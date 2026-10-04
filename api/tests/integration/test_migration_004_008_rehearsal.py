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
        "016_bpe_profile_evidence.sql",
    )]
    migration_011 = api_root / "migrations/011_owned_series_publications.sql"
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
            with connection.transaction():
                connection.execute("""
                    INSERT INTO source_dataset(source_id,name) VALUES ('legacy-profile-source','Legacy profile')
                """)
                connection.execute("""
                    INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date)
                    VALUES ('legacy-profile-source','v1','v1','2025-01-01','2025-02-01')
                """)
                connection.execute("""
                    INSERT INTO profile_descriptor(indicator_id,label,unit,allowed_levels,completeness,
                      descriptor_version,comparison_detail,comparison_sex,comparison_direction)
                    VALUES ('legacy_profile','Legacy profile','items',ARRAY['commune'],'dense_complete',
                      'profile-before-008','overall','total','high')
                """)
                connection.execute("""
                    INSERT INTO profile_descriptor_source(indicator_id,source_id)
                    VALUES ('legacy_profile','legacy-profile-source')
                """)
                connection.execute("""
                    INSERT INTO profile_axis(indicator_id,axis_name,axis_key,label,ordinal)
                    VALUES ('legacy_profile','detail','overall','Overall',0),
                           ('legacy_profile','sex','total','Total',0)
                """)
                connection.execute("""
                    INSERT INTO profile_observation(indicator_id,territory_id,territory_type,
                      detail_key,sex_key,value,status)
                    VALUES ('legacy_profile','chain-fixture','commune','overall','total',12.5,'measured')
                """)
                connection.execute("""
                    INSERT INTO profile_observation_source(indicator_id,territory_id,detail_key,sex_key,
                      source_id,vintage_id)
                    VALUES ('legacy_profile','chain-fixture','overall','total',
                      'legacy-profile-source','v1')
                """)
                connection.execute("""
                    INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version)
                    VALUES ('declared_profile','profile-before-008',1,'ref-chain'),
                           ('ordered_series','series-before-008',0,'ref-chain')
                """)
            legacy_profile_before = connection.execute("""
                SELECT d.unit,d.descriptor_version,o.value,o.status,s.source_id,s.vintage_id
                FROM profile_descriptor d JOIN profile_observation o USING(indicator_id)
                JOIN profile_observation_source s USING(indicator_id,territory_id,detail_key,sex_key)
                WHERE d.indicator_id='legacy_profile'
            """).fetchone()
            profile_series_before = connection.execute(
                "SELECT table_name,content_version,reference_content_version FROM table_publication "
                "WHERE table_name IN ('declared_profile','ordered_series') ORDER BY table_name"
            ).fetchall()
            connection.execute(migrations[3].read_text(encoding="utf-8"))
            connection.execute(migrations[4].read_text(encoding="utf-8"))

            assert connection.execute(
                "SELECT table_name,content_version,reference_content_version FROM table_publication "
                "WHERE table_name IN ('declared_profile','ordered_series') ORDER BY table_name"
            ).fetchall() == profile_series_before
            assert connection.execute("""
                SELECT d.unit,d.descriptor_version,o.value,o.status,s.source_id,s.vintage_id
                FROM profile_descriptor d JOIN profile_observation o USING(indicator_id)
                JOIN profile_observation_source s USING(indicator_id,territory_id,detail_key,sex_key)
                WHERE d.indicator_id='legacy_profile'
            """).fetchone() == legacy_profile_before

            # Confirm actual marker CHECK semantics, including all three
            # profile/series/building marker names introduced along this chain.
            check = connection.execute("""
                SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
                JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
                WHERE n.nspname=current_schema() AND t.relname='table_publication'
                  AND c.conname='table_publication_table_name_check'
            """).fetchone()[0]
            for marker in ('declared_profile', 'ordered_series', 'building_ramp', 'building_grid',
                           'bpe_profile_evidence'):
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
            assert connection.execute("""
                SELECT count(*) FROM information_schema.tables
                WHERE table_schema=current_schema() AND table_name IN
                  ('bpe_profile_evidence_descriptor','bpe_profile_class_axis',
                   'bpe_profile_evidence','bpe_profile_evidence_source')
            """).fetchone()[0] == 4
            assert connection.execute("""
                SELECT count(*) FROM information_schema.columns
                WHERE table_schema=current_schema()
                  AND table_name='bpe_profile_evidence_descriptor'
                  AND column_name='membership_sha256'
            """).fetchone()[0] == 1
            assert connection.execute("""
                SELECT table_name,content_version,reference_content_version
                FROM table_publication
                WHERE table_name IN ('declared_profile','ordered_series')
                ORDER BY table_name
            """).fetchall() == profile_series_before

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
            # Populate representative pre-021 scalar and typed-reading state,
            # including nullable source clocks. Migration 021 is additive: it
            # must leave every marker token/value/time and these consumer rows intact.
            with connection.transaction():
                connection.execute("""
                    INSERT INTO scalar_descriptor(indicator_id,label,unit,direction,comparison_facet,
                      allowed_levels,denominator_semantics,completeness,descriptor_version)
                    VALUES ('legacy_scalar','Legacy scalar','items','none',NULL,ARRAY['commune'],
                      'fixture','sparse','scalar-before-021')
                """)
                connection.execute("INSERT INTO scalar_descriptor_source VALUES ('legacy_scalar','dpe_22')")
                connection.execute("""
                    INSERT INTO scalar_observation(indicator_id,territory_id,territory_type,value,status,support_count)
                    VALUES ('legacy_scalar','chain-fixture','commune',45,'measured',10)
                """)
                connection.execute("""
                    INSERT INTO scalar_observation_source VALUES ('legacy_scalar','chain-fixture','dpe_22','dpe_22')
                """)
            connection.execute("""
                INSERT INTO demographic_reading_descriptor(singleton,descriptor_version,source_id,vintage_id,rate_unit)
                VALUES (true,'demography-before-021','dpe_22','dpe_22','items')
            """)
            connection.execute("""
                INSERT INTO demographic_typed_reading(territory_id,territory_type,groupe,story_key,
                  salience_reason,status,source_id,vintage_id)
                VALUES ('chain-fixture','commune','legacy','legacy-story','fixture','unavailable','dpe_22','dpe_22')
            """)
            connection.execute("""
                INSERT INTO selected_reading_descriptor(theme_id,descriptor_version,source_id,vintage_id,linked_content_version)
                VALUES ('habitat','habitat-before-021','dpe_22','dpe_22','scalar-before-021')
            """)
            connection.execute("""
                INSERT INTO selected_reading_publication(theme_id,content_version,reference_content_version,row_count)
                VALUES ('habitat','habitat-before-021','ref-chain',1)
            """)
            connection.execute("""
                INSERT INTO habitat_typed_reading(territory_id,territory_type,groupe,story_key,salience_reason,
                  status,source_id,vintage_id)
                VALUES ('chain-fixture','commune','legacy','legacy-story','fixture','unavailable','dpe_22','dpe_22')
            """)
            with connection.transaction():
                connection.execute("""
                    INSERT INTO bpe_profile_evidence_descriptor(singleton,indicator_id,descriptor_version,
                      allowed_levels,completeness,classification_id,universe_count,universe_sha256,
                      registry_filename,registry_semantic_effect,membership_sha256,source_id,vintage_id)
                    VALUES (true,'bpe_access_profile','bpe-before-021',
                      ARRAY['commune','epci','departement','region'],'dense_complete','fixture',1,
                      repeat('a',64),'fixture.csv','fixture semantic contract',repeat('b',64),'dpe_22','dpe_22')
                """)
                connection.execute("""
                    INSERT INTO bpe_profile_class_axis(class_key,label,ordinal,direction) VALUES
                      ('class-a','Class A',0,'high'),('class-b','Class B',1,'high'),
                      ('class-c','Class C',2,'none'),('class-d','Class D',3,'none')
                """)
                connection.execute("""
                    INSERT INTO bpe_profile_evidence(territory_id,territory_type,class_key,class_label,
                      class_count,universe_count,exemplar_typequ,exemplar_label,exemplar_c,exemplar_b,exemplar_t)
                    VALUES ('chain-fixture','commune','class-a','Class A',1,1,'A001','Fixture',0.5,0.5,0.5),
                      ('chain-fixture','commune','class-b','Class B',0,1,NULL,NULL,NULL,NULL,NULL),
                      ('chain-fixture','commune','class-c','Class C',0,1,NULL,NULL,NULL,NULL,NULL),
                      ('chain-fixture','commune','class-d','Class D',0,1,NULL,NULL,NULL,NULL,NULL)
                """)
                connection.execute("""
                    INSERT INTO bpe_profile_evidence_source(territory_type,territory_id,class_key,source_id,vintage_id)
                    SELECT 'commune','chain-fixture',class_key,'dpe_22','dpe_22' FROM bpe_profile_class_axis
                """)
            connection.execute("""
                INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version)
                VALUES ('territory_reference','ref-chain',1,NULL),
                       ('service_registry','services-before-021',3,NULL),
                       ('essential_service_access','access-before-021',4,'ref-chain'),
                       ('scalar_observation','scalar-before-021',1,'ref-chain'),
                       ('demographic_typed_reading','demography-before-021',1,'ref-chain'),
                       ('selected_reading','selected-before-021',1,'ref-chain'),
                       ('bpe_profile_evidence','bpe-before-021',4,'ref-chain')
            """)
            markers_before_021 = connection.execute(
                "SELECT table_name,content_version,row_count,reference_content_version,published_at "
                "FROM table_publication ORDER BY table_name"
            ).fetchall()
            scalar_before_021 = connection.execute("""
                SELECT d.label,d.unit,d.descriptor_version,o.value,o.status,o.support_count,
                       s.source_id,s.vintage_id,v.version,v.reference_date,v.publication_date
                FROM scalar_descriptor d JOIN scalar_observation o USING(indicator_id)
                JOIN scalar_observation_source s USING(indicator_id,territory_id)
                JOIN source_vintage v USING(source_id,vintage_id) WHERE d.indicator_id='legacy_scalar'
            """).fetchone()
            typed_before_021 = connection.execute("""
                SELECT r.story_key,r.salience_reason,r.status,r.source_id,r.vintage_id,v.version,
                       v.reference_date,v.publication_date
                FROM demographic_typed_reading r JOIN source_vintage v USING(source_id,vintage_id)
                WHERE r.territory_id='chain-fixture'
            """).fetchone()
            habitat_before_021 = connection.execute("""
                SELECT h.story_key,h.salience_reason,h.status,h.source_id,h.vintage_id,
                       v.version,v.reference_date,v.publication_date
                FROM habitat_typed_reading h JOIN source_vintage v USING(source_id,vintage_id)
                WHERE h.territory_id='chain-fixture'
            """).fetchone()
            bpe_before_021 = connection.execute("""
                SELECT e.class_key,e.class_label,e.class_count,e.universe_count,e.exemplar_typequ,
                       s.source_id,s.vintage_id,v.version,v.reference_date,v.publication_date
                FROM bpe_profile_evidence e JOIN bpe_profile_evidence_source s
                  USING(territory_type,territory_id,class_key)
                JOIN source_vintage v USING(source_id,vintage_id)
                WHERE e.territory_id='chain-fixture' ORDER BY e.class_key
            """).fetchall()
            connection.execute((api_root / "migrations/021_economy_typed_reading.sql").read_text(encoding="utf-8"))
            connection.execute(migration_011.read_text(encoding="utf-8"))
            connection.execute((api_root / "migrations/022_milieux_typed_reading.sql").read_text(encoding="utf-8"))
            prior_after_020 = connection.execute(
                "SELECT table_name,content_version,reference_content_version FROM table_publication "
                "WHERE table_name IN ('declared_profile','ordered_series') ORDER BY table_name"
            ).fetchall()
            assert prior_after_020 == profile_series_before
            assert connection.execute(
                "SELECT table_name,content_version,row_count,reference_content_version,published_at "
                "FROM table_publication ORDER BY table_name"
            ).fetchall() == markers_before_021
            assert connection.execute("""
                SELECT d.label,d.unit,d.descriptor_version,o.value,o.status,o.support_count,
                       s.source_id,s.vintage_id,v.version,v.reference_date,v.publication_date
                FROM scalar_descriptor d JOIN scalar_observation o USING(indicator_id)
                JOIN scalar_observation_source s USING(indicator_id,territory_id)
                JOIN source_vintage v USING(source_id,vintage_id) WHERE d.indicator_id='legacy_scalar'
            """).fetchone() == scalar_before_021
            assert connection.execute("""
                SELECT r.story_key,r.salience_reason,r.status,r.source_id,r.vintage_id,v.version,
                       v.reference_date,v.publication_date
                FROM demographic_typed_reading r JOIN source_vintage v USING(source_id,vintage_id)
                WHERE r.territory_id='chain-fixture'
            """).fetchone() == typed_before_021
            assert connection.execute("""
                SELECT h.story_key,h.salience_reason,h.status,h.source_id,h.vintage_id,
                       v.version,v.reference_date,v.publication_date
                FROM habitat_typed_reading h JOIN source_vintage v USING(source_id,vintage_id)
                WHERE h.territory_id='chain-fixture'
            """).fetchone() == habitat_before_021
            assert connection.execute("""
                SELECT e.class_key,e.class_label,e.class_count,e.universe_count,e.exemplar_typequ,
                       s.source_id,s.vintage_id,v.version,v.reference_date,v.publication_date
                FROM bpe_profile_evidence e JOIN bpe_profile_evidence_source s
                  USING(territory_type,territory_id,class_key)
                JOIN source_vintage v USING(source_id,vintage_id)
                WHERE e.territory_id='chain-fixture' ORDER BY e.class_key
            """).fetchall() == bpe_before_021
            assert scalar_before_021[8] == 'fixture'
            assert scalar_before_021[9] is None
            assert scalar_before_021[10].isoformat() == '2026-01-01'
            check_020 = connection.execute("""SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
                JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
                WHERE n.nspname=current_schema() AND t.relname='table_publication'
                  AND c.conname='table_publication_table_name_check'""").fetchone()[0]
            assert set(re.findall(r"'([a-z_]+)'", check_020)) == fresh_names
            for marker in ('scalar_observation', 'declared_profile', 'ordered_series',
                           'demographic_typed_reading', 'selected_reading',
                           'bpe_profile_evidence'):
                with pytest.raises(psycopg.errors.CheckViolation):
                    with connection.transaction():
                        connection.execute(
                            "UPDATE table_publication SET reference_content_version=NULL WHERE table_name=%s",
                            (marker,),
                        )
            reference_check = connection.execute("""
                SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
                JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
                WHERE n.nspname=current_schema() AND t.relname='table_publication'
                  AND c.conname='shared_fact_publication_requires_reference'
            """).fetchone()[0]
            fresh_reference_names = set(re.findall(r"'([a-z_]+)'", re.search(
                r"shared_fact_publication_requires_reference.*?CHECK\s*\(.*?IN\s*\((.*?)\)",
                fresh_sql, re.S).group(1)))
            assert set(re.findall(r"'([a-z_]+)'", reference_check)) == fresh_reference_names
    finally:
        if created and os.environ.get("LUSK_TEST_ALLOW_SCHEMA_CLEANUP") == "1":
            with psycopg.connect(publish_dsn, autocommit=True) as connection:
                connection.execute(f'DROP SCHEMA "{schema}" CASCADE')
