# test-analytics-economie-dormitory ---------------------------------------------
# Le ratio dortoir « Le matin, la commune se vide » (plan economie-analytical-
# phase, todo 4 / T4) : l'équilibre emploi LIEU DE TRAVAIL vs RÉSIDENCE, commune
# par commune. Ratio = effectifs salariés (Flores A88, gate B) / actifs occupés
# (rp_emploi) — les DEUX perspectives restent des colonnes distinctes, jamais un
# indicateur fusionné (MUST NOT). L'Histoire ne se déclenche que sur les QUEUES
# de la distribution réelle (évidence 2026-08-05, 1202 communes : médiane 0.3 ;
# 69.4 % < 0.5× ; 4.6 % > 1.5× ; 2.1 % > 2×) — jamais sur la majorité. Plancher
# communal gate D (n ≥ 5 salariés au lieu de travail) ; les communes sous le
# plancher sont SUPPRIMÉES et comptées dans le rapport — jamais silencieuses.
# Sélection déterministe (ADR-0002) : même commune + mêmes données -> même
# classification, toujours.
#
# Le mini-fixture construit DES TIBBLES DANS LA FORME des tables normalisées
# réelles (flores_a88 : commune/departement/activity_code/measure/value/
# statut_observation ; rp_emploi : commune/departement/activity_code/measure/
# value). Neuf communes 22001..22009 couvrent TOUS les cas du contrat :
#   - le ratio calculé à la main, hors _T et hors mesure etablissements ;
#   - les deux seuils de saillance ET leurs bornes exactes (ratio == 0.15 et
#     ratio == 1.5 -> la commune NE déclenche PAS, elle est « equilibre ») ;
#   - le plancher gate D (22006 : 4 salariés < 5 -> suppression) ;
#   - le ratio non défini (22007 : zéro actif résident -> NA, rapporté) ;
#   - la perspective absente (22008 : commune sans résidents ; 22009 : cellule
#     non diffusée K -> somme NA, JAMAIS convertie en zéro observé).
# Le réseau n'entre jamais dans la boucle de test : le dernier test_that lit
# les tables réelles quand elles sont présentes (data/ gitignoré) et saute
# proprement sinon (CI).

# Le fixture côté lieu de travail (forme flores_a88) ----------------------------
fixture_flores_dortoir <- function() {
  tibble::tribble(
    ~commune, ~departement, ~activity_code, ~measure, ~value, ~statut_observation,
    # 22001 : 10 + 5 = 15 salariés (le _T = 15 et la mesure etablissements = 3
    # sont EXCLUS du calcul)
    "22001", "22", "01", "effectifs_salaries", 10, "A",
    "22001", "22", "35", "effectifs_salaries", 5, "A",
    "22001", "22", "_T", "effectifs_salaries", 15, "A",
    "22001", "22", "01", "etablissements", 3, "A",
    # 22002 : 100 + 60 = 160 salariés
    "22002", "22", "01", "effectifs_salaries", 100, "A",
    "22002", "22", "45", "effectifs_salaries", 60, "A",
    "22002", "22", "_T", "effectifs_salaries", 160, "A",
    # 22003 : 15 salariés -> ratio exactement 0.15 (borne basse)
    "22003", "22", "01", "effectifs_salaries", 15, "A",
    "22003", "22", "_T", "effectifs_salaries", 15, "A",
    # 22004 : 150 salariés -> ratio exactement 1.5 (borne haute)
    "22004", "22", "01", "effectifs_salaries", 150, "A",
    "22004", "22", "_T", "effectifs_salaries", 150, "A",
    # 22005 : 20 + 30 = 50 salariés -> ratio 0.5 (le milieu)
    "22005", "22", "01", "effectifs_salaries", 20, "A",
    "22005", "22", "35", "effectifs_salaries", 30, "A",
    "22005", "22", "_T", "effectifs_salaries", 50, "A",
    # 22006 : 4 salariés < 5 -> commune SOUS le plancher gate D
    "22006", "22", "01", "effectifs_salaries", 4, "A",
    "22006", "22", "_T", "effectifs_salaries", 4, "A",
    # 22007 : 10 salariés, mais zéro actif résident -> ratio non défini
    "22007", "22", "01", "effectifs_salaries", 10, "A",
    "22007", "22", "_T", "effectifs_salaries", 10, "A",
    # 22008 : présente côté travail, ABSENTE côté résidence -> perspective absente
    "22008", "22", "01", "effectifs_salaries", 8, "A",
    "22008", "22", "_T", "effectifs_salaries", 8, "A",
    # 22009 : une cellule NON DIFFUSÉE (statut K, valeur NA) -> la somme devient
    # NA, jamais convertie en zéro observé (le contrat du reshape)
    "22009", "22", "01", "effectifs_salaries", 5, "A",
    "22009", "22", "35", "effectifs_salaries", NA, "K",
    "22009", "22", "_T", "effectifs_salaries", NA, "K"
  )
}

# Le fixture côté résidence (forme rp_emploi) -----------------------------------
fixture_rp_dortoir <- function() {
  tibble::tribble(
    ~commune, ~departement, ~activity_code, ~measure, ~value,
    # 22001 : 100 + 50 = 150 actifs résidents (le _T = 150 est exclu)
    "22001", "22", "AZ", "actifs_occupes", 100,
    "22001", "22", "BE", "actifs_occupes", 50,
    "22001", "22", "_T", "actifs_occupes", 150,
    # 22002 : 60 + 40 = 100 actifs résidents
    "22002", "22", "AZ", "actifs_occupes", 60,
    "22002", "22", "BE", "actifs_occupes", 40,
    "22002", "22", "_T", "actifs_occupes", 100,
    # 22003..22006 : 100 actifs résidents chacun
    "22003", "22", "AZ", "actifs_occupes", 100,
    "22003", "22", "_T", "actifs_occupes", 100,
    "22004", "22", "AZ", "actifs_occupes", 100,
    "22004", "22", "_T", "actifs_occupes", 100,
    "22005", "22", "AZ", "actifs_occupes", 100,
    "22005", "22", "_T", "actifs_occupes", 100,
    "22006", "22", "AZ", "actifs_occupes", 100,
    "22006", "22", "_T", "actifs_occupes", 100,
    # 22007 : ZÉRO actif résident -> ratio non défini
    "22007", "22", "AZ", "actifs_occupes", 0,
    "22007", "22", "_T", "actifs_occupes", 0,
    # 22009 : 80 + 20 = 100 actifs résidents
    "22009", "22", "AZ", "actifs_occupes", 80,
    "22009", "22", "BE", "actifs_occupes", 20,
    "22009", "22", "_T", "actifs_occupes", 100
  )
}

construire_dortoir_fixture <- function() {
  construire_dortoir_economie(fixture_flores_dortoir(), fixture_rp_dortoir())
}

# Les tables réelles vivent sous pipeline/data/ (gitignoré) — résolues par
# rapport au dossier des tests (testthat::test_path), quel que soit le répertoire
# de travail du lanceur (test_dir depuis la racine ou test_file depuis pipeline/).
chemin_reel_economie <- function(fichier) {
  file.path(testthat::test_path("..", ".."),
            "data", "processed", "economie", fichier)
}

test_that("la formule du ratio : lieu de travail / résidence, hors _T et hors mesure etablissements", {
  d <- construire_dortoir_fixture()$table
  r <- function(code) d$ratio[d$commune == code]

  expect_equal(r("22001"), 15 / 150)   # 10 + 5 salariés, 100 + 50 résidents
  expect_equal(r("22002"), 160 / 100)  # 100 + 60 salariés, 60 + 40 résidents
  expect_equal(r("22003"), 0.15)       # exactement à la borne basse
  expect_equal(r("22004"), 1.5)        # exactement à la borne haute
  expect_equal(r("22005"), 0.5)        # le milieu
  expect_equal(r("22006"), 4 / 100)    # sous le plancher mais ratio calculé

  # le ratio est bien le quotient des deux perspectives DISTINCTES : les
  # colonnes workplace et resident existent à côté du ratio (jamais fondues en
  # un indicateur unique) et le ratio s'en dérive exactement
  expect_true(all(d$ratio[d$commune != "22007" & d$commune != "22008" &
                           d$commune != "22009"] ==
                    d$workplace[d$commune != "22007" & d$commune != "22008" &
                                  d$commune != "22009"] /
                    d$resident[d$commune != "22007" & d$commune != "22008" &
                                 d$commune != "22009"]))
})

test_that("agreger_effectifs_travail : mesure effectifs_salaries, secteurs ≠ _T, somme par commune", {
  w <- agreger_effectifs_travail(fixture_flores_dortoir())

  # la somme EXCLUT la ligne _T et la mesure etablissements
  expect_equal(w$workplace[w$commune == "22001"], 15)
  expect_equal(w$workplace[w$commune == "22002"], 160)
  expect_equal(w$workplace[w$commune == "22005"], 50)
  # une cellule non diffusée (K, valeur NA) propage NA — jamais un zéro observé
  expect_true(is.na(w$workplace[w$commune == "22009"]))
})

test_that("agreger_actifs_occupes : secteurs ≠ _T, somme par commune", {
  r <- agreger_actifs_occupes(fixture_rp_dortoir())

  expect_equal(r$resident[r$commune == "22001"], 150)
  expect_equal(r$resident[r$commune == "22002"], 100)
  expect_equal(r$resident[r$commune == "22007"], 0)
})

test_that("les bornes exactes des seuils : à 0.15 et 1.5 la commune NE déclenche PAS", {
  d <- construire_dortoir_fixture()$table
  cl <- function(code) d$classification[d$commune == code]

  expect_equal(cl("22001"), "dortoir-profond")  # 0.1 < 0.15 : la queue basse
  expect_equal(cl("22002"), "pole-emploi")      # 1.6 > 1.5 : la queue haute
  expect_equal(cl("22003"), "equilibre")        # ratio == 0.15 : pas strictement <
  expect_equal(cl("22004"), "equilibre")        # ratio == 1.5 : pas strictement >
  expect_equal(cl("22005"), "equilibre")        # 0.5 : le milieu, aucune queue
})

test_that("plancher gate D et ratios non définis : suppression NA, comptée dans le rapport", {
  res <- construire_dortoir_fixture()
  d <- res$table
  cl <- function(code) d$classification[d$commune == code]

  expect_true(is.na(cl("22006")))  # 4 salariés < 5 : plancher gate D
  expect_true(is.na(cl("22007")))  # zéro actif résident : ratio non défini
  expect_true(is.na(cl("22008")))  # absente du RP : perspective absente
  expect_true(is.na(cl("22009")))  # cellule non diffusée K : somme NA

  # le rapport compte chaque commune supprimée, avec son motif — rien de silencieux
  expect_equal(sort(res$suppression$commune),
               c("22006", "22007", "22008", "22009"))
  motif <- function(code) res$suppression$motif[res$suppression$commune == code]
  expect_match(motif("22006"), "plancher")
  expect_match(motif("22007"), "défini")
  expect_match(motif("22008"), "perspective")
  expect_match(motif("22009"), "perspective")
})

test_that("déterminisme (ADR-0002) : même commune + mêmes données -> même classification, toujours", {
  d1 <- construire_dortoir_fixture()$table
  d2 <- construire_dortoir_fixture()$table
  expect_identical(d1, d2)

  # les bornes exactes classifient pareil à chaque appel (scénario QA du plan)
  expect_equal(d1$classification[d1$commune == "22003"],
               d2$classification[d2$commune == "22003"])
  expect_equal(d1$classification[d1$commune == "22004"],
               d2$classification[d2$commune == "22004"])
  # la re-classification directe du tableau ne change rien non plus
  expect_identical(classifier_dortoir(d1), d1)
})

test_that("le schéma de la table : commune × ratio × classification, vocabulaire fermé", {
  d <- construire_dortoir_fixture()$table

  expect_named(d, c("commune", "departement", "workplace", "resident",
                    "ratio", "classification"))
  expect_true(all(d$commune == sort(d$commune)))
  expect_setequal(unique(d$classification[!is.na(d$classification)]),
                  CLASSEMENTS_DORTITOIRE)
  # le département des communes du fixture est porté (22)
  expect_true(all(d$departement == "22"))
})

test_that("les seuils sont des constantes nommées, verrouillées sur la distribution réelle", {
  # verrouillés à la construction (2026-08-05, évidence sur les 1202 communes) —
  # des nombres magiques seraient un échec de ce test
  expect_equal(SEUIL_DORTITOIRE_PROFOND, 0.15)
  expect_equal(SEUIL_POLE_EMPLOI, 1.5)
  expect_equal(SEUIL_EFFECTIF_TRAVAIL, 5L)
})

test_that("persister_dortoir_economie : table + rapport de suppression sous data/processed/economie/", {
  d <- tempfile("dortoir-")
  on.exit(unlink(d, recursive = TRUE), add = TRUE)
  res <- construire_dortoir_fixture()

  persister_dortoir_economie(res, sortie = d)

  expect_true(file.exists(file.path(d, "dormitory_economie.rds")))
  expect_true(file.exists(file.path(d, "dormitory_economie_suppression.rds")))
  expect_identical(readr::read_rds(file.path(d, "dormitory_economie.rds")),
                   res$table)
  expect_identical(readr::read_rds(file.path(d, "dormitory_economie_suppression.rds")),
                   res$suppression)
  # la cible par défaut est le dossier Économie/Emploi des données processées
  # (data/ étant gitignoré, seul le chemin est vérifié — jamais public/)
  expect_match(as.character(formals(persister_dortoir_economie)$sortie),
               "data/processed/economie")
})

test_that("données réelles : ratio calculable pour 100 % des communes, distribution verrouillée", {
  chemin_a88 <- chemin_reel_economie("flores_a88.rds")
  skip_if_not(file.exists(chemin_a88),
              "les tables réelles ne sont pas présentes (data/ est gitignoré)")

  res <- construire_dortoir_economie(
    readr::read_rds(chemin_a88),
    readr::read_rds(chemin_reel_economie("rp_emploi.rds"))
  )
  d <- res$table

  # acceptance : ratio calculable pour 100 % des 1202 communes (les deux côtés > 0)
  expect_equal(nrow(d), 1202)
  expect_equal(sum(!is.na(d$ratio)), 1202)
  expect_true(all(d$workplace > 0))
  expect_true(all(d$resident > 0))

  # la distribution réelle verrouillée à la construction (évidence 2026-08-05) :
  # 304 dortoirs profonds (25,3 %), 55 pôles d'emploi (4,6 %), 6 communes sous le
  # plancher gate D (0,5 %), le reste « equilibre » (69,6 %)
  expect_equal(sum(d$classification == "dortoir-profond", na.rm = TRUE), 304)
  expect_equal(sum(d$classification == "pole-emploi", na.rm = TRUE), 55)
  expect_equal(sum(is.na(d$classification)), 6)
  expect_equal(nrow(res$suppression), 6)
  # les 6 supprimées sont toutes sous le plancher (motif gate D)
  expect_true(all(grepl("plancher", res$suppression$motif)))

  # l'Histoire ne se déclenche JAMAIS sur la majorité : < 50 % de communes
  expect_lt(sum(d$classification != "equilibre", na.rm = TRUE) / nrow(d), 0.5)
  # médiane ~0.3 (l'évidence : médiane 0.3, 69.4 % < 0.5×)
  expect_lt(median(d$ratio), 0.5)
  expect_gt(median(d$ratio), 0.2)
})
