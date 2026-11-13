#!/usr/bin/env Rscript
# Guarded test-only proof of the #989 pre-publication serving baseline.
#
# NEVER targets the serving database. Requires:
#   - the private libpq passfile (PGPASSFILE) with exact lusk_it_contract roles;
#   - the dedicated test database lusk_it_contract and publisher role;
#   - LUSK_SCALAR_TEST_CLEANUP=1 (a retained test schema is refused);
#   - LUSK_RETAINED_BASELINE_MUTEX_HELD=1, set only by the PowerShell wrapper
#     that holds the named mutex 'Local\LuskIntegrationContractDb' for the whole
#     run (including cleanup);
#   - candidate and prior-baseline artifact sorties.
#
# One random `serving_it_*` schema is created and seeded with the normal
# baseline publication. Unrelated owners (demographic/economy/Milieux/series)
# are then advanced to newer publication markers, exactly as a live serving
# database may be ahead of the local accepted pack. Then:
#   MISMATCH (newer affected scalar/profile/selected-reading marker or linked
#     dependency) -> the normal scoped publication wrapper hard-refuses with
#     zero writes (whole-schema digest unchanged);
#   MATCH -> the guard passes; the normal registered publishers publish the
#     candidate scalar, the dependent DPE profile binding, and the linked
#     Habitat selected reading inside one atomic transaction. The unrelated
#     owners keep their newer markers and their rows are byte-identical;
#   RECOVERY -> the same normal wrapper/plan is called with the frozen baseline
#     as target and the published candidate as current; it restores the exact
#     baseline affected versions and removes the three scoped facts through the
#     registered retirement policy, without touching unrelated owners;
#   REPUBLISH -> the candidate is published again through the same normal path.
# The test-only fixture repair below rematerializes ONE invalid demographic
# reading on private copies; it does not make the production evidence current.
pkgload::load_all(".", quiet = TRUE)

config <- setNames(lapply(c("HOST", "PORT", "DATABASE", "USER"),
  function(suffix) Sys.getenv(paste0("LUSK_SCALAR_TEST_", suffix), unset = "")),
  c("HOST", "PORT", "DATABASE", "USER"))
expected_config <- c(HOST = "192.168.1.120", PORT = "5432",
  DATABASE = "lusk_it_contract", USER = "lusk_it_contract_pub")
stopifnot(identical(unlist(config), expected_config))
stopifnot(identical(Sys.getenv("LUSK_SCALAR_TEST_CLEANUP"), "1"),
          identical(Sys.getenv("LUSK_RETAINED_BASELINE_MUTEX_HELD"), "1"))
candidate_source <- Sys.getenv("LUSK_RETAINED_BASELINE_TEST_CANDIDATE_DIR")
baseline_source <- Sys.getenv("LUSK_RETAINED_BASELINE_TEST_BASELINE_DIR")
scope_selection <- Sys.getenv("LUSK_SCALAR_SCOPE")
stopifnot(nzchar(candidate_source), dir.exists(candidate_source),
          nzchar(baseline_source), dir.exists(baseline_source))
scope_ids <- retained_backend_scope_ids(scope_selection)
stopifnot(length(scope_ids) > 0L)
passfile <- Sys.getenv("PGPASSFILE", unset = "")
stopifnot(nzchar(passfile), file.exists(passfile),
          !startsWith(tolower(normalizePath(passfile, winslash = "/")),
                      tolower(normalizePath("..", winslash = "/"))))
read_user <- Sys.getenv("LUSK_TEST_READ_USER", unset = "")
read_dsn <- Sys.getenv("LUSK_TEST_READ_DSN", unset = "")
stopifnot(nzchar(read_user), nzchar(read_dsn))
receipt_path <- Sys.getenv("LUSK_RETAINED_BASELINE_RECEIPT",
  unset = file.path(tempdir(), "retained-baseline-receipt.txt"))
stopifnot(requireNamespace("DBI", quietly = TRUE),
          requireNamespace("RPostgres", quietly = TRUE))

workspace <- tempfile("retained-baseline-smoke-")
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
for (path in list.files(workspace, recursive = TRUE, full.names = TRUE,
                        all.files = TRUE)) Sys.chmod(path, mode = "0666")

# TEST-ONLY fixture repair (private copies): the only retained canonical
# generation available here predates the current demographic reading clock.
# Not a production artifact and does not unblock production.
rematerialize_demographic_fixture <- function(directory) {
  metadata <- lire_theme_metadata("demographie")
  histories <- jsonlite::fromJSON(
    file.path(directory, "histoires_demographie.json"),
    simplifyDataFrame = TRUE)
  territories <- nanoparquet::read_parquet(
    file.path(directory, "territoires.parquet"))
  vintages <- nanoparquet::read_parquet(file.path(directory, "vintages.parquet"))
  reading <- project_demographic_reading(histories, territories, vintages,
                                         metadata)
  projection <- typed_reading_projection(reading, "demographie", metadata,
                                         vintages)
  write_typed_reading_artifact(projection,
    file.path(directory, "typed-reading-serving", "demographie"), "demographie")
}
rematerialize_demographic_fixture(candidate_dir)
rematerialize_demographic_fixture(baseline_dir)

# TEST-ONLY preparation (private copies): make the candidate start from the
# prior profile binding so the normal metadata-only companion refresh and its
# artifact restore on failure are exercised. Profile facts are identical; only
# the declared `required_scalar_version` is re-bound by the wrapper.
unlink(file.path(candidate_dir, "profile-serving"), recursive = TRUE)
stopifnot(file.copy(file.path(baseline_dir, "profile-serving"), candidate_dir,
                    recursive = TRUE))
stopifnot(file.copy(file.path(baseline_dir, "scalar-serving", "binding.json"),
                    file.path(candidate_dir, "scalar-serving", "binding.json"),
                    overwrite = TRUE))
for (path in list.files(candidate_dir, recursive = TRUE, full.names = TRUE,
                        all.files = TRUE)) Sys.chmod(path, mode = "0666")
candidate_binding_before <- read_profile_scalar_binding(candidate_dir)

# TEST-ONLY source/vintage fixture (private candidate copy): attach two source
# rows to a scoped indicator's provenance/descriptor. Forward will insert them
# through the normal scalar publisher; recovery removes the scoped indicator and
# must retire the unreferenced source while preserving the one referenced by an
# unrelated series owner. This exercises the registered source retirement policy
# without changing the canonical artifacts.
add_scoped_test_sources <- function(directory) {
  owner_dir <- file.path(directory, "scalar-serving", "mobilite")
  projection <- read_scalar_serving_artifact(owner_dir)
  ids <- c("scope-test-unreferenced", "scope-test-referenced")
  projection$datasets <- rbind(
    projection$datasets,
    data.frame(source_id = ids,
               name = c("Scope test unreferenced source",
                        "Scope test referenced source"),
               stringsAsFactors = FALSE))
  projection$vintages <- rbind(
    projection$vintages,
    data.frame(source_id = ids,
               vintage_id = rep("2025/2025-01-01", length(ids)),
               version = "2025",
               reference_date = as.Date("2025-01-01"),
               publication_date = as.Date("2025-01-02"),
               stringsAsFactors = FALSE))
  indicator <- "stations_service"
  descriptor <- which(projection$descriptors$indicator_id == indicator)
  stopifnot(length(descriptor) == 1L)
  projection$descriptors$allowed_sources[[descriptor]] <- c(
    projection$descriptors$allowed_sources[[descriptor]], ids)
  territory <- projection$facts$territory_id[
    projection$facts$indicator_id == indicator][[1L]]
  projection$provenance <- rbind(
    projection$provenance,
    data.frame(indicator_id = rep(indicator, length(ids)),
               territory_id = rep(territory, length(ids)),
               source_id = ids,
               vintage_id = rep("2025/2025-01-01", length(ids)),
               stringsAsFactors = FALSE))
  write_scalar_serving_artifact(projection, owner_dir)
  invisible(ids)
}
scoped_test_source_ids <- add_scoped_test_sources(candidate_dir)
for (path in list.files(candidate_dir, recursive = TRUE, full.names = TRUE,
                        all.files = TRUE)) Sys.chmod(path, mode = "0666")

Sys.setenv(PGCONNECT_TIMEOUT = "5",
  PGOPTIONS = "-c statement_timeout=180000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=300000")
connection <- DBI::dbConnect(RPostgres::Postgres(), host = config$HOST,
  port = as.integer(config$PORT), dbname = config$DATABASE, user = config$USER)
identity <- DBI::dbGetQuery(connection, paste(
  "SELECT current_database() AS database, current_user AS role,",
  "inet_server_addr()::text AS server_address"))
stopifnot(nrow(identity) == 1L, identity$database[[1L]] == "lusk_it_contract",
          identity$role[[1L]] == "lusk_it_contract_pub",
          identity$server_address[[1L]] == "192.168.16.3/32")

schema <- paste0("serving_it_", Sys.getpid(), "_",
                 sprintf("%08x", sample.int(.Machine$integer.max, 1L)))
quoted_schema <- as.character(DBI::dbQuoteIdentifier(connection, schema))
created <- FALSE
previous_env <- Sys.getenv(c("LUSK_PUBLISH_HOST", "LUSK_PUBLISH_PORT",
  "LUSK_PUBLISH_DATABASE", "LUSK_PUBLISH_USER", "LUSK_SCALAR_SCOPE",
  "LUSK_SCALAR_BASELINE_SORTIE", "PGOPTIONS"), unset = NA_character_)

db_size <- function() DBI::dbGetQuery(connection,
  "SELECT pg_database_size(current_database()) AS bytes")$bytes[[1L]]
public_table_count <- function() DBI::dbGetQuery(connection, paste(
  "SELECT count(*) AS n FROM information_schema.tables",
  "WHERE table_schema='public'"))$n[[1L]]
residual_schemas <- function() DBI::dbGetQuery(connection, paste(
  "SELECT nspname FROM pg_namespace WHERE nspname LIKE 'serving_it_%'",
  "ORDER BY nspname"))$nspname
schema_digest <- function() {
  tables <- DBI::dbGetQuery(connection, paste(
    "SELECT table_name FROM information_schema.tables WHERE table_schema=$1",
    "ORDER BY table_name"), params = list(schema))$table_name
  quote_id <- function(name) as.character(DBI::dbQuoteIdentifier(connection, name))
  hashes <- vapply(tables, function(table) {
    DBI::dbGetQuery(connection, paste0(
      "SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h ",
      "FROM ", quote_id(schema), ".", quote_id(table), " t"))$h[[1L]]
  }, character(1))
  names(hashes) <- tables
  hashes
}
marker_version <- function(table, column = "content_version") {
  DBI::dbGetQuery(connection, paste0(
    "SELECT ", column, " AS v FROM table_publication WHERE table_name=$1"),
    params = list(table))$v[[1L]]
}
http_probe <- function(stage, scalar_version) {
  python <- Sys.which("python")
  if (!nzchar(python)) stop("Python executable is unavailable", call. = FALSE)
  code <- c(
    "import os",
    "from fastapi.testclient import TestClient",
    "from api.main import app",
    "stage = os.environ['LUSK_HTTP_STAGE']",
    "scalar = os.environ['LUSK_HTTP_SCALAR']",
    "with TestClient(app) as c:",
    "    r = c.get('/api/resources')",
    "    assert r.status_code == 200, r.text",
    "    ids = {x['resource_id'] for x in r.json()['resources']}",
    "    need = {'distribution_dpe','habitat_selected_reading','stations_service'}",
    "    assert need <= ids, (need - ids)",
    "    def read(res, intent):",
    "        r = c.post('/api/resources/read', json={'resource':res,'target':{'kind':'territory','type':'commune','id':'35238'},'intent':intent})",
    "        assert r.status_code == 200, (res, r.status_code, r.text)",
    "        return r",
    "    d = read('distribution_dpe', {'kind':'facts'})",
    "    assert 'sources' in d.text and 'unit' in d.text",
    "    h = read('habitat_selected_reading', {'kind':'facts'})",
    "    assert 'descriptor' in h.text and 'part_passoires' in h.text, h.text[:800]",
    "    assert scalar in d.text, (scalar, d.text[:300])",
    "    if stage == 'after':",
    "        for res in ('stations_service','stations_service_1000','bornes_recharge_1000'):",
    "            x = read(res, {'kind':'facts'})",
    "            assert 'unit' in x.text and 'sources' in x.text",
    "            y = read(res, {'kind':'fixed_comparison','context':'default'})",
    "            assert 'rank' in y.text"
  )
  script <- tempfile(fileext = ".py")
  writeLines(code, script)
  keys <- c("PYTHONPATH", "DATABASE_URL", "PGOPTIONS", "LUSK_HTTP_STAGE",
            "LUSK_HTTP_SCALAR")
  previous <- Sys.getenv(keys, unset = NA_character_)
  on.exit({
    for (i in seq_along(keys)) {
      if (is.na(previous[[i]])) Sys.unsetenv(keys[[i]])
      else do.call(Sys.setenv, setNames(list(previous[[i]]), keys[[i]]))
    }
    unlink(script)
  }, add = TRUE)
  Sys.setenv(PYTHONPATH = normalizePath("..", winslash = "/", mustWork = TRUE),
    DATABASE_URL = read_dsn,
    PGOPTIONS = paste0("-c search_path=", schema,
      " -c statement_timeout=60000 -c lock_timeout=5000"),
    LUSK_HTTP_STAGE = stage, LUSK_HTTP_SCALAR = scalar_version)
  status <- system2(python, shQuote(script), stdout = "", stderr = "")
  if (!identical(status, 0L))
    stop("HTTP probe failed at stage: ", stage, call. = FALSE)
  invisible(TRUE)
}

own_schema_cleanup <- function() {
  if (!created) return(invisible(NULL))
  check <- DBI::dbGetQuery(connection, paste(
    "SELECT current_database() AS database, EXISTS (",
    "SELECT 1 FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner",
    "WHERE n.nspname=$1 AND r.rolname=current_user) AS owned"),
    params = list(schema))
  if (!identical(check$database[[1L]], "lusk_it_contract") ||
      !isTRUE(check$owned[[1L]]) || !grepl("^serving_it_[A-Za-z0-9_]+$", schema))
    stop("Refusing cleanup: schema identity is not this guarded test schema")
  DBI::dbExecute(connection, paste0("DROP SCHEMA ", quoted_schema, " CASCADE"))
  invisible(NULL)
}

receipt <- c(paste("schema:", schema), paste("db_bytes_before:", db_size()),
             paste("public_tables_before:", public_table_count()))
failure <- NULL
cleanup_failure <- NULL
tryCatch({
  DBI::dbExecute(connection, paste0("CREATE SCHEMA ", quoted_schema))
  created <- TRUE
  DBI::dbExecute(connection, paste0("SET search_path TO ", quoted_schema))
  schema_sql <- paste(readLines(file.path("..", "api", "schema.sql"), warn = FALSE),
                      collapse = "\n")
  for (statement in split_postgres_sql(schema_sql)) DBI::dbExecute(connection, statement)
  DBI::dbExecute(connection, paste0("GRANT USAGE ON SCHEMA ", quoted_schema,
    " TO ", as.character(DBI::dbQuoteIdentifier(connection, read_user))))
  DBI::dbExecute(connection, paste0("GRANT SELECT ON ALL TABLES IN SCHEMA ",
    quoted_schema, " TO ",
    as.character(DBI::dbQuoteIdentifier(connection, read_user))))

  reference <- project_territory_reference(nanoparquet::read_parquet(
    file.path(baseline_dir, "territoires.parquet")))
  publish_territory_reference_projection(reference,
    territory_reference_postgres_adapter(connection))
  baseline_snapshot <- project_retained_scalar_snapshot(baseline_dir, reference)
  publish_retained_scalar_snapshot(connection, baseline_snapshot, tempdir())
  profile_owners <- unique(c(
    profile_serving_owners(lire_theme_metadata("demographie")),
    profile_serving_owners(lire_theme_metadata("habitat")),
    profile_serving_owners(lire_theme_metadata("mobilite"))))
  publier_declared_profiles_postgres(baseline_dir, profile_owners, con = connection)
  publish_retained_backend_snapshot(connection, baseline_dir, conso_source_path = NULL)
  baseline_state <- schema_digest()
  baseline_markers <- retained_backend_markers(connection)
  baseline_counts <- c(
    facts = DBI::dbGetQuery(connection,
      "SELECT count(*) AS n FROM scalar_observation")$n[[1L]],
    descriptors = DBI::dbGetQuery(connection,
      "SELECT count(*) AS n FROM scalar_descriptor")$n[[1L]],
    groups = DBI::dbGetQuery(connection,
      "SELECT count(*) AS n FROM scalar_comparison_group")$n[[1L]],
    territories = DBI::dbGetQuery(connection,
      "SELECT count(*) AS n FROM scalar_comparison_territory")$n[[1L]])
  receipt <- c(receipt, paste("baseline_scalar_version:",
                              marker_version("scalar_observation")))
  http_probe("before", marker_version("scalar_observation"))
  receipt <- c(receipt, "http_before: PASS (DPE + Habitat available; scalar 3 discovered)")

  # Unrelated owners are advanced to newer publication markers, exactly as a
  # live serving database may legitimately be ahead of the local accepted pack.
  # A scoped publication must neither require nor rewrite them.
  affected_table <- function(name) grepl(paste0(
    "^(table_publication$|scalar_|profile_|selected_reading_|",
    "habitat_typed_reading$|comparison_source_lineage$|",
    "source_dataset$|source_vintage$)"), name)
  unrelated_digests <- function() {
    hashes <- schema_digest()
    hashes[!affected_table(names(hashes))]
  }
  newer_markers <- c(
    demographic_typed_reading = "newer-demographic-test",
    economy_typed_reading = "newer-economy-test",
    economy_activity_evidence = "newer-activity-test",
    milieux_typed_reading = "newer-milieux-test",
    milieux_reading_absence = "newer-absence-test")
  for (name in names(newer_markers))
    DBI::dbExecute(connection, paste(
      "UPDATE table_publication SET content_version=$1 WHERE table_name=$2"),
      params = list(newer_markers[[name]], name))
  DBI::dbExecute(connection, paste(
    "UPDATE series_dataset_publication SET content_version='newer-series-test'"))
  # TEST-ONLY unrelated-owner reference: a series provenance revision points at
  # the synthetic scope source. Recovery must preserve that source row instead
  # of deleting it and leaving a dangling owner reference.
  DBI::dbExecute(connection, paste(
    "INSERT INTO series_provenance_revision(provenance_revision_id, source_id,",
    "vintage_id, source_name, dataset_name, source_version, reference_date,",
    "publication_date, revision_hash) VALUES",
    "('scope-test-revision','scope-test-referenced','2025/2025-01-01',",
    "'Scope test referenced source','Scope test dataset','2025',",
    "'2025-01-01','2025-01-02','scope-test-revision-hash')"))
  source_rows <- function() list(
    datasets = DBI::dbGetQuery(connection, paste(
      "SELECT source_id, name FROM source_dataset ORDER BY source_id")),
    vintages = DBI::dbGetQuery(connection, paste(
      "SELECT source_id, vintage_id, version, reference_date,",
      "publication_date FROM source_vintage ORDER BY source_id, vintage_id")))
  source_before <- source_rows()
  unrelated_rows_before <- unrelated_digests()
  after_unrelated_mutation <- schema_digest()

  # Mismatch proofs use the normal integrated wrapper; it refuses before any
  # write, so the seeded baseline must remain byte-identical.
  Sys.setenv(LUSK_PUBLISH_HOST = config$HOST, LUSK_PUBLISH_PORT = config$PORT,
    LUSK_PUBLISH_DATABASE = config$DATABASE, LUSK_PUBLISH_USER = config$USER,
    LUSK_SCALAR_SCOPE = scope_selection,
    LUSK_SCALAR_BASELINE_SORTIE = baseline_dir,
    PGOPTIONS = paste0("-c search_path=", schema,
      " -c statement_timeout=180000 -c lock_timeout=5000",
      " -c idle_in_transaction_session_timeout=300000"))
  scalar_before <- marker_version("scalar_observation")
  DBI::dbExecute(connection, paste(
    "UPDATE table_publication SET content_version='newer-scalar-test'",
    "WHERE table_name='scalar_observation'"))
  mutated <- schema_digest()
  refused <- tryCatch({ publish_retained_backend_from_parquet(candidate_dir); NULL },
                      error = function(e) e)
  stopifnot(inherits(refused, "error"),
    grepl("Scoped publication baseline mismatch", conditionMessage(refused), fixed = TRUE))
  stopifnot(identical(mutated, schema_digest()))
  DBI::dbExecute(connection, paste(
    "UPDATE table_publication SET content_version=$1",
    "WHERE table_name='scalar_observation'"), params = list(scalar_before))
  receipt <- c(receipt, "mismatch_scalar_case: PASS (refused, zero writes)")

  habitat_before <- marker_version("selected_reading")
  DBI::dbExecute(connection, paste(
    "UPDATE table_publication SET content_version='newer-habitat-test'",
    "WHERE table_name='selected_reading'"))
  mutated <- schema_digest()
  refused <- tryCatch({ publish_retained_backend_from_parquet(candidate_dir); NULL },
                      error = function(e) e)
  stopifnot(inherits(refused, "error"),
    grepl("Scoped publication baseline mismatch", conditionMessage(refused), fixed = TRUE))
  stopifnot(identical(mutated, schema_digest()))
  DBI::dbExecute(connection, paste(
    "UPDATE table_publication SET content_version=$1",
    "WHERE table_name='selected_reading'"), params = list(habitat_before))
  receipt <- c(receipt, "mismatch_owner_case: PASS (refused, zero writes)")
  stopifnot(identical(schema_digest(), after_unrelated_mutation))

  # Mismatch: a newer live declared profile, selected-reading linked clock, or
  # DPE required scalar version must refuse with zero writes.
  declared_before <- marker_version("declared_profile")
  DBI::dbExecute(connection, paste(
    "UPDATE table_publication SET content_version='newer-profile-test'",
    "WHERE table_name='declared_profile'"))
  mutated <- schema_digest()
  refused <- tryCatch({ publish_retained_backend_from_parquet(candidate_dir); NULL },
                      error = function(e) e)
  stopifnot(inherits(refused, "error"),
    grepl("Scoped publication baseline mismatch", conditionMessage(refused), fixed = TRUE))
  stopifnot(identical(mutated, schema_digest()))
  DBI::dbExecute(connection, paste(
    "UPDATE table_publication SET content_version=$1",
    "WHERE table_name='declared_profile'"), params = list(declared_before))

  linked_before <- DBI::dbGetQuery(connection, paste(
    "SELECT linked_content_version FROM selected_reading_descriptor",
    "WHERE theme_id='habitat'"))$linked_content_version[[1L]]
  DBI::dbExecute(connection, paste(
    "UPDATE selected_reading_descriptor SET linked_content_version='newer-link-test'",
    "WHERE theme_id='habitat'"))
  mutated <- schema_digest()
  refused <- tryCatch({ publish_retained_backend_from_parquet(candidate_dir); NULL },
                      error = function(e) e)
  stopifnot(inherits(refused, "error"),
    grepl("Scoped publication baseline mismatch", conditionMessage(refused), fixed = TRUE))
  stopifnot(identical(mutated, schema_digest()))
  DBI::dbExecute(connection, paste(
    "UPDATE selected_reading_descriptor SET linked_content_version=$1",
    "WHERE theme_id='habitat'"), params = list(linked_before))

  required_before <- DBI::dbGetQuery(connection, paste(
    "SELECT required_scalar_version FROM profile_descriptor",
    "WHERE indicator_id='distribution_dpe'"))$required_scalar_version[[1L]]
  DBI::dbExecute(connection, paste(
    "UPDATE profile_descriptor SET required_scalar_version='newer-required-test'",
    "WHERE indicator_id='distribution_dpe'"))
  mutated <- schema_digest()
  refused <- tryCatch({ publish_retained_backend_from_parquet(candidate_dir); NULL },
                      error = function(e) e)
  stopifnot(inherits(refused, "error"),
    grepl("Scoped publication baseline mismatch", conditionMessage(refused), fixed = TRUE))
  stopifnot(identical(mutated, schema_digest()))
  DBI::dbExecute(connection, paste(
    "UPDATE profile_descriptor SET required_scalar_version=$1",
    "WHERE indicator_id='distribution_dpe'"), params = list(required_before))
  receipt <- c(receipt,
    "mismatch_profile_cases: PASS (refused, zero writes)")

  # Mismatch: newer live shared source_dataset/source_vintage rows must refuse
  # with zero writes. These rows are upserted by the whole-snapshot scalar and
  # profile publishers, so they are part of the affected closure.
  shared_source_before <- DBI::dbGetQuery(connection, paste(
    "SELECT name FROM source_dataset WHERE source_id='stationnement-velo'"))$name[[1L]]
  DBI::dbExecute(connection, paste(
    "UPDATE source_dataset SET name='newer-shared-source-test'",
    "WHERE source_id='stationnement-velo'"))
  mutated <- schema_digest()
  refused <- tryCatch({ publish_retained_backend_from_parquet(candidate_dir); NULL },
                      error = function(e) e)
  stopifnot(inherits(refused, "error"),
    grepl("Scoped publication baseline mismatch", conditionMessage(refused), fixed = TRUE))
  stopifnot(identical(mutated, schema_digest()))
  DBI::dbExecute(connection, paste(
    "UPDATE source_dataset SET name=$1 WHERE source_id='stationnement-velo'"),
    params = list(shared_source_before))

  shared_vintage_before <- DBI::dbGetQuery(connection, paste(
    "SELECT version, reference_date, publication_date FROM source_vintage",
    "WHERE source_id='stationnement-velo'"))
  DBI::dbExecute(connection, paste(
    "UPDATE source_vintage SET version='newer-shared-vintage-test'",
    "WHERE source_id='stationnement-velo'"))
  mutated <- schema_digest()
  refused <- tryCatch({ publish_retained_backend_from_parquet(candidate_dir); NULL },
                      error = function(e) e)
  stopifnot(inherits(refused, "error"),
    grepl("Scoped publication baseline mismatch", conditionMessage(refused), fixed = TRUE))
  stopifnot(identical(mutated, schema_digest()))
  DBI::dbExecute(connection, paste(
    "UPDATE source_vintage SET version=$1, reference_date=$2, publication_date=$3",
    "WHERE source_id='stationnement-velo'"),
    params = list(shared_vintage_before$version[[1L]],
                  shared_vintage_before$reference_date[[1L]],
                  shared_vintage_before$publication_date[[1L]]))
  receipt <- c(receipt,
    "mismatch_source_cases: PASS (refused, zero writes)")

  stopifnot(identical(schema_digest(), after_unrelated_mutation),
            identical(read_profile_scalar_binding(candidate_dir),
                      candidate_binding_before))
  profile_facts_before <- DBI::dbGetQuery(connection, paste(
    "SELECT * FROM profile_observation",
    "ORDER BY indicator_id,territory_id,detail_key,sex_key"))
  profile_sources_before <- DBI::dbGetQuery(connection, paste(
    "SELECT * FROM profile_observation_source",
    "ORDER BY indicator_id,territory_id,detail_key,sex_key,source_id,vintage_id"))
  profile_source_digest <- function() DBI::dbGetQuery(connection, paste(
    "SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h",
    "FROM profile_observation_source t"))$h[[1L]]
  profile_source_digest_before <- profile_source_digest()

  # Forced failure AFTER the scalar + profile companion stage, BEFORE the
  # selected reading completes. The outer transaction must roll back every
  # owner and the wrapper must restore the pre-refresh profile artifact.
  DBI::dbExecute(connection, paste(
    "CREATE FUNCTION reject_habitat_smoke() RETURNS trigger LANGUAGE plpgsql AS $$",
    "BEGIN RAISE EXCEPTION 'injected habitat failure'; END $$"))
  DBI::dbExecute(connection, paste(
    "CREATE TRIGGER reject_habitat_smoke BEFORE INSERT ON habitat_typed_reading",
    "FOR EACH ROW EXECUTE FUNCTION reject_habitat_smoke()"))
  before_failure <- schema_digest()
  failed <- tryCatch({ publish_retained_backend_from_parquet(candidate_dir); NULL },
                     error = function(e) e)
  stopifnot(inherits(failed, "error"),
    grepl("injected habitat failure", conditionMessage(failed), fixed = TRUE))
  stopifnot(identical(before_failure, schema_digest()),
            identical(read_profile_scalar_binding(candidate_dir),
                      candidate_binding_before))
  DBI::dbExecute(connection,
    "DROP TRIGGER reject_habitat_smoke ON habitat_typed_reading")
  DBI::dbExecute(connection, "DROP FUNCTION reject_habitat_smoke()")
  receipt <- c(receipt,
    "atomic_rollback_case: PASS (whole-schema digest unchanged; profile artifact restored)")

  # MATCH: ONE actual normal wrapper call. The wrapper refreshes the profile
  # companion, passes the guard, and publishes all owners atomically.
  forward_receipt <- publish_retained_backend_from_parquet(candidate_dir)
  candidate_reference <- project_territory_reference(nanoparquet::read_parquet(
    file.path(candidate_dir, "territoires.parquet")))
  candidate_snapshot <- project_retained_scalar_snapshot(candidate_dir,
                                                         candidate_reference)
  candidate_scalar_version <- scalar_content_version(candidate_snapshot$scalar)
  candidate_profile <- retained_profile_publication(candidate_dir,
    candidate_scalar_version, candidate_reference$content_version)
  candidate_habitat <- read_typed_reading_publication_from(candidate_dir,
                                                           "habitat")
  candidate_linked <- retained_selected_linked_version(candidate_habitat,
    candidate_profile$version, candidate_scalar_version,
    candidate_reference$content_version)
  stopifnot(identical(read_profile_scalar_binding(candidate_dir),
                      candidate_scalar_version))

  after_markers <- retained_backend_markers(connection)
  stopifnot(identical(marker_version("scalar_observation"),
                      candidate_scalar_version))
  stopifnot(identical(after_markers$comparison$content_version[[1L]],
                      candidate_snapshot$comparison$content_version))
  stopifnot(identical(marker_version("declared_profile"),
                      candidate_profile$version),
    identical(after_markers$profile_comparison$content_version[[1L]],
              candidate_profile$comparison_version),
    identical(DBI::dbGetQuery(connection, paste(
      "SELECT linked_content_version FROM selected_reading_descriptor",
      "WHERE theme_id='habitat'"))$linked_content_version[[1L]],
      candidate_linked),
    identical(DBI::dbGetQuery(connection, paste(
      "SELECT required_scalar_version FROM profile_descriptor",
      "WHERE indicator_id='distribution_dpe'"))$required_scalar_version[[1L]],
      candidate_scalar_version))
  stopifnot(identical(profile_facts_before, DBI::dbGetQuery(connection, paste(
    "SELECT * FROM profile_observation",
    "ORDER BY indicator_id,territory_id,detail_key,sex_key"))))
  stopifnot(identical(profile_sources_before, DBI::dbGetQuery(connection, paste(
    "SELECT * FROM profile_observation_source",
    "ORDER BY indicator_id,territory_id,detail_key,sex_key,source_id,vintage_id"))),
    identical(profile_source_digest_before, profile_source_digest()))
  # The selected reading keeps its content marker (only its linked dependency
  # moves); the reference is a required match that is never rewritten; the
  # unrelated owners keep the newer markers they had before this publication.
  for (table in c("territory_reference", "selected_reading")) {
    before <- baseline_markers$tables[baseline_markers$tables$table_name == table, ]
    after <- after_markers$tables[after_markers$tables$table_name == table, ]
    stopifnot(nrow(before) == 1L, nrow(after) == 1L,
      identical(before$content_version[[1L]], after$content_version[[1L]]),
      identical(before$reference_content_version[[1L]],
                after$reference_content_version[[1L]]))
  }
  for (table in names(newer_markers)) {
    live <- after_markers$tables[after_markers$tables$table_name == table, ]
    stopifnot(nrow(live) == 1L,
      identical(as.character(live$content_version[[1L]]),
                newer_markers[[table]]))
  }
  stopifnot(identical(as.character(after_markers$series$content_version[[1L]]),
                      "newer-series-test"),
    identical(unrelated_rows_before, unrelated_digests()))

  # The forward publication inserts the two synthetic source rows through the
  # normal scalar publisher and leaves every shared source/vintage row exactly
  # as it was.
  source_after_forward <- source_rows()
  stopifnot(
    all(scoped_test_source_ids %in% source_after_forward$datasets$source_id),
    all(scoped_test_source_ids %in% source_after_forward$vintages$source_id),
    all(source_after_forward$vintages$vintage_id[
      source_after_forward$vintages$source_id %in% scoped_test_source_ids] ==
      "2025/2025-01-01"))
  reset_rows <- function(rows) {
    rownames(rows) <- NULL
    rows
  }
  non_test_datasets <- function(rows)
    rows[!rows$source_id %in% scoped_test_source_ids, , drop = FALSE]
  non_test_vintages <- function(rows)
    rows[!rows$source_id %in% scoped_test_source_ids, , drop = FALSE]
  stopifnot(
    identical(reset_rows(non_test_datasets(source_after_forward$datasets)),
              reset_rows(source_before$datasets)),
    identical(reset_rows(non_test_vintages(source_after_forward$vintages)),
              reset_rows(source_before$vintages)))
  stopifnot(
    all(scoped_test_source_ids %in% forward_receipt$preserved$datasets),
    all(vapply(scoped_test_source_ids, function(id)
      any(grepl(id, forward_receipt$preserved$vintages, fixed = TRUE)),
      logical(1))),
    length(forward_receipt$retired$datasets) == 0L,
    length(forward_receipt$retired$vintages) == 0L)
  receipt <- c(receipt,
    "source_forward_case: PASS (scope sources inserted and referenced; shared rows unchanged)")

  scope_sql <- paste(vapply(scope_ids, function(id)
    as.character(DBI::dbQuoteString(connection, id)), character(1)),
    collapse = ",")
  base_facts <- DBI::dbGetQuery(connection, paste0(
    "SELECT indicator_id,territory_id,territory_type,value,status,",
    "support_count,denominator_count FROM scalar_observation ",
    "WHERE indicator_id NOT IN (", scope_sql, ") ",
    "ORDER BY indicator_id,territory_id"))
  candidate_facts <- candidate_snapshot$scalar$facts[
    !candidate_snapshot$scalar$facts$indicator_id %in% scope_ids, ]
  candidate_facts <- candidate_facts[
    order(candidate_facts$indicator_id, candidate_facts$territory_id), ]
  rownames(candidate_facts) <- NULL
  stopifnot(identical(as.character(base_facts$indicator_id),
                      as.character(candidate_facts$indicator_id)),
    isTRUE(all.equal(as.numeric(base_facts$value), candidate_facts$value)),
    identical(as.character(base_facts$status), as.character(candidate_facts$status)))
  scope_counts <- DBI::dbGetQuery(connection, paste0(
    "SELECT indicator_id, count(*) AS n FROM scalar_observation ",
    "WHERE indicator_id IN (", scope_sql, ") GROUP BY indicator_id"))
  stopifnot(setequal(scope_counts$indicator_id, scope_ids),
    all(scope_counts$n == 1267L))
  candidate_counts <- c(
    facts = DBI::dbGetQuery(connection,
      "SELECT count(*) AS n FROM scalar_observation")$n[[1L]],
    descriptors = DBI::dbGetQuery(connection,
      "SELECT count(*) AS n FROM scalar_descriptor")$n[[1L]],
    groups = DBI::dbGetQuery(connection,
      "SELECT count(*) AS n FROM scalar_comparison_group")$n[[1L]],
    territories = DBI::dbGetQuery(connection,
      "SELECT count(*) AS n FROM scalar_comparison_territory")$n[[1L]])
  stopifnot(candidate_counts[["facts"]] - baseline_counts[["facts"]] == 3801L,
    candidate_counts[["descriptors"]] - baseline_counts[["descriptors"]] == 3L)
  receipt <- c(receipt,
    paste("candidate_counts:", paste(names(candidate_counts),
                                     candidate_counts, collapse = " ")),
    paste("baseline_counts:", paste(names(baseline_counts),
                                    baseline_counts, collapse = " ")),
    "match_case: PASS (guard passed; exact three added; unchanged owners no-op)")
  http_probe("after", candidate_scalar_version)
  receipt <- c(receipt,
    "http_after: PASS (DPE + Habitat available; scalar 3 facts + fixed ranks)")

  # RECOVERY: the same normal wrapper and plan, with the frozen baseline as the
  # target generation and the just-published candidate as the current one. The
  # registered scalar publisher's explicit retirement policy omits the three
  # scoped facts; the same atomic transaction restores the profile companion and
  # the linked Habitat reading. Unrelated owners are not read or written.
  recovery_receipt <- publish_retained_backend_from_parquet(baseline_dir,
                                        baseline_sortie = candidate_dir)
  restored_markers <- retained_backend_markers(connection)
  baseline_scalar_version <- scalar_content_version(baseline_snapshot$scalar)
  restored_scope_count <- DBI::dbGetQuery(connection, paste0(
    "SELECT count(*) AS n FROM scalar_observation WHERE indicator_id IN (",
    scope_sql, ")"))$n[[1L]]
  stopifnot(
    identical(marker_version("scalar_observation"), baseline_scalar_version),
    identical(restored_markers$comparison$content_version[[1L]],
              baseline_snapshot$comparison$content_version),
    identical(restored_markers$tables$content_version[
                restored_markers$tables$table_name == "declared_profile"],
              baseline_markers$tables$content_version[
                baseline_markers$tables$table_name == "declared_profile"]),
    identical(restored_markers$profile_comparison$content_version[[1L]],
              baseline_markers$profile_comparison$content_version[[1L]]),
    identical(restored_markers$selected_descriptor$linked_content_version[[1L]],
              baseline_markers$selected_descriptor$linked_content_version[[1L]]),
    identical(DBI::dbGetQuery(connection, paste(
      "SELECT required_scalar_version FROM profile_descriptor",
      "WHERE indicator_id='distribution_dpe'"))$required_scalar_version[[1L]],
      baseline_scalar_version),
    restored_scope_count == 0L,
    identical(profile_facts_before, DBI::dbGetQuery(connection, paste(
      "SELECT * FROM profile_observation",
      "ORDER BY indicator_id,territory_id,detail_key,sex_key"))),
    identical(profile_source_digest_before, profile_source_digest()),
    identical(unrelated_rows_before, unrelated_digests()))
  for (table in names(newer_markers)) {
    live <- restored_markers$tables[restored_markers$tables$table_name == table, ]
    stopifnot(nrow(live) == 1L,
      identical(as.character(live$content_version[[1L]]),
                newer_markers[[table]]))
  }
  stopifnot(identical(as.character(
    restored_markers$series$content_version[[1L]]), "newer-series-test"))
  stopifnot(
    "scope-test-unreferenced" %in% recovery_receipt$retired$datasets,
    "scope-test-referenced" %in% recovery_receipt$preserved$datasets,
    any(grepl("scope-test-unreferenced", recovery_receipt$retired$vintages,
              fixed = TRUE)),
    any(grepl("scope-test-referenced", recovery_receipt$preserved$vintages,
              fixed = TRUE)))
  source_after_recovery <- source_rows()
  stopifnot(
    !"scope-test-unreferenced" %in% source_after_recovery$datasets$source_id,
    "scope-test-referenced" %in% source_after_recovery$datasets$source_id,
    !"scope-test-unreferenced" %in% source_after_recovery$vintages$source_id,
    "scope-test-referenced" %in% source_after_recovery$vintages$source_id,
    all(source_after_recovery$vintages$vintage_id[
      source_after_recovery$vintages$source_id == "scope-test-referenced"] ==
      "2025/2025-01-01"),
    DBI::dbGetQuery(connection, paste(
      "SELECT count(*) AS n FROM series_provenance_revision",
      "WHERE provenance_revision_id='scope-test-revision'"))$n[[1L]] == 1L,
    identical(reset_rows(non_test_datasets(source_after_recovery$datasets)),
              reset_rows(source_before$datasets)),
    identical(reset_rows(non_test_vintages(source_after_recovery$vintages)),
              reset_rows(source_before$vintages)))
  receipt <- c(receipt,
    "recovery_source_case: PASS (unreferenced scope source retired; referenced source preserved; shared rows exact)")
  receipt <- c(receipt,
    "recovery_case: PASS (normal wrapper restored the frozen affected baseline; three omitted; unrelated owners untouched)")

  # REPUBLISH: the candidate can be published again through the same normal
  # wrapper once the baseline guard state is restored.
  publish_retained_backend_from_parquet(candidate_dir)
  republished_markers <- retained_backend_markers(connection)
  republished_scope_count <- DBI::dbGetQuery(connection, paste0(
    "SELECT count(*) AS n FROM scalar_observation WHERE indicator_id IN (",
    scope_sql, ")"))$n[[1L]]
  stopifnot(
    identical(marker_version("scalar_observation"), candidate_scalar_version),
    republished_scope_count == 3L * 1267L,
    identical(unrelated_rows_before, unrelated_digests()))
  for (table in names(newer_markers)) {
    live <- republished_markers$tables[
      republished_markers$tables$table_name == table, ]
    stopifnot(nrow(live) == 1L,
      identical(as.character(live$content_version[[1L]]),
                newer_markers[[table]]))
  }
  source_after_republish <- source_rows()
  stopifnot(
    all(scoped_test_source_ids %in% source_after_republish$datasets$source_id),
    all(scoped_test_source_ids %in% source_after_republish$vintages$source_id),
    all(source_after_republish$vintages$vintage_id[
      source_after_republish$vintages$source_id %in% scoped_test_source_ids] ==
      "2025/2025-01-01"),
    DBI::dbGetQuery(connection, paste(
      "SELECT count(*) AS n FROM series_provenance_revision",
      "WHERE provenance_revision_id='scope-test-revision'"))$n[[1L]] == 1L)
  receipt <- c(receipt,
    "republish_source_case: PASS (scope sources reinserted; unrelated reference intact)")
  receipt <- c(receipt,
    "republish_case: PASS (candidate published again through the normal wrapper)")
}, error = function(e) {
  failure <<- conditionMessage(e)
  stop(e)
}, finally = {
  restore <- previous_env[!is.na(previous_env)]
  if (length(restore)) do.call(Sys.setenv, as.list(restore))
  cleanup_failure <- tryCatch({ own_schema_cleanup(); NULL },
                              error = function(e) conditionMessage(e))
  residual <- residual_schemas()
  receipt <- c(receipt,
    paste("residual_serving_schemas:",
          if (length(residual)) paste(residual, collapse = ",") else "none"),
    paste("public_tables_after:", public_table_count()),
    paste("db_bytes_after:", db_size()),
    paste("cleanup:", if (is.null(cleanup_failure)) "ok" else cleanup_failure),
    paste("status:", if (is.null(failure) && is.null(cleanup_failure)) "PASS" else "FAIL"))
  writeLines(receipt, receipt_path)
  cat(paste(receipt, collapse = "\n"), "\n")
  DBI::dbDisconnect(connection)
  unlink(workspace, recursive = TRUE)
  if (!is.null(cleanup_failure))
    stop("Guarded test schema cleanup failed: ", cleanup_failure, call. = FALSE)
})
