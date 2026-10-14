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
        self.marker = (("pub-v1", "profile-v1", "ref-v1", 1, 2, "profile-v1", "ref-v1")
            if marker is _DEFAULT else marker)
        self.members, self.sql = members, []
        self.group = group or [("housing_profile", "old", "", "median", 20.0, len(members), 2, 0, "profile-v1", "ref-v1")]
        self.territory = territory or [("housing_profile", "old", "", member, value, "measured", rank, 1, 2, "profile-v1", "ref-v1")
            for member, value, rank in zip(members, (10.0, 30.0), (1, 2))]

    def execute(self, sql, params=None):
        self.sql.append(sql)
        if "to_regclass('profile_comparison_publication')" in sql:
            return Cursor(("profile_comparison_publication",))
        if "FROM profile_comparison_publication p" in sql:
            return Cursor(self.marker)
        if "SELECT count(*) FROM profile_comparison_group" in sql:
            return Cursor((1, 2))
        if "FROM profile_comparison_group" in sql:
            return Cursor(rows=self.group)
        if "FROM profile_comparison_territory" in sql:
            return Cursor(rows=self.territory)
        if "FROM profile_observation_source" in sql:
            return Cursor()
        if "SELECT DISTINCT p.indicator_id,os.source_id" in sql:
            return Cursor()
        raise AssertionError(sql)


def test_fixed_detail_uses_published_values_and_complete_member_rows_only():
    conn = DetailConnection()
    result = main._published_profile_comparison_results(conn, [PROFILE],
        ("density_class", "A", "commune"), "commune", ("c1", "c2"), "c1")
    assert result["housing_profile"]["median"] == 20.0
    assert result["housing_profile"]["rank_ties"] == 1
    assert not any("o.value" in sql and "profile_observation o" in sql for sql in conn.sql)


@pytest.mark.parametrize("marker,group,territory", [
    (("pub", "stale", "ref-v1", 1, 2, "profile-v1", "ref-v1"), None, None),
    (("pub", "profile-v1", "wrong-ref", 1, 2, "profile-v1", "ref-v1"), None, None),
    (None, [], None),
    (("", "profile-v1", "ref-v1", 1, 2, "profile-v1", "ref-v1"), [], None),
    (("pub", "profile-v1", "ref-v1", 1, 2, "profile-v1", "ref-v1"), None,
     [("housing_profile", "old", "", "c1", 10.0, "measured", 1, 1, 2, "profile-v1", "ref-v1")]),
])
def test_fixed_detail_fails_closed_on_stale_or_incomplete_publication(marker, group, territory):
    conn = DetailConnection(marker=marker, group=group, territory=territory)
    with pytest.raises(HTTPException) as error:
        main._published_profile_comparison_results(conn, [PROFILE],
            ("density_class", "A", "commune"), "commune", ("c1", "c2"), "c1")
    assert error.value.status_code == 503


@pytest.mark.parametrize("corrupt", ["stale_peer", "invalid_peer", "extra_territory"])
def test_fixed_detail_rejects_corrupt_or_extra_nonfocal_rows(corrupt):
    rows = [
        ("housing_profile", "old", "", "c1", 10.0, "measured", 1, 1, 2, "profile-v1", "ref-v1"),
        ("housing_profile", "old", "", "c2", 11.0, "measured", 1, 1, 2, "profile-v1", "ref-v1"),
    ]
    if corrupt == "stale_peer":
        rows[1] = (*rows[1][:-2], "old-profile", rows[1][-1])
    elif corrupt == "invalid_peer":
        rows[1] = (*rows[1][:6], None, None, None, *rows[1][9:])
    else:
        rows.append(("housing_profile", "old", "", "stray", 11.0, "measured", 1, 1, 2, "profile-v1", "ref-v1"))
    conn = DetailConnection(territory=rows)
    with pytest.raises(HTTPException) as error:
        main._published_profile_comparison_results(conn, [PROFILE],
            ("density_class", "A", "commune"), "commune", ("c1", "c2"), "c1")
    assert error.value.status_code == 503


@pytest.mark.parametrize("corrupt", ["median", "rank", "ties"])
def test_fixed_detail_rejects_aggregates_inconsistent_with_measured_peers(corrupt):
    group = [("housing_profile", "old", "", "median", 20.0, 2, 2, 0, "profile-v1", "ref-v1")]
    rows = [
        ("housing_profile", "old", "", "c1", 10.0, "measured", 1, 1, 2, "profile-v1", "ref-v1"),
        ("housing_profile", "old", "", "c2", 30.0, "measured", 2, 1, 2, "profile-v1", "ref-v1"),
    ]
    if corrupt == "median":
        group[0] = (*group[0][:4], 25.0, *group[0][5:])
    elif corrupt == "rank":
        rows[1] = (*rows[1][:6], 1, *rows[1][7:])
    else:
        rows[0] = (*rows[0][:7], 2, *rows[0][8:])
    conn = DetailConnection(group=group, territory=rows)
    with pytest.raises(HTTPException) as error:
        main._published_profile_comparison_results(conn, [PROFILE],
            ("density_class", "A", "commune"), "commune", ("c1", "c2"), "c1")
    assert error.value.status_code == 503


def test_profile_detail_preserves_unavailable_contract_below_two_eligible():
    conn = DetailConnection(group=[("housing_profile", "old", "", "median", 10.0, 2, 1, 1, "profile-v1", "ref-v1")],
        territory=[("housing_profile", "old", "", "c1", 10.0, "measured", 1, 1, 1, "profile-v1", "ref-v1"),
                   ("housing_profile", "old", "", "c2", None, "suppressed", None, None, None, "profile-v1", "ref-v1")])
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
