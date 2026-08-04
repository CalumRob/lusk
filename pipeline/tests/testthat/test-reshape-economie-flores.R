# test-reshape-economie-flores ---------------------------------------------------
# Le remodelage de la source Flores du thème Économie/Emploi (plan
# economie-pipeline-contracts, todo 5) : du produit INSEE 8266010 (Flores,
# contrat MANIFEST_ECONOMIE_FLORES) vers DEUX tables longues et creuses
# INDÉPENDANTES — flores_a38 et flores_a88, une par nomenclature agrégée
# NATIVE, jamais fusionnées. Chaque table porte l'enveloppe commune du thème,
# le concept d'emploi au LIEU DE TRAVAIL, la classification native, la tranche
# d'effectifs native (A38 seulement) et le statut d'observation natif. Les
# mini-fixtures (fixtures/flores-a38-fixture.csv, flores-a88-fixture.csv)
# reproduisent le format RÉEL des fichiers 2024 (vérifié en direct le
# 2026-08-04) : 9 colonnes GEO;GEO_OBJECT;ACTIVITY;NUMBER_EMPL;
# LEGAL_FORM_WITH_PUBLIC;FLORES_MEASURE;OBS_STATUS;TIME_PERIOD;OBS_VALUE pour
# A38, 8 colonnes (SANS NUMBER_EMPL) pour A88, séparateur ; et champs entre
# guillemets. Chaque fixture couvre tous les cas du contrat : une commune hors
# Bretagne, un zéro OBSERVÉ (valeur 0, statut A), une cellule non diffusée
# (statut K, valeur vide), une observation d'inclusion (statut W, valeur
# portée), des combinaisons OMISES (absentes du fichier), un autre grain
# (BV2022), une autre période (2017) et une autre forme juridique. Le réseau
# n'entre jamais dans la boucle de test.

# chargement des fixtures : le lecteur PARTAGÉ (lire_csv_long, filter.R) lit
# les vrais fichiers long INSEE — les fixtures doivent donc se lire à
# l'identique.
charger_fixture_flores_a38 <- function() {
  lire_csv_long(testthat::test_path("fixtures", "flores-a38-fixture.csv"))
}

charger_fixture_flores_a88 <- function() {
  lire_csv_long(testthat::test_path("fixtures", "flores-a88-fixture.csv"))
}

# le référentiel breton (lire_epci, déjà filtré Bretagne) — même forme que
# dans les fixtures Démographie/Habitat ; 44001 (Nantes) en est absente
epci_flores_mini <- tibble::tribble(
  ~CODGEO, ~LIBGEO, ~EPCI, ~LIBEPCI, ~DEP, ~REG,
  "22001", "Commune A1", "200000001", "EPCI X", "22", "53",
  "29001", "Commune B", "200000002", "EPCI Y", "29", "53"
)

# les dictionnaires de libellés natifs du produit — les VRAIS libellés du
# fichier de métadonnées (DS_FLORES_*_metadata.csv) pour les codes des
# fixtures ; dans le pipeline réel, lire_dictionnaire_flores() les lit dans le
# fichier au lieu de les coder en dur.
dictionnaire_a38_mini <- c(
  "CA" = paste0("Fabrication de denrées alimentaires, de boissons et de ",
                "produits à base de tabac"),
  "GZ" = "Commerce ; réparation d'automobiles et de motocycles",
  "DZ" = paste0("Production et distribution d'électricité, de gaz, de vapeur ",
                "et d'air conditionné"),
  "_T" = "Total"
)

dictionnaire_a88_mini <- c(
  "11" = "Fabrication de boissons",
  "22" = "Fabrication de produits en caoutchouc et en plastique",
  "45" = "Commerce et réparation d'automobiles et de motocycles",
  "56" = "Restauration",
  "70" = "Activités des sièges sociaux ; conseil de gestion",
  "78" = "Activités liées à l'emploi",
  "96" = "Autres services personnels",
  "_T" = "Total"
)

test_that("le fixture A38 reproduit le vrai format du fichier (9 colonnes, ;, guillemets)", {
  f <- charger_fixture_flores_a38()

  expect_equal(
    names(f),
    c("GEO", "GEO_OBJECT", "ACTIVITY", "NUMBER_EMPL",
      "LEGAL_FORM_WITH_PUBLIC", "FLORES_MEASURE", "OBS_STATUS",
      "TIME_PERIOD", "OBS_VALUE")
  )
  # le fixture contient bien les cas du contrat : une commune hors Bretagne,
  # un zéro observé, une cellule non diffusée (K), une inclusion (W), un autre
  # grain, une autre période et une autre forme juridique
  expect_true("44001" %in% f$GEO)
  expect_true(any(f$OBS_VALUE == 0))
  expect_true(any(f$OBS_STATUS == "K"))
  expect_true(any(f$OBS_STATUS == "W"))
  expect_true(any(f$GEO_OBJECT == "BV2022"))
  expect_true(any(f$TIME_PERIOD == 2017))
  expect_true(any(f$LEGAL_FORM_WITH_PUBLIC == "2AAAA"))
})

test_that("le fixture A88 reproduit le vrai format du fichier (8 colonnes, sans tranche)", {
  f <- charger_fixture_flores_a88()

  expect_equal(
    names(f),
    c("GEO", "GEO_OBJECT", "ACTIVITY", "LEGAL_FORM_WITH_PUBLIC",
      "FLORES_MEASURE", "OBS_STATUS", "TIME_PERIOD", "OBS_VALUE")
  )
  # pas de dimension tranche d'effectifs dans les fichiers A88
  expect_false("NUMBER_EMPL" %in% names(f))
  # les cas du contrat sont couverts, comme pour A38
  expect_true("44001" %in% f$GEO)
  expect_true(any(f$OBS_VALUE == 0))
  expect_true(any(f$OBS_STATUS == "K"))
  expect_true(any(f$OBS_STATUS == "W"))
  expect_true(any(f$GEO_OBJECT == "BV2022"))
  expect_true(any(f$TIME_PERIOD == 2017))
  expect_true(any(f$LEGAL_FORM_WITH_PUBLIC == "2AAAA"))
})

test_that("pivoter_flores_a38 : une ligne par commune × poste × tranche × mesure, les totaux = les sommes", {
  p <- pivoter_flores_a38(charger_fixture_flores_a38())

  # 22001 : 21 lignes du contrat (les lignes BV2022 / 2017 / autre forme
  # juridique tombent au pivot) ; 29001 : 16 ; la non-bretonne 44001 : 8 —
  # elle reste au pivot, le filtre Bretagne agit à la jointure (même pattern
  # qu'Habitat / RP)
  expect_equal(nrow(p), 45)
  expect_setequal(unique(p$commune), c("22001", "29001", "44001"))
  expect_setequal(unique(p$measure), c("etablissements", "effectifs_salaries"))
  expect_true(all(p$statut_observation %in% c("A", "K", "W")))

  a <- p[p$commune == "22001", ]
  # les valeurs du poste CA (statut A) : les tranches sommées = le total CA
  ca <- a[a$activity_code == "CA" & a$statut_observation == "A", ]
  expect_equal(
    sum(ca$value[ca$measure == "etablissements" & ca$tranche_effectifs != "_T"]),
    ca$value[ca$measure == "etablissements" & ca$tranche_effectifs == "_T"]
  )
  expect_equal(
    sum(ca$value[ca$measure == "effectifs_salaries" & ca$tranche_effectifs != "_T"]),
    ca$value[ca$measure == "effectifs_salaries" & ca$tranche_effectifs == "_T"]
  )
  # le total général (statut A) : la somme des postes HORS lignes totales (la
  # tranche _T et le poste _T portent déjà les agrégats) = la ligne activité _T
  # × tranche _T
  tot <- a[a$activity_code == "_T" & a$tranche_effectifs == "_T" &
             a$statut_observation == "A", ]
  expect_equal(
    sum(a$value[a$activity_code != "_T" & a$tranche_effectifs != "_T" &
                a$statut_observation == "A" & a$measure == "etablissements"]),
    tot$value[tot$measure == "etablissements"]
  )
  expect_equal(
    sum(a$value[a$activity_code != "_T" & a$tranche_effectifs != "_T" &
                a$statut_observation == "A" & a$measure == "effectifs_salaries"]),
    tot$value[tot$measure == "effectifs_salaries"]
  )
  # la tranche E0 (0 salarié) porte des établissements mais PAS d'effectifs
  # salariés (rien à mesurer) — la ligne effectifs est omise, jamais zéro
  expect_true(any(a$tranche_effectifs == "E0" & a$measure == "etablissements"))
  expect_false(any(a$tranche_effectifs == "E0" & a$measure == "effectifs_salaries"))
})

test_that("pivoter_flores_a38 : les cellules non diffusées, les zéros et les omissions restent distinguables", {
  p <- pivoter_flores_a38(charger_fixture_flores_a38())
  a <- p[p$commune == "22001", ]

  # cellule non diffusée (statut K) : présente dans la table, valeur NA et
  # statut "K" — JAMAIS convertie en zéro observé
  k <- a[a$activity_code == "GZ" & a$tranche_effectifs == "E5T9" &
           a$measure == "etablissements", ]
  expect_equal(nrow(k), 1)
  expect_equal(k$statut_observation, "K")
  expect_true(is.na(k$value))

  # zéro OBSERVÉ (statut A, valeur 0) : gardé tel quel, distinguable de la
  # cellule non diffusée (NA) et de la cellule omise (absente)
  z <- a[a$activity_code == "CA" & a$tranche_effectifs == "E50T99" &
           a$measure == "effectifs_salaries", ]
  expect_equal(nrow(z), 1)
  expect_equal(z$statut_observation, "A")
  expect_equal(z$value, 0)

  # observation d'inclusion (statut W) : gardée avec SA valeur et SON statut
  w <- a[a$activity_code == "DZ" & a$measure == "effectifs_salaries", ]
  expect_equal(nrow(w), 1)
  expect_equal(w$statut_observation, "W")
  expect_equal(w$value, 45)

  # combinaisons omises : absentes du fichier → absentes de la table (creuse),
  # jamais complétées par un zéro
  expect_false(any(a$activity_code == "DZ" & a$measure == "etablissements"))
  expect_false(any(a$tranche_effectifs == "E50T99" &
                   a$measure == "etablissements"))
  b <- p[p$commune == "29001", ]
  expect_false(any(b$activity_code == "DZ"))
  expect_false(any(b$tranche_effectifs == "E0"))
})

test_that("pivoter_flores_a88 : une ligne par commune × division × mesure, le total = la somme", {
  p <- pivoter_flores_a88(charger_fixture_flores_a88())

  # 22001 : 14 lignes du contrat ; 29001 : 8 ; 44001 : 3 (filtrée plus tard)
  expect_equal(nrow(p), 25)
  expect_setequal(unique(p$commune), c("22001", "29001", "44001"))
  expect_setequal(unique(p$measure), c("etablissements", "effectifs_salaries"))

  a <- p[p$commune == "22001", ]
  # le total (statut A) : la somme des divisions = la ligne activité _T
  expect_equal(
    sum(a$value[a$activity_code != "_T" & a$statut_observation == "A" &
                a$measure == "etablissements"]),
    a$value[a$activity_code == "_T" & a$measure == "etablissements"]
  )
  expect_equal(
    sum(a$value[a$activity_code != "_T" & a$statut_observation == "A" &
                a$measure == "effectifs_salaries"]),
    a$value[a$activity_code == "_T" & a$measure == "effectifs_salaries"]
  )
})

test_that("pivoter_flores_a88 : les cellules non diffusées, les zéros et les omissions restent distinguables", {
  p <- pivoter_flores_a88(charger_fixture_flores_a88())
  a <- p[p$commune == "22001", ]

  # cellule non diffusée (statut K) : valeur NA + statut "K", pas un zéro
  k <- a[a$activity_code == "96" & a$measure == "effectifs_salaries", ]
  expect_equal(nrow(k), 1)
  expect_equal(k$statut_observation, "K")
  expect_true(is.na(k$value))

  # zéro observé (statut A) : gardé, distinct de la cellule non diffusée
  z <- a[a$activity_code == "78" & a$measure == "etablissements", ]
  expect_equal(nrow(z), 1)
  expect_equal(z$statut_observation, "A")
  expect_equal(z$value, 0)

  # observation d'inclusion (statut W) : gardée avec sa valeur et son statut
  w <- a[a$activity_code == "22" & a$measure == "etablissements", ]
  expect_equal(nrow(w), 1)
  expect_equal(w$statut_observation, "W")
  expect_equal(w$value, 3)

  # la division 78 n'a pas de ligne effectifs (omise) ; 22001 a la division 45,
  # 29001 non — la table reste creuse, rien n'est complété par un zéro
  expect_false(any(a$activity_code == "78" & a$measure == "effectifs_salaries"))
  b <- p[p$commune == "29001", ]
  expect_false(any(b$activity_code == "45"))
  expect_false(any(b$activity_code == "78"))
})

test_that("assembler_flores_a38 : l'enveloppe du contrat, Bretagne seulement, aucun code NAF", {
  b <- assembler_flores_a38(
    pivoter_flores_a38(charger_fixture_flores_a38()),
    epci_flores_mini, dictionnaire_a38_mini
  )

  # une ligne par commune bretonne × poste × tranche × mesure ; 44001 (Nantes)
  # éliminée à la jointure avec le référentiel breton
  expect_equal(nrow(b), 37)
  expect_false("44001" %in% b$commune)
  expect_setequal(b$departement, c("22", "29"))

  # l'enveloppe exacte du contrat : commune | activity_code | activity_label |
  # value | measure | source | vintage, plus le concept, la classification, la
  # tranche d'effectifs native et le statut d'observation
  expect_named(b, c("commune", "departement", "concept", "classification",
                    "activity_code", "activity_label", "tranche_effectifs",
                    "tranche_libelle", "measure", "value",
                    "statut_observation", "source", "vintage"))

  # aucun code NAF ni table de passage — ni colonne, ni libellé, ni étiquette
  expect_false(any(grepl("naf|crosswalk|sirene", names(b), ignore.case = TRUE)))
  expect_true(all(b$activity_code %in% c("CA", "GZ", "DZ", "_T")))
  expect_false(any(grepl("^[0-9]{4,5}$", b$activity_code))) # pas d'APET NAF

  # le concept : l'emploi au LIEU DE TRAVAIL, partout — jamais résidence
  expect_true(all(b$concept == CONCEPT_FLORES))
  expect_false(any(grepl("résidence", b$concept, ignore.case = TRUE)))

  # la classification native : A38 partout
  expect_true(all(b$classification == "A38"))

  # les libellés natifs du dictionnaire du produit
  expect_equal(
    b$activity_label[b$commune == "22001" & b$activity_code == "GZ"][1],
    "Commerce ; réparation d'automobiles et de motocycles"
  )
  expect_equal(
    b$tranche_libelle[b$commune == "22001" &
                       b$tranche_effectifs == "E_GE500"][1],
    NA_character_
  )
  expect_equal(
    b$tranche_libelle[b$commune == "22001" &
                       b$tranche_effectifs == "E1T4"][1],
    "1 à 4 salariés"
  )

  # la provenance : la source et le millésime du manifeste
  expect_true(all(b$source == "flores_a38"))
  expect_true(all(b$vintage == "2024"))

  # les mesures portent le vocabulaire du manifeste (mesures =
  # "etablissements;effectifs_salaries")
  expect_setequal(unique(b$measure), c("etablissements", "effectifs_salaries"))

  # tri déterministe : commune puis poste natif puis tranche puis mesure
  expect_equal(b$commune, sort(b$commune))
  expect_equal(
    b$activity_code[b$commune == "22001"],
    sort(b$activity_code[b$commune == "22001"])
  )
})

test_that("assembler_flores_a88 : l'enveloppe du contrat sans tranche, Bretagne seulement", {
  b <- assembler_flores_a88(
    pivoter_flores_a88(charger_fixture_flores_a88()),
    epci_flores_mini, dictionnaire_a88_mini
  )

  expect_equal(nrow(b), 22)
  expect_false("44001" %in% b$commune)
  expect_setequal(b$departement, c("22", "29"))

  # PAS de colonne de tranche d'effectifs (les fichiers A88 ne sont pas
  # déclinés par tranche) — la dimension est absente, jamais remplie de NA
  expect_named(b, c("commune", "departement", "concept", "classification",
                    "activity_code", "activity_label", "measure", "value",
                    "statut_observation", "source", "vintage"))
  expect_false(any(grepl("tranche", names(b), ignore.case = TRUE)))

  # aucun code NAF ni table de passage
  expect_false(any(grepl("naf|crosswalk|sirene", names(b), ignore.case = TRUE)))
  expect_true(all(b$activity_code %in% c("11", "22", "45", "56", "70",
                                         "78", "96", "_T")))

  # le concept : lieu de travail, jamais résidence ; classification A88
  expect_true(all(b$concept == CONCEPT_FLORES))
  expect_false(any(grepl("résidence", b$concept, ignore.case = TRUE)))
  expect_true(all(b$classification == "A88"))

  # les libellés natifs du dictionnaire du produit
  expect_equal(
    b$activity_label[b$commune == "22001" & b$activity_code == "11"][1],
    "Fabrication de boissons"
  )
  expect_equal(
    b$activity_label[b$commune == "29001" & b$activity_code == "56"][1],
    "Restauration"
  )

  # la provenance : source et millésime du manifeste
  expect_true(all(b$source == "flores_a88"))
  expect_true(all(b$vintage == "2024"))

  # tri déterministe
  expect_equal(b$commune, sort(b$commune))
})

test_that("normaliser_flores : les deux nomenclatures restent des tables SÉPARÉES", {
  a38 <- normaliser_flores_a38(charger_fixture_flores_a38(),
                               epci_flores_mini, dictionnaire_a38_mini)
  a88 <- normaliser_flores_a88(charger_fixture_flores_a88(),
                               epci_flores_mini, dictionnaire_a88_mini)

  # deux tables distinctes, jamais une ligne « Flores » fusionnée
  expect_s3_class(a38$table, "tbl_df")
  expect_s3_class(a88$table, "tbl_df")
  expect_setequal(unique(a38$table$classification), "A38")
  expect_setequal(unique(a88$table$classification), "A88")
  expect_setequal(unique(a38$table$source), "flores_a38")
  expect_setequal(unique(a88$table$source), "flores_a88")

  # la tranche d'effectifs est native de A38 et ABSENTE de A88
  expect_true("tranche_effectifs" %in% names(a38$table))
  expect_false("tranche_effectifs" %in% names(a88$table))

  # les cellules non diffusées survivent aux deux normalisations, marquées
  expect_true(any(a38$table$statut_observation == "K"))
  expect_true(any(a88$table$statut_observation == "K"))
  expect_true(all(is.na(a38$table$value[a38$table$statut_observation == "K"])))
  expect_true(all(is.na(a88$table$value[a88$table$statut_observation == "K"])))
})

test_that("rapport_exclusions_flores : la géographie invalide et les lignes hors contrat sont rapportées", {
  f <- charger_fixture_flores_a88()
  r <- rapport_exclusions_flores(f, epci_flores_mini)

  # la commune hors Bretagne (44001) est exclue de la table... et rapportée
  b <- assembler_flores_a88(pivoter_flores_a88(f), epci_flores_mini,
                            dictionnaire_a88_mini)
  expect_false("44001" %in% b$commune)
  expect_true("44001" %in% r$commune)
  expect_true(any(grepl("Bretagne", r$motif[r$commune == "44001"])))

  # la période hors contrat (2017) et la forme juridique hors contrat (2AAAA)
  # sont rapportées, avec la raison — jamais réinterprétées
  expect_true(any(grepl("période hors contrat", r$motif)))
  expect_true(any(grepl("forme juridique hors contrat", r$motif)))

  # le grain BV2022 n'est PAS une exclusion : ce n'est pas le grain commune,
  # la table communale ne le concerne pas (même convention que Démographie)
  expect_false(any(grepl("BV2022", r$motif)))

  # toutes les communes conservées joignent le référentiel breton
  expect_true(all(b$commune %in% epci_flores_mini$CODGEO))
  # aucune valeur de la non-bretonne ne subsiste (50, 30, 80)
  expect_false(any(b$value %in% c(50, 30, 80)))
})
