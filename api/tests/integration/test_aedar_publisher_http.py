"""Source-shaped AEDAR fixture -> R publisher -> disposable PostgreSQL -> HTTP."""
from __future__ import annotations

import os
import json
import re
import subprocess
import tempfile
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlencode, urlsplit, urlunsplit

import pytest

pytestmark = pytest.mark.integration


def test_aedar_r_publication_is_read_through_bounded_http():
    phase = os.getenv("AEDAR_IT_PHASE", "semantic")
    if phase not in {"semantic", "full-audit"}:
        raise AssertionError("AEDAR_IT_PHASE must be semantic or full-audit")
    required = ("LUSK_TEST_PUBLISH_DSN", "LUSK_TEST_READ_DSN", "LUSK_TEST_READ_USER",
                "LUSK_TEST_DATABASE_NAME", "LUSK_TEST_DATABASE_PREFIX")
    if not all(os.getenv(k) for k in required):
        pytest.skip("requires explicitly configured disposable PostgreSQL publisher/read DSNs")
    from api.tests.integration.test_postgres_publication import (
        _aedar_guarded_configuration, _assert_aedar_server_identity)
    publish_dsn, read_dsn = _aedar_guarded_configuration()
    psycopg = pytest.importorskip("psycopg")
    from fastapi.testclient import TestClient
    from api.main import app, pool

    root = Path(__file__).resolve().parents[3]
    pipeline = root / "pipeline"
    schema = "it_aedar_" + uuid.uuid4().hex[:16]

    def scoped(dsn):
        p = urlsplit(dsn); q = parse_qs(p.query); q["options"] = [f"-csearch_path={schema}"]
        return urlunsplit((p.scheme,p.netloc,p.path,urlencode(q,doseq=True),p.fragment))

    publisher, reader = urlsplit(publish_dsn), urlsplit(read_dsn)
    database_name = os.environ["LUSK_TEST_DATABASE_NAME"]
    read_role = os.environ["LUSK_TEST_READ_USER"]
    assert publisher.hostname == reader.hostname and publisher.port == reader.port
    assert publisher.path.lstrip("/") == database_name
    assert reader.path.lstrip("/") == database_name
    assert publisher.username and reader.username == read_role
    assert publisher.username != reader.username, "publisher and reader roles must differ"
    pub = psycopg.connect(publish_dsn, autocommit=True)
    fixture_tmp = Path(tempfile.mkdtemp(prefix="aedar-it-",dir="E:/Temp/opencode"))
    evidence_manifest = fixture_tmp / "schema-intent.json"
    evidence_manifest.write_text(json.dumps({"schema":schema,"database":database_name,
        "publisher_role":publisher.username,"reader_role":read_role,
        "purpose":"issue-810 AEDAR reference-only guarded proof"},indent=2),encoding="utf-8")
    print(f"AEDAR guarded namespace recorded before DDL: {schema} ({evidence_manifest})",flush=True)
    try:
        _assert_aedar_server_identity(pub, publisher.username)
        with psycopg.connect(read_dsn) as identity:
            _assert_aedar_server_identity(identity, read_role)
        pub.execute(f'CREATE SCHEMA "{schema}"')
        pub.execute(f'SET search_path TO "{schema}"')
        baseline = subprocess.check_output(
            ["git", "show", "75b6ad661d8ab677c33c73152598d097590c7886:api/schema.sql"],
            cwd=root, text=True, encoding="utf-8")
        pub.execute(baseline)
        assert re.fullmatch(r"[A-Za-z0-9_$-]+",read_role)
        pub.execute(f'GRANT USAGE ON SCHEMA "{schema}" TO "{read_role}"')
        pub.execute(f'GRANT SELECT ON territory_reference,table_publication,aedar_territorial_aggregate,aedar_comparison_publication,aedar_comparison_group TO "{read_role}"')
        pub.execute("""INSERT INTO territory_reference(territory_id,territory_type,name) VALUES
          ('22001','commune','Fixture commune'),('200000001','epci','Fixture EPCI'),
          ('22','departement','Fixture département'),('53','region','Fixture région'),
          ('mob-1','commune','Mobility unchanged')""")
        pub.execute("UPDATE territory_reference SET density_class_code=CASE WHEN territory_id='22001' THEN '1' ELSE '2' END,density_class_label='Fixture density',epci_id='200000001' WHERE territory_type='commune'")
        pub.execute("INSERT INTO table_publication(table_name,content_version,row_count) VALUES('territory_reference','fixture-ref-v1',5)")
        # Seed a one-row legacy generation on the pre-040 schema. Its marker
        # and dependencies satisfy the old trigger without manufacturing peers.
        pub.execute("""INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version)
            VALUES('aedar_territorial_aggregate',%s,0,'fixture-ref-v1')""", ("a"*64,))
        pub.execute("""INSERT INTO aedar_comparison_group(comparison_context,group_id,territory_type,
            typequ,measure,statistic,value,n_addresses,n_observed,coverage_status,
            member_count,eligible_count,missing_count)
            VALUES('density_class','1','commune','A135','count_5_walk_mean','pooled',1,2,1,'covered',0,0,0)""")
        pub.execute("""INSERT INTO aedar_comparison_publication(singleton,content_version,
            source_snapshot_id,aedar_content_version,reference_content_version,input_content_version,
            input_identity,group_row_count,territory_row_count)
            VALUES(true,%s,'2026-v1',%s,'fixture-ref-v1',%s,'{}'::jsonb,1,0)""",
            ("b"*64,"a"*64,"c"*64))
        pub.execute((root / "api/migrations/040_aedar_reference_only_publication.sql").read_text(encoding="utf-8"))
        legacy_marker = pub.execute("SELECT publication_mode,group_row_count,territory_row_count FROM aedar_comparison_publication WHERE singleton").fetchone()
        assert legacy_marker == ("legacy_rank",1,0)
        # The migrated reader must reject the retained old marker before the
        # real R producer replaces it with a reference-only generation.
        original_database_url = os.environ.get("DATABASE_URL")
        os.environ["DATABASE_URL"] = scoped(read_dsn)
        pool.cache_clear()
        try:
            with TestClient(app) as client:
                legacy_read = client.post("/api/resources/read",json={
                    "resource":"aedar_territorial_aggregate",
                    "target":{"kind":"territory","type":"commune","id":"22001"},
                    "coordinates":{"typequ":["A135"],"measure":["count_5_walk_mean"]},
                    "intent":{"kind":"fixed_comparison","context":"density_class"},
                })
                assert legacy_read.status_code == 503, legacy_read.text
        finally:
            pool.cache_clear()
            if original_database_url is None:
                os.environ.pop("DATABASE_URL",None)
            else:
                os.environ["DATABASE_URL"] = original_database_url

        rscript = r'''started <- proc.time()[[3L]]
stage <- function(name, ...) {cat(sprintf("AEDAR_STAGE elapsed=%.3fs name=%s %s\n",proc.time()[[3L]]-started,name,paste(...,collapse=" ")));flush.console()}
stage("begin-package-load")
pkgload::load_all('.',quiet=TRUE)
stage("end-package-load")
schema <- Sys.getenv('AEDAR_IT_SCHEMA')
source_axis <- readr::read_csv(file.path("tests","testthat","fixtures","aedar-region-2026v1-typequ.csv"),
  col_types=readr::cols(.default=readr::col_character()),trim_ws=FALSE,show_col_types=FALSE)
measures <- as.data.frame(matrix(0,nrow=nrow(source_axis),ncol=length(AEDAR_AGGREGATE_MEASURES),
  dimnames=list(NULL,AEDAR_AGGREGATE_MEASURES)))
measures$count_5_walk_share <- NA_real_
measures$count_5_walk_max <- 0.12345678901234566
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
inputs$commune <- rbind(inputs$commune,make('commune','code_insee','mob-1','nom_commune','Mobility unchanged'))
i <- seq_len(nrow(source_axis))
hierarchy <- readr::read_csv(file.path("tests","testthat","fixtures","aedar-typequ-hierarchy-2025.csv"),
  col_types=readr::cols(.default=readr::col_character()),trim_ws=FALSE,show_col_types=FALSE)
hierarchy <- hierarchy[match(source_axis$TYPEQU,hierarchy$TYPEQU),,drop=FALSE]
stopifnot(nrow(hierarchy)==nrow(source_axis),!anyNA(hierarchy$TYPEQU))
metadata <- data.frame(TYPEQU=source_axis$TYPEQU,LIB_TYPEQU=source_axis$LIB_TYPEQU,description=paste('Description',i),
  domain_code=hierarchy$domain_code,domain_label=hierarchy$domain_label,
  subdomain_code=hierarchy$subdomain_code,subdomain_label=hierarchy$subdomain_label,
  GAMME=rep(NA_character_,length(i)),gamme_status=rep('absent',length(i)),source_order=i)
metadata$description[metadata$TYPEQU=='A135'] <- 'Description 1'
metadata$LIB_TYPEQU[metadata$TYPEQU=='A135'] <- gsub("'","’",metadata$LIB_TYPEQU[metadata$TYPEQU=='A135'],fixed=TRUE)
stage("begin-aggregate-projection",typequ=nrow(source_axis),measures=length(AEDAR_AGGREGATE_MEASURES),territories=5)
projection <- project_aedar_aggregates(inputs,metadata)
stage("end-aggregate-projection",facts=nrow(projection$facts))
canonical_dir <- Sys.getenv('AEDAR_CANONICAL_AGGREGATE_DIR')
stage("begin-aggregate-serialization")
write_aedar_canonical(projection,canonical_dir)
projection <- read_aedar_canonical(canonical_dir)
stage("end-aggregate-serialization",files=length(list.files(canonical_dir,recursive=TRUE)))
con <- DBI::dbConnect(RPostgres::Postgres(),host=Sys.getenv('PGHOST'),port=as.integer(Sys.getenv('PGPORT')),
 dbname=Sys.getenv('PGDATABASE'),user=Sys.getenv('PGUSER'),password=Sys.getenv('PGPASSWORD'))
on.exit(DBI::dbDisconnect(con))
DBI::dbExecute(con,sprintf('SET search_path TO "%s"',schema))
stage("begin-aggregate-publish")
first <- publish_aedar_aggregates(projection,con)
stage("end-aggregate-publish",rows=first$row_count)
second <- publish_aedar_aggregates(projection,con)
stage("end-aggregate-noop",changed=second$changed)
stopifnot(first$changed,!second$changed,first$row_count==5L * nrow(source_axis))
before <- DBI::dbGetQuery(con,"SELECT content_version FROM table_publication WHERE table_name='aedar_territorial_aggregate'")$content_version[[1]]
DBI::dbExecute(con,"CREATE FUNCTION reject_aedar_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced rollback'; END $$")
DBI::dbExecute(con,"CREATE TRIGGER reject_aedar_insert BEFORE INSERT ON aedar_territorial_aggregate FOR EACH ROW EXECUTE FUNCTION reject_aedar_insert()")
projection$facts$count_5_walk_min[1] <- 7
failed <- tryCatch({publish_aedar_aggregates(projection,con); FALSE},error=function(e) TRUE)
after <- DBI::dbGetQuery(con,"SELECT content_version FROM table_publication WHERE table_name='aedar_territorial_aggregate'")$content_version[[1]]
stopifnot(failed,identical(before,after),DBI::dbGetQuery(con,"SELECT count(*) n FROM aedar_territorial_aggregate")$n[[1]]==5L * nrow(source_axis))
projection <- read_aedar_canonical(canonical_dir)
canonical_comparison <- Sys.getenv('AEDAR_CANONICAL_COMPARISON_DIR')
refs <- DBI::dbGetQuery(con,"SELECT territory_type,territory_id,epci_id,density_class_code FROM territory_reference WHERE territory_type IN ('commune','epci','departement','region')")
make_density_source <- function(walk_value=1) {
  registry <- registre_classes_densite(); codes <- as.character(registry[['classe_densite_code']])
  labels <- as.character(registry[['classe_densite_libelle_public']])
  crosswalk <- data.frame(code_insee=c('22001','mob-1',paste0('unused-',3:7)),density_class_code=codes,
    density_class_label=labels,stringsAsFactors=FALSE)
  density_ref <- list(crosswalk=crosswalk,identity=MANIFEST_CLASSES_DENSITE[['id']][[1]],
    sha256=MANIFEST_CLASSES_DENSITE[['sha256']][[1]],vintage=MANIFEST_CLASSES_DENSITE[['vintage']][[1]])
  axis <- read_aedar_typequ_registry(); grid <- expand.grid(density_class_code=codes,TYPEQU=axis[['TYPEQU']],stringsAsFactors=FALSE)
  addresses <- ifelse(grid$density_class_code=='1',2L,0L)
  facts <- data.frame(territory_type='density_class',territory_id=grid$density_class_code,
    density_class_code=grid$density_class_code,density_class_label=labels[match(grid$density_class_code,codes)],
    TYPEQU=grid$TYPEQU,LIB_TYPEQU=axis[['LIB_TYPEQU']][match(grid$TYPEQU,axis[['TYPEQU']])],
    n_addresses=addresses,n_observed=ifelse(addresses>0,1L,0L),
    coverage_status=ifelse(addresses>0,'covered','uncovered_no_address_origins'),
    source_snapshot_id=AEDAR_AGGREGATE_VINTAGE,density_reference_identity=density_ref$identity,
    density_reference_sha256=density_ref$sha256,density_reference_vintage=density_ref$vintage,
    input_content_version='',input_identity='',stringsAsFactors=FALSE)
  for (measure in AEDAR_AGGREGATE_MEASURES) facts[[measure]] <- ifelse(addresses>0,0,NA_real_)
  facts[['count_5_walk_mean']][addresses>0] <- walk_value
  input_hashes <- c(stats::setNames(rep(paste(rep('1',64),collapse=''),length(AEDAR_ADDRESS_SOURCE_MODES)),
    paste0('mode:',AEDAR_ADDRESS_SOURCE_MODES)),address_origins=paste(rep('2',64),collapse=''),
    density_reference=density_ref$sha256)
  identity <- as.character(jsonlite::toJSON(as.list(input_hashes),auto_unbox=TRUE))
  facts$input_identity <- identity
  facts$input_content_version <- paste(as.character(openssl::sha256(charToRaw(identity))),collapse='')
  content_columns <- c('territory_type','territory_id','density_class_code','density_class_label','TYPEQU','LIB_TYPEQU',
    'n_addresses','n_observed','coverage_status',AEDAR_AGGREGATE_MEASURES,'source_snapshot_id',
    'density_reference_identity','density_reference_sha256','density_reference_vintage','input_content_version','input_identity')
  facts$content_version <- paste(as.character(openssl::sha256(serialize(facts[content_columns],NULL))),collapse='')
  list(facts=facts,crosswalk=crosswalk,density_reference=density_ref,input_hashes=input_hashes,
    input_content_version=facts$input_content_version[[1]],input_identity=identity,
    content_version=facts$content_version[[1]],artifact_sha256=paste(rep(if(walk_value==1)'c' else 'd',64),collapse=''),
    source_snapshot_id=AEDAR_AGGREGATE_VINTAGE)
}
density_source <- make_density_source()
saveRDS(density_source,Sys.getenv('AEDAR_DENSITY_FIXTURE'))
stage("begin-comparison-projection",typequ=AEDAR_TYPEQU_REGISTRY_COUNT,measures=length(AEDAR_AGGREGATE_MEASURES),reference_rows=nrow(refs))
comparison <- project_aedar_comparison_publication(projection,density_source,refs,
  reference_content_version='fixture-ref-v1',directory=canonical_comparison)
stage("end-comparison-projection",groups=comparison$group_row_count,territories=comparison$territory_row_count,partitions=length(comparison$parts),files=length(list.files(canonical_comparison,recursive=TRUE)))
stage("begin-comparison-canonical-read")
comparison <- read_aedar_comparison_canonical(canonical_comparison)
stage("end-comparison-canonical-read")
stage("begin-comparison-publish")
published <- publish_aedar_comparisons(comparison,con)
stage("end-comparison-publish",groups=comparison$group_row_count,territories=comparison$territory_row_count)
stopifnot(published$changed,comparison$group_row_count>0,comparison$territory_row_count==0,length(comparison$parts)==AEDAR_TYPEQU_REGISTRY_COUNT)
unchanged <- publish_aedar_comparisons(comparison,con)
stopifnot(!unchanged$changed,identical(unchanged$content_version,comparison$content_version),
  unchanged$territory_row_count==0)
compare_db_projection <- function(part_kind,table,columns,order_columns) {
  for(part_index in seq_along(comparison$parts)) {
    part <- comparison$parts[[part_index]]
    expected_part <- as.data.frame(nanoparquet::read_parquet(file.path(canonical_comparison,part[[part_kind]])))[,columns,drop=FALSE]
    select_columns <- ifelse(columns=='TYPEQU','typequ AS "TYPEQU"',columns)
    actual <- DBI::dbGetQuery(con,paste0("SELECT ",paste(select_columns,collapse=',')," FROM ",table,
      " WHERE typequ=",as.character(DBI::dbQuoteString(con,part$TYPEQU))))
    numeric_columns <- intersect(c('value','n_addresses','n_observed'),columns)
    for (column in numeric_columns) {expected_part[[column]]<-as.numeric(expected_part[[column]]);actual[[column]]<-as.numeric(actual[[column]])}
    sort_frame <- function(x) {x<-x[do.call(order,x[order_columns]),,drop=FALSE];rownames(x)<-NULL;x}
    same <- all.equal(sort_frame(expected_part),sort_frame(actual),tolerance=0,check.attributes=FALSE)
    if(!isTRUE(same)) stop(paste("Canonical/DB AEDAR comparison parity failed:",paste(same,collapse="; ")))
    if(part_index %% 25L == 0L) stage("parity-progress",table=table,partition=part_index,total=length(comparison$parts))
  }
  invisible(TRUE)
}
group_columns <- c('comparison_context','group_id','territory_type','TYPEQU','measure','statistic','value',
  'n_addresses','n_observed','coverage_status')
group_order <- c('comparison_context','group_id','territory_type','TYPEQU','measure')
if (identical(Sys.getenv('AEDAR_IT_PHASE'),'full-audit')) {
  stage("begin-exhaustive-parity")
  compare_db_projection('groups','aedar_comparison_group',group_columns,group_order)
  stage("end-exhaustive-parity",partitions=length(comparison$parts))
}
a104_part <- comparison$parts[[match('A104',vapply(comparison$parts,`[[`,character(1),'TYPEQU'))]]
part_groups <- as.data.frame(nanoparquet::read_parquet(file.path(canonical_comparison,a104_part$groups)))
focus_group <- part_groups[part_groups$comparison_context=='density_class'&part_groups$group_id=='1'&part_groups$territory_type=='commune'&part_groups$measure=='count_5_walk_mean',,drop=FALSE]
stopifnot(nrow(focus_group)==1,comparison$territory_row_count==0L)
jsonlite::write_json(list(group=as.list(focus_group),
  content_version=comparison$content_version,aedar_content_version=comparison$aedar_content_version,
  reference_content_version=comparison$reference_content_version,input_content_version=comparison$input_content_version,
  input_identity=jsonlite::fromJSON(comparison$input_identity)),Sys.getenv('AEDAR_EXPECTED_COMPARISON_JSON'),auto_unbox=TRUE,na='null',digits=17)
if (identical(Sys.getenv('AEDAR_IT_PHASE'),'semantic')) {
  stage("semantic-fixture-ready")
  quit(save="no",status=0L)
}
        comparison_before <- DBI::dbGetQuery(con,"SELECT content_version,group_row_count,territory_row_count FROM aedar_comparison_publication WHERE singleton")
DBI::dbExecute(con,"CREATE FUNCTION reject_aedar_comparison_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced comparison rollback'; END $$")
DBI::dbExecute(con,"CREATE TRIGGER reject_aedar_comparison_insert BEFORE INSERT ON aedar_comparison_group FOR EACH ROW EXECUTE FUNCTION reject_aedar_comparison_insert()")
replacement_source <- make_density_source(2)
replacement <- project_aedar_comparison_publication(projection,replacement_source,refs,
  aedar_content_version=before,reference_content_version='fixture-ref-v1',directory=canonical_comparison)
comparison_failed <- tryCatch({publish_aedar_comparisons(replacement,con); FALSE},error=function(e) TRUE)
comparison_after <- DBI::dbGetQuery(con,"SELECT content_version,group_row_count,territory_row_count FROM aedar_comparison_publication WHERE singleton")
stopifnot(comparison_failed,identical(comparison_before,comparison_after))
compare_db_projection('groups','aedar_comparison_group',group_columns,group_order)
'''
        try:
            tmp = fixture_tmp
            script = tmp / "fixture.R"; script.write_text(rscript,encoding="utf-8")
            expected_comparison_path = Path(tmp) / "expected-comparison.json"
            canonical_aggregate_dir = Path(tmp) / "canonical-aggregate"
            canonical_comparison_dir = Path(tmp) / "canonical-comparison"
            parts = urlsplit(publish_dsn)
            env = os.environ.copy(); env["AEDAR_IT_SCHEMA"] = schema
            env["LUSK_AEDAR_PUBLISH_PROGRESS"] = "1"
            env["AEDAR_IT_PHASE"] = phase
            env["AEDAR_EXPECTED_COMPARISON_JSON"] = str(expected_comparison_path)
            env["AEDAR_CANONICAL_AGGREGATE_DIR"] = str(canonical_aggregate_dir)
            env["AEDAR_CANONICAL_COMPARISON_DIR"] = str(canonical_comparison_dir)
            env["AEDAR_DENSITY_FIXTURE"] = str(Path(tmp) / "density-fixture.rds")
            env["PGHOST"] = parts.hostname or "localhost"; env["PGPORT"] = str(parts.port or 5432)
            env["PGDATABASE"] = parts.path.lstrip("/"); env["PGUSER"] = unquote(parts.username or "")
            env["PGPASSWORD"] = unquote(parts.password or "")
            child = subprocess.Popen(["Rscript",str(script)],cwd=pipeline,env=env,
                stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1)
            output = []
            def capture_progress():
                for line in child.stdout:
                    output.append(line)
                    print(line,end="",flush=True)
            capture_thread = threading.Thread(target=capture_progress,daemon=True)
            capture_thread.start()
            try:
                child.wait(timeout=275 if phase == "semantic" else 850)
            except subprocess.TimeoutExpired:
                child.terminate()
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill(); child.wait()
                capture_thread.join(timeout=2)
                pytest.fail(f"AEDAR {phase} fixture exceeded its bounded child budget; incremental R stages:\n" + "".join(output))
            capture_thread.join(timeout=2)
            assert child.returncode == 0, "".join(output)
            expected_comparison = json.loads(expected_comparison_path.read_text(encoding="utf-8"))
        except Exception:
            raise

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
            http_started=time.monotonic()
            print("AEDAR_STAGE first-semantic-http-read begin",flush=True)
            with TestClient(app) as client:
                def semantic_read(level, territory_id, **item):
                    return client.post("/api/resources/read", json={
                        "resource": "aedar_territorial_aggregate",
                        "target": {"kind": "territory", "type": level, "id": territory_id},
                        **item})
                for level, territory_id in (("commune","22001"),("epci","200000001"),("departement","22"),("region","53")):
                    resp = semantic_read(level, territory_id,
                        coordinates={"typequ": ["A135"]}, intent={"kind": "facts"})
                    assert resp.status_code == 200, resp.text
                    fact = resp.json()["facts"][0]
                    assert resp.json()["territory"] == {"territory_type": level, "territory_id": territory_id}
                    assert fact["typequ_hierarchy_label"] == "COUR D’ASSISES"
                    assert fact["typequ_description"] == "Description 1"
                    assert fact["typequ_label"] == "COUR D'ASSISES"
                    assert fact["measures"]["count_5_walk_share"] is None
                    assert fact["measures"]["count_5_walk_min"] == 0
                    assert fact["measures"]["count_5_walk_max"] == pytest.approx(0.12345678901234566, rel=1e-15)
                    projected = semantic_read(level, territory_id,
                        coordinates={"typequ": ["A135"]},
                        fields=["measures.count_5_walk_max"], intent={"kind": "facts"})
                    assert projected.status_code == 200, projected.text
                    assert projected.json()["facts"][0]["measures"] == {"count_5_walk_max": pytest.approx(0.12345678901234566, rel=1e-15)}
                    assert projected.json()["facts"][0]["source_id"] == "aedar_bretagne"
                    assert projected.json()["facts"][0]["typequ"] == "A135"
                    assert fact["licence"] == "ODbL" and fact["publication_date"] == "2026-09-30"
                    assert fact["attribution"] == "© OpenStreetMap contributors; données AEDAR — licence ODbL"
                    assert resp.json()["content_version"]
                    assert resp.json()["reference_content_version"] == "fixture-ref-v1"
                # The retired legacy AEDAR GET compatibility routes are absent.
                assert client.get("/api/aedar/territories/region/53/aggregates?typequ=A135&limit=1").status_code == 404
                assert client.get("/api/aedar/territories/commune/22001/comparisons?context=epci&typequ=A104&measure=count_5_walk_mean").status_code == 404
                # The unified grammar replaces the retired route's query bounds:
                # no unbounded limit, no empty or unknown measure projection.
                assert semantic_read("region", "53",
                    coordinates={"typequ": ["A135"]}, fields=[], intent={"kind": "facts"}).status_code == 422
                assert semantic_read("region", "53",
                    coordinates={"typequ": ["A135"]}, fields=["measures.not_registered"],
                    intent={"kind": "facts"}).status_code == 422
                assert semantic_read("region", "53",
                    coordinates={"typequ": ["A135"]}, limit=101, intent={"kind": "facts"}).status_code == 422
                # AEDAR is a source-grain semantic resource, not a disconnected GET-only API.
                semantic_facts = client.post("/api/resources/read", json={
                    "resource": "aedar_territorial_aggregate",
                    "target": {"kind": "territory", "type": "commune", "id": "22001"},
                    "coordinates": {"typequ": ["A135"]},
                    "fields": ["measures.count_5_walk_max"],
                    "intent": {"kind": "facts"},
                })
                print(f"AEDAR_STAGE first-semantic-http-read end elapsed={time.monotonic()-http_started:.3f}s status={semantic_facts.status_code}",flush=True)
                assert semantic_facts.status_code == 200, semantic_facts.text
                assert semantic_facts.json()["facts"][0]["measures"] == {
                    "count_5_walk_max": pytest.approx(0.12345678901234566, rel=1e-15)}
                semantic_comparison = client.post("/api/resources/read", json={
                    "resource": "aedar_territorial_aggregate",
                    "target": {"kind": "territory", "type": "commune", "id": "22001"},
                    "coordinates": {"typequ": ["A104"], "measure": ["count_5_walk_mean"]},
                    "fields": ["group_value", "value"],
                    "intent": {"kind": "fixed_comparison", "context": "density_class"},
                })
                assert semantic_comparison.status_code == 200, semantic_comparison.text
                assert semantic_comparison.json()["comparison"]["group_value"] == pytest.approx(expected_comparison["group"]["value"])
                semantic_batch = client.post("/api/resources/read-batch", json={"items": [
                    {"id": "aggregate", "resource": "aedar_territorial_aggregate",
                     "target": {"kind": "territory", "type": "commune", "id": "22001"},
                     "coordinates": {"typequ": ["A135"]}, "fields": ["measures.count_5_walk_max"],
                     "intent": {"kind": "facts"}},
                    {"id": "comparison", "resource": "aedar_territorial_aggregate",
                     "target": {"kind": "territory", "type": "commune", "id": "22001"},
                     "coordinates": {"typequ": ["A104"], "measure": ["count_5_walk_mean"]},
                      "fields": ["group_value", "value"],
                      "intent": {"kind": "fixed_comparison", "context": "density_class"}},
                ]})
                assert semantic_batch.status_code == 200, semantic_batch.text
                assert [row["id"] for row in semantic_batch.json()["results"]] == ["aggregate", "comparison"]
                assert semantic_batch.json()["results"][1]["data"]["comparison"]["group_value"] == pytest.approx(expected_comparison["group"]["value"])
                assert client.post("/api/resources/read", json={
                    "resource": "aedar_territorial_aggregate",
                    "target": {"kind": "territory", "type": "commune", "id": "22001"},
                    "coordinates": {"typequ": ["NOT-A-TYPEQU"]}, "intent": {"kind": "facts"},
                }).status_code == 422
                comparison=semantic_read("commune", "22001",
                    coordinates={"typequ": ["A104"], "measure": ["count_5_walk_mean"]},
                    intent={"kind": "fixed_comparison", "context": "density_class"})
                assert comparison.status_code==200,comparison.text
                compared=comparison.json()
                assert compared["source_snapshot_id"]=="2026-v1"
                assert compared["input_content_version"]
                assert compared["input_identity"]["address_origins"]=="2"*64
                assert compared["input_identity"]["density_reference_sha256"]=="8ebf3011743db45ab94c4ffb74d1bcb06929f0076ecd5b8247011bca861ca978"
                assert compared["content_version"]==expected_comparison["content_version"]
                assert compared["aedar_content_version"]==expected_comparison["aedar_content_version"]
                assert compared["reference_content_version"]==expected_comparison["reference_content_version"]
                assert compared["input_content_version"]==expected_comparison["input_content_version"]
                assert compared["input_identity"]==expected_comparison["input_identity"]
                group=expected_comparison["group"]
                assert compared["comparison"]["comparison_context"]==group["comparison_context"]
                assert compared["comparison"]["statistic"]==group["statistic"]
                assert compared["comparison"]["group_value"]==pytest.approx(group["value"])
                assert compared["comparison"]["group_value"]==pytest.approx(group["value"])
                assert compared["comparison"]["n_addresses"]==2
                assert not {"rank","rank_size","member_count","eligible_count","missing_count"} & set(compared["comparison"])
                pub.execute("UPDATE table_publication SET content_version='fixture-ref-stale' WHERE table_name='territory_reference'")
                stale=semantic_read("commune", "22001",
                    coordinates={"typequ": ["A104"], "measure": ["count_5_walk_mean"]},
                    intent={"kind": "fixed_comparison", "context": "epci"})
                assert stale.status_code==503
                pub.execute("UPDATE table_publication SET content_version='fixture-ref-v1' WHERE table_name='territory_reference'")
                last_complete = pub.execute("SELECT content_version,group_row_count,territory_row_count FROM aedar_comparison_publication WHERE singleton").fetchone()
                last_group_rows = pub.execute("SELECT count(*) FROM aedar_comparison_group").fetchone()[0]
                last_territory_rows = pub.execute("SELECT count(*) FROM aedar_comparison_territory").fetchone()[0]
                # Source publication is a separate transaction: the fact delete must
                # commit while the previous complete comparison remains available.
                pub.execute("DELETE FROM aedar_territorial_aggregate")
                pub.execute("UPDATE table_publication SET content_version='fixture-source-refreshed' WHERE table_name='aedar_territorial_aggregate'")
                assert pub.execute("SELECT content_version,group_row_count,territory_row_count FROM aedar_comparison_publication WHERE singleton").fetchone() == last_complete
                assert pub.execute("SELECT count(*) FROM aedar_comparison_group").fetchone()[0] == last_group_rows
                assert pub.execute("SELECT count(*) FROM aedar_comparison_territory").fetchone()[0] == last_territory_rows
                stale_after_source_refresh=semantic_read("commune", "22001",
                    coordinates={"typequ": ["A104"], "measure": ["count_5_walk_mean"]},
                    intent={"kind": "fixed_comparison", "context": "epci"})
                # The stored comparison survives (asserted above), but the read
                # must not serve it: the intent snapshot preflight compares the
                # published comparison's aedar_content_version with the now-bumped
                # aggregate marker and fails closed. The preflight runs before the
                # published-descriptor domain check, so this is the exact 503 the
                # retired legacy route returned, not a 422.
                assert stale_after_source_refresh.status_code == 503
                assert "comparison" not in stale_after_source_refresh.json()
                if phase == "full-audit":
                    stale_script = r'''pkgload::load_all('.',quiet=TRUE)
schema <- Sys.getenv('AEDAR_IT_SCHEMA')
con <- DBI::dbConnect(RPostgres::Postgres(),host=Sys.getenv('PGHOST'),port=as.integer(Sys.getenv('PGPORT')),
  dbname=Sys.getenv('PGDATABASE'),user=Sys.getenv('PGUSER'),password=Sys.getenv('PGPASSWORD'))
on.exit(DBI::dbDisconnect(con))
DBI::dbExecute(con,sprintf('SET search_path TO "%s"',schema))
projection <- read_aedar_canonical(Sys.getenv('AEDAR_CANONICAL_AGGREGATE_DIR'))
comparison <- read_aedar_comparison_canonical(Sys.getenv('AEDAR_CANONICAL_COMPARISON_DIR'))
refs <- DBI::dbGetQuery(con,"SELECT territory_type,territory_id,epci_id,density_class_code FROM territory_reference WHERE territory_type IN ('commune','epci','departement','region')")
before <- DBI::dbGetQuery(con,"SELECT content_version,group_row_count,territory_row_count FROM aedar_comparison_publication WHERE singleton")
changed_projection <- projection
changed_projection$facts$count_5_walk_mean[[1L]] <- 9
changed_source_version <- aedar_aggregate_content_version(changed_projection)
stopifnot(!identical(changed_source_version,comparison$aedar_content_version))
DBI::dbExecute(con,"UPDATE table_publication SET content_version=$1 WHERE table_name='aedar_territorial_aggregate'",
  params=list(changed_source_version))
        density_source <- readRDS(Sys.getenv('AEDAR_DENSITY_FIXTURE'))
        stale_replacement <- project_aedar_comparison_publication(changed_projection,density_source,refs,
          aedar_content_version=changed_source_version,reference_content_version='fixture-ref-v1',
          directory=Sys.getenv('AEDAR_CANONICAL_COMPARISON_DIR'))
DBI::dbExecute(con,"CREATE FUNCTION reject_aedar_stale_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced replacement failure'; END $$")
DBI::dbExecute(con,"CREATE TRIGGER reject_aedar_stale_insert BEFORE INSERT ON aedar_comparison_group FOR EACH ROW EXECUTE FUNCTION reject_aedar_stale_insert()")
failed <- tryCatch({publish_aedar_comparisons(stale_replacement,con); FALSE},error=function(e) TRUE)
after <- DBI::dbGetQuery(con,"SELECT content_version,group_row_count,territory_row_count FROM aedar_comparison_publication WHERE singleton")
stopifnot(failed,identical(before,after))
'''
                    stale_script_path = fixture_tmp / "stale-fixture.R"
                    stale_script_path.write_text(stale_script,encoding="utf-8")
                    stale_env = env.copy()
                    stale_env["AEDAR_IT_SCHEMA"] = schema
                    stale_run = subprocess.run(["Rscript",str(stale_script_path)],cwd=pipeline,env=stale_env,capture_output=True,text=True)
                    assert stale_run.returncode==0,stale_run.stdout+stale_run.stderr
                    stale_aedar=semantic_read("commune", "22001",
                        coordinates={"typequ": ["A104"], "measure": ["count_5_walk_mean"]},
                        intent={"kind": "fixed_comparison", "context": "epci"})
                    assert stale_aedar.status_code==503
        finally:
            dbread.close(); pool.cache_clear()
            if original_database_url is None: os.environ.pop("DATABASE_URL",None)
            else: os.environ["DATABASE_URL"]=original_database_url
    finally:
        pub.close()
