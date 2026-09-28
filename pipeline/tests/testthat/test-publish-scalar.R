test_that("scalar publisher validates registered canonical fixture facts", {
  canonical <- compute_payload(load_fixture())$indicateurs
  fixture_fact <- canonical[canonical$key == "densite" & canonical$territoire == "22001", , drop=FALSE]
  expect_equal(nrow(fixture_fact), 1L)
  facts <- data.frame(indicator_id="fixture_scalar", territory_id="22001",
    territory_type="commune", value=fixture_fact$value[[1L]], status="measured", support_count=1L,
    denominator_count=1L, source_id="fixture", vintage_id="2024")
  descriptors <- data.frame(indicator_id="fixture_scalar", source_id="fixture", label="Fixture",
    unit="count", direction="high", comparison_facet=NA_character_,
    allowed_levels=I(list("commune")), denominator_semantics="units",
    completeness="sparse", descriptor_version="1")
  expect_invisible(validate_scalar_projection(facts, descriptors))
  expect_identical(facts$value[[1L]], fixture_fact$value[[1L]])
  expect_error(validate_scalar_projection(rbind(facts, facts), descriptors), "Duplicate")
  bad <- facts; bad$value <- NA_real_
  expect_error(validate_scalar_projection(bad, descriptors), "null/status")
  descriptors$source_id <- "other"
  expect_error(validate_scalar_projection(facts, descriptors), "source disagreement")
  descriptors$source_id <- "fixture"
  dense <- descriptors; dense$completeness <- "dense_complete"
  eligible <- data.frame(territory_id=c("22001", "22002"),
                         territory_type=c("commune", "commune"))
  expect_error(validate_scalar_projection(facts, dense, eligible), "Dense scalar")
  registered_publish <- function(projection, db, version) db$replace(projection, version)
  registry <- register_scalar_publisher(list(), "fixture", identity, registered_publish)
  expect_named(registry, "fixture")
  expect_error(register_scalar_publisher(registry, "fixture", identity, registered_publish), "duplicate")
})

test_that("registered publisher versions independently, retries DB-behind-local, and rolls back failures", {
  facts <- data.frame(indicator_id="fixture_scalar", territory_id="22001",
    territory_type="commune", value=0, status="measured", support_count=1L,
    denominator_count=1L, source_id="fixture", vintage_id="2024")
  descriptors <- data.frame(indicator_id="fixture_scalar", source_id="fixture", label="Fixture",
    unit="count", direction="high", comparison_facet=NA_character_,
    allowed_levels=I(list("commune")), denominator_semantics="units",
    completeness="sparse", descriptor_version="1")
  projection <- function(canonical) {
    f <- facts; f$value <- canonical$value
    list(facts=f, descriptors=descriptors,
      provenance=data.frame(indicator_id=f$indicator_id, territory_id=f$territory_id,
        source_id=f$source_id, vintage_id=f$vintage_id),
      datasets=data.frame(source_id="fixture", name="Fixture"),
      vintages=data.frame(source_id="fixture", vintage_id="2024", version="2024",
        reference_date=as.Date(NA), publication_date=as.Date(NA)),
      eligible_territories=data.frame(territory_id="22001", territory_type="commune"))
  }
  state <- new.env(parent=emptyenv()); state$markers <- list(); state$payload <- NULL
  db <- list(
    transaction=function(expr) {
      old_markers <- state$markers; old_payload <- state$payload
      tryCatch(force(expr), error=function(e) {
        state$markers <- old_markers; state$payload <- old_payload; stop(e)
      })
    },
    marker=function(name) {
      version <- state$markers[[name]]
      if (is.null(version)) data.frame(content_version=character()) else
        data.frame(content_version=version)
    },
    replace=function(value, version) {
      state$payload <- value
      if (identical(value$facts$value[[1]], 9)) stop("simulated SQL failure")
      state$markers$scalar_observation <- version
    })
  registry <- register_scalar_publisher(list(), "fixture", projection,
    function(value, db, version) db$replace(value, version))
  first <- publish_registered_scalar(registry, "fixture", list(value=0), db)
  expect_true(first$changed)
  state$markers$building_ramp <- "building-v1"
  marker <- state$markers$scalar_observation
  expect_false(publish_registered_scalar(registry, "fixture", list(value=0), db)$changed)
  local_new <- publish_registered_scalar(registry, "fixture", list(value=1), db)
  expect_true(local_new$changed)
  state$markers$scalar_observation <- marker
  expect_true(publish_registered_scalar(registry, "fixture", list(value=1), db)$changed)
  expect_identical(state$markers$scalar_observation, local_new$content_version)
  last_good <- state$markers$scalar_observation
  expect_error(publish_registered_scalar(registry, "fixture", list(value=9), db), "simulated SQL failure")
  expect_identical(state$markers$scalar_observation, last_good)
  expect_identical(state$markers$building_ramp, "building-v1")
})
