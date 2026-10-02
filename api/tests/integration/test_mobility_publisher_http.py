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
            expected_details = {
                "voitures_menage": ["sans_voiture", "une_voiture", "deux_plus"],
                "reseaux": ["t_longueur", "b_longueur", "c_longueur"],
                "reseaux_par_habitant": ["t_km_1000", "b_km_1000", "c_km_1000"],
                "offre_cyclable": ["protege_longueur", "protege_km_1000", "partage_longueur",
                                   "partage_km_1000", "total_longueur"],
            }
            expected_sources = {
                "voitures_menage": {"rp_logement_princ"},
                "reseaux": {"amenagements_cyclables"},
                "reseaux_par_habitant": {"osm_reseaux", "stationnement-velo"},
                "offre_cyclable": {"osm_reseaux"},
            }
            expected_vintages = {
                "rp_logement_princ": ("2023", "2023-01-01", "2026-06-30"),
                "amenagements_cyclables": ("2026-08", "2026-08-07", "2026-08-07"),
                "osm_reseaux": ("2026-08", "2026-08-05", "2026-08-06"),
                "stationnement-velo": ("2022-2025", "2025-01-01", "2026-02-03"),
            }
            expected_units = {
                "voitures_menage": ["%", "%", "%"],
                "reseaux": ["km", "km", "km"],
                "reseaux_par_habitant": ["km / 1 000 hab."] * 3,
                "offre_cyclable": ["km", "km / 1 000 hab", "km", "km / 1 000 hab", "km"],
            }
            expected_profile_units = {
                "voitures_menage": "%", "reseaux": "km",
                "reseaux_par_habitant": "km / 1 000 hab.", "offre_cyclable": "km",
            }
            comparison_details = {
                "voitures_menage": "sans_voiture", "reseaux": "b_longueur",
                "reseaux_par_habitant": "b_km_1000", "offre_cyclable": "total_longueur",
            }
            assert set(expected_counts).issubset(profiles)
            for indicator, count in expected_counts.items():
                profile = profiles[indicator]
                cells = profile["cells"]
                assert len(cells) == count
                assert [cell["detail"] for cell in cells] == expected_details[indicator]
                assert [cell["value"] for cell in cells] == [index / 10 for index in range(1, count + 1)]
                assert [cell["unit"] for cell in cells] == expected_units[indicator]
                assert all(cell["status"] == "measured" for cell in cells)
                assert all({source["source_id"] for source in cell["sources"]} == expected_sources[indicator]
                           for cell in cells)
                assert all({source["source_id"]: (source["version"], source["reference_date"], source["publication_date"])
                            for source in cell["sources"]} ==
                           {source_id: expected_vintages[source_id] for source_id in expected_sources[indicator]}
                           for cell in cells)
                assert profile["unit"] == expected_profile_units[indicator]
                assert profile["denominator_semantics"] == cells[0]["denominator_semantics"]
                assert all(cell["denominator_semantics"] == profile["denominator_semantics"] for cell in cells)
                point = profile["comparison_point"]
                assert point["detail"] == comparison_details[indicator]
                assert point["unit"] == next(cell["unit"] for cell in cells if cell["detail"] == point["detail"])
            # Check that the HTTP representation is the same committed SQL snapshot.
            with pool.connection() as conn:
                sql_cells = conn.execute("""SELECT o.indicator_id,o.detail_key,o.sex_key,o.value,o.status,
                    a.unit,d.denominator_semantics
                    FROM profile_observation o JOIN profile_axis a ON a.indicator_id=o.indicator_id
                      AND a.axis_name='detail' AND a.axis_key=o.detail_key
                    JOIN profile_descriptor d ON d.indicator_id=o.indicator_id
                    WHERE o.territory_id=%s AND o.territory_type='commune'
                      AND o.indicator_id=ANY(%s) ORDER BY o.indicator_id,o.detail_key""",
                    (territory, list(expected_counts))).fetchall()
                sql_source_ids = conn.execute("""SELECT indicator_id,detail_key,array_agg(source_id ORDER BY source_id)
                    FROM profile_observation_source WHERE territory_id=%s AND indicator_id=ANY(%s)
                    GROUP BY indicator_id,detail_key""", (territory, list(expected_counts))).fetchall()
                sql_marker = conn.execute("SELECT content_version FROM table_publication WHERE table_name='declared_profile'").fetchone()[0]
            assert body["profile_content_version"] == sql_marker
            http_cells = {(indicator, cell["detail"], cell["sex"] or ""): (cell["value"], cell["status"])
                          for indicator, profile in profiles.items() if indicator in expected_counts
                          for cell in profile["cells"]}
            assert http_cells == {(row[0], row[1], row[2] or ""): (row[3], row[4]) for row in sql_cells}
            sql_units_and_denominators = {(row[0], row[1]): (row[5], row[6]) for row in sql_cells}
            for indicator, profile in profiles.items():
                if indicator not in expected_counts:
                    continue
                for cell in profile["cells"]:
                    assert (cell["unit"], cell["denominator_semantics"]) == sql_units_and_denominators[(indicator, cell["detail"])]
            sql_sources = {(row[0], row[1]): set(row[2]) for row in sql_source_ids}
            for indicator, profile in profiles.items():
                if indicator not in expected_counts:
                    continue
                for cell in profile["cells"]:
                    assert {source["source_id"] for source in cell["sources"]} == sql_sources[(indicator, cell["detail"])]
            assert client.get(f"/api/territories/commune/{territory}/profiles/distribution_dpe").status_code == 200
            assert client.get(f"/api/territories/commune/{territory}/profiles/structure_age").status_code == 200
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous
        pool.close()
