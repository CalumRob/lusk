"""#1140 — guarded real-SQL/HTTP proof of per-resource publication coexistence.

Uses documented SQL fixtures (not a second publisher implementation): two
scalars, one declared profile, per-resource comparison markers and the old
global markers coexist. The dedicated read role exercises the actual API SQL
path. Non-retained, exact test database/role identities, mutex and finally
cleanup; skips before connection without the guarded DSNs.
"""

from __future__ import annotations

import json
import os
import uuid
from pathlib import Path

import pytest

from api.tests.integration.test_postgres_publication import (
    _aedar_guarded_configuration, _assert_aedar_server_identity, _dsn_with_schema)
from api.tests.integration.test_selected_profile_mean_http import (
    _acquire_mutex, _release_mutex)

pytestmark = pytest.mark.integration

SCHEMA = Path(__file__).resolve().parents[2] / "schema.sql"
FOCAL, PEER = "fixture-c1", "fixture-c2"


def _metadata(resource_id, *, profile=False):
    page = {
        "indicator": resource_id, "label": resource_id, "unit": "%" if profile else "count",
        "direction": "high", "levels": ["commune"], "sources": ["source_a"],
    }
    metadata = {
        "theme": "fixture", "indicator_keys": [resource_id],
        "sources": {resource_id: "source_a"},
        "source_records": {"source_a": {"name": "Fixture source", "vintages": [
            {"id": "v1", "version": "2026"}]}},
        "indicator_pages": {resource_id: page},
    }
    if profile:
        page["comparison"] = {"unit": "%", "details": ["d1", "d2"], "detail": "d1"}
        page["pyramid"] = {"dimensions": ["detail"]}
        metadata["profile_contracts"] = {resource_id: {
            "allowed_levels": ["commune"], "completeness": "dense_complete",
            "detail_units": {"d1": "%", "d2": "%"}}}
    else:
        page["comparison"] = {"unit": "count"}
        metadata["scalar_contracts"] = {resource_id: {
            "allowed_levels": ["commune"], "comparison_facet": resource_id,
            "completeness": "dense_complete", "counts_available": True}}
    return {"kind": "indicator", "metadata": metadata}


def _descriptor(connection, resource_id, version, *, profile=False):
    from psycopg.types.json import Jsonb

    connection.execute("""INSERT INTO resource_publication_descriptor(
        resource_id,publication_resource_id,content_version,descriptor)
        VALUES (%s,%s,%s,%s)""", (resource_id, resource_id, version,
                                  Jsonb(_metadata(resource_id, profile=profile))))


def _seed_scalar(connection, resource_id, version, value):
    connection.execute("""INSERT INTO scalar_descriptor(indicator_id,theme_id,label,unit,
        direction,comparison_facet,allowed_levels,denominator_semantics,completeness,
        descriptor_version) VALUES (%s,'fixture',%s,'count','high',%s,ARRAY['commune'],
        'count','dense_complete',%s)""", (resource_id, resource_id, resource_id,
                                         version + "-descriptor"))
    connection.execute("INSERT INTO scalar_descriptor_source VALUES (%s,'source_a')",
                       (resource_id,))
    for territory_id, territory_value in ((FOCAL, value), (PEER, value / 2)):
        connection.execute("""INSERT INTO scalar_observation(indicator_id,territory_id,
            territory_type,value,status,support_count,denominator_count)
            VALUES (%s,%s,'commune',%s,'measured',10,100)""",
            (resource_id, territory_id, territory_value))
        connection.execute("""INSERT INTO scalar_observation_source(indicator_id,territory_id,
            source_id,vintage_id) VALUES (%s,%s,'source_a','v1')""", (resource_id, territory_id))
    connection.execute("""INSERT INTO scalar_comparison_group(comparison_context,group_id,
        territory_type,indicator_id,statistic,median,member_count,eligible_count,
        missing_count,lineage_source_count) VALUES ('density_class','D1','commune',%s,
        'median',%s,2,2,0,1)""", (resource_id, value * 0.75))
    connection.execute("""INSERT INTO scalar_comparison_territory(comparison_context,group_id,
        territory_type,indicator_id,territory_id,value,status,rank,tie_count,rank_size)
        VALUES ('density_class','D1','commune',%s,%s,%s,'measured',1,1,2),
               ('density_class','D1','commune',%s,%s,%s,'measured',2,1,2)""",
        (resource_id, FOCAL, value, resource_id, PEER, value / 2))
    connection.execute("""INSERT INTO comparison_source_lineage(comparison_family,
        comparison_context,group_id,territory_type,facet_id,source_id,vintage_id,
        comparison_content_version) VALUES ('scalar','density_class','D1','commune',%s,
        'source_a','v1',%s)""", (resource_id, version + "-comparison"))
    connection.execute("""INSERT INTO scalar_resource_comparison_publication(indicator_id,
        content_version,scalar_content_version,reference_content_version,group_row_count,
        territory_row_count,lineage_row_count) VALUES (%s,%s,%s,'ref-v1',1,2,1)""",
        (resource_id, version + "-comparison", version))
    connection.execute("""INSERT INTO resource_publication(resource_id,shape,content_version,
        reference_content_version) VALUES (%s,'scalar',%s,'ref-v1')""", (resource_id, version))
    _descriptor(connection, resource_id, version)


def _seed_profile(connection):
    resource_id, version = "profile_a", "profile-v1"
    connection.execute("""INSERT INTO profile_descriptor(indicator_id,theme_id,label,unit,
        allowed_levels,completeness,descriptor_version,comparison_detail,comparison_sex,
        comparison_direction,denominator_semantics,detail_units_required)
        VALUES (%s,'fixture','Profile A','%',ARRAY['commune'],'dense_complete',%s,
        'd1',NULL,'high','stock',false)""", (resource_id, version + "-descriptor"))
    connection.execute("INSERT INTO profile_descriptor_source VALUES (%s,'source_a')",
                       (resource_id,))
    connection.execute("""INSERT INTO profile_axis(indicator_id,axis_name,axis_key,label,
        ordinal,unit) VALUES (%s,'detail','d1','D1',0,'%'),(%s,'detail','d2','D2',1,'%')""",
        (resource_id, resource_id))
    for territory_id, base in ((FOCAL, 10.0), (PEER, 20.0)):
        for detail, value in (("d1", base), ("d2", base + 1)):
            connection.execute("""INSERT INTO profile_observation(indicator_id,territory_id,
                territory_type,detail_key,sex_key,value,status) VALUES (%s,%s,'commune',%s,
                '',%s,'measured')""", (resource_id, territory_id, detail, value))
            connection.execute("""INSERT INTO profile_observation_source(indicator_id,
                territory_id,detail_key,sex_key,source_id,vintage_id) VALUES (%s,%s,%s,'',
                'source_a','v1')""", (resource_id, territory_id, detail))
    connection.execute("""INSERT INTO profile_comparison_group(comparison_context,group_id,
        territory_type,indicator_id,detail_key,sex_key,statistic,median,member_count,
        eligible_count,missing_count,lineage_source_count,profile_content_version,
        reference_content_version) VALUES ('density_class','D1','commune',%s,'d1','',
        'median',15,2,2,0,1,%s,'ref-v1')""", (resource_id, version))
    connection.execute("""INSERT INTO profile_comparison_territory(comparison_context,group_id,
        territory_type,indicator_id,detail_key,sex_key,territory_id,value,status,rank,
        tie_count,rank_size,profile_content_version,reference_content_version)
        VALUES ('density_class','D1','commune',%s,'d1','',%s,10,'measured',1,1,2,%s,'ref-v1'),
               ('density_class','D1','commune',%s,'d1','',%s,20,'measured',2,1,2,%s,'ref-v1')""",
        (resource_id, FOCAL, version, resource_id, PEER, version))
    connection.execute("""INSERT INTO comparison_source_lineage(comparison_family,
        comparison_context,group_id,territory_type,facet_id,source_id,vintage_id,
        comparison_content_version) VALUES ('profile','density_class','D1','commune',%s,
        'source_a','v1',%s)""", (resource_id, version + "-comparison"))
    connection.execute("""INSERT INTO profile_resource_comparison_publication(indicator_id,
        content_version,profile_content_version,reference_content_version,group_row_count,
        territory_row_count,lineage_row_count) VALUES (%s,%s,%s,'ref-v1',1,2,1)""",
        (resource_id, version + "-comparison", version))
    connection.execute("""INSERT INTO resource_publication(resource_id,shape,content_version,
        reference_content_version) VALUES (%s,'declared_profile',%s,'ref-v1')""",
        (resource_id, version))
    _descriptor(connection, resource_id, version, profile=True)


def _seed(connection):
    with connection.transaction():
        connection.execute("""INSERT INTO territory_reference(territory_id,territory_type,
            name,department_id,epci_id,density_class_code,density_class_label)
            VALUES (%s,'commune','Focal','29','E1','D1','Dense'),
                   (%s,'commune','Peer','29','E1','D1','Dense')""", (FOCAL, PEER))
        connection.execute("""INSERT INTO table_publication(table_name,content_version,row_count)
            VALUES ('territory_reference','ref-v1',2)""")
        connection.execute("INSERT INTO source_dataset(source_id,name) VALUES ('source_a','Fixture source')")
        connection.execute("""INSERT INTO source_vintage(source_id,vintage_id,version)
            VALUES ('source_a','v1','2026')""")
        # Old global markers deliberately remain present during the expand phase.
        connection.execute("""INSERT INTO table_publication(table_name,content_version,row_count,
            reference_content_version) VALUES ('scalar_observation','global-scalar-v1',4,'ref-v1'),
            ('declared_profile','global-profile-v1',4,'ref-v1')""")
        connection.execute("""INSERT INTO scalar_comparison_publication(singleton,content_version,
            scalar_content_version,reference_content_version,group_row_count,territory_row_count,
            lineage_row_count) VALUES (true,'global-comparison-v1','global-scalar-v1','ref-v1',2,4,2)""")
        connection.execute("""INSERT INTO profile_comparison_publication(singleton,content_version,
            profile_content_version,reference_content_version,group_row_count,territory_row_count)
            VALUES (true,'global-profile-comparison-v1','global-profile-v1','ref-v1',1,2)""")
        _seed_scalar(connection, "resource_a", "a-v1", 12.0)
        _seed_scalar(connection, "resource_b", "b-v1", 8.0)
        _seed_profile(connection)


def _item(resource_id, *, intent=None, item_id=None):
    result = {
        "resource": resource_id,
        "target": {"kind": "territory", "type": "commune", "id": FOCAL},
        "intent": intent or {"kind": "facts"},
    }
    if item_id is not None:
        result["id"] = item_id
    return result


def test_registry_and_old_global_markers_coexist_over_real_http_sql():
    publish_dsn, read_dsn = _aedar_guarded_configuration()
    if os.environ.get("LUSK_TEST_ALLOW_SCHEMA_CLEANUP") != "1":
        pytest.fail("per-resource HTTP proof is non-retained; set LUSK_TEST_ALLOW_SCHEMA_CLEANUP=1")
    psycopg = pytest.importorskip("psycopg")
    from fastapi.testclient import TestClient
    from psycopg_pool import ConnectionPool
    from api import main

    mutex = _acquire_mutex()
    schema = "it_resource_http_" + uuid.uuid4().hex[:12]
    pool = None
    try:
        with psycopg.connect(publish_dsn, autocommit=True) as identity:
            _assert_aedar_server_identity(identity, "lusk_it_contract_pub")
        with psycopg.connect(read_dsn, autocommit=True) as identity:
            _assert_aedar_server_identity(identity, "lusk_it_contract_read")
        with psycopg.connect(publish_dsn, autocommit=True) as publisher:
            publisher.execute(f'CREATE SCHEMA "{schema}"')
            publisher.execute(f'SET search_path TO "{schema}"')
            publisher.execute(SCHEMA.read_text(encoding="utf-8"))
            reader_role = "lusk_it_contract_read"
            publisher.execute(f'GRANT USAGE ON SCHEMA "{schema}" TO "{reader_role}"')
            publisher.execute(f'GRANT SELECT ON ALL TABLES IN SCHEMA "{schema}" TO "{reader_role}"')
            _seed(publisher)

        pool = ConnectionPool(conninfo=_dsn_with_schema(read_dsn, schema), min_size=0,
                              max_size=1, open=True, kwargs={"autocommit": True})
        original = main.get_repository
        main.app.dependency_overrides[original] = lambda: main.ReadRepository(pool)
        try:
            with TestClient(main.app) as client:
                def read(resource_id, intent=None):
                    return client.post("/api/resources/read", json=_item(resource_id, intent=intent))

                discovered = client.get("/api/resources")
                assert discovered.status_code == 200, discovered.text
                assert {row["resource_id"] for row in discovered.json()["resources"]} == {
                    "resource_a", "resource_b", "profile_a"}

                # Requested resource clocks, not the deliberately old global tokens.
                a = read("resource_a")
                assert a.status_code == 200, a.text
                assert a.json()["content_version"] == "a-v1"
                assert a.json()["reference_content_version"] == "ref-v1"
                fixed = read("resource_a", {"kind": "fixed_comparison", "context": "default"})
                assert fixed.status_code == 200, fixed.text
                assert fixed.json()["content_version"] == "a-v1"
                profile = read("profile_a")
                assert profile.status_code == 200, profile.text
                assert profile.json()["content_version"] == "profile-v1"

                # Publishing B moves only B; A remains readable with old global markers present.
                with psycopg.connect(publish_dsn, autocommit=True) as publisher:
                    publisher.execute(f'SET search_path TO "{schema}"')
                    with publisher.transaction():
                        publisher.execute("""UPDATE scalar_observation SET value=99
                            WHERE indicator_id='resource_b' AND territory_id=%s""", (FOCAL,))
                        publisher.execute("""UPDATE resource_publication SET content_version='b-v2'
                            WHERE resource_id='resource_b'""")
                        publisher.execute("""DELETE FROM resource_publication_descriptor
                            WHERE publication_resource_id='resource_b'""")
                        _descriptor(publisher, "resource_b", "b-v2")
                        publisher.execute("""UPDATE table_publication SET content_version='global-stale-v1'
                            WHERE table_name='scalar_observation'""")
                assert read("resource_a").status_code == 200

                # Retirement disappears from discovery immediately and fails closed on read.
                with psycopg.connect(publish_dsn, autocommit=True) as publisher:
                    publisher.execute(f'SET search_path TO "{schema}"')
                    publisher.execute("UPDATE resource_publication SET retired=true WHERE resource_id='resource_b'")
                discovered = client.get("/api/resources").json()["resources"]
                assert "resource_b" not in {row["resource_id"] for row in discovered}
                retired = read("resource_b")
                assert retired.status_code == 503
                assert retired.json()["detail"] == "Resource publication is unavailable"
                batch = client.post("/api/resources/read-batch", json={
                    "contract": "semantic-read-batch-v2", "items": [
                        _item("resource_a", item_id="a"), _item("resource_b", item_id="b")]})
                assert batch.status_code == 200, batch.text
                assert batch.json()["results"][1] == {
                    "id": "b", "resource": "resource_b", "status": "publication_unavailable",
                    "reason": "publication_absent", "family": "scalar"}

                # A new registry descriptor is discoverable without any image/grammar change.
                with psycopg.connect(publish_dsn, autocommit=True) as publisher:
                    publisher.execute(f'SET search_path TO "{schema}"')
                    with publisher.transaction():
                        publisher.execute("""INSERT INTO resource_publication(resource_id,shape,
                            content_version,reference_content_version) VALUES
                            ('resource_c','scalar','c-v1','ref-v1')""")
                        _descriptor(publisher, "resource_c", "c-v1")
                assert "resource_c" in {row["resource_id"] for row in
                    client.get("/api/resources").json()["resources"]}

                # Grammar-known AEDAR with no registry row is a typed 503, not unknown 422.
                missing = read("aedar_territorial_aggregate")
                assert missing.status_code == 503, missing.text
                assert missing.json()["detail"] == "Resource publication is unavailable"
        finally:
            main.app.dependency_overrides.clear()
    finally:
        if pool is not None:
            pool.close()
        with psycopg.connect(publish_dsn, autocommit=True) as cleanup:
            cleanup.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        _release_mutex(mutex)
