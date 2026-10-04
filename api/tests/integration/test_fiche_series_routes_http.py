"""Canonical owned facts remain reachable independently at fiche levels."""
import json
import os
import subprocess
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

import pytest

pytestmark = pytest.mark.integration


def test_canonical_owned_series_have_independent_fiche_routes(tmp_path):
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
    expected = json.loads((canonical / "indicateurs_habitat.json").read_text(encoding="utf-8-sig"))
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
                annuals = [row for row in expected if row["key"] == "prix_m2" and row["detail"] is not None]
                for level in ("commune","epci","departement","region"):
                    focal_id = "35238" if level=="commune" else next(row["territoire"] for row in annuals if row["type"]==level)
                    focal = [row for row in annuals if row["territoire"]==focal_id]
                    response = client.get(f"/api/territories/{level}/{focal_id}/indicators/prix_m2")
                    assert response.status_code == 200, response.text
                    assert {point["axis"] for point in response.json()["points"]} == {row["detail"] for row in focal}
                    for row in focal:
                        point = next(point for point in response.json()["points"] if point["axis"] == row["detail"])
                        if row["value"] is None:
                            assert point["value"] is None
                        else:
                            assert point["value"] == pytest.approx(row["value"],rel=0,abs=1e-6)
                        assert point["provenance"][0]["version"] == row["vintage_version"]
                    if level=="region":
                        comparison = client.post(f"/api/territories/{level}/{focal_id}/indicators/prix_m2/comparison",json={"selection":[]})
                        assert comparison.status_code == 200, comparison.text
                        assert comparison.json()["result"]["status"] == "unavailable"
                assert pub.execute("SELECT count(*) FROM series_dataset_observation WHERE indicator_id='prix_m2'").fetchone()[0] == len(annuals)
                milieux = json.loads((canonical / "indicateurs_milieux.json").read_text(encoding="utf-8-sig"))
                import pandas as pd
                typed_states = pd.read_parquet(canonical / "indicateurs_milieux.parquet")
                windows = json.loads((canonical / "histoires_milieux.json").read_text(encoding="utf-8-sig"))
                for indicator in ("conso_enaf_annuel","artif_par_habitant"):
                    rows = [row for row in milieux if row["key"]==indicator]
                    for level in ("commune","epci","departement","region"):
                        focal_id = "35238" if level=="commune" else next(row["territoire"] for row in rows if row["type"]==level)
                        focal = [row for row in rows if row["territoire"]==focal_id]
                        response = client.get(f"/api/territories/{level}/{focal_id}/indicators/{indicator}")
                        assert response.status_code == 200, response.text
                        assert response.json()["theme_id"] == "milieux"
                        actual = [point for point in response.json()["points"] if point["status"]=="measured"]
                        expected_values = sorted(row["value"] for row in focal if row["value"] is not None)
                        assert sorted(point["value"] for point in actual) == pytest.approx(expected_values,rel=0,abs=1e-6)
                        if indicator=="artif_par_habitant":
                            state_rows = typed_states[(typed_states.key==indicator) & (typed_states.territoire==focal_id)]
                            window = next(row["periode_artif"] for row in windows if row["territoire"]==focal_id)
                            for row in state_rows.to_dict(orient="records"):
                                point = next(point for point in response.json()["points"] if point["axis"]==row["detail"])
                                assert point["state_role"] == row["state_role"]
                                assert point["observation_period"] == window
                                assert {source["source_id"] for source in point["provenance"]} == set(json.loads(row["source_components"])[row["state_role"]])
                    assert pub.execute("SELECT count(*) FROM series_dataset_observation WHERE indicator_id=%s",(indicator,)).fetchone()[0] == len(rows)
        finally:
            app.dependency_overrides.clear()
            pool.cache_clear()
            pub.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))
