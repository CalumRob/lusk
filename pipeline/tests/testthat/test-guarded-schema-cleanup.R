test_that("guarded schema build drops its schema when the build throws", {
  calls <- character()
  testthat::local_mocked_bindings(
    dbExecute = function(con, statement, ...) {
      calls <<- c(calls, statement)
      0L
    }, .package = "DBI")
  expect_error(.guarded_schema_build(NULL, "it_test_", function(schema)
    stop("fixture build failed", call. = FALSE)), "fixture build failed", fixed = TRUE)
  expect_true(any(grepl('^DROP SCHEMA IF EXISTS "it_test_', calls)), info = calls)
})

test_that("guarded schema build leaves successful cleanup to its caller", {
  calls <- character()
  testthat::local_mocked_bindings(
    dbExecute = function(con, statement, ...) {
      calls <<- c(calls, statement)
      0L
    }, .package = "DBI")
  result <- .guarded_schema_build(NULL, "it_test_", function(schema) "built")
  expect_identical(result$value, "built")
  expect_match(result$schema, "^it_test_")
  expect_false(any(grepl("DROP SCHEMA", calls, fixed = TRUE)))
})

test_that("adopt schema initialization drops a created schema when DDL fails", {
  calls <- character()
  testthat::local_mocked_bindings(
    split_postgres_sql = function(sql) "ddl-fail", .package = "lusk")
  testthat::local_mocked_bindings(
    dbExecute = function(con, statement, ...) {
      calls <<- c(calls, statement)
      if (identical(statement, "ddl-fail"))
        stop("adopt fixture build failed", call. = FALSE)
      0L
    }, .package = "DBI")
  expect_error(.adopt_db_schema(NULL), "adopt fixture build failed", fixed = TRUE)
  expect_true(any(grepl('^DROP SCHEMA IF EXISTS "it_adopt_', calls)), info = calls)
})
