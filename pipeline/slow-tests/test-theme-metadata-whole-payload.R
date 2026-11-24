# Slow tier (#1172): rebuilds every trajectory producer fixture, including the full national
# raccordement artefact, to protect metadata-axis parity across all published trajectory pages.
# Run from pipeline/: Rscript -e "pkgload::load_all('.', quiet=TRUE); testthat::test_file('slow-tests/test-theme-metadata-whole-payload.R', package='lusk')"

for (helper in list.files(file.path(pkgload::pkg_path(), "tests", "testthat"), pattern = "^helper.*\\.R$", full.names = TRUE)) source(helper)

test_that("verifier_parite_trajectoires : les sorties producteur de fixture couvrent leurs axes déclarés (#438)", {
  withr::local_dir(file.path(pkgload::pkg_path(), "tests", "testthat"))
  # Les faits numériques ne sont plus lus depuis un snapshot JSON. Chaque
  # contrat est vérifié contre la sortie de son producteur de fixture.
  racine_public <- file.path(testthat::test_path("..", "..", ".."), "public", "data")
  expect_true(dir.exists(racine_public), info = "public/data absent - la racine du dépôt est introuvable")

  pages_trajectoires <- 0L
  for (theme in THEMES_METADATA) {
    meta <- lire_theme_metadata(theme)
    cles <- names(meta$indicator_pages)
    if (!any(vapply(meta$indicator_pages, function(p) identical(p$family, "trajectory"), logical(1L)))) next

    faits <- lire_indicateurs_producteur_fixture(theme, racine_public)
    if (theme_sans_lecture(theme)) {
      # The retained Mobility Parquet remains unchanged, but its incumbent
      # raccordement curve has the prior axis. Rebuild the owner-owned rows
      # from the byte-pinned producer artifact for the current trajectory
      # contract rather than treating that Parquet as a fixture clone.
      raccordement <- lire_artefact_raccordement_national()
      raccordement_faits <- lignes_indicateurs_raccordement_national(
        raccordement$calculation, vintages_mobilite())
      faits <- dplyr::bind_rows(
        faits[!faits$key %in% raccordement_faits$key, , drop=FALSE],
        raccordement_faits)
    }
    verifier_parite_trajectoires(meta, faits)
    pages_trajectoires <- pages_trajectoires +
      sum(vapply(meta$indicator_pages, function(p) identical(p$family, "trajectory"), logical(1L)))
  }
  # La couverture du devoir : les QUATRE indicateurs trajectoires publiés ont
  # leur page — jamais une famille trajectoire orpheline.
  expect_identical(pages_trajectoires, 4L)
})
