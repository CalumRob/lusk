"""Registered Milieux reading/lineage publication through semantic HTTP."""
from __future__ import annotations

import json
import os
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

import pytest
from fastapi.testclient import TestClient

from api import main

pytestmark = pytest.mark.integration


def test_registered_milieux_reading_and_source_absence_are_semantic_resources():
    schema = os.environ.get("LUSK_MILIEUX_HTTP_SCHEMA")
    read_dsn = os.environ.get("LUSK_TEST_READ_DSN")
    canonical = Path(os.environ.get("LUSK_TEST_CANONICAL_DATA_DIR", ""))
    if not schema or not read_dsn or not canonical.is_dir():
        pytest.skip("invoked by guarded smoke-milieux-reading-postgres.R")
    expected = json.loads((canonical / "milieux_http_expected.json").read_text(encoding="utf-8"))
    parts = urlsplit(read_dsn)
    query = parse_qs(parts.query, keep_blank_values=True)
    query["options"] = [f"-csearch_path={schema}"]
    scoped = urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query, doseq=True), parts.fragment))
    from psycopg_pool import ConnectionPool
    pool = ConnectionPool(conninfo=scoped, min_size=1, max_size=1, open=True,
                          kwargs={"autocommit": True})
    previous = main.app.dependency_overrides.get(main.get_repository)
    main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
    try:
        with pool.connection() as conn:
            assert conn.execute("SELECT current_database(),current_user").fetchone() == (
                os.environ["LUSK_TEST_DATABASE_NAME"], os.environ["LUSK_TEST_READ_USER"])
            markers = conn.execute("SELECT table_name,content_version,row_count,reference_content_version "
                "FROM table_publication WHERE table_name IN ('milieux_typed_reading','milieux_reading_absence') "
                "ORDER BY table_name").fetchall()
            assert len(markers) == 2 and markers[0][1] == markers[1][1]
            assert all(row[3] for row in markers)
        reading = expected["reading"]
        target = {"kind": "territory", "type": reading["territory_type"], "id": reading["territory_id"]}
        request = {
            "resource": "milieux_selected_reading", "target": target,
            "coordinates": {"groupe": [reading["groupe"]]},
            "fields": ["groupe", "story_key", "salience_reason", "periode_pop", "periode_artif",
                       "delta_population", "taux_variation_population", "artif_m2_par_habitant",
                       "artif_m3_par_habitant", "trajectoire_artif_par_habitant", "classification",
                       "status", "source_id", "vintage_id", "source_bindings"],
            "intent": {"kind": "facts"},
        }
        with TestClient(main.app) as client:
            response = client.post("/api/resources/read", json=request)
            assert response.status_code == 200, response.text
            payload = response.json()
            assert len(payload["facts"]) == 1
            fact = payload["facts"][0]
            numeric_fields = {"delta_population", "taux_variation_population", "artif_m2_par_habitant",
                              "artif_m3_par_habitant", "trajectoire_artif_par_habitant"}
            for key in ("groupe", "story_key", "salience_reason", "periode_pop", "periode_artif",
                        "delta_population", "taux_variation_population", "artif_m2_par_habitant",
                        "artif_m3_par_habitant", "trajectoire_artif_par_habitant", "classification",
                        "status", "source_id", "vintage_id"):
                if key in numeric_fields:
                    assert fact[key] == pytest.approx(reading[key]), (key, fact[key], reading[key])
                else:
                    assert fact[key] == reading[key], (key, fact[key], reading[key])
            assert payload["source_bindings"] == expected["bindings"]

            absence = expected["absence"]
            absent_request = {
                "resource": "milieux_selected_reading",
                "target": {"kind": "territory", "type": absence["territory_type"],
                           "id": absence["territory_id"]},
                "fields": ["source_absences"], "intent": {"kind": "facts"},
            }
            absent = client.post("/api/resources/read", json=absent_request)
            assert absent.status_code == 200, absent.text
            absent_payload = absent.json()
            assert absent_payload["facts"] == []
            assert absent_payload["source_absences"] == [absence]

            # Sparse absence is evidence, not a fabricated unavailable fact.
            writer_dsn = os.environ["LUSK_TEST_PUBLISH_DSN"]
            from psycopg import connect
            with connect(writer_dsn, options=f"-csearch_path={schema}", autocommit=True) as writer:
                writer.execute("DELETE FROM milieux_reading_absence WHERE territory_id=%s", (absence["territory_id"],))
            missing = client.post("/api/resources/read", json=absent_request)
            assert missing.status_code == 503, missing.text
            with connect(writer_dsn, options=f"-csearch_path={schema}", autocommit=True) as writer:
                writer.execute("INSERT INTO milieux_reading_absence(territory_id,territory_type,reason,source_id,vintage_id,source_snapshot_sha256) "
                    "VALUES(%s,%s,%s,%s,%s,%s)", tuple(absence.values()))
                writer.execute("UPDATE table_publication SET content_version='stale' "
                    "WHERE table_name='milieux_reading_absence'")
            stale = client.post("/api/resources/read", json=absent_request)
            assert stale.status_code == 503, stale.text
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous
        pool.close()
