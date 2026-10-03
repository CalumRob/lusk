"""Canonical eco_activites shared-scalar publisher through the public HTTP route."""
from __future__ import annotations

import os
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
            assert conn.execute("SELECT count(*) FROM scalar_descriptor").fetchone()[0] == 44
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
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous
        pool.close()
