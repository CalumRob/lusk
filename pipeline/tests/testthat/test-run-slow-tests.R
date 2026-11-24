# Mechanical slow-tier ownership selection; no slow test is executed here.

charger_runner_tests_lents <- function() {
  envir <- new.env(parent = globalenv())
  sys.source(file.path(pkgload::pkg_path(), "scripts", "run-slow-tests.R"),
             envir = envir)
  envir
}

test_that("slow tests run all when no changed paths are supplied", {
  runner <- charger_runner_tests_lents()
  repertoire <- tempfile("slow-selection-")
  dir.create(repertoire)
  on.exit(unlink(repertoire, recursive = TRUE), add = TRUE)
  writeLines(c("# test", "# Subject files: pipeline/R/a.R"),
             file.path(repertoire, "test-a.R"))
  writeLines(c("# test", "# Subject files: public/data"),
             file.path(repertoire, "test-b.R"))
  expect_length(runner$selectionner_tests_lents(tous = TRUE,
                                                 repertoire = repertoire), 2L)
})

test_that("changed subject files and directories select only their slow tests", {
  runner <- charger_runner_tests_lents()
  repertoire <- tempfile("slow-selection-")
  dir.create(repertoire)
  on.exit(unlink(repertoire, recursive = TRUE), add = TRUE)
  writeLines(c("# test", "# Subject files: pipeline/R/a.R"),
             file.path(repertoire, "test-a.R"))
  writeLines(c("# test", "# Subject files: public/data"),
             file.path(repertoire, "test-b.R"))
  attendu <- file.path(repertoire, "test-a.R")
  expect_identical(runner$selectionner_tests_lents("R/a.R", repertoire = repertoire),
                   attendu)
  expect_identical(runner$selectionner_tests_lents("pipeline/R/a.R",
                                                   repertoire = repertoire), attendu)

  expect_identical(runner$selectionner_tests_lents("public/data/theme.json",
                                                   repertoire = repertoire),
                   file.path(repertoire, "test-b.R"))
  expect_length(runner$selectionner_tests_lents("pipeline/R/absent.R",
                                                repertoire = repertoire), 0L)
})

test_that("a slow test without declared subject files fails loudly", {
  runner <- charger_runner_tests_lents()
  repertoire <- tempfile("slow-selection-")
  dir.create(repertoire)
  on.exit(unlink(repertoire, recursive = TRUE), add = TRUE)
  fichier <- file.path(repertoire, "test-a.R")
  writeLines("# no declaration", fichier)
  expect_error(runner$sujets_test_lent(fichier), "Subject files")
})
