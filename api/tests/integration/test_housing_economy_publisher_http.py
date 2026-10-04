"""Canonical eco_activites shared-scalar publisher through the public HTTP route."""
from __future__ import annotations

import os
import json
from pathlib import Path
from urllib.parse import parse_qs, urlsplit, urlunsplit, urlencode

import pytest
from fastapi.testclient import TestClient

from api import main


pytestmark = pytest.mark.integration


def test_registered_economy_scalar_publication_is_readable_over_http():
    schema = os.environ.get("LUSK_HOUSING_HTTP_SCHEMA")
    territory = os.environ.get("LUSK_HOUSING_HTTP_TERRITORY")
    read_dsn = os.environ.get("LUSK_TEST_READ_DSN")
    if not schema or not territory or not read_dsn:
        pytest.skip("invoked by smoke-housing-economy-postgres.R with its live private schema")
    pytest.importorskip("psycopg_pool")
    from psycopg_pool import ConnectionPool
    parts = urlsplit(read_dsn)
    query = parse_qs(parts.query, keep_blank_values=True)
    query["options"] = [f"-csearch_path={schema}"]
    scoped_dsn = urlunsplit((parts.scheme, parts.netloc, parts.path,
                             urlencode(query, doseq=True), parts.fragment))
    pool = ConnectionPool(conninfo=scoped_dsn, min_size=1, max_size=1, open=True,
                          kwargs={"autocommit": True})
    previous = main.app.dependency_overrides.get(main.get_repository)
    main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
    try:
        with pool.connection() as conn:
            assert conn.execute("SELECT current_database(),current_user").fetchone() == (
                os.environ["LUSK_TEST_DATABASE_NAME"], os.environ["LUSK_TEST_READ_USER"])
            marker = conn.execute("SELECT content_version,row_count FROM table_publication "
                                  "WHERE table_name='scalar_observation'").fetchone()
            assert marker is not None and marker[1] > 53253
            assert conn.execute("SELECT count(*) FROM scalar_descriptor").fetchone()[0] == 45
            canonical = conn.execute("""SELECT o.value,o.status,o.support_count,o.denominator_count,
                d.unit,d.direction,d.comparison_facet,
                (SELECT json_agg(json_build_object('source_id',s.source_id,'vintage_id',s.vintage_id,
                  'name',d.name,'version',v.version,'reference_date',v.reference_date,'publication_date',v.publication_date)
                  ORDER BY s.source_id,s.vintage_id)
                 FROM scalar_observation_source s JOIN source_vintage v USING(source_id,vintage_id)
                   JOIN source_dataset d USING(source_id)
                 WHERE s.indicator_id=o.indicator_id AND s.territory_id=o.territory_id) AS sources
                FROM scalar_observation o JOIN scalar_descriptor d USING(indicator_id)
                WHERE o.indicator_id='eco_activites' AND o.territory_id=%s AND o.territory_type='commune'""",
                (territory,)).fetchone()
            assert canonical is not None
            expected_activities = conn.execute("""SELECT rank,activity_code,activity_label,lq,establishment_count,park_share
                FROM economy_activity_evidence WHERE territory_id=%s AND territory_type='commune' AND groupe=%s ORDER BY rank""",
                (territory,"sante-et-taille")).fetchall()
            unsupported_region = conn.execute("SELECT territory_id FROM territory_reference WHERE territory_type='region' LIMIT 1").fetchone()
        previous_pool = main.app.dependency_overrides.get(main.get_repository)
        with TestClient(main.app) as client:
            response = client.get(f"/api/territories/commune/{territory}/indicators/eco_activites")
            assert response.status_code == 200, response.text
            body = response.json()
            assert body["indicator_id"] == "eco_activites"
            assert body["value"] == canonical[0]
            assert body["status"] == canonical[1]
            assert body["support_count"] is None and body["denominator_count"] is None
            assert body["unit"] == canonical[4] == "%"
            assert body["direction"] == canonical[5] == "high"
            assert body["comparison_facet"] == canonical[6] == "eco_activites"
            assert body["sources"] == canonical[7]
            comparison = client.post(
                f"/api/territories/commune/{territory}/indicators/eco_activites/comparison")
            assert comparison.status_code == 200, comparison.text
            result = comparison.json()["result"]
            assert result["indicator_id"] == "eco_activites"
            assert result["unit"] == "%"
            assert "focal_value" not in result
            empty = client.post(
                f"/api/territories/commune/{territory}/indicators/eco_activites/comparison",
                json={"selection": []})
            assert empty.status_code == 200, empty.text
            assert empty.json()["result"]["status"] == "unavailable"
            assert empty.json()["result"]["median"] is None
            assert "focal_value" not in empty.json()["result"]
            fiche = client.get(f"/api/territories/commune/{territory}/themes/economie/facts")
            assert fiche.status_code == 200, fiche.text
            economy = next(item for item in fiche.json()["readings"] if item["groupe"] == "sante-et-taille")
            assert [tuple(item.get(key) for key in ("rank","activity_code","activity_label","lq","n","part_parc"))
                    for item in economy["activities"]] == expected_activities
            assert economy["story_key"] == "ce-que-la-commune-abrite"
            assert economy["salience_reason"] == "defaut"
            assert economy["provenance"]["source_id"] == "sirene_snapshot"
            unsupported = client.get(f"/api/territories/region/{unsupported_region[0]}/themes/economie/facts")
            assert unsupported.status_code == 200, unsupported.text
            assert unsupported.json()["readings"] == []
            assert unsupported.json()["reading_availability"] == "unsupported"
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous
        pool.close()


def test_registered_economy_readings_match_independent_canonical_artifact():
    """Compare the public payload to producer JSON, never to serving fact SQL."""
    schema = os.environ.get("LUSK_HOUSING_HTTP_SCHEMA")
    read_dsn = os.environ.get("LUSK_TEST_READ_DSN")
    canonical_dir = Path(os.environ.get("LUSK_TEST_CANONICAL_DATA_DIR", ""))
    if not schema or not read_dsn or not canonical_dir.is_dir():
        pytest.skip("invoked by guarded smoke-housing-economy-postgres.R")
    histories = json.loads((canonical_dir / "histoires_economie.json").read_text(encoding="utf-8"))
    vintages = json.loads((canonical_dir / "vintages.json").read_text(encoding="utf-8"))
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
            commune = conn.execute("SELECT territory_id,epci_id,department_id FROM territory_reference "
                                   "WHERE territory_type='commune' AND territory_id='35238'").fetchone()
            assert commune is not None
            focal = [("commune", "35238"), ("epci", commune[1]), ("departement", commune[2])]
            region_ids = [r[0] for r in conn.execute(
                "SELECT territory_id FROM territory_reference WHERE territory_type='region'").fetchall()]
            assert region_ids
            focal.extend(("region", territory_id) for territory_id in region_ids)
        # Each expected selected reading and every sparse slot comes from the
        # producer artifact, preserving its order; no serving SQL supplies an
        # expected value.
        selected = {(row["type"], str(row["territoire"])): row for row in histories
                    if row["theme"] == "economie"}
        with TestClient(main.app) as client:
            for level, territory_id in focal:
                producer_row = selected.get((level, str(territory_id)))
                response = client.get(f"/api/territories/{level}/{territory_id}/themes/economie/facts")
                assert response.status_code == 200, response.text
                payload = response.json()
                if producer_row is None:
                    # Unsupported is established by absence in the canonical
                    # selected-reading artifact, not a hard-coded territory.
                    assert payload["readings"] == []
                    assert payload["reading_availability"] == "unsupported"
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
                matching = [r for r in payload["readings"] if r["groupe"] == producer_row["groupe"]]
                assert len(matching) == 1
                actual = matching[0]
                assert (actual["story_key"], actual["salience_reason"]) == (
                    producer_row["story_key"], producer_row["salience_reason"])
                assert actual["status"] == ("measured" if expected_activities else "unavailable")
                assert actual["activities"] == expected_activities
                source_rows = [row for row in vintages if row["source"] == producer_row["vintage_source"]]
                assert len(source_rows) == 1
                source = source_rows[0]
                expected_reference_date = source["date_reference"]
                expected_publication_date = source["date_publication"]
                null_clock = os.environ.get("LUSK_ECONOMY_NULL_CLOCK")
                if null_clock == "reference":
                    expected_reference_date = None
                elif null_clock == "publication":
                    expected_publication_date = None
                assert actual["provenance"] == {
                    "source_id": source["id"], "source_name": source["source"],
                    "vintage_id": f"{source['version']}/{source['date_reference'] or 'NA'}",
                    "source_version": source["version"],
                    "source_reference_date": expected_reference_date,
                    "source_publication_date": expected_publication_date,
                }
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous
        pool.close()
