from pathlib import Path

from fastapi.testclient import TestClient

from api.main import app
from api.scripts.generate_endpoint_inventory import (
    check_inventory_file,
    render_inventory,
)


ENDPOINTS = Path(__file__).parents[1] / "ENDPOINTS.md"
BATCH_CONTRACT = Path(__file__).parents[1] / "batch-read-contract.md"
FIELD_SELECTION = Path(__file__).parents[1] / "field-selection-contract.md"
INTEGRATION_README = Path(__file__).parents[1] / "tests/integration/README.md"
SCHEMA = Path(__file__).parents[1] / "schema.sql"


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


def test_cohort_documentation_matches_aedar_cellule_support():
    """The hand-maintained cohort prose must not contradict admitted targets (#1078)."""
    endpoints = ENDPOINTS.read_text(encoding="utf-8")
    batch = BATCH_CONTRACT.read_text(encoding="utf-8")
    for text in (endpoints, batch):
        assert "AEDAR Cellule" in text
        assert "`values`" in text
        assert "region included" in text
    assert "source-grain resources, named references, and comparison intents do not" not in endpoints
    assert "AEDAR source-grain resources and named references do not" not in batch


def test_public_per_resource_publication_versions_are_documented():
    contract = " ".join(BATCH_CONTRACT.read_text(encoding="utf-8").split())
    assert "`profile_content_versions`" not in contract
    assert "`scalar_content_versions`" not in contract
    assert "`profile_content_version` is that profile's own registry `content_version`" in contract
    assert "There is no public theme-wide version map" in contract


def test_endpoint_reference_pins_public_per_resource_versions():
    endpoints = " ".join(ENDPOINTS.read_text(encoding="utf-8").split())
    assert "`profile_content_version` is that profile's own registry version" in endpoints
    assert "scalar `content_version` is that scalar's own registry version" in endpoints
    assert "A batch may return different versions for different resources" in endpoints
    assert "`profile_content_versions`" not in endpoints
    assert "`scalar_content_versions`" not in endpoints


def test_retired_typed_readings_are_not_advertised_as_active_contracts():
    for document in (ENDPOINTS, BATCH_CONTRACT, FIELD_SELECTION):
        text = document.read_text(encoding="utf-8")
        assert "`typed_reading`" not in text, document
        assert "typed-reading" not in text, document
        assert "selected-reading" not in text, document
    integration = INTEGRATION_README.read_text(encoding="utf-8")
    assert "LUSK_MILIEUX_CONSO_SOURCE" not in integration
    assert "LUSK_MILIEUX_PROCESSED_WINDOW" not in integration
    schema = SCHEMA.read_text(encoding="utf-8")
    assert "coexists with the global profile_comparison_publication" not in schema
    assert "authoritative profile comparison clock after migration 049" in schema


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
        ("array of ResourceBatchItem; min items: `1`", "array of ResourceBatchItem; min items: `0`"),
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
