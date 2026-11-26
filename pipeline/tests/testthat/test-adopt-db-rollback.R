# DB-free proof of the guarded adopt file's shared-fixture rollback harness.

mock_con_rollback_adopt <- function() {
  sql <- character()
  con <- structure(list(id = "fake-adopt"), class = "fake_adopt_con")
  testthat::local_mocked_bindings(
    dbBegin = function(con, ...) { sql <<- c(sql, "BEGIN"); invisible(TRUE) },
    dbRollback = function(con, ...) { sql <<- c(sql, "ROLLBACK"); invisible(TRUE) },
    dbExecute = function(con, statement, ...) { sql <<- c(sql, statement); 0L },
    dbWithTransaction = function(con, expr, ...)
      stop("an outer DBI transaction must not be opened inside the fixture transaction"),
    .package = "DBI"
  )
  list(con = con, sql = function() sql)
}

test_that("adopt mutation harness savepoints inner publications and always rolls back", {
  mock <- mock_con_rollback_adopt()
  valeur <- .adopt_db_rollback(mock$con, {
    DBI::dbExecute(mock$con, "UPDATE fixture SET value=2")
    DBI::dbWithTransaction(mock$con, {
      # PostgreSQL cannot change transaction mode after the fixture's first write.
      DBI::dbExecute(mock$con, "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
      DBI::dbExecute(mock$con, "SET TRANSACTION READ ONLY")
      "published"
    })
  })
  sql <- mock$sql()
  expect_identical(valeur, "published")
  expect_identical(sql[[1L]], "BEGIN")
  expect_identical(sql[[2L]], "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
  expect_identical(sql[[3L]], "UPDATE fixture SET value=2")
  expect_equal(sum(grepl("^SAVEPOINT ", sql)), 1L)
  expect_equal(sum(grepl("^RELEASE SAVEPOINT ", sql)), 1L)
  expect_false(any(grepl("SET TRANSACTION READ ONLY", sql, fixed = TRUE)))
  expect_identical(tail(sql, 1L), "ROLLBACK")
  expect_false(any(grepl("^COMMIT$", sql)))
})

test_that("a failed inner publication rolls back its savepoint before the fixture transaction", {
  mock <- mock_con_rollback_adopt()
  erreur <- tryCatch(.adopt_db_rollback(mock$con,
    DBI::dbWithTransaction(mock$con, stop("writer failed"))), error = identity)
  sql <- mock$sql()
  expect_match(conditionMessage(erreur), "writer failed", fixed = TRUE)
  expect_true(any(grepl("^ROLLBACK TO SAVEPOINT ", sql)))
  expect_true(any(grepl("^RELEASE SAVEPOINT ", sql)))
  expect_identical(tail(sql, 1L), "ROLLBACK")
})
