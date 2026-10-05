"""Small real PostgreSQL -> HTTP JSON -> mounted Variant E assembly proof.

This fixture is synthetic. It does not replace accepted canonical producer parity.
"""
import json
import os
from pathlib import Path
import subprocess
import uuid

import pytest

from api.tests.integration.test_building_evidence_contract import _contracts, _schema_dsn
from api.tests.integration.test_building_fiche_publisher_http import _ConnectionProbePool

pytestmark = pytest.mark.integration
ROOT = Path(__file__).resolve().parents[3]


def insert(conn, table, **values):
    from psycopg import sql
    conn.execute(sql.SQL("INSERT INTO {} ({}) VALUES ({})").format(
        sql.Identifier(table), sql.SQL(',').join(map(sql.Identifier, values)),
        sql.SQL(',').join(sql.Placeholder() for _ in values)), tuple(values.values()))


def seed(conn):
    from psycopg.types.json import Jsonb
    model = json.loads((ROOT / 'public/data/modeles-lecture/territoires/commune/22001.json').read_text(encoding='utf-8'))
    theme = model['themes']['mobilite']
    epci = model['territory']['epci']
    for code, level, name in [('22001', 'commune', 'Gate focal'), ('22002', 'commune', 'Gate peer'),
                              ('53', 'region', 'Bretagne'), (epci, 'epci', 'Gate EPCI')]:
        insert(conn, 'territory_reference', territory_id=code, territory_type=level, name=name,
               department_id='22' if level == 'commune' else None, epci_id=epci if level == 'commune' else None,
               density_class_code='1', density_class_label='Gate density')
    insert(conn, 'source_dataset', source_id='snapshot', name='SQL gate source')
    insert(conn, 'source_vintage', source_id='snapshot', vintage_id='immutable-id', version='Gate display version',
           reference_date=None, publication_date=None)
    rows = theme['indicateurs']
    scalars = {r['key']: r for r in rows if not r.get('detail')}
    # Producer-owned reference and current service shares are explicit fixture facts.
    for key in ['nb_buildings'] + [f'share_{s}_{m}' for s in ['food','health','admin','school','bank'] for m in ['t','b','c']]:
        scalars.setdefault(key, dict(key=key, unit='bâtiments' if key == 'nb_buildings' else '%'))
    for key, row in scalars.items():
        insert(conn, 'scalar_descriptor', indicator_id=key, theme_id='mobilite', label=key, unit=row['unit'],
               direction='high', comparison_facet=key, allowed_levels=['commune','region'],
               denominator_semantics='published fixture', completeness='sparse', descriptor_version='gate-v1')
        insert(conn, 'scalar_descriptor_source', indicator_id=key, source_id='snapshot')
        for code in ['22001','22002'] + (['53'] if key == 'nb_buildings' else []):
            value = 9876 if code == '53' else 120 if key == 'nb_buildings' else .42 if key.startswith('share_') else 123
            if key == 'places_stationnement_voiture_1000': value = None
            insert(conn, 'scalar_observation', indicator_id=key, territory_id=code,
                   territory_type='region' if code == '53' else 'commune', value=value,
                   status='measured' if value is not None else 'not_available')
            insert(conn, 'scalar_observation_source', indicator_id=key, territory_id=code,
                   source_id='snapshot', vintage_id='immutable-id')
    for key in sorted({r['key'] for r in rows if r.get('detail')}):
        cells = {r['detail']: r for r in rows if r['key'] == key and r.get('detail')}
        detail = next(iter(cells))
        insert(conn, 'profile_descriptor', indicator_id=key, label=key, unit=cells[detail]['unit'],
               allowed_levels=['commune'], completeness='dense_complete', descriptor_version='gate-v1',
               comparison_detail=detail, comparison_direction='high', theme_id='mobilite', detail_units_required=True)
        insert(conn, 'profile_descriptor_source', indicator_id=key, source_id='snapshot')
        for ordinal, (detail, row) in enumerate(cells.items()):
            insert(conn, 'profile_axis', indicator_id=key, axis_name='detail', axis_key=detail,
                   label=detail, ordinal=ordinal, unit=row['unit'])
            for code in ['22001','22002']:
                insert(conn, 'profile_observation', indicator_id=key, territory_id=code, territory_type='commune',
                       detail_key=detail, sex_key='', sex_axis_name=None, value=456, status='measured')
                insert(conn, 'profile_observation_source', indicator_id=key, territory_id=code,
                       detail_key=detail, sex_key='', source_id='snapshot', vintage_id='immutable-id')
    for service in ['food','health','admin','school','bank']:
        insert(conn, 'service_registry', service=service)
        for mode in ['car','bike','walk_transit']:
            for code in ['22001','22002']:
                insert(conn, 'essential_service_access', territory_id=code, service=service, mode=mode,
                       share=.42, indicator_label=service, effective_direction='high', source_id='snapshot',
                       source_name='SQL gate source', source_version='Gate display version',
                       reference_date=None, source_publication_date=None)
    insert(conn, 'access_publication_metadata', singleton=True, bretagne_kind='communes-bretagne', bretagne_label='Gate communes')
    history = theme['histoires'][0]
    fields = ['groupe','story_key','salience_reason','classification_saillance','div_loss_t','div_loss_b','status']
    insert(conn, 'mobility_reading_descriptor', descriptor_version='gate-v1', source_id='snapshot', vintage_id='immutable-id',
           source_name='SQL gate source', dataset_name='Synthetic mounted gate', source_version='Gate display version',
           unit='types de services', direction='low', allowed_levels=['commune'], missing_status='unavailable',
           classification_values=['saillant','notable','non-saillant'], field_keys=fields, story_count=1, clock_count=1)
    insert(conn, 'mobility_reading_story', story_key=history['story_key'], groupe=history['groupe'],
           salience_reason='gate', ordinal=1)
    insert(conn, 'mobility_reading_clock', ordinal=1, clock_name='fixture', frequency='snapshot', reference='fixture', trigger='fixture')
    for code in ['22001','22002']:
        insert(conn, 'mobility_typed_reading', territory_id=code, territory_type='commune', groupe=history['groupe'],
               story_key=history['story_key'], salience_reason='gate', classification_saillance='saillant',
               div_loss_t=8, div_loss_b=7, status='measured', source_id='snapshot', vintage_id='immutable-id')
    insert(conn, 'bpe_profile_evidence_descriptor', indicator_id='bpe_access_profile', descriptor_version='gate-v1',
           allowed_levels=['commune','epci','departement','region'], completeness='dense_complete', classification_id='gate',
           universe_count=4, universe_sha256='a'*64, registry_filename='fixture', registry_semantic_effect='fixture',
           membership_sha256='b'*64, source_id='snapshot', vintage_id='immutable-id')
    bpe_rows = list(theme['profils_acces_bpe']) + [dict(profil='velo-compense', profil_libelle='SQL vélo class')]
    for ordinal, row in enumerate(bpe_rows):
        key = row['profil']
        insert(conn, 'bpe_profile_class_axis', class_key=key, label=row['profil_libelle'], ordinal=ordinal, direction='high')
        for code in ['22001','22002']:
            insert(conn, 'bpe_profile_evidence', territory_id=code, territory_type='commune', class_key=key,
                   class_label=row['profil_libelle'], class_count=1, universe_count=4,
                   exemplar_typequ=f'A{ordinal:03}', exemplar_label='SQL exemplar', exemplar_c=.42, exemplar_b=.42, exemplar_t=.42)
            insert(conn, 'bpe_profile_evidence_source', territory_type='commune', territory_id=code,
                   class_key=key, source_id='snapshot', vintage_id='immutable-id')
    contracts = _contracts()
    grid_rows = theme['distribution_acces_batiments']
    ramp_rows = theme['rampe_acces_batiments']
    contracts['building_grid']['presentation'] = dict(mode_label=grid_rows[0]['mode_label'],
        breadth_axis_label='SQL gate breadth', depth_axis_label=grid_rows[0]['depth_axis_label'],
        **{axis: [dict(key=r[f'{axis}_bucket'], min_value=r[f'{axis}_min'], max_value=r[f'{axis}_max'], label=r[f'{axis}_label'])
            for r in {r[f'{axis}_bucket']:r for r in grid_rows}.values()] for axis in ['breadth','depth']})
    contracts['building_ramp']['presentation'] = dict(modes={r['mode']:r['mode_label'] for r in ramp_rows},
        quantile_labels=[r['quantile_label'] for r in ramp_rows if r['mode']=='c'],
        x_axis_label=ramp_rows[0]['x_axis_label'], y_axis_label=ramp_rows[0]['y_axis_label'])
    for table, contract in contracts.items():
        insert(conn, 'building_evidence_descriptor', table_name=table, descriptor_version='gate-v1', contract=Jsonb(contract))
        insert(conn, 'building_evidence_descriptor_source', table_name=table, source_id='snapshot')
    for code in ['22001','22002']:
        for r in ramp_rows:
            insert(conn, 'building_ramp', territory_id=code, territory_type='commune', availability='complete', mode=r['mode'],
                   quantile_index=round(r['quantile']*10), quantile=r['quantile'], accessible_types=10+r['quantile'],
                   total_buildings=120, source_id='snapshot', source_version='immutable-id', effective_direction='high')
        for r in grid_rows:
            axes = contracts['building_grid']['axes']
            index = axes['breadth'].index(r['breadth_bucket']) * len(axes['depth']) + axes['depth'].index(r['depth_bucket'])
            insert(conn, 'building_grid', territory_id=code, territory_type='commune', availability='complete', mode='t',
                   cell_index=index, breadth_bucket=r['breadth_bucket'], depth_bucket=r['depth_bucket'],
                   building_count=120 if index==0 else 0, total_buildings=120, source_id='snapshot', source_version='immutable-id')
    for table in ['territory_reference','service_registry','essential_service_access','scalar_observation','building_ramp','building_grid',
                  'mobility_typed_reading','bpe_profile_evidence']:
        count = conn.execute(f'SELECT count(*) FROM {table}').fetchone()[0]
        insert(conn, 'table_publication', table_name=table, content_version='gate-v1', row_count=count,
               reference_content_version='gate-v1')
    count = conn.execute('SELECT count(*) FROM profile_observation').fetchone()[0]
    insert(conn, 'table_publication', table_name='declared_profile', content_version='gate-v1', row_count=count,
           reference_content_version='gate-v1')
    return model


def test_real_sql_response_reaches_mounted_variant_e(tmp_path):
    import psycopg
    from psycopg import sql
    from psycopg_pool import ConnectionPool
    from fastapi.testclient import TestClient
    from api import main
    if not all(os.getenv(k) for k in ['LUSK_TEST_PUBLISH_DSN','LUSK_TEST_READ_DSN','LUSK_TEST_DATABASE_NAME']):
        pytest.skip('requires approved disposable SQL environment')
    assert os.environ['LUSK_TEST_DATABASE_PREFIX'] == 'lusk_it_'
    assert os.environ['LUSK_TEST_DATABASE_NAME'].startswith('lusk_it_')
    assert os.environ.get('LUSK_TEST_ALLOW_SCHEMA_CLEANUP') == '1'
    schema = 'it_mounted_e_' + uuid.uuid4().hex[:16]
    previous = main.app.dependency_overrides.get(main.get_repository)
    pool = None
    with psycopg.connect(os.environ['LUSK_TEST_PUBLISH_DSN'], autocommit=True) as admin:
        assert admin.execute('SELECT current_database()').fetchone()[0] == os.environ['LUSK_TEST_DATABASE_NAME']
        admin.execute(f'CREATE SCHEMA "{schema}"')
        try:
            with psycopg.connect(_schema_dsn(os.environ['LUSK_TEST_PUBLISH_DSN'], schema), autocommit=True) as conn:
                conn.execute((ROOT/'api/schema.sql').read_text(encoding='utf-8'))
                with conn.transaction():
                    model = seed(conn)
                role = sql.Identifier(os.environ['LUSK_TEST_READ_USER'])
                conn.execute(sql.SQL('GRANT USAGE ON SCHEMA {} TO {}').format(sql.Identifier(schema),role))
                conn.execute(sql.SQL('GRANT SELECT ON ALL TABLES IN SCHEMA {} TO {}').format(sql.Identifier(schema),role))
            pool = ConnectionPool(_schema_dsn(os.environ['LUSK_TEST_READ_DSN'],schema), min_size=1, max_size=1, open=True, kwargs={'autocommit':True})
            with pool.connection() as conn:
                assert conn.execute('SELECT current_database(),current_user').fetchone() == (
                    os.environ['LUSK_TEST_DATABASE_NAME'],os.environ['LUSK_TEST_READ_USER'])
            probe = _ConnectionProbePool(pool)
            main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(probe)
            with TestClient(main.app) as client:
                focal = client.get('/api/territories/commune/22001/themes/mobilite/facts')
                assert focal.status_code == 200, focal.text
                assert 'indicators' in focal.json()
                assert 'facts' not in focal.json() and 'profiles' not in focal.json()
                assert any(row['indicator_id'] == 'places_stationnement_voiture_1000'
                           for row in focal.json()['indicators'])
                assert any(row['dimensions'].get('detail') for row in focal.json()['indicators'])
                assert sum(q.startswith('SET TRANSACTION') for q in probe.statements) == 1
                assert focal.json()['service_reference']['value'] == 9876
                selected = [{'territory_type':'commune','territory_id':code} for code in ['22001','22002']]
                comparison = client.post('/api/territories/commune/22001/themes/mobilite/comparison', json={'theme_id':'mobilite','selection':selected})
                assert comparison.status_code == 200, comparison.text
                for selection in [[], selected[:1], [selected[0],dict(territory_type='epci',territory_id=model['territory']['epci'])]]:
                    response = client.post('/api/territories/commune/22001/themes/mobilite/comparison',
                        json=dict(theme_id='mobilite',selection=selection))
                    assert response.status_code == 200, response.text
                    assert 'facts' not in response.json()
                    assert all('focal_value' not in r for r in response.json()['results'])
                with psycopg.connect(_schema_dsn(os.environ['LUSK_TEST_PUBLISH_DSN'],schema), autocommit=True) as conn:
                    conn.execute("UPDATE table_publication SET reference_content_version='incompatible' WHERE table_name='scalar_observation'")
                unavailable = client.get('/api/territories/commune/22001/themes/mobilite/facts')
                assert unavailable.status_code == 503
                evidence = tmp_path/'sql-http.json'
                cohort = [dict(territoire=code,type='commune',nom='Gate commune',departement='22',epci=model['territory']['epci'])
                          for code in ['22001','22002']]
                evidence.write_text(json.dumps(dict(focal=focal.json(), comparison=comparison.json(), model=model,cohort=cohort,
                    unavailable_status=unavailable.status_code,unavailable=unavailable.json())), encoding='utf-8')
                env = dict(os.environ, LUSK_MOUNTED_E_HTTP_FIXTURE=str(evidence))
                result = subprocess.run(['node',str(ROOT/'app/node_modules/vitest/vitest.mjs'),'run',
                    'src/__tests__/territoire-view.spec.ts','-t','consumes real PostgreSQL HTTP responses in mounted E'],
                    cwd=ROOT/'app',env=env,capture_output=True,text=True,encoding='utf-8',timeout=60)
                assert result.returncode == 0, result.stdout+result.stderr
                (tmp_path/'mounted-output.log').write_text(result.stdout+result.stderr,encoding='utf-8')
        finally:
            if previous is None: main.app.dependency_overrides.pop(main.get_repository,None)
            else: main.app.dependency_overrides[main.get_repository]=previous
            if pool: pool.close()
            assert os.environ.get('LUSK_TEST_ALLOW_SCHEMA_CLEANUP') == '1'
            admin.execute(f'DROP SCHEMA "{schema}" CASCADE')
