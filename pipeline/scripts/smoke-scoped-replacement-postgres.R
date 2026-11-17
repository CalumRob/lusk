#!/usr/bin/env Rscript
# Guarded test-only proof of the #1037 explicit replacement intent.
#
# NEVER targets the serving database. Requires:
#   - the private libpq passfile (PGPASSFILE) with the exact lusk_it_contract
#     publisher role;
#   - the dedicated test database lusk_it_contract;
#   - LUSK_SCALAR_TEST_CLEANUP=1 (a retained test schema is refused);
#   - LUSK_RETAINED_BASELINE_MUTEX_HELD=1, set only by the PowerShell wrapper
#     that holds 'Local\LuskIntegrationContractDb' for the whole run;
#   - LUSK_SCALAR_PUBLICATION_INTENT=replacement;
#   - candidate and prior-baseline artifact sorties.
#
# One random serving_it_* schema is created and seeded with ONLY the registered
# scalar dependency closure of the baseline generation (reference, scalar +
# comparison, declared profiles + comparison, linked Habitat selected reading).
# Unrelated owners are deliberately not seeded: this proof asserts the scoped
# path does not need them.
#
# A TEST-ONLY candidate copy adds one `region` level and one region fact to the
# refuelling ratio, exactly the additive shape of the documented activation.
# The normal wrapper/plan must:
#   FORWARD  -> prove the replacement delta and publish the closure atomically;
#   RECOVERY -> restore the baseline closure through the same plan (no special
#               flag), removing the region/replacement facts;
#   REPUBLISH-> install the candidate again.
# Every step checks the unrelated publication marker is untouched. It does not
# claim a production activation and does not touch the serving database.
main <- function() {
pkgload::load_all(".", quiet = TRUE)

config <- setNames(lapply(c("HOST", "PORT", "DATABASE", "USER"),
  function(suffix) Sys.getenv(paste0("LUSK_SCALAR_TEST_", suffix), unset = "")),
  c("HOST", "PORT", "DATABASE", "USER"))
stopifnot(identical(unlist(config),
  c(HOST = "192.168.1.120", PORT = "5432",
    DATABASE = "lusk_it_contract", USER = "lusk_it_contract_pub")))
stopifnot(identical(Sys.getenv("LUSK_SCALAR_TEST_CLEANUP"), "1"),
          identical(Sys.getenv("LUSK_RETAINED_BASELINE_MUTEX_HELD"), "1"),
          identical(scoped_publication_intent(
            Sys.getenv("LUSK_SCALAR_PUBLICATION_INTENT")), "replacement"))
candidate_source <- Sys.getenv("LUSK_RETAINED_BASELINE_TEST_CANDIDATE_DIR")
baseline_source <- Sys.getenv("LUSK_RETAINED_BASELINE_TEST_BASELINE_DIR")
stopifnot(nzchar(candidate_source), dir.exists(candidate_source),
          nzchar(baseline_source), dir.exists(baseline_source))
scope_ids <- scoped_publication_scope(Sys.getenv("LUSK_SCALAR_SCOPE"),
                                      "replacement")$scope_ids
stopifnot(length(scope_ids) > 0L)
passfile <- Sys.getenv("PGPASSFILE", unset = "")
stopifnot(nzchar(passfile), file.exists(passfile),
          !startsWith(tolower(normalizePath(passfile, winslash = "/")),
                      tolower(normalizePath("..", winslash = "/"))))
read_user <- Sys.getenv("LUSK_TEST_READ_USER", unset = "")
read_dsn <- Sys.getenv("LUSK_TEST_READ_DSN", unset = "")
stopifnot(nzchar(read_user), nzchar(read_dsn))
receipt_path <- Sys.getenv("LUSK_REPLACEMENT_SMOKE_RECEIPT",
  unset = file.path(tempdir(), "scoped-replacement-receipt.txt"))
stopifnot(requireNamespace("DBI", quietly = TRUE),
          requireNamespace("RPostgres", quietly = TRUE))

workspace <- tempfile("scoped-replacement-smoke-")
dir.create(workspace)
copy_sortie <- function(from, name) {
  destination <- file.path(workspace, name)
  dir.create(destination)
  entries <- list.files(from, full.names = TRUE)
  stopifnot(length(entries) > 0L,
            all(file.copy(entries, destination, recursive = TRUE)))
  destination
}
candidate_dir <- copy_sortie(candidate_source, "candidate")
baseline_dir <- copy_sortie(baseline_source, "baseline")
make_writable <- function(directory) {
  for (path in list.files(directory, recursive = TRUE, full.names = TRUE,
                          all.files = TRUE)) Sys.chmod(path, mode = "0666")
}
make_writable(candidate_dir)
make_writable(baseline_dir)

# TEST-ONLY fixture: the candidate artifact predates the #1032 metadata edit, so
# add the additive region level/fact to one both-present scoped indicator. The
# value is a labelled fixture, not a production statistic.
replacement_indicator <- "bornes_ev_par_station_service"
replacement_region <- NULL
add_region_replacement <- function(directory) {
  owner_dir <- file.path(directory, "scalar-serving", "mobilite")
  projection <- read_scalar_serving_artifact(owner_dir)
  reference <- project_territory_reference(nanoparquet::read_parquet(
    file.path(directory, "territoires.parquet")))
  region <- reference$rows[reference$rows$territory_type == "region", ,
                           drop = FALSE]
  stopifnot(nrow(region) == 1L)
  index <- match(replacement_indicator, projection$descriptors$indicator_id)
  stopifnot(!is.na(index))
  levels <- as.character(projection$descriptors$allowed_levels[[index]])
  stopifnot(!"region" %in% levels)
  projection$descriptors$allowed_levels[[index]] <- c(levels, "region")
  projection$descriptors$descriptor_version[[index]] <- paste0(
    projection$descriptors$descriptor_version[[index]],
    "-replacement-smoke-fixture")
  provenance <- projection$provenance[
    projection$provenance$indicator_id == replacement_indicator, ,
    drop = FALSE]
  stopifnot(nrow(provenance) > 0L)
  region_id <- as.character(region$territory_id[[1L]])
  stopifnot(!any(projection$facts$indicator_id == replacement_indicator &
                 projection$facts$territory_id == region_id))
  projection$facts <- rbind(projection$facts, data.frame(
    indicator_id = replacement_indicator, territory_id = region_id,
    territory_type = "region", value = 2.5, status = "measured",
    support_count = NA_integer_, denominator_count = NA_integer_,
    stringsAsFactors = FALSE))
  projection$provenance <- rbind(projection$provenance, data.frame(
    indicator_id = replacement_indicator, territory_id = region_id,
    source_id = as.character(provenance$source_id[[1L]]),
    vintage_id = as.character(provenance$vintage_id[[1L]]),
    stringsAsFactors = FALSE))
  if (!any(projection$eligible_territories$territory_type == "region"))
    projection$eligible_territories <- rbind(
      projection$eligible_territories,
      data.frame(territory_id = region_id, territory_type = "region",
                 stringsAsFactors = FALSE))
  validate_scalar_artifact_projection(projection)
  write_scalar_serving_artifact(projection, owner_dir)
  region_id
}
replacement_region <- add_region_replacement(candidate_dir)

# TEST-ONLY preparation (private copies): start the candidate from the prior
# profile binding, so the normal metadata-only companion refresh runs forward.
unlink(file.path(candidate_dir, "profile-serving"), recursive = TRUE)
stopifnot(file.copy(file.path(baseline_dir, "profile-serving"), candidate_dir,
                    recursive = TRUE))
stopifnot(file.copy(file.path(baseline_dir, "scalar-serving", "binding.json"),
  file.path(candidate_dir, "scalar-serving", "binding.json"), overwrite = TRUE))
make_writable(candidate_dir)

connection <- DBI::dbConnect(RPostgres::Postgres(), host = config[["HOST"]],
  port = as.integer(config[["PORT"]]), dbname = config[["DATABASE"]],
  user = config[["USER"]], passfile = passfile)
identity <- DBI::dbGetQuery(connection, paste(
  "SELECT current_database() AS database, current_user AS role,",
  "inet_server_addr()::text AS server_address"))
stopifnot(nrow(identity) == 1L,
          identity$database[[1L]] == "lusk_it_contract",
          identity$role[[1L]] == "lusk_it_contract_pub")

schema <- paste0("serving_it_", Sys.getpid(), "_",
                 sprintf("%08x", sample.int(.Machine$integer.max, 1L)))
quoted_schema <- as.character(DBI::dbQuoteIdentifier(connection, schema))
created <- FALSE
previous_env <- Sys.getenv(c("LUSK_PUBLISH_HOST", "LUSK_PUBLISH_PORT",
  "LUSK_PUBLISH_DATABASE", "LUSK_PUBLISH_USER", "PGPASSFILE",
  "LUSK_SCALAR_SCOPE", "LUSK_SCALAR_BASELINE_SORTIE",
  "LUSK_SCALAR_PUBLICATION_INTENT", "PGOPTIONS"), unset = NA_character_)
on.exit({
  if (created) {
    try(DBI::dbExecute(connection, "ROLLBACK"), silent = TRUE)
    try(DBI::dbExecute(connection, paste0("DROP SCHEMA ", quoted_schema,
                                          " CASCADE")), silent = TRUE)
  }
  for (i in seq_along(previous_env)) {
    if (is.na(previous_env[[i]])) Sys.unsetenv(names(previous_env)[[i]])
    else do.call(Sys.setenv, setNames(list(previous_env[[i]]),
                                      names(previous_env)[[i]]))
  }
  try(DBI::dbDisconnect(connection), silent = TRUE)
}, add = TRUE)

marker <- function(table, column = "content_version")
  DBI::dbGetQuery(connection, paste0("SELECT ", column,
    " AS v FROM table_publication WHERE table_name=$1"),
    params = list(table))$v[[1L]]
fact_count <- function(indicator) DBI::dbGetQuery(connection,
  "SELECT count(*) AS n FROM scalar_observation WHERE indicator_id=$1",
  params = list(indicator))$n[[1L]]
region_fact <- function(indicator) DBI::dbGetQuery(connection, paste(
  "SELECT value, status FROM scalar_observation WHERE indicator_id=$1",
  "AND territory_type='region' AND territory_id=$2"),
  params = list(indicator, replacement_region))

profile_owners <- declared_profile_owners()
candidate_reference <- project_territory_reference(nanoparquet::read_parquet(
  file.path(candidate_dir, "territoires.parquet")))
candidate_scalar_version <- scalar_content_version(
  project_retained_scalar_snapshot(candidate_dir,
                                   candidate_reference)$scalar)
receipt <- c(paste("schema:", schema),
             "candidate_fixture: additive region level/fact on bornes_ev_par_station_service (value 2.5, TEST fixture)",
             paste("candidate_scalar:", candidate_scalar_version))
DBI::dbExecute(connection, paste0("CREATE SCHEMA ", quoted_schema))
created <- TRUE
DBI::dbExecute(connection, paste0("SET search_path TO ", quoted_schema))
schema_sql <- paste(readLines(file.path("..", "api", "schema.sql"), warn = FALSE),
                    collapse = "\n")
for (statement in split_postgres_sql(schema_sql))
  DBI::dbExecute(connection, statement)
DBI::dbExecute(connection, paste0("GRANT USAGE ON SCHEMA ", quoted_schema,
  " TO ", as.character(DBI::dbQuoteIdentifier(connection, read_user))))
DBI::dbExecute(connection, paste0("GRANT SELECT ON ALL TABLES IN SCHEMA ",
  quoted_schema, " TO ",
  as.character(DBI::dbQuoteIdentifier(connection, read_user))))

# Seed ONLY the affected closure of the baseline generation through the normal
# registered publishers, including the linked Habitat selected reading.
reference <- project_territory_reference(nanoparquet::read_parquet(
  file.path(baseline_dir, "territoires.parquet")))
publish_territory_reference_projection(reference,
  territory_reference_postgres_adapter(connection))
baseline_snapshot <- project_retained_scalar_snapshot(baseline_dir, reference)
publish_retained_scalar_snapshot(connection, baseline_snapshot, tempdir())
publier_declared_profiles_postgres(baseline_dir, profile_owners, con = connection)
habitat <- read_typed_reading_publication_from(baseline_dir, "habitat")
publish_typed_reading_publication(
  register_typed_reading_artifact_publisher(list(), "habitat",
                                            publish_habitat_reading),
  "habitat", habitat, connection)
# Unrelated sentinel: the scoped path must never touch it.
DBI::dbExecute(connection, paste(
  "INSERT INTO table_publication(table_name, content_version, row_count,",
  "reference_content_version) VALUES",
  "('ordered_series', 'unrelated-sentinel-v1', 0, $1)"),
  params = list(reference$content_version))
baseline_markers <- c(
  scalar = marker("scalar_observation"),
  comparison = DBI::dbGetQuery(connection,
    "SELECT content_version AS v FROM scalar_comparison_publication")$v[[1L]],
  profile = marker("declared_profile"),
  reading = marker("selected_reading"))
stopifnot(nrow(region_fact(replacement_indicator)) == 0L)

Sys.setenv(LUSK_PUBLISH_HOST = config[["HOST"]],
           LUSK_PUBLISH_PORT = config[["PORT"]],
           LUSK_PUBLISH_DATABASE = config[["DATABASE"]],
           LUSK_PUBLISH_USER = config[["USER"]],
           PGPASSFILE = passfile,
           PGOPTIONS = paste0("-c search_path=", schema,
             " -c statement_timeout=60000 -c lock_timeout=5000"),
           LUSK_SCALAR_SCOPE = Sys.getenv("LUSK_SCALAR_SCOPE"),
           LUSK_SCALAR_BASELINE_SORTIE = baseline_dir,
           LUSK_SCALAR_PUBLICATION_INTENT = "replacement")

# The plan/preview must be write-free and honest about the replacement. Preview
# runs on a private copy whose declared-profile binding is refreshed exactly as
# forward publication will refresh the real private candidate.
preview_dir <- file.path(workspace, "preview-candidate")
dir.create(preview_dir)
stopifnot(all(file.copy(list.files(candidate_dir, full.names = TRUE),
                        preview_dir, recursive = TRUE)))
refresh_declared_profile_scalar_binding(preview_dir, profile_owners,
                                        candidate_scalar_version)
plan <- scoped_publication_plan(preview_dir, baseline_dir, scope_ids,
                                intent = "replacement")
stopifnot(identical(plan$direction, "forward"),
          any(plan$replacement_indicators$direction == "forward" &
              plan$replacement_indicators$indicator_id ==
                replacement_indicator))
preview <- scoped_publication_preview(plan, theme = "mobilite")
stopifnot(identical(preview$writes, FALSE))
receipt <- c(receipt,
  paste("preview_forward_added_facts:", nrow(preview$added_facts)),
  paste("preview_forward_removed_facts:", nrow(preview$removed_facts)))

forward <- publish_retained_backend_from_parquet(candidate_dir)
stopifnot(identical(marker("scalar_observation"), candidate_scalar_version))
stopifnot(nrow(region_fact(replacement_indicator)) == 1L,
          identical(as.numeric(region_fact(replacement_indicator)$value[[1L]]),
                    2.5),
          fact_count("stations_service") > 0L,
          fact_count("stations_service_1000") > 0L,
          fact_count("bornes_recharge_1000") > 0L,
          identical(marker("ordered_series"), "unrelated-sentinel-v1"))
forward_markers <- c(
  scalar = marker("scalar_observation"),
  comparison = DBI::dbGetQuery(connection,
    "SELECT content_version AS v FROM scalar_comparison_publication")$v[[1L]],
  profile = marker("declared_profile"),
  reading = marker("selected_reading"))
receipt <- c(receipt,
  paste("forward_scalar:", forward_markers[["scalar"]]),
  paste("forward_comparison:", forward_markers[["comparison"]]),
  paste("forward_profile:", forward_markers[["profile"]]),
  paste("forward_reading:", forward_markers[["reading"]]),
  paste("forward_region_rows:", nrow(region_fact(replacement_indicator))),
  paste("forward_three_key_facts:", fact_count("stations_service"),
        fact_count("stations_service_1000"), fact_count("bornes_recharge_1000")))

# Recovery: the same normal wrapper/plan, frozen baseline as target and the
# published candidate as the live guard state.
Sys.setenv(LUSK_SCALAR_BASELINE_SORTIE = candidate_dir)
recovery <- publish_retained_backend_from_parquet(baseline_dir)
stopifnot(identical(marker("scalar_observation"), baseline_markers[["scalar"]]),
          identical(marker("declared_profile"), baseline_markers[["profile"]]),
          nrow(region_fact(replacement_indicator)) == 0L,
          fact_count("stations_service") == 0L,
          fact_count("stations_service_1000") == 0L,
          fact_count("bornes_recharge_1000") == 0L,
          identical(marker("ordered_series"), "unrelated-sentinel-v1"))
receipt <- c(receipt,
  paste("recovery_scalar:", marker("scalar_observation")),
  paste("recovery_region_rows:", nrow(region_fact(replacement_indicator))),
  paste("recovery_unrelated_marker:", marker("ordered_series")))

# Republish the candidate through the same normal wrapper.
Sys.setenv(LUSK_SCALAR_BASELINE_SORTIE = baseline_dir)
republish <- publish_retained_backend_from_parquet(candidate_dir)
stopifnot(identical(marker("scalar_observation"), forward_markers[["scalar"]]),
          nrow(region_fact(replacement_indicator)) == 1L,
          identical(marker("ordered_series"), "unrelated-sentinel-v1"))
receipt <- c(receipt,
  paste("republish_scalar:", marker("scalar_observation")),
  paste("republish_region_rows:", nrow(region_fact(replacement_indicator))),
  paste("unrelated_marker:", marker("ordered_series")),
  "status: PASS (guarded test-only replacement proof)")

DBI::dbExecute(connection, paste0("DROP SCHEMA ", quoted_schema, " CASCADE"))
created <- FALSE
writeLines(receipt, receipt_path)
writeLines(receipt)
cat("Scoped replacement smoke PASS; receipt:", receipt_path, "\n")
}
main()
