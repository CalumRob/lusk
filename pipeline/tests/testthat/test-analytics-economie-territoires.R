# test-analytics-economie-territoires -------------------------------------------
# L'agrégation du payload Économie aux niveaux EPCI / département / région
# (issue #131, décisions verrouillées 2026-08-06) :
#   - `effectifs_salaries` (la « Taille ») : la somme des effectifs salariés
#     au lieu de travail (Flores A88, l'agrégation du dortoir) par niveau —
#     jamais la moyenne d'un ratio ;
#   - `chomage` et `eco_activites` : les taux des agrégats sont RECALCULÉS
#     depuis les parties communales (Σ chômeurs ÷ Σ actifs ; Σ établissements
#     verts ÷ Σ établissements) — JAMAIS la moyenne des parts communales ;
#   - la LQ des agrégats est recalée à RÉFÉRENCE MÊME-ÉCHELLE : un EPCI se
#     compare aux autres EPCIs, un département aux autres départements —
#     jamais vs la moyenne bretonne des communes ;
#   - les histoires deviennent MULTI-LIGNES : « ce que la commune abrite »
#     (top-5 par LQ, rang / activity_code / activity_label / lq / n) pour les
#     communes, les EPCIs et les départements — la région (53) porte « ce que
#     la Bretagne abrite » (top-5 par présence, n + part du parc).
# Le tout, testé sur fixtures calculées À LA MAIN. Aucun appel réseau.

# La base des EPCI du fixture (la forme de lire_epci) -------------------------
# 4 communes, 2 EPCIs, 2 départements — la référence que les agrégations
# consomment pour propager une commune à son EPCI / département.
base_epci_agregats <- tibble::tribble(
  ~CODGEO, ~LIBGEO, ~EPCI, ~LIBEPCI, ~DEP, ~REG,
  "22001", "Commune A1", "200000001", "EPCI X", "22", "53",
  "22002", "Commune D", "200000001", "EPCI X", "22", "53",
  "29001", "Commune B", "200000002", "EPCI Y", "29", "53",
  "29002", "Commune C", "200000002", "EPCI Y", "29", "53"
)

# 1. Effectifs salariés (la « Taille ») ----------------------------------------

test_that("effectifs_salaries : le total par niveau, SOMMÉ jamais moyenné", {
  effectifs <- tibble::tribble(
    ~commune, ~effectifs_salaries,
    "22001", 100,
    "22002", 200,
    "29001", 300,
    "29002", 50
  )

  tab <- agreger_effectifs_territoires(effectifs, base_epci_agregats)

  valeur <- function(code) tab$value[tab$code == code]
  # les communes gardent leur propre effectif
  expect_equal(valeur("22001"), 100)
  expect_equal(valeur("29002"), 50)
  # EPCI X = A1 + D ; EPCI Y = B + C
  expect_equal(valeur("200000001"), 300)
  expect_equal(valeur("200000002"), 350)
  # départements et région : la somme des communes membres
  expect_equal(valeur("22"), 300)
  expect_equal(valeur("29"), 350)
  expect_equal(valeur("53"), 650)
  # une ligne par niveau, aucun doublon
  expect_equal(anyDuplicated(tab$code), 0L)
})

test_that("effectifs_salaries : une commune sans effectif (cellule non diffusée) rend l'agrégat NA", {
  effectifs <- tibble::tribble(
    ~commune, ~effectifs_salaries,
    "22001", 100,
    "22002", NA_real_,
    "29001", 300,
    "29002", 50
  )

  tab <- agreger_effectifs_territoires(effectifs, base_epci_agregats)

  # la somme d'un niveau qui contient une cellule non diffusée est NA —
  # jamais un total partiel inventé (le contrat du dortoir, ressuscité)
  expect_true(is.na(tab$value[tab$code == "200000001"]))
  expect_true(is.na(tab$value[tab$code == "22"]))
  expect_true(is.na(tab$value[tab$code == "53"]))
  # l'EPCI Y et le département 29, complets, gardent leurs totaux
  expect_equal(tab$value[tab$code == "200000002"], 350)
  expect_equal(tab$value[tab$code == "29"], 350)
})

# 2. Chômage : le taux des agrégats est RECALCULÉ, jamais une moyenne --------

test_that("chomage : un EPCI à deux communes = Σ chômeurs ÷ Σ actifs, pas la moyenne des taux", {
  chomage <- tibble::tribble(
    ~commune, ~departement, ~chomeurs, ~actifs_occupes, ~population_active, ~taux_chomage,
    "22001", "22", 1, 9, 10, 0.1,
    "22002", "22", 9, 21, 30, 0.3,
    "29001", "29", 5, 15, 20, 0.25,
    "29002", "29", 2, 8, 10, 0.2
  )

  tab <- agreger_chomage_territoires(chomage, base_epci_agregats)

  valeur <- function(code) tab$value[tab$code == code]
  # les communes gardent leur taux
  expect_equal(valeur("22001"), 0.1)
  expect_equal(valeur("22002"), 0.3)
  # EPCI X : (1 + 9) / (10 + 30) = 0,25 — la moyenne des taux (0,2) est fausse
  expect_equal(valeur("200000001"), 10 / 40)
  # EPCI Y : (5 + 2) / (20 + 10) = 7/30
  expect_equal(valeur("200000002"), 7 / 30)
  # département 22 : les deux communes du 22 → 0,25 ; la région : 17/70
  expect_equal(valeur("22"), 10 / 40)
  expect_equal(valeur("29"), 7 / 30)
  expect_equal(valeur("53"), 17 / 70)
  # le taux d'un agrégat n'est JAMAIS la moyenne des taux de ses communes
  expect_false(valeur("200000001") == mean(c(0.1, 0.3)))
})

test_that("chomage : une commune sans taux (actifs non positifs) rend l'agrégat NA", {
  chomage <- tibble::tribble(
    ~commune, ~departement, ~chomeurs, ~actifs_occupes, ~population_active, ~taux_chomage,
    "22001", "22", 1, 9, 10, 0.1,
    "22002", "22", NA_integer_, 0, 0, NA_real_,
    "29001", "29", 5, 15, 20, 0.25,
    "29002", "29", 2, 8, 10, 0.2
  )

  tab <- agreger_chomage_territoires(chomage, base_epci_agregats)

  # le numérateur manquant de 22002 rend le total de l'EPCI X inconnu — NA,
  # jamais une moyenne des seules communes connues (pas de NA silencieux)
  expect_true(is.na(tab$value[tab$code == "200000001"]))
  expect_true(is.na(tab$value[tab$code == "22"]))
  expect_true(is.na(tab$value[tab$code == "53"]))
  expect_equal(tab$value[tab$code == "200000002"], 7 / 30)
})

# 3. Éco-activités : Σ établissements verts ÷ Σ établissements ----------------

test_that("eco_activites : la part d'un agrégat se recalcule depuis les numérateurs", {
  eco <- tibble::tribble(
    ~commune, ~departement, ~n_etablissements, ~n_eco, ~n_eco_100, ~n_eco_partial, ~part_economie_verte,
    "22001", "22", 10, 2, 2, 0, 0.2,
    "22002", "22", 20, 8, 4, 4, 0.4,
    "29001", "29", 30, 3, 3, 0, 0.1,
    "29002", "29", 5, 1, 1, 0, 0.2
  )

  tab <- agreger_eco_territoires(eco, base_epci_agregats)

  valeur <- function(code) tab$value[tab$code == code]
  # les communes gardent leur part
  expect_equal(valeur("22001"), 0.2)
  expect_equal(valeur("22002"), 0.4)
  # EPCI X : (2 + 8) / (10 + 20) = 1/3 — pas la moyenne de (0,2 ; 0,4) = 0,3
  expect_equal(valeur("200000001"), 10 / 30)
  # EPCI Y : (3 + 1) / (30 + 5) = 4/35
  expect_equal(valeur("200000002"), 4 / 35)
  # départements et région
  expect_equal(valeur("22"), 10 / 30)
  expect_equal(valeur("29"), 4 / 35)
  expect_equal(valeur("53"), 14 / 65)
  expect_false(valeur("200000001") == mean(c(0.2, 0.4)))
})

# 4. La LQ même-échelle des agrégats + les histoires multi-lignes -------------

# Le fixture LQ analytique (le même que test-analytics-economie-lq.R) : les
# cellules retenues de 22001 / 29001 / 35001 (56001 sous le plancher), et une
# base des EPCI qui les porte.
fixture_lq_territoires <- function() {
  agrege <- agreger_sirene_par_activite(fixture_lq_analytique())
  appliquer_plancher_communes(agrege)$retenu %>%
    calculer_lq_balassa()
}

base_epci_histoires <- tibble::tribble(
  ~CODGEO, ~LIBGEO, ~EPCI, ~LIBEPCI, ~DEP, ~REG,
  "22001", "Commune A1", "200000001", "EPCI X", "22", "53",
  "29001", "Commune B", "200000001", "EPCI X", "29", "53",
  "35001", "Commune E", "200000002", "EPCI Y", "35", "53",
  "56001", "Commune G", "200000002", "EPCI Y", "56", "53"
)

test_that("histoires : ce-que-la-commune-abrite top-5 par niveau, LQ même-échelle, n conservé", {
  histoires <- construire_histoires_economie_payload(fixture_lq_territoires(),
                                                     base_epci_histoires)

  # la forme : territoire / type / story_key / rang / activité / lq / n / part
  expect_setequal(names(histoires),
                  c("territoire", "type", "story_key", "rang",
                    "activity_code", "activity_label", "lq", "n", "part_parc"))

  abrite <- histoires[histoires$story_key == "ce-que-la-commune-abrite", ]
  ligne <- function(territoire, rang) {
    abrite[abrite$territoire == territoire & abrite$rang == rang, ]
  }

  # la commune 22001 : 47.11Z (1,5) > 86.10Z (1,25) > 01.11Z (0,5) — `n` porté
  expect_equal(ligne("22001", 1)$activity_code, "47.11Z")
  expect_equal(ligne("22001", 1)$lq, 1.5)
  expect_equal(ligne("22001", 1)$n, 3)
  expect_equal(ligne("22001", 3)$activity_code, "01.11Z")
  expect_true(all(abrite$type[abrite$territoire == "22001"] == "commune"))

  # l'EPCI X (22001 + 29001) : sa LQ est MÊME-ÉCHELLE — (6/20)/(12/30) = 0,75
  # sur 01.11Z, jamais la LQ de ses communes (22001 y vaut 0,5). Top : 86.10Z
  # (1,25) > 47.11Z (1,0) > 01.11Z (0,75), n = 10 · 4 · 6.
  expect_equal(ligne("200000001", 1)$activity_code, "86.10Z")
  expect_equal(ligne("200000001", 1)$lq, 1.25)
  expect_equal(ligne("200000001", 1)$n, 10)
  expect_equal(ligne("200000001", 2)$activity_code, "47.11Z")
  expect_equal(ligne("200000001", 3)$activity_code, "01.11Z")
  expect_equal(ligne("200000001", 3)$lq, 0.75)
  expect_true(all(abrite$type[abrite$territoire == "200000001"] == "epci"))

  # l'EPCI Y (35001 seule) : 01.11Z (1,5) > 47.11Z (1,0) > 86.10Z (0,5)
  expect_equal(ligne("200000002", 1)$activity_code, "01.11Z")
  expect_equal(ligne("200000002", 1)$lq, 1.5)

  # le département 22 (22001 seule) : 47.11Z (1,5) > 86.10Z (1,25) > 01.11Z (0,5)
  expect_equal(ligne("22", 1)$activity_code, "47.11Z")
  expect_equal(ligne("22", 2)$activity_code, "86.10Z")
  expect_true(all(abrite$type[abrite$territoire == "22"] == "departement"))

  # la commune sous le plancher (56001) n'a AUCUNE ligne d'Histoire
  expect_false("56001" %in% abrite$territoire)
})

test_that("histoires : la région (53) porte ce-que-la-bretagne-abrite, jamais de Story LQ", {
  histoires <- construire_histoires_economie_payload(fixture_lq_territoires(),
                                                     base_epci_histoires)

  # la région n'a AUCUNE ligne de Story LQ (sa LQ est dégénérée)
  expect_false("53" %in% histoires$territoire[
    histoires$story_key == "ce-que-la-commune-abrite"])
  # ...et porte la lecture de structure : top-5 par présence, n + part du parc
  bretagne <- histoires[histoires$story_key == "ce-que-la-bretagne-abrite", ]
  expect_equal(nrow(bretagne), 3)  # 3 activités du parc < top_n → toutes
  expect_true(all(bretagne$territoire == "53"))
  expect_true(all(bretagne$type == "region"))
  expect_true(all(is.na(bretagne$lq)))
  # parc retenu : 01.11Z = 12 · 47.11Z = 6 · 86.10Z = 12 · total = 30
  expect_equal(bretagne$activity_code, c("01.11Z", "86.10Z", "47.11Z"))
  expect_equal(bretagne$n, c(12, 12, 6))
  expect_equal(bretagne$part_parc, c(12 / 30, 12 / 30, 6 / 30))
})

test_that("histoires : une commune sans EPCI (île) n'agrège à AUCUN niveau EPCI", {
  # Île-de-Bréhat (22016) n'a pas d'EPCI (fix « Sans objet », issue #131) :
  # elle reste commune / département / région, jamais dans un EPCI fantôme
  lq <- tibble::tribble(
    ~commune, ~activity_code, ~activity_label, ~lq, ~n,
    "22016", "A", "Activité A", 2.0, 5,
    "22016", "B", "Activité B", 1.5, 3,
    "22001", "A", "Activité A", 1.0, 2,
    "22001", "B", "Activité B", 1.2, 4
  )
  base <- tibble::tribble(
    ~CODGEO, ~LIBGEO, ~EPCI, ~LIBEPCI, ~DEP, ~REG,
    "22016", "Île-de-Bréhat", NA_character_, NA_character_, "22", "53",
    "22001", "Commune A1", "200000001", "EPCI X", "22", "53"
  )

  histoires <- construire_histoires_economie_payload(lq, base)
  abrite <- histoires[histoires$story_key == "ce-que-la-commune-abrite", ]

  # l'île garde SES lignes d'Histoire (commune), au rang de sa LQ
  expect_true("22016" %in% abrite$territoire)
  expect_equal(abrite$lq[abrite$territoire == "22016" & abrite$rang == 1], 2.0)
  # l'EPCI X n'absorbe QUE 22001 : sa LQ sur A = (2/6)/(2/6) = 1, jamais le
  # mélange avec l'île (qui aurait donné (7/9)/(7/9) = 1 sur A et changé B)
  expect_equal(abrite$lq[abrite$territoire == "200000001" &
                           abrite$activity_code == "A"], 1.0)
  # la commune de l'EPCI X : (2/6)/(2/6) = 1 · B : (4/6)/(4/6) = 1
  expect_equal(abrite$lq[abrite$territoire == "200000001" &
                           abrite$activity_code == "B"], 1.0)
})
