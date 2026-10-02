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
            # Real publisher cells must feed numeric facet comparisons, not
            # merely echo descriptor references. Each fixture territory has
            # deterministic index/10 measures, so the density-class median is
            # the same declared coordinate and tied rank evidence is stable.
            default_scope = body["default_comparison"]["scope"]
            assert default_scope["kind"] == "density_class"
            assert default_scope["member_count"] >= 2
            comparison_by_id = {row["indicator"]: row
                                for row in body["default_comparison"]["profile_comparisons"]}
            for indicator, detail in comparison_details.items():
                result = comparison_by_id[indicator]
                cell = next(cell for cell in profiles[indicator]["cells"] if cell["detail"] == detail)
                assert result["facet"] == {"detail": detail, "sex": None}
                assert result["unit"] == cell["unit"]
                assert result["denominator_semantics"] == profiles[indicator]["denominator_semantics"]
                assert result["median"] == cell["value"]
                assert result["eligible_count"] == default_scope["member_count"]
                assert result["comparison_sources"]
                assert result["rank_ties"] == default_scope["member_count"]

            comparison_url = f"/api/territories/commune/{territory}/themes/mobilite/comparison"
            whole_epci = client.post(comparison_url, json={"theme_id": "mobilite", "selection": [
                {"territory_type": "epci", "territory_id": "E_TEST"},
                {"territory_type": "commune", "territory_id": territory}]})
            assert whole_epci.status_code == 200, whole_epci.text
            mixed = whole_epci.json()
            assert mixed["scope"]["member_count"] == default_scope["member_count"]
            assert "facts" not in mixed and "profiles" not in mixed and "cells" not in mixed
            assert all("value" not in row and "cells" not in row for row in mixed["profile_comparisons"])
            assert all("focal_value" not in row for row in mixed["results"])
            assert all("focal_value" not in row for row in mixed["profile_comparisons"])
            mixed_by_id = {row["indicator"]: row for row in mixed["profile_comparisons"]}
            assert {row["median"] for row in mixed_by_id.values()} == {
                profiles[indicator]["cells"][next(i for i, c in enumerate(profiles[indicator]["cells"])
                    if c["detail"] == comparison_details[indicator])]["value"]
                for indicator in comparison_details}

            empty = client.post(comparison_url, json={"theme_id": "mobilite", "selection": []})
            assert empty.status_code == 200, empty.text
            assert empty.json()["scope"]["member_count"] == 0
            assert all(row["status"] == "unavailable" and row["median"] is None
                       for row in empty.json()["profile_comparisons"])
            singleton = client.post(comparison_url, json={"theme_id": "mobilite", "selection": [
                {"territory_type": "commune", "territory_id": territory}]})
            assert singleton.status_code == 200, singleton.text
            assert all(row["status"] == "unavailable" and row["eligible_count"] == 1
                       for row in singleton.json()["profile_comparisons"])
            with pool.connection() as conn:
                outside_id = conn.execute("""SELECT territory_id FROM territory_reference
                    WHERE territory_type='commune' AND density_class_code='D_TEST' AND territory_id<>%s
                    ORDER BY territory_id LIMIT 1""", (territory,)).fetchone()[0]
            outside = client.post(comparison_url, json={"theme_id": "mobilite", "selection": [
                {"territory_type": "commune", "territory_id": outside_id}]})
            assert outside.status_code == 200, outside.text
            assert all(row["focal_in_selection"] is False and row["rank"] is None
                       for row in outside.json()["profile_comparisons"])
            assert outside.json()["scope"]["member_count"] == 1
            for indicator, detail in comparison_details.items():
                named = client.post(
                    f"/api/territories/commune/{territory}/indicators/{indicator}/comparison")
                assert named.status_code == 200, named.text
                result = named.json()["result"]
                focal_cell = next(cell for cell in profiles[indicator]["cells"] if cell["detail"] == detail)
                assert named.json()["indicator_id"] == indicator
                assert result["source_facet"] == {"detail": detail, "sex": None}
                assert result["unit"] == focal_cell["unit"]
                assert result["denominator_semantics"] == profiles[indicator]["denominator_semantics"]
                assert result["median"] == focal_cell["value"]
                assert named.json()["profile_content_version"] == sql_marker
                assert "focal_value" not in result
                assert "profile_comparisons" not in named.json() and "cells" not in result
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
            habitat = client.get(f"/api/territories/commune/{territory}/themes/habitat/facts")
            assert habitat.status_code == 200, habitat.text
            named_scalar_comparison = client.post(
                f"/api/territories/commune/{territory}/indicators/part_passoires/comparison")
            assert named_scalar_comparison.status_code == 200, named_scalar_comparison.text
            named_scalar_result = named_scalar_comparison.json()["result"]
            assert named_scalar_result["indicator_id"] == "part_passoires"
            assert named_scalar_result["source_facet"] == "part_passoires"
            assert named_scalar_result["median"] == .5
            assert named_scalar_result["unit"] == "%"
            assert named_scalar_result["rank"] == 1
            assert "focal_value" not in named_scalar_result
            assert {source["source_id"] for source in named_scalar_result["comparison_sources"]} == {"dpe_22"}
            assert "results" not in named_scalar_comparison.json()
            assert "profiles" not in named_scalar_comparison.json() and "facts" not in named_scalar_comparison.json()
            named_scalar_empty = client.post(
                f"/api/territories/commune/{territory}/indicators/part_passoires/comparison",
                json={"selection": []})
            assert named_scalar_empty.status_code == 200, named_scalar_empty.text
            assert named_scalar_empty.json()["scope"]["member_count"] == 0
            assert named_scalar_empty.json()["result"]["median"] is None
            assert named_scalar_empty.json()["result"]["status"] == "unavailable"
            outside_scalar = client.post(
                f"/api/territories/commune/{territory}/indicators/part_passoires/comparison",
                json={"selection": [{"territory_type": "commune", "territory_id": outside_id}]})
            assert outside_scalar.status_code == 200, outside_scalar.text
            assert outside_scalar.json()["result"]["focal_in_selection"] is False
            assert outside_scalar.json()["result"]["rank"] is None

            named_detail = client.post(
                f"/api/territories/commune/{territory}/indicators/offre_cyclable/comparison",
                json={"selection": [{"territory_type": "epci", "territory_id": "E_TEST"},
                                    {"territory_type": "commune", "territory_id": territory}]})
            assert named_detail.status_code == 200, named_detail.text
            detail_result = named_detail.json()["result"]
            assert named_detail.json()["indicator_id"] == "offre_cyclable"
            assert named_detail.json()["shape"] == "profile"
            assert detail_result["source_facet"] == {"detail": "total_longueur", "sex": None}
            assert detail_result["unit"] == "km"
            assert detail_result["denominator_semantics"] == profiles["offre_cyclable"]["denominator_semantics"]
            assert detail_result["median"] == .5
            assert {source["source_id"] for source in detail_result["comparison_sources"]} == {"osm_reseaux"}
            assert "cells" not in detail_result and "profiles" not in named_detail.json()
            assert "focal_value" not in detail_result

            named_dpe = client.post(
                f"/api/territories/commune/{territory}/indicators/distribution_dpe/comparison")
            assert named_dpe.status_code == 200, named_dpe.text
            dpe_result = named_dpe.json()["result"]
            assert named_dpe.json()["indicator_id"] == "distribution_dpe"
            assert dpe_result["source_facet"] == "part_passoires"
            assert dpe_result["source_facet_indicator_id"] == "part_passoires"
            assert dpe_result["source_facet_label"] == "Passoires"
            assert dpe_result["median"] == .5
            assert dpe_result["required_scalar_version"] == "dpe-scalar-fixture-v1"
            assert named_dpe.json()["scalar_content_version"] == "dpe-scalar-fixture-v1"
            assert {source["source_id"] for source in dpe_result["comparison_sources"]} == {"dpe_22"}
            assert "results" not in named_dpe.json() and "cells" not in dpe_result
            assert "focal_value" not in dpe_result
            named_dpe_outside = client.post(
                f"/api/territories/commune/{territory}/indicators/distribution_dpe/comparison",
                json={"selection": [{"territory_type": "commune", "territory_id": outside_id}]})
            assert named_dpe_outside.status_code == 200, named_dpe_outside.text
            assert named_dpe_outside.json()["result"]["focal_in_selection"] is False
            assert named_dpe_outside.json()["result"]["rank"] is None
            assert client.post(
                f"/api/territories/commune/{territory}/indicators/no_such_indicator/comparison").status_code == 404
            assert client.post(
                f"/api/territories/epci/{territory}/indicators/offre_cyclable/comparison").status_code == 422
            dpe_facet = next(row for row in habitat.json()["default_comparison"]["profile_comparisons"]
                             if row["indicator"] == "distribution_dpe")
            assert dpe_facet["facet"] == "part_passoires"
            assert dpe_facet["unit"] == "%"
            assert dpe_facet["median"] == .5
            assert dpe_facet["eligible_count"] == default_scope["member_count"]
            assert {source["source_id"] for source in dpe_facet["comparison_sources"]} == {"dpe_22"}
            assert dpe_facet["required_scalar_version"] == "dpe-scalar-fixture-v1"
            dpe_only_comparison = client.post(
                f"/api/territories/commune/{territory}/themes/habitat/comparison",
                json={"theme_id": "habitat", "selection": []})
            assert dpe_only_comparison.status_code == 200, dpe_only_comparison.text
            assert all("focal_value" not in row for row in dpe_only_comparison.json()["results"])
            assert all("focal_value" not in row for row in dpe_only_comparison.json()["profile_comparisons"])
            dpe_empty = next(row for row in dpe_only_comparison.json()["profile_comparisons"]
                             if row["indicator"] == "distribution_dpe")
            assert dpe_empty["status"] == "unavailable" and dpe_empty["median"] is None
            assert dpe_empty["comparison_sources"] == []
            habitat_comparison = client.post(
                f"/api/territories/commune/{territory}/themes/habitat/comparison",
                json={"theme_id": "habitat"})
            assert habitat_comparison.status_code == 200, habitat_comparison.text
            habitat_comparison_body = habitat_comparison.json()
            assert habitat_comparison_body["results"][0]["median"] == .5
            assert habitat_comparison_body["profile_comparisons"][0]["median"] == .5
            assert all("focal_value" not in row for row in habitat_comparison_body["results"])
            assert all("focal_value" not in row for row in habitat_comparison_body["profile_comparisons"])
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous
        pool.close()
