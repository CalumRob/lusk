read_aedar_region_typequ_fixture <- function() {
  readr::read_csv(testthat::test_path("fixtures","aedar-region-2026v1-typequ.csv"),
    col_types=readr::cols(.default=readr::col_character()),trim_ws=FALSE,show_col_types=FALSE)
}

make_aedar_test_typequ_metadata <- function() {
  axis <- read_aedar_typequ_registry()
  i <- seq_len(nrow(axis))
  domain <- ((i-1L) %% 27L) %% 7L + 1L
  data.frame(TYPEQU=axis$TYPEQU,LIB_TYPEQU=axis$LIB_TYPEQU,
    domain_code=paste0("D",domain),domain_label=paste("Domain",domain),
    subdomain_code=paste0("S",((i-1L) %% 27L)+1L),subdomain_label=paste("Subdomain",((i-1L) %% 27L)+1L),
    GAMME=c("Proximité","Hors Gamme",rep(NA_character_,length(i)-2L)),
    gamme_status=c("classified","hors_gamme",rep("absent",length(i)-2L)),
    source_order=i,stringsAsFactors=FALSE)
}

make_aedar_test_inputs <- function() {
  axis <- read_aedar_region_typequ_fixture()
  stats::setNames(lapply(AEDAR_AGGREGATE_LEVELS, function(level) {
    x <- as.data.frame(matrix(0,nrow=nrow(axis),ncol=length(AEDAR_AGGREGATE_MEASURES),
      dimnames=list(NULL,AEDAR_AGGREGATE_MEASURES)))
    x$code_insee <- "22001"; x$epci_code <- "200000001"; x$code_departement <- "22"; x$code_region <- "53"
    x$nom_commune <- "Essai"; x$nom_epci <- "EPCI"; x$nom_departement <- "Département"; x$nom_region <- "Bretagne"
    x$TYPEQU <- axis$TYPEQU; x$LIB_TYPEQU <- axis$LIB_TYPEQU
    x$n_addresses <- 2L; x$n_observed <- 1L; x$coverage_status <- "covered"
    x$count_5_walk_share <- NA_real_
    x[, c(AEDAR_AGGREGATE_LEVEL_COLUMNS[[level]],AEDAR_AGGREGATE_MEASURES),drop=FALSE]
  }), AEDAR_AGGREGATE_LEVELS)
}

test_that("AEDAR projection preserves the complete 2025 TYPEQU registry at all four levels", {
  levels <- AEDAR_AGGREGATE_LEVELS
  axis <- read_aedar_region_typequ_fixture()
  inputs <- make_aedar_test_inputs()
  projection <- project_aedar_aggregates(inputs)
  expect_equal(unique(projection$facts$territory_type), levels)
  expect_equal(nrow(projection$facts), 4L * AEDAR_TYPEQU_REGISTRY_COUNT)
  expect_equal(length(projection$measures), 312L)
  expect_setequal(unique(projection$facts$TYPEQU), axis$TYPEQU)
  expect_true(all(c("A125","A136","F105") %in% axis$TYPEQU))
  expect_equal(projection$facts$count_5_walk_share, rep(NA_real_, nrow(projection$facts)))
  expect_equal(projection$facts$count_5_walk_min, rep(0, nrow(projection$facts)))
  expect_equal(projection$facts$LIB_TYPEQU[projection$facts$TYPEQU=="F105"], rep("DOMAINE SKIABLE",4))
  expect_equal(projection$source$licence, "ODbL")
})

test_that("the pinned TYPEQU registry matches the producer region aggregate", {
  expect_equal(read_aedar_typequ_registry(),read_aedar_region_typequ_fixture())
})

test_that("hash-pinned TYPEQU artifacts retain LF bytes", {
  paths <- c(testthat::test_path("..","..","inst","extdata",AEDAR_TYPEQU_REGISTRY_FILE),
    testthat::test_path("fixtures","aedar-region-2026v1-typequ.csv"))
  for (path in paths) {
    bytes <- readBin(path,"raw",n=file.info(path)$size)
    expect_false(any(bytes == as.raw(13L)))
  }
})

test_that("AEDAR projection rejects a registered TYPEQU omitted at every level", {
  inputs <- make_aedar_test_inputs()
  inputs <- lapply(inputs,function(x) x[x$TYPEQU!="F105",,drop=FALSE])
  expect_error(project_aedar_aggregates(inputs), "pinned 2025 BPE TYPEQU registry")
})

test_that("AEDAR projection rejects TYPEQU values outside the registry", {
  inputs <- make_aedar_test_inputs()
  extra <- inputs$commune[1,,drop=FALSE]
  extra$TYPEQU <- "Z999"; extra$LIB_TYPEQU <- "Unknown"
  inputs$commune <- rbind(inputs$commune,extra)
  expect_error(project_aedar_aggregates(inputs), "pinned 2025 BPE TYPEQU registry")
})

test_that("AEDAR projection rejects duplicate territory TYPEQU coordinates", {
  inputs <- make_aedar_test_inputs()
  inputs$commune <- rbind(inputs$commune, inputs$commune[1,,drop=FALSE])
  expect_error(project_aedar_aggregates(inputs), "Invalid AEDAR")
})

test_that("AEDAR labels match the independent TYPEQU registry at every level", {
  inputs <- make_aedar_test_inputs()
  inputs$epci$LIB_TYPEQU[inputs$epci$TYPEQU=="A104"] <- "Wrong label"
  expect_error(project_aedar_aggregates(inputs), "pinned 2025 BPE TYPEQU registry")
})

test_that("AEDAR publication refuses territory identities absent from the serving reference", {
  facts <- data.frame(territory_type="commune",territory_id="22001")
  expect_error(validate_aedar_territory_reference(facts,
    data.frame(territory_type="epci",territory_id="200000001")),
    "do not exist in published territory_reference")
})

test_that("canonical Parquet round trip keeps source columns, null/zero and provenance", {
  levels <- AEDAR_AGGREGATE_LEVELS
  inputs <- make_aedar_test_inputs()
  metadata <- make_aedar_test_typequ_metadata()
  a135 <- match("A135",metadata$TYPEQU); d710 <- match("D710",metadata$TYPEQU)
  c401 <- match("C401",metadata$TYPEQU)
  metadata$LIB_TYPEQU[a135] <- gsub("'","’",metadata$LIB_TYPEQU[a135],fixed=TRUE)
  metadata$LIB_TYPEQU[d710] <- trimws(metadata$LIB_TYPEQU[d710])
  metadata$LIB_TYPEQU[c401] <- "STS SECTION TECHNICIEN SUPÉRIEUR, CPGE CLASSE PRÉPARATOIRE AUX GRANDES\nÉCOLES"
  original<-project_aedar_aggregates(inputs,metadata); path<-tempfile("aedar-canonical-")
  write_aedar_canonical(original,path)
  restored<-read_aedar_canonical(path)
  expect_equal(restored$facts$count_5_walk_share,rep(NA_real_,4L * AEDAR_TYPEQU_REGISTRY_COUNT))
  expect_equal(restored$facts$count_5_walk_min,rep(0,4L * AEDAR_TYPEQU_REGISTRY_COUNT))
  expect_equal(restored$facts$territory_type,rep(levels,each=AEDAR_TYPEQU_REGISTRY_COUNT))
  expect_equal(restored$source$licence,"ODbL")
  expect_equal(restored$typequ_metadata$gamme_status,original$typequ_metadata$gamme_status)
  expect_identical(restored$typequ_metadata$GAMME[2],"Hors Gamme")
  expect_identical(restored$typequ_metadata$LIB_TYPEQU[a135],"COUR D’ASSISES")
  expect_identical(restored$typequ_metadata$LIB_TYPEQU[c401],metadata$LIB_TYPEQU[c401])
  expect_equal(restored$source$attribution,"© OpenStreetMap contributors; données AEDAR — licence ODbL")
})

test_that("canonical aggregate labels compare with approved normalization but retain hierarchy text", {
  inputs <- make_aedar_test_inputs()
  metadata <- make_aedar_test_typequ_metadata()
  a135 <- match("A135",metadata$TYPEQU)
  d710 <- match("D710",metadata$TYPEQU)
  metadata$LIB_TYPEQU[a135] <- gsub("'","’",metadata$LIB_TYPEQU[a135],fixed=TRUE)
  metadata$LIB_TYPEQU[d710] <- trimws(metadata$LIB_TYPEQU[d710])
  projection <- project_aedar_aggregates(inputs,metadata)
  expect_identical(projection$typequ_metadata$LIB_TYPEQU[a135],metadata$LIB_TYPEQU[a135])
  bad <- metadata
  bad$LIB_TYPEQU[a135] <- "COUR D’ASSISES MODIFIÉE"
  expect_error(project_aedar_aggregates(inputs,bad),"canonical registry")
})

test_that("published TYPEQU validator and aggregate projection accept the full 235-row metadata axis", {
  metadata <- make_aedar_test_typequ_metadata()
  expect_equal(nrow(validate_aedar_published_typequ_metadata(metadata)),235L)
  projection <- project_aedar_aggregates(make_aedar_test_inputs(),metadata)
  expect_equal(nrow(projection$typequ_metadata),235L)
  expect_equal(nrow(projection$facts),4L*235L)
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

test_that("AEDAR canonical output and database publication require complete TYPEQU metadata", {
  projection <- project_aedar_aggregates(make_aedar_test_inputs())
  expect_error(write_aedar_canonical(projection,tempfile("aedar-metadata-required-")),"requires TYPEQU metadata")
  expect_error(publish_aedar_aggregates(projection,NULL),"requires canonical TYPEQU metadata")
})
