test_that("tot_loss is required and bike loss is clamped", {
  expect_error(calculer_tot_loss_communes(tibble::tibble(commune = "29001")), "tot_loss")
  x <- calculer_tot_loss_communes(tibble::tibble(
    commune = c("29001", "29002"), med_tot_loss_t = c(4, 2), med_tot_loss_b = c(6, 1)))
  expect_equal(x$tot_loss_b, c(4, 1))
})

test_that("BPE B316 preserves absent communes and counts only B316", {
  x <- normaliser_bpe_b316(data.frame(GEO = c("29001", "29001", "35001"),
    FACILITY_TYPE = c("B316", "B999", "B316"), OBS_VALUE = c("2", "99", "0")))
  expect_equal(x$commune, c("29001", "35001"))
  expect_equal(x$fuel, c(2, 0))
  expect_equal(calculer_ratios_mobilite(data.frame(code = "29001", bornes = 0),
    x[x$commune == "29001", c("commune", "fuel")] |> dplyr::rename(code = commune),
    data.frame(code = "29001", places_velo = 1), data.frame(code = "29001", places_voiture = 1))$bornes_ev_par_station_service, 0)
})

test_that("BPE B316 protects the canonical FACILITIES/NB_EQUIP export shape", {
  x <- normaliser_bpe_b316(tibble::tibble(
    GEO = c("29001", "29002"), FACILITIES = c("B316", "B316"),
    NB_EQUIP = c("2", "0")))
  expect_equal(x, tibble::tibble(commune = c("29001", "29002"), fuel = c(2, 0)))
  expect_match(MANIFEST_MOBILITE_BPE_B316$url, "^file:///E:/Website/Data_handling/bpe_b316_2024\\.csv$")
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
