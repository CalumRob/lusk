"""Retained scalar/profile/series storage and semantic discovery contracts."""

from pathlib import Path

from api.main import app
from api.resource_catalogue import default_resource_catalogue


API = Path(__file__).parents[1]


def test_semantic_resource_api_replaces_the_legacy_scalar_profile_and_series_routes():
    paths = set(app.openapi()["paths"])
    assert "/api/resources" in paths
    assert "/api/resources/read" in paths
    assert "/api/resources/read-batch" in paths
    assert "/api/read-batch" not in paths
    assert not any("/scalar" in path or "/profiles/" in path or "/series/" in path
                   for path in paths)
    catalogue = default_resource_catalogue()
    assert "densite" in catalogue.resources_by_id
    assert "structure_age" in catalogue.resources_by_id
    assert "prix_m2" in catalogue.resources_by_id
    assert "scalar" in catalogue.resources_by_id["densite"].shapes
    assert "declared_profile" in catalogue.resources_by_id["structure_age"].shapes
    assert "ordered_series" in catalogue.resources_by_id["prix_m2"].shapes


def test_fresh_and_additive_schema_define_independent_scalar_publication():
    fresh = (API / "schema.sql").read_text()
    migration = (API / "migrations/004_shared_scalar.sql").read_text()
    for sql in (fresh, migration):
        assert "CREATE TABLE scalar_descriptor" in sql
        assert "CREATE TABLE scalar_observation" in sql
        assert "status='measured' AND value IS NOT NULL" in sql or "status = 'measured' AND value IS NOT NULL" in sql
        assert "GRANT SELECT" in sql or sql is fresh
    assert "ALTER TABLE table_publication" in migration
    assert "scalar_observation" in migration


def test_fresh_schema_defines_versioned_fixed_scalar_comparison_grains():
    fresh = (API / "schema.sql").read_text()
    assert "CREATE TABLE scalar_comparison_publication" in fresh
    assert "scalar_content_version text NOT NULL" in fresh
    assert "reference_content_version text NOT NULL" in fresh
    assert "CREATE TABLE scalar_comparison_group" in fresh
    assert "CREATE TABLE scalar_comparison_territory" in fresh
    assert "tie_count integer" in fresh
    assert "median double precision" in fresh
    assert "GRANT SELECT" in fresh
    assert "ON DELETE CASCADE" in fresh


def test_ordered_series_fresh_schema_mirrors_additive_migration():
    fresh = (API / "schema.sql").read_text()
    migration = (API / "migrations/007_ordered_series.sql").read_text()
    for sql in (fresh, migration):
        assert "CREATE TABLE series_descriptor" in sql
        assert "CREATE TABLE ordered_series" in sql
        assert "comparison_point" in sql and "axis_values" in sql
        assert "status='measured' AND value IS NOT NULL" in sql


def test_profile_fresh_schema_and_additive_migration_declare_dense_axes():
    fresh = (API / "schema.sql").read_text()
    migration = (API / "migrations/006_declared_profile.sql").read_text()
    for sql in (fresh, migration):
        assert "CREATE TABLE profile_descriptor" in sql
        assert "CREATE TABLE profile_axis" in sql
        assert "CREATE TABLE profile_observation" in sql
        assert "CREATE TABLE profile_observation_source" in sql
        assert "dense_complete" in sql
        assert "primarykey(indicator_id,territory_id,detail_key,sex_key)" in "".join(sql.lower().split())
    assert "declared_profile" in migration
    assert "profile_publication_requires_reference" in migration
