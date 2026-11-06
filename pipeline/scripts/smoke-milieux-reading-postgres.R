#!/usr/bin/env Rscript
# Guarded canonical Milieux owned-series + selected-reading publisher -> semantic HTTP.
pkgload::load_all(".",quiet=TRUE)
required <- c("HOST","PORT","DATABASE","USER")
config <- setNames(lapply(required,function(k) Sys.getenv(paste0("LUSK_PROFILE_TEST_",k),unset="")),required)
stopifnot(all(vapply(config,nzchar,logical(1))),grepl("^lusk_it_[A-Za-z0-9_]+$",config$DATABASE),
  identical(Sys.getenv("LUSK_TEST_DATABASE_NAME"),config$DATABASE),
  identical(Sys.getenv("LUSK_TEST_DATABASE_PREFIX"),"lusk_it_"))
read_user <- Sys.getenv("LUSK_TEST_READ_USER",unset="")
source_path <- Sys.getenv("LUSK_MILIEUX_CONSO_SOURCE",file.path("data","raw","conso-com.csv"))
canonical_source <- Sys.getenv("LUSK_TEST_CANONICAL_DATA_DIR",unset="")
stopifnot(nzchar(read_user),read_user!=config$USER,dir.exists(canonical_source),
  file.exists(source_path))

# Copy only the current producer-owned serving grains used by the publisher.
# The CONSOENAF source file remains a read-only input at source_path for the
# database-time coverage/absence projection.
fixture_dir <- tempfile("milieux-reading-canonical-")
dir.create(fixture_dir)
canonical_inputs <- c("territoires.parquet","vintages.parquet")
missing_inputs <- canonical_inputs[!file.exists(file.path(canonical_source,canonical_inputs))]
if(length(missing_inputs)) stop("Canonical Milieux territory/vintage inputs are missing: ",
  paste(missing_inputs,collapse=", "),call.=FALSE)
stopifnot(all(file.copy(file.path(canonical_source,canonical_inputs),fixture_dir,overwrite=TRUE)))
canonical_dir <- normalizePath(fixture_dir,winslash="/",mustWork=TRUE)
copy_owner_artifact <- function(family,owner) {
  source <- file.path(canonical_source,family,owner)
  if(!file.exists(file.path(source,"current.json")))
    stop("Current ",family," producer artifact is missing for owner ",owner,call.=FALSE)
  destination <- file.path(canonical_dir,family)
  if(!dir.exists(destination)) dir.create(destination,recursive=TRUE)
  if(!file.copy(source,destination,recursive=TRUE))
    stop("Could not stage ",family," producer artifact for owner ",owner,call.=FALSE)
}
copy_owner_artifact("typed-reading-serving","milieux")
for(owner in c("conso_enaf_annuel","artif_par_habitant"))
  copy_owner_artifact("series-serving",owner)

con <- DBI::dbConnect(RPostgres::Postgres(),host=config$HOST,port=as.integer(config$PORT),
  dbname=config$DATABASE,user=config$USER)
schema <- paste0("reading_it_",Sys.getpid(),"_milieux"); created <- FALSE
tryCatch({
  identity <- DBI::dbGetQuery(con,"SELECT current_database(),current_user")
  stopifnot(identity[[1L]][[1L]]==config$DATABASE,identity[[2L]][[1L]]==config$USER)
  DBI::dbExecute(con,paste0("CREATE SCHEMA ",DBI::dbQuoteIdentifier(con,schema))); created <- TRUE
  DBI::dbExecute(con,paste0("SET search_path TO ",DBI::dbQuoteIdentifier(con,schema)))
  ddl <- paste(readLines("../api/schema.sql",warn=FALSE),collapse="\n")
  for(statement in split_postgres_sql(ddl)) DBI::dbExecute(con,statement)

  territories <- nanoparquet::read_parquet(file.path(canonical_dir,"territoires.parquet"))
  vintages <- nanoparquet::read_parquet(file.path(canonical_dir,"vintages.parquet"))
  metadata <- lire_theme_metadata("milieux")
  publication <- read_typed_reading_publication_from(canonical_dir,"milieux")
  histories <- publication$reading
  state_projection <- read_owned_series_artifact(
    file.path(canonical_dir,"series-serving","artif_par_habitant"),"artif_par_habitant")
  supported_communes <- unique(as.character(state_projection$points$territory_id[
    state_projection$points$territory_type=="commune"]))
  if(!length(supported_communes) || !nrow(histories))
    stop("Current Milieux serving artifacts contain no source-supported commune reading",call.=FALSE)
  focal_id <- supported_communes[[1L]]
  publish_canonical_territory_reference(con,canonical_dir)
  # Keep the declared CONSOENAF source vintage in the database through its own
  # registered owned-series publisher; the reading absence publisher's FK is
  # bound to that exact producer source/version.
  conso_projection <- read_owned_series_artifact(
    file.path(canonical_dir,"series-serving","conso_enaf_annuel"),"conso_enaf_annuel")
  conso_adapter <- owned_series_postgres_adapter(con)
  first_conso <- publish_owned_series_projection(conso_projection,conso_adapter)
  retry_conso <- publish_owned_series_projection(conso_projection,conso_adapter)
  stopifnot(first_conso$changed,!retry_conso$changed)

  source_absences <- milieux_source_absence_declarations(source_path,territories,vintages,metadata)
  expected <- histories
  attr(expected,"source_absences") <- source_absences
  absence_row <- 1L
  bindings <- attr(expected,"source_bindings")
  absences <- source_absences
  # The HTTP test reads selected facts and bindings from the typed-reading
  # generation directly. Keep only this source-snapshot-derived absence record
  # as a small fixture; do not serialize a second numerical reading payload.
  absence_expected <- lapply(absences[absence_row,,drop=FALSE],function(value)
    if(is.na(value[[1L]])) NULL else as.character(value[[1L]]))
  jsonlite::write_json(list(absence=absence_expected),
    file.path(canonical_dir,"milieux_source_absence_expected.json"),
    auto_unbox=TRUE,null="null",digits=NA)

  published <- publish_canonical_milieux_reading(con,canonical_dir,source_path)
  stopifnot(published$reading$row_count==nrow(expected),
    published$reading$changed,
    DBI::dbGetQuery(con,"SELECT count(*) FROM milieux_reading_absence")[[1L]][[1L]]==nrow(absences))
  expected_facts <- expected[c("territory_id","territory_type","groupe","story_key","salience_reason",
    "periode_pop","periode_artif","delta_population","taux_variation_population","artif_m2_par_habitant",
    "artif_m3_par_habitant","trajectoire_artif_par_habitant","classification","status","source_id","vintage_id")]
  actual_facts <- DBI::dbGetQuery(con,"SELECT territory_id,territory_type,groupe,story_key,salience_reason,
    periode_pop,periode_artif,delta_population,taux_variation_population,artif_m2_par_habitant,
    artif_m3_par_habitant,trajectoire_artif_par_habitant,classification,status,source_id,vintage_id
    FROM milieux_typed_reading ORDER BY territory_type,territory_id,groupe")
  expected_facts <- expected_facts[order(expected_facts$territory_type,expected_facts$territory_id,
    expected_facts$groupe),,drop=FALSE]
  stopifnot(isTRUE(all.equal(actual_facts,expected_facts,check.attributes=FALSE,tolerance=1e-10)))
  expected_sources <- bindings[c("territory_id","territory_type","groupe","field_key","source_id","vintage_id",
    "source_name","source_version","reference_date","publication_date","observation_period","dataset_id",
    "dataset_content_version","state_role","axis_value","provenance_revision_id","population_revision_id")]
  actual_sources <- DBI::dbGetQuery(con,"SELECT territory_id,territory_type,groupe,field_key,source_id,vintage_id,
    source_name,source_version,reference_date,publication_date,observation_period,dataset_id,
    dataset_content_version,state_role,axis_value,provenance_revision_id,population_revision_id
    FROM milieux_reading_source ORDER BY territory_type,territory_id,groupe,field_key")
  expected_sources <- expected_sources[order(expected_sources$territory_type,expected_sources$territory_id,
    expected_sources$groupe,expected_sources$field_key),,drop=FALSE]
  stopifnot(isTRUE(all.equal(actual_sources,expected_sources,check.attributes=FALSE,tolerance=1e-10)))
  expected_absences <- absences[c("territory_id","territory_type","reason","source_id","vintage_id","source_snapshot_sha256")]
  actual_absences <- DBI::dbGetQuery(con,"SELECT territory_id,territory_type,reason,source_id,vintage_id,
    source_snapshot_sha256 FROM milieux_reading_absence ORDER BY territory_type,territory_id")
  expected_absences <- expected_absences[order(expected_absences$territory_type,expected_absences$territory_id),,drop=FALSE]
  stopifnot(isTRUE(all.equal(actual_absences,expected_absences,check.attributes=FALSE)))

  # A second registered publish must be a true no-op for both the owned-series
  # dependency and the reading/evidence family.
  before_markers <- DBI::dbGetQuery(con,"SELECT table_name,content_version,row_count,reference_content_version,published_at
    FROM table_publication WHERE table_name IN ('milieux_typed_reading','milieux_reading_absence') ORDER BY table_name")
  again <- publish_canonical_milieux_reading(con,canonical_dir,source_path)
  after_markers <- DBI::dbGetQuery(con,"SELECT table_name,content_version,row_count,reference_content_version,published_at
    FROM table_publication WHERE table_name IN ('milieux_typed_reading','milieux_reading_absence') ORDER BY table_name")
  stopifnot(!again$reading$changed,
    isTRUE(all.equal(before_markers,after_markers,check.attributes=FALSE)))

  # Force the registered publisher down its replacement transaction and inject
  # a source-row failure. PostgreSQL must roll back the preceding fact delete;
  # restore only the deliberately stale marker after proving table preservation.
  DBI::dbExecute(con,"CREATE FUNCTION reject_milieux_reading_source() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected Milieux source failure'; END $$")
  DBI::dbExecute(con,"CREATE TRIGGER reject_milieux_reading_source BEFORE INSERT ON milieux_reading_source
    FOR EACH ROW EXECUTE FUNCTION reject_milieux_reading_source()")
  series_markers_before_failure <- DBI::dbGetQuery(con,"SELECT dataset_id,content_version,reference_content_version,row_count,published_at
    FROM series_dataset_publication ORDER BY dataset_id")
  series_descriptors_before_failure <- DBI::dbGetQuery(con,"SELECT dataset_id,indicator_id,descriptor_version,active_read_route
    FROM series_dataset_descriptor ORDER BY dataset_id,indicator_id")
  series_counts_before_failure <- DBI::dbGetQuery(con,"SELECT dataset_id,indicator_id,count(*) AS row_count
    FROM series_dataset_observation GROUP BY dataset_id,indicator_id ORDER BY dataset_id,indicator_id")
  DBI::dbExecute(con,"UPDATE table_publication SET content_version='retry-required'
    WHERE table_name='milieux_typed_reading'")
  failed <- try(publish_canonical_milieux_reading(con,canonical_dir,source_path),silent=TRUE)
  DBI::dbExecute(con,"DROP TRIGGER reject_milieux_reading_source ON milieux_reading_source")
  DBI::dbExecute(con,"DROP FUNCTION reject_milieux_reading_source()")
  rollback_facts <- DBI::dbGetQuery(con,"SELECT territory_id,territory_type,groupe,story_key,salience_reason,
    periode_pop,periode_artif,delta_population,taux_variation_population,artif_m2_par_habitant,
    artif_m3_par_habitant,trajectoire_artif_par_habitant,classification,status,source_id,vintage_id
    FROM milieux_typed_reading ORDER BY territory_type,territory_id,groupe")
  rollback_sources <- DBI::dbGetQuery(con,"SELECT territory_id,territory_type,groupe,field_key,source_id,vintage_id,
    source_name,source_version,reference_date,publication_date,observation_period,dataset_id,
    dataset_content_version,state_role,axis_value,provenance_revision_id,population_revision_id
    FROM milieux_reading_source ORDER BY territory_type,territory_id,groupe,field_key")
  rollback_absences <- DBI::dbGetQuery(con,"SELECT territory_id,territory_type,reason,source_id,vintage_id,
    source_snapshot_sha256 FROM milieux_reading_absence ORDER BY territory_type,territory_id")
  rollback_marker <- DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at
    FROM table_publication WHERE table_name='milieux_typed_reading'")
  series_markers_after_failure <- DBI::dbGetQuery(con,"SELECT dataset_id,content_version,reference_content_version,row_count,published_at
    FROM series_dataset_publication ORDER BY dataset_id")
  series_descriptors_after_failure <- DBI::dbGetQuery(con,"SELECT dataset_id,indicator_id,descriptor_version,active_read_route
    FROM series_dataset_descriptor ORDER BY dataset_id,indicator_id")
  series_counts_after_failure <- DBI::dbGetQuery(con,"SELECT dataset_id,indicator_id,count(*) AS row_count
    FROM series_dataset_observation GROUP BY dataset_id,indicator_id ORDER BY dataset_id,indicator_id")
  stopifnot(inherits(failed,"try-error"),
    isTRUE(all.equal(actual_facts,rollback_facts,check.attributes=FALSE,tolerance=1e-10)),
    isTRUE(all.equal(actual_sources,rollback_sources,check.attributes=FALSE,tolerance=1e-10)),
    isTRUE(all.equal(actual_absences,rollback_absences,check.attributes=FALSE)),
    isTRUE(all.equal(series_markers_before_failure,series_markers_after_failure,check.attributes=FALSE)),
    isTRUE(all.equal(series_descriptors_before_failure,series_descriptors_after_failure,check.attributes=FALSE)),
    isTRUE(all.equal(series_counts_before_failure,series_counts_after_failure,check.attributes=FALSE)),
    rollback_marker$content_version[[1L]]=="retry-required")
  DBI::dbExecute(con,"UPDATE table_publication SET content_version=$1 WHERE table_name='milieux_typed_reading'",
    params=list(before_markers$content_version[before_markers$table_name=="milieux_typed_reading"]))
  DBI::dbExecute(con,paste0("GRANT USAGE ON SCHEMA ",DBI::dbQuoteIdentifier(con,schema),
    " TO ",DBI::dbQuoteIdentifier(con,read_user)))
  DBI::dbExecute(con,paste0("GRANT SELECT ON ALL TABLES IN SCHEMA ",DBI::dbQuoteIdentifier(con,schema),
    " TO ",DBI::dbQuoteIdentifier(con,read_user)))
  keys <- c("LUSK_MILIEUX_HTTP_SCHEMA","LUSK_TEST_CANONICAL_DATA_DIR","PYTHONPATH")
  old <- Sys.getenv(keys,unset=NA_character_)
  on.exit(for(i in seq_along(keys)) if(is.na(old[[i]])) Sys.unsetenv(keys[[i]]) else
    do.call(Sys.setenv,setNames(list(old[[i]]),keys[[i]])),add=TRUE)
  Sys.setenv(LUSK_MILIEUX_HTTP_SCHEMA=schema,LUSK_TEST_CANONICAL_DATA_DIR=canonical_dir,
    PYTHONPATH=normalizePath("..",winslash="/",mustWork=TRUE))
  test <- normalizePath("../api/tests/integration/test_milieux_cloud_http.py",winslash="/",mustWork=TRUE)
  status <- system2(Sys.which("python"),c("-m","pytest","-q",shQuote(test,type="cmd")),stdout="",stderr="")
  if(!identical(status,0L)) stop("Registered Milieux publisher-to-semantic-HTTP proof failed",call.=FALSE)
  cat("Canonical Milieux reading:",nrow(expected)," facts; exact fact/source/absence DB parity, registered publisher no-op and injected rollback, owned-series/R publishers, semantic HTTP and fail-closed absence: PASS\n")
},finally={
  if(created && identical(Sys.getenv("LUSK_TEST_ALLOW_SCHEMA_CLEANUP"),"1"))
    cleanup_serving_smoke_schema(con,schema,"reading")
  DBI::dbDisconnect(con)
  unlink(fixture_dir,recursive=TRUE)
})
