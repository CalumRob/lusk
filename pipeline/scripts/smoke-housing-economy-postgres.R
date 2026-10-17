#!/usr/bin/env Rscript
# Guarded retained scalar + Economy selected-reading publisher -> semantic HTTP.
pkgload::load_all(".",quiet=TRUE)
required <- c("HOST","PORT","DATABASE","USER")
config <- setNames(lapply(required,function(k) Sys.getenv(paste0("LUSK_PROFILE_TEST_",k),unset="")),required)
stopifnot(all(vapply(config,nzchar,logical(1))),
  grepl("^lusk_it_[A-Za-z0-9_]+$",config$DATABASE),
  identical(Sys.getenv("LUSK_TEST_DATABASE_NAME"),config$DATABASE),
  identical(Sys.getenv("LUSK_TEST_DATABASE_PREFIX"),"lusk_it_"))
read_user <- Sys.getenv("LUSK_TEST_READ_USER",unset="")
stopifnot(nzchar(read_user),read_user!=config$USER)
canonical_source <- Sys.getenv("LUSK_TEST_CANONICAL_DATA_DIR",unset="")
stopifnot(dir.exists(canonical_source))

# All artifact materialization is directed to this bounded writable copy. The
# canonical public snapshot is read-only input; no raw cache or pipeline build.
fixture_dir <- tempfile("economy-reading-canonical-")
dir.create(fixture_dir)
canonical_inputs <- c("territoires.parquet","vintages.parquet","vintages.json",
  "indicateurs_demographie.json","indicateurs_economie.json",
  "indicateurs_habitat.json","indicateurs_mobilite.parquet",
  "histoires_economie.json","theme_demographie.json","theme_economie.json",
  "theme_habitat.json","theme_milieux.json","theme_mobilite.json")
missing_inputs <- canonical_inputs[!file.exists(file.path(canonical_source,canonical_inputs))]
if(length(missing_inputs)) stop("Canonical Economy proof inputs are missing: ",
  paste(missing_inputs,collapse=", "),call.=FALSE)
stopifnot(all(file.copy(file.path(canonical_source,canonical_inputs),fixture_dir,overwrite=TRUE)))
canonical_dir <- normalizePath(fixture_dir,winslash="/",mustWork=TRUE)

con <- DBI::dbConnect(RPostgres::Postgres(),host=config$HOST,port=as.integer(config$PORT),
  dbname=config$DATABASE,user=config$USER)
schema <- paste0("profile_it_",Sys.getpid(),"_economy"); created <- FALSE
tryCatch({
  identity <- DBI::dbGetQuery(con,"SELECT current_database(),current_user")
  stopifnot(identity[[1L]][[1L]]==config$DATABASE,identity[[2L]][[1L]]==config$USER)
  DBI::dbExecute(con,paste0("CREATE SCHEMA ",DBI::dbQuoteIdentifier(con,schema))); created <- TRUE
  DBI::dbExecute(con,paste0("SET search_path TO ",DBI::dbQuoteIdentifier(con,schema)))
  ddl <- paste(readLines("../api/schema.sql",warn=FALSE),collapse="\n")
  for(statement in split_postgres_sql(ddl)) DBI::dbExecute(con,statement)

  territories <- nanoparquet::read_parquet(file.path(canonical_dir,"territoires.parquet"))
  vintages <- nanoparquet::read_parquet(file.path(canonical_dir,"vintages.parquet"))
  for(owner in retained_scalar_artifact_owners()) {
    metadata <- jsonlite::fromJSON(file.path(canonical_dir,paste0("theme_",owner,".json")),simplifyVector=FALSE)
    payload <- list(indicateurs=lire_indicateurs_commis(owner,canonical_dir),territoires=territories)
    materialize_theme_scalar_artifact(payload,metadata,vintages,owner,canonical_dir)
  }
  reference <- publish_canonical_territory_reference(con,canonical_dir)$projection
  scalar <- project_retained_scalar_snapshot(canonical_dir,reference)
  scalar_publication <- publish_retained_scalar_snapshot(con,scalar,canonical_dir)$scalar
  stopifnot(identical(scalar_publication$content_version,
    DBI::dbGetQuery(con,"SELECT content_version FROM table_publication WHERE table_name='scalar_observation'")$content_version[[1L]]))

  histories <- jsonlite::fromJSON(file.path(canonical_dir,"histoires_economie.json"))
  metadata <- lire_theme_metadata("economie")
  materialize_theme_typed_reading_artifacts(list(histoires=histories,territoires=territories,
    indicateurs=lire_indicateurs_commis("economie",canonical_dir),source_vintages=vintages),
    metadata,vintages,"economie",canonical_dir)
  canonical <- read_typed_reading_publication_from(canonical_dir,"economie")
  registry <- register_typed_reading_artifact_publisher(list(),"economie",publish_economy_reading_family)
  first <- publish_typed_reading_publication(registry,"economie",canonical,con)
  marker <- DBI::dbGetQuery(con,"SELECT table_name,content_version,row_count,reference_content_version,published_at
    FROM table_publication WHERE table_name IN ('economy_typed_reading','economy_activity_evidence') ORDER BY table_name")
  retry <- publish_typed_reading_publication(registry,"economie",canonical,con)
  stopifnot(first$changed,!retry$changed,
    isTRUE(all.equal(marker,DBI::dbGetQuery(con,"SELECT table_name,content_version,row_count,reference_content_version,published_at
      FROM table_publication WHERE table_name IN ('economy_typed_reading','economy_activity_evidence') ORDER BY table_name"),check.attributes=FALSE)))

  DBI::dbExecute(con,"CREATE FUNCTION reject_economy_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected economy evidence failure'; END $$")
  DBI::dbExecute(con,"CREATE TRIGGER reject_economy_evidence BEFORE INSERT ON economy_activity_evidence
    FOR EACH ROW EXECUTE FUNCTION reject_economy_evidence()")
  changed <- canonical
  changed$content_version <- paste0(canonical$content_version,"-rollback-probe")
  failed <- try(publish_typed_reading_publication(registry,"economie",changed,con),silent=TRUE)
  DBI::dbExecute(con,"DROP TRIGGER reject_economy_evidence ON economy_activity_evidence")
  DBI::dbExecute(con,"DROP FUNCTION reject_economy_evidence()")
  stopifnot(inherits(failed,"try-error"),
    isTRUE(all.equal(marker,DBI::dbGetQuery(con,"SELECT table_name,content_version,row_count,reference_content_version,published_at
      FROM table_publication WHERE table_name IN ('economy_typed_reading','economy_activity_evidence') ORDER BY table_name"),check.attributes=FALSE)))

  DBI::dbExecute(con,paste0("GRANT USAGE ON SCHEMA ",DBI::dbQuoteIdentifier(con,schema),
    " TO ",DBI::dbQuoteIdentifier(con,read_user)))
  DBI::dbExecute(con,paste0("GRANT SELECT ON ALL TABLES IN SCHEMA ",DBI::dbQuoteIdentifier(con,schema),
    " TO ",DBI::dbQuoteIdentifier(con,read_user)))
  keys <- c("LUSK_HOUSING_HTTP_SCHEMA","PYTHONPATH","LUSK_TEST_CANONICAL_DATA_DIR")
  old <- Sys.getenv(keys,unset=NA_character_)
  on.exit(for(i in seq_along(keys)) if(is.na(old[[i]])) Sys.unsetenv(keys[[i]]) else
    do.call(Sys.setenv,setNames(list(old[[i]]),keys[[i]])),add=TRUE)
  Sys.setenv(LUSK_HOUSING_HTTP_SCHEMA=schema,
    LUSK_TEST_CANONICAL_DATA_DIR=canonical_dir,PYTHONPATH=normalizePath("..",winslash="/",mustWork=TRUE))
  test <- normalizePath("../api/tests/integration/test_housing_economy_publisher_http.py",winslash="/",mustWork=TRUE)
  status <- system2(Sys.which("python"),c("-m","pytest","-q",shQuote(test,type="cmd")),stdout="",stderr="")
  if(!identical(status,0L)) stop("Registered Economy publisher-to-semantic-HTTP proof failed",call.=FALSE)
  cat("Retained Economy scalar descriptors/facts and registered selected reading/activity evidence; semantic HTTP parity, no-op and rollback: PASS\n")
},finally={
  if(created && identical(Sys.getenv("LUSK_TEST_ALLOW_SCHEMA_CLEANUP"),"1"))
    cleanup_serving_smoke_schema(con,schema,"profile")
  DBI::dbDisconnect(con)
  unlink(fixture_dir,recursive=TRUE)
})
