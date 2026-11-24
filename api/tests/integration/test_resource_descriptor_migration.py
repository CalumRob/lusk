"""#1140 — guarded additive migration 048 rehearsal on a populated registry.

Non-retained: exact lusk_it_contract identities, shared mutex, own random schemas
and cleanup in finally. Skips before any connection without guarded DSNs.
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path

import pytest

from api.tests.integration.test_postgres_publication import (
    _aedar_guarded_configuration, _assert_aedar_server_identity)
from api.tests.integration.test_selected_profile_mean_http import (
    _acquire_mutex, _release_mutex)

pytestmark = pytest.mark.integration

MIGRATION = (Path(__file__).resolve().parents[2] /
             "migrations/048_resource_publication_descriptor.sql")
SCHEMA = Path(__file__).resolve().parents[2] / "schema.sql"

PRE_048 = """
CREATE TABLE resource_publication (
    resource_id text PRIMARY KEY,
    shape text NOT NULL,
    content_version text NOT NULL,
    reference_content_version text,
    published_at timestamptz NOT NULL DEFAULT now(),
    retired boolean NOT NULL DEFAULT false
);
CREATE TABLE table_publication (
    table_name text PRIMARY KEY,
    content_version text NOT NULL,
    row_count integer NOT NULL DEFAULT 0,
    reference_content_version text,
    published_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO resource_publication(resource_id,shape,content_version,reference_content_version)
  VALUES ('resource_a','scalar','a-v1','ref-v1');
INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version)
  VALUES ('scalar_observation','global-v1',2,'ref-v1');
"""


def _columns(connection, schema, table):
    return connection.execute("""
        SELECT column_name,data_type,is_nullable,column_default
        FROM information_schema.columns
        WHERE table_schema=%s AND table_name=%s
        ORDER BY ordinal_position""", (schema, table)).fetchall()


def test_migration_048_preserves_registry_and_global_markers_and_matches_fresh_schema():
    publish_dsn, read_dsn = _aedar_guarded_configuration()
    if os.environ.get("LUSK_TEST_ALLOW_SCHEMA_CLEANUP") != "1":
        pytest.fail("migration 048 proof is non-retained; set LUSK_TEST_ALLOW_SCHEMA_CLEANUP=1")
    psycopg = pytest.importorskip("psycopg")
    mutex = _acquire_mutex()
    upgraded = "it_m048_up_" + uuid.uuid4().hex[:12]
    fresh = "it_m048_fresh_" + uuid.uuid4().hex[:12]
    try:
        with psycopg.connect(publish_dsn, autocommit=True) as identity:
            _assert_aedar_server_identity(identity, "lusk_it_contract_pub")
        with psycopg.connect(read_dsn, autocommit=True) as identity:
            _assert_aedar_server_identity(identity, "lusk_it_contract_read")

        with psycopg.connect(publish_dsn, autocommit=True) as connection:
            connection.execute(f'CREATE SCHEMA "{upgraded}"')
            connection.execute(f'CREATE SCHEMA "{fresh}"')
            connection.execute(f'SET search_path TO "{upgraded}"')
            connection.execute(PRE_048)
            before_registry = connection.execute(
                "SELECT * FROM resource_publication").fetchall()
            before_global = connection.execute(
                "SELECT * FROM table_publication").fetchall()

            connection.execute(MIGRATION.read_text(encoding="utf-8"))

            assert connection.execute(
                "SELECT * FROM resource_publication").fetchall() == before_registry
            assert connection.execute(
                "SELECT * FROM table_publication").fetchall() == before_global
            connection.execute("""INSERT INTO resource_publication_descriptor(
                resource_id,publication_resource_id,content_version,descriptor)
                VALUES ('resource_a','resource_a','a-v1','{"kind":"indicator"}'::jsonb)""")
            assert connection.execute("""SELECT jsonb_typeof(descriptor)
                FROM resource_publication_descriptor""").fetchone()[0] == "object"
            with pytest.raises(Exception):
                connection.execute("""INSERT INTO resource_publication_descriptor(
                    resource_id,publication_resource_id,content_version,descriptor)
                    VALUES ('resource_b','resource_a','a-v1','[]'::jsonb)""")
            with pytest.raises(Exception):
                connection.execute("""INSERT INTO resource_publication_descriptor(
                    resource_id,publication_resource_id,content_version,descriptor)
                    VALUES ('resource_b','missing_resource','a-v1','{}'::jsonb)""")

            connection.execute(MIGRATION.read_text(encoding="utf-8"))
            assert connection.execute(
                "SELECT count(*) FROM resource_publication_descriptor").fetchone()[0] == 1

            connection.execute(f'SET search_path TO "{fresh}"')
            connection.execute(SCHEMA.read_text(encoding="utf-8"))
            table = "resource_publication_descriptor"
            assert _columns(connection, upgraded, table) == _columns(connection, fresh, table)
            for schema in (upgraded, fresh):
                assert connection.execute("""SELECT indexname FROM pg_indexes
                    WHERE schemaname=%s AND tablename=%s ORDER BY indexname""", (schema, table)).fetchall() == [
                        ("resource_publication_descriptor_live_idx",),
                        ("resource_publication_descriptor_pkey",),
                    ]
    finally:
        with psycopg.connect(publish_dsn, autocommit=True) as cleanup:
            for schema in (upgraded, fresh):
                cleanup.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        _release_mutex(mutex)
