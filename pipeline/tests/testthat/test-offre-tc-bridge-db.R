# Guarded disposable-database proof for the #1071 bridge.
# NEVER targets the serving database `lusk`. This whole file skips unless the
# operator configured the guarded lusk_it_contract target and runs it through
# pipeline/scripts/run-offre-tc-bridge-db.ps1, which holds the shared Windows
# named mutex 'Local\LuskIntegrationContractDb' across the whole R process.
# No connection is opened at load time. See api/tests/integration/README.md.

bridge_db_proof_configured <- function() {
  required <- c("LUSK_BRIDGE_TEST_DATABASE", "LUSK_BRIDGE_TEST_USER",
                "LUSK_BRIDGE_TEST_MUTEX_HELD", "LUSK_BRIDGE_TEST_CLEANUP",
                "PGPASSFILE")
  all(nzchar(Sys.getenv(required, unset = "")))
}

# Match the guarded Python/R suites: prove the named mutex is actually held by
# the wrapper instead of trusting an environment flag alone. WaitOne(0) can only
# succeed when nobody else holds the mutex; if it does, we release and fail.
bridge_db_assert_mutex_held <- function() {
  script <- tempfile("bridge-mutex-", fileext = ".ps1")
  on.exit(unlink(script), add = TRUE)
  writeLines(c(
    "$name = 'Local\\LuskIntegrationContractDb'",
    "$m = New-Object System.Threading.Mutex($false, $name)",
    "$free = $m.WaitOne(0)",
    "if ($free) { $m.ReleaseMutex() }",
    "$m.Dispose()",
    "if ($free) { 'FREE' } else { 'HELD' }"), script)
  output <- system2("powershell", c("-NoProfile", "-File", shQuote(script)), stdout = TRUE)
  expect_identical(trimws(paste(output, collapse = "")), "HELD")
}

if (!bridge_db_proof_configured()) {
  test_that("the guarded bridge database proof is skipped by default", {
    skip("run pipeline/scripts/run-offre-tc-bridge-db.ps1 with the disposable DB config")
  })
} else {
  test_that("the bridge rolls back on failure and really writes on control", {
    bridge_db_assert_mutex_held()
    database <- Sys.getenv("LUSK_BRIDGE_TEST_DATABASE", unset = "")
    user <- Sys.getenv("LUSK_BRIDGE_TEST_USER", unset = "")
    host <- Sys.getenv("LUSK_BRIDGE_TEST_HOST", unset = "192.168.1.120")
    port <- as.integer(Sys.getenv("LUSK_BRIDGE_TEST_PORT", unset = "5432"))
    passfile <- normalizePath(Sys.getenv("PGPASSFILE"), winslash = "/", mustWork = TRUE)
    repository <- bridge_db_repo_root()
    # HARD stop before dbConnect: an expect_* here would only record a failure
    # and still connect to whatever target the caller supplied.
    bridge_db_target_guard(database, user, host)
    if (!identical(Sys.getenv("LUSK_BRIDGE_TEST_MUTEX_HELD"), "1") ||
        !identical(Sys.getenv("LUSK_BRIDGE_TEST_CLEANUP"), "1") ||
        startsWith(tolower(passfile), paste0(tolower(repository), "/")))
      stop("Guarded proof requires the mutex, cleanup opt-in and a private passfile outside the repo")
    expect_true(requireNamespace("DBI", quietly = TRUE))
    expect_true(requireNamespace("DBI", quietly = TRUE))
    expect_true(requireNamespace("RPostgres", quietly = TRUE))

    connection <- DBI::dbConnect(RPostgres::Postgres(), host = host, port = port,
                                 dbname = database, user = user, passfile = passfile)
    on.exit(try(DBI::dbDisconnect(connection), silent = TRUE), add = TRUE)
    identity <- bridge_db_query(connection, paste(
      "SELECT current_database() AS database, current_user AS role"))
    assert_bridge_connected_test_db(identity)  # HARD stop before any DDL
    config <- list(dbname = database, user = user)

    schema <- paste0("serving_it_", Sys.getpid(), "_",
                     sprintf("%08x", sample.int(.Machine$integer.max, 1L)))
    quoted_schema <- as.character(DBI::dbQuoteIdentifier(connection, schema))
    open_fresh <- function(cfg) do.call(DBI::dbConnect, c(
      list(drv = RPostgres::Postgres()),
      list(host = host, port = port, dbname = cfg$dbname, user = cfg$user,
           passfile = passfile)))

    bridge_db_exec(connection, paste0("CREATE SCHEMA ", quoted_schema))
    # Register cleanup IMMEDIATELY, on a FRESH connection: the publication
    # connection may be broken (observed bad_weak_ptr) and any failure between
    # here and the first assertion must still drop this run's schema.
    on.exit(bridge_db_cleanup_schema(schema, config, open = open_fresh), add = TRUE)
    bridge_db_exec(connection, paste0("SET search_path TO ", quoted_schema))
    ddl <- paste(readLines(bridge_db_schema_path(), warn = FALSE), collapse = "\n")
    for (statement in split_postgres_sql(ddl)) bridge_db_exec(connection, statement)

    # Seed the OLD (pre-bridge) serving state through the registered publishers.
    live <- bridge_live_fixture()
    reference_rows <- bridge_fixture_reference_rows()
    reference_version <- "reference-live"
    DBI::dbWriteTable(connection, "territory_reference", reference_rows,
                      append = TRUE, row.names = FALSE)
    bridge_db_exec(connection, paste(
      "INSERT INTO table_publication(table_name,content_version,row_count,",
      "reference_content_version,published_at) VALUES",
      "('territory_reference',$1,$2,NULL,now())"),
      params = list(reference_version, nrow(reference_rows)))
    # Seed through the REGISTERED publisher, not a direct adapter call: the
    # publisher's transaction keeps descriptor, descriptor_source and observation
    # inserts in one commit, which the deferred FK/trigger constraints require.
    scalar_version <- scalar_content_version(live)
    scalar_adapter <- scalar_postgres_adapter(connection)
    seed_scalar_registry <- register_scalar_publisher(list(), "bridge_test_scalar",
      project = function(canonical) canonical,
      publish = function(projection, db, version) db$replace(projection, version))
    publish_registered_scalar(seed_scalar_registry, "bridge_test_scalar", live,
      scalar_adapter, retired_indicator_ids = retained_scalar_retirement_ids())
    comparison <- project_scalar_comparisons(
      live, reference_rows, input_scalar_content_version = scalar_version,
      reference_content_version = reference_version)
    publish_registered_scalar_comparison(comparison,
                                         scalar_comparison_postgres_adapter(connection))

    seeded_profiles <- bridge_live_profile_fixture(scalar_version)
    seed_base <- names(seeded_profiles)[[1L]]
    seed_registry <- register_profile_publisher(list(), "bridge_test_profiles",
      project = function(canonical) canonical,
      publish = function(projection, db, version) db$replace(projection, version))
    profile_seed <- publish_registered_profile(
      seed_registry, "bridge_test_profiles", seeded_profiles[[seed_base]],
      profile_postgres_adapter(connection),
      additional_projections = seeded_profiles[setdiff(names(seeded_profiles), seed_base)])
    profile_version <- profile_seed$content_version

    habitat_version <- "habitat-live"
    bridge_db_exec(connection, paste(
      "INSERT INTO table_publication(table_name,content_version,row_count,",
      "reference_content_version,published_at) VALUES",
      "('selected_reading',$1,1,$2,now())"),
      params = list(habitat_version, reference_version))
    bridge_db_exec(connection, paste(
      "INSERT INTO selected_reading_descriptor(theme_id,descriptor_version,",
      "source_id,vintage_id,linked_content_version) VALUES",
      "('habitat',$1,'fixture_source','fixture/2025',$2)"),
      params = list(habitat_version,
                    paste("canonical", profile_version, scalar_version,
                          reference_version, sep = "-")))
    bridge_db_exec(connection, paste(
      "INSERT INTO selected_reading_publication(theme_id,content_version,",
      "reference_content_version,row_count,published_at) VALUES",
      "('habitat',$1,$2,1,now())"), params = list(habitat_version, reference_version))

    expected <- c(scalar = scalar_version, comparison = comparison$content_version,
                  profile = profile_version, habitat = habitat_version,
                  reference = reference_version)
    facts_path <- tempfile("bridge-facts-", fileext = ".rds")
    on.exit(unlink(facts_path), add = TRUE)
    saveRDS(bridge_fresh_offre_tc_rows(), facts_path)
    env_values <- bridge_test_env_values(expected, facts_path,
      list(setNames("1", BRIDGE_PUBLISH_OPT_IN_ENV),
           setNames("operator-dump", BRIDGE_DUMP_ACK_ENV)))
    env <- bridge_fake_env(env_values)
    reader <- bridge_live_reader()
    read_markers <- function() retained_backend_markers(connection)
    retired_ids <- retained_scalar_retirement_ids()

    schema_digest <- function() {
      tables <- bridge_db_query(connection, paste(
        "SELECT table_name FROM information_schema.tables",
        "WHERE table_schema=$1 ORDER BY table_name"), params = list(schema))$table_name
      vapply(tables, function(table) {
        bridge_db_query(connection, paste0(
          "SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h ",
          "FROM ", quoted_schema, ".", as.character(DBI::dbQuoteIdentifier(connection, table)),
          " t"))$h[[1L]]
      }, character(1))
    }
    seeded_digest <- schema_digest()

    capture.output(plan <- run_offre_tc_bridge(
      "dry-run", env = env, con = connection, config = config,
      live_reader = reader, read_markers = read_markers, retired_ids = retired_ids))
    expect_identical(schema_digest(), seeded_digest)
    expect_identical(plan$mode, "dry-run")
    expect_true(is.data.frame(plan$fk_inventory))

    # (A) ROLLBACK against the OLD seeded state. The scalar/comparison/profile
    # publishers have real work to do (old -> new); the failure is injected only
    # at the final Habitat rebind. A vacuous no-op would produce a digest that
    # already equals the new state, so the control below rules that out.
    fail_before_rebind <- function(con, prepared, retired, tokens, ...) {
      publish_bridge_snapshot(con, prepared, retired, tokens, ...,
        writer = list(set_habitat_linked = function(new_linked)
          stop("injected failure before Habitat rebind", call. = FALSE)))
    }
    # The real-write gates (opt-in, dump ack, scope, expected tokens, facts file)
    # are set for THIS call only via withr; nothing leaks to other tests.
    withr::with_envvar(as.list(env_values), {
      capture.output(expect_error(run_offre_tc_bridge(
        "publish", env = env, con = connection, config = config,
        live_reader = reader, read_markers = read_markers, retired_ids = retired_ids,
        publish = fail_before_rebind), "injected failure before Habitat rebind"))
    })
    expect_identical(schema_digest(), seeded_digest,
                     info = "failed publication must restore the exact seeded state")

    # (A) CONTROL without injection: the same seeded state really changes when
    # the bridge succeeds, so the rollback assertion above cannot pass vacuously.
    withr::with_envvar(as.list(env_values), {
      capture.output(written <<- run_offre_tc_bridge(
        "publish", env = env, con = connection, config = config,
        live_reader = reader, read_markers = read_markers, retired_ids = retired_ids))
    })
    expect_false(identical(schema_digest(), seeded_digest),
                 info = "control publication must actually change the schema")
    expect_identical(written$scalar$content_version, plan$tokens$scalar)
    expect_identical(written$comparison$content_version, plan$tokens$comparison)
    expect_identical(written$profile$content_version, plan$profile_lineage$version)

    live_ids <- bridge_db_query(connection,
      "SELECT DISTINCT indicator_id FROM scalar_descriptor")$indicator_id
    expect_false(any(retired_ids %in% live_ids))
    fresh_values <- bridge_db_query(connection, paste(
      "SELECT value FROM scalar_observation WHERE indicator_id='offre_tc'",
      "ORDER BY territory_id"))$value
    expect_equal(sort(fresh_values), sort(c(0.9968, 0.9261)))
    expect_identical(bridge_db_query(connection, paste(
      "SELECT content_version FROM table_publication WHERE table_name='scalar_observation'"))$content_version[[1L]],
      plan$tokens$scalar)
    expect_identical(bridge_db_query(connection,
      "SELECT linked_content_version FROM selected_reading_descriptor")$linked_content_version[[1L]],
      plan$tokens$linked)
    expect_identical(bridge_db_query(connection, paste(
      "SELECT content_version FROM table_publication WHERE table_name='selected_reading'"))$content_version[[1L]],
      habitat_version)

    # Post-write hash identity: recompute every dependent token through the SAME
    # producer functions from the rows now in the DB.
    after_profile_rows <- bridge_read_live_profile_projections(
      connection, reader = reader, metadata = bridge_profile_contracts(),
      new_scalar = plan$tokens$scalar)
    after_lineage <- bridge_profile_lineage_tokens(
      after_profile_rows, reader$reference_rows(connection), reference_version)
    expect_identical(bridge_db_query(connection, paste(
      "SELECT descriptor_version FROM profile_descriptor WHERE indicator_id='distribution_dpe'"))$descriptor_version[[1L]],
      after_profile_rows$distribution_dpe$descriptor$descriptor_version)
    expect_identical(bridge_db_query(connection, paste(
      "SELECT content_version FROM table_publication WHERE table_name='declared_profile'"))$content_version[[1L]],
      after_lineage$version)
    expect_identical(bridge_db_query(connection,
      "SELECT profile_content_version FROM profile_comparison_publication")$profile_content_version[[1L]],
      after_lineage$version)
    expect_identical(bridge_db_query(connection,
      "SELECT content_version FROM profile_comparison_publication")$content_version[[1L]],
      after_lineage$comparison_version)
    expect_identical(bridge_db_query(connection, paste(
      "SELECT required_scalar_version FROM profile_descriptor WHERE indicator_id='distribution_dpe'"))$required_scalar_version[[1L]],
      plan$tokens$scalar)

    # Live-shaped addendum: after the control run the retired ids are gone but
    # offre_tc is present with the new values, exactly like the serving DB.
    after_markers <- retained_backend_markers(connection)
    marker_value <- function(name) bridge_db_query(connection,
      "SELECT content_version FROM table_publication WHERE table_name=$1",
      params = list(name))$content_version[[1L]]
    expected_live <- c(
      scalar = marker_value("scalar_observation"),
      comparison = after_markers$comparison$content_version[[1L]],
      profile = marker_value("declared_profile"),
      habitat = marker_value("selected_reading"),
      reference = marker_value("territory_reference"))
    live_facts_path <- tempfile("bridge-facts-live-", fileext = ".rds")
    on.exit(unlink(live_facts_path), add = TRUE)
    saveRDS(bridge_fresh_offre_tc_rows(c(0.55, 0.65)), live_facts_path)
    live_values <- bridge_test_env_values(expected_live, live_facts_path,
      list(setNames("1", BRIDGE_PUBLISH_OPT_IN_ENV),
           setNames("dump-live", BRIDGE_DUMP_ACK_ENV)))
    withr::with_envvar(as.list(live_values), {
      capture.output(live_plan <- run_offre_tc_bridge(
        "dry-run", env = bridge_fake_env(live_values), con = connection,
        config = config, live_reader = reader, read_markers = read_markers,
        retired_ids = retired_ids))
      capture.output(live_written <- run_offre_tc_bridge(
        "publish", env = bridge_fake_env(live_values), con = connection,
        config = config, live_reader = reader, read_markers = read_markers,
        retired_ids = retired_ids))
    })
    expect_length(live_plan$retired_present, 0L)
    expect_identical(live_written$scalar$content_version, live_plan$tokens$scalar)
    live_ids_now <- bridge_db_query(connection,
      "SELECT DISTINCT indicator_id FROM scalar_descriptor")$indicator_id
    expect_false(any(retired_ids %in% live_ids_now))
    live_values_now <- sort(bridge_db_query(connection, paste(
      "SELECT value FROM scalar_observation WHERE indicator_id='offre_tc'",
      "ORDER BY territory_id"))$value)
    expect_equal(live_values_now, c(0.55, 0.65))
    residual <- bridge_db_query(connection, paste(
      "SELECT nspname FROM pg_namespace WHERE nspname LIKE 'serving_it_%'",
      "ORDER BY nspname"))$nspname
    expect_setequal(residual, schema)
  })
}
