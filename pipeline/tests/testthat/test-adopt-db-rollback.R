# DB-free proof of the guarded adopt file's shared-fixture rollback harness.

mock_con_rollback_adopt <- function() {
  sql <- character()
  appendements <- list()
  con <- structure(list(id = "fake-adopt"), class = "fake_adopt_con")
  testthat::local_mocked_bindings(
    dbExecute = function(con, statement, ...) { sql <<- c(sql, statement); 0L },
    dbAppendTable = function(con, name, value, ...) {
      appendements[[length(appendements) + 1L]] <<- list(name = name, value = value)
      nrow(value)
    },
    .package = "DBI", .env = parent.frame()
  )
  list(con = con, sql = function() sql, appendements = function() appendements)
}

test_that("adopt mutation harness savepoints inner publications and always rolls back", {
  mock <- mock_con_rollback_adopt()
  valeur <- .adopt_db_rollback(mock$con, {
    DBI::dbExecute(mock$con, "UPDATE fixture SET value=2")
    faits <- data.frame(value = 1:2)
    DBI::dbWriteTable(mock$con, "fixture", faits, append = TRUE, row.names = FALSE)
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
  appendements <- mock$appendements()
  expect_length(appendements, 1L)
  expect_identical(appendements[[1L]]$name, "fixture")
  expect_identical(appendements[[1L]]$value, faits)
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
