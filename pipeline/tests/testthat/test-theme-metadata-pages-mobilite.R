# test-theme-metadata-pages-mobilite ---------------------------------------------
# Les Pages d'indicateur scalaires de la Mobilité (issue #461) : les QUATORZE
# indicateurs publiés du thème portent chacun leur page scalaire complète —
# offre_tc, bornes_recharge, places_stationnement_velo_1000,
# places_stationnement_voiture_1000, bornes_ev_par_station_service,
# stationnement_velo_par_voiture, tot_loss_t, tot_loss_b et les cinq sœurs
# iso_* — par des descripteurs épinglés → le seam de publication → les
# artefacts committés.
#
# L'énumération est le devoir (le même verrou que les trajectoires #438, les
# distributions #440, les listes #439 et les relations #441) : une page ajoutée
# ou retirée échoue ICI — jamais une famille
# scalaire qui gonfle ou fond en silence.

PAGES_SCALAIRES_MOBILITE <- c(
  "offre_tc", "bornes_recharge",
  "places_stationnement_velo_1000", "places_stationnement_voiture_1000",
  "bornes_ev_par_station_service", "stationnement_velo_par_voiture",
  "tot_loss_t", "tot_loss_b",
  "iso_alimentation", "iso_sante", "iso_administration", "iso_ecole", "iso_banque",
  "raccordement_tc"
)

racine_public <- file.path(testthat::test_path("..", "..", ".."), "public", "data")

test_that("l'énumération des pages Mobilité est connue — les pages multi-mesures et les quatorze scalaires (#461)", {
  meta <- lire_theme_metadata("mobilite")
  cles <- names(meta$indicator_pages)
  expect_setequal(
    cles,
    c(PAGES_SCALAIRES_MOBILITE, "voitures_menage", "offre_cyclable", "reseaux",
      "raccordement_courbe")
  )
  scalaires <- cles[vapply(meta$indicator_pages, function(p)
    identical(p$family, "scalar"), logical(1L))]
  expect_setequal(scalaires, PAGES_SCALAIRES_MOBILITE)
})

test_that("valider_theme_metadata : le canon Mobilité épinglé porte ses quatorze pages scalaires complètes (#461)", {
  meta <- lire_theme_metadata("mobilite")
  expect_no_error(valider_theme_metadata(meta))
})

test_that("map_layers déclare les faits cartographiables sans exposer les séries composées (#487)", {
  meta <- lire_theme_metadata("mobilite")
  expect_identical(meta$map_layers, list(
    offre_tc = TRUE,
    raccordement_tc = TRUE,
    raccordement_courbe = FALSE,
    raccordement_reference = FALSE
  ))

  inconnu <- meta
  inconnu$map_layers$fantome <- TRUE
  expect_error(valider_theme_metadata(inconnu), "indicateur")

  invalide <- meta
  invalide$map_layers$raccordement_tc <- "oui"
  expect_error(valider_theme_metadata(invalide), "booléen")

  vide <- meta
  vide$map_layers <- list()
  expect_no_error(valider_theme_metadata(vide))
})

test_that("publier_theme_metadata : les quatorze pages passent le seam et survivent au round-trip (#461)", {
  meta <- lire_theme_metadata("mobilite")
  sortie <- file.path(tempdir(), "pages-scalaires-mobilite")
  dir.create(sortie, showWarnings = FALSE)
  on.exit(unlink(sortie, recursive = TRUE), add = TRUE)

  expect_no_error(publier_theme_metadata(meta, sortie, theme_attendu = "mobilite"))
  relu <- jsonlite::fromJSON(file.path(sortie, "theme_mobilite.json"),
                             simplifyVector = FALSE)
  for (cle in PAGES_SCALAIRES_MOBILITE) {
    page <- relu$indicator_pages[[cle]]
    expect_identical(page$family, "scalar", info = cle)
    expect_true(page$direction %in% c("high", "low"), info = cle)
  }
})

test_that("parité pages scalaires ↔ faits committés : niveaux publiés, unité honnête, direction du calcul (#461)", {
  skip_if_not(dir.exists(racine_public), "public/data absent — la racine du dépôt est introuvable")
  meta <- lire_theme_metadata("mobilite")
  faits <- jsonlite::fromJSON(file.path(racine_public, "indicateurs_mobilite.json"),
                              simplifyDataFrame = TRUE)
  for (cle in PAGES_SCALAIRES_MOBILITE) {
    page <- meta$indicator_pages[[cle]]
    lignes <- faits[faits$key == cle, ]
    expect_true(nrow(lignes) > 0L, info = cle)
    # la page ne déclare un niveau comparable que si les faits le publient
    for (niveau in unlist(page$levels, use.names = FALSE)) {
      expect_true(sum(lignes$type == niveau) > 0L, info = paste(cle, niveau, sep = " · "))
    }
    # l'unité déclarée est EXACTEMENT celle des faits publiés — jamais une unité qui ment
    expect_identical(page$unit, unique(lignes$unit), info = cle)
    # la direction de page est celle du calcul des rangs (DIRECTIONS_MOBILITE,
    # ADR-0015 — une seule source pour la désirabilité)
    expect_identical(page$direction, DIRECTIONS_MOBILITE[[cle]], info = cle)
  }
})
