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
  expect_setequal(preserved$indicator_id, c("kept_scalar", "other_kept"))
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
