#!/usr/bin/env Rscript
# Opt-in integration smoke against a dedicated lusk_it_* database. Never reads
# production configuration; requires explicit LUSK_SCALAR_TEST_* variables.
pkgload::load_all(".", quiet=TRUE)
required <- c("HOST", "PORT", "DATABASE", "USER")
config <- setNames(lapply(required, function(suffix)
  Sys.getenv(paste0("LUSK_SCALAR_TEST_", suffix), unset="")), required)
stopifnot(all(vapply(config, nzchar, logical(1))),
          grepl("^lusk_it_[A-Za-z0-9_]+$", config$DATABASE),
          !tolower(config$DATABASE) %in% c("lusk", "postgres", "template0", "template1"),
          grepl("^[A-Za-z0-9_.:-]+$", config$HOST),
          grepl("^[0-9]+$", config$PORT))
if (!requireNamespace("RPostgres", quietly=TRUE) || !requireNamespace("DBI", quietly=TRUE))
  stop("DBI and RPostgres are required")

connection <- DBI::dbConnect(RPostgres::Postgres(), host=config$HOST,
  port=as.integer(config$PORT), dbname=config$DATABASE, user=config$USER)
schema <- paste0("scalar_it_", Sys.getpid(), "_", sprintf("%08x", sample.int(.Machine$integer.max, 1L)))
created <- FALSE
execute_sql_file <- function(path) {
  sql <- paste(readLines(path, warn=FALSE), collapse="\n")
  chars <- strsplit(sql, "", fixed=TRUE)[[1L]]
  statements <- character(); buffer <- character()
  single <- double <- line_comment <- FALSE; dollar <- NULL; i <- 1L
  while (i <= length(chars)) {
    ch <- chars[[i]]; next_ch <- if (i < length(chars)) chars[[i+1L]] else ""
    if (line_comment) {
      if (ch == "\n") line_comment <- FALSE
    } else if (!single && !double && is.null(dollar) && ch == "-" && next_ch == "-") {
      line_comment <- TRUE; i <- i + 1L
    } else if (!double && is.null(dollar) && ch == "'") {
      if (single && next_ch == "'") { buffer <- c(buffer, ch, next_ch); i <- i + 1L }
      else single <- !single
    } else if (!single && is.null(dollar) && ch == '"') {
      if (double && next_ch == '"') { buffer <- c(buffer, ch, next_ch); i <- i + 1L }
      else double <- !double
    } else if (!single && !double && ch == "$") {
      rest <- paste0(chars[i:length(chars)], collapse="")
      tag <- regmatches(rest, regexpr("^\\$[A-Za-z_0-9]*\\$", rest))
      if (length(tag) && nzchar(tag)) {
        if (is.null(dollar)) dollar <- tag
        else if (identical(dollar, tag)) dollar <- NULL
        buffer <- c(buffer, strsplit(tag, "", fixed=TRUE)[[1L]])
        i <- i + nchar(tag) - 1L
      } else buffer <- c(buffer, ch)
    } else if (!single && !double && is.null(dollar) && ch == ";") {
      statement <- trimws(paste(buffer, collapse=""))
      if (nzchar(statement)) statements <- c(statements, statement)
      buffer <- character()
    } else buffer <- c(buffer, ch)
    i <- i + 1L
  }
  tail <- trimws(paste(buffer, collapse=""))
  if (nzchar(tail)) statements <- c(statements, tail)
  for (statement in statements) DBI::dbExecute(connection, statement)
  invisible(length(statements))
}
tryCatch({
  DBI::dbExecute(connection, paste0("CREATE SCHEMA ", as.character(DBI::dbQuoteIdentifier(connection, schema))))
  created <- TRUE
  cat("Scalar smoke schema created:", schema, "\n")
  DBI::dbExecute(connection, paste0("SET search_path TO ", as.character(DBI::dbQuoteIdentifier(connection, schema))))
  execute_sql_file(file.path("..", "api", "schema.sql"))

  fixture <- readr::read_csv("tests/testthat/fixtures/demographie-fixture.csv",
    col_types=readr::cols(code=readr::col_character(), epci=readr::col_character()),
    show_col_types=FALSE)
  payload <- compute_payload(fixture)
  descriptor <- jsonlite::fromJSON("inst/extdata/theme-metadata/theme_demographie.json", simplifyVector=FALSE)
  projection <- project_fixture_scalar(payload, descriptor, "dense_complete")
  # Add explicit test-only lineage to exercise the multi-source normalized
  # association contract. No fabricated source is used by production projection.
  extra <- "integration_secondary"
  projection$descriptors$allowed_sources[[1L]] <- c(projection$descriptors$allowed_sources[[1L]], extra)
  projection$datasets <- rbind(projection$datasets, data.frame(source_id=extra, name="Integration secondary"))
  secondary_vintage <- paste0("synthetic/", projection$vintages$vintage_id[[1L]])
  v <- projection$vintages[1L, , drop=FALSE]
  v$source_id <- extra; v$vintage_id <- secondary_vintage
  v$version <- paste0("synthetic-", v$version)
  projection$vintages <- rbind(projection$vintages, v)
  secondary <- projection$provenance
  secondary$source_id <- extra; secondary$vintage_id <- secondary_vintage
  projection$provenance <- rbind(projection$provenance, secondary)

  territory_rows <- projection$eligible_territories
  territory_rows$name <- territory_rows$territory_id
  territory_rows$department_id <- NA_character_
  territory_rows$epci_id <- NA_character_
  territory_rows$density_class_code <- NA_character_
  territory_rows$density_class_label <- NA_character_
  DBI::dbWriteTable(connection, "territory_reference", territory_rows,
    append=TRUE, row.names=FALSE)
  DBI::dbExecute(connection, "INSERT INTO table_publication(table_name,content_version,row_count) VALUES('territory_reference','reference-smoke-v1',$1)",
    params=list(nrow(territory_rows)))

  registry <- register_scalar_publisher(list(), "smoke", function(x) projection,
    function(p, db, version) db$replace(p, version))
  adapter <- scalar_postgres_adapter(connection)
  first <- publish_registered_scalar(registry, "smoke", NULL, adapter)
  marker <- DBI::dbGetQuery(connection, "SELECT content_version, row_count, reference_content_version FROM table_publication WHERE table_name='scalar_observation'")
  stopifnot(first$changed, marker$row_count[[1L]] == nrow(projection$facts))
  actual <- DBI::dbGetQuery(connection, "SELECT o.territory_id,o.value,o.status,d.label,d.descriptor_version,p.content_version,(SELECT count(*) FROM scalar_observation_source s WHERE s.indicator_id=o.indicator_id AND s.territory_id=o.territory_id) AS source_count FROM scalar_observation o JOIN scalar_descriptor d USING(indicator_id) CROSS JOIN table_publication p WHERE p.table_name='scalar_observation' AND o.indicator_id='densite' ORDER BY o.territory_id LIMIT 1")
  actual_sources <- DBI::dbGetQuery(connection, "SELECT os.source_id,os.vintage_id,sv.version FROM scalar_observation_source os JOIN source_vintage sv USING(source_id,vintage_id) WHERE os.indicator_id='densite' AND os.territory_id=$1 ORDER BY os.source_id", params=list(actual$territory_id[[1L]]))
  expected <- projection$facts[order(projection$facts$territory_id), , drop=FALSE][1L, , drop=FALSE]
  expected_sources <- projection$provenance[projection$provenance$territory_id == expected$territory_id[[1L]], , drop=FALSE]
  expected_vintages <- projection$vintages[match(paste(expected_sources$source_id, expected_sources$vintage_id),
    paste(projection$vintages$source_id, projection$vintages$vintage_id)), , drop=FALSE]
  stopifnot(nrow(actual)==1L, actual$source_count[[1L]]==2L,
    identical(actual$content_version[[1L]], marker$content_version[[1L]]),
    identical(actual$territory_id[[1L]], expected$territory_id[[1L]]),
    identical(actual$value[[1L]], expected$value[[1L]]),
    identical(actual$status[[1L]], expected$status[[1L]]),
    identical(actual$label[[1L]], projection$descriptors$label[[1L]]),
    identical(actual$descriptor_version[[1L]], projection$descriptors$descriptor_version[[1L]]),
    setequal(actual_sources$source_id, projection$descriptors$allowed_sources[[1L]]),
    setequal(paste(actual_sources$source_id, actual_sources$vintage_id),
      paste(expected_sources$source_id, expected_sources$vintage_id)),
    setequal(actual_sources$version, expected_vintages$version),
    nrow(actual_sources)==2L)
  no_op <- publish_registered_scalar(registry, "smoke", NULL, adapter)
  stopifnot(!no_op$changed)

  # Rebinding the territory dependency must not change scalar content identity.
  DBI::dbExecute(connection, "UPDATE table_publication SET content_version='reference-smoke-v2' WHERE table_name='territory_reference'")
  rebound <- publish_registered_scalar(registry, "smoke", NULL, adapter)
  after_rebind <- DBI::dbGetQuery(connection, "SELECT content_version,reference_content_version FROM table_publication WHERE table_name='scalar_observation'")
  stopifnot(!rebound$changed, rebound$compatibility_updated,
    identical(after_rebind$content_version[[1L]], marker$content_version[[1L]]),
    identical(after_rebind$reference_content_version[[1L]], "reference-smoke-v2"))

  # Simulate a local commit newer than the DB marker and verify idempotent retry.
  DBI::dbExecute(connection, "UPDATE table_publication SET content_version='db-behind' WHERE table_name='scalar_observation'")
  retry <- publish_registered_scalar(registry, "smoke", NULL, adapter)
  stopifnot(retry$changed, identical(DBI::dbGetQuery(connection,
    "SELECT content_version FROM table_publication WHERE table_name='scalar_observation'")$content_version[[1L]], marker$content_version[[1L]]))

  # Inject a transaction-local failure after replacement begins; old rows and
  # marker must both survive rollback.
  DBI::dbExecute(connection, "CREATE FUNCTION reject_smoke_value() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.value=-999999 THEN RAISE EXCEPTION 'injected scalar smoke failure'; END IF; RETURN NEW; END $$")
  DBI::dbExecute(connection, "CREATE TRIGGER reject_smoke_value BEFORE INSERT ON scalar_observation FOR EACH ROW EXECUTE FUNCTION reject_smoke_value()")
  failing <- register_scalar_publisher(list(), "fail", function(x) {
    p <- projection; p$facts$value[[1L]] <- -999999; p
  }, function(p, db, version) db$replace(p, version))
  previous_rows <- DBI::dbGetQuery(connection, "SELECT count(*) AS n FROM scalar_observation")$n[[1L]]
  previous_marker <- DBI::dbGetQuery(connection, "SELECT content_version FROM table_publication WHERE table_name='scalar_observation'")$content_version[[1L]]
  previous_fact <- DBI::dbGetQuery(connection, "SELECT value,status FROM scalar_observation WHERE indicator_id='densite' ORDER BY territory_id LIMIT 1")
  failed <- try(publish_registered_scalar(failing, "fail", NULL, adapter), silent=TRUE)
  stopifnot(inherits(failed, "try-error"),
    DBI::dbGetQuery(connection, "SELECT count(*) AS n FROM scalar_observation")$n[[1L]] == previous_rows,
    identical(DBI::dbGetQuery(connection, "SELECT value,status FROM scalar_observation WHERE indicator_id='densite' ORDER BY territory_id LIMIT 1"), previous_fact),
    identical(DBI::dbGetQuery(connection, "SELECT content_version FROM table_publication WHERE table_name='scalar_observation'")$content_version[[1L]], previous_marker))
  cat("Scalar PostgreSQL smoke passed; schema:", schema, "\n")
}, finally={
  if (created && identical(Sys.getenv("LUSK_SCALAR_TEST_CLEANUP", "0"), "1")) {
    tryCatch({
      cleanup <- scalar_smoke_schema_cleanup_sql(
        function(parts) DBI::dbQuoteIdentifier(connection, parts), schema)
      for (statement in cleanup) DBI::dbExecute(connection, statement)
      cat("Scalar smoke schema cleaned with RESTRICT:", schema, "\n")
    }, error=function(e) warning("Could not clean scalar smoke schema ", schema,
      " (it remains for inspection): ", conditionMessage(e), call.=FALSE))
  }
  tryCatch(DBI::dbDisconnect(connection), error=function(e)
    warning("Could not disconnect scalar smoke DB connection: ", conditionMessage(e), call.=FALSE))
})
