test_that("scalar publisher validates registered canonical fixture facts", {
  facts <- data.frame(indicator_id="fixture_scalar", territory_id="22001",
    territory_type="commune", value=0, status="measured", support_count=1L,
    denominator_count=1L, source_id="fixture", vintage_id="2024")
  descriptors <- data.frame(indicator_id="fixture_scalar", allowed_levels=I(list("commune")),
    direction="high", descriptor_version="1", source_id="fixture")
  expect_invisible(validate_scalar_projection(facts, descriptors))
  expect_error(validate_scalar_projection(rbind(facts, facts), descriptors), "Duplicate")
  bad <- facts; bad$value <- NA_real_
  expect_error(validate_scalar_projection(bad, descriptors), "null/status")
  descriptors$source_id <- "other"
  expect_error(validate_scalar_projection(facts, descriptors), "source disagreement")
  registry <- register_scalar_publisher(list(), "fixture", identity, identity)
  expect_named(registry, "fixture")
  expect_error(register_scalar_publisher(registry, "fixture", identity, identity), "duplicate")
})
