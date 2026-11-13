"""Explicit equal-weight means for selected declared-profile comparisons (#996).

The owner-approved #979 chart compares one equal-weight arithmetic mean of the
actually measured peer communes per network partition. These unit tests pin the
request/response arithmetic, the measured-zero versus missing law and the
eligible-member identity evidence; the guarded HTTP proof exercises the same
contract end to end.
"""

import pytest
from fastapi import HTTPException

from api import snapshot_reads as reads


class Cursor:
    def __init__(self, row=None, rows=()):
        self.row, self.rows = row, list(rows)

    def fetchone(self):
        return self.row

    def fetchall(self):
        return self.rows


PROFILE = {
    "indicator": "reseaux_par_habitant",
    "label": "Longueur du reseau par habitant",
    "unit": "km / 1 000 hab.",
    "descriptor_version": "reseaux-v1",
    "comparison_scalar": None,
    "comparison_point": {"detail": "b_km_1000", "sex": None, "direction": "high"},
    "denominator_semantics": "population",
    "scalar_descriptor_version": None,
    "required_scalar_version": None,
    "source_facet_label": None,
    "detail_units_required": True,
    "cells": [
        {"detail": "b_km_1000", "sex": None, "unit": "km / 1 000 hab."},
        {"detail": "total_longueur", "sex": None, "unit": "km"},
        {"detail": "protege_longueur", "sex": None, "unit": "km"},
        {"detail": "partage_longueur", "sex": None, "unit": "km"},
    ],
}


class DetailConnection:
    """Answer the dynamic selected-profile reads for one declared detail."""

    def __init__(self, values, *, detail="b_km_1000", unit="km / 1 000 hab."):
        self.values = values
        self.detail = detail
        self.unit = unit
        self.sql = []

    def execute(self, sql, params=None):
        self.sql.append((sql, params))
        if "SELECT d.indicator_id,%s,%s,d.unit" in sql:
            detail = params[0] if params else self.detail
            return Cursor(rows=[("reseaux_par_habitant", detail, None, self.unit,
                                 "population", "reseaux-v1", True, self.unit)])
        if "SELECT d.indicator_id,d.comparison_detail,d.comparison_sex,d.unit" in sql:
            return Cursor(rows=[("reseaux_par_habitant", self.detail, None, self.unit,
                                 "population", "reseaux-v1", True, self.unit)])
        if "SELECT d.indicator_id,o.territory_id,o.value,o.status" in sql:
            detail = params[0] if params else self.detail
            return Cursor(rows=[("reseaux_par_habitant", territory_id, value, status)
                                for territory_id, (value, status)
                                in self.values.get(detail, self.values).items()])
        if "SELECT DISTINCT p.indicator_id,os.source_id" in sql:
            return Cursor(rows=[("reseaux_par_habitant", "osm_reseaux", "2026-08",
                                 "OpenStreetMap reseaux", "2026-08", None, None)])
        raise AssertionError(sql)


def selected(connection, members, *, statistic=None, detail="b_km_1000"):
    return reads._profile_comparison_results(
        connection, [PROFILE], members, "commune", "c1", fixed_context=None,
        comparison_statistic=statistic,
        profile_coordinates={"detail": detail})[0]


def test_explicit_mean_is_equal_weight_arithmetic_over_measured_members():
    values = {"c1": (10.0, "measured"), "c2": (0.0, "measured"),
              "c3": (None, "not_available"), "c4": (20.0, "measured"),
              "c6": (41.0, "measured")}
    result = selected(DetailConnection(values), ("c1", "c2", "c3", "c4", "c6"),
                      statistic="mean")
    # Every eligible commune counts once; zero is a real measurement.
    assert result["statistic"] == "mean"
    assert result["mean"] == pytest.approx(17.75)
    assert "median" not in result
    assert result["eligible_members"] == ["c1", "c2", "c4", "c6"]
    assert (result["selected_member_count"], result["eligible_count"],
            result["missing_count"]) == (5, 4, 1)
    assert result["status"] == "available" and result["reason"] is None
    # c1=10 is beaten by 20 and 41 under the declared high-is-better direction.
    assert (result["rank"], result["rank_size"], result["rank_ties"]) == (3, 4, 1)
    # The default statistic is still the published median contract.
    median = selected(DetailConnection(values), ("c1", "c2", "c3", "c4", "c6"))
    assert median["statistic"] == "median"
    assert median["median"] == pytest.approx(15.0)
    assert "mean" not in median
    assert "eligible_members" not in median


def test_equal_eligible_counts_with_different_identities_are_not_one_population():
    total = selected(DetailConnection({"c1": (3.0, "measured"), "c2": (4.0, "measured"),
                                       "c3": (5.0, "measured")}),
                     ("c1", "c2", "c3", "c5"), statistic="mean", detail="total_longueur")
    protected = selected(DetailConnection({"c1": (1.0, "measured"), "c2": (2.0, "measured"),
                                           "c5": (3.0, "measured")}),
                         ("c1", "c2", "c3", "c5"), statistic="mean",
                         detail="protege_longueur")
    assert (total["eligible_count"], protected["eligible_count"]) == (3, 3)
    # Equal counts are not a shared population: the identity evidence differs.
    assert total["eligible_members"] == ["c1", "c2", "c3"]
    assert protected["eligible_members"] == ["c1", "c2", "c5"]
    assert set(total["eligible_members"]) != set(protected["eligible_members"])


def test_identical_eligible_identities_make_mean_partitions_additive():
    members = ("c1", "c2", "c3")
    partitions = {
        "protege_longueur": {"c1": 1.0, "c2": 2.0, "c3": 4.0},
        "partage_longueur": {"c1": 3.0, "c2": 1.0, "c3": 2.0},
        "total_longueur": {"c1": 4.0, "c2": 3.0, "c3": 6.0},
    }
    results = {detail: selected(
        DetailConnection({territory: (value, "measured")
                          for territory, value in values.items()}),
        members, statistic="mean", detail=detail).copy()
        for detail, values in partitions.items()}
    for detail, result in results.items():
        assert result["eligible_members"] == ["c1", "c2", "c3"], detail
    assert results["total_longueur"]["mean"] == pytest.approx(
        results["protege_longueur"]["mean"] + results["partage_longueur"]["mean"])


def test_mean_keeps_measured_zero_and_never_represents_a_missing_member():
    result = selected(DetailConnection({"c1": (0.0, "measured"),
                                        "c2": (None, "not_available"),
                                        "c3": (0.0, "suppressed")}),
                      ("c1", "c2", "c3"), statistic="mean")
    assert result["mean"] == 0.0
    assert result["eligible_members"] == ["c1"]
    assert (result["eligible_count"], result["missing_count"]) == (1, 2)
    assert result["status"] == "available" and result["reason"] is None
    assert (result["rank"], result["rank_size"], result["rank_ties"]) == (None, None, None)


def test_mean_of_one_eligible_member_is_available_without_rank():
    result = selected(DetailConnection({"c1": (8.0, "measured")}), ("c1", "c2"),
                      statistic="mean")
    assert result["mean"] == pytest.approx(8.0)
    assert result["eligible_members"] == ["c1"]
    assert result["status"] == "available"
    assert (result["rank"], result["rank_size"], result["rank_ties"]) == (None, None, None)


def test_mean_with_no_comparable_member_is_unavailable_and_never_zero():
    result = selected(DetailConnection({"c1": (None, "not_available"),
                                        "c2": (None, "unsupported")}),
                      ("c1", "c2"), statistic="mean")
    assert result["mean"] is None
    assert result["eligible_members"] == []
    assert result["status"] == "unavailable"
    assert result["reason"] == "no_selected_comparable_values"
    assert (result["eligible_count"], result["missing_count"]) == (0, 2)


def test_mean_of_an_empty_selection_has_no_fallback_population():
    result = selected(DetailConnection({"c1": (10.0, "measured")}), (), statistic="mean")
    assert result["mean"] is None
    assert result["eligible_members"] == []
    assert result["selected_member_count"] == 0
    assert result["status"] == "unavailable"
    assert result["focal_in_selection"] is False


def test_mean_for_a_focal_outside_the_population_keeps_no_rank():
    result = selected(DetailConnection({"c2": (1.0, "measured"), "c3": (2.0, "measured")}),
                      ("c2", "c3"), statistic="mean")
    assert result["mean"] == pytest.approx(1.5)
    assert result["focal_in_selection"] is False
    assert (result["rank"], result["rank_size"], result["rank_ties"]) == (None, None, None)


def test_explicit_statistic_swaps_the_single_value_field_without_overloading_fields():
    baseline = reads._COMPARISON_RESULT_FIELDS - {"mean", "mean_curve", "focal_value"}
    assert reads._comparison_statistic_fields(None, baseline) == set(baseline)
    assert reads._comparison_statistic_fields("median", baseline) == set(baseline)
    mean_fields = reads._comparison_statistic_fields("mean", baseline)
    assert "mean" in mean_fields and "median" not in mean_fields
    with pytest.raises(HTTPException) as error:
        reads._validate_comparison_fields(("mean",), set(baseline))
    assert error.value.status_code == 422


def test_explicit_statistic_declaration_distinguishes_profile_facets():
    scalar_backed = [{**PROFILE, "comparison_scalar": "part_passoires"}]
    reads._validate_profile_statistic([PROFILE], "mean")
    reads._validate_profile_statistic([PROFILE], "median")
    # An explicit median is the unchanged default even through a linked scalar.
    reads._validate_profile_statistic(scalar_backed, "median")
    with pytest.raises(HTTPException) as error:
        reads._validate_profile_statistic(scalar_backed, "mean")
    assert error.value.status_code == 422
    with pytest.raises(HTTPException) as error:
        reads._validate_profile_statistic([], "median")
    assert error.value.status_code == 422


@pytest.mark.parametrize("profiles", [
    [],
    [{**PROFILE, "indicator": "distribution_dpe", "comparison_scalar": "part_passoires",
      "comparison_point": None, "required_scalar_version": "scalar-v1"}],
])
def test_mean_is_rejected_for_scalar_backed_and_scalar_profiles(monkeypatch, profiles):
    class Conn:
        def execute(self, sql, params=None):
            if "SELECT indicator_id,label,unit,direction,comparison_facet" in sql:
                return Cursor(rows=[])
            raise AssertionError(sql)

    monkeypatch.setattr(reads, "focal_profiles", lambda *_a, **_kw: (profiles, "pv"))
    with pytest.raises(HTTPException) as error:
        reads._theme_comparison_snapshot(
            Conn(), "commune", "c1", "mobilite", ("c1", "c2"),
            indicator_id="distribution_dpe", comparison_statistic="mean")
    assert error.value.status_code == 422


def test_explicit_mean_never_reads_the_published_fixed_projection(monkeypatch):
    captured = []

    class Conn:
        def execute(self, sql, params=None):
            if "SELECT indicator_id,label,unit,direction,comparison_facet" in sql:
                return Cursor(rows=[])
            if "to_regclass('series_dataset_descriptor')" in sql:
                return Cursor(row=(None,))
            if "table_name='territory_reference'" in sql:
                return Cursor(row=("ref-v1",))
            raise AssertionError(sql)

    def profile_results(conn, profiles, members, cohort_type, territory_id, fixed_context=None,
                        **kwargs):
        captured.append((fixed_context, kwargs.get("comparison_statistic")))
        return []

    monkeypatch.setattr(reads, "focal_profiles", lambda *_a, **_kw: ([PROFILE], "pv"))
    monkeypatch.setattr(reads, "collection_descriptors", lambda *_a, **_kw: [])
    monkeypatch.setattr(reads, "_comparison_cohort", lambda *_a, **_kw: (
        "commune", ("c1", "c2"), {"kind": "density_class"}))
    monkeypatch.setattr(reads, "_fixed_scalar_comparison_context", lambda *_a, **_kw: (
        "density_class", "D1", "commune"))
    monkeypatch.setattr(reads, "_profile_comparison_results", profile_results)
    monkeypatch.setattr(reads, "_owned_series_comparison_results",
                        lambda *_a, **_kw: ([], {}, None, None, None))
    monkeypatch.setattr(reads, "_demographic_reading_marker", lambda _c: None)
    monkeypatch.setattr(reads, "_milieux_reading_marker", lambda _c: None)

    reads._theme_comparison_snapshot(Conn(), "commune", "c1", "mobilite", None,
                                     indicator_id="reseaux_par_habitant")
    reads._theme_comparison_snapshot(Conn(), "commune", "c1", "mobilite", None,
                                     indicator_id="reseaux_par_habitant",
                                     comparison_statistic="mean")
    reads._theme_comparison_snapshot(Conn(), "commune", "c1", "mobilite", None,
                                     indicator_id="reseaux_par_habitant",
                                     comparison_statistic="median")
    # The default median still reuses the validated published fixed projection;
    # an explicit mean is computed from the members' own measured cells, and an
    # explicit median is the same unchanged default.
    assert captured == [(("density_class", "D1", "commune"), None),
                        (None, "mean"),
                        (("density_class", "D1", "commune"), "median")]
