"""#1042 — guarded rehearsal of additive migration 044.

Non-retained: requires the documented cleanup opt-in and dedicated DSNs, holds
the shared database mutex for the whole process, verifies both roles and the
exact test database before any DDL, creates only its own random schemas, and
drops only those schemas in ``finally``.
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path

import pytest

from api.tests.integration.test_postgres_publication import (
    _aedar_guarded_configuration, _assert_aedar_server_identity)

pytestmark = pytest.mark.integration

API = Path(__file__).resolve().parents[2]
MIGRATION = (API / "migrations/044_littoral_comparison_contexts.sql").read_text(encoding="utf-8")
SCHEMA = (API / "schema.sql").read_text(encoding="utf-8")
NEW_LIST = "'density_class','epci','bretagne','same_level','littoral'"
OLD_LIST = "'density_class','epci','bretagne','same_level'"
WIDENED_TABLES = (
    "scalar_comparison_group", "comparison_source_lineage", "profile_comparison_group",
    "ordered_series_comparison_group", "observed_collection_comparison_group",
)


def _context_checks(connection, schema):
    return {
        table: connection.execute("""
            SELECT pg_get_constraintdef(c.oid)
            FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
            JOIN pg_namespace n ON n.oid=r.relnamespace
            WHERE n.nspname=%s AND r.relname=%s AND c.contype='c'
              AND pg_get_constraintdef(c.oid) LIKE '%%comparison_context%%'
        """, (schema, table)).fetchall()
        for table in WIDENED_TABLES
    }


def test_migration_044_widens_in_place_and_preserves_old_generations():
    publish_dsn, read_dsn = _aedar_guarded_configuration()
    if os.environ.get("LUSK_TEST_ALLOW_SCHEMA_CLEANUP") != "1":
        pytest.fail("the littoral comparison migration proof is non-retained; set LUSK_TEST_ALLOW_SCHEMA_CLEANUP=1")
    psycopg = pytest.importorskip("psycopg")
    verified = False
    upgraded = "it_littoral_cmp_" + uuid.uuid4().hex[:12]
    fresh = "it_littoral_cmp_fresh_" + uuid.uuid4().hex[:12]
    try:
        with psycopg.connect(publish_dsn, autocommit=True) as identity:
            _assert_aedar_server_identity(identity, "lusk_it_contract_pub")
        with psycopg.connect(read_dsn, autocommit=True) as identity:
            _assert_aedar_server_identity(identity, "lusk_it_contract_read")
        verified = True

        with psycopg.connect(publish_dsn, autocommit=True) as connection:
            connection.execute(f'CREATE SCHEMA "{upgraded}"')
            connection.execute(f'CREATE SCHEMA "{fresh}"')

            # A synthetic pre-044 install: same schema, old four-value domain.
            connection.execute(f'SET search_path TO "{upgraded}"')
            connection.execute(SCHEMA.replace(NEW_LIST, OLD_LIST))
            connection.execute("INSERT INTO source_dataset(source_id,name) VALUES ('census','Census')")
            connection.execute("INSERT INTO source_vintage(source_id,vintage_id,version) VALUES ('census','2020','v1')")
            connection.execute("""INSERT INTO comparison_source_lineage
                (comparison_family,comparison_context,group_id,territory_type,facet_id,
                 source_id,vintage_id,comparison_content_version)
                VALUES ('scalar','density_class','1','commune','population','census','2020','old-generation')""")

            connection.execute(MIGRATION)

            # The old publication row survives the additive DDL untouched and
            # the widened domain now admits both littoral cohorts.
            assert connection.execute("""SELECT comparison_context,group_id,comparison_content_version
                FROM comparison_source_lineage WHERE comparison_context='density_class'""").fetchone() == (
                    "density_class", "1", "old-generation")
            for group in ("C", "NC"):
                connection.execute("""INSERT INTO comparison_source_lineage
                    (comparison_family,comparison_context,group_id,territory_type,facet_id,
                     source_id,vintage_id,comparison_content_version)
                    VALUES ('scalar','littoral',%s,'commune','population','census','2020','new-generation')""",
                    (group,))

            # A replay of the migration is a no-op (the widened CHECK is found).
            connection.execute(MIGRATION)

            connection.execute(f'SET search_path TO "{fresh}"')
            connection.execute(SCHEMA)
            assert _context_checks(connection, upgraded) == _context_checks(connection, fresh)
            for table in WIDENED_TABLES:
                definition = connection.execute("""
                    SELECT pg_get_constraintdef(c.oid)
                    FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
                    JOIN pg_namespace n ON n.oid=r.relnamespace
                    WHERE n.nspname=%s AND r.relname=%s AND c.contype='c'
                      AND pg_get_constraintdef(c.oid) LIKE '%%comparison_context%%'
                """, (fresh, table)).fetchone()
                assert definition is not None and "littoral" in definition[0]
    finally:
        if verified:
            with psycopg.connect(publish_dsn, autocommit=True) as connection:
                for schema in (upgraded, fresh):
                    connection.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
