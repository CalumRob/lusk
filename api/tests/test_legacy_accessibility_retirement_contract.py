from pathlib import Path


API = Path(__file__).resolve().parents[1]


def test_fresh_schema_excludes_retired_accessibility_relations_and_upgrade_drops_them():
    fresh = (API / "schema.sql").read_text(encoding="utf-8").lower()
    retirement = (API / "migrations/036_retire_legacy_accessibility_serving.sql").read_text(
        encoding="utf-8").lower()
    retired_relations = (
        "service_registry", "essential_service_access", "building_ramp", "building_grid",
        "bpe_profile_evidence", "mobility_density_distribution_point",
        "mobility_density_distribution_range", "mobility_density_distribution_descriptor",
    )
    for relation in retired_relations:
        assert f"create table {relation}" not in fresh
        assert f"drop table if exists {relation}" in retirement
    assert "create table scalar_observation" in fresh
    assert "create table aedar_comparison_publication" in fresh


def test_retired_building_and_bpe_routes_are_not_registered():
    import api.main as main

    paths = set(main.app.openapi()["paths"])
    assert not any("building-access" in path or "essential-services" in path for path in paths)
    assert "/api/resources/read" in paths
    assert "/api/resources/read-batch" in paths
