test_that("legacy whole-snapshot publication is admitted only before 049", {
  testthat::local_mocked_bindings(
    dbGetQuery = function(con, sql, ...) {
      expect_match(sql, "to_regclass", fixed = TRUE)
      data.frame(scalaire = TRUE, profil = TRUE)
    }, .package = "DBI")
  expect_true(verifier_schema_publication_globale(NULL))
})

test_that("legacy whole-snapshot publication refuses post-049 before marker access", {
  testthat::local_mocked_bindings(
    dbGetQuery = function(con, sql, ...) {
      expect_match(sql, "to_regclass", fixed = TRUE)
      expect_false(grepl("FROM scalar_comparison_publication|FROM profile_comparison_publication", sql))
      data.frame(scalaire = FALSE, profil = FALSE)
    }, .package = "DBI")
  expect_error(verifier_schema_publication_globale(NULL),
    "retired after migration 049", fixed = TRUE)
})
