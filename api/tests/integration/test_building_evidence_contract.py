"""Opt-in SQL-backed checks for the #599 building evidence contract."""

from __future__ import annotations

import json
import os
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

import pytest

pytestmark = pytest.mark.integration


@pytest.fixture
def building_db_env():
    dsn = os.environ.get("LUSK_TEST_PUBLISH_DSN")
    db_name = os.environ.get("LUSK_TEST_DATABASE_NAME")
    prefix = os.environ.get("LUSK_TEST_DATABASE_PREFIX")
    if not all((dsn, db_name, prefix)):
        pytest.skip("requires explicit LUSK_TEST_PUBLISH_DSN and disposable database guard")
    parts = urlsplit(dsn)
    if prefix != "lusk_it_" or not db_name.startswith(prefix) or parts.path.lstrip("/") != db_name:
        pytest.fail("Refusing DSN unless it targets the explicitly named lusk_it_ database")
    if db_name.casefold() in {"lusk", "postgres", "template0", "template1"}:
        pytest.fail("Refusing production/default PostgreSQL database name")
    return {"publish_dsn": dsn}


def _schema_dsn(dsn: str, schema: str) -> str:
    parts = urlsplit(dsn)
    query = parse_qs(parts.query, keep_blank_values=True)
    query["options"] = [f"-csearch_path={schema}"]
    return urlunsplit((parts.scheme, parts.netloc, parts.path,
                       urlencode(query, doseq=True), parts.fragment))


def _contracts():
    return {
        "building_ramp": {
            "shape": "building_ramp", "peer_statistic": "building_count_weighted_mean",
            "territory_levels": ["commune", "epci", "departement", "region"],
            "axes": {"mode": ["c", "b", "t"], "quantile": [i / 10 for i in range(11)]},
            "direction": "high",
        },
        "building_grid": {
            "shape": "building_grid", "peer_statistic": "pooled_building_counts",
            "territory_levels": ["commune", "epci", "departement", "region"],
            "axes": {"mode": "t", "breadth": ["0", "1-9", "10-24", "25-39", "40-53"],
                     "depth": ["0", "1-9", "10-49", "50-199", "200-499", "500+"]},
        },
    }


def _previous_layout_sql():
    """Minimal #594-era shared schema and existing dedicated fact shapes."""
    return """
    CREATE TABLE table_publication(table_name text PRIMARY KEY, content_version text NOT NULL,
      row_count integer NOT NULL, published_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE source_dataset(source_id text PRIMARY KEY, name text NOT NULL);
    CREATE TABLE source_vintage(source_id text NOT NULL REFERENCES source_dataset(source_id),
      vintage_id text NOT NULL, version text NOT NULL, reference_date date, publication_date date,
      PRIMARY KEY(source_id,vintage_id));
    CREATE TABLE territory_reference(territory_id text PRIMARY KEY, territory_type text NOT NULL,
      name text NOT NULL, department_id text, epci_id text, density_class_code text,
      density_class_label text);
    CREATE TABLE building_ramp(territory_id text NOT NULL REFERENCES territory_reference(territory_id),
      territory_type text NOT NULL CHECK(territory_type IN ('commune','epci','departement','region')),
      availability text NOT NULL CHECK(availability IN ('complete','absent')),
      mode text NOT NULL CHECK(mode IN ('c','b','t')),
      quantile_index smallint NOT NULL CHECK(quantile_index BETWEEN -1 AND 10),
      quantile double precision, accessible_types double precision,
      total_buildings integer NOT NULL CHECK(total_buildings>=0), source_id text NOT NULL,
      source_version text NOT NULL, effective_direction text NOT NULL CHECK(effective_direction IN ('high','low')),
      PRIMARY KEY(territory_type,territory_id,mode,quantile_index),
      CHECK((availability='absent' AND quantile_index=-1 AND quantile IS NULL
        AND accessible_types IS NULL AND total_buildings=0) OR
        (availability='complete' AND quantile_index>=0 AND quantile IS NOT NULL
        AND accessible_types IS NOT NULL AND total_buildings>0)));
    CREATE TABLE building_grid(territory_id text NOT NULL REFERENCES territory_reference(territory_id),
      territory_type text NOT NULL CHECK(territory_type IN ('commune','epci','departement','region')),
      availability text NOT NULL CHECK(availability IN ('complete','absent')),
      mode text NOT NULL CHECK(mode='t'), cell_index smallint NOT NULL CHECK(cell_index BETWEEN -1 AND 29),
      breadth_bucket text, depth_bucket text, building_count integer,
      total_buildings integer NOT NULL CHECK(total_buildings>=0), source_id text NOT NULL,
      source_version text NOT NULL, PRIMARY KEY(territory_type,territory_id,cell_index),
      CHECK((availability='absent' AND cell_index=-1 AND breadth_bucket IS NULL AND depth_bucket IS NULL
        AND building_count IS NULL AND total_buildings=0) OR (availability='complete' AND cell_index>=0
        AND breadth_bucket IS NOT NULL AND depth_bucket IS NOT NULL AND building_count>=0 AND total_buildings>0)));
    CREATE FUNCTION assert_building_dataset_complete(integer,integer) RETURNS void
      LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
    """


def _create_prior_publication(connection):
    connection.execute("INSERT INTO territory_reference(territory_id,territory_type,name) VALUES ('A','commune','Alpha')")
    connection.execute("INSERT INTO building_ramp VALUES ('A','commune','complete','c',0,0,0,2,'snapshot','old','high')")
    connection.execute("INSERT INTO building_grid VALUES ('A','commune','complete','t',0,'0','0',2,2,'snapshot','old')")
    connection.execute("""INSERT INTO table_publication(table_name,content_version,row_count) VALUES
      ('territory_reference','ref-old',1),('building_ramp','ramp-old',1),('building_grid','grid-old',1)""")


def _seed_fresh_reference(connection):
    """Seed the canonical territory identity and its independent publication marker."""
    connection.execute("""INSERT INTO territory_reference
      (territory_id,territory_type,name,department_id,epci_id,density_class_code,density_class_label)
      VALUES ('A','commune','Alpha','29','E1','D1','Centres urbains')""")
    connection.execute("""INSERT INTO table_publication(table_name,content_version,row_count)
      VALUES ('territory_reference','ref-fixture-v1',1)""")


def _publish_fixture(connection, version: str):
    contracts = _contracts()
    connection.execute("INSERT INTO source_dataset VALUES ('snapshot','Canonical fixture source') ON CONFLICT DO NOTHING")
    connection.execute("INSERT INTO source_vintage VALUES ('snapshot','v1','v1','2026-01-01','2026-02-01') ON CONFLICT DO NOTHING")
    for table, contract in contracts.items():
        content_version = f"{table}-{version}"
        connection.execute("""INSERT INTO building_evidence_descriptor(table_name,descriptor_version,contract)
          VALUES (%s,%s,%s::jsonb) ON CONFLICT(table_name) DO UPDATE SET
          descriptor_version=excluded.descriptor_version,contract=excluded.contract""",
          (table, content_version, json.dumps(contract)))
        connection.execute("DELETE FROM building_evidence_descriptor_source WHERE table_name=%s", (table,))
        connection.execute("INSERT INTO building_evidence_descriptor_source VALUES (%s,'snapshot')", (table,))
    connection.execute("DELETE FROM building_ramp WHERE territory_id='A'")
    connection.execute("DELETE FROM building_grid WHERE territory_id='A'")
    for mode in ("c", "b", "t"):
        for index in range(11):
            connection.execute("""INSERT INTO building_ramp VALUES
              ('A','commune','complete',%s,%s,%s,%s,2,'snapshot','v1','high')""",
              (mode, index, 0.1 + 0.2 if index == 3 else index / 10, index / 5))
    breadth = _contracts()["building_grid"]["axes"]["breadth"]
    depth = _contracts()["building_grid"]["axes"]["depth"]
    for i, b in enumerate(breadth):
        for j, d in enumerate(depth):
            connection.execute("""INSERT INTO building_grid VALUES
              ('A','commune','complete','t',%s,%s,%s,%s,2,'snapshot','v1')""",
              (i * len(depth) + j, b, d, 2 if i == 0 and j == 0 else 0))
    connection.execute("SELECT assert_building_dataset_complete(33,30)")
    for table in contracts:
        connection.execute("""INSERT INTO table_publication(table_name,content_version,row_count)
          VALUES (%s,%s,%s) ON CONFLICT(table_name) DO UPDATE SET
          content_version=excluded.content_version,row_count=excluded.row_count,published_at=now()""",
          (table, f"{table}-{version}", 33 if table == "building_ramp" else 30))


@pytest.mark.parametrize("layout", ["fresh", "previous"])
def test_building_descriptor_constraints_and_atomic_refresh(building_db_env, layout):
    import psycopg

    schema = "it_building_" + uuid.uuid4().hex[:16]
    scoped = _schema_dsn(building_db_env["publish_dsn"], schema)
    api_root = Path(__file__).resolve().parents[2]
    schema_sql = (api_root / "schema.sql").read_text(encoding="utf-8")
    migration_sql = (api_root / "migrations" / "008_building_evidence_contract.sql").read_text(encoding="utf-8")
    correction_sql = (api_root / "migrations" / "010_building_quantile_float_tolerance.sql").read_text(encoding="utf-8")
    created = False
    try:
        with psycopg.connect(building_db_env["publish_dsn"], autocommit=True) as connection:
            connection.execute(f'CREATE SCHEMA "{schema}"')
            created = True
        with psycopg.connect(scoped, autocommit=True) as connection:
            if layout == "fresh":
                connection.execute(schema_sql)
                _seed_fresh_reference(connection)
            else:
                connection.execute(_previous_layout_sql())
                _create_prior_publication(connection)
                old_markers = connection.execute("SELECT table_name,content_version FROM table_publication ORDER BY table_name").fetchall()
                # The live installation has the original 008 trigger, which rejects
                # R's 0.30000000000000004 even though its axis is declared as 0.3.
                original_008 = migration_sql.replace(
                    "NOT COALESCE(abs(NEW.quantile - (expected_quantile #>> '{}')::double precision) <= 1e-12, false)",
                    "NEW.quantile IS DISTINCT FROM (expected_quantile #>> '{}')::double precision",
                )
                assert original_008 != migration_sql
                connection.execute(original_008)
                assert connection.execute("SELECT table_name,content_version FROM table_publication ORDER BY table_name").fetchall() == old_markers
                # NOT VALID FKs intentionally leave this historic row unvalidated/readable.
                assert connection.execute("SELECT count(*) FROM building_ramp").fetchone()[0] == 1
                with pytest.raises(psycopg.errors.RaiseException, match="ramp point is outside its declared axes"):
                    with connection.transaction():
                        _publish_fixture(connection, "pre-correction")
                assert connection.execute("SELECT table_name,content_version FROM table_publication ORDER BY table_name").fetchall() == old_markers
                connection.execute(correction_sql)

            _publish_fixture(connection, "good")
            assert connection.execute("""SELECT table_name,content_version FROM table_publication
              WHERE table_name IN ('building_ramp','building_grid') ORDER BY table_name""").fetchall() == [
                ("building_grid", "building_grid-good"), ("building_ramp", "building_ramp-good")]

            # Each rejected statement runs in its own rolled-back transaction.
            bad_rows = [
                ("quantile", "DELETE FROM building_ramp WHERE territory_id='A' AND mode='c' AND quantile_index=1",
                 "INSERT INTO building_ramp VALUES ('A','commune','complete','c',1,0.15,0.3,2,'snapshot','v1','high')"),
                ("off-axis quantile", "DELETE FROM building_ramp WHERE territory_id='A' AND mode='c' AND quantile_index=3",
                 "INSERT INTO building_ramp VALUES ('A','commune','complete','c',3,0.3001,0.3,2,'snapshot','v1','high')"),
                ("mode", None,
                 "INSERT INTO building_ramp VALUES ('A','commune','complete','x',10,1,2,2,'snapshot','v1','high')"),
                ("source", None,
                 "INSERT INTO building_ramp VALUES ('A','commune','complete','b',10,1,2,2,'other','v1','high')"),
                ("level", None,
                 "INSERT INTO building_ramp VALUES ('A','unknown','complete','c',10,1,2,2,'snapshot','v1','high')"),
                ("availability", None,
                 "INSERT INTO building_ramp VALUES ('A','commune','absent','c',10,1,2,0,'snapshot','v1','high')"),
            ]
            connection.execute("INSERT INTO source_dataset VALUES ('other','Undeclared source')")
            connection.execute("INSERT INTO source_vintage VALUES ('other','v1','v1',NULL,NULL)")
            for _name, remove_sql, insert_sql in bad_rows:
                with pytest.raises(psycopg.Error):
                    with connection.transaction():
                        if remove_sql:
                            connection.execute(remove_sql)
                        connection.execute(insert_sql)
            with pytest.raises(psycopg.Error):
                with connection.transaction():
                    connection.execute("UPDATE building_grid SET breadth_bucket='not-declared' WHERE territory_id='A' AND cell_index=1")
            # A declared pair is still invalid when stored at another cell's
            # index: the PK alone does not ensure the dense Cartesian mapping.
            with pytest.raises(psycopg.Error):
                with connection.transaction():
                    connection.execute("UPDATE building_grid SET breadth_bucket='1-9' WHERE territory_id='A' AND cell_index=1")

            # Deferred marker validation happens at transaction commit, and a
            # source link without a matching descriptor is also not publishable.
            with pytest.raises(psycopg.Error):
                with connection.transaction():
                    connection.execute("UPDATE table_publication SET content_version='unmatched' WHERE table_name='building_ramp'")
            with pytest.raises(psycopg.Error):
                with connection.transaction():
                    connection.execute("DELETE FROM building_evidence_descriptor_source WHERE table_name='building_grid'")
                    connection.execute("UPDATE table_publication SET content_version='unmatched' WHERE table_name='building_grid'")

            before_markers = connection.execute("""SELECT table_name,content_version FROM table_publication
              WHERE table_name IN ('building_ramp','building_grid') ORDER BY table_name""").fetchall()
            before_counts = (connection.execute("SELECT count(*) FROM building_ramp").fetchone()[0],
                             connection.execute("SELECT count(*) FROM building_grid").fetchone()[0])
            connection.execute("""CREATE FUNCTION reject_building_refresh() RETURNS trigger LANGUAGE plpgsql AS $$
              BEGIN IF NEW.quantile_index=5 THEN RAISE EXCEPTION 'injected refresh failure'; END IF;
              RETURN NEW; END $$""")
            connection.execute("""CREATE TRIGGER reject_building_refresh BEFORE INSERT ON building_ramp
              FOR EACH ROW EXECUTE FUNCTION reject_building_refresh()""")
            with pytest.raises(psycopg.errors.RaiseException, match="injected refresh failure"):
                with connection.transaction():
                    _publish_fixture(connection, "failed")
            assert connection.execute("""SELECT table_name,content_version FROM table_publication
              WHERE table_name IN ('building_ramp','building_grid') ORDER BY table_name""").fetchall() == before_markers
            assert (connection.execute("SELECT count(*) FROM building_ramp").fetchone()[0],
                    connection.execute("SELECT count(*) FROM building_grid").fetchone()[0]) == before_counts
            connection.execute("DROP TRIGGER reject_building_refresh ON building_ramp")
            connection.execute("DROP FUNCTION reject_building_refresh()")
    finally:
        if created and os.environ.get("LUSK_TEST_ALLOW_SCHEMA_CLEANUP") == "1":
            with psycopg.connect(building_db_env["publish_dsn"], autocommit=True) as connection:
                connection.execute(f'DROP SCHEMA "{schema}" CASCADE')
