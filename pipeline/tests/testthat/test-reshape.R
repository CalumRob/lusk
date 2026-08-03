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
  "22001", "COM", "_T", "Y_LT15", "A", 2023, 400,
  "22001", "COM", "_T", "Y15T24", "A", 2023, 250,
  "22001", "COM", "_T", "Y25T39", "A", 2023, 350,
  "22001", "COM", "_T", "Y40T54", "A", 2023, 450,
  "22001", "COM", "_T", "Y55T64", "A", 2023, 250,
  "22001", "COM", "_T", "Y65T79", "A", 2023, 200,
  "22001", "COM", "_T", "Y_GE80", "A", 2023, 100,
  "22001", "COM", "_T", "Y_LT20", "A", 2023, 500,
  "22001", "COM", "_T", "_T", "A", 2023, 2000, # total : pas une tranche, ignoré
  "29001", "COM", "_T", "Y_LT15", "A", 2023, 500,
  "29001", "COM", "_T", "Y15T24", "A", 2023, 400,
  "29001", "COM", "_T", "Y25T39", "A", 2023, 550,
  "29001", "COM", "_T", "Y40T54", "A", 2023, 600,
  "29001", "COM", "_T", "Y55T64", "A", 2023, 400,
  "29001", "COM", "_T", "Y65T79", "A", 2023, 350,
  "29001", "COM", "_T", "Y_GE80", "A", 2023, 200,
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

test_that("pivoter_age : les 7 tranches + l'agrégat moins de 20 ans", {
  a <- pivoter_age(age_mini)

  expect_setequal(names(a), c("GEO", "age_lt15", "age_15_24", "age_25_39",
                              "age_40_54", "age_55_64", "age_65_79",
                              "age_80_plus", "age_lt20"))
  expect_equal(a$age_lt15[a$GEO == "22001"], 400)
  expect_equal(a$age_lt20[a$GEO == "22001"], 500)
  expect_equal(a$age_80_plus[a$GEO == "29001"], 200)
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
