"""Bounded population facts through the guarded PostgreSQL-backed public API."""

from __future__ import annotations

import pytest
from api.tests.integration.test_postgres_publication import canonical_db_env

pytestmark = pytest.mark.integration


def test_cohort_scalar_facts_preserve_population_scope_and_observation_evidence(canonical_db_env):
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
            publisher.execute("""INSERT INTO scalar_descriptor(indicator_id,theme_id,label,unit,direction,
                comparison_facet,allowed_levels,denominator_semantics,completeness,descriptor_version)
                VALUES ('densite','demographie','Densité de population','hab./km²','high','densite',
                    ARRAY['commune','epci','departement'],'population','dense_complete','cohort-descriptor-v1')""")
            publisher.execute("INSERT INTO scalar_descriptor_source VALUES ('densite','cohort-source')")
            for territory_id, value, support, denominator in (
                ('cohort-c1', 10.5, 100, 200), ('cohort-c2', 20.25, 150, 300),
                ('cohort-c3', 99.0, 900, 1000),
            ):
                publisher.execute("""INSERT INTO scalar_observation(
                    indicator_id,territory_id,territory_type,value,status,support_count,denominator_count)
                    VALUES ('densite',%s,'commune',%s,'measured',%s,%s)""",
                    (territory_id, value, support, denominator))
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
                VALUES ('scalar_observation','cohort-scalar-v1',3,'cohort-reference-v1')""")

    pool = ConnectionPool(conninfo=canonical_db_env["read_dsn"], min_size=0, max_size=1,
                          open=True, kwargs={"autocommit": True})
    previous = main.app.dependency_overrides.get(main.get_repository)
    main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
    common = {
        "resource": "densite",
        "intent": {"kind": "facts"},
    }
    try:
        with TestClient(main.app) as client:
            all_brittany = client.post("/api/resources/read", json={
                **common,
                "target": {"kind": "territory_cohort", "type": "commune"},
            })
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
