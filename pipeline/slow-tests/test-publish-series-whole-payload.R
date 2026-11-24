# Slow tier (#1172): projects the complete 1,268-commune × 73-step national raccordement artefact
# Subject files: pipeline/R/publish_series.R, pipeline/R/calcul_raccordement.R, pipeline/inst/extdata/theme-metadata, public/data
# to protect the canonical owned-series locator, named reference, and missing-commune fail-closed contract.
# Run from pipeline/: Rscript -e "pkgload::load_all('.', quiet=TRUE); testthat::test_file('slow-tests/test-publish-series-whole-payload.R', package='lusk')"

test_that("canonical Mobility metadata locator validates the owned raccordement projection", {
  metadata <- lire_theme_metadata("mobilite")
  declaration <- metadata$owned_series_routes$raccordement_courbe
  page <- metadata$indicator_pages$raccordement_courbe
  expect_identical(page$trajectory$reference$indicator, declaration$reference_indicator)
  expect_identical(page$trajectory$reference$territoire, "53")
  expect_identical(page$trajectory$reference$label, declaration$reference$label)

  artifact <- lire_artefact_raccordement_national()
  vintages <- vintages_mobilite()
  canonical <- lignes_indicateurs_raccordement_national(artifact$calculation, vintages)
  projection <- project_raccordement_owned_series(canonical, vintages, metadata,
    producer_contract=RECETTE_RACCORDEMENT_NATIONAL)
  expect_no_error(validate_owned_series_projection(projection))
  expect_equal(nrow(projection$points), 1268L * 73L)
  expect_equal(nrow(projection$named_reference), 73L)
  expect_equal(projection$named_reference_descriptors$reference_indicator_id,
    declaration$reference_indicator)
  partial <- canonical[-which(canonical$key == "raccordement_courbe" &
    canonical$type == "commune")[[1L]], , drop = FALSE]
  expect_error(project_raccordement_owned_series(partial, vintages, metadata,
    producer_contract=RECETTE_RACCORDEMENT_NATIONAL), "commune 22001.*t0000")
})
