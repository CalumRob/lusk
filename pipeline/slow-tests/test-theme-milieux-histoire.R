# Slow tier (#1172): ten full OCS-GE payload/history computations protect clocks, state lineage, readings, determinism and schema; thirteen CSV/tibble contracts are back in tests/testthat/.
# Run explicitly with testthat::test_file(..., package="lusk") from pipeline/.

local({
  withr::local_dir(file.path(pkgload::pkg_path(), "tests", "testthat"))
  for (helper in list.files(file.path(pkgload::pkg_path(), "tests", "testthat"), pattern = "^helper.*\\.R$", full.names = TRUE)) source(helper, local = environment())

test_that("les quatre lectures re-keyées : une ligne par territoire, le signe pair (Δpopulation × trajectoire)", {
  p <- compute_payload_test(communes_fixture_milieux_ocsge(), theme = theme_milieux())
  h <- function(code) p$histoires[p$histoires$territoire == code, ]

  expect_equal(nrow(p$histoires), nrow(p$territoires))  # une ligne par territoire
  expect_true(all(p$histoires$story_key == "se-densifier-setaler-ou-sen-aller"))
  expect_true(all(p$histoires$theme == "milieux"))
  expect_true(all(p$histoires$periode_pop == "2017-2023"))  # la fenêtre dérivée

  # 22001 : +200 habitants, M2=400 m² -> M3=1200 m² : trajectoire 2,75 > 1 ->
  # s'étale (la terre grandit plus vite que la population)
  expect_equal(h("22001")$delta_population, 200)
  expect_equal(h("22001")$artif_m2_par_habitant, 400 / 2200)
  expect_equal(h("22001")$artif_m3_par_habitant, 1200 / 2400)
  expect_equal(h("22001")$trajectoire_artif_par_habitant, 2.75)
  expect_equal(h("22001")$classification, "grandir-en-setalant")
  # 56001 : +200 habitants, la terre DIMINUE (800 m² -> 600 m², les deux
  # états > 0 — la renaturation MESURÉE) : la trajectoire par habitant tombe
  # sous 1 : grandir EN SE DENSIFIANT (le cas mixte)
  expect_equal(h("56001")$delta_population, 200)
  expect_equal(h("56001")$trajectoire_artif_par_habitant,
               (600 / 3100) / (800 / 2900), tolerance = 1e-3)
  expect_equal(h("56001")$classification, "grandir-en-se-densifiant")
  # 35001 : +400 habitants, M2=400 -> M3=400 : trajectoire 0,923 < 1 ->
  # se densifie (la terre grandit moins vite que la population)
  expect_equal(h("35001")$trajectoire_artif_par_habitant, 0.923, tolerance = 1e-3)
  expect_equal(h("35001")$classification, "grandir-en-se-densifiant")
  # 29001 : -150 habitants, M2=800 -> M3=1200 : trajectoire 1,58 > 1 ->
  # consomme quand même (la pression par personne continue de grimper)
  expect_equal(h("29001")$delta_population, -150)
  expect_equal(h("29001")$trajectoire_artif_par_habitant, 1.58, tolerance = 1e-2)
  expect_equal(h("29001")$classification, "sen-aller-et-consommer-quand-meme")
  # 29003 : Δpopulation nul (zéro compte négatif), trajectoire 1,4 > 1 ->
  # consomme quand même — la lecture existe (l'état n'est plus NA, #243)
  expect_equal(h("29003")$delta_population, 0)
  expect_equal(h("29003")$trajectoire_artif_par_habitant, 1.4)
  expect_equal(h("29003")$classification, "sen-aller-et-consommer-quand-meme")
})

test_that("les agrégats : la somme naïve des états, NA propagé, le span pour le transfrontalier", {
  p <- compute_payload_test(communes_fixture_milieux_ocsge(), theme = theme_milieux())
  h <- function(code) p$histoires[p$histoires$territoire == code, ]

  # EPCI X = 22001 + 22002 : les états somment — M2=800, M3=2000 (1200 + 800) :
  # trajectoire 2,30 > 1, +300 habitants -> s'étale
  expect_equal(h("200000001")$artif_m3, (1200 + 800) / 10000)
  expect_equal(h("200000001")$artif_m2, (400 + 400) / 10000)
  expect_equal(h("200000001")$delta_population, 300)
  expect_equal(h("200000001")$trajectoire_artif_par_habitant,
               (2000 / 3700) / (800 / 3400), tolerance = 1e-3)
  expect_equal(h("200000001")$classification, "grandir-en-setalant")
  expect_equal(h("22")$classification, "grandir-en-setalant")
  # EPCI Y = 29001 + 29002 + 29003 : les états somment (M2=2100, M3=2700) —
  # toutes les communes portent leurs états depuis #243 ; -160 habitants,
  # trajectoire 1,33 > 1 -> consomme quand même
  expect_equal(h("200000002")$artif_m3, (1200 + 800 + 700) / 10000)
  expect_equal(h("200000002")$delta_population, -160)
  expect_equal(h("200000002")$trajectoire_artif_par_habitant,
               (2700 / 4360) / (2100 / 4520), tolerance = 1e-3)
  expect_equal(h("200000002")$classification, "sen-aller-et-consommer-quand-meme")
  expect_equal(h("29")$classification, "sen-aller-et-consommer-quand-meme")
  # EPCI Z (transfrontalier 35+56) : les états se somment — la renaturation du
  # 56 (l'état final 600 < l'état initial 800) pèse dans l'agrégat ; +600
  # habitants, trajectoire 0,77 < 1 -> se densifie
  expect_equal(h("200000003")$artif_m2, (400 + 800) / 10000)
  expect_equal(h("200000003")$artif_m3, (400 + 600) / 10000)
  expect_equal(h("200000003")$delta_population, 600)
  expect_equal(h("200000003")$trajectoire_artif_par_habitant,
               (1000 / 8300) / (1200 / 7700), tolerance = 1e-3)
  expect_equal(h("200000003")$classification, "grandir-en-se-densifiant")
  # la région : les sept communes, +740 habitants, trajectoire 1,33 > 1 ->
  # s'étale
  expect_equal(h("53")$delta_population, 740)
  expect_equal(h("53")$trajectoire_artif_par_habitant,
               (5700 / 16360) / (4100 / 15620), tolerance = 1e-3)
  expect_equal(h("53")$classification, "grandir-en-setalant")
})

# Les deux fenêtres nommées (les deux horloges, ADR-0017) ----------------------

test_that("periode_pop et periode_artif : les deux horloges dérivent chacune de SA source, nommées séparément", {
  p <- compute_payload_test(communes_fixture_milieux_ocsge(), theme = theme_milieux())
  h <- function(code) p$histoires[p$histoires$territoire == code, ]

  # la fenêtre de population : la paire RP de la série (2017-2023), partout
  expect_true(all(p$histoires$periode_pop == "2017-2023"))
  # la fenêtre des états : le couple du département pour un territoire
  # mono-département, DIT simplement (sans parenthèses)
  expect_equal(h("22001")$periode_artif, "2021-2025")
  expect_equal(h("29001")$periode_artif, "2021-2024")
  expect_equal(h("35001")$periode_artif, "2020-2023")
  expect_equal(h("56001")$periode_artif, "2022-2024")
  # le SPAN avec les dates par département pour l'EPCI transfrontalier, les
  # QUATRE fenêtres pour la région
  expect_equal(h("200000003")$periode_artif, "2020-2023 (35) · 2022-2024 (56)")
  expect_equal(h("53")$periode_artif,
               "2021-2025 (22) · 2021-2024 (29) · 2020-2023 (35) · 2022-2024 (56)")
  # 29003 porte SES états depuis l'amendement #243 : SA fenêtre (29 : 2021/2024),
  # jamais NA
  expect_equal(h("29003")$periode_artif, "2021-2024")
})

test_that("les deux horloges : des millésimes RP différents font glisser periode_pop, jamais la fenêtre des états", {
  cache <- cache_ocsge_milieux()
  on.exit(unlink(cache, recursive = TRUE))
  # une série historique à millésimes 2019 et 2023 (jamais 2017) : la fenêtre
  # de population doit être 2019-2023 et les populations au départ = 2019
  serie <- tibble::tribble(
    ~GEO_OBJECT, ~GEO, ~SEX, ~AGE, ~RP_MEASURE, ~FREQ, ~OBS_STATUS, ~TIME_PERIOD, ~OBS_VALUE,
    "COM", "22001", "_T", "_T", "POP", "A", "A", 2019, 2300,
    "COM", "22001", "_T", "_T", "POP", "A", "A", 2023, 2400,
    "COM", "22002", "_T", "_T", "POP", "A", "A", 2019, 1250,
    "COM", "22002", "_T", "_T", "POP", "A", "A", 2023, 1300,
    "COM", "29001", "_T", "_T", "POP", "A", "A", 2019, 3000,
    "COM", "29001", "_T", "_T", "POP", "A", "A", 2023, 2950,
    "COM", "29002", "_T", "_T", "POP", "A", "A", 2019, 900,
    "COM", "29002", "_T", "_T", "POP", "A", "A", 2023, 910,
    "COM", "29003", "_T", "_T", "POP", "A", "A", 2019, 500,
    "COM", "29003", "_T", "_T", "POP", "A", "A", 2023, 500,
    "COM", "35001", "_T", "_T", "POP", "A", "A", 2019, 4800,
    "COM", "35001", "_T", "_T", "POP", "A", "A", 2023, 5200,
    "COM", "56001", "_T", "_T", "POP", "A", "A", 2019, 2900,
    "COM", "56001", "_T", "_T", "POP", "A", "A", 2023, 3100
  )
  readr::write_delim(serie,
                     file.path(cache, "extracted", NOM_FICHIER_SERIE_HISTORIQUE),
                     delim = ";")

  local_mocked_bindings(lire_epci = function(chemin) base_epci_milieux_ocsge,
                        .package = "lusk")
  communes <- construire_donnees_milieux(cache = cache,
                                         sortie = tempfile(fileext = ".rds"))
  territoires <- construire_territoires_milieux(communes)
  hist <- compute_histoires_milieux(territoires)

  # la fenêtre de population glisse : 2019-2023, population au départ = 2019
  expect_true(all(hist$periode_pop == "2019-2023"))
  expect_equal(hist$delta_population[hist$territoire == "22001"], 100)
  # la fenêtre des états, elle, ne bouge pas : elle dérive des millésimes
  # OCS-GE de la donnée (le couple du 22), jamais de la série de population
  expect_equal(hist$periode_artif[hist$territoire == "22001"], "2021-2025")
  # la lecture suit les deux forces actualisées : 22001 gagne 100 habitants
  # (2019->2023) et porte une trajectoire 2,88 > 1 (M2=400, M3=1200, l'état
  # initial PORTÉ, la population de 2019 au dénominateur initial) -> s'étale
  expect_equal(hist$trajectoire_artif_par_habitant[
    hist$territoire == "22001"], 2.88, tolerance = 1e-2)
  expect_equal(hist$classification[hist$territoire == "22001"],
               "grandir-en-setalant")
  # la consommation de fenêtre (la clé de l'indicateur) se re-somme sur la
  # fenêtre glissée : 22001 = naf19art20..naf22art23 = 31 ha — le total
  # 2011-2025 (naf11art25) ne compte JAMAIS
  expect_equal(territoires$conso_fenetre[territoires$code == "22001"], 31)
})

# Les états, leur unité et le bracket de population ----------------------------

test_that("les états : la conversion m² -> ha et l'intensité d'état en m²/habitant", {
  p <- compute_payload_test(communes_fixture_milieux_ocsge(), theme = theme_milieux())
  h <- function(code) p$histoires[p$histoires$territoire == code, ]

  # 22001 : 1200 m² d'état final -> 0,12 ha (la conversion ÷ 10 000, la même
  # discipline documentée que CONSOENAF), état initial 400 m²
  expect_equal(h("22001")$artif_m3, 1200 / 10000)
  expect_equal(h("22001")$artif_m2, 400 / 10000)
  # l'intensité d'état : le ha × 10 000 = des m², divisés par la population du
  # millésime qui BORNE l'état — RP 2017 (2200) pour l'état initial, RP 2023
  # (2400) pour l'état final
  expect_equal(h("22001")$artif_m2_par_habitant, 400 / 2200)
  expect_equal(h("22001")$artif_m3_par_habitant, 1200 / 2400)
  # 56001 : la renaturation MESURÉE — l'état initial 800 m² (0,08 ha), l'état
  # final 600 m² (0,06 ha) : les DEUX états strictement positifs (un stock
  # n'est jamais 0 — le bug flux-et-état est mort avec le DIFF, #243)
  expect_equal(h("56001")$artif_m2, 800 / 10000)
  expect_equal(h("56001")$artif_m3, 600 / 10000)
  expect_equal(h("56001")$artif_m2_par_habitant, 800 / 2900)
  expect_equal(h("56001")$artif_m3_par_habitant, 600 / 3100)
})

test_that("l'invariant : sign(ratio − 1) = sign(delta) par construction, prouvé sur le fixture", {
  p <- compute_payload_test(communes_fixture_milieux_ocsge(), theme = theme_milieux())
  h <- p$histoires
  # le ratio n'est défini que là où le dénominateur (M2 par habitant) est
  # positif — les lignes NA (fenêtre incomplète) et à état initial nul sont
  # hors de la preuve, jamais une contradiction
  ok <- !is.na(h$artif_m2_par_habitant) & h$artif_m2_par_habitant > 0
  ratio <- h$trajectoire_artif_par_habitant[ok]
  delta <- h$artif_m3_par_habitant[ok] - h$artif_m2_par_habitant[ok]
  expect_equal(sign(ratio - 1), sign(delta))

  # la même preuve sur une table directe aux quatre lectures (les cas mixtes
  # compris) — le dénominateur positif partout, jamais un signe divergent
  territoires <- tibble::tibble(
    code = c("a", "b", "c", "d", "e", "f"),
    type = "commune",
    pop_debut = c(1000, 1000, 1000, 1000, 1000, 1000),
    pop_fin = c(1100, 1100, 900, 900, 1000, 1100),
    artif_m2 = c(10000, 10000, 10000, 10000, 10000, 10000),
    artif_m3 = c(12000, 10000, 12000, 8000, 12000, 11000),
    millesime_debut = 2017, millesime_fin = 2023,
    periode_artif = "2021-2025"
  )
  h2 <- compute_histoires_milieux(territoires)
  expect_equal(
    sign(h2$trajectoire_artif_par_habitant - 1),
    sign(h2$artif_m3_par_habitant - h2$artif_m2_par_habitant)
  )
})

# Le classifieur pur (les cas limites, par une table directe) ------------------

test_that("le taux annuel pour mille : delta annualisé, normalisé par la population moyenne (INSEE, #306)", {
  p <- compute_payload_test(communes_fixture_milieux_ocsge(), theme = theme_milieux())
  h <- function(code) p$histoires[p$histoires$territoire == code, ]

  # la formule du registre Démographie, exprimée telle quelle sur le fixture :
  # 22001 +200 hab entre 2017 et 2023 (durée 6), population moyenne (2200+2400)/2
  expect_equal(h("22001")$taux_variation_population,
               200 / (2023 - 2017) / ((2200 + 2400) / 2) * 1000)
  # 29001 se vide (-150) -> taux négatif
  expect_equal(h("29001")$taux_variation_population,
               -150 / (2023 - 2017) / ((3100 + 2950) / 2) * 1000)
  # 29003 plat (delta 0) -> taux nul, jamais une division par zéro
  expect_equal(h("29003")$taux_variation_population, 0)
  # le delta brut reste publié (le prose le cite — jamais remplacé par le taux)
  expect_equal(h("22001")$delta_population, 200)
  # le signe du taux suit le signe du delta — la lecture ne change pas
  expect_equal(sign(h("22001")$taux_variation_population),
               sign(h("22001")$delta_population))
  expect_equal(sign(h("29001")$taux_variation_population),
               sign(h("29001")$delta_population))
})

test_that("déterminisme : même territoire + mêmes données -> même lecture, toujours", {
  p1 <- compute_payload_test(communes_fixture_milieux_ocsge(), theme = theme_milieux())
  p2 <- compute_payload_test(communes_fixture_milieux_ocsge(), theme = theme_milieux())
  expect_identical(p1$histoires, p2$histoires)
})

test_that("le schéma de la table est le contrat de l'issue #238 (le pivot OCS-GE, étendu #312)", {
  p <- compute_payload_test(communes_fixture_milieux_ocsge(), theme = theme_milieux())
  expect_named(p$histoires, c(
    "territoire", "type", "theme", "groupe", "story_key", "salience_reason",
    "periode_pop", "periode_artif",
    "delta_population",
    "taux_variation_population",
    "artif_m2", "artif_m3",
    "artif_m2_par_habitant", "artif_m3_par_habitant",
    "trajectoire_artif_par_habitant",
    "classification"
  ))
  # la lecture résolue (issue #312) : une par (territoire, groupe), la raison
  # « defaut » — Milieux est un thème à story unique
  expect_true(all(p$histoires$groupe == "artificialisation"))
  expect_true(all(p$histoires$salience_reason == "defaut"))
  # les colonnes doublées de l'ancien schéma (#174) sont PARTIES
  expect_false("conso_fenetre" %in% names(p$histoires))
  expect_false("intensite_m2_par_habitant" %in% names(p$histoires))
  expect_false("periode" %in% names(p$histoires))
  # le payload passe la validation générique (forme, territoires, vintages)
  expect_no_error(
    validate_payload(p,
                     indicateurs = INDICATEURS_MILIEUX,
                     vintages = vintages_milieux(),
                     validations = validations_milieux,
                     apercu = APERCU_MILIEUX)
  )
})

test_that("chemin rétro-compatible : sans archives OCS-GE, le nouveau schéma est présent, les lectures NA (jamais inventées)", {
  p <- compute_payload_test(communes_fixture_milieux(), theme = theme_milieux())

  # le schéma du pivot est présent (le contrat de FORME), sans états OCS-GE
  expect_true(all(c("periode_pop", "periode_artif", "delta_population",
                    "taux_variation_population",
                    "artif_m2", "artif_m3",
                    "artif_m2_par_habitant", "artif_m3_par_habitant",
                    "trajectoire_artif_par_habitant", "classification") %in%
                    names(p$histoires)))
  expect_false("conso_fenetre" %in% names(p$histoires))
  # la fenêtre de population dérive toujours de la série (2017-2023 au fixture)
  expect_true(all(p$histoires$periode_pop == "2017-2023"))
  # le taux dérive des populations, présentes même sans archives OCS-GE — il
  # est publié sur le chemin rétro-compatible, jamais une case vide
  expect_true(all(!is.na(p$histoires$taux_variation_population)))
  # sans états OCS-GE, aucune lecture : tout NA, jamais une lecture inventée
  expect_true(all(is.na(p$histoires$classification)))
  expect_true(all(is.na(p$histoires$artif_m2)))
  expect_true(all(is.na(p$histoires$periode_artif)))
})

})
