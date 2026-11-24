"""Fast (DB-free) contract for migration 047 / schema.sql parity (#1138, ADR-0049 step 2).

Migration 047 is the additive counterpart of 046 for the declared-profile
shape: a per-resource profile comparison marker that coexists with the global
``profile_comparison_publication`` singleton during the expand phase.  It
publishes no resource on its own and changes no existing row or marker.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
M047 = ROOT / "api/migrations/047_profile_resource_comparison.sql"
SCHEMA = ROOT / "api/schema.sql"

TABLE = "profile_resource_comparison_publication"


def _m047():
    return M047.read_text(encoding="utf-8")


def _block(text, table):
    """Return the CREATE TABLE body for `table` from a SQL script."""
    prefix = "CREATE TABLE IF NOT EXISTS " if "IF NOT EXISTS " + table in text else "CREATE TABLE "
    start = text.index(prefix + table)
    end = text.index(");", start) + 2
    return text[start:end]


def test_migration_047_owns_its_transaction():
    m = _m047()
    assert m.lstrip().startswith("BEGIN;")
    assert m.rstrip().endswith("COMMIT;")
    assert "WITHOUT --single-transaction" in m
    assert "ON_ERROR_STOP" in m


def test_migration_047_is_purely_additive():
    m = _m047()
    assert "DROP TABLE" not in m
    assert "ALTER TABLE" not in m
    assert "DELETE FROM" not in m
    code = "\n".join(line for line in m.splitlines() if not line.lstrip().startswith("--"))
    for stmt in ("CREATE TABLE profile_comparison_publication",
                 "INSERT INTO table_publication", "UPDATE table_publication",
                 "DELETE FROM table_publication"):
        assert stmt not in code


def test_migration_047_per_resource_profile_comparison_marker():
    body = _block(_m047(), TABLE)
    assert "indicator_id text PRIMARY KEY CHECK (indicator_id ~ '^[a-z][a-z0-9_]{0,95}$')" in body
    for col in ("content_version", "profile_content_version",
                "reference_content_version", "group_row_count",
                "territory_row_count", "lineage_row_count", "published_at"):
        assert col in body
    for check in ("group_row_count >= 0", "territory_row_count >= 0", "lineage_row_count >= 0"):
        assert check in body


def test_migration_047_grants_follow_046():
    m = _m047()
    assert f"GRANT SELECT ON {TABLE} TO lusk_reader;" in m
    assert f"GRANT SELECT, INSERT, UPDATE, DELETE ON {TABLE} TO lusk_publisher;" in m


def test_schema_sql_matches_migration_047_contract():
    m, s = _m047(), SCHEMA.read_text(encoding="utf-8")
    m_body = _block(m, TABLE)
    s_body = _block(s, TABLE).replace("CREATE TABLE " + TABLE,
                                      "CREATE TABLE IF NOT EXISTS " + TABLE, 1)
    assert m_body == s_body, f"schema.sql drift for {TABLE}"
    for grant in (
        f"GRANT SELECT ON {TABLE} TO lusk_reader;",
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON {TABLE} TO lusk_publisher;",
    ):
        assert grant in s
