# Guarded disposable-database proof for the #1071 bridge.
# NEVER targets the serving database `lusk`. This whole file skips unless the
# operator has configured the guarded lusk_it_contract target, holds the shared
# named mutex for the process, and opted into schema cleanup. No connection is
# opened at load time. See api/tests/integration/README.md.

bridge_db_proof_configured <- function() {
  required <- c("LUSK_BRIDGE_TEST_DATABASE", "LUSK_BRIDGE_TEST_USER",
                "LUSK_BRIDGE_TEST_MUTEX_HELD", "LUSK_BRIDGE_TEST_CLEANUP",
                "PGPASSFILE")
  all(nzchar(Sys.getenv(required, unset = "")))
}

if (!bridge_db_proof_configured()) {
  test_that("the guarded bridge database proof is skipped by default", {
    skip("set LUSK_BRIDGE_TEST_* and PGPASSFILE to exercise the disposable DB")
  })
} else {
  test_that("the bridge writes rows and markers atomically on the disposable DB", {
    database <- Sys.getenv("LUSK_BRIDGE_TEST_DATABASE", unset = "")
    user <- Sys.getenv("LUSK_BRIDGE_TEST_USER", unset = "")
    host <- Sys.getenv("LUSK_BRIDGE_TEST_HOST", unset = "192.168.1.120")
    port <- as.integer(Sys.getenv("LUSK_BRIDGE_TEST_PORT", unset = "5432"))
    passfile <- normalizePath(Sys.getenv("PGPASSFILE"), winslash = "/", mustWork = TRUE)
    repository <- normalizePath("..", winslash = "/", mustWork = TRUE)
    expect_identical(database, "lusk_it_contract")
    expect_identical(user, "lusk_it_contract_pub")
    expect_identical(Sys.getenv("LUSK_BRIDGE_TEST_MUTEX_HELD"), "1")
    expect_identical(Sys.getenv("LUSK_BRIDGE_TEST_CLEANUP"), "1")
    expect_false(startsWith(tolower(passfile), paste0(tolower(repository), "/")))
    expect_true(requireNamespace("DBI", quietly = TRUE))
    expect_true(requireNamespace("RPostgres", quietly = TRUE))

    connection <- DBI::dbConnect(RPostgres::Postgres(), host = host, port = port,
                                 dbname = database, user = user, passfile = passfile)
    on.exit(DBI::dbDisconnect(connection), add = TRUE)
    identity <- DBI::dbGetQuery(connection, paste(
      "SELECT current_database() AS database, current_user AS role"))
    expect_identical(identity$database[[1L]], "lusk_it_contract")
    expect_identical(identity$role[[1L]], "lusk_it_contract_pub")

    schema <- paste0("serving_it_", Sys.getpid(), "_",
                     sprintf("%08x", sample.int(.Machine$integer.max, 1L)))
    quoted_schema <- as.character(DBI::dbQuoteIdentifier(connection, schema))
    created <- FALSE
    on.exit({
      if (created) {
        check <- DBI::dbGetQuery(connection, paste(
          "SELECT current_database() AS database, EXISTS (",
          "SELECT 1 FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner",
          "WHERE n.nspname=$1 AND r.rolname=current_user) AS owned"),
          params = list(schema))
        if (identical(check$database[[1L]], "lusk_it_contract") &&
            isTRUE(check$owned[[1L]]) && grepl("^serving_it_[A-Za-z0-9_]+$", schema))
          DBI::dbExecute(connection, paste0("DROP SCHEMA ", quoted_schema, " CASCADE"))
      }
    }, add = TRUE)

    DBI::dbExecute(connection, paste0("CREATE SCHEMA ", quoted_schema))
    created <- TRUE
    DBI::dbExecute(connection, paste0("SET search_path TO ", quoted_schema))
    ddl <- paste(readLines(file.path("..", "api", "schema.sql"), warn = FALSE),
                 collapse = "\n")
    for (statement in split_postgres_sql(ddl)) DBI::dbExecute(connection, statement)

    # Seed a coherent live serving snapshot from the fixture. All versions are
    # produced here, never copied from the issue text (no token literals).
    live <- bridge_live_fixture()
    reference_rows <- bridge_fixture_reference_rows()
    reference_version <- "reference-live"
    DBI::dbWriteTable(connection, "territory_reference", reference_rows,
                      append = TRUE, row.names = FALSE)
    DBI::dbExecute(connection, paste(
      "INSERT INTO table_publication(table_name,content_version,row_count,",
      "reference_content_version,published_at) VALUES",
      "('territory_reference',$1,$2,NULL,now())"),
      params = list(reference_version, nrow(reference_rows)))
    scalar_version <- scalar_content_version(live)
    scalar_adapter <- scalar_postgres_adapter(connection)
    scalar_adapter$replace(live, scalar_version,
                           retired_indicator_ids = retained_scalar_retirement_ids())
    comparison <- project_scalar_comparisons(
      live, reference_rows, input_scalar_content_version = scalar_version,
      reference_content_version = reference_version)
    publish_registered_scalar_comparison(comparison,
                                         scalar_comparison_postgres_adapter(connection))

    profile_version <- "profile-live"
    habitat_version <- "habitat-live"
    DBI::dbExecute(connection, paste(
      "INSERT INTO table_publication(table_name,content_version,row_count,",
      "reference_content_version,published_at) VALUES",
      "('declared_profile',$1,1,$2,now()), ('selected_reading',$1,1,$2,now())"),
      params = list(profile_version, reference_version))
    DBI::dbExecute(connection, paste(
      "INSERT INTO profile_descriptor(indicator_id,label,unit,allowed_levels,",
      "completeness,descriptor_version,comparison_direction,theme_id,",
      "comparison_scalar,required_scalar_version) VALUES",
      "('distribution_dpe','DPE','class',ARRAY['commune']::text[],",
      "'dense_complete','dpe-live','high','habitat',",
      "'part_passoires',$1)"), params = list(scalar_version))
    DBI::dbExecute(connection, paste(
      "INSERT INTO selected_reading_descriptor(theme_id,descriptor_version,",
      "source_id,vintage_id,linked_content_version) VALUES",
      "('habitat',$1,'fixture_source','fixture/2025',$2)"),
      params = list(habitat_version,
                    paste("canonical", profile_version, scalar_version,
                          reference_version, sep = "-")))
    DBI::dbExecute(connection, paste(
      "INSERT INTO selected_reading_publication(theme_id,content_version,",
      "reference_content_version,row_count,published_at) VALUES",
      "('habitat',$1,$2,1,now())"), params = list(habitat_version, reference_version))

    expected <- c(scalar = scalar_version, comparison = comparison$content_version,
                  profile = profile_version, habitat = habitat_version,
                  reference = reference_version)
    facts_path <- tempfile("bridge-facts-", fileext = ".rds")
    on.exit(unlink(facts_path), add = TRUE)
    saveRDS(bridge_fresh_offre_tc_rows(), facts_path)
    env_values <- c(setNames(unname(expected), unname(BRIDGE_EXPECTED_ENV)),
                    setNames(facts_path, BRIDGE_FACTS_ENV))
    env <- bridge_fake_env(env_values)
    reader <- bridge_live_reader()
    read_markers <- function() bridge_read_markers(connection)
    retired_ids <- retained_scalar_retirement_ids()

    schema_digest <- function() {
      tables <- DBI::dbGetQuery(connection, paste(
        "SELECT table_name FROM information_schema.tables",
        "WHERE table_schema=$1 ORDER BY table_name"), params = list(schema))$table_name
      vapply(tables, function(table) {
        DBI::dbGetQuery(connection, paste0(
          "SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h ",
          "FROM ", quoted_schema, ".", as.character(DBI::dbQuoteIdentifier(connection, table)),
          " t"))$h[[1L]]
      }, character(1))
    }
    before <- schema_digest()

    dry <- capture.output(plan <- run_offre_tc_bridge(
      "dry-run", env = env, con = connection, live_reader = reader,
      read_markers = read_markers, retired_ids = retired_ids))
    expect_identical(schema_digest(), before)
    expect_identical(plan$mode, "dry-run")

    env_write <- bridge_fake_env(c(env_values,
      setNames("operator-dump-2026-11-20", BRIDGE_DUMP_ACK_ENV)))
    write_result <- capture.output(written <- run_offre_tc_bridge(
      "publish", env = env_write, con = connection, live_reader = reader,
      read_markers = read_markers, retired_ids = retired_ids))
    expect_identical(written$scalar$content_version, plan$tokens$scalar)
    expect_identical(written$comparison$content_version, plan$tokens$comparison)

    live_ids <- DBI::dbGetQuery(connection,
      "SELECT DISTINCT indicator_id FROM scalar_descriptor")$indicator_id
    expect_false(any(retired_ids %in% live_ids))
    fresh_values <- DBI::dbGetQuery(connection, paste(
      "SELECT value FROM scalar_observation WHERE indicator_id='offre_tc'",
      "ORDER BY territory_id"))$value
    expect_equal(sort(fresh_values), sort(c(0.9968, 0.9261)))
    expect_identical(DBI::dbGetQuery(connection, paste(
      "SELECT content_version FROM table_publication WHERE table_name='scalar_observation'"))$content_version[[1L]],
      plan$tokens$scalar)
    expect_identical(DBI::dbGetQuery(connection,
      "SELECT required_scalar_version FROM profile_descriptor")$required_scalar_version[[1L]],
      plan$tokens$scalar)
    expect_identical(DBI::dbGetQuery(connection,
      "SELECT linked_content_version FROM selected_reading_descriptor")$linked_content_version[[1L]],
      plan$tokens$linked)
    # Unrelated owner markers are untouched.
    expect_identical(DBI::dbGetQuery(connection, paste(
      "SELECT content_version FROM table_publication WHERE table_name='declared_profile'"))$content_version[[1L]],
      profile_version)
    expect_identical(DBI::dbGetQuery(connection, paste(
      "SELECT content_version FROM table_publication WHERE table_name='selected_reading'"))$content_version[[1L]],
      habitat_version)

    residual <- DBI::dbGetQuery(connection, paste(
      "SELECT nspname FROM pg_namespace WHERE nspname LIKE 'serving_it_%'",
      "ORDER BY nspname"))$nspname
    expect_setequal(residual, schema)
  })
}
