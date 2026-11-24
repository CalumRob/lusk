# Slow tier (#1172): the full pooled density + littoral comparison publication proves sibling isolation.
# Contract: littoral publication keeps density counters intact, binds the classification version, and fails closed on stale C/NC membership.
# Run from pipeline/: Rscript -e "pkgload::load_all('.', quiet=TRUE); testthat::test_file('slow-tests/test-aedar-littoral-whole-payload.R', package='lusk')"

source(file.path(pkgload::pkg_path(), "tests", "testthat", "helper-aedar-fixtures.R"))

test_that("littoral publication is a sibling that leaves density counters intact", {
  withr::local_dir(file.path(pkgload::pkg_path(), "tests", "testthat"))
  skip_if_not_installed("nanoparquet")
  axis <- read_aedar_typequ_registry()
  local_mocked_bindings(project_aedar_density_comparisons=function(...) stop("must consume the pooled artifact"))
  inputs <- make_aedar_test_inputs()
  extra <- inputs$commune; extra$code_insee <- "22002"
  inputs$commune <- rbind(inputs$commune,extra)
  projection <- project_aedar_aggregates(inputs,make_aedar_test_typequ_metadata())
  # Density source fixture (one class) built from the pooled density artifact.
  density_ref <- list(crosswalk=data.frame(code_insee=c("22001","22002"),density_class_code=c("1","1"),
    density_class_label=c("Classe 1","Classe 1"),stringsAsFactors=FALSE),identity=MANIFEST_CLASSES_DENSITE[["id"]][[1L]],
    sha256=MANIFEST_CLASSES_DENSITE[["sha256"]][[1L]],vintage=MANIFEST_CLASSES_DENSITE[["vintage"]][[1L]])
  grid <- expand.grid(density_class_code="1",TYPEQU=axis$TYPEQU,stringsAsFactors=FALSE)
  density <- data.frame(territory_type="density_class",territory_id="1",
    density_class_code="1",density_class_label="Classe 1",TYPEQU=grid$TYPEQU,
    LIB_TYPEQU=axis$LIB_TYPEQU[match(grid$TYPEQU,axis$TYPEQU)],n_addresses=1L,n_observed=1L,
    coverage_status="covered",source_snapshot_id=AEDAR_AGGREGATE_VINTAGE,
    density_reference_identity=density_ref$identity,density_reference_sha256=density_ref$sha256,
    density_reference_vintage=density_ref$vintage,input_content_version="",input_identity="",
    content_version=paste(rep("b",64),collapse=""),stringsAsFactors=FALSE)
  for (measure in AEDAR_AGGREGATE_MEASURES) density[[measure]] <- 1
  dhashes <- c(stats::setNames(rep(paste(rep("1",64),collapse=""),length(AEDAR_ADDRESS_SOURCE_MODES)),
    paste0("mode:",AEDAR_ADDRESS_SOURCE_MODES)),address_origins=paste(rep("2",64),collapse=""),
    density_reference=density_ref$sha256)
  density$input_identity <- as.character(jsonlite::toJSON(as.list(dhashes),auto_unbox=TRUE))
  density$input_content_version <- paste(as.character(openssl::sha256(charToRaw(density$input_identity[[1L]]))),collapse="")
  cols <- c("territory_type","territory_id","density_class_code","density_class_label","TYPEQU","LIB_TYPEQU",
    "n_addresses","n_observed","coverage_status",AEDAR_AGGREGATE_MEASURES,"source_snapshot_id",
    "density_reference_identity","density_reference_sha256","density_reference_vintage",
    "input_content_version","input_identity")
  density <- density[cols]
  density$content_version <- paste(as.character(openssl::sha256(serialize(density[cols],NULL))),collapse="")
  density_source <- list(facts=density,density_reference=density_ref,input_hashes=dhashes,
    crosswalk=density_ref$crosswalk,input_content_version=density$input_content_version[[1L]],
    content_version=density$content_version[[1L]],artifact_sha256=paste(rep("c",64),collapse=""),
    source_snapshot_id=AEDAR_AGGREGATE_VINTAGE)
  refs <- data.frame(territory_type=c("commune","commune","epci","departement","region"),
    territory_id=c("22001","22002","200000001","22","53"),
    epci_id=c("200000001","200000001",NA,NA,NA),density_class_code=c("1","1",NA,NA,NA),
    littoral_code=c("C","NC",NA,NA,NA),stringsAsFactors=FALSE)
  dir <- tempfile("aedar-littoral-publication-"); on.exit(unlink(dir,recursive=TRUE),add=TRUE)
  # #1154: a real reference content version is a 32-hex token (the published
  # classification content version), not a 64-hex digest. The producer's
  # littoral identity field must carry exactly this value and the manifest
  # validator must accept it.
  reference_content_version <- "ec2d980c88a9401441cd1e934fde0411"
  result <- project_aedar_comparison_publication(projection,density_source,refs,
    reference_content_version=reference_content_version,directory=dir,
    littoral_source=aedar_littoral_test_source_artifact())
  identity_values <- jsonlite::fromJSON(result$input_identity)
  expect_identical(as.character(identity_values$littoral_classification_content_version),reference_content_version)
  expect_identical(result$density_class_summaries$class_count,1L)
  expect_false("C"%in%unique(as.character(nanoparquet::read_parquet(file.path(dir,result$density_class_summaries$path))$group_id)))
  expect_identical(result$littoral_summaries$row_count,2L*nrow(aedar_aggregate_reading_bindings()))
  expect_identical(result$littoral_summaries$status_count,2L)
  groups <- nanoparquet::read_parquet(file.path(dir,result$parts[[1L]]$groups))
  expect_setequal(unique(groups$comparison_context[groups$comparison_context=="littoral"]),"littoral")
  expect_true(all(groups$statistic[groups$comparison_context=="littoral"]=="pooled"))
  # A reference whose C/NC classification no longer matches the pooled artifact
  # fails closed instead of silently borrowing another group.
  stale <- refs; stale$littoral_code[stale$territory_id=="22001"] <- "NC"
  expect_error(project_aedar_comparison_publication(projection,density_source,stale,
    reference_content_version=reference_content_version,directory=tempfile("x"),
    littoral_source=aedar_littoral_test_source_artifact()),"membership|disagrees")
})
