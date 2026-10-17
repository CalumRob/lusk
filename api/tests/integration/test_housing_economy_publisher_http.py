"""Registered Economy reading publisher through shared semantic HTTP reads."""
from __future__ import annotations

import json
import os
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

import pytest
from fastapi.testclient import TestClient

from api import main

pytestmark = pytest.mark.integration


def test_registered_economy_readings_match_independent_canonical_artifact():
    schema = os.environ.get("LUSK_HOUSING_HTTP_SCHEMA")
    read_dsn = os.environ.get("LUSK_TEST_READ_DSN")
    canonical_dir = Path(os.environ.get("LUSK_TEST_CANONICAL_DATA_DIR", ""))
    if not schema or not read_dsn or not canonical_dir.is_dir():
        pytest.skip("invoked by guarded smoke-housing-economy-postgres.R")
    histories = json.loads((canonical_dir / "histoires_economie.json").read_text(encoding="utf-8"))
    indicators = json.loads((canonical_dir / "indicateurs_economie.json").read_text(encoding="utf-8"))
    vintages = json.loads((canonical_dir / "vintages.json").read_text(encoding="utf-8"))
    metadata = json.loads((canonical_dir / "theme_economie.json").read_text(encoding="utf-8"))
    parts = urlsplit(read_dsn)
    query = parse_qs(parts.query, keep_blank_values=True)
    query["options"] = [f"-csearch_path={schema}"]
    scoped_dsn = urlunsplit((parts.scheme, parts.netloc, parts.path,
                             urlencode(query, doseq=True), parts.fragment))
    from psycopg_pool import ConnectionPool
    pool = ConnectionPool(conninfo=scoped_dsn, min_size=1, max_size=1, open=True,
                          kwargs={"autocommit": True})
    previous = main.app.dependency_overrides.get(main.get_repository)
    main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
    try:
        with pool.connection() as conn:
            assert conn.execute("SELECT current_database(),current_user").fetchone() == (
                os.environ["LUSK_TEST_DATABASE_NAME"], os.environ["LUSK_TEST_READ_USER"])
            marker = conn.execute("SELECT content_version,row_count,reference_content_version "
                                  "FROM table_publication WHERE table_name='economy_typed_reading'").fetchone()
            evidence_marker = conn.execute("SELECT content_version,row_count,reference_content_version "
                                  "FROM table_publication WHERE table_name='economy_activity_evidence'").fetchone()
            assert marker and evidence_marker
            assert marker[0] == evidence_marker[0]
            reference = conn.execute("SELECT content_version FROM table_publication "
                                     "WHERE table_name='territory_reference'").fetchone()[0]
            assert marker[2] == evidence_marker[2] == reference
            focal = conn.execute("SELECT territory_id,epci_id,department_id FROM territory_reference "
                                 "WHERE territory_type='commune' AND territory_id='35238'").fetchone()
            assert focal is not None
            region_ids = [row[0] for row in conn.execute(
                "SELECT territory_id FROM territory_reference WHERE territory_type='region' ORDER BY territory_id")]
        selected = {(row["type"], str(row["territoire"])): row for row in histories
                    if row["theme"] == "economie"}
        targets = [("commune", "35238"), ("epci", focal[1]), ("departement", focal[2])]
        targets.extend(("region", territory_id) for territory_id in region_ids)
        with TestClient(main.app) as client:
            scalar_source = next(row for row in indicators if row["key"] == "eco_activites"
                                 and row["type"] == "commune" and str(row["territoire"]) == "35238")
            scalar = client.post("/api/resources/read", json={
                "resource": "eco_activites",
                "target": {"kind": "territory", "type": "commune", "id": "35238"},
                "intent": {"kind": "facts"},
            })
            assert scalar.status_code == 200, scalar.text
            scalar_fact = scalar.json()
            assert scalar_fact["value"] == scalar_source["value"]
            assert scalar_fact["unit"] == scalar_source["unit"] == "%"
            assert scalar_fact["status"] == "measured"
            scalar_vintage = next(row for row in vintages
                                  if row["source"] == scalar_source["vintage_source"])
            assert scalar_fact["sources"] == [{
                "source_id": metadata["sources"]["eco_activites"],
                "name": scalar_source["vintage_source"],
                "vintage_id": f"{scalar_source['vintage_version']}/{scalar_source['vintage_date_reference']}",
                "version": scalar_vintage["version"],
                "reference_date": scalar_source["vintage_date_reference"],
                "publication_date": scalar_source["vintage_date_publication"],
            }]
            for level, territory_id in targets:
                producer_row = selected.get((level, str(territory_id)))
                if producer_row is None:
                    continue
                expected_activities = []
                for rank in range(1, 6):
                    code = producer_row.get(f"top{rank}_activity_code")
                    if code is None:
                        continue
                    expected_activities.append({
                        "rank": rank, "activity_code": code,
                        "activity_label": producer_row[f"top{rank}_activity_label"],
                        "lq": producer_row[f"top{rank}_lq"],
                        "n": producer_row[f"top{rank}_n"],
                        "part_parc": producer_row[f"top{rank}_part_parc"],
                    })
                response = client.post("/api/resources/read", json={
                    "resource": "economie_selected_reading",
                    "target": {"kind": "territory", "type": level, "id": str(territory_id)},
                    "coordinates": {"groupe": [producer_row["groupe"]]},
                    "fields": ["groupe", "story_key", "salience_reason", "status",
                               "source_id", "vintage_id", "ranked_activities"],
                    "intent": {"kind": "facts"},
                })
                assert response.status_code == 200, response.text
                payload = response.json()
                assert payload["content_version"] == marker[0]
                assert len(payload["facts"]) == 1
                fact = payload["facts"][0]
                assert (fact["groupe"], fact["story_key"], fact["salience_reason"], fact["status"]) == (
                    producer_row["groupe"], producer_row["story_key"], producer_row["salience_reason"],
                    "measured" if expected_activities else "unavailable")
                source_id = metadata["sources"]["eco_activites"]
                source = next(row for row in vintages if row["id"] == source_id)
                vintage_id = f"{source['version']}/{source['date_reference'] or 'NA'}"
                assert (fact["source_id"], fact["vintage_id"]) == (source_id, vintage_id)
                actual = payload["ranked_activities"]
                assert [row["rank"] for row in actual] == [row["rank"] for row in expected_activities]
                assert [{key: row[key] for key in ("rank", "activity_code", "activity_label", "lq",
                          "establishment_count", "park_share")} for row in actual] == [
                    {"rank": row["rank"], "activity_code": row["activity_code"],
                     "activity_label": row["activity_label"], "lq": row["lq"],
                     "establishment_count": row["n"], "park_share": row["part_parc"]}
                    for row in expected_activities]
                repeated = client.post("/api/resources/read", json={
                    "resource": "economie_selected_reading",
                    "target": {"kind": "territory", "type": level, "id": str(territory_id)},
                    "coordinates": {"groupe": [producer_row["groupe"]]},
                    "intent": {"kind": "facts"},
                })
                assert repeated.status_code == 200 and repeated.json()["content_version"] == payload["content_version"]
        assert marker[1] > 0 and evidence_marker[1] > 0
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous
        pool.close()
