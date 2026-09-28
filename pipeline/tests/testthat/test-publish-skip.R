test_that("la publication Parquet ne remplace pas un fichier identique", {
  cible <- tempfile(fileext = ".parquet")
  table <- data.frame(territoire = c("22001", "22002"), value = c(1, 2))
  expect_true(ecrire_parquet_si_modifie(table, cible))
  ancien <- as.POSIXct("2020-01-01", tz = "UTC")
  Sys.setFileTime(cible, ancien)
  expect_false(ecrire_parquet_si_modifie(table, cible))
  expect_equal(as.numeric(file.info(cible)$mtime), as.numeric(ancien))
  modifie <- table
  modifie$value[2] <- 3
  expect_true(ecrire_parquet_si_modifie(modifie, cible))
  expect_equal(nanoparquet::read_parquet(cible)$value, c(1, 3))
})

test_that("une différence numérique minuscule reste un changement", {
  cible <- tempfile(fileext = ".parquet")
  ecrire_parquet_si_modifie(data.frame(value = 1), cible)
  expect_true(ecrire_parquet_si_modifie(data.frame(value = 1 + 1e-10), cible))
  expect_identical(nanoparquet::read_parquet(cible)$value[[1]], 1 + 1e-10)
})

test_that("les projections JSON héritées ne sont pas réécrites sans changement", {
  cible <- tempfile(fileext = ".json")
  ecrire_json_si_modifie(data.frame(value = 1), cible, dataframe = "rows", auto_unbox = TRUE)
  ancien <- as.POSIXct("2020-01-01", tz = "UTC")
  Sys.setFileTime(cible, ancien)
  expect_false(ecrire_json_si_modifie(data.frame(value = 1), cible,
                                       dataframe = "rows", auto_unbox = TRUE))
  expect_equal(as.numeric(file.info(cible)$mtime), as.numeric(ancien))
  expect_true(ecrire_json_si_modifie(data.frame(value = 2), cible,
                                      dataframe = "rows", auto_unbox = TRUE))
})
