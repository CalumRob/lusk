# test-theme-milieux-histoire ---------------------------------------------------
# L'Histoire « Se densifier, s'étaler, ou s'en aller » (issue #174, pivotée par
# #238 — ADR-0017) : la lecture du territoire contre sa terre, re-keyée sur les
# états OCS-GE. Deux forces, chacune lue par le SIGNE seul (seuil 0, la règle
# des quadrants d'ADR-0011) :
#   - le Δpopulation = pop_fin - pop_debut — les populations de la SÉRIE
#     HISTORIQUE du recensement aux deux millésimes de la fenêtre (RP 2017 /
#     RP 2023 — la règle de source d'ADR-0014, jamais les populations
#     embarquées de CONSOENAF) — publié brut (le prose le cite) ET, depuis
#     #306, en taux annuel pour mille (taux_variation_population, ‰/an — le
#     registre Démographie : delta / durée / population moyenne x 1000) ;
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
  # total — la structure du fichier réel Cerema. La colonne conso_fenetre de
  # la table des territoires (la fenêtre re-sommée sur les annuels, la source
  # de l'ancienne clé tête de l'indicateur, #172) doit rester la somme des
  # SEULS totaux : 51 ha pour 22001, jamais 102 (le doublement du bug #221).
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
# Le fixture territorial OCS-GE (helper-milieux.R, issue #237, amendé par
# #243) : sept communes, l'EPCI Z transfrontalier 35+56, quatre départements
# et la région. Les états par commune (en m², la fenêtre dérivée de la donnée
# — des STOCKS, jamais des flux) :
#   22001 : 400 -> 1200 (22, 2021/2025)   35001 : 400 -> 400 (35, 2020/2023)
#   22002 : 400 -> 800  (22, 2021/2025)   56001 : 800 -> 600 (56, 2022/2024 —
#   29001 : 800 -> 1200 (29, 2021/2024)           la renaturation MESURÉE,
#   29002 : 800 -> 800  (29, 2021/2024)           M3 < M2, jamais un 0)
#   29003 : 500 -> 700  (29, 2021/2024)

test_that("indicator state rows carry typed role and source-component lineage", {
  territoires <- tibble::tibble(code=c("22001","200000003"),departement=c("22",NA_character_),
    millesime_ocsge_debut=c(2021L,NA_integer_),millesime_ocsge_fin=c(2025L,NA_integer_),
    artif_m2=c(400,1000),pop_debut=c(2200,5000),artif_m3=c(1200,900),pop_fin=c(2400,5100),
    periode_artif=c("2021-2025","2020-2023 (35) · 2022-2024 (56)"),
    couples_ocsge=c("22:2021:2025","35:2020:2023|56:2022:2024"))
  rows <- indicator_artif_par_habitant(territoires)
  expect_equal(rows$state_role,c("M2","M3","M2","M3"))
  expect_equal(rows$detail,c("2021","2025","M2","M3"))
  component <- lapply(rows$source_components,jsonlite::fromJSON,simplifyVector=FALSE)
  expect_identical(unlist(component[[1]]$M2),"ocsge_artificialisation_22_2021")
  expect_identical(unlist(component[[2]]$M3),"ocsge_artificialisation_22_2025")
  expect_setequal(unlist(component[[3]]$M2),c("ocsge_artificialisation_35_2020","ocsge_artificialisation_56_2022"))
  expect_setequal(unlist(component[[4]]$M3),c("ocsge_artificialisation_35_2023","ocsge_artificialisation_56_2024"))
  expect_equal(rows$value,c(400/2200,1200/2400,1000/5000,900/5100))
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

# Le taux annuel pour mille de la Story (issue #306) ---------------------------
# La force population du quadrant est désormais un TAUX annuel pour mille
# habitants (‰/an) — le registre Démographie (ADR-0011), jamais la variation
# brute, jamais un absolu annualisé (le « ×100 hab/an » de #264, amendé par
# #306). La formule est la convention INSEE de compute_histoires_demographie :
#   taux = delta_population / (millesime_fin - millesime_debut) /
#          ((pop_debut + pop_fin) / 2) x 1000
# — la durée dérive des deux millésimes de la série (les deux horloges, jamais
# codée en dur), la population moyenne est le bracket INSEE (pop_debut +
# pop_fin) / 2. Le delta brut RESTE publié (le prose le cite). La
# classification est inchangée : elle lit le signe seul de delta_population —
# identique pour le compte et pour le taux.

test_that("le taux annuel : une population moyenne nulle rend le taux NA — jamais une division par zéro (#306)", {
  territoires <- tibble::tibble(
    code = c("a", "b", "c"),
    type = "commune",
    pop_debut = c(0, 1000, 1000),
    pop_fin = c(0, NA_real_, 1500),
    millesime_debut = 2017, millesime_fin = 2023,
    artif_m2 = c(10000, 10000, 10000),
    artif_m3 = c(12000, 12000, 12000),
    periode_artif = "2021-2025"
  )
  h <- compute_histoires_milieux(territoires)
  # population moyenne nulle (les deux bornes à 0 — le 0 réel des villages
  # détruits) : le taux est NA, jamais un rapport inventé sur un 0
  expect_true(is.na(h$taux_variation_population[h$territoire == "a"]))
  # population absente de la série -> taux NA, jamais un taux inventé
  expect_true(is.na(h$taux_variation_population[h$territoire == "b"]))
  # la référence saine : +500 hab, durée 6, population moyenne 1250
  expect_equal(h$taux_variation_population[h$territoire == "c"],
               500 / 6 / ((1000 + 1500) / 2) * 1000)
})

test_that("la durée du taux dérive des millésimes de la série — jamais codée en dur (les deux horloges, #306)", {
  # une fenêtre 2019-2023 (durée 4) : le taux annualise sur SA durée, jamais 6
  territoires <- tibble::tibble(
    code = "a", type = "commune",
    pop_debut = 1000, pop_fin = 1100,
    millesime_debut = 2019, millesime_fin = 2023,
    artif_m2 = 10000, artif_m3 = 12000,
    periode_artif = "2021-2025"
  )
  h <- compute_histoires_milieux(territoires)
  expect_equal(h$taux_variation_population, 100 / 4 / ((1000 + 1100) / 2) * 1000)
})

# Déterminisme et forme du contrat ---------------------------------------------
