# test-reshape-economie-rp ------------------------------------------------------
# Le remodelage de la source RP Emploi du thème Économie/Emploi (plan
# economie-pipeline-contracts, todo 6) : du fichier long INSEE harmonisé
# « Activité des résidents » (DS_RP_TD_ACTIVITE_PCSACTIVITY_COMP — les tables
# ACT4/ACT5 du dossier complet, contrat MANIFEST_ECONOMIE_RP) vers la table de
# validation « rp_emploi » : une ligne longue et creuse par commune bretonne ×
# secteur d'activité économique NATIF du RP, portant l'enveloppe commune du
# thème et le concept d'emploi au lieu de RÉSIDENCE. Le mini-fixture
# (fixtures/rp-emploi-fixture.csv) reproduit le format RÉEL du fichier — 12
# colonnes GEO;GEO_OBJECT;SEX;AGE;EMPSTA_ENQ;PCS;EMP_ACTIVITY;RP_MEASURE;
# FREQ;OBS_STATUS;TIME_PERIOD;OBS_VALUE, séparateur ; et champs entre
# guillemets (vérifié sur le fichier 2023) — et couvre tous les cas du
# contrat. Le réseau n'entre jamais dans la boucle de test.

# chargement du fixture : le lecteur PARTAGÉ (lire_csv_long, filter.R) lit les
# vrais fichiers long INSEE — le fixture doit donc se lire à l'identique.
charger_fixture_emploi_rp <- function() {
  lire_csv_long(testthat::test_path("fixtures", "rp-emploi-fixture.csv"))
}

# le référentiel breton (lire_epci, déjà filtré Bretagne) — même forme que
# dans les fixtures Démographie/Habitat ; 44001 (Nantes) en est absente
epci_emploi_mini <- tibble::tribble(
  ~CODGEO, ~LIBGEO, ~EPCI, ~LIBEPCI, ~DEP, ~REG,
  "22001", "Commune A1", "200000001", "EPCI X", "22", "53",
  "29001", "Commune B", "200000002", "EPCI Y", "29", "53"
)

test_that("le fixture reproduit le vrai format du fichier (12 colonnes, ;, guillemets)", {
  f <- charger_fixture_emploi_rp()

  expect_equal(
    names(f),
    c("GEO", "GEO_OBJECT", "SEX", "AGE", "EMPSTA_ENQ", "PCS",
      "EMP_ACTIVITY", "RP_MEASURE", "FREQ", "OBS_STATUS",
      "TIME_PERIOD", "OBS_VALUE")
  )
  # le fixture contient bien les cas du contrat : une commune hors Bretagne,
  # une mesure d'emploi au lieu de travail, des lignes détaillées et des
  # doublons d'inclusion
  expect_true("44001" %in% f$GEO)
  expect_true("EMPLT" %in% f$RP_MEASURE)
  expect_true(any(f$SEX == "F"))
  expect_true(any(f$AGE == "Y25T29"))
  expect_true(any(f$PCS == "3"))
  expect_true(any(f$OBS_STATUS == "K"))
  expect_true(any(f$GEO_OBJECT == "BV2022"))
  expect_true(any(f$TIME_PERIOD == 2017))
})

test_that("pivoter_emploi_rp : une ligne par commune × secteur natif, le total = la somme des secteurs", {
  p <- pivoter_emploi_rp(charger_fixture_emploi_rp())

  # 22001 et 29001 × 6 lignes (les 5 secteurs natifs + le total _T), plus les
  # 3 lignes de la non-bretonne 44001 qui reste au pivot (le filtre Bretagne
  # agit à la jointure avec le référentiel, plus tard — même pattern qu'Habitat)
  expect_equal(nrow(p), 15)
  expect_setequal(unique(p$commune), c("22001", "29001", "44001"))
  expect_setequal(p$activity_code, c("AZ", "BE", "FZ", "GU", "OQ", "_T"))

  # valeurs de 22001 ; le total _T = la somme des 5 secteurs natifs (cohérence
  # structurelle du fichier, vérifiée sur le fichier réel : 284.77368 = 60.69 +
  # 30.25 + 25.44 + 87.17 + 81.23)
  a <- p[p$commune == "22001", ]
  expect_equal(a$value[a$activity_code == "AZ"], 60.7)
  expect_equal(a$value[a$activity_code == "BE"], 30.2)
  expect_equal(a$value[a$activity_code == "FZ"], 25.4)
  expect_equal(a$value[a$activity_code == "GU"], 87.2)
  expect_equal(a$value[a$activity_code == "OQ"], 81.2)
  expect_equal(a$value[a$activity_code == "_T"], 284.7)
  expect_equal(
    sum(a$value[a$activity_code != "_T"]),
    a$value[a$activity_code == "_T"]
  )

  # mêmes cohérences pour 29001
  b <- p[p$commune == "29001", ]
  expect_equal(
    sum(b$value[b$activity_code != "_T"]),
    b$value[b$activity_code == "_T"]
  )
})

test_that("pivoter_emploi_rp : seules les lignes totales du contrat sont gardées", {
  p <- pivoter_emploi_rp(charger_fixture_emploi_rp())

  # les lignes détaillées (SEX F, AGE Y25T29, PCS 3), les bassins de vie, les
  # doublons d'inclusion (K), les autres millésimes et l'emploi au lieu de
  # travail (EMPLT) tombent au pivot
  expect_false(any(p$value == 3.5))     # SEX = F
  expect_false(any(p$value == 10.0))    # AGE = Y25T29
  expect_false(any(p$value == 20.0))    # PCS = 3
  expect_false(any(p$value == 555.0))   # BV2022
  expect_false(any(p$value == 99999.0)) # OBS_STATUS = K
  expect_false(any(p$value == 100.0))   # TIME_PERIOD = 2017
  expect_false(any(p$value == 9999.0))  # RP_MEASURE = EMPLT (lieu de travail)
})

test_that("assembler_emploi_rp : l'enveloppe du contrat, Bretagne seulement, aucune colonne Flores/SIRENE", {
  b <- assembler_emploi_rp(
    pivoter_emploi_rp(charger_fixture_emploi_rp()), epci_emploi_mini
  )

  # une ligne par commune bretonne × secteur ; 44001 (Nantes) éliminée à la
  # jointure avec le référentiel breton
  expect_equal(nrow(b), 12)
  expect_false("44001" %in% b$commune)
  expect_setequal(b$departement, c("22", "29"))

  # l'enveloppe exacte du contrat : commune | activity_code | activity_label |
  # value | measure | source | vintage, plus le concept résident et le
  # département (la Bretagne des lignes conservées, portée par le référentiel)
  expect_named(b, c("commune", "departement", "concept", "activity_code",
                    "activity_label", "value", "measure", "source", "vintage"))

  # aucune colonne Flores (flores_a38 / flores_a88) ni SIRENE
  expect_false(any(grepl("flores|sirene|a38|a88", names(b), ignore.case = TRUE)))

  # le concept : l'emploi au lieu de RÉSIDENCE, partout — jamais lieu de travail
  expect_true(all(b$concept == CONCEPT_RP_EMPLOI))
  expect_false(any(grepl("lieu de travail", b$concept)))

  # les libellés natifs du dictionnaire du fichier
  expect_equal(
    b$activity_label[b$commune == "22001" & b$activity_code == "AZ"],
    "Agriculture, sylviculture et pêche"
  )
  expect_equal(
    b$activity_label[b$commune == "29001" & b$activity_code == "OQ"],
    "Administration publique, enseignement, santé humaine et action sociale"
  )

  # la provenance : la source et le millésime du manifeste
  expect_true(all(b$source == "rp_emploi"))
  expect_true(all(b$vintage == "2023"))

  # tri déterministe : commune puis secteur natif
  expect_equal(b$commune, sort(b$commune))
  expect_equal(
    b$activity_code[b$commune == "22001"],
    c("AZ", "BE", "FZ", "GU", "OQ", "_T")
  )
})

test_that("les lignes d'emploi au lieu de travail sont exclues, jamais réinterprétées", {
  f <- charger_fixture_emploi_rp()
  b <- normaliser_emploi_rp(f, epci_emploi_mini)$table

  # la ligne EMPLT (emploi au lieu de travail, 9999.0) n'apparaît pas dans la
  # table — exclue au pivot par la borne de la mesure résidente
  expect_false(any(b$value == 9999.0))
  # le concept porté est LE concept résident constant — rien d'autre : la
  # table ne réinterprète jamais une ligne lieu de travail en emploi résident
  expect_setequal(unique(b$concept), CONCEPT_RP_EMPLOI)

  # le rapport la signale comme exclue, avec la raison
  r <- rapport_exclusions_emploi_rp(f, epci_emploi_mini)
  expect_true("22001" %in% r$commune)
  expect_true(any(grepl("EMPLT", r$motif)))
  expect_true(any(grepl("lieu de travail", r$motif)))
})

test_that("la géographie invalide est rapportée et exclue", {
  resultat <- normaliser_emploi_rp(charger_fixture_emploi_rp(), epci_emploi_mini)

  # la commune hors Bretagne (44001) est exclue de la table...
  expect_false("44001" %in% resultat$table$commune)
  # ...et rapportée, avec la raison
  expect_true("44001" %in% resultat$exclusions$commune)
  expect_true(any(grepl("Bretagne", resultat$exclusions$motif[
    resultat$exclusions$commune == "44001"
  ])))

  # toutes les communes conservées joignent le référentiel breton
  expect_true(all(resultat$table$commune %in% epci_emploi_mini$CODGEO))
  # aucune valeur de la non-bretonne ne subsiste (AZ 50.0, BE 150.0, _T 200.0)
  expect_false(any(resultat$table$value %in% c(50.0, 150.0, 200.0)))
})
