# test-contract-payload-milieux -------------------------------------------------
# Le SEAM de test du payload Milieux (issue #171, étendu par #172) : même
# fixture -> même payload, pour toujours. L'INDICATEUR livré publie SES DEUX
# clés — conso_enaf_fenetre (la fenêtre 2021-2025, en hectares, une ligne par
# territoire) et conso_enaf_annuel (la série annuelle 2011-2024, 14 lignes par
# territoire, detail = l'année) — et CE payload passe la validation GÉNÉRIQUE
# (validate_payload : forme, couverture des territoires, multiplicités,
# estampilles vintage). La conversion m² -> ha est prouvée bout en bout : la
# valeur publiée d'une commune EST sa consommation en hectares, et la fenêtre
# EST la somme des quatre annuels 2021-2024 (vérifiée à la main). Les tables
# histoires et apercu restent VIDE mais présentes (la forme du contrat).

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

test_that("la forme des quatre tables est le contrat (payload Milieux)", {
  payload <- compute_payload(communes_fixture_milieux(),
                             theme = theme_milieux())

  expect_named(payload, c("indicateurs", "histoires", "territoires", "apercu"))
  expect_named(payload$indicateurs, c(
    "territoire", "type", "theme", "key", "detail", "value", "unit",
    "rang_epci", "rang_dep", "rang_reg",
    "vintage_source", "vintage_version",
    "vintage_date_reference", "vintage_date_publication"
  ))
  # histoires et apercu : présents, vides, la forme du contrat
  expect_named(payload$histoires,
               c("territoire", "type", "theme", "story_key"))
  expect_equal(nrow(payload$histoires), 0L)
  expect_named(payload$apercu, c("territoire", "type", "key", "value", "unit"))
  expect_equal(nrow(payload$apercu), 0L)
  expect_true(all(payload$indicateurs$theme == "milieux"))
})

test_that("chaque territoire publie la fenêtre 2021-2025 (ha) et la série annuelle 2011-2024", {
  payload <- compute_payload(communes_fixture_milieux(),
                             theme = theme_milieux())

  # les DEUX clés de l'indicateur livré (issue #172) — la fenêtre et la série
  expect_setequal(unique(payload$indicateurs$key),
                  c("conso_enaf_fenetre", "conso_enaf_annuel"))
  # 10 territoires x 1 (fenêtre) + 10 x 14 (annuels) = 150 lignes
  expect_equal(nrow(payload$indicateurs), 10 + 10 * 14)

  fenetre <- function(code) valeur_payload(payload, code, "conso_enaf_fenetre")
  # la fenêtre : le champ natif naf21art25, converti m² -> ha (la conversion
  # prouvée bout en bout — 233 202 m² -> 23,3202 ha pour la commune A1)
  expect_equal(fenetre("22001")$value, 233202 / 10000)
  expect_equal(fenetre("22002")$value, 100000 / 10000)
  expect_equal(fenetre("29001")$value, 150000 / 10000)
  expect_equal(fenetre("29002")$value, 25000 / 10000)
  # la commune sans donnée porte NA (une fenêtre incomplète, jamais un 0 inventé)
  expect_true(is.na(fenetre("29003")$value))
  # agrégats : les sommes des parties
  expect_equal(fenetre("200000001")$value, (233202 + 100000) / 10000)  # EPCI X
  expect_equal(fenetre("22")$value, (233202 + 100000) / 10000)          # dép. 22
  # EPCI Y / département 29 / région : membres incomplets (29003 NA) -> NA
  expect_true(is.na(fenetre("200000002")$value))
  expect_true(is.na(fenetre("29")$value))
  expect_true(is.na(fenetre("53")$value))
  # l'unité du contrat : la fenêtre s'exprime en hectares
  expect_true(all(fenetre("22001")$unit == "ha"))

  annuel <- function(code) valeur_payload(payload, code, "conso_enaf_annuel")
  # la série annuelle : 14 lignes par territoire, detail = l'année (2011..2024)
  expect_equal(nrow(annuel("22001")), 14L)
  expect_setequal(annuel("22001")$detail, as.character(2011:2024))
  # les valeurs en hectares, vérifiées à la main (naf{AA}art{AA+1} ÷ 10 000)
  attendues <- c(
    "2011" = 120000, "2012" = 80000,
    "2013" = 100000, "2014" = 100000, "2015" = 100000, "2016" = 100000,
    "2017" = 100000, "2018" = 100000, "2019" = 100000, "2020" = 100000,
    "2021" = 60000, "2022" = 50000, "2023" = 80000, "2024" = 43202
  ) / 10000
  for (an in names(attendues)) {
    expect_equal(annuel("22001")$value[annuel("22001")$detail == an],
                 unname(attendues[[an]]), info = an)
  }
  # la fenêtre (la clé tête) EST la somme des quatre annuels 2021-2024 — la
  # vérification à la main de l'acceptance criteria, côté payload
  somme_fenetre <- sum(annuel("22001")$value[
    annuel("22001")$detail %in% c("2021", "2022", "2023", "2024")])
  expect_equal(somme_fenetre, fenetre("22001")$value)
  # un agrégat somme les annuels de ses communes (EPCI X, 2021 : 6 + 2 ha)
  expect_equal(annuel("200000001")$value[
    annuel("200000001")$detail == "2021"], 8)
  # la commune sans donnée garde ses 14 annuels NA (jamais des 0 inventés)
  expect_equal(nrow(annuel("29003")), 14L)
  expect_true(all(is.na(annuel("29003")$value)))
  # un niveau incomplet garde ses annuels NA
  expect_true(all(is.na(annuel("200000002")$value)))
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
