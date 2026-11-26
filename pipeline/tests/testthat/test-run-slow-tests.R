# Mechanical slow-tier ownership selection; no slow test is executed here.

charger_runner_tests_lents <- function() {
  envir <- new.env(parent = globalenv())
  sys.source(file.path(pkgload::pkg_path(), "scripts", "run-slow-tests.R"),
             envir = envir)
  envir
}

test_that("the slow tier counts errored tests, not only failed expectations", {
  runner <- charger_runner_tests_lents()
  # What testthat reports for a test that RAISED: no failed expectation, error = TRUE.
  vert <- data.frame(test = "a", nb = 3L, failed = 0L, skipped = FALSE, error = FALSE,
                     warning = 0L)
  erreur <- data.frame(test = "b", nb = 1L, failed = 0L, skipped = FALSE, error = TRUE,
                       warning = 0L)
  echec <- data.frame(test = "c", nb = 2L, failed = 1L, skipped = FALSE, error = FALSE,
                      warning = 0L)
  expect_identical(runner$compter_resultats_tests_lents(list(vert)),
                   list(attentes = 3, echecs = 0, erreurs = 0))
  bilan <- runner$compter_resultats_tests_lents(list(vert, erreur))
  expect_identical(bilan$erreurs, 1)
  expect_identical(bilan$echecs, 0)        # the old counter stopped here and reported green
  bilan <- runner$compter_resultats_tests_lents(list(vert, erreur, echec))
  expect_identical(c(bilan$echecs, bilan$erreurs), c(1, 1))
  # the runner stops on either
  corps <- paste(deparse(runner$executer_tests_lents), collapse = "\n")
  expect_true(grepl("bilan\\$echecs > 0L \\|\\| bilan\\$erreurs > 0L", corps))

  # End to end on a real testthat result holding one erroring test.
  fichier <- tempfile("test-erreur-", fileext = ".R")
  on.exit(unlink(fichier), add = TRUE)
  writeLines(c('test_that("ok", expect_true(TRUE))', 'test_that("boom", stop("boom"))'), fichier)
  resultat <- testthat::test_file(fichier, reporter = "silent", stop_on_failure = FALSE)
  bilan <- runner$compter_resultats_tests_lents(list(as.data.frame(resultat)))
  expect_identical(bilan$erreurs, 1)
  expect_identical(bilan$echecs, 0)
})

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
