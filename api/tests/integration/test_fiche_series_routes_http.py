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
    import pandas as pd
    habitat_parquet = pd.read_parquet(canonical / "indicateurs_habitat.parquet")
    habitat_metadata = json.loads((root / "pipeline/inst/extdata/theme-metadata/theme_habitat.json").read_text(encoding="utf-8"))
    milieux_metadata = json.loads((root / "pipeline/inst/extdata/theme-metadata/theme_milieux.json").read_text(encoding="utf-8"))
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
                    pub.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(schema)))
                    prix_rows = pub.execute("""SELECT o.territory_id,o.territory_type,o.axis_value,o.observation_period,
                    o.value,o.status,r.source_id,r.vintage_id,r.source_name,r.dataset_name,
                    r.source_version,r.reference_date,r.publication_date
                    FROM series_dataset_observation o
                    JOIN series_observation_provenance a USING(dataset_id,indicator_id,territory_id,axis_value)
                    JOIN series_provenance_revision r USING(provenance_revision_id)
                    WHERE o.dataset_id='dvf_prix_m2' AND o.indicator_id='prix_m2'
                    ORDER BY o.territory_id,o.axis_value,r.source_id""").fetchall()
                    expected_prix = {(str(row["territoire"]),row["type"],str(row["detail"])): row
                        for row in annuals}
                    assert len(annuals) == 6340
                    parquet_prix = habitat_parquet[(habitat_parquet.key=="prix_m2") & habitat_parquet.detail.notna()]
                    parquet_prix_by_key={(str(row.territoire),row.type,str(row.detail)):row
                        for row in parquet_prix.itertuples(index=False)}
                    assert set(parquet_prix_by_key)==set(expected_prix)
                    actual_prix = {}
                    for territory_id,territory_type,axis,period,value,status,source_id,vintage_id,source_name,dataset_name,source_version,ref_date,pub_date in prix_rows:
                        key=(territory_id,territory_type,axis)
                        actual_prix.setdefault(key,[]).append((period,value,status,source_id,vintage_id,source_name,dataset_name,source_version,ref_date,pub_date))
                    assert set(actual_prix) == set(expected_prix)
                    for key,row in expected_prix.items():
                        canonical_row=parquet_prix_by_key[key]
                        period,value,status,source_id,vintage_id,source_name,dataset_name,source_version,ref_date,pub_date=actual_prix[key][0]
                        assert len(actual_prix[key]) == 1
                        assert (value is None) == (row["value"] is None)
                        if value is not None:
                            assert value == pytest.approx(row["value"],rel=0,abs=1e-6)
                        assert status == ("missing" if row["value"] is None else "measured")
                        assert source_id == habitat_metadata["indicator_pages"]["prix_m2"]["sources"][0]
                        assert period == key[2]
                        assert vintage_id == row["vintage_version"] == canonical_row.vintage_version
                        assert source_name == row["vintage_source"] == canonical_row.vintage_source
                        assert dataset_name == habitat_metadata["source_records"][source_id]["dataset"]
                        assert source_version == row["vintage_version"] == canonical_row.vintage_version
                        assert str(ref_date) == row["vintage_date_reference"] == canonical_row.vintage_date_reference
                        assert str(pub_date) == row["vintage_date_publication"] == canonical_row.vintage_date_publication
                milieux = json.loads((canonical / "indicateurs_milieux.json").read_text(encoding="utf-8-sig"))
                typed_states = pd.read_parquet(canonical / "indicateurs_milieux.parquet")
                windows = json.loads((canonical / "histoires_milieux.json").read_text(encoding="utf-8-sig"))
                vintages = pd.read_parquet(canonical / "vintages.parquet")
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
                        dataset_id = milieux_metadata["indicator_pages"][indicator]["series_dataset_id"]
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
                    if indicator == "conso_enaf_annuel":
                        assert len(rows) == 17724
                        expected = {(str(row["territoire"]),row["type"],str(row["detail"])):row for row in rows}
                        assert set(actual) == set(expected)
                        for key,row in expected.items():
                            records=actual[key]
                            assert len(records)==1
                            rec=records[0]
                            assert rec[4]==key[2]
                            assert (rec[5] is None)==(row["value"] is None)
                            if rec[5] is not None: assert rec[5] == pytest.approx(row["value"],rel=0,abs=1e-6)
                            assert rec[6] == ("missing" if row["value"] is None else "measured")
                            source_id=milieux_metadata["indicator_pages"][indicator]["sources"][0]
                            source_record=milieux_metadata["source_records"][source_id]
                            assert rec[7] == source_id
                            assert rec[8] == f'{row["vintage_version"]}/{row["vintage_date_reference"]}'
                            assert rec[9] == row["vintage_source"]
                            assert rec[10] == source_record["dataset"] and rec[11] == row["vintage_version"]
                            assert str(rec[12]) == row["vintage_date_reference"]
                            assert str(rec[13]) == row["vintage_date_publication"]
                    else:
                        state_rows=typed_states[(typed_states.key==indicator) & typed_states.type.isin(["commune","epci","departement","region"])]
                        assert len(state_rows)==2532
                        expected_states={}
                        history_by_id={str(row["territoire"]):row for row in windows if row["theme"]=="milieux"}
                        vintage_by_id={str(row["id"]):row for row in vintages.to_dict(orient="records")}
                        for state in state_rows.to_dict(orient="records"):
                            key=(str(state["territoire"]),state["type"],str(state["detail"]))
                            window=history_by_id[key[0]]["periode_artif"]
                            component_map=json.loads(state["source_components"])
                            sources=sorted(component_map[state["state_role"]])
                            clocks=[]
                            for source in sources:
                                vintage=vintage_by_id[source]
                                clocks.append((source,str(vintage["version"]),str(vintage["source"]),
                                    str(vintage["date_reference"]),str(vintage["date_publication"])))
                            expected_states[key]=(state,window,sources,clocks)
                        assert set(actual)==set(expected_states)
                        for key,(state,window,sources,clocks) in expected_states.items():
                            recs=actual[key]
                            assert len(recs)==len(sources)
                            assert {r[7] for r in recs}==set(sources)
                            for rec in recs:
                                assert rec[3]==state["state_role"]
                                assert rec[4]==window
                                assert (rec[5] is None)==pd.isna(state["value"])
                                if rec[5] is not None: assert rec[5]==pytest.approx(state["value"],rel=0,abs=1e-6)
                                assert rec[6]==("missing" if pd.isna(state["value"]) else "measured")
                                clock=next(c for c in clocks if c[0]==rec[7])
                                assert (rec[8],rec[9],rec[11],str(rec[12]),str(rec[13]))==(clock[1],clock[2],clock[1],clock[3],clock[4])
                                expected_dataset=milieux_metadata["source_records"][milieux_metadata["indicator_pages"][indicator]["sources"][0]]["dataset"]
                                assert rec[10]==expected_dataset
        finally:
            app.dependency_overrides.clear()
            pool.cache_clear()
            pub.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))
