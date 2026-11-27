"""#1141 guarded migration 049 rehearsal over a populated adopted schema.

The upgrade starts from the reviewed post-046/pre-049 schema object, seeds every
retained publication shape, applies the real migration, compares every retained
row, and reads scalar/profile resources through the real HTTP app. A second
schema proves an unexpected view dependency aborts the whole transaction.
"""

from __future__ import annotations

import os
import subprocess
import uuid
from pathlib import Path

import pytest

from api.tests.integration.resource_publication_fixtures import publish_aedar, publish_indicator
from api.tests.integration.test_per_resource_publication_http import FOCAL, PEER, _seed
from api.tests.integration.test_postgres_publication import (
    _aedar_guarded_configuration, _assert_aedar_server_identity, _dsn_with_schema)

pytestmark = pytest.mark.integration

ROOT = Path(__file__).resolve().parents[3]
API = ROOT / "api"
MIGRATION = API / "migrations/049_retire_typed_readings.sql"
SCHEMA = API / "schema.sql"
PRE_049_COMMIT = "a0807c710569b65c64b1154f7ab0683b671551a5"
TYPED_TABLES = {
    "demographic_reading_descriptor", "demographic_typed_reading",
    "selected_reading_publication", "selected_reading_descriptor", "habitat_typed_reading",
    "economy_activity_evidence", "economy_typed_reading", "milieux_reading_source",
    "milieux_reading_absence", "milieux_typed_reading", "milieux_population_provenance_revision",
    "scalar_comparison_publication", "profile_comparison_publication",
}
RETIRED_MARKERS = {
    "scalar_observation", "declared_profile", "demographic_typed_reading", "selected_reading",
    "economy_typed_reading", "economy_activity_evidence", "milieux_typed_reading",
    "milieux_reading_absence",
}


def _pre_049_schema() -> str:
    result = subprocess.run(
        ["git", "-C", str(ROOT), "show", f"{PRE_049_COMMIT}:api/schema.sql"],
        check=True, capture_output=True, text=True, encoding="utf-8")
    return result.stdout


def _quote(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _tables(connection, schema: str) -> list[str]:
    return [row[0] for row in connection.execute(
        "SELECT table_name FROM information_schema.tables WHERE table_schema=%s ORDER BY table_name",
        (schema,)).fetchall()]


def _snapshot(connection, schema: str, *, exclude=()):
    result = {}
    for table in _tables(connection, schema):
        if table in exclude:
            continue
        columns = [row[0] for row in connection.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_schema=%s AND table_name=%s ORDER BY ordinal_position",
            (schema, table)).fetchall()]
        order = ",".join(_quote(column) for column in columns)
        result[table] = connection.execute(
            f"SELECT * FROM {_quote(schema)}.{_quote(table)} ORDER BY {order}").fetchall()
    return result


def _catalog(connection, schema: str):
    return connection.execute("""
        SELECT c.relname,c.relkind,pg_get_viewdef(c.oid,true)
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=%s AND c.relkind IN ('r','v','m')
        ORDER BY c.relname
    """, (schema,)).fetchall(), connection.execute("""
        SELECT r.relname,c.conname,pg_get_constraintdef(c.oid,true)
        FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
        JOIN pg_namespace n ON n.oid=r.relnamespace
        WHERE n.nspname=%s ORDER BY r.relname,c.conname
    """, (schema,)).fetchall()


def _seed_remaining_shapes(connection):
    connection.execute("""INSERT INTO table_publication(table_name,content_version,row_count,
        reference_content_version) VALUES ('scalar_observation','global-scalar-v1',4,'ref-v1'),
        ('declared_profile','global-profile-v1',4,'ref-v1')""")
    connection.execute("""INSERT INTO scalar_comparison_publication(singleton,content_version,
        scalar_content_version,reference_content_version,group_row_count,territory_row_count,
        lineage_row_count) VALUES (true,'global-comparison-v1','global-scalar-v1','ref-v1',2,4,2)""")
    connection.execute("""INSERT INTO profile_comparison_publication(singleton,content_version,
        profile_content_version,reference_content_version,group_row_count,territory_row_count)
        VALUES (true,'global-profile-comparison-v1','global-profile-v1','ref-v1',1,2)""")
    connection.execute("""UPDATE source_vintage SET reference_date='2026-01-01',
        publication_date='2026-01-02' WHERE source_id='source_a' AND vintage_id='v1'""")
    connection.execute("""INSERT INTO series_dataset_publication
        (dataset_id,content_version,reference_content_version,row_count)
        VALUES ('artif_par_habitant','series-v1','ref-v1',4)""")
    connection.execute("""INSERT INTO series_dataset_descriptor(
        dataset_id,indicator_id,axis_kind,axis_values,completeness,label,unit,direction,
        allowed_levels,descriptor_version,active_read_route,theme_id,absence_semantics)
        VALUES ('artif_par_habitant','artif_par_habitant','state_role',ARRAY['M2','M3'],
        'dense_complete','Artificialisation','m²/hab','none',ARRAY['commune'],'series-desc-v1',
        true,'milieux','unavailable')""")
    connection.execute("""INSERT INTO series_provenance_revision(
        provenance_revision_id,source_id,vintage_id,source_name,dataset_name,source_version,
        reference_date,publication_date,revision_hash)
        VALUES ('series-revision','source_a','v1','Fixture source','OCS-GE','2026',
        '2026-01-01','2026-01-02','series-hash')""")
    for territory, value in ((FOCAL, 10.0), (PEER, 20.0)):
        for axis in ("M2", "M3"):
            connection.execute("""INSERT INTO series_dataset_observation(
                dataset_id,indicator_id,territory_id,territory_type,axis_value,state_role,
                observation_period,value,status)
                VALUES ('artif_par_habitant','artif_par_habitant',%s,'commune',%s,%s,'2025',%s,'measured')""",
                (territory, axis, axis, value))
            connection.execute("""INSERT INTO series_observation_provenance
                VALUES ('artif_par_habitant','artif_par_habitant',%s,%s,'series-revision')""",
                (territory, axis))
    publish_indicator(connection, "artif_par_habitant", "owned_series", "series-v1",
                      reference_content_version="ref-v1", publication_id="artif_par_habitant")

    connection.execute("""INSERT INTO observed_collection_publication
        VALUES ('subventions_par_domaine','collection-v1','ref-v1',1)""")
    connection.execute("""INSERT INTO observed_collection_descriptor(
        indicator_id,theme_id,kind,label,unit,descriptor_version,allowed_levels,direction)
        VALUES ('subventions_par_domaine','programmes','period_detail','Subventions','€',
        'collection-desc-v1',ARRAY['commune'],'none')""")
    connection.execute("""INSERT INTO observed_collection_category(
        indicator_id,detail_key,label,ordinal,source_id)
        VALUES ('subventions_par_domaine','education','Éducation',0,'source_a')""")
    connection.execute("""INSERT INTO period_detail_observation(
        indicator_id,territory_id,territory_type,detail_key,observation_period,value,source_id,vintage_id)
        VALUES ('subventions_par_domaine',%s,'commune','education','2025',125,'source_a','v1')""",
        (FOCAL,))
    publish_indicator(connection, "subventions_par_domaine", "observed_collection", "collection-v1",
                      reference_content_version="ref-v1")

    connection.execute("""INSERT INTO observed_collection_publication
        VALUES ('couverture_programmes','membership-v1','ref-v1',1)""")
    connection.execute("""INSERT INTO observed_collection_descriptor(
        indicator_id,theme_id,kind,label,unit,descriptor_version,allowed_levels,direction)
        VALUES ('couverture_programmes','programmes','anchored_membership','Couverture','adhésion',
        'membership-desc-v1',ARRAY['commune'],'none')""")
    connection.execute("""INSERT INTO observed_collection_category(
        indicator_id,detail_key,label,ordinal,source_id,anchor_levels,rider_label)
        VALUES ('couverture_programmes','ACV','Action cœur de ville',0,'source_a',
        ARRAY['commune'],'Convention valant ORT')""")
    connection.execute("""INSERT INTO anchored_membership(
        indicator_id,territory_id,territory_type,detail_key,convention_valant_ort,source_id,vintage_id)
        VALUES ('couverture_programmes',%s,'commune','ACV',true,'source_a','v1')""", (FOCAL,))
    publish_indicator(connection, "couverture_programmes", "observed_collection", "membership-v1",
                      reference_content_version="ref-v1")

    connection.execute("""INSERT INTO aedar_territorial_aggregate(
        territory_type,territory_id,typequ,typequ_label,typequ_hierarchy_label,typequ_description,
        typequ_domain_code,typequ_domain_label,typequ_subdomain_code,typequ_subdomain_label,
        typequ_gamme,typequ_gamme_status,typequ_source_order,identity,n_addresses,n_observed,
        coverage_status,measures,source_id,vintage_id,source_url,licence,attribution)
        VALUES ('commune',%s,'A104','Équipement','Équipement','Description','D','Domaine','S','Sous-domaine',
        NULL,'absent',1,'{}'::jsonb,10,8,'covered','{}'::jsonb,'source_a','v1','https://example.test',
        'Licence','Attribution')""", (FOCAL,))
    connection.execute("""INSERT INTO aedar_territory_summary(
        territory_type,territory_id,measure,value,status,n_typequ,n_addresses,n_observed,
        coverage_status,source_id,vintage_id,source_url,licence,attribution)
        VALUES ('commune',%s,'meanVolume',NULL,'unavailable',NULL,NULL,NULL,NULL,
        'source_a','v1','https://example.test','Licence','Attribution')""", (FOCAL,))
    connection.execute("""INSERT INTO table_publication(table_name,content_version,row_count,
        reference_content_version,aedar_source_content_version)
        VALUES ('aedar_territorial_aggregate','aedar-v1',1,'ref-v1',NULL),
               ('aedar_territory_summary','aedar-summary-v1',1,'ref-v1','aedar-v1')""")
    publish_aedar(connection, "aedar-v1", reference_content_version="ref-v1")
    connection.execute("""INSERT INTO resource_publication_event(
        resource_id,shape,operation,new_content_version)
        SELECT resource_id,shape,'adopt',content_version FROM resource_publication""")


def _columns_and_constraints(connection, schema: str, tables):
    columns = connection.execute("""
        SELECT table_name,column_name,data_type,is_nullable,column_default
        FROM information_schema.columns WHERE table_schema=%s AND table_name=ANY(%s)
        ORDER BY table_name,ordinal_position
    """, (schema, list(tables))).fetchall()
    constraints = connection.execute("""
        SELECT r.relname,c.conname,pg_get_constraintdef(c.oid,true)
        FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
        JOIN pg_namespace n ON n.oid=r.relnamespace
        WHERE n.nspname=%s AND r.relname=ANY(%s) ORDER BY r.relname,c.conname
    """, (schema, list(tables))).fetchall()
    return columns, sorted(constraints)


def test_migration_049_preserves_adopted_resources_and_http_reads():
    publish_dsn, read_dsn = _aedar_guarded_configuration()
    if os.environ.get("LUSK_TEST_ALLOW_SCHEMA_CLEANUP") != "1":
        pytest.fail("migration 049 proof is non-retained; set LUSK_TEST_ALLOW_SCHEMA_CLEANUP=1")
    psycopg = pytest.importorskip("psycopg")
    from fastapi.testclient import TestClient
    from psycopg_pool import ConnectionPool
    from api import main

    upgraded = "it_m049_up_" + uuid.uuid4().hex[:12]
    fresh = "it_m049_fresh_" + uuid.uuid4().hex[:12]
    pool = None
    try:
        with psycopg.connect(publish_dsn, autocommit=True) as identity:
            _assert_aedar_server_identity(identity, "lusk_it_contract_pub")
        with psycopg.connect(read_dsn, autocommit=True) as identity:
            _assert_aedar_server_identity(identity, "lusk_it_contract_read")
        with psycopg.connect(publish_dsn, autocommit=True) as connection:
            connection.execute(f'CREATE SCHEMA "{upgraded}"')
            connection.execute(f'CREATE SCHEMA "{fresh}"')
            connection.execute(f'SET search_path TO "{upgraded}"')
            connection.execute(_pre_049_schema())
            with connection.transaction():
                _seed(connection)
                _seed_remaining_shapes(connection)
            before = _snapshot(connection, upgraded)
            before_publication = {row[0]: row for row in before["table_publication"]}
            retained_tables = set(before) - TYPED_TABLES - {"table_publication"}
            connection.execute(MIGRATION.read_text(encoding="utf-8"))
            after = _snapshot(connection, upgraded)
            assert set(TYPED_TABLES).isdisjoint(after)
            for table in retained_tables:
                assert after[table] == before[table], table
            assert {row[0]: row for row in after["table_publication"]} == {
                name: row for name, row in before_publication.items() if name not in RETIRED_MARKERS
            }
            assert {row[0] for row in after["resource_publication"]} == {
                "resource_a", "resource_b", "profile_a", "profile_b", "profile_dpe",
                "artif_par_habitant", "subventions_par_domaine", "couverture_programmes", "aedar"
            }
            assert len(after["resource_publication_event"]) == 9
            assert len(after["scalar_resource_comparison_publication"]) == 2
            assert len(after["profile_resource_comparison_publication"]) == 2

            connection.execute(f'SET search_path TO "{fresh}"')
            connection.execute(SCHEMA.read_text(encoding="utf-8"))
            upgraded_columns, upgraded_constraints = _columns_and_constraints(
                connection, upgraded, retained_tables | {"table_publication"})
            fresh_columns, fresh_constraints = _columns_and_constraints(
                connection, fresh, retained_tables | {"table_publication"})
            assert upgraded_columns == fresh_columns
            assert [row for row in upgraded_constraints if row[0] == "table_publication"] == \
                [row for row in fresh_constraints if row[0] == "table_publication"]

        role = "lusk_it_contract_read"
        with psycopg.connect(publish_dsn, autocommit=True) as publisher:
            publisher.execute(f'GRANT USAGE ON SCHEMA "{upgraded}" TO "{role}"')
            publisher.execute(f'GRANT SELECT ON ALL TABLES IN SCHEMA "{upgraded}" TO "{role}"')
        pool = ConnectionPool(conninfo=_dsn_with_schema(read_dsn, upgraded), min_size=0,
                              max_size=1, open=True, kwargs={"autocommit": True})
        original = dict(main.app.dependency_overrides)
        main.app.dependency_overrides.clear()
        main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
        try:
            with TestClient(main.app) as client:
                discovered = client.get("/api/resources")
                assert discovered.status_code == 200, discovered.text
                assert "resource_a" in {row["resource_id"] for row in discovered.json()["resources"]}
                for resource in ("resource_a", "profile_a"):
                    response = client.post("/api/resources/read", json={
                        "resource": resource,
                        "target": {"kind": "territory", "type": "commune", "id": FOCAL},
                        "intent": {"kind": "facts"},
                    })
                    assert response.status_code == 200, response.text
        finally:
            main.app.dependency_overrides.clear()
            main.app.dependency_overrides.update(original)
    finally:
        if pool is not None:
            pool.close()
        with psycopg.connect(publish_dsn, autocommit=True) as cleanup:
            cleanup.execute(f'DROP SCHEMA IF EXISTS "{upgraded}" CASCADE')
            cleanup.execute(f'DROP SCHEMA IF EXISTS "{fresh}" CASCADE')


def test_migration_049_unexpected_dependency_aborts_with_zero_changes():
    publish_dsn, _read_dsn = _aedar_guarded_configuration()
    if os.environ.get("LUSK_TEST_ALLOW_SCHEMA_CLEANUP") != "1":
        pytest.fail("migration 049 dependency proof is non-retained; set LUSK_TEST_ALLOW_SCHEMA_CLEANUP=1")
    psycopg = pytest.importorskip("psycopg")
    schema = "it_m049_dep_" + uuid.uuid4().hex[:12]
    try:
        with psycopg.connect(publish_dsn, autocommit=True) as identity:
            _assert_aedar_server_identity(identity, "lusk_it_contract_pub")
        with psycopg.connect(publish_dsn, autocommit=True) as connection:
            connection.execute(f'CREATE SCHEMA "{schema}"')
            connection.execute(f'SET search_path TO "{schema}"')
            connection.execute(_pre_049_schema())
            connection.execute("CREATE VIEW unexpected_reading_consumer AS SELECT * FROM demographic_typed_reading")
            before_rows = _snapshot(connection, schema)
            before_catalog = _catalog(connection, schema)
            with pytest.raises(psycopg.errors.DependentObjectsStillExist):
                connection.execute(MIGRATION.read_text(encoding="utf-8"))
            connection.execute("ROLLBACK")
            assert _snapshot(connection, schema) == before_rows
            assert _catalog(connection, schema) == before_catalog
            assert connection.execute("SELECT to_regclass('demographic_typed_reading')").fetchone()[0]
            assert connection.execute("SELECT to_regclass('unexpected_reading_consumer')").fetchone()[0]
    finally:
        with psycopg.connect(publish_dsn, autocommit=True) as cleanup:
            cleanup.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
