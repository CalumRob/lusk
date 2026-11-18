"""#1043 — guarded rehearsal of migration 045 / AEDAR littoral trigger.

Non-retained: requires the documented cleanup opt-in and dedicated DSNs, holds
the shared database mutex for the whole process, verifies both roles and the
exact test database before any DDL, creates only its own random schemas, and
drops only those schemas in ``finally``. Never touches the serving database.
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

API = Path(__file__).resolve().parents[2]
MIGRATION = (API / "migrations/045_aedar_littoral_summary.sql").read_text(encoding="utf-8")
SCHEMA = (API / "schema.sql").read_text(encoding="utf-8")
H64 = "a" * 64
B64 = "b" * 64
C64 = "c" * 64
D64 = "d" * 64


def _seed_reference(connection):
    connection.execute("""INSERT INTO table_publication(table_name,content_version,row_count)
        VALUES ('territory_reference',%s,10)""", (H64,))
    connection.execute("""INSERT INTO table_publication(table_name,content_version,row_count,
        reference_content_version) VALUES ('aedar_territorial_aggregate',%s,10,%s)""", (B64, H64))


def _marker(connection, version, group_row_count, density_class_count, density_rows):
    connection.execute("""INSERT INTO aedar_comparison_publication(
        singleton,content_version,source_snapshot_id,aedar_content_version,reference_content_version,
        input_content_version,input_identity,group_row_count,territory_row_count,publication_mode,
        density_summary_class_count,density_summary_measure_count,density_summary_typequ_count,
        density_summary_row_count,littoral_summary_status_count,littoral_summary_measure_count,
        littoral_summary_row_count)
        VALUES(true,%s,'2026-v1',%s,%s,%s,'{}'::jsonb,%s,0,'reference_only',%s,40,235,%s,0,0,0)""",
        (version, B64, H64, C64, group_row_count, density_class_count, density_rows))


def _density_group(connection, version, group="1", typequ="A104"):
    connection.execute("""INSERT INTO aedar_comparison_group(
        comparison_context,group_id,territory_type,typequ,measure,statistic,value,n_addresses,
        n_observed,coverage_status)
        VALUES('density_class',%s,'commune',%s,'count_5_walk_mean','pooled',1,10,8,'covered')""",
        (group, typequ))


def _density_summary(connection, version, group="1", measure="meanVolume"):
    connection.execute("""INSERT INTO aedar_density_class_summary(
        comparison_content_version,aedar_content_version,reference_content_version,
        input_content_version,group_id,measure,value,status,n_typequ,n_addresses,n_observed,
        coverage_status) VALUES(%s,%s,%s,%s,%s,%s,1,'available',235,10,8,'covered')""",
        (version, B64, H64, C64, group, measure))


def _littoral_summary(connection, version, group, measure):
    connection.execute("""INSERT INTO aedar_littoral_summary(
        comparison_content_version,aedar_content_version,reference_content_version,
        input_content_version,group_id,measure,value,status,n_typequ,n_addresses,n_observed,
        coverage_status) VALUES(%s,%s,%s,%s,%s,%s,1,'available',235,10,8,'covered')""",
        (version, B64, H64, C64, group, measure))


def _reading_measures():
    from api.aedar_models import AEDAR_AGGREGATE_READINGS
    return sorted(AEDAR_AGGREGATE_READINGS)


def test_aedar_littoral_trigger_rehearsal_and_schema_parity():
    publish_dsn, read_dsn = _aedar_guarded_configuration()
    if os.environ.get("LUSK_TEST_ALLOW_SCHEMA_CLEANUP") != "1":
        pytest.fail("the AEDAR littoral migration proof is non-retained; set LUSK_TEST_ALLOW_SCHEMA_CLEANUP=1")
    psycopg = pytest.importorskip("psycopg")
    mutex = _acquire_mutex()
    verified = False
    fresh = "it_littoral_aedar_" + uuid.uuid4().hex[:12]
    try:
        with psycopg.connect(publish_dsn, autocommit=True) as identity:
            _assert_aedar_server_identity(identity, "lusk_it_contract_pub")
        with psycopg.connect(read_dsn, autocommit=True) as identity:
            _assert_aedar_server_identity(identity, "lusk_it_contract_read")
        verified = True

        with psycopg.connect(publish_dsn, autocommit=True) as connection:
            connection.execute(f'CREATE SCHEMA "{fresh}"')
            connection.execute(f'SET search_path TO "{fresh}"')
            connection.execute(SCHEMA)
            _seed_reference(connection)

            # (a) A complete PRE-EXTENSION generation: one density group and its
            # density summary, zero littoral groups/counters. The sibling table
            # must let it commit exactly as before #1043.
            pre = D64
            connection.execute("BEGIN")
            _marker(connection, pre, 1, 1, 40)
            _density_group(connection, pre)
            for measure in _reading_measures():
                _density_summary(connection, pre, measure=measure)
            connection.execute("COMMIT")
            assert connection.execute("SELECT count(*) FROM aedar_comparison_publication").fetchone()[0] == 1

            # (b) An INCOMPLETE littoral generation is rejected: littoral group
            # rows without any sibling summary/counters.
            bad = "e" * 64
            try:
                connection.execute("BEGIN")
                connection.execute("DELETE FROM aedar_comparison_group")
                connection.execute("DELETE FROM aedar_comparison_publication")
                _marker(connection, bad, 2, 1, 40)
                _density_group(connection, bad)
                for measure in _reading_measures():
                    _density_summary(connection, bad, measure=measure)
                connection.execute("""INSERT INTO aedar_comparison_group(
                    comparison_context,group_id,territory_type,typequ,measure,statistic,value,
                    n_addresses,n_observed,coverage_status)
                    VALUES('littoral','C','commune','A104','count_5_walk_mean','pooled',1,10,8,'covered')""")
                connection.execute("COMMIT")
                pytest.fail("incomplete littoral generation was accepted")
            except psycopg.errors.RaiseException as exc:
                assert "pre-extension" in str(exc)
            finally:
                connection.execute("ROLLBACK")

            # (c) A complete C/NC generation commits: sibling rows for BOTH
            # statuses with their own PK, density counters untouched. This would
            # collide if C/NC had been inserted into the density summary table.
            full = "f" * 64
            connection.execute("BEGIN")
            connection.execute("DELETE FROM aedar_comparison_group")
            connection.execute("DELETE FROM aedar_comparison_publication")
            connection.execute("""INSERT INTO aedar_comparison_publication(
                singleton,content_version,source_snapshot_id,aedar_content_version,reference_content_version,
                input_content_version,input_identity,group_row_count,territory_row_count,publication_mode,
                density_summary_class_count,density_summary_measure_count,density_summary_typequ_count,
                density_summary_row_count,littoral_summary_status_count,littoral_summary_measure_count,
                littoral_summary_row_count) VALUES(true,%s,'2026-v1',%s,%s,%s,'{}'::jsonb,3,0,
                'reference_only',1,40,235,40,2,40,80)""", (full, B64, H64, C64))
            _density_group(connection, full)
            for measure in _reading_measures():
                _density_summary(connection, full, measure=measure)
            for group in ("C", "NC"):
                connection.execute("""INSERT INTO aedar_comparison_group(
                    comparison_context,group_id,territory_type,typequ,measure,statistic,value,
                    n_addresses,n_observed,coverage_status)
                    VALUES('littoral',%s,'commune','A104','count_5_walk_mean','pooled',1,10,8,'covered')""",
                    (group,))
                for measure in _reading_measures():
                    _littoral_summary(connection, full, group, measure)
            connection.execute("COMMIT")
            density = connection.execute("""SELECT density_summary_class_count,density_summary_row_count,
                littoral_summary_status_count,littoral_summary_row_count FROM aedar_comparison_publication
                WHERE content_version=%s""", (full,)).fetchone()
            assert density == (1, 40, 2, 80)
            assert connection.execute("""SELECT count(*) FROM aedar_density_class_summary
                WHERE comparison_content_version=%s""", (full,)).fetchone()[0] == 40
            assert connection.execute("""SELECT count(DISTINCT group_id) FROM aedar_density_class_summary
                WHERE comparison_content_version=%s""", (full,)).fetchone()[0] == 1
            assert "C" not in [r[0] for r in connection.execute(
                "SELECT group_id FROM aedar_density_class_summary").fetchall()]

            # Replaying 045 on a current schema is a structural no-op: the
            # widened CHECKs, columns, sibling table and function already exist.
            replay = "it_littoral_aedar_replay_" + uuid.uuid4().hex[:12]
            connection.execute(f'CREATE SCHEMA "{replay}"')
            try:
                def aedar_shape(schema):
                    return connection.execute("""
                        SELECT table_name,column_name,data_type,is_nullable
                        FROM information_schema.columns
                        WHERE table_schema=%s AND table_name LIKE 'aedar_%%'
                        ORDER BY table_name,ordinal_position""", (schema,)).fetchall()
                connection.execute(f'SET search_path TO "{replay}"')
                connection.execute(SCHEMA)
                before = aedar_shape(replay)
                connection.execute(MIGRATION)
                after = aedar_shape(replay)
                assert before == after
                assert connection.execute("""SELECT count(*) FROM pg_constraint c
                    JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
                    WHERE n.nspname=%s AND c.conname IN ('aedar_reference_context_check','aedar_reference_scope_check')
                      AND pg_get_constraintdef(c.oid) LIKE '%%littoral%%'""", (replay,)).fetchone()[0] == 2
            finally:
                connection.execute(f'DROP SCHEMA IF EXISTS "{replay}" CASCADE')

            # Definition-based location: an AUTO-NAMED pre-extension CHECK is
            # widened in place (matching merged 044), then replay is a no-op and
            # a missing definition fails loudly instead of being guessed.
            widen = "it_littoral_aedar_widen_" + uuid.uuid4().hex[:12]
            connection.execute(f'CREATE SCHEMA "{widen}"')
            try:
                connection.execute(f'SET search_path TO "{widen}"')
                connection.execute(SCHEMA)
                connection.execute("ALTER TABLE aedar_comparison_group DROP CONSTRAINT aedar_reference_context_check")
                connection.execute("ALTER TABLE aedar_comparison_group ADD CHECK(comparison_context IN ('density_class','same_level'))")
                connection.execute("ALTER TABLE aedar_comparison_group DROP CONSTRAINT aedar_reference_scope_check")
                connection.execute("""ALTER TABLE aedar_comparison_group ADD CHECK(
                    (comparison_context='density_class' AND territory_type='commune' AND statistic='pooled') OR
                    (comparison_context='same_level' AND territory_type IN ('epci','departement') AND statistic='median'))""")

                def check_defs():
                    return connection.execute("""
                        SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
                        JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
                        WHERE n.nspname=%s AND r.relname='aedar_comparison_group' AND c.contype='c'
                          AND pg_get_constraintdef(c.oid) LIKE '%%comparison_context%%'
                        ORDER BY 1""", (widen,)).fetchall()
                assert all("littoral" not in d[0] for d in check_defs())
                # The auto-named constraint is found by definition, not conname.
                assert not any(c[0] in ("aedar_reference_context_check", "aedar_reference_scope_check")
                               for c in connection.execute("""SELECT c.conname FROM pg_constraint c
                                   JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
                                   WHERE n.nspname=%s AND r.relname='aedar_comparison_group' AND c.contype='c'""",
                                   (widen,)).fetchall())
                connection.execute(MIGRATION)
                widened = check_defs()
                assert len(widened) == 2 and all("littoral" in d[0] for d in widened)
                connection.execute(MIGRATION)
                assert check_defs() == widened  # replay is a structural no-op
                # Removing the definition makes the next application fail loudly.
                defs = connection.execute("""SELECT c.conname FROM pg_constraint c
                    JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
                    WHERE n.nspname=%s AND r.relname='aedar_comparison_group' AND c.contype='c'
                      AND pg_get_constraintdef(c.oid) LIKE '%%comparison_context%%'
                      AND pg_get_constraintdef(c.oid) NOT LIKE '%%territory_type%%'""", (widen,)).fetchall()
                assert len(defs) == 1
                connection.execute(f'ALTER TABLE aedar_comparison_group DROP CONSTRAINT "{defs[0][0]}"')
                connection.execute("BEGIN")
                try:
                    connection.execute(MIGRATION)
                    pytest.fail("migration 045 accepted a missing AEDAR context CHECK")
                except psycopg.errors.RaiseException as exc:
                    assert "expected exactly one AEDAR comparison_context CHECK" in str(exc)
                finally:
                    connection.execute("ROLLBACK")
            finally:
                connection.execute(f'DROP SCHEMA IF EXISTS "{widen}" CASCADE')
    finally:
        try:
            if verified:
                with psycopg.connect(publish_dsn, autocommit=True) as connection:
                    connection.execute(f'DROP SCHEMA IF EXISTS "{fresh}" CASCADE')
        finally:
            _release_mutex(mutex)
