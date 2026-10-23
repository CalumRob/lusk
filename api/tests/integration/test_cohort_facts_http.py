"""Bounded population facts through the guarded PostgreSQL-backed public API."""

from __future__ import annotations

import pytest
from api.tests.integration.test_postgres_publication import canonical_db_env

pytestmark = pytest.mark.integration


def test_cohort_facts_preserve_population_scope_and_observation_evidence(canonical_db_env, monkeypatch):
    import psycopg
    from contextlib import contextmanager
    from fastapi.testclient import TestClient
    from psycopg_pool import ConnectionPool
    from api import main

    with psycopg.connect(canonical_db_env["publish_dsn"], autocommit=True) as publisher:
        with publisher.transaction():
            publisher.execute("""INSERT INTO territory_reference(
                territory_id,territory_type,name,department_id,epci_id)
                VALUES ('cohort-c1','commune','Commune 1','29','cohort-e29'),
                       ('cohort-c2','commune','Commune 2','29','cohort-e29'),
                       ('cohort-c3','commune','Commune 3','22','cohort-e22'),
                       ('cohort-e29','epci','EPCI 29','29',NULL),
                       ('cohort-e22','epci','EPCI 22','22',NULL),
                       ('29','departement','Finistère',NULL,NULL),
                       ('22','departement','Côtes-d’Armor',NULL,NULL),
                       ('cohort-bretagne','region','Bretagne',NULL,NULL)""")
            publisher.execute("""INSERT INTO table_publication(table_name,content_version,row_count)
                VALUES ('territory_reference','cohort-reference-v1',8)""")
            publisher.execute("INSERT INTO source_dataset(source_id,name) VALUES ('cohort-source','Cohort source')")
            publisher.execute("""INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date)
                VALUES ('cohort-source','cohort-v1','2026','2026-01-01','2026-01-02')""")
            publisher.execute("""INSERT INTO scalar_descriptor(indicator_id,theme_id,label,unit,direction,
                comparison_facet,allowed_levels,denominator_semantics,completeness,descriptor_version)
                VALUES ('densite','demographie','Densité de population','hab./km²','high','densite',
                    ARRAY['commune','epci','departement'],'population','dense_complete','cohort-descriptor-v1')""")
            publisher.execute("INSERT INTO scalar_descriptor_source VALUES ('densite','cohort-source')")
            for territory_id, territory_type, value, support, denominator in (
                ('cohort-c1', 'commune', 10.5, 100, 200),
                ('cohort-c2', 'commune', 20.25, 150, 300),
                ('cohort-c3', 'commune', 99.0, 900, 1000),
                ('cohort-e29', 'epci', 100.5, 1000, 2000),
                ('cohort-e22', 'epci', 200.5, 2000, 4000),
            ):
                publisher.execute("""INSERT INTO scalar_observation(
                    indicator_id,territory_id,territory_type,value,status,support_count,denominator_count)
                    VALUES ('densite',%s,%s,%s,'measured',%s,%s)""",
                    (territory_id, territory_type, value, support, denominator))
                publisher.execute("""INSERT INTO scalar_observation_source
                    VALUES ('densite',%s,'cohort-source','cohort-v1')""", (territory_id,))
            publisher.execute("""INSERT INTO profile_descriptor(indicator_id,theme_id,label,unit,allowed_levels,
                completeness,descriptor_version,comparison_detail,comparison_sex,comparison_direction)
                VALUES ('structure_age','demographie','Structure par âge','%',ARRAY['commune'],
                    'dense_complete','cohort-profile-v1','<15','F','high')""")
            publisher.execute("INSERT INTO profile_descriptor_source VALUES ('structure_age','cohort-source')")
            for axis, keys in (("detail", ("<15", "15-24")), ("sex", ("F", "M"))):
                for ordinal, key in enumerate(keys):
                    publisher.execute("""INSERT INTO profile_axis(indicator_id,axis_name,axis_key,label,ordinal)
                        VALUES ('structure_age',%s,%s,%s,%s)""", (axis, key, key, ordinal))
            for territory_id in ("cohort-c1", "cohort-c2", "cohort-c3"):
                for detail in ("<15", "15-24"):
                    for sex in ("F", "M"):
                        suppressed = territory_id == "cohort-c2" and detail == "<15" and sex == "M"
                        value = None if suppressed else 0.25
                        publisher.execute("""INSERT INTO profile_observation(
                            indicator_id,territory_id,territory_type,detail_key,sex_key,value,status)
                            VALUES ('structure_age',%s,'commune',%s,%s,%s,%s)""",
                            (territory_id, detail, sex, value,
                             "suppressed" if suppressed else "measured"))
                        publisher.execute("""INSERT INTO profile_observation_source
                            VALUES ('structure_age',%s,%s,%s,'cohort-source','cohort-v1')""",
                            (territory_id, detail, sex))
            publisher.execute("""INSERT INTO table_publication(
                table_name,content_version,row_count,reference_content_version)
                VALUES ('declared_profile','cohort-profile-v1',12,'cohort-reference-v1')""")
            publisher.execute("""INSERT INTO table_publication(
                table_name,content_version,row_count,reference_content_version)
                VALUES ('scalar_observation','cohort-scalar-v1',5,'cohort-reference-v1')""")
            publisher.execute("""INSERT INTO observed_collection_publication
                VALUES ('subventions_par_domaine','cohort-domain-v1','cohort-reference-v1',1)""")
            publisher.execute("""INSERT INTO observed_collection_descriptor(
                indicator_id,theme_id,kind,label,unit,descriptor_version,allowed_levels,direction)
                VALUES ('subventions_par_domaine','programmes','period_detail','Subventions par domaine',
                    '€','cohort-domain-desc-v1',ARRAY['commune'],'none')""")
            publisher.execute("""INSERT INTO observed_collection_category(
                indicator_id,detail_key,label,ordinal,source_id)
                VALUES ('subventions_par_domaine','education','Éducation',0,'cohort-source')""")
            publisher.execute("""INSERT INTO period_detail_observation(
                indicator_id,territory_id,territory_type,detail_key,observation_period,value,source_id,vintage_id)
                VALUES ('subventions_par_domaine','cohort-c1','commune','education','2025',125.0,
                    'cohort-source','cohort-v1')""")
            publisher.execute("""INSERT INTO observed_collection_publication
                VALUES ('couverture_programmes','cohort-membership-v1','cohort-reference-v1',1)""")
            publisher.execute("""INSERT INTO observed_collection_descriptor(
                indicator_id,theme_id,kind,label,unit,descriptor_version,allowed_levels,direction)
                VALUES ('couverture_programmes','programmes','anchored_membership','Couverture des programmes',
                    'adhésion','cohort-membership-desc-v1',ARRAY['commune'],'none')""")
            publisher.execute("""INSERT INTO observed_collection_category(
                indicator_id,detail_key,label,ordinal,source_id,anchor_levels,rider_label)
                VALUES ('couverture_programmes','ACV','Action cœur de ville',0,'cohort-source',
                    ARRAY['commune'],'Convention valant ORT')""")
            publisher.execute("""INSERT INTO anchored_membership(
                indicator_id,territory_id,territory_type,detail_key,convention_valant_ort,source_id,vintage_id)
                VALUES ('couverture_programmes','cohort-c1','commune','ACV',true,'cohort-source','cohort-v1')""")
            publisher.execute("""INSERT INTO economy_typed_reading(
                territory_id,territory_type,groupe,story_key,salience_reason,status,source_id,vintage_id)
                VALUES ('cohort-c1','commune','sante-et-taille','ce-que-la-commune-abrite','source',
                        'measured','cohort-source','cohort-v1'),
                       ('cohort-c2','commune','sante-et-taille','ce-que-la-commune-abrite','source',
                        'unavailable','cohort-source','cohort-v1')""")
            publisher.execute("""INSERT INTO economy_activity_evidence(
                territory_id,territory_type,groupe,rank,activity_code,activity_label,lq,
                establishment_count,park_share,source_id,vintage_id)
                VALUES ('cohort-c1','commune','sante-et-taille',1,'A01','Agriculture',2.5,
                    12,0.2,'cohort-source','cohort-v1')""")
            publisher.execute("""INSERT INTO table_publication(
                table_name,content_version,row_count,reference_content_version)
                VALUES ('economy_typed_reading','cohort-economy-v1',2,'cohort-reference-v1')""")
            publisher.execute("""INSERT INTO table_publication(
                table_name,content_version,row_count,reference_content_version)
                VALUES ('economy_activity_evidence','cohort-economy-evidence-v1',1,'cohort-reference-v1')""")
            publisher.execute("""INSERT INTO milieux_typed_reading(
                territory_id,territory_type,groupe,story_key,salience_reason,periode_pop,periode_artif,
                delta_population,taux_variation_population,artif_m2_par_habitant,artif_m3_par_habitant,
                trajectoire_artif_par_habitant,classification,status,source_id,vintage_id)
                VALUES ('cohort-c1','commune','artificialisation','trajectoire-artificialisation','source',
                    '2020','2021',25,0.02,10,12,0.01,'stable','measured','cohort-source','cohort-v1')""")
            publisher.execute("""INSERT INTO milieux_population_provenance_revision(
                population_revision_id,source_id,vintage_id,source_name,dataset_name,source_version,
                reference_date,publication_date,revision_hash)
                VALUES ('cohort-milieux-population','cohort-source','cohort-v1','Cohort source',
                    'Population','2026','2026-01-01','2026-01-02','cohort-milieux-hash')""")
            publisher.execute("""INSERT INTO milieux_reading_source(
                territory_id,territory_type,groupe,field_key,source_id,vintage_id,source_name,source_version,
                observation_period,population_revision_id)
                VALUES ('cohort-c1','commune','artificialisation','population','cohort-source','cohort-v1',
                    'Cohort source','2026','2020','cohort-milieux-population')""")
            publisher.execute("""INSERT INTO milieux_reading_absence(
                territory_id,territory_type,reason,source_id,vintage_id,source_snapshot_sha256)
                VALUES ('cohort-c2','commune','source_record_absent','cohort-source','cohort-v1',%s)""",
                ('a' * 64,))
            publisher.execute("""INSERT INTO table_publication(
                table_name,content_version,row_count,reference_content_version)
                VALUES ('milieux_typed_reading','cohort-milieux-v1',1,'cohort-reference-v1'),
                       ('milieux_reading_absence','cohort-milieux-v1',1,'cohort-reference-v1')""")
            publisher.execute("""INSERT INTO series_dataset_publication
                (dataset_id,content_version,reference_content_version,row_count)
                VALUES ('dvf_prix_m2','cohort-series-v1','cohort-reference-v1',3)""")
            publisher.execute("""INSERT INTO series_dataset_descriptor(
                dataset_id,indicator_id,axis_kind,axis_values,completeness,comparison_point,label,unit,direction,
                allowed_levels,descriptor_version,active_read_route,theme_id,absence_semantics)
                VALUES ('dvf_prix_m2','prix_m2','year',ARRAY['2024','2025'],'may_be_missing','2025',
                    'Prix médian au m²','€/m²','low',ARRAY['commune'],'cohort-series-desc-v1',true,'habitat','no_record')""")
            publisher.execute("""INSERT INTO series_provenance_revision(
                provenance_revision_id,source_id,vintage_id,source_name,dataset_name,source_version,
                reference_date,publication_date,revision_hash)
                VALUES ('cohort-series-revision','cohort-source','cohort-v1','Cohort source','DVF','2026',
                    '2026-01-01','2026-01-02','cohort-series-hash')""")
            for territory_id, axis, value, status in (
                ('cohort-c1','2024',230.0,'measured'),
                ('cohort-c1','2025',None,'missing'),
                ('cohort-c2','2024',123.0,'measured'),
            ):
                publisher.execute("""INSERT INTO series_dataset_observation(
                    dataset_id,indicator_id,territory_id,territory_type,axis_value,observation_period,
                    value,status)
                    VALUES ('dvf_prix_m2','prix_m2',%s,'commune',%s,'2025',%s,%s)""",
                    (territory_id, axis, value, status))
                publisher.execute("""INSERT INTO series_observation_provenance
                    VALUES ('dvf_prix_m2','prix_m2',%s,%s,'cohort-series-revision')""",
                    (territory_id, axis))
            publisher.execute("""INSERT INTO series_descriptor(
                indicator_id,axis_kind,axis_values,completeness,comparison_point,allowed_levels,label,unit,
                direction,source_id,vintage_id,descriptor_version)
                VALUES ('subventions_annuelles','year',ARRAY['2024','2025'],'may_be_missing',NULL,
                    ARRAY['commune','epci','departement'],'Subventions annuelles','€','none',
                    'cohort-source','cohort-v1','cohort-legacy-series-desc-v1')""")
            for territory_id, axis, value, status in (
                ('cohort-c1','2024',75.0,'measured'),
                ('cohort-c1','2025',None,'missing'),
                ('cohort-c2','2024',125.0,'measured'),
            ):
                publisher.execute("""INSERT INTO ordered_series(
                    indicator_id,territory_id,territory_type,axis_value,observation_period,value,status,
                    source_id,vintage_id)
                    VALUES ('subventions_annuelles',%s,'commune',%s,'2025',%s,%s,'cohort-source','cohort-v1')""",
                    (territory_id, axis, value, status))
            publisher.execute("""INSERT INTO table_publication(
                table_name,content_version,row_count,reference_content_version)
                VALUES ('ordered_series','cohort-legacy-series-v1',3,'cohort-reference-v1')""")
            publisher.execute("""INSERT INTO aedar_territorial_aggregate(
                territory_type,territory_id,typequ,typequ_label,typequ_hierarchy_label,typequ_description,
                typequ_domain_code,typequ_domain_label,typequ_subdomain_code,typequ_subdomain_label,
                typequ_gamme,typequ_gamme_status,typequ_source_order,identity,n_addresses,n_observed,
                coverage_status,measures,source_id,vintage_id,source_url,licence,attribution,reference_date,publication_date)
                VALUES ('commune','cohort-c1','cohort-typequ','Accessibilité','Accessibilité','Description',
                    'D','Domaine','S','Sous-domaine','Gamme','classified',1,'{}',3,2,'complete',
                    '{\"count_5_walk_mean\":12.5}','aedar_bretagne','2026-v1','https://example.test',
                    'Licence','Attribution','2026-01-01','2026-01-02')""")
            publisher.execute("""INSERT INTO table_publication(
                table_name,content_version,row_count,reference_content_version)
                VALUES ('aedar_territorial_aggregate','cohort-aedar-v1',1,'cohort-reference-v1')""")

    pool = ConnectionPool(conninfo=canonical_db_env["read_dsn"], min_size=0, max_size=1,
                          open=True, kwargs={"autocommit": True})
    query_counter = {"count": 0}

    class CountingConnection:
        def __init__(self, connection):
            self.connection = connection

        def execute(self, *args, **kwargs):
            query_counter["count"] += 1
            return self.connection.execute(*args, **kwargs)

        def __getattr__(self, name):
            return getattr(self.connection, name)

    class CountingPool:
        @contextmanager
        def connection(self):
            with pool.connection() as connection:
                yield CountingConnection(connection)

    previous = main.app.dependency_overrides.get(main.get_repository)
    main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(CountingPool())
    common = {
        "resource": "densite",
        "intent": {"kind": "facts"},
    }
    try:
        with TestClient(main.app) as client:
            before = query_counter["count"]
            all_brittany = client.post("/api/resources/read", json={
                **common,
                "target": {"kind": "territory_cohort", "type": "commune"},
            })
            commune_query_count = query_counter["count"] - before
            filtered = client.post("/api/resources/read", json={
                **common,
                "target": {"kind": "territory_cohort", "type": "commune",
                           "department_id": "29", "epci_id": "cohort-e29"},
                "fields": ["value"],
            })
            filtered_batch = client.post("/api/resources/read-batch", json={"items": [{
                "id": "filtered", **common,
                "target": {"kind": "territory_cohort", "type": "commune",
                           "department_id": "29", "epci_id": "cohort-e29"},
                "fields": ["value"],
            }]})
            profile = client.post("/api/resources/read", json={
                "resource": "structure_age",
                "target": {"kind": "territory_cohort", "type": "commune",
                           "department_id": "29", "epci_id": "cohort-e29"},
                "coordinates": {"detail": ["<15"], "sex": ["M"]},
                "intent": {"kind": "facts"},
            })
            period_detail = client.post("/api/resources/read", json={
                "resource": "subventions_par_domaine",
                "target": {"kind": "territory_cohort", "type": "commune",
                           "department_id": "29", "epci_id": "cohort-e29"},
                "coordinates": {"period": ["2025"], "detail": ["education"]},
                "fields": ["value"], "intent": {"kind": "facts"},
            })
            membership = client.post("/api/resources/read", json={
                "resource": "couverture_programmes",
                "target": {"kind": "territory_cohort", "type": "commune",
                           "department_id": "29", "epci_id": "cohort-e29"},
                "coordinates": {"membership": ["ACV"]},
                "fields": ["detail", "label", "rider", "anchor_count", "availability"],
                "intent": {"kind": "facts"},
            })
            typed_reading = client.post("/api/resources/read", json={
                "resource": "economie_selected_reading",
                "target": {"kind": "territory_cohort", "type": "commune",
                           "department_id": "29", "epci_id": "cohort-e29"},
                "coordinates": {"groupe": ["sante-et-taille"]},
                "fields": ["status", "source_id", "vintage_id", "ranked_activities"],
                "intent": {"kind": "facts"},
            })
            milieux_reading = client.post("/api/resources/read", json={
                "resource": "milieux_selected_reading",
                "target": {"kind": "territory_cohort", "type": "commune",
                           "department_id": "29", "epci_id": "cohort-e29"},
                "coordinates": {"groupe": ["artificialisation"]},
                "fields": ["status", "source_absences", "source_bindings"],
                "intent": {"kind": "facts"},
            })
            milieux_absence_projection = client.post("/api/resources/read", json={
                "resource": "milieux_selected_reading",
                "target": {"kind": "territory_cohort", "type": "commune",
                           "department_id": "29", "epci_id": "cohort-e29"},
                "coordinates": {"groupe": ["artificialisation"]},
                "fields": ["source_absences"], "intent": {"kind": "facts"},
            })
            owned_series = client.post("/api/resources/read", json={
                "resource": "prix_m2", "target": {"kind": "territory_cohort", "type": "commune"},
                "coordinates": {"year": ["2024", "2025"]}, "fields": ["value"],
                "intent": {"kind": "facts"},
            })
            legacy_series = client.post("/api/resources/read", json={
                "resource": "subventions_annuelles",
                "target": {"kind": "territory_cohort", "type": "commune"},
                "coordinates": {"year": ["2024", "2025"]}, "fields": ["value"],
                "intent": {"kind": "facts"},
            })
            aedar = client.post("/api/resources/read", json={
                "resource": "aedar_territorial_aggregate",
                "target": {"kind": "territory_cohort", "type": "commune",
                           "department_id": "29", "epci_id": "cohort-e29"},
                "coordinates": {"typequ": ["cohort-typequ"]},
                "fields": ["measures.count_5_walk_mean"],
                "intent": {"kind": "facts"},
            })
            before = query_counter["count"]
            epci_population = client.post("/api/resources/read", json={
                "resource": "densite", "target": {"kind": "territory_cohort", "type": "epci"},
                "intent": {"kind": "facts"},
            })
            epci_query_count = query_counter["count"] - before
            multi_batch = client.post("/api/resources/read-batch", json={"items": [
                {"id": "profile", "resource": "structure_age", "target": {
                    "kind": "territory_cohort", "type": "commune", "department_id": "29",
                    "epci_id": "cohort-e29"}, "coordinates": {"detail": ["<15"], "sex": ["M"]},
                    "intent": {"kind": "facts"}},
                {"id": "period", "resource": "subventions_par_domaine", "target": {
                    "kind": "territory_cohort", "type": "commune", "department_id": "29",
                    "epci_id": "cohort-e29"}, "coordinates": {"period": ["2025"], "detail": ["education"]},
                    "fields": ["value"], "intent": {"kind": "facts"}},
                {"id": "membership", "resource": "couverture_programmes", "target": {
                    "kind": "territory_cohort", "type": "commune", "department_id": "29",
                    "epci_id": "cohort-e29"}, "coordinates": {"membership": ["ACV"]},
                    "fields": ["detail", "label", "rider", "anchor_count", "availability"],
                    "intent": {"kind": "facts"}},
                    {"id": "reading", "resource": "economie_selected_reading", "target": {
                    "kind": "territory_cohort", "type": "commune", "department_id": "29",
                    "epci_id": "cohort-e29"}, "coordinates": {"groupe": ["sante-et-taille"]},
                        "fields": ["status", "source_id", "vintage_id", "ranked_activities"],
                        "intent": {"kind": "facts"}},
                    {"id": "milieux", "resource": "milieux_selected_reading", "target": {
                        "kind": "territory_cohort", "type": "commune", "department_id": "29",
                        "epci_id": "cohort-e29"}, "coordinates": {"groupe": ["artificialisation"]},
                        "fields": ["status", "source_absences", "source_bindings"],
                        "intent": {"kind": "facts"}},
                    {"id": "series", "resource": "prix_m2", "target": {
                        "kind": "territory_cohort", "type": "commune"},
                        "coordinates": {"year": ["2024", "2025"]}, "fields": ["value"],
                        "intent": {"kind": "facts"}},
                    {"id": "legacy-series", "resource": "subventions_annuelles", "target": {
                        "kind": "territory_cohort", "type": "commune"},
                        "coordinates": {"year": ["2024", "2025"]}, "fields": ["value"],
                        "intent": {"kind": "facts"}},
                    {"id": "aedar", "resource": "aedar_territorial_aggregate", "target": {
                    "kind": "territory_cohort", "type": "commune", "department_id": "29",
                    "epci_id": "cohort-e29"}, "coordinates": {"typequ": ["cohort-typequ"]},
                    "fields": ["measures.count_5_walk_mean"], "intent": {"kind": "facts"}},
            ]})
            invalid_batch = client.post("/api/resources/read-batch", json={"items": [
                {"id": "valid", **common,
                 "target": {"kind": "territory_cohort", "type": "commune"}},
                {"id": "invalid", **common,
                 "target": {"kind": "territory_cohort", "type": "commune", "department_id": "98"}},
            ]})
            invalid_coordinate = client.post("/api/resources/read", json={
                "resource": "structure_age", "target": {"kind": "territory_cohort", "type": "commune"},
                "coordinates": {"detail": ["not-a-profile-axis"]}, "intent": {"kind": "facts"},
            })
            with monkeypatch.context() as patch:
                from api import resource_execution
                patch.setattr(resource_execution, "MAX_WORK_UNITS", 2)
                over_budget = client.post("/api/resources/read", json={
                    **common, "target": {"kind": "territory_cohort", "type": "commune"},
                })
            with monkeypatch.context() as patch:
                from api import resource_execution
                patch.setattr(resource_execution, "MAX_WORK_UNITS", 9)
                over_axis_work = client.post("/api/resources/read", json={
                    "resource": "prix_m2", "target": {"kind": "territory_cohort", "type": "commune"},
                    "coordinates": {"year": ["2024", "2025"]}, "intent": {"kind": "facts"},
                })
            with monkeypatch.context() as patch:
                from api import resource_execution
                patch.setattr(resource_execution, "MAX_RESPONSE_BYTES", 100)
                over_response = client.post("/api/resources/read", json={
                    **common, "target": {"kind": "territory_cohort", "type": "commune"},
                })
            with psycopg.connect(canonical_db_env["publish_dsn"], autocommit=True) as publisher:
                publisher.execute("""UPDATE table_publication SET reference_content_version='stale-reference'
                    WHERE table_name='scalar_observation'""")
                try:
                    stale = client.post("/api/resources/read", json={
                        **common, "target": {"kind": "territory_cohort", "type": "commune"},
                    })
                finally:
                    publisher.execute("""UPDATE table_publication SET reference_content_version='cohort-reference-v1'
                        WHERE table_name='scalar_observation'""")
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous
        pool.close()

    assert all_brittany.status_code == 200, all_brittany.text
    body = all_brittany.json()
    assert body["target"] == {"kind": "territory_cohort", "type": "commune",
                               "department_id": None, "epci_id": None}
    assert body["cohort"]["territory_type"] == "commune"
    assert body["cohort"]["member_count"] == 3
    assert [member["id"] for member in body["cohort"]["members"]] == [
        "cohort-c1", "cohort-c2", "cohort-c3"]
    assert body["content_version"] == "cohort-scalar-v1"
    assert body["reference_content_version"] == "cohort-reference-v1"
    assert body["descriptor"]["descriptor_version"] == "cohort-descriptor-v1"
    assert [(row["territory"]["id"], row["value"], row["status"],
             row["support_count"], row["denominator_count"]) for row in body["observations"]] == [
        ("cohort-c1", 10.5, "measured", 100, 200),
        ("cohort-c2", 20.25, "measured", 150, 300),
        ("cohort-c3", 99.0, "measured", 900, 1000),
    ]
    assert all(row["sources"] == [{
        "source_id": "cohort-source", "name": "Cohort source", "vintage_id": "cohort-v1",
        "version": "2026", "reference_date": "2026-01-01", "publication_date": "2026-01-02",
    }] for row in body["observations"])
    assert epci_population.status_code == 200, epci_population.text
    assert epci_population.json()["cohort"]["member_count"] == 2
    assert len(epci_population.json()["observations"]) == 2
    assert commune_query_count == epci_query_count
    assert multi_batch.status_code == 200, multi_batch.text
    batch_data = {result["id"]: result["data"] for result in multi_batch.json()["results"]}
    assert batch_data == {
        "profile": profile.json(), "period": period_detail.json(),
        "membership": membership.json(), "reading": typed_reading.json(),
        "milieux": milieux_reading.json(), "series": owned_series.json(),
        "legacy-series": legacy_series.json(), "aedar": aedar.json(),
    }
    assert invalid_batch.status_code == 422
    assert "results" not in invalid_batch.json()
    assert invalid_coordinate.status_code == 422
    assert over_budget.status_code == 413
    assert over_axis_work.status_code == 413
    assert over_response.status_code == 413
    assert stale.status_code == 503

    assert filtered.status_code == 200, filtered.text
    filtered_body = filtered.json()
    assert filtered_body["cohort"]["member_count"] == 2
    assert {member["id"] for member in filtered_body["cohort"]["members"]} == {
        "cohort-c1", "cohort-c2"}
    assert {row["territory"]["id"] for row in filtered_body["observations"]} == {
        "cohort-c1", "cohort-c2"}
    assert all("support_count" not in row and "denominator_count" not in row
               for row in filtered_body["observations"])
    assert filtered_batch.status_code == 200, filtered_batch.text
    assert filtered_batch.json()["results"][0]["data"] == filtered_body
    assert profile.status_code == 200, profile.text
    profile_body = profile.json()
    assert profile_body["shape"] == "declared_profile"
    assert profile_body["content_version"] == "cohort-profile-v1"
    assert profile_body["descriptor"]["descriptor_version"] == "cohort-profile-v1"
    assert [entry["territory"]["id"] for entry in profile_body["profiles"]] == [
        "cohort-c1", "cohort-c2"]
    assert [entry["cells"][0]["detail"] for entry in profile_body["profiles"]] == ["<15", "<15"]
    assert [entry["cells"][0]["status"] for entry in profile_body["profiles"]] == [
        "measured", "suppressed"]
    assert [entry["cells"][0].get("value") for entry in profile_body["profiles"]] == [
        0.25, None]
    assert all(entry["cells"][0]["sources"][0]["version"] == "2026"
               for entry in profile_body["profiles"])
    assert period_detail.status_code == 200, period_detail.text
    period_body = period_detail.json()
    assert period_body["content_version"] == "cohort-domain-v1"
    assert [member["availability"] for member in period_body["territories"]] == ["observed", "no_record"]
    assert period_body["territories"][0]["entries"] == [{
        "detail": "education", "label": "Éducation", "observation_period": "2025",
        "value": 125.0, "status": "measured", "sources": [{
            "source_id": "cohort-source", "name": "Cohort source", "vintage_id": "cohort-v1",
            "version": "2026", "reference_date": "2026-01-01", "publication_date": "2026-01-02",
        }],
    }]
    assert membership.status_code == 200, membership.text
    membership_body = membership.json()
    assert membership_body["content_version"] == "cohort-membership-v1"
    assert [member["availability"] for member in membership_body["territories"]] == ["observed", "no_record"]
    assert membership_body["territories"][0]["entries"][0]["detail"] == "ACV"
    assert membership_body["territories"][0]["entries"][0]["rider"] == "Convention valant ORT"
    assert membership_body["territories"][0]["summaries"] == [{
        "detail": "ACV", "label": "Action cœur de ville", "anchor_count": 1,
    }]
    assert typed_reading.status_code == 200, typed_reading.text
    reading_body = typed_reading.json()
    assert reading_body["content_version"] == "cohort-economy-v1"
    assert [territory["territory"]["id"] for territory in reading_body["territories"]] == [
        "cohort-c1", "cohort-c2"]
    assert reading_body["territories"][0]["facts"][0]["status"] == "measured"
    assert reading_body["territories"][0]["facts"][0]["source_id"] == "cohort-source"
    assert reading_body["territories"][0]["facts"][0]["vintage_id"] == "cohort-v1"
    assert reading_body["territories"][0]["ranked_activities"] == [{
        "territory_id": "cohort-c1", "territory_type": "commune", "groupe": "sante-et-taille",
        "rank": 1, "activity_code": "A01", "activity_label": "Agriculture", "lq": 2.5,
        "establishment_count": 12, "park_share": 0.2, "source_id": "cohort-source", "vintage_id": "cohort-v1",
    }]
    assert reading_body["territories"][1]["facts"][0]["status"] == "unavailable"
    assert reading_body["territories"][1]["ranked_activities"] == []
    assert milieux_reading.status_code == 200, milieux_reading.text
    milieux_body = milieux_reading.json()
    assert milieux_body["content_version"] == "cohort-milieux-v1"
    assert [item["territory"]["id"] for item in milieux_body["territories"]] == [
        "cohort-c1", "cohort-c2"]
    assert milieux_body["territories"][0]["source_bindings"][0]["field_key"] == "population"
    assert milieux_body["territories"][0]["source_bindings"][0]["population_revision_id"] == "cohort-milieux-population"
    assert milieux_body["territories"][0]["source_bindings"][0]["observation_period"] == "2020"
    assert milieux_body["territories"][0]["source_absences"] == []
    assert milieux_body["territories"][1]["facts"] == []
    assert milieux_body["territories"][1]["source_absences"] == [{
        "territory_id": "cohort-c2", "territory_type": "commune", "reason": "source_record_absent",
        "source_id": "cohort-source", "vintage_id": "cohort-v1", "source_snapshot_sha256": "a" * 64,
    }]
    assert milieux_absence_projection.status_code == 200, milieux_absence_projection.text
    assert all(item["facts"] == [] for item in milieux_absence_projection.json()["territories"])
    assert milieux_absence_projection.json()["territories"][0]["source_absences"] == []
    assert len(milieux_absence_projection.json()["territories"][1]["source_absences"]) == 1
    assert owned_series.status_code == 200, owned_series.text
    series_body = owned_series.json()
    assert series_body["shape"] == "ordered_series"
    assert series_body["descriptor"]["absence_semantics"] == "no_record"
    assert [item["territory"]["id"] for item in series_body["series"]] == [
        "cohort-c1", "cohort-c2", "cohort-c3"]
    assert [(point["axis"], point["status"], point.get("value"))
            for point in series_body["series"][0]["points"]] == [
        ("2024", "measured", 230.0), ("2025", "missing", None)]
    assert series_body["series"][0]["points"][0]["provenance"][0]["version"] == "2026"
    assert series_body["series"][2]["availability"] == "no_record"
    assert series_body["series"][2]["points"] == []
    assert legacy_series.status_code == 200, legacy_series.text
    legacy_series_body = legacy_series.json()
    assert legacy_series_body["content_version"] == "cohort-legacy-series-v1"
    assert [member["territory"]["id"] for member in legacy_series_body["series"]] == [
        "cohort-c1", "cohort-c2", "cohort-c3"]
    assert [point["status"] for point in legacy_series_body["series"][0]["points"]] == [
        "measured", "missing"]
    assert legacy_series_body["series"][0]["points"][0]["source_version"] == "2026"
    assert aedar.status_code == 200, aedar.text
    aedar_body = aedar.json()
    assert aedar_body["content_version"] == "cohort-aedar-v1"
    assert len(aedar_body["facts"]) == 1
    assert aedar_body["facts"][0]["territory_id"] == "cohort-c1"
    assert aedar_body["facts"][0]["typequ"] == "cohort-typequ"
    assert aedar_body["facts"][0]["measures"] == {"count_5_walk_mean": 12.5}
    assert (aedar_body["facts"][0]["source_id"], aedar_body["facts"][0]["vintage_id"]) == (
        "aedar_bretagne", "2026-v1")
