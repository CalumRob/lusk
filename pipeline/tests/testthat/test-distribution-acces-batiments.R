# test-distribution-acces-batiments --------------------------------------------

registre_distribution_fixture <- function() {
  tibble::tibble(
    TYPEQU = c("A128", "A129"),
    Libelle_TYPEQU = c("France services", "Mairie"),
    Description = c("fixture", "fixture")
  )
}

distribution_batiments_fixture <- function() {
  list(
    accessibilite = tibble::tibble(
      id = c("bg-1", "bg-2", "bg-3"),
      car_A128 = c("2", "3", "0"),
      car_A129 = c("1", "4", "0"),
      bike_A128 = c("1", "2", "0"),
      bike_A129 = c("0", "1", "0"),
      transit_walk_A128 = c("1", "10", "0"),
      transit_walk_A129 = c("0", "2", "0")
    ),
    batiments = sf::st_as_sf(
      tibble::tibble(
        batiment_groupe_id = c("bg-1", "bg-2", "bg-3"),
        code_commune_insee = c("22001", "22001", "29011"),
        geom_adresse = c(
          "POINT (400000 6780000)",
          "POINT (400100 6780000)",
          "POINT (165000 6780000)"
        )
      ),
      wkt = "geom_adresse", crs = 2154
    ),
    base_epci = tibble::tibble(
      CODGEO = c("22001", "22002", "29011"),
      EPCI = c("200000001", "200000001", "290000001"),
      DEP = c("22", "22", "29")
    )
  )
}

test_that("normaliser_accessibilite_batiments calcule breadth et depth sur le même bâtiment", {
  fx <- distribution_batiments_fixture()

  resultat <- normaliser_accessibilite_batiments(
    fx$accessibilite,
    fx$batiments,
    registre_distribution_fixture()
  )

  expect_named(resultat, c("batiment_groupe_id", "commune", "breadth", "depth"))
  expect_equal(resultat$commune, c("22001", "22001", "29011"))
  expect_equal(resultat$breadth, c(1L, 2L, 0L))
  expect_equal(resultat$depth, c(1L, 12L, 0L))
})

test_that("agreger_distribution_acces_batiments publie une grille complète par territoire", {
  fx <- distribution_batiments_fixture()
  batiments <- normaliser_accessibilite_batiments(
    fx$accessibilite,
    fx$batiments,
    registre_distribution_fixture()
  )

  resultat <- agreger_distribution_acces_batiments(
    batiments,
    fx$base_epci,
    registre_distribution_fixture()
  )

  expect_named(resultat, CLES_DISTRIBUTION_ACCES_BATIMENTS)
  expect_true(all(resultat$availability[resultat$availability != "absent"] == "complete"))
  expect_equal(nrow(resultat), 7L * 5L * 6L + 1L)

  cellule <- resultat[
    resultat$territoire == "22001" &
      resultat$breadth_bucket == "1-9" &
      resultat$depth_bucket == "1-9", , drop = FALSE
  ]
  expect_equal(nrow(cellule), 1L)
  expect_equal(cellule$building_count, 1L)
  expect_equal(cellule$total_buildings, 2L)
  expect_equal(cellule$share, 0.5)
  expect_equal(cellule$breadth_label, "1 à 9 types")
  expect_equal(cellule$depth_label, "1 à 9 équipements")
  expect_equal(cellule$mode, "t")
  expect_equal(cellule$mode_label, "À pied + TC")
  expect_equal(cellule$source_id, "mobilite_snapshot")
  expect_equal(cellule$source, MOBILITE_SNAPSHOT_SOURCE)
  expect_equal(cellule$version, "2026-02")
  expect_equal(cellule$date_reference, "2026-02-28")
  expect_equal(cellule$date_publication, "2026-08-06")
  expect_true(is.na(cellule$comparison_label))

  verifier_contrat_distribution_acces_batiments(resultat)
})

test_that("les bornes de la distribution sont les tranches documentées", {
  expect_equal(
    DISTRIBUTION_ACCES_BATIMENTS_BREADTH_BINS$key,
    c("0", "1-9", "10-24", "25-39", "40-53")
  )
  expect_equal(
    DISTRIBUTION_ACCES_BATIMENTS_DEPTH_BINS$key,
    c("0", "1-9", "10-49", "50-199", "200-499", "500+")
  )
  expect_equal(
    DISTRIBUTION_ACCES_BATIMENTS_BREADTH_LABEL,
    "types d’équipements accessibles"
  )
  expect_equal(
    DISTRIBUTION_ACCES_BATIMENTS_DEPTH_LABEL,
    "équipements accessibles"
  )
})

test_that("agreger_rampe_acces_batiments publie onze points monotones par mode", {
  fx <- distribution_batiments_fixture()
  batiments <- normaliser_accessibilite_batiments_modes(
    fx$accessibilite,
    fx$batiments,
    registre_distribution_fixture()
  )

  resultat <- agreger_rampe_acces_batiments(batiments, fx$base_epci)

  expect_named(resultat, CLES_RAMPE_ACCES_BATIMENTS)
  expect_equal(nrow(resultat), 7L * 3L * 11L + 3L)
  expect_equal(
    nrow(resultat[resultat$territoire == "22001" & resultat$availability == "complete", ]),
    3L * 11L
  )
  mediane <- resultat[
    resultat$territoire == "22001" & resultat$mode == "t" & resultat$quantile == 0.5,
    , drop = FALSE
  ]
  expect_equal(mediane$quantile_label, "50 %")
  expect_equal(mediane$accessible_types, 1)
  expect_true(all(resultat$accessible_types[!is.na(resultat$accessible_types)] %% 1 == 0))
  expect_equal(mediane$mode_label, "À pied + TC")
  expect_equal(mediane$x_axis_label, "Part cumulée des bâtiments")
  expect_equal(mediane$y_axis_label, "types d’équipements accessibles")
  expect_equal(mediane$source_id, "mobilite_snapshot")
  expect_equal(mediane$source, MOBILITE_SNAPSHOT_SOURCE)
  expect_equal(mediane$version, "2026-02")
  expect_equal(mediane$date_reference, "2026-02-28")
  expect_equal(mediane$date_publication, "2026-08-06")

  absent <- resultat[resultat$territoire == "22002", , drop = FALSE]
  expect_equal(nrow(absent), 3L)
  expect_true(all(absent$availability == "absent"))
  expect_true(all(is.na(absent$accessible_types)))
  verifier_contrat_rampe_acces_batiments(resultat)
  expect_error(
    verifier_contrat_rampe_acces_batiments(
      resultat[! (resultat$mode == "t"), , drop = FALSE]
    ),
    "trois modes"
  )
})

test_that("la normalisation multi-mode garde le contrat t et refuse un mode incomplet", {
  fx <- distribution_batiments_fixture()
  resultat <- normaliser_accessibilite_batiments_modes(
    fx$accessibilite,
    fx$batiments,
    registre_distribution_fixture()
  )

  expect_named(
    resultat,
    c("batiment_groupe_id", "commune", "breadth_c", "depth_c",
      "breadth_b", "depth_b", "breadth_t", "depth_t")
  )
  expect_equal(resultat$breadth_c, c(2L, 2L, 0L))
  expect_equal(resultat$breadth_b, c(1L, 2L, 0L))
  expect_equal(resultat$breadth_t, c(1L, 2L, 0L))

  expect_error(
    normaliser_accessibilite_batiments_modes(
      dplyr::select(fx$accessibilite, -bike_A129),
      fx$batiments,
      registre_distribution_fixture()
    ),
    "bike_A129"
  )

})

test_that("les valeurs d'accessibilité manquantes ou non entières échouent", {
  fx <- distribution_batiments_fixture()

  expect_error(
    normaliser_accessibilite_batiments(
      dplyr::select(fx$accessibilite, -transit_walk_A129),
      fx$batiments,
      registre_distribution_fixture()
    ),
    "transit_walk_A129"
  )

  absent <- fx$accessibilite
  absent$transit_walk_A128[[1]] <- NA_character_
  expect_error(
    normaliser_accessibilite_batiments(
      absent, fx$batiments, registre_distribution_fixture()
    ),
    "valeur manquante"
  )

  fraction <- fx$accessibilite
  fraction$transit_walk_A128[[1]] <- "1.5"
  expect_error(
    normaliser_accessibilite_batiments(
      fraction, fx$batiments, registre_distribution_fixture()
    ),
    "entière"
  )
})
