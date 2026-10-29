"""Guarded public-wire proof for #857's OCS-GE calendar/role boundary.

No R or serving database: use the existing isolated-schema fixture and the
current producer's state-role-only comparison publication grain.
"""

import json
from pathlib import Path

import pytest

from api.tests.integration.test_postgres_publication import canonical_db_env

pytestmark = pytest.mark.integration


def test_capture_native_state_calendar_comparison_boundary(canonical_db_env, tmp_path):
    import psycopg
    from fastapi.testclient import TestClient
    from psycopg_pool import ConnectionPool
    from api import main

    # Three EPCI with different OCS-GE windows. The final roles are comparable
    # under the existing fixed policy; calendar 2023 and 2025 are not aliases.
    territories = [
        {"territoire": "state-e1", "type": "epci", "nom": "EPCI 2023", "departement": "35", "epci": None},
        {"territoire": "state-e2", "type": "epci", "nom": "EPCI 2025", "departement": "22", "epci": None},
        {"territoire": "state-e3", "type": "epci", "nom": "Other EPCI 2023", "departement": "35", "epci": None},
        {"territoire": "state-c1", "type": "commune", "nom": "Commune 2023", "departement": "35", "epci": "state-e1"},
        {"territoire": "state-c2", "type": "commune", "nom": "Commune 2025", "departement": "22", "epci": "state-e2"},
        {"territoire": "state-c3", "type": "commune", "nom": "Other commune 2023", "departement": "35", "epci": "state-e3"},
        {"territoire": "53", "type": "region", "nom": "Bretagne", "departement": None, "epci": None},
    ]
    axes = ["M2", "M3", "2020", "2021", "2022", "2023", "2024", "2025"]
    with psycopg.connect(canonical_db_env["publish_dsn"]) as conn:
        for territory in territories:
            conn.execute("""INSERT INTO territory_reference(territory_id,territory_type,name,department_id,epci_id)
                VALUES (%s,%s,%s,%s,%s)""", (territory["territoire"], territory["type"], territory["nom"],
                territory["departement"], territory["epci"]))
        conn.execute("""INSERT INTO table_publication(table_name,content_version,row_count)
            VALUES ('territory_reference','state-ref-v1',7)""")
        conn.execute("""INSERT INTO series_dataset_publication(dataset_id,content_version,reference_content_version,row_count)
            VALUES ('ocsge_artif_etats','state-facts-v1','state-ref-v1',24)""")
        conn.execute("""INSERT INTO series_dataset_descriptor(dataset_id,indicator_id,axis_kind,axis_values,
            completeness,comparison_point,label,unit,direction,allowed_levels,descriptor_version,
            active_read_route,theme_id,comparison_statistic,comparison_scope,comparison_levels)
            VALUES ('ocsge_artif_etats','artif_par_habitant','declared_detail',%s,'may_be_missing','2025',
                'Intensité état','m²/hab','low',ARRAY['commune','epci','departement','region'],
                'state-desc-v1',true,'milieux','median','default_group',ARRAY['commune','epci','departement'])""", (axes,))
        for suffix, source, initial, final in [("1", "ocsge_artificialisation_35_2023", "2020", "2023"),
                                                ("2", "ocsge_artificialisation_22_2025", "2021", "2025"),
                                                ("3", "ocsge_artificialisation_35_2023", "2020", "2023")]:
            conn.execute("""INSERT INTO series_provenance_revision(provenance_revision_id,source_id,vintage_id,
                source_name,dataset_name,source_version,reference_date,publication_date,revision_hash)
                VALUES (%s,%s,%s,'Native IGN','Native OCS-GE','native-version','2026-01-03','2026-07-04',%s)""",
                ("state-rev-" + suffix, source, final, "native-hash-" + suffix))
            for kind in ("e", "c"):
                territory_id = "state-" + kind + suffix
                # Deliberately different commune/parent facts expose accidental
                # parent-selection expansion masquerading as EPCI comparison.
                start, end = {"1": (100, 120), "2": (300, 360), "3": (150, 180)}[suffix]
                if kind == "c":
                    start, end = start / 10, end / 10
                for axis, role, value in [("M2", "M2", start), ("M3", "M3", end),
                                           (initial, "M2", start), (final, "M3", end)]:
                    conn.execute("""INSERT INTO series_dataset_observation(dataset_id,indicator_id,territory_id,
                        territory_type,axis_value,state_role,observation_period,value,status)
                        VALUES ('ocsge_artif_etats','artif_par_habitant',%s,%s,%s,%s,%s,%s,'measured')""",
                        (territory_id, "epci" if kind == "e" else "commune", axis, role,
                         initial + '–' + final, value))
                    conn.execute("""INSERT INTO series_observation_provenance VALUES
                        ('ocsge_artif_etats','artif_par_habitant',%s,%s,%s)""",
                        (territory_id, axis, "state-rev-" + suffix))
        # project_owned_series_comparisons uses comparison_axis_values=M2/M3
        # for OCS-GE (publish_series.R), NOT the calendar details in axis_values.
        conn.execute("""INSERT INTO ordered_series_comparison_publication(dataset_id,indicator_id,content_version,
            ordered_series_content_version,reference_content_version,group_row_count,territory_row_count,
            lineage_row_count,comparison_axes) VALUES ('ocsge_artif_etats','artif_par_habitant',
                'state-comparison-v1','state-facts-v1','state-ref-v1',2,6,6,ARRAY['M2','M3'])""")
        for axis, value, values in [("M2", 150, [100, 300, 150]), ("M3", 180, [120, 360, 180])]:
            conn.execute("""INSERT INTO ordered_series_comparison_group VALUES
                ('ocsge_artif_etats','artif_par_habitant','same_level','53','epci',%s,'median',%s,3,3,0,3)""",
                (axis, value))
            for index, member_value in enumerate(values, start=1):
                conn.execute("""INSERT INTO ordered_series_comparison_territory VALUES
                    ('ocsge_artif_etats','artif_par_habitant','same_level','53','epci',%s,%s,%s,
                        'measured',%s,1,3)""", (axis, f"state-e{index}", member_value, [1, 3, 2][index - 1]))
                conn.execute("""INSERT INTO ordered_series_comparison_lineage VALUES
                    ('ocsge_artif_etats','artif_par_habitant','same_level','53','epci',%s,%s)""",
                    (axis, f"state-rev-{index}"))

    pool = ConnectionPool(conninfo=canonical_db_env["read_dsn"], min_size=0, max_size=1,
                          open=True, kwargs={"autocommit": True})
    previous = main.app.dependency_overrides.get(main.get_repository)
    main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
    try:
        with TestClient(main.app) as client:
            catalogue = client.get('/api/resources')
            assert catalogue.status_code == 200, catalogue.text

            def read(target, intent, *, coordinates=None, fields=None):
                item = {"resource": "artif_par_habitant", "target": target, "intent": intent}
                if coordinates is not None:
                    item["coordinates"] = coordinates
                if fields is not None:
                    item["fields"] = fields
                request = {"items": [{"id": "scalar-0-artif_par_habitant", **item}]}
                response = client.post('/api/resources/read-batch', json=request)
                return {"request": request, "response_status": response.status_code, "response": response.json()}

            target = {"kind": "territory", "type": "epci", "id": "state-e1"}
            cohort = read({"kind": "territory_cohort", "type": "epci"}, {"kind": "facts"})
            focal = read(target, {"kind": "facts"})
            fixed = read(target, {"kind": "fixed_comparison", "context": "default"})
            calendar = read(target, {"kind": "fixed_comparison", "context": "default"},
                            coordinates={"declared_detail": ["2023"]})
            selected = read(target, {"kind": "selected_comparison", "members": [
                {"type": "epci", "id": "state-e1"}, {"type": "epci", "id": "state-e2"},
                {"type": "epci", "id": "state-e3"}]},
                coordinates={"declared_detail": ["2023"]})
            roles = read(target, {"kind": "fixed_comparison", "context": "default"},
                         coordinates={"declared_detail": ["M2", "M3"]}, fields=["axis_comparisons"])
            bridge_items = [
                {"id": "scalar-0-artif_par_habitant", "resource": "artif_par_habitant",
                 "target": {"kind": "territory_cohort", "type": "epci"}, "intent": {"kind": "facts"},
                 "fields": ["value"]},
                {"id": "scalar-1-artif_par_habitant", "resource": "artif_par_habitant",
                 "target": target, "intent": {"kind": "facts"}},
                {"id": "scalar-2-artif_par_habitant", "resource": "artif_par_habitant",
                 "target": target, "intent": {"kind": "fixed_comparison", "context": "default"},
                 "fields": ["axis_comparisons"]},
            ]
            bridge_response = client.post('/api/resources/read-batch', json={"items": bridge_items})
            assert bridge_response.status_code == 200, bridge_response.text
        for capture in (cohort, focal, fixed, calendar, selected):
            assert capture["response_status"] == 200, capture
        fixed_result = fixed["response"]["results"][0]["data"]["result"]
        assert fixed_result["median"] == 180
        selected_data = selected["response"]["results"][0]["data"]
        assert selected_data["scope"]["member_count"] == 3
        assert selected_data["result"]["eligible_count"] == 1
        assert selected_data["result"]["status"] == "unavailable"
        assert selected_data["result"]["reason"] == "selected_coordinate_has_no_comparison_result"
        capture = {"schema": canonical_db_env["schema"], "catalogue": catalogue.json(), "territories": territories,
                   "cohort": cohort, "focal": focal, "fixed": fixed, "calendar": calendar, "selected": selected,
                   "roles": roles, "application_bridge": {"request": {"items": bridge_items},
                       "response_status": bridge_response.status_code, "response": bridge_response.json()}}
        output = tmp_path / 'native-state-calendar-boundary.json'
        output.write_text(json.dumps(capture, indent=2, ensure_ascii=False), encoding='utf-8')
        print(f'Guarded native state/calendar capture: {output}', flush=True)
        assert roles["response_status"] == 200, roles
        points = roles["response"]["results"][0]["data"]["result"]["axis_comparisons"]
        assert [(point["axis"], point["value"], point["eligible_count"]) for point in points] == [
            ("M2", 150, 3), ("M3", 180, 3)]
        assert points[1]["member_ranks"] == [
            {"territory_id": "state-e1", "rank": 1, "rank_size": 3, "rank_ties": 1},
            {"territory_id": "state-e2", "rank": 3, "rank_size": 3, "rank_ties": 1},
            {"territory_id": "state-e3", "rank": 2, "rank_size": 3, "rank_ties": 1}]

        # An impossible published tie span (rank 3 + ties 3 in a size-3
        # population) must fail closed on the requested projection, never serve
        # HTTP 200 over inconsistent comparison evidence. The probe corrupts and
        # restores only its own random schema's seeded row.
        def corrupt_ties(value):
            with psycopg.connect(canonical_db_env['publish_dsn']) as corrupt_conn:
                corrupt_conn.execute("""UPDATE ordered_series_comparison_territory SET tie_count=%s
                    WHERE dataset_id='ocsge_artif_etats' AND indicator_id='artif_par_habitant'
                      AND comparison_context='same_level' AND territory_type='epci'
                      AND axis_value='M3' AND territory_id='state-e2'""", (value,))

        corrupt_ties(3)
        try:
            broken = client.post('/api/resources/read-batch', json={
                "items": [{"id": "scalar-0-artif_par_habitant", "resource": "artif_par_habitant",
                           "target": target, "intent": {"kind": "fixed_comparison", "context": "default"},
                           "fields": ["axis_comparisons"]}]})
            assert broken.status_code == 503, (broken.status_code, broken.text)
            assert "inconsistent" in broken.text
        finally:
            corrupt_ties(1)
        healed = client.post('/api/resources/read-batch', json={
            "items": [{"id": "scalar-0-artif_par_habitant", "resource": "artif_par_habitant",
                       "target": target, "intent": {"kind": "fixed_comparison", "context": "default"},
                       "fields": ["axis_comparisons"]}]})
        assert healed.status_code == 200, healed.text
        assert healed.json()["results"][0]["data"]["result"]["axis_comparisons"] == points
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous
        pool.close()
