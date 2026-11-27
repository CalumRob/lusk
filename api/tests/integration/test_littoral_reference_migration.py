"""#1041 — guarded rehearsal of migration 043 on the shared territory reference.

The proof is non-retained: it requires the documented cleanup opt-in, creates
only its own random schemas, and always drops them in ``finally``. It holds
``Local\\LuskIntegrationContractDb`` for the whole process, so it never runs
while another worker's focused proof owns the operator test database.
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path

import pytest

from api.tests.integration.test_postgres_publication import (
    _aedar_guarded_configuration, _assert_aedar_server_identity)

pytestmark = pytest.mark.integration

PRE_043_REFERENCE = """
CREATE TABLE territory_reference (
    territory_id text PRIMARY KEY,
    territory_type text NOT NULL,
    name text NOT NULL,
    department_id text,
    epci_id text,
    density_class_code text,
    density_class_label text
);
CREATE TABLE table_publication (
    table_name text PRIMARY KEY,
    content_version text NOT NULL,
    row_count integer NOT NULL DEFAULT 0,
    reference_content_version text,
    published_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO territory_reference VALUES
  ('22001','commune','Commune A','22','200000001','1','Grands centres urbains'),
  ('22','departement','Côtes-d''Armor','22',NULL,NULL,NULL);
INSERT INTO table_publication(table_name,content_version,row_count)
  VALUES ('territory_reference','reference-before-043',2);
"""

MIGRATION = (Path(__file__).resolve().parents[2] /
             "migrations/043_littoral_territory_reference.sql")
SCHEMA = Path(__file__).resolve().parents[2] / "schema.sql"


def _columns(connection, schema):
    return connection.execute("""
        SELECT column_name,data_type,is_nullable,column_default
        FROM information_schema.columns
        WHERE table_schema=%s AND table_name='territory_reference'
        ORDER BY ordinal_position""", (schema,)).fetchall()


def _constraint(connection, schema):
    return connection.execute("""
        SELECT pg_get_constraintdef(c.oid)
        FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
        JOIN pg_namespace n ON n.oid=r.relnamespace
        WHERE n.nspname=%s AND r.relname='territory_reference'
          AND c.conname='territory_reference_littoral_scope_check'""",
        (schema,)).fetchone()


def test_migration_043_is_additive_and_matches_a_fresh_install():
    # Ordinary collection without the guarded DSNs skips before any env check.
    publish_dsn, read_dsn = _aedar_guarded_configuration()
    if os.environ.get("LUSK_TEST_ALLOW_SCHEMA_CLEANUP") != "1":
        pytest.fail("the littoral migration proof is non-retained; set LUSK_TEST_ALLOW_SCHEMA_CLEANUP=1")
    psycopg = pytest.importorskip("psycopg")
    verified = False
    upgraded = "it_littoral_mig_" + uuid.uuid4().hex[:12]
    fresh = "it_littoral_fresh_" + uuid.uuid4().hex[:12]
    try:
        # Verify BOTH dedicated roles and the exact test database BEFORE any
        # DDL. A wrong target must never see CREATE/DROP from this proof.
        with psycopg.connect(publish_dsn, autocommit=True) as identity:
            _assert_aedar_server_identity(identity, "lusk_it_contract_pub")
        with psycopg.connect(read_dsn, autocommit=True) as identity:
            _assert_aedar_server_identity(identity, "lusk_it_contract_read")
        verified = True

        with psycopg.connect(publish_dsn, autocommit=True) as connection:
            connection.execute(f'CREATE SCHEMA "{upgraded}"')
            connection.execute(f'CREATE SCHEMA "{fresh}"')

            connection.execute(f'SET search_path TO "{upgraded}"')
            connection.execute(PRE_043_REFERENCE)
            connection.execute(MIGRATION.read_text(encoding="utf-8"))

            # Existing facts and the publication marker survive the additive
            # DDL untouched; the new columns are explicitly NULL.
            assert connection.execute("""
                SELECT territory_id,territory_type,name,department_id,epci_id,
                       density_class_code,density_class_label,
                       littoral_code,littoral_classement_source
                FROM territory_reference ORDER BY territory_id""").fetchall() == [
                ("22", "departement", "Côtes-d'Armor", "22", None, None, None, None, None),
                ("22001", "commune", "Commune A", "22", "200000001",
                 "1", "Grands centres urbains", None, None),
            ]
            assert connection.execute("""
                SELECT content_version,row_count FROM table_publication
                WHERE table_name='territory_reference'""").fetchone() == (
                    "reference-before-043", 2)

            connection.execute(f'SET search_path TO "{fresh}"')
            connection.execute(SCHEMA.read_text(encoding="utf-8"))

            assert _columns(connection, upgraded) == _columns(connection, fresh)
            upgraded_constraint = _constraint(connection, upgraded)
            assert upgraded_constraint == _constraint(connection, fresh)
            assert upgraded_constraint is not None

            # The closed domain: valid rows insert; invalid rows fail closed.
            connection.execute(f'SET search_path TO "{upgraded}"')
            valid = [
                ("29083", "commune", "Île-de-Sein", "29", None, "C", "Mer"),
                ("29209", "commune", "Plouvien", "29", None, "NC", None),
            ]
            for row in valid:
                connection.execute(
                    "INSERT INTO territory_reference(territory_id,territory_type,name,"
                    "department_id,epci_id,littoral_code,littoral_classement_source) "
                    "VALUES (%s,%s,%s,%s,%s,%s,%s)", row)
            invalid = [
                ("1", "commune", "C", None),
                ("2", "commune", "C", "Lac"),
                ("3", "commune", "NC", "Mer"),
                ("4", "commune", "X", None),
                ("5", "epci", "C", "Mer"),
            ]
            for code, kind, littoral, classement in invalid:
                with pytest.raises(psycopg.errors.CheckViolation):
                    connection.execute(
                        "INSERT INTO territory_reference(territory_id,territory_type,"
                        "name,littoral_code,littoral_classement_source) "
                        "VALUES (%s,%s,%s,%s,%s)",
                        (f"bad-{code}", kind, "Bad", littoral, classement))
    finally:
        if verified:
            with psycopg.connect(publish_dsn, autocommit=True) as connection:
                for schema in (upgraded, fresh):
                    connection.execute(
                        f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
