test_that("owner publication protocol handles no-op, dependency rebind and DB-behind retry", {
  current <- data.frame(content_version = "v1", reference_content_version = "r1")
  dependency <- data.frame(content_version = "r1")
  calls <- character()
  db <- list(
    transaction = function(expr) force(expr),
    lock = function(owner) calls <<- c(calls, paste0("lock:", owner)),
    marker = function(owner) current,
    set_marker = function(version, reference) {
      current$content_version <<- version
      current$reference_content_version <<- reference
    }
  )
  publish <- function(version, dep) {
    calls <<- c(calls, paste0("publish:", version))
    db$set_marker(version, dep$content_version[[1L]])
  }
  rebind <- function(version) {
    calls <<- c(calls, paste0("rebind:", version))
    current$reference_content_version <<- version
  }
  validate <- function(dep) expect_true(nrow(dep) == 1L)
  run <- function(version = "v1") publish_owner_snapshot(
    db, "scalar", version, "territory_reference", function() dependency,
    validate, publish, rebind)

  expect_false(run()$changed)
  expect_identical(calls, "lock:scalar")

  dependency$content_version <- "r2"
  expect_true(run()$rebound)
  expect_identical(current$reference_content_version, "r2")

  current$content_version <- "behind"
  expect_true(run()$changed)
  expect_identical(current$content_version, "v1")
  expect_identical(current$reference_content_version, "r2")
  expect_identical(sum(grepl("publish:v1", calls, fixed = TRUE)), 1L)
})

test_that("owner publication validation failure leaves the stored token untouched", {
  current <- data.frame(content_version = "v1", reference_content_version = "r1")
  db <- list(transaction = function(expr) force(expr), marker = function(owner) current)
  expect_error(publish_owner_snapshot(
    db, "profile", "v2", "scalar", function() data.frame(content_version = NA_character_),
    function(dep) stop("dependency rejected"), function(...) stop("must not publish"),
    function(...) stop("must not rebind")), "dependency rejected")
  expect_identical(current$content_version, "v1")
})

test_that("owner protocol can republish a coherent dependent projection on lineage staleness", {
  current <- data.frame(content_version = "v1", reference_content_version = "r1")
  db <- list(
    transaction = function(expr) force(expr),
    marker = function(owner) current,
    lock = function(owner) invisible(NULL)
  )
  published <- FALSE
  result <- publish_owner_snapshot(
    db, "series:dvf", "v1", "territory_reference",
    function() data.frame(content_version = "r1"), function(dep) invisible(TRUE),
    function(version, dep) published <<- TRUE, function(version) invisible(NULL),
    requires_republish = function(marker, dep) TRUE)

  expect_true(result$republished_for_dependency)
  expect_true(published)
})
