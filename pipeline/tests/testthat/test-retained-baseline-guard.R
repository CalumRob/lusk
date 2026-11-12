# test-retained-baseline-guard ------------------------------------------------
# #989 pre-publication serving baseline guard. Pure checks (no database): scope
# parsing, prior-snapshot reconstruction, and exact marker matching/refusals.
# The guarded test-only database smoke exercises the integrated normal publisher.

scope_baseline_fixture <- function() {
  facts <- data.frame(
    indicator_id = c("kept_scalar", "kept_scalar", "scoped_scalar",
                     "scoped_scalar"),
    territory_id = c("22001", "22002", "22001", "22002"),
    territory_type = "commune",
    value = c(1, 2, 3, 4),
    status = "measured",
    support_count = NA_integer_,
    denominator_count = NA_integer_,
    stringsAsFactors = FALSE)
  descriptors <- data.frame(
    indicator_id = c("kept_scalar", "scoped_scalar"),
    theme_id = "fixture",
    allowed_sources = I(list("fixture_source", "fixture_source")),
    label = c("Kept", "Scoped"),
    unit = "count",
    direction = "high",
    comparison_facet = c("kept_scalar", "scoped_scalar"),
    allowed_levels = I(list("commune", "commune")),
    denominator_semantics = "count",
    completeness = "sparse",
    descriptor_version = "v1",
    stringsAsFactors = FALSE)
  provenance <- data.frame(
    indicator_id = facts$indicator_id,
    territory_id = facts$territory_id,
    source_id = "fixture_source",
    vintage_id = "2025/2025-01-01",
    stringsAsFactors = FALSE)
  list(
    facts = facts, descriptors = descriptors, provenance = provenance,
    datasets = data.frame(source_id = "fixture_source", name = "Fixture",
                          stringsAsFactors = FALSE),
    vintages = data.frame(
      source_id = "fixture_source", vintage_id = "2025/2025-01-01",
      version = "2025", reference_date = as.Date("2025-01-01"),
      publication_date = as.Date("2025-01-02"), stringsAsFactors = FALSE),
    eligible_territories = data.frame(
      territory_id = c("22001", "22002"), territory_type = "commune",
      stringsAsFactors = FALSE))
}

marker_fixture <- function() {
  list(
    tables = data.frame(
      table_name = c("territory_reference", "scalar_observation",
                     "demographic_typed_reading", "selected_reading",
                     "economy_typed_reading", "economy_activity_evidence",
                     "milieux_typed_reading", "milieux_reading_absence"),
      content_version = c("ref-v1", "scalar-base", "demo-v1", "habitat-v1",
                          "eco-v1", "eco-v1", "milieux-v1", "milieux-v1"),
      reference_content_version = c(NA, "ref-v1", "ref-v1", "ref-v1",
                                    "ref-v1", "ref-v1", "ref-v1", "ref-v1"),
      stringsAsFactors = FALSE),
    comparison = data.frame(
      content_version = "comparison-base",
      scalar_content_version = "scalar-base",
      reference_content_version = "ref-v1", stringsAsFactors = FALSE),
    series = data.frame(
      dataset_id = "ocsge_artif_etats",
      content_version = "series-v1", reference_content_version = "ref-v1",
      stringsAsFactors = FALSE))
}

expected_fixture <- function() {
  list(reference = "ref-v1", scalar = "scalar-base",
       comparison = "comparison-base", comparison_scalar = "scalar-base",
       typed = c(demographie = "demo-v1", habitat = "habitat-v1",
                 economie = "eco-v1", milieux = "milieux-v1"),
       series = list(dataset_id = "ocsge_artif_etats",
                     content_version = "series-v1"),
       scope_ids = "scoped_scalar")
}

test_that("the scoped publication requires an explicit prior baseline scope", {
  expect_identical(retained_backend_scope_ids(""), character())
  expect_identical(
    retained_backend_scope_ids(
      "mobilite:stations_service,stations_service_1000,bornes_recharge_1000"),
    c("stations_service", "stations_service_1000", "bornes_recharge_1000"))
  expect_error(retained_backend_scope_ids("mobilite:unknown"),
               "unregistered")
})

test_that("the prior scalar snapshot removes exactly the scoped indicators", {
  projection <- scope_baseline_fixture()
  prior <- retained_baseline_scalar(projection, "scoped_scalar")
  expect_setequal(unique(prior$facts$indicator_id), "kept_scalar")
  expect_identical(prior$descriptors$indicator_id, "kept_scalar")
  expect_true(all(
    identical(rownames(prior$facts), as.character(seq_len(nrow(prior$facts)))),
    identical(rownames(prior$descriptors),
              as.character(seq_len(nrow(prior$descriptors)))),
    identical(rownames(prior$provenance),
              as.character(seq_len(nrow(prior$provenance))))))
  expect_identical(prior$eligible_territories, projection$eligible_territories)
  expect_no_error(validate_scalar_artifact_projection(prior))
  # Idempotent on an already-filtered projection.
  expect_identical(retained_baseline_scalar(prior, character()), prior)
})

test_that("the baseline marker verifier accepts an exact match", {
  mismatches <- verifier_retained_backend_baseline(marker_fixture(),
                                                   expected_fixture())
  expect_equal(nrow(mismatches), 0L)
})

test_that("the baseline marker verifier refuses every stale owner marker", {
  cases <- list(
    scalar = function(m) { m$tables$content_version[
      m$tables$table_name == "scalar_observation"] <- "newer-scalar"; m },
    territory = function(m) { m$tables$content_version[
      m$tables$table_name == "territory_reference"] <- "newer-ref"; m },
    typed = function(m) { m$tables$content_version[
      m$tables$table_name == "selected_reading"] <- "newer-habitat"; m },
    comparison = function(m) { m$comparison$content_version <- "newer"; m },
    series = function(m) { m$series$content_version <- "newer-series"; m },
    reference_binding = function(m) {
      m$tables$reference_content_version[
        m$tables$table_name == "scalar_observation"] <- "other-ref"; m },
    missing = function(m) {
      m$tables <- m$tables[m$tables$table_name != "milieux_typed_reading", ]
      m }
  )
  for (name in names(cases)) {
    mismatches <- verifier_retained_backend_baseline(
      cases[[name]](marker_fixture()), expected_fixture())
    expect_gt(nrow(mismatches), 0L)
    expect_true(any(grepl("newer|other-ref|missing|presence", mismatches$live) |
                      mismatches$field == "presence"), info = name)
  }
})

test_that("the baseline marker verifier reports a missing owner marker", {
  markers <- marker_fixture()
  markers$tables <- markers$tables[
    markers$tables$table_name != "milieux_typed_reading", ]
  mismatches <- verifier_retained_backend_baseline(markers, expected_fixture())
  expect_true(any(mismatches$marker == "milieux_typed_reading" &
                    mismatches$field == "presence"))
})
