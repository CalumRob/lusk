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

# Explicit registered replacement intent (#1037) --------------------------------

# The fixture expands one scoped scalar from commune-only to commune+region,
# exactly the shape of a legitimate level expansion: the descriptor advances,
# the existing facts are unchanged, and one fact appears at the new level.
scoped_expanded_fixture <- function() {
  expanded <- scoped_scalar_fixture()
  scoped <- expanded$descriptors$indicator_id == "scoped_scalar"
  expanded$descriptors$allowed_levels[scoped] <-
    I(list(c("commune", "region")))
  expanded$descriptors$descriptor_version[scoped] <- "v2"
  expanded$facts <- rbind(expanded$facts, data.frame(
    indicator_id = "scoped_scalar", territory_id = "53",
    territory_type = "region", value = 5, status = "measured",
    support_count = NA_integer_, denominator_count = NA_integer_,
    stringsAsFactors = FALSE))
  expanded$provenance <- rbind(expanded$provenance, data.frame(
    indicator_id = "scoped_scalar", territory_id = "53",
    source_id = "fixture_source", vintage_id = "2025/2025-01-01",
    stringsAsFactors = FALSE))
  expanded$eligible_territories <- rbind(expanded$eligible_territories,
    data.frame(territory_id = "53", territory_type = "region",
               stringsAsFactors = FALSE))
  expanded
}

scoped_replacement_delta <- function(target, current, scope = "scoped_scalar")
  scoped_snapshot_delta(list(scalar = target), list(scalar = current), scope,
                        intent = "replacement")

test_that("the default intent still rejects a both-present scope", {
  generation <- scoped_expanded_fixture()
  expect_error(
    scoped_snapshot_delta(list(scalar = generation), list(scalar = generation),
                          "scoped_scalar"),
    "exactly one generation")
})

test_that("replacement accepts an additive level expansion and its reverse", {
  baseline <- scoped_scalar_fixture()
  candidate <- scoped_expanded_fixture()
  forward <- scoped_replacement_delta(candidate, baseline)
  expect_identical(forward$intent, "replacement")
  expect_identical(forward$direction, "forward")
  expect_identical(forward$indicators$added_levels, "region")
  expect_identical(forward$indicators$facts_added, 1L)
  expect_identical(forward$indicators$facts_removed, 0L)
  expect_identical(forward$indicators$facts_shared, 2L)
  expect_identical(nrow(forward$added_facts), 1L)
  expect_true(all(forward$added_facts$territory_type == "region"))

  recovery <- scoped_replacement_delta(baseline, candidate)
  expect_identical(recovery$direction, "recovery")
  expect_identical(recovery$indicators$removed_levels, "region")
  expect_identical(recovery$indicators$facts_removed, 1L)
  expect_identical(recovery$indicators$facts_added, 0L)
})

test_that("replacement refuses a pure one-sided scope", {
  baseline <- retained_baseline_scalar(scoped_scalar_fixture(), "scoped_scalar")
  candidate <- scoped_expanded_fixture()
  expect_error(
    scoped_snapshot_delta(list(scalar = candidate), list(scalar = baseline),
                          "scoped_scalar", intent = "replacement"),
    "EVERY named scoped indicator in both")
})

test_that("replacement refuses mixed presence instead of widening the mode", {
  baseline <- retained_baseline_scalar(scoped_scalar_fixture(), "scoped_scalar")
  candidate <- scoped_expanded_fixture()
  expect_error(
    scoped_snapshot_delta(list(scalar = candidate), list(scalar = baseline),
                          c("kept_scalar", "scoped_scalar"),
                          intent = "replacement"),
    "mixed presence.*refused|EVERY named scoped indicator in both")
  expect_error(
    scoped_snapshot_delta(list(scalar = candidate), list(scalar = baseline),
                          "scoped_scalar", intent = "replacement"),
    "missing from current: scoped_scalar")
})

test_that("numeric facts are compared exactly, not through string casts", {
  baseline <- scoped_scalar_fixture()
  candidate <- scoped_expanded_fixture()
  candidate$facts$value[candidate$facts$indicator_id == "scoped_scalar" &
    candidate$facts$territory_id == "22001"] <-
    candidate$facts$value[candidate$facts$indicator_id == "scoped_scalar" &
      candidate$facts$territory_id == "22001"] * (1 + .Machine$double.eps)
  expect_error(scoped_replacement_delta(candidate, baseline),
               "changes an existing fact")
})

test_that("fact row order does not change the replacement proof", {
  baseline <- scoped_scalar_fixture()
  candidate <- scoped_expanded_fixture()
  candidate$facts <- candidate$facts[rev(seq_len(nrow(candidate$facts))), ,
                                     drop = FALSE]
  candidate$provenance <- candidate$provenance[
    rev(seq_len(nrow(candidate$provenance))), , drop = FALSE]
  forward <- scoped_replacement_delta(candidate, baseline)
  expect_identical(forward$direction, "forward")
})

test_that("true NA facts stay equal and NA/NaN is not silently merged", {
  make_na <- function(generation) {
    row <- generation$facts$indicator_id == "scoped_scalar" &
      generation$facts$territory_id == "22002"
    generation$facts$value[row] <- NA_real_
    generation$facts$status[row] <- "not_available"
    generation
  }
  baseline <- make_na(scoped_scalar_fixture())
  candidate <- make_na(scoped_expanded_fixture())
  forward <- scoped_replacement_delta(candidate, baseline)
  expect_identical(forward$direction, "forward")
  changed <- candidate
  row <- changed$facts$indicator_id == "scoped_scalar" &
    changed$facts$territory_id == "22002"
  changed$facts$value[row] <- NaN
  expect_error(scoped_replacement_delta(changed, baseline),
               "changes an existing fact")
})

test_that("replacement accepts multi-source provenance and refuses a change", {
  add_second_source <- function(generation, vintage = "2025/2025-02-01") {
    generation$datasets <- rbind(generation$datasets, data.frame(
      source_id = "fixture_source_2", name = "Fixture second",
      stringsAsFactors = FALSE))
    generation$vintages <- rbind(generation$vintages, data.frame(
      source_id = "fixture_source_2", vintage_id = vintage, version = "2025",
      reference_date = as.Date("2025-02-01"),
      publication_date = as.Date("2025-02-02"), stringsAsFactors = FALSE))
    generation$provenance <- rbind(generation$provenance, data.frame(
      indicator_id = "scoped_scalar", territory_id = "22001",
      source_id = "fixture_source_2", vintage_id = vintage,
      stringsAsFactors = FALSE))
    generation
  }
  baseline <- add_second_source(scoped_scalar_fixture())
  candidate <- add_second_source(scoped_expanded_fixture())
  forward <- scoped_replacement_delta(candidate, baseline)
  expect_identical(forward$direction, "forward")
  changed <- add_second_source(scoped_expanded_fixture(),
                               vintage = "2025/2025-03-01")
  expect_error(scoped_replacement_delta(changed, baseline),
               "changes provenance")
})

test_that("replacement refuses a change outside the scoped indicators", {
  baseline <- scoped_scalar_fixture()
  candidate <- scoped_expanded_fixture()
  candidate$facts$value[candidate$facts$indicator_id == "kept_scalar"] <- 99
  expect_error(scoped_replacement_delta(candidate, baseline),
               "outside the scoped indicators")
})

test_that("replacement refuses a deleted existing fact", {
  baseline <- scoped_scalar_fixture()
  candidate <- scoped_expanded_fixture()
  candidate$facts <- candidate$facts[!(
    candidate$facts$indicator_id == "scoped_scalar" &
      candidate$facts$territory_id == "22002"), , drop = FALSE]
  candidate$provenance <- candidate$provenance[!(
    candidate$provenance$indicator_id == "scoped_scalar" &
      candidate$provenance$territory_id == "22002"), , drop = FALSE]
  expect_error(scoped_replacement_delta(candidate, baseline),
               "removes 1 existing fact")
})

test_that("replacement refuses a new fact at an already admitted level", {
  baseline <- scoped_scalar_fixture()
  candidate <- scoped_scalar_fixture()
  candidate$facts <- rbind(candidate$facts, data.frame(
    indicator_id = "scoped_scalar", territory_id = "22003",
    territory_type = "commune", value = 7, status = "measured",
    support_count = NA_integer_, denominator_count = NA_integer_,
    stringsAsFactors = FALSE))
  candidate$provenance <- rbind(candidate$provenance, data.frame(
    indicator_id = "scoped_scalar", territory_id = "22003",
    source_id = "fixture_source", vintage_id = "2025/2025-01-01",
    stringsAsFactors = FALSE))
  candidate$eligible_territories <- rbind(candidate$eligible_territories,
    data.frame(territory_id = "22003", territory_type = "commune",
               stringsAsFactors = FALSE))
  expect_error(scoped_replacement_delta(candidate, baseline),
               "without changing its allowed levels")
})

test_that("replacement refuses a changed shared fact value", {
  baseline <- scoped_scalar_fixture()
  candidate <- scoped_expanded_fixture()
  candidate$facts$value[candidate$facts$indicator_id == "scoped_scalar" &
    candidate$facts$territory_id == "22001"] <- 42
  expect_error(scoped_replacement_delta(candidate, baseline),
               "changes an existing fact")
})

test_that("replacement refuses descriptor changes the capability does not own", {
  baseline <- scoped_scalar_fixture()
  candidate <- scoped_expanded_fixture()
  candidate$descriptors$label[candidate$descriptors$indicator_id ==
                                "scoped_scalar"] <- "Relabelled"
  expect_error(scoped_replacement_delta(candidate, baseline),
               "outside allowed_levels")
})

test_that("replacement refuses a level change without a descriptor token", {
  baseline <- scoped_scalar_fixture()
  candidate <- scoped_expanded_fixture()
  candidate$descriptors$descriptor_version[
    candidate$descriptors$indicator_id == "scoped_scalar"] <- "v1"
  expect_error(scoped_replacement_delta(candidate, baseline),
               "without advancing descriptor_version")
})

test_that("replacement refuses a no-op candidate", {
  generation <- scoped_expanded_fixture()
  expect_error(scoped_replacement_delta(generation, generation), "no-op")
})

test_that("replacement refuses mixed directions across scoped indicators", {
  baseline <- scoped_scalar_fixture()
  baseline$descriptors$allowed_levels[
    baseline$descriptors$indicator_id == "kept_scalar"] <-
    I(list(c("commune", "region")))
  baseline$descriptors$descriptor_version[
    baseline$descriptors$indicator_id == "kept_scalar"] <- "v2"
  baseline$facts <- rbind(baseline$facts, data.frame(
    indicator_id = "kept_scalar", territory_id = "53",
    territory_type = "region", value = 6, status = "measured",
    support_count = NA_integer_, denominator_count = NA_integer_,
    stringsAsFactors = FALSE))
  baseline$provenance <- rbind(baseline$provenance, data.frame(
    indicator_id = "kept_scalar", territory_id = "53",
    source_id = "fixture_source", vintage_id = "2025/2025-01-01",
    stringsAsFactors = FALSE))
  baseline$eligible_territories <- rbind(baseline$eligible_territories,
    data.frame(territory_id = "53", territory_type = "region",
               stringsAsFactors = FALSE))
  candidate <- scoped_expanded_fixture()
  expect_error(scoped_replacement_delta(candidate, baseline,
                                        c("scoped_scalar", "kept_scalar")),
               "mixed directions")
})

test_that("the replacement intent accepts registered scopes and nothing else", {
  expect_identical(scoped_publication_intent(""), "missing_only")
  expect_identical(scoped_publication_intent(NULL), "missing_only")
  expect_identical(scoped_publication_intent("missing-only"), "missing_only")
  expect_identical(scoped_publication_intent("replacement"), "replacement")
  expect_error(scoped_publication_intent("force"), "must be")
  expect_error(scoped_publication_scope("", "replacement"),
               "explicit registered scalar scope")
  expect_error(scoped_publication_scope("mobilite:not_registered",
                                        "replacement"),
               "unregistered indicators")
  scope <- scoped_publication_scope(
    "mobilite:bornes_ev_par_station_service", "replacement")
  expect_identical(scope$intent, "replacement")
  expect_identical(scope$scope_ids, "bornes_ev_par_station_service")
  expect_false("bornes_ev_par_station_service" %in%
                 scoped_publication_scope("", "missing_only")$scope_ids)
})

test_that("shared source drift is refused before any connection", {
  baseline <- scoped_source_fixture()
  candidate <- scoped_source_fixture()
  expect_identical(scoped_shared_source_drift(candidate$target_sources,
    baseline$target_sources), character())
  candidate$target_sources$vintages$version <- "2026"
  drift <- scoped_shared_source_drift(candidate$target_sources,
                                      baseline$target_sources)
  expect_true(any(grepl("source_vintage", drift)))
  candidate$target_sources$datasets$name <- "Renamed"
  drift <- scoped_shared_source_drift(candidate$target_sources,
                                      baseline$target_sources)
  expect_true(any(grepl("source_dataset", drift)))
})

test_that("candidate source clocks are validated honestly", {
  sources <- scoped_source_fixture()$target_sources
  expect_invisible(scoped_source_clocks_valid(sources))
  sources$vintages$publication_date <- as.Date("2024-12-31")
  expect_error(scoped_source_clocks_valid(sources),
               "publication date before its reference")
})

scoped_preview_plan <- function(baseline, candidate) {
  delta <- scoped_replacement_delta(candidate, baseline)
  list(
    intent = "replacement", direction = delta$direction,
    rejection = NULL,
    replacement_indicators = delta$indicators,
    replacement_added_facts = delta$added_facts,
    replacement_removed_facts = delta$removed_facts,
    target_dir = "candidate", current_dir = "baseline",
    reference = "ref-v1", scope_ids = "scoped_scalar",
    target_snapshot = list(scalar = candidate),
    current_snapshot = list(scalar = baseline),
    target_scalar_version = "scalar-candidate",
    current_scalar_version = "scalar-base",
    target_comparison_version = "comparison-candidate",
    current_comparison_version = "comparison-base",
    profile_owners = "distribution_dpe",
    bound_profiles = "distribution_dpe",
    target_sources = scoped_source_fixture()$target_sources,
    current_sources = scoped_source_fixture()$target_sources,
    retire_sources = list(
      datasets = scoped_source_fixture()$target_sources$datasets[0, ,
        drop = FALSE],
      vintages = scoped_source_fixture()$target_sources$vintages[0, ,
        drop = FALSE]),
    target_profile_descriptors = data.frame(
      indicator_id = "distribution_dpe",
      descriptor_version = "dpe-v1",
      required_scalar_version = "scalar-candidate",
      stringsAsFactors = FALSE),
    current_profile_descriptors = data.frame(
      indicator_id = "distribution_dpe",
      descriptor_version = "dpe-v1",
      required_scalar_version = "scalar-base",
      stringsAsFactors = FALSE),
    target_profile_version = "profile-candidate",
    current_profile_version = "profile-base",
    target_profile_comparison_version = "profile-comparison-candidate",
    current_profile_comparison_version = "profile-comparison-base",
    reading_owners = "habitat",
    target_reading_version = "habitat-v1",
    current_reading_version = "habitat-v1",
    target_linked_version = "linked-candidate",
    current_linked_version = "linked-base")
}

test_that("the preview is honest, complete and write-free", {
  baseline <- scoped_scalar_fixture()
  candidate <- scoped_expanded_fixture()
  preview <- scoped_publication_preview(scoped_preview_plan(baseline, candidate),
                                        theme = "mobilite")
  expect_false(preview$writes)
  expect_false(preview$database)
  expect_false(preview$guard$evaluated)
  expect_identical(preview$theme, "mobilite")
  expect_identical(preview$direction, "forward")
  expect_identical(preview$snapshot$before$scope_facts, 2L)
  expect_identical(preview$snapshot$after$scope_facts, 3L)
  expect_identical(preview$snapshot$before$status_counts[["measured"]], 2L)
  expect_identical(preview$snapshot$after$status_counts[["measured"]], 3L)
  expect_identical(nrow(preview$added_facts), 1L)
  expect_identical(nrow(preview$removed_facts), 0L)
  expect_identical(preview$sources$before$vintages$version, "2025")
  lines <- scoped_publication_preview_lines(preview)
  expect_true(any(grepl("writes: none", lines, fixed = TRUE)))
  expect_true(any(grepl("scoped_scalar: forward", lines, fixed = TRUE)))
  expect_true(any(grepl("(+region)", lines, fixed = TRUE)))
  expect_true(any(grepl("scalar version: scalar-base -> scalar-candidate",
                        lines, fixed = TRUE)))
  expect_true(any(grepl("source rows to upsert: 2 datasets / 2 vintages",
                        lines, fixed = TRUE)))
  expect_true(any(grepl("territory_reference = ref-v1", lines, fixed = TRUE)))
  expect_true(any(grepl("Not exercised by this preview", lines, fixed = TRUE)))
})

test_that("the target marker expectations use the validated write generation", {
  plan <- scoped_plan_fixture()
  plan$target_scalar_version <- "scalar-target"
  plan$target_comparison_version <- "comparison-target"
  plan$target_profile_version <- "profile-target"
  plan$target_profile_comparison_version <- "profile-comparison-target"
  plan$target_profile_descriptors <- data.frame(
    indicator_id = "distribution_dpe", descriptor_version = "dpe-v2",
    required_scalar_version = "scalar-target", stringsAsFactors = FALSE)
  plan$target_reading_version <- "habitat-v1"
  plan$target_linked_version <- "linked-target"
  target <- scoped_target_markers(plan)
  expect_identical(target$scalar, "scalar-target")
  expect_identical(target$profile, "profile-target")
  expect_identical(target$profile_comparison, "profile-comparison-target")
  expect_identical(target$linked, "linked-target")
  expect_identical(target$profile_descriptors, plan$target_profile_descriptors)
})

test_that("frozen profile publication refuses a changed projection", {
  profile <- list(descriptor = list(indicator_id = "structure_age"),
                  facts = data.frame(), axes = data.frame(),
                  provenance = data.frame(), datasets = data.frame(),
                  vintages = data.frame(), eligible_territories = data.frame())
  expect_error(
    publish_declared_profiles_projection(list(structure_age = profile), NULL,
      expected_version = paste(rep("0", 32), collapse = "")),
    "does not match the validated plan")
})

test_that("the stripped snapshot keeps its artifact row order for versions", {
  target <- scoped_scalar_fixture()
  current <- retained_baseline_scalar(scoped_scalar_fixture(), "scoped_scalar")
  current$facts <- current$facts[rev(seq_len(nrow(current$facts))), ,
                                 drop = FALSE]
  delta <- scoped_snapshot_delta(list(scalar = target), list(scalar = current),
                                 "scoped_scalar")
  expect_identical(delta$direction, "forward")
  expect_identical(delta$without_scope$facts,
                   retained_baseline_scalar(target, "scoped_scalar")$facts)
})
