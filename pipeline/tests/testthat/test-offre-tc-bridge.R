# Guarded #1071 offre_tc serving bridge. Pure tests: no database connection.
# The write path is exercised only against the disposable lusk_it_* test DB
# (see test-offre-tc-bridge-db.R); this file never opens a connection.

test_that("the bridge removes the 29 retired ids and replaces the offre_tc facts", {
  live <- bridge_live_fixture()
  built <- build_bridge_scalar_projection(
    live, bridge_fresh_offre_tc_rows(), bridge_fixture_metadata(),
    retained_scalar_retirement_ids())

  projection <- built$projection
  ids <- unique(projection$facts$indicator_id)
  expect_false("tot_loss_t" %in% ids)
  expect_false(any(retained_scalar_retirement_ids() %in% ids))
  expect_true("offre_tc" %in% ids)
  expect_setequal(setdiff(unique(live$facts$indicator_id),
                          retained_scalar_retirement_ids()), ids)
  # The old building-based values are gone, the new address-based ones are in.
  expect_equal(sort(projection$facts$value[projection$facts$indicator_id == "offre_tc"]),
               sort(c(0.9968, 0.9261)))
  expect_identical(sort(unique(projection$provenance$source_id[
    projection$provenance$indicator_id == "offre_tc"])), "korrigo")
  validate_scalar_artifact_projection(projection)
})

test_that("the bridge preserves the published offre_tc descriptor verbatim", {
  live <- bridge_live_fixture()
  built <- build_bridge_scalar_projection(
    live, bridge_fresh_offre_tc_rows(), bridge_fixture_metadata(),
    retained_scalar_retirement_ids())
  live_descriptor <- live$descriptors[live$descriptors$indicator_id == "offre_tc", , drop = FALSE]
  new_descriptor <- built$projection$descriptors[
    built$projection$descriptors$indicator_id == "offre_tc", , drop = FALSE]
  rownames(live_descriptor) <- rownames(new_descriptor) <- NULL
  expect_identical(new_descriptor, live_descriptor)
})

test_that("the round-trip proof accepts a bridge that changes only the affected indicators", {
  live <- bridge_live_fixture()
  built <- build_bridge_scalar_projection(
    live, bridge_fresh_offre_tc_rows(), bridge_fixture_metadata(),
    retained_scalar_retirement_ids())
  diff <- assert_bridge_round_trip(live, built$projection, built$affected)

  preserved <- diff[diff$status == "preserved", , drop = FALSE]
  expect_setequal(preserved$indicator_id,
                  c("kept_scalar", "other_kept", "part_passoires"))
  expect_true(all(preserved$facts_identical))
  expect_true(all(preserved$descriptors_identical))
  expect_true(all(preserved$provenance_identical))
  expect_setequal(diff$status[diff$indicator_id == "offre_tc"], "affected")
  expect_setequal(diff$status[diff$indicator_id == "tot_loss_t"], "affected")
})

test_that("the round-trip proof refuses any change to an unrelated indicator", {
  live <- bridge_live_fixture()
  built <- build_bridge_scalar_projection(
    live, bridge_fresh_offre_tc_rows(), bridge_fixture_metadata(),
    retained_scalar_retirement_ids())
  tampered <- built$projection
  row <- tampered$facts$indicator_id == "kept_scalar" & tampered$facts$territory_id == "29001"
  tampered$facts$value[row] <- 999

  expect_error(assert_bridge_round_trip(live, tampered, built$affected),
               "round-trip proof failed.*kept_scalar")
})

test_that("the round-trip proof refuses an unexpected new indicator", {
  live <- bridge_live_fixture()
  built <- build_bridge_scalar_projection(
    live, bridge_fresh_offre_tc_rows(), bridge_fixture_metadata(),
    retained_scalar_retirement_ids())
  tampered <- built$projection
  tampered$facts <- rbind(tampered$facts, data.frame(
    indicator_id = "unexpected", territory_id = "29001", territory_type = "commune",
    value = 1, status = "measured", support_count = NA_integer_,
    denominator_count = NA_integer_, stringsAsFactors = FALSE))
  expect_error(assert_bridge_round_trip(live, tampered, built$affected),
               "unexpected indicator")
})

test_that("the builder refuses a stale or semantically different offre_tc descriptor", {
  live <- bridge_live_fixture()
  stale <- live
  row <- stale$descriptors$indicator_id == "offre_tc"
  stale$descriptors$unit[row] <- "buildings"
  expect_error(build_bridge_scalar_projection(
    stale, bridge_fresh_offre_tc_rows(), bridge_fixture_metadata(),
    retained_scalar_retirement_ids()), "offre_tc descriptor.*current metadata")
})

test_that("the builder refuses malformed retirement policies and fresh rows", {
  live <- bridge_live_fixture()
  expect_error(build_bridge_scalar_projection(
    live, bridge_fresh_offre_tc_rows(), bridge_fixture_metadata(), character()),
    "retirement")
  expect_error(build_bridge_scalar_projection(
    live, bridge_fresh_offre_tc_rows(), bridge_fixture_metadata(),
    c(retained_scalar_retirement_ids(), "offre_tc")), "retirement")
  bad_rows <- bridge_fresh_offre_tc_rows()
  bad_rows$unit <- "buildings"
  expect_error(build_bridge_scalar_projection(
    live, bad_rows, bridge_fixture_metadata(), retained_scalar_retirement_ids()),
    "unit")
})

# --- Slice 2: read-only live loader and marker guard --------------------------

test_that("Postgres text arrays and pre-split level vectors both decode", {
  expect_identical(bridge_parse_text_array("{commune,epci}"), c("commune", "epci"))
  expect_identical(bridge_parse_text_array(c("commune", "epci")), c("commune", "epci"))
  expect_identical(bridge_parse_text_array("{}"), character())
})

test_that("the live loader reconstructs a projection from serving-shaped rows", {
  live <- bridge_live_fixture()
  reader <- bridge_fake_reader(bridge_db_rows_from_projection(live))
  loaded <- read_live_scalar_projection(NULL, reader = reader)
  validate_scalar_artifact_projection(loaded)

  for (field in names(live)) {
    left <- live[[field]]
    right <- loaded[[field]]
    if (field == "descriptors") {
      # allowed_sources/allowed_levels are list columns: compare as character
      left$allowed_sources <- lapply(left$allowed_sources, as.character)
      right$allowed_sources <- lapply(right$allowed_sources, as.character)
      left$allowed_levels <- lapply(left$allowed_levels, as.character)
      right$allowed_levels <- lapply(right$allowed_levels, as.character)
    }
    keys <- switch(field,
      facts = c("indicator_id", "territory_id"),
      descriptors = "indicator_id",
      provenance = c("indicator_id", "territory_id", "source_id", "vintage_id"),
      datasets = "source_id",
      vintages = c("source_id", "vintage_id"),
      eligible_territories = c("territory_type", "territory_id"))
    left <- left[do.call(order, c(left[keys], list(na.last = TRUE, method = "radix"))), , drop = FALSE]
    right <- right[do.call(order, c(right[keys], list(na.last = TRUE, method = "radix"))), , drop = FALSE]
    rownames(left) <- rownames(right) <- NULL
    expect_identical(right, left, info = field)
  }
})

test_that("the marker guard accepts exactly the operator-supplied tokens", {
  expected <- bridge_fixture_expected_tokens()
  expect_equal(nrow(assert_bridge_markers(bridge_fixture_markers(expected), expected)), 0L)
})

test_that("the marker guard refuses any moved token with a named report", {
  expected <- bridge_fixture_expected_tokens()
  for (token in names(expected)) {
    moved <- expected
    moved[[token]] <- "moved-token"
    markers <- bridge_fixture_markers(expected)
    err <- expect_error(assert_bridge_markers(markers, moved), "REFUSED with zero writes")
    expect_match(conditionMessage(err), token, fixed = TRUE, info = token)
  }
})

test_that("the marker guard also checks chained input fields", {
  expected <- bridge_fixture_expected_tokens()
  markers <- bridge_fixture_markers(expected)
  markers$comparison$scalar_content_version <- "stale"
  expect_error(assert_bridge_markers(markers, expected), "scalar_content_version")

  markers <- bridge_fixture_markers(expected)
  markers$profile_descriptor$required_scalar_version <- "stale"
  expect_error(assert_bridge_markers(markers, expected), "required_scalar_version")

  markers <- bridge_fixture_markers(expected)
  markers$selected_descriptor$descriptor_version <- "stale"
  expect_error(assert_bridge_markers(markers, expected), "descriptor_version")
})

test_that("expected tokens and the dump acknowledgement come only from the environment", {
  expected <- bridge_fixture_expected_tokens()
  env <- bridge_fake_env(setNames(unname(expected), unname(BRIDGE_EXPECTED_ENV)))
  expect_identical(bridge_expected_tokens_from_env(env), expected)

  partial <- bridge_fake_env(setNames(unname(expected)[-2L], unname(BRIDGE_EXPECTED_ENV)[-2L]))
  expect_error(bridge_expected_tokens_from_env(partial), "missing publication token")

  expect_error(assert_bridge_dump_confirmed(bridge_fake_env(list())), "verified dump")
  ack <- assert_bridge_dump_confirmed(bridge_fake_env(setNames("dump-2026-11-20", BRIDGE_DUMP_ACK_ENV)))
  expect_identical(ack, "dump-2026-11-20")
})


# --- Slice 3: token chaining, one-transaction write and dry-run ---------------

test_that("the Habitat linked token is re-chained from the live tokens", {
  live <- c(profile = "profile-live", scalar = "scalar-live", reference = "reference-live")
  new <- c(profile = "profile-live", scalar = "scalar-new", reference = "reference-live")
  live_linked <- paste(c("canonical", unname(live)), collapse = "-")
  expect_identical(bridge_rebind_linked_version(live_linked, live, new),
                   paste(c("canonical", unname(new)), collapse = "-"))
  expect_error(bridge_rebind_linked_version("not-chained", live, new),
               "not chained")
})

test_that("new tokens chain scalar -> comparison -> Habitat link", {
  live <- bridge_live_fixture()
  built <- build_bridge_scalar_projection(
    live, bridge_fresh_offre_tc_rows(), bridge_fixture_metadata(),
    retained_scalar_retirement_ids())
  expected <- bridge_fixture_expected_tokens()
  tokens <- bridge_compute_new_tokens(
    built$projection, bridge_fixture_reference_rows(), expected[["reference"]],
    markers = bridge_fixture_markers(expected), expected = expected)

  scalar_version <- scalar_content_version(built$projection)
  comparison <- project_scalar_comparisons(
    built$projection, bridge_fixture_reference_rows(),
    input_scalar_content_version = scalar_version,
    reference_content_version = expected[["reference"]])
  expect_identical(tokens$scalar, scalar_version)
  expect_identical(tokens$comparison, comparison$content_version)
  expect_identical(tokens$comparison_projection$content_version, comparison$content_version)
  expect_match(tokens$linked, paste0("-", expected[["profile"]], "-", scalar_version,
                                     "-", expected[["reference"]], "$"))
})

test_that("the write composes the registered publishers inside ONE transaction", {
  live <- bridge_live_fixture()
  built <- build_bridge_scalar_projection(
    live, bridge_fresh_offre_tc_rows(), bridge_fixture_metadata(),
    retained_scalar_retirement_ids())
  expected <- bridge_fixture_expected_tokens()
  tokens <- bridge_compute_new_tokens(
    built$projection, bridge_fixture_reference_rows(), expected[["reference"]],
    markers = bridge_fixture_markers(expected), expected = expected)
  plan <- list(projection = built$projection, tokens = tokens,
               markers = bridge_fixture_markers(expected), expected = expected)

  scalar_db <- bridge_fake_scalar_adapter("scalar-live")
  comparison_db <- bridge_fake_comparison_adapter("comparison-live", tokens$scalar)
  writer <- bridge_fake_marker_writer(expected[["scalar"]])
  transactions <- 0L
  write <- publish_bridge_snapshot(
    NULL, plan, retained_scalar_retirement_ids(), expected,
    transaction = function(con, expr) { transactions <<- transactions + 1L; force(expr) },
    scalar_adapter = scalar_db, comparison_adapter = comparison_db,
    writer = writer)

  expect_identical(transactions, 1L)
  expect_identical(write$scalar$content_version, tokens$scalar)
  expect_identical(write$comparison$content_version, tokens$comparison)
  expect_identical(scalar_db$state$retired, retained_scalar_retirement_ids())
  expect_identical(comparison_db$state$replaced, tokens$comparison)
  expect_identical(writer$state$linked_new, tokens$linked)
})

test_that("the write rolls back as one unit when an adapter fails", {
  live <- bridge_live_fixture()
  built <- build_bridge_scalar_projection(
    live, bridge_fresh_offre_tc_rows(), bridge_fixture_metadata(),
    retained_scalar_retirement_ids())
  expected <- bridge_fixture_expected_tokens()
  tokens <- bridge_compute_new_tokens(
    built$projection, bridge_fixture_reference_rows(), expected[["reference"]],
    markers = bridge_fixture_markers(expected), expected = expected)
  plan <- list(projection = built$projection, tokens = tokens,
               markers = bridge_fixture_markers(expected), expected = expected)

  comparison_db <- bridge_fake_comparison_adapter("comparison-live", tokens$scalar)
  comparison_db$replace <- function(projection) stop("injected comparison failure")
  expect_error(publish_bridge_snapshot(
    NULL, plan, retained_scalar_retirement_ids(), expected,
    transaction = function(con, expr) force(expr),
    scalar_adapter = bridge_fake_scalar_adapter("scalar-live"),
    comparison_adapter = comparison_db,
    writer = bridge_fake_marker_writer(expected[["scalar"]])), "injected comparison failure")
})

test_that("the dry-run prints tokens and the diff and never calls the writer", {
  expected <- bridge_fixture_expected_tokens()
  facts_path <- tempfile("bridge-facts-", fileext = ".rds")
  on.exit(unlink(facts_path), add = TRUE)
  saveRDS(bridge_fresh_offre_tc_rows(), facts_path)
  env <- bridge_fake_env(bridge_test_env_values(expected, facts_path))

  live <- bridge_live_fixture()
  reader <- bridge_fake_reader(bridge_db_rows_from_projection(live))
  write_calls <- 0L
  output <- capture.output(result <- run_offre_tc_bridge(
    "dry-run", env = env, con = structure(list(), class = "fake-con"),
    config = bridge_pure_config(), identity_reader = bridge_pure_identity,
    live_reader = reader, read_markers = function() bridge_fixture_markers(expected),
    retired_ids = retained_scalar_retirement_ids(),
    publish = function(...) { write_calls <<- write_calls + 1L }))

  expect_identical(write_calls, 0L)
  expect_match(paste(output, collapse = "\n"), "new scalar token", fixed = TRUE)
  expect_match(paste(output, collapse = "\n"), "new comparison token", fixed = TRUE)
  expect_match(paste(output, collapse = "\n"), "offre_tc")
  expect_identical(result$mode, "dry-run")
  expect_true("tot_loss_t" %in% result$diff$indicator_id)
})

test_that("a moved live marker refuses before any write is attempted", {
  expected <- bridge_fixture_expected_tokens()
  moved <- expected
  moved[["scalar"]] <- "someone-else"
  env <- bridge_fake_env(bridge_test_env_values(moved))
  reader <- bridge_fake_reader(bridge_db_rows_from_projection(bridge_live_fixture()))
  write_calls <- 0L
  expect_error(run_offre_tc_bridge(
    "publish", env = env, con = structure(list(), class = "fake-con"),
    config = bridge_pure_config(), identity_reader = bridge_pure_identity,
    live_reader = reader, read_markers = function() bridge_fixture_markers(expected),
    retired_ids = retained_scalar_retirement_ids(),
    publish = function(...) { write_calls <<- write_calls + 1L }), "marker mismatch")
  expect_identical(write_calls, 0L)
})

test_that("a missing dump acknowledgement refuses before any write is attempted", {
  expected <- bridge_fixture_expected_tokens()
  facts_path <- tempfile("bridge-facts-", fileext = ".rds")
  on.exit(unlink(facts_path), add = TRUE)
  saveRDS(bridge_fresh_offre_tc_rows(), facts_path)
  env <- bridge_fake_env(bridge_test_env_values(
    expected, facts_path, setNames("1", BRIDGE_PUBLISH_OPT_IN_ENV)))
  reader <- bridge_fake_reader(bridge_db_rows_from_projection(bridge_live_fixture()))
  write_calls <- 0L
  capture.output(expect_error(run_offre_tc_bridge(
    "publish", env = env, con = structure(list(), class = "fake-con"),
    config = bridge_pure_config(), identity_reader = bridge_pure_identity,
    live_reader = reader, read_markers = function() bridge_fixture_markers(expected),
    retired_ids = retained_scalar_retirement_ids(),
    publish = function(...) { write_calls <<- write_calls + 1L }), "verified dump"))
  expect_identical(write_calls, 0L)
})

test_that("the bridge refuses to run without the LUSK_PUBLISH_* configuration", {
  bridge_pure_env_clear()
  expected <- bridge_fixture_expected_tokens()
  env <- bridge_fake_env(bridge_test_env_values(expected))
  expect_error(run_offre_tc_bridge("dry-run", env = env,
    connect = bridge_pure_connect), "Publication SQL")
})


test_that("the CLI registers both bridge commands without changing --publish", {
  script <- readLines(system.file("..", "scripts", "publish-serving-tables.R",
                                  package = "lusk"))
  source_text <- paste(script, collapse = "\n")
  expect_match(source_text, '"--offre-tc-bridge"', fixed = TRUE)
  expect_match(source_text, '"--offre-tc-bridge-dry-run"', fixed = TRUE)
  expect_match(source_text, "run_offre_tc_bridge(mode)", fixed = TRUE)
  expect_match(source_text, "publish_retained_backend_from_parquet(", fixed = TRUE)
  # The single-command arg contract is unchanged.
  expect_match(source_text, "length(args) != 1L", fixed = TRUE)
})


# --- Review fixes: fail-closed markers and explicit write opt-in --------------

test_that("absent or duplicated descriptor markers refuse with zero writes", {
  expected <- bridge_fixture_expected_tokens()
  for (field in c("profile_descriptor", "selected_descriptor")) {
    missing <- bridge_fixture_markers(expected)
    missing[[field]] <- missing[[field]][0L, , drop = FALSE]
    expect_error(assert_bridge_markers(missing, expected), "exactly one marker",
                 info = paste("missing", field))

    duplicated <- bridge_fixture_markers(expected)
    duplicated[[field]] <- rbind(duplicated[[field]], duplicated[[field]])
    expect_error(assert_bridge_markers(duplicated, expected), "exactly one marker",
                 info = paste("duplicated", field))
  }
})

test_that("a real write requires the explicit LUSK_PUBLISH_OFFRE_TC_BRIDGE opt-in", {
  expected <- bridge_fixture_expected_tokens()
  facts_path <- tempfile("bridge-facts-", fileext = ".rds")
  on.exit(unlink(facts_path), add = TRUE)
  saveRDS(bridge_fresh_offre_tc_rows(), facts_path)
  base <- bridge_test_env_values(
    expected, facts_path, setNames("dump-ack", BRIDGE_DUMP_ACK_ENV))
  env <- bridge_fake_env(base)
  reader <- bridge_fake_reader(bridge_db_rows_from_projection(bridge_live_fixture()))
  write_calls <- 0L
  run_write <- function(e) capture.output(suppressWarnings(run_offre_tc_bridge(
    "publish", env = e, con = structure(list(), class = "fake-con"),
    config = bridge_pure_config(), identity_reader = bridge_pure_identity,
    live_reader = reader, read_markers = function() bridge_fixture_markers(expected),
    retired_ids = retained_scalar_retirement_ids(),
    publish = function(...) { write_calls <<- write_calls + 1L; list(ok = TRUE) })))

  expect_error(run_write(env), "LUSK_PUBLISH_OFFRE_TC_BRIDGE=1", fixed = TRUE)
  expect_error(run_write(bridge_fake_env(c(base,
    setNames("0", BRIDGE_PUBLISH_OPT_IN_ENV)))), "LUSK_PUBLISH_OFFRE_TC_BRIDGE=1", fixed = TRUE)
  expect_identical(write_calls, 0L)
  run_write(bridge_fake_env(c(base, setNames("1", BRIDGE_PUBLISH_OPT_IN_ENV))))
  expect_identical(write_calls, 1L)
})


# --- Review fix: profile hash lineage from live-read projections --------------

test_that("the DPE descriptor version is recomputed with the producer hash function", {
  expected <- bridge_fixture_expected_tokens()
  profiles <- bridge_live_profile_fixture(expected[["scalar"]])
  dpe <- profiles$distribution_dpe
  new_scalar <- "scalar-new"
  descriptor <- dpe$descriptor
  descriptor$required_scalar_version <- new_scalar
  contract <- lire_theme_metadata("habitat")$profile_contracts$distribution_dpe
  want <- profile_content_version(list(within(descriptor, rm(descriptor_version)),
                                       dpe$axes, contract))
  got <- bridge_recompute_profile_descriptor_version(
    "distribution_dpe", descriptor, dpe$axes, lire_theme_metadata("habitat"))
  expect_identical(got, want)
  expect_false(identical(got, dpe$descriptor$descriptor_version))
})

test_that("the live profile loader rebinds only the scalar token and descriptor hash", {
  expected <- bridge_fixture_expected_tokens()
  profiles <- bridge_live_profile_fixture(expected[["scalar"]])
  rows <- bridge_db_rows_from_profile_projections(profiles)
  reader <- bridge_fake_reader(bridge_db_rows_from_projection(bridge_live_fixture()),
                               profile_rows = rows)
  loaded <- bridge_read_live_profile_projections(
    NULL, reader = reader, metadata = lire_theme_metadata("habitat"),
    new_scalar = "scalar-new")
  expect_setequal(names(loaded), c("distribution_dpe", "structure_age"))
  for (owner in names(profiles)) {
    expect_identical(loaded[[owner]]$facts, profiles[[owner]]$facts)
    expect_identical(loaded[[owner]]$axes, profiles[[owner]]$axes)
    expect_identical(loaded[[owner]]$provenance, profiles[[owner]]$provenance)
  }
  dpe <- loaded$distribution_dpe
  expect_identical(dpe$descriptor$required_scalar_version, "scalar-new")
  contract <- lire_theme_metadata("habitat")$profile_contracts$distribution_dpe
  d <- dpe$descriptor; d$descriptor_version <- NULL
  expect_identical(dpe$descriptor$descriptor_version,
                   profile_content_version(list(d, dpe$axes, contract)))
  # The non-scalar-bound owner keeps its live descriptor hash.
  expect_identical(loaded$structure_age$descriptor$descriptor_version,
                   profiles$structure_age$descriptor$descriptor_version)
  expect_null(loaded$structure_age$descriptor$required_scalar_version)
})

test_that("profile marker and comparison tokens equal a fresh producer recompute", {
  expected <- bridge_fixture_expected_tokens()
  profiles <- bridge_live_profile_fixture(expected[["scalar"]])
  rebound <- bridge_rebind_profile_lineage(
    profiles, lire_theme_metadata("habitat"), "scalar-new")
  tokens <- bridge_profile_lineage_tokens(
    rebound, bridge_fixture_reference_rows(), expected[["reference"]])

  base <- names(rebound)[[1L]]
  assembled <- c(list(rebound[[base]]), rebound[setdiff(names(rebound), base)])
  ids <- vapply(assembled, function(p) p$descriptor$indicator_id, character(1))
  assembled <- assembled[order(ids)]
  want_version <- profile_content_version(list(profiles = assembled))
  want_comparison <- project_declared_profile_comparisons(
    assembled, bridge_fixture_reference_rows(), want_version, expected[["reference"]])
  expect_identical(tokens$version, want_version)
  expect_identical(tokens$comparison_version, profile_content_version(want_comparison))
  expect_false(identical(tokens$version, expected[["profile"]]))
})

test_that("the registered profile publisher writes the recomputed lineage in the same transaction", {
  expected <- bridge_fixture_expected_tokens()
  live <- bridge_live_fixture()
  built <- build_bridge_scalar_projection(
    live, bridge_fresh_offre_tc_rows(), bridge_fixture_metadata(),
    retained_scalar_retirement_ids())
  tokens <- bridge_compute_new_tokens(
    built$projection, bridge_fixture_reference_rows(), expected[["reference"]],
    markers = bridge_fixture_markers(expected), expected = expected)
  profiles <- bridge_rebind_profile_lineage(
    bridge_live_profile_fixture(expected[["scalar"]]),
    lire_theme_metadata("habitat"), tokens$scalar)
  lineage <- bridge_profile_lineage_tokens(
    profiles, bridge_fixture_reference_rows(), expected[["reference"]])
  plan <- list(projection = built$projection, tokens = tokens,
               markers = bridge_fixture_markers(expected), expected = expected,
               profiles = profiles, profile_lineage = lineage)
  profile_db <- bridge_fake_profile_adapter(expected[["profile"]], tokens$scalar)
  calls <- 0L
  write <- publish_bridge_snapshot(
    NULL, plan, retained_scalar_retirement_ids(), expected,
    transaction = function(con, expr) { calls <<- calls + 1L; force(expr) },
    scalar_adapter = bridge_fake_scalar_adapter(expected[["scalar"]]),
    comparison_adapter = bridge_fake_comparison_adapter(expected[["comparison"]], tokens$scalar),
    writer = bridge_fake_marker_writer(expected[["scalar"]]),
    profile_adapter = profile_db)
  expect_identical(calls, 1L)
  expect_identical(profile_db$state$replaced, lineage$version)
  expect_identical(profile_db$state$comparisons, lineage$version)
  expect_identical(write$profile$content_version, lineage$version)
})


# --- Review fix 2: fail-closed writes and race-safe marker re-check ----------

test_that("the real marker writer refuses zero- or multi-row updates", {
  for (affected in c(0L, 2L)) {
    called <- FALSE
    writer <- bridge_marker_writer(NULL, "old-linked",
      execute = function(sql, params) { called <<- TRUE; affected })
    expect_error(writer$set_habitat_linked("new-linked"), "expected exactly one",
                 info = paste("affected", affected))
    expect_true(called)
  }
  ok <- bridge_marker_writer(NULL, "old-linked",
    execute = function(sql, params) 1L)
  expect_true(ok$set_habitat_linked("new-linked"))
})

test_that("a marker that moves inside the write transaction aborts everything", {
  expected <- bridge_fixture_expected_tokens()
  live <- bridge_live_fixture()
  built <- build_bridge_scalar_projection(
    live, bridge_fresh_offre_tc_rows(), bridge_fixture_metadata(),
    retained_scalar_retirement_ids())
  tokens <- bridge_compute_new_tokens(
    built$projection, bridge_fixture_reference_rows(), expected[["reference"]],
    markers = bridge_fixture_markers(expected), expected = expected)
  plan <- list(projection = built$projection, tokens = tokens,
               markers = bridge_fixture_markers(expected), expected = expected,
               affected = built$affected, live = live)
  moved <- expected
  moved[["scalar"]] <- "someone-else"
  writer <- bridge_fake_marker_writer(expected[["scalar"]])
  scalar_db <- bridge_fake_scalar_adapter(expected[["scalar"]])
  expect_error(publish_bridge_snapshot(
    NULL, plan, retained_scalar_retirement_ids(), expected,
    transaction = function(con, expr) force(expr),
    scalar_adapter = scalar_db,
    comparison_adapter = bridge_fake_comparison_adapter(expected[["comparison"]], tokens$scalar),
    writer = writer,
    read_markers = function() bridge_fixture_markers(moved)), "marker mismatch")
  expect_null(writer$state$linked_new)
  expect_null(scalar_db$state$replaced)
})

test_that("the write path takes the scalar advisory lock before any SQL", {
  expected <- bridge_fixture_expected_tokens()
  live <- bridge_live_fixture()
  built <- build_bridge_scalar_projection(
    live, bridge_fresh_offre_tc_rows(), bridge_fixture_metadata(),
    retained_scalar_retirement_ids())
  tokens <- bridge_compute_new_tokens(
    built$projection, bridge_fixture_reference_rows(), expected[["reference"]],
    markers = bridge_fixture_markers(expected), expected = expected)
  plan <- list(projection = built$projection, tokens = tokens,
               markers = bridge_fixture_markers(expected), expected = expected,
               affected = built$affected, live = live)
  lock_calls <- 0L
  adapter <- bridge_fake_scalar_adapter(expected[["scalar"]])
  adapter$lock <- function(owner) { lock_calls <<- lock_calls + 1L; invisible(NULL) }
  publish_bridge_snapshot(
    NULL, plan, retained_scalar_retirement_ids(), expected,
    transaction = function(con, expr) force(expr),
    scalar_adapter = adapter,
    comparison_adapter = bridge_fake_comparison_adapter(expected[["comparison"]], tokens$scalar),
    writer = bridge_fake_marker_writer(expected[["scalar"]]))
  # Re-entrant in-session: the bridge and the normal scalar publisher both take
  # the same xact lock; at least one call must precede any write.
  expect_gte(lock_calls, 1L)
})


# --- Round-2 review: scope/identity gates and pure-test isolation -------------

test_that("a scope selection other than the registered offre_tc scope refuses", {
  bridge_pure_env_clear()
  expected <- bridge_fixture_expected_tokens()
  values <- bridge_test_env_values(expected)
  values[["LUSK_SCALAR_SCOPE"]] <- "mobilite:stations_service"
  env <- bridge_fake_env(values)
  write_calls <- 0L
  expect_error(run_offre_tc_bridge(
    "dry-run", env = env, con = structure(list(), class = "fake-con"),
    config = bridge_pure_config(), identity_reader = bridge_pure_identity,
    live_reader = bridge_fake_reader(bridge_db_rows_from_projection(bridge_live_fixture())),
    read_markers = function() bridge_fixture_markers(expected),
    retired_ids = retained_scalar_retirement_ids(),
    publish = function(...) { write_calls <<- write_calls + 1L }), "LUSK_SCALAR_SCOPE")
  expect_identical(write_calls, 0L)
})

test_that("a missing or malformed scope selection refuses", {
  bridge_pure_env_clear()
  expected <- bridge_fixture_expected_tokens()
  for (selection in c("", "mobilite", "nope:offre_tc")) {
    values <- bridge_test_env_values(expected)
    values[["LUSK_SCALAR_SCOPE"]] <- selection
    expect_error(run_offre_tc_bridge(
      "dry-run", env = bridge_fake_env(values),
      con = structure(list(), class = "fake-con"), config = bridge_pure_config(),
      identity_reader = bridge_pure_identity,
      live_reader = bridge_fake_reader(bridge_db_rows_from_projection(bridge_live_fixture())),
      read_markers = function() bridge_fixture_markers(expected),
      retired_ids = retained_scalar_retirement_ids(),
      publish = function(...) NULL), "LUSK_SCALAR_SCOPE", info = selection)
  }
})

test_that("the connection must be the configured database and role", {
  bridge_pure_env_clear()
  expected <- bridge_fixture_expected_tokens()
  values <- bridge_test_env_values(expected)
  for (bad in list(
    data.frame(database = "lusk", role = "lusk_it_contract_pub", stringsAsFactors = FALSE),
    data.frame(database = "lusk_it_contract", role = "lusk_publisher", stringsAsFactors = FALSE))) {
    expect_error(run_offre_tc_bridge(
      "dry-run", env = bridge_fake_env(values),
      con = structure(list(), class = "fake-con"), config = bridge_pure_config(),
      identity_reader = function(con) bad,
      live_reader = bridge_fake_reader(bridge_db_rows_from_projection(bridge_live_fixture())),
      read_markers = function() bridge_fixture_markers(expected),
      retired_ids = retained_scalar_retirement_ids(),
      publish = function(...) NULL), "connection identity")
  }
})

test_that("pure tests never reach DBI::dbConnect even with operator env present", {
  bridge_pure_env_clear()
  withr::local_envvar(c(LUSK_PUBLISH_HOST = "serving-host",
                        LUSK_PUBLISH_DATABASE = "lusk",
                        LUSK_PUBLISH_USER = "lusk_publisher",
                        PGPASSFILE = "C:/secret/pgpass.conf"))
  expected <- bridge_fixture_expected_tokens()
  facts_path <- tempfile("bridge-facts-", fileext = ".rds")
  on.exit(unlink(facts_path), add = TRUE)
  saveRDS(bridge_fresh_offre_tc_rows(), facts_path)
  values <- bridge_test_env_values(expected, facts_path)
  connected <- 0L
  result <- run_offre_tc_bridge(
    "dry-run", env = bridge_fake_env(values),
    config = bridge_pure_config(),
    connect = function(cfg) { connected <<- connected + 1L
                              structure(list(), class = "fake-con") },
    identity_reader = bridge_pure_identity,
    live_reader = bridge_fake_reader(bridge_db_rows_from_projection(bridge_live_fixture())),
    read_markers = function() bridge_fixture_markers(expected),
    retired_ids = retained_scalar_retirement_ids(),
    publish = function(...) stop("no write in dry-run"))
  expect_identical(connected, 1L)
  expect_identical(result$mode, "dry-run")
  expect_error(bridge_pure_connect(bridge_pure_config()), "must never be called")
})

# --- Round-2 review: profile fact round-trip guards ---------------------------

test_that("the live profile reader keeps deterministic serving row columns", {
  profiles <- bridge_live_profile_fixture(bridge_fixture_expected_tokens()[["scalar"]])
  rows <- bridge_db_rows_from_profile_projections(profiles)
  expect_true(all(c("detail_axis_name", "sex_axis_name") %in% names(rows$profile_facts)))
  expect_identical(rownames(rows$profile_facts), as.character(seq_len(nrow(rows$profile_facts))))
  expect_identical(rows$profile_axes$ordinal[rows$profile_axes$axis_name == "detail"], c(0L, 1L, 0L))
})

test_that("a mutated profile fact refuses at the pre-write round-trip guard", {
  expected <- bridge_fixture_expected_tokens()
  profiles <- bridge_live_profile_fixture(expected[["scalar"]])
  rows <- bridge_db_rows_from_profile_projections(profiles)
  tampered <- profiles
  tampered$structure_age$facts$value[[1L]] <- 0.999
  live_rows <- list(facts = rows$profile_facts, axes = rows$profile_axes,
                    provenance = rows$profile_provenance)
  expect_error(assert_bridge_profile_round_trip(tampered, live_rows),
               "profile round-trip")
})

test_that("re-read profile rows that moved during the write abort the transaction", {
  expected <- bridge_fixture_expected_tokens()
  live <- bridge_live_fixture()
  built <- build_bridge_scalar_projection(
    live, bridge_fresh_offre_tc_rows(), bridge_fixture_metadata(),
    retained_scalar_retirement_ids())
  tokens <- bridge_compute_new_tokens(
    built$projection, bridge_fixture_reference_rows(), expected[["reference"]],
    markers = bridge_fixture_markers(expected), expected = expected)
  profiles <- bridge_rebind_profile_lineage(
    bridge_live_profile_fixture(expected[["scalar"]]),
    lire_theme_metadata("habitat"), tokens$scalar)
  lineage <- bridge_profile_lineage_tokens(
    profiles, bridge_fixture_reference_rows(), expected[["reference"]])
  rows <- bridge_db_rows_from_profile_projections(
    bridge_live_profile_fixture(expected[["scalar"]]))
  plan <- list(projection = built$projection, tokens = tokens,
               markers = bridge_fixture_markers(expected), expected = expected,
               affected = built$affected, live = live, profiles = profiles,
               profile_lineage = lineage,
               live_profile_rows = list(facts = rows$profile_facts,
                                        axes = rows$profile_axes,
                                        provenance = rows$profile_provenance))
  moved <- rows
  moved$profile_facts$value[[1L]] <- 0.999
  expect_error(publish_bridge_snapshot(
    NULL, plan, retained_scalar_retirement_ids(), expected,
    transaction = function(con, expr) force(expr),
    scalar_adapter = bridge_fake_scalar_adapter(expected[["scalar"]]),
    comparison_adapter = bridge_fake_comparison_adapter(expected[["comparison"]], tokens$scalar),
    profile_adapter = bridge_fake_profile_adapter(expected[["profile"]], tokens$scalar),
    writer = bridge_fake_marker_writer(expected[["scalar"]]),
    read_profile_rows = function(con) list(
      facts = moved$profile_facts, axes = moved$profile_axes,
      provenance = moved$profile_provenance)), "profile round-trip")
})

