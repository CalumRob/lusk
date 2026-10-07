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

test_that("AEDAR labels follow the source TYPEQU registry across all aggregate files", {
  inputs <- stats::setNames(lapply(AEDAR_AGGREGATE_LEVELS,function(level) {
    x<-as.data.frame(as.list(stats::setNames(rep(0,length(AEDAR_AGGREGATE_MEASURES)),AEDAR_AGGREGATE_MEASURES)))
    x$code_insee<-"22001"; x$epci_code<-"200000001"; x$code_departement<-"22"; x$code_region<-"53"
    x$nom_commune<-"Commune"; x$nom_epci<-"EPCI"; x$nom_departement<-"Département"; x$nom_region<-"Bretagne"
    x$TYPEQU<-"A104"; x$LIB_TYPEQU<-if(level=="epci") "Wrong" else "GENDARMERIE"
    x$n_addresses<-1L; x$n_observed<-1L; x$coverage_status<-"covered"
    x[,c(AEDAR_AGGREGATE_LEVEL_COLUMNS[[level]],AEDAR_AGGREGATE_MEASURES),drop=FALSE]
  }),AEDAR_AGGREGATE_LEVELS)
  expect_error(project_aedar_aggregates(inputs),"labels differ")
})

test_that("AEDAR publication refuses territory identities absent from the serving reference", {
  facts <- data.frame(territory_type="commune",territory_id="22001")
  expect_error(validate_aedar_territory_reference(facts,
    data.frame(territory_type="epci",territory_id="200000001")),
    "do not exist in published territory_reference")
})

test_that("canonical Parquet round trip keeps source columns, null/zero and provenance", {
  levels <- AEDAR_AGGREGATE_LEVELS
  inputs <- stats::setNames(lapply(levels,function(level) {
    x<-as.data.frame(as.list(stats::setNames(rep(0,length(AEDAR_AGGREGATE_MEASURES)),AEDAR_AGGREGATE_MEASURES)))
    x$code_insee<-"22001"; x$epci_code<-"200000001"; x$code_departement<-"22"; x$code_region<-"53"
    x$nom_commune<-"Commune"; x$nom_epci<-"EPCI"; x$nom_departement<-"Département"; x$nom_region<-"Bretagne"
    x$TYPEQU<-"A104"; x$LIB_TYPEQU<-"GENDARMERIE"; x$n_addresses<-2L; x$n_observed<-1L; x$coverage_status<-"covered"
    x$count_5_walk_share<-NA_real_
    x[,c(AEDAR_AGGREGATE_LEVEL_COLUMNS[[level]],AEDAR_AGGREGATE_MEASURES),drop=FALSE]
  }),levels)
  original<-project_aedar_aggregates(inputs); path<-tempfile("aedar-canonical-")
  write_aedar_canonical(original,path)
  restored<-read_aedar_canonical(path)
  expect_equal(restored$facts$count_5_walk_share,rep(NA_real_,4))
  expect_equal(restored$facts$count_5_walk_min,rep(0,4))
  expect_equal(restored$facts$territory_type,levels)
  expect_equal(restored$source$licence,"ODbL")
})

test_that("AEDAR operator publish reads the validated canonical Parquets", {
  script <- paste(readLines(testthat::test_path("..","..","scripts","publish-aedar-aggregates.R"),warn=FALSE),collapse="\n")
  expect_match(script,"write_aedar_canonical\\(projection,canonical_dir\\)")
  expect_match(script,"projection <- read_aedar_canonical\\(canonical_dir\\)")
  expect_match(script,"publish_aedar_aggregates\\(projection,con\\)")
  expect_gt(regexpr("write_aedar_canonical\\(projection,canonical_dir\\)",script)[[1]],0)
  expect_gt(regexpr("projection <- read_aedar_canonical\\(canonical_dir\\)",script)[[1]],0)
  expect_match(script,"Canonical AEDAR Parquets are missing; run --check first")
  expect_match(script,"LUSK_PUBLISH_AEDAR")
  expect_match(script,"disabled for cron")
})
