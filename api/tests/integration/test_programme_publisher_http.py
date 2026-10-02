"""Canonical grant producer -> registered R publisher -> named HTTP acquisition."""
import json
import os
import subprocess
import statistics
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

import pytest

pytestmark = pytest.mark.integration


def test_canonical_annual_grants_survive_registered_publication(tmp_path):
    required = ("LUSK_TEST_PUBLISH_DSN", "LUSK_TEST_READ_DSN",
                "LUSK_TEST_DATABASE_NAME", "LUSK_TEST_CANONICAL_DATA_DIR")
    if not all(os.getenv(key) for key in required):
        pytest.skip("requires explicitly guarded disposable PostgreSQL and canonical artifacts")
    assert os.environ["LUSK_TEST_DATABASE_PREFIX"] == "lusk_it_"
    assert os.environ["LUSK_TEST_DATABASE_NAME"].startswith("lusk_it_")
    import psycopg
    from fastapi.testclient import TestClient
    from api.main import ReadRepository, app, get_repository, pool

    root = Path(__file__).resolve().parents[3]
    canonical = Path(os.environ["LUSK_TEST_CANONICAL_DATA_DIR"])
    # An independently published producer projection, not an expectation made
    # by the serving projector or by the API's SQL aggregation.
    rows = json.loads((canonical / "indicateurs_programmes.json").read_text(encoding="utf-8-sig"))
    expected = next(row for row in rows if row["key"] == "subventions_annuelles"
                    and row["territoire"] == "35238")
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
        with psycopg.connect(os.environ["LUSK_TEST_READ_DSN"]) as reader:
            assert reader.execute("SELECT current_database(),current_user").fetchone() == (
                os.environ["LUSK_TEST_DATABASE_NAME"], urlsplit(os.environ["LUSK_TEST_READ_DSN"]).username)
        pub.execute(f'CREATE SCHEMA "{schema}"')
        try:
            pub.execute(f'SET search_path TO "{schema}"')
            pub.execute((root / "api/schema.sql").read_text(encoding="utf-8"))
            completed = subprocess.run(
                ["Rscript", "scripts/smoke-programme-postgres.R", schema],
                cwd=root / "pipeline", env=os.environ.copy(), capture_output=True,
                text=True, encoding="utf-8", errors="replace", timeout=180,
            )
            assert completed.returncode == 0, completed.stdout + completed.stderr
            role = urlsplit(os.environ["LUSK_TEST_READ_DSN"]).username
            from psycopg import sql
            pub.execute(sql.SQL("GRANT USAGE ON SCHEMA {} TO {}").format(sql.Identifier(schema), sql.Identifier(role)))
            pub.execute(sql.SQL("GRANT SELECT ON ALL TABLES IN SCHEMA {} TO {}").format(sql.Identifier(schema), sql.Identifier(role)))
            app.dependency_overrides[get_repository] = lambda: ReadRepository(Connections())
            pool.cache_clear()
            with TestClient(app) as client:
                response = client.get("/api/territories/commune/35238/indicators/subventions_annuelles")
            assert response.status_code == 200, response.text
            body = response.json()
            assert body["indicator_id"] == expected["key"]
            assert body["theme_id"] == "programmes"
            assert body["unit"] == expected["unit"]
            point = next(point for point in body["points"] if point["axis"] == expected["dimension"])
            assert point["value"] == pytest.approx(expected["value"], rel=0, abs=1e-6)
            assert point["observation_period"] == expected["dimension"]
            assert point["status"] == "measured"
            source = point["provenance"][0]
            assert source["source_name"] == expected["vintage_source"]
            assert source["version"] == expected["vintage_version"]
            assert source["reference_date"] == expected["vintage_date_reference"]
            assert source["publication_date"] == expected["vintage_date_publication"]
            assert body["scope_series"] == []
            # Fiche focal eligibility includes regional facts even where the
            # standalone indicator page limits its comparison controls.
            annual = [row for row in rows if row["key"] == expected["key"]]
            with TestClient(app) as client:
                for level in ("commune", "epci", "departement", "region"):
                    focal = next(row for row in annual if row["type"] == level)
                    read = client.get(f'/api/territories/{level}/{focal["territoire"]}/indicators/{focal["key"]}')
                    assert read.status_code == 200, read.text
                    focal_point = next(point for point in read.json()["points"] if point["axis"] == focal["dimension"])
                    assert focal_point["value"] == pytest.approx(focal["value"], rel=0, abs=1e-6)
                peers = [row for row in annual if row["type"] == "commune"
                         and row["territoire"] != expected["territoire"]][:2]
                selection = [{"territory_type": "commune", "territory_id": row["territoire"]} for row in peers]
                comparison = client.post("/api/territories/commune/35238/indicators/subventions_annuelles/comparison",
                                         json={"selection": selection})
                assert comparison.status_code == 200, comparison.text
                result = comparison.json()["result"]
                assert result["median"] == pytest.approx(statistics.median(row["value"] for row in peers), rel=0, abs=1e-6)
                assert result["source_facet"] == expected["dimension"]
                assert result["selected_member_count"] == len(peers)
                assert "focal_value" not in result and "points" not in comparison.json()
                empty = client.post("/api/territories/commune/35238/indicators/subventions_annuelles/comparison",
                                    json={"selection": []})
                assert empty.status_code == 200, empty.text
                assert empty.json()["scope"]["member_count"] == 0
                assert empty.json()["result"]["median"] is None
                region = next(row for row in annual if row["type"] == "region")
                regional_comparison = client.post(
                    f'/api/territories/region/{region["territoire"]}/indicators/subventions_annuelles/comparison',
                    json={"selection": selection})
                assert regional_comparison.status_code == 200, regional_comparison.text
                assert regional_comparison.json()["result"]["status"] == "unavailable"
                assert regional_comparison.json()["result"]["median"] is None
                observed_ids = {row["territoire"] for row in annual}
                absent_id = next(territory_id for (territory_id,) in pub.execute(
                    "SELECT territory_id FROM territory_reference WHERE territory_type='commune' ORDER BY territory_id"
                ) if territory_id not in observed_ids)
                absent = client.get(f"/api/territories/commune/{absent_id}/indicators/subventions_annuelles")
                assert absent.status_code == 200, absent.text
                assert absent.json()["availability"] == "no_record"
                assert absent.json()["points"] == []
                theme = client.get("/api/territories/commune/35238/themes/programmes/facts")
                assert theme.status_code == 200, theme.text
                assert theme.json()["complete_theme"] is False
                assert theme.json()["series"][0]["indicator_id"] == expected["key"]
                assert next(result for result in theme.json()["default_comparison"]["results"]
                            if result["indicator_id"] == expected["key"])["statistic"] == "median"
            # Rehearse upgrading a populated pre-017 projection. The existing
            # fail-closed contract is the default; no facts or markers change.
            before = pub.execute("SELECT content_version,row_count FROM series_dataset_publication ORDER BY dataset_id").fetchall()
            pub.execute("ALTER TABLE series_dataset_descriptor DROP COLUMN absence_semantics")
            pub.execute("ALTER TABLE series_dataset_descriptor DROP COLUMN comparison_levels")
            pub.execute((root / "api/migrations/017_series_source_absence.sql").read_text(encoding="utf-8"))
            assert pub.execute("SELECT content_version,row_count FROM series_dataset_publication ORDER BY dataset_id").fetchall() == before
            assert pub.execute("SELECT DISTINCT absence_semantics FROM series_dataset_descriptor").fetchall() == [("unavailable",)]
            with TestClient(app) as client:
                legacy_absent = client.get(f"/api/territories/commune/{absent_id}/indicators/subventions_annuelles")
            assert legacy_absent.status_code == 503
        finally:
            app.dependency_overrides.clear()
            pool.cache_clear()
            pub.execute(f'DROP SCHEMA "{schema}" CASCADE')
