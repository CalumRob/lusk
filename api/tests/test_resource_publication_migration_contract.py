"""Fast (DB-free) contract for migration 046 / schema.sql parity (#1137, ADR-0049 step 2)."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
M046 = ROOT / "api/migrations/046_resource_publication.sql"
SCHEMA = ROOT / "api/schema.sql"


def _m046():
    return M046.read_text(encoding="utf-8")


def _block(text, table):
    """Return the CREATE TABLE body for `table` from a SQL script."""
    start = text.index("CREATE TABLE" + (" IF NOT EXISTS" if "IF NOT EXISTS " + table in text else "") + " " + table)
    end = text.index(");", start) + 2
    return text[start:end]


def test_migration_046_owns_its_transaction():
    m = _m046()
    assert m.lstrip().startswith("BEGIN;")
    assert m.rstrip().endswith("COMMIT;")
    # Operator applies with psql --set ON_ERROR_STOP=on and WITHOUT the
    # --single-transaction flag (the file owns BEGIN/COMMIT itself).
    assert "WITHOUT --single-transaction" in m
    assert "ON_ERROR_STOP" in m


def test_migration_046_is_purely_additive():
    m = _m046()
    # Expand phase: global markers stay, nothing is dropped or rewritten.
    assert "DROP TABLE" not in m
    assert "ALTER TABLE" not in m
    assert "DELETE FROM" not in m
    # No data UPDATE of any serving table; the only "UPDATE" token is the
    # append-only trigger's event clause and the REVOKE of the UPDATE grant.
    assert "UPDATE resource_publication" not in m.replace(
        "REVOKE UPDATE, DELETE, TRUNCATE ON resource_publication_event", "")
    assert "\nUPDATE " not in m
    for table in ("resource_publication", "resource_publication_event",
                  "scalar_resource_comparison_publication"):
        assert f"CREATE TABLE IF NOT EXISTS {table}" in m
    # The current API's global markers are not touched by this migration
    # (the only mention of them is in the explanatory comment).
    code = "\n".join(line for line in m.splitlines() if not line.lstrip().startswith("--"))
    for stmt in ("CREATE TABLE scalar_comparison_publication",
                 "ALTER TABLE table_publication", "INSERT INTO table_publication",
                 "DELETE FROM table_publication", "UPDATE table_publication"):
        assert stmt not in code


def test_migration_046_registry_contract():
    body = _block(_m046(), "resource_publication")
    for col in ("resource_id text PRIMARY KEY", "shape text NOT NULL",
                "content_version text NOT NULL", "reference_content_version text",
                "published_at timestamptz", "retired boolean"):
        assert col in body
    for shape in ("scalar", "declared_profile", "owned_series",
                  "observed_collection", "aedar"):
        assert f"'{shape}'" in body


def test_migration_046_receipt_is_append_only():
    m = _m046()
    body = _block(m, "resource_publication_event")
    for col in ("event_id", "resource_id", "shape", "operation",
                "old_content_version", "new_content_version", "commit_sha",
                "recorded_at", "confirmed_definition", "lineage_digests"):
        assert col in body
    for operation in ("apply", "retire", "adopt"):
        assert f"'{operation}'" in body
    # Receipts: INSERT/SELECT only, no UPDATE / DELETE / TRUNCATE grant, and a
    # trigger enforces append-only regardless of role.
    assert "GRANT SELECT, INSERT ON resource_publication_event TO lusk_publisher;" in m
    assert "REVOKE UPDATE, DELETE, TRUNCATE ON resource_publication_event FROM lusk_publisher;" in m
    assert "BEFORE UPDATE OR DELETE ON resource_publication_event" in m
    assert "BEFORE TRUNCATE ON resource_publication_event" in m
    assert "resource_publication_event is append-only" in m


def test_migration_046_per_resource_scalar_comparison_marker():
    body = _block(_m046(), "scalar_resource_comparison_publication")
    assert "indicator_id text PRIMARY KEY REFERENCES scalar_descriptor(indicator_id)" in body
    for col in ("content_version", "scalar_content_version",
                "reference_content_version", "group_row_count",
                "territory_row_count", "lineage_row_count"):
        assert col in body


def test_schema_sql_matches_migrated_contract():
    m, s = _m046(), SCHEMA.read_text(encoding="utf-8")
    # Same table bodies for a fresh install (schema.sql uses plain CREATE TABLE).
    for table in ("resource_publication", "resource_publication_event",
                  "scalar_resource_comparison_publication"):
        m_body = _block(m, table)
        s_body = _block(s, table).replace("CREATE TABLE " + table,
                                           "CREATE TABLE IF NOT EXISTS " + table, 1)
        assert m_body == s_body, f"schema.sql drift for {table}"
    for grant in (
        "GRANT SELECT, INSERT ON resource_publication_event TO lusk_publisher;",
        "REVOKE UPDATE, DELETE, TRUNCATE ON resource_publication_event FROM lusk_publisher;",
    ):
        assert grant in s
