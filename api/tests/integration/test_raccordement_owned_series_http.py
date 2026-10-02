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
        pub.execute("INSERT INTO territory_reference(territory_id,territory_type,name,department_id,epci_id) VALUES('35238','commune','Rennes','35','243500139')")
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
        for key,territory,kind,values in (("raccordement_courbe","35238","commune",[.11,.19,.27,.35,.43,.55,.67,.79,.87,.93,.98]),
                                           ("raccordement_reference","53","region",[.02,.08,.16,.24,.33,.45,.59,.72,.82,.9,.96])):
            for axis,value in zip(axes,values):
                fixture.append({"key":key,"theme":"mobilite","detail":axis,"type":kind,"territoire":territory,
                    "value":value,"unit":"%","vintage_source":"fixture matrix","vintage_version":"2026-09-16",
                    "vintage_date_reference":"2026-08-25","vintage_date_publication":"2026-08-26"})
        canonical={"mobilite":{"indicateurs":pd.DataFrame(fixture)},"vintages":pd.DataFrame([
            {"id":"matrice_temps_mairies","source":"fixture matrix","version":"2026-09-16",
             "date_reference":"2026-08-25","date_publication":"2026-08-26"}])}
        metadata={"owned_series_routes":{"raccordement_courbe":{"dataset_id":"raccordement_curve",
            "active_read_route":True,"axis_kind":"duration_minute","axis_values":[0,15,30,45,60,90,120,180,240,300,360],
            "reference_indicator":"raccordement_reference","reference_id":"commune_bretonne_mediane",
            "reference_label":"Commune bretonne médiane","reference_role":"analytical_reference",
            "reference_statistic":"median_routed_communes","source_id":"matrice_temps_mairies"}},
            "indicator_pages":{"raccordement_courbe":{"comparison":{"detail":"t0090"},"label":"Courbe raccordement",
                "levels":["commune","epci","departement"]}},
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
            script.write_text('''args<-commandArgs(TRUE); root<-args[[1]]; payload<-jsonlite::read_json(args[[2]],simplifyVector=TRUE); metadata<-jsonlite::read_json(args[[3]],simplifyVector=FALSE); schema<-args[[4]];\nsource(file.path(root,"pipeline/R/publish_scalar.R")); source(file.path(root,"pipeline/R/publish_series.R"));\ncanonical<-list(mobilite=list(indicateurs=as.data.frame(payload$indicators)),vintages=as.data.frame(payload$vintages));\ncon<-DBI::dbConnect(RPostgres::Postgres(),dbname=Sys.getenv("LUSK_TEST_DATABASE_NAME"),host="192.168.1.120",port=5432,user="lusk_it_contract_pub"); DBI::dbExecute(con,sprintf("SET search_path TO \\\"%s\\\"",schema));\nregistry<-register_raccordement_owned_publisher(list(),metadata); result<-publish_registered_series(registry,"raccordement_courbe_owned",canonical,owned_series_postgres_adapter(con)); stopifnot(result$changed); DBI::dbDisconnect(con)\n''',encoding="utf-8")
            env=os.environ.copy(); env["PGPASSFILE"]=str(Path(os.environ["APPDATA"])/"PostgreSQL/pgpass.conf")
            env["R_LIBS_USER"]=str(Path(os.environ["LOCALAPPDATA"])/"R/cache/R/renv/library/pipeline-d149995d/windows/R-4.4/x86_64-w64-mingw32")
            completed=subprocess.run(["Rscript",str(script),str(root),str(payload_path),str(metadata_path),schema],cwd=root/"pipeline",env=env,capture_output=True,text=True)
            assert completed.returncode==0,completed.stdout+completed.stderr
        counts=pub.execute("SELECT row_count FROM series_dataset_publication WHERE dataset_id='raccordement_curve'").fetchone()
        assert counts==(22,)
        assert pub.execute("SELECT count(*) FROM series_dataset_observation WHERE territory_id='35238'").fetchone()==(11,)
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
        with pytest.raises(psycopg.errors.RaiseException):
            with pub.transaction():
                pub.execute("UPDATE series_dataset_publication SET published_at=transaction_timestamp() WHERE dataset_id='raccordement_curve'")
                pub.execute("DELETE FROM series_named_reference_provenance WHERE dataset_id='raccordement_curve' AND axis_value='t0000'")
        assert pub.execute("SELECT count(*) FROM series_named_reference_provenance").fetchone()==(11,)
        with pub.transaction():
            pub.execute("UPDATE series_dataset_publication SET published_at=transaction_timestamp() WHERE dataset_id='raccordement_curve'")
            pub.execute("UPDATE series_dataset_descriptor SET active_read_route=false WHERE dataset_id='raccordement_curve'")
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
        migration=(root/"api/migrations/015_owned_series_duration_reference.sql").read_text(encoding="utf-8")
        upgrade.execute(migration)
        assert upgrade.execute("SELECT value FROM series_dataset_observation WHERE dataset_id='conso_enaf_annuel'").fetchone()==(12.5,)
        assert upgrade.execute("SELECT active_read_route FROM series_dataset_descriptor WHERE dataset_id='conso_enaf_annuel'").fetchone()==(False,)
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
