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
},finally=DBI::dbDisconnect(con))
