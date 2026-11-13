# test-scoped-publication-plan -------------------------------------------------
# #995 pure checks for the registered scoped dependency closure. The guarded
# test-only database smoke exercises the integrated normal wrapper.

scoped_scalar_fixture <- function() {
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

scoped_marker_fixture <- function() {
  list(
    tables = data.frame(
      table_name = c("territory_reference", "scalar_observation",
                     "declared_profile", "selected_reading",
                     "milieux_typed_reading"),
      content_version = c("ref-v1", "scalar-base", "profile-base",
                          "habitat-v1", "milieux-newer"),
      reference_content_version = c(NA, "ref-v1", "ref-v1", "ref-v1", "ref-v1"),
      stringsAsFactors = FALSE),
    scalar_comparison = data.frame(
      content_version = "comparison-base",
      scalar_content_version = "scalar-base",
      reference_content_version = "ref-v1", stringsAsFactors = FALSE),
    profile_comparison = data.frame(
      content_version = "profile-comparison-base",
      profile_content_version = "profile-base",
      reference_content_version = "ref-v1", stringsAsFactors = FALSE),
    profile_descriptors = data.frame(
      indicator_id = "distribution_dpe", descriptor_version = "dpe-v1",
      required_scalar_version = "scalar-base", stringsAsFactors = FALSE),
    selected_publication = data.frame(
      content_version = "habitat-v1",
      reference_content_version = "ref-v1", stringsAsFactors = FALSE),
    selected_descriptor = data.frame(
      descriptor_version = "habitat-v1",
      linked_content_version = "linked-base", stringsAsFactors = FALSE))
}

scoped_plan_fixture <- function() {
  list(
    direction = "forward",
    reading_owners = "habitat",
    reference = "ref-v1",
    current_scalar_version = "scalar-base",
    current_comparison_version = "comparison-base",
    current_profile_version = "profile-base",
    current_profile_comparison_version = "profile-comparison-base",
    current_profile_descriptors = data.frame(
      indicator_id = "distribution_dpe", descriptor_version = "dpe-v1",
      required_scalar_version = "scalar-base", stringsAsFactors = FALSE),
    current_reading_version = "habitat-v1",
    current_linked_version = "linked-base")
}

test_that("the scoped delta accepts exactly one side carrying the indicators", {
  baseline <- scoped_scalar_fixture()
  stripped <- retained_baseline_scalar(baseline, "scoped_scalar")
  forward <- scoped_snapshot_delta(
    list(scalar = baseline), list(scalar = stripped), "scoped_scalar")
  expect_identical(forward$direction, "forward")
  recovery <- scoped_snapshot_delta(
    list(scalar = stripped), list(scalar = baseline), "scoped_scalar")
  expect_identical(recovery$direction, "recovery")
})

test_that("the scoped delta refuses a difference outside the scope", {
  baseline <- scoped_scalar_fixture()
  candidate <- baseline
  candidate$facts$value[candidate$facts$indicator_id == "kept_scalar"] <- 99
  expect_error(
    scoped_snapshot_delta(list(scalar = candidate),
                          list(scalar = baseline), "scoped_scalar"),
    "outside the scoped indicators")
})

test_that("the scoped delta refuses indicators present on both or neither side", {
  baseline <- scoped_scalar_fixture()
  expect_error(
    scoped_snapshot_delta(list(scalar = baseline), list(scalar = baseline),
                          "scoped_scalar"),
    "exactly one generation")
  stripped <- retained_baseline_scalar(baseline, "scoped_scalar")
  expect_error(
    scoped_snapshot_delta(list(scalar = stripped), list(scalar = stripped),
                          "scoped_scalar"),
    "exactly one generation")
})

test_that("the affected reading closure derives only the linked owner", {
  metadata <- list(
    list(theme = "habitat",
         semantic_resources = list(list(kind = "typed_reading",
           source_keys = list("part_passoires")))),
    list(theme = "demographie",
         semantic_resources = list(list(kind = "typed_reading",
           source_keys = list("serie_historique")))),
    list(theme = "mobilite",
         semantic_resources = list(list(kind = "scalar",
           source_keys = list("part_passoires")))))
  bound <- list(distribution_dpe = list(
    descriptor = list(comparison_scalar = "part_passoires")))
  expect_identical(scoped_affected_readings(metadata, bound), "habitat")
  expect_identical(scoped_affected_readings(metadata, list()), character())
})

test_that("the scoped guard accepts the affected baseline and ignores others", {
  markers <- scoped_marker_fixture()
  expected <- scoped_expected_markers(scoped_plan_fixture())
  mismatches <- verifier_scoped_publication(markers, expected, "habitat")
  expect_equal(nrow(mismatches), 0L)
  # A newer unrelated owner marker is outside the plan and cannot fail the
  # scoped guard.
  markers$tables$content_version[
    markers$tables$table_name == "milieux_typed_reading"] <- "milieux-even-newer"
  expect_equal(nrow(verifier_scoped_publication(markers, expected, "habitat")),
               0L)
})

test_that("the scoped guard refuses every affected stale marker", {
  expected <- scoped_expected_markers(scoped_plan_fixture())
  cases <- list(
    scalar = function(m) {
      m$tables$content_version[m$tables$table_name == "scalar_observation"] <-
        "newer-scalar"; m },
    profile = function(m) {
      m$tables$content_version[m$tables$table_name == "declared_profile"] <-
        "newer-profile"; m },
    selected = function(m) {
      m$tables$content_version[m$tables$table_name == "selected_reading"] <-
        "newer-selected"; m },
    comparison = function(m) {
      m$scalar_comparison$content_version <- "newer-comparison"; m },
    profile_comparison = function(m) {
      m$profile_comparison$content_version <- "newer-profile-comparison"; m },
    required = function(m) {
      m$profile_descriptors$required_scalar_version <- "newer-scalar"; m },
    descriptor = function(m) {
      m$profile_descriptors$descriptor_version <- "newer-descriptor"; m },
    linked = function(m) {
      m$selected_descriptor$linked_content_version <- "newer-linked"; m })
  for (name in names(cases)) {
    expect_true(nrow(verifier_scoped_publication(cases[[name]](
      scoped_marker_fixture()), expected, "habitat")) > 0L, info = name)
  }
})

test_that("the scoped reading publishers are the registered normal ones", {
  publishers <- scoped_reading_publishers()
  expect_true(all(vapply(publishers, is.function, logical(1))))
  expect_setequal(names(publishers),
                  c("demographie", "habitat", "economie", "milieux"))
})

scoped_source_fixture <- function() {
  list(
    target_sources = list(
      datasets = data.frame(
        source_id = c("shared_source", "new_source"),
        name = c("Shared source", "New source"), stringsAsFactors = FALSE),
      vintages = data.frame(
        source_id = c("shared_source", "new_source"),
        vintage_id = c("2025/2025-01-01", "2025/2025-01-01"),
        version = "2025", reference_date = as.Date("2025-01-01"),
        publication_date = as.Date("2025-01-02"),
        stringsAsFactors = FALSE)),
    retire_sources = list(
      datasets = data.frame(source_id = "retired_source",
                            name = "Retired source", stringsAsFactors = FALSE),
      vintages = data.frame(
        source_id = "retired_source", vintage_id = "2025/2025-01-01",
        version = "2025", reference_date = as.Date("2025-01-01"),
        publication_date = as.Date("2025-01-02"),
        stringsAsFactors = FALSE)))
}

scoped_live_source_fixture <- function() {
  list(
    datasets = data.frame(source_id = "shared_source", name = "Shared source",
                          stringsAsFactors = FALSE),
    vintages = data.frame(
      source_id = "shared_source", vintage_id = "2025/2025-01-01",
      version = "2025", reference_date = as.Date("2025-01-01"),
      publication_date = as.Date("2025-01-02"), stringsAsFactors = FALSE))
}

test_that("the source guard accepts shared rows and records missing target rows", {
  guard <- scoped_source_guard(scoped_source_fixture(),
                               scoped_live_source_fixture())
  expect_equal(nrow(guard$mismatches), 0L)
  expect_identical(guard$absent$datasets, "new_source")
  expect_identical(guard$absent$vintages,
                   scoped_source_vintage_key("new_source", "2025/2025-01-01"))
})

test_that("the source guard refuses a newer shared source row", {
  live <- scoped_live_source_fixture()
  live$datasets$name <- "Newer shared source"
  live$vintages$version <- "2026"
  guard <- scoped_source_guard(scoped_source_fixture(), live)
  expect_equal(nrow(guard$mismatches), 2L)
  expect_true(any(guard$mismatches$marker == "source_dataset[shared_source]"))
  expect_true(any(guard$mismatches$marker ==
                    "source_vintage[shared_source|2025/2025-01-01]"))
})

test_that("the source retirement combines current-only and absent target rows", {
  plan <- scoped_source_fixture()
  absent <- list(
    datasets = "new_source",
    vintages = scoped_source_vintage_key("new_source", "2025/2025-01-01"))
  candidates <- scoped_source_retirement(plan, absent)
  expect_setequal(candidates$datasets$source_id,
                  c("retired_source", "new_source"))
  expect_setequal(candidates$vintages$source_id,
                  c("retired_source", "new_source"))
})

test_that("the projection source set unions scalar and profile sources", {
  scalar <- list(scalar = list(
    datasets = data.frame(source_id = "scalar_source", name = "Scalar",
                          stringsAsFactors = FALSE),
    vintages = data.frame(
      source_id = "scalar_source", vintage_id = "v1", version = "2025",
      reference_date = as.Date("2025-01-01"),
      publication_date = as.Date("2025-01-02"), stringsAsFactors = FALSE)))
  profiles <- list(
    list(datasets = data.frame(source_id = "profile_source", name = "Profile",
                               stringsAsFactors = FALSE),
         vintages = data.frame(
           source_id = "profile_source", vintage_id = "v1", version = "2025",
           reference_date = as.Date("2025-01-01"),
           publication_date = as.Date("2025-01-02"), stringsAsFactors = FALSE)))
  sources <- scoped_projection_sources(scalar, profiles)
  expect_setequal(sources$datasets$source_id,
                  c("scalar_source", "profile_source"))
  expect_setequal(sources$vintages$source_id,
                  c("scalar_source", "profile_source"))
  expect_identical(scoped_source_difference(sources, sources)$datasets$source_id,
                   character())
})
