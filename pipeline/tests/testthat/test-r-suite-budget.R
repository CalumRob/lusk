# Budget classification is tested with synthetic timings; the real serial guard
# remains an explicit script so machine noise never fails the default suite.

test_that("the serial budget flags only unlisted tests and files", {
  envir <- new.env(parent = globalenv())
  sys.source(file.path(pkgload::pkg_path(), "scripts", "verify-r-suite-budget.R"), envir = envir)
  fichiers <- data.frame(
    file = c("fast.R", "listed.R", "slow.R"),
    wall = c(4.9, 15.1, 15.1), in_tests = c(4.9, 15, 15)
  )
  tests <- data.frame(
    file = c("fast.R", "listed.R", "slow.R"),
    test = c("fast", "raccordement scalar projection binds its producer metadata, source vintage, and trajectory t0090", "slow"),
    real = c(5, 5.1, 5.1)
  )
  envir$EXCEPTIONS_BUDGET <- data.frame(
    fichier = c("listed.R", "listed.R"),
    test = c(NA_character_, "raccordement scalar projection binds its producer metadata, source vintage, and trajectory t0090"),
    raison = c("file execution contract", "test execution contract")
  )
  depassements <- envir$depassements_budget(fichiers, tests)
  expect_identical(depassements$fichiers$file, "slow.R")
  expect_identical(depassements$tests$file, "slow.R")
})

test_that("budget exceptions match the exact file and test name", {
  envir <- new.env(parent = globalenv())
  sys.source(file.path(pkgload::pkg_path(), "scripts", "verify-r-suite-budget.R"), envir = envir)
  envir$EXCEPTIONS_BUDGET <- data.frame(
    fichier = "fixture.R", test = "executes twice", raison = "execution contract"
  )
  expect_true(envir$exception_budget("fixture.R", "executes twice"))
  expect_false(envir$exception_budget("fixture.R", "executes once"))
  expect_false(envir$exception_budget("other.R", "executes twice"))
})

test_that("retirement-bound budget exceptions carry an expiry label", {
  envir <- new.env(parent = globalenv())
  sys.source(file.path(pkgload::pkg_path(), "scripts", "verify-r-suite-budget.R"), envir = envir)
  attendu <- c("test-offre-tc-bridge.R" = "ADR-0049 step 4",
               "test-targets-raccordement.R" = "#1129")
  expect_true("expiration" %in% names(envir$EXCEPTIONS_BUDGET))
  for (fichier in names(attendu)) {
    lignes <- envir$EXCEPTIONS_BUDGET[envir$EXCEPTIONS_BUDGET$fichier == fichier, ]
    expect_true(all(lignes$expiration == attendu[[fichier]]), info = fichier)
  }
})

test_that("the budget report names the top offenders", {
  envir <- new.env(parent = globalenv())
  sys.source(file.path(pkgload::pkg_path(), "scripts", "verify-r-suite-budget.R"), envir = envir)
  resultats <- list(
    wall = 20,
    par_fichier = data.frame(file = c("b.R", "a.R"), wall = c(12, 8), in_tests = c(11, 7)),
    par_test = data.frame(file = c("b.R", "a.R"), test = c("b test", "a test"), real = c(6, 4))
  )
  rapport <- envir$formater_rapport_budget(resultats, top = 1L)
  expect_true(any(grepl("b.R", rapport, fixed = TRUE)))
  expect_false(any(grepl("a.R", rapport, fixed = TRUE)))
  expect_true(any(grepl("b test", rapport, fixed = TRUE)))
})

test_that("the handoff report names every failed or erroring test and its first message line", {
  envir <- new.env(parent = globalenv())
  sys.source(file.path(pkgload::pkg_path(), "scripts", "verify-r-suite-budget.R"), envir = envir)
  fichiers <- data.frame(
    file = c("a.R", "b.R", "c.R"), wall = c(1, 1, 1), errored = c(FALSE, FALSE, TRUE),
    error_message = c(NA_character_, NA_character_, "load failed\nsecond line"),
    stringsAsFactors = FALSE
  )
  tests <- data.frame(
    file = c("a.R", "a.R", "b.R"), test = c("fails", "passes", "errors"),
    real = c(0.1, 0.1, 0.1), failed = c(2, 0, 0), error = c(0, 0, 1),
    first_message = c("expected one\nmore detail", NA_character_, "writer exploded\nstack"),
    stringsAsFactors = FALSE
  )
  echecs <- envir$echecs_suite(fichiers, tests)
  expect_identical(echecs$file, c("a.R", "b.R", "c.R"))
  expect_identical(echecs$test, c("fails", "errors", "<file load>"))
  expect_identical(echecs$kind, c("FAIL", "ERROR", "ERROR"))
  expect_identical(echecs$message, c("expected one", "writer exploded", "load failed"))
  rapport <- envir$formater_echecs_suite(echecs)
  expect_true(any(grepl("FAIL a.R :: fails: expected one", rapport, fixed = TRUE)))
  expect_true(any(grepl("ERROR b.R :: errors: writer exploded", rapport, fixed = TRUE)))
  expect_false(any(grepl("second line|stack|more detail", rapport)))
  expect_error(envir$arreter_si_echecs(echecs), "R default suite failed")
  expect_silent(envir$arreter_si_echecs(echecs[FALSE, , drop = FALSE]))
})

test_that("testthat error messages survive the timing data-frame conversion", {
  envir <- new.env(parent = globalenv())
  sys.source(file.path(pkgload::pkg_path(), "scripts", "verify-r-suite-budget.R"), envir = envir)
  erreur <- structure(list(message = "writer exploded\nsecond line"),
    class = c("expectation_error", "expectation", "error", "condition"))
  echec <- structure(list(message = "expected TRUE\nmore detail"),
    class = c("expectation_failure", "expectation", "error", "condition"))
  resultats <- list(list(results = list(erreur)), list(results = list(echec)))
  expect_identical(envir$messages_resultats_tests(resultats),
                   c("writer exploded", "expected TRUE"))
})

test_that("empty budget sections do not print a phantom file offender", {
  envir <- new.env(parent = globalenv())
  sys.source(file.path(pkgload::pkg_path(), "scripts", "verify-r-suite-budget.R"), envir = envir)
  depassements <- list(
    tests = data.frame(file = "slow.R", test = "slow", real = 6),
    fichiers = data.frame(file = character(), wall = numeric())
  )
  details <- envir$formater_depassements_budget(depassements)
  expect_length(details, 1L)
  expect_match(details, "slow.R :: slow", fixed = TRUE)
  expect_false(any(grepl("file ", details, fixed = TRUE)))
})
