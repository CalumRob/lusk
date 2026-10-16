"""Retirement contract for the legacy accessibility-specific HTTP surface."""

from api.main import app


def test_retired_building_and_essential_service_routes_are_absent():
    paths = set(app.openapi()["paths"])
    assert not any("building-access" in path or "essential-services" in path for path in paths)
    assert "/api/resources/read" in paths
    assert "/api/resources/read-batch" in paths
