"""Explicit semantic comparison targets resolve to bounded unique communes."""

import pytest

from api.comparison_members import ComparisonInputError, resolve_commune_members


@pytest.fixture
def reference():
    return [
        {"territoire": "A", "type": "commune", "departement": "22", "epci": "E"},
        {"territoire": "B", "type": "commune", "departement": "22", "epci": "E"},
        {"territoire": "C", "type": "commune", "departement": "29", "epci": "F"},
        {"territoire": "E", "type": "epci"}, {"territoire": "F", "type": "epci"},
        {"territoire": "22", "type": "departement"}, {"territoire": "29", "type": "departement"},
        {"territoire": "53", "type": "region"},
    ]


def test_mixed_parent_and_commune_selections_deduplicate_without_implicit_focal(reference):
    assert resolve_commune_members(reference, [("epci", "E"), ("commune", "A")],
                                   max_members=3) == ("A", "B")
    assert resolve_commune_members(reference, [("epci", "E"), ("departement", "22")],
                                   max_members=3) == ("A", "B")
    assert resolve_commune_members(reference, [("departement", "29")],
                                   max_members=3) == ("C",)
    assert resolve_commune_members(reference, [("region", "53")],
                                   max_members=3) == ("A", "B", "C")


def test_invalid_and_overbroad_targets_fail_closed(reference):
    for selection, limit in (
        ([("epci", "E"), ("epci", "E")], 3),
        ([("epci", "unknown")], 3),
        ([("region", "53")], 2),
    ):
        with pytest.raises(ComparisonInputError):
            resolve_commune_members(reference, selection, max_members=limit)
