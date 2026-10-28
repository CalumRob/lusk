"""Small SQL fixtures at actual producer grains, captured through public HTTP."""

import json
from pathlib import Path

import pytest

from api.tests.integration.test_postgres_publication import canonical_db_env

pytestmark = pytest.mark.integration
ROOT = Path(__file__).resolve().parents[3]


@pytest.mark.parametrize('theme,indicator', [('habitat', 'prix_m2'), ('milieux', 'conso_enaf_annuel'),
    ('programmes', 'subventions_annuelles'), ('mobilite', 'raccordement_courbe')])
def test_native_series_family_capture(canonical_db_env, tmp_path, theme, indicator):
    import psycopg
    from psycopg_pool import ConnectionPool
    from fastapi.testclient import TestClient
    from api import main

    metadata = json.loads((ROOT / f'pipeline/inst/extdata/theme-metadata/theme_{theme}.json').read_text(encoding='utf-8'))
    page = metadata['indicator_pages'][indicator]
    route = metadata.get('owned_series_routes', {}).get(indicator, {})
    mean = route.get('comparison_contract', {}).get('statistic') == 'mean'
    axes = [f't{minute:04}' for minute in range(0, 361, 5)] if mean else page.get('comparison', {}).get('details', ['2025'])
    point = page['comparison'].get('detail', page['comparison'].get('dimension'))
    dataset = page.get('series_dataset_id', route.get('dataset_id'))
    source = route.get('source_id') or page['sources'][0]
    statistic = route.get('comparison_contract', {}).get('statistic', page['comparison'].get('statistic'))
    scope = route.get('comparison_contract', {}).get('scope', page['comparison'].get('scope'))
    # Match current producer descriptor defaults (NULL for price/ENAF), not an
    # independently imagined successful API comparison contract.
    territories = [
        {'territoire': 'native-c1', 'type': 'commune', 'nom': 'Native one', 'departement': '35', 'epci': 'native-e1'},
        {'territoire': 'native-c2', 'type': 'commune', 'nom': 'Native two', 'departement': '35', 'epci': 'native-e1'},
        {'territoire': 'native-c4', 'type': 'commune', 'nom': 'Native four', 'departement': '35', 'epci': 'native-e2'},
        {'territoire': 'native-c3', 'type': 'commune', 'nom': 'Outside', 'departement': '22', 'epci': 'native-e2'},
        {'territoire': 'native-e1', 'type': 'epci', 'nom': 'EPCI one', 'departement': '35', 'epci': None},
        {'territoire': 'native-e2', 'type': 'epci', 'nom': 'EPCI two', 'departement': '22', 'epci': None},
        {'territoire': '53', 'type': 'region', 'nom': 'Bretagne', 'departement': None, 'epci': None},
        {'territoire': '35', 'type': 'departement', 'nom': 'Ille-et-Vilaine', 'departement': None, 'epci': None},
        {'territoire': '22', 'type': 'departement', 'nom': 'Côtes-d’Armor', 'departement': None, 'epci': None},
    ]
    cohort_target = {'kind': 'territory_cohort', 'type': 'commune',
        'department_id': None if indicator == 'prix_m2' else '35',
        'epci_id': 'native-e1' if indicator == 'prix_m2' else None}
    with psycopg.connect(canonical_db_env['publish_dsn']) as conn:
        for t in territories:
            conn.execute('''INSERT INTO territory_reference(territory_id,territory_type,name,department_id,epci_id,
                density_class_code) VALUES (%s,%s,%s,%s,%s,'D1')''',
                (t['territoire'], t['type'], t['nom'], t['departement'], t['epci']))
        conn.execute("INSERT INTO table_publication(table_name,content_version,row_count) VALUES ('territory_reference','native-ref',%s)", (len(territories),))
        levels = ['commune', 'epci', 'departement', 'region']
        conn.execute('''INSERT INTO series_dataset_publication(dataset_id,content_version,reference_content_version,row_count)
            VALUES (%s,'native-series','native-ref',%s)''', (dataset, len(axes) * (len(territories) + (1 if mean else 0))))
        conn.execute('''INSERT INTO series_dataset_descriptor(dataset_id,indicator_id,axis_kind,axis_values,axis_numeric_values,
            completeness,comparison_point,label,unit,direction,allowed_levels,descriptor_version,active_read_route,
            theme_id,comparison_statistic,comparison_scope,observation_period_kind,absence_semantics)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'native-descriptor',true,%s,%s,%s,%s,%s)''',
            (dataset, indicator, 'duration_minute' if mean else 'year', axes, list(range(0,361,5)) if mean else None,
             'dense_complete' if mean else 'may_be_missing', point, page['label'], page['unit'], page['direction'],
             levels, theme, statistic, scope, 'snapshot_date' if mean else None, page.get('absence_semantics', 'unavailable')))
        conn.execute('''INSERT INTO series_provenance_revision VALUES ('native-revision',%s,'native-vintage',
            'Native combined source','Native dataset','native-version','2026-01-02','2026-07-03','native-hash')''', (source,))
        for index, t in enumerate(territories, 1):
            for ordinal, axis in enumerate(axes):
                value = (ordinal / 1000 + index / 10) if mean else index * 10 + ordinal
                conn.execute('''INSERT INTO series_dataset_observation(dataset_id,indicator_id,territory_id,territory_type,
                    axis_value,observation_period,value,status) VALUES (%s,%s,%s,%s,%s,%s,%s,'measured')''',
                    (dataset, indicator, t['territoire'], t['type'], axis, '2026-09-16' if mean else axis, value))
                conn.execute('INSERT INTO series_observation_provenance VALUES (%s,%s,%s,%s,\'native-revision\')',
                    (dataset, indicator, t['territoire'], axis))
        if mean:
            ref = route['reference']
            conn.execute('''INSERT INTO series_named_reference_descriptor VALUES
                (%s,%s,%s,%s,%s,%s,true,'raccordement_reference',true)''',
                (dataset, indicator, ref['id'], ref['label'], ref['role'], ref['statistic']))
            for ordinal, axis in enumerate(axes):
                conn.execute('''INSERT INTO series_named_reference(dataset_id,indicator_id,reference_id,axis_value,
                    observation_period,value,status) VALUES (%s,%s,%s,%s,'2026-09-16',%s,'measured')''',
                    (dataset, indicator, ref['id'], axis, .45 + ordinal / 1000))
                conn.execute("INSERT INTO series_named_reference_provenance VALUES (%s,%s,%s,%s,'native-revision')",
                    (dataset, indicator, ref['id'], axis))
        if indicator == 'prix_m2':
            conn.execute("INSERT INTO source_dataset VALUES (%s,'Native pooled source')", (source,))
            conn.execute("INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date) VALUES (%s,'pooled-vintage','pooled-version','2025-01-02','2025-07-03')", (source,))
            conn.execute('''INSERT INTO scalar_descriptor(indicator_id,theme_id,label,unit,direction,comparison_facet,
                allowed_levels,denominator_semantics,completeness,descriptor_version) VALUES ('prix_m2','habitat',
                'Native pooled price','€/m²','low','prix_m2',%s,'transactions','sparse','pooled-desc')''', (levels,))
            conn.execute("INSERT INTO scalar_descriptor_source VALUES ('prix_m2',%s)", (source,))
            for t in territories:
                if t['territoire'] == 'native-c4':
                    continue  # exercise selected=3, eligible=2, missing=1 from native SQL evidence
                conn.execute("INSERT INTO scalar_observation(indicator_id,territory_id,territory_type,value,status) VALUES ('prix_m2',%s,%s,987,'measured')", (t['territoire'], t['type']))
                conn.execute("INSERT INTO scalar_observation_source VALUES ('prix_m2',%s,%s,'pooled-vintage')", (t['territoire'], source))
            conn.execute("INSERT INTO table_publication(table_name,content_version,reference_content_version,row_count) VALUES ('scalar_observation','native-pooled','native-ref',8)")
        # Current R publication grain: all annual/duration axes, fixed same-level
        # parent groups and commune presets. Values are the independent SQL seed.
        groups = [('same_level','53','epci',[4,5]), ('same_level','53','departement',[7,8]),
                  ('bretagne','53','commune',[1,2,3]), ('density_class','D1','commune',[1,2,3]),
                  ('epci','native-e1','commune',[1,2]), ('epci','native-e2','commune',[3])]
        conn.execute('''INSERT INTO ordered_series_comparison_publication(dataset_id,indicator_id,content_version,
            ordered_series_content_version,reference_content_version,group_row_count,territory_row_count,
            lineage_row_count,comparison_axes) VALUES (%s,%s,'native-comparison','native-series','native-ref',%s,%s,%s,%s)''',
            (dataset, indicator, len(groups)*len(axes), sum(len(g[3]) for g in groups)*len(axes), len(groups)*len(axes), axes))
        for context, group, level, indices in groups:
            for ordinal, axis in enumerate(axes):
                values = [ordinal / 1000 + i/10 if mean else i*10+ordinal for i in indices]
                ordered = sorted(values)
                group_value = sum(values)/len(values) if mean else (ordered[(len(values)-1)//2]+ordered[len(values)//2])/2
                conn.execute('''INSERT INTO ordered_series_comparison_group VALUES
                    (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,0,1)''',
                    (dataset, indicator, context, group, level, axis, 'mean' if mean else 'median', group_value, len(indices),len(indices)))
                for index, value in zip(indices, values):
                    rank = 1 + sum(v > value if page['direction']=='high' else v < value for v in values)
                    conn.execute('''INSERT INTO ordered_series_comparison_territory VALUES
                        (%s,%s,%s,%s,%s,%s,%s,%s,'measured',%s,1,%s)''',
                        (dataset, indicator, context, group, level, axis, territories[index-1]['territoire'], value, rank,len(indices)))
                conn.execute("INSERT INTO ordered_series_comparison_lineage VALUES (%s,%s,%s,%s,%s,%s,'native-revision')",
                    (dataset, indicator, context, group, level, axis))

    pool = ConnectionPool(conninfo=canonical_db_env['read_dsn'], min_size=0, max_size=1, open=True,
                          kwargs={'autocommit': True})
    previous = main.app.dependency_overrides.get(main.get_repository)
    main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
    try:
        with TestClient(main.app) as client:
            catalogue = client.get('/api/resources')
            assert catalogue.status_code == 200
            captures = {}
            def read(name, target, intent, fields=None):
                item = {'id': f'scalar-0-{indicator}', 'resource': indicator, 'target': target, 'intent': intent}
                if fields is not None:
                    item['fields'] = fields
                request = {'items': [item]}
                response = client.post('/api/resources/read-batch', json=request)
                captures[name] = {'request': request, 'response_status': response.status_code, 'response': response.json()}
                assert response.status_code == 200, response.text
            read('cohort', cohort_target, {'kind': 'facts'},
                 fields=['value', 'scalar_facet'] if indicator == 'prix_m2' else ['value'])
            read('focal', {'kind': 'territory', 'type': 'commune', 'id': 'native-c3'}, {'kind': 'facts'})
            read('comparison', {'kind': 'territory', 'type': 'commune', 'id': 'native-c3'},
                 {'kind': 'selected_comparison', 'members': [{'type': 'commune', 'id': 'native-c1'},
                    {'type': 'commune', 'id': 'native-c2'}]})
            if mean:
                request = {'items': [{'id': 'scalar-0-raccordement_reference', 'resource': 'raccordement_reference',
                    'target': {'kind': 'named_reference', 'id': route['reference']['id']}, 'intent': {'kind': 'facts'}}]}
                response = client.post('/api/resources/read-batch', json=request)
                assert response.status_code == 200, response.text
                captures['reference'] = {'request': request, 'response_status': 200, 'response': response.json()}
            read('axis_comparison', {'kind': 'territory', 'type': 'commune', 'id': 'native-c3'},
                 {'kind': 'selected_comparison', 'members': [{'type': 'commune', 'id': 'native-c1'},
                    {'type': 'commune', 'id': 'native-c2'}]},
                 fields=['axis_comparisons', 'scalar_facet'] if indicator == 'prix_m2' else ['axis_comparisons'])
            pooled_page_fields = ['axis_comparisons', 'scalar_facet', 'median', 'rank', 'rank_size',
                'rank_ties', 'selected_member_count', 'eligible_count', 'missing_count', 'member_ranks']
            bridge_items = [
                {'id': f'scalar-0-{indicator}', 'resource': indicator,
                 'target': cohort_target,
                 'intent': {'kind': 'facts'},
                 'fields': ['value', 'scalar_facet'] if indicator == 'prix_m2' else ['value']},
                {'id': f'scalar-1-{indicator}', 'resource': indicator,
                 'target': {'kind': 'territory', 'type': 'commune', 'id': 'native-c3'},
                 'intent': {'kind': 'facts'}},
                {'id': f'scalar-2-{indicator}', 'resource': indicator,
                 'target': {'kind': 'territory', 'type': 'commune', 'id': 'native-c3'},
                 'intent': {'kind': 'selected_comparison', 'members': [
                     {'type': 'commune', 'id': 'native-c1'}, {'type': 'commune', 'id': 'native-c2'}]},
                 'fields': pooled_page_fields if indicator == 'prix_m2' else ['axis_comparisons']},
            ]
            bridge_response = client.post('/api/resources/read-batch', json={'items': bridge_items})
            assert bridge_response.status_code == 200, bridge_response.text
            captures['application_bridge'] = {'request': {'items': bridge_items},
                'response_status': bridge_response.status_code, 'response': bridge_response.json()}
            if indicator == 'prix_m2':
                # The page focal is inside the explicit EPCI selection so the
                # native scalar comparison must return its actual pooled rank
                # and tie evidence for that member, not just metadata.
                page_items = [
                    {'id': 'scalar-0-prix_m2', 'resource': indicator,
                     'target': {'kind': 'territory_cohort', 'type': 'commune', 'department_id': '35', 'epci_id': None},
                     'intent': {'kind': 'facts'}, 'fields': ['value', 'scalar_facet']},
                    {'id': 'scalar-1-prix_m2', 'resource': indicator,
                     'target': {'kind': 'territory', 'type': 'commune', 'id': 'native-c1'},
                     'intent': {'kind': 'facts'}},
                    {'id': 'scalar-2-prix_m2', 'resource': indicator,
                     'target': {'kind': 'territory', 'type': 'commune', 'id': 'native-c1'},
                     'intent': {'kind': 'selected_comparison', 'members': [
                         {'type': 'commune', 'id': 'native-c1'}, {'type': 'commune', 'id': 'native-c2'},
                         {'type': 'commune', 'id': 'native-c4'}]},
                     'fields': pooled_page_fields},
                ]
                page_response = client.post('/api/resources/read-batch', json={'items': page_items})
                assert page_response.status_code == 200, page_response.text
                captures['application_page'] = {'request': {'items': page_items},
                    'response_status': page_response.status_code, 'response': page_response.json()}
        capture = {'catalogue': catalogue.json(), 'territories': territories, **captures}
        output = tmp_path / f'native-{indicator}.json'
        output.write_text(json.dumps(capture, indent=2, ensure_ascii=False), encoding='utf-8')
        print(f'Native family capture: {output}', flush=True)
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous
        pool.close()
