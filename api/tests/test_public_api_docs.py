from pathlib import Path

from fastapi.testclient import TestClient

from api.main import app


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


def test_endpoint_reference_covers_every_openapi_operation():
    reference = ENDPOINTS.read_text(encoding="utf-8")
    schema = app.openapi()
    for path, path_item in schema["paths"].items():
        for method in ("get", "post", "put", "patch", "delete"):
            if method in path_item:
                assert f"`{method.upper()} {path}`" in reference
