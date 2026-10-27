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
            response = client.post('/api/resources/read', json={
                "resource": "distribution_dpe",
                "target": {"kind": "territory", "type": "commune", "id": "29001"},
                "intent": {"kind": "facts"},
            })
        assert response.status_code == 503
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous
        pool.close()


def test_dpe_theme_read_is_focal_only_and_pins_scalar_snapshot(canonical_db_env, monkeypatch):
    import psycopg
    from fastapi.testclient import TestClient
    from psycopg_pool import ConnectionPool
    from api import main

    with psycopg.connect(canonical_db_env['publish_dsn']) as conn:
        conn.execute("""INSERT INTO territory_reference(territory_id,territory_type,name,epci_id,density_class_code,density_class_label)
            VALUES ('29001','commune','Focal','E1','D1','Dense'),('29002','commune','Peer','E1','D1','Dense'),
                   ('29003','commune','Other density','E2','D2','Rural')""")
        conn.execute("INSERT INTO territory_reference(territory_id,territory_type,name) VALUES ('E1','epci','Fixture EPCI'),('E2','epci','Other EPCI')")
        conn.execute("INSERT INTO table_publication(table_name,content_version,row_count) VALUES ('territory_reference','ref-v1',5)")
        conn.execute("INSERT INTO source_dataset VALUES ('dpe','DPE fixture')")
        conn.execute("INSERT INTO source_vintage(source_id,vintage_id,version) VALUES ('dpe','v1','2024')")
        conn.execute("""INSERT INTO scalar_descriptor(indicator_id,theme_id,label,unit,direction,comparison_facet,allowed_levels,denominator_semantics,completeness,descriptor_version)
            VALUES ('part_passoires','habitat','Passoires','%','low','part_passoires',ARRAY['commune'],'diagnostics','sparse','scalar-d1')""")
        conn.execute("INSERT INTO scalar_descriptor_source VALUES ('part_passoires','dpe')")
        conn.execute("""INSERT INTO scalar_observation(indicator_id,territory_id,territory_type,value,status) VALUES
            ('part_passoires','29001','commune',0.3,'measured'),('part_passoires','29002','commune',0.1,'measured')""")
        conn.execute("INSERT INTO scalar_observation_source VALUES ('part_passoires','29001','dpe','v1'),('part_passoires','29002','dpe','v1')")
        conn.execute("INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version) VALUES ('scalar_observation','scalar-v1',2,'ref-v1')")
        conn.execute("""INSERT INTO scalar_comparison_publication(singleton,content_version,scalar_content_version,
            reference_content_version,group_row_count,territory_row_count,lineage_row_count)
            VALUES (true,'scalar-comparison-v1','scalar-v1','ref-v1',2,4,2)""")
        conn.execute("""INSERT INTO scalar_comparison_group(comparison_context,group_id,territory_type,indicator_id,
            statistic,median,member_count,eligible_count,missing_count,lineage_source_count)
            VALUES ('density_class','D1','commune','part_passoires','median',0.2,2,2,0,1),
                   ('epci','E1','commune','part_passoires','median',0.2,2,2,0,1)""")
        conn.execute("""INSERT INTO comparison_source_lineage(comparison_family,comparison_context,group_id,
            territory_type,facet_id,source_id,vintage_id,comparison_content_version) VALUES
            ('scalar','density_class','D1','commune','part_passoires','dpe','v1','scalar-comparison-v1'),
            ('scalar','epci','E1','commune','part_passoires','dpe','v1','scalar-comparison-v1')""")
        conn.execute("""INSERT INTO scalar_comparison_territory(comparison_context,group_id,territory_type,indicator_id,
            territory_id,value,status,rank,tie_count,rank_size)
            VALUES ('density_class','D1','commune','part_passoires','29001',0.3,'measured',2,1,2),
                   ('density_class','D1','commune','part_passoires','29002',0.1,'measured',1,1,2),
                   ('epci','E1','commune','part_passoires','29001',0.3,'measured',2,1,2),
                   ('epci','E1','commune','part_passoires','29002',0.1,'measured',1,1,2)""")
        conn.execute("""INSERT INTO profile_descriptor(indicator_id,theme_id,label,unit,allowed_levels,completeness,descriptor_version,
            comparison_detail,comparison_sex,comparison_direction,comparison_scalar,required_scalar_version) VALUES
            ('distribution_dpe','habitat','DPE','%',ARRAY['commune'],'dense_complete','dpe-d1',NULL,NULL,'low','part_passoires','scalar-v1')""")
        conn.execute("INSERT INTO profile_descriptor_source VALUES ('distribution_dpe','dpe')")
        for ordinal, detail in enumerate('ABCDEFG'):
            conn.execute("INSERT INTO profile_axis(indicator_id,axis_name,axis_key,label,ordinal) VALUES ('distribution_dpe','detail',%s,%s,%s)", (detail, detail, ordinal))
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
        from contextlib import contextmanager
        counts = {"connections": 0, "transactions": 0}

        class CountedConnection:
            def __init__(self, connection):
                self.connection = connection

            def __getattr__(self, name):
                return getattr(self.connection, name)

            @contextmanager
            def transaction(self, *args, **kwargs):
                counts["transactions"] += 1
                with self.connection.transaction(*args, **kwargs) as tx:
                    yield tx

        class CountedPool:
            @contextmanager
            def connection(self):
                counts["connections"] += 1
                with pool.connection() as conn:
                    yield CountedConnection(conn)

        main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(CountedPool())
        original_focal_profiles = main.focal_profiles
        wrote_concurrently = False

        def mutate_after_profile_read(conn, *args, **kwargs):
            nonlocal wrote_concurrently
            result = original_focal_profiles(conn, *args, **kwargs)
            if not wrote_concurrently and kwargs.get("theme_id") == "habitat":
                wrote_concurrently = True
                with psycopg.connect(canonical_db_env['publish_dsn'], autocommit=True) as writer:
                    with writer.transaction():
                        writer.execute("UPDATE scalar_observation SET value=0.7 WHERE indicator_id='part_passoires' AND territory_id='29001'")
                        writer.execute("UPDATE table_publication SET content_version='scalar-v2' WHERE table_name='scalar_observation'")
                        writer.execute("UPDATE profile_descriptor SET required_scalar_version='scalar-v2' WHERE indicator_id='distribution_dpe'")
                        writer.execute("UPDATE table_publication SET content_version='profiles-v2' WHERE table_name='declared_profile'")
            return result

        monkeypatch.setattr(main, "focal_profiles", mutate_after_profile_read)
        with TestClient(main.app) as client:
            url = '/api/territories/commune/29001/themes/habitat/facts'
            response = client.get(url)
            assert response.status_code == 200, response.text
            body = response.json()
            assert counts == {"connections": 1, "transactions": 1}
            assert wrote_concurrently
            assert body['content_version'] == 'scalar-v1'
            assert body['profile_content_version'] == 'profiles-v1'
            assert next(row for row in body['indicators'] if row['indicator_id'] == 'part_passoires')['value'] == 0.3
            assert body['default_comparison']['results'][0]['median'] == 0.2
            with psycopg.connect(canonical_db_env['publish_dsn'], autocommit=True) as writer:
                with writer.transaction():
                    writer.execute("UPDATE scalar_observation SET value=0.3 WHERE indicator_id='part_passoires' AND territory_id='29001'")
                    writer.execute("UPDATE table_publication SET content_version='scalar-v1' WHERE table_name='scalar_observation'")
                    writer.execute("UPDATE profile_descriptor SET required_scalar_version='scalar-v1' WHERE indicator_id='distribution_dpe'")
                    writer.execute("UPDATE table_publication SET content_version='profiles-v1' WHERE table_name='declared_profile'")
            monkeypatch.setattr(main, "focal_profiles", original_focal_profiles)
            counts.update(connections=0, transactions=0)
            main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
            response = client.get(url)
            assert response.status_code == 200, response.text
            body = response.json()
            assert body['profile_content_version'] == 'profiles-v1'
            profile = [row for row in body['indicators'] if row['indicator_id'] == 'distribution_dpe']
            profile_metadata = next(row for row in body['indicator_metadata']
                                    if row['indicator_id'] == 'distribution_dpe')
            assert [(row['dimensions']['detail'], row['dimensions'].get('sex')) for row in profile] == [(detail, None) for detail in 'ABCDEFG']
            assert profile[6]['value'] == 0.4
            assert profile[0]['sources'][0]['version'] == '2024'
            assert [(axis['name'], axis['key'], axis['order']) for axis in profile_metadata['axes']] == [
                ('detail', detail, order) for order, detail in enumerate('ABCDEFG')]
            assert profile_metadata['comparison_scalar'] == 'part_passoires'
            assert all('comparison' not in row for row in profile) and '29002' not in response.text
            assert body['default_comparison']['results'][0]['median'] == 0.2
            dpe_comparison = body['default_comparison']['profile_comparisons'][0]
            assert dpe_comparison['indicator'] == 'distribution_dpe'
            assert dpe_comparison['facet'] == 'part_passoires'
            assert dpe_comparison['median'] == 0.2
            assert dpe_comparison['eligible_count'] == 2
            assert len(dpe_comparison['comparison_sources']) == 1
            legacy = client.get('/api/territories/commune/29001/profiles/distribution_dpe')
            assert legacy.status_code == 200, legacy.text
            assert legacy.json()['comparison']['indicator'] == 'part_passoires'
            assert legacy.json()['comparison']['values'][0]['value'] == 0.3
            # The stable indicator-name URL resolves the producer-declared shape;
            # callers do not need a separate profile URL or a key allowlist.
            counts.update(connections=0, transactions=0)
            main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(CountedPool())
            named_profile = client.get('/api/territories/commune/29001/indicators/distribution_dpe')
            assert named_profile.status_code == 200, named_profile.text
            assert counts == {"connections": 1, "transactions": 1}
            main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
            assert named_profile.json()['indicator'] == 'distribution_dpe'
            assert [cell['detail'] for cell in named_profile.json()['cells']] == list('ABCDEFG')
            assert '29002' not in named_profile.text
            assert named_profile.json()['default_comparison']['results'][0]['median'] == 0.2
            counts.update(connections=0, transactions=0)
            main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(CountedPool())
            named_scalar = client.get('/api/territories/commune/29001/indicators/part_passoires')
            assert named_scalar.status_code == 200, named_scalar.text
            assert counts == {"connections": 1, "transactions": 1}
            main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
            assert named_scalar.json()['value'] == 0.3
            assert '29002' not in named_scalar.text
            assert named_scalar.json()['indicator_id'] == 'part_passoires'
            counts.update(connections=0, transactions=0)
            main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(CountedPool())
            scalar_comparison = client.post(
                '/api/territories/commune/29001/indicators/part_passoires/comparison')
            assert scalar_comparison.status_code == 200, scalar_comparison.text
            assert counts == {"connections": 1, "transactions": 1}
            main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
            assert scalar_comparison.json()['result']['median'] == 0.2
            assert scalar_comparison.json()['result']['unit'] == '%'
            assert scalar_comparison.json()['result']['comparison_sources'][0]['source_id'] == 'dpe'
            counts.update(connections=0, transactions=0)
            main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(CountedPool())
            profile_comparison = client.post(
                '/api/territories/commune/29001/indicators/distribution_dpe/comparison',
                json={'selection': [{'territory_type':'commune','territory_id':'29002'}]})
            assert profile_comparison.status_code == 200, profile_comparison.text
            assert counts == {"connections": 1, "transactions": 1}
            main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
            assert profile_comparison.json()['result']['source_facet_indicator_id'] == 'part_passoires'
            assert profile_comparison.json()['result']['required_scalar_version'] == 'scalar-v1'
            comparison_url = '/api/territories/commune/29001/themes/comparison'
            selection = {'theme_id': 'habitat', 'selection': [{'territory_type': 'commune', 'territory_id': '29002'}]}
            compared = client.post(comparison_url, json=selection)
            assert compared.status_code == 200
            assert compared.json()['profile_content_version'] == 'profiles-v1'
            profile_result = compared.json()['profile_comparisons'][0]
            assert profile_result['indicator'] == 'distribution_dpe'
            assert profile_result['facet'] == 'part_passoires'
            assert profile_result['status'] == 'unavailable'
            assert profile_result['reason'] == 'fewer_than_two_comparable_values'
            assert profile_result['median'] is None
            assert profile_result['eligible_count'] == 1
            assert profile_result['focal_in_selection'] is False
            assert profile_result['focal_value'] == 0.3
            assert profile_result['rank'] is None
            assert '29001' not in compared.text
            assert compared.json()['results'][0]['median'] == 0.1
            mixed_group = client.post(comparison_url, json={'theme_id':'habitat','selection':[
                {'territory_type':'epci','territory_id':'E1'},
                {'territory_type':'commune','territory_id':'29002'}]})
            assert mixed_group.status_code == 200, mixed_group.text
            mixed_profile_result = mixed_group.json()['profile_comparisons'][0]
            assert mixed_profile_result['eligible_count'] == 2
            assert mixed_profile_result['selected_member_count'] == 2
            assert mixed_profile_result['median'] == 0.2

            # A scalar-backed profile comparison consumes the scalar comparison
            # publication only. An unrelated declared detail profile in the
            # same theme must neither require the profile comparison marker nor
            # appear in this indicator-scoped reader.
            with psycopg.connect(canonical_db_env['publish_dsn'], autocommit=True) as writer:
                writer.execute("""INSERT INTO profile_descriptor(indicator_id,theme_id,label,unit,allowed_levels,
                    completeness,descriptor_version,comparison_detail,comparison_direction)
                    VALUES ('unrelated_detail_fixture','habitat','Unrelated detail','u',ARRAY['commune'],
                    'dense_complete','detail-v1','value','high')""")
                assert writer.execute("SELECT count(*) FROM profile_comparison_publication").fetchone()[0] == 0
            dpe_single = client.post(
                '/api/territories/commune/29001/indicators/distribution_dpe/comparison')
            dpe_batch = client.post('/api/read-batch', json={'items': [{
                'id': 'dpe-comparison', 'resource': 'indicator_comparison',
                'territory_type': 'commune', 'territory_id': '29001',
                'indicator_id': 'distribution_dpe'}]})
            assert dpe_single.status_code == dpe_batch.status_code == 200, (dpe_single.text, dpe_batch.text)
            assert dpe_batch.json()['results'][0]['data'] == dpe_single.json()
            with psycopg.connect(canonical_db_env['publish_dsn'], autocommit=True) as conn:
                conn.execute("UPDATE table_publication SET content_version='scalar-v2' WHERE table_name='scalar_observation'")
            assert client.get(url).status_code == 503
            assert client.get('/api/territories/commune/29001/profiles/distribution_dpe').status_code == 503
            assert client.post(comparison_url, json=selection).status_code == 503
            assert client.post('/api/territories/commune/29001/indicators/distribution_dpe/comparison').status_code == 503
            with psycopg.connect(canonical_db_env['publish_dsn'], autocommit=True) as conn:
                conn.execute("UPDATE table_publication SET content_version='scalar-v1' WHERE table_name='scalar_observation'")
                conn.execute("DELETE FROM profile_observation_source WHERE territory_id='29001' AND detail_key='A'")
            assert client.get(url).status_code == 503
            assert client.get('/api/territories/commune/29001/profiles/distribution_dpe').status_code == 503
            assert client.post('/api/territories/commune/29001/indicators/distribution_dpe/comparison').status_code == 503
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
    reader_provider = main.get_semantic_resource_reader
    previous_reader = main.app.dependency_overrides.get(reader_provider)
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
            conn.execute("""INSERT INTO territory_reference(territory_id,territory_type,name,department_id,epci_id,
                density_class_code,density_class_label)
                VALUES (%s,'commune','Focal','29','E1','D1','Dense'),
                       (%s,'commune','Peer','29','E1','D1','Dense'),
                       (%s,'commune','Other department','22','E2','D2','Rural'),
                       (%s,'commune','No density','29','E1',NULL,NULL)""", (territory, peer, territory + 'x', territory + 'n'))
            conn.execute("INSERT INTO territory_reference(territory_id,territory_type,name) VALUES ('E1','epci','Fixture EPCI')")
            conn.execute("INSERT INTO table_publication(table_name,content_version,row_count) VALUES ('territory_reference','ref-v1',5)")
            conn.execute("BEGIN")
            conn.execute("INSERT INTO source_dataset VALUES ('indicator_fixture','Indicator fixture')")
            conn.execute("INSERT INTO source_vintage VALUES ('indicator_fixture','v1','2026',NULL,NULL)")
            conn.execute("""INSERT INTO scalar_descriptor(indicator_id,theme_id,label,unit,direction,comparison_facet,
                allowed_levels,denominator_semantics,completeness,descriptor_version) VALUES
                ('habitat_fixture','habitat','Habitat fixture','%','high','habitat_fixture',ARRAY['commune'],
                'fixture','sparse','scalar-fixture-v1')""")
            conn.execute("INSERT INTO scalar_descriptor_source VALUES ('habitat_fixture','indicator_fixture')")
            for tid, value in ((territory, .2), (peer, .6), (territory + 'x', .9), (territory + 'n', .5)):
                conn.execute("INSERT INTO scalar_observation(indicator_id,territory_id,territory_type,value,status) VALUES ('habitat_fixture',%s,'commune',%s,'measured')", (tid,value))
                conn.execute("INSERT INTO scalar_observation_source VALUES ('habitat_fixture',%s,'indicator_fixture','v1')", (tid,))
            conn.execute("INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version) VALUES ('scalar_observation','scalar-fixture-v1',4,'ref-v1')")
            if installation == 'fresh':
                conn.execute("""INSERT INTO scalar_comparison_publication(singleton,content_version,scalar_content_version,
                    reference_content_version,group_row_count,territory_row_count,lineage_row_count)
                    VALUES (true,'scalar-comparison-v1','scalar-fixture-v1','ref-v1',1,2,0)""")
                conn.execute("""INSERT INTO scalar_comparison_group(comparison_context,group_id,territory_type,
                    indicator_id,statistic,median,member_count,eligible_count,missing_count,lineage_source_count)
                    VALUES ('density_class','D1','commune','habitat_fixture','median',.4,2,2,0,0)""")
                conn.execute("""INSERT INTO scalar_comparison_territory(comparison_context,group_id,territory_type,
                    indicator_id,territory_id,value,status,rank,tie_count,rank_size) VALUES
                    ('density_class','D1','commune','habitat_fixture',%s,.2,'measured',2,1,2),
                    ('density_class','D1','commune','habitat_fixture',%s,.6,'measured',1,1,2)""", (territory, peer))
            conn.execute("COMMIT")
            profile_insert = """INSERT INTO profile_descriptor(indicator_id,label,unit,allowed_levels,completeness,descriptor_version,comparison_detail,comparison_sex,comparison_direction) VALUES
                    ('structure_age','Structure par âge','%',ARRAY['commune'],'dense_complete','fixture-v1','<15','F','high')"""
            if installation == 'fresh':
                profile_insert = """INSERT INTO profile_descriptor(indicator_id,theme_id,label,unit,allowed_levels,completeness,descriptor_version,comparison_detail,comparison_sex,comparison_direction) VALUES
                        ('structure_age','demographie','Structure par âge','%',ARRAY['commune'],'dense_complete','fixture-v1','<15','F','high')"""
            conn.execute(profile_insert)
            conn.execute("""INSERT INTO profile_axis(indicator_id,axis_name,axis_key,label,ordinal) VALUES
                ('structure_age','detail','<15','Moins de 15 ans',0),
                ('structure_age','detail','15-24','15 à 24 ans',1),
                ('structure_age','sex','F','Femmes',0),('structure_age','sex','M','Hommes',1)""")
            conn.execute("INSERT INTO source_dataset VALUES ('age_detail','INSEE fixture')")
            conn.execute("INSERT INTO source_vintage VALUES ('age_detail','v1','2023','2023-01-01',NULL)")
            conn.execute("INSERT INTO profile_descriptor_source VALUES ('structure_age','age_detail')")
            for tid, vals in ((territory, (.2,.3,.4,.5)), (peer, (.6,.7,.8,.9))):
                for detail, sex, value in zip(('<15','<15','15-24','15-24'), ('F','M','F','M'), vals):
                    conn.execute("INSERT INTO profile_observation(indicator_id,territory_id,territory_type,detail_key,sex_key,value,status) VALUES ('structure_age',%s,'commune',%s,%s,%s,'measured')", (tid,detail,sex,value))
                    conn.execute("INSERT INTO profile_observation_source VALUES ('structure_age',%s,%s,%s,'age_detail','v1')", (tid,detail,sex))
            conn.execute("INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version) VALUES ('declared_profile','profile-v1',8,'ref-v1')")
            if installation == 'upgrade':
                # Rehearse expansion over a populated age profile and unchanged
                # marker, not only a fresh empty schema.
                conn.execute((schema_file.parent / 'migrations/013_profile_optional_axis.sql').read_text(encoding='utf-8'))
                conn.execute("UPDATE profile_descriptor SET theme_id='demographie' WHERE indicator_id='structure_age'")
                unit_migration = schema_file.parent / 'migrations/014_profile_axis_units.sql'
                if unit_migration.exists():
                    conn.execute(unit_migration.read_text(encoding='utf-8'))
            conn.execute("INSERT INTO source_dataset VALUES ('one_axis_source','One axis fixture')")
            conn.execute("INSERT INTO source_vintage VALUES ('one_axis_source','v1','2025',NULL,NULL)")
            has_axis_units = conn.execute("""SELECT EXISTS(SELECT 1 FROM information_schema.columns
                WHERE table_schema=current_schema() AND table_name='profile_axis' AND column_name='unit')""").fetchone()[0]
            if has_axis_units:
                conn.execute("""INSERT INTO profile_descriptor(indicator_id,theme_id,label,unit,allowed_levels,completeness,
                    descriptor_version,comparison_detail,comparison_sex,comparison_direction,denominator_semantics,
                    detail_units_required) VALUES ('one_axis_fixture','demographie','One axis','km',ARRAY['commune'],
                    'dense_complete','one-axis-v1','length',NULL,'low','fixture length',true)""")
            else:
                conn.execute("""INSERT INTO profile_descriptor(indicator_id,theme_id,label,unit,allowed_levels,completeness,
                    descriptor_version,comparison_detail,comparison_sex,comparison_direction) VALUES
                    ('one_axis_fixture','demographie','One axis','km',ARRAY['commune'],'dense_complete',
                     'one-axis-v1','length',NULL,'low')""")
            conn.execute("INSERT INTO profile_descriptor_source VALUES ('one_axis_fixture','one_axis_source')")
            if has_axis_units:
                conn.execute("INSERT INTO profile_axis(indicator_id,axis_name,axis_key,label,ordinal,unit) VALUES ('one_axis_fixture','detail','length','Length',0,'km')")
            else:
                conn.execute("INSERT INTO profile_axis(indicator_id,axis_name,axis_key,label,ordinal) VALUES ('one_axis_fixture','detail','length','Length',0)")
            for tid, value in ((territory, .9), (peer, .9)):
                conn.execute("""INSERT INTO profile_observation(indicator_id,territory_id,territory_type,detail_key,
                    sex_key,sex_axis_name,value,status) VALUES ('one_axis_fixture',%s,'commune','length','',NULL,%s,'measured')""",
                    (tid,value))
                conn.execute("INSERT INTO profile_observation_source VALUES ('one_axis_fixture',%s,'length','','one_axis_source','v1')",
                    (tid,))
            conn.execute("""INSERT INTO profile_observation(indicator_id,territory_id,territory_type,detail_key,
                sex_key,sex_axis_name,value,status) VALUES
                    ('structure_age',%s,'commune','<15','F','sex',NULL,'not_available'),
                    ('structure_age',%s,'commune','<15','M','sex',NULL,'not_available'),
                    ('structure_age',%s,'commune','15-24','F','sex',NULL,'not_available'),
                    ('structure_age',%s,'commune','15-24','M','sex',NULL,'not_available'),
                ('one_axis_fixture',%s,'commune','length','',NULL,NULL,'not_available')""",
                (territory + 'n', territory + 'n', territory + 'n', territory + 'n', territory + 'n'))
            conn.execute("""INSERT INTO profile_observation_source VALUES
                    ('structure_age',%s,'<15','F','age_detail','v1'),
                    ('structure_age',%s,'<15','M','age_detail','v1'),
                    ('structure_age',%s,'15-24','F','age_detail','v1'),
                    ('structure_age',%s,'15-24','M','age_detail','v1'),
                ('one_axis_fixture',%s,'length','','one_axis_source','v1')""",
                (territory + 'n', territory + 'n', territory + 'n', territory + 'n', territory + 'n'))
            conn.execute("UPDATE table_publication SET row_count=row_count+7 WHERE table_name='declared_profile'")
            conn.execute("UPDATE table_publication SET reference_content_version='ref-v1' WHERE table_name='declared_profile'")
            if installation == 'fresh':
                conn.execute("""INSERT INTO profile_comparison_group(comparison_context,group_id,territory_type,
                    indicator_id,detail_key,sex_key,statistic,median,member_count,eligible_count,missing_count,
                    lineage_source_count,profile_content_version,reference_content_version) VALUES
                        ('density_class','D1','commune','structure_age','<15','F','median',.4,2,2,0,0,'profile-v1','ref-v1'),
                    ('density_class','D1','commune','one_axis_fixture','length','','median',.9,2,2,0,0,'profile-v1','ref-v1'),
                        ('epci','E1','commune','structure_age','<15','F','median',.4,3,2,1,0,'profile-v1','ref-v1'),
                    ('epci','E1','commune','one_axis_fixture','length','','median',.9,3,2,1,0,'profile-v1','ref-v1')""")
                conn.execute("""INSERT INTO profile_comparison_territory(comparison_context,group_id,territory_type,
                    indicator_id,detail_key,sex_key,territory_id,value,status,rank,tie_count,rank_size,
                    profile_content_version,reference_content_version) VALUES
                        ('density_class','D1','commune','structure_age','<15','F',%s,.2,'measured',2,1,2,'profile-v1','ref-v1'),
                        ('density_class','D1','commune','structure_age','<15','F',%s,.6,'measured',1,1,2,'profile-v1','ref-v1'),
                    ('density_class','D1','commune','one_axis_fixture','length','',%s,.9,'measured',1,2,2,'profile-v1','ref-v1'),
                    ('density_class','D1','commune','one_axis_fixture','length','',%s,.9,'measured',1,2,2,'profile-v1','ref-v1'),
                        ('epci','E1','commune','structure_age','<15','F',%s,.2,'measured',2,1,2,'profile-v1','ref-v1'),
                        ('epci','E1','commune','structure_age','<15','F',%s,.6,'measured',1,1,2,'profile-v1','ref-v1'),
                    ('epci','E1','commune','one_axis_fixture','length','',%s,.9,'measured',1,2,2,'profile-v1','ref-v1'),
                    ('epci','E1','commune','one_axis_fixture','length','',%s,.9,'measured',1,2,2,'profile-v1','ref-v1'),
                        ('epci','E1','commune','structure_age','<15','F',%s,NULL,'not_available',NULL,NULL,NULL,'profile-v1','ref-v1'),
                    ('epci','E1','commune','one_axis_fixture','length','',%s,NULL,'not_available',NULL,NULL,NULL,'profile-v1','ref-v1')""",
                    (territory, peer, territory, peer, territory, peer, territory, peer, territory + 'n', territory + 'n'))
                conn.execute("""INSERT INTO profile_comparison_publication(singleton,content_version,
                    profile_content_version,reference_content_version,group_row_count,territory_row_count)
                    VALUES (true,'profile-comparison-v1','profile-v1','ref-v1',4,10)""")

        scoped = reader_dsn + ("&" if "?" in reader_dsn else "?") + "options=" + __import__('urllib.parse').parse.quote(f"-csearch_path={schema}")
        pool = ConnectionPool(conninfo=scoped, min_size=0, max_size=1, open=True, kwargs={"autocommit": True})
        main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
        with TestClient(main.app) as client:
            semantic_item = {
                "resource": "structure_age",
                "target": {"kind": "territory", "type": "commune", "id": territory},
                "fields": ["value"],
                "intent": {"kind": "facts"},
            }
            semantic_single = client.post("/api/resources/read", json=semantic_item)
            semantic_batch = client.post("/api/resources/read-batch", json={"items": [
                {"id": "age", **semantic_item},
            ]})
            assert semantic_single.status_code == semantic_batch.status_code == 200, (semantic_single.text, semantic_batch.text)
            semantic_data = semantic_batch.json()["results"][0]["data"]
            assert semantic_data == semantic_single.json()
            assert semantic_data["resource"] == "structure_age"
            assert semantic_data["target"] == semantic_item["target"]
            assert len(semantic_data["observations"]) == 4
            assert all("value" in observation and "status" in observation
                       for observation in semantic_data["observations"])
            changed_during_preflight = False

            def concurrent_reader_provider():
                reader = reader_provider()
                original_preflight = reader.preflight

                def concurrent_update_preflight(connection, item, catalogue=None, *, work_budget=200_000):
                    nonlocal changed_during_preflight
                    estimate = original_preflight(connection, item, catalogue, work_budget=work_budget)
                    if item.resource == "structure_age" and not changed_during_preflight:
                        with psycopg.connect(publisher_dsn) as writer:
                            writer.execute(f'SET search_path TO "{schema}"')
                            writer.execute("UPDATE profile_observation SET value=.9 WHERE territory_id=%s",
                                           (territory,))
                        changed_during_preflight = True
                    return estimate

                reader.preflight = concurrent_update_preflight
                return reader

            main.app.dependency_overrides[reader_provider] = concurrent_reader_provider
            try:
                snapshot_batch = client.post("/api/resources/read-batch", json={"items": [
                    {"id": "snapshot-a", **semantic_item},
                    {"id": "snapshot-b", **semantic_item},
                ]})
            finally:
                if previous_reader is None:
                    main.app.dependency_overrides.pop(reader_provider, None)
                else:
                    main.app.dependency_overrides[reader_provider] = previous_reader
                with psycopg.connect(publisher_dsn) as writer:
                    writer.execute(f'SET search_path TO "{schema}"')
                    writer.execute("""UPDATE profile_observation SET value=CASE
                        WHEN detail_key='<15' AND sex_key='F' THEN .2
                        WHEN detail_key='<15' AND sex_key='M' THEN .3
                        WHEN detail_key='15-24' AND sex_key='F' THEN .4
                        WHEN detail_key='15-24' AND sex_key='M' THEN .5
                        END WHERE indicator_id='structure_age' AND territory_id=%s""",
                                   (territory,))
            assert snapshot_batch.status_code == 200, snapshot_batch.text
            snapshot_values = [observation["value"]
                for result in snapshot_batch.json()["results"]
                for observation in result["data"]["observations"]]
            initial_profile_values = [observation["value"] for observation in semantic_data["observations"]]
            assert snapshot_values == initial_profile_values * 2
            if installation == 'upgrade':
                return
            semantic_comparison_item = {
                "resource": "structure_age",
                "target": {"kind": "territory", "type": "commune", "id": territory},
                "fields": ["median", "eligible_count"],
                "intent": {"kind": "fixed_comparison", "context": "default"},
            }
            semantic_comparison = client.post("/api/resources/read", json=semantic_comparison_item)
            semantic_comparison_batch = client.post("/api/resources/read-batch", json={"items": [
                {"id": "age-comparison", **semantic_comparison_item},
            ]})
            assert semantic_comparison.status_code == semantic_comparison_batch.status_code == 200, (
                semantic_comparison.text, semantic_comparison_batch.text)
            comparison_payload = semantic_comparison_batch.json()["results"][0]["data"]
            assert comparison_payload == semantic_comparison.json()
            assert comparison_payload["result"]["median"] == pytest.approx(.4)
            assert comparison_payload["result"]["eligible_count"] == 2
            matching_fixed_coordinates = client.post("/api/resources/read", json={
                **semantic_comparison_item, "coordinates": {"detail": ["<15"], "sex": ["F"]},
            })
            assert matching_fixed_coordinates.status_code == 200, matching_fixed_coordinates.text
            assert matching_fixed_coordinates.json()["result"]["median"] == pytest.approx(.4)
            incompatible_fixed_coordinates = client.post("/api/resources/read", json={
                **semantic_comparison_item, "coordinates": {"detail": ["15-24"], "sex": ["M"]},
            })
            assert incompatible_fixed_coordinates.status_code == 422, incompatible_fixed_coordinates.text
            selected_comparison_item = {
                "resource": "structure_age",
                "target": {"kind": "territory", "type": "commune", "id": territory},
                "intent": {"kind": "selected_comparison", "members": [
                    {"type": "commune", "id": peer},
                ]},
            }
            selected_comparison = client.post("/api/resources/read", json=selected_comparison_item)
            assert selected_comparison.status_code == 200, selected_comparison.text
            assert selected_comparison.json()["selection"] == [
                {"territory_type": "commune", "territory_id": peer},
            ]
            # A selected profile facet is an actual coordinate selection, not
            # a filter applied to the descriptor's published default point.
            # The fixture deliberately makes this cell differ from <15 × F.
            selected_cell_item = {
                **selected_comparison_item,
                "fields": ["median", "rank", "rank_size", "rank_ties", "selected_member_count",
                           "eligible_count", "missing_count", "member_ranks"],
                "coordinates": {"detail": ["15-24"], "sex": ["M"]},
                "intent": {"kind": "selected_comparison", "members": [
                    {"type": "commune", "id": territory},
                    {"type": "commune", "id": peer},
                    {"type": "commune", "id": territory + "n"},
                ]},
            }
            with psycopg.connect(publisher_dsn) as witness:
                witness.execute(f'SET search_path TO "{schema}"')
                marker_before = witness.execute("""SELECT p.content_version,p.profile_content_version,
                    p.reference_content_version,p.group_row_count,p.territory_row_count,
                    d.content_version,t.content_version FROM profile_comparison_publication p
                    JOIN table_publication d ON d.table_name='declared_profile'
                    JOIN table_publication t ON t.table_name='territory_reference'
                    WHERE p.singleton""").fetchone()
            selected_cell = client.post("/api/resources/read", json=selected_cell_item)
            assert selected_cell.status_code == 200, selected_cell.text
            assert selected_cell.json()["selection"] == [
                {"territory_type": "commune", "territory_id": territory},
                {"territory_type": "commune", "territory_id": peer},
                {"territory_type": "commune", "territory_id": territory + "n"},
            ]
            selected_result = selected_cell.json()["result"]
            assert selected_result["status"] == "available"
            assert selected_result["source_facet"] == {"detail": "15-24", "sex": "M"}
            assert selected_result["unit"] == "%"
            assert selected_result["direction"] == "high"
            assert selected_result["median"] == pytest.approx(.7)
            assert selected_result["rank"] == 2
            assert selected_result["rank_size"] == 2
            assert selected_result["rank_ties"] == 1
            assert selected_result["selected_member_count"] == 3
            assert selected_result["eligible_count"] == 2
            assert selected_result["missing_count"] == 1
            assert {row["territory_id"]: {key: row[key] for key in ("rank", "rank_size", "rank_ties")}
                    for row in selected_result["member_ranks"]} == {
                territory: {"rank": 2, "rank_size": 2, "rank_ties": 1},
                peer: {"rank": 1, "rank_size": 2, "rank_ties": 1},
                territory + "n": {"rank": None, "rank_size": None, "rank_ties": None},
            }
            assert selected_result["comparison_sources"] == [{
                "source_id": "age_detail", "name": "INSEE fixture", "vintage_id": "v1",
                "version": "2023", "reference_date": "2023-01-01", "publication_date": None,
            }]
            multiple_coordinates = client.post("/api/resources/read", json={
                **selected_cell_item, "coordinates": {"detail": ["<15", "15-24"], "sex": ["M"]},
            })
            assert multiple_coordinates.status_code == 422
            incomplete_coordinates = client.post("/api/resources/read", json={
                **selected_cell_item, "coordinates": {"detail": ["15-24"]},
            })
            assert incomplete_coordinates.status_code == 422
            with psycopg.connect(publisher_dsn) as witness:
                witness.execute(f'SET search_path TO "{schema}"')
                marker_after = witness.execute("""SELECT p.content_version,p.profile_content_version,
                    p.reference_content_version,p.group_row_count,p.territory_row_count,
                    d.content_version,t.content_version FROM profile_comparison_publication p
                    JOIN table_publication d ON d.table_name='declared_profile'
                    JOIN table_publication t ON t.table_name='territory_reference'
                    WHERE p.singleton""").fetchone()
            assert marker_after == marker_before
            with psycopg.connect(publisher_dsn) as writer:
                writer.execute(f'SET search_path TO "{schema}"')
                writer.execute("""UPDATE profile_observation SET value=.5 WHERE indicator_id='structure_age'
                    AND detail_key='15-24' AND sex_key='M' AND territory_id=%s""", (peer,))
            with psycopg.connect(publisher_dsn) as witness:
                witness.execute(f'SET search_path TO "{schema}"')
                tie_marker_before = witness.execute("""SELECT p.content_version,p.profile_content_version,
                    p.reference_content_version,p.group_row_count,p.territory_row_count,
                    d.content_version,t.content_version FROM profile_comparison_publication p
                    JOIN table_publication d ON d.table_name='declared_profile'
                    JOIN table_publication t ON t.table_name='territory_reference'
                    WHERE p.singleton""").fetchone()
            tied_selected_cell = client.post("/api/resources/read", json={
                **selected_cell_item,
                "intent": {"kind": "selected_comparison", "members": [
                    {"type": "commune", "id": territory}, {"type": "commune", "id": peer},
                ]},
            })
            assert tied_selected_cell.status_code == 200, tied_selected_cell.text
            tied_result = tied_selected_cell.json()["result"]
            assert tied_result["median"] == pytest.approx(.5)
            assert tied_result["rank"] == 1
            assert tied_result["rank_ties"] == 2
            assert {row["territory_id"]: row["rank_ties"] for row in tied_result["member_ranks"]} == {
                territory: 2, peer: 2,
            }
            with psycopg.connect(publisher_dsn) as witness:
                witness.execute(f'SET search_path TO "{schema}"')
                tie_marker_after = witness.execute("""SELECT p.content_version,p.profile_content_version,
                    p.reference_content_version,p.group_row_count,p.territory_row_count,
                    d.content_version,t.content_version FROM profile_comparison_publication p
                    JOIN table_publication d ON d.table_name='declared_profile'
                    JOIN table_publication t ON t.table_name='territory_reference'
                    WHERE p.singleton""").fetchone()
            assert tie_marker_after == tie_marker_before
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
