test_that("annual series preserves declared gaps and source vintage", {
  descriptor <- list(indicator_id="conso_enaf_annuel", axis_kind="year",
    axis_values=as.character(2011:2014), completeness="may_be_missing",
    comparison_point="2014", label="Consommation", unit="ha", direction="low",
    allowed_levels="commune", source_id="consoenaf", vintage_id="2025")
  points <- data.frame(indicator_id="conso_enaf_annuel", territory_id="22001",
    territory_type="commune", axis_value=c("2011","2013","2014"),
    observation_period=c("2011","2013","2014"), value=c(2,0,4),
    status="measured", source_id="consoenaf", vintage_id="2025")
  result <- validate_series_projection(points, descriptor)
  expect_identical(result$axis_value, c("2011","2013","2014"))
  expect_equal(result$value[result$axis_value == "2013"], 0)
  expect_false("2012" %in% result$axis_value)
  expect_error(validate_series_projection(rbind(points, points[1,]), descriptor), "duplicate")
  invalid <- points; invalid$axis_value[1] <- "2015"
  expect_error(validate_series_projection(invalid, descriptor), "Undeclared")
  bad_descriptor <- descriptor; bad_descriptor$comparison_point <- "2015"
  expect_error(validate_series_projection(points, bad_descriptor), "descriptor")
  no_direction <- descriptor; no_direction$direction <- "none"
  expect_error(validate_series_projection(points, no_direction), "descriptor")
  dense <- descriptor; dense$completeness <- "dense_complete"
  expect_error(validate_series_projection(points, dense), "Dense-complete")
  comparison <- series_comparison(data.frame(territory_id=c("a","b","c","d"),
    value=c(0,2,2,NA_real_)), "b", "low")
  expect_equal(comparison$median, 2)
  expect_equal(comparison$rank, 2L)
  expect_equal(comparison$tied, 2L)
  expect_equal(comparison$comparable_count, 3L)
})

test_that("conso ENAF projection follows canonical facts and descriptor-selected point", {
  payload <- compute_payload(communes_fixture_milieux_ocsge(), theme=theme_milieux())
  metadata <- jsonlite::read_json(testthat::test_path("../../inst/extdata/theme-metadata/theme_milieux.json"), simplifyVector=FALSE)
  registry <- register_conso_enaf_series_publisher(list(), metadata)
  projection <- registry$conso_enaf_annuel$project(payload)
  expect_identical(projection$descriptor$comparison_point,
    as.character(metadata$indicator_pages$conso_enaf_annuel$comparison$detail))
  expect_true(all(projection$points$axis_value %in% projection$descriptor$axis_values))
  canonical <- payload$indicateurs[payload$indicateurs$key == "conso_enaf_annuel", , drop=FALSE]
  expected <- canonical[canonical$territoire == projection$points$territory_id[1] &
    canonical$detail == projection$points$axis_value[1], "value"]
  expect_equal(projection$points$value[1], expected[[1]])
  expect_true(all(projection$points$source_id == projection$descriptor$source_id))
  expect_true(all(projection$points$vintage_id == projection$descriptor$vintage_id))
})

test_that("registered series publication is atomic, idempotent and rollback-safe", {
  descriptor <- list(indicator_id="fixture_series", axis_kind="year", axis_values="2020",
    completeness="may_be_missing", comparison_point="2020", label="fixture", unit="ha",
    direction="low", allowed_levels="commune", source_id="fixture", vintage_id="v1", descriptor_version="1")
  points <- data.frame(indicator_id="fixture_series", territory_id="t1", territory_type="commune",
    axis_value="2020", observation_period="2020", value=0, status="measured",
    source_id="fixture", vintage_id="v1")
  state <- new.env(parent=emptyenv()); state$marker <- NULL; state$marker_reference <- NULL
  state$reference <- "territory-v1"; state$projection <- NULL
  db <- list(transaction=function(expr) {
    before <- list(marker=state$marker, marker_reference=state$marker_reference, projection=state$projection)
    tryCatch(force(expr), error=function(e) {
      state$marker <- before$marker; state$marker_reference <- before$marker_reference
      state$projection <- before$projection; stop(e)
    })
  }, marker=function(name) {
    if (name == "territory_reference") return(data.frame(content_version=state$reference,
      reference_content_version=NA_character_))
    if (is.null(state$marker)) data.frame() else data.frame(content_version=state$marker,
      reference_content_version=state$marker_reference)
  },
  replace=function(projection, version) {
    state$projection <- projection; state$marker <- version; state$marker_reference <- state$reference
  })
  registry <- register_series_publisher(list(), "fixture", function(input) list(points=points, descriptor=descriptor),
    function(projection, db, version) db$replace(projection, version))
  expect_true(publish_registered_series(registry, "fixture", NULL, db)$changed)
  marker <- state$marker
  expect_false(publish_registered_series(registry, "fixture", NULL, db)$changed)
  state$reference <- "territory-v2"
  rebound <- publish_registered_series(registry, "fixture", NULL, db)
  expect_false(rebound$changed)
  expect_true(rebound$rebound)
  expect_identical(state$marker_reference, "territory-v2")
  changed_points <- points; changed_points$value <- 1
  broken <- register_series_publisher(list(), "broken", function(input) list(points=changed_points, descriptor=descriptor),
    function(projection, db, version) { db$replace(projection, version); stop("injected failure") })
  expect_error(publish_registered_series(broken, "broken", NULL, db), "injected failure")
  expect_identical(state$marker, marker)
})
