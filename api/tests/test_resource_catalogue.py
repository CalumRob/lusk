import json
import shutil
from collections import Counter
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.resource_catalogue import (default_resource_catalogue,
                                    discover_indicator_resources,
                                    validate_resource_item)
from api.resource_requests import ResourceReadItem
from api import main


METADATA = Path(__file__).parents[2] / "pipeline/inst/extdata/theme-metadata"
SNAPSHOT = Path(__file__).parents[2] / "docs/design/serving-resource-catalogue-snapshot.md"


def _snapshot_indicator_ids():
    retained = set()
    excluded = set()
    for line in SNAPSHOT.read_text(encoding="utf-8").splitlines():
        if not line.startswith("| "):
            continue
        columns = [part.strip() for part in line.strip().strip("|").split("|")]
        if len(columns) < 6 or columns[0] not in {
            "demographie", "economie", "habitat", "milieux", "mobilite", "programmes",
        }:
            continue
        indicator_id, classification, target = columns[1], columns[4], columns[5]
        if classification.startswith("EXCLUDED -"):
            excluded.add(indicator_id)
        elif target.startswith("indicator:"):
            retained.add(indicator_id)
    return retained, excluded


def test_discovery_accounts_for_every_theme_indicator_and_excludes_legacy_source():
    catalogue = discover_indicator_resources(METADATA)
    resources = {resource.resource_id: resource for resource in catalogue.resources}

    declared_keys = [key for path in sorted(METADATA.glob("theme_*.json"))
                     for key in json.loads(path.read_text(encoding="utf-8"))["indicator_keys"]]
    assert len(catalogue.declarations) == len(declared_keys)
    assert len(catalogue.excluded) == 29
    # #962 added three Mobility supply scalar pages: stations_service,
    # stations_service_1000 and bornes_recharge_1000 (33 -> 36 retained).
    assert len(resources) == 36
    assert {"bornes_ev_par_station_service", "stations_service",
            "stations_service_1000", "bornes_recharge_1000"} <= set(resources)
    assert "structure_age" in resources
    assert "subventions_annuelles" in resources
    reference = resources["raccordement_reference"]
    assert "named_reference" in reference.shapes
    assert reference.target_kinds == ("named_reference",)
    assert all(not key.startswith("share_") for key in resources)
    assert all(not key.startswith("iso_") for key in resources)
    assert {resource.indicator_id for resource in catalogue.excluded} == {
        declaration.indicator_id for declaration in catalogue.declarations
        if declaration.disposition == "excluded_legacy_accessibility"
    }
    expected_retained, expected_excluded = _snapshot_indicator_ids()
    assert {resource.indicator_id for resource in catalogue.resources} == expected_retained
    assert {declaration.indicator_id for declaration in catalogue.excluded} == expected_excluded


def test_declared_docker_metadata_payload_loads_full_catalogue_without_checkout(monkeypatch, tmp_path):
    """Mirror only the producer metadata COPY inputs from api/deploy/Dockerfile."""
    root = Path(__file__).parents[2]
    source = root / "pipeline/inst/extdata"
    dockerfile = (root / "api/deploy/Dockerfile").read_text(encoding="utf-8")
    assert "COPY pipeline/inst/extdata/theme-metadata /app/pipeline/inst/extdata/theme-metadata" in dockerfile
    assert "COPY pipeline/inst/extdata/semantic-resource-contracts.json /app/pipeline/inst/extdata/semantic-resource-contracts.json" in dockerfile
    image_payload = tmp_path / "pipeline/inst/extdata"
    shutil.copytree(source / "theme-metadata", image_payload / "theme-metadata")
    shutil.copy2(source / "semantic-resource-contracts.json", image_payload)
    monkeypatch.setenv("LUSK_PRODUCER_METADATA_DIR", str(image_payload))

    from api.resource_catalogue import default_resource_catalogue
    catalogue = default_resource_catalogue.__wrapped__()
    # The full catalogue is exactly the declared payload: producer indicators,
    # the two AEDAR semantic contracts, and the four declared typed readings.
    indicator_catalogue = discover_indicator_resources(image_payload / "theme-metadata")
    contracts = json.loads((image_payload / "semantic-resource-contracts.json").read_text(encoding="utf-8"))
    typed_readings = [resource["resource_id"]
                      for path in sorted((image_payload / "theme-metadata").glob("theme_*.json"))
                      for resource in json.loads(path.read_text(encoding="utf-8")).get("semantic_resources") or []]
    expected_ids = ({resource.resource_id for resource in indicator_catalogue.resources}
                    | {resource["resource_id"] for resource in contracts["resources"]}
                    | set(typed_readings))
    assert {resource.resource_id for resource in catalogue.resources} == expected_ids
    assert len(catalogue.excluded) == 29
    assert "aedar_territorial_aggregate" in catalogue.resources_by_id
    summary = catalogue.resources_by_id["aedar_territory_summary"]
    assert summary.resource_kind == "aedar_territory_summary"
    assert summary.allowed_levels == ("commune", "epci", "departement", "region")
    assert summary.axes == ("measure",) and summary.dynamic_axes == ("measure",)
    assert summary.intents == ("facts",)
    assert {"value", "status", "n_typequ", "n_addresses", "n_observed",
            "coverage_status", "source_id", "vintage_id"} <= set(summary.fields)
    typed = {resource_id: catalogue.resources_by_id[resource_id] for resource_id in (
        "demographie_selected_reading", "economie_selected_reading",
        "habitat_selected_reading", "milieux_selected_reading")}
    assert all(resource.resource_kind == "typed_reading" for resource in typed.values())
    assert all(resource.map_eligible is None and not resource.counts_available
               for resource in typed.values())
    assert typed["economie_selected_reading"].side_relations[0]["storage_relation"] == "economy_activity_evidence"
    assert typed["milieux_selected_reading"].side_relations[0]["storage_relation"] == "milieux_reading_absence"
    public_contract = next(item for item in catalogue.discovery_payload()["resources"]
                           if item["resource_id"] == "economie_selected_reading")
    assert "ranked_activities" in public_contract["fields"]
    assert "storage_relation" not in public_contract
    assert "side_relations" not in public_contract
    assert public_contract["evidence"] == [{"field": "ranked_activities", "fields": [
        "territory_id", "territory_type", "groupe", "rank", "activity_code",
        "activity_label", "lq", "establishment_count", "park_share", "source_id", "vintage_id"]}]


def test_discovery_preserves_multiple_producer_declared_shapes_and_axes():
    catalogue = discover_indicator_resources(METADATA)
    resources = {resource.resource_id: resource for resource in catalogue.resources}

    assert resources["prix_m2"].shapes == ("scalar", "ordered_series")
    assert resources["prix_m2"].counts_available is True
    assert resources["structure_age"].counts_available is False
    assert resources["offre_tc"].map_eligible is True
    assert resources["raccordement_tc"].map_eligible is True
    assert resources["raccordement_courbe"].map_eligible is False
    assert resources["raccordement_reference"].map_eligible is False
    age = resources["structure_age"]
    assert age.shapes == ("declared_profile",)
    assert age.axes == ("detail", "sex")
    assert resources["couverture_programmes"].shapes == ("anchored_membership",)
    assert resources["couverture_programmes"].intents == ("facts",)
    assert resources["subventions_par_domaine"].shapes == ("period_detail",)
    assert resources["subventions_annuelles"].shapes == ("ordered_series",)
    assert "fixed_comparison" in resources["subventions_par_domaine"].intents
    assert "selected_comparison" in resources["subventions_annuelles"].intents


def test_scalar_discovery_exposes_all_producer_declared_vintage_source_identities():
    catalogue = default_resource_catalogue.__wrapped__()
    scalar = catalogue.resources_by_id["part_passoires"]

    assert set(scalar.sources) == {"dpe_22", "dpe_29", "dpe_35", "dpe_56"}


def test_discovery_exposes_every_retained_profile_page_and_its_declared_axes():
    catalogue = discover_indicator_resources(METADATA)
    resources = {resource.resource_id: resource for resource in catalogue.resources
                 if "declared_profile" in resource.shapes}
    expected = {}
    families = Counter()
    for path in METADATA.glob("theme_*.json"):
        metadata = json.loads(path.read_text(encoding="utf-8"))
        profile_ids = set(metadata.get("profile_contracts", {}))
        profile_ids.update(
            indicator for indicator, page in (metadata.get("indicator_pages") or {}).items()
            if (page.get("pyramid") or {}).get("dimensions")
        )
        for indicator in profile_ids:
            page = metadata["indicator_pages"][indicator]
            expected[indicator] = (metadata["theme"], page["family"])
            families[page["family"]] += 1

    assert set(resources) == set(expected)
    assert len(resources) == 10
    assert families == Counter({"composition": 6, "list": 2, "distribution": 1, "pyramid": 1})
    for indicator, (theme, _family) in expected.items():
        resource = resources[indicator]
        assert resource.theme_id == theme
        assert resource.axes == tuple(axis for axis, _values in resource.axis_values)
        assert resource.axes
        assert all(resource.axis_values)
        public = next(entry for entry in catalogue.discovery_payload()["resources"]
                      if entry["resource_id"] == indicator)
        assert public["axes"] == resource.axes
        assert public["axis_values"] == resource.axis_values


def test_cohort_capability_is_derived_from_supported_fact_families():
    catalogue = default_resource_catalogue.__wrapped__()
    resources = catalogue.resources_by_id

    assert "territory_cohort" in resources["densite"].target_kinds
    assert "territory_cohort" in resources["structure_age"].target_kinds
    assert "territory_cohort" in resources["prix_m2"].target_kinds
    assert "territory_cohort" in resources["subventions_par_domaine"].target_kinds
    assert "territory_cohort" in resources["couverture_programmes"].target_kinds
    assert "territory_cohort" in resources["economie_selected_reading"].target_kinds
    assert "territory_cohort" not in resources["aedar_territorial_aggregate"].target_kinds
    assert resources["raccordement_reference"].target_kinds == ("named_reference",)

    aedar_cohort = ResourceReadItem.model_validate({
        "resource": "aedar_territorial_aggregate",
        "target": {"kind": "territory_cohort", "type": "commune"},
        "intent": {"kind": "facts"},
    })
    with pytest.raises(ValueError, match="target kind is not declared"):
        validate_resource_item(aedar_cohort, catalogue)

    named_reference_cohort = ResourceReadItem.model_validate({
        "resource": "raccordement_reference",
        "target": {"kind": "territory_cohort", "type": "commune"},
        "intent": {"kind": "facts"},
    })
    with pytest.raises(ValueError, match="target kind is not declared"):
        validate_resource_item(named_reference_cohort, catalogue)

    comparison_cohort = ResourceReadItem.model_validate({
        "resource": "densite",
        "target": {"kind": "territory_cohort", "type": "commune"},
        "intent": {"kind": "fixed_comparison", "context": "default"},
    })
    with pytest.raises(ValueError, match="facts-only"):
        validate_resource_item(comparison_cohort, catalogue)


def test_member_ranks_are_projectable_for_scalar_comparisons_and_selected_profiles_only():
    catalogue = default_resource_catalogue.__wrapped__()
    selected = ResourceReadItem.model_validate({
        "resource": "structure_age",
        "target": {"kind": "territory", "type": "commune", "id": "22001"},
        "fields": ["member_ranks"],
        "intent": {"kind": "selected_comparison", "members": [
            {"type": "commune", "id": "22001"}, {"type": "commune", "id": "22002"},
        ]},
    })
    assert validate_resource_item(selected, catalogue).resource_id == "structure_age"

    scalar = ResourceReadItem.model_validate({
        "resource": "densite",
        "target": {"kind": "territory", "type": "commune", "id": "22001"},
        "fields": ["member_ranks"],
        "intent": {"kind": "selected_comparison", "members": [
            {"type": "commune", "id": "22001"}, {"type": "commune", "id": "22002"},
        ]},
    })
    assert validate_resource_item(scalar, catalogue).resource_id == "densite"

    fixed = ResourceReadItem.model_validate({
        "resource": "structure_age",
        "target": {"kind": "territory", "type": "commune", "id": "22001"},
        "fields": ["member_ranks"],
        "intent": {"kind": "fixed_comparison", "context": "default"},
    })
    with pytest.raises(ValueError, match="field is not declared"):
        validate_resource_item(fixed, catalogue)

    scalar_fixed = ResourceReadItem.model_validate({
        "resource": "densite",
        "target": {"kind": "territory", "type": "epci", "id": "200000001"},
        "fields": ["member_ranks"],
        "intent": {"kind": "fixed_comparison", "context": "default"},
    })
    assert validate_resource_item(scalar_fixed, catalogue).resource_id == "densite"

    non_comparable = ResourceReadItem.model_validate({
        "resource": "structure_age",
        "target": {"kind": "territory", "type": "commune", "id": "22001"},
        "fields": ["member_ranks"],
        "intent": {"kind": "facts"},
    })
    with pytest.raises(ValueError, match="field is not declared"):
        validate_resource_item(non_comparable, catalogue)

    scalar_facts = ResourceReadItem.model_validate({
        "resource": "densite",
        "target": {"kind": "territory", "type": "commune", "id": "22001"},
        "fields": ["member_ranks"],
        "intent": {"kind": "facts"},
    })
    with pytest.raises(ValueError, match="field is not declared"):
        validate_resource_item(scalar_facts, catalogue)


@pytest.mark.parametrize("intent", [
    {"kind": "selected_comparison", "members": [
        {"type": "commune", "id": "29001"}, {"type": "commune", "id": "29002"},
    ]},
    {"kind": "fixed_comparison", "context": "default"},
])
def test_member_ranks_do_not_project_from_dual_shape_scalar_series_resources(intent):
    catalogue = default_resource_catalogue.__wrapped__()
    item = ResourceReadItem.model_validate({
        "resource": "prix_m2",
        "target": {"kind": "territory", "type": "commune", "id": "29001"},
        "fields": ["member_ranks"],
        "intent": intent,
    })

    with pytest.raises(ValueError, match="field is not declared"):
        validate_resource_item(item, catalogue)


def test_dual_scalar_series_member_ranks_require_an_explicit_nested_scalar_projection():
    catalogue = default_resource_catalogue.__wrapped__()
    fields = ["axis_comparisons", "scalar_facet", "median", "rank", "rank_size",
        "rank_ties", "selected_member_count", "eligible_count", "missing_count", "member_ranks"]
    selected = ResourceReadItem.model_validate({
        "resource": "prix_m2",
        "target": {"kind": "territory", "type": "commune", "id": "29001"},
        "fields": fields,
        "intent": {"kind": "selected_comparison", "members": [
            {"type": "commune", "id": "29001"}, {"type": "commune", "id": "29002"},
        ]},
    })
    assert validate_resource_item(selected, catalogue).resource_id == "prix_m2"

    for missing_selector in ("scalar_facet", "axis_comparisons"):
        invalid = ResourceReadItem.model_validate({
            "resource": "prix_m2",
            "target": {"kind": "territory", "type": "commune", "id": "29001"},
            "fields": [field for field in fields if field != missing_selector],
            "intent": selected.intent,
        })
        with pytest.raises(ValueError, match="field is not declared"):
            validate_resource_item(invalid, catalogue)


@pytest.mark.parametrize("intent", [
    {"kind": "selected_comparison", "members": [
        {"type": "commune", "id": "29001"}, {"type": "commune", "id": "29002"},
    ]},
    {"kind": "fixed_comparison", "context": "default"},
])
def test_dual_shape_member_rank_projection_fails_before_opening_the_reader(intent):
    from contextlib import contextmanager
    from types import SimpleNamespace

    class NoConnectionPool:
        @contextmanager
        def connection(self):
            raise AssertionError("invalid dual-shape member-rank projection must fail during preflight")
            yield

    catalogue = default_resource_catalogue.__wrapped__()
    previous_catalogue = main.app.dependency_overrides.get(main.get_resource_catalogue)
    previous_repository = main.app.dependency_overrides.get(main.get_repository)
    main.app.dependency_overrides[main.get_resource_catalogue] = lambda: catalogue
    main.app.dependency_overrides[main.get_repository] = lambda: SimpleNamespace(connections=NoConnectionPool())
    try:
        response = TestClient(main.app).post("/api/resources/read", json={
            "resource": "prix_m2",
            "target": {"kind": "territory", "type": "commune", "id": "29001"},
            "fields": ["member_ranks"], "intent": intent,
        })
        assert response.status_code == 422
        assert "field is not declared" in response.json()["detail"]
    finally:
        if previous_catalogue is None:
            main.app.dependency_overrides.pop(main.get_resource_catalogue, None)
        else:
            main.app.dependency_overrides[main.get_resource_catalogue] = previous_catalogue
        if previous_repository is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous_repository


def test_aedar_cohort_is_rejected_by_public_http_before_opening_a_connection(monkeypatch):
    from contextlib import contextmanager
    from types import SimpleNamespace

    class NoConnectionPool:
        @contextmanager
        def connection(self):
            raise AssertionError("invalid cohort target must fail before opening a connection")
            yield

    catalogue = default_resource_catalogue.__wrapped__()
    previous_catalogue = main.app.dependency_overrides.get(main.get_resource_catalogue)
    previous_repository = main.app.dependency_overrides.get(main.get_repository)
    main.app.dependency_overrides[main.get_resource_catalogue] = lambda: catalogue
    main.app.dependency_overrides[main.get_repository] = lambda: SimpleNamespace(
        connections=NoConnectionPool())
    try:
        response = TestClient(main.app).post("/api/resources/read", json={
            "resource": "aedar_territorial_aggregate",
            "target": {"kind": "territory_cohort", "type": "commune"},
            "intent": {"kind": "facts"},
        })
    finally:
        if previous_catalogue is None:
            main.app.dependency_overrides.pop(main.get_resource_catalogue, None)
        else:
            main.app.dependency_overrides[main.get_resource_catalogue] = previous_catalogue
        if previous_repository is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous_repository

    assert response.status_code == 422
    assert "target kind is not declared" in response.json()["detail"]


def test_discovery_fails_closed_on_unaccounted_producer_declaration(tmp_path):
    source = json.loads((METADATA / "theme_demographie.json").read_text(encoding="utf-8"))
    source["indicator_keys"].append("new_unclassified_indicator")
    source["sources"]["new_unclassified_indicator"] = "new_source"
    source["indicator_pages"]["new_unclassified_indicator"] = {
        "indicator": "new_unclassified_indicator", "label": "New", "unit": "x",
        "direction": "none", "levels": ["commune"], "sources": ["new_source"]
    }
    (tmp_path / "theme_demographie.json").write_text(json.dumps(source), encoding="utf-8")
    for metadata in METADATA.glob("theme_*.json"):
        if metadata.name != "theme_demographie.json":
            (tmp_path / metadata.name).write_bytes(metadata.read_bytes())

    with pytest.raises(ValueError, match="unclassified producer indicator"):
        discover_indicator_resources(tmp_path)


def test_public_discovery_is_producer_derived_and_database_free():
    catalogue = discover_indicator_resources(METADATA)
    main.app.dependency_overrides[main.get_resource_catalogue] = lambda: catalogue
    try:
        response = TestClient(main.app).get("/api/resources")
    finally:
        main.app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["contract"] == "semantic-resource-catalogue-v1"
    # The public payload is exactly the discovered catalogue: no silent drop
    # or extra resource (36 producer indicators after #962).
    ids = {resource["resource_id"] for resource in payload["resources"]}
    assert ids == {resource.resource_id for resource in catalogue.resources}
    assert "bornes_ev_par_station_service" in ids
    assert {"stations_service", "stations_service_1000",
            "bornes_recharge_1000"} <= ids
    passoires = next(resource for resource in payload["resources"]
                     if resource["resource_id"] == "part_passoires")
    assert set(passoires["sources"]) == {"dpe_22", "dpe_29", "dpe_35", "dpe_56"}
    offers = {resource["resource_id"]: resource for resource in payload["resources"]}
    assert offers["offre_tc"]["map_eligible"] is True
    assert offers["raccordement_tc"]["map_eligible"] is True
    assert offers["raccordement_courbe"]["map_eligible"] is False
    assert offers["raccordement_reference"]["map_eligible"] is False
    assert offers["prix_m2"]["counts_available"] is True
    assert offers["structure_age"]["counts_available"] is False
    assert not any(resource.startswith("share_") for resource in ids)


def _copy_theme_metadata(destination):
    for metadata in METADATA.glob("theme_*.json"):
        (destination / metadata.name).write_bytes(metadata.read_bytes())


def test_discovery_capabilities_follow_mutated_producer_declarations(tmp_path):
    _copy_theme_metadata(tmp_path)
    mobility_path = tmp_path / "theme_mobilite.json"
    mobility = json.loads(mobility_path.read_text(encoding="utf-8"))
    mobility["map_layers"]["offre_tc"] = False
    mobility["map_layers"]["raccordement_courbe"] = True
    mobility["map_layers"]["raccordement_reference"] = True
    mobility_path.write_text(json.dumps(mobility), encoding="utf-8")

    habitat_path = tmp_path / "theme_habitat.json"
    habitat = json.loads(habitat_path.read_text(encoding="utf-8"))
    habitat["scalar_contracts"]["prix_m2"]["counts_available"] = False
    habitat_path.write_text(json.dumps(habitat), encoding="utf-8")

    demographic_path = tmp_path / "theme_demographie.json"
    demographic = json.loads(demographic_path.read_text(encoding="utf-8"))
    demographic["scalar_contracts"]["densite"]["counts_available"] = True
    demographic["indicator_pages"]["structure_age"]["counts_available"] = True
    demographic_path.write_text(json.dumps(demographic), encoding="utf-8")

    catalogue = discover_indicator_resources(tmp_path)
    resources = catalogue.resources_by_id

    assert resources["offre_tc"].map_eligible is False
    assert resources["raccordement_courbe"].map_eligible is True
    assert resources["raccordement_courbe"].shapes == ("ordered_series",)
    assert resources["raccordement_reference"].map_eligible is True
    assert resources["raccordement_reference"].shapes == ("named_reference",)
    assert resources["offre_cyclable"].map_eligible is True
    assert resources["densite"].map_eligible is True
    assert resources["prix_m2"].counts_available is False
    assert resources["densite"].counts_available is True
    assert resources["structure_age"].counts_available is False

    public = {resource["resource_id"]: resource
              for resource in catalogue.discovery_payload()["resources"]}
    assert public["offre_tc"]["map_eligible"] is False
    assert public["densite"]["counts_available"] is True
    assert public["structure_age"]["counts_available"] is False


@pytest.mark.parametrize(("theme", "capability", "invalid_value", "message"), [
    ("mobilite", "unknown_map_layer", False, "Unknown producer map layer indicator"),
    ("mobilite", "malformed_map_layer", "false", "Invalid producer map-layer capability"),
    ("demographie", "malformed_counts", "false", "Invalid scalar counts capability"),
])
def test_discovery_rejects_unknown_or_malformed_capabilities(
        tmp_path, theme, capability, invalid_value, message):
    _copy_theme_metadata(tmp_path)
    path = tmp_path / f"theme_{theme}.json"
    metadata = json.loads(path.read_text(encoding="utf-8"))
    if capability == "unknown_map_layer":
        metadata["map_layers"]["unknown_indicator"] = invalid_value
    elif capability == "malformed_map_layer":
        metadata["map_layers"]["offre_tc"] = invalid_value
    else:
        metadata["scalar_contracts"]["densite"]["counts_available"] = invalid_value
    path.write_text(json.dumps(metadata), encoding="utf-8")

    with pytest.raises(ValueError, match=message):
        discover_indicator_resources(tmp_path)
