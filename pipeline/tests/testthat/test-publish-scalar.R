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
  bad <- facts; bad$status <- NA_character_
  expect_error(validate_scalar_projection(bad, descriptors), "identity/key")
  invalid_descriptor <- descriptors; invalid_descriptor$label <- ""
  expect_error(validate_scalar_projection(facts, invalid_descriptor), "descriptor fields")
  invalid_descriptor <- descriptors; invalid_descriptor$allowed_levels <- I(list("unknown"))
  expect_error(validate_scalar_projection(facts, invalid_descriptor), "descriptor fields")
  descriptors$source_id <- "other"
  expect_error(validate_scalar_projection(facts, descriptors), "source disagreement")
  descriptors$source_id <- "fixture"
  dense <- descriptors; dense$completeness <- "dense_complete"
  eligible <- data.frame(territory_id=c("22001", "22002"),
                         territory_type=c("commune", "commune"))
  expect_error(validate_scalar_projection(facts, dense, eligible), "Dense scalar")
  expect_error(validate_scalar_projection(facts, descriptors,
    data.frame(territory_id="99999", territory_type="commune")), "unknown eligible territory")
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
        source_id=c(f$source_id, "fixture_secondary"), vintage_id=c(f$vintage_id, "2023")),
      datasets=data.frame(source_id=c("fixture", "fixture_secondary"), name=c("Fixture", "Secondary")),
      vintages=data.frame(source_id=c("fixture", "fixture_secondary"),
        vintage_id=c("2024", "2023"), version=c("2024", "2023"),
        reference_date=as.Date(c(NA, NA)), publication_date=as.Date(c(NA, NA))),
      eligible_territories=data.frame(territory_id="22001", territory_type="commune"))
  }
  state <- new.env(parent=emptyenv()); state$markers <- list(); state$payload <- NULL
  state$reference_version <- "territory-v1"
  state$scalar_reference_version <- NULL
  state$territories <- data.frame(territory_id="22001", territory_type="commune")
  db <- list(
    transaction=function(expr) {
      old_markers <- state$markers; old_payload <- state$payload
      old_scalar_reference <- state$scalar_reference_version
      tryCatch(force(expr), error=function(e) {
        state$markers <- old_markers; state$payload <- old_payload
        state$scalar_reference_version <- old_scalar_reference; stop(e)
      })
    },
    marker=function(name) {
      version <- state$markers[[name]]
      if (is.null(version)) data.frame(content_version=character()) else
        data.frame(content_version=version, reference_content_version=state$scalar_reference_version)
    },
    reference_marker=function() data.frame(content_version=state$reference_version),
    validate_territories=function(territories, descriptors) {
      expected <- unique(territories[c("territory_id", "territory_type")])
      actual <- state$territories[state$territories$territory_type %in%
        unique(unlist(descriptors$allowed_levels)), , drop=FALSE]
      if (!setequal(paste(expected$territory_id, expected$territory_type),
                    paste(actual$territory_id, actual$territory_type)))
        stop("territory universe mismatch")
    },
    set_reference_version=function(version) { state$scalar_reference_version <- version },
    replace=function(value, version) {
      state$payload <- value
      if (identical(value$facts$value[[1]], 9)) stop("simulated SQL failure")
      state$markers$scalar_observation <- version
      state$scalar_reference_version <- state$reference_version
    })
  registry <- register_scalar_publisher(list(), "fixture", projection,
    function(value, db, version) db$replace(value, version))
  first <- publish_registered_scalar(registry, "fixture", list(value=0), db)
  expect_true(first$changed)
  state$markers$building_ramp <- "building-v1"
  marker <- state$markers$scalar_observation
  expect_false(publish_registered_scalar(registry, "fixture", list(value=0), db)$changed)
  bad_provenance_registry <- register_scalar_publisher(list(), "bad-provenance",
    project=function(x) { p <- projection(x); p$provenance$vintage_id[[2]] <- NA_character_; p },
    function(value, db, version) db$replace(value, version))
  expect_error(publish_registered_scalar(bad_provenance_registry, "bad-provenance", list(value=0), db),
               "provenance associations")
  bad_universe_registry <- register_scalar_publisher(list(), "bad-universe",
    project=function(x) { p <- projection(x); p$eligible_territories <- rbind(p$eligible_territories,
      data.frame(territory_id="99999", territory_type="commune")); p },
    function(value, db, version) db$replace(value, version))
  expect_error(publish_registered_scalar(bad_universe_registry, "bad-universe", list(value=0), db),
               "territory universe mismatch")
  state$reference_version <- "territory-v2"
  compatibility <- publish_registered_scalar(registry, "fixture", list(value=0), db)
  expect_false(compatibility$changed)
  expect_true(compatibility$compatibility_updated)
  expect_identical(state$reference_version, "territory-v2")
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

test_that("fixture publisher projects canonical facts with independent parity and metadata versioning", {
  payload <- compute_payload(load_fixture())
  metadata <- jsonlite::fromJSON(testthat::test_path("../../inst/extdata/theme-metadata/theme_demographie.json"),
                                 simplifyVector=FALSE)
  expected <- payload$indicateurs[payload$indicateurs$key == "densite" &
    payload$indicateurs$territoire == "22001", , drop=FALSE]
  projected <- project_fixture_scalar(payload, metadata)
  observed <- projected$facts[projected$facts$territory_id == "22001", , drop=FALSE]
  expect_equal(observed$value[[1]], expected$value[[1]])
  expect_true("source_id" %in% names(projected$descriptors))
  expect_invisible(validate_scalar_projection(projected$facts, projected$descriptors,
                                               projected$eligible_territories))
  changed_metadata <- metadata
  changed_metadata$indicator_pages$densite$label <- "Densité modifiée"
  changed <- project_fixture_scalar(payload, changed_metadata)
  expect_false(identical(scalar_content_version(projected), scalar_content_version(changed)))
})
