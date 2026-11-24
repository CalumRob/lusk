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
        assert "JOIN resource_publication_descriptor" in sql
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
        ("resource_a", "a-v1", "resource_a", indicator_declaration("resource_a", label="A")),
        ("resource_b", "b-v2", "resource_b", indicator_declaration("resource_b", label="B")),
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
                        indicator_declaration("new_resource"))])

    catalogue = database_resource_catalogue(conn, grammar)

    assert set(catalogue.resources_by_id) == {"new_resource"}


def test_descriptor_cannot_inject_an_unregistered_shape():
    declaration = indicator_declaration("resource_a")
    declaration["kind"] = "invented_shape"
    conn = Connection([("resource_a", "a-v1", "resource_a", declaration)])

    with pytest.raises(HTTPException) as raised:
        database_resource_catalogue(conn, default_resource_grammar())

    assert raised.value.status_code == 503


def test_empty_live_set_is_an_empty_catalogue_not_file_backed_discovery():
    catalogue = database_resource_catalogue(Connection(), default_resource_grammar())

    assert catalogue.discovery_payload() == {
        "contract": "semantic-resource-catalogue-v1", "resources": []}
