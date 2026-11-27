"""Discovery is the semantic grammar intersected with live DB descriptors."""

import json

import pytest
from fastapi import HTTPException

from api.resource_catalogue import (database_resource_catalogue,
                                    default_resource_grammar)


def indicator_declaration(resource_id, *, label=None, shapes=None):
    theme = "demographie"
    contract = {"allowed_levels": ["commune"], "counts_available": True}
    metadata = {
        "theme": theme,
        "indicator_keys": [resource_id],
        "sources": {resource_id: "source_a"},
        "source_records": {"source_a": {"name": "Source A", "vintages": [
            {"id": "source_a_2026", "version": "2026"}]}},
        "indicator_pages": {resource_id: {
            "indicator": resource_id, "label": label or resource_id, "unit": "count",
            "direction": "high", "levels": ["commune"],
            "comparison": {"unit": "count"},
        }},
        "scalar_contracts": {resource_id: contract},
    }
    return {"kind": "indicator", "metadata": metadata}


class Cursor:
    def __init__(self, rows=()):
        self.rows = list(rows)

    def fetchall(self):
        return self.rows


class Connection:
    def __init__(self, rows=()):
        self.rows = list(rows)
        self.statements = []

    def execute(self, sql, params=None):
        self.statements.append((sql, params))
        assert "FROM resource_publication_descriptor d" in sql
        assert "LEFT JOIN resource_publication p" in sql
        assert "NOT p.retired" in sql
        assert "d.content_version=p.content_version" in sql
        return Cursor(self.rows)


def test_catalogue_lists_only_live_version_bound_descriptors(monkeypatch, tmp_path):
    import shutil
    from pathlib import Path

    source = Path(__file__).parents[2] / "pipeline/inst/extdata"
    for name in ("semantic-resource-contracts.json", "aedar-typequ-universe.json"):
        shutil.copy2(source / name, tmp_path / name)
    monkeypatch.setenv("LUSK_PRODUCER_METADATA_DIR", str(tmp_path))
    grammar = default_resource_grammar.__wrapped__()
    conn = Connection([
        ("resource_a", "a-v1", "resource_a", indicator_declaration("resource_a", label="A"), True),
        ("resource_b", "b-v2", "resource_b", indicator_declaration("resource_b", label="B"), True),
    ])

    catalogue = database_resource_catalogue(conn, grammar)

    assert [resource.resource_id for resource in catalogue.resources] == ["resource_a", "resource_b"]
    assert catalogue.resources_by_id["resource_a"].label == "A"
    assert catalogue.resources_by_id["resource_a"].counts_available is True
    assert catalogue.resources_by_id["resource_a"].sources == ("source_a", "source_a_2026")
    assert len(conn.statements) == 1


def test_adding_a_registry_descriptor_needs_no_image_or_grammar_change():
    grammar = default_resource_grammar()
    conn = Connection([("new_resource", "new-v1", "new_resource",
                        indicator_declaration("new_resource"), True)])

    catalogue = database_resource_catalogue(conn, grammar)

    assert {resource.resource_id for resource in catalogue.resources} == {"new_resource"}
    assert "new_resource" in catalogue.resources_by_id


def test_descriptor_cannot_inject_an_unregistered_shape():
    declaration = indicator_declaration("resource_a")
    declaration["kind"] = "invented_shape"
    conn = Connection([("resource_a", "a-v1", "resource_a", declaration, True)])

    with pytest.raises(HTTPException) as raised:
        database_resource_catalogue(conn, default_resource_grammar())

    assert raised.value.status_code == 503


def test_named_reference_alias_is_discovered_against_its_owner_registry_row():
    owner, alias = "series_owner", "series_reference"
    metadata = {
        "theme": "fixture", "indicator_keys": [alias],
        "sources": {alias: "source_a"},
        "source_records": {"source_a": {"name": "Source A"}},
        "indicator_pages": {owner: {"indicator": owner, "label": "Owner", "unit": "count",
                                   "levels": ["commune"]}},
        "owned_series_routes": {owner: {
            "axis_kind": "year", "axis_values": ["2026"], "reference_read_route": True,
            "reference_indicator": alias, "reference_id": "national"}},
    }
    conn = Connection([(owner, "series-v1", alias,
                        {"kind": "indicator", "metadata": metadata}, True)])

    catalogue = database_resource_catalogue(conn, default_resource_grammar())

    assert [resource.resource_id for resource in catalogue.resources] == [alias]
    assert catalogue.resources[0].shapes == ("named_reference",)
    assert catalogue.resources[0].target_ids == ("national",)


def test_owned_series_descriptor_binds_semantic_identity_to_dataset_registry():
    owner, dataset = "series_owner", "series_dataset"
    metadata = {
        "theme": "fixture", "indicator_keys": [owner],
        "sources": {owner: "source_a"},
        "source_records": {"source_a": {"name": "Source A"}},
        "indicator_pages": {owner: {
            "indicator": owner, "label": "Owner", "unit": "count",
            "levels": ["commune"], "axis_kind": "year", "axis_values": ["2026"],
        }},
        "owned_series_routes": {owner: {
            "dataset_id": dataset, "axis_kind": "year", "axis_values": ["2026"],
        }},
    }
    conn = Connection([(dataset, "series-v1", owner,
                        {"kind": "indicator", "metadata": metadata}, True)])

    catalogue = database_resource_catalogue(conn, default_resource_grammar())

    assert [resource.resource_id for resource in catalogue.resources] == [owner]
    assert catalogue.resources[0].publication_resource_id == dataset
    assert catalogue.resources[0].shapes == ("ordered_series",)


def test_retired_descriptor_is_admissible_but_not_discoverable():
    from api.resource_catalogue import validate_resource_item
    from api.resource_requests import ResourceReadItem

    conn = Connection([("resource_a", "a-v1", "resource_a",
                        indicator_declaration("resource_a"), False)])
    catalogue = database_resource_catalogue(conn, default_resource_grammar())

    assert catalogue.discovery_payload()["resources"] == []
    item = ResourceReadItem.model_validate({
        "resource": "resource_a",
        "target": {"kind": "territory", "type": "commune", "id": "c1"},
        "intent": {"kind": "facts"},
    })
    assert validate_resource_item(item, catalogue).resource_id == "resource_a"


def test_empty_live_set_is_an_empty_catalogue_not_file_backed_discovery():
    catalogue = database_resource_catalogue(Connection(), default_resource_grammar())

    assert catalogue.discovery_payload() == {
        "contract": "semantic-resource-catalogue-v1", "resources": []}


@pytest.mark.db_catalogue
def test_production_catalogue_module_has_no_theme_metadata_file_discovery():
    import inspect
    from api import resource_catalogue

    source = inspect.getsource(resource_catalogue)
    assert "default_resource_catalogue" not in source
    assert "discover_indicator_resources" not in source
    assert "theme-metadata" not in source
    assert 'glob("theme_*.json")' not in source


@pytest.mark.db_catalogue
def test_resources_http_route_uses_the_database_catalogue(monkeypatch):
    from fastapi.testclient import TestClient
    from api import main
    from api.resource_catalogue import ResourceCatalogue

    calls = []

    class Repository:
        def resource_catalogue(self, grammar):
            calls.append(grammar)
            return ResourceCatalogue((), (), ())

    original = main.get_repository
    main.app.dependency_overrides[original] = lambda: Repository()
    try:
        response = TestClient(main.app).get("/api/resources")
    finally:
        main.app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {"contract": "semantic-resource-catalogue-v1", "resources": []}
    assert len(calls) == 1
