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
  expect_match(paste(output, collapse = "\n"), "new declared-profile token", fixed = TRUE)
  expect_match(paste(output, collapse = "\n"), "new profile comparison token", fixed = TRUE)
  expect_match(paste(output, collapse = "\n"), "new Habitat linked token", fixed = TRUE)
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


# --- Round-3: harness defects exposed by the real DB proof --------------------

test_that("the DB proof resolves schema.sql independently of the working directory", {
  expected <- bridge_db_schema_path()
  expect_true(file.exists(expected))
  expect_match(normalizePath(expected, winslash = "/"), "/api/schema.sql$")
  withr::local_dir(tempdir())
  expect_identical(bridge_db_schema_path(), expected)
  expect_identical(bridge_db_repo_root(), dirname(dirname(expected)))
})

test_that("schema cleanup runs after an early error and drops only this run's schema", {
  dropped <- character()
  opened <- closed <- 0L
  open_stub <- function(config) { opened <<- opened + 1L
    structure(list(), class = "fake-cleanup-con") }
  query_stub <- function(con, sql, params = list())
    data.frame(database = "lusk_it_contract", owned = TRUE, stringsAsFactors = FALSE)
  execute_stub <- function(con, sql) { dropped <<- c(dropped, sql); 1L }
  close_stub <- function(con) { closed <<- closed + 1L; invisible(TRUE) }

  expect_error(local({
    schema <- "serving_it_999_abcdef"
    on.exit(bridge_db_cleanup_schema(
      schema, bridge_pure_config(), open = open_stub, query = query_stub,
      execute = execute_stub, close = close_stub,
      quote_id = function(con, schema) paste0('"', schema, '"'),
      cleanup_flag = "1"), add = TRUE)
    stop("boom between CREATE SCHEMA and the first assertion")
  }), "boom between CREATE SCHEMA")

  expect_identical(opened, 1L)
  expect_identical(closed, 1L)
  expect_identical(dropped, 'DROP SCHEMA "serving_it_999_abcdef" CASCADE')
})

test_that("schema cleanup refuses unsafe schemas, wrong databases and missing opt-in", {
  dropped <- character()
  common <- list(
    open = function(config) structure(list(), class = "fake-cleanup-con"),
    query = function(con, sql, params = list())
      data.frame(database = "lusk_it_contract", owned = TRUE, stringsAsFactors = FALSE),
    execute = function(con, sql) { dropped <<- c(dropped, sql); 1L },
    close = function(con) invisible(TRUE))
  expect_error(do.call(bridge_db_cleanup_schema, c(list(
    schema = "public", config = bridge_pure_config(), cleanup_flag = "1"), common)),
    "Refusing cleanup")
  expect_error(do.call(bridge_db_cleanup_schema, c(list(
    schema = "serving_it_1_abcd", config = bridge_pure_config(), cleanup_flag = "0"), common)),
    "Refusing cleanup")
  bad_query <- common
  bad_query$query <- function(con, sql, params = list())
    data.frame(database = "lusk", owned = TRUE, stringsAsFactors = FALSE)
  expect_error(do.call(bridge_db_cleanup_schema, c(list(
    schema = "serving_it_1_abcd", config = bridge_pure_config(), cleanup_flag = "1"), bad_query)),
    "Refusing cleanup")
  expect_length(dropped, 0L)
})


# --- Round-4: seed through the registered publisher, producer-valid -----------

test_that("the seeded old-state projection is producer-valid and FK-coherent", {
  live <- bridge_live_fixture()
  validate_scalar_projection(live$facts, live$descriptors, live$eligible_territories)
  validate_scalar_artifact_projection(live)

  # In-memory mirror of the serving FKs exercised by api/schema.sql:
  # scalar_observation -> scalar_descriptor;
  # scalar_observation_source -> descriptor and (source_dataset, source_vintage);
  # scalar_descriptor_source -> descriptor and source_dataset.
  descriptor_ids <- as.character(live$descriptors$indicator_id)
  dataset_ids <- as.character(live$datasets$source_id)
  vintage_keys <- paste(live$vintages$source_id, live$vintages$vintage_id, sep = "\r")
  expect_true(all(live$facts$indicator_id %in% descriptor_ids))
  expect_true(all(live$provenance$indicator_id %in% descriptor_ids))
  expect_true(all(live$provenance$source_id %in% dataset_ids))
  expect_true(all(paste(live$provenance$source_id, live$provenance$vintage_id, sep = "\r")
                  %in% vintage_keys))
  expect_true(all(unlist(live$descriptors$allowed_sources, use.names = FALSE) %in% dataset_ids))

  # The old state contains a registry-derived retired id plus the old offre_tc.
  retired <- retained_scalar_retirement_ids()
  expect_true(any(retired %in% descriptor_ids))
  expect_false(bridge_offre_tc_id() %in% retired)
  expect_true(bridge_offre_tc_id() %in% descriptor_ids)
  expect_equal(max(live$facts$value[live$facts$indicator_id == bridge_offre_tc_id()]), 0.20)
})

test_that("scalar seeding goes through the publisher transaction before replace", {
  calls <- character()
  adapter <- bridge_fake_scalar_adapter("seed-version")
  base_replace <- adapter$replace
  adapter$transaction <- function(expr) { calls <<- c(calls, "transaction"); force(expr) }
  adapter$replace <- function(projection, version, retired_indicator_ids = character()) {
    calls <<- c(calls, "replace")
    base_replace(projection, version, retired_indicator_ids)
  }
  registry <- register_scalar_publisher(list(), "seed",
    project = function(canonical) canonical,
    publish = function(projection, db, version) db$replace(projection, version))
  publish_registered_scalar(registry, "seed", bridge_live_fixture(), adapter,
                            retired_indicator_ids = retained_scalar_retirement_ids())
  # A direct adapter$replace call would skip the transaction; the deferred FK
  # and descriptor-source triggers require descriptor and source inserts to
  # commit together (this is what failed when the DB proof seeded directly).
  expect_identical(calls, c("transaction", "replace"))
})


# --- Round-5: RPostgres raw shapes -> producer-identical projections ----------

test_that("Postgres array text shapes parse to producer vectors, including empty/NULL", {
  expect_identical(bridge_parse_text_array("{commune,epci}"), c("commune", "epci"))
  expect_identical(bridge_parse_text_array("{}"), character())
  expect_identical(bridge_parse_text_array(NA_character_), NA_character_)
  expect_identical(bridge_parse_text_array(c("commune", "epci")), c("commune", "epci"))
  expect_identical(bridge_parse_text_array(list(c("a", "b"))), c("a", "b"))
})

test_that("a raw RPostgres scalar projection is producer-equal and hash-equal", {
  live <- bridge_live_fixture()
  reader <- bridge_fake_reader(bridge_db_rows_from_projection(live))
  loaded <- read_live_scalar_projection(NULL, reader = reader)
  expect_identical(loaded, live)
  validate_scalar_artifact_projection(loaded)
  # The token is md5(saveRDS()); no test-only canonicalisation is applied — the
  # production reader already builds byte-stable frames, so this pins real parity.
  expect_identical(scalar_content_version(loaded),
                   scalar_content_version(live))
})

test_that("a raw RPostgres profile projection is producer-equal and hash-equal", {
  producer <- bridge_live_profile_fixture("scalar-live")
  profile_rows <- bridge_db_rows_from_profile_projections(producer, raw_arrays = TRUE)
  expect_true(is.character(profile_rows$profile_descriptors$allowed_levels))
  expect_match(profile_rows$profile_descriptors$allowed_levels[[1L]], "^\\{")
  reader <- bridge_fake_reader(bridge_db_rows_from_projection(bridge_live_fixture()),
                               profile_rows = profile_rows)
  loaded <- bridge_read_live_profile_projections(
    NULL, reader = reader, metadata = lire_theme_metadata("habitat"),
    new_scalar = "scalar-live")

  expect_identical(loaded, producer)
  for (owner in names(producer)) {
    validate_declared_profile(loaded[[owner]]$facts, loaded[[owner]]$descriptor,
                              loaded[[owner]]$axes, loaded[[owner]]$eligible_territories)
    expect_identical(profile_content_version(loaded[[owner]]),
                     profile_content_version(producer[[owner]]))
  }

  # The original production failure: reconstructed levels must be a character
  # vector suitable for comparison_context_membership, not "{a,b}".
  comparisons <- project_declared_profile_comparisons(
    loaded, bridge_fixture_reference_rows(), "profile-live", "reference-live")
  expect_setequal(unique(comparisons$groups$comparison_context),
                  c("bretagne", "density_class", "epci", "littoral"))
})

# --- Round-6: real-write prerequisites and PostgreSQL semantics (offline) -----

test_that("the harness env builder carries every real-write gate", {
  values <- bridge_test_env_values(bridge_fixture_expected_tokens(), "facts.rds",
    list(setNames("1", BRIDGE_PUBLISH_OPT_IN_ENV),
         setNames("dump", BRIDGE_DUMP_ACK_ENV)))
  env <- bridge_fake_env(values)
  expect_identical(env(BRIDGE_PUBLISH_OPT_IN_ENV), "1")
  expect_identical(env(BRIDGE_DUMP_ACK_ENV), "dump")
  expect_identical(env("LUSK_SCALAR_SCOPE"), "mobilite:offre_tc")
  expect_identical(env(BRIDGE_FACTS_ENV), "facts.rds")
  expect_true(all(vapply(unname(BRIDGE_EXPECTED_ENV),
                         function(name) nzchar(env(name)), logical(1))))
  expect_invisible(assert_bridge_publish_opt_in(env))
  expect_invisible(assert_bridge_dump_confirmed(env))
})

test_that("the session lock is released even when the real write fails", {
  expected <- bridge_fixture_expected_tokens()
  facts_path <- tempfile("bridge-facts-", fileext = ".rds")
  on.exit(unlink(facts_path), add = TRUE)
  saveRDS(bridge_fresh_offre_tc_rows(), facts_path)
  values <- bridge_test_env_values(expected, facts_path,
    list(setNames("1", BRIDGE_PUBLISH_OPT_IN_ENV),
         setNames("dump", BRIDGE_DUMP_ACK_ENV)))
  locked <- unlocked <- 0L
  expect_error(capture.output(run_offre_tc_bridge(
    "publish", env = bridge_fake_env(values),
    con = structure(list(), class = "fake-con"), config = bridge_pure_config(),
    identity_reader = bridge_pure_identity,
    live_reader = bridge_fake_reader(bridge_db_rows_from_projection(bridge_live_fixture())),
    read_markers = function() bridge_fixture_markers(expected),
    retired_ids = retained_scalar_retirement_ids(),
    lock = function(con) { locked <<- locked + 1L; invisible(NULL) },
    unlock = function(con) { unlocked <<- unlocked + 1L; invisible(NULL) },
    publish = function(...) stop("injected write failure"))), "injected write failure")
  expect_identical(locked, 1L)
  expect_identical(unlocked, 1L)
})

test_that("a failed publication transaction rolls back before the caller continues", {
  expected <- bridge_fixture_expected_tokens()
  live <- bridge_live_fixture()
  built <- build_bridge_scalar_projection(live, bridge_fresh_offre_tc_rows(),
    bridge_fixture_metadata(), retained_scalar_retirement_ids())
  tokens <- bridge_compute_new_tokens(built$projection, bridge_fixture_reference_rows(),
    expected[["reference"]], bridge_fixture_markers(expected), expected)
  plan <- list(projection = built$projection, tokens = tokens,
               markers = bridge_fixture_markers(expected), expected = expected,
               affected = built$affected, live = live)
  rolled_back <- 0L
  # Mimics DBI::dbWithTransaction: run the body, roll back on error, rethrow.
  fake_transaction <- function(con, expr) {
    result <- tryCatch(list(ok = force(expr)), error = function(e) {
      rolled_back <<- rolled_back + 1L
      stop(e)
    })
    result$ok
  }
  comparison_db <- bridge_fake_comparison_adapter(expected[["comparison"]], tokens$scalar)
  comparison_db$replace <- function(projection) stop("injected failure")
  expect_error(publish_bridge_snapshot(
    NULL, plan, retained_scalar_retirement_ids(), expected,
    transaction = fake_transaction,
    scalar_adapter = bridge_fake_scalar_adapter(expected[["scalar"]]),
    comparison_adapter = comparison_db,
    writer = bridge_fake_marker_writer(expected[["scalar"]])), "injected failure")
  expect_identical(rolled_back, 1L)
})


# --- Round-7: in-transaction re-guard ordering and exemption set --------------

bridge_ordering_stub_reader <- function(pre_rows, post_rows, profile_rows) {
  state <- new.env(parent = emptyenv())
  state$written <- FALSE
  reader <- bridge_fake_reader(pre_rows, profile_rows = profile_rows)
  pick <- function(field) function(con) {
    if (isTRUE(state$written)) post_rows[[field]] else pre_rows[[field]]
  }
  reader$facts <- pick("facts")
  reader$descriptors <- pick("descriptors")
  reader$provenance <- pick("provenance")
  reader$datasets <- pick("datasets")
  reader$vintages <- pick("vintages")
  reader$territories <- function(con) pre_rows$territories
  reader$reference_rows <- function(con) pre_rows$reference_rows
  list(reader = reader, state = state)
}

test_that("the in-transaction re-guard exempts offre_tc and the retirements", {
  expected <- bridge_fixture_expected_tokens()
  live <- bridge_live_fixture()
  built <- build_bridge_scalar_projection(live, bridge_fresh_offre_tc_rows(),
    bridge_fixture_metadata(), retained_scalar_retirement_ids())
  pre_rows <- bridge_db_rows_from_projection(live)
  post_rows <- bridge_db_rows_from_projection(built$projection)
  profile_rows <- bridge_db_rows_from_profile_projections(
    bridge_live_profile_fixture(expected[["scalar"]]))
  stub <- bridge_ordering_stub_reader(pre_rows, post_rows, profile_rows)
  facts_path <- tempfile("bridge-facts-", fileext = ".rds")
  on.exit(unlink(facts_path), add = TRUE)
  saveRDS(bridge_fresh_offre_tc_rows(), facts_path)
  values <- bridge_test_env_values(expected, facts_path,
    list(setNames("1", BRIDGE_PUBLISH_OPT_IN_ENV),
         setNames("dump", BRIDGE_DUMP_ACK_ENV)))
  expect_silent(capture.output(written <- run_offre_tc_bridge(
    "publish", env = bridge_fake_env(values),
    con = structure(list(), class = "fake-con"), config = bridge_pure_config(),
    identity_reader = bridge_pure_identity,
    live_reader = stub$reader,
    read_markers = function() bridge_fixture_markers(expected),
    retired_ids = retained_scalar_retirement_ids(),
    publish = function(con, plan, retired, tokens, ...) {
      stub$state$written <- TRUE
      expect_true(setequal(plan$affected,
        union(retained_scalar_retirement_ids(), bridge_offre_tc_id())))
      publish_bridge_snapshot(con, plan, retired, tokens, ...,
        transaction = function(con, expr) force(expr),
        scalar_adapter = bridge_fake_scalar_adapter(expected[["scalar"]]),
        comparison_adapter = bridge_fake_comparison_adapter("comparison-live", plan$tokens$scalar),
        profile_adapter = bridge_fake_profile_adapter(expected[["profile"]], plan$tokens$scalar),
        writer = bridge_fake_marker_writer(expected[["scalar"]]))
    })))
  expect_identical(written$scalar$content_version,
                   scalar_content_version(built$projection))
})

test_that("the in-transaction re-guard still refuses a changed kept indicator", {
  expected <- bridge_fixture_expected_tokens()
  live <- bridge_live_fixture()
  built <- build_bridge_scalar_projection(live, bridge_fresh_offre_tc_rows(),
    bridge_fixture_metadata(), retained_scalar_retirement_ids())
  post_rows <- bridge_db_rows_from_projection(built$projection)
  post_rows$facts$value[post_rows$facts$indicator_id == "kept_scalar"][[1L]] <- 999
  profile_rows <- bridge_db_rows_from_profile_projections(
    bridge_live_profile_fixture(expected[["scalar"]]))
  stub <- bridge_ordering_stub_reader(bridge_db_rows_from_projection(live), post_rows,
                                      profile_rows)
  facts_path <- tempfile("bridge-facts-", fileext = ".rds")
  on.exit(unlink(facts_path), add = TRUE)
  saveRDS(bridge_fresh_offre_tc_rows(), facts_path)
  values <- bridge_test_env_values(expected, facts_path,
    list(setNames("1", BRIDGE_PUBLISH_OPT_IN_ENV),
         setNames("dump", BRIDGE_DUMP_ACK_ENV)))
  expect_error(capture.output(run_offre_tc_bridge(
    "publish", env = bridge_fake_env(values),
    con = structure(list(), class = "fake-con"), config = bridge_pure_config(),
    identity_reader = bridge_pure_identity,
    live_reader = stub$reader,
    read_markers = function() bridge_fixture_markers(expected),
    retired_ids = retained_scalar_retirement_ids(),
    publish = function(con, plan, retired, tokens, ...) {
      stub$state$written <- TRUE
      publish_bridge_snapshot(con, plan, retired, tokens, ...,
        transaction = function(con, expr) force(expr),
        scalar_adapter = bridge_fake_scalar_adapter(expected[["scalar"]]),
        comparison_adapter = bridge_fake_comparison_adapter("comparison-live", plan$tokens$scalar),
        profile_adapter = bridge_fake_profile_adapter(expected[["profile"]], plan$tokens$scalar),
        writer = bridge_fake_marker_writer(expected[["scalar"]]))
    })),
    "unrelated indicator\\(s\\) changed: kept_scalar")
})


# --- Review round 4 + addendum: safety, types, FK, timeouts, live shape -------

test_that("the disposable target guard stops every wrong-host/db/user path", {
  for (bad in list(
    list("lusk", "lusk_it_contract_pub", "192.168.1.120"),
    list("lusk_it_contract", "lusk_publisher", "192.168.1.120"),
    list("lusk_it_contract", "lusk_it_contract_pub", "other-host")))
    expect_error(do.call(bridge_db_target_guard, bad), "Refusing to connect")
  expect_invisible(bridge_db_target_guard("lusk_it_contract",
    "lusk_it_contract_pub", "192.168.1.120"))

  good <- data.frame(database = "lusk_it_contract", role = "lusk_it_contract_pub",
                     stringsAsFactors = FALSE)
  expect_invisible(assert_bridge_connected_test_db(good))
  expect_error(assert_bridge_connected_test_db(transform(good, database = "lusk")),
               "Refusing to run")
  expect_error(assert_bridge_connected_test_db(transform(good, role = "lusk_publisher")),
               "Refusing to run")
})

test_that("the FK pre-flight refuses populated outside references", {
  internal <- data.frame(referencing_table = "scalar_comparison_group",
    referenced_table = "scalar_descriptor", has_rows = TRUE, stringsAsFactors = FALSE)
  expect_invisible(assert_bridge_no_foreign_scalar_fks(internal))
  expect_invisible(assert_bridge_no_foreign_scalar_fks(internal[0L, , drop = FALSE]))
  outside <- transform(internal, referencing_table = "outside_owner",
                       has_rows = TRUE)
  expect_error(assert_bridge_no_foreign_scalar_fks(outside),
               "outside table\\(s\\) with rows reference")
  # An empty outside FK is harmless: nothing can cascade.
  expect_invisible(assert_bridge_no_foreign_scalar_fks(
    transform(outside, has_rows = FALSE)))
})

test_that("api/schema.sql declares no outside FK into wholesale-replaced tables", {
  sql <- paste(readLines(bridge_db_schema_path(), warn = FALSE), collapse = "\n")
  current <- NA_character_
  refs <- list()
  for (line in strsplit(sql, "\n", fixed = TRUE)[[1L]]) {
    header <- regmatches(line, regexpr("^CREATE TABLE [a-z_]+", line))
    if (length(header)) current <- sub("^CREATE TABLE ", "", header)
    for (match in regmatches(line, gregexpr("REFERENCES [a-z_]+", line))[[1L]])
      refs[[length(refs) + 1L]] <- data.frame(
        referencing_table = current, referenced_table = sub("^REFERENCES ", "", match),
        stringsAsFactors = FALSE)
  }
  catalog <- do.call(rbind, refs)
  replaced <- c("scalar_descriptor", "scalar_observation",
                "scalar_observation_source", "scalar_descriptor_source")
  outside <- catalog[catalog$referenced_table %in% replaced &
                       !catalog$referencing_table %in% BRIDGE_MANAGED_TABLES, ,
                     drop = FALSE]
  expect_identical(nrow(outside), 0L)
})

test_that("write timeouts are bounded, configurable SQL and reject bad values", {
  seen <- character()
  expect_invisible(bridge_write_timeouts("250", "90000",
    set = function(sql) seen <<- c(seen, sql)))
  expect_identical(seen, c("SET LOCAL lock_timeout = '250ms'",
                           "SET LOCAL statement_timeout = '90000ms'"))
  expect_error(bridge_write_timeouts("0", "100"), "positive integer")
  expect_error(bridge_write_timeouts("5000", "abc"), "positive integer")
  expect_match(bridge_write_timeouts(set = function(sql) NULL)[[1L]],
               "SET LOCAL lock_timeout")
})

test_that("the in-transaction guard refuses missing or empty exemption sets", {
  expected <- bridge_fixture_expected_tokens()
  live <- bridge_live_fixture()
  built <- build_bridge_scalar_projection(live, bridge_fresh_offre_tc_rows(),
    bridge_fixture_metadata(), retained_scalar_retirement_ids())
  make_plan <- function() list(projection = built$projection, tokens =
    bridge_compute_new_tokens(built$projection, bridge_fixture_reference_rows(),
      expected[["reference"]], bridge_fixture_markers(expected), expected),
    markers = bridge_fixture_markers(expected), expected = expected,
    live = live, profiles = NULL, live_profile_rows = NULL)
  for (affected in list(NULL, character())) {
    plan <- make_plan()
    if (!is.null(affected)) plan$affected <- affected
    expect_error(publish_bridge_snapshot(NULL, plan,
      retained_scalar_retirement_ids(), expected,
      transaction = function(con, expr) force(expr),
      scalar_adapter = bridge_fake_scalar_adapter(expected[["scalar"]]),
      comparison_adapter = bridge_fake_comparison_adapter(expected[["comparison"]],
                                                         plan$tokens$scalar),
      writer = bridge_fake_marker_writer(expected[["scalar"]]),
      read_live = function() live), "exemption set")
  }
})

test_that("the array parser stops on quoted or escaped elements", {
  expect_error(bridge_parse_text_array('{"a\\"b"}'), "quoted/escaped")
  expect_error(bridge_parse_text_array('{"a\\\\b"}'), "quoted/escaped")
  expect_identical(bridge_parse_text_array("{commune,epci}"), c("commune", "epci"))
})

test_that("post-write re-read refuses retired rows still present and changed facts", {
  expected <- bridge_fixture_expected_tokens()
  live <- bridge_live_fixture()
  built <- build_bridge_scalar_projection(live, bridge_fresh_offre_tc_rows(),
    bridge_fixture_metadata(), retained_scalar_retirement_ids())
  retired <- retained_scalar_retirement_ids()
  expect_invisible(assert_bridge_post_write_scalar(built$projection,
    built$projection, live, built$affected, retired, built$indicator_id))
  bad <- built$projection
  rid <- retired[[1L]]
  bad$descriptors <- rbind(bad$descriptors,
    live$descriptors[live$descriptors$indicator_id == rid, , drop = FALSE])
  bad$facts <- rbind(bad$facts,
    live$facts[live$facts$indicator_id == rid, , drop = FALSE])
  bad$provenance <- rbind(bad$provenance,
    live$provenance[live$provenance$indicator_id == rid, , drop = FALSE])
  expect_error(assert_bridge_post_write_scalar(bad, built$projection, live,
    built$affected, retired, built$indicator_id), "retired indicator")
  bad2 <- built$projection
  bad2$facts$value[bad2$facts$indicator_id == "kept_scalar"][[1L]] <- 999
  expect_error(assert_bridge_post_write_scalar(bad2, built$projection, live,
    built$affected, retired, built$indicator_id), "unrelated indicator")
})

test_that("the live-shaped no-retirement scenario publishes cleanly", {
  expected <- bridge_fixture_expected_tokens()
  live <- bridge_live_fixture_no_retirements()
  retired <- retained_scalar_retirement_ids()
  expect_false(any(retired %in% live$descriptors$indicator_id))
  expect_true(bridge_offre_tc_id() %in% live$descriptors$indicator_id)
  built <- build_bridge_scalar_projection(live, bridge_fresh_offre_tc_rows(),
    bridge_fixture_metadata(), retired)
  facts_path <- tempfile("bridge-facts-", fileext = ".rds")
  on.exit(unlink(facts_path), add = TRUE)
  saveRDS(bridge_fresh_offre_tc_rows(), facts_path)
  values <- bridge_test_env_values(expected, facts_path,
    list(setNames("1", BRIDGE_PUBLISH_OPT_IN_ENV),
         setNames("dump", BRIDGE_DUMP_ACK_ENV)))
  report <- capture.output(result <- run_offre_tc_bridge(
    "dry-run", env = bridge_fake_env(values),
    con = structure(list(), class = "fake-con"), config = bridge_pure_config(),
    identity_reader = bridge_pure_identity,
    live_reader = bridge_fake_reader(bridge_db_rows_from_projection(live)),
    read_markers = function() bridge_fixture_markers(expected),
    retired_ids = retired))
  expect_match(paste(report, collapse = "\n"), "none present live", fixed = TRUE)
  expect_match(paste(report, collapse = "\n"), "FK pre-flight:", fixed = TRUE)
  expect_length(result$retired_present, 0L)
  expect_identical(result$projection, built$projection)

  live_stub <- bridge_ordering_stub_reader(
    bridge_db_rows_from_projection(live),
    bridge_db_rows_from_projection(built$projection),
    bridge_db_rows_from_profile_projections(bridge_live_profile_fixture(expected[["scalar"]])))
  written <- run_offre_tc_bridge(
    "publish", env = bridge_fake_env(values),
    con = structure(list(), class = "fake-con"), config = bridge_pure_config(),
    identity_reader = bridge_pure_identity,
    live_reader = live_stub$reader,
    read_markers = function() bridge_fixture_markers(expected),
    retired_ids = retired,
    publish = function(con, plan, retired_ids, tokens, ...) {
      live_stub$state$written <- TRUE
      expect_length(plan$retired_present, 0L)
      publish_bridge_snapshot(con, plan, retired_ids, tokens, ...,
        transaction = function(con, expr) force(expr),
        scalar_adapter = bridge_fake_scalar_adapter(expected[["scalar"]]),
        comparison_adapter = bridge_fake_comparison_adapter(expected[["comparison"]],
                                                           plan$tokens$scalar),
        profile_adapter = bridge_fake_profile_adapter(expected[["profile"]],
                                                     plan$tokens$scalar),
        writer = bridge_fake_marker_writer(expected[["scalar"]]))
    })
  expect_identical(written$scalar$content_version, result$tokens$scalar)
})


# --- Review round 5: schema-scoped FK inventory ------------------------------

test_that("FK inventory ignores other schemas and probes quoted qualified tables", {
  target <- "serving_it_abc"
  catalog <- data.frame(
    referencing_table = c("outside_owner", "inside_owner"),
    referenced_table = c("scalar_descriptor", "scalar_descriptor"),
    constraint_name = c("fk_other", "fk_inside"),
    referencing_oid = c(101L, 202L),
    conkey = I(list(1L, 1L)),
    schema = c("other_it_schema", target), stringsAsFactors = FALSE)
  probes <- character()
  quote_stub <- function(id) {
    if (inherits(id, "Id")) paste0('"', id@name[["schema"]], '"."', id@name[["table"]], '"') else paste0('"', id, '"')
  }
  query_stub <- function(sql, params = list()) {
    sql <- paste(sql, collapse = " ")
    if (grepl("current_schema", sql)) return(data.frame(schema = target))
    if (grepl("pg_constraint", sql)) {
      expect_match(sql, "rn\\.nspname")
      expect_match(sql, "dn\\.nspname")
      return(catalog)
    }
    if (grepl("pg_attribute", sql)) return(data.frame(attname = "indicator_id"))
    if (grepl("EXISTS", sql)) {
      probes <<- c(probes, sql)
      return(data.frame(has_rows = TRUE))
    }
    stop("unexpected catalog query: ", sql)
  }
  inventory <- bridge_fk_inventory(NULL, query = query_stub, quote_id = quote_stub)
  expect_identical(nrow(inventory), 1L)
  expect_identical(inventory$referencing_table, "inside_owner")
  expect_length(probes, 1L)
  expect_match(probes[[1L]], "serving_it_abc", fixed = TRUE)
  expect_false(grepl("outside_owner", probes[[1L]], fixed = TRUE))
  expect_match(probes[[1L]], 't."indicator_id" IS NOT NULL', fixed = TRUE)
  expect_error(assert_bridge_no_foreign_scalar_fks(inventory), "outside table")
})

test_that("FK inventory tolerates an empty catalog and an unresolved schema", {
  target <- "serving_it_empty"
  query_stub <- function(sql, params = list()) {
    sql <- paste(sql, collapse = " ")
    if (grepl("current_schema", sql)) return(data.frame(schema = target))
    if (grepl("pg_constraint", sql)) return(data.frame(
      referencing_table = character(), referenced_table = character(),
      constraint_name = character(), referencing_oid = integer(),
      conkey = I(list()), schema = character(), stringsAsFactors = FALSE))
    stop("unexpected query")
  }
  inventory <- bridge_fk_inventory(NULL, query = query_stub)
  expect_identical(nrow(inventory), 0L)
  expect_invisible(assert_bridge_no_foreign_scalar_fks(inventory))
  expect_error(bridge_fk_inventory(NULL, query = function(sql, params = list())
    data.frame(schema = NA_character_)), "could not resolve the target schema")
})


bridge_sql_lint <- function(text) {
  lines <- if (length(text) == 1L && grepl("\n", text, fixed = TRUE))
    strsplit(text, "\n", fixed = TRUE)[[1L]] else text
  exprs <- tryCatch(parse(text = paste(lines, collapse = "\n")), error = function(e) NULL)
  problems <- list()
  add <- function(call, problem) problems[[length(problems) + 1L]] <<-
    data.frame(call = call, problem = problem, stringsAsFactors = FALSE)
  if (is.null(exprs)) {
    add("<parse>", "unparseable_source")
  } else {
    calls <- list()
    source_text <- paste(lines, collapse = "\n")
    src_lines <- strsplit(source_text, "\n", fixed = TRUE)[[1L]]
    aliases <- character()
    for (k in seq_along(src_lines)) {
      line <- src_lines[[k]]
      if (!grepl("^\\s*\\w+\\s*<-\\s*function\\(", line)) next
      nm <- sub("^\\s*(\\w+)\\s*<-.*$", "\\1", line)
      next_line <- if (k < length(src_lines)) src_lines[[k + 1L]] else ""
      if ((grepl("function\\(", line) &&
           grepl("bridge_db_(query|exec)\\(", line)) ||
          grepl("^\\s*bridge_db_(query|exec)\\(", next_line))
        aliases <- c(aliases, nm)
    }
    lint_heads <- c("bridge_db_query", "bridge_db_exec", aliases)
    walk <- function(e) {
      if (is.call(e)) {
        fn <- if (is.symbol(e[[1L]])) as.character(e[[1L]]) else ""
        if (fn %in% lint_heads)
          calls[[length(calls) + 1L]] <<- e
        for (i in seq_along(e)) if (is.call(e[[i]])) walk(e[[i]])
      }
    }
    for (e in exprs) walk(e)

    literal_sql <- function(e) {
      if (is.character(e) && length(e) == 1L) return(e)
      if (is.call(e)) {
        fn <- if (is.symbol(e[[1L]])) as.character(e[[1L]]) else ""
        if (fn %in% c("paste", "paste0")) {
          args <- as.list(e)[-1L]
          nms <- names(args)
          if (is.null(nms)) nms <- rep("", length(args))
          args <- args[!nzchar(nms)]
          parts <- vapply(args, literal_sql, character(1))
          parts <- parts[nzchar(parts)]
          return(paste(parts, collapse = if (fn == "paste0") "" else " "))
        }
        if (fn == "sprintf") {
          args <- as.list(e)[-1L]
          fmt <- literal_sql(args[[1L]])
          vals <- vapply(args[-1L], literal_sql, character(1))
          return(do.call(sprintf, c(list(fmt), as.list(vals))))
        }
      }
      ""
    }
    params_len <- function(e) {
      if (is.null(e)) return(0L)
      if (is.call(e)) {
        fn <- if (is.symbol(e[[1L]])) as.character(e[[1L]]) else ""
        if (identical(fn, "list")) return(length(as.list(e)[-1L]))
        if (identical(fn, "c")) return(NA_integer_)  # dynamic composition
      }
      NA_integer_
    }

    for (call in calls) {
      label <- paste(deparse(call, width.cutoff = 200L), collapse = " ")
      as_list <- as.list(call)[-1L]
      if (length(as_list) < 2L) {
        if (startsWith(label, "bridge_db_")) add(label, "missing_sql")
        next
      }
      head_name <- as.character(call[[1L]])
      sql_index <- if (head_name %in% c("bridge_db_query", "bridge_db_exec")) 2L else 1L
      sql <- literal_sql(as_list[[sql_index]])
      idx <- which(names(as_list) == "params")
      plen <- if (length(idx)) params_len(as_list[[idx[[1L]]]]) else 0L
      tokens <- unlist(regmatches(sql, gregexpr("\\$[0-9]+", sql)))
      numbers <- if (length(tokens)) as.integer(sub("\\$", "", tokens)) else integer()
      n <- if (length(numbers)) max(numbers) else 0L
      if (n > 0L && plen == 0L) add(label, "placeholders_without_params")
      if (n == 0L && isTRUE(plen > 0L)) add(label, "params_without_placeholders")
      if (isTRUE(plen > 0L) && n > 0L && plen != n) add(label, "arity_mismatch")
      if (length(numbers) && !identical(sort(unique(numbers)), seq_len(n)))
        add(label, "non_contiguous_placeholders")
      if (grepl("pg_constraint", sql, fixed = TRUE) &&
          !grepl("nspname", sql, fixed = TRUE)) add(label, "unscoped_catalog")
    }
  }
  source_text <- paste(lines, collapse = "\n")
  if (grepl("\\bquote\\s*\\(", source_text)) add("<source>", "bare_quote")
  if (grepl("paste0?\\(['\"]\"", source_text)) add("<source>", "hand_built_identifier")
  if (length(problems)) do.call(rbind, problems) else data.frame(
    call = character(), problem = character(), stringsAsFactors = FALSE)
}

# BEST-EFFORT STATIC CHECK, not a guarantee. This regex/AST lint can only see
# literal SQL passed through the named helpers and their local aliases. It CANNOT
# catch: dynamically assembled table names (paste/sprintf/runtime interpolation),
# writes performed in other files or other packages, UPDATE/TRUNCATE/COPY/MERGE
# targets, SQL assembled from variables, or runtime-bound DBI calls that bypass
# the helper names entirely.
test_that("the SQL lint is honest on real sources and rejects synthetic errors", {
  bridge <- system.file("..", "R", "publish_serving_bridge.R", package = "lusk")
  expect_identical(nrow(bridge_sql_lint(readLines(bridge, warn = FALSE))), 0L)
  db_test <- file.path(testthat::test_path(), "test-offre-tc-bridge-db.R")
  expect_identical(nrow(bridge_sql_lint(readLines(db_test, warn = FALSE))), 0L)

  bad <- c(
    'bridge_db_query(con, "SELECT $1, $2", params = list(1))',
    'bridge_db_query(con, "SELECT $1")',
    'bridge_db_query(con, "SELECT 1", params = list(1))',
    'x <- quote(foo)',
    'bridge_db_query(con, paste("SELECT * FROM pg_constraint WHERE x = $1"))',
    'q <- function(sql, params = list()) bridge_db_query(con, sql, params = params)',
    'q("SELECT $1, $2", params = list(1))')
  problems <- bridge_sql_lint(bad)
  for (kind in c("arity_mismatch", "placeholders_without_params",
                 "params_without_placeholders", "bare_quote", "unscoped_catalog"))
    expect_true(any(problems$problem == kind), info = kind)
  aliased <- problems[problems$problem == "arity_mismatch", , drop = FALSE]
  expect_true(any(grepl("q\\(\"SELECT", aliased$call)), info = "aliased call linted")
})
# --- Round-7: full FK probe through real DBI S4 dispatch ----------------------

test_that("FK probe SQL is exactly quoted and column-derived (real DBI dispatch)", {
  target <- "serving_it_real"
  catalog <- data.frame(
    referencing_table = "inside_owner", referenced_table = "scalar_descriptor",
    constraint_name = "fk_inside", referencing_oid = 42L,
    conkey = I(list(c(2L, 3L))), schema = target, stringsAsFactors = FALSE)
  con <- bridge_mock_connection(list(
    data.frame(schema = target), catalog,
    data.frame(attname = c("indicator_id", "source_id")),
    data.frame(has_rows = TRUE)))
  inventory <- bridge_fk_inventory(con)
  expect_identical(inventory$has_rows, TRUE)
  calls <- con@state$calls
  expect_identical(calls[[4L]], paste(
    'SELECT EXISTS (SELECT 1 FROM "serving_it_real"."inside_owner" t',
    'WHERE t."indicator_id" IS NOT NULL OR t."source_id" IS NOT NULL) AS has_rows'))
  # The stub's other-schema catalog rows (if any) are filtered before probing.
  expect_false(any(grepl("other_it_schema", calls, fixed = TRUE)))
})

test_that("schema cleanup uses DBI identifier quoting via real dispatch", {
  dropped <- character()
  con <- bridge_mock_connection(list(
    data.frame(database = "lusk_it_contract", owned = TRUE, stringsAsFactors = FALSE)))
  expect_true(bridge_db_cleanup_schema("serving_it_999_abcdef",
    bridge_pure_config(), open = function(config) con,
    execute = function(con, sql) { dropped <<- c(dropped, sql); 1L },
    cleanup_flag = "1"))
  expect_identical(dropped,
    'DROP SCHEMA "serving_it_999_abcdef" CASCADE')
})

test_that("SQL lint rejects bare quote() and hand-built identifiers", {
  for (path in c(system.file("..", "R", "publish_serving_bridge.R", package = "lusk"),
                 file.path(testthat::test_path(), "test-offre-tc-bridge-db.R"))) {
    text <- paste(readLines(path, warn = FALSE), collapse = "\n")
    expect_false(grepl("\\bquote\\s*\\(", text), info = path)
    expect_false(grepl("paste0\\(['\"]\"", text), info = path)
  }
})


# --- Review round 8: linked-token chain must match producer + #1068 guard ----

test_that("bridge linked token equals the producer's own formula", {
  expected <- bridge_fixture_expected_tokens()
  live <- bridge_live_fixture()
  built <- build_bridge_scalar_projection(live, bridge_fresh_offre_tc_rows(),
    bridge_fixture_metadata(), retained_scalar_retirement_ids())
  scalar_version <- scalar_content_version(built$projection)
  profiles <- bridge_read_live_profile_projections(NULL,
    reader = bridge_fake_reader(bridge_db_rows_from_projection(live),
      profile_rows = bridge_db_rows_from_profile_projections(
        bridge_live_profile_fixture(expected[["scalar"]]))),
    metadata = lire_theme_metadata("habitat"), new_scalar = scalar_version)
  lineage <- bridge_profile_lineage_tokens(profiles, bridge_fixture_reference_rows(),
                                           expected[["reference"]])
  tokens <- bridge_compute_new_tokens(built$projection, bridge_fixture_reference_rows(),
    expected[["reference"]], bridge_fixture_markers(expected), expected,
    profile_version = lineage$version)

  producer <- retained_selected_linked_version(
    list(linked_content_version = "canonical"), lineage$version, tokens$scalar,
    expected[["reference"]])
  expect_identical(tokens$linked, producer)
  expect_identical(tokens$linked, paste("canonical", lineage$version,
                                         tokens$scalar, expected[["reference"]], sep = "-"))
})

# Independently derive the scalar snapshot token from the SAME inputs using
# producer projectors only — never the bridge's token computation.
bridge_independent_scalar_version <- function(live, fresh_rows, metadata = bridge_fixture_metadata()) {
  scoped <- project_scalar_canonical_rows(fresh_rows, metadata, bridge_offre_tc_id(),
                                           live$eligible_territories)
  affected <- union(retained_scalar_retirement_ids(), bridge_offre_tc_id())
  keep <- function(frame) frame[!frame$indicator_id %in% affected, , drop=FALSE]
  kept <- list(facts = keep(live$facts), descriptors = keep(live$descriptors),
               provenance = keep(live$provenance), datasets = live$datasets,
               vintages = live$vintages,
               eligible_territories = live$eligible_territories)
  scalar_content_version(combine_scalar_projections(kept, scoped))
}

test_that("the #1068 marker verifier accepts the state a bridge write produces", {
  expected <- bridge_fixture_expected_tokens()
  live <- bridge_live_fixture()
  built <- build_bridge_scalar_projection(live, bridge_fresh_offre_tc_rows(),
    bridge_fixture_metadata(), retained_scalar_retirement_ids())
  scalar_version <- scalar_content_version(built$projection)
  profiles <- bridge_read_live_profile_projections(NULL,
    reader = bridge_fake_reader(bridge_db_rows_from_projection(live),
      profile_rows = bridge_db_rows_from_profile_projections(
        bridge_live_profile_fixture(expected[["scalar"]]))),
    metadata = lire_theme_metadata("habitat"), new_scalar = scalar_version)
  lineage <- bridge_profile_lineage_tokens(profiles, bridge_fixture_reference_rows(),
                                           expected[["reference"]])
  tokens <- bridge_compute_new_tokens(built$projection, bridge_fixture_reference_rows(),
    expected[["reference"]], bridge_fixture_markers(expected), expected,
    profile_version = lineage$version)

  independent_scalar <- bridge_independent_scalar_version(live, bridge_fresh_offre_tc_rows())
  expect_identical(tokens$scalar, independent_scalar)
  independent_comparison <- project_scalar_comparisons(
    built$projection, bridge_fixture_reference_rows(),
    input_scalar_content_version = independent_scalar,
    reference_content_version = expected[["reference"]])
  expect_identical(tokens$comparison, independent_comparison$content_version)
  markers <- bridge_fixture_markers(expected)
  markers$tables$content_version[markers$tables$table_name == "scalar_observation"] <- tokens$scalar
  markers$tables$content_version[markers$tables$table_name == "declared_profile"] <- lineage$version
  markers$comparison$content_version <- tokens$comparison
  markers$comparison$scalar_content_version <- tokens$scalar
  markers$profile_descriptor$required_scalar_version <- tokens$scalar
  markers$selected_descriptor$linked_content_version <- tokens$linked
  markers$profile_comparison$profile_content_version <- lineage$version
  markers$profile_comparison$content_version <- lineage$comparison_version

  # Markers the bridge does not own; the verifier still requires them present.
  owned_tables <- markers$tables$table_name
  extra_names <- c("demographic_typed_reading", "economy_typed_reading",
    "economy_activity_evidence", "milieux_typed_reading", "milieux_reading_absence")
  extra_versions <- c("demo-v1", "eco-v1", "eco-v1", "milieux-v1", "milieux-v1")
  markers$tables <- rbind(markers$tables, data.frame(
    table_name = setdiff(extra_names, owned_tables), content_version = extra_versions,
    reference_content_version = expected[["reference"]], stringsAsFactors = FALSE))
  markers$series <- rbind(markers$series, data.frame(
    dataset_id = "ocsge_artif_etats", content_version = "series-v1",
    reference_content_version = expected[["reference"]], stringsAsFactors = FALSE))
  expectations <- list(
    reference = expected[["reference"]], scalar = independent_scalar,
    comparison = independent_comparison$content_version, comparison_scalar = independent_scalar,
    typed = c(demographie = "demo-v1", habitat = expected[["habitat"]],
              economie = "eco-v1", milieux = "milieux-v1"),
    series = list(dataset_id = "ocsge_artif_etats", content_version = "series-v1"),
    profile_version = lineage$version,
    profile_comparison_version = lineage$comparison_version,
    profile_descriptor_version = markers$profile_descriptor$descriptor_version[[1L]],
    profile_required_scalar = independent_scalar,
    habitat_version = expected[["habitat"]], selected_linked = tokens$linked)
  expect_identical(nrow(verifier_retained_backend_baseline(markers, expectations)), 0L)
  # A stale linked token in the written state must be caught.
  stale <- markers
  stale$selected_descriptor$linked_content_version <- paste0("-", expected[["profile"]],
    "-", tokens$scalar, "-", expected[["reference"]])
  expect_gt(nrow(verifier_retained_backend_baseline(stale, expectations)), 0L)
})


# --- Review round 5: write-schema and extended marker guards -----------------

test_that("write-schema guard refuses when any write table is absent", {
  ok_replies <- c(list(data.frame(schema = "serving_it_ok", stringsAsFactors = FALSE)),
                  rep(list(data.frame(reg = "serving_it_ok", stringsAsFactors = FALSE)),
                      length(BRIDGE_WRITE_TABLES)))
  expect_identical(bridge_assert_write_schema(bridge_mock_connection(ok_replies)),
                   "serving_it_ok")
  bad <- ok_replies
  bad[[3L]] <- data.frame(reg = NA_character_, stringsAsFactors = FALSE)
  expect_error(bridge_assert_write_schema(bridge_mock_connection(bad)),
               "write tables missing from current schema")
  no_schema <- bridge_mock_connection(list(data.frame(schema = NA_character_)))
  expect_error(bridge_assert_write_schema(no_schema), "could not resolve")
})

test_that("marker guard checks profile comparison and the Habitat chain", {
  expected <- bridge_fixture_expected_tokens()
  markers <- bridge_fixture_markers(expected)
  expect_invisible(assert_bridge_markers(markers, expected))

  absent <- markers
  absent$profile_comparison <- absent$profile_comparison[0L, , drop = FALSE]
  expect_error(assert_bridge_markers(absent, expected), "profile_comparison_publication")

  duplicated <- markers
  duplicated$profile_comparison <- rbind(duplicated$profile_comparison,
                                         duplicated$profile_comparison)
  expect_error(assert_bridge_markers(duplicated, expected), "exactly one row")

  stale_profile <- markers
  stale_profile$profile_comparison$profile_content_version <- "stale"
  expect_error(assert_bridge_markers(stale_profile, expected), "profile_content_version")

  stale_link <- markers
  stale_link$selected_descriptor$linked_content_version <- "canonical-stale-stale-stale"
  expect_error(assert_bridge_markers(stale_link, expected), "linked_content_version")
})


# --- Review round 5: write-table list is checked against the publishers -------

# BEST-EFFORT STATIC CHECK, not a guarantee. This regex scan of two publisher
# files sees only literal DELETE/INSERT/dbWriteTable table names. It CANNOT catch:
# dynamically assembled table names (paste/sprintf/runtime interpolation), writes
# in other files or other packages, UPDATE/TRUNCATE/COPY/MERGE targets, SQL built
# from variables, or runtime-bound DBI calls that bypass the scanned patterns.
test_that("BRIDGE_WRITE_TABLES covers every table the publishers mutate", {
  targets <- character()
  for (file in c("publish_scalar.R", "publish_profile.R")) {
    path <- system.file("..", "R", file, package = "lusk")
    text <- paste(readLines(path, warn = FALSE), collapse = "\n")
    for (pattern in c("DELETE FROM ([a-z_]+)", "INSERT INTO ([a-z_]+)",
                      'dbWriteTable\\(con,\\s*"([a-z_]+)"')) {
      hits <- regmatches(text, gregexpr(pattern, text, perl = TRUE))[[1L]]
      for (hit in hits) {
        capture <- regmatches(hit, regexec(pattern, hit, perl = TRUE))[[1L]]
        if (length(capture) > 1L) targets <- c(targets, capture[[2L]])
      }
    }
  }
  tables <- unique(targets)
  expect_gt(length(tables), 10L)
  expect_identical(setdiff(tables, BRIDGE_WRITE_TABLES), character())
})

test_that("the write-schema guard checks comparison_source_lineage", {
  expect_true("comparison_source_lineage" %in% BRIDGE_WRITE_TABLES)
  replies <- c(list(data.frame(schema = "serving_it_ok")),
               lapply(BRIDGE_WRITE_TABLES, function(t)
                 data.frame(reg = if (identical(t, "comparison_source_lineage"))
                   NA_character_ else "serving_it_ok")))
  expect_error(bridge_assert_write_schema(bridge_mock_connection(replies)),
               "comparison_source_lineage")
})


# --- User decision: operator-confirmed offre_tc descriptor replacement --------


bridge_descriptor_run <- function(live, mode, env_extra = list(), policy = NULL) {
  expected <- bridge_fixture_expected_tokens()
  facts_path <- tempfile("bridge-facts-", fileext = ".rds")
  on.exit(unlink(facts_path), add = TRUE)
  saveRDS(bridge_fresh_offre_tc_rows(), facts_path)
  extra <- env_extra
  if (identical(mode, "publish"))
    extra <- c(list(setNames("1", BRIDGE_PUBLISH_OPT_IN_ENV),
                    setNames("dump", BRIDGE_DUMP_ACK_ENV)), extra)
  values <- bridge_test_env_values(expected, facts_path, extra)
  pre_rows <- bridge_db_rows_from_projection(live)
  state <- new.env(parent = emptyenv())
  state$written <- FALSE
  state$post <- NULL
  reader <- bridge_fake_reader(pre_rows)
  make_field <- function(field) {
    force(field)
    function(con) {
    rows <- if (isTRUE(state$written)) state$post else pre_rows
    rows[[field]]
    }
  }
  for (field in c("facts", "descriptors", "provenance", "datasets", "vintages"))
    reader[[field]] <- make_field(field)
  capture.output(plan <- run_offre_tc_bridge(
    mode, env = bridge_fake_env(values),
    con = structure(list(), class = "fake-con"), config = bridge_pure_config(),
    identity_reader = bridge_pure_identity, live_reader = reader,
    read_markers = function() bridge_fixture_markers(expected),
    retired_ids = retained_scalar_retirement_ids(), policy = policy,
    publish = function(con, plan, retired_ids, tokens, ...) {
      state$post <- bridge_db_rows_from_projection(plan$projection)
      state$written <- TRUE
      result <- publish_bridge_snapshot(con, plan, retired_ids, tokens, ...,
        transaction = function(con, expr) force(expr),
        scalar_adapter = bridge_fake_scalar_adapter(expected[["scalar"]]),
        comparison_adapter = bridge_fake_comparison_adapter(expected[["comparison"]],
                                                           plan$tokens$scalar),
        profile_adapter = bridge_fake_profile_adapter(expected[["profile"]],
                                                     plan$tokens$scalar),
        writer = bridge_fake_marker_writer(expected[["scalar"]]))
      c(plan, result)
    }))
  plan
}

test_that("dry-run prints both descriptors and the confirmation token", {
  plan <- bridge_descriptor_run(bridge_live_fixture_old_descriptor(), "dry-run",
                                 policy = "replace")
  expect_true(plan$descriptor_info$changed)
  expect_match(plan$descriptor_info$token, "^[a-f0-9]{32}$")
  expect_identical(as.character(plan$descriptor_info$live$label[[1L]]),
                   "Part des bÃ¢timents prÃ¨s dâ€™un arrÃªt (Ã  500 m)")
  expect_match(as.character(plan$descriptor_info$metadata$label[[1L]]), "adresses",
               ignore.case = TRUE)
})

test_that("descriptor replacement refuses without a matching confirmation token", {
  live <- bridge_live_fixture_old_descriptor()
  expect_error(bridge_descriptor_run(live, "publish", policy = "replace"),
               "LUSK_BRIDGE_CONFIRM_DESCRIPTOR")
  token <- bridge_descriptor_run(live, "dry-run", policy = "replace")$descriptor_info$token
  expect_error(bridge_descriptor_run(live, "publish",
    list(setNames("wrong-token", BRIDGE_CONFIRM_DESCRIPTOR_ENV)), policy = "replace"),
    "LUSK_BRIDGE_CONFIRM_DESCRIPTOR")
  # A token from a different transition must not authorise this one.
  other_token <- bridge_descriptor_run(bridge_live_fixture(), "dry-run",
                                        policy = "replace")$descriptor_info$token
  expect_false(identical(other_token, token))
  expect_error(bridge_descriptor_run(live, "publish",
    list(setNames(other_token, BRIDGE_CONFIRM_DESCRIPTOR_ENV)), policy = "replace"),
    "LUSK_BRIDGE_CONFIRM_DESCRIPTOR")
})

test_that("a confirmed descriptor replacement succeeds; identical descriptors need no token", {
  live_old <- bridge_live_fixture_old_descriptor()
  token <- bridge_descriptor_run(live_old, "dry-run", policy = "replace")$descriptor_info$token
  written <- bridge_descriptor_run(live_old, "publish",
    list(setNames(token, BRIDGE_CONFIRM_DESCRIPTOR_ENV)), policy = "replace")
  expect_true(written$descriptor_info$changed)
  expect_identical(as.character(written$projection$descriptors$label[
    written$projection$descriptors$indicator_id == bridge_offre_tc_id()]),
    as.character(written$descriptor_info$metadata$label[[1L]]))
  expect_false("LUSK_BRIDGE_CONFIRM_DESCRIPTOR" %in% names(
    bridge_descriptor_run(bridge_live_fixture(), "publish")))
  # Preserve policy still refuses a differing descriptor.
  expect_error(bridge_descriptor_run(live_old, "publish"),
               "preserve policy refuses")
})

test_that("the replaced descriptor keeps all chained tokens #1068-consistent", {
  live_old <- bridge_live_fixture_old_descriptor()
  token <- bridge_descriptor_run(live_old, "dry-run", policy = "replace")$descriptor_info$token
  written <- bridge_descriptor_run(live_old, "publish",
    list(setNames(token, BRIDGE_CONFIRM_DESCRIPTOR_ENV)), policy = "replace")
  expected <- bridge_fixture_expected_tokens()
  markers <- bridge_fixture_markers(expected)
  markers$tables$content_version[markers$tables$table_name == "scalar_observation"] <- written$tokens$scalar
  markers$tables$content_version[markers$tables$table_name == "declared_profile"] <- written$profile_lineage$version
  markers$comparison$content_version <- written$tokens$comparison
  markers$comparison$scalar_content_version <- written$tokens$scalar
  markers$profile_descriptor$required_scalar_version <- written$tokens$scalar
  markers$selected_descriptor$linked_content_version <- written$tokens$linked
  markers$profile_comparison$profile_content_version <- written$profile_lineage$version
  markers$profile_comparison$content_version <- written$profile_lineage$comparison_version
  producer_linked <- retained_selected_linked_version(list(linked_content_version = "canonical"),
    written$profile_lineage$version, written$tokens$scalar, expected[["reference"]])
  expect_identical(written$tokens$linked, producer_linked)
  expect_identical(scalar_content_version(written$projection), written$tokens$scalar)
  markers$tables <- rbind(markers$tables, data.frame(
    table_name = c("demographic_typed_reading", "economy_typed_reading",
      "economy_activity_evidence", "milieux_typed_reading", "milieux_reading_absence"),
    content_version = c("demo-v1", "eco-v1", "eco-v1", "milieux-v1", "milieux-v1"),
    reference_content_version = expected[["reference"]], stringsAsFactors = FALSE))
  markers$series <- rbind(markers$series, data.frame(dataset_id = "ocsge_artif_etats",
    content_version = "series-v1", reference_content_version = expected[["reference"]],
    stringsAsFactors = FALSE))
  expect_identical(nrow(verifier_retained_backend_baseline(markers, list(
    reference = expected[["reference"]], scalar = written$tokens$scalar,
    comparison = written$tokens$comparison, comparison_scalar = written$tokens$scalar,
    typed = c(demographie = "demo-v1", habitat = expected[["habitat"]],
              economie = "eco-v1", milieux = "milieux-v1"),
    series = list(dataset_id = "ocsge_artif_etats", content_version = "series-v1"),
    profile_version = written$profile_lineage$version,
    profile_comparison_version = written$profile_lineage$comparison_version,
    profile_descriptor_version = markers$profile_descriptor$descriptor_version[[1L]],
    profile_required_scalar = written$tokens$scalar,
    habitat_version = expected[["habitat"]], selected_linked = written$tokens$linked))), 0L)
})


# --- Final review: semantic fields, dry-run refusal, comparison-shape change --

test_that("confirmation token fields equal the shared semantic definition", {
  expect_identical(BRIDGE_DESCRIPTOR_FIELDS, SCALAR_DESCRIPTOR_SEMANTICS)
  expect_true(all(SCALAR_DESCRIPTOR_SEMANTIC_FIELDS %in% BRIDGE_DESCRIPTOR_FIELDS))
  expect_true(all(SCALAR_DESCRIPTOR_SEMANTIC_LIST_FIELDS %in% BRIDGE_DESCRIPTOR_FIELDS))
  expect_false("descriptor_version" %in% BRIDGE_DESCRIPTOR_FIELDS)
  base <- bridge_live_fixture_old_descriptor()
  row <- base$descriptors[base$descriptors$indicator_id == bridge_offre_tc_id(), , drop=FALSE]
  changed <- row
  changed$allowed_sources <- I(list(c("korrigo", "other_source")))
  t1 <- bridge_descriptor_confirmation_token(row, row)
  t2 <- bridge_descriptor_confirmation_token(row, changed)
  expect_false(identical(t1, t2))
  expect_true(identical_scalar_descriptor(row, row))
  expect_false(identical_scalar_descriptor(row, changed))
})

test_that("dry-run with preserve prints both descriptors then refuses", {
  expected <- bridge_fixture_expected_tokens()
  live <- bridge_live_fixture_old_descriptor()
  facts_path <- tempfile("bridge-facts-", fileext=".rds")
  on.exit(unlink(facts_path), add=TRUE)
  saveRDS(bridge_fresh_offre_tc_rows(), facts_path)
  values <- bridge_test_env_values(expected, facts_path)
  output <- character(); err <- NULL
  output <- capture.output(err <- tryCatch(run_offre_tc_bridge(
    "dry-run", env = bridge_fake_env(values),
    con = structure(list(), class="fake-con"), config = bridge_pure_config(),
    identity_reader = bridge_pure_identity,
    live_reader = bridge_fake_reader(bridge_db_rows_from_projection(live)),
    read_markers = function() bridge_fixture_markers(expected),
    retired_ids = retained_scalar_retirement_ids()), error = function(e) conditionMessage(e)))
  expect_match(paste(output, collapse="\n"), "offre_tc live descriptor", fixed=TRUE)
  expect_match(paste(output, collapse="\n"), "offre_tc metadata descriptor", fixed=TRUE)
  expect_match(paste(output, collapse="\n"), "descriptor confirmation token", fixed=TRUE)
  expect_true(grepl("LUSK_BRIDGE_DESCRIPTOR_POLICY='replace'", err, fixed=TRUE))
  expect_true(grepl("LUSK_BRIDGE_CONFIRM_DESCRIPTOR=", err, fixed=TRUE))
  # A real write with preserve refuses with zero writes.
  expect_error(bridge_descriptor_run(live, "publish", policy = "preserve"),
               "preserve policy refuses")
})

test_that("a facet/direction/levels transition rewrites the comparison chain", {
  expected <- bridge_fixture_expected_tokens()
  live <- bridge_live_fixture_old_descriptor()
  metadata <- lire_theme_metadata("mobilite")
  metadata$indicator_pages$offre_tc$direction <- "low"
  metadata$scalar_contracts$offre_tc$comparison_facet <- "offre_tc"
  metadata$scalar_contracts$offre_tc$allowed_levels <- c("commune", "epci")
  rows_probe <- project_scalar_canonical_rows(bridge_fresh_offre_tc_rows(), metadata,
    bridge_offre_tc_id(), live$eligible_territories)
  meta_desc <- rows_probe$descriptors[1L, , drop=FALSE]
  token <- bridge_descriptor_confirmation_token(
    live$descriptors[live$descriptors$indicator_id == bridge_offre_tc_id(), , drop=FALSE],
    meta_desc)
  built <- build_bridge_scalar_projection(live, bridge_fresh_offre_tc_rows(), metadata,
    retained_scalar_retirement_ids(), descriptor_policy="replace",
    descriptor_confirmation=token)
  expect_identical(as.character(built$projection$descriptors$direction[
    built$projection$descriptors$indicator_id == bridge_offre_tc_id()]), "low")
  expect_identical(as.character(unlist(built$projection$descriptors$allowed_levels[
    built$projection$descriptors$indicator_id == bridge_offre_tc_id()])),
    c("commune", "epci"))
  # Independent expectation: producer functions on a fresh projection, not the bridge.
  independent <- project_scalar_canonical_rows(bridge_fresh_offre_tc_rows(), metadata,
    bridge_offre_tc_id(), live$eligible_territories)
  idx <- built$projection$descriptors$indicator_id == bridge_offre_tc_id()
  actual_row <- built$projection$descriptors[idx, , drop=FALSE]
  rownames(actual_row) <- NULL
  expected_row <- independent$descriptors
  rownames(expected_row) <- NULL
  expect_identical(actual_row, expected_row)
  expected_projection <- built$projection
  expected_projection$descriptors[idx, ] <- independent$descriptors[1L, ]
  expect_identical(scalar_content_version(built$projection),
                   scalar_content_version(expected_projection))
  comparison <- project_scalar_comparisons(independent, bridge_fixture_reference_rows(),
    input_scalar_content_version = scalar_content_version(independent),
    reference_content_version = expected[["reference"]])
  expect_true(nrow(comparison$groups) > 0L)
  expect_true(any(comparison$groups$indicator_id == bridge_offre_tc_id()))
  expect_identical(built$descriptor_info$token, token)
})

