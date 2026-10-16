import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.resource_catalogue import discover_indicator_resources
from api import main


METADATA = Path(__file__).parents[2] / "pipeline/inst/extdata/theme-metadata"


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


def test_discovery_preserves_multiple_producer_declared_shapes_and_axes():
    catalogue = discover_indicator_resources(METADATA)
    resources = {resource.resource_id: resource for resource in catalogue.resources}

    assert resources["prix_m2"].shapes == ("scalar", "ordered_series")
    age = resources["structure_age"]
    assert age.shapes == ("declared_profile",)
    assert age.axes == ("detail", "sex")
    assert resources["couverture_programmes"].shapes == ("anchored_membership",)
    assert resources["subventions_par_domaine"].shapes == ("period_detail",)
    assert resources["subventions_annuelles"].shapes == ("ordered_series",)


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
