"""Canonical focal Mobilite distributions as read through the theme HTTP route."""
from __future__ import annotations

import json
import os
import re

import pytest
from fastapi.testclient import TestClient

from api import main

pytestmark = pytest.mark.integration


def test_canonical_mobility_density_distribution_focals_over_http():
    schema = os.environ["LUSK_DENSITY_CANONICAL_SCHEMA"]
    expected_path = os.environ["LUSK_DENSITY_CANONICAL_EXPECTED"]
    assert re.fullmatch(r"distribution_canonical_[a-z0-9_]+", schema)
    expected = json.loads(open(expected_path, encoding="utf-8").read())
    from psycopg_pool import ConnectionPool

    pool = ConnectionPool(conninfo=os.environ["LUSK_TEST_READ_DSN"], min_size=1, max_size=1,
                          open=True, kwargs={"autocommit": True})
    prior = main.app.dependency_overrides.get(main.get_repository)
    main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
    try:
        with pool.connection() as conn:
            assert conn.execute("SELECT current_database(),current_user").fetchone() == (
                os.environ["LUSK_TEST_DATABASE_NAME"], os.environ["LUSK_TEST_READ_USER"])
            conn.execute(f'SET search_path TO "{schema}"')
            assert conn.execute("SELECT count(*) FROM territory_reference").fetchone()[0] == 1268
            assert conn.execute("SELECT row_count FROM table_publication WHERE table_name='mobility_density_distribution'").fetchone()[0] == 1266
            assert conn.execute("SELECT count(*) FROM mobility_density_distribution_point").fetchone()[0] == 12660
            assert conn.execute("SELECT row_count FROM table_publication WHERE table_name='mobility_typed_reading'").fetchone()[0] == 1266
        with TestClient(main.app) as client:
            for identity, source in expected.items():
                territory_type, territory_id = identity.split(":", 1)
                response = client.get(f"/api/territories/{territory_type}/{territory_id}/themes/mobilite/facts")
                assert response.status_code == 200, f"{identity}: {response.text}"
                distribution = response.json()["density_distribution"]
                assert distribution["range"] == source["range"]
                assert [point["ordinal"] for point in distribution["points"]] == list(range(10))
                assert [point["density"] for point in distribution["points"]] == pytest.approx(source["density"])
                assert [point["decile"] for point in distribution["points"]] == source["decile"]
                assert [point["density_status"] for point in distribution["points"]] == source["density_status"]
                assert [point["decile_status"] for point in distribution["points"]] == source["decile_status"]
                assert distribution["units"] == source["units"]
                assert distribution["provenance"] == source["provenance"]
                assert distribution["allowed_levels"] == ["commune", "epci", "departement", "region"]
    finally:
        if prior is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = prior
        pool.close()
