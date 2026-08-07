# test-theme-milieux-reshape ----------------------------------------------------
# Le reshape CONSOENAF (issue #171) : le fichier distribue la consommation
# d'ENAF en m² alors que le dictionnaire Cerema la labellise « en hectares »
# (vérifié via la cohérence interne d'artcom1125 pour Rennes, docs/research/
# zan-rennes.md). Le reshape convertit m² -> ha (÷ 10 000) à la lecture et
# filtre la Bretagne (22/29/35/56). La conversion ET le filtre sont testés ici
# — la règle d'unité n'est jamais silencieusement trustée (ADR-0014, point
# « unit conversion »).

# La fixture : un petit CSV à la forme réelle du jeu (les colonnes du
# dictionnaire, un sous-ensemble des 172) — quatre communes bretonnes (dont
# une à consommation vide -> NA) et une hors Bretagne qui doit tomber au filtre.
lire_fixture_consoenaf <- function() {
  lire_consoenaf(testthat::test_path("fixtures", "consoenaf-fixture.csv"))
}

test_that("lire_consoenaf : le CSV se lit, les identifiants restent des chaînes", {
  brut <- lire_fixture_consoenaf()

  expect_s3_class(brut, "tbl_df")
  expect_equal(nrow(brut), 6L)
  expect_true(all(c("idcom", "idcomtxt", "iddep", "epci25", "epci25txt") %in%
                    names(brut)))
  # les codes ne sont jamais lus comme des nombres (le 0 de tête de 01001)
  expect_equal(brut$idcom[brut$idcomtxt == "Hors-Bretagne"], "01001")
  expect_type(brut$iddep, "character")
})

test_that("normaliser_consoenaf : la conversion m² -> ha (÷ 10 000) sur tous les champs de consommation", {
  norm <- normaliser_consoenaf(lire_fixture_consoenaf())

  # 22001 : le cas Rennes de la recherche — naf11art25 = 1 233 202 m² -> 123,3202 ha
  a1 <- norm[norm$code == "22001", ]
  expect_equal(a1$naf11art25, 1233202 / 10000)      # 123,3202 ha
  expect_equal(a1$art11hab25, 700000 / 10000)       # 70 ha
  expect_equal(a1$art11act25, 300000 / 10000)       # 30 ha
  expect_equal(a1$naf11art12, 120000 / 10000)       # 12 ha (un annuel)
  expect_equal(a1$art11hab12, 60000 / 10000)        # 6 ha (un annuel par destination)
  expect_equal(a1$naf12art13, 80000 / 10000)        # 8 ha (un autre annuel)
  expect_equal(a1$naf11art21, 1000000 / 10000)      # 100 ha (la décennie de référence)
  expect_equal(a1$naf21art25, 233202 / 10000)       # 23,3202 ha (la fenêtre post-loi)
  expect_equal(a1$art21hab25, 150000 / 10000)       # 15 ha

  # les autres communes bretonnes
  expect_equal(norm$naf11art25[norm$code == "22002"], 25)
  expect_equal(norm$naf11art25[norm$code == "29001"], 50)
  expect_equal(norm$naf11art25[norm$code == "29002"], 7.5)
})

test_that("normaliser_consoenaf : seuls les champs de consommation sont convertis — jamais les ratios, jamais les surfaces, jamais les parts", {
  norm <- normaliser_consoenaf(lire_fixture_consoenaf())
  a1 <- norm[norm$code == "22001", ]

  # les décors du fichier passent INTACTS, tels que lus (le reshape ne touche
  # QUE les champs de consommation — un décor n'est jamais divisé par 10 000) :
  #   - pop11/16/22 : les populations RP embarquées (jamais converties — la
  #     règle de source de population d'ADR-0014)
  #   - mepart1116 / menhab1116 : les ratios ménages-emplois par ha
  #   - artpop1116 : la surface par habitant supplémentaire (ha/hab — son nom
  #     commence par « art » mais ce n'est PAS une consommation en m²)
  #   - surfcom2025 : la surface de la commune, en m² (une mesure, pas une
  #     consommation — on ne la divise pas)
  #   - artcom1125 : la part de surface consommée (un %, déjà dans sa forme)
  expect_equal(a1$pop11, "208033")
  expect_equal(a1$pop22, "227830")
  expect_equal(a1$mepart1116, "25.17")
  expect_equal(a1$artpop1116, "457.97")
  expect_equal(a1$menhab1116, "5.44")
  expect_equal(a1$surfcom2025, "50311729.0")
  expect_equal(a1$artcom1125, "2.45")
})

test_that("normaliser_consoenaf : le filtre Bretagne (22/29/35/56) — la commune hors Bretagne tombe", {
  norm <- normaliser_consoenaf(lire_fixture_consoenaf())

  expect_false("01001" %in% norm$code)   # Hors-Bretagne (01)
  expect_setequal(norm$code, c("22001", "22002", "29001", "29002", "29003"))
  expect_true(all(norm$departement %in% DEPT_BRETAGNE))
  expect_true(all(norm$departement %in% c("22", "29", "35", "56")))
})

test_that("normaliser_consoenaf : une consommation vide reste NA (jamais 0 inventé)", {
  norm <- normaliser_consoenaf(lire_fixture_consoenaf())

  na <- norm[norm$code == "29003", ]
  expect_equal(nrow(na), 1L)
  expect_true(is.na(na$naf11art25))
  expect_true(is.na(na$art11hab25))
  expect_true(is.na(na$naf11art12))
})

test_that("normaliser_consoenaf : le rename d'identité (code/nom/departement/epci/nom_epci)", {
  norm <- normaliser_consoenaf(lire_fixture_consoenaf())

  expect_true(all(c("code", "nom", "departement", "epci", "nom_epci") %in%
                    names(norm)))
  expect_equal(norm$nom[norm$code == "29001"], "Commune B")
  expect_equal(norm$epci[norm$code == "22001"], "200000001")
  expect_equal(norm$nom_epci[norm$code == "29002"], "EPCI Y")
})

test_that("conso_en_m2 : le motif isole exactement les champs de consommation (jamais les ratios, parts ni surfaces)", {
  noms <- c(
    "naf11art12", "art11hab12", "art11act12", "art11inc12", "art11mix12",
    "art11fer12", "art11rou12", "naf12art13", "naf24art25", "art24hab25",
    "naf11art25", "art11hab25", "naf11art21", "art21hab25", "naf11art16",
    "naf16art22", "naf11art22", "art11hab16", "art16hab22", "art11hab22",
    # les décors : rien de tout cela n'est une consommation en m²
    "artpop1116", "artpop1622", "artpop1122", "mepart1116", "mepart1622",
    "mepart1122", "menhab1116", "menhab1622", "menhab1122",
    "artcom1125", "surfcom2025", "pop11", "pop16", "pop22", "men11", "emp11",
    "idcom", "idcomtxt", "iddep", "epci25", "epci25txt", "scot"
  )

  m2 <- conso_en_m2(noms)

  attendus <- c(
    "naf11art12", "art11hab12", "art11act12", "art11inc12", "art11mix12",
    "art11fer12", "art11rou12", "naf12art13", "naf24art25", "art24hab25",
    "naf11art25", "art11hab25", "naf11art21", "art21hab25", "naf11art16",
    "naf16art22", "naf11art22", "art11hab16", "art16hab22", "art11hab22"
  )
  expect_setequal(m2, attendus)
})

# Données réelles --------------------------------------------------------------
# Le bloc « données réelles » (hors boucle par défaut — LUSK_RUN_REAL=1, le
# helper skip_sans_donnees_reelles) : le CSV CONSOENAF réel du cache
# (pipeline/data/raw/, gitignoré). Il verrouille le CONTRAT RÉEL du fichier —
# les 172 colonnes du dictionnaire, l'anomalie d'unité m²/ha vérifiée sur
# Rennes (1 233 202 m² ÷ 50 311 729 m² = 2,45 %, docs/research/zan-rennes.md) —
# que les fixtures ne peuvent pas voir. Sans fichier réel, le test est sauté.

test_that("données réelles : le CSV CONSOENAF réel — 172 colonnes, l'anomalie m²/ha vérifiée sur Rennes", {
  fichier <- testthat::test_path("..", "..", "data", "raw", "conso-com.csv")
  skip_sans_donnees_reelles(file.exists(fichier),
                            "le CSV CONSOENAF réel est absent du cache")

  brut <- lire_consoenaf(fichier)
  expect_equal(ncol(brut), 172L)

  # l'anomalie d'unité, vérifiée sur le fichier réel : Rennes porte naf11art25
  # = 1 233 202 m² (le dictionnaire dit hectares) — la cohérence interne
  # d'artcom1125 (2,45 %) le prouve : 1 233 202 / 50 311 729 × 100 = 2,45 %
  # (la formule du dictionnaire suppose le champ en hectares et multiplie par
  # 10 000 ; le fichier distribuant des m², la part se lit directement en m²)
  rennes <- brut[brut$idcom == "35238", ]
  expect_equal(nrow(rennes), 1L)
  m2 <- as.double(rennes$naf11art25)
  expect_equal(m2, 1233202)
  part <- as.double(rennes$artcom1125)
  expect_equal(part, m2 / as.double(rennes$surfcom2025) * 100,
               tolerance = 1e-2)

  # le reshape réel : la conversion et le filtre Bretagne tournent sans dérive
  norm <- normaliser_consoenaf(brut)
  expect_true(all(norm$departement %in% DEPT_BRETAGNE))
  expect_equal(norm$naf11art25[norm$code == "35238"], 1233202 / 10000)
})
