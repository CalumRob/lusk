test_that("services_gtfs_a_la_date applies weekly calendars and exceptions", {
  calendar <- data.frame(
    service_id = c("weekday", "weekend", "outside"),
    monday = c(1L, 0L, 1L), tuesday = c(1L, 0L, 1L),
    wednesday = c(1L, 0L, 1L), thursday = c(1L, 0L, 1L),
    friday = c(1L, 0L, 1L), saturday = c(0L, 1L, 0L),
    sunday = c(0L, 1L, 0L),
    start_date = c("20261001", "20261001", "20261101"),
    end_date = c("20261031", "20261031", "20261130"),
    stringsAsFactors = FALSE
  )
  exceptions <- data.frame(
    service_id = c("weekday", "weekend", "oneoff"),
    date = c("20261021", "20261021", "20261021"),
    exception_type = c(2L, 1L, 1L), stringsAsFactors = FALSE
  )

  expect_setequal(
    services_gtfs_a_la_date(calendar, exceptions, "2026-10-21"),
    c("weekend", "oneoff")
  )
  expect_setequal(
    services_gtfs_a_la_date(calendar, exceptions, "2026-10-22"),
    "weekday"
  )
})

test_that("services_gtfs_a_la_date supports calendar_dates-only feeds", {
  exceptions <- data.frame(
    service_id = c("active", "cancelled"),
    date = c("20261021", "20261021"), exception_type = c(1L, 2L),
    stringsAsFactors = FALSE
  )

  expect_identical(
    services_gtfs_a_la_date(NULL, exceptions, "2026-10-21"), "active"
  )
})
