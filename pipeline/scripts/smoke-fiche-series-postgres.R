#!/usr/bin/env Rscript
# Invoked by guarded canonical HTTP acceptance, only inside its disposable schema.
pkgload::load_all(".",quiet=TRUE)
args <- commandArgs(TRUE)
stopifnot(length(args)==1L,grepl("^it_[a-f0-9]{20}$",args[[1L]]),
  identical(Sys.getenv("LUSK_TEST_DATABASE_PREFIX"),"lusk_it_"),
  startsWith(Sys.getenv("LUSK_TEST_DATABASE_NAME"),"lusk_it_"),
  identical(Sys.getenv("LUSK_PROFILE_TEST_DATABASE"),Sys.getenv("LUSK_TEST_DATABASE_NAME")))
con <- DBI::dbConnect(RPostgres::Postgres(),host=Sys.getenv("LUSK_PROFILE_TEST_HOST"),
  port=as.integer(Sys.getenv("LUSK_PROFILE_TEST_PORT")),dbname=Sys.getenv("LUSK_PROFILE_TEST_DATABASE"),
  user=Sys.getenv("LUSK_PROFILE_TEST_USER"))
tryCatch({
  identity <- DBI::dbGetQuery(con,"SELECT current_database() AS database,current_user AS username")
  stopifnot(identical(identity$database[[1L]],Sys.getenv("LUSK_TEST_DATABASE_NAME")),
    identical(identity$username[[1L]],Sys.getenv("LUSK_PROFILE_TEST_USER")))
  DBI::dbExecute(con,paste("SET search_path TO",DBI::dbQuoteIdentifier(con,args[[1L]])))
  sortie <- Sys.getenv("LUSK_TEST_CANONICAL_DATA_DIR")
  reference <- preparer_tables_service(sortie)$tables$territory_reference
  DBI::dbWriteTable(con,"territory_reference",reference,append=TRUE,row.names=FALSE)
  DBI::dbExecute(con,"INSERT INTO table_publication(table_name,content_version,row_count) VALUES('territory_reference',$1,$2)",
    params=list(scalar_content_version(reference),nrow(reference)))
  metadata <- lire_theme_metadata("habitat")
  canonical <- list(habitat=list(indicateurs=nanoparquet::read_parquet(file.path(sortie,"indicateurs_habitat.parquet"))),
    vintages=nanoparquet::read_parquet(file.path(sortie,"vintages.parquet")))
  registry <- register_prix_m2_owned_publisher(list(),metadata)
  adapter <- owned_series_postgres_adapter(con)
  first <- publish_registered_series(registry,"prix_m2_owned",canonical,adapter)
  retry <- publish_registered_series(registry,"prix_m2_owned",canonical,adapter)
  stopifnot(first$changed,!retry$changed)
  canonical$indicateurs <- nanoparquet::read_parquet(file.path(sortie,"indicateurs_milieux.parquet"))
  canonical$histoires <- nanoparquet::read_parquet(file.path(sortie,"histoires_milieux.parquet"))
  milieux <- lire_theme_metadata("milieux")
  registry <- register_owned_series_publishers(list(),milieux)
  for (name in names(registry)) {
    first <- publish_registered_series(registry,name,canonical,adapter)
    retry <- publish_registered_series(registry,name,canonical,adapter)
    stopifnot(first$changed,!retry$changed)
  }
  milieux_publication <- publish_canonical_milieux_reading(con,sortie)
  reading <- milieux_publication$reading
  reading_input <- list(histories=canonical$histoires,vintages=canonical$vintages,
    indicateurs=canonical$indicateurs,metadata=milieux)
  registry <- register_milieux_reading_publisher(list())
  marker_before_retry <- DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name='milieux_typed_reading'")
  sources_before_retry <- DBI::dbGetQuery(con,"SELECT count(*) n FROM milieux_reading_source")$n[[1L]]
  retry <- publish_registered_typed_reading(registry,"milieux",reading_input,con)
  marker_after_retry <- DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name='milieux_typed_reading'")
  sources_after_retry <- DBI::dbGetQuery(con,"SELECT count(*) n FROM milieux_reading_source")$n[[1L]]
  stopifnot(reading$changed,!retry$changed,reading$row_count==nrow(canonical$histoires),reading$source_row_count>reading$row_count,
    isTRUE(all.equal(marker_before_retry,marker_after_retry,check.attributes=FALSE)),sources_before_retry==sources_after_retry)
  projection <- registry$milieux$project(reading_input)
  bindings <- attr(projection,"source_bindings")
  invalid <- rbind(projection,projection[1,,drop=FALSE])
  attr(invalid,"source_bindings") <- bindings
  rolled_back <- try(publish_milieux_reading(con,invalid,reading_input),silent=TRUE)
  stopifnot(inherits(rolled_back,"try-error"))
  marker_after_failure <- DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name='milieux_typed_reading'")
  stopifnot(isTRUE(all.equal(marker_before_retry,marker_after_failure,check.attributes=FALSE)),
    DBI::dbGetQuery(con,"SELECT count(*) n FROM milieux_typed_reading")$n[[1L]]==reading$row_count,
    DBI::dbGetQuery(con,"SELECT count(*) n FROM milieux_reading_source")$n[[1L]]==reading$source_row_count)
},finally=DBI::dbDisconnect(con))
