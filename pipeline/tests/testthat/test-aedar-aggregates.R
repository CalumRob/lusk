read_aedar_region_typequ_fixture <- function() {
  readr::read_csv(testthat::test_path("fixtures","aedar-region-2026v1-typequ.csv"),
    col_types=readr::cols(.default=readr::col_character()),trim_ws=FALSE,show_col_types=FALSE)
}

make_aedar_test_typequ_metadata <- function() {
  axis <- read_aedar_typequ_registry()
  i <- seq_len(nrow(axis))
  domain <- ((i-1L) %% 27L) %% 7L + 1L
  data.frame(TYPEQU=axis$TYPEQU,LIB_TYPEQU=axis$LIB_TYPEQU,description=paste("Description",i),
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

set_aedar_density_fixture_content_version <- function(facts) {
  columns<-c("territory_type","territory_id","density_class_code","density_class_label",
    "TYPEQU","LIB_TYPEQU","n_addresses","n_observed","coverage_status",AEDAR_AGGREGATE_MEASURES,
    "source_snapshot_id","density_reference_identity","density_reference_sha256",
    "density_reference_vintage","input_content_version","input_identity")
  facts$content_version<-paste(as.character(openssl::sha256(serialize(facts[columns],NULL))),collapse="")
  facts
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

test_that("AEDAR fixed comparison inventory is complete and excludes custom groups", {
  expect_equal(AEDAR_FIXED_COMPARISON_SCOPES,
    list(commune=c("densite", "epci", "bretagne"), epci="epci", departement="departement"))
  expect_false(any(grepl("custom|arbitrary", unlist(AEDAR_FIXED_COMPARISON_SCOPES))))
  adr <- paste(readLines(testthat::test_path("..","..","..","docs","adr",
    "0039-published-comparison-aggregates.md"),warn=FALSE),collapse="\n")
  expect_match(adr,"commune choices \\(density class, EPCI, Bretagne\\)")
  expect_match(adr,"AEDAR's existing EPCI and Bretagne comparisons continue to use their direct")
  expect_match(adr,"Explicit arbitrary territory selections remain request-time")
})

test_that("density cohort pools distinct address facts and fills sparse zeros across TYPEQU", {
  axis <- read_aedar_region_typequ_fixture()
  spine <- data.frame(address_id=c("a", "b", "c"), commune=c("1", "1", "2"),
    stringsAsFactors=FALSE)
  membership <- data.frame(territory_id="1", member_commune=c("1", "2"),
    territory_type="commune", context="densite", stringsAsFactors=FALSE)
  facts <- data.frame(address_id=c("a", "a", "b"), TYPEQU=c("A104", "A104", "A104"),
    count_5_walk=c(1, 2, 4), count_5_transit_gain_p1=c(-1,3,0), stringsAsFactors=FALSE)
  facts <- facts[!duplicated(facts[c("address_id", "TYPEQU")]), , drop=FALSE]
  result <- project_aedar_density_comparisons(spine, facts, membership, axis,
    measures=c("count_5_walk","count_5_transit_gain"))
  row <- result[result$TYPEQU == "A104", ]
  expect_equal(row$n_addresses, 3)
  expect_equal(row$count_5_walk_mean, 5/3)
  expect_equal(row$count_5_walk_share, 2/3)
  expect_equal(row$count_5_walk_min,0)
  expect_equal(row$count_5_walk_max,4)
  expect_equal(row$count_5_walk_decile1,.2)
  expect_equal(row$count_5_walk_decile9,3.4)
  expect_equal(row$count_5_transit_gain_share,1/3)
  expect_equal(row$count_5_transit_gain_mean,-1/3)
  expect_equal(row$n_observed, 2)
  expect_equal(nrow(result), nrow(axis))
  expect_true(all(result$count_5_walk_mean[result$TYPEQU != "A104"] == 0))
})

test_that("density cohort without address origins is uncovered and null", {
  axis <- read_aedar_region_typequ_fixture()
  result <- project_aedar_density_comparisons(
    data.frame(address_id=character(), commune=character()),
    data.frame(address_id=character(), TYPEQU=character(), count_5_walk=numeric()),
    data.frame(territory_id="empty", member_commune="none", territory_type="commune", context="densite"),
    axis, measures="count_5_walk")
  expect_true(all(result$coverage_status == "uncovered_no_address_origins"))
  expect_true(all(is.na(result$count_5_walk_mean)))
})

test_that("density transit-gain max includes only observed or implicit zeros", {
  axis <- read_aedar_region_typequ_fixture()
  membership <- data.frame(territory_id="density",member_commune="1",
    territory_type="commune",context="densite",stringsAsFactors=FALSE)
  full_origins <- data.frame(address_id=c("a","b"),commune="1",stringsAsFactors=FALSE)
  full_facts <- data.frame(address_id=c("a","b"),TYPEQU="A104",
    count_5_transit_gain_p1=c(-4,-2),stringsAsFactors=FALSE)
  full <- project_aedar_density_comparisons(full_origins,full_facts,membership,axis,
    measures="count_5_transit_gain")
  full_row <- full[full$TYPEQU=="A104",,drop=FALSE]
  expect_equal(full_row$count_5_transit_gain_min,-4)
  expect_equal(full_row$count_5_transit_gain_max,-2)

  sparse_origins <- rbind(full_origins,data.frame(address_id="c",commune="1"))
  sparse <- project_aedar_density_comparisons(sparse_origins,full_facts,membership,axis,
    measures="count_5_transit_gain")
  sparse_row <- sparse[sparse$TYPEQU=="A104",,drop=FALSE]
  expect_equal(sparse_row$count_5_transit_gain_min,0)
  expect_equal(sparse_row$count_5_transit_gain_max,0)
})

test_that("materialized density artifact is pinned, complete, and carries its byte identity", {
  skip_if_not_installed("nanoparquet")
  registry <- registre_classes_densite()
  codes <- as.character(registry[["classe_densite_code"]])
  labels <- as.character(registry[["classe_densite_libelle_public"]])
  local_reference <- list(crosswalk=data.frame(code_insee=paste0("c",seq_along(codes)),
      density_class_code=codes,density_class_label=labels,stringsAsFactors=FALSE),
    identity="classe_densite_communale",sha256=paste(rep("a",64),collapse=""),vintage="fixture vintage")
  axis <- read_aedar_typequ_registry()
  grid <- expand.grid(density_class_code=codes,TYPEQU=axis$TYPEQU,stringsAsFactors=FALSE)
  facts <- data.frame(territory_type="density_class",territory_id=grid$density_class_code,
    density_class_code=grid$density_class_code,
    density_class_label=labels[match(grid$density_class_code,codes)],TYPEQU=grid$TYPEQU,
    LIB_TYPEQU=axis$LIB_TYPEQU[match(grid$TYPEQU,axis$TYPEQU)],n_addresses=1L,n_observed=0L,
    coverage_status="covered",source_snapshot_id=AEDAR_AGGREGATE_VINTAGE,
    density_reference_identity=local_reference$identity,density_reference_sha256=local_reference$sha256,
    density_reference_vintage=local_reference$vintage,input_content_version=rep("",nrow(grid)),input_identity=rep("",nrow(grid)),
    content_version=paste(rep("b",64),collapse=""),stringsAsFactors=FALSE)
  for (measure in AEDAR_AGGREGATE_MEASURES) facts[[measure]] <- 0
  identity <- c(stats::setNames(rep(paste(rep("1",64),collapse=""),length(AEDAR_ADDRESS_SOURCE_MODES)),
      paste0("mode:",AEDAR_ADDRESS_SOURCE_MODES)),address_origins=paste(rep("2",64),collapse=""),
    density_reference=local_reference$sha256)
  facts$input_identity <- as.character(jsonlite::toJSON(as.list(identity),auto_unbox=TRUE))
  facts$input_content_version <- paste(as.character(openssl::sha256(charToRaw(facts$input_identity[[1L]]))),collapse="")
  facts <- set_aedar_density_fixture_content_version(facts)
  path <- tempfile(fileext=".parquet"); on.exit(unlink(path),add=TRUE)
  nanoparquet::write_parquet(facts,path)
  loaded <- read_aedar_density_aggregate(path,local_reference)
  expect_equal(nrow(loaded$facts),7L*AEDAR_TYPEQU_REGISTRY_COUNT)
  expect_equal(loaded$artifact_sha256,sha256_aedar_file(path))
  expect_equal(loaded$content_version,unique(facts$content_version))
  expect_error(read_aedar_density_aggregate(file.path(dirname(path),"missing.parquet"),local_reference),"missing or empty")
  expect_error(read_aedar_density_aggregate(path,local_reference,paste(rep("c",64),collapse="")),"checksum mismatch")
  tampered <- facts[-1,,drop=FALSE]
  tampered_path <- tempfile(fileext=".parquet"); on.exit(unlink(tampered_path),add=TRUE)
  nanoparquet::write_parquet(tampered,tampered_path)
  expect_error(read_aedar_density_aggregate(tampered_path,local_reference),"omits a density class")
  altered <- facts
  altered$count_5_walk_mean[[1L]] <- 2
  altered_path <- tempfile(fileext=".parquet"); on.exit(unlink(altered_path),add=TRUE)
  nanoparquet::write_parquet(altered,altered_path)
  expect_error(read_aedar_density_aggregate(altered_path,local_reference),"content identity")
  stale_reference <- local_reference
  stale_reference$crosswalk$density_class_code[[1L]] <- codes[[2L]]
  expect_error(read_aedar_density_aggregate(path,stale_reference),"class axis is incomplete|mislabeled")
})

test_that("AEDAR materialized density membership is checked against the local source", {
  source <- list(crosswalk=data.frame(code_insee=c("c1","c2"),density_class_code=c("6","5"),
    density_class_label=c("Dense","Dense"),stringsAsFactors=FALSE))
  refs <- data.frame(territory_type=c("commune","commune"),territory_id=c("c1","c2"),
    density_class_code=c("6","5"),stringsAsFactors=FALSE)
  expect_invisible(validate_aedar_density_membership(source,refs))
  refs$density_class_code[[2L]] <- "6"
  expect_error(validate_aedar_density_membership(source,refs),"disagrees with the pinned local")
})

test_that("comparison publication consumes materialized density facts without recomputing address rows", {
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
  a104 <- result$parts[[match("A104",vapply(result$parts,`[[`,character(1),"TYPEQU"))]]
  groups <- nanoparquet::read_parquet(file.path(dir,a104$groups))
  expect_equal(unique(groups$statistic[groups$comparison_context=="density_class"]),"pooled")
  expect_equal(unique(groups$statistic[groups$comparison_context=="epci"]),"direct")
  expect_equal(unique(groups$statistic[groups$comparison_context=="same_level"]),"median")
  expect_identical(result$reference_content_version,"published-ref-v1")
  expect_true(all(vapply(result$parts,function(p)identical(basename(p$groups),paste0(p$TYPEQU,"-groups.parquet")),logical(1))))
  stable_version <- result$content_version
  repeated <- project_aedar_comparison_publication(projection,source,refs,
    reference_content_version="published-ref-v1",directory=dir)
  expect_identical(repeated$content_version,stable_version)
  manifest_path <- file.path(dir,"aedar_comparison_manifest.json")
  prior_manifest <- readBin(manifest_path,"raw",n=file.info(manifest_path)$size)
  failing_metadata <- repeated[c("source_snapshot_id","aedar_content_version","reference_content_version",
    "input_content_version","input_identity","membership","typequ_axis","typequ_axis_sha256")]
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

test_that("density-only Parquet builder pools addresses and publishes the complete domain", {
  skip_if_not_installed("nanoparquet")
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

test_that("AEDAR observed key union excludes derived transit_gain rows and deduplicates", {
  modes<-list(walk=data.frame(address_id=c("a","a"),TYPEQU=c("A104","A104")),
    transit=data.frame(address_id="b",TYPEQU="A104"),
    transit_gain=data.frame(address_id="c",TYPEQU="A104"))
  expect_equal(aedar_observed_address_type_keys(modes),
    data.frame(address_id=c("a","b"),TYPEQU=c("A104","A104")))
})

test_that("AEDAR sparse mode tables combine by address/TYPEQU without losing source count fields", {
  modes<-stats::setNames(lapply(AEDAR_ADDRESS_SOURCE_MODES,function(mode) {
    x<-as.data.frame(as.list(stats::setNames(rep(1,4),AEDAR_ADDRESS_SOURCE_COLUMNS[[mode]])))
    x$code_insee<-"22001"; x$cle_interop_adr<-"a"; x$TYPEQU<-"A104"; x
  }),AEDAR_ADDRESS_SOURCE_MODES)
  combined<-combine_aedar_address_mode_facts(modes)
  expect_equal(nrow(combined),1)
  expect_true(all(unlist(AEDAR_ADDRESS_SOURCE_COLUMNS)%in%names(combined)))
  expect_equal(combined$address_id,aedar_address_identity("22001","a"))
  expect_equal(nrow(aedar_observed_address_type_keys(modes)),1)
})

test_that("AEDAR comparison inputs load registered sparse modes and configured origin spine", {
  dir <- tempfile("aedar-address-inputs-"); dir.create(dir)
  modes <- stats::setNames(lapply(AEDAR_ADDRESS_SOURCE_MODES, function(mode) {
    x <- as.data.frame(as.list(stats::setNames(rep(1,4), AEDAR_ADDRESS_SOURCE_COLUMNS[[mode]])))
    x$code_insee <- "22001"; x$cle_interop_adr <- "addr-1"; x$TYPEQU <- "A104"; x
  }), AEDAR_ADDRESS_SOURCE_MODES)
  paths <- stats::setNames(vapply(names(modes), function(mode) {
    path <- file.path(dir,paste0(mode,".parquet")); nanoparquet::write_parquet(modes[[mode]],path); path
  }, character(1)), names(modes))
  spine_path <- file.path(dir,"origins.parquet")
  nanoparquet::write_parquet(data.frame(address_id="addr-1",code_insee="22001",lon=1,lat=2),spine_path)
  loaded <- read_aedar_comparison_inputs(paths,spine_path,verify_hashes=FALSE)
  expect_equal(nrow(loaded$address_origins),1)
  expect_equal(loaded$address_origins$commune,"22001")
  expect_equal(nrow(loaded$address_facts),1)
  expect_true(nzchar(loaded$input_content_version))
  expect_true(identical(loaded$source_snapshot_id,"2026-v1"))
  expect_equal(loaded$address_facts$count_5_transit_p1,1)
  expect_equal(loaded$address_facts$count_5_transit_gain_p1,1)
  identity_before<-loaded$input_content_version
  changed<-modes$walk; changed$count_5_walk<-2
  nanoparquet::write_parquet(changed,paths[["walk"]])
  expect_false(identical(read_aedar_comparison_inputs(paths,spine_path,verify_hashes=FALSE)$input_content_version,identity_before))
  duplicate_spine<-file.path(dir,"duplicate-origins.parquet")
  nanoparquet::write_parquet(rbind(data.frame(address_id="addr-1",code_insee="22001",lon=1,lat=2),
    data.frame(address_id="addr-1",code_insee="22001",lon=1,lat=2)),duplicate_spine)
  expect_error(read_aedar_comparison_inputs(paths,duplicate_spine,verify_hashes=FALSE),"unique identity contract")
  expect_error(read_aedar_comparison_inputs(paths,file.path(dir,"missing.parquet"),verify_hashes=FALSE),
    "complete address-origin Parquet")
  missing_mode<-paths[-1]
  expect_error(read_aedar_comparison_inputs(missing_mode,spine_path,verify_hashes=FALSE),
    "All six registered")
})

test_that("AEDAR density projection covers all 235 TYPEQU and all 312 measure results", {
  address_origins<-data.frame(address_id=c("a","b"),commune=c("1","2"),stringsAsFactors=FALSE)
  membership<-data.frame(territory_type="commune",territory_id="1",member_commune=c("1","2"),context="densite")
  mode_facts<-stats::setNames(lapply(AEDAR_ADDRESS_SOURCE_MODES,function(mode) {
    fields<-AEDAR_ADDRESS_SOURCE_COLUMNS[[mode]]
    x<-as.data.frame(as.list(stats::setNames(rep(1,length(fields)),fields)))
    x$address_id<-"a"; x$TYPEQU<-"A104"; x
  }),AEDAR_ADDRESS_SOURCE_MODES)
  facts<-combine_aedar_address_mode_facts(mode_facts)
  result<-project_aedar_density_comparisons(address_origins,facts,membership,
    read_aedar_region_typequ_fixture(),observed_keys=aedar_observed_address_type_keys(mode_facts))
  expect_equal(nrow(result),AEDAR_TYPEQU_REGISTRY_COUNT)
  expect_setequal(grep("^count_",names(result),value=TRUE),AEDAR_AGGREGATE_MEASURES)
  expect_true(all(result$n_addresses==2))
  row<-result[result$TYPEQU=="A104",]
  expect_equal(row$count_5_walk_mean,0.5)
  expect_equal(row$count_5_walk_share,0.5)
})

test_that("AEDAR fixed ranks use eligible peers, competition ties, and higher-is-better", {
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
  expect_equal(nrow(result$groups),6L*length(axis)*length(measures))
  expect_equal(nrow(result$territories),15L*length(axis)*length(measures))
  peer <- subset(result$territories, comparison_context=="epci" & group_id=="E1" & TYPEQU=="A104" & measure=="count_5_walk_mean")
  expect_equal(peer$rank, c(1L,1L))
  expect_equal(peer$rank_size, c(2L,2L))
  density_ranks<-subset(result$territories,comparison_context=="density_class"&TYPEQU=="A104"&measure=="count_5_walk_mean"&territory_id%in%c("1","2","3"))
  expect_equal(density_ranks$rank,c(1L,1L,3L))
  expect_true(all(density_ranks$rank_size==3L))
  same_level_ranks<-subset(result$territories,comparison_context=="same_level"&territory_type=="epci"&TYPEQU=="A104"&measure=="count_5_walk_mean")
  expect_equal(same_level_ranks$rank,c(1L,2L))
  expect_equal(same_level_ranks$rank_size,c(2L,2L))
  expect_equal(subset(result$groups,comparison_context=="epci"&group_id=="E1"&TYPEQU=="A104"&measure=="count_5_walk_mean")$value,8)
  expect_equal(subset(result$groups,comparison_context=="same_level"&territory_type=="epci"&TYPEQU=="A104"&measure=="count_5_walk_mean")$value,6)
  expect_equal(subset(result$groups,comparison_context=="density_class"&TYPEQU=="A104"&measure=="count_5_walk_mean")$value,7)
  expect_equal(unique(result$groups$statistic[result$groups$comparison_context=="density_class"]),"pooled")
  expect_equal(unique(result$groups$statistic[result$groups$comparison_context=="epci"]),"direct")
  expect_equal(unique(result$groups$statistic[result$groups$comparison_context=="same_level"]),"median")
  expect_equal(subset(result$groups,comparison_context=="bretagne"&TYPEQU=="A104"&measure=="count_5_walk_mean")$value,0)
  expect_false("rank_ties" %in% names(result$territories))
  expect_true(all(c("density_class","epci","bretagne","same_level") %in% result$groups$comparison_context))
  expect_setequal(unique(result$groups$territory_type[result$groups$comparison_context=="same_level"]),c("epci","departement"))
  expect_setequal(unique(result$groups$measure),AEDAR_AGGREGATE_MEASURES)
  expect_true(validate_aedar_comparison_membership(result,refs))
  missing_typequ<-subset(result$groups,TYPEQU!=axis[[1L]])
  expect_error(validate_aedar_comparison_projection(within(result,groups<-missing_typequ)),"full TYPEQU")
  missing_territory_typequ<-result
  missing_territory_typequ$territories<-missing_territory_typequ$territories[
    missing_territory_typequ$territories$TYPEQU!=axis[[1L]],,drop=FALSE]
  expect_error(validate_aedar_comparison_projection(missing_territory_typequ),"full TYPEQU")
  stale_refs<-refs; stale_refs$density_class_code[stale_refs$territory_id=="1"]<-"changed"
  expect_error(validate_aedar_comparison_membership(result,stale_refs),"contexts/groups differ")
  dir<-tempfile("aedar-comparison-roundtrip-")
  write_aedar_comparison_fixture(result,dir)
  restored<-read_aedar_comparison_fixture(dir)
  expect_equal(restored$groups,result$groups)
  expect_equal(restored$territories,result$territories)
  expect_identical(restored$content_version,result$content_version)
  tampered<-result; tampered$input_identity<-'{"address_origins":"different"}'
  tampered$groups$input_identity<-tampered$input_identity; tampered$territories$input_identity<-tampered$input_identity
  expect_error(validate_aedar_comparison_projection(tampered),"content version|provenance hash")
  before<-tools::md5sum(file.path(dir,c("fixture-groups.parquet","fixture-territories.parquet")))
  invalid<-result; invalid$territories$rank[1]<-NA_integer_
  expect_error(write_aedar_comparison_fixture(invalid,dir),"Invalid AEDAR comparison rank contract")
  expect_identical(unname(tools::md5sum(file.path(dir,c("fixture-groups.parquet","fixture-territories.parquet")))),unname(before))
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
  expect_identical(restored$typequ_metadata$description,metadata$description)
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
  c401 <- match("C401",metadata$TYPEQU)
  metadata$LIB_TYPEQU[c401] <- sub(" ","\n",metadata$LIB_TYPEQU[c401],fixed=TRUE)
  expect_equal(nrow(validate_aedar_published_typequ_metadata(metadata)),235L)
  expect_identical(validate_aedar_published_typequ_metadata(metadata)$LIB_TYPEQU[c401],metadata$LIB_TYPEQU[c401])
  other_newline <- metadata
  other <- match("A135",other_newline$TYPEQU)
  other_newline$LIB_TYPEQU[other] <- sub(" ","\n",other_newline$LIB_TYPEQU[other],fixed=TRUE)
  expect_error(validate_aedar_published_typequ_metadata(other_newline),"canonical registry")
  projection <- project_aedar_aggregates(make_aedar_test_inputs(),metadata)
  expect_equal(nrow(projection$typequ_metadata),235L)
  expect_equal(nrow(projection$facts),4L*235L)
})

test_that("AEDAR operator uses canonical aggregate and bounded comparison manifest", {
  script <- paste(readLines(testthat::test_path("..","..","scripts","publish-aedar-aggregates.R"),warn=FALSE),collapse="\n")
  expect_match(script,"write_aedar_canonical\\(projection,canonical_dir\\)")
  expect_match(script,"projection <- read_aedar_canonical\\(canonical_dir\\)")
  expect_match(script,"publish_aedar_aggregates\\(projection,con\\)")
  expect_match(script,"read_aedar_comparison_canonical\\(canonical_dir,verify_parts=FALSE\\)")
  expect_match(script,"read_aedar_density_aggregate\\(density_path,density_reference\\)")
  expect_match(script,"LUSK_AEDAR_DENSITY_AGGREGATE")
  expect_false(grepl("read_aedar_comparison_inputs",script,fixed=TRUE))
  expect_match(script,"project_aedar_comparison_publication\\(")
  expect_match(script,"project_aedar_comparison_publication\\(projection,density_source")
  source <- paste(readLines(testthat::test_path("..","..","R","aedar_aggregates.R"),warn=FALSE),collapse="\n")
  expect_match(source,"typequ_codes=typequ,calculate_content_version=FALSE")
  expect_match(source,"aedar_comparison_manifest.json")
  expect_match(script,"publish_aedar_comparisons\\(comparison_projection,con\\)")
  expect_gt(regexpr("write_aedar_canonical\\(projection,canonical_dir\\)",script)[[1]],0)
  expect_gt(regexpr("projection <- read_aedar_canonical\\(canonical_dir\\)",script)[[1]],0)
  expect_match(script,"Canonical AEDAR Parquets are missing; run --check first")
  expect_match(script,"LUSK_PUBLISH_AEDAR")
  expect_match(script,"disabled for cron")
})

test_that("AEDAR production comparison publication is partition-bounded without legacy fallback", {
  source <- paste(readLines(testthat::test_path("..","..","R","aedar_aggregates.R"),warn=FALSE),collapse="\n")
  publisher <- substring(source,regexpr("publish_aedar_comparisons <- function",source),
    regexpr("serialize_aedar_json_rows <- function",source)-1L)
  expect_match(publisher,"for\\(part in x\\$parts\\)")
  expect_match(publisher,"chunk_size<-20000L")
  expect_false(grepl("x\\$territories",publisher))
  empty <- tempfile("aedar-no-manifest-"); dir.create(empty)
  on.exit(unlink(empty,recursive=TRUE),add=TRUE)
  nanoparquet::write_parquet(data.frame(x=1),file.path(empty,"aedar_comparison_groups.parquet"))
  expect_error(read_aedar_comparison_canonical(empty),"manifest is missing")
})

test_that("AEDAR canonical output and database publication require complete TYPEQU metadata", {
  projection <- project_aedar_aggregates(make_aedar_test_inputs())
  expect_error(write_aedar_canonical(projection,tempfile("aedar-metadata-required-")),"requires TYPEQU metadata")
  expect_error(publish_aedar_aggregates(projection,NULL),"requires canonical TYPEQU metadata")
})
