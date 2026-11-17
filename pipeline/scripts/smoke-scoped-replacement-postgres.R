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
#   - a candidate and a baseline generation that both already carry the four
#     registered Mobility keys. The candidate copy gets one TEST-ONLY additive
#     `region` level/fact on the ratio, the exact shape of the documented
#     replacement step after the three newer keys were published missing-only.
#
# One random serving_it_* schema is seeded with the baseline closure through
# the normal registered publishers. The proof then:
#   FAILURE  -> an injected reading-publisher error after the scalar/profile
#               stage must roll back the whole outer transaction (all rows,
#               markers and pointers byte-identical), then clean up normally;
#   FORWARD  -> the normal wrapper commits the validated candidate closure;
#               every closure table must equal an independently seeded candidate
#               schema (same normal publishers), and the guard must verify every
#               scalar/comparison/profile/profile-comparison/selected-reading
#               marker + linked identity;
#   RECOVERY -> the same wrapper/plan restores the baseline closure exactly;
#   PINNED   -> after a plan, the profile/selected-reading artifact directories
#               are renamed away. A second normal atomic publication must still
#               commit the SAME validated candidate closure from the frozen plan
#               (a re-read would fail), proving no plan-to-write TOCTOU.
# Zero residual serving_it_* schemas and zero public relations are required
# before and after, including after the injected failure.
pkgload::load_all(".", quiet = TRUE)

main <- function() {
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

# TEST-ONLY fixture: add the additive region level/fact to the ratio. The value
# is a labelled fixture, not a production statistic.
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
expected_schema <- paste0("serving_it_expected_", Sys.getpid(), "_",
                          sprintf("%08x", sample.int(.Machine$integer.max, 1L)))
quoted_schema <- as.character(DBI::dbQuoteIdentifier(connection, schema))
quoted_expected <- as.character(DBI::dbQuoteIdentifier(connection,
                                                       expected_schema))
created <- FALSE
expected_created <- FALSE
previous_env <- Sys.getenv(c("LUSK_PUBLISH_HOST", "LUSK_PUBLISH_PORT",
  "LUSK_PUBLISH_DATABASE", "LUSK_PUBLISH_USER", "PGPASSFILE",
  "LUSK_SCALAR_SCOPE", "LUSK_SCALAR_BASELINE_SORTIE",
  "LUSK_SCALAR_PUBLICATION_INTENT", "PGOPTIONS"), unset = NA_character_)
drop_schema <- function(name) {
  try(DBI::dbExecute(connection, paste0("DROP SCHEMA ", name, " CASCADE")),
      silent = TRUE)
}
on.exit({
  if (expected_created) drop_schema(quoted_expected)
  if (created) drop_schema(quoted_schema)
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
residual_schemas <- function()
  DBI::dbGetQuery(connection, paste(
    "SELECT nspname FROM pg_namespace",
    "WHERE nspname LIKE 'serving_it_%' ORDER BY nspname"))$nspname
public_relations <- function()
  DBI::dbGetQuery(connection, paste(
    "SELECT count(*) AS n FROM pg_class c JOIN pg_namespace n",
    "ON n.oid=c.relnamespace WHERE n.nspname='public'",
    "AND c.relkind IN ('r','v','m','p')"))$n[[1L]]
schema_digest <- function(name) {
  tables <- DBI::dbGetQuery(connection, paste(
    "SELECT table_name FROM information_schema.tables",
    "WHERE table_schema=$1 AND table_type='BASE TABLE'",
    "ORDER BY table_name"), params = list(name))$table_name
  quote_id <- function(value) as.character(DBI::dbQuoteIdentifier(connection,
                                                                 value))
  vapply(tables, function(table) {
    DBI::dbGetQuery(connection, paste0(
      "SELECT md5(coalesce(string_agg(",
      "(to_jsonb(t) - 'published_at')::text, '|' ORDER BY ",
      "(to_jsonb(t) - 'published_at')::text), '')) AS h FROM ",
      quote_id(name), ".", quote_id(table), " t"))$h[[1L]]
  }, character(1))
}
apply_schema <- function(name) {
  DBI::dbExecute(connection, paste0("SET search_path TO ", name))
  sql <- paste(readLines(file.path("..", "api", "schema.sql"), warn = FALSE),
               collapse = "\n")
  for (statement in split_postgres_sql(sql)) DBI::dbExecute(connection, statement)
}
seed_closure <- function(directory, publication_dir = tempdir()) {
  reference <- project_territory_reference(nanoparquet::read_parquet(
    file.path(directory, "territoires.parquet")))
  publish_territory_reference_projection(reference,
    territory_reference_postgres_adapter(connection))
  snapshot <- project_retained_scalar_snapshot(directory, reference)
  publish_retained_scalar_snapshot(connection, snapshot, publication_dir)
  publier_declared_profiles_postgres(directory, declared_profile_owners(),
                                     con = connection)
  reading <- read_typed_reading_publication_from(directory, "habitat")
  publish_typed_reading_publication(
    register_typed_reading_artifact_publisher(list(), "habitat",
                                              publish_habitat_reading),
    "habitat", reading, connection)
  DBI::dbExecute(connection, paste(
    "INSERT INTO table_publication(table_name, content_version, row_count,",
    "reference_content_version) VALUES",
    "('ordered_series', 'unrelated-sentinel-v1', 0, $1)"),
    params = list(reference$content_version))
  invisible(snapshot)
}

stopifnot(length(residual_schemas()) == 0L)
public_before <- public_relations()
receipt <- c("scoped replacement guarded proof (#1037)",
             paste("candidate_fixture: additive region level/fact on",
                   replacement_indicator, "(value 2.5, TEST fixture)"))
DBI::dbExecute(connection, paste0("CREATE SCHEMA ", quoted_schema))
created <- TRUE
apply_schema(quoted_schema)
DBI::dbExecute(connection, paste0("GRANT USAGE ON SCHEMA ", quoted_schema,
  " TO ", as.character(DBI::dbQuoteIdentifier(connection, read_user))))
DBI::dbExecute(connection, paste0("GRANT SELECT ON ALL TABLES IN SCHEMA ",
  quoted_schema, " TO ",
  as.character(DBI::dbQuoteIdentifier(connection, read_user))))

baseline_snapshot <- seed_closure(baseline_dir)
baseline_digest <- schema_digest(schema)
baseline_markers <- c(
  scalar = marker("scalar_observation"),
  comparison = DBI::dbGetQuery(connection,
    "SELECT content_version AS v FROM scalar_comparison_publication")$v[[1L]],
  profile = marker("declared_profile"),
  profile_comparison = DBI::dbGetQuery(connection,
    "SELECT content_version AS v FROM profile_comparison_publication")$v[[1L]],
  reading = marker("selected_reading"))
stopifnot(nrow(region_fact(replacement_indicator)) == 0L,
          fact_count("stations_service") > 0L)
receipt <- c(receipt,
  paste("baseline_scalar:", baseline_markers[["scalar"]]),
  paste("baseline_three_key_facts:", fact_count("stations_service"),
        fact_count("stations_service_1000"), fact_count("bornes_recharge_1000")))

# Point the wrapper at the dedicated test database and the private candidate.
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

# FAILURE injection: the reading publisher throws after the scalar/profile
# stage. The normal outer transaction must roll everything back exactly.
namespace <- asNamespace("lusk")
original_reading_publisher <- get("publish_habitat_reading", envir = namespace)
assignInNamespace("publish_habitat_reading",
  function(...) stop("injected replacement failure", call. = FALSE), ns = "lusk")
failed <- tryCatch({
  publish_retained_backend_from_parquet(candidate_dir)
  NULL
}, error = function(error) error)
assignInNamespace("publish_habitat_reading", original_reading_publisher,
                  ns = "lusk")
stopifnot(inherits(failed, "error"),
          grepl("injected replacement failure", conditionMessage(failed)))
failed_digest <- schema_digest(schema)
stopifnot(identical(failed_digest, baseline_digest))
stopifnot(identical(schema_digest(schema), baseline_digest),
          identical(marker("scalar_observation"),
                    baseline_markers[["scalar"]]),
          identical(marker("declared_profile"), baseline_markers[["profile"]]),
          nrow(region_fact(replacement_indicator)) == 0L)
receipt <- c(receipt, "failure_injection: rolled back whole schema exactly")

# FORWARD through the normal wrapper.
forward <- publish_retained_backend_from_parquet(candidate_dir)
plan <- scoped_publication_plan(candidate_dir, baseline_dir, scope_ids,
                                intent = "replacement")
stopifnot(identical(plan$direction, "forward"))
mismatches <- verifier_scoped_publication(
  scoped_publication_markers(connection, plan),
  scoped_target_markers(plan), plan$reading_owners)
stopifnot(nrow(mismatches) == 0L,
          nrow(region_fact(replacement_indicator)) == 1L,
          identical(as.numeric(region_fact(replacement_indicator)$value[[1L]]),
                    2.5),
          fact_count("stations_service") > 0L,
          fact_count("stations_service_1000") > 0L,
          fact_count("bornes_recharge_1000") > 0L,
          identical(marker("ordered_series"), "unrelated-sentinel-v1"))
forward_digest <- schema_digest(schema)

# Independently seed the candidate closure in a second schema and require every
# closure table to match exactly (all facts/descriptors/provenance,
# comparisons, profiles, selected reading, markers and source rows).
DBI::dbExecute(connection, paste0("CREATE SCHEMA ", quoted_expected))
expected_created <- TRUE
apply_schema(quoted_expected)
reference <- project_territory_reference(nanoparquet::read_parquet(
  file.path(candidate_dir, "territoires.parquet")))
publish_territory_reference_projection(reference,
  territory_reference_postgres_adapter(connection))
candidate_snapshot <- project_retained_scalar_snapshot(candidate_dir, reference)
publish_retained_scalar_snapshot(connection, candidate_snapshot, tempdir())
publish_declared_profiles_projection(plan$target_profiles, connection,
  artifact_directory = NULL, expected_version = plan$target_profile_version,
  comparisons = plan$target_profile_comparisons)
publish_typed_reading_publication(
  register_typed_reading_artifact_publisher(list(), "habitat",
                                            publish_habitat_reading),
  "habitat", plan$target_reading_publication, connection)
DBI::dbExecute(connection, paste(
  "INSERT INTO table_publication(table_name, content_version, row_count,",
  "reference_content_version) VALUES",
  "('ordered_series', 'unrelated-sentinel-v1', 0, $1)"),
  params = list(reference$content_version))
expected_digest <- schema_digest(expected_schema)
stopifnot(identical(names(expected_digest), names(forward_digest)),
          identical(unname(expected_digest), unname(forward_digest)))
DBI::dbExecute(connection, paste0("SET search_path TO ", quoted_schema))
drop_schema(quoted_expected)
expected_created <- FALSE
receipt <- c(receipt,
  paste("forward_scalar:", marker("scalar_observation")),
  paste("forward_comparison:", {
    DBI::dbGetQuery(connection,
      "SELECT content_version AS v FROM scalar_comparison_publication")$v[[1L]]
  }),
  paste("forward_profile:", marker("declared_profile")),
  paste("forward_profile_comparison:", {
    DBI::dbGetQuery(connection,
      "SELECT content_version AS v FROM profile_comparison_publication")$v[[1L]]
  }),
  paste("forward_reading:", marker("selected_reading")),
  paste("forward_region_rows:", nrow(region_fact(replacement_indicator))),
  "closure_rows: exact match against independent candidate seed")

# RECOVERY through the same normal wrapper/plan.
Sys.setenv(LUSK_SCALAR_BASELINE_SORTIE = candidate_dir)
recovery <- publish_retained_backend_from_parquet(baseline_dir)
recovery_digest <- schema_digest(schema)
stopifnot(identical(recovery_digest, baseline_digest),
          identical(marker("scalar_observation"), baseline_markers[["scalar"]]),
          identical(marker("declared_profile"), baseline_markers[["profile"]]),
          nrow(region_fact(replacement_indicator)) == 0L,
          fact_count("stations_service") > 0L,
          identical(marker("ordered_series"), "unrelated-sentinel-v1"))
receipt <- c(receipt,
  paste("recovery_scalar:", marker("scalar_observation")),
  "recovery_rows: whole schema digest identical to baseline seed")

# PINNED write: build the plan, then rename the profile and reading artifact
# directories away. A re-read would fail; the frozen plan must publish the SAME
# candidate closure through the normal atomic transaction.
plan <- scoped_publication_plan(candidate_dir, baseline_dir, scope_ids,
                                intent = "replacement")
profile_dir <- file.path(candidate_dir, "profile-serving")
reading_dir <- file.path(candidate_dir, "typed-reading-serving")
profile_pinned <- file.path(candidate_dir, "profile-serving.pinned")
reading_pinned <- file.path(candidate_dir, "typed-reading-serving.pinned")
stopifnot(file.rename(profile_dir, profile_pinned),
          file.rename(reading_dir, reading_pinned))
restore_pinned <- function() {
  if (dir.exists(profile_pinned)) file.rename(profile_pinned, profile_dir)
  if (dir.exists(reading_pinned)) file.rename(reading_pinned, reading_dir)
}
on.exit(restore_pinned(), add = TRUE)
locked <- FALSE
DBI::dbGetQuery(connection, "SELECT pg_advisory_lock(594, 1)")
locked <- TRUE
on.exit(if (locked) try(DBI::dbGetQuery(connection,
  "SELECT pg_advisory_unlock(594, 1)"), silent = TRUE), add = TRUE)
pinned_guard <- assert_scoped_publication_baseline(connection, plan)
pinned <- publish_scoped_retained_backend(connection, plan,
                                          pinned_guard$absent_sources)
pinned_digest <- schema_digest(schema)
stopifnot(identical(unname(pinned_digest), unname(forward_digest)),
          nrow(region_fact(replacement_indicator)) == 1L,
          identical(marker("selected_reading"), plan$target_reading_version))
receipt <- c(receipt,
  paste("pinned_scalar:", marker("scalar_observation")),
  "pinned_write: same candidate closure with profile/reading dirs renamed")
restore_pinned()
DBI::dbGetQuery(connection, "SELECT pg_advisory_unlock(594, 1)")
locked <- FALSE

DBI::dbExecute(connection, paste0("SET search_path TO ", quoted_schema))
DBI::dbExecute(connection, paste0("DROP SCHEMA ", quoted_schema, " CASCADE"))
created <- FALSE
public_after <- public_relations()
residual_after <- residual_schemas()
stopifnot(public_after == public_before, length(residual_after) == 0L)
receipt <- c(receipt,
  paste("public_relations_before_after:", public_before, public_after),
  paste("residual_serving_schemas_after:", length(residual_after)),
  "status: PASS (guarded test-only replacement proof)")
writeLines(receipt, receipt_path)
writeLines(receipt)
cat("Scoped replacement smoke PASS; receipt:", receipt_path, "\n")
}
main()
