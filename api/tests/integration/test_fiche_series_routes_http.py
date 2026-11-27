"""Canonical owned facts remain reachable independently at fiche levels."""
import os
import subprocess
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

import pytest
from producer_artifacts import read_owned_series_artifact, records

pytestmark = pytest.mark.integration


def test_canonical_owned_series_have_independent_fiche_routes():
    required = ("LUSK_TEST_PUBLISH_DSN", "LUSK_TEST_READ_DSN", "LUSK_TEST_DATABASE_NAME", "LUSK_TEST_CANONICAL_DATA_DIR")
    if not all(os.getenv(key) for key in required):
        pytest.skip("requires guarded disposable PostgreSQL and canonical artifacts")
    assert os.environ["LUSK_TEST_DATABASE_PREFIX"] == "lusk_it_"
    assert os.environ["LUSK_TEST_DATABASE_NAME"].startswith("lusk_it_")
    import psycopg
    from psycopg import sql
    from fastapi.testclient import TestClient
    from api.main import ReadRepository, app, get_repository, pool

    root = Path(__file__).resolve().parents[3]
    canonical = Path(os.environ["LUSK_TEST_CANONICAL_DATA_DIR"])
    habitat = read_owned_series_artifact(canonical, "prix_m2")
    habitat_points = records(habitat["points"])
    annual_series = read_owned_series_artifact(canonical, "conso_enaf_annuel")
    state_series = read_owned_series_artifact(canonical, "artif_par_habitant")
    milieux_points = {
        "conso_enaf_annuel": records(annual_series["points"]),
        "artif_par_habitant": records(state_series["points"]),
    }
    milieux_series = {
        "conso_enaf_annuel": annual_series,
        "artif_par_habitant": state_series,
    }

    def linked_provenance(projection):
        revisions = {row["provenance_revision_id"]: row for row in records(projection["provenance"])}
        result = {}
        for link in records(projection["point_provenance"]):
            key = (link["indicator_id"], link["territory_id"], link["axis_value"])
            result.setdefault(key, []).append(revisions[link["provenance_revision_id"]])
        return result

    habitat_lineage = linked_provenance(habitat)
    milieux_lineage = {indicator: linked_provenance(projection)
                       for indicator, projection in milieux_series.items()}
    schema = "it_" + uuid.uuid4().hex[:20]

    def scoped(dsn):
        url = urlsplit(dsn)
        query = parse_qs(url.query)
        query["options"] = [f"-csearch_path={schema}"]
        return urlunsplit((url.scheme, url.netloc, url.path, urlencode(query, doseq=True), url.fragment))

    class Connections:
        def connection(self):
            return psycopg.connect(scoped(os.environ["LUSK_TEST_READ_DSN"]))

    with psycopg.connect(os.environ["LUSK_TEST_PUBLISH_DSN"], autocommit=True) as pub:
        assert pub.execute("SELECT current_database(),current_user").fetchone() == (
            os.environ["LUSK_TEST_DATABASE_NAME"], urlsplit(os.environ["LUSK_TEST_PUBLISH_DSN"]).username)
        with psycopg.connect(os.environ["LUSK_TEST_READ_DSN"]) as read:
            assert read.execute("SELECT current_database(),current_user").fetchone() == (
                os.environ["LUSK_TEST_DATABASE_NAME"], urlsplit(os.environ["LUSK_TEST_READ_DSN"]).username)
        pub.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
        try:
            pub.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(schema)))
            pub.execute((root / "api/schema.sql").read_text(encoding="utf-8"))
            completed = subprocess.run(["Rscript", "scripts/smoke-fiche-series-postgres.R", schema],
                cwd=root / "pipeline", env=os.environ.copy(), capture_output=True, text=True,
                encoding="utf-8", errors="replace", timeout=900)
            assert completed.returncode == 0, completed.stdout + completed.stderr
            role = urlsplit(os.environ["LUSK_TEST_READ_DSN"]).username
            pub.execute(sql.SQL("GRANT USAGE ON SCHEMA {} TO {}").format(sql.Identifier(schema), sql.Identifier(role)))
            pub.execute(sql.SQL("GRANT SELECT ON ALL TABLES IN SCHEMA {} TO {}").format(sql.Identifier(schema), sql.Identifier(role)))
            app.dependency_overrides[get_repository] = lambda: ReadRepository(Connections())
            pool.cache_clear()
            with TestClient(app) as client:
                response = client.get("/api/territories/commune/35238/indicators/prix_m2")
                assert response.status_code == 200, response.text
                assert response.json()["theme_id"] == "habitat"
                annuals = habitat_points
                for level in ("commune","epci","departement","region"):
                    focal_id = "35238" if level=="commune" else next(row["territory_id"] for row in annuals if row["territory_type"]==level)
                    focal = [row for row in annuals if row["territory_id"]==focal_id]
                    response = client.get(f"/api/territories/{level}/{focal_id}/indicators/prix_m2")
                    assert response.status_code == 200, response.text
                    assert {point["axis"] for point in response.json()["points"]} == {row["axis_value"] for row in focal}
                    for row in focal:
                        point = next(point for point in response.json()["points"] if point["axis"] == row["axis_value"])
                        if row["value"] is None:
                            assert point["value"] is None
                        else:
                            assert point["value"] == pytest.approx(row["value"],rel=0,abs=1e-6)
                        lineage = habitat_lineage[("prix_m2", row["territory_id"], row["axis_value"])]
                        assert len(lineage) == 1
                        assert point["provenance"][0]["version"] == lineage[0]["source_version"]
                    if level=="region":
                        comparison = client.post(f"/api/territories/{level}/{focal_id}/indicators/prix_m2/comparison",json={"selection":[]})
                        assert comparison.status_code == 200, comparison.text
                        assert comparison.json()["result"]["status"] == "unavailable"
                    pub.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(schema)))
                    prix_rows = pub.execute("""SELECT o.territory_id,o.territory_type,o.axis_value,o.observation_period,
                    o.value,o.status,r.source_id,r.vintage_id,r.source_name,r.dataset_name,
                    r.source_version,r.reference_date,r.publication_date
                    FROM series_dataset_observation o
                    JOIN series_observation_provenance a USING(dataset_id,indicator_id,territory_id,axis_value)
                    JOIN series_provenance_revision r USING(provenance_revision_id)
                    WHERE o.dataset_id=%s AND o.indicator_id='prix_m2'
                    ORDER BY o.territory_id,o.axis_value,r.source_id""",(habitat["dataset_id"],)).fetchall()
                    expected_prix = {(str(row["territory_id"]),row["territory_type"],str(row["axis_value"])): row
                        for row in annuals}
                    assert expected_prix
                    actual_prix = {}
                    for territory_id,territory_type,axis,period,value,status,source_id,vintage_id,source_name,dataset_name,source_version,ref_date,pub_date in prix_rows:
                        key=(territory_id,territory_type,axis)
                        actual_prix.setdefault(key,[]).append((period,value,status,source_id,vintage_id,source_name,dataset_name,source_version,ref_date,pub_date))
                    assert set(actual_prix) == set(expected_prix)
                    for key,row in expected_prix.items():
                        period,value,status,source_id,vintage_id,source_name,dataset_name,source_version,ref_date,pub_date=actual_prix[key][0]
                        lineage = habitat_lineage[("prix_m2", key[0], key[2])]
                        assert len(actual_prix[key]) == len(lineage) == 1
                        assert (value is None) == (row["value"] is None)
                        if value is not None:
                            assert value == pytest.approx(row["value"],rel=0,abs=1e-6)
                        assert status == ("missing" if row["value"] is None else "measured")
                        assert source_id == lineage[0]["source_id"]
                        assert period == key[2]
                        assert vintage_id == lineage[0]["vintage_id"]
                        assert source_name == lineage[0]["source_name"]
                        assert dataset_name == lineage[0]["dataset_name"]
                        assert source_version == lineage[0]["source_version"]
                        assert str(ref_date) == str(lineage[0]["reference_date"])
                        assert str(pub_date) == str(lineage[0]["publication_date"])
                for indicator in ("conso_enaf_annuel","artif_par_habitant"):
                    rows = milieux_points[indicator]
                    projection = milieux_series[indicator]
                    for level in ("commune","epci","departement","region"):
                        focal_id = "35238" if level=="commune" else next(row["territory_id"] for row in rows if row["territory_type"]==level)
                        focal = [row for row in rows if row["territory_id"]==focal_id and row["territory_type"]==level]
                        response = client.get(f"/api/territories/{level}/{focal_id}/indicators/{indicator}")
                        assert response.status_code == 200, response.text
                        assert response.json()["theme_id"] == "milieux"
                        actual = [point for point in response.json()["points"] if point["status"]=="measured"]
                        expected_values = sorted(row["value"] for row in focal if row["value"] is not None)
                        assert sorted(point["value"] for point in actual) == pytest.approx(expected_values,rel=0,abs=1e-6)
                        if indicator=="artif_par_habitant":
                            for row in focal:
                                point = next(point for point in response.json()["points"] if point["axis"]==row["axis_value"])
                                assert point["state_role"] == row["state_role"]
                                assert point["observation_period"] == row["observation_period"]
                                lineage = milieux_lineage[indicator][(indicator, row["territory_id"], row["axis_value"])]
                                assert {source["source_id"] for source in point["provenance"]} == {
                                    source["source_id"] for source in lineage}
                        dataset_id = projection["dataset_id"]
                    sql_rows = pub.execute("""SELECT o.territory_id,o.territory_type,o.axis_value,o.state_role,
                        o.observation_period,o.value,o.status,r.source_id,r.vintage_id,r.source_name,
                        r.dataset_name,r.source_version,r.reference_date,r.publication_date
                        FROM series_dataset_observation o
                        LEFT JOIN series_observation_provenance a USING(dataset_id,indicator_id,territory_id,axis_value)
                        LEFT JOIN series_provenance_revision r USING(provenance_revision_id)
                        WHERE o.dataset_id=%s AND o.indicator_id=%s
                        ORDER BY o.territory_id,o.axis_value,r.source_id""",(dataset_id,indicator)).fetchall()
                    actual = {}
                    for record in sql_rows:
                        key=(record[0],record[1],record[2])
                        actual.setdefault(key,[]).append(record)
                    expected_states = {
                        (str(row["territory_id"]), row["territory_type"], str(row["axis_value"])): row
                        for row in rows
                    }
                    assert set(actual) == set(expected_states)
                    for key, state in expected_states.items():
                        recs = actual[key]
                        lineage = milieux_lineage[indicator][(indicator, key[0], key[2])]
                        assert len(recs) == len(lineage)
                        assert {record[7] for record in recs} == {source["source_id"] for source in lineage}
                        for rec in recs:
                            source = next(item for item in lineage if item["source_id"] == rec[7])
                            assert rec[3] == state.get("state_role")
                            assert rec[4] == state["observation_period"]
                            assert (rec[5] is None) == (state["value"] is None)
                            if rec[5] is not None:
                                assert rec[5] == pytest.approx(state["value"], rel=0, abs=1e-6)
                            assert rec[6] == state["status"]
                            assert rec[8] == source["vintage_id"]
                            assert rec[9] == source["source_name"]
                            assert rec[10] == source["dataset_name"]
                            assert rec[11] == source["source_version"]
                            assert str(rec[12]) == str(source["reference_date"])
                            assert str(rec[13]) == str(source["publication_date"])
        finally:
            app.dependency_overrides.clear()
            pool.cache_clear()
            pub.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))
