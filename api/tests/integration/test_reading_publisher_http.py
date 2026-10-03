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
    finally:
        if prior is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = prior
        pool.close()
