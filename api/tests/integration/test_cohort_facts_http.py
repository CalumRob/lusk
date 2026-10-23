"""Focused guarded HTTP coverage for bounded population fact families."""

from __future__ import annotations

from contextlib import contextmanager

import pytest

from api.tests.integration.test_postgres_publication import canonical_db_env

pytestmark = pytest.mark.integration


class CohortHTTP:
    def __init__(self, client, publish_dsn, query_counter):
        self.client = client
        self.publish_dsn = publish_dsn
        self.query_counter = query_counter

    @staticmethod
    def item(resource, *, territory_type="commune", department_id=None, epci_id=None,
             coordinates=None, fields=None, item_id=None):
        target = {"kind": "territory_cohort", "type": territory_type}
        if department_id is not None:
            target["department_id"] = department_id
        if epci_id is not None:
            target["epci_id"] = epci_id
        result = {"resource": resource, "target": target, "intent": {"kind": "facts"}}
        if coordinates is not None:
            result["coordinates"] = coordinates
        if fields is not None:
            result["fields"] = fields
        if item_id is not None:
            result["id"] = item_id
        return result

    def read(self, resource, **kwargs):
        payload = self.item(resource, **kwargs)
        payload.pop("id", None)
        return self.client.post("/api/resources/read", json=payload)

    def focal(self, resource, *, territory_id="cohort-c1", territory_type="commune",
              coordinates=None, fields=None):
        item = {"resource": resource,
                "target": {"kind": "territory", "type": territory_type, "id": territory_id},
                "intent": {"kind": "facts"}}
        if coordinates is not None:
            item["coordinates"] = coordinates
        if fields is not None:
            item["fields"] = fields
        return self.client.post("/api/resources/read", json=item)

    def batch(self, items):
        return self.client.post("/api/resources/read-batch", json={"items": items})

    def publish(self, *statements):
        import psycopg

        with psycopg.connect(self.publish_dsn, autocommit=True) as publisher:
            with publisher.transaction():
                for sql, params in statements:
                    publisher.execute(sql, params)


@pytest.fixture
def cohort_http(canonical_db_env):
    import psycopg
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
            publisher.execute("INSERT INTO source_dataset(source_id,name) VALUES ('cohort-evidence-source','Evidence source')")
            publisher.execute("""INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date)
                VALUES ('cohort-evidence-source','cohort-evidence-v1','evidence-2025',NULL,'2025-03-04')""")

            publisher.execute("""INSERT INTO scalar_descriptor(indicator_id,theme_id,label,unit,direction,
                comparison_facet,allowed_levels,denominator_semantics,completeness,descriptor_version)
                VALUES ('densite','demographie','Densité de population','hab./km²','high','densite',
                    ARRAY['commune','epci','departement'],'population','dense_complete','cohort-descriptor-v1')""")
            publisher.execute("INSERT INTO scalar_descriptor_source VALUES ('densite','cohort-source')")
            scalar_rows = (
                ('cohort-c1', 'commune', 10.5, 100, 200),
                ('cohort-c2', 'commune', 20.25, 150, 300),
                ('cohort-c3', 'commune', 99.0, 900, 1000),
                ('cohort-e29', 'epci', 100.5, 1000, 2000),
                ('cohort-e22', 'epci', 200.5, 2000, 4000),
            )
            for territory_id, territory_type, value, support, denominator in scalar_rows:
                publisher.execute("""INSERT INTO scalar_observation(
                    indicator_id,territory_id,territory_type,value,status,support_count,denominator_count)
                    VALUES ('densite',%s,%s,%s,'measured',%s,%s)""",
                    (territory_id, territory_type, value, support, denominator))
                publisher.execute("""INSERT INTO scalar_observation_source
                    VALUES ('densite',%s,'cohort-source','cohort-v1')""", (territory_id,))
            publisher.execute("""INSERT INTO table_publication(
                table_name,content_version,row_count,reference_content_version)
                VALUES ('scalar_observation','cohort-scalar-v1',5,'cohort-reference-v1')""")

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
                        publisher.execute("""INSERT INTO profile_observation(
                            indicator_id,territory_id,territory_type,detail_key,sex_key,value,status)
                            VALUES ('structure_age',%s,'commune',%s,%s,%s,%s)""",
                            (territory_id, detail, sex, None if suppressed else 0.25,
                             "suppressed" if suppressed else "measured"))
                        publisher.execute("""INSERT INTO profile_observation_source
                            VALUES ('structure_age',%s,%s,%s,'cohort-source','cohort-v1')""",
                            (territory_id, detail, sex))
            publisher.execute("""INSERT INTO table_publication(
                table_name,content_version,row_count,reference_content_version)
                VALUES ('declared_profile','cohort-profile-v1',12,'cohort-reference-v1')""")

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
                    12,0.2,'cohort-evidence-source','cohort-evidence-v1')""")
            publisher.execute("""INSERT INTO table_publication(
                table_name,content_version,row_count,reference_content_version)
                VALUES ('economy_typed_reading','cohort-economy-v1',2,'cohort-reference-v1'),
                       ('economy_activity_evidence','cohort-economy-evidence-v1',1,'cohort-reference-v1')""")

            publisher.execute("""INSERT INTO demographic_reading_descriptor(
                singleton,descriptor_version,source_id,vintage_id,rate_unit)
                VALUES (true,'cohort-demographic-v1','cohort-source','cohort-v1','‰/an')""")
            publisher.execute("""INSERT INTO demographic_typed_reading(
                territory_id,territory_type,groupe,story_key,salience_reason,periode,
                solde_naturel,solde_migratoire,taux_solde_naturel,taux_solde_migratoire,
                classification,status,source_id,vintage_id)
                VALUES ('cohort-c1','commune','trajectoire-demographique','histoire-naturel','source','2025',
                    10,20,0.01,0.02,'balanced','measured','cohort-source','cohort-v1'),
                       ('cohort-c2','commune','trajectoire-demographique','histoire-naturel','source',
                    NULL,NULL,NULL,NULL,NULL,NULL,'unavailable','cohort-source','cohort-v1')""")
            publisher.execute("""INSERT INTO table_publication(
                table_name,content_version,row_count,reference_content_version)
                VALUES ('demographic_typed_reading','cohort-demographic-v1',2,'cohort-reference-v1')""")

            publisher.execute("""INSERT INTO selected_reading_descriptor(
                theme_id,descriptor_version,source_id,vintage_id,linked_content_version)
                VALUES ('habitat','cohort-habitat-v1','cohort-source','cohort-v1','linked-dpe-v1')""")
            publisher.execute("""INSERT INTO selected_reading_publication(
                theme_id,content_version,reference_content_version,row_count)
                VALUES ('habitat','cohort-habitat-v1','cohort-reference-v1',2)""")
            publisher.execute("""INSERT INTO habitat_typed_reading(
                territory_id,territory_type,groupe,story_key,salience_reason,classification,
                part_passoires,part_abc,n_dpe,status,source_id,vintage_id)
                VALUES ('cohort-c1','commune','etat-energetique-du-parc','diagnostics','source',
                    'energivore',0.2,0.3,12,'measured','cohort-source','cohort-v1'),
                       ('cohort-c2','commune','etat-energetique-du-parc','diagnostics','source',
                    NULL,NULL,NULL,4,'suppressed','cohort-source','cohort-v1')""")
            publisher.execute("""INSERT INTO table_publication(
                table_name,content_version,row_count,reference_content_version)
                VALUES ('selected_reading','cohort-habitat-v1',2,'cohort-reference-v1')""")

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
            publisher.execute("""INSERT INTO series_dataset_publication(
                dataset_id,content_version,reference_content_version,row_count)
                VALUES ('cohort_artif_states','cohort-artif-v1','cohort-reference-v1',2)""")
            publisher.execute("""INSERT INTO series_dataset_descriptor(
                dataset_id,indicator_id,axis_kind,axis_values,completeness,label,unit,direction,
                allowed_levels,descriptor_version)
                VALUES ('cohort_artif_states','artif_par_habitant','state_role',ARRAY['M2','M3'],
                    'dense_complete','Artificialisation par habitant','m²/hab.','none',
                    ARRAY['commune'],'cohort-artif-desc-v1')""")
            publisher.execute("""INSERT INTO series_provenance_revision(
                provenance_revision_id,source_id,vintage_id,source_name,dataset_name,source_version,
                reference_date,publication_date,revision_hash)
                VALUES ('cohort-artif-revision','cohort-source','cohort-v1','Cohort source',
                    'Artificialisation','2026','2026-01-01','2026-01-02','cohort-artif-hash')""")
            publisher.execute("""INSERT INTO series_dataset_observation(
                dataset_id,indicator_id,territory_id,territory_type,axis_value,state_role,
                observation_period,value,status)
                VALUES ('cohort_artif_states','artif_par_habitant','cohort-c1','commune','M2','M2',
                    '2021',10,'measured'),
                       ('cohort_artif_states','artif_par_habitant','cohort-c1','commune','M3','M3',
                    '2021',12,'measured')""")
            publisher.execute("""INSERT INTO series_observation_provenance
                VALUES ('cohort_artif_states','artif_par_habitant','cohort-c1','M2','cohort-artif-revision'),
                       ('cohort_artif_states','artif_par_habitant','cohort-c1','M3','cohort-artif-revision')""")
            publisher.execute("""INSERT INTO milieux_reading_source(
                territory_id,territory_type,groupe,field_key,source_id,vintage_id,source_name,source_version,
                reference_date,publication_date,observation_period,population_revision_id)
                VALUES ('cohort-c1','commune','artificialisation','population','cohort-source','cohort-v1',
                    'Cohort source','2026','2026-01-01','2026-01-02','2020','cohort-milieux-population')""")
            publisher.execute("""INSERT INTO milieux_reading_source(
                territory_id,territory_type,groupe,field_key,source_id,vintage_id,source_name,source_version,
                reference_date,publication_date,observation_period,dataset_id,dataset_content_version,
                state_role,axis_value,provenance_revision_id)
                VALUES ('cohort-c1','commune','artificialisation','artif_m2_par_habitant',
                    'cohort-source','cohort-v1','Cohort source','2026','2026-01-01','2026-01-02',
                    '2021','cohort_artif_states','cohort-artif-v1','M2','M2','cohort-artif-revision'),
                       ('cohort-c1','commune','artificialisation','artif_m3_par_habitant',
                    'cohort-source','cohort-v1','Cohort source','2026','2026-01-01','2026-01-02',
                    '2021','cohort_artif_states','cohort-artif-v1','M3','M3','cohort-artif-revision')""")
            publisher.execute("""INSERT INTO milieux_reading_absence(
                territory_id,territory_type,reason,source_id,vintage_id,source_snapshot_sha256)
                VALUES ('cohort-c2','commune','source_record_absent','cohort-source','cohort-v1',%s),
                       ('cohort-c3','commune','source_record_absent','cohort-source','cohort-v1',%s)""",
                ('a' * 64, 'a' * 64))
            publisher.execute("""INSERT INTO table_publication(
                table_name,content_version,row_count,reference_content_version)
                VALUES ('milieux_typed_reading','cohort-milieux-v1',1,'cohort-reference-v1'),
                       ('milieux_reading_absence','cohort-milieux-v1',2,'cohort-reference-v1')""")

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
            series_rows = (
                ('cohort-c1', '2024', 230.0, 'measured'),
                ('cohort-c1', '2025', None, 'missing'),
                ('cohort-c2', '2024', 123.0, 'measured'),
            )
            for territory_id, axis, value, status in series_rows:
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
            for territory_id, axis, value, status in series_rows:
                publisher.execute("""INSERT INTO ordered_series(
                    indicator_id,territory_id,territory_type,axis_value,observation_period,value,status,
                    source_id,vintage_id)
                    VALUES ('subventions_annuelles',%s,'commune',%s,'2025',%s,%s,'cohort-source','cohort-v1')""",
                    (territory_id, axis, value, status))
            publisher.execute("""INSERT INTO table_publication(
                table_name,content_version,row_count,reference_content_version)
                VALUES ('ordered_series','cohort-legacy-series-v1',3,'cohort-reference-v1')""")

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
    try:
        with TestClient(main.app) as client:
            yield CohortHTTP(client, canonical_db_env["publish_dsn"], query_counter)
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous
        pool.close()


def test_scalar_cohort_intersects_commune_parent_filters_and_keeps_support_and_lineage(cohort_http):
    all_communes = cohort_http.read("densite")
    filtered = cohort_http.read("densite", department_id="29", epci_id="cohort-e29", fields=["value"])

    assert all_communes.status_code == 200, all_communes.text
    body = all_communes.json()
    assert body["cohort"]["member_count"] == 3
    assert [row["territory"]["id"] for row in body["observations"]] == [
        "cohort-c1", "cohort-c2", "cohort-c3"]
    assert body["content_version"] == "cohort-scalar-v1"
    assert body["reference_content_version"] == "cohort-reference-v1"
    assert body["descriptor"]["descriptor_version"] == "cohort-descriptor-v1"
    assert [(row["value"], row["status"], row["support_count"], row["denominator_count"])
            for row in body["observations"]] == [
        (10.5, "measured", 100, 200), (20.25, "measured", 150, 300),
        (99.0, "measured", 900, 1000)]
    assert all(row["sources"] == [{
        "source_id": "cohort-source", "name": "Cohort source", "vintage_id": "cohort-v1",
        "version": "2026", "reference_date": "2026-01-01", "publication_date": "2026-01-02",
    }] for row in body["observations"])
    assert filtered.status_code == 200, filtered.text
    filtered_body = filtered.json()
    assert {member["id"] for member in filtered_body["cohort"]["members"]} == {
        "cohort-c1", "cohort-c2"}
    assert {row["territory"]["id"] for row in filtered_body["observations"]} == {
        "cohort-c1", "cohort-c2"}
    assert all("support_count" not in row and "denominator_count" not in row
               for row in filtered_body["observations"])


def test_profile_cohort_preserves_declared_axes_suppression_and_sources(cohort_http):
    response = cohort_http.read("structure_age", department_id="29", epci_id="cohort-e29",
        coordinates={"detail": ["<15"], "sex": ["M"]})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["shape"] == "declared_profile"
    assert body["content_version"] == "cohort-profile-v1"
    assert body["descriptor"]["descriptor_version"] == "cohort-profile-v1"
    assert [entry["territory"]["id"] for entry in body["profiles"]] == ["cohort-c1", "cohort-c2"]
    assert [entry["cells"][0]["detail"] for entry in body["profiles"]] == ["<15", "<15"]
    assert [entry["cells"][0]["status"] for entry in body["profiles"]] == ["measured", "suppressed"]
    assert [entry["cells"][0].get("value") for entry in body["profiles"]] == [0.25, None]
    assert all(entry["cells"][0]["sources"][0]["version"] == "2026"
               for entry in body["profiles"])


def test_period_detail_cohort_keeps_sparse_availability_and_measurement_provenance(cohort_http):
    response = cohort_http.read("subventions_par_domaine", department_id="29", epci_id="cohort-e29",
        coordinates={"period": ["2025"], "detail": ["education"]}, fields=["value"])

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["content_version"] == "cohort-domain-v1"
    assert [member["availability"] for member in body["territories"]] == ["observed", "no_record"]
    assert body["territories"][0]["entries"] == [{
        "detail": "education", "label": "Éducation", "observation_period": "2025",
        "value": 125.0, "status": "measured", "sources": [{
            "source_id": "cohort-source", "name": "Cohort source", "vintage_id": "cohort-v1",
            "version": "2026", "reference_date": "2026-01-01", "publication_date": "2026-01-02",
        }],
    }]
    assert body["territories"][1]["entries"] == []


def test_anchored_membership_cohort_keeps_rider_and_source_anchor_counts(cohort_http):
    response = cohort_http.read("couverture_programmes", department_id="29", epci_id="cohort-e29",
        coordinates={"membership": ["ACV"]},
        fields=["detail", "label", "rider", "anchor_count", "availability"])

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["content_version"] == "cohort-membership-v1"
    assert [member["availability"] for member in body["territories"]] == ["observed", "no_record"]
    assert body["territories"][0]["entries"][0]["detail"] == "ACV"
    assert body["territories"][0]["entries"][0]["rider"] == "Convention valant ORT"
    assert body["territories"][0]["summaries"] == [{
        "detail": "ACV", "label": "Action cœur de ville", "anchor_count": 1,
    }]


def test_economy_typed_reading_cohort_preserves_status_and_ranked_evidence(cohort_http):
    response = cohort_http.read("economie_selected_reading", department_id="29", epci_id="cohort-e29",
        coordinates={"groupe": ["sante-et-taille"]},
        fields=["status", "source_id", "vintage_id", "ranked_activities"])

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["content_version"] == "cohort-economy-v1"
    assert body["reference_content_version"] == "cohort-reference-v1"
    assert [item["territory"]["id"] for item in body["territories"]] == ["cohort-c1", "cohort-c2"]
    assert (body["territories"][0]["facts"][0]["status"],
            body["territories"][0]["facts"][0]["source_id"],
            body["territories"][0]["facts"][0]["vintage_id"]) == (
        "measured", "cohort-source", "cohort-v1")
    assert body["territories"][0]["ranked_activities"] == [{
        "territory_id": "cohort-c1", "territory_type": "commune", "groupe": "sante-et-taille",
        "rank": 1, "activity_code": "A01", "activity_label": "Agriculture", "lq": 2.5,
        "establishment_count": 12, "park_share": 0.2,
        "source_id": "cohort-evidence-source", "vintage_id": "cohort-evidence-v1",
        "source": {"source_id": "cohort-evidence-source", "name": "Evidence source",
            "vintage_id": "cohort-evidence-v1", "version": "evidence-2025",
            "reference_date": None, "publication_date": "2025-03-04"},
    }]
    assert body["territories"][1]["facts"][0]["status"] == "unavailable"
    assert body["territories"][1]["ranked_activities"] == []


def test_milieux_cohort_keeps_explicit_source_absence_separate_from_sparse_facts(cohort_http):
    response = cohort_http.read("milieux_selected_reading", department_id="29", epci_id="cohort-e29",
        coordinates={"groupe": ["artificialisation"]},
        fields=["status", "source_absences", "source_bindings"])
    absence_projection = cohort_http.read("milieux_selected_reading", department_id="29", epci_id="cohort-e29",
        coordinates={"groupe": ["artificialisation"]}, fields=["source_absences"])

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["content_version"] == "cohort-milieux-v1"
    assert [item["territory"]["id"] for item in body["territories"]] == ["cohort-c1", "cohort-c2"]
    population_binding = next(item for item in body["territories"][0]["source_bindings"]
                              if item["field_key"] == "population")
    assert population_binding["population_revision_id"] == "cohort-milieux-population"
    assert population_binding["observation_period"] == "2020"
    series_bindings = {item["field_key"]: item for item in body["territories"][0]["source_bindings"]
                       if item["field_key"] != "population"}
    assert set(series_bindings) == {"artif_m2_par_habitant", "artif_m3_par_habitant"}
    assert series_bindings["artif_m2_par_habitant"]["source"] == {
        "source_id": "cohort-source", "name": "Cohort source", "vintage_id": "cohort-v1",
        "version": "2026", "reference_date": "2026-01-01", "publication_date": "2026-01-02",
    }
    assert series_bindings["artif_m2_par_habitant"]["provenance_revision_id"] == "cohort-artif-revision"
    assert body["territories"][0]["source_absences"] == []
    assert body["territories"][1]["facts"] == []
    assert body["territories"][1]["source_absences"] == [{
        "territory_id": "cohort-c2", "territory_type": "commune", "reason": "source_record_absent",
        "source_id": "cohort-source", "vintage_id": "cohort-v1", "source_snapshot_sha256": "a" * 64,
        "source": {"source_id": "cohort-source", "name": "Cohort source", "vintage_id": "cohort-v1",
            "version": "2026", "reference_date": "2026-01-01", "publication_date": "2026-01-02"},
    }]
    assert absence_projection.status_code == 200, absence_projection.text
    projected = absence_projection.json()["territories"]
    assert all(item["facts"] == [] for item in projected)
    assert projected[0]["source_absences"] == []
    assert len(projected[1]["source_absences"]) == 1


def test_owned_series_cohort_preserves_sparse_no_record_and_lineage(cohort_http):
    response = cohort_http.read("prix_m2", coordinates={"year": ["2024", "2025"]}, fields=["value"])

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["shape"] == "ordered_series"
    assert body["descriptor"]["absence_semantics"] == "no_record"
    assert [item["territory"]["id"] for item in body["series"]] == [
        "cohort-c1", "cohort-c2", "cohort-c3"]
    assert [(point["axis"], point["status"], point.get("value"))
            for point in body["series"][0]["points"]] == [
        ("2024", "measured", 230.0), ("2025", "missing", None)]
    assert body["series"][0]["points"][0]["provenance"][0]["version"] == "2026"
    assert body["series"][2]["availability"] == "no_record"
    assert body["series"][2]["points"] == []


def test_legacy_series_cohort_preserves_declared_axis_and_source_vintage(cohort_http):
    response = cohort_http.read("subventions_annuelles", coordinates={"year": ["2024", "2025"]},
                                fields=["value"])

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["content_version"] == "cohort-legacy-series-v1"
    assert [member["territory"]["id"] for member in body["series"]] == [
        "cohort-c1", "cohort-c2", "cohort-c3"]
    assert [point["status"] for point in body["series"][0]["points"]] == ["measured", "missing"]
    assert body["series"][0]["points"][0]["source_version"] == "2026"


def test_batch_family_parity_is_all_or_none(cohort_http):
    specs = [
        ("scalar", "densite", {"department_id": "29", "epci_id": "cohort-e29"}, None, ["value"]),
        ("profile", "structure_age", {"department_id": "29", "epci_id": "cohort-e29"},
         {"detail": ["<15"], "sex": ["M"]}, None),
        ("period", "subventions_par_domaine", {"department_id": "29", "epci_id": "cohort-e29"},
         {"period": ["2025"], "detail": ["education"]}, ["value"]),
        ("membership", "couverture_programmes", {"department_id": "29", "epci_id": "cohort-e29"},
         {"membership": ["ACV"]}, ["detail", "label", "rider", "anchor_count", "availability"]),
        ("economy", "economie_selected_reading", {"department_id": "29", "epci_id": "cohort-e29"},
         {"groupe": ["sante-et-taille"]}, ["status", "ranked_activities"]),
        ("milieux", "milieux_selected_reading", {"department_id": "29", "epci_id": "cohort-e29"},
         {"groupe": ["artificialisation"]}, ["status", "source_absences", "source_bindings"]),
        ("owned", "prix_m2", {}, {"year": ["2024", "2025"]}, ["value"]),
        ("legacy", "subventions_annuelles", {}, {"year": ["2024", "2025"]}, ["value"]),
    ]
    expected = {}
    items = []
    for request_id, resource, target_options, coordinates, fields in specs:
        item = cohort_http.item(resource, **target_options, coordinates=coordinates,
                                fields=fields, item_id=request_id)
        items.append(item)
        individual = dict(item)
        individual.pop("id")
        response = cohort_http.client.post("/api/resources/read", json=individual)
        assert response.status_code == 200, response.text
        expected[request_id] = response.json()

    response = cohort_http.batch(items)
    assert response.status_code == 200, response.text
    assert {row["id"]: row["data"] for row in response.json()["results"]} == expected

    rejected = cohort_http.batch([
        cohort_http.item("densite", item_id="valid"),
        cohort_http.item("densite", department_id="98", item_id="invalid"),
    ])
    assert rejected.status_code == 422
    assert "results" not in rejected.json()


@pytest.mark.parametrize("resource,coordinates,fields", [
    ("densite", None, ["value"]),
    ("structure_age", {"detail": ["<15"], "sex": ["M"]}, None),
    ("subventions_par_domaine", {"period": ["2025"], "detail": ["education"]}, ["value"]),
    ("couverture_programmes", {"membership": ["ACV"]}, ["detail", "availability"]),
    ("economie_selected_reading", {"groupe": ["sante-et-taille"]}, ["status", "ranked_activities"]),
    ("milieux_selected_reading", {"groupe": ["artificialisation"]},
     ["status", "source_absences", "source_bindings"]),
    ("prix_m2", {"year": ["2024"]}, ["value"]),
    ("subventions_annuelles", {"year": ["2024"]}, ["value"]),
])
def test_family_query_count_is_independent_of_population_size(cohort_http, resource, coordinates, fields):
    def measured_count(**target_options):
        before = cohort_http.query_counter["count"]
        response = cohort_http.read(resource, coordinates=coordinates, fields=fields, **target_options)
        count = cohort_http.query_counter["count"] - before
        assert response.status_code == 200, response.text
        return count

    full_population = measured_count()
    filtered_population = measured_count(department_id="29", epci_id="cohort-e29")
    # The filtered target performs two fixed parent-identity lookups. Its actual
    # family-query count must otherwise stay independent of member cardinality.
    assert filtered_population - full_population == 2


def test_cohort_work_output_and_dependency_failures_remain_bounded(cohort_http, monkeypatch):
    invalid_scope = cohort_http.read("densite", department_id="98")
    invalid_coordinate = cohort_http.read("structure_age", coordinates={"detail": ["not-an-axis"]})
    with monkeypatch.context() as patch:
        from api import resource_execution
        patch.setattr(resource_execution, "MAX_WORK_UNITS", 2)
        over_members = cohort_http.read("densite")
    with monkeypatch.context() as patch:
        from api import resource_execution
        patch.setattr(resource_execution, "MAX_WORK_UNITS", 9)
        over_axis_work = cohort_http.read("prix_m2", coordinates={"year": ["2024", "2025"]})
    with monkeypatch.context() as patch:
        from api import resource_execution
        patch.setattr(resource_execution, "MAX_WORK_UNITS", 4)
        over_owned_integrity = cohort_http.read("prix_m2", department_id="29", epci_id="cohort-e29",
                                                coordinates={"year": ["2024"]})
    with monkeypatch.context() as patch:
        from api import resource_execution
        patch.setattr(resource_execution, "MAX_WORK_UNITS", 3)
        over_typed_integrity = cohort_http.read("economie_selected_reading",
            department_id="29", epci_id="cohort-e29",
            coordinates={"groupe": ["sante-et-taille"]}, fields=["status"])
    with monkeypatch.context() as patch:
        from api import resource_execution
        patch.setattr(resource_execution, "MAX_RESPONSE_BYTES", 100)
        over_response = cohort_http.read("densite")

    cohort_http.publish(("UPDATE table_publication SET reference_content_version='stale-reference' "
                         "WHERE table_name='scalar_observation'", ()))
    try:
        stale = cohort_http.read("densite")
    finally:
        cohort_http.publish(("UPDATE table_publication SET reference_content_version='cohort-reference-v1' "
                             "WHERE table_name='scalar_observation'", ()))

    assert invalid_scope.status_code == 422
    assert invalid_coordinate.status_code == 422
    assert over_members.status_code == 413
    assert over_axis_work.status_code == 413
    assert over_owned_integrity.status_code == 413
    assert over_typed_integrity.status_code == 413
    assert over_response.status_code == 413
    assert stale.status_code == 503


def test_owned_series_rejects_truncated_published_rows_for_subset_and_axis(cohort_http):
    # Simulate physical truncation in this throwaway schema while keeping the
    # publication token and declared row count unchanged; restore the deferred
    # publisher guard before committing the synthetic inconsistent state.
    cohort_http.publish(
        ("ALTER TABLE series_dataset_publication DISABLE TRIGGER series_dataset_publication_complete", ()),
        ("UPDATE series_dataset_publication SET published_at=transaction_timestamp() "
         "WHERE dataset_id='dvf_prix_m2'", ()),
        ("DELETE FROM series_dataset_observation WHERE dataset_id='dvf_prix_m2' "
         "AND indicator_id='prix_m2' AND territory_id='cohort-c1' AND axis_value='2024'", ()),
        ("ALTER TABLE series_dataset_publication ENABLE TRIGGER series_dataset_publication_complete", ()),
    )
    response = cohort_http.read("prix_m2", department_id="29", epci_id="cohort-e29",
                                coordinates={"year": ["2024"]}, fields=["value"])
    assert response.status_code == 503, response.text
    assert "row count" in response.json()["detail"]


def test_typed_reading_rejects_truncated_primary_rows_with_publication_marker_intact(cohort_http):
    cohort_http.publish(("DELETE FROM economy_typed_reading WHERE territory_id='cohort-c1' "
                         "AND groupe='sante-et-taille'", ()))
    response = cohort_http.read("economie_selected_reading", department_id="29", epci_id="cohort-e29",
        coordinates={"groupe": ["sante-et-taille"]}, fields=["status"])

    assert response.status_code == 503, response.text
    assert response.json()["detail"] == "Typed-reading publication row count is inconsistent"


def test_typed_reading_rejects_truncated_ranked_evidence_with_marker_intact(cohort_http):
    cohort_http.publish(("DELETE FROM economy_activity_evidence WHERE territory_id='cohort-c1' "
                         "AND rank=1", ()))
    response = cohort_http.read("economie_selected_reading", department_id="29", epci_id="cohort-e29",
        coordinates={"groupe": ["sante-et-taille"]}, fields=["ranked_activities"])

    assert response.status_code == 503, response.text
    assert response.json()["detail"] == "Typed-reading publication row count is inconsistent"


def test_batch_observes_one_repeatable_read_snapshot_across_preflight_and_reads(cohort_http):
    from api import main

    original_provider = main.get_semantic_resource_reader
    reader = original_provider()

    class MutatingReader:
        mutated = False

        def preflight(self, *args, **kwargs):
            estimate = reader.preflight(*args, **kwargs)
            if not self.mutated:
                self.mutated = True
                cohort_http.publish(
                    ("UPDATE scalar_observation SET value=77 WHERE indicator_id='densite' "
                     "AND territory_id='cohort-c1'", ()),
                    ("UPDATE table_publication SET content_version='cohort-scalar-v2' "
                     "WHERE table_name='scalar_observation'", ()),
                )
            return estimate

        def read(self, *args, **kwargs):
            return reader.read(*args, **kwargs)

    main.app.dependency_overrides[main.get_semantic_resource_reader] = MutatingReader
    try:
        response = cohort_http.batch([
            cohort_http.item("densite", fields=["value"], item_id="first"),
            cohort_http.item("densite", fields=["value"], item_id="second"),
        ])
    finally:
        main.app.dependency_overrides.pop(main.get_semantic_resource_reader, None)

    assert response.status_code == 200, response.text
    results = response.json()["results"]
    assert [item["data"]["content_version"] for item in results] == [
        "cohort-scalar-v1", "cohort-scalar-v1"]
    assert [item["data"]["observations"][0]["value"] for item in results] == [10.5, 10.5]
    next_snapshot = cohort_http.read("densite", fields=["value"])
    assert next_snapshot.status_code == 200, next_snapshot.text
    assert next_snapshot.json()["content_version"] == "cohort-scalar-v2"
    assert next_snapshot.json()["observations"][0]["value"] == 77


def test_focal_resource_evidence_is_additive_and_matches_single_batch(cohort_http):
    requests = [
        {"resource": "densite", "fields": ["value"]},
        {"resource": "structure_age", "coordinates": {"detail": ["<15"], "sex": ["F"]},
         "fields": ["value"]},
        {"resource": "economie_selected_reading",
         "coordinates": {"groupe": ["sante-et-taille"]},
         "fields": ["status", "ranked_activities"]},
        {"resource": "habitat_selected_reading",
         "coordinates": {"groupe": ["etat-energetique-du-parc"]}, "fields": ["status"]},
    ]
    singles = {}
    batch_items = []
    for index, spec in enumerate(requests):
        item = {"resource": spec["resource"],
                "target": {"kind": "territory", "type": "commune", "id": "cohort-c1"},
                "intent": {"kind": "facts"}, **{key: value for key, value in spec.items() if key != "resource"}}
        response = cohort_http.client.post("/api/resources/read", json=item)
        assert response.status_code == 200, response.text
        singles[item["resource"]] = response.json()
        batch_items.append({"id": f"focal-{index}", **item})
    batch = cohort_http.batch(batch_items)
    assert batch.status_code == 200, batch.text
    assert [row["data"] for row in batch.json()["results"]] == list(singles.values())

    assert singles["densite"]["reference_content_version"] == "cohort-reference-v1"
    assert singles["densite"]["descriptor_version"] == "cohort-descriptor-v1"
    assert singles["structure_age"]["reference_content_version"] == "cohort-reference-v1"
    economy = singles["economie_selected_reading"]
    assert economy["reference_content_version"] == "cohort-reference-v1"
    assert economy["facts"][0]["source"] == {
        "source_id": "cohort-source", "name": "Cohort source", "vintage_id": "cohort-v1",
        "version": "2026", "reference_date": "2026-01-01", "publication_date": "2026-01-02",
    }
    assert economy["ranked_activities"][0]["source"] == {
        "source_id": "cohort-evidence-source", "name": "Evidence source",
        "vintage_id": "cohort-evidence-v1", "version": "evidence-2025",
        "reference_date": None, "publication_date": "2025-03-04",
    }
    assert economy["facts"][0]["status"] == "measured"
    assert economy["facts"][0]["source_id"] == "cohort-source"
    assert economy["facts"][0]["vintage_id"] == "cohort-v1"
    habitat = singles["habitat_selected_reading"]
    assert habitat["reference_content_version"] == "cohort-reference-v1"
    assert habitat["descriptor"] == {
        "descriptor_version": "cohort-habitat-v1", "linked_content_version": "linked-dpe-v1",
        "source": {"source_id": "cohort-source", "name": "Cohort source", "vintage_id": "cohort-v1",
            "version": "2026", "reference_date": "2026-01-01", "publication_date": "2026-01-02"},
    }
    assert habitat["facts"][0]["source"]["source_id"] == "cohort-source"

    habitat_cohort = cohort_http.read("habitat_selected_reading",
        coordinates={"groupe": ["etat-energetique-du-parc"]}, fields=["status"])
    assert habitat_cohort.status_code == 200, habitat_cohort.text
    assert habitat_cohort.json()["reference_content_version"] == "cohort-reference-v1"
    assert habitat_cohort.json()["descriptor"]["linked_content_version"] == "linked-dpe-v1"
    assert habitat_cohort.json()["territories"][1]["facts"][0]["status"] == "suppressed"

    sparse_cohort = cohort_http.read("economie_selected_reading",
        coordinates={"groupe": ["sante-et-taille"]}, fields=["ranked_activities"])
    assert sparse_cohort.status_code == 200, sparse_cohort.text
    assert sparse_cohort.json()["territories"][2]["facts"] == []
    assert sparse_cohort.json()["territories"][2]["ranked_activities"] == []


def test_demographic_reading_exposes_its_declared_rate_unit_and_clock_for_focal_and_cohort(cohort_http):
    focal_item = {"resource": "demographie_selected_reading",
        "target": {"kind": "territory", "type": "commune", "id": "cohort-c1"},
        "coordinates": {"groupe": ["trajectoire-demographique"]}, "fields": ["status"],
        "intent": {"kind": "facts"}}
    focal = cohort_http.client.post("/api/resources/read", json=focal_item)
    assert focal.status_code == 200, focal.text
    body = focal.json()
    assert body["reference_content_version"] == "cohort-reference-v1"
    assert body["descriptor"] == {
        "descriptor_version": "cohort-demographic-v1", "rate_unit": "‰/an",
        "source": {"source_id": "cohort-source", "name": "Cohort source",
            "vintage_id": "cohort-v1", "version": "2026", "reference_date": "2026-01-01",
            "publication_date": "2026-01-02"},
    }
    assert body["facts"][0]["status"] == "measured"
    assert body["facts"][0]["source"]["version"] == "2026"
    batch = cohort_http.batch([{"id": "demography", **focal_item}])
    assert batch.status_code == 200, batch.text
    assert batch.json()["results"][0]["data"] == body

    cohort = cohort_http.read("demographie_selected_reading", department_id="29", epci_id="cohort-e29",
        coordinates={"groupe": ["trajectoire-demographique"]}, fields=["status"])
    assert cohort.status_code == 200, cohort.text
    cohort_body = cohort.json()
    assert cohort_body["reference_content_version"] == "cohort-reference-v1"
    assert cohort_body["descriptor"]["rate_unit"] == "‰/an"
    assert [entry["facts"][0]["status"] for entry in cohort_body["territories"]] == [
        "measured", "unavailable"]
    assert cohort_body["territories"][0]["facts"][0]["source"]["version"] == "2026"


def test_focal_typed_reading_rejects_stale_reference_dependency(cohort_http):
    cohort_http.publish(("UPDATE table_publication SET reference_content_version='stale-reference' "
                         "WHERE table_name='economy_typed_reading'", ()))
    try:
        focal = cohort_http.focal("economie_selected_reading",
            coordinates={"groupe": ["sante-et-taille"]}, fields=["status"])
        cohort = cohort_http.read("economie_selected_reading",
            coordinates={"groupe": ["sante-et-taille"]}, fields=["status"])
    finally:
        cohort_http.publish(("UPDATE table_publication SET reference_content_version='cohort-reference-v1' "
                             "WHERE table_name='economy_typed_reading'", ()))
    assert focal.status_code == 503, focal.text
    assert cohort.status_code == 503, cohort.text


def test_focal_milieux_absence_projection_keeps_sparse_state_honest(cohort_http):
    bindings = cohort_http.focal("milieux_selected_reading", territory_id="cohort-c1",
        coordinates={"groupe": ["artificialisation"]}, fields=["source_bindings"])
    observed = cohort_http.focal("milieux_selected_reading", territory_id="cohort-c1",
        coordinates={"groupe": ["artificialisation"]}, fields=["source_absences"])
    absent = cohort_http.focal("milieux_selected_reading", territory_id="cohort-c2",
        coordinates={"groupe": ["artificialisation"]}, fields=["source_absences"])
    assert bindings.status_code == observed.status_code == absent.status_code == 200, (
        bindings.text, observed.text, absent.text)
    binding = next(row for row in bindings.json()["source_bindings"]
                   if row["field_key"] == "population")
    assert binding["source"]["reference_date"] == "2026-01-01"
    assert binding["source"]["publication_date"] == "2026-01-02"
    state_binding = next(row for row in bindings.json()["source_bindings"]
                         if row["field_key"] == "artif_m2_par_habitant")
    assert state_binding["provenance_revision_id"] == "cohort-artif-revision"
    assert state_binding["source"]["version"] == "2026"
    assert observed.json()["facts"] == []
    assert observed.json()["source_absences"] == []
    assert absent.json()["facts"] == []
    assert absent.json()["source_absences"][0]["reason"] == "source_record_absent"
    assert absent.json()["source_absences"][0]["source"]["version"] == "2026"


def test_typed_reading_fails_closed_when_selected_evidence_clock_is_missing(cohort_http):
    cohort_http.publish(
        ("ALTER TABLE economy_activity_evidence DROP CONSTRAINT "
         "economy_activity_evidence_source_id_vintage_id_fkey", ()),
        ("DELETE FROM source_vintage WHERE source_id='cohort-evidence-source' "
         "AND vintage_id='cohort-evidence-v1'", ()),
    )
    try:
        response = cohort_http.focal("economie_selected_reading",
            coordinates={"groupe": ["sante-et-taille"]}, fields=["ranked_activities"])
    finally:
        cohort_http.publish(
            ("INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date) "
             "VALUES ('cohort-evidence-source','cohort-evidence-v1','evidence-2025',NULL,'2025-03-04')", ()),
            ("ALTER TABLE economy_activity_evidence ADD CONSTRAINT "
             "economy_activity_evidence_source_id_vintage_id_fkey "
             "FOREIGN KEY(source_id,vintage_id) REFERENCES source_vintage(source_id,vintage_id)", ()),
        )
    assert response.status_code == 503, response.text
    assert response.json()["detail"] == "Typed-reading evidence provenance is unavailable"
