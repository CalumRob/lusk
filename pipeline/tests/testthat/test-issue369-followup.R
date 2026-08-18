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
    data.frame(code = "29001", places_velo = 1), data.frame(code = "29001", places_voiture = 1))$ev_fuel, 0)
})

test_that("street-side parking uses both legacy and lane tags", {
  skip_if_not_installed("sf")
  lim <- sf::st_sf(code_insee = "29001", geometry = sf::st_sfc(
    sf::st_polygon(list(rbind(c(0, 0), c(100, 0), c(100, 100), c(0, 100), c(0, 0)))), crs = 2154))
  parking <- sf::st_sf(osm_id = c("1", "1"), parking = c("surface", "surface"),
    geometry = sf::st_sfc(sf::st_polygon(list(rbind(c(1, 1), c(51, 1), c(51, 51), c(1, 51), c(1, 1)))),
      sf::st_polygon(list(rbind(c(1, 1), c(51, 1), c(51, 51), c(1, 51), c(1, 1)))), crs = 2154))
  lines <- sf::st_sf(`parking:left` = "both", geometry = sf::st_sfc(
    sf::st_linestring(rbind(c(1, 80), c(11, 80))), crs = 2154))
  out <- calculer_stationnement_voiture_communes(parking, lines, lim)
  expect_equal(out$places_voiture, 100 + 10 * 2 * 2.3 / 11.5)
})
