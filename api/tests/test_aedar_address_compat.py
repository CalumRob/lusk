"""Declared AEDAR addresses, the deprecated `measure` alias, and read regressions (#1076).

The declared coordinates are the only documented address. The legacy `measure`
form stays accepted as a deprecated alias with its pre-#1076 semantics until
#1098 migrates the fiche and removes it.
"""

from contextlib import contextmanager

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from api.aedar_models import (AEDARAddressError, AEDAR_AGGREGATE_READINGS, AEDAR_MEASURE_KEYS,
                              resolve_aedar_address)
from api.resource_catalogue import default_resource_catalogue, validate_resource_item
from api.resource_requests import ResourceReadItem
from api.semantic_resource_reader import SemanticResourceReader

AGGREGATE = "aedar_territorial_aggregate"
SUMMARY = "aedar_territory_summary"
TARGET = {"kind": "territory", "type": "commune", "id": "22001"}


def _reader():
    return SemanticResourceReader(
        indicator_facts_snapshot=lambda *a, **k: {}, indicator_comparison_preflight=lambda *a, **k: {},
        indicator_comparison_snapshot=lambda *a, **k: {}, owned_series_route=lambda *a, **k: None,
        owned_named_reference_snapshot=lambda *a, **k: {}, comparison_field_selection=lambda f: f,
        max_owned_series_provenance_per_point=8)


def _item(resource_id, coordinates, intent):
    return ResourceReadItem.model_validate({
        "resource": resource_id, "target": TARGET, "coordinates": coordinates, "intent": intent})


# Bug 1: comparison with omitted coordinates must be a named 422 at admission,
# never a TypeError/500 in preflight or read.
@pytest.mark.parametrize("resource_id,intent", [
    (AGGREGATE, {"kind": "fixed_comparison", "context": "epci"}),
    (AGGREGATE, {"kind": "selected_comparison", "members": [
        {"type": "commune", "id": "22002"}]}),
    (SUMMARY, {"kind": "fixed_comparison", "context": "epci"}),
    (SUMMARY, {"kind": "selected_comparison", "members": [
        {"type": "commune", "id": "22002"}]}),
])
def test_comparison_without_coordinates_is_a_named_422(resource_id, intent):
    catalogue = default_resource_catalogue.__wrapped__()
    item = _item(resource_id, None, intent)
    with pytest.raises(ValueError, match="AEDAR comparison requires its Cellule coordinates"):
        validate_resource_item(item, catalogue)
    # And the reader never gets a chance to index a missing measure.
    with pytest.raises(HTTPException) as error:
        _reader().preflight(None, item, catalogue)
    assert error.value.status_code == 422


# Bug 2: a per-cell Cellule needs its equipment coordinate.
def test_per_cell_cellule_without_typequ_is_rejected_by_name():
    with pytest.raises(AEDARAddressError, match="typequ"):
        resolve_aedar_address("aedar_source_grain", {
            "horizon": ["5"], "mode": ["walk"], "statistic": ["mean"]})
    from api.resource_catalogue import _validate_aedar_address
    resource = default_resource_catalogue.__wrapped__().resources_by_id[AGGREGATE]
    with pytest.raises(ValueError, match="typequ"):
        _validate_aedar_address(resource, {
            "horizon": ["5"], "mode": ["walk"], "statistic": ["mean"]}, "facts")


# Bug 3: context is an intent context, not a declared coordinate.
def test_context_is_not_advertised_as_a_coordinate():
    public = next(resource for resource in default_resource_catalogue.__wrapped__().discovery_payload()["resources"]
                  if resource["resource_id"] == AGGREGATE)
    assert "context" not in public["axes"]
    assert "context" not in {axis for axis, _values in public["axis_values"]}


# The deprecated alias keeps its pre-#1076 semantics on both resources.
def test_alias_summary_on_aggregate_still_works():
    from api.aedar_models import aedar_measure_family
    assert aedar_measure_family(["meanDiversity"]) == "aedar_summary"
    catalogue = default_resource_catalogue.__wrapped__()
    item = _item(AGGREGATE, {"measure": ["meanDiversity"]},
                 {"kind": "fixed_comparison", "context": "epci"})
    assert validate_resource_item(item, catalogue).resource_id == AGGREGATE
    # Declared summary address cannot be satisfied by the aggregate resource.
    wrong = _item(AGGREGATE, {"horizon": ["15"], "mode": ["car"], "kind": ["diversity"]},
                  {"kind": "fixed_comparison", "context": "epci"})
    with pytest.raises(ValueError, match="not declared for the AEDAR per-cell family"):
        validate_resource_item(wrong, catalogue)


def test_alias_and_declared_address_resolve_to_the_same_internal_selectors():
    from api.semantic_resource_reader import SemanticResourceReader
    catalogue = default_resource_catalogue.__wrapped__()
    reader = _reader()
    resolver = reader._aedar_resolve
    aggregate = catalogue.resources_by_id[AGGREGATE]
    summary = catalogue.resources_by_id[SUMMARY]

    declared_cell = _item(AGGREGATE, {"typequ": ["A104"], "horizon": ["5"],
                                      "mode": ["walk"], "statistic": ["mean"]},
                          {"kind": "fixed_comparison", "context": "epci"})
    alias_cell = _item(AGGREGATE, {"typequ": ["A104"], "measure": ["count_5_walk_mean"]},
                       {"kind": "fixed_comparison", "context": "epci"})
    assert (resolver(declared_cell, aggregate).coordinates["measure"]
            == resolver(alias_cell, aggregate).coordinates["measure"] == ["count_5_walk_mean"])

    declared_summary = _item(SUMMARY, {"horizon": ["15"], "mode": ["car"], "kind": ["diversity"]},
                             {"kind": "fixed_comparison", "context": "epci"})
    alias_summary = _item(AGGREGATE, {"measure": ["meanDiversity"]},
                          {"kind": "fixed_comparison", "context": "epci"})
    assert (resolver(declared_summary, summary).coordinates["measure"]
            == resolver(alias_summary, aggregate).coordinates["measure"] == ["meanDiversity"])


# Quality 6: a fixed summary comparison charges the peer group like the aggregate.
def test_fixed_summary_preflight_charges_the_peer_group():
    monkeypatch = pytest.MonkeyPatch()
    calls = []

    class Cached:
        pass

    def peer_ids(_conn, *_args):
        calls.append("peers")
        return ["22002", "22003"]

    monkeypatch.setattr("api.aedar_reads._aedar_fixed_peer_ids_cached", peer_ids)
    monkeypatch.setattr("api.aedar_reads._aedar_comparison_snapshot",
                        lambda *a, **k: {"comparison": {}})
    try:
        item = _item(SUMMARY, {"horizon": ["15"], "mode": ["car"], "kind": ["diversity"]},
                     {"kind": "fixed_comparison", "context": "epci"})
        catalogue = default_resource_catalogue.__wrapped__()
        work = _reader().preflight(None, item, catalogue)
        assert work == 1 + len(peer_ids(None))
        assert calls == ["peers", "peers"]
    finally:
        monkeypatch.undo()


# Quality 9: diversity rank grant and a summary comparison read over HTTP.
def test_declared_summary_receives_diversity_ranks():
    catalogue = default_resource_catalogue.__wrapped__()
    item = _item(SUMMARY, {"horizon": ["15"], "mode": ["car"], "kind": ["diversity"]},
                 {"kind": "fixed_comparison", "context": "epci"})
    validate_resource_item(item, catalogue)
    resource = catalogue.resources_by_id[SUMMARY]
    facet = resource.measure_facets["meanDiversity"]
    assert facet == {"facet": "diversity", "direction": "high", "ranked": True}


def test_summary_comparison_read_over_http(monkeypatch):
    from api import main

    calls = []

    class Connection:
        def execute(self, sql, params=None):
            return type("Cursor", (), {"fetchone": lambda self: None, "fetchall": lambda self: []})()

        @contextmanager
        def transaction(self):
            yield self

    class Pool:
        @contextmanager
        def connection(self):
            yield Connection()

    def snapshot(*args, **kwargs):
        calls.append(args)
        return {"comparison": {"group_value": 1.0, "value": 1.0, "status": "available",
                               "rank": 1, "rank_size": 3, "rank_ties": 1}}

    monkeypatch.setattr(main, "pool", lambda: Pool())
    monkeypatch.setattr("api.aedar_reads._aedar_comparison_snapshot", snapshot)
    monkeypatch.setattr("api.aedar_reads._aedar_fixed_peer_ids_cached",
                        lambda *_a, **_k: ["22002"])
    response = TestClient(main.app).post("/api/resources/read", json={
        "resource": SUMMARY, "target": TARGET,
        "coordinates": {"horizon": ["15"], "mode": ["car"], "kind": ["diversity"]},
        "fields": ["group_value", "value", "rank", "rank_size", "rank_ties"],
        "intent": {"kind": "fixed_comparison", "context": "epci"}})
    assert response.status_code == 200, response.text
    comparison = response.json()["comparison"]
    assert comparison["group_value"] == 1.0
    assert (comparison["rank"], comparison["rank_size"], comparison["rank_ties"]) == (1, 3, 1)
    # The declared summary address reached the shared comparison snapshot with
    # its legacy car × 15 key, no equipment coordinate and the rank projection.
    assert calls and calls[0][4] is None and calls[0][5] == "meanDiversity"
    assert {"rank", "rank_size", "rank_ties"} <= set(calls[0][6])


def test_alias_facts_on_aggregate_and_summary_resolve_identically():
    catalogue = default_resource_catalogue.__wrapped__()
    for resource_id, coordinates in (
        (AGGREGATE, {"typequ": ["A104"], "measure": ["count_5_walk_mean"]}),
        (SUMMARY, {"measure": ["meanVolume"]}),
    ):
        item = _item(resource_id, coordinates, {"kind": "facts"})
        assert validate_resource_item(item, catalogue).resource_id == resource_id
    # A declared, equipment-free per-cell facts read is still rejected.
    item = _item(AGGREGATE, {"horizon": ["5"], "mode": ["walk"], "statistic": ["mean"]},
                 {"kind": "facts"})
    with pytest.raises(ValueError, match="typequ"):
        validate_resource_item(item, catalogue)
