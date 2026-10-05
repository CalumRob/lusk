"""Guard compatibility for homogeneous legacy units and strict mixed-unit contracts."""
from __future__ import annotations

import pytest

from api.tests.integration.test_postgres_publication import canonical_db_env

pytestmark = pytest.mark.integration


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

    pool = ConnectionPool(conninfo=canonical_db_env["read_dsn"], min_size=0, max_size=1,
                          open=True, kwargs={"autocommit": True})
    previous = main.app.dependency_overrides.get(main.get_repository)
    main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
    try:
        with TestClient(main.app) as client:
            url = f"/api/territories/commune/{territory}/themes/compat/facts"
            legacy = client.get(url)
            assert legacy.status_code == 200, legacy.text
            legacy_body = legacy.json()
            legacy_profile = [row for row in legacy_body["indicators"] if row["indicator_id"] == "legacy_uniform"]
            legacy_meta = next(row for row in legacy_body["indicator_metadata"] if row["indicator_id"] == "legacy_uniform")
            assert legacy_profile[0]["unit"] == "widgets"
            assert legacy_meta["axes"][0]["unit"] == "widgets"
            assert legacy_meta["comparison_point"]["unit"] == "widgets"

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
            # Per-detail contracts do not inherit the headline unit when one
            # declared axis is missing its own unit.
            assert client.get(url).status_code == 503
            with psycopg.connect(canonical_db_env["publish_dsn"]) as conn:
                conn.execute("UPDATE profile_axis SET unit='km / 1 000 hab' WHERE indicator_id='mixed_contract' AND axis_key='per_person'")
            mixed = client.get(url)
            assert mixed.status_code == 200, mixed.text
            mixed_profile = [row for row in mixed.json()["indicators"] if row["indicator_id"] == "mixed_contract"]
            mixed_meta = next(row for row in mixed.json()["indicator_metadata"] if row["indicator_id"] == "mixed_contract")
            assert [row["unit"] for row in mixed_profile] == ["km", "km / 1 000 hab"]
            assert [axis["unit"] for axis in mixed_meta["axes"]] == ["km", "km / 1 000 hab"]
            assert mixed_meta["comparison_point"]["unit"] == "km"
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous
        pool.close()
