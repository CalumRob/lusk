"""Retirement contract for the legacy service-comparison API."""

from api.main import app


def test_legacy_service_comparison_routes_are_absent_but_semantic_reads_remain():
    paths = set(app.openapi()["paths"])
    assert not any("essential-services" in path or "read-batch" == path.rsplit("/", 1)[-1]
                   and path == "/api/read-batch" for path in paths)
    assert "/api/resources/read" in paths
    assert "/api/resources/read-batch" in paths
