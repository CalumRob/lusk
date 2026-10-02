#!/usr/bin/env Rscript
# Invoked by the guarded Python HTTP acceptance test in its own disposable schema.
pkgload::load_all(".", quiet=TRUE)
args <- commandArgs(TRUE)
stopifnot(length(args)==1L, grepl("^it_[a-f0-9]{20}$", args[[1L]]),
  identical(Sys.getenv("LUSK_TEST_DATABASE_PREFIX"), "lusk_it_"),
  grepl("^lusk_it_[A-Za-z0-9_]+$", Sys.getenv("LUSK_TEST_DATABASE_NAME")),
  identical(Sys.getenv("LUSK_PROFILE_TEST_DATABASE"), Sys.getenv("LUSK_TEST_DATABASE_NAME")))
con <- DBI::dbConnect(RPostgres::Postgres(), host=Sys.getenv("LUSK_PROFILE_TEST_HOST"),
  port=as.integer(Sys.getenv("LUSK_PROFILE_TEST_PORT")),
  dbname=Sys.getenv("LUSK_PROFILE_TEST_DATABASE"), user=Sys.getenv("LUSK_PROFILE_TEST_USER"))
tryCatch({
  identity <- DBI::dbGetQuery(con, "SELECT current_database() AS database,current_user AS username")
  stopifnot(identical(identity$database[[1L]], Sys.getenv("LUSK_TEST_DATABASE_NAME")),
    identical(identity$username[[1L]], Sys.getenv("LUSK_PROFILE_TEST_USER")))
  DBI::dbExecute(con, paste("SET search_path TO", DBI::dbQuoteIdentifier(con, args[[1L]])))
  canonical_dir <- Sys.getenv("LUSK_TEST_CANONICAL_DATA_DIR")
  reference <- preparer_tables_service(canonical_dir)$tables$territory_reference
  DBI::dbWriteTable(con, "territory_reference", reference, append=TRUE, row.names=FALSE)
  DBI::dbExecute(con,
    "INSERT INTO table_publication(table_name,content_version,row_count) VALUES ('territory_reference',$1,$2)",
    params=list(scalar_content_version(reference), nrow(reference)))
  inputs <- read_programme_serving_inputs(canonical_dir)
  registry <- register_programme_series_publishers(list(), inputs$metadata)
  adapter <- owned_series_postgres_adapter(con)
  result <- publish_registered_series(registry, "subventions_annuelles_owned", inputs$canonical, adapter)
  retry <- publish_registered_series(registry, "subventions_annuelles_owned", inputs$canonical, adapter)
  stopifnot(result$changed, !retry$changed)
  marker <- adapter$dataset_marker("subventions_annuelles")
  inconsistent <- inputs$canonical
  inconsistent$programmes$subventions$vintage_version[[1L]] <- "stale-input"
  stopifnot(inherits(try(publish_registered_series(registry,"subventions_annuelles_owned",
    inconsistent,adapter),silent=TRUE),"try-error"),
    identical(marker,adapter$dataset_marker("subventions_annuelles")))
  invalid <- inputs$metadata
  invalid$indicator_pages$subventions_annuelles$comparison$dimension <- "9999"
  invalid_registry <- register_programme_series_publishers(list(),invalid)
  stopifnot(inherits(try(publish_registered_series(invalid_registry,"subventions_annuelles_owned",
    inputs$canonical,adapter),silent=TRUE),"try-error"),
    identical(marker,adapter$dataset_marker("subventions_annuelles")))
  cat("Canonical annual grant registered publication and unchanged retry passed\n")
}, finally=DBI::dbDisconnect(con))
