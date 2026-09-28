#!/usr/bin/env Rscript
# Explicitly disposable PostgreSQL integration check for the profile publisher.
pkgload::load_all(".", quiet=TRUE)
required <- c("HOST", "PORT", "DATABASE", "USER")
config <- setNames(lapply(required, function(key) Sys.getenv(paste0("LUSK_PROFILE_TEST_", key), unset="")), required)
stopifnot(all(vapply(config, nzchar, logical(1))), grepl("^lusk_it_[A-Za-z0-9_]+$", config$DATABASE),
  grepl("^[A-Za-z0-9_.:-]+$", config$HOST), grepl("^[0-9]+$", config$PORT))
if (!requireNamespace("DBI", quietly=TRUE) || !requireNamespace("RPostgres", quietly=TRUE))
  stop("DBI and RPostgres are required")
con <- DBI::dbConnect(RPostgres::Postgres(), host=config$HOST, port=as.integer(config$PORT),
  dbname=config$DATABASE, user=config$USER)
schema <- paste0("profile_it_", Sys.getpid())
created <- FALSE
tryCatch({
  DBI::dbExecute(con,paste0("CREATE SCHEMA ",DBI::dbQuoteIdentifier(con,schema)))
  created <- TRUE
  DBI::dbExecute(con,paste0("SET search_path TO ",DBI::dbQuoteIdentifier(con,schema)))
  ddl <- paste(readLines("../api/schema.sql",warn=FALSE),collapse="\n")
  for (statement in split_postgres_sql(ddl)) DBI::dbExecute(con,statement)
  payload <- compute_payload(load_fixture())
  metadata <- jsonlite::fromJSON("inst/extdata/theme-metadata/theme_demographie.json",simplifyVector=FALSE)
  projection <- project_structure_age_profile(payload,metadata)
  territories <- projection$eligible_territories
  reference <- data.frame(territory_id=territories$territory_id,territory_type=territories$territory_type,
    name=territories$territory_id,department_id=NA_character_,epci_id=NA_character_,
    density_class_code=NA_character_,density_class_label=NA_character_)
  # Fixture reference identities need valid type-to-scope values only for this test.
  DBI::dbWriteTable(con,"territory_reference",reference,append=TRUE,row.names=FALSE)
  reference_version <- "profile-reference-fixture-v1"
  DBI::dbExecute(con,"INSERT INTO table_publication(table_name,content_version,row_count) VALUES('territory_reference',$1,$2)",
    params=list(reference_version,nrow(reference)))
  registry <- register_structure_age_profile_publisher(list(),metadata)
  adapter <- profile_postgres_adapter(con)
  first <- publish_registered_profile(registry,"structure_age",payload,adapter)
  facts_before <- DBI::dbGetQuery(con,"SELECT territory_id,territory_type,detail_key,sex_key,value,status FROM profile_observation ORDER BY territory_type,territory_id,detail_key,sex_key")
  marker_before <- DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version FROM table_publication WHERE table_name='declared_profile'")
  stopifnot(first$changed, marker_before$row_count[[1L]]==nrow(projection$facts),
    marker_before$reference_content_version[[1L]]==reference_version,
    DBI::dbGetQuery(con,"SELECT count(*) AS n FROM profile_observation_source")$n[[1L]]==nrow(projection$facts))
  DBI::dbExecute(con,"CREATE FUNCTION reject_profile_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'profile fixture failure'; END $$")
  DBI::dbExecute(con,"CREATE TRIGGER reject_profile BEFORE INSERT ON profile_observation FOR EACH ROW EXECUTE FUNCTION reject_profile_insert()")
  changed <- payload
  changed$indicateurs$value[which(changed$indicateurs$key=="structure_age")[[1L]]] <-
    changed$indicateurs$value[which(changed$indicateurs$key=="structure_age")[[1L]]] + 0.001
  failed <- try(publish_registered_profile(registry,"structure_age",changed,adapter),silent=TRUE)
  stopifnot(inherits(failed,"try-error"),
    identical(marker_before,DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version FROM table_publication WHERE table_name='declared_profile'")),
    identical(facts_before,DBI::dbGetQuery(con,"SELECT territory_id,territory_type,detail_key,sex_key,value,status FROM profile_observation ORDER BY territory_type,territory_id,detail_key,sex_key")))
  cat("Profile PostgreSQL publication, lineage, independent marker, and rollback: PASS\n")
},finally={
  if (created) {
    DBI::dbExecute(con,paste0("DROP SCHEMA ",DBI::dbQuoteIdentifier(con,schema)," CASCADE"))
  }
  DBI::dbDisconnect(con)
})
