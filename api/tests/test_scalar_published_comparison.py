import pytest
from fastapi import HTTPException

from api import snapshot_reads as main


class Cursor:
    def __init__(self, row=None, rows=None):
        self.row = row
        self.rows = rows or []

    def fetchone(self):
        return self.row

    def fetchall(self):
        return self.rows


def test_fixed_context_resolution_requires_exact_resolved_selection():
    class Connection:
        def execute(self, sql, params=None):
            if "WHERE territory_type='commune'" in sql:
                return Cursor(rows=[("c1", "e1", "A"), ("c2", "e1", "A"), ("c3", "e2", "B")])
            if "WHERE territory_type='region'" in sql:
                return Cursor(rows=[("r1",)])
            raise AssertionError(sql)

    conn = Connection()
    assert main._fixed_scalar_comparison_context(conn, "commune", "c1", ["c1", "c2"],
        "commune", ("c1", "c2"), {"kind": "explicit_selection"}) == ("epci", "e1", "commune")
    assert main._fixed_scalar_comparison_context(conn, "commune", "c3", ["c1", "c2"],
        "commune", ("c1", "c2"), {"kind": "explicit_selection"}) is None
    assert main._fixed_scalar_comparison_context(conn, "commune", "c1", ["c1"],
        "commune", ("c1",), {"kind": "explicit_selection"}) is None
    assert main._fixed_scalar_comparison_context(conn, "commune", "c1", ["c1", "c2", "c3"],
        "commune", ("c1", "c2", "c3"), {"kind": "explicit_selection"}) == ("bretagne", "r1", "commune")
    assert main._fixed_scalar_comparison_context(conn, "commune", "c1", None,
        "commune", ("c1", "c2"), {"kind": "density_class", "density_class_code": "A"}) == (
            "density_class", "A", "commune")
    assert main._fixed_scalar_comparison_context(conn, "epci", "e1", None,
        "epci", ("e1", "e2"), {"kind": "same_level", "territory_type": "epci"}) == (
            "same_level", "r1", "epci")


def test_published_scalar_comparison_reads_group_and_focal_result_without_peer_fact_values():
    class Connection:
        def __init__(self):
            self.sql = []

        def execute(self, sql, params=None):
            self.sql.append((sql, params))
            if "to_regclass('scalar_comparison_publication')" in sql:
                return Cursor(("scalar_comparison_publication",))
            if "FROM scalar_comparison_publication p" in sql:
                return Cursor(("comparison-v1", "scalar-v1", "reference-v1", 1, 2,
                    "scalar-v1", "reference-v1", "reference-v1"))
            if "FROM scalar_comparison_group" in sql:
                return Cursor(rows=[("population", "median", 7.5, 3, 2, 1, 1, True)])
            if "FROM scalar_comparison_territory" in sql:
                if "territory_id=ANY(%s)" in sql:
                    return Cursor(rows=[
                        ("population", "c1", "measured", 1, 1, 2, True),
                        ("population", "c2", "measured", 2, 1, 2, True),
                        ("population", "c3", "not_available", None, None, None, True),
                    ])
                return Cursor(rows=[("population", 10.0, "measured", 1, 1, 2, True)])
            if "FROM comparison_source_lineage l" in sql:
                return Cursor(rows=[("population", "census", "2020", "Census", "2020", None, None, "comparison-v1")])
            raise AssertionError(sql)

    conn = Connection()
    descriptors = [("population", "Population", "persons", "high", "population", ["commune"], "d-v1")]
    result = main._published_scalar_comparison_results(conn, descriptors,
        ("density_class", "A", "commune"), "commune", ("c1", "c2", "c3"), "c1")

    assert result["population"] == {
        "status": "available", "reason": None, "selected_member_count": 3,
        "eligible_count": 2, "missing_count": 1, "focal_value": 10.0,
        "median": 7.5, "rank": 1, "rank_size": 2,
        "comparison_sources": [{"source_id": "census", "name": "Census", "vintage_id": "2020",
            "version": "2020", "reference_date": None, "publication_date": None}],
    }
    assert not any("scalar_observation o" in sql and "o.value" in sql for sql, _ in conn.sql)

    selected = main._published_scalar_comparison_results(conn, descriptors,
        ("density_class", "A", "commune"), "commune", ("c1", "c2", "c3"), "c1",
        selected_fields={"median"})["population"]
    assert selected["median"] == 7.5 and selected["status"] == "available"
    assert "rank" not in selected and "focal_value" not in selected
    group_query = [(sql,params) for sql,params in conn.sql if "FROM scalar_comparison_group" in sql][-1]
    territory_query = [(sql,params) for sql,params in conn.sql if "FROM scalar_comparison_territory" in sql][-1]
    assert "CASE WHEN %s THEN median" in group_query[0] and group_query[1][0] is True
    assert all(value is False for value in territory_query[1][:4])
    assert not any("territory_id=ANY(%s)" in sql for sql, _ in conn.sql)

    peer_selection = main._published_scalar_comparison_results(conn, descriptors,
        ("density_class", "A", "commune"), "commune", ("c1", "c2", "c3"), "c1",
        include_member_ranks=True, selected_fields=("median", "member_ranks"))["population"]
    assert peer_selection["member_ranks"] == [
        {"territory_id": "c1", "rank": 1, "rank_size": 2, "rank_ties": 1},
        {"territory_id": "c2", "rank": 2, "rank_size": 2, "rank_ties": 1},
        {"territory_id": "c3", "rank": None, "rank_size": None, "rank_ties": None},
    ]
    assert any("territory_id=ANY(%s)" in sql for sql, _ in conn.sql)


def test_published_scalar_member_projection_preserves_a_single_eligible_rank():
    class Connection:
        def execute(self, sql, params=None):
            if "to_regclass('scalar_comparison_publication')" in sql:
                return Cursor(("scalar_comparison_publication",))
            if "FROM scalar_comparison_publication p" in sql:
                return Cursor(("comparison-v1", "scalar-v1", "reference-v1", 1, 2,
                    "scalar-v1", "reference-v1", "reference-v1"))
            if "FROM scalar_comparison_group" in sql:
                return Cursor(rows=[("population", "median", 10.0, 2, 1, 1, 1, True)])
            if "FROM scalar_comparison_territory" in sql:
                if "territory_id=ANY(%s)" in sql:
                    return Cursor(rows=[
                        ("population", "c1", "measured", 1, 1, 1, True),
                        ("population", "c2", "not_available", None, None, None, True),
                    ])
                return Cursor(rows=[("population", 10.0, "measured", 1, 1, 1, True)])
            if "FROM comparison_source_lineage l" in sql:
                return Cursor(rows=[("population", "census", "2020", "Census", "2020", None, None, "comparison-v1")])
            raise AssertionError(sql)

    result = main._published_scalar_comparison_results(
        Connection(),
        [("population", "Population", "persons", "high", "population", ["commune"], "d-v1")],
        ("same_level", "g1", "commune"), "commune", ("c1", "c2"), "c1",
        include_member_ranks=True, selected_fields=("median", "member_ranks"),
    )["population"]

    assert result["median"] == 10.0
    assert result["member_ranks"] == [
        {"territory_id": "c1", "rank": 1, "rank_size": 1, "rank_ties": 1},
        {"territory_id": "c2", "rank": None, "rank_size": None, "rank_ties": None},
    ]

def test_published_scalar_comparison_fails_closed_on_stale_inputs_or_missing_results():
    class Connection:
        def __init__(self, stale=False, missing=False, invalid=False):
            self.stale = stale
            self.missing = missing
            self.invalid = invalid

        def execute(self, sql, params=None):
            if "to_regclass('scalar_comparison_publication')" in sql:
                return Cursor(("scalar_comparison_publication",))
            if "FROM scalar_comparison_publication p" in sql:
                return Cursor(("comparison-v1", "old-scalar" if self.stale else "scalar-v1",
                    "reference-v1", 1, 1, "scalar-v1", "reference-v1", "reference-v1"))
            if "FROM scalar_comparison_group" in sql:
                return Cursor(rows=[] if self.missing else [("population", "median", 1.0, 1, 1, 0, 1, True)])
            if "FROM scalar_comparison_territory" in sql:
                rank = 2 if self.invalid else 1
                return Cursor(rows=[] if self.missing else [("population", 1.0, "measured", rank, 1, 1, not self.invalid)])
            raise AssertionError(sql)

    descriptor = [("population", "Population", "persons", "high", "population", ["commune"], "d-v1")]
    with pytest.raises(HTTPException) as stale:
        main._published_scalar_comparison_results(Connection(stale=True), descriptor,
            ("density_class", "A", "commune"), "commune", ("c1",), "c1")
    assert stale.value.status_code == 503
    with pytest.raises(HTTPException) as missing:
        main._published_scalar_comparison_results(Connection(missing=True), descriptor,
            ("density_class", "A", "commune"), "commune", ("c1",), "c1")
    assert missing.value.status_code == 503
    with pytest.raises(HTTPException) as invalid:
        main._published_scalar_comparison_results(Connection(invalid=True), descriptor,
            ("density_class", "A", "commune"), "commune", ("c1",), "c1")
    assert invalid.value.status_code == 503


@pytest.mark.parametrize("corruption", ["status_counts", "tie_span"])
def test_published_scalar_peer_rows_match_group_counts_and_tie_span(corruption):
    class Connection:
        def execute(self, sql, params=None):
            if "to_regclass('scalar_comparison_publication')" in sql:
                return Cursor(("scalar_comparison_publication",))
            if "FROM scalar_comparison_publication p" in sql:
                return Cursor(("comparison-v1", "scalar-v1", "reference-v1", 1, 3,
                    "scalar-v1", "reference-v1", "reference-v1"))
            if "FROM scalar_comparison_group" in sql:
                return Cursor(rows=[("population", "median", 7.5, 3, 2, 1, 1, True)])
            if "FROM scalar_comparison_territory" in sql:
                if "territory_id=ANY(%s)" in sql:
                    if corruption == "status_counts":
                        peers = [
                            ("population", "c1", "measured", 1, 1, 2, True),
                            ("population", "c2", "not_available", None, None, None, True),
                            ("population", "c3", "not_available", None, None, None, True),
                        ]
                    else:
                        peers = [
                            ("population", "c1", "measured", 1, 1, 2, True),
                            ("population", "c2", "measured", 2, 2, 2, False),
                            ("population", "c3", "not_available", None, None, None, True),
                        ]
                    return Cursor(rows=peers)
                return Cursor(rows=[("population", 10.0, "measured", 1, 1, 2, True)])
            if "FROM comparison_source_lineage l" in sql:
                return Cursor(rows=[("population", "census", "2020", "Census", "2020", None, None,
                    "comparison-v1")])
            raise AssertionError(sql)

    descriptor = [("population", "Population", "persons", "high", "population", ["commune"], "d-v1")]
    with pytest.raises(HTTPException) as error:
        main._published_scalar_comparison_results(Connection(), descriptor,
            ("density_class", "A", "commune"), "commune", ("c1", "c2", "c3"), "c1",
            include_member_ranks=True, selected_fields=("median", "member_ranks"))
    assert error.value.status_code == 503


def test_theme_comparison_uses_published_fixed_scalar_results_but_keeps_dynamic_selection(monkeypatch):
    descriptor = ("population", "Population", "persons", "high", "population", ["commune"], "d-v1")
    dynamic_calls = []
    published_calls = []

    class Connection:
        def execute(self, sql, params=None):
            if "SELECT indicator_id,label,unit,direction,comparison_facet" in sql:
                return Cursor(rows=[descriptor])
            if "to_regclass('bpe_profile_evidence_descriptor')" in sql:
                return Cursor((None,))
            if "to_regclass('series_dataset_descriptor')" in sql:
                return Cursor((None,))
            if "table_name='territory_reference'" in sql:
                return Cursor(("reference-v1",))
            if "table_name='scalar_observation'" in sql:
                return Cursor(("scalar-v1", "reference-v1"))
            raise AssertionError(sql)

    monkeypatch.setattr(main, "focal_profiles", lambda *args, **kwargs: ([], None))
    monkeypatch.setattr(main, "collection_descriptors", lambda *args, **kwargs: [])
    monkeypatch.setattr(main, "_demographic_reading_marker", lambda _conn: None)
    monkeypatch.setattr(main, "_comparison_cohort", lambda *_args: (
        "commune", ("c1", "c2"), {"kind": "density_class"}))
    monkeypatch.setattr(main, "_fixed_scalar_comparison_context", lambda *_args, **_kwargs: (
        "density_class", "A", "commune") if _args[3] is None else None)
    monkeypatch.setattr(main, "_published_scalar_comparison_results", lambda *_args, **kwargs: (
        published_calls.append(kwargs) or {"population": {"status": "available", "reason": None,
            "selected_member_count": 2, "eligible_count": 2, "missing_count": 0,
            "focal_value": 10.0, "median": 7.5, "rank": 1, "rank_size": 2,
            "comparison_sources": []}}))
    monkeypatch.setattr(main, "_selected_scalar_comparison_inputs", lambda *_args, **_kwargs: (
        dynamic_calls.append(True) or [("population", "c1", "commune", 10.0, "measured"),
            ("population", "c2", "commune", 5.0, "measured")], {}))
    monkeypatch.setattr(main, "_profile_comparison_results", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(main, "_owned_series_comparison_results", lambda *_args, **_kwargs: ([], {}, None, None, None))

    fixed = main._theme_comparison_snapshot(Connection(), "commune", "c1", "demographie", None,
        result_fields=("member_ranks",))
    assert fixed["results"][0]["median"] == 7.5
    assert published_calls[0]["include_member_ranks"] is True
    assert dynamic_calls == []

    monkeypatch.setattr(main, "_fixed_scalar_comparison_context", lambda *_args, **_kwargs: None)
    dynamic = main._theme_comparison_snapshot(Connection(), "commune", "c1", "demographie",
        [("commune", "c2")], result_fields=("member_ranks",))
    assert dynamic["results"][0]["member_ranks"] == [
        {"territory_id": "c1", "rank": 1, "rank_size": 2, "rank_ties": 1},
        {"territory_id": "c2", "rank": 2, "rank_size": 2, "rank_ties": 1},
    ]
    assert dynamic_calls == [True]

    monkeypatch.setattr(main, "_comparison_cohort", lambda *_args: (
        "commune", ("c2",), {"kind": "explicit_selection"}))
    monkeypatch.setattr(main, "_fixed_scalar_comparison_context", lambda *_args, **_kwargs: (
        "density_class", "A", "commune"))
    outside = main._theme_comparison_snapshot(Connection(), "commune", "c1", "demographie", [("commune", "c2")])
    assert outside["results"][0]["rank"] is None
    assert dynamic_calls == [True, True]
    assert len(published_calls) == 1


def test_selected_scalar_member_projection_preserves_a_single_eligible_rank(monkeypatch):
    class Connection:
        def execute(self, sql, params=None):
            if "SELECT indicator_id,label,unit,direction,comparison_facet" in sql:
                return Cursor(rows=[("population", "Population", "persons", "high", "population", ["commune"], "d-v1")])
            if "to_regclass('bpe_profile_evidence_descriptor')" in sql or "to_regclass('series_dataset_descriptor')" in sql:
                return Cursor((None,))
            if "table_name='territory_reference'" in sql:
                return Cursor(("reference-v1",))
            if "table_name='scalar_observation'" in sql:
                return Cursor(("scalar-v1", "reference-v1"))
            raise AssertionError(sql)

    monkeypatch.setattr(main, "focal_profiles", lambda *args, **kwargs: ([], None))
    monkeypatch.setattr(main, "collection_descriptors", lambda *args, **kwargs: [])
    monkeypatch.setattr(main, "_demographic_reading_marker", lambda _conn: None)
    monkeypatch.setattr(main, "_comparison_cohort", lambda *_args: (
        "commune", ("c1", "c2"), {"kind": "explicit_selection"}))
    monkeypatch.setattr(main, "_fixed_scalar_comparison_context", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(main, "_selected_scalar_comparison_inputs", lambda *_args, **_kwargs: (
        [("population", "c1", "commune", 10.0, "measured"),
         ("population", "c2", "commune", None, "not_available")], {}))
    monkeypatch.setattr(main, "_profile_comparison_results", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(main, "_owned_series_comparison_results", lambda *_args, **_kwargs: ([], {}, None, None, None))

    result = main._theme_comparison_snapshot(Connection(), "commune", "c1", "demographie",
        [("commune", "c1"), ("commune", "c2")],
        result_fields=("median", "rank", "rank_size", "rank_ties", "member_ranks"))["results"][0]

    assert (result["eligible_count"], result["missing_count"], result["median"]) == (1, 1, 10.0)
    assert (result["rank"], result["rank_size"], result["rank_ties"]) == (1, 1, 1)
    assert result["member_ranks"] == [
        {"territory_id": "c1", "rank": 1, "rank_size": 1, "rank_ties": 1},
        {"territory_id": "c2", "rank": None, "rank_size": None, "rank_ties": None},
    ]

    rank_only = main._project_comparison_result_fields(result,
        ("rank", "rank_size", "rank_ties", "member_ranks"))
    assert rank_only["rank_ties"] == 1
    assert "median" not in rank_only and "focal_value" not in rank_only
