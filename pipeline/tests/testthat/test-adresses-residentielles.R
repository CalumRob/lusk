# test-adresses-residentielles -------------------------------------------------
# La population d'adresses résidentielles (le spine AEDAR) remplace la couche
# bâtiments comme dénominateur d'Offre TC (décision propriétaire 2026-11-18).
# Le lecteur lit le parquet du cache, le normaliseur projette vers le contrat
# spatial du calcul : un sf POINT EPSG:2154 portant code_commune_insee.
# Fixtures en mémoire, aucun fichier réel, aucun réseau.

fixture_adresses <- function() {
  data.frame(
    address_id = c("22001_a", "22001_b", "29001_a"),
    code_insee = c("22001", "22001", "29001"),
    lon = c(-2.87, -2.86, -4.10),
    lat = c(48.31, 48.32, 48.40),
    stringsAsFactors = FALSE
  )
}

test_that("normaliser_adresses_residentielles : POINT EPSG:2154 avec code commune", {
  table <- normaliser_adresses_residentielles(fixture_adresses())

  expect_s3_class(table, "sf")
  expect_equal(as.character(sf::st_crs(table)$epsg), "2154")
  expect_true(all(sf::st_geometry_type(table) == "POINT"))
  expect_named(table, c("address_id", "code_commune_insee", "geometry"))
  expect_equal(table$code_commune_insee, c("22001", "22001", "29001"))
  expect_equal(table$address_id, c("22001_a", "22001_b", "29001_a"))
})

test_that("normaliser_adresses_residentielles : un input corrompu s'arrête bruyamment", {
  expect_error(
    normaliser_adresses_residentielles(fixture_adresses()["address_id"]),
    "manquante"
  )
  expect_error(
    normaliser_adresses_residentielles(fixture_adresses()[0, ]),
    "aucune ligne"
  )
  vide <- fixture_adresses(); vide$address_id[[1]] <- ""
  expect_error(normaliser_adresses_residentielles(vide), "address_id vide")

  doublon <- fixture_adresses(); doublon$address_id[[2]] <- doublon$address_id[[1]]
  expect_error(normaliser_adresses_residentielles(doublon), "dupliqu")

  cog <- fixture_adresses(); cog$code_insee[[1]] <- "2201"
  expect_error(normaliser_adresses_residentielles(cog), "COG")

  coord <- fixture_adresses(); coord$lon[[1]] <- NA_real_
  expect_error(normaliser_adresses_residentielles(coord), "coordonn")
})

test_that("lire_adresses_residentielles : lit le parquet du cache et refuse un fichier absent", {
  chemin <- tempfile(fileext = ".parquet")
  nanoparquet::write_parquet(fixture_adresses(), chemin)
  lu <- lire_adresses_residentielles(chemin)
  expect_equal(nrow(lu), 3L)
  expect_equal(lu$address_id, fixture_adresses()$address_id)

  expect_error(
    lire_adresses_residentielles(file.path(tempfile(), "absent.parquet")),
    "absente du cache"
  )
})

test_that("normaliser_adresses_residentielles : les quatre gardes portées de l'ancienne couche bâtiments", {
  # Port des cas retirés avec normaliser_batiments_residentiels (issue #1048) :
  # la population d'adresses doit s'arrêter bruyamment sur la même corruption
  # de forme, jamais publier une géométrie ou un dénominateur invalide.
  fx <- fixture_adresses()

  # 1. une colonne requise manquante nomme la colonne fautive
  expect_error(
    normaliser_adresses_residentielles(fx[c("address_id", "code_insee")]),
    "lon|manquante"
  )
  # 2. un fichier vide est une corruption
  expect_error(
    normaliser_adresses_residentielles(fx[0L, ]),
    "aucune ligne"
  )
  # 3. un code commune hors format COG est une corruption
  cog <- fx; cog$code_insee[[1L]] <- "ABC"
  expect_error(normaliser_adresses_residentielles(cog), "COG")
  # 4. une coordonnée absente ou non finie est une corruption
  coord <- fx; coord$lat[[1L]] <- NA_real_
  expect_error(normaliser_adresses_residentielles(coord), "coordonn")
  non_fini <- fx; non_fini$lon[[2L]] <- "Inf"
  expect_error(normaliser_adresses_residentielles(non_fini), "coordonn")
})
