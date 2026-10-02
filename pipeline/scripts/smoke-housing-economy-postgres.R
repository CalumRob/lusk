#!/usr/bin/env Rscript
# Guarded canonical scalar publication + HTTP check for #627's eco_activites.
pkgload::load_all(".", quiet=TRUE)
required <- c("HOST", "PORT", "DATABASE", "USER")
config <- setNames(lapply(required, function(k) Sys.getenv(paste0("LUSK_PROFILE_TEST_", k), unset="")), required)
stopifnot(all(vapply(config, nzchar, logical(1))),
  grepl("^lusk_it_[A-Za-z0-9_]+$", config$DATABASE),
  !tolower(config$DATABASE) %in% c("lusk", "postgres", "template0", "template1"),
  grepl("^[A-Za-z0-9_.:-]+$", config$HOST), grepl("^[0-9]+$", config$PORT))
read_user <- Sys.getenv("LUSK_TEST_READ_USER", unset="")
read_dsn <- Sys.getenv("LUSK_TEST_READ_DSN", unset="")
stopifnot(nzchar(read_user), nzchar(read_dsn), read_user != config$USER,
  identical(Sys.getenv("LUSK_TEST_DATABASE_PREFIX"), "lusk_it_"),
  identical(Sys.getenv("LUSK_TEST_DATABASE_NAME"), config$DATABASE))
canonical_dir <- Sys.getenv("LUSK_TEST_CANONICAL_DATA_DIR", unset="")
stopifnot(nzchar(canonical_dir), dir.exists(canonical_dir))
con <- DBI::dbConnect(RPostgres::Postgres(), host=config$HOST, port=as.integer(config$PORT),
  dbname=config$DATABASE, user=config$USER)
schema <- paste0("profile_it_", Sys.getpid(), "_economy")
created <- FALSE
tryCatch({
  identity <- DBI::dbGetQuery(con, "SELECT current_database() AS database,current_user AS username")
  stopifnot(identical(identity$database[[1L]], config$DATABASE),
    identical(identity$username[[1L]], config$USER))
  DBI::dbExecute(con, paste0("CREATE SCHEMA ", DBI::dbQuoteIdentifier(con, schema)))
  created <- TRUE
  DBI::dbExecute(con, paste0("SET search_path TO ", DBI::dbQuoteIdentifier(con, schema)))
  ddl <- paste(readLines("../api/schema.sql", warn=FALSE), collapse="\n")
  for (statement in split_postgres_sql(ddl)) DBI::dbExecute(con, statement)

  inputs <- preparer_tables_service(canonical_dir)
  complete <- project_service_scalar_snapshot(inputs, canonical_dir)
  stopifnot("eco_activites" %in% complete$projection$descriptors$indicator_id,
    nrow(complete$projection$descriptors) == 43L,
    nrow(complete$projection$facts[complete$projection$facts$indicator_id != "eco_activites", , drop=FALSE]) == 53253L,
    nrow(complete$projection$facts[complete$projection$facts$indicator_id == "eco_activites", , drop=FALSE]) > 0L)
  DBI::dbWriteTable(con, "territory_reference", inputs$tables$territory_reference,
    append=TRUE, row.names=FALSE)
  reference_version <- "canonical-housing-economy-reference"
  DBI::dbExecute(con, "INSERT INTO table_publication(table_name,content_version,row_count) VALUES ('territory_reference',$1,$2)",
    params=list(reference_version,nrow(inputs$tables$territory_reference)))
  publish_service_share_scalars(con, inputs$scalar_access, inputs$scalar_metadata,
    inputs$scalar_eligible_territories, additional_projections=complete$additional_projections)
  expected_eco <- complete$projection$facts[complete$projection$facts$indicator_id == "eco_activites", , drop=FALSE]
  actual_eco <- DBI::dbGetQuery(con, "SELECT indicator_id,territory_id,territory_type,value,status,support_count,denominator_count FROM scalar_observation WHERE indicator_id='eco_activites' ORDER BY territory_type,territory_id")
  expected_eco <- expected_eco[order(expected_eco$territory_type, expected_eco$territory_id),
    c("indicator_id","territory_id","territory_type","value","status","support_count","denominator_count"), drop=FALSE]
  rownames(actual_eco) <- rownames(expected_eco) <- NULL
  stopifnot(isTRUE(all.equal(actual_eco, expected_eco, check.attributes=FALSE)),
    DBI::dbGetQuery(con, "SELECT count(*) AS n FROM scalar_descriptor")$n[[1L]] == 43L,
    DBI::dbGetQuery(con, "SELECT row_count FROM table_publication WHERE table_name='scalar_observation'")$row_count[[1L]] ==
      53253L + nrow(expected_eco))
  focal <- DBI::dbGetQuery(con, "SELECT indicator_id,territory_id,value,status,support_count,denominator_count FROM scalar_observation WHERE indicator_id='eco_activites' AND territory_type='commune' AND territory_id='35238'")
  stopifnot(nrow(focal)==1L)
  DBI::dbExecute(con, paste0("GRANT USAGE ON SCHEMA ", DBI::dbQuoteIdentifier(con, schema),
    " TO ", DBI::dbQuoteIdentifier(con, read_user)))
  DBI::dbExecute(con, paste0("GRANT SELECT ON ALL TABLES IN SCHEMA ", DBI::dbQuoteIdentifier(con, schema),
    " TO ", DBI::dbQuoteIdentifier(con, read_user)))
  keys <- c("LUSK_HOUSING_HTTP_SCHEMA", "LUSK_HOUSING_HTTP_TERRITORY", "PYTHONPATH")
  old <- Sys.getenv(keys, unset=NA_character_)
  on.exit(for (i in seq_along(keys)) if (is.na(old[[i]])) Sys.unsetenv(keys[[i]]) else
    do.call(Sys.setenv, setNames(list(old[[i]]), keys[[i]])), add=TRUE)
  Sys.setenv(LUSK_HOUSING_HTTP_SCHEMA=schema, LUSK_HOUSING_HTTP_TERRITORY="35238",
    PYTHONPATH=normalizePath("..", winslash="/", mustWork=TRUE))
  status <- system2(Sys.which("python"), c("-m", "pytest", "-q",
    shQuote(normalizePath("../api/tests/integration/test_housing_economy_publisher_http.py", winslash="/", mustWork=TRUE), type="cmd")),
    stdout="", stderr="")
  if (!identical(status, 0L)) stop("Canonical economy publisher-to-HTTP parity failed", call.=FALSE)
  cat("Registered full scalar snapshot (43 descriptors), eco_activites PostgreSQL and HTTP parity: PASS\n")
}, finally={
  if (created) cleanup_serving_smoke_schema(con, schema, "profile")
  DBI::dbDisconnect(con)
})
