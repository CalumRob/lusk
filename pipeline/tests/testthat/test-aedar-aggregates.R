test_that("AEDAR aggregation projection preserves dense source facts and all levels", {
  levels <- AEDAR_AGGREGATE_LEVELS
  inputs <- stats::setNames(lapply(levels, function(level) data.frame(
    territory_id=paste0(level, "-1"), TYPEQU="A1", LIB_TYPEQU="École",
    n_addresses=2L, n_observed=1L, coverage_status="partial",
    car_p1=0, car_p50=NA_real_, transit_p1=NA_real_, transit_gain_p1=0,
    stringsAsFactors=FALSE)), levels)
  projection <- project_aedar_aggregates(inputs,
    c("car_p1", "car_p50", "transit_p1", "transit_gain_p1"))
  expect_equal(unique(projection$facts$territory_type), levels)
  expect_equal(nrow(projection$facts), 4L)
  expect_equal(projection$facts$car_p1, rep(0, 4))
  expect_true(all(is.na(projection$facts$car_p50)))
  expect_true(all(is.na(projection$facts$transit_p1)))
  expect_equal(projection$facts$LIB_TYPEQU, rep("École", 4))
  expect_equal(projection$source$licence, "ODbL")
})

test_that("AEDAR projection rejects duplicate territory TYPEQU coordinates", {
  inputs <- stats::setNames(lapply(AEDAR_AGGREGATE_LEVELS, function(level) data.frame(
    territory_id="x", TYPEQU="A1", LIB_TYPEQU="École", n_addresses=1L,
    n_observed=1L, coverage_status="complete", value=0)), AEDAR_AGGREGATE_LEVELS)
  inputs$commune <- rbind(inputs$commune, inputs$commune)
  expect_error(project_aedar_aggregates(inputs, "value"), "Invalid AEDAR")
})
