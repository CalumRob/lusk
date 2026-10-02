"""Registered R publisher -> guarded PostgreSQL -> stable named-indicator HTTP read."""
import json
import os
import re
import subprocess
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

import pytest

pytestmark = pytest.mark.integration


def test_registered_r_curve_publication_is_read_by_stable_indicator_route():
    required = ["LUSK_TEST_PUBLISH_DSN", "LUSK_TEST_READ_DSN", "LUSK_TEST_DATABASE_NAME", "LUSK_TEST_DATABASE_PREFIX"]
    if not all(os.getenv(key) for key in required):
        pytest.skip("requires explicitly guarded private PostgreSQL test configuration")
    assert os.environ["LUSK_TEST_DATABASE_PREFIX"] == "lusk_it_"
    assert os.environ["LUSK_TEST_DATABASE_NAME"].startswith("lusk_it_")
    psycopg = pytest.importorskip("psycopg")
    from fastapi.testclient import TestClient
    from api.main import ReadRepository, app, get_repository, pool

    root = Path(__file__).resolve().parents[3]
    schema = "it_" + uuid.uuid4().hex[:20]
    def scoped(dsn):
        u=urlsplit(dsn); q=parse_qs(u.query); q["options"]=[f"-csearch_path={schema}"]
        return urlunsplit((u.scheme,u.netloc,u.path,urlencode(q,doseq=True),u.fragment))
    pub=psycopg.connect(os.environ["LUSK_TEST_PUBLISH_DSN"],autocommit=True)
    created=False
    upgrade_schema="it_"+uuid.uuid4().hex[:20]
    upgrade_created=False
    try:
        assert pub.execute("select current_database(),current_user").fetchone()==(
            os.environ["LUSK_TEST_DATABASE_NAME"],urlsplit(os.environ["LUSK_TEST_PUBLISH_DSN"]).username)
        with psycopg.connect(os.environ["LUSK_TEST_READ_DSN"]) as reader_identity:
            assert reader_identity.execute("select current_database(),current_user").fetchone()==(
                os.environ["LUSK_TEST_DATABASE_NAME"],urlsplit(os.environ["LUSK_TEST_READ_DSN"]).username)
        pub.execute(f'CREATE SCHEMA "{schema}"'); created=True
        pub.execute(f'SET search_path TO "{schema}"')
        pub.execute((root/"api/schema.sql").read_text(encoding="utf-8"))
        pub.execute("""INSERT INTO territory_reference(territory_id,territory_type,name,department_id,epci_id,density_class_code) VALUES
            ('35238','commune','Rennes','35','243500139','D1'),
            ('35001','commune','Peer one','35','243500139','D1'),
            ('35002','commune','Peer two','35','243500139','D1'),
            ('22001','commune','Other class','22','243500140','D2'),
            ('243500139','epci','EPCI one','35',NULL,NULL)""")
        pub.execute("INSERT INTO table_publication(table_name,content_version,row_count) VALUES('territory_reference','fixture-ref-v1',1)")
        role=os.environ.get("LUSK_TEST_READ_USER",urlsplit(os.environ["LUSK_TEST_READ_DSN"]).username)
        assert role and re.fullmatch(r"[A-Za-z0-9_$-]+",role)
        pub.execute(f'GRANT USAGE ON SCHEMA "{schema}" TO "{role}"')
        pub.execute(f'GRANT SELECT ON ALL TABLES IN SCHEMA "{schema}" TO "{role}"')
        class Connections:
            def connection(self):
                class Context:
                    def __enter__(self): self.conn=psycopg.connect(scoped(os.environ["LUSK_TEST_READ_DSN"])); return self.conn
                    def __exit__(self,*args): self.conn.close()
                return Context()
        app.dependency_overrides[get_repository]=lambda: ReadRepository(Connections())
        pool.cache_clear()
        with TestClient(app) as client:
            before_publication=client.get("/api/territories/commune/35238/indicators/raccordement_courbe")
        assert before_publication.status_code==404
        import pandas as pd
        axes=["t0000","t0015","t0030","t0045","t0060","t0090","t0120","t0180","t0240","t0300","t0360"]
        fixture=[]
        curve_rows=[("35238",[.11,.19,.27,.35,.43,.55,.67,.79,.87,.93,.98]),
                    ("35001",[.10,.18,.26,.34,.42,.50,.62,.74,.84,.92,.97]),
                    ("35002",[.09,.17,.25,.33,.41,.45,.57,.69,.79,.89,.95]),
                    ("22001",[.12,.20,.28,.36,.44,.99,.68,.80,.88,.94,.99])]
        for key,territory,kind,values in ([ ("raccordement_courbe",territory,"commune",values) for territory,values in curve_rows ]+
                                           [("raccordement_reference","53","region",[.02,.08,.16,.24,.33,.45,.59,.72,.82,.9,.96])]):
            for axis,value in zip(axes,values):
                fixture.append({"key":key,"theme":"mobilite","detail":axis,"type":kind,"territoire":territory,
                    "value":value,"unit":"%","rider":None,"vintage_source":"fixture matrix","vintage_version":"2026-09-16",
                    "vintage_date_reference":"2026-08-25","vintage_date_publication":"2026-08-26"})
        canonical={"mobilite":{"indicateurs":pd.DataFrame(fixture)},"vintages":pd.DataFrame([
            {"id":"matrice_temps_mairies","source":"fixture matrix","version":"2026-09-16",
             "date_reference":"2026-08-25","date_publication":"2026-08-26"}])}
        metadata={"theme":"mobilite","owned_series_routes":{"raccordement_courbe":{"dataset_id":"raccordement_curve",
            "theme_id":"mobilite","active_read_route":True,"axis_kind":"duration_minute","axis_values":[0,15,30,45,60,90,120,180,240,300,360],
            "reference_indicator":"raccordement_reference","reference_id":"commune_bretonne_mediane",
            "reference":{"id":"commune_bretonne_mediane","label":"Commune bretonne médiane",
                "role":"analytical_reference","statistic":"median_routed_communes"},"source_id":"matrice_temps_mairies"}},
            "indicator_pages":{"raccordement_courbe":{"indicator":"raccordement_courbe","unit":"%","direction":"high",
                "comparison":{"detail":"t0090","details":axes},"label":"Courbe raccordement",
                "sources":["matrice_temps_mairies"],"trajectory":{"reference":{"indicator":"raccordement_reference",
                    "territoire":"53","label":"Commune bretonne médiane"}},"levels":["commune"]}},
            "source_records":{"matrice_temps_mairies":{"dataset":"Matrice temps fixture"}}}
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            canonical_path=Path(directory)/"canonical.rds"
            metadata_path=Path(directory)/"metadata.json"
            # Python writes interchange JSON; R reconstructs the data frames before invoking the registered publisher.
            payload_path=Path(directory)/"payload.json"
            payload_path.write_text(json.dumps({"indicators":fixture,"vintages":canonical["vintages"].to_dict("records")}),encoding="utf-8")
            metadata_path.write_text(json.dumps(metadata,ensure_ascii=False),encoding="utf-8")
            script=Path(directory)/"publish.R"
            script.write_text('''args<-commandArgs(TRUE); root<-args[[1]]; payload<-jsonlite::read_json(args[[2]],simplifyVector=TRUE); metadata<-jsonlite::read_json(args[[3]],simplifyVector=FALSE); schema<-args[[4]];\nsource(file.path(root,"pipeline/R/publish_scalar.R")); source(file.path(root,"pipeline/R/publish_series.R"));\ncanonical<-list(mobilite=list(indicateurs=as.data.frame(payload$indicators)),vintages=as.data.frame(payload$vintages));\ncon<-DBI::dbConnect(RPostgres::Postgres(),dbname=Sys.getenv("LUSK_TEST_DATABASE_NAME"),host="192.168.1.120",port=5432,user="lusk_it_contract_pub"); DBI::dbExecute(con,sprintf("SET search_path TO \\\"%s\\\"",schema));\nregistry<-register_raccordement_owned_publisher(list(),metadata); adapter<-owned_series_postgres_adapter(con); result<-publish_registered_series(registry,"raccordement_courbe_owned",canonical,adapter); stopifnot(result$changed); retry<-publish_registered_series(registry,"raccordement_courbe_owned",canonical,adapter); stopifnot(!retry$changed); DBI::dbDisconnect(con)\n''',encoding="utf-8")
            env=os.environ.copy(); env["PGPASSFILE"]=str(Path(os.environ["APPDATA"])/"PostgreSQL/pgpass.conf")
            env["R_LIBS_USER"]=str(Path(os.environ["LOCALAPPDATA"])/"R/cache/R/renv/library/pipeline-d149995d/windows/R-4.4/x86_64-w64-mingw32")
            completed=subprocess.run(["Rscript",str(script),str(root),str(payload_path),str(metadata_path),schema],cwd=root/"pipeline",env=env,capture_output=True,text=True)
            assert completed.returncode==0,completed.stdout+completed.stderr
        counts=pub.execute("SELECT row_count FROM series_dataset_publication WHERE dataset_id='raccordement_curve'").fetchone()
        assert counts==(55,)
        assert pub.execute("SELECT count(*) FROM series_dataset_observation WHERE indicator_id='raccordement_courbe'").fetchone()==(44,)
        assert pub.execute("SELECT count(*) FROM series_named_reference WHERE reference_id='commune_bretonne_mediane'").fetchone()==(11,)
        assert pub.execute("SELECT count(*) FROM territory_reference WHERE territory_id='53'").fetchone()==(0,)
        # A conflicting legacy descriptor is deliberately present. Only the
        # explicit owned route declaration may choose the owned dataset.
        pub.execute("INSERT INTO source_dataset(source_id,name) VALUES('legacy','Legacy')")
        pub.execute("INSERT INTO source_vintage(source_id,vintage_id,version) VALUES('legacy','v1','v1')")
        pub.execute("INSERT INTO series_descriptor(indicator_id,axis_kind,axis_values,completeness,comparison_point,allowed_levels,label,unit,direction,source_id,vintage_id,descriptor_version) VALUES('raccordement_courbe','year',ARRAY['2020'],'may_be_missing','2020',ARRAY['commune'],'Legacy curve','%', 'high','legacy','v1','1')")
        with TestClient(app) as client:
            response=client.get("/api/territories/commune/35238/indicators/raccordement_courbe")
        assert response.status_code==200,response.text
        body=response.json()
        assert [p["axis"] for p in body["points"]]==axes
        assert body["axis_numeric_values"]==[0,15,30,45,60,90,120,180,240,300,360]
        assert [p["value"] for p in body["points"]]==[.11,.19,.27,.35,.43,.55,.67,.79,.87,.93,.98]
        assert body["scope_series"]==[]
        assert body["named_references"][0]["id"]=="commune_bretonne_mediane"
        assert body["named_references"][0]["statistic"]=="median_routed_communes"
        assert [p["value"] for p in body["named_references"][0]["points"]]==[.02,.08,.16,.24,.33,.45,.59,.72,.82,.9,.96]
        assert all(p["provenance"][0]["source_id"]=="matrice_temps_mairies" for p in body["points"])
        with TestClient(app) as client:
            theme=client.get("/api/territories/commune/35238/themes/mobilite/facts")
            comparison=client.post("/api/territories/commune/35238/indicators/raccordement_courbe/comparison",
                json={"selection":[{"territory_type":"epci","territory_id":"243500139"},
                                    {"territory_type":"commune","territory_id":"35001"}]})
            cross_class=client.post("/api/territories/commune/35238/indicators/raccordement_courbe/comparison",
                json={"selection":[{"territory_type":"epci","territory_id":"243500139"},
                                    {"territory_type":"commune","territory_id":"22001"}]})
            outside_group=client.post("/api/territories/commune/35238/indicators/raccordement_courbe/comparison",
                json={"selection":[{"territory_type":"commune","territory_id":"35001"},
                                    {"territory_type":"commune","territory_id":"22001"}]})
            single=client.post("/api/territories/commune/35238/indicators/raccordement_courbe/comparison",
                json={"selection":[{"territory_type":"commune","territory_id":"35001"}]})
            empty=client.post("/api/territories/commune/35238/indicators/raccordement_courbe/comparison",
                json={"selection":[]})
            theme_comparison=client.post("/api/territories/commune/35238/themes/mobilite/comparison",
                json={"theme_id":"mobilite","selection":[]})
        assert theme.status_code==200,theme.text
        assert len(theme.json()["series"])==1 and len(theme.json()["series"][0]["points"])==11
        assert theme.json()["default_comparison"]["results"][0]["median"]==.5
        assert comparison.status_code==200,comparison.text
        assert comparison.json()["scope"]["member_count"]==3
        assert comparison.json()["result"]["median"]==.5
        assert "points" not in comparison.json() and "focal_value" not in comparison.json()["result"]
        assert "named_references" not in comparison.json()
        assert cross_class.status_code==200 and cross_class.json()["scope"]["member_count"]==4
        assert cross_class.json()["result"]["median"]==.525
        assert outside_group.status_code==200 and outside_group.json()["result"]["rank"] is None
        assert "focal_value" not in outside_group.json()["result"]
        assert single.status_code==200 and single.json()["result"]["status"]=="unavailable"
        assert single.json()["result"]["reason"]=="fewer_than_two_comparable_values"
        assert empty.status_code==200 and empty.json()["result"]["median"] is None
        assert empty.json()["result"]["status"]=="unavailable"
        assert "focal_value" not in empty.json()["result"]
        assert theme_comparison.status_code==200 and theme_comparison.json()["results"][0]["median"] is None
        assert "focal_value" not in theme_comparison.json()["results"][0]
        with TestClient(app) as client:
            wrong_type=client.get("/api/territories/epci/35238/indicators/raccordement_courbe")
        assert wrong_type.status_code==422
        with pytest.raises(psycopg.errors.RaiseException):
            with pub.transaction():
                pub.execute("UPDATE series_dataset_publication SET published_at=transaction_timestamp() WHERE dataset_id='raccordement_curve'")
                pub.execute("INSERT INTO series_named_reference(dataset_id,indicator_id,reference_id,axis_value,observation_period,value,status) VALUES('raccordement_curve','raccordement_courbe','commune_bretonne_mediane','t9999','2026-09-16',0.1,'measured')")
        with pytest.raises(psycopg.errors.RaiseException):
            with pub.transaction():
                pub.execute("UPDATE series_dataset_publication SET published_at=transaction_timestamp() WHERE dataset_id='raccordement_curve'")
                pub.execute("DELETE FROM series_named_reference WHERE dataset_id='raccordement_curve' AND axis_value='t0000'")
        with pytest.raises(psycopg.errors.RaiseException):
            with pub.transaction():
                pub.execute("UPDATE series_dataset_publication SET published_at=transaction_timestamp() WHERE dataset_id='raccordement_curve'")
                pub.execute("UPDATE series_dataset_descriptor SET axis_numeric_values=ARRAY[0,15,30,45,60,90,120,180,300,240,360] WHERE dataset_id='raccordement_curve'")
        before_rollback=(pub.execute("SELECT content_version,reference_content_version,row_count FROM series_dataset_publication WHERE dataset_id='raccordement_curve'").fetchone(),
            pub.execute("SELECT count(*) FROM series_dataset_observation WHERE dataset_id='raccordement_curve'").fetchone(),
            pub.execute("SELECT count(*) FROM series_named_reference WHERE dataset_id='raccordement_curve'").fetchone(),
            pub.execute("SELECT count(*) FROM series_named_reference_provenance WHERE dataset_id='raccordement_curve'").fetchone())
        with pytest.raises(psycopg.errors.RaiseException):
            with pub.transaction():
                pub.execute("DELETE FROM series_dataset_publication WHERE dataset_id='raccordement_curve'")
                pub.execute("INSERT INTO series_dataset_publication(dataset_id,content_version,reference_content_version,row_count) VALUES('raccordement_curve','partial','fixture-ref-v1',55)")
        after_rollback=(pub.execute("SELECT content_version,reference_content_version,row_count FROM series_dataset_publication WHERE dataset_id='raccordement_curve'").fetchone(),
            pub.execute("SELECT count(*) FROM series_dataset_observation WHERE dataset_id='raccordement_curve'").fetchone(),
            pub.execute("SELECT count(*) FROM series_named_reference WHERE dataset_id='raccordement_curve'").fetchone(),
            pub.execute("SELECT count(*) FROM series_named_reference_provenance WHERE dataset_id='raccordement_curve'").fetchone())
        assert after_rollback==before_rollback
        # Independent canonical-data audit plus a second publication using the
        # real Parquet, vintage and producer metadata artifacts.
        canonical_dir=Path(os.environ.get("LUSK_TEST_CANONICAL_DATA_DIR",r"E:\Lusk\public\data"))
        metadata_file=root/"pipeline/inst/extdata/theme-metadata/theme_mobilite.json"
        canonical_files={name:canonical_dir/f"{name}.parquet" for name in
            ("indicateurs_mobilite","territoires","vintages")}
        assert all(path.is_file() for path in canonical_files.values()),f"Missing canonical artifacts under {canonical_dir}"
        import pandas as pd
        metadata=json.loads(metadata_file.read_text(encoding="utf-8"))
        route=metadata["owned_series_routes"]["raccordement_courbe"]
        canonical_dataset_id=route["dataset_id"]
        page=metadata["indicator_pages"]["raccordement_courbe"]
        axes=[f"t{int(value):04d}" for value in route["axis_values"]]
        canonical_indicators=pd.read_parquet(canonical_files["indicateurs_mobilite"])
        canonical_territories=pd.read_parquet(canonical_files["territoires"])
        canonical_vintages=pd.read_parquet(canonical_files["vintages"])
        raw_curve=canonical_indicators[canonical_indicators.key==page["indicator"]].copy()
        raw_reference=canonical_indicators[canonical_indicators.key==route["reference_indicator"]].copy()
        expected_curve=raw_curve[raw_curve.type.isin(page["levels"])].copy()
        excluded_curve=raw_curve[~raw_curve.type.isin(page["levels"])].copy()
        expected_curve["axis_value"]=expected_curve.detail.astype(str)
        raw_reference["axis_value"]=raw_reference.detail.astype(str)
        assert len(excluded_curve)==11 and set(excluded_curve.type)=={"region"}
        assert set(raw_curve.unit)=={page["unit"]} and set(raw_reference.unit)=={page["unit"]}
        assert set(expected_curve.axis_value)==set(axes) and set(raw_reference.axis_value)==set(axes)
        expected_territories=set(canonical_territories.loc[
            canonical_territories.type.isin(page["levels"]),"territoire"].astype(str))
        assert set(expected_curve.territoire.astype(str))==expected_territories
        expected_counts=expected_curve.groupby(["territoire","type"]).size()
        assert expected_counts.eq(len(axes)).all()
        # Replace only this private rehearsal dataset, then bind all canonical
        # territory IDs to a private reference marker matching that universe.
        pub.execute("DELETE FROM series_dataset_publication WHERE dataset_id='raccordement_curve'")
        territory_records=[]
        for row in canonical_territories.to_dict("records"):
            territory_records.append((str(row["territoire"]),str(row["type"]),str(row["nom"]),
                None if pd.isna(row.get("departement")) else str(row["departement"]),
                None if pd.isna(row.get("epci")) else str(row["epci"]),
                None if pd.isna(row.get("classe_densite_code")) else str(row["classe_densite_code"])))
        with pub.cursor() as cursor:
            cursor.executemany("""INSERT INTO territory_reference(territory_id,territory_type,name,department_id,epci_id,density_class_code)
            VALUES(%s,%s,%s,%s,%s,%s) ON CONFLICT(territory_id) DO UPDATE SET territory_type=excluded.territory_type,
            name=excluded.name,department_id=excluded.department_id,epci_id=excluded.epci_id,
            density_class_code=excluded.density_class_code""",territory_records)
        territory_ids=[row[0] for row in territory_records]
        pub.execute("DELETE FROM territory_reference WHERE NOT (territory_id=ANY(%s))",(territory_ids,))
        pub.execute("UPDATE table_publication SET content_version='canonical-reference-v1',row_count=%s WHERE table_name='territory_reference'",
                    (len(territory_records),))
        with tempfile.TemporaryDirectory() as directory:
            canonical_script=Path(directory)/"publish_canonical.R"
            canonical_script.write_text('''args<-commandArgs(TRUE); root<-args[[1]]; data_dir<-args[[2]]; metadata_path<-args[[3]]; schema<-args[[4]];\nsource(file.path(root,"pipeline/R/publish_scalar.R")); source(file.path(root,"pipeline/R/publish_series.R"));\nmetadata<-jsonlite::read_json(metadata_path,simplifyVector=FALSE); canonical<-list(mobilite=list(indicateurs=nanoparquet::read_parquet(file.path(data_dir,"indicateurs_mobilite.parquet"))),vintages=nanoparquet::read_parquet(file.path(data_dir,"vintages.parquet")));\ncon<-DBI::dbConnect(RPostgres::Postgres(),dbname=Sys.getenv("LUSK_TEST_DATABASE_NAME"),host="192.168.1.120",port=5432,user="lusk_it_contract_pub"); DBI::dbExecute(con,sprintf("SET search_path TO \\\"%s\\\"",schema));\nregistry<-register_raccordement_owned_publisher(list(),metadata); result<-publish_registered_series(registry,"raccordement_courbe_owned",canonical,owned_series_postgres_adapter(con)); stopifnot(result$changed); DBI::dbDisconnect(con)\n''',encoding="utf-8")
            env=os.environ.copy(); env["PGPASSFILE"]=str(Path(os.environ["APPDATA"])/"PostgreSQL/pgpass.conf")
            env["R_LIBS_USER"]=str(Path(os.environ["LOCALAPPDATA"])/"R/cache/R/renv/library/pipeline-d149995d/windows/R-4.4/x86_64-w64-mingw32")
            completed=subprocess.run(["Rscript",str(canonical_script),str(root),str(canonical_dir),str(metadata_file),schema],
                cwd=root/"pipeline",env=env,capture_output=True,text=True)
            assert completed.returncode==0,completed.stdout+completed.stderr
        assert pub.execute("SELECT row_count FROM series_dataset_publication WHERE dataset_id=%s",(canonical_dataset_id,)).fetchone()==(len(expected_curve)+len(raw_reference),)
        sql_curve=pub.execute("""SELECT o.territory_id,o.territory_type,o.axis_value,o.observation_period,o.value,o.status,o.missing_reason,
            p.source_id,p.vintage_id,p.source_name,p.dataset_name,p.source_version,p.reference_date,p.publication_date,p.revision_hash
            FROM series_dataset_observation o JOIN series_observation_provenance a USING(dataset_id,indicator_id,territory_id,axis_value)
            JOIN series_provenance_revision p USING(provenance_revision_id) WHERE o.dataset_id=%s""",(canonical_dataset_id,)).fetchall()
        expected_map={(str(row.territoire),str(row.type),str(row.axis_value)):row
            for row in expected_curve.itertuples(index=False)}
        assert len(sql_curve)==len(expected_map)
        vintage=canonical_vintages[canonical_vintages.id==route["source_id"]].iloc[0]
        source_record=metadata["source_records"][route["source_id"]]
        linked_revisions=set()
        for row in sql_curve:
            territory,level,axis,period,value,status,reason,source_id,vintage_id,source_name,dataset_name,source_version,ref_date,pub_date,revision_hash=row
            raw=expected_map[(territory,level,axis)]
            assert period==str(vintage.version) and source_id==route["source_id"] and vintage_id==str(vintage.version)
            assert source_name==str(vintage.source) and dataset_name==source_record["dataset"]
            assert source_version==str(vintage.version) and str(ref_date)==str(vintage.date_reference) and str(pub_date)==str(vintage.date_publication)
            assert revision_hash and len(revision_hash) in (32,64)
            linked_revisions.add(revision_hash)
            assert status==("missing" if pd.isna(raw.value) else "measured")
            assert value==(None if pd.isna(raw.value) else float(raw.value))
            assert reason==(None if pd.isna(raw.rider) else str(raw.rider))
        assert len(linked_revisions)==1
        sql_reference=pub.execute("""SELECT d.reference_id,d.reference_label,d.reference_role,d.reference_statistic,
            r.axis_value,r.observation_period,r.value,r.status,r.missing_reason,p.source_id,p.vintage_id,p.source_name,
            p.dataset_name,p.source_version,p.reference_date,p.publication_date,p.revision_hash
            FROM series_named_reference_descriptor d JOIN series_named_reference r USING(dataset_id,indicator_id,reference_id)
            JOIN series_named_reference_provenance a USING(dataset_id,indicator_id,reference_id,axis_value)
            JOIN series_provenance_revision p USING(provenance_revision_id) WHERE d.dataset_id=%s""",(canonical_dataset_id,)).fetchall()
        reference_contract=route["reference"]
        assert len(sql_reference)==len(raw_reference)==11
        assert pub.execute("SELECT count(*) FROM information_schema.columns WHERE table_schema=%s AND table_name='series_named_reference' AND column_name='territory_id'",(schema,)).fetchone()==(0,)
        expected_ref={str(row.axis_value):row for row in raw_reference.itertuples(index=False)}
        for row in sql_reference:
            rid,label,role,statistic,axis,period,value,status,reason,source_id,vintage_id,source_name,dataset_name,source_version,ref_date,pub_date,revision_hash=row
            raw=expected_ref[axis]
            assert (rid,label,role,statistic)==(reference_contract["id"],reference_contract["label"],reference_contract["role"],reference_contract["statistic"])
            assert period==str(vintage.version) and source_id==route["source_id"] and vintage_id==str(vintage.version)
            assert status==("missing" if pd.isna(raw.value) else "measured")
            assert value==(None if pd.isna(raw.value) else float(raw.value))
            assert reason is None
            assert (source_name,dataset_name,source_version,str(ref_date),str(pub_date))==(
                str(vintage.source),source_record["dataset"],str(vintage.version),str(vintage.date_reference),
                str(vintage.date_publication))
            assert revision_hash in linked_revisions
        assert pub.execute("SELECT count(*) FROM series_dataset_observation WHERE territory_type='region'").fetchone()==(0,)
        descriptor=pub.execute("""SELECT axis_kind,axis_values,axis_numeric_values,completeness,comparison_point,
            unit,direction,allowed_levels,active_read_route,theme_id FROM series_dataset_descriptor
            WHERE dataset_id=%s AND indicator_id=%s""",(canonical_dataset_id,page["indicator"])).fetchone()
        assert descriptor==("duration_minute",axes,[int(value) for value in route["axis_values"]],
            "dense_complete",page["comparison"]["detail"],page["unit"],page["direction"],page["levels"],True,metadata["theme"])
        with TestClient(app) as client:
            canonical_http=client.get("/api/territories/commune/35238/indicators/raccordement_courbe")
        assert canonical_http.status_code==200,canonical_http.text
        ren_expected=expected_curve[expected_curve.territoire.astype(str)=="35238"].set_index("axis_value").loc[axes]
        assert [point["axis"] for point in canonical_http.json()["points"]]==axes
        assert [point["value"] for point in canonical_http.json()["points"]]==[
            None if pd.isna(value) else float(value) for value in ren_expected.value]
        assert [point["status"] for point in canonical_http.json()["points"]]==[
            "missing" if pd.isna(value) else "measured" for value in ren_expected.value]
        assert [point["missing_reason"] for point in canonical_http.json()["points"]]==[
            None if pd.isna(row.rider) else str(row.rider) for row in ren_expected.itertuples()]
        pub.execute("UPDATE table_publication SET content_version='stale-reference-v1' WHERE table_name='territory_reference'")
        with TestClient(app) as client:
            stale=client.get("/api/territories/commune/35238/indicators/raccordement_courbe")
        assert stale.status_code==503
        pub.execute("UPDATE table_publication SET content_version='canonical-reference-v1' WHERE table_name='territory_reference'")
        with pytest.raises(psycopg.errors.RaiseException):
            with pub.transaction():
                pub.execute("UPDATE series_dataset_publication SET published_at=transaction_timestamp() WHERE dataset_id=%s",(canonical_dataset_id,))
                pub.execute("DELETE FROM series_named_reference_provenance WHERE dataset_id=%s AND axis_value='t0000'",(canonical_dataset_id,))
        assert pub.execute("SELECT count(*) FROM series_named_reference_provenance").fetchone()==(11,)
        with pub.transaction():
            pub.execute("UPDATE series_dataset_publication SET published_at=transaction_timestamp() WHERE dataset_id=%s",(canonical_dataset_id,))
            pub.execute("UPDATE series_dataset_descriptor SET active_read_route=false WHERE dataset_id=%s",(canonical_dataset_id,))
        with TestClient(app) as client:
            unavailable=client.get("/api/territories/commune/35238/indicators/raccordement_courbe")
        assert unavailable.status_code==503
        # Rehearse migration 015 over a genuinely populated pre-015 schema from
        # this branch's base commit; existing ENAF ownership must survive intact.
        upgrade=psycopg.connect(os.environ["LUSK_TEST_PUBLISH_DSN"],autocommit=True)
        upgrade.execute(f'CREATE SCHEMA "{upgrade_schema}"'); upgrade_created=True
        upgrade.execute(f'SET search_path TO "{upgrade_schema}"')
        prior=subprocess.run(["git","show","2e09a0369f33557167c11903decba5fc754c8607:api/schema.sql"],
            cwd=root,capture_output=True,text=True,check=True).stdout
        upgrade.execute(prior)
        upgrade.execute("INSERT INTO territory_reference(territory_id,territory_type,name) VALUES('35238','commune','Rennes')")
        upgrade.execute("INSERT INTO table_publication(table_name,content_version,row_count) VALUES('territory_reference','upgrade-ref',1)")
        with upgrade.transaction():
            upgrade.execute("INSERT INTO series_provenance_revision VALUES('rev','src','v1','Source','Dataset','v1','2025-01-01','2025-02-01','hash')")
            upgrade.execute("INSERT INTO series_dataset_publication(dataset_id,content_version,reference_content_version,row_count) VALUES('conso_enaf_annuel','old-version','upgrade-ref',1)")
            upgrade.execute("INSERT INTO series_dataset_descriptor(dataset_id,indicator_id,axis_kind,axis_values,completeness,comparison_point,label,unit,direction,allowed_levels,descriptor_version) VALUES('conso_enaf_annuel','conso_enaf_annuel','year',ARRAY['2024'],'may_be_missing','2024','ENAF','ha','low',ARRAY['commune'],'1')")
            upgrade.execute("INSERT INTO series_dataset_observation(dataset_id,indicator_id,territory_id,territory_type,axis_value,observation_period,value,status) VALUES('conso_enaf_annuel','conso_enaf_annuel','35238','commune','2024','2024',12.5,'measured')")
            upgrade.execute("INSERT INTO series_observation_provenance VALUES('conso_enaf_annuel','conso_enaf_annuel','35238','2024','rev')")
            upgrade.execute("INSERT INTO series_dataset_publication(dataset_id,content_version,reference_content_version,row_count) VALUES('artif_par_habitant','old-state','upgrade-ref',2)")
            upgrade.execute("INSERT INTO series_dataset_descriptor(dataset_id,indicator_id,axis_kind,axis_values,completeness,comparison_point,label,unit,direction,allowed_levels,descriptor_version) VALUES('artif_par_habitant','artif_par_habitant','declared_detail',ARRAY['M2','M3'],'dense_complete',NULL,'Artificialisation','m²/hab','none',ARRAY['commune'],'1')")
            upgrade.execute("INSERT INTO series_dataset_observation(dataset_id,indicator_id,territory_id,territory_type,axis_value,state_role,observation_period,value,status) VALUES('artif_par_habitant','artif_par_habitant','35238','commune','M2','M2','2023',2.5,'measured'),('artif_par_habitant','artif_par_habitant','35238','commune','M3','M3','2023',3.5,'measured')")
            upgrade.execute("INSERT INTO series_observation_provenance VALUES('artif_par_habitant','artif_par_habitant','35238','M2','rev'),('artif_par_habitant','artif_par_habitant','35238','M3','rev')")
        migration=(root/"api/migrations/015_owned_series_duration_reference.sql").read_text(encoding="utf-8")
        upgrade.execute(migration)
        assert upgrade.execute("SELECT value FROM series_dataset_observation WHERE dataset_id='conso_enaf_annuel'").fetchone()==(12.5,)
        assert upgrade.execute("SELECT active_read_route FROM series_dataset_descriptor WHERE dataset_id='conso_enaf_annuel'").fetchone()==(False,)
        assert upgrade.execute("SELECT array_agg(state_role ORDER BY state_role) FROM series_dataset_observation WHERE dataset_id='artif_par_habitant'").fetchone()==(["M2","M3"],)
        upgrade.close()
    finally:
        app.dependency_overrides.pop(get_repository,None); pool.cache_clear(); pub.close()
        if created and os.environ.get("LUSK_TEST_ALLOW_SCHEMA_CLEANUP")=="1":
            # The rehearsal schema is private and random; dependency-ordered RESTRICT is intentional.
            cleanup=psycopg.connect(os.environ["LUSK_TEST_PUBLISH_DSN"],autocommit=True)
            tables=[r[0] for r in cleanup.execute("select tablename from pg_tables where schemaname=%s",(schema,)).fetchall()]
            pending=tables[:]
            while pending:
                rest=[]
                for table in pending:
                    try: cleanup.execute(f'DROP TABLE "{schema}"."{table}" RESTRICT')
                    except psycopg.Error: rest.append(table)
                if len(rest)==len(pending): raise RuntimeError(f"Could not RESTRICT-clean rehearsal relations: {rest}")
                pending=rest
            functions=cleanup.execute("select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=%s",(schema,)).fetchall()
            for (function,) in functions:
                cleanup.execute(f'DROP FUNCTION "{schema}"."{function.split("(",1)[0].split(".")[-1]}" RESTRICT')
            cleanup.execute(f'DROP SCHEMA "{schema}" RESTRICT'); cleanup.close()
        if upgrade_created and os.environ.get("LUSK_TEST_ALLOW_SCHEMA_CLEANUP")=="1":
            cleanup=psycopg.connect(os.environ["LUSK_TEST_PUBLISH_DSN"],autocommit=True)
            tables=[r[0] for r in cleanup.execute("select tablename from pg_tables where schemaname=%s",(upgrade_schema,)).fetchall()]
            pending=tables[:]
            while pending:
                rest=[]
                for table in pending:
                    try: cleanup.execute(f'DROP TABLE "{upgrade_schema}"."{table}" RESTRICT')
                    except psycopg.Error: rest.append(table)
                if len(rest)==len(pending): raise RuntimeError(f"Could not RESTRICT-clean migration schema: {rest}")
                pending=rest
            functions=cleanup.execute("select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=%s",(upgrade_schema,)).fetchall()
            for (function,) in functions:
                cleanup.execute(f'DROP FUNCTION "{upgrade_schema}"."{function.split("(",1)[0].split(".")[-1]}" RESTRICT')
            cleanup.execute(f'DROP SCHEMA "{upgrade_schema}" RESTRICT'); cleanup.close()
