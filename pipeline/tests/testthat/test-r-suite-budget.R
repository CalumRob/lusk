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
