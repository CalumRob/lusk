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
                expected_readings=json.loads((canonical/"histoires_milieux.json").read_text(encoding="utf-8-sig"))
                reading_rows=[row for row in expected_readings if row["theme"]=="milieux"]
                pub.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(schema)))
                sql_readings=pub.execute("""SELECT territory_id,territory_type,groupe,story_key,salience_reason,periode_pop,
                    periode_artif,delta_population,taux_variation_population,artif_m2_par_habitant,
                    artif_m3_par_habitant,trajectoire_artif_par_habitant,classification,status,source_id,vintage_id
                    FROM milieux_typed_reading ORDER BY territory_type,territory_id,groupe""").fetchall()
                expected_by_key={(str(row["territoire"]),row["type"],row["groupe"]):row for row in reading_rows}
                actual_by_key={(row[0],row[1],row[2]):row for row in sql_readings}
                assert set(actual_by_key)==set(expected_by_key)
                for key,old in expected_by_key.items():
                    row=actual_by_key[key]
                    for index,field in ((3,"story_key"),(4,"salience_reason"),(5,"periode_pop"),(6,"periode_artif"),
                        (11,"trajectoire_artif_par_habitant"),(12,"classification")):
                        assert row[index]==old[field],(key,field)
                    for index,field in ((7,"delta_population"),(8,"taux_variation_population"),
                        (9,"artif_m2_par_habitant"),(10,"artif_m3_par_habitant")):
                        if old[field] is None: assert row[index] is None,(key,field)
                        else: assert row[index]==pytest.approx(old[field],rel=0,abs=1e-10),(key,field)
                    assert row[13]==("measured" if old["classification"] is not None and old["periode_pop"] is not None and old["periode_artif"] is not None else "unavailable")
                    population_vintage_id=f'{vintage_by_id["serie_historique"]["version"]}/{vintage_by_id["serie_historique"]["date_reference"]}'
                    assert (row[14],row[15])==("serie_historique",population_vintage_id)
                sql_sources=pub.execute("""SELECT territory_id,territory_type,groupe,field_key,source_id,vintage_id,
                    source_name,source_version,reference_date,publication_date,observation_period,dataset_id,
                    dataset_content_version,state_role,axis_value,provenance_revision_id
                    ,population_revision_id
                    FROM milieux_reading_source ORDER BY territory_type,territory_id,groupe,field_key,source_id,vintage_id""").fetchall()
                actual_sources={(r[0],r[1],r[2],r[3],r[4],r[5]):r for r in sql_sources}
                expected_source_keys=set()
                for key,old in expected_by_key.items():
                    territory,level,groupe=key
                    pop=vintage_by_id["serie_historique"]
                    population_vintage_id=f'{pop["version"]}/{pop["date_reference"]}'
                    expected_source_keys.add((territory,level,groupe,"population","serie_historique",population_vintage_id))
                    source_row=next(row for row in reading_rows if (str(row["territoire"]),row["type"],row["groupe"])==key)
                    pop_actual=actual_sources[(territory,level,groupe,"population","serie_historique",population_vintage_id)]
                    assert (pop_actual[6],pop_actual[7],str(pop_actual[8]),str(pop_actual[9]),pop_actual[10])==(
                        pop["source"],pop["version"],str(pop["date_reference"]),str(pop["date_publication"]),old["periode_pop"])
                    state_rows=typed_states[(typed_states.key=="artif_par_habitant") &
                        (typed_states.territoire.astype(str)==territory) & (typed_states.type==level)]
                    for state in state_rows.to_dict(orient="records"):
                        role=state["state_role"]
                        field="artif_m2_par_habitant" if role=="M2" else "artif_m3_par_habitant"
                        component_ids=set(json.loads(state["source_components"])[role])
                        for source_id in component_ids:
                            clock=vintage_by_id[source_id]
                            vintage_id=str(clock["version"])
                            source_key=(territory,level,groupe,field,source_id,vintage_id)
                            expected_source_keys.add(source_key)
                            linked=actual_sources[source_key]
                            assert (linked[6],linked[7],str(linked[8]),str(linked[9]),linked[10],linked[13],linked[14])==(
                                clock["source"],clock["version"],str(clock["date_reference"]),str(clock["date_publication"]),
                                old["periode_artif"],role,str(state["detail"]))
                            assert linked[11]==milieux_metadata["indicator_pages"]["artif_par_habitant"]["series_dataset_id"]
                            assert linked[12]==pub.execute("SELECT content_version FROM series_dataset_publication WHERE dataset_id=%s",
                                (linked[11],)).fetchone()[0]
                            assert linked[15] and pub.execute("SELECT 1 FROM series_observation_provenance WHERE dataset_id=%s AND indicator_id='artif_par_habitant' AND territory_id=%s AND axis_value=%s AND provenance_revision_id=%s",
                                (linked[11],territory,linked[14],linked[15])).fetchone()
                    population_sources=[r for r in sql_sources if r[3]=="population"]
                    assert len(population_sources)==len(reading_rows)
                    for source in population_sources:
                        revision=pub.execute("SELECT source_id,vintage_id,source_name,source_version,reference_date,publication_date FROM milieux_population_provenance_revision WHERE population_revision_id=%s",
                            (source[16],)).fetchone()
                        assert revision is not None
                        assert (source[4],source[5],source[6],source[7],source[8],source[9])==(
                            revision[0],revision[1],revision[2],revision[3],revision[4],revision[5])
                assert set(actual_sources)==expected_source_keys
                selected_by_level={}
                for level in ("commune","epci","departement","region"):
                    candidates=[row for row in reading_rows if row["type"]==level and
                        not typed_states[(typed_states.key=="artif_par_habitant") & (typed_states.territoire.astype(str)==str(row["territoire"]))].empty]
                    assert candidates, f"canonical Milieux reading missing source-supported {level} row"
                    selected_by_level[level]=candidates[0]
                vintage_by_id={str(row["id"]):row for row in vintages.to_dict(orient="records")}
                for level,old in selected_by_level.items():
                    territory=str(old["territoire"])
                    response=client.get(f"/api/territories/{level}/{territory}/themes/milieux/facts")
                    assert response.status_code==200,response.text
                    body=response.json(); actual_reading=next(r for r in body["readings"] if r["groupe"]==old["groupe"])
                    for field in ("groupe","story_key","salience_reason","periode_pop","periode_artif","delta_population",
                        "taux_variation_population","artif_m2_par_habitant","artif_m3_par_habitant",
                        "trajectoire_artif_par_habitant","classification"):
                        assert actual_reading[field]==old[field],(level,territory,field)
                    population=vintage_by_id["serie_historique"]
                    assert actual_reading["provenance"]["source_id"]=="serie_historique"
                    assert actual_reading["provenance"]["vintage_id"]==f'{population["version"]}/{population["date_reference"]}'
                    assert actual_reading["provenance"]["source_version"]==population["version"]
                    assert str(actual_reading["provenance"]["source_reference_date"])==str(population["date_reference"])
                    associations=actual_reading["provenance"]["associations"]
                    pop_assoc=[a for a in associations if a["field"]=="population"]
                    assert len(pop_assoc)==1 and pop_assoc[0]["observation_period"]==old["periode_pop"]
                    assert pop_assoc[0]["source_id"]=="serie_historique"
                    state_rows=typed_states[(typed_states.key=="artif_par_habitant") & (typed_states.territoire.astype(str)==territory)]
                    for role,field in (("M2","artif_m2_par_habitant"),("M3","artif_m3_par_habitant")):
                        state=state_rows[state_rows.state_role==role]
                        assert len(state)==1
                        source_ids=set(json.loads(state.iloc[0].source_components)[role])
                        linked=[a for a in associations if a["field"]==field]
                        assert {a["source_id"] for a in linked}==source_ids
                        assert all(a["state_role"]==role and a["observation_period"]==old["periode_artif"] for a in linked)
                        for association in linked:
                            vintage=vintage_by_id[association["source_id"]]
                            assert association["source_version"]==vintage["version"]
                            assert str(association["source_reference_date"])==str(vintage["date_reference"])
                            assert str(association["source_publication_date"])==str(vintage["date_publication"])
                            marker=pub.execute("SELECT content_version FROM series_dataset_publication WHERE dataset_id=%s",
                                (association["dataset_id"],)).fetchone()
                            assert marker and marker[0]==association["dataset_content_version"]
                focal=selected_by_level["commune"]; territory=str(focal["territoire"])
                pub.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(schema)))
                original=pub.execute("SELECT taux_variation_population FROM milieux_typed_reading WHERE territory_id=%s AND territory_type='commune'",
                    (territory,)).fetchone()[0]
                pub.execute("UPDATE milieux_typed_reading SET taux_variation_population=%s WHERE territory_id=%s AND territory_type='commune'",
                    (original+1,territory))
                try:
                    mutated=client.get(f"/api/territories/commune/{territory}/themes/milieux/facts")
                    assert mutated.status_code==200,mutated.text
                    got=next(r for r in mutated.json()["readings"] if r["groupe"]==focal["groupe"])
                    assert got["taux_variation_population"]!=focal["taux_variation_population"]
                finally:
                    pub.execute("UPDATE milieux_typed_reading SET taux_variation_population=%s WHERE territory_id=%s AND territory_type='commune'",
                        (original,territory))
                population_clock=pub.execute("SELECT population_revision_id,source_name,source_version,reference_date,publication_date FROM milieux_reading_source WHERE territory_id=%s AND territory_type='commune' AND field_key='population'",
                    (territory,)).fetchone()
                for column,bad_value in (("source_name","mutated source name"),("source_version","mutated source version"),
                    ("reference_date","1900-01-01"),("publication_date","1900-01-02")):
                    pub.execute(f"UPDATE milieux_reading_source SET {column}=%s WHERE territory_id=%s AND territory_type='commune' AND field_key='population'",
                        (bad_value,territory))
                    try:
                        corrupted=client.get(f"/api/territories/commune/{territory}/themes/milieux/facts")
                        assert corrupted.status_code==503,(column,corrupted.text)
                    finally:
                        pub.execute("UPDATE milieux_reading_source SET source_name=%s,source_version=%s,reference_date=%s,publication_date=%s WHERE territory_id=%s AND territory_type='commune' AND field_key='population'",
                            (*population_clock[1:],territory))
                null_clock=pub.execute("""SELECT r.population_revision_id,r.vintage_id,r.source_name,r.source_version,
                    r.reference_date,r.publication_date FROM milieux_population_provenance_revision r
                    WHERE r.reference_date IS NULL AND r.publication_date IS NULL AND r.source_id='serie_historique'
                    ORDER BY r.population_revision_id LIMIT 1""").fetchone()
                assert null_clock is not None
                pub.execute("UPDATE milieux_typed_reading SET vintage_id=%s WHERE territory_id=%s AND territory_type='commune'",
                    (null_clock[1],territory))
                pub.execute("""UPDATE milieux_reading_source SET vintage_id=%s,population_revision_id=%s,source_name=%s,
                    source_version=%s,reference_date=NULL,publication_date=NULL
                    WHERE territory_id=%s AND territory_type='commune' AND field_key='population'""",
                    (null_clock[1],null_clock[0],null_clock[2],null_clock[3],territory))
                try:
                    null_clock_response=client.get(f"/api/territories/commune/{territory}/themes/milieux/facts")
                    assert null_clock_response.status_code==200,null_clock_response.text
                    null_reading=next(r for r in null_clock_response.json()["readings"] if r["groupe"]==focal["groupe"])
                    assert null_reading["provenance"]["source_reference_date"] is None
                    assert null_reading["provenance"]["source_publication_date"] is None
                finally:
                    pub.execute("UPDATE milieux_typed_reading SET vintage_id=%s WHERE territory_id=%s AND territory_type='commune'",
                        (population_vintage_id,territory))
                    pub.execute("""UPDATE milieux_reading_source SET vintage_id=%s,population_revision_id=%s,source_name=%s,
                        source_version=%s,reference_date=%s,publication_date=%s
                        WHERE territory_id=%s AND territory_type='commune' AND field_key='population'""",
                        (population_vintage_id,population_clock[0],population_clock[1],population_clock[2],
                         population_clock[3],population_clock[4],territory))
                pop_window=pub.execute("SELECT observation_period FROM milieux_reading_source WHERE territory_id=%s AND territory_type='commune' AND field_key='population'",
                    (territory,)).fetchone()[0]
                pub.execute("UPDATE milieux_reading_source SET observation_period='2099-2100' WHERE territory_id=%s AND territory_type='commune' AND field_key='population'",
                    (territory,))
                try:
                    stale=client.get(f"/api/territories/commune/{territory}/themes/milieux/facts")
                    assert stale.status_code==503,stale.text
                finally:
                    pub.execute("UPDATE milieux_reading_source SET observation_period=%s WHERE territory_id=%s AND territory_type='commune' AND field_key='population'",
                        (pop_window,territory))
                dataset=next(a["dataset_id"] for a in associations if a["dataset_id"] is not None)
                dataset_version=pub.execute("SELECT content_version FROM series_dataset_publication WHERE dataset_id=%s",
                    (dataset,)).fetchone()[0]
                pub.execute("UPDATE series_dataset_publication SET content_version='deliberately-stale-test-token' WHERE dataset_id=%s",
                    (dataset,))
                try:
                    incompatible=client.get(f"/api/territories/commune/{territory}/themes/milieux/facts")
                    assert incompatible.status_code==503,incompatible.text
                finally:
                    pub.execute("UPDATE series_dataset_publication SET content_version=%s WHERE dataset_id=%s",
                        (dataset_version,dataset))
        finally:
            app.dependency_overrides.clear()
            pool.cache_clear()
            pub.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))
