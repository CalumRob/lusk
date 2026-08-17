# Le remodelage : des fichiers longs INSEE vers la forme du contrat (le
# fixture). Les mini-fixtures ci-dessous reproduisent le format réel des
# fichiers (colonnes GEO/GEO_OBJECT/.../OBS_VALUE, séparateur ; dans les
# vrais fichiers) ; les pivots ne lisent que les colonnes utiles.

serie_mini <- tibble::tribble(
  ~GEO, ~GEO_OBJECT, ~RP_MEASURE, ~OBS_STATUS, ~TIME_PERIOD, ~OBS_VALUE,
  "22001", "COM", "POP", "A", 1968, 1500,
  "22001", "COM", "POP", "K", 1968, 222833, # doublon d'inclusion : ignoré
  "22001", "BV2022", "POP", "A", 1968, 333333, # même code, bassin de vie : ignoré
  "22001", "COM", "POP", "A", 2017, 1900,
  "22001", "COM", "POP", "A", 2023, 2000,
  "22001", "COM", "SUP", "A", 2023, 10,
  "22001", "COM", "BRTH", "A", 2023, 150,
  "22001", "COM", "DEATH", "A", 2023, 80,
  "29001", "COM", "POP", "A", 1968, 2400,
  "29001", "COM", "POP", "A", 2017, 2600,
  "29001", "COM", "POP", "A", 2023, 3000,
  "29001", "COM", "SUP", "A", 2023, 20,
  "29001", "COM", "BRTH", "A", 2023, 120,
  "29001", "COM", "DEATH", "A", 2023, 100,
  "44001", "COM", "POP", "A", 2023, 500, # non-bretonne : éliminée à la jointure
  "44001", "COM", "SUP", "A", 2023, 5
)

menages_mini <- tibble::tribble(
  ~GEO, ~GEO_OBJECT, ~RP_MEASURE, ~OCS, ~TPH, ~PCS, ~OBS_STATUS, ~TIME_PERIOD, ~OBS_VALUE,
  "22001", "COM", "DWELLINGS", "DW_MAIN", "_T", "_T", "A", 2023, 850,
  "22001", "COM", "DWELLINGS", "DW_MAIN", "11", "1", "A", 2023, 300, # détail : ignoré
  "22001", "COM", "DWELLINGS_POPSIZE", "DW_MAIN", "_T", "_T", "A", 2023, 1950,
  "29001", "COM", "DWELLINGS", "DW_MAIN", "_T", "_T", "A", 2023, 1400,
  "29001", "COM", "DWELLINGS_POPSIZE", "DW_MAIN", "_T", "_T", "A", 2023, 2920
)

age_mini <- tibble::tribble(
  ~GEO, ~GEO_OBJECT, ~SEX, ~AGE, ~OBS_STATUS, ~TIME_PERIOD, ~OBS_VALUE,
  "22001", "COM", "F", "Y_LT15", "A", 2023, 204,
  "22001", "COM", "M", "Y_LT15", "A", 2023, 196,
  "22001", "COM", "F", "Y15T24", "A", 2023, 128,
  "22001", "COM", "M", "Y15T24", "A", 2023, 122,
  "22001", "COM", "F", "Y25T39", "A", 2023, 179,
  "22001", "COM", "M", "Y25T39", "A", 2023, 171,
  "22001", "COM", "F", "Y40T54", "A", 2023, 230,
  "22001", "COM", "M", "Y40T54", "A", 2023, 220,
  "22001", "COM", "F", "Y55T64", "A", 2023, 128,
  "22001", "COM", "M", "Y55T64", "A", 2023, 122,
  "22001", "COM", "F", "Y65T79", "A", 2023, 102,
  "22001", "COM", "M", "Y65T79", "A", 2023, 98,
  "22001", "COM", "F", "Y_GE80", "A", 2023, 51,
  "22001", "COM", "M", "Y_GE80", "A", 2023, 49,
  "22001", "COM", "_T", "Y_LT20", "A", 2023, 500,
  "22001", "COM", "_T", "_T", "A", 2023, 2000, # total : pas une tranche, ignoré
  "29001", "COM", "F", "Y_LT15", "A", 2023, 255,
  "29001", "COM", "M", "Y_LT15", "A", 2023, 245,
  "29001", "COM", "F", "Y15T24", "A", 2023, 204,
  "29001", "COM", "M", "Y15T24", "A", 2023, 196,
  "29001", "COM", "F", "Y25T39", "A", 2023, 281,
  "29001", "COM", "M", "Y25T39", "A", 2023, 269,
  "29001", "COM", "F", "Y40T54", "A", 2023, 306,
  "29001", "COM", "M", "Y40T54", "A", 2023, 294,
  "29001", "COM", "F", "Y55T64", "A", 2023, 204,
  "29001", "COM", "M", "Y55T64", "A", 2023, 196,
  "29001", "COM", "F", "Y65T79", "A", 2023, 179,
  "29001", "COM", "M", "Y65T79", "A", 2023, 171,
  "29001", "COM", "F", "Y_GE80", "A", 2023, 102,
  "29001", "COM", "M", "Y_GE80", "A", 2023, 98,
  "29001", "COM", "_T", "Y_LT20", "A", 2023, 700
)

epci_mini <- tibble::tribble(
  ~CODGEO, ~LIBGEO, ~EPCI, ~LIBEPCI, ~DEP, ~REG,
  "22001", "Commune A1", "200000001", "EPCI X", "22", "53",
  "29001", "Commune B", "200000002", "EPCI Y", "29", "53"
)

test_that("pivoter_serie : une ligne par commune, colonnes du contrat", {
  p <- pivoter_serie(serie_mini)

  expect_setequal(names(p), c("GEO", "population", "population_1968",
                              "population_precedente", "superficie_km2",
                              "naissances", "deces"))
  expect_equal(p$population[p$GEO == "22001"], 2000)
  expect_equal(p$population_1968[p$GEO == "22001"], 1500)
  expect_equal(p$population_precedente[p$GEO == "22001"], 1900)
  expect_equal(p$superficie_km2[p$GEO == "22001"], 10)
  expect_equal(p$naissances[p$GEO == "22001"], 150)
  expect_equal(p$deces[p$GEO == "22001"], 80)
  expect_equal(nrow(p), 3) # y compris la non-bretonne (filtrée plus tard)
})

test_that("pivoter_menages : ménages et population des ménages", {
  m <- pivoter_menages(menages_mini)

  expect_setequal(names(m), c("GEO", "menages", "population_menages"))
  expect_equal(m$menages[m$GEO == "22001"], 850)
  expect_equal(m$population_menages[m$GEO == "22001"], 1950)
})

test_that("pivoter_age : les 7 tranches × 2 sexes + l'agrégat moins de 20 ans", {
  a <- pivoter_age(age_mini)

  expect_setequal(names(a), c("GEO", "age_lt15", "age_15_24", "age_25_39",
                              "age_40_54", "age_55_64", "age_65_79",
                              "age_80_plus", "age_lt20",
                              "age_lt15_F", "age_15_24_F", "age_25_39_F",
                              "age_40_54_F", "age_55_64_F", "age_65_79_F",
                              "age_80_plus_F", "age_lt15_M", "age_15_24_M",
                              "age_25_39_M", "age_40_54_M", "age_55_64_M",
                              "age_65_79_M", "age_80_plus_M"))
  # totaux dérivés (F + M)
  expect_equal(a$age_lt15[a$GEO == "22001"], 400)
  expect_equal(a$age_lt20[a$GEO == "22001"], 500)
  # par sexe
  expect_equal(a$age_lt15_F[a$GEO == "22001"], 204)
  expect_equal(a$age_lt15_M[a$GEO == "22001"], 196)
  expect_equal(a$age_80_plus_F[a$GEO == "29001"], 102)
  expect_equal(a$age_80_plus_M[a$GEO == "29001"], 98)
})

# La garde de complétude de la SOURCE (issue #390) ------------------------------
# Le pivot ne fabrique une colonne que pour les couples (AGE, SEX) réellement
# OBSERVÉS : si la source réelle perd une tranche ou un sexe, la colonne manque
# tout simplement. Sans garde, la pyramide se publierait amputée (ou pire,
# échouerait plus tard sur un message d'outil illisible). Ces cas se testent
# entièrement sur la mini-fixture synthétique — aucune donnée réelle requise.

test_that("pivoter_age : un SEXE manquant sur une tranche -> erreur nommée", {
  # la source perd les hommes de 80 ans et plus
  tronquee <- age_mini[!(age_mini$SEX == "M" & age_mini$AGE == "Y_GE80"), ]

  expect_error(pivoter_age(tronquee), "Source PRINC incompl")
  expect_error(pivoter_age(tronquee), "Y_GE80_M")
})

test_that("pivoter_age : une TRANCHE entièrement absente (ses deux sexes) -> erreur nommée", {
  tronquee <- age_mini[age_mini$AGE != "Y55T64", ]

  expect_error(pivoter_age(tronquee), "Y55T64_F")
  expect_error(pivoter_age(tronquee), "Y55T64_M")
})

test_that("pivoter_age : une tranche écartée par son statut (OBS_STATUS != « A ») -> erreur, jamais un trou muet", {
  # le piège réaliste : la donnée EXISTE dans le fichier mais son statut la
  # rend inutilisable — le filtre la retire, la colonne disparaît. La garde
  # doit parler, pas laisser publier une pyramide à six étages.
  provisoire <- age_mini
  provisoire$OBS_STATUS[provisoire$AGE == "Y25T39"] <- "P"

  expect_error(pivoter_age(provisoire), "Y25T39_F")
})

test_that("pivoter_age : l'agrégat des moins de 20 ans absent -> erreur (le rang scalaire en dépend)", {
  sans_lt20 <- age_mini[age_mini$AGE != "Y_LT20", ]

  expect_error(pivoter_age(sans_lt20), "moins de 20 ans")
})

test_that("assembler_communes : la forme du contrat, Bretagne seulement", {
  brut <- assembler_communes(
    pivoter_serie(serie_mini),
    pivoter_menages(menages_mini),
    pivoter_age(age_mini),
    epci_mini
  )

  expect_setequal(brut$code, c("22001", "29001")) # 44001 éliminée
  expect_setequal(brut$nom, c("Commune A1", "Commune B"))
  expect_setequal(brut$departement, c("22", "29"))
  expect_setequal(brut$epci, c("200000001", "200000002"))
  expect_equal(brut$population[brut$code == "22001"], 2000)
  expect_equal(brut$menages[brut$code == "22001"], 850)
  expect_equal(brut$population_menages[brut$code == "22001"], 1950)
  expect_equal(brut$age_lt20[brut$code == "22001"], 500)
  expect_true(all(c("age_lt15", "age_65_79", "naissances", "deces") %in% names(brut)))
})
