"""Small populated migration + registered Mobility publisher + fiche HTTP exercise."""
import os
import json
import re
import subprocess
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

import pytest

pytestmark = pytest.mark.integration


def test_registered_mobility_reading_publication_survives_populated_upgrade_and_serves_http():
    required = ("LUSK_TEST_PUBLISH_DSN", "LUSK_TEST_READ_DSN", "LUSK_TEST_DATABASE_NAME", "LUSK_TEST_DATABASE_PREFIX")
    if not all(os.getenv(key) for key in required):
        pytest.skip("requires explicitly guarded disposable PostgreSQL configuration")
    assert os.environ["LUSK_TEST_DATABASE_PREFIX"] == "lusk_it_"
    assert os.environ["LUSK_TEST_DATABASE_NAME"].startswith("lusk_it_")
    psycopg = pytest.importorskip("psycopg")
    from fastapi.testclient import TestClient
    from api import main

    root = Path(__file__).resolve().parents[3]
    schema = "it_" + uuid.uuid4().hex[:20]
    fresh_schema = "it_" + uuid.uuid4().hex[:20]

    def scoped(dsn):
        url = urlsplit(dsn)
        query = parse_qs(url.query, keep_blank_values=True)
        query["options"] = [f"-csearch_path={schema}"]
        return urlunsplit((url.scheme, url.netloc, url.path, urlencode(query, doseq=True), url.fragment))

    pub = psycopg.connect(os.environ["LUSK_TEST_PUBLISH_DSN"], autocommit=True)
    created_schemas = []
    previous = main.app.dependency_overrides.get(main.get_repository)
    try:
        assert pub.execute("SELECT current_database(),current_user").fetchone() == (
            os.environ["LUSK_TEST_DATABASE_NAME"], urlsplit(os.environ["LUSK_TEST_PUBLISH_DSN"]).username)
        with psycopg.connect(os.environ["LUSK_TEST_READ_DSN"]) as identity:
            assert identity.execute("SELECT current_database(),current_user").fetchone() == (
                os.environ["LUSK_TEST_DATABASE_NAME"], os.environ["LUSK_TEST_READ_USER"])
        pub.execute(f'CREATE SCHEMA "{schema}"')
        created_schemas.append(schema)
        pub.execute(f'SET search_path TO "{schema}"')
        pub.execute(f'CREATE SCHEMA "{fresh_schema}"')
        created_schemas.append(fresh_schema)
        pub.execute(f'SET search_path TO "{fresh_schema}"')
        pub.execute((root / "api/schema.sql").read_text(encoding="utf-8"))
        assert pub.execute("SELECT to_regclass('mobility_typed_reading')").fetchone()[0] == "mobility_typed_reading"
        pub.execute(f'SET search_path TO "{schema}"')

        # Rehearse 023 against the reviewed prior fresh schema with populated
        # unrelated Economy facts/marker; do not exercise a full publication.
        old_schema = (root / "api/schema.sql").read_text(encoding="utf-8")
        old_schema = old_schema.replace("'milieux_typed_reading','mobility_typed_reading'", "'milieux_typed_reading'")
        old_schema = old_schema.replace(",'mobility_typed_reading'", "")
        old_schema = re.sub(r"CREATE TABLE mobility_typed_reading \(.*?CREATE TABLE milieux_population_provenance_revision \(",
                            "CREATE TABLE milieux_population_provenance_revision (", old_schema, flags=re.S)
        old_schema = re.sub(r"GRANT .* ON mobility_typed_reading,mobility_reading_descriptor,mobility_reading_story,mobility_reading_clock TO lusk_(?:reader|publisher);\n", "", old_schema)
        pub.execute(old_schema)
        pub.execute("""INSERT INTO territory_reference(territory_id,territory_type,name,density_class_code,density_class_label) VALUES
            ('35238','commune','Fixture Rennes','D1','Fixture density'),('35239','commune','Fixture unavailable','D1','Fixture density')""")
        pub.execute("INSERT INTO table_publication(table_name,content_version,row_count) VALUES('territory_reference','ref-v1',2)")
        pub.execute("INSERT INTO source_dataset(source_id,name) VALUES('mobilite_snapshot',%s)",
            ("Lusk — analyse d'accessibilité « Vingt minutes sans voiture » (analyse portée, BPE 2024 · OSM 02-2026 · BDNB 2025-07)",))
        pub.execute("""INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date)
            VALUES('mobilite_snapshot','v1/NA','v1',NULL,'2026-08-06')""")
        pub.execute("""INSERT INTO economy_typed_reading VALUES
            ('35238','commune','economy-fixture','fixture-story','fixture','unavailable','mobilite_snapshot','v1/NA')""")
        pub.execute("""INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version)
            VALUES('economy_typed_reading','economy-fixture-v1',1,'ref-v1')""")
        pub.execute((root / "api/migrations/023_mobility_typed_reading.sql").read_text(encoding="utf-8"))

        smoke = subprocess.run(["Rscript", "scripts/smoke-mobility-reading-postgres.R", schema], cwd=root / "pipeline",
                               check=False, timeout=120, capture_output=True, text=True)
        assert smoke.returncode == 0, smoke.stdout + smoke.stderr
        assert pub.execute("SELECT content_version,row_count,reference_content_version FROM table_publication WHERE table_name='mobility_typed_reading'").fetchone()[1:] == (2, "ref-v1")
        descriptor = pub.execute("SELECT unit,direction,allowed_levels,missing_status,classification_values,field_keys,source_version,reference_date FROM mobility_reading_descriptor").fetchone()
        assert descriptor == ("types de services","low",["commune","epci","departement","region"],"unavailable",
            ["saillant","notable","non-saillant"],
            ["groupe","story_key","salience_reason","classification_saillance","div_loss_t","div_loss_b","status"],"v1",None)
        assert pub.execute("SELECT content_version,row_count FROM table_publication WHERE table_name='economy_typed_reading'").fetchone() == ("economy-fixture-v1", 1)
        assert pub.execute("SELECT story_key,div_loss_t,div_loss_b,status FROM mobility_typed_reading WHERE territory_id='35238'").fetchone() == (
            "vingt-minutes-sans-voiture", 8.0, 5.0, "measured")
        reader = os.environ["LUSK_TEST_READ_USER"]
        assert re.fullmatch(r"[A-Za-z0-9_$-]+", reader)
        pub.execute(f'GRANT USAGE ON SCHEMA "{schema}" TO "{reader}"')
        pub.execute(f'GRANT SELECT ON ALL TABLES IN SCHEMA "{schema}" TO "{reader}"')

        from psycopg_pool import ConnectionPool
        pool = ConnectionPool(conninfo=scoped(os.environ["LUSK_TEST_READ_DSN"]), min_size=1, max_size=1,
                             open=True, kwargs={"autocommit": True})
        main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
        try:
            with TestClient(main.app) as client:
                response = client.get("/api/territories/commune/35238/themes/mobilite/facts")
                assert response.status_code == 200, response.text
                body = response.json()
                reading = next(item for item in body["readings"] if item["groupe"] == "acces-aux-services")
                assert {key: reading[key] for key in ("story_key", "salience_reason", "classification_saillance",
                    "div_loss_t", "div_loss_b", "status")} == {
                    "story_key": "vingt-minutes-sans-voiture", "salience_reason": "defaut",
                    "classification_saillance": "non-saillant", "div_loss_t": 8.0,
                    "div_loss_b": 5.0, "status": "measured"}
                assert reading["provenance"]["source_id"] == "mobilite_snapshot"
                assert reading["provenance"]["source_name"].startswith("Lusk — analyse d'accessibilité")
                assert reading["provenance"]["dataset_name"] == "Mobility snapshot dataset"
                assert reading["provenance"]["source_reference_date"] is None
                assert len(reading["provenance"]["windows"]) == 2
                assert body["reading_content_version"]
                unavailable_response=client.get("/api/territories/commune/35239/themes/mobilite/facts")
                assert unavailable_response.status_code==200,unavailable_response.text
                unavailable=unavailable_response.json()["readings"][0]
                assert unavailable["status"]=="unavailable" and unavailable["div_loss_t"] is None
                assert unavailable["div_loss_b"] is None
                assert unavailable_response.json()["reading_descriptor_version"]==body["reading_descriptor_version"]
                pub.execute("UPDATE table_publication SET reference_content_version='stale-ref' WHERE table_name='mobility_typed_reading'")
                stale = client.get("/api/territories/commune/35238/themes/mobilite/facts")
                assert stale.status_code == 503
        finally:
            pool.close()
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous
        for owned_schema in created_schemas:
            pub.execute(f'DROP SCHEMA "{owned_schema}" CASCADE')
        pub.close()


def test_canonical_mobility_reading_publication_matches_artifacts_and_four_focal_http_reads():
    required = ("LUSK_TEST_PUBLISH_DSN", "LUSK_TEST_READ_DSN", "LUSK_TEST_DATABASE_NAME", "LUSK_TEST_DATABASE_PREFIX")
    if not all(os.getenv(key) for key in required):
        pytest.skip("requires explicitly guarded disposable PostgreSQL configuration")
    assert os.environ["LUSK_TEST_DATABASE_PREFIX"] == "lusk_it_"
    assert os.environ["LUSK_TEST_DATABASE_NAME"].startswith("lusk_it_")
    psycopg = pytest.importorskip("psycopg")
    from fastapi.testclient import TestClient
    from api import main

    root = Path(__file__).resolve().parents[3]
    schema = "it_" + uuid.uuid4().hex[:20]

    def scoped(dsn):
        url = urlsplit(dsn)
        query = parse_qs(url.query, keep_blank_values=True)
        query["options"] = [f"-csearch_path={schema}"]
        return urlunsplit((url.scheme, url.netloc, url.path, urlencode(query, doseq=True), url.fragment))

    pub = psycopg.connect(os.environ["LUSK_TEST_PUBLISH_DSN"], autocommit=True)
    previous = main.app.dependency_overrides.get(main.get_repository)
    created = False
    try:
        assert pub.execute("SELECT current_database(),current_user").fetchone() == (
            os.environ["LUSK_TEST_DATABASE_NAME"], urlsplit(os.environ["LUSK_TEST_PUBLISH_DSN"]).username)
        with psycopg.connect(os.environ["LUSK_TEST_READ_DSN"]) as identity:
            assert identity.execute("SELECT current_database(),current_user").fetchone() == (
                os.environ["LUSK_TEST_DATABASE_NAME"], os.environ["LUSK_TEST_READ_USER"])
        pub.execute(f'CREATE SCHEMA "{schema}"')
        created = True
        pub.execute(f'SET search_path TO "{schema}"')
        pub.execute((root / "api/schema.sql").read_text(encoding="utf-8"))

        publication = subprocess.run(
            ["Rscript", "scripts/smoke-canonical-mobility-reading-postgres.R", schema, "E:/Lusk/public/data"],
            cwd=root / "pipeline", check=False, timeout=120, capture_output=True, text=True, encoding="utf-8")
        assert publication.returncode == 0, publication.stdout + publication.stderr
        assert "CANONICAL_SQL_PARITY=1266 REFERENCE_ROWS=1268 NOOP_RETRY=TRUE" in publication.stdout
        expected_line = next(line for line in publication.stdout.splitlines()
                             if line.startswith("CANONICAL_HTTP_EXPECTED="))
        expected_rows = json.loads(expected_line.split("=", 1)[1])
        expected_by_territory = {row["territory_id"]: row for row in expected_rows}
        assert set(expected_by_territory) == {"35238", "243500139", "35", "53"}
        assert pub.execute("SELECT count(*) FROM territory_reference").fetchone()[0] == 1268
        assert pub.execute("SELECT count(*) FROM mobility_typed_reading").fetchone()[0] == 1266
        assert pub.execute("SELECT count(*) FROM table_publication WHERE table_name='scalar_observation'").fetchone()[0] == 0
        assert pub.execute("SELECT count(*) FROM table_publication WHERE table_name='mobility_typed_reading'").fetchone()[0] == 1
        for territory_id, expected in expected_by_territory.items():
            stored_name = pub.execute("SELECT name FROM territory_reference WHERE territory_id=%s", (territory_id,)).fetchone()[0]
            assert stored_name == expected["territory_name"], (territory_id, repr(stored_name), repr(expected["territory_name"]))
        source = expected_by_territory["35238"]["provenance"]
        assert pub.execute("SELECT sd.name,d.dataset_name FROM source_dataset sd JOIN mobility_reading_descriptor d USING(source_id)").fetchone() == (
            source["source_name"], source["dataset_name"])

        reader = os.environ["LUSK_TEST_READ_USER"]
        assert re.fullmatch(r"[A-Za-z0-9_$-]+", reader)
        pub.execute(f'GRANT USAGE ON SCHEMA "{schema}" TO "{reader}"')
        pub.execute(f'GRANT SELECT ON ALL TABLES IN SCHEMA "{schema}" TO "{reader}"')
        from psycopg_pool import ConnectionPool
        pool = ConnectionPool(conninfo=scoped(os.environ["LUSK_TEST_READ_DSN"]), min_size=1, max_size=1,
                             open=True, kwargs={"autocommit": True})
        main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
        try:
            with TestClient(main.app) as client:
                for territory_id, expected in expected_by_territory.items():
                    response = client.get(
                        f"/api/territories/{expected['territory_type']}/{territory_id}/themes/mobilite/facts")
                    assert response.status_code == 200, response.text
                    body = response.json()
                    assert body["reading_availability"] == "available"
                    assert body["territory"] == {"territory_id": territory_id,
                        "territory_type": expected["territory_type"], "name": expected["territory_name"]}
                    assert body["reading_content_version"]
                    assert body["reading_descriptor_version"]
                    assert body["indicators"] == []
                    assert len(body["readings"]) == 1
                    reading = body["readings"][0]
                    expected_reading = {key: value for key, value in expected.items()
                                        if key not in ("territory_id", "territory_type", "territory_name")}
                    assert reading == expected_reading
        finally:
            pool.close()
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous
        if created:
            pub.execute(f'DROP SCHEMA "{schema}" CASCADE')
        pub.close()
