"""Source-shaped AEDAR fixture -> R publisher -> disposable PostgreSQL -> HTTP."""
from __future__ import annotations

import os
import re
import subprocess
import tempfile
import uuid
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlencode, urlsplit, urlunsplit

import pytest

pytestmark = pytest.mark.integration


def test_aedar_r_publication_is_read_through_bounded_http():
    required = ("LUSK_TEST_PUBLISH_DSN", "LUSK_TEST_READ_DSN", "LUSK_TEST_READ_USER",
                "LUSK_TEST_DATABASE_NAME", "LUSK_TEST_DATABASE_PREFIX")
    if not all(os.getenv(k) for k in required):
        pytest.skip("requires explicitly configured disposable PostgreSQL publisher/read DSNs")
    assert os.environ["LUSK_TEST_DATABASE_PREFIX"] == "lusk_it_"
    assert os.environ["LUSK_TEST_DATABASE_NAME"].startswith("lusk_it_")
    psycopg = pytest.importorskip("psycopg")
    from fastapi.testclient import TestClient
    from api.main import app, pool

    root = Path(__file__).resolve().parents[3]
    pipeline = root / "pipeline"
    schema = "it_aedar_" + uuid.uuid4().hex[:16]

    def scoped(dsn):
        p = urlsplit(dsn); q = parse_qs(p.query); q["options"] = [f"-csearch_path={schema}"]
        return urlunsplit((p.scheme,p.netloc,p.path,urlencode(q,doseq=True),p.fragment))

    publish_dsn, read_dsn = os.environ["LUSK_TEST_PUBLISH_DSN"], os.environ["LUSK_TEST_READ_DSN"]
    publisher, reader = urlsplit(publish_dsn), urlsplit(read_dsn)
    database_name = os.environ["LUSK_TEST_DATABASE_NAME"]
    read_role = os.environ["LUSK_TEST_READ_USER"]
    allowed_hosts = {"localhost", "127.0.0.1", "::1", "192.168.1.120"}
    assert publisher.hostname in allowed_hosts and reader.hostname in allowed_hosts, \
        "integration DSNs must use loopback or the documented test PostgreSQL host"
    assert publisher.hostname == reader.hostname and publisher.port == reader.port
    assert publisher.path.lstrip("/") == database_name
    assert reader.path.lstrip("/") == database_name
    assert publisher.username and reader.username == read_role
    assert publisher.username != reader.username, "publisher and reader roles must differ"
    if publisher.hostname == "192.168.1.120":
        assert database_name == "lusk_it_contract"
        assert publisher.port == 5432
        assert publisher.username == "lusk_it_contract_pub"
        assert reader.username == "lusk_it_contract_read"

    pub = psycopg.connect(publish_dsn, autocommit=True)
    created = False
    try:
        assert pub.execute("SELECT current_database(),current_user").fetchone() == (
            database_name, publisher.username)
        with psycopg.connect(read_dsn) as identity:
            assert identity.execute("SELECT current_database(),current_user").fetchone() == (
                database_name, read_role)
        pub.execute(f'CREATE SCHEMA "{schema}"'); created = True
        pub.execute(f'SET search_path TO "{schema}"')
        pub.execute((root / "api/schema.sql").read_text(encoding="utf-8"))
        # Rehearse the actual additive migration against the disposable schema
        # as well as parsing the fresh-install DDL above.
        pub.execute((root / "api/migrations/028_aedar_territorial_aggregates.sql").read_text(encoding="utf-8"))
        assert re.fullmatch(r"[A-Za-z0-9_$-]+",read_role)
        pub.execute(f'GRANT USAGE ON SCHEMA "{schema}" TO "{read_role}"')
        pub.execute(f'GRANT SELECT ON ALL TABLES IN SCHEMA "{schema}" TO "{read_role}"')
        pub.execute("""INSERT INTO territory_reference(territory_id,territory_type,name) VALUES
          ('22001','commune','Fixture commune'),('200000001','epci','Fixture EPCI'),
          ('22','departement','Fixture département'),('53','region','Fixture région'),
          ('mob-1','commune','Mobility unchanged')""")
        pub.execute("UPDATE territory_reference SET density_class_code='fixture-density',density_class_label='Fixture density' WHERE territory_id='mob-1'")
        pub.execute("INSERT INTO table_publication(table_name,content_version,row_count) VALUES('territory_reference','fixture-ref-v1',5)")
        pub.execute("INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version) VALUES('essential_service_access','mobility-access-v1',3,'fixture-ref-v1')")
        pub.execute("INSERT INTO access_publication_metadata(singleton,bretagne_kind,bretagne_label) VALUES(true,'communes-bretagne','Fixture communes')")
        pub.execute("INSERT INTO service_registry(service) VALUES('fixture-service')")
        pub.execute("""INSERT INTO essential_service_access(territory_id,service,mode,share,indicator_label,effective_direction,
          source_id,source_name,source_version,reference_date,source_publication_date) VALUES
          ('mob-1','fixture-service','walk_transit',0.6,'Fixture access','high','fixture-mobility','Fixture incumbent mobility','v1',NULL,'2026-10-07'),
          ('mob-1','fixture-service','bike',0.4,'Fixture access','high','fixture-mobility','Fixture incumbent mobility','v1',NULL,'2026-10-07'),
          ('mob-1','fixture-service','car',0.8,'Fixture access','high','fixture-mobility','Fixture incumbent mobility','v1',NULL,'2026-10-07')""")
        pub.execute("INSERT INTO source_dataset(source_id,name) VALUES('fixture-mobility','Fixture incumbent mobility')")
        pub.execute("INSERT INTO source_vintage(source_id,vintage_id,version) VALUES('fixture-mobility','v1','v1')")
        pub.execute("""INSERT INTO mobility_reading_descriptor(singleton,descriptor_version,source_id,vintage_id,
          source_name,dataset_name,source_version,unit,direction,allowed_levels,missing_status,
          classification_values,field_keys,story_count,clock_count)
          VALUES(true,'fixture-desc-v1','fixture-mobility','v1','Fixture incumbent mobility','fixture','v1',
          'share','none',ARRAY['commune'],'unavailable',ARRAY['stable'],
          ARRAY['groupe','story_key','salience_reason','classification_saillance','div_loss_t','div_loss_b','status'],1,1)""")
        pub.execute("INSERT INTO mobility_reading_story(story_key,groupe,salience_reason,ordinal) VALUES('fixture-story','fixture-group','fixture',1)")
        pub.execute("INSERT INTO mobility_reading_clock(ordinal,clock_name,frequency,reference,trigger) VALUES(1,'fixture-clock','annual','fixture reference','fixture trigger')")
        pub.execute("INSERT INTO mobility_typed_reading(territory_id,territory_type,groupe,story_key,salience_reason,div_loss_t,div_loss_b,status,source_id,vintage_id) VALUES('mob-1','commune','fixture-group','fixture-story','fixture',0.4,0.2,'measured','fixture-mobility','v1')")
        pub.execute("INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version) VALUES('mobility_typed_reading','mobility-fixture-v1',1,'fixture-ref-v1')")

        rscript = r'''pkgload::load_all('.',quiet=TRUE)
schema <- Sys.getenv('AEDAR_IT_SCHEMA')
source_axis <- readr::read_csv(file.path("tests","testthat","fixtures","aedar-region-2026v1-typequ.csv"),
  col_types=readr::cols(.default=readr::col_character()),show_col_types=FALSE)
measures <- as.data.frame(matrix(0,nrow=nrow(source_axis),ncol=length(AEDAR_AGGREGATE_MEASURES),
  dimnames=list(NULL,AEDAR_AGGREGATE_MEASURES)))
measures$count_5_walk_share <- NA_real_
make <- function(level,idcol,id,namecol,name) {
  x <- measures
  for (nm in AEDAR_AGGREGATE_LEVEL_COLUMNS[[level]]) x[[nm]] <- NA
  x[[idcol]] <- id; x[['TYPEQU']] <- source_axis$TYPEQU; x[['LIB_TYPEQU']] <- source_axis$LIB_TYPEQU
  ids <- list(code_insee='22001',epci_code='200000001',code_departement='22',code_region='53')
  for (nm in intersect(names(ids),names(x))) x[[nm]] <- ids[[nm]]
  x[[idcol]] <- id
  x[['n_addresses']] <- 2L; x[['n_observed']] <- 1L; x[['coverage_status']] <- 'covered'
  if (!is.null(namecol)) x[[namecol]] <- name
  x
}
inputs <- list(
  commune=make('commune','code_insee','22001','nom_commune','Fixture commune'),
  epci=make('epci','epci_code','200000001','nom_epci','Fixture EPCI'),
  departement=make('departement','code_departement','22','nom_departement','Fixture département'),
  region=make('region','code_region','53','nom_region','Fixture région'))
projection <- project_aedar_aggregates(inputs)
canonical_dir <- tempfile('aedar-canonical-')
write_aedar_canonical(projection,canonical_dir)
projection <- read_aedar_canonical(canonical_dir)
con <- DBI::dbConnect(RPostgres::Postgres(),host=Sys.getenv('PGHOST'),port=as.integer(Sys.getenv('PGPORT')),
 dbname=Sys.getenv('PGDATABASE'),user=Sys.getenv('PGUSER'),password=Sys.getenv('PGPASSWORD'))
on.exit(DBI::dbDisconnect(con))
DBI::dbExecute(con,sprintf('SET search_path TO "%s"',schema))
first <- publish_aedar_aggregates(projection,con)
second <- publish_aedar_aggregates(projection,con)
stopifnot(first$changed,!second$changed,first$row_count==4L * nrow(source_axis))
before <- DBI::dbGetQuery(con,"SELECT content_version FROM table_publication WHERE table_name='aedar_territorial_aggregate'")$content_version[[1]]
DBI::dbExecute(con,"CREATE FUNCTION reject_aedar_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced rollback'; END $$")
DBI::dbExecute(con,"CREATE TRIGGER reject_aedar_insert BEFORE INSERT ON aedar_territorial_aggregate FOR EACH ROW EXECUTE FUNCTION reject_aedar_insert()")
projection$facts$count_5_walk_min[1] <- 7
failed <- tryCatch({publish_aedar_aggregates(projection,con); FALSE},error=function(e) TRUE)
DBI::dbExecute(con,"DROP TRIGGER reject_aedar_insert ON aedar_territorial_aggregate")
DBI::dbExecute(con,"DROP FUNCTION reject_aedar_insert()")
after <- DBI::dbGetQuery(con,"SELECT content_version FROM table_publication WHERE table_name='aedar_territorial_aggregate'")$content_version[[1]]
stopifnot(failed,identical(before,after),DBI::dbGetQuery(con,"SELECT count(*) n FROM aedar_territorial_aggregate")$n[[1]]==4L * nrow(source_axis))
'''
        with tempfile.TemporaryDirectory(prefix="aedar-it-",dir="E:/Temp/opencode") as tmp:
            script = Path(tmp) / "fixture.R"; script.write_text(rscript,encoding="utf-8")
            parts = urlsplit(publish_dsn)
            env = os.environ.copy(); env["AEDAR_IT_SCHEMA"] = schema
            env["PGHOST"] = parts.hostname or "localhost"; env["PGPORT"] = str(parts.port or 5432)
            env["PGDATABASE"] = parts.path.lstrip("/"); env["PGUSER"] = unquote(parts.username or "")
            env["PGPASSWORD"] = unquote(parts.password or "")
            done = subprocess.run(["Rscript",str(script)],cwd=pipeline,env=env,capture_output=True,text=True)
            assert done.returncode == 0, done.stdout + done.stderr

        dbread = psycopg.connect(scoped(read_dsn))
        class Connections:
            def connection(self):
                class Ctx:
                    def __enter__(self): return dbread
                    def __exit__(self,*_): pass
                return Ctx()
        # Route obtains the standard app pool; point it at the guarded reader DSN.
        pool.cache_clear()
        original_database_url=os.environ.get("DATABASE_URL")
        os.environ["DATABASE_URL"] = scoped(read_dsn)
        pool.cache_clear()
        try:
            with TestClient(app) as client:
                mobility_url="/api/territories/commune/mob-1/essential-services"
                mobility_before=client.get(mobility_url)
                assert mobility_before.status_code == 200, mobility_before.text
                for level, territory_id in (("commune","22001"),("epci","200000001"),("departement","22"),("region","53")):
                    resp = client.get(f"/api/aedar/territories/{level}/{territory_id}/aggregates?typequ=A104&limit=1")
                    assert resp.status_code == 200, resp.text
                    fact = resp.json()["facts"][0]
                    assert fact["measures"]["count_5_walk_share"] is None
                    assert fact["measures"]["count_5_walk_min"] == 0
                    assert fact["licence"] == "ODbL" and fact["publication_date"] == "2026-09-30"
                    assert fact["attribution"] == "© OpenStreetMap contributors; données AEDAR — licence ODbL"
                    assert resp.json()["content_version"]
                    assert resp.json()["reference_content_version"] == "fixture-ref-v1"
                assert client.get("/api/aedar/territories/region/53/aggregates?limit=101").status_code == 422
                mobility_after=client.get(mobility_url)
                assert mobility_after.status_code == 200, mobility_after.text
                assert mobility_after.json() == mobility_before.json()
                assert dbread.execute("SELECT div_loss_t,div_loss_b FROM mobility_typed_reading WHERE territory_id='mob-1'").fetchone() == (0.4,0.2)
        finally:
            dbread.close(); pool.cache_clear()
            if original_database_url is None: os.environ.pop("DATABASE_URL",None)
            else: os.environ["DATABASE_URL"]=original_database_url
    finally:
        if created: pub.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        pub.close()
