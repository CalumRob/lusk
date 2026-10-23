import json
import shutil
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

    assert len(catalogue.declarations) == 62
    assert len(catalogue.excluded) == 29
    assert len(resources) == 33
    assert "bornes_ev_par_station_service" in resources
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
    assert len(catalogue.resources) == 38
    assert len(catalogue.excluded) == 29
    assert "aedar_territorial_aggregate" in catalogue.resources_by_id
    typed = {resource_id: catalogue.resources_by_id[resource_id] for resource_id in (
        "demographie_selected_reading", "economie_selected_reading",
        "habitat_selected_reading", "milieux_selected_reading")}
    assert all(resource.resource_kind == "typed_reading" for resource in typed.values())
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
    age = resources["structure_age"]
    assert age.shapes == ("declared_profile",)
    assert age.axes == ("detail", "sex")
    assert resources["couverture_programmes"].shapes == ("anchored_membership",)
    assert resources["couverture_programmes"].intents == ("facts",)
    assert resources["subventions_par_domaine"].shapes == ("period_detail",)
    assert resources["subventions_annuelles"].shapes == ("ordered_series",)
    assert "fixed_comparison" in resources["subventions_par_domaine"].intents
    assert "selected_comparison" in resources["subventions_annuelles"].intents


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
    assert len(payload["resources"]) == 33
    ids = {resource["resource_id"] for resource in payload["resources"]}
    assert "bornes_ev_par_station_service" in ids
    assert not any(resource.startswith("share_") for resource in ids)
