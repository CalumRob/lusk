"""#1041 — littoral classification on the canonical territory reference.

Fast contract checks: the additive migration and the fresh schema declare the
same closed domain, existing rows survive with NULL, and the producer/app
sides name the same fields. The guarded PostgreSQL rehearsal is separate.
"""

from __future__ import annotations

import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
API = ROOT / "api"
MIGRATION = API / "migrations/043_littoral_territory_reference.sql"
SCHEMA = API / "schema.sql"
PROJECTOR = ROOT / "pipeline/R/publish_territory_reference.R"
PRODUCER = ROOT / "pipeline/R/classes_littoral.R"
APP_TYPES = ROOT / "app/src/payload/types.ts"
APP_VALIDATE = ROOT / "app/src/payload/validate.ts"


def _constraint_expression(sql: str) -> str:
    match = re.search(
        r"territory_reference_littoral_scope_check\s+CHECK\s*\(",
        sql,
        flags=re.IGNORECASE,
    )
    assert match, "the littoral reference constraint must be declared"
    depth = 0
    for index in range(match.end() - 1, len(sql)):
        if sql[index] == "(":
            depth += 1
        elif sql[index] == ")":
            depth -= 1
            if depth == 0:
                return sql[match.end():index]
    raise AssertionError("unbalanced littoral reference CHECK expression")


def _normalized(expression: str) -> str:
    return "".join(expression.split()).lower()


def test_migration_is_additive_and_matches_the_fresh_schema_domain():
    migration = MIGRATION.read_text(encoding="utf-8")
    schema = SCHEMA.read_text(encoding="utf-8")

    for column in ("littoral_code", "littoral_classement_source"):
        assert f"ADD COLUMN {column}" in migration
        assert column in schema

    # Additive only: no destructive DDL, no rewrite of existing columns, and
    # the existing reference contract is untouched.
    normalized = "".join(migration.split()).upper()
    assert "DROPTABLE" not in normalized
    assert "DROPCOLUMN" not in normalized
    assert "ALTERTYPE" not in normalized
    for existing in ("density_class_code", "density_class_label", "epci_id"):
        assert f"DROP{existing.upper()}" not in normalized

    assert "ALTER TABLE territory_reference" in migration
    assert _normalized(_constraint_expression(migration)) == _normalized(
        _constraint_expression(schema)
    )


def _sqlite_reference() -> sqlite3.Connection:
    connection = sqlite3.connect(":memory:")
    expression = _constraint_expression(SCHEMA.read_text(encoding="utf-8"))
    expression = " ".join(expression.split())
    # SQLite accepts the same closed CHECK shape (IN / IS NULL / boolean OR).
    connection.execute(
        "CREATE TABLE territory_reference ("
        "territory_id text PRIMARY KEY, territory_type text NOT NULL,"
        "littoral_code text, littoral_classement_source text,"
        f"CONSTRAINT territory_reference_littoral_scope_check CHECK ({expression}))"
    )
    return connection


def test_littoral_domain_is_closed_and_non_communes_stay_unclassified():
    connection = _sqlite_reference()
    valid = [
        ("53", "region", None, None),
        ("200000001", "epci", None, None),
        ("22001", "commune", "C", "Mer"),
        ("56086", "commune", "C", "Estuaire"),
        ("29209", "commune", "NC", None),
    ]
    for row in valid:
        connection.execute(
            "INSERT INTO territory_reference VALUES (?,?,?,?)", row
        )

    invalid = [
        # a non-commune can never carry the classification
        ("22", "departement", "C", "Mer"),
        ("200000002", "epci", "NC", None),
        # C must carry the source classement, and only Mer/Estuaire exists
        ("22002", "commune", "C", None),
        ("22003", "commune", "C", "Lac"),
        # NC must not invent a source classement
        ("22004", "commune", "NC", "Mer"),
        # an arbitrary code is not a classification
        ("22005", "commune", "X", None),
        # a classement without a code is incomplete provenance
        ("22006", "commune", None, "Mer"),
    ]
    for row in invalid:
        try:
            connection.execute(
                "INSERT INTO territory_reference VALUES (?,?,?,?)", row
            )
        except sqlite3.IntegrityError:
            continue
        raise AssertionError(f"invalid littoral reference row accepted: {row}")


def test_producer_and_app_share_the_same_reference_fields():
    projector = PROJECTOR.read_text(encoding="utf-8")
    producer = PRODUCER.read_text(encoding="utf-8")
    app_types = APP_TYPES.read_text(encoding="utf-8")
    app_validate = APP_VALIDATE.read_text(encoding="utf-8")

    for source in (projector, producer, app_types, app_validate):
        assert "littoral_code" in source
        assert "littoral_classement_source" in source

    # The PostgreSQL writer names both columns and never writes a partial row.
    for column in ("littoral_code", "littoral_classement_source"):
        assert f",{column}" in projector
        assert f"{column}=EXCLUDED.{column}" in projector

    # The producer owns the closed domain and the source classements.
    assert '"C", "NC"' in producer
    assert '"Mer", "Estuaire"' in producer
    # The app validates the same closed domain, never derives it.
    assert "'C'" in app_validate and "'NC'" in app_validate
    assert "Mer" in app_validate and "Estuaire" in app_validate
