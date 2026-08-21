test_that("tot_loss is required and bike loss is clamped", {
  expect_error(calculer_tot_loss_communes(tibble::tibble(commune = "29001")), "tot_loss")
  x <- calculer_tot_loss_communes(tibble::tibble(
    commune = c("29001", "29002"), med_tot_loss_t = c(4, 2), med_tot_loss_b = c(6, 1)))
  expect_equal(x$tot_loss_b, c(4, 1))
})

test_that("BPE B316 preserves absent communes and counts only B316", {
  x <- normaliser_bpe_b316(data.frame(GEO = c("29001", "29001", "35001"),
    FACILITIES = c("B316", "B316", "B316"), NB_EQUIP = c("2", "0", "0")))
  expect_equal(x$commune, c("29001", "35001"))
  expect_equal(x$fuel, c(2, 0))
  expect_equal(calculer_ratios_mobilite(data.frame(code = "29001", bornes = 0),
    x[x$commune == "29001", c("commune", "fuel")] |> dplyr::rename(code = commune),
    data.frame(code = "29001", places_velo = 1), data.frame(code = "29001", places_voiture = 1))$bornes_ev_par_station_service, 0)
})

test_that("BPE B316 ignores non-B316 rows when a canonical table is mixed", {
  x <- normaliser_bpe_b316(data.frame(
    GEO = c("29001", "29001", "35001"),
    FACILITIES = c("B316", "B999", "B316"),
    NB_EQUIP = c("2", "99", "0")
  ))
  expect_equal(x$commune, c("29001", "35001"))
  expect_equal(x$fuel, c(2, 0))
})

test_that("BPE B316 rejects non-canonical legacy source shapes", {
  expect_error(normaliser_bpe_b316(data.frame(
    GEO = "29001", FACILITY_TYPE = "B316", OBS_VALUE = "2")),
    "GEO/FACILITIES/NB_EQUIP")
  expect_error(lire_bpe_b316(file.path(tempdir(), "wrong-source.parquet")), "BPE25.parquet")
})

test_that("BPE B316 protects the canonical FACILITIES/NB_EQUIP export shape", {
  x <- normaliser_bpe_b316(tibble::tibble(
    GEO = c("29001", "29002"), FACILITIES = c("B316", "B316"),
    NB_EQUIP = c("2", "0")))
  expect_equal(x, tibble::tibble(commune = c("29001", "29002"), fuel = c(2, 0)))
  expect_identical(MANIFEST_MOBILITE_BPE_B316$url,
                   "https://www.insee.fr/fr/statistiques/fichier/8217525/BPE25.parquet")
  expect_identical(MANIFEST_MOBILITE_BPE_B316$fichier, "BPE25.parquet")
  expect_identical(MANIFEST_MOBILITE_BPE_B316$vintage, "2025")
  expect_silent(verifier_contrat_mobilite_bpe_b316(
    MANIFEST_MOBILITE_BPE_B316,
    tibble::tibble(GEO = "29001", FACILITIES = "B316", NB_EQUIP = "2")))
  expect_error(verifier_contrat_mobilite_bpe_b316(
    MANIFEST_MOBILITE_BPE_B316, tibble::tibble(GEO = "29001", OBS_VALUE = "2")),
    "GEO/FACILITIES/NB_EQUIP")
  expect_silent(verifier_contenu_bpe_b316(
    tibble::tibble(GEO = "29001", FACILITIES = "B316", NB_EQUIP = "2")))
  expect_error(verifier_contenu_bpe_b316(tibble::tibble(GEO = "29001", NB_EQUIP = "2")),
               "GEO/FACILITIES/NB_EQUIP")
  expect_error(verifier_contenu_bpe_b316(tibble::tibble(
    GEO = "29001", FACILITIES = "B999", NB_EQUIP = "2")),
    "aucune ligne B316")
  expect_error(verifier_contenu_bpe_b316(tibble::tibble(
    GEO = "29001", FACILITIES = "B316", NB_EQUIP = "-1")),
    "non négatif")
  expect_error(verifier_contenu_bpe_b316(tibble::tibble(
    GEO = "29001", FACILITIES = NA_character_, NB_EQUIP = "1")),
    "manquant")
  expect_error(verifier_contenu_bpe_b316(tibble::tibble(
    GEO = "29X01", FACILITIES = "B316", NB_EQUIP = "1")),
    "invalide")
})

test_that("BPE25 counts geolocalized B316 equipment rows by commune", {
  brut <- tibble::tribble(
    ~DEPCOM, ~GEO_OBJECT, ~TYPEQU,
    "29001", "COM", "B316",
    "29001", "COM", "B316",
    "29002", "COM", "B999",
    "75001", "COM", "B316",
    "2A004", "COM", "B316",
    "29001", "COM", "B999",
    "200000001", "EPCI", "B316"
  )
  expect_equal(selectionner_bpe_b316_2025(brut), tibble::tibble(
    GEO = c("29002", "29001", "29001"),
    FACILITIES = c("B316", "B316", "B316"), NB_EQUIP = c(0, 1, 1)))
  expect_equal(normaliser_bpe_b316(brut)$fuel, c(2, 0))
  expect_error(selectionner_bpe_b316_2025(brut[3, , drop = FALSE]), "aucune observation")
  expect_error(selectionner_bpe_b316_2025(brut[6, , drop = FALSE]), "aucune observation")
})

test_that("BPE25 coverage turns non-B316 equipment into observed fuel zero", {
  brut <- tibble::tribble(
    ~DEPCOM, ~GEO_OBJECT, ~TYPEQU,
    "29001", "COM", "B999",
    "29002", "COM", "B316",
    "29002", "COM", "B316"
  )
  selected <- selectionner_bpe_b316_2025(brut)
  expect_equal(normaliser_bpe_b316(selected), tibble::tibble(
    commune = c("29001", "29002"), fuel = c(0, 2)))
  expect_false("29003" %in% normaliser_bpe_b316(selected)$commune)
})

test_that("complete BPE coverage sums zero and positive members before parent ratio", {
  ref <- tibble::tribble(~CODGEO, ~EPCI, ~DEP,
                         "29001", "200000001", "29",
                         "29002", "200000001", "29")
  out <- agreger_offre_territoires(
    offre_tc_communes = tibble::tibble(commune = ref$CODGEO,
                                       n_batiments = 1, part_proche = 1),
    bornes_communes = tibble::tibble(commune = ref$CODGEO, nb_bornes = c(2, 4)),
    velo_communes = tibble::tibble(commune = ref$CODGEO, places = 1,
                                   population = 100, places_1000 = 10),
    base_epci = ref,
    fuel_communes = calculer_fuel_communes(tibble::tibble(
      commune = ref$CODGEO, fuel = c(0, 2)))
  )
  ratio <- out$value[out$key == "bornes_ev_par_station_service" &
                     out$code == "200000001"]
  expect_equal(ratio, 3)
})

test_that("BPE25 rejects malformed equipment observations", {
  expect_error(verifier_contenu_bpe_b316(tibble::tibble(
    GEO = "29001", FACILITIES = "B316", NB_EQUIP = "abc")), "non négatif")
  expect_error(verifier_contenu_bpe_b316(tibble::tibble(
    GEO = "29001", FACILITIES = "B316", NB_EQUIP = "-1")), "non négatif")
  expect_error(selectionner_bpe_b316_2025(tibble::tibble(
    DEPCOM = "29001", TYPEQU = NA_character_)), "TYPEQU")
  expect_error(selectionner_bpe_b316_2025(tibble::tibble(
    DEPCOM = "29X01", TYPEQU = "B316")), "invalide")
  expect_error(selectionner_bpe_b316_2025(tibble::tibble(
    DEPCOM = "200000001", GEO_OBJECT = "EPCI", TYPEQU = "B316")),
    "aucune observation")
})

test_that("mixed unavailable BPE values remain unavailable during aggregation", {
  ref <- tibble::tribble(~CODGEO, ~EPCI, ~DEP,
                         "29001", "200000001", "29",
                         "29002", "200000001", "29")
  out <- agreger_offre_territoires(
    offre_tc_communes = tibble::tibble(commune = c("29001", "29002"), n_batiments = 1, part_proche = 1),
    bornes_communes = tibble::tibble(commune = "29001", nb_bornes = 1),
    velo_communes = tibble::tibble(commune = c("29001", "29002"), places = 1, population = 100, places_1000 = 10),
    base_epci = ref,
    fuel_communes = tibble::tibble(code = "29001", fuel = 2)
  )
  ratio <- out[out$key == "bornes_ev_par_station_service" & out$code == "200000001", ]
  expect_true(is.na(ratio$value))
})

test_that("B316 fuel counts aggregate before division through every territory level", {
  ref <- tibble::tribble(
    ~CODGEO, ~EPCI, ~DEP,
    "29001", "200000001", "29",
    "29002", "200000001", "29",
    "35001", "200000002", "35"
  )
  bornes <- tibble::tibble(
    code = c("29001", "29002", "35001"), bornes = c(4, 6, 10))
  fuel <- tibble::tibble(
    code = c("29001", "29002", "35001"), fuel = c(1, 3, 5))

  out <- agreger_offre_territoires(
    offre_tc_communes = tibble::tibble(commune = ref$CODGEO,
                                       n_batiments = 1, part_proche = 1),
    bornes_communes = bornes %>% dplyr::rename(commune = code,
                                                nb_bornes = bornes),
    velo_communes = tibble::tibble(commune = ref$CODGEO,
                                   places = 1, population = 100,
                                   places_1000 = 10),
    base_epci = ref,
    fuel_communes = fuel
  )
  ratio <- out[out$key == "bornes_ev_par_station_service", ]
  lire <- function(code) ratio$value[ratio$code == code]

  # Counts are summed before division: the EPCI is 10 / (1 + 3), not
  # the mean of its commune ratios (4 and 2).
  expect_equal(lire("29001"), 4)
  expect_equal(lire("200000001"), 2.5)
  expect_equal(lire("29"), 2.5)
  expect_equal(lire("53"), 20 / 9)
})

test_that("the durable parking comparison decision publishes only the count ratio", {
  expect_identical(RATIO_STATIONNEMENT_VELO_DECISION,
                   "places_velo_par_places_voiture")
})

test_that("total-loss aggregation and ranks keep the two canonical keys separate", {
  snap <- tibble::tibble(
    commune = c("29001", "29002"), nb_buildings = c(10, 20),
    med_tot_loss_t = c(4, 8), med_tot_loss_b = c(6, 3),
    med_tot_loss_t_epci = 6, med_tot_loss_b_epci = 3,
    med_tot_loss_t_dep = 6, med_tot_loss_b_dep = 3,
    med_tot_loss_t_reg = 6, med_tot_loss_b_reg = 3)
  ref <- tibble::tribble(~CODGEO, ~EPCI, ~DEP,
                         "29001", "200000001", "29",
                         "29002", "200000001", "29")
  tot <- agreger_tot_loss_territoires(calculer_tot_loss_communes(snap), snap, ref)
  expect_equal(tot$tot_loss_b[tot$code == "29001"], 4)
  expect_equal(tot$tot_loss_b[tot$code != "29001"], c(3, 3, 3, 3))
  territoires <- tibble::tibble(code = c("29001", "29002", "200000001", "29", "53"),
                                type = c("commune", "commune", "epci", "departement", "region"),
                                epci = c("200000001", "200000001", NA, NA, NA),
                                departement = c("29", "29", NA, NA, NA))
  long <- tidyr::pivot_longer(tot, c(tot_loss_t, tot_loss_b), names_to = "key", values_to = "value") |>
    dplyr::mutate(detail = NA_character_)
  ranks <- construire_rangs_detail(long, territoires)
  expect_setequal(unique(ranks$key), c("tot_loss_t", "tot_loss_b"))
  expect_equal(nrow(ranks), nrow(long))
})

test_that("total-loss clamp is preserved at commune, EPCI, department and region", {
  x <- tibble::tibble(commune = c("29001", "29002"), nb_buildings = c(10, 20),
                      med_tot_loss_t = c(4, 8), med_tot_loss_b = c(9, 3),
                      med_tot_loss_t_epci = 6, med_tot_loss_b_epci = 9,
                      med_tot_loss_t_dep = 6, med_tot_loss_b_dep = 9,
                      med_tot_loss_t_reg = 6, med_tot_loss_b_reg = 9)
  ref <- tibble::tribble(~CODGEO, ~EPCI, ~DEP,
                         "29001", "200000001", "29",
                         "29002", "200000001", "29")
  out <- agreger_tot_loss_territoires(calculer_tot_loss_communes(x), x, ref)
  expect_true(all(out$tot_loss_b <= out$tot_loss_t))
  expect_equal(out$tot_loss_b[out$code == "29001"], 4)
  expect_equal(out$tot_loss_b[out$code == "200000001"], 6)
  expect_equal(out$tot_loss_b[out$code == "29"], 6)
  expect_equal(out$tot_loss_b[out$code == "53"], 6)
})

test_that("street-side parking uses both legacy and lane tags", {
  skip_if_not_installed("sf")
  lim <- sf::st_sf(code_insee = "29001", geometry = sf::st_sfc(
    sf::st_polygon(list(rbind(c(0, 0), c(100, 0), c(100, 100), c(0, 100), c(0, 0)))), crs = 2154))
  parking <- sf::st_sf(osm_id = c("1", "1"), parking = c("surface", "surface"),
    geometry = sf::st_sfc(sf::st_polygon(list(rbind(c(1, 1), c(51, 1), c(51, 51), c(1, 51), c(1, 1)))),
      sf::st_polygon(list(rbind(c(1, 1), c(51, 1), c(51, 51), c(1, 51), c(1, 1)))), crs = 2154))
  lines <- sf::st_sf(highway = "residential", `parking:left` = "both", geometry = sf::st_sfc(
    sf::st_linestring(rbind(c(1, 80), c(11, 80))), crs = 2154))
  out <- calculer_stationnement_voiture_communes(parking, lines, lim)
  expect_equal(out$places_voiture, 100 + 10 * 2 * 2.3 / 11.5)
})

test_that("invalid closed parking geometry is repaired before attribution", {
  skip_if_not_installed("sf")
  # A self-crossing closed way is the minimal form of the OSM defect seen in
  # the Bretagne extract (duplicate/overlapping member edges are repaired by
  # the same GEOS operation).
  parking <- sf::st_sf(
    osm_id = "invalid-way",
    amenity = "parking",
    parking = "surface",
    geometry = sf::st_sfc(sf::st_polygon(list(rbind(
      c(1, 1), c(5, 5), c(1, 5), c(5, 1), c(1, 1)
    ))), crs = 2154)
  )
  limites <- sf::st_sf(
    code_insee = "29001",
    geometry = sf::st_sfc(sf::st_polygon(list(rbind(
      c(0, 0), c(10, 0), c(10, 10), c(0, 10), c(0, 0)
    ))), crs = 2154)
  )
  expect_false(sf::st_is_valid(parking))
  repaired <- normaliser_parkings_osm(parking)
  expect_true(all(sf::st_is_valid(repaired)))
  lignes <- sf::st_sf(highway = character(), geometry = sf::st_sfc(crs = 2154))
  out <- calculer_stationnement_voiture_communes(repaired, lignes, limites)
  expect_equal(out$commune, "29001")
  expect_equal(out$places_voiture, as.numeric(sf::st_area(repaired)) / 25)
})

test_that("parking per 1000 inhabitants keeps population through aggregation", {
  base <- tibble::tribble(~CODGEO, ~EPCI, ~DEP,
                          "29001", "200000001", "29")
  voiture <- tibble::tibble(commune = "29001", places_voiture = 25)
  velo <- tibble::tibble(commune = "29001", places = 10, population = 1000)
  out <- agreger_stationnement_voiture_territoires(voiture, velo, base)
  ratio <- out[out$key == "places_stationnement_voiture_1000" & out$code == "29001", ]
  expect_equal(ratio$value, 25)
  expect_true(is.finite(ratio$value))
})
