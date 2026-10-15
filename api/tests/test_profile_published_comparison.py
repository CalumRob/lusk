import pytest
from fastapi import HTTPException

from api import main


class Cursor:
    def __init__(self, row=None, rows=()):
        self.row, self.rows = row, list(rows)

    def fetchone(self):
        return self.row

    def fetchall(self):
        return self.rows


PROFILE = {"indicator": "housing_profile", "label": "Housing", "unit": "%",
    "descriptor_version": "pd1", "comparison_scalar": None,
    "comparison_point": {"detail": "old", "sex": None, "direction": "low"},
    "denominator_semantics": "stock", "cells": [{"detail": "old", "sex": None, "unit": "%"}]}


_DEFAULT = object()


class DetailConnection:
    def __init__(self, *, marker=_DEFAULT, members=("c1", "c2"), group=None, territory=None):
        self.marker = (("pub-v1", "profile-v1", "ref-v1", 1, len(members), "profile-v1", "ref-v1")
            if marker is _DEFAULT else marker)
        self.members, self.sql, self.comparison_rows_returned = members, [], 0
        self.group = ([("housing_profile", "old", "", "median", 20.0, len(members), len(members), 0, "profile-v1", "ref-v1")]
            if group is None else group)
        self.territory = ([("housing_profile", "old", "", "c1", 10.0, "measured", 1, 1, len(members), "profile-v1", "ref-v1")]
            if territory is None else territory)

    def execute(self, sql, params=None):
        self.sql.append((sql, params))
        if "to_regclass('profile_comparison_publication')" in sql:
            return Cursor(("profile_comparison_publication",))
        if "FROM profile_comparison_publication p" in sql:
            return Cursor(self.marker)
        if "FROM profile_comparison_group" in sql:
            self.comparison_rows_returned += len(self.group)
            return Cursor(rows=self.group)
        if "FROM profile_comparison_territory" in sql:
            assert "territory_id=%s" in sql
            self.comparison_rows_returned += len(self.territory)
            return Cursor(rows=self.territory)
        if "FROM profile_observation_source" in sql:
            return Cursor()
        if "SELECT DISTINCT p.indicator_id,os.source_id" in sql:
            return Cursor()
        raise AssertionError(sql)


def test_fixed_detail_uses_published_statistics_and_only_reads_focal_row():
    conn = DetailConnection()
    result = main._published_profile_comparison_results(conn, [PROFILE],
        ("density_class", "A", "commune"), "commune", ("c1", "c2"), "c1")
    assert result["housing_profile"]["median"] == 20.0
    assert result["housing_profile"]["rank_ties"] == 1
    assert "missing_count" not in result["housing_profile"]
    sql = [statement for statement, _ in conn.sql]
    assert not any("count(" in statement.lower() for statement in sql)
    assert not any("o.value" in statement and "profile_observation o" in statement for statement in sql)
    territory_read = next((statement, params) for statement, params in conn.sql
        if "FROM profile_comparison_territory" in statement)
    assert "territory_id=%s" in territory_read[0]
    assert territory_read[1][-1] == "c1"


def test_fixed_detail_published_comparison_read_work_is_bounded_as_cohort_grows():
    returned_rows = []
    for size in (2, 50, 1_202):
        members = tuple(f"c{i}" for i in range(size))
        conn = DetailConnection(members=members)
        main._published_profile_comparison_results(conn, [PROFILE],
            ("bretagne", "region", "commune"), "commune", members, "c1")
        returned_rows.append(conn.comparison_rows_returned)
        assert not any("count(" in statement.lower() for statement, _ in conn.sql)
        territory_queries = [(statement, params) for statement, params in conn.sql
            if "FROM profile_comparison_territory" in statement]
        assert len(territory_queries) == 1
        assert territory_queries[0][1][-1] == "c1"
    assert returned_rows == [2, 2, 2]


@pytest.mark.parametrize("marker,group,territory", [
    (("pub", "stale", "ref-v1", 1, 2, "profile-v1", "ref-v1"), None, None),
    (("pub", "profile-v1", "wrong-ref", 1, 2, "profile-v1", "ref-v1"), None, None),
    (None, [], None),
    (("", "profile-v1", "ref-v1", 1, 2, "profile-v1", "ref-v1"), [], None),
])
def test_fixed_detail_fails_closed_on_stale_or_incomplete_publication(marker, group, territory):
    conn = DetailConnection(marker=marker, group=group, territory=territory)
    with pytest.raises(HTTPException) as error:
        main._published_profile_comparison_results(conn, [PROFILE],
            ("density_class", "A", "commune"), "commune", ("c1", "c2"), "c1")
    assert error.value.status_code == 503


@pytest.mark.parametrize("corrupt", ["stale_focal", "invalid_focal", "extra_focal", "wrong_group_key"])
def test_fixed_detail_rejects_corrupt_or_extra_focal_rows(corrupt):
    rows = [("housing_profile", "old", "", "c1", 10.0, "measured", 1, 1, 2, "profile-v1", "ref-v1")]
    if corrupt == "stale_focal":
        rows[0] = (*rows[0][:-2], "old-profile", rows[0][-1])
    elif corrupt == "invalid_focal":
        rows[0] = (*rows[0][:6], None, None, None, *rows[0][9:])
    elif corrupt == "extra_focal":
        rows.append(("housing_profile", "old", "", "stray", 11.0, "measured", 1, 1, 2, "profile-v1", "ref-v1"))
    else:
        rows[0] = ("housing_profile", "wrong-detail", "", "c1", 10.0, "measured", 1, 1, 2, "profile-v1", "ref-v1")
    conn = DetailConnection(territory=rows)
    with pytest.raises(HTTPException) as error:
        main._published_profile_comparison_results(conn, [PROFILE],
            ("density_class", "A", "commune"), "commune", ("c1", "c2"), "c1")
    assert error.value.status_code == 503


@pytest.mark.parametrize("stale", ["group_profile", "group_reference", "focal_profile", "focal_reference"])
def test_fixed_detail_fails_closed_on_stale_group_or_focal_versions(stale):
    group = [("housing_profile", "old", "", "median", 20.0, 2, 2, 0, "profile-v1", "ref-v1")]
    territory = [("housing_profile", "old", "", "c1", 10.0, "measured", 1, 1, 2, "profile-v1", "ref-v1")]
    if stale == "group_profile":
        group[0] = (*group[0][:-2], "old-profile", group[0][-1])
    elif stale == "group_reference":
        group[0] = (*group[0][:-1], "old-reference")
    elif stale == "focal_profile":
        territory[0] = (*territory[0][:-2], "old-profile", territory[0][-1])
    else:
        territory[0] = (*territory[0][:-1], "old-reference")
    conn = DetailConnection(group=group, territory=territory)
    with pytest.raises(HTTPException) as error:
        main._published_profile_comparison_results(conn, [PROFILE],
            ("density_class", "A", "commune"), "commune", ("c1", "c2"), "c1")
    assert error.value.status_code == 503


@pytest.mark.parametrize("corrupt", ["missing_group", "missing_focal", "group_member_count", "group_shape"])
def test_fixed_detail_fails_closed_on_missing_or_invalid_local_publication_rows(corrupt):
    group = [("housing_profile", "old", "", "median", 20.0, 2, 2, 0, "profile-v1", "ref-v1")]
    rows = [("housing_profile", "old", "", "c1", 10.0, "measured", 1, 1, 2, "profile-v1", "ref-v1")]
    if corrupt == "missing_group":
        group = []
    elif corrupt == "missing_focal":
        rows = []
    elif corrupt == "group_member_count":
        group[0] = (*group[0][:5], 3, 2, 1, *group[0][8:])
    else:
        group[0] = (*group[0][:4], None, *group[0][5:])
    conn = DetailConnection(group=group, territory=rows)
    with pytest.raises(HTTPException) as error:
        main._published_profile_comparison_results(conn, [PROFILE],
            ("density_class", "A", "commune"), "commune", ("c1", "c2"), "c1")
    assert error.value.status_code == 503


def test_profile_detail_preserves_unavailable_contract_below_two_eligible():
    conn = DetailConnection(group=[("housing_profile", "old", "", "median", 10.0, 2, 1, 1, "profile-v1", "ref-v1")],
        territory=[("housing_profile", "old", "", "c1", 10.0, "measured", 1, 1, 1, "profile-v1", "ref-v1")])
    result = main._published_profile_comparison_results(conn, [PROFILE],
        ("density_class", "A", "commune"), "commune", ("c1", "c2"), "c1")["housing_profile"]
    assert result["status"] == "unavailable"
    assert result["reason"] == "fewer_than_two_comparable_values"
    assert (result["median"], result["rank"], result["rank_size"], result["rank_ties"]) == (None, None, None, None)


def test_theme_uses_fixed_context_for_profile_only_filtered_default(monkeypatch):
    calls = []

    class Conn:
        def execute(self, sql, params=None):
            if "SELECT indicator_id,label,unit,direction,comparison_facet" in sql:
                return Cursor(rows=[])
            if "to_regclass('bpe_profile_evidence_descriptor')" in sql:
                return Cursor((None,))
            if "to_regclass('series_dataset_descriptor')" in sql:
                return Cursor((None,))
            if "table_name='territory_reference'" in sql:
                return Cursor(("ref",))
            return Cursor()

    monkeypatch.setattr(main, "focal_profiles", lambda *_a, **_kw: ([PROFILE], "profile-v1"))
    monkeypatch.setattr(main, "collection_descriptors", lambda *_a, **_kw: [])
    monkeypatch.setattr(main, "_comparison_cohort", lambda *_a: ("commune", ("c1", "c2"), {"kind": "density_class"}))
    monkeypatch.setattr(main, "_fixed_scalar_comparison_context", lambda *_a: ("density_class", "A", "commune"))
    monkeypatch.setattr(main, "_profile_comparison_results", lambda *a: calls.append(a[-1]) or [])
    monkeypatch.setattr(main, "_owned_series_comparison_results", lambda *_a, **_kw: ([], {}, None, None, None))
    monkeypatch.setattr(main, "_demographic_reading_marker", lambda _c: None)
    monkeypatch.setattr(main, "_milieux_reading_marker", lambda _c: None)
    main._theme_comparison_snapshot(Conn(), "commune", "c1", "habitat", None, indicator_id="housing_profile")
    assert calls == [("density_class", "A", "commune")]


def test_dpe_profile_adapts_scalar_publication_and_keeps_metadata(monkeypatch):
    dpe = {**PROFILE, "indicator": "dpe_profile", "comparison_scalar": "part_passoires",
        "comparison_point": None, "required_scalar_version": "sv1"}
    scalar_rows = [("part_passoires", "Part passoires", "%", "low", "part_passoires", ["commune"], "sdv1")]
    class Conn:
        def execute(self, sql, params=None):
            if "FROM scalar_descriptor WHERE indicator_id=ANY" in sql:
                return Cursor(rows=scalar_rows)
            if "SELECT DISTINCT p.indicator_id,os.source_id" in sql:
                return Cursor()
            raise AssertionError(sql)
    scalar_calls = []
    monkeypatch.setattr(main, "_published_profile_comparison_results", lambda *_a: pytest.fail("profile rows used for DPE"))
    monkeypatch.setattr(main, "_published_scalar_comparison_results", lambda *a, **kw: scalar_calls.append(kw) or {
        "part_passoires": {"status": "available", "reason": None, "selected_member_count": 2,
            "eligible_count": 2, "missing_count": 0, "focal_value": 10, "median": 12,
            "rank": 2, "rank_size": 2, "rank_ties": 1, "comparison_sources": []}})
    result = main._profile_comparison_results(Conn(), [dpe], ("c1", "c2"), "commune", "c1",
        ("density_class", "A", "commune"))[0]
    assert scalar_calls == [{"include_ties": True}]
    assert result["source_facet_label"] == "Part passoires"
    assert result["scalar_descriptor_version"] == "sdv1"
    assert result["rank_ties"] == 1
    assert "missing_count" not in result


def test_profile_selection_resolves_exact_preset_but_custom_cohort_stays_dynamic(monkeypatch):
    observed = []

    class Conn:
        def execute(self, sql, params=None):
            if "SELECT indicator_id,label,unit,direction,comparison_facet" in sql:
                return Cursor(rows=[])
            if "to_regclass('bpe_profile_evidence_descriptor')" in sql or "to_regclass('series_dataset_descriptor')" in sql:
                return Cursor((None,))
            if "table_name='territory_reference'" in sql:
                return Cursor(("ref",))
            return Cursor()

    monkeypatch.setattr(main, "focal_profiles", lambda *_a, **_kw: ([PROFILE], "pv"))
    monkeypatch.setattr(main, "collection_descriptors", lambda *_a, **_kw: [])
    monkeypatch.setattr(main, "_comparison_cohort", lambda _c, _tt, _tid, selection:
        ("commune", tuple(selection or ("c1", "c2")), {"kind": "explicit_selection" if selection else "density_class"}))
    monkeypatch.setattr(main, "_fixed_scalar_comparison_context", lambda _c, _tt, _tid, selection, *_rest:
        ("density_class", "A", "commune") if selection == ["c1", "c2"] else None)
    monkeypatch.setattr(main, "_profile_comparison_results", lambda *a: observed.append(a[-1]) or [])
    monkeypatch.setattr(main, "_owned_series_comparison_results", lambda *_a, **_kw: ([], {}, None, None, None))
    monkeypatch.setattr(main, "_demographic_reading_marker", lambda _c: None)
    monkeypatch.setattr(main, "_milieux_reading_marker", lambda _c: None)
    main._theme_comparison_snapshot(Conn(), "commune", "c1", "habitat", ["c1", "c2"])
    main._theme_comparison_snapshot(Conn(), "commune", "c1", "habitat", ["c1", "c3"])
    assert observed == [("density_class", "A", "commune"), None]


def test_custom_profile_comparison_reads_peer_facts_without_published_tables():
    class Conn:
        def __init__(self):
            self.sql = []
        def execute(self, sql, params=None):
            self.sql.append(sql)
            if "SELECT d.indicator_id,d.comparison_detail" in sql:
                return Cursor(rows=[("housing_profile", "old", None, "%", "stock", "pd1", False, "%")])
            if "SELECT d.indicator_id,o.territory_id,o.value,o.status" in sql:
                return Cursor(rows=[("housing_profile", "c1", 8.0, "measured"),
                    ("housing_profile", "c2", 2.0, "measured"), ("housing_profile", "c3", 4.0, "measured")])
            if "SELECT DISTINCT p.indicator_id,os.source_id" in sql:
                return Cursor()
            raise AssertionError(sql)
    conn = Conn()
    result = main._profile_comparison_results(conn, [PROFILE], ("c1", "c2", "c3"),
        "commune", "c1", fixed_context=None)[0]
    assert result["median"] == 4.0
    assert result["rank"] == 3
    assert any("profile_observation o" in sql and "o.value" in sql for sql in conn.sql)
    assert not any("profile_comparison_" in sql for sql in conn.sql)
