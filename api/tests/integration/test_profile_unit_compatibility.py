"""Guard compatibility for homogeneous legacy units and strict mixed-unit contracts."""
from __future__ import annotations

import pytest

from dataclasses import replace

from api.tests.integration.resource_publication_helper import publish_resource
from api.tests.integration.test_postgres_publication import canonical_db_env
from api.tests.resource_catalogue_fixtures import default_resource_catalogue

pytestmark = pytest.mark.integration


def _declaration(resource_id, details, units, default_detail):
    page = {
        "indicator": resource_id, "label": resource_id, "unit": units[default_detail],
        "direction": "high", "levels": ["commune"], "sources": ["unit-fixture"],
        "comparison": {"unit": units[default_detail], "direction": "high",
                       "details": list(details), "detail": default_detail},
        "pyramid": {"dimensions": ["detail"]},
    }
    return {"kind": "indicator", "metadata": {
        "theme": "compat", "indicator_keys": [resource_id],
        "sources": {resource_id: "unit-fixture"},
        "source_records": {"unit-fixture": {"name": "Unit fixture", "vintages": [
            {"id": "v1", "version": "v1"}]}},
        "indicator_pages": {resource_id: page},
        "profile_contracts": {resource_id: {
            "allowed_levels": ["commune"], "completeness": "dense_complete",
            "detail_units": units}},
        "detail_labels": {resource_id: {detail: detail for detail in details}},
    }}


def test_legacy_null_unit_falls_back_but_required_per_detail_unit_fails_closed(canonical_db_env):
    import psycopg
    from fastapi.testclient import TestClient
    from psycopg_pool import ConnectionPool
    from api import main

    territory = "unit-legacy-focal"
    with psycopg.connect(canonical_db_env["publish_dsn"]) as conn:
        conn.execute("""INSERT INTO territory_reference(territory_id,territory_type,name,
            density_class_code,density_class_label) VALUES (%s,'commune','Focal','D-UNIT','Unit fixture')""", (territory,))
        conn.execute("INSERT INTO table_publication(table_name,content_version,row_count) VALUES ('territory_reference','units-ref',1)")
        conn.execute("INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version) VALUES ('scalar_observation','units-scalar',0,'units-ref')")
        conn.execute("INSERT INTO source_dataset VALUES ('unit-fixture','Unit fixture')")
        conn.execute("INSERT INTO source_vintage(source_id,vintage_id,version) VALUES ('unit-fixture','v1','v1')")
        conn.execute("""INSERT INTO profile_descriptor(indicator_id,theme_id,label,unit,allowed_levels,completeness,
            descriptor_version,comparison_detail,comparison_direction) VALUES
            ('legacy_uniform','compat','Legacy uniform','widgets',ARRAY['commune'],'dense_complete','legacy-v1','only','high')""")
        conn.execute("INSERT INTO profile_descriptor_source VALUES ('legacy_uniform','unit-fixture')")
        conn.execute("INSERT INTO profile_axis(indicator_id,axis_name,axis_key,label,ordinal,unit) VALUES ('legacy_uniform','detail','only','Only',0,NULL)")
        conn.execute("""INSERT INTO profile_observation(indicator_id,territory_id,territory_type,detail_key,sex_key,sex_axis_name,value,status)
            VALUES ('legacy_uniform',%s,'commune','only','',NULL,7,'measured')""", (territory,))
        conn.execute("INSERT INTO profile_observation_source VALUES ('legacy_uniform',%s,'only','','unit-fixture','v1')", (territory,))
        conn.execute("INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version) VALUES ('declared_profile','units-profile',1,'units-ref')")
        publish_resource(conn, "legacy_uniform", "declared_profile", "units-profile",
                         reference_content_version="units-ref",
                         declarations={"legacy_uniform": _declaration(
                             "legacy_uniform", ("only",), {"only": "widgets"}, "only")})

    pool = ConnectionPool(conninfo=canonical_db_env["read_dsn"], min_size=0, max_size=1,
                          open=True, kwargs={"autocommit": True})
    previous = main.app.dependency_overrides.get(main.get_repository)
    previous_catalogue = main.app.dependency_overrides.get(main.get_resource_catalogue)
    main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
    base_catalogue = default_resource_catalogue()
    template = base_catalogue.resources_by_id["structure_age"]
    fixture_resources = tuple(
        replace(template, resource_id=resource_id, indicator_id=resource_id,
                theme_id="compat", label=resource_id, unit=unit,
                allowed_levels=("commune",), shapes=("declared_profile",),
                axes=("detail",), dynamic_axes=("detail",),
                axis_values=(("detail", tuple(details)),), cellule=None,
                sources=("unit-fixture",), intents=("facts",),
                publication_resource_id=None)
        for resource_id, unit, details in (
            ("legacy_uniform", "widgets", ("only",)),
            ("mixed_contract", "km", ("network", "per_person")),
        )
    )
    main.app.dependency_overrides[main.get_resource_catalogue] = lambda: replace(
        base_catalogue, resources=(*base_catalogue.resources, *fixture_resources))
    try:
        with TestClient(main.app) as client:
            def read(resource_id):
                return client.post("/api/resources/read", json={
                    "resource": resource_id,
                    "target": {"kind": "territory", "type": "commune", "id": territory},
                    "fields": ["value"], "intent": {"kind": "facts"},
                })

            legacy = read("legacy_uniform")
            assert legacy.status_code == 200, legacy.text
            legacy_body = legacy.json()
            assert legacy_body["observations"][0]["unit"] == "widgets"
            assert legacy_body["descriptor"]["axes"][0]["unit"] == "widgets"
            assert legacy_body["descriptor"]["comparison_point"]["unit"] == "widgets"

            with psycopg.connect(canonical_db_env["publish_dsn"]) as conn:
                conn.execute("""INSERT INTO profile_descriptor(indicator_id,theme_id,label,unit,allowed_levels,completeness,
                    descriptor_version,comparison_detail,comparison_direction,detail_units_required) VALUES
                    ('mixed_contract','compat','Mixed contract','km',ARRAY['commune'],'dense_complete','mixed-v1','network','high',true)""")
                conn.execute("INSERT INTO profile_descriptor_source VALUES ('mixed_contract','unit-fixture')")
                conn.execute("""INSERT INTO profile_axis(indicator_id,axis_name,axis_key,label,ordinal,unit) VALUES
                    ('mixed_contract','detail','network','Network',0,'km'),
                    ('mixed_contract','detail','per_person','Per person',1,NULL)""")
                for detail, value in (("network", 2), ("per_person", 3)):
                    conn.execute("""INSERT INTO profile_observation(indicator_id,territory_id,territory_type,detail_key,sex_key,sex_axis_name,value,status)
                        VALUES ('mixed_contract',%s,'commune',%s,'',NULL,%s,'measured')""", (territory, detail, value))
                    conn.execute("INSERT INTO profile_observation_source VALUES ('mixed_contract',%s,%s,'','unit-fixture','v1')", (territory, detail))
                publish_resource(conn, "mixed_contract", "declared_profile", "mixed-v1",
                                 reference_content_version="units-ref",
                                 declarations={"mixed_contract": _declaration(
                                     "mixed_contract", ("network", "per_person"),
                                     {"network": "km", "per_person": "km / 1 000 hab"}, "network")})
            # Per-detail contracts do not inherit the headline unit when one
            # declared axis is missing its own unit.
            assert read("mixed_contract").status_code == 503
            with psycopg.connect(canonical_db_env["publish_dsn"]) as conn:
                conn.execute("UPDATE profile_axis SET unit='km / 1 000 hab' WHERE indicator_id='mixed_contract' AND axis_key='per_person'")
            mixed = read("mixed_contract")
            assert mixed.status_code == 200, mixed.text
            assert [row["unit"] for row in mixed.json()["observations"]] == ["km", "km / 1 000 hab"]
            assert [axis["unit"] for axis in mixed.json()["descriptor"]["axes"]] == ["km", "km / 1 000 hab"]
            assert mixed.json()["descriptor"]["comparison_point"]["unit"] == "km"
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous
        if previous_catalogue is None:
            main.app.dependency_overrides.pop(main.get_resource_catalogue, None)
        else:
            main.app.dependency_overrides[main.get_resource_catalogue] = previous_catalogue
        pool.close()
