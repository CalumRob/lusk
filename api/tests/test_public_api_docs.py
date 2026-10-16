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
    assert "/api/read-batch" in schema.json()["paths"]
    assert "BatchReadRequest" in schema.json()["components"]["schemas"]
    assert any(
        parameter["name"] == "fields"
        for path, path_item in schema.json()["paths"].items()
        if "/themes/" in path
        for operation in path_item.values()
        for parameter in operation.get("parameters", [])
    )


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
    assert "`fields` (query, optional: array of string; max items: `32`)" in generated
    assert (
        "`comparison` (query, optional: string; one of `bretagne`, `densite`, `epci`; "
        "default: `densite`)"
    ) in generated
    assert "optional request body: `IndicatorComparisonRequest`" in generated
    assert "| `BatchReadRequest` | `items` | yes |" in generated
    assert (
        "| `ThemeComparisonRequest` | `selection` | no | "
        "array of ThemeTerritorySelection; max items: `1500` |"
    ) in generated
    assert "const: `theme_facts`" in generated


def test_endpoint_request_inventory_check_detects_schema_drift(tmp_path):
    schema = app.openapi()
    reference = ENDPOINTS.read_text(encoding="utf-8")
    generated = render_inventory(schema)
    examples = (
        ("default: `8`", "default: `9`"),
        ("required request body", "optional request body"),
        ("max items: `12`", "max items: `11`"),
        (
            "| `BatchReadRequest` | `items` | yes |",
            "| `BatchReadRequest` | `items` | no |",
        ),
        (
            "| `ThemeComparisonRequest` | `selection` | no | "
            "array of ThemeTerritorySelection; max items: `1500` |",
            "| `ThemeComparisonRequest` | `selection` | no | "
            "array of ThemeTerritorySelection; max items: `1499` |",
        ),
    )
    for expected, changed in examples:
        assert expected in generated
        altered = reference.replace(expected, changed, 1)
        assert altered != reference
        candidate = tmp_path / "ENDPOINTS.md"
        candidate.write_text(altered, encoding="utf-8")
        assert not check_inventory_file(candidate, schema)
