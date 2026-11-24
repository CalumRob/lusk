# Slow tier (#1172): the retained scalar snapshot is rebuilt from committed producer outputs; protects legacy service-share exclusion and reference binding.
# Subject files: pipeline/R/publish_territory_reference.R, pipeline/R/publish_retained_scalar_snapshot.R, pipeline/tests/testthat/helper-payload.R, public/data
# Run explicitly with testthat::test_file(..., package="lusk") from pipeline/.

local({
  withr::local_dir(file.path(pkgload::pkg_path(), "tests", "testthat"))
  for (helper in list.files(file.path(pkgload::pkg_path(), "tests", "testthat"), pattern = "^helper.*\\.R$", full.names = TRUE)) source(helper, local = environment())

test_that("retained scalar snapshot is assembled without legacy service-share projection", {
  root <- file.path(pkgload::pkg_path(), "..", "public", "data")
  artifacts <- tempfile("retained-scalar-artifacts-")
  dir.create(artifacts)
  on.exit(unlink(artifacts, recursive=TRUE), add=TRUE)
  vintages <- nanoparquet::read_parquet(file.path(root, "vintages.parquet"))
  territories <- territoires_producteur_fixture(
    c("economie", "demographie", "mobilite", "habitat"), root)
  for (theme in c("economie", "demographie", "mobilite", "habitat")) {
    payload <- payload_producteur_fixture(theme, root)
    payload$territoires <- territories
    metadata <- lire_theme_metadata(theme)
    # The committed Mobility facts carry the historical raccordement source;
    # keep that bundle assertion in test-publish-scalar.R rather than pairing
    # it with the current canonical owner declaration here.
    if (identical(theme, "mobilite")) {
      metadata$scalar_contracts$raccordement_tc <- NULL
      # #953 : déclarées au canon, matérialisées au prochain run seulement
      metadata$scalar_contracts$stations_service <- NULL
      metadata$scalar_contracts$stations_service_1000 <- NULL
      metadata$scalar_contracts$bornes_recharge_1000 <- NULL
    }
    materialize_theme_scalar_artifact(payload, metadata, vintages, theme, artifacts)
  }
  reference <- project_territory_reference(territories)
  snapshot <- project_retained_scalar_snapshot(root, reference, artifacts)
  ids <- as.character(snapshot$scalar$descriptors$indicator_id)
  expect_true(length(ids) > 0L)
  expect_false(any(grepl("^(share_|iso_)", ids)))
  expect_identical(snapshot$comparison$scalar_content_version,
    scalar_content_version(snapshot$scalar))
  expect_identical(snapshot$comparison$reference_content_version,
    reference$content_version)
})

})
