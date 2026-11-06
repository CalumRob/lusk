"""Canonical owned facts remain reachable independently at fiche levels."""
import os
import subprocess
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

import pytest
from producer_artifacts import read_owned_series_artifact, read_typed_reading_artifact, records

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
    milieux_reading_projection = read_typed_reading_artifact(canonical, "milieux")
    reading_rows = records(milieux_reading_projection["facts"])
    reading_bindings = records(milieux_reading_projection["source_bindings"])
    population_revisions = records(milieux_reading_projection["population_revisions"])
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
                pub.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(schema)))
                sql_readings=pub.execute("""SELECT territory_id,territory_type,groupe,story_key,salience_reason,periode_pop,
                    periode_artif,delta_population,taux_variation_population,artif_m2_par_habitant,
                    artif_m3_par_habitant,trajectoire_artif_par_habitant,classification,status,source_id,vintage_id
                    FROM milieux_typed_reading ORDER BY territory_type,territory_id,groupe""").fetchall()
                expected_by_key={(str(row["territory_id"]),row["territory_type"],row["groupe"]):row for row in reading_rows}
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
                    assert row[13] == old["status"]
                    assert (row[14],row[15])==(old["source_id"],old["vintage_id"])
                sql_sources=pub.execute("""SELECT territory_id,territory_type,groupe,field_key,source_id,vintage_id,
                    source_name,source_version,reference_date,publication_date,observation_period,dataset_id,
                    dataset_content_version,state_role,axis_value,provenance_revision_id
                    ,population_revision_id
                    FROM milieux_reading_source ORDER BY territory_type,territory_id,groupe,field_key,source_id,vintage_id""").fetchall()
                actual_sources={(r[0],r[1],r[2],r[3],r[4],r[5]):r for r in sql_sources}
                expected_source_keys = {
                    (row["territory_id"], row["territory_type"], row["groupe"], row["field_key"], row["source_id"], row["vintage_id"])
                    for row in reading_bindings
                }
                binding_by_key = {
                    (row["territory_id"], row["territory_type"], row["groupe"], row["field_key"], row["source_id"], row["vintage_id"]): row
                    for row in reading_bindings
                }
                for source_key, binding in binding_by_key.items():
                    linked = actual_sources[source_key]
                    for index, field in ((6,"source_name"),(7,"source_version"),(8,"reference_date"),
                        (9,"publication_date"),(10,"observation_period"),(11,"dataset_id"),
                        (12,"dataset_content_version"),(13,"state_role"),(14,"axis_value"),
                        (15,"provenance_revision_id"),(16,"population_revision_id")):
                        actual_value = linked[index]
                        if hasattr(actual_value, "isoformat"):
                            actual_value = actual_value.isoformat()
                        assert actual_value == binding[field], (source_key, field)
                    if binding["dataset_id"] is not None:
                        marker = pub.execute("SELECT content_version FROM series_dataset_publication WHERE dataset_id=%s",
                            (binding["dataset_id"],)).fetchone()
                        assert marker and marker[0] == binding["dataset_content_version"]
                    if binding["provenance_revision_id"] is not None:
                        assert pub.execute("SELECT 1 FROM series_observation_provenance WHERE dataset_id=%s AND indicator_id='artif_par_habitant' AND territory_id=%s AND axis_value=%s AND provenance_revision_id=%s",
                            (binding["dataset_id"], binding["territory_id"], binding["axis_value"],
                             binding["provenance_revision_id"])).fetchone()
                population_sources=[r for r in sql_sources if r[3]=="population"]
                assert len(population_sources)==sum(row["field_key"]=="population" for row in reading_bindings)
                revisions_by_id = {row["population_revision_id"]: row for row in population_revisions}
                for source in population_sources:
                    revision=pub.execute("SELECT source_id,vintage_id,source_name,source_version,reference_date,publication_date FROM milieux_population_provenance_revision WHERE population_revision_id=%s",
                        (source[16],)).fetchone()
                    assert revision is not None
                    expected_revision = revisions_by_id[source[16]]
                    assert (revision[0],revision[1],revision[2],revision[3],str(revision[4]),str(revision[5])) == (
                        expected_revision["source_id"], expected_revision["vintage_id"],
                        expected_revision["source_name"], expected_revision["source_version"],
                        str(expected_revision["reference_date"]), str(expected_revision["publication_date"]))
                assert set(actual_sources)==expected_source_keys
                selected_by_level={}
                for level in ("commune","epci","departement","region"):
                    state_territories = {(row["territory_id"], row["territory_type"])
                                         for row in milieux_points["artif_par_habitant"]}
                    candidates=[row for row in reading_rows if row["territory_type"]==level and
                        (str(row["territory_id"]), row["territory_type"]) in state_territories]
                    assert candidates, f"canonical Milieux reading missing source-supported {level} row"
                    selected_by_level[level]=candidates[0]
                for level,old in selected_by_level.items():
                    territory=str(old["territory_id"])
                    response=client.get(f"/api/territories/{level}/{territory}/themes/milieux/facts")
                    assert response.status_code==200,response.text
                    body=response.json(); actual_reading=next(r for r in body["readings"] if r["groupe"]==old["groupe"])
                    for field in ("groupe","story_key","salience_reason","periode_pop","periode_artif","delta_population",
                        "taux_variation_population","artif_m2_par_habitant","artif_m3_par_habitant",
                        "trajectoire_artif_par_habitant","classification"):
                        assert actual_reading[field]==old[field],(level,territory,field)
                    population = population_revisions[0]
                    assert actual_reading["provenance"]["source_id"]==old["source_id"]==population["source_id"]
                    assert actual_reading["provenance"]["vintage_id"]==old["vintage_id"]==population["vintage_id"]
                    assert actual_reading["provenance"]["source_version"]==population["source_version"]
                    assert str(actual_reading["provenance"]["source_reference_date"])==str(population["reference_date"])
                    associations=actual_reading["provenance"]["associations"]
                    pop_assoc=[a for a in associations if a["field"]=="population"]
                    population_binding = next(row for row in reading_bindings
                        if row["territory_id"]==territory and row["territory_type"]==level
                        and row["groupe"]==old["groupe"] and row["field_key"]=="population")
                    assert len(pop_assoc)==1 and pop_assoc[0]["observation_period"]==population_binding["observation_period"]
                    assert pop_assoc[0]["source_id"]==population_binding["source_id"]
                    state_rows=[row for row in milieux_points["artif_par_habitant"]
                                if str(row["territory_id"])==territory and row["territory_type"]==level]
                    for role,field in (("M2","artif_m2_par_habitant"),("M3","artif_m3_par_habitant")):
                        state=[row for row in state_rows if row["state_role"]==role]
                        assert len(state)==1
                        lineage=milieux_lineage["artif_par_habitant"][("artif_par_habitant",territory,state[0]["axis_value"])]
                        source_ids={source["source_id"] for source in lineage}
                        linked=[a for a in associations if a["field"]==field]
                        assert {a["source_id"] for a in linked}==source_ids
                        assert all(a["state_role"]==role and a["observation_period"]==state[0]["observation_period"] for a in linked)
                        for association in linked:
                            source=next(item for item in lineage if item["source_id"]==association["source_id"])
                            assert association["source_version"]==source["source_version"]
                            assert str(association["source_reference_date"])==str(source["reference_date"])
                            assert str(association["source_publication_date"])==str(source["publication_date"])
                            marker=pub.execute("SELECT content_version FROM series_dataset_publication WHERE dataset_id=%s",
                                (association["dataset_id"],)).fetchone()
                            assert marker and marker[0]==association["dataset_content_version"]
                focal=selected_by_level["commune"]; territory=str(focal["territory_id"])
                population_vintage_id=focal["vintage_id"]
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
                    WHERE r.reference_date IS NULL AND r.publication_date IS NULL AND r.source_id=%s
                    ORDER BY r.population_revision_id LIMIT 1""", (focal["source_id"],)).fetchone()
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
