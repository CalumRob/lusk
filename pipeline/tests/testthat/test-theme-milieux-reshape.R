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

test_that("les 14 colonnes annuelles naf{AA}art{AA+1} se convertissent m² -> ha (2011 -> 2024)", {
  norm <- normaliser_consoenaf(lire_fixture_consoenaf())
  a1 <- norm[norm$code == "22001", ]

  # les annuels de tête (2011, 2012) étaient déjà dans la fixture ; la suite
  # 2013-2024 arrive avec l'indicateur livré (issue #172) — chaque colonne
  # annuelle se convertit m² -> ha comme les autres champs de consommation
  expect_equal(a1$naf13art14, 100000 / 10000)   # 10 ha (2013)
  expect_equal(a1$naf20art21, 100000 / 10000)   # 10 ha (2020)
  expect_equal(a1$naf21art22, 60000 / 10000)    # 6 ha (2021)
  expect_equal(a1$naf22art23, 50000 / 10000)    # 5 ha (2022)
  expect_equal(a1$naf23art24, 80000 / 10000)    # 8 ha (2023)
  expect_equal(a1$naf24art25, 43202 / 10000)    # 4,3202 ha (2024)

  # la fenêtre 2021-2025 EST la somme des quatre annuels 2021-2024 — la
  # vérification à la main de l'acceptance criteria : le champ natif naf21art25
  # (233 202 m²) vaut la somme des quatre annuels de la fenêtre
  fenetre <- sum(c(a1$naf21art22, a1$naf22art23, a1$naf23art24, a1$naf24art25))
  expect_equal(fenetre, a1$naf21art25)
  # la décennie 2011-2021 (le champ naf11art21) vaut la somme des dix premiers
  # annuels (2011-2020) — la cohérence interne du fixture, vérifiée à la main
  decennie <- sum(c(a1$naf11art12, a1$naf12art13, a1$naf13art14, a1$naf14art15,
                    a1$naf15art16, a1$naf16art17, a1$naf17art18, a1$naf18art19,
                    a1$naf19art20, a1$naf20art21))
  expect_equal(decennie, a1$naf11art21)
  # et le total 2011-2025 (naf11art25) = décennie + fenêtre
  expect_equal(decennie + fenetre, a1$naf11art25)
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
