"""Opt-in end-to-end API checks against a guarded disposable PostgreSQL DB."""

from __future__ import annotations

import os
import uuid
from pathlib import Path
from urllib.parse import urlsplit

import pytest
from api.tests.integration.test_postgres_publication import canonical_db_env

pytestmark = pytest.mark.integration


def test_dpe_profile_without_publication_is_unavailable_not_an_unknown_route(canonical_db_env):
    from fastapi.testclient import TestClient
    from psycopg_pool import ConnectionPool
    from api import main

    pool = ConnectionPool(conninfo=canonical_db_env['read_dsn'], min_size=0, max_size=1,
                          open=True, kwargs={'autocommit': True})
    previous = main.app.dependency_overrides.get(main.get_repository)
    main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
    try:
        with TestClient(main.app) as client:
            response = client.get('/api/territories/commune/29001/profiles/distribution_dpe')
        assert response.status_code == 503
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous
        pool.close()


def test_dpe_theme_read_is_focal_only_and_pins_scalar_snapshot(canonical_db_env):
    import psycopg
    from fastapi.testclient import TestClient
    from psycopg_pool import ConnectionPool
    from api import main

    with psycopg.connect(canonical_db_env['publish_dsn']) as conn:
        conn.execute("INSERT INTO territory_reference(territory_id,territory_type,name) VALUES ('29001','commune','Focal'),('29002','commune','Peer')")
        conn.execute("INSERT INTO table_publication(table_name,content_version,row_count) VALUES ('territory_reference','ref-v1',2)")
        conn.execute("INSERT INTO source_dataset VALUES ('dpe','DPE fixture')")
        conn.execute("INSERT INTO source_vintage(source_id,vintage_id,version) VALUES ('dpe','v1','2024')")
        conn.execute("""INSERT INTO scalar_descriptor(indicator_id,theme_id,label,unit,direction,comparison_facet,allowed_levels,denominator_semantics,completeness,descriptor_version)
            VALUES ('part_passoires','habitat','Passoires','%','low','part_passoires',ARRAY['commune'],'diagnostics','sparse','scalar-d1')""")
        conn.execute("INSERT INTO scalar_descriptor_source VALUES ('part_passoires','dpe')")
        conn.execute("""INSERT INTO scalar_observation(indicator_id,territory_id,territory_type,value,status) VALUES
            ('part_passoires','29001','commune',0.3,'measured'),('part_passoires','29002','commune',0.1,'measured')""")
        conn.execute("INSERT INTO scalar_observation_source VALUES ('part_passoires','29001','dpe','v1'),('part_passoires','29002','dpe','v1')")
        conn.execute("INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version) VALUES ('scalar_observation','scalar-v1',2,'ref-v1')")
        conn.execute("""INSERT INTO profile_descriptor(indicator_id,theme_id,label,unit,allowed_levels,completeness,descriptor_version,
            comparison_detail,comparison_sex,comparison_direction,comparison_scalar,required_scalar_version) VALUES
            ('distribution_dpe','habitat','DPE','%',ARRAY['commune'],'dense_complete','dpe-d1',NULL,NULL,'low','part_passoires','scalar-v1')""")
        conn.execute("INSERT INTO profile_descriptor_source VALUES ('distribution_dpe','dpe')")
        for ordinal, detail in enumerate('ABCDEFG'):
            conn.execute("INSERT INTO profile_axis VALUES ('distribution_dpe','detail',%s,%s,%s)", (detail, detail, ordinal))
            for tid in ('29001', '29002'):
                conn.execute("""INSERT INTO profile_observation(indicator_id,territory_id,territory_type,detail_key,sex_key,sex_axis_name,value,status)
                    VALUES ('distribution_dpe',%s,'commune',%s,'',NULL,%s,'measured')""", (tid, detail, 0.1 if detail != 'G' else 0.4))
                conn.execute("INSERT INTO profile_observation_source VALUES ('distribution_dpe',%s,%s,'','dpe','v1')", (tid, detail))
        conn.execute("INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version) VALUES ('declared_profile','profiles-v1',14,'ref-v1')")
    pool = ConnectionPool(conninfo=canonical_db_env['read_dsn'], min_size=0, max_size=1,
                          open=True, kwargs={'autocommit': True})
    previous = main.app.dependency_overrides.get(main.get_repository)
    main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
    try:
        with TestClient(main.app) as client:
            url = '/api/territories/commune/29001/themes/habitat/facts'
            response = client.get(url)
            assert response.status_code == 200, response.text
            body = response.json()
            assert body['profile_content_version'] == 'profiles-v1'
            profile = body['profiles'][0]
            assert profile['indicator'] == 'distribution_dpe'
            assert [(cell['detail'], cell['sex']) for cell in profile['cells']] == [(detail, None) for detail in 'ABCDEFG']
            assert profile['cells'][6]['value'] == 0.4
            assert profile['cells'][0]['sources'][0]['version'] == '2024'
            assert {axis['name'] for axis in profile['axes']} == {'detail'}
            assert profile['comparison_scalar'] == 'part_passoires'
            assert 'comparison' not in profile and '29002' not in response.text
            legacy = client.get('/api/territories/commune/29001/profiles/distribution_dpe')
            assert legacy.status_code == 200, legacy.text
            assert legacy.json()['comparison']['indicator'] == 'part_passoires'
            assert legacy.json()['comparison']['values'][0]['value'] == 0.3
            comparison_url = '/api/territories/commune/29001/themes/comparison'
            selection = {'theme_id': 'habitat', 'selection': [{'territory_type': 'commune', 'territory_id': '29002'}]}
            compared = client.post(comparison_url, json=selection)
            assert compared.status_code == 200
            assert compared.json()['profile_content_version'] == 'profiles-v1'
            assert compared.json()['profile_comparisons'] == [{'indicator': 'distribution_dpe', 'comparison_scalar': 'part_passoires'}]
            assert compared.json()['results'][0]['median'] == 0.1
            with psycopg.connect(canonical_db_env['publish_dsn'], autocommit=True) as conn:
                conn.execute("UPDATE table_publication SET content_version='scalar-v2' WHERE table_name='scalar_observation'")
            assert client.get(url).status_code == 503
            assert client.get('/api/territories/commune/29001/profiles/distribution_dpe').status_code == 503
            assert client.post(comparison_url, json=selection).status_code == 503
            with psycopg.connect(canonical_db_env['publish_dsn'], autocommit=True) as conn:
                conn.execute("UPDATE table_publication SET content_version='scalar-v1' WHERE table_name='scalar_observation'")
                conn.execute("DELETE FROM profile_observation_source WHERE territory_id='29001' AND detail_key='A'")
            assert client.get(url).status_code == 503
            assert client.get('/api/territories/commune/29001/profiles/distribution_dpe').status_code == 503
            with psycopg.connect(canonical_db_env['publish_dsn'], autocommit=True) as conn:
                conn.execute("INSERT INTO profile_observation_source VALUES ('distribution_dpe','29001','A','','dpe','v1')")
                conn.execute("DELETE FROM profile_observation WHERE territory_id='29001' AND detail_key='G'")
            assert client.get(url).status_code == 503
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous
        pool.close()


def _test_dsns():
    publisher = os.environ.get("LUSK_TEST_PUBLISH_DSN")
    reader = os.environ.get("LUSK_TEST_READ_DSN")
    name = os.environ.get("LUSK_TEST_DATABASE_NAME", "")
    if not publisher or not reader:
        pytest.skip("requires explicit LUSK_TEST_* PostgreSQL DSNs")
    if os.environ.get("LUSK_TEST_DATABASE_PREFIX") != "lusk_it_" or not name.startswith("lusk_it_"):
        pytest.fail("Refusing integration DB without exact lusk_it_ guard")
    if name.casefold() in {"lusk", "postgres", "template0", "template1"}:
        pytest.fail("Refusing production/default database")
    pub, read = urlsplit(publisher), urlsplit(reader)
    if pub.path.lstrip("/") != name or read.path.lstrip("/") != name:
        pytest.fail("Both DSNs must target LUSK_TEST_DATABASE_NAME")
    if pub.hostname != read.hostname or pub.port != read.port or pub.username == read.username:
        pytest.fail("Use distinct roles on the same explicitly named test server")
    return publisher, reader, read.username


@pytest.mark.parametrize('installation', ['fresh', 'upgrade'])
def test_declared_profile_postgres_api_contract(installation):
    import psycopg
    from fastapi.testclient import TestClient
    from psycopg_pool import ConnectionPool
    from api import main

    publisher_dsn, reader_dsn, reader_role = _test_dsns()
    schema = "profile_api_it_" + uuid.uuid4().hex[:16]
    schema_file = Path(__file__).resolve().parents[2] / "schema.sql"
    territory = "api" + uuid.uuid4().hex[:12]
    peer = territory + "p"
    created = False
    pool = None
    previous = main.app.dependency_overrides.get(main.get_repository)
    try:
        with psycopg.connect(publisher_dsn, autocommit=True) as conn:
            conn.execute(f'CREATE SCHEMA "{schema}"')
            created = True
            conn.execute(f'SET search_path TO "{schema}"')
            if installation == 'upgrade':
                import subprocess
                previous_schema = subprocess.check_output(
                    ['git', 'show', '298831504f1a755d0f83fe919e9999616c98e8ce:api/schema.sql'],
                    cwd=schema_file.parent, text=True, encoding='utf-8')
                conn.execute(previous_schema)
            else:
                conn.execute(schema_file.read_text(encoding="utf-8"))
            role = '"' + reader_role.replace('"', '""') + '"'
            conn.execute(f'GRANT USAGE ON SCHEMA "{schema}" TO {role}')
            conn.execute(f'GRANT SELECT ON ALL TABLES IN SCHEMA "{schema}" TO {role}')
            conn.execute("""INSERT INTO territory_reference(territory_id,territory_type,name,department_id,epci_id)
                VALUES (%s,'commune','Focal','29','E1'),(%s,'commune','Peer','29','E1'),
                       (%s,'commune','Other department','22','E2')""", (territory, peer, territory + 'x'))
            conn.execute("INSERT INTO table_publication(table_name,content_version,row_count) VALUES ('territory_reference','ref-v1',3)")
            conn.execute("""INSERT INTO profile_descriptor(indicator_id,label,unit,allowed_levels,completeness,descriptor_version,comparison_detail,comparison_sex,comparison_direction) VALUES
                ('structure_age','Structure par âge','%',ARRAY['commune'],'dense_complete','fixture-v1','15-29','F','high')""")
            conn.execute("""INSERT INTO profile_axis(indicator_id,axis_name,axis_key,label,ordinal) VALUES
                ('structure_age','detail','15-29','15 à 29 ans',0),
                ('structure_age','detail','0-14','Moins de 15 ans',1),
                ('structure_age','sex','F','Femmes',0),('structure_age','sex','M','Hommes',1)""")
            conn.execute("INSERT INTO source_dataset VALUES ('age_detail','INSEE fixture')")
            conn.execute("INSERT INTO source_vintage VALUES ('age_detail','v1','2023','2023-01-01',NULL)")
            conn.execute("INSERT INTO profile_descriptor_source VALUES ('structure_age','age_detail')")
            for tid, vals in ((territory, (.2,.3,.4,.5)), (peer, (.6,.7,.8,.9))):
                for detail, sex, value in zip(('15-29','15-29','0-14','0-14'), ('F','M','F','M'), vals):
                    conn.execute("INSERT INTO profile_observation(indicator_id,territory_id,territory_type,detail_key,sex_key,value,status) VALUES ('structure_age',%s,'commune',%s,%s,%s,'measured')", (tid,detail,sex,value))
                    conn.execute("INSERT INTO profile_observation_source VALUES ('structure_age',%s,%s,%s,'age_detail','v1')", (tid,detail,sex))
            conn.execute("INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version) VALUES ('declared_profile','profile-v1',8,'ref-v1')")
            if installation == 'upgrade':
                # Rehearse expansion over a populated age profile and unchanged
                # marker, not only a fresh empty schema.
                conn.execute((schema_file.parent / 'migrations/013_profile_optional_axis.sql').read_text(encoding='utf-8'))
                conn.execute((schema_file.parent / 'migrations/014_profile_axis_units.sql').read_text(encoding='utf-8'))

        scoped = reader_dsn + ("&" if "?" in reader_dsn else "?") + "options=" + __import__('urllib.parse').parse.quote(f"-csearch_path={schema}")
        pool = ConnectionPool(conninfo=scoped, min_size=0, max_size=1, open=True, kwargs={"autocommit": True})
        main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
        with TestClient(main.app) as client:
            base = f"/api/territories/commune/{territory}/profiles/structure_age"
            # Local comparison universes must be explicit; silently treating a
            # missing id as Bretagne would claim a narrower cohort than queried.
            for query in (
                "?comparison_scope=departement",
                "?comparison_scope=epci",
                "?comparison_scope=bretagne&comparison_scope_id=29",
            ):
                assert client.get(base + query).status_code == 422
            assert client.get(
                f"/api/territories/epci/{territory}/profiles/structure_age?comparison_scope=departement"
            ).status_code == 422
            response = client.get(base + "?comparison_scope=departement&comparison_scope_id=29")
            assert response.status_code == 200, response.text
            body = response.json()
            assert [(c["detail"], c["sex"]) for c in body["cells"]] == [
                ("15-29", "F"), ("15-29", "M"), ("0-14", "F"), ("0-14", "M")]
            assert body["cells"][0]["value"] == pytest.approx(.2)
            assert body["comparison"] == {
                "detail": "15-29", "sex": "F", "direction": "high", "scope": "departement",
                "scope_id": "29", "values": [
                    {"territory_id": territory, "name": "Focal", "value": .2, "status": "measured"},
                    {"territory_id": peer, "name": "Peer", "value": .6, "status": "measured"}]}
            assert body["sources"] == [{"source_id":"age_detail","name":"INSEE fixture","version":"2023",
                "reference_date":"2023-01-01","publication_date":None}]
            for scope, valid_id, invalid_ids in (
                ("departement", "29", ("22", "999")),
                ("epci", "E1", ("E2", "missing")),
            ):
                assert client.get(base + f"?comparison_scope={scope}&comparison_scope_id={valid_id}").status_code == 200
                for invalid_id in invalid_ids:
                    invalid = client.get(base + f"?comparison_scope={scope}&comparison_scope_id={invalid_id}")
                    assert invalid.status_code == 422, invalid.text
            with psycopg.connect(publisher_dsn, autocommit=True) as conn:
                conn.execute(f'SET search_path TO "{schema}"')
                conn.execute("UPDATE table_publication SET reference_content_version='stale' WHERE table_name='declared_profile'")
            unavailable = client.get(base)
            assert unavailable.status_code == 503
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous
        if pool is not None:
            pool.close()
        # The test schema is uniquely random and dropped only under the harness's
        # explicit cleanup opt-in; CASCADE cannot reach shared/public objects.
        if created and os.environ.get("LUSK_TEST_ALLOW_SCHEMA_CLEANUP") == "1":
            with psycopg.connect(publisher_dsn, autocommit=True) as conn:
                conn.execute(f'DROP SCHEMA "{schema}" CASCADE')
