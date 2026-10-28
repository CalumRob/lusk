"""Capture public scalar HTTP envelopes from the guarded SQL fixture for the app bridge."""

import json
from pathlib import Path

import pytest
from api.tests.integration.test_postgres_publication import canonical_db_env

pytestmark = pytest.mark.integration


@pytest.mark.parametrize("scenario", ["one_eligible", "outside_missing_focal", "unavailable"])
def test_capture_native_scalar_page_batches(canonical_db_env, tmp_path, scenario):
    import psycopg
    from fastapi.testclient import TestClient
    from psycopg_pool import ConnectionPool
    from api import main

    territories = [
        {"territoire": "29001", "type": "commune", "nom": "Focal", "departement": "29",
         "epci": "E1", "classe_densite_code": "D1"},
        {"territoire": "29002", "type": "commune", "nom": "Peer", "departement": "29",
         "epci": "E1", "classe_densite_code": "D1"},
    ]
    if scenario == "outside_missing_focal":
        territories.append({"territoire": "22001", "type": "commune", "nom": "Outside",
            "departement": "22", "epci": "E2", "classe_densite_code": "D2"})
    focal_id = "22001" if scenario == "outside_missing_focal" else "29001"
    observations = {
        "one_eligible": [("29001", 100, "measured"), ("29002", None, "not_available")],
        "outside_missing_focal": [("29001", 100, "measured"), ("29002", 80, "measured")],
        "unavailable": [("29001", None, "suppressed"), ("29002", None, "not_available")],
    }[scenario]

    with psycopg.connect(canonical_db_env["publish_dsn"]) as conn:
        for territory in territories:
            conn.execute("""INSERT INTO territory_reference(territory_id,territory_type,name,department_id,epci_id,density_class_code)
                VALUES (%s,'commune',%s,%s,%s,%s)""", (territory["territoire"], territory["nom"],
                territory["departement"], territory["epci"], territory["classe_densite_code"]))
        conn.execute("INSERT INTO table_publication(table_name,content_version,row_count) VALUES ('territory_reference','ref-v1',%s)",
            (len(territories),))
        conn.execute("INSERT INTO source_dataset VALUES ('serie_historique','Historical population')")
        conn.execute("""INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date)
            VALUES ('serie_historique','serie_historique','2023','2023-01-01','2025-01-01')""")
        conn.execute("""INSERT INTO scalar_descriptor(indicator_id,theme_id,label,unit,direction,comparison_facet,
            allowed_levels,denominator_semantics,completeness,descriptor_version)
            VALUES ('densite','demographie','Densité de population','hab/km²','high','densite',
            ARRAY['commune','epci','departement','region'],'population municipale','sparse','densite-native-d1')""")
        conn.execute("INSERT INTO scalar_descriptor_source VALUES ('densite','serie_historique')")
        for territory_id, value, status in observations:
            conn.execute("""INSERT INTO scalar_observation(indicator_id,territory_id,territory_type,value,status)
                VALUES ('densite',%s,'commune',%s,%s)""", (territory_id, value, status))
            conn.execute("""INSERT INTO scalar_observation_source(indicator_id,territory_id,source_id,vintage_id)
                VALUES ('densite',%s,'serie_historique','serie_historique')""", (territory_id,))
        conn.execute("""INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version)
            VALUES ('scalar_observation','densite-v1',%s,'ref-v1')""", (len(observations),))

    pool = ConnectionPool(conninfo=canonical_db_env["read_dsn"], min_size=0, max_size=1,
                          open=True, kwargs={"autocommit": True})
    previous = main.app.dependency_overrides.get(main.get_repository)
    main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
    try:
        with TestClient(main.app) as client:
            catalogue = client.get("/api/resources")
            assert catalogue.status_code == 200, catalogue.text

            def read(item):
                request = {"items": [{**item, "id": "scalar-0-densite"}]}
                response = client.post("/api/resources/read-batch", json=request)
                return {"request": request, "response_status": response.status_code,
                    "response": response.json()}

            cohort = read({"resource": "densite", "target": {"kind": "territory_cohort", "type": "commune",
                "department_id": "29", "epci_id": None}, "fields": ["value"], "intent": {"kind": "facts"}})
            assert cohort["response_status"] == 200, cohort
            members = cohort["response"]["results"][0]["data"]["cohort"]["members"]
            selected = [{"type": row["type"], "id": row["id"]} for row in members]
            focal = read({"resource": "densite", "target": {"kind": "territory", "type": "commune", "id": focal_id},
                "fields": ["value"], "intent": {"kind": "facts"}})
            comparison = read({"resource": "densite", "target": {"kind": "territory", "type": "commune", "id": focal_id},
                "fields": ["median", "rank", "rank_size", "eligible_count", "selected_member_count", "missing_count",
                    "member_ranks"],
                "intent": {"kind": "selected_comparison", "members": selected}})
        assert comparison["response_status"] == 200, comparison
        result = comparison["response"]["results"][0]["data"]["result"]
        if scenario == "one_eligible":
            assert result["eligible_count"] == 1 and result["median"] == 100
            assert result["member_ranks"] == [
                {"territory_id": "29001", "rank": 1, "rank_size": 1, "rank_ties": 1},
                {"territory_id": "29002", "rank": None, "rank_size": None, "rank_ties": None},
            ]
        elif scenario == "outside_missing_focal":
            assert result["focal_in_selection"] is False and result["rank"] is None
            assert focal["response_status"] == 404
        else:
            assert result["status"] == "unavailable" and result["eligible_count"] == 0
            assert result["median"] is None and all(row["rank"] is None for row in result["member_ranks"])
        capture = {"level": "commune", "catalogue": catalogue.json(), "territories": territories,
            "cohort": cohort, "focal": focal, "comparison": comparison}
        output = tmp_path / f"native-scalar-commune-{scenario}-api.json"
        output.write_text(json.dumps(capture, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"Guarded native scalar HTTP capture: {output}", flush=True)
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous
        pool.close()
