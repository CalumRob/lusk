"""Canonical selected demographic reading through its public HTTP contract."""
from __future__ import annotations

import json
import os
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

import pytest
from fastapi.testclient import TestClient

from api import main

pytestmark = pytest.mark.integration


def test_canonical_demographic_reading_is_readable_over_http():
    schema = os.environ.get("LUSK_READING_HTTP_SCHEMA")
    read_dsn = os.environ.get("LUSK_TEST_READ_DSN")
    canonical = Path(os.environ.get("LUSK_TEST_CANONICAL_DATA_DIR", ""))
    if not schema or not read_dsn or not canonical.is_dir():
        pytest.skip("invoked by smoke-demographic-reading-postgres.R with guarded schema")
    expected = json.loads((canonical / "histoires_demographie.json").read_text(encoding="utf-8"))
    read_ids = {("commune", "35238"), ("epci", "200068120")}
    selected = {}
    for row in expected:
        key = (row["type"], row["territoire"])
        if row["theme"] == "demographie" and key in read_ids:
            selected[key] = row
    assert set(selected) == read_ids

    parts = urlsplit(read_dsn)
    query = parse_qs(parts.query, keep_blank_values=True)
    query["options"] = [f"-csearch_path={schema}"]
    scoped_dsn = urlunsplit((parts.scheme, parts.netloc, parts.path,
                             urlencode(query, doseq=True), parts.fragment))
    from psycopg_pool import ConnectionPool
    pool = ConnectionPool(conninfo=scoped_dsn, min_size=1, max_size=1, open=True,
                          kwargs={"autocommit": True})
    prior = main.app.dependency_overrides.get(main.get_repository)
    main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
    try:
        with pool.connection() as conn:
            assert conn.execute("SELECT current_database(),current_user").fetchone() == (
                os.environ["LUSK_TEST_DATABASE_NAME"], os.environ["LUSK_TEST_READ_USER"])
            publication = conn.execute("SELECT content_version,row_count FROM table_publication "
                                       "WHERE table_name='demographic_typed_reading'").fetchone()
            assert publication and publication[1] == 1268
        with TestClient(main.app) as client:
            for (level, territory), old in selected.items():
                response = client.get(f"/api/territories/{level}/{territory}/themes/demographie/facts")
                assert response.status_code == 200, response.text
                body = response.json()
                reading = next(item for item in body["readings"] if item["groupe"] == old["groupe"])
                for field in ("groupe", "story_key", "salience_reason", "periode", "solde_naturel",
                              "solde_migratoire", "taux_solde_naturel", "taux_solde_migratoire",
                              "classification"):
                    assert reading[field] == old[field], (level, territory, field)
                assert body["complete_theme"] is False
                assert reading["rate_unit"] == "‰/an"
                assert reading["provenance"]["source_id"] == "serie_historique"
                assert reading["provenance"]["source_version"] == "2023"
                assert reading["provenance"]["source_reference_date"] == "2023-01-01"
                assert reading["status"] == "measured"

            with pool.connection() as conn:
                density, epci = conn.execute("SELECT density_class_code,epci_id FROM territory_reference "
                    "WHERE territory_id='35238' AND territory_type='commune'").fetchone()
                density_members = conn.execute("SELECT territory_id,name FROM territory_reference "
                    "WHERE territory_type='commune' AND density_class_code=%s ORDER BY name,territory_id",
                    (density,)).fetchall()
                epci_members = conn.execute("SELECT territory_id,name FROM territory_reference "
                    "WHERE territory_type='commune' AND epci_id=%s ORDER BY name,territory_id",(epci,)).fetchall()
            expected_by_id = {row["territoire"]:row for row in expected
                              if row["theme"]=="demographie" and row["type"]=="commune"}
            default = client.post("/api/territories/commune/35238/themes/demographie/comparison",
                                  json={"theme_id":"demographie"})
            assert default.status_code == 200, default.text
            default_cloud = default.json()["reading_cloud"]
            assert default_cloud["status"] == "available"
            assert default_cloud["scope"]["kind"] == "density_class"
            assert [point["territory"]["territory_id"] for point in default_cloud["points"]] == [
                row[0] for row in density_members]
            for point in default_cloud["points"]:
                old = expected_by_id[point["territory"]["territory_id"]]
                assert point["territory"]["name"] == next(name for code,name in density_members if code==old["territoire"])
                assert point["periode"] == old["periode"]
                assert point["taux_solde_naturel"] == old["taux_solde_naturel"]
                assert point["taux_solde_migratoire"] == old["taux_solde_migratoire"]
                assert set(point) == {"territory","periode","taux_solde_naturel","taux_solde_migratoire"}
            assert default_cloud["rate_unit"] == "‰/an"
            assert default_cloud["source"]["version"] == "2023"

            empty = client.post("/api/territories/commune/35238/themes/demographie/comparison",
                json={"theme_id":"demographie","selection":[]})
            assert empty.status_code == 200, empty.text
            assert empty.json()["reading_cloud"]["status"] == "unavailable"
            assert empty.json()["reading_cloud"]["points"] == []
            singleton = client.post("/api/territories/commune/35238/themes/demographie/comparison",
                json={"theme_id":"demographie","selection":[{"territory_type":"commune","territory_id":"35238"}]})
            assert singleton.status_code == 200, singleton.text
            singleton_cloud = singleton.json()["reading_cloud"]
            assert len(singleton_cloud["points"]) == 1
            assert singleton_cloud["points"][0]["territory"]["territory_id"] == "35238"

            mixed = client.post("/api/territories/commune/35238/themes/demographie/comparison",
                json={"theme_id":"demographie","selection":[
                    {"territory_type":"epci","territory_id":epci},
                    {"territory_type":"commune","territory_id":"35238"}]})
            assert mixed.status_code == 200, mixed.text
            mixed_body = mixed.json()
            mixed_cloud = mixed_body["reading_cloud"]
            assert len(mixed_cloud["points"]) == len(set(code for code,_ in epci_members))
            assert {point["territory"]["territory_id"] for point in mixed_cloud["points"]} == {
                code for code,_ in epci_members}
            assert "focal_value" not in mixed_body
            assert all("focal_value" not in result for result in mixed_body["results"])
    finally:
        if prior is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = prior
        pool.close()
