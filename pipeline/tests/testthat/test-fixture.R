test_that("le fixture se charge avec la forme attendue", {
  fixture <- load_fixture()
  expect_s3_class(fixture, "tbl_df")
  expect_equal(nrow(fixture), 4)
})

test_that("le fixture porte toutes les colonnes du contrat", {
  expected <- c(
    "code", "nom", "departement", "epci",
    "population", "population_1968", "population_precedente",
    "superficie_km2", "naissances", "deces",
    "age_0_19", "age_20_39", "age_40_59", "age_60_74", "age_75_plus",
    "menages"
  )
  expect_setequal(names(load_fixture()), expected)
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
  age_cols <- grep("^age_", names(fixture), value = TRUE)
  expect_equal(rowSums(fixture[age_cols]), fixture$population)
})
