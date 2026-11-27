"""#1138 — guarded rehearsal of migration 047 on a populated pre-047 schema.

Non-retained: requires the documented cleanup opt-in, creates only its own
random schemas (owned by the test publisher role) and drops them in ``finally``.
Holds the shared mutex for the whole process. Skips before any connection when
the guarded DSNs are absent. Never points at the serving database ``lusk``.
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
             "migrations/047_profile_resource_comparison.sql")
SCHEMA = Path(__file__).resolve().parents[2] / "schema.sql"
TABLE = "profile_resource_comparison_publication"

# A faithful pre-047 shape: the global marker the expand phase must leave
# untouched. Migration 047 references no existing table by foreign key.
PRE_047 = """
CREATE TABLE table_publication (
    table_name text PRIMARY KEY,
    content_version text NOT NULL,
    row_count integer NOT NULL DEFAULT 0,
    reference_content_version text,
    published_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE profile_comparison_publication (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    content_version text NOT NULL, profile_content_version text NOT NULL,
    reference_content_version text NOT NULL,
    group_row_count integer NOT NULL, territory_row_count integer NOT NULL,
    published_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version)
  VALUES ('declared_profile','global-profile-v1',1,'ref-v1');
INSERT INTO profile_comparison_publication
  VALUES (true,'cmp-v1','global-profile-v1','ref-v1',0,0,now());
"""


def _columns(connection, schema, table):
    return connection.execute("""
        SELECT column_name,data_type,is_nullable,column_default
        FROM information_schema.columns
        WHERE table_schema=%s AND table_name=%s
        ORDER BY ordinal_position""", (schema, table)).fetchall()


def test_migration_047_upgrade_preserves_global_marker_and_adds_per_resource_marker():
    publish_dsn, read_dsn = _aedar_guarded_configuration()
    if os.environ.get("LUSK_TEST_ALLOW_SCHEMA_CLEANUP") != "1":
        pytest.fail("migration 047 proof is non-retained; set LUSK_TEST_ALLOW_SCHEMA_CLEANUP=1")
    psycopg = pytest.importorskip("psycopg")
    upgraded = "it_m047_up_" + uuid.uuid4().hex[:12]
    fresh = "it_m047_fresh_" + uuid.uuid4().hex[:12]
    try:
        with psycopg.connect(publish_dsn, autocommit=True) as identity:
            _assert_aedar_server_identity(identity, "lusk_it_contract_pub")
        with psycopg.connect(read_dsn, autocommit=True) as identity:
            _assert_aedar_server_identity(identity, "lusk_it_contract_read")

        with psycopg.connect(publish_dsn, autocommit=True) as connection:
            connection.execute(f'CREATE SCHEMA "{upgraded}"')
            connection.execute(f'CREATE SCHEMA "{fresh}"')

            connection.execute(f'SET search_path TO "{upgraded}"')
            connection.execute(PRE_047)
            before_marker = connection.execute(
                "SELECT table_name,content_version,row_count,reference_content_version "
                "FROM table_publication").fetchall()
            before_cmp = connection.execute(
                "SELECT singleton,content_version,profile_content_version,"
                "reference_content_version FROM profile_comparison_publication").fetchall()

            connection.execute(MIGRATION.read_text(encoding="utf-8"))

            # The global marker and comparison singleton survive untouched.
            assert connection.execute(
                "SELECT table_name,content_version,row_count,reference_content_version "
                "FROM table_publication").fetchall() == before_marker
            assert connection.execute(
                "SELECT singleton,content_version,profile_content_version,"
                "reference_content_version FROM profile_comparison_publication").fetchall() == before_cmp
            assert connection.execute("SELECT to_regclass(%s)", (TABLE,)).fetchone()[0] is not None
            assert connection.execute(f"SELECT count(*) FROM {TABLE}").fetchone()[0] == 0

            # Replay is a structural no-op.
            connection.execute(MIGRATION.read_text(encoding="utf-8"))
            assert connection.execute(f"SELECT count(*) FROM {TABLE}").fetchone()[0] == 0

            # Behaviour, not grants: the test role OWNS the schema it created,
            # so ownership carries every privilege. Assert the marker accepts a
            # well-formed row, that its CHECK rejects a negative count, and
            # that the primary key rejects a duplicate indicator.
            connection.execute(
                f"INSERT INTO {TABLE}(indicator_id,content_version,profile_content_version,"
                "reference_content_version,group_row_count,territory_row_count,lineage_row_count)"
                " VALUES ('distribution_dpe','v1','facts-v1','ref-v1',1,2,3)")
            assert connection.execute(
                f"SELECT content_version,profile_content_version,reference_content_version,"
                f"group_row_count,territory_row_count,lineage_row_count FROM {TABLE}"
            ).fetchone() == ("v1", "facts-v1", "ref-v1", 1, 2, 3)
            with pytest.raises(Exception):
                connection.execute(
                    f"INSERT INTO {TABLE}(indicator_id,content_version,profile_content_version,"
                    "reference_content_version,group_row_count,territory_row_count,lineage_row_count)"
                    " VALUES ('bad','v1','f','r',-1,0,0)")
            with pytest.raises(Exception):
                connection.execute(
                    f"INSERT INTO {TABLE}(indicator_id,content_version,profile_content_version,"
                    "reference_content_version,group_row_count,territory_row_count,lineage_row_count)"
                    " VALUES ('distribution_dpe','v2','f','r',0,0,0)")
            # The failed writes left the well-formed row intact.
            assert connection.execute(f"SELECT count(*) FROM {TABLE}").fetchone()[0] == 1

            # Fresh-install parity for the new relation.
            connection.execute(f'SET search_path TO "{fresh}"')
            connection.execute(SCHEMA.read_text(encoding="utf-8"))
            assert _columns(connection, upgraded, TABLE) == _columns(connection, fresh, TABLE)

            # Grant model for the NAMED serving roles is a static contract of
            # migration 047 and schema.sql (the test owner role is exempt).
            for ddl in (MIGRATION.read_text(encoding="utf-8"),
                        SCHEMA.read_text(encoding="utf-8")):
                assert f"GRANT SELECT ON {TABLE} TO lusk_reader;" in ddl
                assert (f"GRANT SELECT, INSERT, UPDATE, DELETE ON {TABLE} TO "
                        "lusk_publisher;") in ddl
    finally:
        with psycopg.connect(publish_dsn, autocommit=True) as cleanup:
            for schema in (upgraded, fresh):
                cleanup.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
