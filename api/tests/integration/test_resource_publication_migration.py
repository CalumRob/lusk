"""#1137 — guarded rehearsal of migration 046 on a populated pre-046 schema.

Non-retained: requires the documented cleanup opt-in, creates only its own
random schemas and drops them in ``finally``. Holds the shared mutex for the
whole process. Skips before any connection when the guarded DSNs are absent.
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path

import pytest

from api.tests.integration.test_postgres_publication import (
    _aedar_guarded_configuration, _assert_aedar_server_identity)

pytestmark = pytest.mark.integration

MIGRATION = (Path(__file__).resolve().parents[2] /
             "migrations/046_resource_publication.sql")
SCHEMA = Path(__file__).resolve().parents[2] / "schema.sql"

# A faithful pre-046 shape with a real scalar descriptor and the two GLOBAL
# markers the expand phase must leave untouched. Migration 046 is purely
# additive and references no existing table by foreign key.
PRE_046 = """
CREATE TABLE table_publication (
    table_name text PRIMARY KEY,
    content_version text NOT NULL,
    row_count integer NOT NULL DEFAULT 0,
    reference_content_version text,
    published_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE scalar_descriptor (
    indicator_id text PRIMARY KEY,
    theme_id text NOT NULL, label text NOT NULL, unit text NOT NULL,
    direction text NOT NULL, allowed_levels text[] NOT NULL,
    denominator_semantics text NOT NULL, completeness text NOT NULL,
    descriptor_version text NOT NULL
);
CREATE TABLE scalar_comparison_publication (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    content_version text NOT NULL, scalar_content_version text NOT NULL,
    reference_content_version text NOT NULL,
    group_row_count integer NOT NULL, territory_row_count integer NOT NULL,
    lineage_row_count integer NOT NULL, published_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO scalar_descriptor VALUES
  ('a','demographie','A','count','high',ARRAY['commune'],'count','sparse','a-v1'),
  ('b','demographie','B','count','low',ARRAY['commune'],'count','sparse','b-v1');
INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version)
  VALUES ('scalar_observation','global-scalar-v1',2,'ref-v1');
INSERT INTO scalar_comparison_publication
  VALUES (true,'cmp-v1','global-scalar-v1','ref-v1',0,0,0,now());
"""

NEW_TABLES = ("resource_publication", "resource_publication_event",
              "scalar_resource_comparison_publication")


def _columns(connection, schema, table):
    return connection.execute("""
        SELECT column_name,data_type,is_nullable,column_default
        FROM information_schema.columns
        WHERE table_schema=%s AND table_name=%s
        ORDER BY ordinal_position""", (schema, table)).fetchall()


def test_migration_046_upgrade_preserves_every_existing_row_and_marker():
    publish_dsn, read_dsn = _aedar_guarded_configuration()
    if os.environ.get("LUSK_TEST_ALLOW_SCHEMA_CLEANUP") != "1":
        pytest.fail("migration 046 proof is non-retained; set LUSK_TEST_ALLOW_SCHEMA_CLEANUP=1")
    psycopg = pytest.importorskip("psycopg")
    upgraded = "it_m046_up_" + uuid.uuid4().hex[:12]
    fresh = "it_m046_fresh_" + uuid.uuid4().hex[:12]
    try:
        with psycopg.connect(publish_dsn, autocommit=True) as identity:
            _assert_aedar_server_identity(identity, "lusk_it_contract_pub")
        with psycopg.connect(read_dsn, autocommit=True) as identity:
            _assert_aedar_server_identity(identity, "lusk_it_contract_read")

        with psycopg.connect(publish_dsn, autocommit=True) as connection:
            connection.execute(f'CREATE SCHEMA "{upgraded}"')
            connection.execute(f'CREATE SCHEMA "{fresh}"')

            connection.execute(f'SET search_path TO "{upgraded}"')
            connection.execute(PRE_046)
            before_descriptors = connection.execute(
                "SELECT * FROM scalar_descriptor ORDER BY indicator_id").fetchall()
            before_marker = connection.execute(
                "SELECT table_name,content_version,row_count,reference_content_version "
                "FROM table_publication").fetchall()
            before_cmp = connection.execute(
                "SELECT singleton,content_version,scalar_content_version,"
                "reference_content_version FROM scalar_comparison_publication").fetchall()

            connection.execute(MIGRATION.read_text(encoding="utf-8"))

            # Every pre-existing row and BOTH global markers survive untouched.
            assert connection.execute(
                "SELECT * FROM scalar_descriptor ORDER BY indicator_id").fetchall() == before_descriptors
            assert connection.execute(
                "SELECT table_name,content_version,row_count,reference_content_version "
                "FROM table_publication").fetchall() == before_marker
            assert connection.execute(
                "SELECT singleton,content_version,scalar_content_version,"
                "reference_content_version FROM scalar_comparison_publication").fetchall() == before_cmp
            for table in NEW_TABLES:
                assert connection.execute(
                    "SELECT to_regclass(%s)", (table,)).fetchone()[0] is not None
            assert connection.execute("SELECT count(*) FROM resource_publication").fetchone()[0] == 0
            assert connection.execute("SELECT count(*) FROM resource_publication_event").fetchone()[0] == 0

            # Replay is a structural no-op (no rows, no error).
            connection.execute(MIGRATION.read_text(encoding="utf-8"))
            assert connection.execute("SELECT count(*) FROM resource_publication_event").fetchone()[0] == 0

            # Receipts are append-only: assert BEHAVIOUR. The test publisher role
            # OWNS the schema it creates, so it holds every privilege including
            # UPDATE/DELETE/TRUNCATE by ownership — grants cannot prove anything
            # here. The BEFORE triggers are the real protection.
            connection.execute(
                "INSERT INTO resource_publication_event(resource_id,shape,operation,"
                "new_content_version) VALUES ('a','scalar','apply','v1')")
            assert connection.execute(
                "SELECT new_content_version FROM resource_publication_event").fetchone()[0] == "v1"
            for forbidden in (
                "UPDATE resource_publication_event SET new_content_version='v2'",
                "DELETE FROM resource_publication_event",
                "TRUNCATE resource_publication_event",
            ):
                with pytest.raises(Exception):
                    connection.execute(forbidden)
            # INSERT and SELECT still work after the three refusals.
            connection.execute(
                "INSERT INTO resource_publication_event(resource_id,shape,operation,"
                "new_content_version) VALUES ('b','scalar','apply','v2')")
            assert connection.execute(
                "SELECT count(*) FROM resource_publication_event").fetchone()[0] == 2

            # Fresh-install parity for the three new relations.
            connection.execute(f'SET search_path TO "{fresh}"')
            connection.execute(SCHEMA.read_text(encoding="utf-8"))
            for table in NEW_TABLES:
                assert _columns(connection, upgraded, table) == _columns(connection, fresh, table)

            # Grant model for the NAMED serving roles is a static contract of
            # migration 046 and schema.sql (the test owner role is exempt — see
            # the behavioural proof above). The named roles are not provisioned
            # in this disposable test database, so assert the DDL text instead.
            for ddl in (MIGRATION.read_text(encoding="utf-8"),
                        SCHEMA.read_text(encoding="utf-8")):
                assert "GRANT SELECT, INSERT ON resource_publication_event TO lusk_publisher;" in ddl
                assert "REVOKE UPDATE, DELETE, TRUNCATE ON resource_publication_event FROM lusk_publisher;" in ddl
                assert "GRANT SELECT ON resource_publication, resource_publication_event," in ddl
    finally:
        with psycopg.connect(publish_dsn, autocommit=True) as cleanup:
            for schema in (upgraded, fresh):
                cleanup.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
