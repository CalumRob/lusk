# test-theme-programmes-faits ---------------------------------------------------
# Les faits du SIXIÈME thème (issue #408) : la paire hermétique
# indicateurs_programmes.json + histoires_programmes.json. Ce test verrouille :
#   - le builder : les adhésions deviennent l'indicateur catégoriel
#     `couverture_programmes` (le rider « convention valant ORT » sur la ligne
#     du label, l'estampille de SA source par ligne — les lignes ORT gardent
#     leur actualisation SANS date de publication) ;
#   - les agrégats SCDL deviennent `subventions_annuelles` (le total poolé de
#     l'année de référence, dimension = l'année) et `subventions_par_domaine`
#     (la ventilation communale COMPLÈTE — chaque valeur des tables survit) ;
#   - les gardes : total poolé = somme des domaines (bruyamment), unicité
#     (territoire × key × detail × dimension), jamais un rang ;
#   - l'absence honnête : zéro fait → RIEN n'est écrit (jamais un thème
#     inventé), et la paire écrite porte des histoires VIDES.

membres_faits <- function() {
  tibble::tibble(
    territoire = c("22001", "22002", "200000001", "29001", "200000002"),
    type = c("commune", "commune", "epci", "commune", "epci"),
    sigle = c("ACV", "PVD", "CRTE", "ORT", "ORT"),
    convention_valant_ort = c(TRUE, FALSE, FALSE, FALSE, FALSE),
    vintage_source = c("src-acv", "src-pvd", "src-crte", "src-ort", "src-ort"),
    vintage_version = c("v1", "v2", "v3", "en continu", "en continu"),
    vintage_date_reference = c("2025-01-01", "2025-01-01", "2025-07-17",
                               "2026-07-15", "2026-07-20"),
    vintage_date_publication = c("2025-09-24", "2026-04-27", "2025-09-24",
                                 NA_character_, NA_character_)
  )
}

subventions_faits <- function() {
  tibble::tibble(
    territoire = c("22001", "22001", "22001", "22002", "200000001", "53"),
    type = c("commune", "commune", "commune", "commune", "epci", "region"),
    annee = c(2024L, 2025L, 2025L, 2025L, 2025L, 2025L),
    programme_libl = c("Culture", "Agriculture", "Développement économique",
                       "Tourisme", NA_character_, NA_character_),
    montant = c(1000, 15000, 30000, 5000, 45000, 2000000),
    vintage_source = "src-scdl",
    vintage_version = "2026-08-05",
    vintage_date_reference = "2026-08-05",
    vintage_date_publication = "2026-08-05"
  )
}

test_that("construire_indicateurs_programmes : les adhésions deviennent l'indicateur catégoriel, estampilles comprises", {
  ind <- construire_indicateurs_programmes(membres_faits(), subventions_faits())

  couverture <- ind[ind$key == "couverture_programmes", ]
  expect_equal(nrow(couverture), 5L)
  # une ligne par adhésion au niveau d'ANCRAGE, value = 1, unit « adhésion »
  acv <- couverture[couverture$detail == "ACV", ]
  expect_equal(acv$territoire, "22001")
  expect_equal(acv$value, 1)
  expect_equal(acv$unit, "adhésion")
  # le rider « convention valant ORT » voyage sur LA ligne du label qui le
  # porte — jamais un second badge
  expect_equal(acv$rider, "convention valant ORT")
  pvd <- couverture[couverture$detail == "PVD", ]
  expect_true(is.na(pvd$rider))
  # chaque ligne garde l'estampille de SA source
  expect_equal(couverture$vintage_source[couverture$detail == "CRTE"], "src-crte")
  # les lignes ORT gardent leur actualisation par ligne SANS publication
  ort <- couverture[couverture$detail == "ORT", ]
  expect_setequal(ort$territoire, c("29001", "200000002"))
  expect_false(any(is.na(ort$vintage_date_reference)))
  expect_true(all(is.na(ort$vintage_date_publication)))
})

test_that("construire_indicateurs_programmes : les deux clés numériques portent toute la matière SCDL", {
  ind <- construire_indicateurs_programmes(membres_faits(), subventions_faits())

  # le total poolé : SEULEMENT l'année de référence de chaque territoire
  annuelles <- ind[ind$key == "subventions_annuelles", ]
  commune_22001 <- annuelles[annuelles$territoire == "22001", ]
  expect_equal(nrow(commune_22001), 1L)
  expect_equal(commune_22001$value, 45000)  # 15000 + 30000 (2025) — pas 1000 (2024)
  expect_true(is.na(commune_22001$detail))
  expect_equal(commune_22001$dimension, "2025")
  expect_equal(commune_22001$unit, "€")

  # la ventilation communale COMPLÈTE : chaque domaine, chaque année, chaque
  # valeur (#305 — le poolé seul est borné à l'année de référence)
  domaines <- ind[ind$key == "subventions_par_domaine", ]
  d22001 <- sort(domaines$value[domaines$territoire == "22001"])
  expect_equal(d22001, c(1000, 15000, 30000))
  expect_equal(domaines$detail[domaines$territoire == "22002"], "Tourisme")
  # les agrégats n'ont PAS de ligne domaine (leur total unique suffit)
  expect_equal(nrow(domaines[domaines$type != "commune", ]), 0L)

  # JAMAIS un rang : les faits d'action publique ne sont pas un classement
  colonnes_rang <- grep("^rang_", names(ind), value = TRUE)
  expect_length(colonnes_rang, 6L)
  expect_true(all(is.na(as.matrix(ind[, colonnes_rang]))))
})

test_that("construire_indicateurs_programmes : le total poolé incohérent échoue fort", {
  subventions <- subventions_faits()
  # une ligne de domaine modifiée sans retoucher le total poolé — impossible
  # ici (le total est CALCULÉ), donc on force l'incohérence par une ligne
  # d'agrégat qui porterait un domaine (la forme interdite)
  subventions$programme_libl[subventions$type == "epci"] <- "Fantôme"
  expect_error(
    construire_indicateurs_programmes(membres_faits(), subventions),
    "porte un domaine"
  )
})

test_that("construire_indicateurs_programmes : une ligne en double échoue fort", {
  membres <- dplyr::bind_rows(membres_faits(), membres_faits()[1L, ])
  expect_error(
    construire_indicateurs_programmes(membres, subventions_faits()),
    "double"
  )
})

test_that("ecrire_theme_programmes : l'absence honnête — zéro fait n'écrit RIEN", {
  sortie <- file.path(tempdir(), "faits-programmes-vide")
  dir.create(sortie, showWarnings = FALSE)
  on.exit(unlink(sortie, recursive = TRUE), add = TRUE)

  ind <- construire_indicateurs_programmes(
    membres_faits()[0L, ], subventions_faits()[0L, ]
  )
  expect_equal(nrow(ind), 0L)

  ecrire_theme_programmes(ind, sortie)
  expect_false(file.exists(file.path(sortie, "indicateurs_programmes.json")))
  expect_false(file.exists(file.path(sortie, "histoires_programmes.json")))
})

test_that("ecrire_theme_programmes : la paire hermétique — faits + histoires VIDES (le thème sans lecture)", {
  sortie <- file.path(tempdir(), "faits-programmes-pleins")
  dir.create(sortie, showWarnings = FALSE)
  on.exit(unlink(sortie, recursive = TRUE), add = TRUE)

  ind <- construire_indicateurs_programmes(membres_faits(), subventions_faits())
  ecrire_theme_programmes(ind, sortie)

  # indicateurs_programmes.json se relit dans la forme du contrat app
  relu <- jsonlite::fromJSON(file.path(sortie, "indicateurs_programmes.json"))
  expect_true(all(relu$theme == "programmes"))
  expect_setequal(unique(relu$key), c("couverture_programmes",
                                      "subventions_annuelles",
                                      "subventions_par_domaine"))
  # le rider JSON : présent sur la ligne ACV, null ailleurs (na = "null")
  expect_equal(relu$rider[relu$key == "couverture_programmes" & relu$detail == "ACV"],
               "convention valant ORT")

  # histoires_programmes.json : le tableau VIDE — aucune lecture inventée
  histoires <- jsonlite::fromJSON(file.path(sortie, "histoires_programmes.json"))
  expect_length(histoires, 0L)

  # un second appel identique réécrit le même fichier (la projection stable)
  octets <- function(fichier) {
    readBin(file.path(sortie, fichier), "raw",
            n = file.info(file.path(sortie, fichier))$size)
  }
  avant <- octets("indicateurs_programmes.json")
  ecrire_theme_programmes(ind, sortie)
  expect_identical(octets("indicateurs_programmes.json"), avant)
})
