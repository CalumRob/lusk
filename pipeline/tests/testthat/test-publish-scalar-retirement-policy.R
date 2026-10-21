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
