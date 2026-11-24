"""#1042 — fast contract for the additive littoral comparison-context migration.

The guarded PostgreSQL rehearsal (separate, opt-in) proves old publication rows
survive and the migrated structure equals a fresh install. These checks pin the
next free migration number, the exact five widened CHECKs, and that no
historical migration was silently rewritten.
"""

from __future__ import annotations

import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
API = ROOT / "api"
SCHEMA = API / "schema.sql"
MIGRATIONS = API / "migrations"
MIGRATION = MIGRATIONS / "044_littoral_comparison_contexts.sql"

OLD_IN = "'density_class','epci','bretagne','same_level'"
NEW_IN = "'density_class','epci','bretagne','same_level','littoral'"
WIDENED_TABLES = (
    "scalar_comparison_group",
    "comparison_source_lineage",
    "profile_comparison_group",
    "ordered_series_comparison_group",
    "observed_collection_comparison_group",
)


def test_044_045_046_047_are_the_pinned_migration_numbers():
    numbers = sorted(int(path.name.split("_", 1)[0])
                     for path in MIGRATIONS.glob("[0-9]*.sql"))
    assert 43 in numbers
    assert 44 in numbers, "the littoral comparison migration must be 044"
    assert 45 in numbers, "the AEDAR littoral sibling migration must be 045"
    assert 46 in numbers, "the per-resource publication migration must be 046 (#1137)"
    assert 47 in numbers, "the per-resource profile comparison migration must be 047 (#1138)"
    assert not any(number > 47 for number in numbers), numbers


def test_schema_and_migration_widen_the_same_five_context_checks():
    schema = SCHEMA.read_text(encoding="utf-8")
    migration = MIGRATION.read_text(encoding="utf-8")

    assert schema.count(NEW_IN) == len(WIDENED_TABLES)
    old_domain_check = re.compile(
        r"comparison_context IN \('density_class','epci','bretagne','same_level'\)")
    assert not old_domain_check.search(schema), "a group-context CHECK was left at the old domain"
    for table in WIDENED_TABLES:
        assert table in migration, f"migration 044 does not widen {table}"
    # Inside the DO block the list is an SQL string literal, so quotes double.
    assert NEW_IN in migration or NEW_IN.replace("'", "''") in migration
    assert "littoral" in migration


def test_migration_is_additive_and_does_not_rewrite_history():
    migration = MIGRATION.read_text(encoding="utf-8")
    normalized = "".join(migration.split()).upper()
    assert "BEGIN;" in normalized and "COMMIT;" in normalized
    for destructive in ("DROPTABLE", "DROPCOLUMN", "TRUNCATETABLE", "ALTERTYPE", "DELETEFROM"):
        assert destructive not in normalized, f"migration 044 is not additive: {destructive}"
    # It locates the exact existing CHECK definition through the catalog and
    # replaces only that constraint, so it works on named or auto-named checks.
    assert "pg_constraint" in migration
    assert "pg_get_constraintdef" in migration
    assert "ADD CONSTRAINT" in migration

    # 039 keeps its exact pre-044 four-value expected definitions and accepts
    # the post-044 form only through one documented, proof-backed normaliser.
    # It is not silently rewritten to expect the widened domain.
    m039 = (MIGRATIONS / "039_comparison_base_objects.sql").read_text(encoding="utf-8")
    assert "m039_normalize_context" in m039
    assert ("'density_class'::text, 'epci'::text, 'bretagne'::text, 'same_level'::text"
            in m039)
    assert "''littoral''::text" in m039  # escaped inside the SQL string literal
    assert "039" in migration or "after" in migration.lower()


def _context_check_expression(schema: str) -> str:
    match = re.search(
        r"comparison_context text NOT NULL CHECK\s*\(\s*comparison_context IN \(([^)]*)\)\s*\)",
        schema,
        flags=re.IGNORECASE,
    )
    assert match, "the widened group-context CHECK must be declared"
    return match.group(1)


def test_widened_context_domain_accepts_littoral_and_old_generations():
    expression = _context_check_expression(SCHEMA.read_text(encoding="utf-8"))
    connection = sqlite3.connect(":memory:")
    connection.execute(
        f"CREATE TABLE g (comparison_context text NOT NULL CHECK (comparison_context IN ({expression})), "
        "group_id text NOT NULL, value real)"
    )
    # Old published generations stay readable and writable under the widened
    # domain; the two littoral cohorts are admitted with no rankless exception.
    for context, group in (("density_class", "1"), ("epci", "e1"), ("bretagne", "53"),
                           ("same_level", "53"), ("littoral", "C"), ("littoral", "NC")):
        connection.execute("INSERT INTO g VALUES (?,?,?)", (context, group, 1.0))
    assert connection.execute("SELECT count(*) FROM g").fetchone()[0] == 6
    try:
        connection.execute("INSERT INTO g VALUES ('unknown','C',1.0)")
    except sqlite3.IntegrityError:
        pass
    else:
        raise AssertionError("an undeclared comparison context was accepted")
