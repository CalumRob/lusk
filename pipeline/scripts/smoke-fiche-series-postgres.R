#!/usr/bin/env Rscript
# Guarded canonical owned-series publication used by the HTTP acceptance proof.
pkgload::load_all(".", quiet=TRUE)
args <- commandArgs(TRUE)
stopifnot(length(args)==1L, grepl("^it_[a-f0-9]{20}$", args[[1L]]),
  identical(Sys.getenv("LUSK_TEST_DATABASE_PREFIX"), "lusk_it_"),
  startsWith(Sys.getenv("LUSK_TEST_DATABASE_NAME"), "lusk_it_"),
  identical(Sys.getenv("LUSK_PROFILE_TEST_DATABASE"), Sys.getenv("LUSK_TEST_DATABASE_NAME")))
con <- DBI::dbConnect(RPostgres::Postgres(), host=Sys.getenv("LUSK_PROFILE_TEST_HOST"),
  port=as.integer(Sys.getenv("LUSK_PROFILE_TEST_PORT")),
  dbname=Sys.getenv("LUSK_PROFILE_TEST_DATABASE"),
  user=Sys.getenv("LUSK_PROFILE_TEST_USER"))
tryCatch({
  identity <- DBI::dbGetQuery(con, "SELECT current_database() AS database,current_user AS username")
  stopifnot(identical(identity$database[[1L]], Sys.getenv("LUSK_TEST_DATABASE_NAME")),
    identical(identity$username[[1L]], Sys.getenv("LUSK_PROFILE_TEST_USER")))
  DBI::dbExecute(con, paste("SET search_path TO", DBI::dbQuoteIdentifier(con, args[[1L]])))
  sortie <- Sys.getenv("LUSK_TEST_CANONICAL_DATA_DIR")
  publish_canonical_territory_reference(con, sortie)
  adapter <- owned_series_postgres_adapter(con)
  for (id in c("prix_m2", "conso_enaf_annuel", "artif_par_habitant")) {
    projection <- read_owned_series_artifact(file.path(sortie, "series-serving", id), id)
    first <- publish_owned_series_projection(projection, adapter)
    retry <- publish_owned_series_projection(projection, adapter)
    stopifnot(first$changed, !retry$changed)
  }
}, finally=DBI::dbDisconnect(con))
