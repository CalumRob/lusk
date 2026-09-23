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
  expect_equal(cellule$breadth_label, "1–9")
  expect_equal(cellule$depth_label, "1–9")
  expect_equal(cellule$mode, "t")
  expect_equal(cellule$mode_label, "À pied + TC")
  expect_equal(cellule$source_id, "mobilite_snapshot")
  expect_equal(cellule$source, MOBILITE_SNAPSHOT_SOURCE)
  expect_equal(cellule$version, "2026-02")
  expect_equal(cellule$date_reference, "2026-02-28")
  expect_equal(cellule$date_publication, "2026-08-06")
  expect_equal(cellule$comparison_label, "communes de l'EPCI")
  expect_equal(cellule$comparison_total_buildings, 2L)
  expect_equal(cellule$comparison_building_count, 1L)
  expect_equal(cellule$comparison_share, 0.5)

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
  expect_equal(mediane$comparison_label, "communes de l'EPCI")
  expect_equal(mediane$comparison_total_buildings, 2L)
  expect_equal(mediane$comparison_accessible_types, 1)

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

test_that("les projections bâtiment publient les contextes applicables sans fallback EPCI", {
  base <- tibble::tibble(
    CODGEO = c("22001", "22002", "22003", "22004", "29011"),
    EPCI = c("200000001", "200000001", NA_character_, "200000002", "290000001"),
    LIBEPCI = c("EPCI X", "EPCI X", NA_character_, "EPCI Y", "EPCI Z"),
    DEP = c("22", "22", "22", "22", "29")
  )
  classes <- tibble::tibble(
    CODGEO = c("22001", "22002", "22003", "22004", "29011"),
    DENS7 = c("1", "1", "1", "1", "2"),
    LIBDENS7 = c(
      "Grands centres urbains", "Grands centres urbains",
      "Grands centres urbains", "Grands centres urbains",
      "Centres urbains intermédiaires"
    )
  )
  reference <- tibble::tribble(
    ~territoire, ~type, ~nom, ~departement, ~epci,
    ~classe_densite_code, ~classe_densite_libelle_insee,
    ~classe_densite_libelle_public,
    "22001", "commune", "Commune A", "22", "200000001", "1",
    "Grands centres urbains", "grands centres urbains bretons",
    "22002", "commune", "Commune B", "22", "200000001", "1",
    "Grands centres urbains", "grands centres urbains bretons",
    "22003", "commune", "Commune sans EPCI", "22", NA_character_, "1",
    "Grands centres urbains", "grands centres urbains bretons",
    "22004", "commune", "Commune C", "22", "200000002", "1",
    "Grands centres urbains", "grands centres urbains bretons",
    "29011", "commune", "Commune D", "29", "290000001", "2",
    "Centres urbains intermédiaires", "centres urbains intermédiaires bretons",
    "200000001", "epci", "CA EPCI X", "22", NA_character_, NA_character_,
    NA_character_, NA_character_,
    "200000002", "epci", "CA EPCI Y", "22", NA_character_, NA_character_,
    NA_character_, NA_character_,
    "290000001", "epci", "CC EPCI Z", "29", NA_character_, NA_character_,
    NA_character_, NA_character_,
    "22", "departement", "Côtes-d’Armor", "22", NA_character_, NA_character_,
    NA_character_, NA_character_,
    "29", "departement", "Finistère", "29", NA_character_, NA_character_,
    NA_character_, NA_character_,
    "53", "region", "Bretagne", NA_character_, NA_character_, NA_character_,
    NA_character_, NA_character_
  )
  contextes <- resoudre_contextes_comparaison(
    reference,
    reference[reference$territoire == "22001", , drop = FALSE],
    "commune"
  )
  expect_equal(names(contextes), c("densite", "epci", "bretagne"))
  expect_equal(contextes$densite$member_code, "1")
  expect_equal(contextes$densite$member_selector, "classe_densite")
  expect_equal(contextes$epci$label, "communes de CA EPCI X")
  expect_equal(contextes$epci$member_code, "200000001")
  expect_equal(contextes$bretagne$member_type, "commune")

  contextes_sans_epci <- resoudre_contextes_comparaison(
    reference,
    reference[reference$territoire == "22003", , drop = FALSE],
    "commune"
  )
  expect_equal(names(contextes_sans_epci), c("densite", "bretagne"))

  batiments <- tibble::tibble(
    commune = c("22001", "22001", "22002", "22004", "29011"),
    breadth = c(1L, 2L, 3L, 4L, 4L),
    depth = c(1L, 2L, 3L, 4L, 4L)
  )
  rampe <- tibble::tibble(
    commune = c("22001", "22001", "22002", "22004", "29011"),
    breadth_c = c(1, 2, 3, 4, 4),
    breadth_b = c(2, 3, 4, 5, 5),
    breadth_t = c(3, 4, 5, 6, 6)
  )

  projections <- construire_contextes_acces_batiments(
    batiments, rampe, base, classes,
    territoires_reference = reference
  )
  density_distribution <- projections$distribution[
    projections$distribution$territoire == "22001" &
      projections$distribution$comparison_mode == "densite", , drop = FALSE
  ]
  expect_equal(nrow(density_distribution), 5L * 6L)
  expect_equal(sum(density_distribution$comparison_building_count), 4L)
  expect_equal(unique(density_distribution$comparison_total_buildings), 4L)
  expect_equal(unique(density_distribution$scope_kind), "communes-densite")
  epci_distribution <- projections$distribution[
    projections$distribution$territoire == "22001" &
      projections$distribution$comparison_mode == "epci", , drop = FALSE
  ]
  expect_equal(sum(epci_distribution$comparison_building_count), 3L)
  expect_equal(unique(epci_distribution$scope_label), "communes de CA EPCI X")

  density_ramp <- projections$rampe[
    projections$rampe$territoire == "22001" &
      projections$rampe$comparison_mode == "densite" &
      projections$rampe$mode == "t" &
      projections$rampe$quantile == 0.5, , drop = FALSE
  ]
  expect_equal(density_ramp$comparison_total_buildings, 4L)
  expect_equal(density_ramp$comparison_accessible_types, 4)

  expect_false(any(
    projections$distribution$territoire == "22003" &
      projections$distribution$comparison_mode == "epci"
  ))
  bretagne_distribution <- projections$distribution[
    projections$distribution$territoire == "22001" &
      projections$distribution$comparison_mode == "bretagne", , drop = FALSE
  ]
  expect_equal(sum(bretagne_distribution$comparison_building_count), 5L)
  expect_equal(unique(bretagne_distribution$comparison_total_buildings), 5L)
  expect_false(any(
    projections$distribution$territoire == "29011" &
      projections$distribution$comparison_mode == "densite"
  ))
  expect_false(any(
    projections$rampe$territoire == "29011" &
      projections$rampe$comparison_mode == "densite"
  ))

  # Deux bâtiments dans la seule commune de l'EPCI Z ne forment toujours pas
  # un groupe de comparaison : le dénominateur est le nombre de communes,
  # jamais le nombre de lignes bâtiment.
  batiments_groupe_insuffisant <- dplyr::bind_rows(
    batiments[batiments$commune == "29011", , drop = FALSE],
    batiments[batiments$commune == "29011", , drop = FALSE]
  )
  rampe_groupe_insuffisant <- dplyr::bind_rows(
    rampe[rampe$commune == "29011", , drop = FALSE],
    rampe[rampe$commune == "29011", , drop = FALSE]
  )
  projections_groupe_insuffisant <- construire_contextes_acces_batiments(
    batiments_groupe_insuffisant,
    rampe_groupe_insuffisant,
    base,
    classes,
    territoires_reference = reference
  )
  expect_false(any(
    projections_groupe_insuffisant$distribution$territoire == "29011" &
      projections_groupe_insuffisant$distribution$comparison_mode == "epci"
  ))
  expect_false(any(
    projections_groupe_insuffisant$rampe$territoire == "29011" &
      projections_groupe_insuffisant$rampe$comparison_mode == "epci"
  ))

  reference_sans_densite <- reference[
    setdiff(names(reference), c(
      "classe_densite_code", "classe_densite_libelle_insee",
      "classe_densite_libelle_public"
    ))
  ]
  projections_sans_densite <- construire_contextes_acces_batiments(
    batiments, rampe, base,
    territoires_reference = reference_sans_densite
  )
  expect_false(any(projections_sans_densite$distribution$comparison_mode == "densite"))
  expect_true(any(projections_sans_densite$distribution$comparison_mode == "epci"))
})

test_that("les projections refusent un référentiel de densité incomplet ou ambigu", {
  base <- tibble::tibble(
    CODGEO = c("22001", "22002"),
    EPCI = c("200000001", "200000001"),
    LIBEPCI = c("EPCI X", "EPCI X"),
    DEP = c("22", "22")
  )
  classes <- tibble::tibble(
    CODGEO = c("22001", "22002"),
    DENS7 = c("1", "1"),
    LIBDENS7 = c("Grands centres urbains", "Grands centres urbains")
  )
  batiments <- tibble::tibble(
    commune = c("22001", "22002"), breadth = c(1L, 2L), depth = c(1L, 2L)
  )

  expect_error(
    construire_contextes_acces_batiments(batiments, NULL, base),
    "référentiel de densité"
  )

  expect_error(
    construire_contextes_acces_batiments(batiments, NULL, base, classes[-1, ]),
    "sans classe de densité"
  )

  expect_error(
    construire_contextes_acces_batiments(
      batiments, NULL, base, dplyr::bind_rows(classes, classes[1, ])
    ),
    "jointure communale ambiguë"
  )
})
