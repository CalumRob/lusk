"""HTTP contract check invoked by the guarded R publisher smoke while its schema is live."""
from __future__ import annotations

import os
from urllib.parse import parse_qs, urlsplit, urlunsplit, urlencode

import pytest

pytestmark = pytest.mark.integration


def test_mobility_profile_publisher_output_is_served_over_http():
    schema = os.environ.get("LUSK_PROFILE_HTTP_SCHEMA")
    read_dsn = os.environ.get("LUSK_TEST_READ_DSN")
    territory = os.environ.get("LUSK_PROFILE_HTTP_TERRITORY", "35238")
    if not schema or not read_dsn:
        pytest.skip("invoked by smoke-profile-postgres.R with its live private schema and read-only DSN")
    pytest.importorskip("psycopg_pool")
    from fastapi.testclient import TestClient
    from api import main

    parts = urlsplit(read_dsn)
    query = parse_qs(parts.query, keep_blank_values=True)
    query["options"] = [f"-csearch_path={schema}"]
    scoped_dsn = urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query, doseq=True), parts.fragment))
    from psycopg_pool import ConnectionPool

    pool = ConnectionPool(conninfo=scoped_dsn, min_size=1, max_size=1, open=True,
                          kwargs={"autocommit": True})
    previous = main.app.dependency_overrides.get(main.get_repository)
    main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
    try:
        with TestClient(main.app) as client:
            response = client.get(f"/api/territories/commune/{territory}/themes/mobilite/facts")
            assert response.status_code == 200, response.text
            body = response.json()
            profiles = {profile["indicator"]: profile for profile in body["profiles"]}
            expected_counts = {"voitures_menage": 3, "reseaux": 3,
                               "reseaux_par_habitant": 3, "offre_cyclable": 5}
            assert set(expected_counts).issubset(profiles)
            for indicator, count in expected_counts.items():
                profile = profiles[indicator]
                cells = profile["cells"]
                assert len(cells) == count
                assert all(cell["unit"] for cell in cells)
                assert all(cell["status"] in {"measured", "not_available", "suppressed", "unsupported"}
                           for cell in cells)
                assert all(cell["sources"] for cell in cells)
                assert profile["denominator_semantics"]
                assert all(cell["denominator_semantics"] == profile["denominator_semantics"] for cell in cells)
                if indicator == "offre_cyclable":
                    assert {cell["unit"] for cell in cells} == {"km", "km / 1 000 hab"}
                if indicator == "reseaux_par_habitant":
                    assert all({source["source_id"] for source in cell["sources"]} ==
                               {"osm_reseaux", "stationnement-velo"} for cell in cells)
            # Check that the HTTP representation is the same committed SQL snapshot.
            with pool.connection() as conn:
                sql_cells = conn.execute("""SELECT indicator_id,detail_key,sex_key,value,status
                    FROM profile_observation WHERE territory_id=%s AND territory_type='commune'
                      AND indicator_id=ANY(%s) ORDER BY indicator_id,detail_key""",
                    (territory, list(expected_counts))).fetchall()
                sql_marker = conn.execute("SELECT content_version FROM table_publication WHERE table_name='declared_profile'").fetchone()[0]
            assert body["profile_content_version"] == sql_marker
            http_cells = {(indicator, cell["detail"], cell["sex"] or ""): (cell["value"], cell["status"])
                          for indicator, profile in profiles.items() if indicator in expected_counts
                          for cell in profile["cells"]}
            assert http_cells == {(row[0], row[1], row[2] or ""): (row[3], row[4]) for row in sql_cells}
            assert client.get(f"/api/territories/commune/{territory}/profiles/distribution_dpe").status_code == 200
            assert client.get(f"/api/territories/commune/{territory}/profiles/structure_age").status_code == 200
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous
        pool.close()
