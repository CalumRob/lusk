"""Declared AEDAR addresses, the deprecated `measure` alias, and read regressions (#1076).

The declared coordinates are the only documented address. The legacy `measure`
form stays accepted as a deprecated alias with its frozen pre-#1076 semantics
until #1098 migrates the fiche and removes it. Tests assert what a caller
observes through admission and the HTTP read path, with stubbed snapshots.
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


class _Cursor:
    def __init__(self, rows=()):
        self.rows = list(rows)

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return self.rows


class _Connection:
    def execute(self, sql, params=None):
        if "SELECT DISTINCT typequ" in sql:
            return _Cursor([(code,) for code in (params[0] if params else ())])
        if "SELECT count(*)" in sql:
            return _Cursor([(0,)])
        return _Cursor()

    @contextmanager
    def transaction(self):
        yield self


class _Pool:
    @contextmanager
    def connection(self):
        yield _Connection()


def _wire_snapshots(monkeypatch, captured):
    """Record what the shared AEDAR snapshots receive, bypassing only SQL."""
    from api import main

    def capture(name, result):
        def stub(*args, **kwargs):
            captured[name] = (args, kwargs, result)
            return result
        return stub

    monkeypatch.setattr(main, "pool", lambda: _Pool())
    monkeypatch.setattr("api.aedar_reads._aedar_comparison_snapshot", capture("comparison", {
        "comparison": {"group_value": 1.0, "value": 1.0, "status": "available",
                       "rank": 1, "rank_size": 3, "rank_ties": 1}}))
    monkeypatch.setattr("api.aedar_reads._aedar_selected_comparison_snapshot",
                        capture("selected", {"comparison": {"group_value": 1.0}}))
    monkeypatch.setattr("api.aedar_reads._aedar_territorial_aggregate_snapshot",
                        capture("aggregate_facts", {"facts": []}))
    monkeypatch.setattr("api.aedar_reads._aedar_territory_summary_resource_snapshot",
                        capture("summary_facts", {"readings": []}))
    monkeypatch.setattr("api.aedar_reads._aedar_fixed_peer_ids_cached", capture("peers", ["22002"]))


def _http_read(monkeypatch, captured, payload):
    from api import main

    _wire_snapshots(monkeypatch, captured)
    return TestClient(main.app).post("/api/resources/read", json=payload)


def _fixed(context="epci"):
    return {"kind": "fixed_comparison", "context": context}


def _selected():
    return {"kind": "selected_comparison", "members": [{"type": "commune", "id": "22002"}]}


# Round 3 bug: a comparison naming coordinates but no measure must be a named
# 422 at admission, never a NoneType 500 in preflight/read. Same bug class as
# the omitted-coordinates case, through the `{typequ}`-only door.
@pytest.mark.parametrize("resource_id,coordinates", [
    (AGGREGATE, {"typequ": ["A104"]}),
    (SUMMARY, {"horizon": ["15"], "mode": ["car"]}),
])
def test_selected_comparison_without_a_measure_is_a_named_422(resource_id, coordinates):
    catalogue = default_resource_catalogue.__wrapped__()
    item = _item(resource_id, coordinates, _selected())
    with pytest.raises(ValueError, match="requires a measure|missing.*coordinate"):
        validate_resource_item(item, catalogue)
    with pytest.raises(HTTPException) as error:
        _reader().preflight(None, item, catalogue)
    assert error.value.status_code == 422
    # The measure-free `{typequ}` facts read stays legal on the aggregate.
    validate_resource_item(_item(AGGREGATE, {"typequ": ["A104"]}, {"kind": "facts"}), catalogue)


def test_selected_comparison_without_measure_is_422_over_http(monkeypatch):
    from api import main

    class NoConnectionPool:
        @contextmanager
        def connection(self):
            raise AssertionError("admission must reject before any connection")

    monkeypatch.setattr(main, "pool", lambda: NoConnectionPool())
    response = TestClient(main.app).post("/api/resources/read", json={
        "resource": AGGREGATE, "target": TARGET,
        "coordinates": {"typequ": ["A104"]}, "intent": _selected()})
    assert response.status_code == 422, response.text
    assert "measure" in response.json()["detail"]


# Round 3 bug: comparison with omitted coordinates must be a named 422 at
# admission, never a TypeError/500 in preflight or read.
@pytest.mark.parametrize("resource_id,intent", [
    (AGGREGATE, _fixed()), (AGGREGATE, _selected()),
    (SUMMARY, _fixed()), (SUMMARY, _selected()),
])
def test_comparison_without_coordinates_is_a_named_422(resource_id, intent):
    catalogue = default_resource_catalogue.__wrapped__()
    item = _item(resource_id, None, intent)
    with pytest.raises(ValueError, match="AEDAR comparison requires its Cellule coordinates"):
        validate_resource_item(item, catalogue)
    with pytest.raises(HTTPException) as error:
        _reader().preflight(None, item, catalogue)
    assert error.value.status_code == 422


# Round 3 bug: the deprecated alias must be frozen to the legacy axes/domains.
def test_alias_rejects_a_declared_axis_alongside_measure():
    catalogue = default_resource_catalogue.__wrapped__()
    item = _item(AGGREGATE, {"measure": ["meanDiversity"], "horizon": ["5"]}, _fixed())
    with pytest.raises(ValueError, match="accepts no other coordinate"):
        validate_resource_item(item, catalogue)


def test_alias_rejects_a_per_cell_measure_on_the_summary_resource():
    catalogue = default_resource_catalogue.__wrapped__()
    item = _item(SUMMARY, {"measure": ["count_5_walk_mean"]}, {"kind": "facts"})
    with pytest.raises(ValueError, match="not declared"):
        validate_resource_item(item, catalogue)


def test_alias_rejects_an_unknown_measure_by_name():
    catalogue = default_resource_catalogue.__wrapped__()
    item = _item(AGGREGATE, {"measure": ["not_a_measure"]}, {"kind": "facts"})
    with pytest.raises(ValueError, match="not declared"):
        validate_resource_item(item, catalogue)


def test_per_cell_cellule_without_typequ_is_rejected_by_name():
    with pytest.raises(AEDARAddressError, match="typequ"):
        resolve_aedar_address("aedar_source_grain", {
            "horizon": ["5"], "mode": ["walk"], "statistic": ["mean"]})
    from api.resource_catalogue import _validate_aedar_address
    resource = default_resource_catalogue.__wrapped__().resources_by_id[AGGREGATE]
    with pytest.raises(ValueError, match="typequ"):
        _validate_aedar_address(resource, {
            "horizon": ["5"], "mode": ["walk"], "statistic": ["mean"]}, "facts")


def test_context_is_not_advertised_as_a_coordinate():
    public = next(resource for resource in default_resource_catalogue.__wrapped__().discovery_payload()["resources"]
                  if resource["resource_id"] == AGGREGATE)
    assert "context" not in public["axes"]
    assert "context" not in {axis for axis, _values in public["axis_values"]}


# Behavioural: the legacy summary-on-aggregate call still reaches the shared
# comparison snapshot, and the declared summary address cannot do so.
def test_alias_summary_on_aggregate_still_works(monkeypatch):
    captured = {}
    response = _http_read(monkeypatch, captured, {
        "resource": AGGREGATE, "target": TARGET,
        "coordinates": {"measure": ["meanDiversity"]}, "intent": _fixed()})
    assert response.status_code == 200, response.text
    assert response.json()["comparison"]["group_value"] == 1.0
    args = captured["comparison"][0]
    assert args[4] is None and args[5] == "meanDiversity"

    # The declared summary address is refused by name on the aggregate.
    catalogue = default_resource_catalogue.__wrapped__()
    with pytest.raises(ValueError, match="not declared for the AEDAR per-cell family"):
        validate_resource_item(
            _item(AGGREGATE, {"horizon": ["15"], "mode": ["car"], "kind": ["diversity"]}, _fixed()),
            catalogue)


# Behavioural: both address forms produce the same read for the same Cellule.
@pytest.mark.parametrize("declared,alias,resource_kind", [
    ({"typequ": ["A104"], "horizon": ["5"], "mode": ["walk"], "statistic": ["mean"]},
     {"typequ": ["A104"], "measure": ["count_5_walk_mean"]}, "per_cell"),
    ({"horizon": ["15"], "mode": ["car"], "kind": ["diversity"]},
     {"measure": ["meanDiversity"]}, "summary"),
])
def test_alias_and_declared_address_resolve_to_the_same_read(monkeypatch, declared, alias, resource_kind):
    captured = {}
    declared_resource = AGGREGATE if resource_kind == "per_cell" else SUMMARY
    alias_resource = AGGREGATE

    first = _http_read(monkeypatch, captured, {
        "resource": declared_resource, "target": TARGET,
        "coordinates": declared, "intent": _fixed()})
    assert first.status_code == 200, first.text
    # Target, context, equipment, measure and fields — excluding the connection
    # and the resource-specific facet map, which legitimately differ.
    declared_args = captured["comparison"][0][1:7]
    captured.clear()

    second = _http_read(monkeypatch, captured, {
        "resource": alias_resource, "target": TARGET,
        "coordinates": alias, "intent": _fixed()})
    assert second.status_code == 200, second.text
    alias_args = captured["comparison"][0][1:7]
    # Same equipment, same measure, same projection — the caller cannot tell
    # which address form was used.
    assert declared_args == alias_args
    # The response envelope differs only in the resource identity; the read
    # itself is identical.
    assert first.json()["comparison"] == second.json()["comparison"]


# Fixed summary comparison charges the peer group like the aggregate reading.
def test_fixed_summary_preflight_charges_the_peer_group(monkeypatch):
    captured = {}
    _wire_snapshots(monkeypatch, captured)
    item = _item(SUMMARY, {"horizon": ["15"], "mode": ["car"], "kind": ["diversity"]}, _fixed())
    work = _reader().preflight(None, item, default_resource_catalogue.__wrapped__())
    assert work == 1 + len(captured["peers"][2])


# Behavioural: diversity ranks reach the caller from a declared summary Cellule.
def test_declared_summary_receives_diversity_ranks(monkeypatch):
    captured = {}
    response = _http_read(monkeypatch, captured, {
        "resource": SUMMARY, "target": TARGET,
        "coordinates": {"horizon": ["15"], "mode": ["car"], "kind": ["diversity"]},
        "fields": ["group_value", "value", "rank", "rank_size", "rank_ties"],
        "intent": _fixed()})
    assert response.status_code == 200, response.text
    comparison = response.json()["comparison"]
    assert (comparison["rank"], comparison["rank_size"], comparison["rank_ties"]) == (1, 3, 1)
    assert {"rank", "rank_size", "rank_ties"} <= set(captured["comparison"][0][6])


def test_alias_facts_on_aggregate_and_summary_read_the_declared_fields(monkeypatch):
    captured = {}
    first = _http_read(monkeypatch, captured, {
        "resource": AGGREGATE, "target": TARGET,
        "coordinates": {"typequ": ["A104"], "measure": ["count_5_walk_mean"]},
        "intent": {"kind": "facts"}})
    assert first.status_code == 200, first.text
    assert captured["aggregate_facts"][0][3] == ["A104"]
    assert captured["aggregate_facts"][0][4] is None  # legacy envelope, no field injection

    captured.clear()
    second = _http_read(monkeypatch, captured, {
        "resource": SUMMARY, "target": TARGET,
        "coordinates": {"measure": ["meanVolume"]}, "intent": {"kind": "facts"}})
    assert second.status_code == 200, second.text
    assert captured["summary_facts"][0][3] == ["meanVolume"]

    catalogue = default_resource_catalogue.__wrapped__()
    with pytest.raises(ValueError, match="typequ"):
        validate_resource_item(
            _item(AGGREGATE, {"horizon": ["5"], "mode": ["walk"], "statistic": ["mean"]},
                  {"kind": "facts"}), catalogue)
