# test-surface-reseaux-routiers -----------------------------------------------
# La surface du réseau routier OCS-GE (#552) : le fait est défini par l'usage
# US4.1.1, jamais par le statut juridique `artif`. L'agrégation découpe les
# polygones aux frontières communales et répartit la mesure `aire_m2` au prorata
# de la géométrie découpée.

test_that("calculer_surface_reseaux_routiers_communes compte US4.1.1 même non artificialisé", {
  polygones <- list(
    sf::st_polygon(list(rbind(
      c(20, 20), c(40, 20), c(40, 40), c(20, 40), c(20, 20)
    ))),
    sf::st_polygon(list(rbind(
      c(80, 20), c(120, 20), c(120, 60), c(80, 60), c(80, 20)
    ))),
    sf::st_polygon(list(rbind(
      c(120, 120), c(160, 120), c(160, 160), c(120, 160), c(120, 120)
    ))),
    sf::st_polygon(list(rbind(
      c(20, 120), c(40, 120), c(40, 140), c(20, 140), c(20, 120)
    )))
  )
  ocsge <- sf::st_sf(
    code_us = c("US4.1.1", "US4.1.1", "US5", "US4.1.1"),
    aire_m2 = c(400, 1600, 1600, 400),
    departement = c("22", "22", "22", "29"),
    # Le premier et le dernier sont explicitement non artificialisés : le
    # statut ne doit pas changer le fait de surface routière.
    artif = c("non artif", "non artif", "artif", "artif"),
    geometry = sf::st_sfc(polygones, crs = 2154)
  )
  communes <- sf::st_sf(
    code_insee = c("22001", "22002", "22003"),
    geometry = sf::st_sfc(
      sf::st_polygon(list(rbind(
        c(0, 0), c(100, 0), c(100, 100), c(0, 100), c(0, 0)
      ))),
      sf::st_polygon(list(rbind(
        c(100, 0), c(200, 0), c(200, 100), c(100, 100), c(100, 0)
      ))),
      sf::st_polygon(list(rbind(
        c(0, 100), c(100, 100), c(100, 200), c(0, 200), c(0, 100)
      ))),
      crs = 2154
    )
  )

  resultat <- calculer_surface_reseaux_routiers_communes(ocsge, communes)

  expect_equal(resultat$commune, c("22001", "22002", "22003"))
  expect_equal(resultat$surface_routiere_m2, c(1200, 800, 0))
  expect_equal(resultat$part_surface_routiere, c(0.12, 0.08, 0))
  expect_equal(resultat$aire_m2, c(10000, 10000, 10000))
})

test_that("agreger_surface_reseaux_routiers_territoires recalcule les parts depuis les surfaces", {
  communes <- tibble::tribble(
    ~commune, ~aire_m2, ~surface_routiere_m2,
    "22001", 10000, 1200,
    "22002", 10000, 800,
    "22003", 10000, 0
  ) %>%
    dplyr::mutate(part_surface_routiere = surface_routiere_m2 / aire_m2)
  base_epci <- tibble::tribble(
    ~CODGEO, ~EPCI, ~DEP,
    "22001", "200000001", "22",
    "22002", "200000001", "22",
    "22003", "200000002", "22"
  )

  resultat <- agreger_surface_reseaux_routiers_territoires(
    communes, base_epci
  )

  codes <- c(
    "22001", "22002", "22003", "200000001", "200000002", "22", "53"
  )
  expect_equal(
    resultat$value[match(codes, resultat$code)],
    c(0.12, 0.08, 0, 0.10, 0, 2 / 30, 2 / 30)
  )
})

test_that("normaliser_ocsge_reseaux_routiers conserve aire et code_us sans lire artif", {
  brut <- sf::st_sf(
    code_us = c("US4.1.1", "US5"),
    aire = c(400, 600),
    millesime = c("2023", "2023"),
    artif = c("non artif", "artif"),
    geometry = sf::st_sfc(
      sf::st_polygon(list(rbind(
        c(0, 0), c(20, 0), c(20, 20), c(0, 20), c(0, 0)
      ))),
      sf::st_polygon(list(rbind(
        c(30, 0), c(50, 0), c(50, 30), c(30, 30), c(30, 0)
      ))),
      crs = 2154
    )
  )

  resultat <- normaliser_ocsge_reseaux_routiers(brut, departement = "35")

  expect_true(all(c("code_us", "aire_m2", "millesime", "departement") %in%
                  names(resultat)))
  expect_equal(resultat$code_us, c("US4.1.1", "US5"))
  expect_equal(resultat$aire_m2, c(400, 600))
  expect_equal(resultat$millesime, c(2023L, 2023L))
  expect_equal(resultat$departement, c("35", "35"))
})

test_that("construire_donnees_ocsge_reseaux_routiers lit chaque millésime déclaré", {
  brut <- sf::st_sf(
    code_us = "US4.1.1",
    code_cs = "CS2.1.1.1",
    aire = 400,
    millesime = "2025",
    artif = "non artif",
    geometry = sf::st_sfc(sf::st_polygon(list(rbind(
      c(0, 0), c(20, 0), c(20, 20), c(0, 20), c(0, 0)
    ))), crs = 2154)
  )
  manifest <- tibble::tribble(
    ~id, ~fichier,
    "ocsge_reseaux_22_2025", "routes-22.7z",
    "ocsge_reseaux_35_2023", "routes-35.7z"
  )
  appels <- new.env()

  local_mocked_bindings(
    extraire_gpkg_ocsge = function(archive, extrait) {
      appels$archives <- c(appels$archives, archive)
      "routes.gpkg"
    },
    lire_ocsge_artificialisation = function(chemin) {
      appels$lectures <- c(appels$lectures, chemin)
      resultat <- brut
      if (length(appels$lectures) == 2L) resultat$millesime <- "2023"
      resultat
    },
    .package = "lusk"
  )

  resultat <- construire_donnees_ocsge_reseaux_routiers(
    cache = "cache-test", manifest = manifest, extrait = "extrait-test"
  )

  expect_equal(appels$archives, c("cache-test/routes-22.7z",
                                  "cache-test/routes-35.7z"))
  expect_equal(appels$lectures, c("routes.gpkg", "routes.gpkg"))
  expect_equal(resultat$departement, c("22", "35"))
  expect_equal(resultat$millesime, c(2025L, 2023L))
  expect_equal(resultat$aire_m2, c(400, 400))
})

test_that("le manifeste Mobilité déclare les quatre états OCS-GE routiers", {
  ids <- c(
    "ocsge_reseaux_22_2025", "ocsge_reseaux_29_2024",
    "ocsge_reseaux_35_2023", "ocsge_reseaux_56_2024"
  )

  expect_true(all(ids %in% MANIFEST_MOBILITE$id))
  expect_equal(MANIFEST_MOBILITE_OCSGE_RESEAUX$id, ids)
  expect_true(all(MANIFEST_MOBILITE_OCSGE_RESEAUX$licence == "lov2"))
  expect_true(all(MANIFEST_MOBILITE_OCSGE_RESEAUX$type == "fichier"))
})

test_that("surface_reseaux_routiers est une clé séparée et descriptive", {
  indicateur <- INDICATEURS_MOBILITE[
    INDICATEURS_MOBILITE$key == "surface_reseaux_routiers", ]

  expect_equal(nrow(indicateur), 1L)
  expect_equal(indicateur$source_reference, "ocsge_reseaux_routiers")
  expect_equal(indicateur$multiplicite, 1L)
  expect_equal(DIRECTIONS_MOBILITE$surface_reseaux_routiers, "low")
})
