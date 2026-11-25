test_that("positional IN placeholders have ONE shared definition", {
  expect_identical(in_params(c("a", "b", "c")), "$1,$2,$3")
  expect_identical(in_params("a"), "$1")
  expect_identical(in_params(c("a", "b"), start = 3L), "$3,$4")
  clause <- clause_in_positionnelle(c("s", "s", NA, "t"), "source_id")
  expect_identical(clause$where, " WHERE source_id IN ($1,$2)")
  expect_identical(clause$params, list("s", "t"))
  expect_null(clause_in_positionnelle(character(), "source_id"))
  # Neither the typed readings nor adoption redefine it.
  fichiers <- file.path(testthat::test_path("..", "..", "R"),
    c("publish_typed_readings.R", "adoption_lectures_live.R"))
  for (fichier in fichiers)
    expect_false(any(grepl("in_params *<- *function", readLines(fichier, warn = FALSE))),
                 info = fichier)
})
