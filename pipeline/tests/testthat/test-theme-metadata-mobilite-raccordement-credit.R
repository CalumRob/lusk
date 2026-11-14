# test-theme-metadata-mobilite-raccordement-credit --------------------------------
# #1006 - le crédit de la source « raccordement_gtfs_national » est une DÉCISION
# ÉDITORIALE DU PROPRIÉTAIRE : la formule vague « et licences des sources
# ouvertes » disparaît du seul crédit compact de la page 3, sans toucher aux
# faits de provenance (millésime, version, dates) ni au contrat numérique de la
# courbe (73 points, seuil 90 min, marqueur t0090).
#
# Le crédit vit chez son PROPRIÉTAIRE (le canon épinglé), et la projection
# navigateur publiée n'en est que la copie stricte : aucun renderer ne retire
# une sous-chaîne, aucune attribution n'est fabriquée à la volée.

CREDIT_RACCORDEMENT_ATTENDU <-
  "ODbL \u2013 \u00a9 OpenStreetMap contributors (GTFS SNCF/Korrigo)"

test_that("le crédit publié de la matrice GTFS nationale est exact et sans formule vague", {
  meta <- lire_theme_metadata("mobilite")
  record <- meta$source_records$raccordement_gtfs_national

  expect_identical(record$licence, CREDIT_RACCORDEMENT_ATTENDU)
  expect_false(grepl("licences des sources ouvertes", record$licence, fixed = TRUE))
  # L'éditeur et l'URL publics restent ceux du producteur, jamais réécrits ici.
  expect_identical(record$publisher, "Lusk")
  expect_identical(record$url, "https://github.com/CalumRob/lusk")
})

test_that("le crédit éditorial ne déplace AUCUN fait de provenance du raccordement", {
  meta <- lire_theme_metadata("mobilite")
  record <- meta$source_records$raccordement_gtfs_national
  clock <- record$vintages[[1L]]
  vintage <- VINTAGES_RACCORDEMENT[
    VINTAGES_RACCORDEMENT$id == "raccordement_gtfs_national", , drop = FALSE]

  # Le canon porte toujours le millésime réel et ses deux dates distinctes.
  expect_identical(record$vintage, "Mesure du 2026-10-21 ; flux acquis le 2026-10-10")
  expect_identical(record$freshness, "10 octobre 2026")
  expect_identical(clock$version, "national-gtfs-outbound-v1")
  expect_identical(clock$dateReference, as.character(vintage$date_reference))
  expect_identical(clock$datePublication, as.character(vintage$date_publication))
  expect_identical(clock$dateReference, "2026-10-10")
  expect_identical(clock$datePublication, "2026-10-10")

  # Le contrat numérique de la courbe est intact : 73 pas de 5 min, seuil 90.
  page <- meta$indicator_pages$raccordement_courbe
  expect_identical(page$family, "trajectory")
  grille <- as.numeric(unlist(record$methodology$publication_grid_minutes))
  expect_length(grille, 73L)
  expect_identical(grille[1L], 0)
  expect_identical(grille[73L], 360)
  seuil <- Filter(function(facteur) identical(facteur$key, "scalar_minute"),
                  record$methodology$factors)
  expect_length(seuil, 1L)
  expect_identical(as.numeric(seuil[[1L]]$value), 90)
  expect_identical(page$trajectory$marker$detail, "t0090")
  expect_identical(
    unlist(page$comparison$details, use.names = FALSE),
    paste0("t", sprintf("%04d", grille)))
})

test_that("la projection navigateur publiée porte le crédit du canon, à l'octet", {
  racine_repo <- testthat::test_path("..", "..", "..")
  publie <- file.path(racine_repo, "public", "data", "theme_mobilite.json")
  skip_if_not(file.exists(publie), "public/data absent - la racine du dépôt est introuvable")

  meta <- lire_theme_metadata("mobilite")
  projection <- projection_navigateur(meta)
  snapshot <- jsonlite::fromJSON(publie, simplifyVector = FALSE)

  expect_identical(
    projection$source_records$raccordement_gtfs_national,
    meta$source_records$raccordement_gtfs_national)
  expect_identical(
    snapshot$source_records$raccordement_gtfs_national,
    projection$source_records$raccordement_gtfs_national)
  expect_identical(
    snapshot$source_records$raccordement_gtfs_national$licence,
    CREDIT_RACCORDEMENT_ATTENDU)
})
