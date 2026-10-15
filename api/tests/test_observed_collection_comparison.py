import pytest
from fastapi import HTTPException

from api.observed_collections import collection_comparison


class Cursor:
    def __init__(self, row=None, rows=()):
        self.row, self.rows = row, list(rows)

    def fetchone(self):
        return self.row

    def fetchall(self):
        return self.rows


DESCRIPTOR = {"indicator_id": "grant_amount", "theme_id": "programmes",
    "kind": "period_detail", "label": "Grant", "unit": "€", "descriptor_version": "d1",
    "comparison_detail": "housing", "comparison_period": "2024", "direction": "high",
    "allowed_levels": ["commune"]}


class PublishedConnection:
    def __init__(self, *, bad=None):
        self.sql, self.calls, self.bad = [], [], bad

    def execute(self, sql, params=None):
        self.sql.append(sql)
        self.calls.append((sql,params))
        if "to_regclass('observed_collection_comparison_lineage')" in sql:
            return Cursor((None,False) if self.bad=="storage_missing" else ("observed_collection_comparison_lineage",True))
        if "FROM observed_collection_publication p" in sql:
            return Cursor(("collection-v1", "ref-v1", "ref-v1"))
        if "FROM observed_collection_comparison_publication" in sql:
            if self.bad == "marker_missing": return Cursor()
            if self.bad == "marker_stale": return Cursor(("comparison-v1", "old", "ref-v1", 1, 2, 1, True))
            if self.bad == "lineage_unpublished": return Cursor(("comparison-v1", "collection-v1", "ref-v1", 1, 2, 1, False))
            return Cursor(("comparison-v1", "collection-v1", "ref-v1", 1, 2, 1, True))
        if "FROM observed_collection_comparison_group" in sql:
            row = ("median", 15.0, 2, 2, 0, 1, "collection-v1", "ref-v1")
            return Cursor(row)
        if "FROM observed_collection_comparison_territory" in sql:
            if "territory_id=%s" not in sql: raise AssertionError("focal-only comparison read expected")
            row = ("c1", 10., "measured", 2, 1, 2, "collection-v1", "ref-v1")
            if self.bad == "bad_rank": row = (*row[:3], 3, *row[4:])
            if self.bad == "bad_tie": row = (*row[:4], 2, *row[5:])
            if self.bad == "bad_version": row = (*row[:6], "old", row[7])
            return Cursor() if self.bad == "missing_focal" else Cursor(row)
        if "FROM observed_collection_comparison_lineage" in sql:
            rows = [("source", "v1", "comparison-v1")]
            if self.bad in ("lineage_missing", "empty_lineage"): rows = []
            if self.bad == "lineage_stale": rows = [("source", "v1", "old")]
            return Cursor(rows=rows)
        if "FROM source_dataset sd JOIN source_vintage" in sql:
            return Cursor(rows=[("source", "Dataset", "v1", "2024", None, None)])
        raise AssertionError(sql)


def test_fixed_comparison_uses_published_sparse_facet_without_peer_values():
    conn = PublishedConnection()
    result = collection_comparison(conn, DESCRIPTOR, "commune", "c1", "commune", ("c1", "c2"),
                                   ("density_class", "A", "commune"))
    assert (result["median"], result["rank"], result["rank_size"]) == (15., 2, 2)
    assert "focal_value" not in result and "rank_ties" not in result
    assert result["source_facet"] == {"detail": "housing", "observation_period": "2024"}
    assert not any("period_detail_observation" in sql for sql in conn.sql)
    assert not any("SELECT count(*)" in sql for sql in conn.sql)
    assert not any("FROM observed_collection_comparison_territory" in sql and "territory_id=%s" not in sql for sql in conn.sql)


def test_fixed_read_work_is_independent_of_selected_cohort_size():
    class Large(PublishedConnection):
        def __init__(self, member_count):
            super().__init__()
            self.member_count = member_count

        def execute(self, sql, params=None):
            if "FROM observed_collection_comparison_group" in sql:
                self.sql.append(sql); self.calls.append((sql,params))
                return Cursor(("median",15.,self.member_count,2,self.member_count-2,1,"collection-v1","ref-v1"))
            return super().execute(sql,params)

    sizes=[]
    for count in (2,20000):
        conn=Large(count)
        result=collection_comparison(conn,DESCRIPTOR,"commune","c1","commune",
            tuple(f"c{i}" for i in range(count)),("density_class","A","commune"))
        sizes.append((len(conn.calls),result["selected_member_count"],
            tuple(len(params) if isinstance(params,(tuple,list)) else 0 for _,params in conn.calls)))
        assert not any("period_detail_observation" in sql for sql in conn.sql)
        assert not any(isinstance(params,(tuple,list)) and any(isinstance(value,list) and len(value)>10
            for value in params) for _,params in conn.calls)
    assert sizes[0][0] == sizes[1][0]
    assert sizes[0][1:] != sizes[1][1:]


@pytest.mark.parametrize("bad", ["storage_missing", "missing_focal", "bad_rank", "bad_version", "lineage_missing", "lineage_stale", "lineage_unpublished", "marker_missing", "marker_stale"])
def test_fixed_comparison_rejects_incomplete_or_invalid_rows(bad):
    with pytest.raises(HTTPException) as error:
        collection_comparison(PublishedConnection(bad=bad), DESCRIPTOR, "commune", "c1", "commune",
                              ("c1", "c2"), ("density_class", "A", "commune"))
    assert error.value.status_code == 503


def test_unsupported_contract_bypasses_fixed_tables():
    conn = PublishedConnection()
    result = collection_comparison(conn, DESCRIPTOR, "epci", "e1", "epci", ("e1",),
                                   ("same_level", "bretagne", "epci"))
    assert result["reason"] == "unsupported_comparison_contract"
    assert not any("observed_collection_comparison_" in sql for sql in conn.sql)


def test_anchored_membership_remains_non_comparable():
    descriptor = {**DESCRIPTOR, "kind": "anchored_membership"}
    conn = PublishedConnection()
    result = collection_comparison(conn, descriptor, "commune", "c1", "commune", ("c1",),
                                   ("density_class", "A", "commune"))
    assert result["reason"] == "categorical_membership_not_comparable"
    assert not any("observed_collection_comparison_" in sql for sql in conn.sql)


def test_custom_cohort_reads_peer_facts_not_comparison_tables():
    class Custom(PublishedConnection):
        def execute(self, sql, params=None):
            if "FROM period_detail_observation o" in sql:
                self.sql.append(sql)
                return Cursor(rows=[("c1", 10., "s1", "Dataset", "v1", "2024", None, None),
                                    ("c2", 20., "s1", "Dataset", "v1", "2024", None, None)])
            return super().execute(sql, params)
    conn = Custom()
    result = collection_comparison(conn, DESCRIPTOR, "commune", "c1", "commune", ("c1", "c2"))
    assert result["median"] == 15. and result["rank"] == 2
    assert any("o.value" in sql for sql in conn.sql)
    assert not any("observed_collection_comparison_" in sql for sql in conn.sql)


def test_theme_collection_only_route_passes_exact_fixed_context(monkeypatch):
    from api import main

    class ThemeConn:
        def execute(self, sql, params=None):
            if "SELECT indicator_id,label,unit,direction,comparison_facet" in sql: return Cursor(rows=[])
            if "to_regclass('bpe_profile_evidence_descriptor')" in sql: return Cursor((None,))
            if "to_regclass('series_dataset_descriptor')" in sql: return Cursor((None,))
            if "table_name='territory_reference'" in sql: return Cursor(("ref",))
            return Cursor()

    observed = []
    monkeypatch.setattr(main, "collection_descriptors", lambda *_a, **_kw: [DESCRIPTOR])
    monkeypatch.setattr(main, "_comparison_cohort", lambda *_a: ("commune", ("c1", "c2"), {"kind":"density_class"}))
    monkeypatch.setattr(main, "_fixed_scalar_comparison_context", lambda *_a: ("density_class", "A", "commune"))
    monkeypatch.setattr(main, "collection_comparison", lambda *a: observed.append(a[-1]) or {
        "content_version":"cv", "reference_content_version":"ref", "indicator_id":"grant_amount"})
    monkeypatch.setattr(main, "_profile_comparison_results", lambda *_a: [])
    monkeypatch.setattr(main, "_owned_series_comparison_results", lambda *_a, **_kw: ([], {}, None, None, None))
    monkeypatch.setattr(main, "_demographic_reading_marker", lambda _c: None)
    monkeypatch.setattr(main, "_milieux_reading_marker", lambda _c: None)
    main._theme_comparison_snapshot(ThemeConn(), "commune", "c1", "programmes", None)
    assert observed == [("density_class", "A", "commune")]


def test_fixed_comparison_preserves_sparse_unavailable_result():
    class Sparse(PublishedConnection):
        def execute(self, sql, params=None):
            if "FROM observed_collection_comparison_group" in sql:
                return Cursor(("median", 10., 2, 1, 1, 1, "collection-v1", "ref-v1"))
            if "FROM observed_collection_comparison_territory" in sql:
                return Cursor(("c1", 10., "measured", 1, 1, 1, "collection-v1", "ref-v1"))
            if "FROM observed_collection_comparison_lineage" in sql:
                return Cursor(rows=[("source", "v1", "comparison-v1")])
            return super().execute(sql, params)
    result = collection_comparison(Sparse(), DESCRIPTOR, "commune", "c1", "commune", ("c1", "c2"),
                                   ("density_class", "A", "commune"))
    assert result["status"] == "unavailable"
    assert result["reason"] == "fewer_than_two_comparable_values"
    assert result["median"] is None and result["rank"] is None
