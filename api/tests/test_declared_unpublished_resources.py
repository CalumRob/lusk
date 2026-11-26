"""Grammar-declared but unpublished resources fail per item, not as unknown."""

from __future__ import annotations

from contextlib import contextmanager
import json
from pathlib import Path
import shutil

import pytest
from fastapi.testclient import TestClient

from api import main
from api.repository import ReadRepository
from api.resource_catalogue import ResourceGrammar


ROOT = Path(__file__).parents[2]
SHAPES = (
    ("scalar", "scalar", "scalar_descriptor"),
    ("declared_profile", "profile", "profile_descriptor"),
    ("ordered_series", "ordered_series", "series_descriptor"),
    ("period_detail", "collection", "observed_collection_descriptor"),
    ("aedar_source_grain", "aedar", "aedar_territorial_aggregate"),
)
PUBLISHED = "published_scalar"
FOCAL = "22001"


class Cursor:
    def __init__(self, rows=()):
        self.rows = list(rows)

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return self.rows


class Connection:
    def __init__(self):
        self.statements = []

    @contextmanager
    def transaction(self):
        yield self

    def execute(self, sql, params=None):
        self.statements.append(sql)
        normalized = " ".join(sql.split())
        if normalized.startswith("SET TRANSACTION ISOLATION LEVEL"):
            return Cursor()
        if "FROM resource_publication_descriptor" in normalized:
            return Cursor([(
                PUBLISHED, "published-v1", PUBLISHED,
                json.dumps({"kind": "scalar"}), True,
            )])
        if "FROM resource_publication" in normalized:
            requested = set(params[0])
            rows = [(PUBLISHED, "scalar", "published-v1", "ref-v1")] if PUBLISHED in requested else []
            return Cursor(rows)
        if "to_regclass" in normalized:
            return Cursor([(params[0],)])
        if "table_name='territory_reference'" in normalized:
            return Cursor([("ref-v1", 1)])
        if "territory_id=ANY" in normalized:
            return Cursor([(FOCAL, "commune")])
        if "FROM profile_descriptor" in normalized:
            return Cursor([(["commune"],)])
        if "SELECT count(*) FROM aedar_territorial_aggregate" in normalized:
            return Cursor([(0,)])
        raise AssertionError(sql)


class Pool:
    def __init__(self):
        self.connection_value = Connection()

    @contextmanager
    def connection(self):
        yield self.connection_value


@pytest.fixture(scope="module")
def grammar(tmp_path_factory):
    directory = tmp_path_factory.mktemp("declared-unpublished-grammar")
    source = ROOT / "pipeline/inst/extdata"
    contract = json.loads((source / "semantic-resource-contracts.json").read_text(encoding="utf-8"))
    declarations = [
        {
            "resource_id": resource_id,
            "kind": kind,
            "fields": ["value"],
            "storage_relation": relation,
            "allowed_levels": ["commune"],
            "intents": ["facts"],
        }
        for resource_id, (kind, _family, relation) in (
            ("declared_" + kind, (kind, family, relation))
            for kind, family, relation in SHAPES if kind != "aedar_source_grain"
        )
    ]
    declarations.append({
        "resource_id": PUBLISHED, "kind": "scalar", "fields": ["value"],
        "storage_relation": "scalar_descriptor", "allowed_levels": ["commune"],
        "intents": ["facts"],
    })
    contract["resources"].extend(declarations)
    path = directory / "semantic-resource-contracts.json"
    path.write_text(json.dumps(contract), encoding="utf-8")
    shutil.copy2(source / "aedar-typequ-universe.json", directory)
    return ResourceGrammar(path, contract)


@pytest.fixture
def client(monkeypatch, grammar):
    import api.aedar_reads as aedar_reads

    pool = Pool()
    repository = ReadRepository(pool)
    reader = main.get_semantic_resource_reader()

    def facts(connection, territory_type, territory_id, indicator_id, fields=None, **kwargs):
        if kwargs.get("preflight_only"):
            return 1
        return {"resource": indicator_id, "value": 12}

    def aedar_snapshot(*args, **kwargs):
        if kwargs.get("preflight_only"):
            return 0
        return {"observations": []}

    monkeypatch.setattr(reader, "_indicator_facts_snapshot", facts)
    monkeypatch.setattr(aedar_reads, "_aedar_territorial_aggregate_snapshot", aedar_snapshot)
    main.app.dependency_overrides[main.get_repository] = lambda: repository
    main.app.dependency_overrides[main.get_resource_grammar] = lambda: grammar
    main.app.dependency_overrides[main.get_semantic_resource_reader] = lambda: reader
    try:
        yield TestClient(main.app)
    finally:
        main.app.dependency_overrides.clear()


def request(resource_id):
    return {
        "resource": resource_id,
        "target": {"kind": "territory", "type": "commune", "id": FOCAL},
        "intent": {"kind": "facts"},
    }


@pytest.mark.parametrize(("kind", "family", "relation"), SHAPES)
def test_declared_but_unpublished_single_read_is_typed_unavailable(client, kind, family, relation):
    resource_id = "aedar_territorial_aggregate" if kind == "aedar_source_grain" else "declared_" + kind

    response = client.post("/api/resources/read", json=request(resource_id))

    assert response.status_code == 503, response.text
    assert response.json()["detail"] == "Resource publication is unavailable"


@pytest.mark.parametrize(("kind", "family", "relation"), SHAPES)
def test_declared_but_unpublished_batch_item_does_not_block_published_sibling(
        client, kind, family, relation):
    resource_id = "aedar_territorial_aggregate" if kind == "aedar_source_grain" else "declared_" + kind

    response = client.post("/api/resources/read-batch", json={
        "contract": "semantic-read-batch-v2",
        "items": [
            {"id": "missing", **request(resource_id)},
            {"id": "published", **request(PUBLISHED)},
        ],
    })

    assert response.status_code == 200, response.text
    missing, published = response.json()["results"]
    assert missing == {
        "id": "missing", "resource": resource_id, "status": "publication_unavailable",
        "reason": "publication_absent", "family": family,
    }
    assert published["id"] == "published"
    assert published["resource"] == PUBLISHED
    assert published["status"] == "available"
    assert published["data"]["value"] == 12


@pytest.mark.parametrize(("kind", "family", "relation"), SHAPES)
def test_never_declared_identity_remains_request_wide_422(client, kind, family, relation):
    response = client.post("/api/resources/read-batch", json={
        "contract": "semantic-read-batch-v2",
        "items": [
            {"id": "unknown", **request("never_declared")},
            {"id": "published", **request(PUBLISHED)},
        ],
    })

    assert response.status_code == 422, response.text
    assert response.json()["detail"] == "unknown semantic resource"


@pytest.mark.parametrize(("kind", "family", "relation"), SHAPES)
def test_discovery_still_lists_only_live_version_bound_resources(client, kind, family, relation):
    response = client.get("/api/resources")

    assert response.status_code == 200, response.text
    assert [row["resource_id"] for row in response.json()["resources"]] == [PUBLISHED]
