"""Focal Mobilité density distribution published by R and exposed over HTTP."""
from __future__ import annotations

import os
import re

import pytest
from fastapi.testclient import TestClient

from api import main

pytestmark = pytest.mark.integration


def test_registered_mobility_density_distribution_is_readable_over_http():
    schema = os.environ.get("LUSK_DENSITY_TEST_SCHEMA")
    read_dsn = os.environ.get("LUSK_TEST_READ_DSN")
    if not schema or not read_dsn:
        pytest.skip("invoked by the guarded Mobility distribution PostgreSQL smoke script")
    assert re.fullmatch(r"distribution_it_[a-z0-9_]+", schema)
    from psycopg_pool import ConnectionPool
    pool = ConnectionPool(conninfo=read_dsn, min_size=1, max_size=1, open=True,
                          kwargs={"autocommit": True,"options":f"-csearch_path={schema}"})
    prior = main.app.dependency_overrides.get(main.get_repository)
    main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
    try:
        with pool.connection() as conn:
            assert conn.execute("SELECT current_database(),current_user").fetchone() == (
                os.environ["LUSK_TEST_DATABASE_NAME"], os.environ["LUSK_TEST_READ_USER"])
            conn.execute(f'SET search_path TO "{schema}"')
            state=conn.execute("SELECT current_schema(),current_setting('search_path'),has_schema_privilege(current_user,%s,'USAGE'),"
                               "EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=%s)",(schema,schema)).fetchone()
            assert state == (schema,schema,True,True), state
            marker = conn.execute("SELECT content_version,row_count,reference_content_version FROM table_publication "
                                  "WHERE table_name='mobility_density_distribution'").fetchone()
            assert marker and marker[1] == 3
            assert conn.execute("SELECT count(*) FROM mobility_typed_reading WHERE territory_id='35238'").fetchone()[0] == 1
        with TestClient(main.app) as client:
            response = client.get("/api/territories/commune/35238/themes/mobilite/facts")
            assert response.status_code == 200, response.text
            body = response.json()
            distribution = body["density_distribution"]
            assert distribution["range"] == {"minimum": 1.0, "maximum": 52.0, "status": "measured"}
            expected_deciles = [1, 4, 8, 12, 18, None, None, 33, 42, 52]
            assert [point["density"] for point in distribution["points"]] == pytest.approx(
                [i / 100 for i in range(1, 11)])
            assert [point["decile"] for point in distribution["points"]] == expected_deciles
            assert [point["density_status"] for point in distribution["points"]] == ["measured"] * 10
            assert [point["decile_status"] for point in distribution["points"]] == [
                "not_available" if value is None else "measured" for value in expected_deciles]
            assert [point["ordinal"] for point in distribution["points"]] == list(range(10))
            assert distribution["units"] == {"density": "1 / type de service perdu",
                                             "decile": "type de service perdu"}
            assert distribution["provenance"]["source_id"] == "mobilite_snapshot"
            assert distribution["provenance"]["source_version"] == "2026-02"
            assert "nuage" not in distribution
    finally:
        if prior is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = prior
        pool.close()
