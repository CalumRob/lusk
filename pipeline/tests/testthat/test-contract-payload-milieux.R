# test-contract-payload-milieux -------------------------------------------------
# Le SEAM de test du payload Milieux (issue #171, étendu par #172, pivoté par
# #239 — ADR-0017) : même fixture -> même payload, pour toujours. L'INDICATEUR
# livré publie SES DEUX clés — artif_par_habitant (l'état artificialisé par
# habitant, m²/hab, DEUX lignes par territoire : le millésime M2 puis M3 — la
# figure « Intensité état ») et conso_enaf_annuel (la série annuelle
# 2011-2024, 14 lignes par territoire, detail = l'année — la figure « Série
# annuelle »). La fenêtre (conso_enaf_fenetre) et la trajectoire ZAN
# (trajectoire_zan) sont MORTES avec les flux CONSOENAF : leurs lignes
# quittent le payload (la story porte la trajectoire — #63). Depuis l'Histoire
# (#238), la table histoires porte une ligne par territoire : les deux
# fenêtres nommées (periode_pop / periode_artif), les états OCS-GE en ha et
# en m²/habitant (le bracket de population : RP 2017 pour l'état initial,
# RP 2023 pour l'état final), la trajectoire par habitant et la classification
# re-keyée sur le signe pair (Δpopulation × trajectoire).
# Le fixture est celui du câblage territorial OCS-GE (#237) — sept communes,
# trois EPCIs (dont le transfrontalier 35+56), quatre départements et la
# région — pour que les états existent (les valeurs m² sont prouvées bout en
# bout : 22001 publie 0,5 m²/hab à l'état final = 1200 m² / 2400 habitants) et
# que les DEUX lignes soient datées (detail = l'année de l'état pour une
# fenêtre unique, « M2 »/« M3 » pour l'EPCI Z et la région dont la fenêtre est
# multi-dépt — le span n'a pas de paire unique). La conversion m² -> ha de la
# série annuelle est prouvée bout en bout (la valeur publiée d'une commune
# EST sa consommation en hectares, vérifiée à la main). L'Aperçu reste VIDE
# mais présent (la forme du contrat).

test_that("le payload Milieux couvre chaque territoire du fixture", {
  payload <- compute_payload(communes_fixture_milieux_ocsge(),
                             theme = theme_milieux())

  territoires_attendus <- c(
    "22001", "22002", "29001", "29002", "29003", "35001", "56001", # communes
    "200000001", "200000002", "200000003",                          # EPCIs
    "22", "29", "35", "56",                                         # départements
    "53"                                                            # région
  )
  expect_setequal(unique(payload$indicateurs$territoire), territoires_attendus)
  # la table de référence couvre les mêmes territoires, une fois chacun
  expect_setequal(payload$territoires$territoire, territoires_attendus)
  expect_equal(nrow(payload$territoires), length(territoires_attendus))
})

test_that("la forme des quatre tables est le contrat (payload Milieux)", {
  payload <- compute_payload(communes_fixture_milieux_ocsge(),
                             theme = theme_milieux())

  expect_named(payload, c("indicateurs", "histoires", "territoires", "apercu"))
  expect_named(payload$indicateurs, c(
    "territoire", "type", "theme", "key", "detail", "value", "unit",
    "rang_epci", "rang_dep", "rang_reg",
    "rang_epci_n", "rang_dep_n", "rang_reg_n",
    "vintage_source", "vintage_version",
    "vintage_date_reference", "vintage_date_publication",
    "source_reference"
  ))
  # histoires : la forme du contrat de l'Histoire pivotée (#238, ADR-0017) —
  # une ligne par territoire, les deux fenêtres (periode_pop / periode_artif),
  # les états OCS-GE en ha et en m²/habitant, la trajectoire par habitant et
  # la classification re-keyée sur le signe pair (Δpopulation × trajectoire)
  expect_named(payload$histoires, c(
    "territoire", "type", "theme", "groupe", "story_key", "salience_reason",
    "periode_pop", "periode_artif",
    "delta_population",
    "taux_variation_population",
    "artif_m2", "artif_m3",
    "artif_m2_par_habitant", "artif_m3_par_habitant",
    "trajectoire_artif_par_habitant",
    "classification"
  ))
  # les colonnes doublées de l'ancien schéma (#174) sont PARTIES du contrat
  expect_false("conso_fenetre" %in% names(payload$histoires))
  expect_false("intensite_m2_par_habitant" %in% names(payload$histoires))
  expect_false("periode" %in% names(payload$histoires))
  expect_equal(nrow(payload$histoires), nrow(payload$territoires))
  expect_named(payload$apercu, c("territoire", "type", "key", "value", "unit"))
  expect_equal(nrow(payload$apercu), 0L)
  expect_true(all(payload$indicateurs$theme == "milieux"))
})

test_that("chaque territoire publie l'état M2/M3 (m²/hab) et la série annuelle 2011-2024 — les deux clés vivantes", {
  payload <- compute_payload(communes_fixture_milieux_ocsge(),
                             theme = theme_milieux())

  # les DEUX clés du thème (issue #239) — l'état par habitant (multiplicité 2)
  # et la série annuelle (multiplicité 14) ; la fenêtre et la trajectoire ZAN
  # sont mortes avec les flux
  expect_setequal(unique(payload$indicateurs$key),
                  c("artif_par_habitant", "conso_enaf_annuel"))
  # 15 territoires x 2 (l'état M2/M3) + 15 x 14 (la série annuelle) = 240 lignes
  expect_equal(nrow(payload$indicateurs), 15 * 2 + 15 * 14)

  etat <- function(code, detail) {
    valeur_payload(payload, code, "artif_par_habitant", detail)
  }
  # l'état par habitant : la valeur EST l'état m² / population du millésime
  # qui BORNE l'état (RP 2017 pour M2, RP 2023 pour M3 — le bracket ADR-0017) —
  # vérifiée à la main pour chaque commune du fixture. Depuis l'amendement
  # #243, ce sont des STOCKS (le produit millésimé) — chaque commune a les
  # DEUX états strictement positifs, jamais un 0 (le bug flux-et-état).
  expect_equal(etat("22001", "2021")$value, 400 / 2200)
  expect_equal(etat("22001", "2025")$value, 1200 / 2400)
  expect_equal(etat("22002", "2021")$value, 400 / 1200)
  expect_equal(etat("22002", "2025")$value, 800 / 1300)
  expect_equal(etat("29001", "2021")$value, 800 / 3100)
  expect_equal(etat("29001", "2024")$value, 1200 / 2950)
  expect_equal(etat("29002", "2021")$value, 800 / 920)
  expect_equal(etat("29002", "2024")$value, 800 / 910)
  expect_equal(etat("29003", "2021")$value, 500 / 500)
  expect_equal(etat("29003", "2024")$value, 700 / 500)
  expect_equal(etat("35001", "2020")$value, 400 / 4800)
  expect_equal(etat("35001", "2023")$value, 400 / 5200)
  expect_equal(etat("56001", "2022")$value, 800 / 2900)  # la renaturation
  expect_equal(etat("56001", "2024")$value, 600 / 3100)  # MESURÉE (M3 < M2)
  # les agrégats : les états somment (EPCI X = 22001 + 22002 -> M2 800 m²,
  # M3 2000 m²), l'intensité se lit sur la population du niveau (RP 2017 =
  # 2200 + 1200 pour M2, RP 2023 = 2400 + 1300 pour M3)
  expect_equal(etat("200000001", "2021")$value, 800 / 3400)
  expect_equal(etat("200000001", "2025")$value, 2000 / 3700)
  expect_equal(etat("22", "2021")$value, 800 / 3400)
  expect_equal(etat("22", "2025")$value, 2000 / 3700)
  expect_equal(etat("35", "2020")$value, 400 / 4800)
  expect_equal(etat("35", "2023")$value, 400 / 5200)
  expect_equal(etat("56", "2022")$value, 800 / 2900)
  expect_equal(etat("56", "2024")$value, 600 / 3100)
  # EPCI Y / département 29 : 29001 + 29002 + 29003 (toutes portent leurs
  # états depuis l'amendement #243)
  expect_equal(etat("200000002", "2021")$value, 2100 / 4520)
  expect_equal(etat("200000002", "2024")$value, 2700 / 4360)
  expect_equal(etat("29", "2021")$value, 2100 / 4520)
  expect_equal(etat("29", "2024")$value, 2700 / 4360)
  # la région : les sept communes
  expect_equal(etat("53", "M2")$value, 4100 / 15620)
  expect_equal(etat("53", "M3")$value, 5700 / 16360)
  # l'unité du contrat : m²/hab pour l'état, partout
  expect_true(all(valeur_payload(payload, "22001",
                                 "artif_par_habitant")$unit == "m²/hab"))

  # le détail des deux lignes : l'année de l'état pour une fenêtre UNIQUE,
  # le nom de l'état (« M2 »/« M3 ») pour le span multi-dépt — jamais une
  # année inventée (spec #225)
  expect_setequal(valeur_payload(payload, "22001", "artif_par_habitant")$detail,
                  c("2021", "2025"))
  expect_setequal(valeur_payload(payload, "35001", "artif_par_habitant")$detail,
                  c("2020", "2023"))
  expect_setequal(valeur_payload(payload, "200000003",
                                 "artif_par_habitant")$detail, c("M2", "M3"))
  expect_setequal(valeur_payload(payload, "53",
                                 "artif_par_habitant")$detail, c("M2", "M3"))

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
  # la fenêtre 2021-2025 EST la somme des quatre annuels 2021-2024 — la
  # vérification à la main de l'ancienne clé tête, côté colonne de la table
  somme_fenetre <- sum(annuel("22001")$value[
    annuel("22001")$detail %in% c("2021", "2022", "2023", "2024")])
  expect_equal(somme_fenetre, 233202 / 10000)
  # un agrégat somme les annuels de ses communes (EPCI X, 2021 : 6 + 2 ha)
  expect_equal(annuel("200000001")$value[
    annuel("200000001")$detail == "2021"], 8)
  # la commune sans donnée garde ses 14 annuels NA (jamais des 0 inventés)
  expect_equal(nrow(annuel("29003")), 14L)
  expect_true(all(is.na(annuel("29003")$value)))
  # un niveau incomplet garde ses annuels NA
  expect_true(all(is.na(annuel("200000002")$value)))
})

test_that("la fenêtre et la trajectoire ZAN sont mortes avec les flux CONSOENAF", {
  payload <- compute_payload(communes_fixture_milieux_ocsge(),
                             theme = theme_milieux())

  # aucune ligne des deux clés retirées (#63) dans le payload
  expect_false(any(payload$indicateurs$key == "conso_enaf_fenetre"))
  expect_false(any(payload$indicateurs$key == "trajectoire_zan"))
  # elles ne sont pas non plus déclarées par le thème
  expect_false(any(INDICATEURS_MILIEUX$key == "conso_enaf_fenetre"))
  expect_false(any(INDICATEURS_MILIEUX$key == "trajectoire_zan"))
})

test_that("chaque indicateur est estampillé depuis sa source de référence PAR LIGNE (le couple département × millésime, jamais une archive uniforme)", {
  payload <- compute_payload(communes_fixture_milieux_ocsge(),
                             theme = theme_milieux())

  v <- vintages_milieux()
  conso <- v[v$id == "consoenaf", ]
  # DEPUIS #243, l'état par habitant est estampillé PAR LIGNE : la source de
  # référence d'une ligne est l'archive du département × le millésime de LA
  # LIGNE (Rennes 2020 -> ocsge_artificialisation_35_2020, 2023 -> 35_2023 —
  # jamais l'archive uniforme du passé qui faisait dire à Rennes
  # « Côtes-d'Armor (22), millésime 2025 »). Le composant signature reste
  # l'état artificialisé (jamais le dénominateur partagé de population, la
  # règle ADR-0009).
  etat <- payload$indicateurs[payload$indicateurs$key == "artif_par_habitant", ]
  ligne_estampillee <- function(code, detail) {
    ligne <- etat[etat$territoire == code & etat$detail == detail, ]
    expect_equal(nrow(ligne), 1L, info = paste(code, detail))
    v_id <- ligne$source_reference
    attendu <- v[v$id == v_id, ]
    expect_equal(ligne$vintage_source, attendu$source, info = paste(code, detail))
    expect_equal(ligne$vintage_version, attendu$version, info = paste(code, detail))
    expect_equal(ligne$vintage_date_reference, attendu$date_reference,
                 info = paste(code, detail))
    expect_equal(ligne$vintage_date_publication, attendu$date_publication,
                 info = paste(code, detail))
  }
  # 35001 (Ille-et-Vilaine) : la ligne 2020 estampillée 35_2020, la ligne 2023
  # estampillée 35_2023 — le couple du territoire, jamais une archive uniforme
  ligne_estampillee("35001", "2020")
  ligne_estampillee("35001", "2023")
  expect_equal(etat$source_reference[etat$territoire == "35001"],
               c("ocsge_artificialisation_35_2020", "ocsge_artificialisation_35_2023"))
  # 22001 (Côtes-d'Armor) : 2021 -> 22_2021, 2025 -> 22_2025
  ligne_estampillee("22001", "2021")
  ligne_estampillee("22001", "2025")
  expect_equal(etat$source_reference[etat$territoire == "22001"],
               c("ocsge_artificialisation_22_2021", "ocsge_artificialisation_22_2025"))
  # 29001 (Finistère) : 2021 -> 29_2021, 2024 -> 29_2024
  ligne_estampillee("29001", "2021")
  ligne_estampillee("29001", "2024")
  # 56001 (Morbihan) : 2022 -> 56_2022, 2024 -> 56_2024
  ligne_estampillee("56001", "2022")
  ligne_estampillee("56001", "2024")
  # l'EPCI mono-département (X, 22) et le département 22 portent le même couple
  ligne_estampillee("200000001", "2021")
  ligne_estampillee("200000001", "2025")
  ligne_estampillee("22", "2021")
  ligne_estampillee("22", "2025")

  # la série annuelle garde SA source de référence CONSOENAF (pas de ref par
  # ligne — la clé fait foi)
  annuel <- payload$indicateurs[payload$indicateurs$key == "conso_enaf_annuel", ]
  expect_true(all(annuel$vintage_source == conso$source))
  expect_true(all(annuel$vintage_version == conso$version))
  expect_true(all(is.na(annuel$source_reference)))
})

test_that("les territoires multi-départements (EPCI transfrontalier, région) portent une estampille SPAN — jamais un couple unique inventé", {
  payload <- compute_payload(communes_fixture_milieux_ocsge(),
                             theme = theme_milieux())
  etat <- payload$indicateurs[payload$indicateurs$key == "artif_par_habitant", ]

  # l'EPCI Z (200000003) traverse 35 (2020-2023) et 56 (2022-2024) : SA source
  # de référence est le span de SES deux fenêtres — le MÊME convention que
  # periode_artif (le mélange est DIT, jamais aplati, jamais une archive
  # unique)
  z <- etat[etat$territoire == "200000003", ]
  expect_equal(z$source_reference,
               rep("2020-2023 (35) · 2022-2024 (56)", 2))
  expect_equal(z$vintage_version, rep("2020-2023 (35) · 2022-2024 (56)", 2))
  expect_true(all(grepl("^IGN — OCS GE « surfaces artificialisées »", z$vintage_source)))
  expect_true(all(z$vintage_date_reference == "2020-01-01"))
  expect_true(all(z$vintage_date_publication == "2026-06-10"))

  # la région (53) : les QUATRE fenêtres, triées par code de département —
  # jamais un couple unique
  region <- etat[etat$territoire == "53", ]
  expect_equal(region$source_reference,
               rep("2021-2025 (22) · 2021-2024 (29) · 2020-2023 (35) · 2022-2024 (56)", 2))
  expect_equal(region$vintage_version,
               rep("2021-2025 (22) · 2021-2024 (29) · 2020-2023 (35) · 2022-2024 (56)", 2))
  expect_true(all(grepl("^IGN — OCS GE « surfaces artificialisées »", region$vintage_source)))
  # la référence du span = la plus ancienne des références d'état (35 : 2020),
  # la publication = la plus récente des publications (22 : 2026-07-03)
  expect_true(all(region$vintage_date_reference == "2020-01-01"))
  expect_true(all(region$vintage_date_publication == "2026-07-03"))
  # AUCUNE ligne d'état ne porte une archive uniforme : chaque ref par ligne
  # est soit un couple (département × millésime de la ligne) soit un span
  refs <- etat$source_reference
  couples <- paste0("ocsge_artificialisation_", c("22", "29", "35", "56"),
                    "_", c("2021", "2021", "2020", "2022"))
  expect_true(all(grepl("·", refs[!refs %in% c(couples,
                                               paste0("ocsge_artificialisation_", c("22", "29", "35", "56"),
                                                      "_", c("2025", "2024", "2023", "2024")))])))
  expect_true(all(!is.na(refs)))
})

test_that("le payload Milieux passe la validation générique (forme, territoires, vintages)", {
  payload <- compute_payload(communes_fixture_milieux_ocsge(),
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
  payload <- compute_payload(communes_fixture_milieux_ocsge(),
                             theme = theme_milieux())

  # une consommation annuelle négative (une dérive du fichier source) — la
  # validation de VALEUR du thème l'attrape
  payload$indicateurs$value[payload$indicateurs$key == "conso_enaf_annuel"][1] <- -5
  expect_error(
    validate_payload(payload,
                     indicateurs = INDICATEURS_MILIEUX,
                     vintages = vintages_milieux(),
                     validations = validations_milieux,
                     apercu = APERCU_MILIEUX),
    "négative"
  )

  # une intensité d'état négative — la validation de VALEUR du thème l'attrape
  payload <- compute_payload(communes_fixture_milieux_ocsge(),
                             theme = theme_milieux())
  payload$indicateurs$value[payload$indicateurs$key == "artif_par_habitant"][1] <- -1
  expect_error(
    validate_payload(payload,
                     indicateurs = INDICATEURS_MILIEUX,
                     vintages = vintages_milieux(),
                     validations = validations_milieux,
                     apercu = APERCU_MILIEUX),
    "négative"
  )

  # une clé fantôme non déclarée — la validation GÉNÉRIQUE l'attrape
  payload <- compute_payload(communes_fixture_milieux_ocsge(),
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

test_that("la garde « toute commune a un état > 0 » : un état nul ou NA est une corruption (amendement #243)", {
  payload <- compute_payload(communes_fixture_milieux_ocsge(),
                             theme = theme_milieux())

  # un état initial nul (le bug flux-et-état — les 102 communes à M2 = 0 du
  # payload différentiel) : la garde l'attrape, jamais un stock nul publié
  zero <- payload
  zero$histoires$artif_m2[zero$histoires$territoire == "22001" &
                            zero$histoires$type == "commune"] <- 0
  expect_error(
    validate_payload(zero,
                     indicateurs = INDICATEURS_MILIEUX,
                     vintages = vintages_milieux(),
                     validations = validations_milieux,
                     apercu = APERCU_MILIEUX),
    "état artificialisé"
  )

  # une commune sans état (NA — un désalignement COG) : la garde l'attrape
  sans_etat <- payload
  sans_etat$histoires$artif_m3[sans_etat$histoires$territoire == "29003" &
                                 sans_etat$histoires$type == "commune"] <- NA_real_
  expect_error(
    validate_payload(sans_etat,
                     indicateurs = INDICATEURS_MILIEUX,
                     vintages = vintages_milieux(),
                     validations = validations_milieux,
                     apercu = APERCU_MILIEUX),
    "état artificialisé"
  )

  # le fixture complet passe la garde (toutes les communes portent leurs états)
  expect_no_error(
    validate_payload(payload,
                     indicateurs = INDICATEURS_MILIEUX,
                     vintages = vintages_milieux(),
                     validations = validations_milieux,
                     apercu = APERCU_MILIEUX)
  )
})
