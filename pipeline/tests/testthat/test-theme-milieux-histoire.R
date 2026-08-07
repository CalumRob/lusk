# test-theme-milieux-histoire ---------------------------------------------------
# L'Histoire « Se densifier, s'étaler, ou s'en aller » (issue #174, ADR-0014) :
# la lecture du territoire contre sa terre. Deux forces — la variation de
# population (de la SÉRIE HISTORIQUE du recensement, la source partagée —
# jamais les populations embarquées de CONSOENAF) et la consommation d'ENAF de
# la fenêtre (les ANNUELS CONSOENAF re-sommés sur la MÊME période que la
# fenêtre de population) — classent chaque territoire dans EXACTEMENT une des
# quatre lectures, par le SIGNE seul (seuil 0 : ZAN est un objectif zéro, la
# donnée est un dénombrement complet — un 0 est un vrai 0).
#
# La règle des DEUX HORLOGES (le cœur du ticket) : la fenêtre de l'Histoire
# dérive des DEUX millésimes RP les plus récents que la série historique porte
# (aujourd'hui 2017 et 2023), jamais codée en dur — elle glisse automatiquement
# quand l'INSEE publie un nouveau recensement, et les annuels de terre se
# re-somment sur la fenêtre dérivée. L'intensité (m² d'ENAF par habitant
# ajouté) est publiée seulement quand le Δpopulation est significativement
# positif (au moins un habitant ajouté — le dénombrement est exact).

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

# Les quatre lectures sur le fixture -------------------------------------------

test_that("les quatre lectures : une ligne par territoire, la classification par signes (seuil 0)", {
  p <- compute_payload(communes_fixture_milieux(), theme = theme_milieux())
  h <- function(code) p$histoires[p$histoires$territoire == code, ]

  expect_equal(nrow(p$histoires), nrow(p$territoires))  # une ligne par territoire
  expect_true(all(p$histoires$story_key == "se-densifier-setaler-ou-sen-aller"))
  expect_true(all(p$histoires$theme == "milieux"))
  expect_true(all(p$histoires$periode == "2017-2023"))  # la fenêtre dérivée

  # 22001 : population en hausse (+200), consommation 51 ha -> s'étale
  expect_equal(h("22001")$delta_population, 200)
  expect_equal(h("22001")$conso_fenetre, 51)
  expect_equal(h("22001")$classification, "grandir-en-setalant")
  # 22002 : population en hausse (+100), consommation 9 ha -> s'étale aussi
  expect_equal(h("22002")$delta_population, 100)
  expect_equal(h("22002")$conso_fenetre, 9)
  expect_equal(h("22002")$classification, "grandir-en-setalant")
  # 29001 : population en baisse (-150), consommation 15,5 ha -> consomme quand même
  expect_equal(h("29001")$delta_population, -150)
  expect_equal(h("29001")$conso_fenetre, 15.5)
  expect_equal(h("29001")$classification, "sen-aller-et-consommer-quand-meme")
  # 29002 : population en baisse (-10), consommation 1,75 ha -> consomme quand même
  expect_equal(h("29002")$delta_population, -10)
  expect_equal(h("29002")$conso_fenetre, 1.75)
  expect_equal(h("29002")$classification, "sen-aller-et-consommer-quand-meme")
  # 29003 : consommation NA (jamais un 0 inventé) -> lecture NA
  expect_equal(h("29003")$delta_population, 0)
  expect_true(is.na(h("29003")$conso_fenetre))
  expect_true(is.na(h("29003")$classification))
})

test_that("les agrégats : mêmes signes, même lecture — un total incomplet reste NA", {
  p <- compute_payload(communes_fixture_milieux(), theme = theme_milieux())
  h <- function(code) p$histoires[p$histoires$territoire == code, ]

  # EPCI X = A1 + D : Δpop 300, conso 60 ha -> s'étale
  expect_equal(h("200000001")$delta_population, 300)
  expect_equal(h("200000001")$conso_fenetre, 60)
  expect_equal(h("200000001")$classification, "grandir-en-setalant")
  # le département 22 suit ses communes
  expect_equal(h("22")$classification, "grandir-en-setalant")
  # EPCI Y = B + C + NA : la consommation incomplète (29003) rend la lecture NA
  # — un total incomplet n'est jamais publié comme s'il était complet
  expect_equal(h("200000002")$delta_population, -160)
  expect_true(is.na(h("200000002")$conso_fenetre))
  expect_true(is.na(h("200000002")$classification))
  expect_true(is.na(h("29")$classification))
  expect_true(is.na(h("53")$classification))
})

test_that("l'intensité (m² d'ENAF par habitant ajouté) : publiée quand le Δpopulation est significativement positif, supprimée sinon", {
  p <- compute_payload(communes_fixture_milieux(), theme = theme_milieux())
  h <- function(code) p$histoires[p$histoires$territoire == code, ]

  # 22001 : 51 ha pour +200 habitants -> 51 × 10 000 / 200 = 2550 m²/hab
  expect_equal(h("22001")$intensite_m2_par_habitant, 51 * 10000 / 200)
  # 22002 : 9 ha pour +100 habitants -> 9 × 10 000 / 100 = 900 m²/hab
  expect_equal(h("22002")$intensite_m2_par_habitant, 9 * 10000 / 100)
  # 29001 : la population DIMINUE -> pas d'habitants ajoutés -> NA (supprimée)
  expect_true(is.na(h("29001")$intensite_m2_par_habitant))
  # 29003 : Δpopulation nul (près de zéro) -> NA
  expect_true(is.na(h("29003")$intensite_m2_par_habitant))
})

# Le classifieur pur (les cas limites, par une table directe) ------------------

test_that("le classifieur pur : les quatre lectures et les cas limites (zéro = négatif)", {
  territoires <- tibble::tibble(
    code = c("a", "b", "c", "d", "e", "f"),
    type = "commune",
    pop_debut = c(1000, 1000, 1000, 1000, 1000, 1000),
    pop_fin = c(1100, 1100, 900, 900, 1001, 1000),
    conso_fenetre = c(10, 0, 10, 0, 10, 10),
    millesime_debut = 2017, millesime_fin = 2023
  )
  h <- compute_histoires_milieux(territoires)
  lire <- function(code) h$classification[h$territoire == code]

  # a : +100, consomme -> s'étale ; b : +100, zéro EXACT -> se densifie
  expect_equal(lire("a"), "grandir-en-setalant")
  expect_equal(lire("b"), "grandir-en-se-densifiant")
  # c : -100, consomme -> consomme quand même ; d : -100, zéro -> renaturation
  expect_equal(lire("c"), "sen-aller-et-consommer-quand-meme")
  expect_equal(lire("d"), "les-departs-laissent-la-place-a-la-renaturation")
  # e : +1 (le plus petit gain réel) -> s'étale ; l'intensité est publiée
  expect_equal(lire("e"), "grandir-en-setalant")
  expect_equal(h$intensite_m2_par_habitant[h$territoire == "e"], 10 * 10000 / 1)
  # f : Δpopulation NUL — zéro compte négatif : consomme quand même, intensité NA
  expect_equal(lire("f"), "sen-aller-et-consommer-quand-meme")
  expect_true(is.na(h$intensite_m2_par_habitant[h$territoire == "f"]))
})

test_that("le classifieur pur : une consommation NA rend la lecture NA, jamais une lecture inventée", {
  territoires <- tibble::tibble(
    code = "a",
    type = "commune",
    pop_debut = 1000, pop_fin = 1100,
    conso_fenetre = NA_real_,
    millesime_debut = 2017, millesime_fin = 2023
  )
  h <- compute_histoires_milieux(territoires)
  expect_true(is.na(h$classification))
  expect_true(is.na(h$intensite_m2_par_habitant))
})

# La règle des deux horloges : la fenêtre glisse avec la série -----------------

test_that("les deux horloges : des millésimes différents font glisser la fenêtre et re-sommer la terre", {
  cache <- tempfile("cache-milieux-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))
  file.copy(testthat::test_path("fixtures", "consoenaf-fixture.csv"),
            file.path(cache, "conso-com.csv"), overwrite = TRUE)
  # une série historique à millésimes 2019 et 2023 (jamais 2017) : la fenêtre
  # doit être 2019-2023 et les annuels 2019..2022 re-sommés
  extrait <- file.path(cache, "extracted")
  dir.create(extrait, recursive = TRUE)
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
    "COM", "29003", "_T", "_T", "POP", "A", "A", 2023, 500
  )
  readr::write_delim(serie, file.path(extrait, NOM_FICHIER_SERIE_HISTORIQUE),
                     delim = ";")

  local_mocked_bindings(lire_epci = function(chemin) base_epci_milieux,
                        .package = "lusk")
  communes <- construire_donnees_milieux(cache = cache,
                                         sortie = tempfile(fileext = ".rds"))

  # la fenêtre dérivée : 2019-2023, et la population au départ = 2019
  expect_equal(unique(communes$millesime_debut), 2019)
  expect_equal(unique(communes$millesime_fin), 2023)
  expect_equal(communes$pop_debut[communes$code == "22001"], 2300)

  # la terre re-sommée sur la fenêtre : 22001 = naf19art20..naf22art23
  # (100000 + 100000 + 60000 + 50000 m²) = 310 000 m² = 31 ha — le total
  # 2011-2025 (naf11art25) ne compte JAMAIS
  expect_equal(communes$conso_fenetre[communes$code == "22001"], 31)

  # l'Histoire publiée porte la fenêtre glissée et la lecture actualisée
  territoires <- construire_territoires_milieux(communes)
  hist <- compute_histoires_milieux(territoires)
  expect_true(all(hist$periode == "2019-2023"))
  expect_equal(hist$delta_population[hist$territoire == "22001"], 100)
  expect_equal(hist$conso_fenetre[hist$territoire == "22001"], 31)
})

# Déterminisme et forme du contrat ---------------------------------------------

test_that("déterminisme : même territoire + mêmes données -> même lecture, toujours", {
  p1 <- compute_payload(communes_fixture_milieux(), theme = theme_milieux())
  p2 <- compute_payload(communes_fixture_milieux(), theme = theme_milieux())
  expect_identical(p1$histoires, p2$histoires)
})

test_that("le schéma de la table est le contrat de l'issue #174", {
  p <- compute_payload(communes_fixture_milieux(), theme = theme_milieux())
  expect_named(p$histoires, c(
    "territoire", "type", "theme", "story_key", "periode",
    "delta_population", "conso_fenetre", "intensite_m2_par_habitant",
    "classification"
  ))
  # le payload passe la validation générique (forme, territoires, vintages)
  expect_no_error(
    validate_payload(p,
                     indicateurs = INDICATEURS_MILIEUX,
                     vintages = vintages_milieux(),
                     validations = validations_milieux,
                     apercu = APERCU_MILIEUX)
  )
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

test_that("données réelles : le run complet Milieux — une lecture par territoire, la fenêtre 2017-2023", {
  cache <- testthat::test_path("..", "..", "data", "raw")
  skip_sans_donnees_reelles(
    file.exists(file.path(cache, "conso-com.csv")),
    "le CSV CONSOENAF réel est absent du cache")

  communes <- construire_donnees_milieux(cache = cache,
                                         sortie = tempfile(fileext = ".rds"))
  territoires <- construire_territoires_milieux(communes)
  hist <- compute_histoires_milieux(territoires)

  # une ligne par territoire, la fenêtre dérivée de la série réelle
  expect_equal(nrow(hist), nrow(territoires))
  expect_true(all(hist$periode == "2017-2023"))
  # la donnée réelle est un dénombrement complet : chaque lecture porte soit
  # une des quatre lectures, soit NA quand la consommation de la fenêtre est
  # incomplète — jamais une lecture hors contrat
  lectures <- c("grandir-en-se-densifiant", "grandir-en-setalant",
                "sen-aller-et-consommer-quand-meme",
                "les-departs-laissent-la-place-a-la-renaturation")
  expect_true(all(is.na(hist$classification) |
                    hist$classification %in% lectures))
  # les communes qui consomment et gagnent des habitants portent l'intensité
  ok <- !is.na(hist$classification) & hist$delta_population >= SEUIL_INTENSITE_MILIEUX
  expect_true(all(!is.na(hist$intensite_m2_par_habitant[ok])))
})
