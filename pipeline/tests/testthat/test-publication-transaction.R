# test-publication-transaction ------------------------------------------------
# The outer publication transaction is single-connection and identity-checked:
# an inner publisher on the SAME connection joins; a DIFFERENT connection fails
# before SQL instead of silently skipping its transaction. Nested outer calls are
# refused and the active state is cleared on every exit/error.

state <- getFromNamespace(".publication_transaction_state", "lusk")
state$connection <- NULL

test_that("the outer publication transaction joins only its own connection", {
  calls <- 0L
  testthat::local_mocked_bindings(
    dbWithTransaction = function(con, expr) { calls <<- calls + 1L; force(expr) },
    .package = "DBI")
  con_a <- structure(list(id = "a"), class = "fake_publication_con")
  con_b <- structure(list(id = "b"), class = "fake_publication_con")
  expect_identical(
    with_publication_transaction(con_a, {
      expect_identical(publication_transaction(con_a, "joined"), "joined")
      "outer"
    }), "outer")
  expect_identical(calls, 1L)
  expect_null(state$connection)

  expect_error(
    with_publication_transaction(con_a, publication_transaction(con_b, "x")),
    "different connection")
  expect_null(state$connection)

  expect_error(
    with_publication_transaction(con_a,
      with_publication_transaction(con_a, "nested")),
    "Nested outer publication transaction")
  expect_null(state$connection)

  expect_error(
    with_publication_transaction(con_a, stop("boom")),
    "boom")
  expect_null(state$connection)

  # Direct calls still open their own DBI transaction.
  calls <- 0L
  expect_identical(publication_transaction(con_a, "direct"), "direct")
  expect_identical(calls, 1L)
})

test_that("the outer state is restored after a failed inner publisher", {
  con <- structure(list(id = "a"), class = "fake_publication_con")
  calls <- 0L
  testthat::local_mocked_bindings(
    dbWithTransaction = function(con, expr) { calls <<- calls + 1L; force(expr) },
    .package = "DBI")
  expect_error(with_publication_transaction(con, {
    publication_transaction(con, stop("inner failure"))
  }), "inner failure")
  expect_null(state$connection)
  expect_identical(calls, 1L)
})
