"""Selected building evidence retains focal facts and aggregates only selected peers."""

import os
import uuid
from pathlib import Path
from urllib.parse import urlsplit

import pytest

from api.tests.integration.test_building_evidence_contract import (
    _publish_fixture,
    _schema_dsn,
    _seed_fresh_reference,
    building_db_env,
)

pytestmark = pytest.mark.integration


def test_selected_mobility_comparison_route_and_building_reader(building_db_env, monkeypatch):
    import psycopg
    from api.main import ReadRepository

    schema = "it_selected_building_" + uuid.uuid4().hex[:12]
    dsn = building_db_env["publish_dsn"]
    created = False
    monkeypatch.delenv("LUSK_SERVICES_SCALAR_READ", raising=False)
    try:
        with psycopg.connect(dsn, autocommit=True) as owner:
            owner.execute(f'CREATE SCHEMA "{schema}"')
            created = True
        with psycopg.connect(_schema_dsn(dsn, schema), autocommit=True) as connection:
            connection.execute((Path(__file__).resolve().parents[2] / "schema.sql").read_text(encoding="utf-8"))
            _seed_fresh_reference(connection)
            _publish_fixture(connection, "selected-fixture")
            with connection.transaction():
                connection.execute("""INSERT INTO territory_reference
                    (territory_id,territory_type,name,department_id,epci_id) VALUES
                    ('B','commune','Peer B','29','E2'),('C','commune','Peer C','29','E2'),
                    ('E1','epci','Focal EPCI','29',NULL),('E2','epci','Selected EPCI','29',NULL)""")
                # Independent worked example: B weighs 10, C weighs 30. The
                # focal weighs 100 and must not enter the peer calculation.
                for code, level, buildings, ramp_value, occupied_cell in (
                    ("B", "commune", 10, 1, 0),
                    ("C", "commune", 30, 3, 1),
                    ("E1", "epci", 100, 4, 0),
                    ("E2", "epci", 40, 2, 1),
                ):
                    connection.execute("""INSERT INTO building_ramp
                        SELECT %s,%s,availability,mode,quantile_index,quantile,%s,%s,
                            source_id,source_version,effective_direction
                        FROM building_ramp WHERE territory_id='A'""",
                        (code, level, ramp_value, buildings))
                    connection.execute("""INSERT INTO building_grid
                        SELECT %s,%s,availability,mode,cell_index,breadth_bucket,depth_bucket,
                            CASE WHEN cell_index=%s THEN %s ELSE 0 END,%s,source_id,source_version
                        FROM building_grid WHERE territory_id='A'""",
                        (code, level, occupied_cell, buildings, buildings))
                services = ("food", "health", "admin", "school", "bank")
                connection.cursor().executemany("INSERT INTO service_registry(service) VALUES (%s)",
                                                [(service,) for service in services])
                connection.execute("""INSERT INTO access_publication_metadata
                    (singleton,bretagne_kind,bretagne_label)
                    VALUES (true,'communes-bretagne','communes bretonnes')""")
                service_rows = []
                for code in ("E1", "E2", "B", "C"):
                    for service in services:
                        for mode, shares in {
                            "car": {"E1": .95, "E2": .8, "B": .2, "C": .6},
                            "bike": {"E1": .95, "E2": .75, "B": .4, "C": .8},
                            "walk_transit": {"E1": .95, "E2": .7, "B": .1, "C": .3},
                        }.items():
                            source_id = {"E1": "focal-only", "E2": "peer-epci",
                                         "B": "peer-b", "C": "peer-c"}[code]
                            service_rows.append((code, service, mode, shares[code], f"{service} {mode}",
                                "high", source_id, f"Source {code}", "v1", "2025-01-01", "2026-01-01"))
                connection.cursor().executemany("""INSERT INTO essential_service_access
                    (territory_id,service,mode,share,indicator_label,effective_direction,source_id,
                     source_name,source_version,reference_date,source_publication_date)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""", service_rows)
                connection.execute("""INSERT INTO table_publication(table_name,content_version,row_count)
                    VALUES ('essential_service_access','access-v1',%s)""", (len(service_rows),))
                connection.execute("INSERT INTO source_dataset VALUES ('access-fixture','Access fixture')")
                connection.execute("""INSERT INTO source_vintage
                    VALUES ('access-fixture','v1','v1','2025-01-01','2026-01-01')""")
                connection.execute("""INSERT INTO series_dataset_publication
                    (dataset_id,content_version,reference_content_version,row_count)
                    VALUES ('mobility_owned','owned-v1','ref-fixture-v1',4)""")
                connection.execute("""INSERT INTO series_dataset_descriptor
                    (dataset_id,indicator_id,axis_kind,axis_values,completeness,comparison_point,
                     label,unit,comparison_statistic,comparison_scope,direction,allowed_levels,
                     comparison_levels,descriptor_version,active_read_route,theme_id)
                    VALUES ('mobility_owned','active_network','year',ARRAY['2025'],'dense_complete',
                     '2025','Active network','km','median','default_group','high',
                     ARRAY['commune','epci'],ARRAY['commune','epci'],'owned-desc-v1',true,'mobilite')""")
                connection.execute("""INSERT INTO series_provenance_revision
                    (provenance_revision_id,source_id,vintage_id,source_name,dataset_name,source_version,
                     reference_date,publication_date,revision_hash)
                    VALUES ('owned-rev','access-fixture','v1','Access fixture','Mobility fixture','v1',
                     '2025-01-01','2026-01-01',%s)""", ("a" * 64,))
                for code, level, value in (("B", "commune", .2), ("C", "commune", .6),
                                           ("E1", "epci", .5), ("E2", "epci", .6)):
                    connection.execute("""INSERT INTO series_dataset_observation
                        (dataset_id,indicator_id,territory_id,territory_type,axis_value,
                         observation_period,value,status)
                        VALUES ('mobility_owned','active_network',%s,%s,'2025','2025',%s,'measured')""",
                        (code, level, value))
                    connection.execute("""INSERT INTO series_observation_provenance
                        (dataset_id,indicator_id,territory_id,axis_value,provenance_revision_id)
                        VALUES ('mobility_owned','active_network',%s,'2025','owned-rev')""", (code,))
                with connection.transaction():
                    connection.execute("""INSERT INTO scalar_descriptor
                        (indicator_id,theme_id,label,unit,direction,comparison_facet,allowed_levels,
                         denominator_semantics,completeness,descriptor_version)
                        VALUES ('share_food_c','mobilite','Food car share','%','high','share_food_c',
                                ARRAY['commune','epci'],'fixture','dense_complete','scalar-v1')""")
                    connection.execute("INSERT INTO scalar_descriptor_source VALUES ('share_food_c','access-fixture')")
                    for code, level, value in (("E1", "epci", .95), ("E2", "epci", .8),
                                               ("B", "commune", .2), ("C", "commune", .6)):
                        connection.execute("""INSERT INTO scalar_observation
                            (indicator_id,territory_id,territory_type,value,status)
                            VALUES ('share_food_c',%s,%s,%s,'measured')""", (code, level, value))
                        connection.execute("""INSERT INTO scalar_observation_source
                            (indicator_id,territory_id,source_id,vintage_id)
                            VALUES ('share_food_c',%s,'access-fixture','v1')""", (code,))
                    connection.execute("""INSERT INTO table_publication
                        (table_name,content_version,row_count,reference_content_version)
                        VALUES ('scalar_observation','scalar-access-v1',5,'ref-fixture-v1')""")
                # The registered regional service denominator (the services
                # family's building count at region level) + its territory row.
                connection.execute("INSERT INTO territory_reference(territory_id,territory_type,name) VALUES ('R','region','Region fixture')")
                with connection.transaction():
                    connection.execute("""INSERT INTO scalar_descriptor
                        (indicator_id,theme_id,label,unit,direction,comparison_facet,allowed_levels,
                         denominator_semantics,completeness,descriptor_version)
                        VALUES ('nb_buildings','mobilite','Buildings','count','high','nb_buildings',
                                ARRAY['region'],'fixture','dense_complete','scalar-v1')""")
                    connection.execute("INSERT INTO scalar_descriptor_source VALUES ('nb_buildings','access-fixture')")
                    connection.execute("""INSERT INTO scalar_observation
                        (indicator_id,territory_id,territory_type,value,status)
                        VALUES ('nb_buildings','R','region',150,'measured')""")
                    connection.execute("""INSERT INTO scalar_observation_source
                        (indicator_id,territory_id,source_id,vintage_id)
                        VALUES ('nb_buildings','R','access-fixture','v1')""")
                connection.execute("UPDATE table_publication SET row_count=6 WHERE table_name='territory_reference'")
                connection.execute("UPDATE table_publication SET row_count=165 WHERE table_name='building_ramp'")
                connection.execute("UPDATE table_publication SET row_count=150 WHERE table_name='building_grid'")
                # Mobility reading + focal density-distribution fixtures: the
                # theme-facts route composes both into one snapshot, and the
                # distribution publication shares the reading's source identity
                # (migration 024's marker contract).
                connection.execute("INSERT INTO source_dataset VALUES ('mobilite_snapshot','Mobility snapshot fixture')")
                connection.execute("""INSERT INTO source_vintage
                    VALUES ('mobilite_snapshot','dist-v1','v1','2025-01-01','2026-01-01')""")
                connection.execute("""INSERT INTO mobility_reading_descriptor
                    (singleton,descriptor_version,source_id,vintage_id,source_name,dataset_name,
                     source_version,reference_date,publication_date,unit,direction,allowed_levels,
                     missing_status,classification_values,field_keys,story_count,clock_count)
                    VALUES (true,'reading-v1','mobilite_snapshot','dist-v1','Mobility snapshot fixture',
                     'Mobility fixture','v1','2025-01-01','2026-01-01','types de service perdu','none',
                     ARRAY['commune','epci'],'unavailable',ARRAY['fixture'],
                     ARRAY['groupe','story_key','salience_reason','classification_saillance',
                            'div_loss_t','div_loss_b','status'],1,1)""")
                connection.execute("""INSERT INTO mobility_reading_story(story_key,groupe,salience_reason,ordinal)
                    VALUES ('fixture-story','fixture','defaut',1)""")
                connection.execute("""INSERT INTO mobility_reading_clock(ordinal,clock_name,frequency,reference,trigger)
                    VALUES (1,'Fixture clock','fixture','fixture','fixture')""")
                for epci_code in ("E1", "E2"):
                    connection.execute("""INSERT INTO mobility_typed_reading
                        (territory_id,territory_type,groupe,story_key,salience_reason,classification_saillance,
                         div_loss_t,div_loss_b,status,source_id,vintage_id)
                        VALUES (%s,'epci','fixture','fixture-story','defaut',NULL,5,4,'measured',
                         'mobilite_snapshot','dist-v1')""", (epci_code,))
                connection.execute("""INSERT INTO table_publication
                    (table_name,content_version,row_count,reference_content_version)
                    VALUES ('mobility_typed_reading','reading-v1',2,'ref-fixture-v1')""")
                connection.execute("""INSERT INTO mobility_density_distribution_descriptor
                    (singleton,descriptor_version,source_id,vintage_id,axis_count,allowed_levels,
                     density_unit,decile_unit)
                    VALUES (true,'dist-v1','mobilite_snapshot','dist-v1',10,ARRAY['commune','epci'],
                     'part des batiments','minutes')""")
                connection.execute("""INSERT INTO mobility_density_distribution_range
                    (territory_id,territory_type,minimum,maximum,status,source_id,vintage_id)
                    VALUES ('E1','epci',1.0,52.0,'measured','mobilite_snapshot','dist-v1')""")
                for ordinal in range(10):
                    connection.execute("""INSERT INTO mobility_density_distribution_point
                        (territory_id,territory_type,ordinal,density,density_status,decile,decile_status,
                         source_id,vintage_id)
                        VALUES ('E1','epci',%s,%s,'measured',%s,%s,'mobilite_snapshot','dist-v1')""",
                        (ordinal, (ordinal + 1) / 100,
                         None if ordinal == 5 else float(ordinal * 5 + 2),
                         "not_available" if ordinal == 5 else "measured"))
                connection.execute("""INSERT INTO table_publication
                    (table_name,content_version,row_count,reference_content_version)
                    VALUES ('mobility_density_distribution','dist-v1',11,'ref-fixture-v1')""")

            class NoConnections:
                def connection(self):
                    raise AssertionError("Reader must reuse the acquisition connection")

            repository = ReadRepository(NoConnections())
            with connection.transaction():
                connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
                selected = repository.read_building_initial(
                    "epci", "E1", selected=(("epci", "E2"), ("commune", "B")), connection=connection)
                assert selected["scope"]["member_count"] == 2
                assert len(selected["ramp"]) == 33
                assert len(selected["distribution"]) == 30
                assert all(point["accessible_types"] == 4 for point in selected["ramp"])
                assert all(point["total_buildings"] == 100 for point in selected["ramp"])
                assert selected["peer_ramp"]["total_buildings"] == 40
                assert all(point["accessible_types"] == 2.5 for point in selected["peer_ramp"]["points"])
                peer_grid = selected["peer_distribution"]
                assert peer_grid["total_buildings"] == 40
                first_cell = next(cell for cell in peer_grid["cells"]
                                  if cell["breadth_bucket"] == "0" and cell["depth_bucket"] == "0")
                assert first_cell["building_count"] == 10
                assert first_cell["share"] == 0.25
                empty = repository.read_building_initial("epci", "E1", selected=(), connection=connection)
                assert empty["scope"]["member_count"] == 0
                assert empty["peer_ramp"] is None and empty["peer_distribution"] is None
                assert empty["ramp"] == selected["ramp"]
                assert empty["distribution"] == selected["distribution"]
                assert empty["sources"] == selected["sources"]
                assert empty["publication_id"] == selected["publication_id"]

            read_dsn = os.environ.get("LUSK_TEST_READ_DSN")
            assert read_dsn, "guarded route-level verification requires LUSK_TEST_READ_DSN"
            import psycopg
            from fastapi.testclient import TestClient
            from psycopg_pool import ConnectionPool
            from api import main

            reader = urlsplit(read_dsn).username
            assert reader and reader.replace("_", "").replace("-", "").isalnum()
            connection.execute(f'GRANT USAGE ON SCHEMA "{schema}" TO "{reader}"')
            connection.execute(f'GRANT SELECT ON ALL TABLES IN SCHEMA "{schema}" TO "{reader}"')
            scoped_read = _schema_dsn(read_dsn, schema)
            pool = ConnectionPool(conninfo=scoped_read, min_size=1, max_size=1, open=True,
                                  kwargs={"autocommit": True})
            transactions = []
            checked_out = []
            class RecordingConnection:
                def __init__(self, raw):
                    self.raw = raw
                    self.transaction_commands = []
                def execute(self, query, *args, **kwargs):
                    if str(query).upper().startswith("SET TRANSACTION"):
                        self.transaction_commands.append(str(query))
                    return self.raw.execute(query, *args, **kwargs)
                def transaction(self, *args, **kwargs):
                    return self.raw.transaction(*args, **kwargs)
                def __getattr__(self, name):
                    return getattr(self.raw, name)
            class Connections:
                def connection(self):
                    class Context:
                        def __enter__(self):
                            self.context = pool.connection()
                            self.raw = self.context.__enter__()
                            self.recorded = RecordingConnection(self.raw)
                            checked_out.append(self.recorded)
                            return self.recorded
                        def __exit__(self, *args):
                            transactions.append(self.recorded.transaction_commands)
                            return self.context.__exit__(*args)
                    return Context()
            previous_override = main.app.dependency_overrides.get(main.get_repository)
            main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(Connections())
            main.pool.cache_clear()
            try:
                with TestClient(main.app) as client:
                    response = client.post("/api/territories/epci/E1/themes/mobilite/comparison", json={
                        "theme_id": "mobilite", "selection": [
                            {"territory_type": "epci", "territory_id": "E2"},
                            {"territory_type": "commune", "territory_id": "B"},
                        ],
                    })
                    assert response.status_code == 200, response.text
                    body = response.json()
                    assert body["selection"] == [
                        {"territory_type": "epci", "territory_id": "E2"},
                        {"territory_type": "commune", "territory_id": "B"},
                    ]
                    assert body["scope"]["member_count"] == 2
                    scalar_result = next(row for row in body["results"]
                                         if row["indicator_id"] == "share_food_c")
                    assert scalar_result["selected_member_count"] == 2
                    assert scalar_result["eligible_count"] == 2
                    assert scalar_result["median"] == pytest.approx(.4)
                    assert "focal_value" not in scalar_result
                    service = body["essential_service_access"]
                    assert service["scope"]["member_count"] == 2
                    assert len(service["services"]) == 5
                    assert service["publication_id"] == "access-v1"
                    for item in service["services"]:
                        assert item["modes"]["car"]["median"] == pytest.approx(.4)
                        assert item["modes"]["bike"]["median"] == pytest.approx(.6)
                        assert item["modes"]["walk_transit"]["median"] == pytest.approx(.2)
                        assert item["peer_median_car_gap"] == pytest.approx(.2)
                        assert item["peer_median_bike_gain"] == pytest.approx(.4)
                        for mode in item["modes"].values():
                            assert "value" not in mode
                            assert {source["source_id"] for source in mode["comparison_sources"]} == {"peer-b", "peer-c"}
                            assert all(source["source_id"] != "focal-only" for source in mode["comparison_sources"])
                    assert body["building_access"]["scope"]["member_count"] == 2
                    assert body["collection_content_versions"] == {}
                    assert body["scalar_content_version"] == "scalar-access-v1"
                    assert body["owned_series_content_versions"] == {
                        "mobility_owned": {"content_version": "owned-v1",
                                           "reference_content_version": "ref-fixture-v1"}}
                    owned_result = next(row for row in body["results"]
                                        if row["indicator_id"] == "active_network")
                    assert owned_result["median"] == pytest.approx(.4)
                    assert "focal_value" not in owned_result
                    assert body["bpe_content_version"] is None
                    assert body["service_publication_id"] == "access-v1"
                    assert body["building_publication_id"] == selected["publication_id"]
                    assert "focal_value" not in response.text
                    assert "focal-only" not in response.text

                    empty_response = client.post(
                        "/api/territories/epci/E1/themes/mobilite/comparison",
                        json={"theme_id": "mobilite", "selection": []})
                    assert empty_response.status_code == 200, empty_response.text
                    empty_body = empty_response.json()
                    assert empty_body["selection"] == []
                    assert empty_body["scope"]["member_count"] == 0
                    empty_scalar = next(row for row in empty_body["results"]
                                        if row["indicator_id"] == "share_food_c")
                    assert empty_scalar["selected_member_count"] == 0
                    assert empty_scalar["eligible_count"] == 0
                    assert empty_scalar["median"] is None
                    assert "focal_value" not in empty_scalar
                    empty_service = empty_body["essential_service_access"]
                    assert empty_service["scope"]["member_count"] == 0
                    for item in empty_service["services"]:
                        for mode in item["modes"].values():
                            assert "value" not in mode
                            assert mode["median"] is None
                            assert mode["comparison_sources"] == []
                    assert empty_body["building_access"]["scope"]["member_count"] == 0
                    assert empty_body["building_access"]["ramp"] is None
                    assert empty_body["building_access"]["distribution"] is None
                    assert empty_body["service_publication_id"] == "access-v1"
                    assert empty_body["building_publication_id"] == selected["publication_id"]
                    assert "focal-only" not in empty_response.text

                    default_response = client.post(
                        "/api/territories/epci/E1/themes/mobilite/comparison",
                        json={"theme_id": "mobilite"})
                    assert default_response.status_code == 200, default_response.text
                    default_body = default_response.json()
                    assert default_body["selection"] is None
                    assert default_body["scope"]["kind"] == "same_level"
                    assert default_body["essential_service_access"]["scope"]["member_count"] == 2
                    default_food = next(item for item in default_body["essential_service_access"]["services"]
                                        if item["id"] == "food")
                    assert default_food["modes"]["car"]["median"] == pytest.approx(.875)
                    assert default_body["essential_service_access"]["publication_id"] == "access-v1"
                    assert default_body["service_publication_id"] == "access-v1"
                    assert default_body["building_publication_id"] == selected["publication_id"]

                    # The theme-facts snapshot composes the focal density
                    # distribution (migration 024's contract): a measured range
                    # with complete ordinal points, per-value statuses honoured
                    # (a non-measured decile stays null — never fabricated),
                    # and the honest "unsupported" state for a territory
                    # without a published range.
                    facts_response = client.post("/api/territories/epci/E1/themes/mobilite/facts",
                                                 json={"theme_id": "mobilite"})
                    assert facts_response.status_code == 200, facts_response.text
                    distribution = facts_response.json()["density_distribution"]
                    assert distribution["status"] == "measured"
                    assert distribution["range"] == {"minimum": 1.0, "maximum": 52.0, "status": "measured"}
                    assert distribution["units"] == {"density": "part des batiments", "decile": "minutes"}
                    assert [point["ordinal"] for point in distribution["points"]] == list(range(10))
                    assert [point["density"] for point in distribution["points"]] == pytest.approx(
                        [(ordinal + 1) / 100 for ordinal in range(10)])
                    absent_decile = distribution["points"][5]
                    assert absent_decile["decile"] is None
                    assert absent_decile["decile_status"] == "not_available"
                    assert all(point["decile"] is not None
                               for point in distribution["points"] if point["ordinal"] != 5)
                    assert all(point["density_status"] == "measured" for point in distribution["points"])
                    assert distribution["provenance"]["source_id"] == "mobilite_snapshot"
                    assert distribution["content_version"] == "dist-v1"
                    e2_facts = client.post("/api/territories/epci/E2/themes/mobilite/facts",
                                           json={"theme_id": "mobilite"})
                    assert e2_facts.status_code == 200, e2_facts.text
                    e2_distribution = e2_facts.json()["density_distribution"]
                    assert e2_distribution["status"] == "unsupported"
                    assert e2_distribution["range"]["minimum"] is None
                    assert e2_distribution["range"]["maximum"] is None
                    assert e2_distribution["points"] == []
                assert len(checked_out) == 5
                assert len(transactions) == 5
                assert all(len(commands) == 1 for commands in transactions)
                assert all("REPEATABLE READ, READ ONLY" in commands[0] for commands in transactions)
            finally:
                main.app.dependency_overrides.pop(main.get_repository, None)
                if previous_override is not None:
                    main.app.dependency_overrides[main.get_repository] = previous_override
                main.pool.cache_clear()
                pool.close()
    finally:
        if created:
            with psycopg.connect(dsn, autocommit=True) as owner:
                owner.execute(f'DROP SCHEMA "{schema}" CASCADE')
