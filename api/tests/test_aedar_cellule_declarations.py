"""Discovery declarations for the two AEDAR Cellule families (#1076).

The aggregate's 312 measure keys and the 40 registry-wide summary readings are
declared as *addresses made of coordinates*, never as keys a client has to parse.
The Typequ universe is declared as structured values so a reader never needs an
app table, a registry file or a first-letter inference to name or group a type.

These assertions read the public discovery payload and the pinned producer
sources independently, so a fact duplicated in the catalogue cannot pass.
"""

import csv
import json
from pathlib import Path

import pytest

from api.resource_catalogue import default_resource_catalogue, discover_indicator_resources

ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "pipeline/inst/extdata/semantic-resource-contracts.json"
UNIVERSE = ROOT / "pipeline/inst/extdata/aedar-typequ-universe.json"
REGISTRY = ROOT / "pipeline/inst/extdata/aedar-typequ-2025.csv"
HIERARCHY = ROOT / "pipeline/tests/testthat/fixtures/aedar-typequ-hierarchy-2025.csv"

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


def _public(resource_id):
    payload = default_resource_catalogue.__wrapped__().discovery_payload()
    return next(resource for resource in payload["resources"]
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


def test_aggregate_declares_three_measure_coordinates_with_producer_labels():
    """The 312 keys decompose into three declared axes with readable labels."""
    cellule = _cellule(AGGREGATE)
    assert cellule["family"] == "aedar_per_cell"
    assert [coordinate["name"] for coordinate in cellule["coordinates"]] == [
        "horizon", "mode", "statistic"]

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
    # Legacy keys are comparison facets, never declared Cellule addresses.
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
    aggregate = _cellule(AGGREGATE)
    summary = _cellule(SUMMARY)
    aggregate_axes = {coordinate["name"] for coordinate in aggregate["coordinates"]}
    summary_axes = {coordinate["name"] for coordinate in summary["coordinates"]}
    assert aggregate_axes == {"horizon", "mode", "statistic"}
    assert summary_axes == {"horizon", "mode", "kind"}
    assert not aggregate_axes & {"kind"}
    assert not summary_axes & {"statistic", "typequ"}

    from api.aedar_models import AEDAR_AGGREGATE_READINGS, AEDAR_MEASURE_KEYS
    assert not set(AEDAR_AGGREGATE_READINGS) & set(AEDAR_MEASURE_KEYS)

    # Each resource's own resource id remains its address; the other family's
    # axis is not admitted on it.
    from api.resource_catalogue import validate_resource_item
    from api.resource_requests import ResourceReadItem
    catalogue = default_resource_catalogue.__wrapped__()
    target = {"kind": "territory", "type": "commune", "id": "22001"}
    summary_on_aggregate = ResourceReadItem.model_validate({
        "resource": AGGREGATE, "target": target, "coordinates": {"kind": ["diversity"]},
        "intent": {"kind": "facts"}})
    with pytest.raises(ValueError, match="coordinate axis is not declared"):
        validate_resource_item(summary_on_aggregate, catalogue)
    aggregate_on_summary = ResourceReadItem.model_validate({
        "resource": SUMMARY, "target": target, "coordinates": {"statistic": ["mean"]},
        "intent": {"kind": "facts"}})
    with pytest.raises(ValueError, match="coordinate axis is not declared"):
        validate_resource_item(aggregate_on_summary, catalogue)


def test_measure_selectors_resolve_to_exactly_one_family():
    from api.aedar_models import aedar_measure_family

    assert aedar_measure_family(["count_5_walk_mean"]) == "per_cell"
    assert aedar_measure_family(["meanDiversity"]) == "summary"
    assert aedar_measure_family(["meanVolume", "count_15_car_mean"]) is None
    assert aedar_measure_family(["bogus"]) is None
    assert aedar_measure_family([]) is None


def test_typequ_universe_is_complete_and_structured():
    """No code may rely on a display string, an app table or its first letter."""
    values = _cellule(AGGREGATE)["typequ_universe"]
    registry = _registry()
    hierarchy = _hierarchy()
    assert len(values) == 235 == len(registry) == len(hierarchy)
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
        assert set(value["gamme"]) == {"status", "label"}
        assert value["gamme"]["status"] in {"classified", "hors_gamme", "absent"}, (
            f"{code}: gamme status is not declared")


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
