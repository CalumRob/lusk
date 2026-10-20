#!/usr/bin/env Rscript
# Guarded canonical demographic reading → PostgreSQL → HTTP acceptance tracer.
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
stopifnot(nzchar(read_user),nzchar(read_dsn),read_user!=config$USER,
  identical(config$DATABASE,"lusk_it_contract"),identical(read_user,"lusk_it_contract_read"),
  identical(publish_dsn,"postgresql://lusk_it_contract_pub@192.168.1.120:5432/lusk_it_contract"),
  identical(read_dsn,"postgresql://lusk_it_contract_read@192.168.1.120:5432/lusk_it_contract"),
  file.exists(Sys.getenv("PGPASSFILE",unset="")),
  identical(Sys.getenv("LUSK_TEST_DATABASE_PREFIX"),"lusk_it_"),
  identical(Sys.getenv("LUSK_TEST_DATABASE_NAME"),config$DATABASE),dir.exists(canonical_dir))
con <- DBI::dbConnect(RPostgres::Postgres(),host=config$HOST,port=as.integer(config$PORT),
  dbname=config$DATABASE,user=config$USER)
DBI::dbExecute(con,"SET statement_timeout='150s'")
DBI::dbExecute(con,"SET lock_timeout='5s'")
DBI::dbExecute(con,"SET idle_in_transaction_session_timeout='60s'")
schema <- paste0("reading_it_",Sys.getpid(),"_",sample.int(1000000L,1L)); created <- FALSE
scalar_fixture <- tempfile("demographic-retained-scalar-"); dir.create(scalar_fixture)
on.exit(unlink(scalar_fixture,recursive=TRUE),add=TRUE)
tryCatch({
  identity <- DBI::dbGetQuery(con,"SELECT current_database() database,current_user username,
    inet_server_addr()::text server_address,inet_server_port() server_port")
  cat("Expected guarded DB identity: ",config$DATABASE," / ",config$USER,
      " via ",config$HOST,":",config$PORT,"; actual: ",identity$database[[1L]]," / ",identity$username[[1L]],
      " at ",identity$server_address[[1L]],":",identity$server_port[[1L]],"\n",sep="")
  stopifnot(identity$database[[1L]]==config$DATABASE,identity$username[[1L]]==config$USER,
    identity$server_address[[1L]]=="192.168.16.3",as.integer(identity$server_port[[1L]])==5432L)
  cat("Guarded schema manifest intent (before CREATE): ",config$DATABASE," / ",config$USER,
    " / ",schema,"; create only this random schema, retain by default\n",sep="")
  DBI::dbExecute(con,paste0("CREATE SCHEMA ",DBI::dbQuoteIdentifier(con,schema))); created <- TRUE
  schema_identity <- DBI::dbGetQuery(con,
    "SELECT n.nspname,r.rolname AS owner FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner WHERE n.nspname=$1",
    params=list(schema))
  cat("Guarded schema manifest after CREATE: ",schema_identity$nspname[[1L]]," / ",
    schema_identity$owner[[1L]],"\n",sep="")
  stopifnot(nrow(schema_identity)==1L,schema_identity$owner[[1L]]==config$USER)
  DBI::dbExecute(con,paste0("SET search_path TO ",DBI::dbQuoteIdentifier(con,schema)))
  ddl <- paste(readLines("../api/schema.sql",warn=FALSE),collapse="\n")
  for (statement in split_postgres_sql(ddl)) DBI::dbExecute(con,statement)
  read_canonical <- function(name) nanoparquet::read_parquet(file.path(canonical_dir,paste0(name,".parquet")))
  territories <- read_canonical("territoires"); vintages <- read_canonical("vintages")
  # The theme Parquet history stays the independent oracle of the stored rows.
  histories <- read_canonical("histoires_demographie")
  stopifnot(nrow(histories)==1268L)
  publish_canonical_territory_reference(con, canonical_dir)
  file.copy(file.path(canonical_dir,"territoires.parquet"),scalar_fixture,overwrite=TRUE)
  stopifnot(dir.exists(file.path(canonical_dir,"scalar-serving")))
  stopifnot(isTRUE(file.copy(file.path(canonical_dir,"scalar-serving"),scalar_fixture,recursive=TRUE)))
  reference <- project_territory_reference(territories)
  scalar <- project_retained_scalar_snapshot(scalar_fixture,reference,scalar_fixture)
  scalar_result <- publish_retained_scalar_snapshot(con,scalar,scalar_fixture)$scalar
  demographic_metadata <- lire_theme_metadata("demographie")
  source_ids <- unlist(lapply(demographic_metadata$semantic_resources,function(resource) {
    if(identical(resource$kind,"typed_reading")) resource$source_keys else NULL
  }),use.names=FALSE)
  stopifnot(length(source_ids)==1L)
  source <- vintages[vintages$id==source_ids[[1L]],,drop=FALSE]
  expected_vintage_id <- paste(source$version[[1L]],source$date_reference[[1L]],sep="/")
  registered_clock <- DBI::dbGetQuery(con,"SELECT source_id,vintage_id,version,reference_date,publication_date
    FROM source_vintage WHERE source_id=$1 AND vintage_id=$2",params=list(source$id[[1L]],expected_vintage_id))
  cat("Canonical source clock after retained scalar publication:\n")
  print(registered_clock)
  stopifnot(nrow(registered_clock)==1L,registered_clock$version[[1L]]==source$version[[1L]],
    as.character(registered_clock$reference_date[[1L]])==as.character(source$date_reference[[1L]]),
    as.character(registered_clock$publication_date[[1L]])==as.character(source$date_publication[[1L]]),
    !DBI::dbGetQuery(con,"SELECT EXISTS(SELECT 1 FROM source_vintage WHERE source_id=$1 AND vintage_id=$1) present",
      params=list(source$id[[1L]] ) )$present[[1L]])
  # The published reading is the owner-scoped serving artifact: the theme Parquet
  # history above is only the independent oracle, never re-projected here.
  publication <- read_typed_reading_publication_from(canonical_dir,"demographie")
  canonical <- list(reading=publication$reading,content_version=publication$content_version)
  registry <- register_typed_reading_artifact_publisher(list(),"demographie",publish_demographic_reading)
  result <- publish_registered_typed_reading(registry,"demographie",canonical,con)
  marker_before_retry <- DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name='demographic_typed_reading'")
  retry <- publish_registered_typed_reading(registry,"demographie",canonical,con)
  stopifnot(isTRUE(result$changed),!isTRUE(retry$changed),identical(marker_before_retry,
     DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name='demographic_typed_reading'")))
  cat("Demographic publication marker after first publish (unchanged on retry):\n")
  print(marker_before_retry)
  bad <- canonical
  bad$reading$vintage_id[] <- "stale/clock"
  expect_failure <- tryCatch({publish_registered_typed_reading(registry,"demographie",bad,con);FALSE},error=function(e) TRUE)
  stopifnot(expect_failure,identical(marker_before_retry,
    DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name='demographic_typed_reading'")))
  actual <- DBI::dbGetQuery(con,"SELECT territory_id,territory_type,groupe,story_key,salience_reason,periode,
    solde_naturel,solde_migratoire,taux_solde_naturel,taux_solde_migratoire,classification,status
    FROM demographic_typed_reading ORDER BY territory_type,territory_id,groupe")
  expected <- project_demographic_reading(histories,territories,vintages,demographic_metadata)
  expected <- expected[order(expected$territory_type,expected$territory_id,expected$groupe),
    names(actual),drop=FALSE]; rownames(actual)<-rownames(expected)<-NULL
  stopifnot(isTRUE(all.equal(actual,expected,check.attributes=FALSE)),result$row_count==1268L)
  DBI::dbExecute(con,paste0("GRANT USAGE ON SCHEMA ",DBI::dbQuoteIdentifier(con,schema)," TO ",DBI::dbQuoteIdentifier(con,read_user)))
  DBI::dbExecute(con,paste0("GRANT SELECT ON ALL TABLES IN SCHEMA ",DBI::dbQuoteIdentifier(con,schema)," TO ",DBI::dbQuoteIdentifier(con,read_user)))
  keys<-c("LUSK_READING_HTTP_SCHEMA","PYTHONPATH"); old<-Sys.getenv(keys,unset=NA_character_)
  on.exit(for(i in seq_along(keys)) if(is.na(old[[i]])) Sys.unsetenv(keys[[i]]) else do.call(Sys.setenv,setNames(list(old[[i]]),keys[[i]])),add=TRUE)
  Sys.setenv(LUSK_READING_HTTP_SCHEMA=schema,PYTHONPATH=normalizePath("..",winslash="/",mustWork=TRUE))
  test<-normalizePath("../api/tests/integration/test_reading_publisher_http.py",winslash="/",mustWork=TRUE)
  status<-system2(Sys.which("python"),c("-m","pytest","-q",shQuote(test,type="cmd"),"-k","demographic"),
    stdout="",stderr="",env="PGOPTIONS=-c statement_timeout=45000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=60000")
  if(!identical(status,0L)) stop("Canonical demographic publisher-to-HTTP parity failed",call.=FALSE)
  cat("Canonical demographic typed readings: ",nrow(actual)," rows; retained scalar source clock → typed artifact → registered demographic publisher → guarded PostgreSQL → HTTP: PASS; scalar version ",scalar_result$content_version,"; demographic version ",result$content_version,"\n",sep="")
},finally={
  if(created && identical(Sys.getenv("LUSK_TEST_ALLOW_SCHEMA_CLEANUP"),"1")) cleanup_serving_smoke_schema(con,schema,"reading")
  if(created && !identical(Sys.getenv("LUSK_TEST_ALLOW_SCHEMA_CLEANUP"),"1"))
    cat("Guarded schema retained: ",schema," in ",config$DATABASE,"\n",sep="")
  DBI::dbDisconnect(con)
})
