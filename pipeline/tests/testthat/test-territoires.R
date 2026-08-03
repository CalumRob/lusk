# build_territoires ------------------------------------------------------------
# La table interne des territoires (communes + agrégats EPCI / département /
# région). Point 1 : les EPCIs portent leur nom réel (LIBEPCI), jamais leur
# SIREN. Point 6 : un EPCI à cheval sur plusieurs départements est attribué au
# département qui détient la pluralité de sa population (règle documentée,
# décision 2026-08-03).

test_that("les communes gardent leur nom et leur code", {
  bt <- build_territoires(load_fixture())
  communes <- bt[bt$type == "commune", ]
  expect_setequal(communes$code, c("22001", "22002", "29001", "29002"))
  expect_setequal(communes$nom, c("Commune A1", "Commune D", "Commune B", "Commune C"))
})

test_that("les EPCIs portent leur LIBEPCI, pas leur SIREN", {
  bt <- build_territoires(load_fixture())
  epcis <- bt[bt$type == "epci", ]
  # le code reste le SIREN (identifiant), le nom devient le LIBEPCI
  expect_setequal(epcis$code, c("200000001", "200000002"))
  expect_setequal(epcis$nom, c("EPCI X", "EPCI Y"))
  expect_false(any(grepl("^EPCI 200", epcis$nom)))
})

test_that("les départements et la région portent leurs étiquettes", {
  bt <- build_territoires(load_fixture())
  expect_equal(bt$nom[bt$type == "departement"], c("Département 22", "Département 29"))
  expect_equal(bt$nom[bt$type == "region"], "Bretagne")
})

test_that("un EPCI à cheval sur deux départements prend la pluralité de population (point 6)", {
  # mini-table : l'EPCI Z réunit une commune du 22 (1000 hab.) et une du 29
  # (2000 hab.) — la pluralité de population est le 29.
  mini <- tibble::tibble(
    code = c("22003", "29003"),
    nom = c("Commune E", "Commune F"),
    departement = c("22", "29"),
    epci = c("200000003", "200000003"),
    nom_epci = c("EPCI Z", "EPCI Z"),
    population = c(1000, 2000),
    population_1968 = c(800, 1500),
    population_precedente = c(900, 1800),
    superficie_km2 = c(10, 20),
    naissances = c(50, 80),
    deces = c(30, 60),
    age_lt15 = c(200, 400), age_15_24 = c(100, 300),
    age_25_39 = c(200, 400), age_40_54 = c(200, 400),
    age_55_64 = c(150, 200), age_65_79 = c(100, 200),
    age_80_plus = c(50, 100), age_lt20 = c(300, 500),
    population_menages = c(980, 1950), menages = c(420, 900)
  )
  bt <- build_territoires(mini)
  epci_z <- bt[bt$type == "epci" & bt$code == "200000003", ]
  expect_equal(epci_z$departement, "29")
})

test_that("un EPCI à cheval ex æquo prend le plus petit département (règle v1)", {
  # les deux départements pèsent le même poids : le plus petit code gagne
  mini <- tibble::tibble(
    code = c("22004", "29004"),
    nom = c("Commune G", "Commune H"),
    departement = c("22", "29"),
    epci = c("200000004", "200000004"),
    nom_epci = c("EPCI W", "EPCI W"),
    population = c(1000, 1000),
    population_1968 = c(800, 800),
    population_precedente = c(900, 900),
    superficie_km2 = c(10, 10),
    naissances = c(50, 50),
    deces = c(30, 30),
    age_lt15 = c(200, 200), age_15_24 = c(100, 100),
    age_25_39 = c(200, 200), age_40_54 = c(200, 200),
    age_55_64 = c(150, 150), age_65_79 = c(100, 100),
    age_80_plus = c(50, 50), age_lt20 = c(300, 300),
    population_menages = c(980, 980), menages = c(420, 420)
  )
  bt <- build_territoires(mini)
  epci_w <- bt[bt$type == "epci" & bt$code == "200000004", ]
  expect_equal(epci_w$departement, "22")
})
