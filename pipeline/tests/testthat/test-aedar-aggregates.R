test_that("AEDAR aggregation projection preserves dense source facts and all levels", {
  levels <- AEDAR_AGGREGATE_LEVELS
  inputs <- stats::setNames(lapply(levels, function(level) {
    x <- as.data.frame(as.list(stats::setNames(rep(0,length(AEDAR_AGGREGATE_MEASURES)),AEDAR_AGGREGATE_MEASURES)))
    x$code_insee <- "22001"; x$epci_code <- "200000001"; x$code_departement <- "22"; x$code_region <- "53"; x$nom_commune <- "Essai"
    x$nom_epci <- "EPCI"; x$nom_departement <- "Département"; x$nom_region <- "Bretagne"
    x$TYPEQU <- "A104"; x$LIB_TYPEQU <- "GENDARMERIE"; x$n_addresses <- 2L; x$n_observed <- 1L; x$coverage_status <- "covered"
    x$count_5_walk_share <- NA_real_
    x[, c(AEDAR_AGGREGATE_LEVEL_COLUMNS[[level]],AEDAR_AGGREGATE_MEASURES),drop=FALSE]
  }), levels)
  projection <- project_aedar_aggregates(inputs)
  expect_equal(unique(projection$facts$territory_type), levels)
  expect_equal(nrow(projection$facts), 4L)
  expect_equal(length(projection$measures), 312L)
  expect_equal(projection$facts$count_5_walk_share[[1]], NA_real_)
  expect_equal(projection$facts$count_5_walk_min[[1]], 0)
  expect_equal(projection$facts$LIB_TYPEQU, rep("GENDARMERIE", 4))
  expect_equal(projection$source$licence, "ODbL")
})

test_that("AEDAR projection rejects duplicate territory TYPEQU coordinates", {
  inputs <- stats::setNames(lapply(AEDAR_AGGREGATE_LEVELS, function(level) {
    x<-as.data.frame(as.list(stats::setNames(rep(0,length(AEDAR_AGGREGATE_MEASURES)),AEDAR_AGGREGATE_MEASURES)))
    x$code_insee<-"22001"; x$epci_code<-"200000001"; x$code_departement<-"22"; x$code_region<-"53"; x$nom_commune<-"Essai"
    x$nom_epci<-"EPCI"; x$nom_departement<-"Département"; x$nom_region<-"Bretagne"
    x$TYPEQU<-"A104"; x$LIB_TYPEQU<-"GENDARMERIE"; x$n_addresses<-1L; x$n_observed<-1L; x$coverage_status<-"covered"
    x[,c(AEDAR_AGGREGATE_LEVEL_COLUMNS[[level]],AEDAR_AGGREGATE_MEASURES),drop=FALSE]
  }), AEDAR_AGGREGATE_LEVELS)
  inputs$commune <- rbind(inputs$commune, inputs$commune)
  expect_error(project_aedar_aggregates(inputs), "Invalid AEDAR")
})
