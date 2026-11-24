# Slow tier (#1172): the complete Mobility fixture uses the committed territory universe and
# national raccordement artefact. It protects all 17 indicator keys/ranks/clocks and loud theme validation.
# Run from pipeline/: Rscript -e "pkgload::load_all('.', quiet=TRUE); testthat::test_file('slow-tests/test-theme-mobilite-whole-payload.R', package='lusk')"

# fixture_raccordement ------------------------------------------------------------
# L'assembleur national consomme un résultat complet et validé, jamais une
# miniature présentée comme la production nationale. Les exemples de calcul à
# trois communes restent à la couture du calcul dans test-raccordement-national.
fixture_raccordement <- function() {
  lire_artefact_raccordement_national()
}

territoires_fixture_indicateurs_mobilite <- function() {
  path <- file.path(pkgload::pkg_path(), "..", "public", "data", "territoires.parquet")
  nanoparquet::read_parquet(path) %>% dplyr::rename(code = territoire)
}

histoires_fixture_indicateurs_mobilite <- function() {
  # #1048 : le producteur n'émet plus aucune lecture — la table est VIDE.
  # Le Parquet `histoires_mobilite.parquet` committé est l'état ANTÉRIEUR au
  # retrait (facts non republiés en slice 2) : il ne doit plus servir de fixture.
  data.frame(
    territoire = character(), type = character(), theme = character(),
    story_key = character(), stringsAsFactors = FALSE
  )
}

# fixture_indicateurs_mobilite ---------------------------------------------------
 # La liste des artefacts analytiques pour l'assemblage des indicateurs (le seam
 # construire_indicateurs_mobilite, issue #141) : la « Taille », les 5 parts
# d'isolation et LEURS RANGS (mocked — la forme exacte des artefacts que le
# chaînon persiste : isolation_territoires.rds et isolation_rangs.rds), l'étage
# demande/réseaux et le sous-bloc. La forme de chaque table est celle des
# builders réels — le seam ne calcule RIEN, il assemble.

fixture_indicateurs_mobilite <- function() {
  territoires <- territoires_fixture_indicateurs_mobilite()
  codes <- territoires$codes %||% territoires$code
  voitures_territoires <- tidyr::crossing(code = codes,
    detail = c("sans_voiture", "une_voiture", "deux_plus")) %>%
    dplyr::mutate(key = "voitures_menage",
      value = dplyr::if_else(detail == "sans_voiture", 0.2,
                             dplyr::if_else(detail == "une_voiture", 0.5, 0.3)))
  reseaux_territoires <- tidyr::crossing(code = codes,
    detail = c("t_longueur", "b_longueur", "c_longueur")) %>%
    dplyr::mutate(key = "reseaux", value = 1)
  reseaux_par_habitant_territoires <- tidyr::crossing(code = codes,
    detail = c("t_km_1000", "b_km_1000", "c_km_1000")) %>%
    dplyr::mutate(key = "reseaux_par_habitant", value = 2)
  surface_reseaux_routiers_territoires <- tibble::tibble(code = codes, value = 0.1)
  offre_territoires <- dplyr::bind_rows(
    tidyr::crossing(code = codes, key = c("offre_tc", "bornes_recharge",
      "places_stationnement_velo_1000", "places_stationnement_voiture_1000",
      "bornes_ev_par_station_service", "stationnement_velo_par_voiture",
      "stations_service", "stations_service_1000", "bornes_recharge_1000")) %>%
      dplyr::mutate(detail = NA_character_,
                    value = dplyr::if_else(key == "offre_tc", 0.5, 10)),
    tidyr::crossing(code = codes,
      detail = c("protege_longueur", "protege_km_1000", "partage_longueur",
                 "partage_km_1000", "total_longueur")) %>%
      dplyr::mutate(key = "offre_cyclable", value = 1)
  )
  list(
    voitures_territoires = voitures_territoires,
    reseaux_territoires = reseaux_territoires,
    reseaux_par_habitant_territoires = reseaux_par_habitant_territoires,
    surface_reseaux_routiers_territoires = surface_reseaux_routiers_territoires,
    offre_territoires = offre_territoires,
    raccordement = fixture_raccordement()
  )
}

test_that("construire_indicateurs_mobilite : les dix-sept clés retenues, leurs rangs et estampilles", {
  fx <- fixture_indicateurs_mobilite()
  territoires <- territoires_fixture_indicateurs_mobilite()
  n_territoires <- nrow(territoires)
  ind <- construire_indicateurs_mobilite(fx, territoires, vintages_mobilite())
  expect_setequal(unique(ind$key), c("voitures_menage", "reseaux", "reseaux_par_habitant",
  "surface_reseaux_routiers", "offre_tc", "bornes_recharge",
  "places_stationnement_velo_1000", "places_stationnement_voiture_1000",
  "bornes_ev_par_station_service", "stationnement_velo_par_voiture",
  "stations_service", "stations_service_1000", "bornes_recharge_1000",
  "offre_cyclable", "raccordement_tc", "raccordement_courbe",
  "raccordement_reference"))
  expect_false(any(c("nb_buildings", "tot_loss_t", "iso_banque",
                     "share_food_t", "avg_tot_car") %in% ind$key))
  grille_n <- length(grille_raccordement_national())
  expect_equal(nrow(ind),
    n_territoires * (3L + 3L + 3L + 1L + 9L + 5L + 1L) +
      n_territoires * grille_n + grille_n)
  expect_equal(sum(ind$key == "voitures_menage"), n_territoires * 3)
  expect_equal(sum(ind$key == "reseaux"), n_territoires * 3)
  expect_equal(sum(ind$key == "reseaux_par_habitant"), n_territoires * 3)
  expect_equal(sum(ind$key == "surface_reseaux_routiers"), n_territoires)
  expect_equal(sum(ind$key == "offre_cyclable"), n_territoires * 5)
  for (cle in c("offre_tc", "bornes_recharge", "places_stationnement_velo_1000",
                "places_stationnement_voiture_1000", "bornes_ev_par_station_service",
                "stationnement_velo_par_voiture", "stations_service",
                "stations_service_1000", "bornes_recharge_1000"))
    expect_equal(sum(ind$key == cle), n_territoires, info = cle)
  expect_equal(unique(ind$unit[ind$key == "stations_service"]), "stations")
  expect_equal(unique(ind$unit[ind$key == "bornes_recharge_1000"]), "bornes / 1 000 hab")
  for (cle in c("stations_service", "stations_service_1000", "bornes_recharge_1000"))
    expect_true(any(!is.na(ind$rang_epci[ind$key == cle])), info = cle)
  # l'estampille de l'offre cyclable : l'horloge lente OSM
  ref_osm <- vintages_mobilite()$source[vintages_mobilite()$id == "osm_reseaux"]
  expect_true(all(ind$vintage_source[ind$key == "offre_cyclable"] == ref_osm))
  # LE RACCORDEMENT : le scalaire et ses deux clés de figure
  racc_ind <- ind[ind$key == "raccordement_tc", ]
  expect_equal(racc_ind$value[racc_ind$territoire == "35238"], 0.43772196082183124)
  non_routee <- racc_ind[racc_ind$territoire == "22001", ]
  expect_equal(non_routee$value, 0)
  expect_equal(non_routee$rider, "no_modeled_endpoint_stops")
  ref_national <- vintages_mobilite()$source[
    vintages_mobilite()$id == "raccordement_gtfs_national"]
  expect_true(all(racc_ind$vintage_source == ref_national))
  expect_true(all(racc_ind$vintage_date_reference == "2026-10-10"))
  courbe_ind <- ind[ind$key == "raccordement_courbe", ]
  expect_equal(sum(courbe_ind$territoire == "22001"), grille_n)
  expect_setequal(courbe_ind$detail[courbe_ind$territoire == "22001"],
                  grille_raccordement_national())
  reference_ind <- ind[ind$key == "raccordement_reference", ]
  expect_setequal(unique(reference_ind$territoire), "53")
  expect_equal(nrow(reference_ind), grille_n)
})

test_that("validations_mobilite : le raccordement hors domaine ou hors grille fait échouer la validation bruyamment (#486)", {
  fx <- fixture_indicateurs_mobilite()
  territoires <- territoires_fixture_indicateurs_mobilite()
  fabriquer_payload <- function() list(
    indicateurs = construire_indicateurs_mobilite(fx, territoires,
                                                  vintages_mobilite()),
    histoires = histoires_fixture_indicateurs_mobilite(),
    territoires = reference_territoires(territoires),
    apercu = assemble_apercu(territoires, list())
  )

  # une part joignable > 1 (une corruption du calcul) fait échouer
  payload <- fabriquer_payload()
  payload$indicateurs$value[
    payload$indicateurs$key == "raccordement_tc" &
      payload$indicateurs$territoire == "22001"] <- 1.5
  expect_error(validate_payload(
    payload, indicateurs = INDICATEURS_MOBILITE,
    vintages = vintages_mobilite(), validations = validations_mobilite,
    apercu = APERCU_MOBILITE), "population joignable")

  # un détail de courbe HORS GRILLE (91 minutes) fait échouer
  payload <- fabriquer_payload()
  courbe <- which(payload$indicateurs$key == "raccordement_courbe" &
                    payload$indicateurs$detail == "t0090")
  payload$indicateurs$detail[courbe[1]] <- "t0091"
  expect_error(validate_payload(
    payload, indicateurs = INDICATEURS_MOBILITE,
    vintages = vintages_mobilite(), validations = validations_mobilite,
    apercu = APERCU_MOBILITE), "grille publiée")

  # un détail MAL FORMÉ fait échouer
  payload <- fabriquer_payload()
  courbe <- which(payload$indicateurs$key == "raccordement_reference" &
                    payload$indicateurs$detail == "t0000")
  payload$indicateurs$detail[courbe[1]] <- "90 minutes"
  expect_error(validate_payload(
    payload, indicateurs = INDICATEURS_MOBILITE,
    vintages = vintages_mobilite(), validations = validations_mobilite,
    apercu = APERCU_MOBILITE), "grille publiée")
})
