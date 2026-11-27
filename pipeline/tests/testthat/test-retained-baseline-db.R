# Guarded #989 baseline proof: mismatch is write-free, match publishes scalar +
# DPE binding atomically, and recovery restores the frozen baseline. The legacy
# whole-snapshot publisher is deliberately proved on the reviewed pre-049 schema;
# no typed-reading owner or artefact participates in this fixture.

.baseline_db_digest <- function(con, schema) {
  tables <- DBI::dbGetQuery(con,
    "SELECT table_name FROM information_schema.tables WHERE table_schema=$1 ORDER BY table_name",
    params = list(schema))$table_name
  quote_id <- function(name) as.character(DBI::dbQuoteIdentifier(con, name))
  hashes <- vapply(tables, function(table) {
    DBI::dbGetQuery(con, paste0(
      "SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h ",
      "FROM ", quote_id(schema), ".", quote_id(table), " t"))$h[[1L]]
  }, character(1))
  names(hashes) <- tables
  hashes
}

.baseline_db_marker <- function(con, table) {
  DBI::dbGetQuery(con,
    "SELECT content_version FROM table_publication WHERE table_name=$1",
    params = list(table))$content_version[[1L]]
}

.baseline_db_binding <- function(con) {
  DBI::dbGetQuery(con,
    "SELECT required_scalar_version FROM profile_descriptor WHERE indicator_id='distribution_dpe'"
  )$required_scalar_version[[1L]]
}

.baseline_db_scope_count <- function(con) {
  as.integer(DBI::dbGetQuery(con,
    "SELECT count(*) AS n FROM scalar_observation WHERE indicator_id='stations_service'"
  )$n[[1L]])
}

test_that("guarded: scoped baseline refuses mismatches, publishes atomically and recovers", {
  con <- .adopt_db_connect()
  on.exit(DBI::dbDisconnect(con), add = TRUE, after = FALSE)
  schema <- .guarded_schema_build(con, "it_baseline_", function(schema) {
    .adopt_db_initialize_schema(con, schema)
    schema
  })$value
  on.exit(DBI::dbExecute(con, paste0('DROP SCHEMA IF EXISTS "', schema, '" CASCADE')),
          add = TRUE, after = FALSE)

  fixture <- .adopt_db_fixture()
  baseline_dir <- fixture$sortie
  candidate_dir <- tempfile("baseline-candidate-")
  dir.create(candidate_dir)
  on.exit(unlink(c(candidate_dir, fixture$root, fixture$aedar_dir, fixture$base_metadata),
                 recursive = TRUE), add = TRUE, after = FALSE)
  stopifnot(file.copy(list.files(baseline_dir, full.names = TRUE), candidate_dir,
                      recursive = TRUE))

  baseline_snapshot <- fixture$snapshot
  # Shared source rows are storage-only, but the scoped guard still compares
  # their live values. Align the scalar side with the profile owner's canonical
  # source label so the bounded fixture satisfies the same producer contract.
  profile_sources <- fixture$projections$declared_profile$distribution_dpe$datasets
  shared <- baseline_snapshot$scalar$datasets$source_id %in% profile_sources$source_id
  baseline_snapshot$scalar$datasets$name[shared] <- profile_sources$name[
    match(baseline_snapshot$scalar$datasets$source_id[shared], profile_sources$source_id)]
  scope <- .adopt_db_scalar_indicator("stations_service", "scope-test-source",
                                      seq_len(nrow(fixture$reference$rows)))
  scope$descriptors$theme_id <- "mobilite"
  candidate_scalar <- baseline_snapshot$scalar
  candidate_scalar$facts <- rbind(baseline_snapshot$scalar$facts, scope$facts)
  candidate_scalar$descriptors <- rbind(baseline_snapshot$scalar$descriptors, scope$descriptors)
  candidate_scalar$provenance <- rbind(baseline_snapshot$scalar$provenance, scope$provenance)
  candidate_scalar$datasets <- rbind(baseline_snapshot$scalar$datasets, scope$datasets)
  candidate_scalar$vintages <- rbind(baseline_snapshot$scalar$vintages, scope$vintages)
  candidate_scalar$eligible_territories <- baseline_snapshot$scalar$eligible_territories
  rownames(candidate_scalar$facts) <- rownames(candidate_scalar$descriptors) <- NULL
  rownames(candidate_scalar$provenance) <- rownames(candidate_scalar$datasets) <- NULL
  rownames(candidate_scalar$vintages) <- NULL
  candidate_version <- scalar_content_version(candidate_scalar)
  candidate_snapshot <- list(scalar = candidate_scalar,
    comparison = project_scalar_comparisons(candidate_scalar, fixture$reference$rows,
      candidate_version, fixture$reference$content_version),
    retired_indicator_ids = character())
  # Freeze the exact prior generation from the candidate, including row-name
  # normalisation, so the scoped plan's comparison proof is byte-identical.
  baseline_prior <- retained_baseline_scalar(candidate_scalar, "stations_service")
  baseline_snapshot$scalar <- baseline_prior
  baseline_snapshot$comparison <- project_scalar_comparisons(baseline_prior,
    fixture$reference$rows, scalar_content_version(baseline_prior),
    fixture$reference$content_version)

  candidate_norm <- normalizePath(candidate_dir, winslash = "/", mustWork = TRUE)
  baseline_norm <- normalizePath(baseline_dir, winslash = "/", mustWork = TRUE)
  testthat::local_mocked_bindings(
    verifier_gel_release = function(...) TRUE,
    declared_profile_owners = function() c("structure_age", "distribution_dpe"),
    project_retained_scalar_snapshot = function(sortie, ...) {
      if (identical(normalizePath(sortie, winslash = "/", mustWork = TRUE), candidate_norm))
        candidate_snapshot else baseline_snapshot
    },
    publish_canonical_milieux_state_series = function(...) list(changed = FALSE),
    .package = "lusk")
  refresh_declared_profile_scalar_binding(baseline_dir,
    c("structure_age", "distribution_dpe"), scalar_content_version(baseline_prior))
  refresh_declared_profile_scalar_binding(candidate_dir,
    c("structure_age", "distribution_dpe"), candidate_version)

  # Seed the live baseline through the real retained publisher.
  publish_retained_backend_snapshot(con, baseline_dir, atomic = TRUE,
    companion_profiles = TRUE)
  baseline_version <- .baseline_db_marker(con, "scalar_observation")
  baseline_binding <- .baseline_db_binding(con)
  baseline_profile_facts <- DBI::dbGetQuery(con,
    "SELECT * FROM profile_observation ORDER BY indicator_id,territory_id,detail_key,sex_key")

  # A real retained owned-series consumer gives the unrelated owner rows and a
  # stable parent key without resurrecting any typed-reading relation.
  series_root <- artefacts_fixture_root()
  on.exit(unlink(series_root, recursive = TRUE), add = TRUE, after = FALSE)
  series_artefact <- adaptateur_series_artefact(series_root,
    reference_version = fixture$reference$content_version)
  series_rows <- projeter_artefact_series(series_artefact)
  remplacer_series(con, "artif_par_habitant", series_rows, series_rows$version,
    reference_content_version = fixture$reference$content_version,
    reference_rows = adaptateur_reference_rows())
  DBI::dbExecute(con,
    "UPDATE series_dataset_publication SET content_version='newer-series-test' WHERE dataset_id='artif_par_habitant'")
  unrelated_before <- .baseline_db_digest(con, schema)[
    c("series_dataset_publication", "series_dataset_descriptor",
      "series_dataset_observation", "series_observation_provenance",
      "series_provenance_revision")]

  cfg <- .adopt_db_config()
  old_env <- Sys.getenv(c("LUSK_PUBLISH_HOST", "LUSK_PUBLISH_PORT",
    "LUSK_PUBLISH_DATABASE", "LUSK_PUBLISH_USER", "PGOPTIONS"), unset = NA_character_)
  on.exit({
    for (i in seq_along(old_env)) {
      if (is.na(old_env[[i]])) Sys.unsetenv(names(old_env)[[i]])
      else do.call(Sys.setenv, setNames(list(old_env[[i]]), names(old_env)[[i]]))
    }
  }, add = TRUE, after = FALSE)
  Sys.setenv(LUSK_PUBLISH_HOST = cfg$host, LUSK_PUBLISH_PORT = as.character(cfg$port),
    LUSK_PUBLISH_DATABASE = cfg$dbname, LUSK_PUBLISH_USER = cfg$user,
    PGOPTIONS = paste0("-c search_path=", schema,
      " -c statement_timeout=180000 -c lock_timeout=5000"))
  publish <- function(target, current) {
    publish_retained_backend_from_parquet(target, conso_source_path = NULL,
      baseline_sortie = current, scalar_scope = "mobilite:stations_service")
  }

  # MISMATCH: the normal wrapper refreshes only local profile metadata, then the
  # live marker guard refuses before any serving write.
  DBI::dbExecute(con,
    "UPDATE table_publication SET content_version='newer-scalar-test' WHERE table_name='scalar_observation'")
  before_refusal <- .baseline_db_digest(con, schema)
  refusal <- tryCatch({ publish(candidate_dir, baseline_dir); NULL }, error = identity)
  expect_s3_class(refusal, "error")
  expect_match(conditionMessage(refusal), "Scoped publication baseline mismatch", fixed = TRUE)
  expect_identical(.baseline_db_digest(con, schema), before_refusal)
  DBI::dbExecute(con, "UPDATE table_publication SET content_version=$1 WHERE table_name='scalar_observation'",
                 params = list(baseline_version))

  # Atomic rollback after the scalar stage: a failing profile insert must restore
  # every serving row and the candidate's pre-call profile binding artefact.
  DBI::dbExecute(con, "CREATE FUNCTION reject_baseline_profile() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected baseline profile failure'; END $$")
  DBI::dbExecute(con, "CREATE TRIGGER reject_baseline_profile BEFORE INSERT ON profile_observation
    FOR EACH ROW EXECUTE FUNCTION reject_baseline_profile()")
  before_failure <- .baseline_db_digest(con, schema)
  failed <- tryCatch({ publish(candidate_dir, baseline_dir); NULL }, error = identity)
  expect_match(conditionMessage(failed), "injected baseline profile failure", fixed = TRUE)
  expect_identical(.baseline_db_digest(con, schema), before_failure)
  expect_identical(read_profile_scalar_binding(candidate_dir), candidate_version)
  DBI::dbExecute(con, "DROP TRIGGER reject_baseline_profile ON profile_observation")
  DBI::dbExecute(con, "DROP FUNCTION reject_baseline_profile()")

  # MATCH: one real wrapper call publishes candidate scalar/comparison and the
  # DPE binding, while profile facts and the unrelated series owner stay exact.
  forward <- publish(candidate_dir, baseline_dir)
  expect_identical(.baseline_db_marker(con, "scalar_observation"), candidate_version)
  expect_identical(.baseline_db_binding(con), candidate_version)
  expect_identical(.baseline_db_scope_count(con), nrow(fixture$reference$rows))
  expect_identical(DBI::dbGetQuery(con,
    "SELECT * FROM profile_observation ORDER BY indicator_id,territory_id,detail_key,sex_key"),
    baseline_profile_facts)
  expect_identical(.baseline_db_digest(con, schema)[names(unrelated_before)], unrelated_before)
  expect_identical(.baseline_db_marker(con, "declared_profile"),
                   retained_profile_publication(candidate_dir, candidate_version,
                     fixture$reference$content_version)$version)

  # RECOVERY: the same wrapper/plan with the frozen baseline as target restores
  # the baseline scalar/profile clocks and retires only the scoped facts/source.
  recovered <- publish(baseline_dir, candidate_dir)
  expect_identical(.baseline_db_marker(con, "scalar_observation"), baseline_version)
  expect_identical(.baseline_db_binding(con), baseline_binding)
  expect_identical(.baseline_db_scope_count(con), 0L)
  expect_identical(DBI::dbGetQuery(con,
    "SELECT * FROM profile_observation ORDER BY indicator_id,territory_id,detail_key,sex_key"),
    baseline_profile_facts)
  expect_identical(.baseline_db_digest(con, schema)[names(unrelated_before)], unrelated_before)
  expect_true("scope-test-source" %in% recovered$retired$datasets)
})
