# test-theme-mobilite-ravitaillement ---------------------------------------------
# Le verrou « données réelles » des densités de ravitaillement (issue #953) : la
# preuve est testée sur son SEAM DE VÉRIFICATION, pas sur une arithmétique de
# helper. Les entrées synthétiques sont mélangées et multi-territoires — le
# verrou doit s'aligner par clé de territoire (jamais par recyclage positionnel
# d'un vecteur de codes), distinguer un zéro OBSERVÉ d'une observation ABSENTE,
# et refuser une preuve comptable manquante ou un ratio incohérent.

base_ravitaillement_test <- function() {
  tibble::tribble(
    ~CODGEO, ~EPCI, ~DEP,
    "22001", "200000001", "22",
    "22002", "200000001", "22",
    "29001", "200000002", "29",
    "29002", NA, "29"
  )
}

population_ravitaillement_test <- function() {
  c("22001" = 1000, "22002" = 3000, "29001" = 2000, "29002" = 4000)
}

# La forme longue (code × key × detail × value) que agreger_offre_territoires
# publie — construite depuis les comptes communaux et la population, avec la
# règle NA d'une observation BPE absente (jamais un zéro inventé).
offre_ravitaillement_test <- function(fuel, bornes, base, population) {
  ctx <- base %>%
    dplyr::transmute(
      commune = CODGEO,
      fuel = unname(fuel[CODGEO]),
      bornes = unname(bornes[CODGEO]),
      population = unname(population[CODGEO]),
      EPCI = EPCI, DEP = DEP
    )
  resumer <- function(x) {
    tibble::tibble(
      stations = if (anyNA(x$fuel)) NA_real_ else sum(x$fuel),
      bornes = sum(x$bornes),
      population = sum(x$population)
    )
  }
  niveaux <- dplyr::bind_rows(
    ctx %>% dplyr::transmute(code = commune, stations = fuel,
                             bornes = bornes, population = population),
    ctx %>% dplyr::filter(!is.na(EPCI)) %>%
      dplyr::group_by(code = EPCI) %>%
      dplyr::group_modify(~resumer(.x)) %>% dplyr::ungroup(),
    ctx %>% dplyr::group_by(code = DEP) %>%
      dplyr::group_modify(~resumer(.x)) %>% dplyr::ungroup(),
    resumer(ctx) %>% dplyr::mutate(code = "53")
  ) %>%
    dplyr::mutate(
      stations_service = stations,
      stations_service_1000 = stations / population * 1000,
      bornes_recharge = bornes,
      bornes_recharge_1000 = bornes / population * 1000,
      bornes_ev_par_station_service = dplyr::if_else(
        !is.na(stations) & stations > 0, bornes / stations, NA_real_
      )
    )
  niveaux %>%
    dplyr::select(code, stations_service, stations_service_1000,
                  bornes_recharge, bornes_recharge_1000,
                  bornes_ev_par_station_service) %>%
    tidyr::pivot_longer(-code, names_to = "key", values_to = "value") %>%
    dplyr::mutate(detail = NA_character_)
}

donnees_ravitaillement_test <- function(fuel) {
  list(stations_service = tibble::tibble(
    commune = names(fuel), fuel = unname(fuel)))
}

analytiques_ravitaillement_test <- function(base, population) {
  list(stationnement_velo_communes = tibble::tibble(
    commune = base$CODGEO, population = unname(population[base$CODGEO])))
}

test_that("le verrou de ravitaillement s'aligne par code sur une offre mélangée multi-territoires (#953)", {
  base <- base_ravitaillement_test()
  population <- population_ravitaillement_test()
  fuel <- c("22001" = 0, "22002" = 2, "29001" = 1, "29002" = 3)
  bornes <- c("22001" = 4, "22002" = 2, "29001" = 1, "29002" = 3)
  donnees <- donnees_ravitaillement_test(fuel)
  analytiques <- analytiques_ravitaillement_test(base, population)
  offre <- offre_ravitaillement_test(fuel, bornes, base, population)

  # l'ordre des lignes ne change rien : l'alignement lit les clés de territoire
  melangee <- offre[rev(seq_len(nrow(offre))), ]
  expect_no_error(verifier_ravitaillement_mobilite(
    melangee, donnees, base, analytiques))

  # une preuve comptable MANQUANTE pour un code publié au ratio échoue fort
  sans_preuve <- offre[!(offre$key == "stations_service" & offre$code == "29"), ]
  expect_error(
    verifier_ravitaillement_mobilite(sans_preuve, donnees, base, analytiques),
    "preuve comptable"
  )

  # un ratio incohérent sur UN code (au milieu de plusieurs) échoue fort
  casse <- offre
  casse$value[casse$key == "bornes_ev_par_station_service" &
                casse$code == "29"] <- 99
  expect_error(
    verifier_ravitaillement_mobilite(casse, donnees, base, analytiques),
    "ne recompose pas"
  )

  # un ratio publié sans station-service est impossible
  sans_station <- offre
  sans_station$value[sans_station$key == "stations_service" &
                       sans_station$code == "29002"] <- 0
  sans_station$value[sans_station$key == "bornes_ev_par_station_service" &
                       sans_station$code == "29002"] <- 5
  expect_error(
    verifier_ravitaillement_mobilite(sans_station, donnees, base, analytiques),
    "sans station-service"
  )
})

test_that("le verrou distingue un zéro observé d'une observation BPE absente (#953)", {
  base <- base_ravitaillement_test()
  population <- population_ravitaillement_test()
  bornes <- c("22001" = 4, "22002" = 2, "29001" = 1, "29002" = 3)

  # zéro OBSERVÉ : la commune couverte sans station publie 0 (compte et taux),
  # et le ratio reste indisponible (dénominateur nul)
  fuel_zero <- c("22001" = 0, "22002" = 2, "29001" = 1, "29002" = 3)
  offre_zero <- offre_ravitaillement_test(fuel_zero, bornes, base, population)
  expect_no_error(verifier_ravitaillement_mobilite(
    offre_zero, donnees_ravitaillement_test(fuel_zero), base,
    analytiques_ravitaillement_test(base, population)))
  lire <- function(offre, code, key) {
    offre$value[offre$code == code & offre$key == key]
  }
  expect_equal(lire(offre_zero, "22001", "stations_service"), 0)
  expect_equal(lire(offre_zero, "22001", "stations_service_1000"), 0)
  expect_true(is.na(lire(offre_zero, "22001", "bornes_ev_par_station_service")))
  # et le compte de la région reste la somme des parties (zéro inclus)
  expect_equal(lire(offre_zero, "53", "stations_service"), 6)

  # observation ABSENTE : 29002 n'est pas couverte par la BPE — son compte et
  # tous les agrégats qui la contiennent restent absents, jamais un zéro
  fuel_absent <- c("22001" = 0, "22002" = 2, "29001" = 1)
  donnees_absent <- donnees_ravitaillement_test(fuel_absent)
  offre_absent <- offre_ravitaillement_test(fuel_absent, bornes, base, population)
  expect_true(is.na(lire(offre_absent, "29002", "stations_service")))
  expect_true(is.na(lire(offre_absent, "29", "stations_service")))
  expect_true(is.na(lire(offre_absent, "53", "stations_service")))
  expect_no_error(verifier_ravitaillement_mobilite(
    offre_absent, donnees_absent, base,
    analytiques_ravitaillement_test(base, population)))

  # un zéro INVENTÉ pour l'observation absente est refusé (compte régional
  # amputé en silence)
  invente <- offre_absent
  invente$value[invente$code == "53" & invente$key == "stations_service"] <- 0
  expect_error(
    verifier_ravitaillement_mobilite(
      invente, donnees_absent, base,
      analytiques_ravitaillement_test(base, population)),
    "BPE incomplète"
  )
})
