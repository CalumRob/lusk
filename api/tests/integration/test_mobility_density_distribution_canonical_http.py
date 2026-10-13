"""Canonical focal Mobilite distributions as read through the theme HTTP route."""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from urllib.parse import urlsplit

import pytest
from fastapi.testclient import TestClient

from api import main

pytestmark = pytest.mark.integration


def _canonical_smoke_configuration():
    schema = os.environ.get("LUSK_DENSITY_CANONICAL_SCHEMA")
    expected_path = os.environ.get("LUSK_DENSITY_CANONICAL_EXPECTED")
    if not schema and not expected_path:
        pytest.skip("invoked by the guarded canonical Mobility distribution smoke script")
    if not schema or not expected_path:
        pytest.fail("canonical Mobility smoke requires both schema and expected-output variables")

    required = ("LUSK_TEST_READ_DSN", "LUSK_TEST_DATABASE_NAME",
                "LUSK_TEST_DATABASE_PREFIX", "LUSK_TEST_READ_USER")
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        pytest.fail("canonical Mobility smoke is missing test database configuration: " +
                    ", ".join(missing))

    database_name = os.environ["LUSK_TEST_DATABASE_NAME"]
    if (os.environ["LUSK_TEST_DATABASE_PREFIX"] != "lusk_it_" or
            not database_name.startswith("lusk_it_") or
            database_name.casefold() in {"lusk", "postgres", "template0", "template1"}):
        pytest.fail("canonical Mobility smoke requires an explicitly named lusk_it_ database")
    reader = urlsplit(os.environ["LUSK_TEST_READ_DSN"])
    read_user = os.environ["LUSK_TEST_READ_USER"]
    allowed_hosts = {"localhost", "127.0.0.1", "::1", "192.168.1.120"}
    if (reader.scheme not in {"postgres", "postgresql"} or
            reader.path.lstrip("/") != database_name or
            reader.hostname not in allowed_hosts or not reader.port or
            reader.username != read_user):
        pytest.fail("canonical Mobility smoke read DSN must target the named lusk_it_ database and reader role")
    if reader.hostname == "192.168.1.120" and (
            database_name != "lusk_it_contract" or reader.port != 5432 or
            read_user != "lusk_it_contract_read"):
        pytest.fail("the shared integration server requires its dedicated lusk_it_contract reader")
    if not re.fullmatch(r"distribution_canonical_[a-z0-9_]+", schema):
        pytest.fail("canonical Mobility smoke schema has an invalid name")
    if not Path(expected_path).is_file():
        pytest.fail("canonical Mobility smoke expected-output file is unavailable")
    return schema, expected_path, database_name, read_user, os.environ["LUSK_TEST_READ_DSN"]


def test_canonical_mobility_density_distribution_focals_over_http():
    schema, expected_path, database_name, read_user, read_dsn = _canonical_smoke_configuration()
    expected = json.loads(Path(expected_path).read_text(encoding="utf-8"))
    from psycopg_pool import ConnectionPool

    pool = ConnectionPool(conninfo=read_dsn, min_size=1, max_size=1,
                          open=True, kwargs={"autocommit": True})
    prior = main.app.dependency_overrides.get(main.get_repository)
    main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
    try:
        with pool.connection() as conn:
            assert conn.execute("SELECT current_database(),current_user").fetchone() == (
                database_name, read_user)
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
