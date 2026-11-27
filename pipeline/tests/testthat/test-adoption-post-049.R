test_that("adoption accepts the pre-049 global-marker schema", {
  testthat::local_mocked_bindings(
    dbGetQuery = function(con, sql, ...) {
      expect_match(sql, "to_regclass", fixed = TRUE)
      expect_false(grepl("FROM scalar_comparison_publication|FROM profile_comparison_publication", sql))
      data.frame(scalaire = TRUE, profil = TRUE)
    }, .package = "DBI")
  expect_true(verifier_schema_adoption_globale(NULL))
})

test_that("adoption refuses post-049 before reading any dropped marker", {
  testthat::local_mocked_bindings(
    dbGetQuery = function(con, sql, ...) {
      expect_match(sql, "to_regclass", fixed = TRUE)
      expect_false(grepl("FROM scalar_comparison_publication|FROM profile_comparison_publication", sql))
      data.frame(scalaire = FALSE, profil = FALSE)
    }, .package = "DBI")
  err <- tryCatch(verifier_schema_adoption_globale(NULL), error = identity)
  expect_s3_class(err, "erreur_adoption")
  expect_identical(err$refus, "adoption_globale_retiree")
  expect_match(conditionMessage(err), "migration 049", fixed = TRUE)
  expect_match(conditionMessage(err), "zéro écriture", fixed = TRUE)
})

test_that("adoption delegates the global-marker probe to the shared publication guard", {
  con <- structure(list(), class = "probe-con")
  seen <- NULL
  testthat::local_mocked_bindings(
    verifier_schema_publication_globale = function(con, refusal = NULL) {
      seen <<- list(con = con, refusal = refusal)
      stop(refusal)
    }, .package = "lusk")
  err <- tryCatch(verifier_schema_adoption_globale(con), error = identity)
  expect_identical(seen$con, con)
  expect_s3_class(seen$refusal, "erreur_adoption")
  expect_identical(seen$refusal$refus, "adoption_globale_retiree")
  expect_identical(err, seen$refusal)
})
