"""Fast contract for additive migration 048 and fresh-schema parity (#1140)."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "api/migrations/048_resource_publication_descriptor.sql"
SCHEMA = ROOT / "api/schema.sql"
TABLE = "resource_publication_descriptor"


def _block(text):
    prefix = "CREATE TABLE IF NOT EXISTS " if f"CREATE TABLE IF NOT EXISTS {TABLE}" in text else "CREATE TABLE "
    start = text.index(prefix + TABLE)
    return text[start:text.index(");", start) + 2]


def test_migration_048_is_additive_and_owns_its_transaction():
    migration = MIGRATION.read_text(encoding="utf-8")
    assert migration.lstrip().startswith("BEGIN;")
    assert migration.rstrip().endswith("COMMIT;")
    assert "WITHOUT --single-transaction" in migration
    assert "ON_ERROR_STOP" in migration
    assert "DROP TABLE" not in migration
    assert "ALTER TABLE" not in migration
    assert "DELETE FROM" not in migration
    assert "UPDATE resource_publication" not in migration


def test_descriptor_is_bound_to_one_publication_resource_and_version():
    body = _block(MIGRATION.read_text(encoding="utf-8"))
    for fragment in (
        "resource_id text PRIMARY KEY",
        "publication_resource_id text NOT NULL",
        "content_version text NOT NULL",
        "descriptor jsonb NOT NULL",
        "jsonb_typeof(descriptor) = 'object'",
        "FOREIGN KEY (publication_resource_id) REFERENCES resource_publication(resource_id)",
        "ON DELETE CASCADE",
    ):
        assert fragment in body


def test_reader_can_select_but_not_mutate_discovery_descriptors():
    migration = MIGRATION.read_text(encoding="utf-8")
    assert "GRANT SELECT ON resource_publication_descriptor TO lusk_reader;" in migration
    assert "GRANT SELECT, INSERT, UPDATE, DELETE ON resource_publication_descriptor TO lusk_publisher;" in migration
    assert "REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON resource_publication_descriptor FROM lusk_reader;" in migration


def test_fresh_schema_matches_migration_048():
    migrated = _block(MIGRATION.read_text(encoding="utf-8"))
    fresh = _block(SCHEMA.read_text(encoding="utf-8")).replace(
        f"CREATE TABLE {TABLE}", f"CREATE TABLE IF NOT EXISTS {TABLE}", 1)
    assert migrated == fresh
    schema = SCHEMA.read_text(encoding="utf-8")
    assert "CREATE INDEX resource_publication_descriptor_live_idx" in schema
    assert "GRANT SELECT ON resource_publication_descriptor TO lusk_reader;" in schema
