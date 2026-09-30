from pathlib import Path


def test_owned_series_migration_is_additive_and_fresh_schema_matches():
    root = Path(__file__).resolve().parents[1]
    migration = (root / "migrations/011_owned_series_publications.sql").read_text()
    fresh = (root / "schema.sql").read_text()
    for token in (
        "series_provenance_revision", "series_dataset_publication",
        "series_dataset_descriptor", "series_dataset_observation",
        "series_observation_provenance",
    ):
        assert f"CREATE TABLE {token}" in migration
        assert f"CREATE TABLE {token}" in fresh
    assert "ALTER TABLE ordered_series" not in migration
    assert "DROP TABLE ordered_series" not in migration
    assert "DROP TABLE series_descriptor" not in migration
    assert "ON DELETE CASCADE" not in migration.split("CREATE TABLE series_provenance_revision", 1)[1].split("CREATE TABLE series_dataset_publication", 1)[0]
    # Provenance is a revisioned, immutable snapshot; readers can associate a
    # point with multiple revisions while owner-local publications have tokens.
    assert "UNIQUE(source_id, vintage_id, revision_hash)" in migration
    assert "PRIMARY KEY(dataset_id,indicator_id,territory_id,axis_value,provenance_revision_id)" in migration
    assert "reference_content_version" in migration and "published_at" in migration
    assert "comparison_point IS NOT NULL OR direction='none'" in migration
    # Existing ENAF API and legacy table publication remain available.
    assert "table_publication" not in "\n".join(line for line in migration.splitlines() if not line.lstrip().startswith("--"))
    assert "series_descriptor" in fresh and "ordered_series" in fresh
