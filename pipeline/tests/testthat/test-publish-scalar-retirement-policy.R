test_that("scalar completeness is checked before a same-version no-op", {
  projection <- list(
    facts=data.frame(indicator_id="fixture_scalar", territory_id="22001",
      territory_type="commune", value=1, status="measured", support_count=1L,
      denominator_count=1L),
    descriptors=data.frame(indicator_id="fixture_scalar", theme_id="demographie",
      allowed_sources=I(list("fixture")), label="Fixture", unit="count",
      direction="high", comparison_facet=NA_character_,
      allowed_levels=I(list("commune")), denominator_semantics="units",
      completeness="sparse", descriptor_version="1"),
    provenance=data.frame(indicator_id="fixture_scalar", territory_id="22001",
      source_id="fixture", vintage_id="v1"),
    datasets=data.frame(source_id="fixture", name="Fixture"),
    vintages=data.frame(source_id="fixture", vintage_id="v1", version="v1",
      reference_date=as.Date(NA), publication_date=as.Date(NA)),
    eligible_territories=data.frame(territory_id="22001", territory_type="commune"))
  version <- scalar_content_version(projection)
  checked <- FALSE
  db <- list(
    transaction=function(expr) force(expr),
    marker=function(name) data.frame(content_version=version,
      reference_content_version="reference-v1"),
    reference_marker=function() data.frame(content_version="reference-v1",
      row_count=1L, actual_rows=1L),
    validate_snapshot=function(candidate, retired_indicator_ids) {
      checked <<- TRUE
      assert_complete_scalar_snapshot(c("fixture_scalar", "unexpected_live_scalar"),
        candidate, retired_indicator_ids)
      list(pending_retirement=FALSE)
    },
    validate_territories=function(territories, descriptors) invisible(NULL),
    replace=function(projection, version) stop("same-version no-op must not replace"),
    set_reference_version=function(version) stop("same-version no-op must not rebind"))
  registry <- register_scalar_publisher(list(), "same_version", function(x) projection,
    function(value, adapter, content_version) adapter$replace(value, content_version))

  expect_error(publish_registered_scalar(registry, "same_version", NULL, db),
    "unexpected_live_scalar")
  expect_true(checked)
})

test_that("approved live retirement forces same-version replacement and leaves comparison publication stale", {
  projection <- list(
    facts=data.frame(indicator_id="fixture_scalar", territory_id="22001",
      territory_type="commune", value=1, status="measured", support_count=1L,
      denominator_count=1L),
    descriptors=data.frame(indicator_id="fixture_scalar", theme_id="demographie",
      allowed_sources=I(list("fixture")), label="Fixture", unit="count",
      direction="high", comparison_facet=NA_character_,
      allowed_levels=I(list("commune")), denominator_semantics="units",
      completeness="sparse", descriptor_version="1"),
    provenance=data.frame(indicator_id="fixture_scalar", territory_id="22001",
      source_id="fixture", vintage_id="v1"),
    datasets=data.frame(source_id="fixture", name="Fixture"),
    vintages=data.frame(source_id="fixture", vintage_id="v1", version="v1",
      reference_date=as.Date(NA), publication_date=as.Date(NA)),
    eligible_territories=data.frame(territory_id="22001", territory_type="commune"))
  version <- scalar_content_version(projection)
  retired_id <- "legacy_fixture_scalar"

  new_adapter <- function() {
    state <- new.env(parent=emptyenv())
    state$live_ids <- c("fixture_scalar", retired_id)
    state$replace_calls <- 0L
    state$comparison_groups <- data.frame(
      indicator_id=c("fixture_scalar", retired_id), stringsAsFactors=FALSE)
    state$comparison_territories <- data.frame(
      indicator_id=c("fixture_scalar", retired_id), stringsAsFactors=FALSE)
    state$comparison_marker <- data.frame(scalar_content_version=version,
      reference_content_version="reference-v1", group_row_count=2L,
      territory_row_count=2L)
    adapter <- list(
      transaction=function(expr) force(expr),
      marker=function(name) data.frame(content_version=version,
        reference_content_version="reference-v1"),
      reference_marker=function() data.frame(content_version="reference-v1",
        row_count=1L, actual_rows=1L),
      validate_snapshot=function(candidate, retired_indicator_ids) {
        assert_complete_scalar_snapshot(state$live_ids, candidate, retired_indicator_ids)
        omitted <- setdiff(state$live_ids, candidate$descriptors$indicator_id)
        list(pending_retirement=length(intersect(omitted, retired_indicator_ids)) > 0L)
      },
      validate_territories=function(territories, descriptors) invisible(NULL),
      replace=function(candidate, content_version, retired_indicator_ids=character()) {
        state$replace_calls <- state$replace_calls + 1L
        assert_complete_scalar_snapshot(state$live_ids, candidate, retired_indicator_ids)
        omitted <- intersect(setdiff(state$live_ids, candidate$descriptors$indicator_id),
          retired_indicator_ids)
        state$live_ids <- candidate$descriptors$indicator_id
        state$comparison_groups <- state$comparison_groups[
          !state$comparison_groups$indicator_id %in% omitted, , drop=FALSE]
        state$comparison_territories <- state$comparison_territories[
          !state$comparison_territories$indicator_id %in% omitted, , drop=FALSE]
        invisible(NULL)
      },
      set_reference_version=function(version) stop("matching dependency must not rebind"))
    list(adapter=adapter, state=state)
  }
  registry <- register_scalar_publisher(list(), "same_version_retirement",
    function(x) projection,
    function(value, adapter, content_version) adapter$replace(value, content_version))

  strict <- new_adapter()
  expect_error(publish_registered_scalar(registry, "same_version_retirement", NULL,
    strict$adapter), "omitted registered indicators")
  expect_identical(strict$state$replace_calls, 0L)

  approved <- new_adapter()
  original_comparison_marker <- approved$state$comparison_marker
  first <- publish_registered_scalar(registry, "same_version_retirement", NULL,
    approved$adapter, retired_indicator_ids=retired_id)
  expect_true(first$changed)
  expect_true(first$retirement_repaired)
  expect_identical(approved$state$replace_calls, 1L)
  expect_setequal(approved$state$live_ids, projection$descriptors$indicator_id)
  expect_identical(approved$state$comparison_marker, original_comparison_marker)
  expect_identical(approved$state$comparison_groups$indicator_id, "fixture_scalar")
  expect_identical(approved$state$comparison_territories$indicator_id, "fixture_scalar")
  expect_gt(approved$state$comparison_marker$group_row_count[[1L]],
    nrow(approved$state$comparison_groups))
  expect_gt(approved$state$comparison_marker$territory_row_count[[1L]],
    nrow(approved$state$comparison_territories))

  completed <- publish_registered_scalar(registry, "same_version_retirement", NULL,
    approved$adapter, retired_indicator_ids=retired_id)
  expect_false(completed$changed)
  expect_false(completed$retirement_repaired)
  expect_identical(approved$state$replace_calls, 1L)
  expect_identical(approved$state$comparison_marker, original_comparison_marker)
})
