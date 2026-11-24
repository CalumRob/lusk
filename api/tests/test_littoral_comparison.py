"""#1042 — API recognition of published littoral comparison contexts.

The four non-AEDAR families share one member-set recogniser. An exact
same-status commune set resolves to the published ``littoral`` context just as
an exact density-class set resolves to ``density_class``; mixed or partial sets
stay explicit selections. Missing/corrupt classification fails closed with a
named reason and never falls back to density, Bretagne or an arbitrary group.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from api import snapshot_reads as sr


class Cursor:
    def __init__(self, row=None, rows=None):
        self.row = row
        self.rows = rows or []

    def fetchone(self):
        return self.row

    def fetchall(self):
        return self.rows


# Commune rows in _comparison_cohort order:
# (territory_id, territory_type, department_id, epci_id, density_class_code, littoral_code)
REFERENCE_ROWS = (
    ("c1", "commune", "22", "e1", "A", "C"),
    ("c2", "commune", "22", "e2", "B", "C"),
    ("c3", "commune", "29", "e2", "A", "NC"),
    ("c4", "commune", "29", "e1", "B", "NC"),
    ("c5", "commune", "29", "e3", "A", "NC"),
    ("e1", "epci", None, None, None, None),
    ("e2", "epci", None, None, None, None),
    ("e3", "epci", None, None, None, None),
    ("r1", "region", None, None, None, None),
)


def _recognise(focal="c1", members=("c1", "c2"), rows=REFERENCE_ROWS):
    return sr._fixed_scalar_comparison_context(
        _Connection(rows), "commune", focal, list(members), "commune", tuple(members),
        {"kind": "explicit_selection"},
    )


class _Connection:
    def __init__(self, rows=REFERENCE_ROWS):
        self.rows = rows
        self.sql = []

    def execute(self, sql, params=None):
        self.sql.append((sql, params))
        if "WHERE territory_type='commune'" in sql:
            return Cursor(rows=[(r[0], r[3], r[4], r[5] if len(r) > 5 else None)
                                for r in self.rows if r[1] == "commune"])
        if "WHERE territory_type='region'" in sql:
            return Cursor(rows=[(r[0],) for r in self.rows if r[1] == "region"])
        raise AssertionError(sql)


def test_exact_c_and_nc_member_sets_resolve_to_published_littoral_context():
    # C cohort, focal included (c1 is C).
    assert _recognise(members=("c1", "c2")) == ("littoral", "C", "commune")
    # NC cohort with an NC focal (c3 is NC).
    assert _recognise(focal="c3", members=("c3", "c4", "c5")) == ("littoral", "NC", "commune")


def test_inexact_mixed_and_foreign_cohort_sets_stay_explicit_or_unresolved():
    # A partial subset of C is not the published C cohort.
    assert _recognise(members=("c1",)) is None
    # A mixed set spanning C and NC is not any same-status cohort.
    assert _recognise(members=("c1", "c2", "c3")) is None
    # The NC cohort is not the published group for a C focal (focal inclusion).
    assert _recognise(focal="c1", members=("c3", "c4", "c5")) is None


def test_existing_epci_bretagne_density_resolution_is_unchanged():
    class LegacyRows:
        pass

    # Without the littoral column, a full-epci set still resolves to epci and a
    # full-commune set still resolves to bretagne: no borrowed littoral group.
    rows_5 = tuple(r[:5] for r in REFERENCE_ROWS)
    assert _recognise(members=("c1", "c4"), rows=rows_5) == ("epci", "e1", "commune")
    assert _recognise(members=("c1", "c2", "c3", "c4", "c5"), rows=rows_5) == ("bretagne", "r1", "commune")
    assert sr._fixed_scalar_comparison_context(
        _Connection(rows_5), "commune", "c1", None, "commune", ("c1", "c2"),
        {"kind": "density_class", "density_class_code": "A"},
    ) == ("density_class", "A", "commune")


def test_missing_or_partial_classification_fails_closed_with_named_reason():
    # Focal unclassified while other communes are classified: a corrupt
    # crosswalk must not be served as an arbitrary selection or a density group.
    partial = tuple((r[0], r[1], r[2], r[3], r[4], None if r[0] == "c1" else r[5])
                    for r in REFERENCE_ROWS)
    with pytest.raises(HTTPException) as raised:
        _recognise(members=("c2",), rows=partial)
    assert raised.value.status_code == 503
    assert "littoral" in raised.value.detail


@pytest.mark.parametrize("focal, peer", [("c1", "c2"), ("c3", "c4")])
def test_classified_focal_with_unclassified_peer_fails_closed(focal, peer):
    # The producer rejects a partial crosswalk regardless of which cohort the
    # focal belongs to. The API must not build a truncated littoral cohort from
    # the classified subset: any unclassified commune poisons the reference.
    partial = tuple((r[0], r[1], r[2], r[3], r[4], None if r[0] == peer else r[5])
                    for r in REFERENCE_ROWS)
    with pytest.raises(HTTPException) as raised:
        _recognise(focal=focal, members=(focal,), rows=partial)
    assert raised.value.status_code == 503
    assert "littoral" in raised.value.detail


@pytest.mark.parametrize("focal, epci_members, epci_id", [
    ("c1", ("c1", "c4"), "e1"),
    ("c3", ("c2", "c3"), "e2"),
])
def test_fully_unclassified_legacy_reference_keeps_existing_contexts(focal, epci_members, epci_id):
    # No classification at all is the historical transition shape: it offers
    # no littoral context but leaves density/EPCI/Bretagne resolution intact.
    legacy = tuple((r[0], r[1], r[2], r[3], r[4], None) for r in REFERENCE_ROWS)
    assert _recognise(focal=focal, members=epci_members, rows=legacy) == ("epci", epci_id, "commune")
    assert _recognise(focal=focal, members=tuple(r[0] for r in REFERENCE_ROWS if r[1] == "commune"),
                      rows=legacy) == ("bretagne", "r1", "commune")
    assert sr._fixed_scalar_comparison_context(
        _Connection(legacy), "commune", focal, None, "commune", epci_members,
        {"kind": "density_class", "density_class_code": "A"},
    ) == ("density_class", "A", "commune")


def test_comparison_cohort_reads_littoral_classification_without_changing_defaults():
    conn = _Connection()

    class CohortConnection(_Connection):
        def execute(self, sql, params=None):
            self.sql.append((sql, params))
            if "WHERE territory_id=%s" in sql and "density_class_code" in sql:
                return Cursor(row=("c1", "commune", "C"))
            if "FROM territory_reference" in sql and "epci_id" in sql:
                return Cursor(rows=REFERENCE_ROWS)
            raise AssertionError(sql)

    cohort = CohortConnection()
    level, members, scope = sr._comparison_cohort(cohort, "commune", "c1", None)
    assert level == "commune"
    assert scope["kind"] == "density_class"          # default unchanged
    assert any("littoral_code" in sql for sql, _ in cohort.sql)

    # Exact same-status selection is passed through as an explicit selection;
    # the fixed-context recogniser resolves it to the published littoral group.
    level, members, scope = sr._comparison_cohort(cohort, "commune", "c1",
        [("commune", "c1"), ("commune", "c2")])
    assert level == "commune" and set(members) == {"c1", "c2"}


def test_littoral_fixed_context_reads_published_group_without_peer_facts():
    """A published read addressed at the littoral context keeps ranks/lineage."""
    descriptors = [("population", "Population", "persons", "high", "population", ["commune"], "d-v1")]

    class PublishedConnection:
        def execute(self, sql, params=None):
            if "to_regclass('scalar_resource_comparison_publication')" in sql:
                return Cursor(("scalar_comparison_publication",))
            if "FROM resource_publication" in sql:
                return Cursor(rows=[("population", "scalar", "scalar-v1", "reference-v1")])
            if "SELECT content_version" in sql and "territory_reference" in sql:
                return Cursor(("reference-v1",))
            if "FROM scalar_resource_comparison_publication" in sql:
                return Cursor(rows=[("population", "comparison-v1", "scalar-v1", "reference-v1", 1, 2,
                    "scalar-v1", "reference-v1", "reference-v1")])
            if "FROM scalar_comparison_group" in sql:
                assert params[1] == "littoral" and params[2] == "C"
                return Cursor(rows=[("population", "median", 5.0, 2, 2, 0, 1, True)])
            if "FROM scalar_comparison_territory" in sql:
                return Cursor(rows=[("population", 10.0, "measured", 1, 1, 2, True)])
            if "FROM comparison_source_lineage l" in sql:
                return Cursor(rows=[("population", "census", "2020", "Census", "2020", None, None, "comparison-v1")])
            raise AssertionError(sql)

    result = sr._published_scalar_comparison_results(
        PublishedConnection(), descriptors, ("littoral", "C", "commune"),
        "commune", ("c1", "c2"), "c1",
    )["population"]
    assert result["median"] == 5.0
    assert result["rank"] == 1 and result["rank_size"] == 2
    assert result["status"] == "available"


@pytest.mark.parametrize("absence", ["missing_group", "stale_generation"])
def test_absent_littoral_publication_fails_closed_without_borrowed_statistics(absence):
    """A classified reference with no (or stale) littoral publication is 503.

    No density/Bretagne group or focal statistic may be served instead.
    """
    descriptors = [("population", "Population", "persons", "high", "population", ["commune"], "d-v1")]

    class AbsentConnection:
        def __init__(self):
            self.sql = []

        def execute(self, sql, params=None):
            self.sql.append((sql, params))
            if "to_regclass('scalar_resource_comparison_publication')" in sql:
                return Cursor(("scalar_comparison_publication",))
            if "FROM resource_publication" in sql:
                return Cursor(rows=[("population", "scalar", "scalar-v1", "reference-v1")])
            if "SELECT content_version" in sql and "territory_reference" in sql:
                return Cursor(("reference-v1",))
            if "FROM scalar_resource_comparison_publication" in sql:
                marker = ["comparison-v1", "scalar-v1", "reference-v1", 1, 2,
                          "scalar-v1", "reference-v1", "reference-v1"]
                if absence == "stale_generation":
                    marker[2] = "older-reference-generation"
                return Cursor(rows=[("population", *marker)])
            if "FROM scalar_comparison_group" in sql:
                assert params[1] == "littoral" and params[2] == "C"
                return Cursor(rows=[] if absence == "missing_group" else [
                    ("population", "median", 5.0, 2, 2, 0, 1, True)])
            if "FROM scalar_comparison_territory" in sql:
                return Cursor(rows=[])
            if "FROM comparison_source_lineage l" in sql:
                return Cursor(rows=[])
            raise AssertionError(sql)

    connection = AbsentConnection()
    with pytest.raises(HTTPException) as raised:
        sr._published_scalar_comparison_results(
            connection, descriptors, ("littoral", "C", "commune"),
            "commune", ("c1", "c2"), "c1",
        )
    assert raised.value.status_code == 503
    expected = ("territory reference publication" if absence == "stale_generation"
                else "scalar comparison")
    assert expected in raised.value.detail.lower()
    # Every published read was addressed at the littoral context only: no
    # density/Bretagne group or focal statistic was fetched as a substitute.
    assert connection.sql
    for _sql, params in connection.sql:
        assert "density_class" not in tuple(str(value) for value in (params or ()))
        assert "bretagne" not in tuple(str(value) for value in (params or ()))

