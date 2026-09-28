"""Custom peer ramps are averages of curves, never quantiles of pooled buildings."""

import pytest

from api.building_comparison import (
    ComparisonInputError, pooled_peer_distribution, resolve_commune_members,
    weighted_peer_ramp,
)


def curve(territory, count, offset=0):
    return [
        dict(territoire=territory, type="commune", availability="complete",
             mode=mode, quantile=position / 10,
             accessible_types=offset + position + {"c": 0, "b": 10, "t": 20}[mode],
             total_buildings=count, source_id="snapshot", version="v1")
        for mode in ("c", "b", "t") for position in range(11)
    ]


def absent(territory):
    return [dict(territoire=territory, type="commune", availability="absent",
                 mode=mode, quantile=None, accessible_types=None,
                 total_buildings=0, source_id="snapshot", version="v1")
            for mode in ("c", "b", "t")]


def test_custom_group_averages_each_of_eleven_positions_per_mode_with_ramp_counts():
    rows = curve("A", 2) + curve("B", 6, offset=10) + absent("C")
    result = weighted_peer_ramp(rows, ["A", "B", "C"], max_members=3)

    assert result["statistic"] == "mean"
    assert result["member_count"] == 2
    assert result["total_buildings"] == 8
    for mode in ("c", "b", "t"):
        points = [point for point in result["points"] if point["mode"] == mode]
        assert len(points) == 11
        offset = {"c": 0, "b": 10, "t": 20}[mode]
        assert [point["accessible_types"] for point in points] == [7.5 + offset + i for i in range(11)]
    # The absent focal territory can still have a valid comparison.
    assert len(result["points"]) == 33


def test_no_peer_comparison_when_fewer_than_two_members_have_a_ramp():
    assert weighted_peer_ramp(curve("A", 2) + absent("C"), ["A", "C"], max_members=2) is None


def test_grid_uses_the_same_mean_metric_type_for_pooled_building_shares():
    rows = [
        dict(territoire=code, type="commune", availability="complete", mode="t",
             total_buildings=count, breadth_bucket=breadth, depth_bucket="0",
             building_count=value, source_id="snapshot", version="v1")
        for code, count, values in (("A", 2, (1, 1)), ("B", 6, (0, 6)))
        for breadth, value in zip(("0", "1-9"), values)
    ]
    result = pooled_peer_distribution(rows, ["A", "B"], max_members=2)
    assert result == {
        "statistic": "mean", "member_count": 2, "total_buildings": 8,
        "cells": [
            {"breadth_bucket": "0", "depth_bucket": "0", "building_count": 1, "share": 1 / 8},
            {"breadth_bucket": "1-9", "depth_bucket": "0", "building_count": 7, "share": 7 / 8},
        ],
    }


def test_mixed_level_selection_expands_to_distinct_communes_without_double_counting():
    reference = [
        dict(territoire="A", type="commune", departement="22", epci="E"),
        dict(territoire="B", type="commune", departement="22", epci="E"),
        dict(territoire="C", type="commune", departement="29", epci="F"),
        dict(territoire="E", type="epci"), dict(territoire="F", type="epci"),
        dict(territoire="22", type="departement"), dict(territoire="29", type="departement"),
        dict(territoire="53", type="region"),
    ]
    assert resolve_commune_members(reference, [("epci", "E"), ("commune", "A")],
                                   max_members=3) == ("A", "B")
    assert resolve_commune_members(reference, [("epci", "E"), ("departement", "22")],
                                   max_members=3) == ("A", "B")
    # A focal commune is neither included nor excluded by the server: selection
    # of another department omits it; an explicitly selected parent includes it.
    assert resolve_commune_members(reference, [("departement", "29")],
                                   max_members=3) == ("C",)
    assert resolve_commune_members(reference, [("region", "53")], max_members=3) == ("A", "B", "C")
    with pytest.raises(ComparisonInputError):
        resolve_commune_members(reference, [("region", "53")], max_members=2)
    with pytest.raises(ComparisonInputError):
        resolve_commune_members(reference, [("epci", "unknown")], max_members=3)


@pytest.mark.parametrize("rows,members,limit", [
    (curve("A", 2) + curve("B", 6), ["A", "A"], 2),
    (curve("A", 2) + curve("B", 6), ["A", "B"], 1),
    (curve("A", 2), ["A", "missing"], 2),
    (curve("A", 2)[:-1] + curve("B", 6), ["A", "B"], 2),
    (curve("A", 0) + curve("B", 6), ["A", "B"], 2),
    (curve("A", 2) + curve("B", 6, offset=10) + curve("A", 2), ["A", "B"], 2),
    (curve("A", 2) + [{**row, "version": "v2"} for row in curve("B", 6)], ["A", "B"], 2),
])
def test_invalid_selection_or_incomplete_publication_fails_closed(rows, members, limit):
    with pytest.raises(ComparisonInputError):
        weighted_peer_ramp(rows, members, max_members=limit)
