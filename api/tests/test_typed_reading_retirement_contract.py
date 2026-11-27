"""DB-free contract for migration 049: retire typed readings/global clocks (#1141)."""

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "api/migrations/049_retire_typed_readings.sql"
SCHEMA = ROOT / "api/schema.sql"

TYPED_TABLES = (
    "demographic_reading_descriptor",
    "demographic_typed_reading",
    "selected_reading_publication",
    "selected_reading_descriptor",
    "habitat_typed_reading",
    "economy_activity_evidence",
    "economy_typed_reading",
    "milieux_reading_source",
    "milieux_reading_absence",
    "milieux_typed_reading",
    "milieux_population_provenance_revision",
)
RETIRED_MARKERS = (
    "scalar_observation",
    "declared_profile",
    "demographic_typed_reading",
    "selected_reading",
    "economy_typed_reading",
    "economy_activity_evidence",
    "milieux_typed_reading",
    "milieux_reading_absence",
)
GLOBAL_SINGLETONS = ("scalar_comparison_publication", "profile_comparison_publication")
RETAINED_MARKERS = (
    "territory_reference",
    "ordered_series",
    "aedar_territorial_aggregate",
    "aedar_territory_summary",
)


def _migration() -> str:
    return MIGRATION.read_text(encoding="utf-8")


def _schema() -> str:
    return SCHEMA.read_text(encoding="utf-8")


def _code(text: str) -> str:
    return "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("--"))


def test_migration_049_owns_one_atomic_restrict_transaction():
    code = _code(_migration())
    assert code.lstrip().startswith("BEGIN;")
    assert code.rstrip().endswith("COMMIT;")
    assert "ON_ERROR_STOP" in _migration()
    assert "WITHOUT --single-transaction" in _migration()
    assert not re.search(r"\bCASCADE\b", code)


def test_migration_049_drops_exact_typed_tables_and_global_singletons():
    code = _code(_migration())
    for table in (*TYPED_TABLES, *GLOBAL_SINGLETONS):
        assert f"DROP TABLE IF EXISTS {table}" in code
    # The scalar/profile FACT tables survive; only their global clocks retire.
    assert "DROP TABLE IF EXISTS scalar_observation;" not in code
    assert "DROP TABLE IF EXISTS profile_observation;" not in code
    assert "DROP FUNCTION IF EXISTS reject_milieux_population_provenance_mutation" in code


def test_migration_049_deletes_only_retired_table_publication_markers():
    code = _code(_migration())
    match = re.search(r"DELETE FROM table_publication WHERE table_name IN \((.*?)\);", code, re.S)
    assert match is not None
    deleted = set(re.findall(r"'([a-z_]+)'", match.group(1)))
    assert deleted == set(RETIRED_MARKERS)
    assert "DROP TABLE IF EXISTS table_publication" not in code


def test_schema_sql_has_no_typed_tables_or_global_comparison_singletons():
    schema = _schema()
    for table in (*TYPED_TABLES, *GLOBAL_SINGLETONS):
        assert f"CREATE TABLE {table}" not in schema
    publication = schema[schema.index("CREATE TABLE table_publication"):schema.index(");", schema.index("CREATE TABLE table_publication"))]
    for marker in RETIRED_MARKERS:
        assert f"'{marker}'" not in publication
    assert "CREATE TABLE scalar_observation (" in schema
    assert "CREATE TABLE profile_observation (" in schema


def test_production_api_and_producer_grammar_have_no_typed_reading_registration():
    for path in (ROOT / "api").glob("*.py"):
        source = path.read_text(encoding="utf-8")
        assert "typed_reading" not in source, path
        assert "selected_reading" not in source, path
    for path in (ROOT / "pipeline/inst/extdata/theme-metadata").glob("theme_*.json"):
        source = path.read_text(encoding="utf-8")
        assert "typed_reading" not in source, path
        assert "selected_reading" not in source, path


def test_table_publication_checks_are_narrowed_identically_in_schema_and_migration():
    schema = re.sub(r"\s+", " ", _schema())
    migration = re.sub(r"\s+", " ", _code(_migration()))
    schema = re.sub(r"\s*([(),])\s*", r"\1", schema)
    migration = re.sub(r"\s*([(),])\s*", r"\1", migration)
    allowed = "'territory_reference','ordered_series','aedar_territorial_aggregate','aedar_territory_summary'"
    assert f"CHECK(table_name IN({allowed}))" in schema
    assert f"CHECK(table_name IN({allowed}))" in migration
    required_reference = "'ordered_series','aedar_territorial_aggregate','aedar_territory_summary'"
    assert f"CHECK(table_name NOT IN({required_reference})OR reference_content_version IS NOT NULL)" in schema
    assert f"CHECK(table_name NOT IN({required_reference})OR reference_content_version IS NOT NULL)" in migration
    assert set(RETAINED_MARKERS) == {
        "territory_reference", "ordered_series", "aedar_territorial_aggregate", "aedar_territory_summary"
    }
