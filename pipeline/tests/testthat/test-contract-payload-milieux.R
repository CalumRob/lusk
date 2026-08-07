# test-contract-payload-milieux -------------------------------------------------
# Le SEAM de test du payload Milieux (issue #171) : même fixture -> même
# payload, pour toujours. Le TRACEUR publie un payload squelettique — la clé
# conso_enaf (la consommation totale d'ENAF 2011-2025, en hectares, une ligne
# par territoire), la table apercu VIDE mais présente (la forme du contrat) —
# et CE payload passe la validation GÉNÉRIQUE (validate_payload : forme,
# couverture des territoires, estampilles vintage). Depuis l'Histoire (#174),
# la table histoires porte une ligne par territoire : les deux forces de la
# lecture (Δpopulation de la série historique, consommation de la fenêtre
# re-sommée), l'intensité et la classification (détaillés dans
# test-theme-milieux-histoire.R). La conversion m² -> ha est prouvée bout en
# bout : la valeur publiée d'une commune EST sa consommation en hectares.

test_that("le payload Milieux couvre chaque territoire du fixture", {
  payload <- compute_payload(communes_fixture_milieux(),
                             theme = theme_milieux())

  territoires_attendus <- c(
    "22001", "22002", "29001", "29002", "29003", # communes
    "200000001", "200000002",                    # EPCIs
    "22", "29",                                  # départements
    "53"                                         # région Bretagne
  )
  expect_setequal(unique(payload$indicateurs$territoire), territoires_attendus)
  # la table de référence couvre les mêmes territoires, une fois chacun
  expect_setequal(payload$territoires$territoire, territoires_attendus)
  expect_equal(nrow(payload$territoires), length(territoires_attendus))
})

test_that("la forme des quatre tables est le contrat (payload squelettique)", {
  payload <- compute_payload(communes_fixture_milieux(),
                             theme = theme_milieux())

  expect_named(payload, c("indicateurs", "histoires", "territoires", "apercu"))
  expect_named(payload$indicateurs, c(
    "territoire", "type", "theme", "key", "detail", "value", "unit",
    "rang_epci", "rang_dep", "rang_reg",
    "vintage_source", "vintage_version",
    "vintage_date_reference", "vintage_date_publication"
  ))
  # histoires : la forme du contrat de l'Histoire (#174) — une ligne par
  # territoire, les forces de la lecture et la classification
  expect_named(payload$histoires, c(
    "territoire", "type", "theme", "story_key", "periode",
    "delta_population", "conso_fenetre", "intensite_m2_par_habitant",
    "classification"
  ))
  expect_equal(nrow(payload$histoires), nrow(payload$territoires))
  expect_named(payload$apercu, c("territoire", "type", "key", "value", "unit"))
  expect_equal(nrow(payload$apercu), 0L)
  expect_true(all(payload$indicateurs$theme == "milieux"))
})

test_that("chaque territoire porte la clé conso_enaf — la conversion m² -> ha prouvée bout en bout", {
  payload <- compute_payload(communes_fixture_milieux(),
                             theme = theme_milieux())

  expect_setequal(unique(payload$indicateurs$key), "conso_enaf")
  # une ligne par territoire
  expect_equal(nrow(payload$indicateurs), nrow(payload$territoires))

  valeur <- function(code) {
    payload$indicateurs$value[payload$indicateurs$territoire == code]
  }
  # communes : les valeurs du reshape (m² -> ha), vérifiées à la main
  expect_equal(valeur("22001"), 1233202 / 10000)   # 123,3202 ha
  expect_equal(valeur("22002"), 25)
  expect_equal(valeur("29001"), 50)
  expect_equal(valeur("29002"), 7.5)
  # la commune sans donnée porte NA (un total incomplet, jamais un 0 inventé)
  expect_true(is.na(valeur("29003")))
  # agrégats : les sommes des parties
  expect_equal(valeur("200000001"), 1233202 / 10000 + 25)  # EPCI X
  expect_equal(valeur("22"), 1233202 / 10000 + 25)          # département 22
  # EPCI Y / département 29 / région : incomplets (membre 29003 NA) -> NA
  expect_true(is.na(valeur("200000002")))
  expect_true(is.na(valeur("29")))
  expect_true(is.na(valeur("53")))
  # l'unité du contrat
  expect_true(all(payload$indicateurs$unit == "ha"))
})

test_that("chaque indicateur est estampillé depuis sa source de référence (CONSOENAF)", {
  payload <- compute_payload(communes_fixture_milieux(),
                             theme = theme_milieux())

  v <- vintages_milieux()
  conso <- v[v$id == "consoenaf", ]
  expect_true(all(payload$indicateurs$vintage_source == conso$source))
  expect_true(all(payload$indicateurs$vintage_version == "2025"))
  expect_true(all(payload$indicateurs$vintage_date_reference == "2025-01-01"))
  expect_true(all(payload$indicateurs$vintage_date_publication == "2026-07-24"))
})

test_that("le payload Milieux passe la validation générique (forme, territoires, vintages)", {
  payload <- compute_payload(communes_fixture_milieux(),
                             theme = theme_milieux())

  # la validation générique avec les tables déclaratives du thème — un payload
  # invalide s'arrêterait ICI (le garde-fou de compute_payload l'a déjà appelée)
  expect_no_error(
    validate_payload(payload,
                     indicateurs = INDICATEURS_MILIEUX,
                     vintages = vintages_milieux(),
                     validations = validations_milieux,
                     apercu = APERCU_MILIEUX)
  )
})

test_that("une dérive de valeur du payload Milieux échoue bruyamment", {
  payload <- compute_payload(communes_fixture_milieux(),
                             theme = theme_milieux())

  # une consommation négative (une dérive du fichier source) — la validation
  # de VALEUR du thème l'attrape
  payload$indicateurs$value[1] <- -5
  expect_error(
    validate_payload(payload,
                     indicateurs = INDICATEURS_MILIEUX,
                     vintages = vintages_milieux(),
                     validations = validations_milieux,
                     apercu = APERCU_MILIEUX),
    "négative"
  )

  # une clé fantôme non déclarée — la validation GÉNÉRIQUE l'attrape
  payload <- compute_payload(communes_fixture_milieux(),
                             theme = theme_milieux())
  payload$indicateurs$key[1] <- "lq"
  expect_error(
    validate_payload(payload,
                     indicateurs = INDICATEURS_MILIEUX,
                     vintages = vintages_milieux(),
                     validations = validations_milieux,
                     apercu = APERCU_MILIEUX),
    "non déclarée"
  )
})
