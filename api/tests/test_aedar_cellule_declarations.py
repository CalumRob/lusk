"""Declared AEDAR Cellule addressing (#1076).

The 312 per-cell keys and the 40 summary readings are addresses made of
declared coordinates, never measure-key strings. The Typequ universe is a real
coordinate of the aggregate Cellule, so equipment × horizon × mode × statistic
is addressable without an app table, a registry file or a first-letter guess.

These assertions read the public discovery payload and the pinned producer
sources independently, so a fact duplicated in the catalogue cannot pass.
"""

import csv
import json
import re
from pathlib import Path

import pytest

from api.resource_catalogue import validate_resource_item
from api.tests.resource_catalogue_fixtures import default_resource_catalogue, discover_indicator_resources
from api.resource_requests import ResourceBatchItem, ResourceReadItem

ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "pipeline/inst/extdata/semantic-resource-contracts.json"
UNIVERSE = ROOT / "pipeline/inst/extdata/aedar-typequ-universe.json"
REGISTRY = ROOT / "pipeline/inst/extdata/aedar-typequ-2025.csv"
HIERARCHY = ROOT / "pipeline/tests/testthat/fixtures/aedar-typequ-hierarchy-2025.csv"
R_SOURCE = ROOT / "pipeline/R/aedar_aggregates.R"

AGGREGATE = "aedar_territorial_aggregate"
SUMMARY = "aedar_territory_summary"

MODE_LABELS = {
    "walk": "À pied",
    "transit": "Transports en commun",
    "transit_gain": "Gain des transports en commun",
    "bike_lts2": "Vélo LTS2",
    "bike_lts4": "Vélo LTS4",
    "car": "Voiture",
}
DISPLAY_MODES = ("walk", "transit", "bike_lts2", "bike_lts4", "car")
HORIZONS = ("5", "10", "15", "20")
STATISTICS = ("share", "min", "max", *(f"decile{i}" for i in range(1, 10)), "mean")
KINDS = ("diversity", "volume")


def _resource(resource_id):
    return next(resource for resource in default_resource_catalogue.__wrapped__().resources
                if resource.resource_id == resource_id)


def _public(resource_id):
    return next(resource for resource in default_resource_catalogue.__wrapped__().discovery_payload()["resources"]
                if resource["resource_id"] == resource_id)


def _cellule(resource_id):
    return _public(resource_id)["cellule"]


def _coordinate(resource_id, name):
    return next(coordinate for coordinate in _cellule(resource_id)["coordinates"]
                if coordinate["name"] == name)


def _values(resource_id, name):
    return {value["value"]: value for value in _coordinate(resource_id, name)["values"]}


def _registry():
    with REGISTRY.open(encoding="utf-8-sig", newline="") as handle:
        return {row["TYPEQU"]: row["LIB_TYPEQU"] for row in csv.DictReader(handle)}


def _hierarchy():
    with HIERARCHY.open(encoding="utf-8-sig", newline="") as handle:
        return {row["TYPEQU"]: row for row in csv.DictReader(handle)}


def _discover(tmp_path, mutate):
    """A producer declaration mutated in isolation, discovered fail-closed."""
    contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
    universe = json.loads(UNIVERSE.read_text(encoding="utf-8"))
    mutate(contract, universe)
    (tmp_path / "semantic-resource-contracts.json").write_text(
        json.dumps(contract, ensure_ascii=False), encoding="utf-8")
    (tmp_path / "aedar-typequ-universe.json").write_text(
        json.dumps(universe, ensure_ascii=False), encoding="utf-8")
    metadata = ROOT / "pipeline/inst/extdata/theme-metadata"
    return discover_indicator_resources(metadata, tmp_path / "semantic-resource-contracts.json")


def _aedar_declaration(contract, resource_id):
    return contract["cellule_declarations"][resource_id]


def test_aggregate_declares_four_addressable_coordinates_with_producer_labels():
    """Equipment × horizon × mode × statistic; every value is addressable."""
    cellule = _cellule(AGGREGATE)
    assert cellule["family"] == "aedar_per_cell"
    assert [coordinate["name"] for coordinate in cellule["coordinates"]] == [
        "typequ", "horizon", "mode", "statistic"]
    assert _resource(AGGREGATE).axes == ("typequ", "horizon", "mode", "statistic")

    horizon = _coordinate(AGGREGATE, "horizon")
    assert [value["value"] for value in horizon["values"]] == list(HORIZONS)
    assert [value["label"] for value in horizon["values"]] == [
        "5 min", "10 min", "15 min", "20 min"]
    assert all(value["unit"] == "minutes" for value in horizon["values"])

    modes = _values(AGGREGATE, "mode")
    assert list(modes) == list(MODE_LABELS)
    assert {key: value["label"] for key, value in modes.items()} == MODE_LABELS
    # transit_gain is a real per-cell mode, even though no ramp is drawn for it.
    assert "transit_gain" in modes

    statistics = _values(AGGREGATE, "statistic")
    assert list(statistics) == list(STATISTICS)
    assert statistics["share"]["label"] == "Part"
    assert statistics["mean"]["label"] == "Moyenne"
    assert statistics["decile1"]["label"] == "1er décile"
    assert statistics["decile9"]["label"] == "9e décile"
    assert all(value["label"] for value in statistics.values())


def test_summary_declares_its_own_family_address_and_excludes_transit_gain():
    """The summary is its own family: car x 15 is a point, not a legacy key."""
    cellule = _cellule(SUMMARY)
    assert cellule["family"] == "aedar_summary"
    assert [coordinate["name"] for coordinate in cellule["coordinates"]] == [
        "horizon", "mode", "kind"]
    assert _resource(SUMMARY).axes == ("horizon", "mode", "kind")
    assert list(_values(SUMMARY, "mode")) == list(DISPLAY_MODES)
    assert "transit_gain" not in _values(SUMMARY, "mode")
    assert cellule["no_summary_modes"] == ["transit_gain"]
    assert list(_values(SUMMARY, "kind")) == list(KINDS)
    assert {key: value["label"] for key, value in _values(SUMMARY, "kind").items()} == {
        "diversity": "Diversité", "volume": "Volume"}

    points = [set(point) for point in cellule["valid_combinations"]]
    assert all(point == {"horizon", "mode", "kind"} for point in points)
    assert {"horizon": "15", "mode": "car", "kind": "diversity"} in cellule["valid_combinations"]
    assert {"horizon": "15", "mode": "car", "kind": "volume"} in cellule["valid_combinations"]
    addresses = {value["value"] for coordinate in cellule["coordinates"]
                 for value in coordinate["values"]}
    assert not {"meanDiversity", "meanVolume"} & addresses


def test_valid_combinations_cover_exactly_the_two_spaces():
    aggregate = _cellule(AGGREGATE)["valid_combinations"]
    assert len(aggregate) == 4 * 6 * 13 == 312
    assert all(set(point) == {"horizon", "mode", "statistic"} for point in aggregate)
    assert {"horizon": "15", "mode": "transit_gain", "statistic": "mean"} in aggregate

    summary = _cellule(SUMMARY)["valid_combinations"]
    assert len(summary) == 4 * 5 * 2 == 40
    assert all(set(point) == {"horizon", "mode", "kind"} for point in summary)
    assert not any(point["mode"] == "transit_gain" for point in summary)


def test_the_two_families_cannot_satisfy_each_other():
    aggregate_axes = {coordinate["name"] for coordinate in _cellule(AGGREGATE)["coordinates"]}
    summary_axes = {coordinate["name"] for coordinate in _cellule(SUMMARY)["coordinates"]}
    assert aggregate_axes == {"typequ", "horizon", "mode", "statistic"}
    assert summary_axes == {"horizon", "mode", "kind"}
    assert not aggregate_axes & {"kind"}
    assert not summary_axes & {"statistic", "typequ"}

    from api.aedar_models import AEDAR_AGGREGATE_READINGS, AEDAR_MEASURE_KEYS
    assert not set(AEDAR_AGGREGATE_READINGS) & set(AEDAR_MEASURE_KEYS)

    catalogue = default_resource_catalogue.__wrapped__()
    target = {"kind": "territory", "type": "commune", "id": "22001"}
    for resource_id, coordinates in ((AGGREGATE, {"horizon": ["15"], "mode": ["car"], "kind": ["volume"]}),
                                     (SUMMARY, {"typequ": ["A104"], "horizon": ["5"],
                                                "mode": ["walk"], "statistic": ["mean"]})):
        wrong = ResourceReadItem.model_validate({
            "resource": resource_id, "target": target, "coordinates": coordinates,
            "intent": {"kind": "facts"}})
        with pytest.raises(ValueError, match="not declared for the AEDAR"):
            validate_resource_item(wrong, catalogue)


def test_measure_string_is_not_an_address():
    """The declared address is the only documented one; measure is deprecated alias."""
    from api.aedar_models import AEDARAddressError, resolve_aedar_address
    catalogue = default_resource_catalogue.__wrapped__()
    target = {"kind": "territory", "type": "commune", "id": "22001"}
    for resource_id, measure in ((AGGREGATE, "count_5_walk_mean"), (SUMMARY, "meanVolume")):
        public = _public(resource_id)
        assert "measure" not in public["axes"]
        assert "measure" not in {axis for axis, _values in public["axis_values"]}
        # The deprecated alias still works until #1098 migrates the fiche.
        item = ResourceReadItem.model_validate({
            "resource": resource_id, "target": target,
            "coordinates": {"measure": [measure]}, "intent": {"kind": "facts"}})
        assert validate_resource_item(item, catalogue).resource_id == resource_id
    # A declared address never carries a measure key.
    with pytest.raises(AEDARAddressError, match="measure is not an AEDAR Cellule address"):
        resolve_aedar_address("aedar_source_grain", {"measure": ["count_5_walk_mean"]})


def test_declared_coordinates_resolve_to_internal_selectors(monkeypatch):
    """The reader alone turns a declared address into the internal measure key."""
    from api.aedar_models import resolve_aedar_address
    from api.semantic_resource_reader import SemanticResourceReader

    assert resolve_aedar_address("aedar_source_grain", {
        "typequ": ["A104"], "horizon": ["5"], "mode": ["walk"], "statistic": ["mean"]}) == (
        ["A104"], ["count_5_walk_mean"], "aedar_per_cell")
    # The car × 15 summary resolves to its legacy key without ever addressing by it.
    assert resolve_aedar_address("aedar_territory_summary", {
        "horizon": ["15"], "mode": ["car"], "kind": ["diversity"]}) == (
        None, ["meanDiversity"], "aedar_summary")
    # A measure-free typequ read addresses no Cellule and keeps all measures.
    assert resolve_aedar_address("aedar_source_grain", {"typequ": ["A104"]}) == (
        ["A104"], None, "aedar_per_cell")
    # transit_gain has no summary.
    from api.aedar_models import AEDARAddressError
    with pytest.raises(AEDARAddressError, match="does not name a declared AEDAR summary"):
        resolve_aedar_address("aedar_territory_summary", {
            "horizon": ["15"], "mode": ["transit_gain"], "kind": ["diversity"]})

    captured = {}

    def fake_facts(conn, territory_type, territory_id, typequ, fields, limit, offset,
                   *, preflight_only=False):
        captured.update(typequ=typequ, fields=fields)
        return {"facts": []}

    monkeypatch.setattr("api.aedar_reads._aedar_territorial_aggregate_snapshot", fake_facts)
    reader = SemanticResourceReader(
        indicator_facts_snapshot=lambda *a, **k: {}, indicator_comparison_preflight=lambda *a, **k: {},
        indicator_comparison_snapshot=lambda *a, **k: {}, owned_series_route=lambda *a, **k: None,
        owned_named_reference_snapshot=lambda *a, **k: {}, comparison_field_selection=lambda f: f,
        max_owned_series_provenance_per_point=8)
    catalogue = default_resource_catalogue.__wrapped__()
    item = ResourceReadItem.model_validate({
        "resource": AGGREGATE,
        "target": {"kind": "territory", "type": "commune", "id": "22001"},
        "coordinates": {"typequ": ["A104"], "horizon": ["5"], "mode": ["walk"],
                        "statistic": ["mean"]},
        "intent": {"kind": "facts"}})
    reader.read(None, item, catalogue)
    assert captured == {"typequ": ["A104"], "fields": ["measures.count_5_walk_mean"]}


def test_batch_items_share_the_declared_address_resolution(monkeypatch):
    """Each declared Cellule in a batch reaches its snapshot with one resolved measure."""
    from contextlib import contextmanager

    from api.resource_execution import execute_batch
    from api.semantic_resource_reader import SemanticResourceReader

    captured = []

    def snapshot(name):
        def stub(*args, **kwargs):
            captured.append((name, args, kwargs))
            return {"facts": [], "readings": []}
        return stub

    monkeypatch.setattr("api.aedar_reads._aedar_territorial_aggregate_snapshot",
                        snapshot("aggregate"))
    monkeypatch.setattr("api.aedar_reads._aedar_territory_summary_resource_snapshot",
                        snapshot("summary"))

    class Cursor:
        def __init__(self, rows=()):
            self.rows = list(rows)

        def fetchone(self):
            return self.rows[0] if self.rows else (0,)

        def fetchall(self):
            return self.rows

    class Connection:
        def execute(self, sql, params=None):
            if "FROM resource_publication" in sql:
                return Cursor([("aedar", "aedar", "aedar-v1", "ref-v1")])
            if "territory_id=ANY" in sql:
                return Cursor([(territory_id, "commune") for territory_id in params[0]])
            if "SELECT DISTINCT typequ" in sql:
                return Cursor([(code,) for code in (params[0] if params else ())])
            return Cursor()

        @contextmanager
        def transaction(self):
            yield self

    class Pool:
        @contextmanager
        def connection(self):
            yield Connection()

    catalogue = default_resource_catalogue.__wrapped__()
    reader = SemanticResourceReader(
        indicator_facts_snapshot=lambda *a, **k: {}, indicator_comparison_preflight=lambda *a, **k: {},
        indicator_comparison_snapshot=lambda *a, **k: {}, owned_series_route=lambda *a, **k: None,
        owned_named_reference_snapshot=lambda *a, **k: {}, comparison_field_selection=lambda f: f,
        max_owned_series_provenance_per_point=8)
    request = type("Request", (), {"items": [
        ResourceBatchItem.model_validate({
            "id": "a", "resource": AGGREGATE,
            "target": {"kind": "territory", "type": "commune", "id": "22001"},
            "coordinates": {"typequ": ["A104"], "horizon": ["5"], "mode": ["walk"],
                            "statistic": ["mean"]},
            "intent": {"kind": "facts"}}),
        ResourceBatchItem.model_validate({
            "id": "b", "resource": SUMMARY,
            "target": {"kind": "territory", "type": "commune", "id": "22001"},
            "coordinates": {"horizon": ["15"], "mode": ["car"], "kind": ["volume"]},
            "intent": {"kind": "facts"}}),
    ], "contract": None})()
    response = execute_batch(Pool(), request, catalogue,
        lambda conn, item, budget: reader.preflight(conn, item, catalogue, work_budget=budget),
        lambda conn, item: reader.read(conn, item, catalogue))
    assert [result["id"] for result in response["results"]] == ["a", "b"]
    # Each declared Cellule was projected to exactly one internal measure.
    aggregate_call = next(entry for entry in captured
                          if entry[0] == "aggregate" and not entry[2].get("preflight_only"))
    summary_call = next(entry for entry in captured
                        if entry[0] == "summary" and not entry[2].get("preflight_only"))
    assert aggregate_call[1][3] == ["A104"]
    assert aggregate_call[1][4] == ["measures.count_5_walk_mean"]
    assert summary_call[1][3] == ["meanVolume"]


class _NoConnection:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def transaction(self):
        return self

    def execute(self, *_args, **_kwargs):
        return None


def _no_conn():
    return _NoConnection()


def test_typequ_universe_is_a_complete_structured_coordinate():
    """No code may rely on a display string, an app table or its first letter."""
    values = [value for value in _coordinate(AGGREGATE, "typequ")["values"]]
    registry = _registry()
    hierarchy = _hierarchy()
    assert len(values) == len(registry) == len(hierarchy) == 235
    assert {value["value"] for value in values} == set(registry)

    by_code = {value["value"]: value for value in values}
    assert sorted(value["source_order"] for value in values) == list(range(1, 236))
    assert len({value["domain"]["code"] for value in values}) == 7
    assert len({(value["domain"]["code"], value["subdomain"]["code"]) for value in values}) == 27

    for code, label in registry.items():
        value = by_code[code]
        assert value["label"] == label, f"{code}: label disagrees with the pinned registry"
        row = hierarchy[code]
        assert value["domain"]["code"] == " ".join(row["domain_code"].split()), (
            f"{code}: domain code disagrees with the producer hierarchy")
        assert value["domain"]["label"] == " ".join(row["domain_label"].split()), (
            f"{code}: domain label disagrees with the producer hierarchy")
        assert value["subdomain"]["code"] == " ".join(row["subdomain_code"].split()), (
            f"{code}: subdomain code disagrees with the producer hierarchy")
        assert value["subdomain"]["label"] == " ".join(row["subdomain_label"].split()), (
            f"{code}: subdomain label disagrees with the producer hierarchy")
        assert set(value["gamme"]) == {"status", "label"}, f"{code}: gamme is not structured"
        assert value["gamme"]["status"] in {"classified", "hors_gamme", "absent"}, (
            f"{code}: gamme status is not declared")
        if value["gamme"]["status"] == "absent":
            assert value["gamme"]["label"] is None, f"{code}: absent gamme carries a label"
        else:
            assert value["gamme"]["label"], f"{code}: gamme label is missing"

    assert by_code["A104"]["gamme"]["label"] == "Gamme intermédiaire"
    assert by_code["A105"]["gamme"] == {"status": "hors_gamme", "label": "Hors Gamme"}
    assert by_code["F105"]["gamme"] == {"status": "absent", "label": None}


def test_source_pins_and_python_vocabulary_match_the_producer_file():
    """Drift between the declaration and the R producer fails by name."""
    payload = json.loads(UNIVERSE.read_text(encoding="utf-8"))
    source = R_SOURCE.read_text(encoding="utf-8")
    registry_sha = re.search(r'AEDAR_TYPEQU_REGISTRY_SHA256\s*<-\s*"([0-9a-f]{64})"', source).group(1)
    pinned = re.findall(r'"([0-9a-f]{64})"', re.search(
        r'AEDAR_TYPEQU_METADATA_RESOURCES\s*<-\s*data\.frame\((.*?)stringsAsFactors',
        source, re.S).group(1))
    assert payload["sources"]["registry"]["sha256"] == registry_sha
    assert payload["sources"]["hierarchy"]["sha256"] == pinned[0]
    assert payload["sources"]["gamme"]["sha256"] == pinned[1]

    # The Python vocabulary and the producer contract file cannot drift apart.
    from api.aedar_models import (AEDAR_MEASURE_HORIZONS, AEDAR_MEASURE_MODES,
                                  AEDAR_MEASURE_STATISTICS, AEDAR_SUMMARY_KINDS)
    declarations = json.loads(CONTRACT.read_text(encoding="utf-8"))["cellule_declarations"]
    aggregate = {coordinate["name"]: [value["value"] for value in coordinate["values"]]
                 for coordinate in declarations[AGGREGATE]["coordinates"]}
    summary = {coordinate["name"]: [value["value"] for value in coordinate["values"]]
               for coordinate in declarations[SUMMARY]["coordinates"]}
    assert tuple(aggregate["horizon"]) == AEDAR_MEASURE_HORIZONS
    assert tuple(aggregate["mode"]) == AEDAR_MEASURE_MODES
    assert tuple(aggregate["statistic"]) == AEDAR_MEASURE_STATISTICS
    assert tuple(summary["mode"]) == tuple(mode for mode in AEDAR_MEASURE_MODES
                                           if mode != "transit_gain")
    assert tuple(summary["kind"]) == AEDAR_SUMMARY_KINDS


def test_measure_selectors_keep_the_one_family_vocabulary():
    from api.aedar_models import aedar_measure_family

    assert aedar_measure_family(["count_5_walk_mean"]) == "aedar_per_cell"
    assert aedar_measure_family(["meanDiversity"]) == "aedar_summary"
    assert aedar_measure_family(["meanVolume", "count_15_car_mean"]) is None
    assert aedar_measure_family(["bogus"]) is None
    assert aedar_measure_family([]) is None


def test_deprecated_union_alias_is_published():
    from api.aedar_models import (AEDAR_AGGREGATE_READINGS, AEDAR_COMPARISON_MEASURE_KEYS,
                                  AEDAR_MEASURE_KEYS)
    assert AEDAR_COMPARISON_MEASURE_KEYS == frozenset(AEDAR_MEASURE_KEYS) | frozenset(
        AEDAR_AGGREGATE_READINGS)


def test_declaration_fails_closed_when_a_coordinate_or_label_is_missing(tmp_path):
    def drop_mode(contract, _universe):
        _aedar_declaration(contract, AGGREGATE)["coordinates"][1]["values"].pop()

    with pytest.raises(ValueError, match="aedar_per_cell.*mode"):
        _discover(tmp_path, drop_mode)

    def blank_label(contract, _universe):
        _aedar_declaration(contract, SUMMARY)["coordinates"][1]["values"][0]["label"] = ""

    with pytest.raises(ValueError, match="aedar_summary.*label"):
        _discover(tmp_path, blank_label)


def test_declaration_fails_closed_when_the_typequ_universe_is_incomplete(tmp_path):
    def drop_domain(contract, universe):
        universe["values"][0]["domain"]["code"] = ""

    with pytest.raises(ValueError, match="typequ.*domain"):
        _discover(tmp_path, drop_domain)

    def drop_entry(contract, universe):
        universe["values"].pop()

    with pytest.raises(ValueError, match="typequ.*235"):
        _discover(tmp_path, drop_entry)


def test_declaration_fails_closed_when_combinations_do_not_match_the_axes(tmp_path):
    def drop_combination(contract, _universe):
        _aedar_declaration(contract, SUMMARY)["valid_combinations"].pop()

    with pytest.raises(ValueError, match="aedar_summary.*combination"):
        _discover(tmp_path, drop_combination)


def test_declaration_fails_closed_when_the_families_overlap(tmp_path):
    def leak_summary_axis(contract, _universe):
        declaration = _aedar_declaration(contract, AGGREGATE)
        declaration["coordinates"].append({"name": "kind", "values": [
            {"value": "diversity", "label": "Diversité"}]})

    with pytest.raises(ValueError, match="AEDAR families overlap"):
        _discover(tmp_path, leak_summary_axis)
