# test-theme-milieux-histoire ---------------------------------------------------
# L'Histoire « Se densifier, s'étaler, ou s'en aller » (issue #174, pivotée par
# #238 — ADR-0017) : la lecture du territoire contre sa terre, re-keyée sur les
# états OCS-GE. Deux forces, chacune lue par le SIGNE seul (seuil 0, la règle
# des quadrants d'ADR-0011) :
#   - le Δpopulation = pop_fin - pop_debut — les populations de la SÉRIE
#     HISTORIQUE du recensement aux deux millésimes de la fenêtre (RP 2017 /
#     RP 2023 — la règle de source d'ADR-0014, jamais les populations
#     embarquées de CONSOENAF) ;
#   - la trajectoire par habitant = le ratio M3/M2 des états OCS-GE par
#     habitant (artif_m3_par_habitant / artif_m2_par_habitant) — la seconde
#     force de la lecture (ADR-0017). L'intensité d'état (m²/habitant) à
#     CHAQUE état se lit sur la population du millésime qui BORNE l'état :
#     RP 2017 pour l'état initial, RP 2023 pour l'état final — jamais
#     interpolée.
# Les quatre lectures sont les quatre quadrants du plan
# (Δpopulation × trajectoire) ; zéro compte négatif (la convention ADR-0011,
# la même que Démographie) :
#   grandir-en-se-densifiant               Δpop > 0, trajectoire < 1
#   grandir-en-setalant                    Δpop > 0, trajectoire > 1
#   sen-aller-et-consommer-quand-meme      Δpop <= 0, trajectoire > 1
#   les-departs-laissent-la-place-a-la-renaturation  Δpop <= 0,
#       trajectoire < 1 — la renaturation doit être MESURÉE (artif_m3 <
#       artif_m2) : la propriété qui rend la lecture rigoureuse. Sans elle,
#       PAS de lecture (jamais une lecture inventée).
# L'invariant : sign(ratio − 1) = sign(delta) par construction — le
# dénominateur du ratio (le M2 par habitant) est toujours positif — prouvé par
# le fixture : la classification et le futur graphe ne peuvent jamais se
# contredire.
# La règle des DEUX HORLOGES : la fenêtre de POPULATION (periode_pop) dérive
# des deux millésimes RP les plus récents de la série (jamais codée en dur) ;
# la fenêtre des ÉTATS (periode_artif) dérive des couples (département ->
# millésimes OCS-GE) de la donnée. Les deux fenêtres sont nommées séparément,
# jamais confondues (ADR-0017).

# La fenêtre et la source de population ----------------------------------------

test_that("lire_serie_historique_pop : la fenêtre dérive des DEUX millésimes les plus récents (jamais codée en dur)", {
  fichier <- testthat::test_path("fixtures", "serie-historique-fixture.csv")
  serie <- lire_serie_historique_pop(fichier)

  # la série du fixture porte 1968, 2017 et 2023 — la fenêtre prend les deux
  # plus récents, 1968 ne compte pas
  expect_equal(unique(serie$millesime_debut), 2017)
  expect_equal(unique(serie$millesime_fin), 2023)
  # les populations aux deux bornes, par commune
  expect_equal(serie$pop_debut[serie$code == "22001"], 2200)
  expect_equal(serie$pop_fin[serie$code == "22001"], 2400)
  expect_equal(serie$pop_debut[serie$code == "29001"], 3100)
  expect_equal(serie$pop_fin[serie$code == "29001"], 2950)
})

test_that("lire_serie_historique_pop : ne garde que les communes (GEO_OBJECT == COM) au statut A", {
  fichier <- testthat::test_path("fixtures", "serie-historique-fixture.csv")
  serie <- lire_serie_historique_pop(fichier)

  # les pièges du fixture sont filtrés : la ligne EPCI (200000001, POP 2023 =
  # 999999) et la ligne à statut W (22001, POP 2025 = 888888 — un millésime qui
  # corromprait la fenêtre s'il passait)
  expect_false("200000001" %in% serie$code)
  expect_equal(unique(serie$millesime_fin), 2023)  # jamais 2025
  expect_setequal(serie$code, c("22001", "22002", "29001", "29002", "29003"))
})

test_that("conso_annuelles_fenetre : seuls les ANNUELS de la fenêtre sont sommés, jamais les totaux de période", {
  noms <- c(
    "naf11art12", "naf12art13",               # annuels hors fenêtre (2011, 2012)
    "naf17art18", "naf18art19", "naf19art20", # annuels dans la fenêtre 2017-2023
    "naf20art21", "naf21art22", "naf22art23",
    "naf21art25", "naf11art25", "naf11art21", # totaux de période — JAMAIS sommés
    "artpop1116", "artcom1125", "surfcom2025" # décors — hors motif
  )
  annuelles <- conso_annuelles_fenetre(noms, millesime_debut = 2017,
                                       millesime_fin = 2023)

  expect_setequal(annuelles,
                  c("naf17art18", "naf18art19", "naf19art20",
                    "naf20art21", "naf21art22", "naf22art23"))
})

test_that("conso_annuelles_fenetre : la fenêtre glisse — d'autres millésimes, d'autres annuels", {
  noms <- c("naf17art18", "naf18art19", "naf19art20", "naf20art21",
            "naf21art22", "naf22art23", "naf21art25")
  # une fenêtre 2019-2023 re-somme les années 2019..2022 — jamais codée en dur
  annuelles <- conso_annuelles_fenetre(noms, millesime_debut = 2019,
                                       millesime_fin = 2023)
  expect_setequal(annuelles, c("naf19art20", "naf20art21", "naf21art22",
                               "naf22art23"))
})

test_that("conso_annuelles_fenetre : les colonnes de DÉCOMPOSITION art{AA}{dest}{AA+1} ne sont JAMAIS sommées — le total naf{AA}art{AA+1} suffit (#221)", {
  # le fichier réel Cerema porte, pour CHAQUE année, le total naf{AA}art{AA+1}
  # ET ses six colonnes de décomposition (art{AA}hab{AA+1}, act, inc, mix,
  # fer, rou) qui somment EXACTEMENT au total. Le motif des ANNUELS ne doit
  # donc retenir QUE le total : les décompositions, sommées en plus,
  # DOUBLERAIENT la consommation de la fenêtre (le bug #221).
  noms <- c(
    "naf17art18", "art17hab18", "art17act18", "art17inc18", "art17mix18",
    "art17fer18", "art17rou18",                 # 2017 : le total + ses 6 décompositions
    "naf18art19", "art18hab19",                 # 2018 : idem (extrait)
    "naf22art23", "art22hab23", "art22rou23"    # 2022 : idem (extrait)
  )
  annuelles <- conso_annuelles_fenetre(noms, millesime_debut = 2017,
                                       millesime_fin = 2023)
  expect_setequal(annuelles, c("naf17art18", "naf18art19", "naf22art23"))
})

test_that("conso_fenetre : les décompositions présentes dans le fixture ne DOUBLENT jamais la consommation (#221)", {
  # le fixture consoenaf porte désormais, pour CHAQUE année de la fenêtre
  # 2017-2023, le total naf{AA}art{AA+1} ET ses six colonnes de décomposition
  # (art{AA}hab{AA+1}, act, inc, mix, fer, rou) qui somment exactement au
  # total — la structure du fichier réel Cerema. La fenêtre publiée (la clé
  # conso_enaf_fenetre de l'indicateur, dont la colonne conso_fenetre de la
  # table des territoires est la source) doit rester la somme des SEULS
  # totaux : 51 ha pour 22001, jamais 102 (le doublement du bug #221).
  brut <- lire_consoenaf(
    testthat::test_path("fixtures", "consoenaf-fixture.csv")
  )
  a1 <- brut[brut$idcom == "22001", ]
  dest <- c("hab", "act", "inc", "mix", "fer", "rou")
  for (aa in 17:22) {
    total <- as.double(a1[[sprintf("naf%02dart%02d", aa, aa + 1)]])
    decomp <- sum(as.double(unlist(a1[sprintf("art%02d%s%02d", aa, dest, aa + 1)])))
    expect_equal(decomp, total, info = sprintf("année 20%02d", aa))
  }

  territoires <- construire_territoires_milieux(communes_fixture_milieux())
  t <- function(code) territoires[territoires$code == code, ]

  # les quatre communes portent leur fenêtre de totaux, JAMAIS doublée
  expect_equal(t("22001")$conso_fenetre, 51)
  expect_equal(t("22002")$conso_fenetre, 9)
  expect_equal(t("29001")$conso_fenetre, 15.5)
  expect_equal(t("29002")$conso_fenetre, 1.75)
  # la commune sans donnée reste NA (les décompositions ne créent rien)
  expect_true(is.na(t("29003")$conso_fenetre))
  # l'agrégat EPCI X = 22001 + 22002 = 60 ha, jamais 120
  expect_equal(t("200000001")$conso_fenetre, 60)
})

# Les quatre lectures re-keyées sur le fixture OCS-GE --------------------------
# Le fixture territorial OCS-GE (helper-milieux.R, issue #237) : sept communes,
# l'EPCI Z transfrontalier 35+56, quatre départements et la région. Les états
# par commune (en m², la fenêtre dérivée de la donnée) :
#   22001 : 0 -> 1200 (22, 2021-2025)    35001 : 0 -> 400 (35, 2020-2023)
#   22002 : 0 -> 800  (22, 2021-2025)    56001 : 400 -> 0 (56, 2022-2024 —
#   29001 : 0 -> 1200 (29, 2021-2024)            la désartificialisation)
#   29002 : 0 -> 800  (29, 2021-2024)    29003 : NA (sans donnée)

test_that("les quatre lectures re-keyées : une ligne par territoire, le signe pair (Δpopulation × trajectoire)", {
  p <- compute_payload(communes_fixture_milieux_ocsge(), theme = theme_milieux())
  h <- function(code) p$histoires[p$histoires$territoire == code, ]

  expect_equal(nrow(p$histoires), nrow(p$territoires))  # une ligne par territoire
  expect_true(all(p$histoires$story_key == "se-densifier-setaler-ou-sen-aller"))
  expect_true(all(p$histoires$theme == "milieux"))
  expect_true(all(p$histoires$periode_pop == "2017-2023"))  # la fenêtre dérivée

  # 22001 : +200 habitants, état initial nul, état final 0,12 ha -> la
  # trajectoire par habitant est infinie (0 -> 0,5 m²/hab) : > 1 -> s'étale
  expect_equal(h("22001")$delta_population, 200)
  expect_equal(h("22001")$artif_m2_par_habitant, 0)
  expect_equal(h("22001")$artif_m3_par_habitant, 1200 / 2400)
  expect_true(is.infinite(h("22001")$trajectoire_artif_par_habitant))
  expect_equal(h("22001")$classification, "grandir-en-setalant")
  # 56001 : +200 habitants, la terre DIMINUE (0,04 ha -> 0) -> la trajectoire
  # par habitant tombe sous 1 : grandir EN SE DENSIFIANT (le cas mixte)
  expect_equal(h("56001")$delta_population, 200)
  expect_equal(h("56001")$trajectoire_artif_par_habitant, 0)
  expect_equal(h("56001")$classification, "grandir-en-se-densifiant")
  # 29001 : -150 habitants, la terre progresse -> consomme quand même
  expect_equal(h("29001")$delta_population, -150)
  expect_equal(h("29001")$classification, "sen-aller-et-consommer-quand-meme")
  # 29003 : état NA (fenêtre incomplète) -> lecture NA, jamais une lecture
  # inventée
  expect_equal(h("29003")$delta_population, 0)
  expect_true(is.na(h("29003")$classification))
})

test_that("les agrégats : la somme naïve des états, NA propagé, le span pour le transfrontalier", {
  p <- compute_payload(communes_fixture_milieux_ocsge(), theme = theme_milieux())
  h <- function(code) p$histoires[p$histoires$territoire == code, ]

  # EPCI X = 22001 + 22002 : les états somment, la lecture suit ses communes
  expect_equal(h("200000001")$artif_m3, (1200 + 800) / 10000)
  expect_equal(h("200000001")$delta_population, 300)
  expect_equal(h("200000001")$classification, "grandir-en-setalant")
  expect_equal(h("22")$classification, "grandir-en-setalant")
  # EPCI Y / département 29 / région : le membre sans donnée (29003) rend le
  # niveau NA — un total incomplet n'est jamais publié comme complet
  expect_true(is.na(h("200000002")$artif_m3))
  expect_true(is.na(h("200000002")$classification))
  expect_true(is.na(h("29")$classification))
  expect_true(is.na(h("53")$classification))
  # EPCI Z (transfrontalier 35+56) : les états se somment signés — la
  # désartificialisation du 56 (état initial porté, état final nul) pèse dans
  # l'agrégat ; +600 habitants, trajectoire < 1 -> se densifie
  expect_equal(h("200000003")$artif_m2, 400 / 10000)
  expect_equal(h("200000003")$artif_m3, 400 / 10000)
  expect_equal(h("200000003")$delta_population, 600)
  expect_equal(h("200000003")$trajectoire_artif_par_habitant, 7700 / 8300)
  expect_equal(h("200000003")$classification, "grandir-en-se-densifiant")
})

# Les deux fenêtres nommées (les deux horloges, ADR-0017) ----------------------

test_that("periode_pop et periode_artif : les deux horloges dérivent chacune de SA source, nommées séparément", {
  p <- compute_payload(communes_fixture_milieux_ocsge(), theme = theme_milieux())
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
  # une fenêtre d'états absente (29003) reste NA — jamais un span inventé
  expect_true(is.na(h("29003")$periode_artif))
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
  # la lecture suit les deux forces actualisées : 22001 gagne 100 habitants et
  # porte une trajectoire infinie (état initial nul) -> s'étale
  expect_equal(hist$classification[hist$territoire == "22001"],
               "grandir-en-setalant")
  # la consommation de fenêtre (la clé de l'indicateur) se re-somme sur la
  # fenêtre glissée : 22001 = naf19art20..naf22art23 = 31 ha — le total
  # 2011-2025 (naf11art25) ne compte JAMAIS
  expect_equal(territoires$conso_fenetre[territoires$code == "22001"], 31)
})

# Les états, leur unité et le bracket de population ----------------------------

test_that("les états : la conversion m² -> ha et l'intensité d'état en m²/habitant", {
  p <- compute_payload(communes_fixture_milieux_ocsge(), theme = theme_milieux())
  h <- function(code) p$histoires[p$histoires$territoire == code, ]

  # 22001 : 1200 m² d'état final -> 0,12 ha (la conversion ÷ 10 000, la même
  # discipline documentée que CONSOENAF), état initial nul
  expect_equal(h("22001")$artif_m3, 1200 / 10000)
  expect_equal(h("22001")$artif_m2, 0)
  # l'intensité d'état : le ha × 10 000 = des m², divisés par la population du
  # millésime qui BORNE l'état — RP 2023 (2400) pour l'état final
  expect_equal(h("22001")$artif_m3_par_habitant, 1200 / 2400)
  # 56001 : l'état initial porté (400 m² = 0,04 ha), l'état final nul
  expect_equal(h("56001")$artif_m2, 400 / 10000)
  expect_equal(h("56001")$artif_m3, 0)
  expect_equal(h("56001")$artif_m2_par_habitant, 400 / 2900)
  expect_equal(h("56001")$artif_m3_par_habitant, 0)
})

test_that("le bracket de population : RP 2017 pour l'état initial, RP 2023 pour l'état final — jamais interpolé", {
  territoires <- tibble::tibble(
    code = "a", type = "commune",
    pop_debut = 1000, pop_fin = 1500,
    millesime_debut = 2017, millesime_fin = 2023,
    artif_m2 = 10000, artif_m3 = 12000,
    periode_artif = "2021-2025"
  )
  h <- compute_histoires_milieux(territoires)
  # l'état initial se lit sur RP 2017 (10 000 m² / 1000 hab = 10 m²/hab) —
  # jamais une population interpolée entre les deux recensements
  expect_equal(h$artif_m2_par_habitant, 10000 / 1000)
  # l'état final se lit sur RP 2023 (12 000 m² / 1500 hab = 8 m²/hab)
  expect_equal(h$artif_m3_par_habitant, 12000 / 1500)
  # la trajectoire = M3/M2 par habitant = 8 / 10 = 0,8 (la seconde force)
  expect_equal(h$trajectoire_artif_par_habitant, 8 / 10)
})

# L'invariant ratio/delta ------------------------------------------------------

test_that("l'invariant : sign(ratio − 1) = sign(delta) par construction, prouvé sur le fixture", {
  p <- compute_payload(communes_fixture_milieux_ocsge(), theme = theme_milieux())
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

test_that("le classifieur pur : les quatre lectures re-keyées et les cas limites (zéro = négatif)", {
  territoires <- tibble::tibble(
    code = c("a", "b", "c", "d", "e", "f", "g"),
    type = "commune",
    pop_debut = c(1000, 1000, 1000, 1000, 1000, 1000, 1000),
    pop_fin = c(1100, 1100, 900, 900, 1000, 1100, 1000),
    artif_m2 = c(10000, 10000, 10000, 10000, 10000, 10000, 10000),
    artif_m3 = c(12000, 10000, 12000, 8000, 12000, 11000, 10000),
    millesime_debut = 2017, millesime_fin = 2023,
    periode_artif = "2021-2025"
  )
  h <- compute_histoires_milieux(territoires)
  lire <- function(code) h$classification[h$territoire == code]

  # a : +100, trajectoire > 1 -> s'étale ; b : +100, trajectoire < 1 -> se
  # densifie (la terre n'a pas grandi, les habitants si)
  expect_equal(lire("a"), "grandir-en-setalant")
  expect_equal(lire("b"), "grandir-en-se-densifiant")
  # c : -100, trajectoire > 1 -> consomme quand même ; d : -100, trajectoire
  # < 1 ET la terre a DIMINUÉ (8000 < 10000) -> la renaturation MESURÉE
  expect_equal(lire("c"), "sen-aller-et-consommer-quand-meme")
  expect_equal(lire("d"), "les-departs-laissent-la-place-a-la-renaturation")
  # e : Δpopulation NUL — zéro compte négatif : consomme quand même
  expect_equal(lire("e"), "sen-aller-et-consommer-quand-meme")
  # f : trajectoire == 1 EXACTE — zéro compte négatif : se densifie (Δpop > 0)
  expect_equal(lire("f"), "grandir-en-se-densifiant")
  # g : Δpopulation nul ET trajectoire == 1 (la terre n'a pas bougé) : la
  # renaturation exige une renaturation MESURÉE (artif_m3 < artif_m2) —
  # absente, PAS de lecture (jamais une lecture inventée)
  expect_true(is.na(lire("g")))
})

test_that("la renaturation mesurée : la trajectoire < 1 sous population en baisse exige artif_m3 < artif_m2", {
  # un territoire qui se VIDE avec une trajectoire par habitant qui tombe : la
  # lecture « renaturation » ne vaut QUE si la terre a réellement diminué —
  # la propriété qui rend la lecture rigoureuse (ADR-0017)
  renaturation <- tibble::tibble(
    code = "r", type = "commune",
    pop_debut = 1000, pop_fin = 900,
    millesime_debut = 2017, millesime_fin = 2023,
    artif_m2 = 20000, artif_m3 = 15000,
    periode_artif = "2021-2025"
  )
  h <- compute_histoires_milieux(renaturation)
  expect_equal(h$classification,
               "les-departs-laissent-la-place-a-la-renaturation")
  expect_true(h$artif_m3 < h$artif_m2)  # la propriété est VRAIE

  # le même territoire avec une trajectoire par habitant qui MONTE (la terre
  # n'a pas diminué) : la lecture est « consomme quand même », JAMAIS la
  # renaturation — la propriété est FAUSSE
  pas_renaturation <- tibble::tibble(
    code = "c", type = "commune",
    pop_debut = 1000, pop_fin = 900,
    millesime_debut = 2017, millesime_fin = 2023,
    artif_m2 = 10000, artif_m3 = 12000,
    periode_artif = "2021-2025"
  )
  h2 <- compute_histoires_milieux(pas_renaturation)
  expect_equal(h2$classification, "sen-aller-et-consommer-quand-meme")
})

test_that("le classifieur pur : une force NA rend la lecture NA, jamais une lecture inventée", {
  # état initial NA (fenêtre incomplète) : ni trajectoire ni lecture
  na_etat <- tibble::tibble(
    code = "a", type = "commune",
    pop_debut = 1000, pop_fin = 1100,
    millesime_debut = 2017, millesime_fin = 2023,
    artif_m2 = NA_real_, artif_m3 = 10000,
    periode_artif = "2021-2025"
  )
  h <- compute_histoires_milieux(na_etat)
  expect_true(is.na(h$artif_m2_par_habitant))
  expect_true(is.na(h$trajectoire_artif_par_habitant))
  expect_true(is.na(h$classification))

  # population absente de la série (Δpopulation NA) : lecture NA
  na_pop <- tibble::tibble(
    code = "b", type = "commune",
    pop_debut = 1000, pop_fin = NA_real_,
    millesime_debut = 2017, millesime_fin = 2023,
    artif_m2 = 10000, artif_m3 = 12000,
    periode_artif = "2021-2025"
  )
  h2 <- compute_histoires_milieux(na_pop)
  expect_true(is.na(h2$delta_population))
  expect_true(is.na(h2$classification))
})

# Déterminisme et forme du contrat ---------------------------------------------

test_that("déterminisme : même territoire + mêmes données -> même lecture, toujours", {
  p1 <- compute_payload(communes_fixture_milieux_ocsge(), theme = theme_milieux())
  p2 <- compute_payload(communes_fixture_milieux_ocsge(), theme = theme_milieux())
  expect_identical(p1$histoires, p2$histoires)
})

test_that("le schéma de la table est le contrat de l'issue #238 (le pivot OCS-GE)", {
  p <- compute_payload(communes_fixture_milieux_ocsge(), theme = theme_milieux())
  expect_named(p$histoires, c(
    "territoire", "type", "theme", "story_key",
    "periode_pop", "periode_artif",
    "delta_population",
    "artif_m2", "artif_m3",
    "artif_m2_par_habitant", "artif_m3_par_habitant",
    "trajectoire_artif_par_habitant",
    "classification"
  ))
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
  p <- compute_payload(communes_fixture_milieux(), theme = theme_milieux())

  # le schéma du pivot est présent (le contrat de FORME), sans états OCS-GE
  expect_true(all(c("periode_pop", "periode_artif", "artif_m2", "artif_m3",
                    "artif_m2_par_habitant", "artif_m3_par_habitant",
                    "trajectoire_artif_par_habitant", "classification") %in%
                    names(p$histoires)))
  expect_false("conso_fenetre" %in% names(p$histoires))
  # la fenêtre de population dérive toujours de la série (2017-2023 au fixture)
  expect_true(all(p$histoires$periode_pop == "2017-2023"))
  # sans états OCS-GE, aucune lecture : tout NA, jamais une lecture inventée
  expect_true(all(is.na(p$histoires$classification)))
  expect_true(all(is.na(p$histoires$artif_m2)))
  expect_true(all(is.na(p$histoires$periode_artif)))
})

# Données réelles --------------------------------------------------------------
# Le bloc « données réelles » (hors boucle par défaut — LUSK_RUN_REAL=1, le
# helper skip_sans_donnees_reelles) : la VRAIE série historique du recensement
# du cache (pipeline/data/raw/, gitignoré). Il verrouille le CONTRAT RÉEL de
# la source de population de l'Histoire : les deux millésimes les plus récents
# de la série sont 2017 et 2023 (la fenêtre de l'Histoire, jamais codée en
# dur — si l'INSEE publie un nouveau recensement, la fenêtre dérive toute
# seule), et le run complet du thème sur les vraies données produit une
# lecture par territoire.

test_that("données réelles : la série historique réelle — la fenêtre dérive des millésimes 2017 et 2023", {
  extrait <- testthat::test_path("..", "..", "data", "raw", "extracted")
  fichier <- file.path(extrait, NOM_FICHIER_SERIE_HISTORIQUE)
  zip_serie <- testthat::test_path("..", "..", "data", "raw",
                                   "DS_RP_SERIE_HISTORIQUE_2023_CSV_FR.zip")
  skip_sans_donnees_reelles(
    file.exists(fichier) || file.exists(zip_serie),
    "la série historique réelle est absente du cache")

  # extraction idempotente — la même que le builder du thème
  if (!file.exists(fichier)) {
    if (!dir.exists(extrait)) dir.create(extrait, recursive = TRUE)
    suppressWarnings(
      utils::unzip(zip_serie, exdir = extrait, overwrite = FALSE)
    )
  }

  serie <- lire_serie_historique_pop(fichier)
  expect_equal(unique(serie$millesime_debut), 2017)
  expect_equal(unique(serie$millesime_fin), 2023)
  # les populations réelles ne sont JAMAIS négatives aux deux bornes. Six
  # communes du département 55 (55039, 55050, 55139, 55189, 55239, 55307 —
  # les villages détruits de la Meuse, 0 habitant) portent un 0 RÉEL aux deux
  # bornes : la donnée est un dénombrement exact, le 0 est vrai — l'assertion
  # borne à >= 0, jamais à > 0 (un 0 n'est pas une corruption).
  expect_true(all(serie$pop_debut >= 0))
  expect_true(all(serie$pop_fin >= 0))
})

test_that("données réelles : le run complet Milieux — une lecture par territoire, les deux fenêtres 2017-2023", {
  cache <- testthat::test_path("..", "..", "data", "raw")
  skip_sans_donnees_reelles(
    file.exists(file.path(cache, "conso-com.csv")),
    "le CSV CONSOENAF réel est absent du cache")

  communes <- construire_donnees_milieux(cache = cache,
                                         sortie = tempfile(fileext = ".rds"))
  territoires <- construire_territoires_milieux(communes)
  hist <- compute_histoires_milieux(territoires)

  # une ligne par territoire, les deux fenêtres dérivées de la donnée réelle
  expect_equal(nrow(hist), nrow(territoires))
  expect_true(all(hist$periode_pop == "2017-2023"))
  lectures <- c("grandir-en-se-densifiant", "grandir-en-setalant",
                "sen-aller-et-consommer-quand-meme",
                "les-departs-laissent-la-place-a-la-renaturation")
  expect_true(all(is.na(hist$classification) |
                    hist$classification %in% lectures))
  # quand les archives OCS-GE sont dans le cache, les états sont là :
  # l'invariant tient sur les lectures publiées et la renaturation est mesurée
  if ("artif_m2" %in% names(territoires)) {
    ok <- !is.na(hist$artif_m2_par_habitant) & hist$artif_m2_par_habitant > 0
    expect_true(all(
      sign(hist$trajectoire_artif_par_habitant[ok] - 1) ==
        sign(hist$artif_m3_par_habitant[ok] - hist$artif_m2_par_habitant[ok])
    ))
    renat <- hist$classification ==
      "les-departs-laissent-la-place-a-la-renaturation"
    expect_true(all(hist$artif_m3[renat] < hist$artif_m2[renat]))
  }
})
