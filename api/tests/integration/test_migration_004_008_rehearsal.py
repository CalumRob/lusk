"""Guarded cumulative rehearsal of shared serving migrations 004 through 008."""

from __future__ import annotations

import os
import re
import uuid
from pathlib import Path

import pytest

from api.tests.integration.test_postgres_publication import _configuration, _dsn_with_schema


pytestmark = pytest.mark.integration


def test_cumulative_004_006_007_008_preserves_markers_and_fresh_contract():
    import psycopg

    publish_dsn, _ = _configuration()
    api_root = Path(__file__).resolve().parents[2]
    migrations = [api_root / f"migrations/{name}" for name in (
        "004_shared_scalar.sql", "006_declared_profile.sql",
        "007_ordered_series.sql", "008_building_evidence_contract.sql",
    )]
    migration_020 = api_root / "migrations/020_demographic_typed_reading.sql"
    schema = "it_migration_chain_" + uuid.uuid4().hex[:16]
    scoped = _dsn_with_schema(publish_dsn, schema)
    created = False
    try:
        with psycopg.connect(publish_dsn, autocommit=True) as connection:
            connection.execute(f'CREATE SCHEMA "{schema}"')
            created = True
        with psycopg.connect(scoped, autocommit=True) as connection:
            # Supported pre-594 shape, with the original five marker names and
            # the physical building fact tables that migrations 003 introduced.
            connection.execute("""
                CREATE TABLE table_publication (
                  table_name text PRIMARY KEY CHECK (table_name IN (
                    'territory_reference','service_registry','essential_service_access',
                    'building_ramp','building_grid')),
                  content_version text NOT NULL, row_count integer NOT NULL CHECK(row_count>=0),
                  published_at timestamptz NOT NULL DEFAULT now());
                CREATE TABLE territory_reference (
                  territory_id text PRIMARY KEY, territory_type text NOT NULL,
                  name text NOT NULL, department_id text, epci_id text,
                  density_class_code text, density_class_label text);
                CREATE TABLE building_ramp (
                  territory_id text NOT NULL REFERENCES territory_reference(territory_id),
                  territory_type text NOT NULL, availability text NOT NULL, mode text NOT NULL,
                  quantile_index smallint NOT NULL, quantile double precision,
                  accessible_types double precision, total_buildings integer NOT NULL,
                  source_id text NOT NULL, source_version text NOT NULL,
                  effective_direction text NOT NULL,
                  PRIMARY KEY(territory_type,territory_id,mode,quantile_index));
                CREATE TABLE building_grid (
                  territory_id text NOT NULL REFERENCES territory_reference(territory_id),
                  territory_type text NOT NULL, availability text NOT NULL, mode text NOT NULL,
                  cell_index smallint NOT NULL, breadth_bucket text, depth_bucket text,
                  building_count integer, total_buildings integer NOT NULL,
                  source_id text NOT NULL, source_version text NOT NULL,
                  PRIMARY KEY(territory_type,territory_id,cell_index));
                INSERT INTO territory_reference(territory_id,territory_type,name)
                  VALUES ('chain-fixture','commune','Chain fixture');
            """)
            for migration in migrations[:3]:
                connection.execute(migration.read_text(encoding="utf-8"))
            connection.execute("""
                INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version)
                VALUES ('declared_profile','profile-before-008',0,'ref-chain'),
                       ('ordered_series','series-before-008',0,'ref-chain')
            """)
            profile_series_before = connection.execute(
                "SELECT table_name,content_version,reference_content_version FROM table_publication "
                "WHERE table_name IN ('declared_profile','ordered_series') ORDER BY table_name"
            ).fetchall()
            connection.execute(migrations[3].read_text(encoding="utf-8"))

            assert connection.execute(
                "SELECT table_name,content_version,reference_content_version FROM table_publication "
                "WHERE table_name IN ('declared_profile','ordered_series') ORDER BY table_name"
            ).fetchall() == profile_series_before

            # Confirm actual marker CHECK semantics, including all three
            # profile/series/building marker names introduced along this chain.
            check = connection.execute("""
                SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
                JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
                WHERE n.nspname=current_schema() AND t.relname='table_publication'
                  AND c.conname='table_publication_table_name_check'
            """).fetchone()[0]
            for marker in ('declared_profile', 'ordered_series', 'building_ramp', 'building_grid'):
                assert marker in check
            with pytest.raises(psycopg.errors.CheckViolation):
                with connection.transaction():
                    connection.execute("INSERT INTO table_publication VALUES ('not_allowed','x',0,now(),NULL)")

            # Building 008 added NOT VALID source-vintage FKs: old rows remain
            # readable while future writes are checked; descriptor tables are present.
            fk_states = connection.execute("""
                SELECT c.conname,c.convalidated FROM pg_constraint c
                JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
                WHERE n.nspname=current_schema() AND c.conname IN
                  ('building_ramp_source_vintage_fk','building_grid_source_vintage_fk')
                ORDER BY c.conname
            """).fetchall()
            assert fk_states == [
                ('building_grid_source_vintage_fk', False),
                ('building_ramp_source_vintage_fk', False),
            ]
            assert connection.execute("""
                SELECT count(*) FROM information_schema.tables
                WHERE table_schema=current_schema() AND table_name IN
                  ('building_evidence_descriptor','building_evidence_descriptor_source')
            """).fetchone()[0] == 2

            # Fresh install declares the same allowable publication names and
            # keeps profile/series reference requirements after adding buildings.
            fresh_sql = (api_root / "schema.sql").read_text(encoding="utf-8")
            fresh_names = set(re.findall(r"'([a-z_]+)'", re.search(
                r"CREATE TABLE table_publication.*?CHECK\s*\(table_name IN\s*\((.*?)\)\)",
                fresh_sql, re.S).group(1)))
            # Apply 020 over populated earlier-family markers; their versions
            # must survive while the new markers converge to fresh-install DDL.
            connection.execute("INSERT INTO source_dataset(source_id,name) VALUES ('dpe_22','DPE')")
            connection.execute("INSERT INTO source_vintage(source_id,vintage_id,version,publication_date) VALUES ('dpe_22','dpe_22','fixture','2026-01-01')")
            connection.execute(migration_020.read_text(encoding="utf-8"))
            prior_after_020 = connection.execute(
                "SELECT table_name,content_version,reference_content_version FROM table_publication "
                "WHERE table_name IN ('declared_profile','ordered_series') ORDER BY table_name"
            ).fetchall()
            assert prior_after_020 == profile_series_before
            check_020 = connection.execute("""SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
                JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
                WHERE n.nspname=current_schema() AND t.relname='table_publication'
                  AND c.conname='table_publication_table_name_check'""").fetchone()[0]
            assert set(re.findall(r"'([a-z_]+)'", check_020)) == fresh_names
            for marker in ('declared_profile', 'ordered_series'):
                with pytest.raises(psycopg.errors.CheckViolation):
                    with connection.transaction():
                        connection.execute(
                            "UPDATE table_publication SET reference_content_version=NULL WHERE table_name=%s",
                            (marker,),
                        )
    finally:
        if created and os.environ.get("LUSK_TEST_ALLOW_SCHEMA_CLEANUP") == "1":
            with psycopg.connect(publish_dsn, autocommit=True) as connection:
                connection.execute(f'DROP SCHEMA "{schema}" CASCADE')
