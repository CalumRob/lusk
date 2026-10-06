"""Selected building evidence retains focal facts and aggregates only selected peers."""

import uuid
from pathlib import Path

import pytest

from api.tests.integration.test_building_evidence_contract import (
    _publish_fixture,
    _schema_dsn,
    _seed_fresh_reference,
    building_db_env,
)

pytestmark = pytest.mark.integration


def test_selected_building_read_preserves_epci_focal_and_weights_commune_peers(building_db_env):
    import psycopg
    from api.main import ReadRepository

    schema = "it_selected_building_" + uuid.uuid4().hex[:12]
    dsn = building_db_env["publish_dsn"]
    created = False
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
                connection.execute("UPDATE table_publication SET row_count=5 WHERE table_name='territory_reference'")
                connection.execute("UPDATE table_publication SET row_count=132 WHERE table_name='building_ramp'")
                connection.execute("UPDATE table_publication SET row_count=120 WHERE table_name='building_grid'")

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
    finally:
        if created:
            with psycopg.connect(dsn, autocommit=True) as owner:
                owner.execute(f'DROP SCHEMA "{schema}" CASCADE')
