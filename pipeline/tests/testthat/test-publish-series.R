test_that("annual series preserves declared gaps and source vintage", {
  descriptor <- list(indicator_id="conso_enaf_annuel", axis_kind="year",
    axis_values=as.character(2011:2014), completeness="may_be_missing",
    comparison_point="2014", label="Consommation", unit="ha", direction="low",
    allowed_levels="commune", source_id="consoenaf", vintage_id="2025")
  points <- data.frame(indicator_id="conso_enaf_annuel", territory_id="22001",
    territory_type="commune", axis_value=c("2011","2013","2014"),
    observation_period=c("2011","2013","2014"), value=c(2,0,NA_real_),
    status=c("measured","measured","missing"), source_id="consoenaf", vintage_id="2025")
  result <- validate_series_projection(points, descriptor)
  expect_identical(result$axis_value, c("2011","2013","2014"))
  expect_equal(result$value[result$axis_value == "2013"], 0)
  expect_identical(result$status[result$axis_value == "2013"], "measured")
  expect_true(is.na(result$value[result$axis_value == "2014"]))
  expect_identical(result$status[result$axis_value == "2014"], "missing")
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
  payload$indicateurs <- payload$indicateurs[payload$indicateurs$key != "conso_enaf_annuel" |
    payload$indicateurs$type %in% unlist(metadata$indicator_pages$conso_enaf_annuel$levels), , drop=FALSE]
  registry <- register_conso_enaf_series_publisher(list(), metadata)
  projection <- registry$conso_enaf_annuel$project(payload)
  expect_identical(projection$descriptor$comparison_point,
    as.character(metadata$indicator_pages$conso_enaf_annuel$comparison$detail))
  canonical <- payload$indicateurs[payload$indicateurs$key == "conso_enaf_annuel", , drop=FALSE]
  expect_identical(projection$descriptor$axis_values,
    as.character(metadata$indicator_pages$conso_enaf_annuel$comparison$details))
  expect_identical(projection$descriptor$allowed_levels,
    unlist(metadata$indicator_pages$conso_enaf_annuel$levels, use.names=FALSE))
  canonical <- canonical[canonical$detail %in% projection$descriptor$axis_values &
    canonical$type %in% projection$descriptor$allowed_levels, , drop=FALSE]
  key <- function(territory, level, axis) paste(territory, level, axis, sep="|")
  canonical_key <- key(canonical$territoire, canonical$type, as.character(canonical$detail))
  projected_key <- key(projection$points$territory_id, projection$points$territory_type,
    projection$points$axis_value)
  expect_length(unique(canonical_key), nrow(canonical))
  expect_length(unique(projected_key), nrow(projection$points))
  expect_setequal(projected_key, canonical_key)
  canonical <- canonical[match(projected_key, canonical_key), , drop=FALSE]
  expect_identical(projection$points$indicator_id, rep("conso_enaf_annuel", nrow(canonical)))
  expect_identical(projection$points$observation_period, as.character(canonical$detail))
  expect_equal(projection$points$value, canonical$value)
  expect_identical(projection$points$status, ifelse(is.na(canonical$value), "missing", "measured"))
  expect_true(all(projection$points$source_id == projection$descriptor$source_id))
  expect_identical(projection$points$vintage_id,
    paste(as.character(canonical$vintage_version), canonical$vintage_date_reference, sep="/"))
  expect_true(all(projection$points$axis_value %in% projection$descriptor$axis_values))
})

test_that("production series input is projected from the canonical Parquet and metadata", {
  root <- testthat::test_path("../../../public/data")
  metadata_path <- testthat::test_path("../../inst/extdata/theme-metadata/theme_milieux.json")
  projection <- read_conso_enaf_series_projection(root, metadata_path)
  canonical <- nanoparquet::read_parquet(file.path(root, "indicateurs_milieux.parquet"))
  metadata <- jsonlite::read_json(metadata_path, simplifyVector=FALSE)
  annual <- canonical[canonical$key == "conso_enaf_annuel", , drop=FALSE]
  selected <- annual[annual$detail %in% metadata$indicator_pages$conso_enaf_annuel$comparison$details &
    annual$type %in% unlist(metadata$indicator_pages$conso_enaf_annuel$levels), , drop=FALSE]
  excluded_region <- annual[annual$type == "region", , drop=FALSE]
  expect_equal(nrow(projection$points), 17710L)
  expect_equal(nrow(excluded_region), 14L)
  expect_equal(nrow(annual), nrow(projection$points) + nrow(excluded_region))
  key <- function(territory, level, year) paste(territory, level, year, sep="|")
  projected_key <- key(projection$points$territory_id, projection$points$territory_type,
    projection$points$axis_value)
  expected_key <- key(selected$territoire, selected$type, as.character(selected$detail))
  expect_setequal(projected_key, expected_key)
  matched <- selected[match(projected_key, expected_key), , drop=FALSE]
  expect_equal(projection$points$value, matched$value)
  expect_identical(projection$points$status, ifelse(is.na(matched$value), "missing", "measured"))
  expect_identical(projection$points$vintage_id,
    paste(as.character(matched$vintage_version), matched$vintage_date_reference, sep="/"))
  expect_identical(projection$descriptor$comparison_point,
    as.character(metadata$indicator_pages$conso_enaf_annuel$comparison$detail))
  expect_true(all(projection$points$source_id == "consoenaf"))
  expect_equal(projection$excluded$region$row_count, 14L)
  expect_identical(projection$excluded$region$policy, "territory_fiche_only")
  expect_error(require_series_publish_opt_in(""), "explicit LUSK_PUBLISH_SERIES=1")
  expect_error(require_series_publish_opt_in("0"), "explicit LUSK_PUBLISH_SERIES=1")
  expect_invisible(require_series_publish_opt_in("1"))
})

test_that("canonical annual rows outside descriptor axes or levels are rejected", {
  payload <- compute_payload(communes_fixture_milieux_ocsge(), theme=theme_milieux())
  metadata <- jsonlite::read_json(testthat::test_path("../../inst/extdata/theme-metadata/theme_milieux.json"), simplifyVector=FALSE)
  bad_axis <- payload
  extra <- bad_axis$indicateurs[bad_axis$indicateurs$key == "conso_enaf_annuel", ][1, , drop=FALSE]
  extra$detail <- "2099"
  bad_axis$indicateurs <- rbind(bad_axis$indicateurs, extra)
  expect_error(project_conso_enaf_series(bad_axis, metadata), "undeclared.*axis|axis.*undeclared")
  bad_level <- payload
  extra <- bad_level$indicateurs[bad_level$indicateurs$key == "conso_enaf_annuel", ][1, , drop=FALSE]
  extra$type <- "unknown_level"
  bad_level$indicateurs <- rbind(bad_level$indicateurs, extra)
  expect_error(project_conso_enaf_series(bad_level, metadata), "unexpected territory level")
  duplicate <- payload
  duplicate$indicateurs <- rbind(duplicate$indicateurs,
    duplicate$indicateurs[duplicate$indicateurs$key == "conso_enaf_annuel", ][1, , drop=FALSE])
  expect_error(project_conso_enaf_series(duplicate, metadata), "duplicate territory/axis keys")
  mislabeled <- payload
  annual_idx <- which(mislabeled$indicateurs$key == "conso_enaf_annuel")[[1L]]
  mislabeled$indicateurs$theme[[annual_idx]] <- "demographie"
  expect_error(project_conso_enaf_series(mislabeled, metadata), "mislabeled")
  bad_metadata <- metadata
  bad_metadata$indicator_pages$conso_enaf_annuel$label <- NULL
  expect_error(project_conso_enaf_series(payload, bad_metadata), "descriptor is invalid")
  bad_metadata <- metadata
  bad_metadata$source_records$consoenaf$vintages[[1]]$version <- "wrong-vintage"
  eligible <- payload
  eligible$indicateurs <- eligible$indicateurs[eligible$indicateurs$key != "conso_enaf_annuel" |
    eligible$indicateurs$type %in% unlist(metadata$indicator_pages$conso_enaf_annuel$levels), , drop=FALSE]
  expect_error(project_conso_enaf_series(eligible, bad_metadata), "vintage disagrees")
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

test_that("publishing a validated projection preserves its exact identity and version", {
  payload <- compute_payload(communes_fixture_milieux_ocsge(), theme=theme_milieux())
  metadata <- jsonlite::read_json(testthat::test_path("../../inst/extdata/theme-metadata/theme_milieux.json"), simplifyVector=FALSE)
  payload$indicateurs <- payload$indicateurs[payload$indicateurs$key != "conso_enaf_annuel" |
    payload$indicateurs$type %in% unlist(metadata$indicator_pages$conso_enaf_annuel$levels), , drop=FALSE]
  projection <- project_conso_enaf_series(payload, metadata)
  state <- new.env(parent=emptyenv()); state$marker <- NULL; state$marker_reference <- NULL
  state$reference <- "territory-v1"; state$projection <- NULL; state$seen_version <- NULL
  db <- list(transaction=function(expr) force(expr), marker=function(name) {
    if (name == "territory_reference") return(data.frame(content_version=state$reference,
      reference_content_version=NA_character_))
    if (is.null(state$marker)) data.frame() else data.frame(content_version=state$marker,
      reference_content_version=state$marker_reference)
  }, replace=function(got, version) {
    state$projection <- got; state$seen_version <- version
    state$marker <- version; state$marker_reference <- state$reference
  })
  result <- publish_series_projection(projection, db,
    function(got, database, version) database$replace(got, version))
  expect_identical(state$projection, projection)
  expect_identical(state$seen_version, scalar_content_version(projection))
  expect_identical(result$content_version, state$seen_version)
})
