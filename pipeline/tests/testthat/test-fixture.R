test_that("le fixture se charge avec la forme attendue", {
  fixture <- load_fixture()
  expect_s3_class(fixture, "tbl_df")
  expect_equal(nrow(fixture), 4)
})

test_that("le fixture porte toutes les colonnes du contrat", {
  expected <- c(
    "code", "nom", "departement", "epci", "nom_epci",
    "population", "population_1968", "population_precedente",
    "superficie_km2", "naissances", "deces",
    "age_lt15", "age_15_24", "age_25_39", "age_40_54",
    "age_55_64", "age_65_79", "age_80_plus", "age_lt20",
    "population_menages", "menages"
  )
  expect_setequal(names(load_fixture()), expected)
})

test_that("le fixture porte le nom d'EPCI (LIBEPCI) par commune", {
  fixture <- load_fixture()
  expect_true(all(!is.na(fixture$nom_epci)))
  expect_equal(fixture$nom_epci[fixture$epci == "200000001"], rep("EPCI X", 2))
  expect_equal(fixture$nom_epci[fixture$epci == "200000002"], rep("EPCI Y", 2))
})

test_that("le fixture couvre 2 départements et 2 EPCIs", {
  fixture <- load_fixture()
  expect_setequal(unique(fixture$departement), c(22, 29))
  expect_length(unique(fixture$epci), 2)
})

test_that("le fixture contient une égalité de densité (cas de rang)", {
  fixture <- load_fixture()
  densite <- fixture$population / fixture$superficie_km2
  expect_true(any(duplicated(densite)))
})

test_that("les tranches d'âge somment chaque population", {
  fixture <- load_fixture()
  # les 7 tranches exhaustives somment la population ; age_lt20 est un
  # agrégat qui recoupe (moins de 20 ans) — il n'entre pas dans la somme.
  age_cols <- setdiff(grep("^age_", names(fixture), value = TRUE), "age_lt20")
  expect_equal(rowSums(fixture[age_cols]), fixture$population)
})
