"""Canonical Habitat producer rows through registered PostgreSQL publication and HTTP."""
from __future__ import annotations

import json
import math
import os
from statistics import median
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

import pytest
from fastapi.testclient import TestClient

from api import main

pytestmark = pytest.mark.integration


def test_canonical_housing_profiles_are_served_at_each_declared_level():
    schema = os.environ.get("LUSK_HOUSING_HTTP_SCHEMA")
    manifest_path = os.environ.get("LUSK_HOUSING_HTTP_MANIFEST")
    read_dsn = os.environ.get("LUSK_TEST_READ_DSN")
    if not schema or not manifest_path or not read_dsn:
        pytest.skip("invoked by guarded smoke-housing-economy-postgres.R")
    pytest.importorskip("psycopg_pool")
    from psycopg_pool import ConnectionPool

    with open(manifest_path, encoding="utf-8") as manifest_file:
        expected_profiles = json.load(manifest_file)
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
            descriptor_count = conn.execute("SELECT count(*) FROM profile_descriptor").fetchone()[0]
            assert descriptor_count == 10
            marker = conn.execute("SELECT content_version FROM table_publication "
                                  "WHERE table_name='declared_profile'").fetchone()[0]
            scalar_marker = conn.execute("SELECT content_version FROM table_publication "
                                         "WHERE table_name='scalar_observation'").fetchone()[0]
            assert marker and scalar_marker
            for expected in expected_profiles:
                indicator = expected["indicator_id"]
                sql_count = conn.execute("SELECT count(*) FROM profile_observation WHERE indicator_id=%s",
                                         (indicator,)).fetchone()[0]
                assert sql_count > 0, indicator
                descriptor = conn.execute("SELECT allowed_levels,denominator_semantics,comparison_detail "
                                          "FROM profile_descriptor WHERE indicator_id=%s",
                                          (indicator,)).fetchone()
                assert descriptor[0] == ["commune", "epci", "departement", "region"]
                assert descriptor[1] == expected["denominator_semantics"]
                assert descriptor[2] == expected["comparison_detail"]

        with TestClient(main.app) as client:
            for expected in expected_profiles:
                indicator = expected["indicator_id"]
                for focal in expected["levels"]:
                    path = (f"/api/territories/{focal['territory_type']}/{focal['territory_id']}"
                            f"/indicators/{indicator}")
                    response = client.get(path)
                    assert response.status_code == 200, response.text
                    body = response.json()
                    assert body["indicator"] == indicator
                    assert body["unit"] == expected["unit"]
                    assert body["denominator_semantics"] == expected["denominator_semantics"]
                    assert body["content_version"] == marker
                    assert [axis["key"] for axis in body["axes"] if axis["name"] == "detail"] == [
                        cell["detail"] for cell in focal["cells"]]
                    assert [cell["detail"] for cell in body["cells"]] == [
                        cell["detail"] for cell in focal["cells"]]
                    for actual, canonical in zip(body["cells"], focal["cells"], strict=True):
                        if actual["value"] is None or canonical["value"] is None:
                            assert actual["value"] is canonical["value"]
                        else:
                            assert math.isclose(actual["value"], canonical["value"],
                                                rel_tol=1e-14, abs_tol=1e-14)
                        assert actual["status"] == canonical["status"]
                        assert actual["unit"] == canonical["unit"]
                        assert actual["denominator_semantics"] == expected["denominator_semantics"]
                        assert actual["sources"] == [{
                            "source_id": focal["source"]["source_id"],
                            "vintage_id": focal["source"]["vintage_id"],
                            "name": focal["source"]["name"],
                            "version": focal["source"]["version"],
                            "reference_date": focal["source"]["reference_date"],
                            "publication_date": focal["source"]["publication_date"],
                        }]
                    default = body["default_comparison"]["results"][0]
                    assert default["facet"] == {"detail": expected["comparison_detail"], "sex": None}
                    assert default["unit"] == "%"
                    with pool.connection() as conn:
                        if focal["territory_type"] == "region":
                            cohort_values = []
                        elif focal["territory_type"] == "commune":
                            cohort_values = [row[0] for row in conn.execute("""SELECT o.value
                                FROM profile_observation o JOIN territory_reference t USING(territory_id)
                                JOIN territory_reference f ON f.territory_id=%s
                                WHERE o.indicator_id=%s AND o.territory_type='commune'
                                  AND o.detail_key=%s AND o.sex_key='' AND o.status='measured'
                                  AND t.density_class_code=f.density_class_code""",
                                (focal["territory_id"],indicator,expected["comparison_detail"])).fetchall()]
                        else:
                            cohort_values = [row[0] for row in conn.execute("""SELECT value FROM profile_observation
                                WHERE indicator_id=%s AND territory_type=%s AND detail_key=%s AND sex_key=''
                                  AND status='measured'""",
                                (indicator,focal["territory_type"],expected["comparison_detail"])).fetchall()]
                    if len(cohort_values) >= 2:
                        assert math.isclose(default["median"], median(cohort_values), rel_tol=1e-14, abs_tol=1e-14)
                        assert default["eligible_count"] == len(cohort_values)
                    else:
                        assert default["status"] == "unavailable"
                        assert default["median"] is None

                    comparison_url = path + "/comparison"
                    empty = client.post(comparison_url, json={"selection": []})
                    assert empty.status_code == 200, empty.text
                    empty_result = empty.json()["result"]
                    assert empty_result["status"] == "unavailable"
                    assert empty_result["median"] is None
                    assert "focal_value" not in empty_result

                # A real selected comparison over source-backed focal facts
                # verifies median/facet semantics independently of the default cohort.
                with pool.connection() as conn:
                    selected = conn.execute("""SELECT territory_id,value FROM profile_observation
                        WHERE indicator_id=%s AND territory_type='commune' AND detail_key=%s
                          AND status='measured' ORDER BY territory_id LIMIT 3""",
                        (indicator, expected["comparison_detail"])).fetchall()
                assert len(selected) >= 2, (indicator, selected)
                focal_id = selected[0][0]
                chosen = selected[:2]
                result = client.post(
                    f"/api/territories/commune/{focal_id}/indicators/{indicator}/comparison",
                    json={"selection": [{"territory_type": "commune", "territory_id": row[0]}
                                         for row in chosen]})
                assert result.status_code == 200, result.text
                comparison = result.json()["result"]
                assert comparison["source_facet"] == {
                    "detail": expected["comparison_detail"], "sex": None}
                assert math.isclose(comparison["median"], median(row[1] for row in chosen),
                                    rel_tol=1e-14, abs_tol=1e-14)
                assert comparison["selected_member_count"] == 2
                assert "focal_value" not in comparison
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous
        pool.close()
