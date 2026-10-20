#!/usr/bin/env Rscript
# Guarded canonical demographic reading → PostgreSQL/read-role acceptance tracer.
pkgload::load_all(".", quiet=TRUE)
required <- c("HOST","PORT","DATABASE","USER")
config <- setNames(lapply(required,function(k) Sys.getenv(paste0("LUSK_PROFILE_TEST_",k),unset="")),required)
stopifnot(all(vapply(config,nzchar,logical(1))),identical(config$HOST,"192.168.1.120"),
  identical(config$PORT,"5432"),identical(config$USER,"lusk_it_contract_pub"),
  grepl("^lusk_it_[A-Za-z0-9_]+$",config$DATABASE),
  !tolower(config$DATABASE)%in%c("lusk","postgres","template0","template1"))
read_user <- Sys.getenv("LUSK_TEST_READ_USER",unset=""); read_dsn <- Sys.getenv("LUSK_TEST_READ_DSN",unset="")
publish_dsn <- Sys.getenv("LUSK_TEST_PUBLISH_DSN",unset="")
canonical_dir <- Sys.getenv("LUSK_TEST_CANONICAL_DATA_DIR",unset="")
scalar_artifact_dir <- Sys.getenv("LUSK_TEST_SCALAR_ARTIFACT_DIR",unset="")
evidence_dir <- Sys.getenv("LUSK_TEST_EVIDENCE_DIR",unset="")
stopifnot(nzchar(read_user),nzchar(read_dsn),read_user!=config$USER,
  identical(config$DATABASE,"lusk_it_contract"),identical(read_user,"lusk_it_contract_read"),
  identical(publish_dsn,"postgresql://lusk_it_contract_pub@192.168.1.120:5432/lusk_it_contract"),
  identical(read_dsn,"postgresql://lusk_it_contract_read@192.168.1.120:5432/lusk_it_contract"),
  file.exists(Sys.getenv("PGPASSFILE",unset="")),
  identical(Sys.getenv("LUSK_TEST_DATABASE_PREFIX"),"lusk_it_"),
  identical(Sys.getenv("LUSK_TEST_DATABASE_NAME"),config$DATABASE),dir.exists(canonical_dir),
  dir.exists(scalar_artifact_dir),nzchar(evidence_dir))
canonical_dir <- normalizePath(canonical_dir,winslash="/",mustWork=TRUE)
stopifnot(identical(tolower(canonical_dir),tolower(normalizePath("E:/Lusk/public/data",winslash="/",mustWork=TRUE))))
evidence_dir <- normalizePath(evidence_dir,winslash="/",mustWork=FALSE)
stopifnot(grepl("^E:/Temp/opencode/issue-808-guarded-proof-[A-Za-z0-9_-]+$",evidence_dir,ignore.case=TRUE))
if(dir.exists(evidence_dir)) {
  stopifnot(identical(list.files(evidence_dir,all.files=FALSE),"run-command.txt"))
} else {
  dir.create(evidence_dir,recursive=TRUE)
}
work_dir <- file.path(evidence_dir,"work")
stopifnot(!dir.exists(work_dir))
dir.create(work_dir)
required_canonical_files <- file.path(canonical_dir,c("territoires.parquet","vintages.parquet",
  "histoires_demographie.json","theme_demographie.json"))
missing_canonical_files <- required_canonical_files[!file.exists(required_canonical_files)]
if(length(missing_canonical_files)) stop("Required canonical files missing: ",
  paste(missing_canonical_files,collapse=", "),call.=FALSE)
required_scalar_owners <- retained_scalar_artifact_owners()
missing_scalar_owners <- required_scalar_owners[!dir.exists(file.path(scalar_artifact_dir,required_scalar_owners))]
if(length(missing_scalar_owners)) stop("Retained scalar artifact owners missing: ",
  paste(missing_scalar_owners,collapse=", "),call.=FALSE)
run_manifest <- list(database=config$DATABASE,role=config$USER,configured_host=config$HOST,
  expected_server="192.168.16.3/32",schema=NULL,created=FALSE,retained=TRUE,
  canonical_source=canonical_dir,scalar_artifacts=normalizePath(scalar_artifact_dir,winslash="/",mustWork=TRUE),
  canonical_inputs=required_canonical_files,evidence_directory=evidence_dir)
con <- DBI::dbConnect(RPostgres::Postgres(),host=config$HOST,port=as.integer(config$PORT),
  dbname=config$DATABASE,user=config$USER)
DBI::dbExecute(con,"SET statement_timeout='150s'")
DBI::dbExecute(con,"SET lock_timeout='5s'")
DBI::dbExecute(con,"SET idle_in_transaction_session_timeout='60s'")
schema <- paste0("reading_it_",Sys.getpid(),"_",format(Sys.time(),"%H%M%S"),"_",sample.int(1000000L,1L))
created <- FALSE
read_con <- NULL
tryCatch({
  identity <- DBI::dbGetQuery(con,"SELECT current_database() database,current_user username,
    inet_server_addr()::text server_address,masklen(inet_server_addr()) server_mask_bits,inet_server_port() server_port")
  server_ip <- sub("/[0-9]+$","",identity$server_address[[1L]])
  cat("Expected guarded DB identity: ",config$DATABASE," / ",config$USER,
      " via ",config$HOST,":",config$PORT,"; actual: ",identity$database[[1L]]," / ",identity$username[[1L]],
      " at ",server_ip,"/",identity$server_mask_bits[[1L]],":",identity$server_port[[1L]],"\n",sep="")
  stopifnot(identity$database[[1L]]==config$DATABASE,identity$username[[1L]]==config$USER,
    server_ip=="192.168.16.3",as.integer(identity$server_mask_bits[[1L]])==32L,
    as.integer(identity$server_port[[1L]])==5432L)
  collision <- DBI::dbGetQuery(con,"SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=$1) present",params=list(schema))$present[[1L]]
  stopifnot(!isTRUE(collision))
  run_manifest$schema <- schema
  writeLines(jsonlite::toJSON(run_manifest,auto_unbox=TRUE,pretty=TRUE),
    file.path(evidence_dir,"schema-manifest-before.json"),useBytes=TRUE)
  cat("Guarded schema manifest intent (before CREATE): ",config$DATABASE," / ",config$USER,
    " / ",schema,"; create only this random schema, retain by default\n",sep="")
  DBI::dbExecute(con,paste0("CREATE SCHEMA ",DBI::dbQuoteIdentifier(con,schema))); created <- TRUE
  schema_identity <- DBI::dbGetQuery(con,
    "SELECT n.nspname,r.rolname AS owner FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner WHERE n.nspname=$1",
    params=list(schema))
  cat("Guarded schema manifest after CREATE: ",schema_identity$nspname[[1L]]," / ",
    schema_identity$owner[[1L]],"\n",sep="")
  stopifnot(nrow(schema_identity)==1L,schema_identity$owner[[1L]]==config$USER)
  run_manifest$created <- TRUE
  run_manifest$server_address <- paste0(server_ip,"/",identity$server_mask_bits[[1L]])
  writeLines(jsonlite::toJSON(run_manifest,auto_unbox=TRUE,pretty=TRUE),
    file.path(evidence_dir,"schema-manifest-after-create.json"),useBytes=TRUE)
  DBI::dbExecute(con,paste0("SET search_path TO ",DBI::dbQuoteIdentifier(con,schema)))
  ddl <- paste(readLines("../api/schema.sql",warn=FALSE),collapse="\n")
  for (statement in split_postgres_sql(ddl)) DBI::dbExecute(con,statement)
  read_canonical <- function(name) {
    parquet <- file.path(canonical_dir,paste0(name,".parquet"))
    json <- file.path(canonical_dir,paste0(name,".json"))
    if(file.exists(parquet)) return(nanoparquet::read_parquet(parquet))
    if(file.exists(json)) return(jsonlite::fromJSON(json,simplifyVector=TRUE))
    stop("Required canonical artifact is missing: ",parquet," or ",json,call.=FALSE)
  }
  territories <- read_canonical("territoires"); vintages <- read_canonical("vintages")
  # Current payloads may retire theme Parquets; the committed JSON is the oracle.
  histories <- read_canonical("histoires_demographie")
  stopifnot(nrow(histories)==1268L)
  publish_canonical_territory_reference(con, canonical_dir)
  stopifnot(isTRUE(file.copy(file.path(canonical_dir,"territoires.parquet"),work_dir,overwrite=TRUE)))
  owners <- retained_scalar_artifact_owners()
  stopifnot(all(owners %in% list.dirs(scalar_artifact_dir,recursive=FALSE,full.names=FALSE)))
  scalar_destination <- file.path(work_dir,"scalar-serving")
  dir.create(scalar_destination)
  for(owner in owners) stopifnot(isTRUE(file.copy(file.path(scalar_artifact_dir,owner),
    scalar_destination,recursive=TRUE)))
  reference <- project_territory_reference(territories)
  demographic_metadata <- lire_theme_metadata("demographie")
  source_ids <- unlist(lapply(demographic_metadata$semantic_resources,function(resource) {
    if(identical(resource$kind,"typed_reading")) resource$source_keys else NULL
  }),use.names=FALSE)
  stopifnot(length(source_ids)==1L)
  source <- vintages[vintages$id==source_ids[[1L]],,drop=FALSE]
  stopifnot(nrow(source)==1L)
  read_registry_clock <- function() DBI::dbGetQuery(con,"SELECT d.source_id,d.name AS source_name,
    v.vintage_id,v.version,v.reference_date,v.publication_date FROM source_dataset d
    JOIN source_vintage v USING(source_id) WHERE d.source_id=$1 ORDER BY v.vintage_id",
    params=list(source$id[[1L]]))
  clock_before <- read_registry_clock()
  stopifnot(nrow(clock_before)==0L)
  write.csv(clock_before,file.path(evidence_dir,"source-clock-before-scalar.csv"),row.names=FALSE,na="")
  scalar <- project_retained_scalar_snapshot(work_dir,reference,work_dir)
  scalar_result <- publish_retained_scalar_snapshot(con,scalar,work_dir)$scalar
  materialize_theme_typed_reading_artifacts(list(histoires=histories,territoires=territories),
    demographic_metadata,vintages,"demographie",work_dir)
  expected_vintage_id <- paste(source$version[[1L]],source$date_reference[[1L]],sep="/")
  registered_clock <- read_registry_clock()
  registered_clock <- registered_clock[registered_clock$vintage_id==expected_vintage_id,,drop=FALSE]
  cat("Canonical source clock after retained scalar publication:\n")
  print(registered_clock)
  stopifnot(nrow(registered_clock)==1L,registered_clock$version[[1L]]==source$version[[1L]],
    registered_clock$source_name[[1L]]==source$source[[1L]],
    as.character(registered_clock$reference_date[[1L]])==as.character(source$date_reference[[1L]]),
    as.character(registered_clock$publication_date[[1L]])==as.character(source$date_publication[[1L]]),
    !DBI::dbGetQuery(con,"SELECT EXISTS(SELECT 1 FROM source_vintage WHERE source_id=$1 AND vintage_id=$1) present",
      params=list(source$id[[1L]] ) )$present[[1L]])
  write.csv(read_registry_clock(),file.path(evidence_dir,"source-clock-after-scalar.csv"),row.names=FALSE,na="")
  # Publish the newly materialized owner artifact, not a stale pointer from the
  # canonical source or a theme-wide Parquet.
  publication <- read_typed_reading_publication_from(work_dir,"demographie")
  canonical <- list(reading=publication$reading,content_version=publication$content_version)
  registry <- register_typed_reading_artifact_publisher(list(),"demographie",publish_demographic_reading)
  result <- publish_registered_typed_reading(registry,"demographie",canonical,con)
  marker_before_retry <- DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name='demographic_typed_reading'")
  retry <- publish_registered_typed_reading(registry,"demographie",canonical,con)
  stopifnot(isTRUE(result$changed),!isTRUE(retry$changed),identical(marker_before_retry,
     DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name='demographic_typed_reading'")))
  cat("Demographic publication marker after first publish (unchanged on retry):\n")
  print(marker_before_retry)
  writeLines(jsonlite::toJSON(list(source_id=source$id[[1L]],
    source_name=source$source[[1L]],version=source$version[[1L]],
    reference_date=as.character(source$date_reference[[1L]]),
    publication_date=as.character(source$date_publication[[1L]]),
    registry_vintage_id=expected_vintage_id,
    retained_scalar_clock=registered_clock,
    demographic_content_version=result$content_version,
    demographic_marker=marker_before_retry),auto_unbox=TRUE,pretty=TRUE),
    file.path(evidence_dir,"source-clock-and-marker-after.json"),useBytes=TRUE)
  read_full_snapshot <- function() list(
    facts=DBI::dbGetQuery(con,"SELECT * FROM demographic_typed_reading
      ORDER BY territory_type,territory_id,groupe"),
    descriptor=DBI::dbGetQuery(con,"SELECT * FROM demographic_reading_descriptor WHERE singleton"),
    marker=DBI::dbGetQuery(con,"SELECT * FROM table_publication WHERE table_name='demographic_typed_reading'"),
    source_clock=read_registry_clock())
  state_before_failures <- read_full_snapshot()
  saveRDS(state_before_failures,file.path(evidence_dir,"publication-before-failure-probes.rds"))
  bad <- canonical
  bad$reading$vintage_id[] <- "stale/clock"
  expect_failure <- tryCatch({publish_registered_typed_reading(registry,"demographie",bad,con);FALSE},error=function(e) TRUE)
  state_after_bad_binding <- read_full_snapshot()
  stopifnot(expect_failure,identical(state_before_failures,state_after_bad_binding))
  rollback_case <- canonical
  changed_rows <- which(rollback_case$reading$status=="measured" & !is.na(rollback_case$reading$solde_naturel))
  stopifnot(length(changed_rows)>0L)
  changed_row <- changed_rows[[1L]]
  rollback_case$reading$solde_naturel[[changed_row]] <- rollback_case$reading$solde_naturel[[changed_row]] + 1
  rollback_projection <- typed_reading_projection(rollback_case$reading,"demographie",
    demographic_metadata,vintages)
  rollback_case$content_version <- typed_reading_content_version(
    canonicalize_typed_reading_projection(rollback_projection),"demographie")
  stopifnot(!identical(rollback_case$content_version,canonical$content_version))
  DBI::dbExecute(con,"CREATE FUNCTION test_reject_demographic_delete() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN
      RAISE EXCEPTION 'guarded rollback probe after demographic fact delete';
    END; $$")
  DBI::dbExecute(con,"CREATE TRIGGER test_reject_demographic_delete
    AFTER DELETE ON demographic_typed_reading FOR EACH ROW
    EXECUTE FUNCTION test_reject_demographic_delete()")
  rollback_error <- tryCatch({publish_registered_typed_reading(registry,"demographie",rollback_case,con);NA_character_},
    error=function(e) conditionMessage(e))
  rollback_failed <- !is.na(rollback_error) &&
    grepl("guarded rollback probe after demographic fact delete",rollback_error,fixed=TRUE)
  DBI::dbDisconnect(con)
  con <- DBI::dbConnect(RPostgres::Postgres(),host=config$HOST,port=as.integer(config$PORT),
    dbname=config$DATABASE,user=config$USER)
  DBI::dbExecute(con,"SET statement_timeout='150s'")
  DBI::dbExecute(con,"SET lock_timeout='5s'")
  DBI::dbExecute(con,"SET idle_in_transaction_session_timeout='60s'")
  DBI::dbExecute(con,paste0("SET search_path TO ",DBI::dbQuoteIdentifier(con,schema)))
  DBI::dbExecute(con,"DROP TRIGGER test_reject_demographic_delete ON demographic_typed_reading")
  DBI::dbExecute(con,"DROP FUNCTION test_reject_demographic_delete()")
  state_after_rollback <- read_full_snapshot()
  saveRDS(state_after_rollback,file.path(evidence_dir,"publication-after-failure-probes.rds"))
  writeLines(if(is.na(rollback_error)) "<no error>" else rollback_error,
    file.path(evidence_dir,"transaction-rollback-error.txt"),useBytes=TRUE)
  stopifnot(rollback_failed,identical(state_before_failures,state_after_rollback))
  actual <- DBI::dbGetQuery(con,"SELECT territory_id,territory_type,groupe,story_key,salience_reason,periode,
    solde_naturel,solde_migratoire,taux_solde_naturel,taux_solde_migratoire,classification,status
    FROM demographic_typed_reading ORDER BY territory_type,territory_id,groupe")
  expected <- project_demographic_reading(histories,territories,vintages,demographic_metadata)
  expected <- expected[order(expected$territory_type,expected$territory_id,expected$groupe),
    names(actual),drop=FALSE]; rownames(actual)<-rownames(expected)<-NULL
  stopifnot(isTRUE(all.equal(actual,expected,check.attributes=FALSE)),result$row_count==1268L)
  DBI::dbExecute(con,paste0("GRANT USAGE ON SCHEMA ",DBI::dbQuoteIdentifier(con,schema)," TO ",DBI::dbQuoteIdentifier(con,read_user)))
  DBI::dbExecute(con,paste0("GRANT SELECT ON ALL TABLES IN SCHEMA ",DBI::dbQuoteIdentifier(con,schema)," TO ",DBI::dbQuoteIdentifier(con,read_user)))
  read_con <- DBI::dbConnect(RPostgres::Postgres(),host=config$HOST,port=as.integer(config$PORT),
    dbname=config$DATABASE,user=read_user)
  DBI::dbExecute(read_con,"SET statement_timeout='45s'")
  DBI::dbExecute(read_con,"SET lock_timeout='5s'")
  DBI::dbExecute(read_con,paste0("SET search_path TO ",DBI::dbQuoteIdentifier(read_con,schema)))
  DBI::dbExecute(read_con,"SET transaction_read_only=on")
  read_identity <- DBI::dbGetQuery(read_con,"SELECT current_database() database,current_user username,
    inet_server_addr()::text server_address,masklen(inet_server_addr()) server_mask_bits")
  stopifnot(read_identity$database[[1L]]==config$DATABASE,read_identity$username[[1L]]==read_user,
    sub("/[0-9]+$","",read_identity$server_address[[1L]])=="192.168.16.3",
    as.integer(read_identity$server_mask_bits[[1L]])==32L)
  read_rows <- DBI::dbGetQuery(read_con,"SELECT territory_id,territory_type,groupe,story_key,salience_reason,periode,
    solde_naturel,solde_migratoire,taux_solde_naturel,taux_solde_migratoire,classification,status
    FROM demographic_typed_reading ORDER BY territory_type,territory_id,groupe")
  read_marker <- DBI::dbGetQuery(read_con,"SELECT content_version,row_count,reference_content_version,published_at
    FROM table_publication WHERE table_name='demographic_typed_reading'")
  read_clock <- DBI::dbGetQuery(read_con,"SELECT d.source_id,d.name AS source_name,v.vintage_id,v.version,
    v.reference_date,v.publication_date FROM source_dataset d JOIN source_vintage v USING(source_id)
    WHERE v.source_id=$1 AND v.vintage_id=$2",params=list(source$id[[1L]],expected_vintage_id))
  stopifnot(isTRUE(all.equal(read_rows,actual,check.attributes=FALSE)),
    isTRUE(all.equal(read_marker,marker_before_retry,check.attributes=FALSE)),nrow(read_clock)==1L,
    read_clock$source_name[[1L]]==source$source[[1L]],read_clock$version[[1L]]==source$version[[1L]],
    as.character(read_clock$reference_date[[1L]])==as.character(source$date_reference[[1L]]),
    as.character(read_clock$publication_date[[1L]])==as.character(source$date_publication[[1L]]))
  DBI::dbDisconnect(read_con); read_con <- NULL
  writeLines(jsonlite::toJSON(list(schema=schema,database=config$DATABASE,role=config$USER,
    row_count=nrow(actual),scalar_content_version=scalar_result$content_version,
    demographic_content_version=result$content_version,retry_unchanged=!isTRUE(retry$changed),
    invalid_binding_failed=expect_failure,transaction_rollback=rollback_failed,
    rollback_error=rollback_error,read_role=read_user,read_role_parity="PASS",
    read_role_marker_version=read_marker$content_version[[1L]],retained=TRUE),auto_unbox=TRUE,pretty=TRUE),
    file.path(evidence_dir,"proof-result.json"),useBytes=TRUE)
  cat("Canonical demographic typed readings: ",nrow(actual)," rows; retained scalar source clock → private typed artifact → registered demographic publisher → guarded PostgreSQL → dedicated read-role parity: PASS; scalar version ",scalar_result$content_version,"; demographic version ",result$content_version,"\n",sep="")
},finally={
  if(created) cat("Guarded schema retained: ",schema," in ",config$DATABASE,"; evidence: ",evidence_dir,"\n",sep="")
  if(!is.null(read_con)) DBI::dbDisconnect(read_con)
  DBI::dbDisconnect(con)
})
