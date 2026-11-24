# Slow tier (#1172): full 235-TYPEQU × 312-measure comparison publications and round trips.
# Subject files: pipeline/R/aedar_aggregates.R, pipeline/tests/testthat/helper-aedar-fixtures.R
# Run from pipeline/: Rscript -e "pkgload::load_all('.', quiet=TRUE); testthat::test_file('slow-tests/test-aedar-aggregates-whole-payload.R', package='lusk')"

source(file.path(pkgload::pkg_path(), "tests", "testthat", "helper-aedar-fixtures.R"))

# Contract: comparison publication consumes the materialized density artefact, never address rows, and installs atomically.
test_that("comparison publication consumes materialized density facts without recomputing address rows", {
  withr::local_dir(file.path(pkgload::pkg_path(), "tests", "testthat"))
  axis <- read_aedar_typequ_registry()
  registry <- registre_classes_densite()
  codes <- as.character(registry[["classe_densite_code"]])
  ref <- list(crosswalk=data.frame(code_insee=c("22001",paste0("unused",2:7)),
      density_class_code=codes,density_class_label=as.character(registry[["classe_densite_libelle_public"]]),
      stringsAsFactors=FALSE),identity=MANIFEST_CLASSES_DENSITE[["id"]][[1L]],
    sha256=MANIFEST_CLASSES_DENSITE[["sha256"]][[1L]],vintage=MANIFEST_CLASSES_DENSITE[["vintage"]][[1L]])
  grid <- expand.grid(density_class_code=codes,TYPEQU=axis$TYPEQU,stringsAsFactors=FALSE)
  density <- data.frame(territory_type="density_class",territory_id=grid$density_class_code,
    density_class_code=grid$density_class_code,
    density_class_label=ref$crosswalk$density_class_label[match(grid$density_class_code,codes)],
    TYPEQU=grid$TYPEQU,LIB_TYPEQU=axis$LIB_TYPEQU[match(grid$TYPEQU,axis$TYPEQU)],
    n_addresses=1L,n_observed=1L,coverage_status="covered",source_snapshot_id=AEDAR_AGGREGATE_VINTAGE,
    density_reference_identity=ref$identity,density_reference_sha256=ref$sha256,
    density_reference_vintage=ref$vintage,input_content_version="",input_identity="",
    content_version=paste(rep("b",64),collapse=""),stringsAsFactors=FALSE)
  for (measure in AEDAR_AGGREGATE_MEASURES) density[[measure]] <- 1
  hashes <- c(stats::setNames(rep(paste(rep("1",64),collapse=""),length(AEDAR_ADDRESS_SOURCE_MODES)),
    paste0("mode:",AEDAR_ADDRESS_SOURCE_MODES)),address_origins=paste(rep("2",64),collapse=""),
    density_reference=ref$sha256)
  density$input_identity <- as.character(jsonlite::toJSON(as.list(hashes),auto_unbox=TRUE))
  density$input_content_version <- paste(as.character(openssl::sha256(charToRaw(density$input_identity[[1L]]))),collapse="")
  density <- set_aedar_density_fixture_content_version(density)
  source <- list(facts=density,density_reference=ref,input_hashes=hashes,
    crosswalk=ref$crosswalk,
    input_content_version=density$input_content_version[[1L]],content_version=density$content_version[[1L]],
    artifact_sha256=paste(rep("c",64),collapse=""),source_snapshot_id=AEDAR_AGGREGATE_VINTAGE)
  projection <- project_aedar_aggregates(make_aedar_test_inputs(),make_aedar_test_typequ_metadata())
  refs <- data.frame(territory_type=c("commune","epci","departement","region"),
    territory_id=c("22001","200000001","22","53"),epci_id=c("200000001",NA,NA,NA),
    density_class_code=c("1",NA,NA,NA),stringsAsFactors=FALSE)
  local_mocked_bindings(project_aedar_density_comparisons=function(...) stop("must consume artifact facts, not recompute"))
  dir <- tempfile("aedar-streamed-comparison-"); on.exit(unlink(dir,recursive=TRUE),add=TRUE)
  result <- project_aedar_comparison_publication(projection,source,refs,
    reference_content_version="published-ref-v1",directory=dir)
  expect_invisible(validate_aedar_comparison_manifest(result,dir))
  expect_true("density_artifact"%in%names(jsonlite::fromJSON(result$input_identity)))
  expect_equal(length(result$parts),AEDAR_TYPEQU_REGISTRY_COUNT)
  expected_reference_rows <- (length(unique(refs$density_class_code[
    !is.na(refs$density_class_code)])) +
    length(unique(refs$territory_type[refs$territory_type %in% c("epci","departement")]))) *
    nrow(axis) * length(AEDAR_AGGREGATE_MEASURES)
  expect_equal(result$group_row_count,expected_reference_rows)
  expect_equal(result$territory_row_count,0)
  density_summaries <- as.data.frame(nanoparquet::read_parquet(file.path(dir,
    result$density_class_summaries$path)),stringsAsFactors=FALSE)
  expect_equal(result$density_class_summaries$row_count,
    length(unique(refs$density_class_code[!is.na(refs$density_class_code)]))*
      nrow(aedar_aggregate_reading_bindings()))
  expect_equal(result$density_class_summaries$typequ_count,nrow(axis))
  expect_equal(nrow(density_summaries),result$density_class_summaries$row_count)
  stale_typequ_count <- result
  stale_typequ_count$density_class_summaries$typequ_count <- nrow(axis)-1L
  stale_typequ_count$content_version <- aedar_comparison_manifest_version(stale_typequ_count)
  expect_error(validate_aedar_comparison_manifest(stale_typequ_count,dir,verify_parts=FALSE),
    "density summary descriptor is malformed")
  pooled <- density_summaries[density_summaries$group_id==codes[[1L]],]
  expect_equal(nrow(pooled),nrow(aedar_aggregate_reading_bindings()))
  expect_true(all(pooled$status=="available" & pooled$value==AEDAR_TYPEQU_REGISTRY_COUNT))
  expect_true(all(pooled$n_addresses==1L & pooled$n_observed==AEDAR_TYPEQU_REGISTRY_COUNT))
  expect_true(all(pooled$n_observed>pooled$n_addresses))
  expect_true(all(pooled$source_id==projection$source$source_id & pooled$vintage==projection$source$vintage))
  a104 <- result$parts[[match("A104",vapply(result$parts,`[[`,character(1),"TYPEQU"))]]
  groups <- nanoparquet::read_parquet(file.path(dir,a104$groups))
  expect_equal(unique(groups$statistic[groups$comparison_context=="density_class"]),"pooled")
  expect_false("epci" %in% groups$comparison_context)
  expect_equal(unique(groups$statistic[groups$comparison_context=="same_level"]),"median")
  expect_identical(result$reference_content_version,"published-ref-v1")
  expect_true(all(vapply(result$parts,function(p)identical(basename(p$groups),paste0(p$TYPEQU,"-groups.parquet")),logical(1))))
  stable_version <- result$content_version
  repeated <- project_aedar_comparison_publication(projection,source,refs,
    reference_content_version="published-ref-v1",directory=dir)
  expect_identical(repeated$content_version,stable_version)
  manifest_path <- file.path(dir,"aedar_comparison_manifest.json")
  prior_manifest <- readBin(manifest_path,"raw",n=file.info(manifest_path)$size)
  legacy_manifest <- jsonlite::fromJSON(manifest_path,simplifyVector=FALSE)
  legacy_manifest$schema_version <- 1L
  writeLines(as.character(jsonlite::toJSON(legacy_manifest,auto_unbox=TRUE,dataframe="rows",
    null="null",digits=NA,pretty=FALSE)),manifest_path,useBytes=TRUE)
  expect_error(read_aedar_comparison_canonical(dir),"Legacy AEDAR peer/rank artifact is incompatible")
  writeBin(prior_manifest,manifest_path)
  failing_metadata <- repeated[c("source_snapshot_id","aedar_content_version","reference_content_version",
    "input_content_version","input_identity","membership","typequ_axis","typequ_axis_sha256")]
  failing_metadata$density_class_summaries <- density_summaries
  expect_error(write_aedar_comparison_canonical(function(code) stop("forced partition failure"),dir,
    failing_metadata),"forced partition failure")
  expect_identical(readBin(manifest_path,"raw",n=file.info(manifest_path)$size),prior_manifest)
  existing_part_builder <- function(code) {
    part<-repeated$parts[[match(code,vapply(repeated$parts,`[[`,character(1),"TYPEQU"))]]
    list(groups=nanoparquet::read_parquet(file.path(dir,part$groups)),
      territories=nanoparquet::read_parquet(file.path(dir,part$territories)))
  }
  local_mocked_bindings(install_aedar_comparison_manifest=function(staged,target)
    stop("forced atomic manifest replacement failure"))
  expect_error(write_aedar_comparison_canonical(existing_part_builder,dir,failing_metadata),
    "forced atomic manifest replacement failure")
  expect_identical(readBin(manifest_path,"raw",n=file.info(manifest_path)$size),prior_manifest)
  stored_part <- repeated$parts[[1L]]$groups
  stored_path <- file.path(dir,stored_part)
  saved_part <- readBin(stored_path,"raw",n=file.info(stored_path)$size)
  writeBin(as.raw(c(1,2,3)),stored_path)
  expect_error(read_aedar_comparison_canonical(dir))
  writeBin(saved_part,stored_path)
  expect_identical(read_aedar_comparison_canonical(dir)$content_version,stable_version)
})

# Contract: fixed AEDAR references preserve pooled density/same-level medians, complete TYPEQU coverage and immutable round trips.
test_that("AEDAR fixed references keep pooled density and same-level medians without peer rows", {
  withr::local_dir(file.path(pkgload::pkg_path(), "tests", "testthat"))
  measures<-AEDAR_AGGREGATE_MEASURES; axis<-read_aedar_typequ_registry()$TYPEQU
  ids<-c(as.character(1:4),"E1","E2","22","53")
  types<-c(rep("commune",4),"epci","epci","departement","region")
  facts<-as.data.frame(matrix(0,nrow=length(ids)*length(axis),ncol=length(measures),dimnames=list(NULL,measures)))
  facts$territory_id<-rep(ids,each=length(axis)); facts$territory_type<-rep(types,each=length(axis))
  facts$TYPEQU<-rep(axis,times=length(ids)); facts$n_addresses<-1; facts$n_observed<-1; facts$coverage_status<-"covered"
  special<-facts$TYPEQU=="A104"
  facts$count_5_walk_mean[special&facts$territory_id%in%as.character(1:4)]<-c(9,9,5,NA_real_)
  facts$count_5_walk_mean[special&facts$territory_id=="E1"]<-8
  facts$count_5_walk_mean[special&facts$territory_id=="E2"]<-4
  refs <- data.frame(territory_type=types, territory_id=ids,
    epci_id=c("E1","E1","E2","E2",NA,NA,NA,NA),
    density_class_code=c("1","1","1","1",NA,NA,NA,NA), stringsAsFactors=FALSE)
  density<-as.data.frame(matrix(7,nrow=length(axis),ncol=length(measures),dimnames=list(NULL,measures)))
  density$territory_id<-"1"; density$TYPEQU<-axis; density$n_addresses<-12; density$n_observed<-9; density$coverage_status<-"covered"
  result <- project_aedar_fixed_comparisons(facts, refs, "aedar-v1", "ref-v1",density)
  # AEDAR fixed publication contains comparison references only. EPCI and
  # Bretagne values remain in the source-grain aggregate and are not copied
  # into a second group projection; no per-commune peer/rank rows are emitted.
  expect_equal(nrow(result$territories), 0L)
  expect_setequal(unique(result$groups$comparison_context), c("density_class", "same_level"))
  expect_true(all(is.na(result$groups$n_addresses[result$groups$statistic == "median"])))
  expect_true(all(is.na(result$groups$n_observed[result$groups$statistic == "median"])))
  expect_equal(subset(result$groups,comparison_context=="density_class" & TYPEQU=="A104" &
    measure=="count_5_walk_mean")$value, 7)
  commune_density_values<-subset(facts,territory_type=="commune" & TYPEQU=="A104")$count_5_walk_mean
  expect_equal(stats::median(commune_density_values,na.rm=TRUE),9)
  expect_false(identical(subset(result$groups,comparison_context=="density_class" & TYPEQU=="A104" &
    measure=="count_5_walk_mean")$value,stats::median(commune_density_values,na.rm=TRUE)))
  expect_equal(subset(facts,territory_type=="epci" & territory_id=="E1" & TYPEQU=="A104")$count_5_walk_mean, 8)
  expect_equal(subset(facts,territory_type=="region" & territory_id=="53" & TYPEQU=="A104")$count_5_walk_mean, 0)
  expect_equal(nrow(result$groups),3L*length(axis)*length(measures))
  expect_equal(nrow(result$territories),0L)
  expect_false(any(c("rank","rank_size","member_count","eligible_count","missing_count") %in% names(result$groups)))
  expect_equal(subset(result$groups,comparison_context=="same_level"&territory_type=="epci"&TYPEQU=="A104"&measure=="count_5_walk_mean")$value,6)
  expect_equal(subset(result$groups,comparison_context=="density_class"&TYPEQU=="A104"&measure=="count_5_walk_mean")$value,7)
  expect_equal(unique(result$groups$statistic[result$groups$comparison_context=="density_class"]),"pooled")
  expect_equal(unique(result$groups$statistic[result$groups$comparison_context=="same_level"]),"median")
  median_rows<-result$groups$statistic=="median"
  expect_true(all(is.na(result$groups$n_addresses[median_rows])))
  expect_true(all(is.na(result$groups$n_observed[median_rows])))
  expect_true(all(is.na(result$groups$coverage_status[median_rows])))
  expect_true(all(c("density_class","same_level") %in% result$groups$comparison_context))
  expect_setequal(unique(result$groups$territory_type[result$groups$comparison_context=="same_level"]),c("epci","departement"))
  expect_setequal(unique(result$groups$measure),AEDAR_AGGREGATE_MEASURES)
  expect_true(validate_aedar_comparison_membership(result,refs))
  missing_typequ<-subset(result$groups,TYPEQU!=axis[[1L]])
  expect_error(validate_aedar_comparison_projection(within(result,groups<-missing_typequ)),"full TYPEQU")
  stale_refs<-refs; stale_refs$density_class_code[stale_refs$territory_id=="1"]<-"changed"
  expect_error(validate_aedar_comparison_membership(result,stale_refs),"contexts/groups differ")
  dir<-tempfile("aedar-comparison-roundtrip-")
  write_aedar_comparison_fixture(result,dir)
  restored<-read_aedar_comparison_fixture(dir)
  expect_equal(restored$groups,result$groups)
  expect_equal(restored$territories,result$territories)
  expect_identical(restored$content_version,result$content_version)
  tampered<-result; tampered$input_identity<-'{"address_origins":"different"}'
  tampered$groups$input_identity<-tampered$input_identity
  expect_error(validate_aedar_comparison_projection(tampered),"content version|provenance hash")
  before<-tools::md5sum(file.path(dir,c("fixture-groups.parquet","fixture-territories.parquet")))
  invalid<-result; invalid$groups$statistic[1]<-"median"; invalid$groups$n_addresses[1]<-1
  expect_error(write_aedar_comparison_fixture(invalid,dir),"Invalid AEDAR reference comparison keys")
  expect_identical(unname(tools::md5sum(file.path(dir,c("fixture-groups.parquet","fixture-territories.parquet")))),unname(before))

test_that("density-only Parquet builder pools addresses and publishes the complete domain", {
  skip_if_not_installed("nanoparquet")
  skip_if_not_installed("arrow")
  axis <- read_aedar_typequ_registry()
  dir <- tempfile("aedar-density-only-"); dir.create(dir)
  on.exit(unlink(dir,recursive=TRUE),add=TRUE)
  origins_path <- file.path(dir,"origins.parquet")
  nanoparquet::write_parquet(data.frame(address_id=c("a","b","c","d","e","f","g"),
    code_insee=c("c1","c1","c2","c2","c2","c3","c3"),lon=1:7,lat=1:7),origins_path)
  mode_paths <- stats::setNames(vapply(AEDAR_ADDRESS_SOURCE_MODES,function(mode) file.path(dir,paste0(mode,".parquet")),character(1)),
    AEDAR_ADDRESS_SOURCE_MODES)
  keys <- list(walk=data.frame(code_insee=c("c1","c1","c2"),cle_interop_adr=c("a","b","c"),TYPEQU="A104"),
    transit=data.frame(code_insee=c("c1","c2"),cle_interop_adr=c("b","e"),TYPEQU="A104"),
    transit_gain=data.frame(code_insee=c("c1","c1","c3","c3"),cle_interop_adr=c("a","b","f","g"),TYPEQU="A104"))
  for(mode in AEDAR_ADDRESS_SOURCE_MODES) {
    x <- keys[[mode]]
    if(is.null(x)) x <- data.frame(code_insee=character(),cle_interop_adr=character(),TYPEQU=character())
    for(column in AEDAR_ADDRESS_SOURCE_COLUMNS[[mode]]) x[[column]] <- rep(0,nrow(x))
    if(mode=="walk"&&nrow(x)) x$count_5_walk <- c(1,3,9)
    if(mode=="transit_gain"&&nrow(x)) x$count_5_transit_gain_p1 <- c(-4,-2,-4,-2)
    nanoparquet::write_parquet(x,mode_paths[[mode]])
  }
  crosswalk <- data.frame(code_insee=c("c1","c2","c3","c4"),density_class_code=c("pooled","pooled","negative","empty"),
    density_class_label=c("Pooled","Pooled","Negative","Empty"),stringsAsFactors=FALSE)
  output_path <- file.path(dir,"density.parquet")
  local_mocked_bindings(project_aedar_aggregates=function(...) stop("territorial aggregate projection must not run"))
  result <- build_aedar_density_aggregate(mode_paths,origins_path,crosswalk,
    "classe_densite_communale",paste(rep("a",64),collapse=""),"test-vintage",output_path,
    verify_hashes=FALSE)
  expect_true(file.exists(output_path))
  expect_equal(nrow(result),3L*nrow(axis))
  expect_true(all(AEDAR_AGGREGATE_MEASURES%in%names(result)))
  pooled <- result[result$density_class_code=="pooled"&result$TYPEQU=="A104",,drop=FALSE]
  expect_equal(pooled$n_addresses,5)
  expect_equal(pooled$n_observed,4)
  expect_equal(pooled$count_5_walk_mean,13/5)
  expect_equal(pooled$count_5_walk_min,0)
  expect_equal(pooled$count_5_walk_max,9)
  negative <- result[result$density_class_code=="negative"&result$TYPEQU=="A104",,drop=FALSE]
  expect_equal(negative$count_5_transit_gain_min,-4)
  expect_equal(negative$count_5_transit_gain_max,-2)
  covered_unseen <- result[result$density_class_code=="pooled"&result$TYPEQU=="A105",,drop=FALSE]
  expect_equal(covered_unseen$count_5_walk_mean,0)
  uncovered <- result[result$density_class_code=="empty"&result$TYPEQU=="A104",,drop=FALSE]
  expect_equal(uncovered$coverage_status,"uncovered_no_address_origins")
  expect_true(is.na(uncovered$count_5_walk_mean))
  expect_equal(unique(result$density_reference_identity),"classe_densite_communale")
  expect_equal(unique(result$density_reference_sha256),paste(rep("a",64),collapse=""))
  expect_equal(unique(result$density_reference_vintage),"test-vintage")
  expect_true(all(nzchar(result$input_content_version)))
  identity <- jsonlite::fromJSON(unique(result$input_identity))
  expect_setequal(names(identity),c("address_origins","density_reference",paste0("mode:",AEDAR_ADDRESS_SOURCE_MODES)))
  expect_true(all(result$source_snapshot_id==AEDAR_AGGREGATE_VINTAGE))
  restored <- nanoparquet::read_parquet(output_path)
  expect_equal(restored$count_5_walk_mean[restored$density_class_code=="pooled"&restored$TYPEQU=="A104"],13/5)
})

})
