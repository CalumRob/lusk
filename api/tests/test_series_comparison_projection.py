"""Boundary checks for the requested-only ordered-series comparison projection (#857).

The projection is the owner-approved bounded seam: it re-reads PUBLISHED
comparison evidence for axes already present in the comparison publication,
never reconstructs fixed groups, never aliases calendar facts to state roles,
and never fires on unrequested reads. These unit tests lock each side of that
boundary with a scripted read-only connection.
"""

import pytest
from fastapi import HTTPException
from types import SimpleNamespace

from api import series_comparison_projection as projection


class Cursor:
    def __init__(self, rows=(), row=None):
        self.rows, self.row = list(rows), row

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.row if self.row is not None else (self.rows[0] if self.rows else None)


AXES = ["M2", "M3"]
MEMBERS = ["e1", "e2", "e3"]
# Published M3 grain of the #857 worked example: median 180 over three EPCIs.
PUBLISHED_VALUES = {"M2": {"e1": 10.0, "e2": 30.0, "e3": 20.0},
                    "M3": {"e1": 360.0, "e2": 120.0, "e3": 180.0}}
PUBLISHED_GROUPS = {"M2": 20.0, "M3": 180.0}
# Raw observations deliberately DISAGREE with the published medians: a
# reconstruction from raw facts would return 20.0/220.0, never 20.0/180.0.
RAW_VALUES = {"M2": {"e1": 5.0, "e2": 35.0, "e3": 20.0, "c1": 11.0, "c2": 21.0},
              "M3": {"e1": 300.0, "e2": 140.0, "e3": 220.0, "c1": 310.0, "c2": 150.0}}


class ProjectionConnection:
    """Scripted read-only connection at the published comparison grain."""

    def __init__(self, *, stale=None, missing_group=False, missing_publication=False,
                 eligible=3, bad_rank=False, foreign_member=False, budget_override=None):
        self.stale = stale
        self.missing_group = missing_group
        self.missing_publication = missing_publication
        self.eligible = eligible
        self.bad_rank = bad_rank
        self.foreign_member = foreign_member
        self.budget_override = budget_override
        self.statements = []

    def execute(self, sql, params=None):
        self.statements.append(" ".join(sql.split()))
        if sql.startswith("SELECT count(*) FROM"):
            inner = " ".join(sql.split())
            if "ordered_series_comparison_lineage" in inner:
                return Cursor(row=(len(MEMBERS) * len(AXES),))
            if "series_observation_provenance" in inner:
                return Cursor(row=(len(MEMBERS) * len(AXES),))
            raise AssertionError(f"Unexpected bounded count: {sql}")
        if "SELECT d.dataset_id,d.axis_kind,d.axis_values" in sql:
            if self.stale == "descriptor_missing":
                return Cursor()
            return Cursor(row=("owned-v1", "declared_detail", AXES, "low", "median",
                "default_group", "desc-v1", "series-v1", "ref-v1", "ref-v1"))
        if "FROM ordered_series_comparison_publication" in sql:
            if self.missing_publication or self.stale == "missing":
                return Cursor()
            source = "old-series" if self.stale == "series" else "series-v1"
            reference = "old-ref" if self.stale == "reference" else "ref-v1"
            return Cursor(row=(AXES, source, reference))
        if "SELECT territory_id,territory_type,density_class_code FROM territory_reference WHERE territory_id=%s" in sql:
            return Cursor(row=("e1", "epci", "d1"))
        if "SELECT territory_id,territory_type,department_id,epci_id,density_class_code FROM territory_reference" in sql:
            return Cursor(rows=[("e1", "epci", "35", None, "d1"), ("e2", "epci", "35", None, "d1"),
                ("e3", "epci", "22", None, "d1"), ("53", "region", None, None, None),
                ("c1", "commune", "35", "e1", "d1"), ("c2", "commune", "35", "e1", "d1")])
        if "SELECT territory_id FROM territory_reference WHERE territory_type='region'" in sql:
            return Cursor(rows=[("53",)])
        if "FROM ordered_series_comparison_group" in sql:
            if self.missing_group:
                return Cursor(rows=[])
            count = len(MEMBERS) + (1 if self.foreign_member else 0)
            return Cursor(rows=[(axis, "median", PUBLISHED_GROUPS[axis], count,
                self.eligible, count - self.eligible, len(MEMBERS)) for axis in AXES])
        if "FROM ordered_series_comparison_territory" in sql:
            members = ["e4"] if self.foreign_member else MEMBERS
            rows = []
            for axis in AXES:
                for tid in members:
                    measured = tid in PUBLISHED_VALUES.get(axis, {}) and (
                        self.eligible >= 2 or tid == "e1")
                    value = PUBLISHED_VALUES[axis].get(tid) if measured else None
                    rank = None
                    rank_size = None
                    ties = None
                    if measured and self.eligible >= 2:
                        rank = 99 if self.bad_rank else 1 + sum(
                            other < value for other in PUBLISHED_VALUES[axis].values())
                        rank_size = self.eligible + (2 if self.bad_rank else 0)
                        ties = 1
                    elif measured and self.eligible == 1:
                        rank, rank_size, ties = 1, 1, 1
                    rows.append((axis, tid, value, "measured" if measured else "missing",
                        rank, rank_size, ties))
            return Cursor(rows=rows)
        if "FROM ordered_series_comparison_lineage" in sql:
            return Cursor(rows=[(axis, f"rev-{axis}-{tid}", "src", "vintage", "Fixture source",
                "Fixture dataset", "src-version", "2026-01-02", "2026-07-03", f"hash-{axis}")
                for axis in AXES for tid in MEMBERS])
        if "FROM series_dataset_observation o LEFT JOIN series_observation_provenance" in sql:
            rows = []
            for tid in params[3]:
                for axis in params[4]:
                    value = RAW_VALUES[axis].get(tid)
                    rows.append((axis, tid, value, "measured" if value is not None else "missing",
                        None, f"rev-{tid}-{axis}", "src", "vintage", "Fixture source",
                        "Fixture dataset", "src-version", "2026-01-02", "2026-07-03", f"hash-{axis}"))
            return Cursor(rows=rows)
        raise AssertionError(f"Unexpected SQL in projection test: {sql}")


def read_item(*, coordinates=None, fields=("axis_comparisons",), intent="fixed_comparison",
              target_type="epci", target_id="e1"):
    from types import SimpleNamespace
    members = None
    if intent == "selected_comparison":
        members = [SimpleNamespace(type="commune", id="c1"), SimpleNamespace(type="commune", id="c2")]
    return SimpleNamespace(resource="artif_x", fields=list(fields) if fields is not None else None,
        coordinates=coordinates,
        target=SimpleNamespace(kind="territory", type=target_type, id=target_id),
        intent=SimpleNamespace(kind=intent, members=members))


def test_unrequested_calendar_axis_is_refused_not_aliased_to_a_state_role():
    """A calendar coordinate is not a published comparison axis: 422, never M2/M3 evidence."""
    conn = ProjectionConnection()
    with pytest.raises(HTTPException) as excinfo:
        projection.read_axis_comparisons(conn, read_item(coordinates={"declared_detail": ["2023"]}))
    assert excinfo.value.status_code == 422
    assert "published comparison axis" in excinfo.value.detail


def test_foreign_coordinate_axis_is_refused():
    conn = ProjectionConnection()
    with pytest.raises(HTTPException) as excinfo:
        projection.read_axis_comparisons(conn, read_item(coordinates={"declared_year": ["M3"]}))
    assert excinfo.value.status_code == 422
    assert "native descriptor" in excinfo.value.detail


def test_fixed_group_reads_published_median_never_reconstructs_from_raw_facts():
    conn = ProjectionConnection()
    result = projection.read_axis_comparisons(conn, read_item())
    assert [(point["axis"], point["value"], point["eligible_count"]) for point in result] == [
        ("M2", 20.0, 3), ("M3", 180.0, 3)]
    m3 = result[1]
    assert m3["statistic"] == "median"
    assert m3["min"] == 120.0 and m3["max"] == 360.0
    assert {rank["territory_id"]: rank["rank"] for rank in m3["member_ranks"]} == {
        "e1": 3, "e2": 1, "e3": 2}
    assert all(source["revision_hash"] == f"hash-{point['axis']}"
               for point in result for source in point["sources"])
    assert all("INSERT" not in sql and "UPDATE" not in sql and "DELETE" not in sql
               for sql in conn.statements)


def test_published_evidence_mismatch_fails_closed():
    conn = ProjectionConnection(foreign_member=True)
    with pytest.raises(HTTPException) as excinfo:
        projection.read_axis_comparisons(conn, read_item())
    assert excinfo.value.status_code == 503
    assert "inconsistent" in excinfo.value.detail

    conn = ProjectionConnection(bad_rank=True)
    with pytest.raises(HTTPException) as excinfo:
        projection.read_axis_comparisons(conn, read_item())
    assert excinfo.value.status_code == 503

    conn = ProjectionConnection(missing_group=True)
    with pytest.raises(HTTPException) as excinfo:
        projection.read_axis_comparisons(conn, read_item())
    assert excinfo.value.status_code == 503
    assert "incomplete" in excinfo.value.detail


def test_stale_publication_markers_fail_closed_before_any_read():
    for stale in ("series", "reference", "missing"):
        conn = ProjectionConnection(stale=stale)
        with pytest.raises(HTTPException) as excinfo:
            projection.read_axis_comparisons(conn, read_item())
        assert excinfo.value.status_code == 503
        assert "unavailable" in excinfo.value.detail
    conn = ProjectionConnection(missing_publication=True)
    with pytest.raises(HTTPException) as excinfo:
        projection.read_axis_comparisons(conn, read_item())
    assert excinfo.value.status_code == 503


def test_singleton_published_population_is_unavailable_with_null_ranks():
    conn = ProjectionConnection(eligible=1)
    result = projection.read_axis_comparisons(conn, read_item())
    assert all(point["status"] == "unavailable" and point["value"] is None and
        point["min"] is None and point["max"] is None and
        all(rank["rank"] is None and rank["rank_size"] is None and rank["rank_ties"] is None
            for rank in point["member_ranks"])
        for point in result)


def test_projection_preflight_bounds_member_axis_work():
    conn = ProjectionConnection()
    work = projection.preflight_axis_comparisons(conn, read_item(), 100_000)
    assert work >= len(MEMBERS) * len(AXES)
    with pytest.raises(HTTPException) as excinfo:
        projection.preflight_axis_comparisons(conn, read_item(), 1)
    assert excinfo.value.status_code == 413


def test_selected_comparison_keeps_the_existing_unique_commune_min_two_policy():
    conn = ProjectionConnection()
    result = projection.read_axis_comparisons(conn, read_item(intent="selected_comparison"))
    # Two selected communes resolve to their own published commune values, not
    # to a parent peer population; the median is computed over exactly them.
    assert result[1]["selected_member_count"] == 2
    assert result[1]["eligible_count"] == 2
    assert {rank["territory_id"] for rank in result[1]["member_ranks"]} == {"c1", "c2"}


def test_reader_projection_is_requested_only_and_default_reads_stay_unchanged(monkeypatch):
    """Without the opt-in field the shared reader never enters the projection."""
    from api.semantic_resource_reader import SemanticResourceReader
    from api.resource_catalogue import default_resource_catalogue

    def fail_projection(*_args, **_kwargs):
        raise AssertionError("Unrequested reads must not reach the comparison projection")

    monkeypatch.setattr(projection, "read_axis_comparisons", fail_projection)
    monkeypatch.setattr(projection, "preflight_axis_comparisons", fail_projection)

    class ReaderProbe(SemanticResourceReader):
        def __init__(self):
            self._cohort_scopes = {}

    reader = ReaderProbe()
    catalogue = default_resource_catalogue()
    assert "ordered_series" in catalogue.resources_by_id["artif_par_habitant"].shapes
    # A facts read without axis_comparisons must return the plain cohort read
    # (no axis_comparisons key), via a stubbed cohort read.
    monkeypatch.setattr("api.semantic_resource_reader.resolve_territory_cohort",
                        lambda conn, target, work_budget: ("commune", ("c1",), {"kind": "bretagne"}))
    monkeypatch.setattr("api.semantic_resource_reader.read_cohort",
                        lambda conn, item, resource, cohort, fields: {"result": {"status": "measured"}})
    item = read_item(fields=None, intent="facts", target_type="commune", target_id="c1")
    item.resource = "artif_par_habitant"
    item.target = SimpleNamespace(kind="territory_cohort", type="commune",
        department_id=None, epci_id=None)
    data = reader.read(conn=None, item=item, catalogue=catalogue)
    assert "axis_comparisons" not in data["result"]
