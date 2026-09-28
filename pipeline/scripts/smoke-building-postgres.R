#!/usr/bin/env Rscript
# Exercise the actual #599 RPostgres publisher adapter against a disposable,
# explicitly named lusk_it_* database. Run from pipeline/; no repo data used.

abort <- function(...) stop(..., call. = FALSE)
required <- c("LUSK_BUILDING_TEST_HOST", "LUSK_BUILDING_TEST_PORT",
              "LUSK_BUILDING_TEST_DATABASE", "LUSK_BUILDING_TEST_USER",
              "LUSK_BUILDING_TEST_PGPASSFILE")
values <- Sys.getenv(required, unset = "")
if (any(!nzchar(values))) {
  abort("Set all LUSK_BUILDING_TEST_* connection values; refusing implicit/default database access.")
}
cfg <- as.list(values); names(cfg) <- required
database <- cfg$LUSK_BUILDING_TEST_DATABASE
if (!grepl("^lusk_it_[A-Za-z0-9_]+$", database) || database %in% c("lusk", "postgres", "template0", "template1")) {
  abort("LUSK_BUILDING_TEST_DATABASE must be a disposable database named lusk_it_*.")
}
port <- suppressWarnings(as.integer(cfg$LUSK_BUILDING_TEST_PORT))
if (is.na(port) || port < 1L || port > 65535L) abort("Invalid LUSK_BUILDING_TEST_PORT.")
passfile <- normalizePath(cfg$LUSK_BUILDING_TEST_PGPASSFILE, winslash = "/", mustWork = TRUE)
repo <- normalizePath("..", winslash = "/", mustWork = TRUE)
if (startsWith(tolower(passfile), paste0(tolower(repo), "/"))) {
  abort("LUSK_BUILDING_TEST_PGPASSFILE must be private and outside the checkout.")
}
Sys.setenv(PGPASSFILE = passfile)

run_smoke <- function() {
if (!requireNamespace("DBI", quietly = TRUE) || !requireNamespace("RPostgres", quietly = TRUE)) {
  abort("DBI and RPostgres are required for this opt-in smoke.")
}
if (!requireNamespace("pkgload", quietly = TRUE)) abort("pkgload is required.")
pkgload::load_all(".", quiet = TRUE)

execute_sql_file <- function(con, path) {
  lines <- readLines(path, warn = FALSE, encoding = "UTF-8")
  statements <- character(); current <- character(); in_dollar_body <- FALSE
  for (line in lines) {
    current <- c(current, line)
    if (grepl("\\$\\$", line)) in_dollar_body <- !in_dollar_body
    if (!in_dollar_body && grepl(";\\s*$", line)) {
      statement <- paste(current, collapse = "\n")
      if (nzchar(trimws(statement))) statements <- c(statements, statement)
      current <- character()
    }
  }
  if (length(current) && nzchar(trimws(paste(current, collapse = "\n")))) {
    abort("SQL schema ended with an unterminated statement.")
  }
  for (statement in statements) DBI::dbExecute(con, statement)
  invisible(length(statements))
}

db_connect <- function(options = NULL) {
  args <- list(drv = RPostgres::Postgres(), host = cfg$LUSK_BUILDING_TEST_HOST,
               port = port, dbname = database, user = cfg$LUSK_BUILDING_TEST_USER)
  if (!is.null(options)) args$options <- options
  do.call(DBI::dbConnect, args)
}

schema <- paste0("it_building_publisher_", paste(sample(c(letters, 0:9), 20, TRUE), collapse = ""))
created <- FALSE
main <- db_connect()
on.exit(if (DBI::dbIsValid(main)) DBI::dbDisconnect(main), add = TRUE)
connected_database <- DBI::dbGetQuery(main, "SELECT current_database() AS name")$name[[1]]
if (!identical(connected_database, database)) abort("Connected database does not match the explicitly guarded target.")
DBI::dbExecute(main, paste0("CREATE SCHEMA ", as.character(DBI::dbQuoteIdentifier(main, schema))))
created <- TRUE
schema_ident <- as.character(DBI::dbQuoteIdentifier(main, schema))
DBI::dbExecute(main, paste("SET search_path TO", schema_ident))

run_connection <- NULL

cleanup <- function() {
  if (!created) return(invisible(NULL))
  if (!is.null(run_connection) && DBI::dbIsValid(run_connection)) DBI::dbDisconnect(run_connection)
  # Remove only this random schema's objects, in FK dependency order. RESTRICT
  # is deliberate: unexpected objects stop cleanup instead of being cascaded.
  ordered_tables <- c(
    "scalar_observation_source", "scalar_observation", "scalar_descriptor_source",
    "scalar_descriptor", "essential_service_access", "building_ramp", "building_grid",
    "building_evidence_descriptor_source", "building_evidence_descriptor",
    "service_registry", "territory_reference", "source_vintage", "source_dataset",
    "table_publication", "access_publication_metadata"
  )
  for (table in ordered_tables) {
    if (DBI::dbExistsTable(main, DBI::Id(schema = schema, table = table))) {
      DBI::dbExecute(main, paste("DROP TABLE", schema_ident, ".",
        as.character(DBI::dbQuoteIdentifier(main, table)), "RESTRICT"))
    }
  }
  signatures <- c("assert_scalar_observation_has_source()", "assert_scalar_descriptor_sources()",
    "assert_scalar_territory_update()", "assert_scalar_descriptor_update()", "assert_scalar_levels()",
    "assert_building_fact_source()", "assert_building_dataset_complete(integer, integer)",
    "assert_building_descriptor_publication()", "assert_current_dataset_complete(integer)")
  for (signature in signatures) DBI::dbExecute(main, paste("DROP FUNCTION IF EXISTS", signature, "RESTRICT"))
  DBI::dbExecute(main, paste0("DROP SCHEMA ", schema_ident, " RESTRICT"))
  created <<- FALSE
  invisible(NULL)
}
on.exit(cleanup(), add = TRUE)

run_connection <- db_connect(paste0("-csearch_path=", schema))
on.exit(if (DBI::dbIsValid(run_connection)) DBI::dbDisconnect(run_connection), add = TRUE)

execute_sql_file(run_connection, "../api/schema.sql")

source_id <- "building_smoke_source"
vintage_id <- "2026-01"
reference <- data.frame(territory_id = "smoke-commune", territory_type = "commune",
  name = "Smoke commune", department_id = "29", epci_id = "smoke-epci",
  density_class_code = "D1", density_class_label = "Centres urbains", stringsAsFactors = FALSE)
registry <- data.frame(service = "smoke_service", stringsAsFactors = FALSE)
access <- data.frame(
  territory_id = rep(reference$territory_id, 3L), service = "smoke_service",
  mode = c("walk_transit", "bike", "car"), share = c(.6, .5, .4),
  indicator_label = "Synthetic smoke fixture", effective_direction = "high",
  source_id = source_id, source_name = "Synthetic smoke source", source_version = vintage_id,
  reference_date = as.Date("2026-01-01"), source_publication_date = as.Date("2026-02-01"),
  stringsAsFactors = FALSE)
ramp <- expand.grid(mode = c("c", "b", "t"), quantile_index = 0:10,
                    KEEP.OUT.ATTRS = FALSE, stringsAsFactors = FALSE)
ramp$territory_id <- reference$territory_id
ramp$territory_type <- "commune"; ramp$availability <- "complete"
ramp$quantile <- ramp$quantile_index / 10
ramp$accessible_types <- ramp$quantile_index + 1
ramp$total_buildings <- 30L; ramp$source_id <- source_id; ramp$source_version <- vintage_id
ramp$effective_direction <- "high"
ramp <- ramp[c("territory_id", "territory_type", "availability", "mode", "quantile_index",
  "quantile", "accessible_types", "total_buildings", "source_id", "source_version", "effective_direction")]
breadth <- as.character(DISTRIBUTION_ACCES_BATIMENTS_BREADTH_BINS$key)
depth <- as.character(DISTRIBUTION_ACCES_BATIMENTS_DEPTH_BINS$key)
grid <- expand.grid(breadth_bucket = breadth, depth_bucket = depth,
                    KEEP.OUT.ATTRS = FALSE, stringsAsFactors = FALSE)
grid$cell_index <- (match(grid$breadth_bucket, breadth) - 1L) * length(depth) +
                   match(grid$depth_bucket, depth) - 1L
grid$territory_id <- reference$territory_id; grid$territory_type <- "commune"
grid$availability <- "complete"; grid$mode <- DISTRIBUTION_ACCES_BATIMENTS_MODE
grid$building_count <- ifelse(grid$cell_index == 0L, 30L, 0L)
grid$total_buildings <- 30L; grid$source_id <- source_id; grid$source_version <- vintage_id
grid <- grid[c("territory_id", "territory_type", "availability", "mode", "cell_index",
  "breadth_bucket", "depth_bucket", "building_count", "total_buildings", "source_id", "source_version")]

tables <- list(territory_reference = reference, service_registry = registry,
  essential_service_access = access, building_ramp = ramp, building_grid = grid)
access_scope <- list(kind = "smoke-fixture", label = "Synthetic smoke fixture")
building_sources <- data.frame(source_id = source_id, source_name = "Synthetic smoke source",
  vintage_id = vintage_id, reference_date = "2026-01-01", publication_date = "2026-02-01",
  stringsAsFactors = FALSE)
building_contract <- contrat_publication_batiments(list(statistic = "mean", direction = "high"))
provenance <- building_sources
for (name in names(building_contract)) building_contract[[name]]$provenance <- provenance
versions <- setNames(paste0("smoke-v1-", names(tables)), names(tables))

publish <- function(t, v = versions) publier_tables_postgres(run_connection, t, v,
  access_scope, building_contract, building_sources)
changed <- publish(tables)
stopifnot(setequal(changed, names(tables)))

marker_versions <- DBI::dbGetQuery(run_connection,
  "SELECT table_name, content_version, row_count FROM table_publication ORDER BY table_name")
stopifnot(nrow(marker_versions) == 5L,
  marker_versions$row_count[marker_versions$table_name == "building_ramp"] == 33L,
  marker_versions$row_count[marker_versions$table_name == "building_grid"] == 30L)
for (table in c("building_ramp", "building_grid")) {
  descriptor <- DBI::dbGetQuery(run_connection,
    "SELECT descriptor_version, contract FROM building_evidence_descriptor WHERE table_name=$1",
    params = list(table))
  decoded_contract <- jsonlite::fromJSON(as.character(descriptor$contract[[1]]), simplifyVector = FALSE)
  stopifnot(nrow(descriptor) == 1L,
    identical(descriptor$descriptor_version[[1]], versions[[table]]),
    identical(decoded_contract$shape, table),
    identical(decoded_contract$provenance[[1]]$source_id, source_id),
    identical(decoded_contract$provenance[[1]]$vintage_id, vintage_id))
  lineage <- DBI::dbGetQuery(run_connection,
    "SELECT d.source_id, v.vintage_id, v.version FROM building_evidence_descriptor_source d
     JOIN source_vintage v ON v.source_id=d.source_id WHERE d.table_name=$1",
    params = list(table))
  stopifnot(nrow(lineage) == 1L, lineage$source_id[[1]] == source_id,
    lineage$vintage_id[[1]] == vintage_id, lineage$version[[1]] == vintage_id)
}
actual_grid <- DBI::dbGetQuery(run_connection,
  "SELECT cell_index, breadth_bucket, depth_bucket FROM building_grid ORDER BY cell_index")
expected_grid <- grid[order(grid$cell_index), c("cell_index", "breadth_bucket", "depth_bucket")]
actual_breadth_ordinal <- match(as.character(actual_grid$breadth_bucket), breadth)
actual_depth_ordinal <- match(as.character(actual_grid$depth_bucket), depth)
stopifnot(DBI::dbGetQuery(run_connection, "SELECT count(*) AS n FROM building_ramp")$n[[1]] == 33L,
  DBI::dbGetQuery(run_connection, "SELECT count(*) AS n FROM building_ramp WHERE source_id=$1 AND source_version=$2",
    params = list(source_id, vintage_id))$n[[1]] == 33L,
  nrow(actual_grid) == 30L,
  identical(as.integer(actual_grid$cell_index), as.integer(expected_grid$cell_index)),
  identical(as.character(actual_grid$breadth_bucket), as.character(expected_grid$breadth_bucket)),
  identical(as.character(actual_grid$depth_bucket), as.character(expected_grid$depth_bucket)),
  all(actual_grid$cell_index == (actual_breadth_ordinal - 1L) * length(depth) + actual_depth_ordinal - 1L))

# A current marker is an idempotent no-op.
stopifnot(length(publish(tables)) == 0L)

# A stale marker causes the unchanged canonical table to be resent and restored.
DBI::dbExecute(run_connection,
  "UPDATE table_publication SET content_version='db-behind' WHERE table_name='building_grid'")
retry <- publish(tables)
stopifnot(identical(retry, "building_grid"),
  DBI::dbGetQuery(run_connection, "SELECT content_version FROM table_publication WHERE table_name='building_grid")$content_version[[1]] == versions[["building_grid"]])

# Inject failure inside fact replacement and verify transaction rollback retains
# the prior facts, descriptor and independent publication markers.
before_ramp <- DBI::dbGetQuery(run_connection, "SELECT * FROM building_ramp ORDER BY mode, quantile_index")
before_markers <- DBI::dbGetQuery(run_connection,
  "SELECT table_name, content_version, row_count FROM table_publication ORDER BY table_name")
before_descriptors <- DBI::dbGetQuery(run_connection,
  "SELECT table_name, descriptor_version FROM building_evidence_descriptor ORDER BY table_name")
DBI::dbExecute(run_connection, "CREATE FUNCTION reject_smoke_ramp() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN IF NEW.quantile_index=5 THEN RAISE EXCEPTION 'smoke injected failure'; END IF;
  RETURN NEW; END $$")
DBI::dbExecute(run_connection, "CREATE TRIGGER reject_smoke_ramp BEFORE INSERT ON building_ramp
  FOR EACH ROW EXECUTE FUNCTION reject_smoke_ramp()")
on.exit({
  try(DBI::dbExecute(run_connection, "DROP TRIGGER IF EXISTS reject_smoke_ramp ON building_ramp"), silent = TRUE)
  try(DBI::dbExecute(run_connection, "DROP FUNCTION IF EXISTS reject_smoke_ramp()"), silent = TRUE)
}, add = TRUE)
replacement <- tables
replacement$building_ramp$accessible_types[[1]] <- replacement$building_ramp$accessible_types[[1]] + 99
failed_versions <- versions
failed_versions[["building_ramp"]] <- "smoke-v2-building_ramp"
failed <- tryCatch({ publish(replacement, failed_versions); FALSE }, error = function(e) {
  if (!grepl("smoke injected failure", conditionMessage(e), fixed = TRUE)) stop(e)
  TRUE
})
stopifnot(failed)
after_ramp <- DBI::dbGetQuery(run_connection, "SELECT * FROM building_ramp ORDER BY mode, quantile_index")
after_markers <- DBI::dbGetQuery(run_connection,
  "SELECT table_name, content_version, row_count FROM table_publication ORDER BY table_name")
after_descriptors <- DBI::dbGetQuery(run_connection,
  "SELECT table_name, descriptor_version FROM building_evidence_descriptor ORDER BY table_name")
stopifnot(identical(before_ramp, after_ramp), identical(before_markers, after_markers),
          identical(before_descriptors, after_descriptors))

cat("Building publisher PostgreSQL smoke passed in schema", schema, "on", database, "\n")
}

run_smoke()
