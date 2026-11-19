"""Synthetic guarded SQL-to-native-HTTP proof, not live publication parity (#1032).

Uses the existing mutex, exact test-only database/role guards and self-cleaning
schema fixture. No serving connection or canonical publication is performed.
"""
import json
from pathlib import Path

import pytest

from api.resource_catalogue import default_resource_catalogue
from api.tests.integration.test_publication_outcome_http import (
    outcome_db, integration_db_mutex, _client, _close, _item, _v2,
)

pytestmark = pytest.mark.integration

CHANGED = (
    "densite", "taille_menages", "effectifs_salaries", "chomage", "eco_activites",
    "prix_m2", "part_passoires", "surface_reseaux_routiers", "offre_tc",
    "bornes_recharge", "places_stationnement_velo_1000",
    "places_stationnement_voiture_1000", "stations_service",
    "stations_service_1000", "bornes_recharge_1000", "bornes_ev_par_station_service",
)
METADATA = Path(__file__).parents[3] / "pipeline/inst/extdata/theme-metadata"


@pytest.fixture(scope="module")
def regional_db(outcome_db):
    import psycopg
    catalogue = default_resource_catalogue.__wrapped__()
    with psycopg.connect(outcome_db["publish_dsn"]) as publisher:
        for index, key in enumerate(CHANGED):
            resource = catalogue.resources_by_id[key]
            metadata = json.loads((METADATA / f"theme_{resource.theme_id}.json").read_text(encoding="utf-8"))
            page = metadata["indicator_pages"][key]
            if key == "densite":
                publisher.execute("""UPDATE scalar_descriptor SET allowed_levels=%s,label=%s,unit=%s,
                    direction=%s,descriptor_version='regional-fixture-descriptor' WHERE indicator_id=%s""",
                    (metadata["scalar_contracts"][key]["allowed_levels"], page["label"],
                     page["unit"], page["direction"], key))
            else:
                publisher.execute("""INSERT INTO scalar_descriptor(indicator_id,theme_id,label,unit,direction,
                    comparison_facet,allowed_levels,denominator_semantics,completeness,descriptor_version)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'sparse','regional-fixture-descriptor')""",
                    (key, resource.theme_id, page["label"], page["unit"], page["direction"], key,
                     metadata["scalar_contracts"][key]["allowed_levels"], page["calculation"]))
            for source_id in resource.sources:
                publisher.execute("INSERT INTO source_dataset VALUES (%s,%s) ON CONFLICT DO NOTHING",
                                  (source_id, f"Synthetic {source_id}"))
                publisher.execute("""INSERT INTO source_vintage(source_id,vintage_id,version,
                    reference_date,publication_date) VALUES (%s,'regional-fixture','fixture-2026',
                    '2026-01-01','2026-01-02') ON CONFLICT DO NOTHING""", (source_id,))
                publisher.execute("INSERT INTO scalar_descriptor_source VALUES (%s,%s)", (key, source_id))
            # A measured zero is retained. Other fixture values are deliberately
            # distinct; none claims a real regional statistic.
            publisher.execute("""INSERT INTO scalar_observation(indicator_id,territory_id,territory_type,
                value,status) VALUES (%s,'53','region',%s,'measured')""", (key, index / 4))
            for source_id in resource.sources:
                publisher.execute("INSERT INTO scalar_observation_source VALUES (%s,'53',%s,%s)",
                                  (key, source_id, "regional-fixture"))
    return outcome_db


@pytest.mark.parametrize("key", CHANGED)
def test_every_new_regional_scalar_uses_native_query_or_honest_owned_publication_outcome(regional_db, monkeypatch, key):
    client, pool = _client(regional_db, monkeypatch)
    item = _item(key, key, target={"kind": "territory", "type": "region", "id": "53"})
    try:
        discovery = client.get("/api/resources").json()
        declared = next(row for row in discovery["resources"] if row["resource_id"] == key)
        response = client.post("/api/resources/read-batch", json=_v2([item]))
        assert response.status_code == 200, response.text
        assert "region" in declared["allowed_levels"]
        result = response.json()["results"][0]
        if key == "prix_m2":
            # Its owned annual series remains required, even with a scalar
            # facet in SQL. No successful scalar fallback or fake series.
            assert result["status"] == "publication_unavailable"
            assert result["family"] == "ordered_series"
            assert "data" not in result
            return
        assert result["status"] == "available"
        data = result["data"]
        assert data["value"] == CHANGED.index(key) / 4
        assert data["status"] == "measured"
        assert data["content_version"] == "oc-scalar-v1"
        assert data["reference_content_version"] == "oc-ref-v1"
        assert "default_comparison" not in data
        assert data["unit"] == declared["unit"]
        assert data["descriptor_version"] == "regional-fixture-descriptor"
        assert {row["source_id"] for row in data["sources"]} == set(declared["sources"])
        assert all(row["version"] == "fixture-2026" for row in data["sources"])
        assert all(str(row["reference_date"]).startswith("2026-01-01") for row in data["sources"])
        assert all(str(row["publication_date"]).startswith("2026-01-02") for row in data["sources"])
        single = client.post("/api/resources/read", json={k: v for k, v in item.items() if k != "id"})
        assert single.status_code == 200, single.text
        assert single.json() == data
    finally:
        _close(regional_db, pool)
