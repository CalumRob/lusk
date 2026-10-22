from pathlib import Path

from fastapi.testclient import TestClient

from api.main import app
from api.scripts.generate_endpoint_inventory import (
    check_inventory_file,
    render_inventory,
)


ENDPOINTS = Path(__file__).parents[1] / "ENDPOINTS.md"


def test_public_docs_and_openapi_are_database_free_and_api_prefixed():
    with TestClient(app) as client:
        docs = client.get("/api/docs")
        schema = client.get("/api/openapi.json")

    assert docs.status_code == 200
    assert "url: '/api/openapi.json'" in docs.text
    assert schema.status_code == 200
    paths = schema.json()["paths"]
    assert "/api/resources/read-batch" in paths
    assert "/api/read-batch" not in paths
    assert "/api/territories/{territory_type}/{territory_id}/themes/{theme_id}/facts" not in paths
    for retired_path in (
        "/api/building-access/territories",
        "/api/territories/{territory_type}/{territory_id}/building-access",
        "/api/territories/{territory_type}/{territory_id}/building-access-comparison",
        "/api/territories/{territory_type}/{territory_id}/profiles/{indicator_id}",
        "/api/territories/{territory_type}/{territory_id}/indicators/{indicator_id}",
        "/api/territories/{territory_type}/{territory_id}/themes/{theme_id}/comparison",
        "/api/territories/{territory_type}/{territory_id}/indicators/{indicator_id}/comparison",
        "/api/series-datasets/{dataset_id}/territories/{territory_type}/{territory_id}/{indicator_id}",
        "/api/territories/commune/{territory_id}/essential-services",
        "/api/aedar/territories/{territory_type}/{territory_id}/aggregates",
        "/api/aedar/territories/{territory_type}/{territory_id}/comparisons",
    ):
        assert retired_path not in paths
    assert not any(path.startswith("/api/aedar") for path in paths)
    assert "/api/resources/read" in paths


def test_endpoint_request_inventory_matches_openapi():
    assert check_inventory_file(ENDPOINTS, app.openapi())


def test_endpoint_reference_has_human_guidance_for_every_operation():
    reference = ENDPOINTS.read_text(encoding="utf-8")
    for path, path_item in app.openapi()["paths"].items():
        for method in ("get", "put", "post", "delete", "options", "head", "patch", "trace"):
            if method in path_item:
                assert f"`{method.upper()} {path}`" in reference


def test_endpoint_request_inventory_is_deterministic():
    schema = app.openapi()
    generated = render_inventory(schema)
    assert generated == render_inventory(schema)
    assert "required request body: `ResourceReadItem`" in generated
    assert "required request body: `ResourceBatchRequest`" in generated
    assert "| `ResourceReadItem` | `resource` | yes |" in generated
    assert "| `ResourceBatchRequest` | `items` | yes |" in generated
    assert "const: `facts`" in generated


def test_endpoint_request_inventory_check_detects_schema_drift(tmp_path):
    schema = app.openapi()
    reference = ENDPOINTS.read_text(encoding="utf-8")
    generated = render_inventory(schema)
    examples = (
        ("required request body", "optional request body"),
        ("max items: `12`", "max items: `11`"),
        ("| `ResourceBatchRequest` | `items` | yes |", "| `ResourceBatchRequest` | `items` | no |"),
        ("| `ResourceReadItem` | `resource` | yes |", "| `ResourceReadItem` | `resource` | no |"),
    )
    for expected, changed in examples:
        assert expected in generated
        altered = reference.replace(expected, changed, 1)
        assert altered != reference
        candidate = tmp_path / "ENDPOINTS.md"
        candidate.write_text(altered, encoding="utf-8")
        assert not check_inventory_file(candidate, schema)
