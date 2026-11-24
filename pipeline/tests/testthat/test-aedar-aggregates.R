
test_that("density-class summary projection preserves the complete pooled reading law", {
  bindings <- aedar_aggregate_reading_bindings()
  source <- list(source_id="aedar_bretagne",vintage="2026-v1",url="https://example.test/aedar",
    licence="ODbL",attribution="AEDAR fixture",reference_date=NA_character_,publication_date="2026-09-30")
  facts <- expand.grid(territory_id=c("1","2"),TYPEQU=c("A","B"),stringsAsFactors=FALSE)
  facts$territory_type <- "density_class"
  facts$density_class_code <- facts$territory_id
  facts$n_addresses <- ifelse(facts$territory_id=="1",2L,0L)
  facts$n_observed <- ifelse(facts$territory_id=="1",2L,0L)
  facts$coverage_status <- ifelse(facts$territory_id=="1","covered","uncovered_no_address_origins")
  for (i in seq_len(nrow(bindings))) {
    base <- if(endsWith(bindings$underlying[[i]],"_share")) 0.75 else i/1000
    values <- ifelse(facts$territory_id=="1",base,NA_real_)
    facts[[bindings$underlying[[i]]]] <- values
  }

  projected <- project_aedar_density_class_summary(facts,source,registry_size=2L)
  expect_equal(nrow(projected),2L*nrow(bindings))
  expect_equal(projected$group_id[projected$measure==bindings$measure[[1L]]],c("1","2"))
  available <- projected[projected$group_id=="1",]
  unavailable <- projected[projected$group_id=="2",]
  expected <- vapply(seq_len(nrow(bindings)),function(i)
    sum(facts[facts$territory_id=="1",bindings$underlying[[i]]]),numeric(1))
  expect_equal(available$value,expected)
  expect_true(all(available$status=="available" & available$n_typequ==2L))
  expect_true(all(available$n_addresses==2L & available$n_observed==4L))
  expect_true(all(available$n_observed>available$n_addresses))
  expect_true(any(available$value>1 & endsWith(bindings$underlying[match(available$measure,
    bindings$measure)],"_share")))
  expect_true(all(available$coverage_status=="covered"))
  expect_true(all(unavailable$status=="unavailable" & is.na(unavailable$value) &
    is.na(unavailable$n_typequ) & unavailable$n_addresses==0L & unavailable$n_observed==0L &
    unavailable$coverage_status=="uncovered_no_address_origins"))
  expect_true(all(available$source_id==source$source_id & available$vintage==source$vintage))

  partial <- facts[facts$territory_id=="1" & facts$TYPEQU=="A",]
  partial_projection <- project_aedar_density_class_summary(partial,source,registry_size=2L)
  expect_true(all(partial_projection$status=="unavailable" & is.na(partial_projection$value) &
    is.na(partial_projection$n_typequ)))

  inconsistent <- facts[facts$territory_id=="1",]
  inconsistent$n_addresses[[2L]] <- 3L
  inconsistent_projection <- project_aedar_density_class_summary(inconsistent,source,registry_size=2L)
  expect_true(all(inconsistent_projection$status=="unavailable" & is.na(inconsistent_projection$value) &
    is.na(inconsistent_projection$n_addresses) & inconsistent_projection$n_observed==4L))

  missing_observation <- facts[facts$territory_id=="1",]
  missing_observation$n_observed[[2L]] <- NA_integer_
  missing_projection <- project_aedar_density_class_summary(missing_observation,source,registry_size=2L)
  expect_true(all(missing_projection$status=="unavailable" & is.na(missing_projection$value) &
    missing_projection$n_addresses==2L & missing_projection$n_observed==2L))

  invalid_share <- facts[facts$territory_id=="1",]
  share_underlying <- bindings$underlying[endsWith(bindings$underlying,"_share")][[1L]]
  invalid_share[[share_underlying]][[1L]] <- 1.01
  invalid_projection <- project_aedar_density_class_summary(invalid_share,source,registry_size=2L)
  invalid_measure <- bindings$measure[match(share_underlying,bindings$underlying)]
  expect_true(all(invalid_projection$status[invalid_projection$measure==invalid_measure]=="unavailable"))
  expect_true(all(is.na(invalid_projection$value[invalid_projection$measure==invalid_measure])))
})

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
    list(commune=c("densite", "littoral", "epci", "bretagne"), epci="epci", departement="departement"))
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

test_that("AEDAR comparison inputs resolve the registered address-origin spine when no path is configured", {
  dir <- tempfile("aedar-spine-default-"); dir.create(dir)
  modes <- stats::setNames(lapply(AEDAR_ADDRESS_SOURCE_MODES, function(mode) {
    x <- as.data.frame(as.list(stats::setNames(rep(1,4), AEDAR_ADDRESS_SOURCE_COLUMNS[[mode]])))
    x$code_insee <- "22001"; x$cle_interop_adr <- "addr-1"; x$TYPEQU <- "A104"; x
  }), AEDAR_ADDRESS_SOURCE_MODES)
  paths <- stats::setNames(vapply(names(modes), function(mode) {
    path <- file.path(dir,paste0(mode,".parquet")); nanoparquet::write_parquet(modes[[mode]],path); path
  }, character(1)), names(modes))
  nanoparquet::write_parquet(
    data.frame(address_id="addr-1",code_insee="22001",lon=1,lat=2),
    file.path(dir,AEDAR_ADDRESS_ORIGIN_FILE))
  previous <- Sys.getenv("LUSK_AEDAR_ADDRESS_ORIGINS", unset=NA_character_)
  Sys.unsetenv("LUSK_AEDAR_ADDRESS_ORIGINS")
  on.exit({
    if (is.na(previous)) Sys.unsetenv("LUSK_AEDAR_ADDRESS_ORIGINS")
    else Sys.setenv(LUSK_AEDAR_ADDRESS_ORIGINS=previous)
  }, add=TRUE)
  loaded <- read_aedar_comparison_inputs(paths,origins_path=NULL,raw_dir=dir,verify_hashes=FALSE)
  expect_equal(nrow(loaded$address_origins),1)
  expect_equal(loaded$address_origins$commune,"22001")
  empty <- tempfile("aedar-spine-empty-")
  expect_error(
    read_aedar_comparison_inputs(paths,origins_path=NULL,raw_dir=empty,verify_hashes=FALSE),
    "aedar-address-origins-2026v1[.]parquet")
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

test_that("AEDAR publication refuses an entire expected territory omitted from the snapshot", {
  inputs <- make_aedar_test_inputs()
  second_commune <- inputs$commune
  second_commune$code_insee <- "22002"
  second_commune$nom_commune <- "Essai deuxième"
  inputs$commune <- rbind(inputs$commune,second_commune)
  projection <- project_aedar_aggregates(inputs,make_aedar_test_typequ_metadata())
  reference_pairs <- data.frame(territory_type=c("commune","commune","epci","departement","region"),
    territory_id=c("22001","22002","200000001","22","53"),stringsAsFactors=FALSE)
  incomplete_facts <- projection$facts[projection$facts$territory_id!="22002",,drop=FALSE]

  expect_silent(validate_aedar_territory_reference(projection$facts,reference_pairs))
  expect_equal(length(unique(incomplete_facts$territory_id[incomplete_facts$territory_type=="commune"])),1L)
  expect_error(validate_aedar_territory_reference(incomplete_facts,reference_pairs),
    "incomplete relative to published territory_reference")
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
  summary <- project_aedar_territory_summary(restored$facts,restored$source)
  expect_equal(restored$facts$count_5_walk_share,rep(NA_real_,4L * AEDAR_TYPEQU_REGISTRY_COUNT))
  expect_equal(restored$facts$count_5_walk_min,rep(0,4L * AEDAR_TYPEQU_REGISTRY_COUNT))
  expect_equal(restored$facts$territory_type,rep(levels,each=AEDAR_TYPEQU_REGISTRY_COUNT))
  expect_equal(restored$source$licence,"ODbL")
  expect_identical(restored$source$source_id,AEDAR_AGGREGATE_SOURCE_ID)
  expect_identical(restored$source$vintage,AEDAR_AGGREGATE_VINTAGE)
  expect_true(all(summary$source_id==AEDAR_AGGREGATE_SOURCE_ID))
  expect_true(all(summary$vintage==AEDAR_AGGREGATE_VINTAGE))
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
  expect_match(source,'identical\\(Sys.getenv\\("LUSK_AEDAR_PUBLISH_PROGRESS"\\),"1"\\)')
  expect_false(grepl('LUSK_AEDAR_PUBLISH_PROGRESS="1"',script,fixed=TRUE))
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
  expect_match(publisher,"for\\(part_index in seq_along\\(x\\$parts\\)\\)")
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

test_that("AEDAR territory summary projects the bound 40 readings under complete support", {
  projection <- project_aedar_aggregates(make_aedar_test_inputs(),make_aedar_test_typequ_metadata())
  facts <- projection$facts
  # Independently vary measure values by TYPEQU and territory; expectations
  # below are sums over the fixture rows, not a call back into the projector.
  facts$count_5_walk_share <- seq_len(nrow(facts)) / 1000
  facts$count_5_walk_mean <- seq_len(nrow(facts)) / 10
  result <- project_aedar_territory_summary(facts,projection$source)
  expect_equal(nrow(result),4L*40L)
  expect_equal(unique(result$territory_type),AEDAR_AGGREGATE_LEVELS)
  # Independently expected all-40 fixture: every registry TYPEQU gets a
  # distinct, bounded value per reading, and expectations are plain sums over
  # those 235 source rows (not a call to the summary projector).
  independent_facts <- facts
  bindings <- aedar_aggregate_reading_bindings()
  for(i in seq_len(nrow(bindings))) {
    underlying <- bindings$underlying[[i]]
    independent_facts[[underlying]] <- ((seq_len(nrow(independent_facts))-1L)%%
      AEDAR_TYPEQU_REGISTRY_COUNT)/1000 + i/10000
  }
  all_readings <- project_aedar_territory_summary(independent_facts,projection$source)
  for(level in AEDAR_AGGREGATE_LEVELS) for(territory in unique(independent_facts$territory_id[
      independent_facts$territory_type==level])) for(i in seq_len(nrow(bindings))) {
    underlying <- bindings$underlying[[i]]
    source_rows <- independent_facts$territory_type==level & independent_facts$territory_id==territory
    reading <- subset(all_readings,territory_type==level & territory_id==territory &
      measure==bindings$measure[[i]])
    expect_equal(reading$value,sum(independent_facts[[underlying]][source_rows]))
    expect_equal(reading$status,"available")
    expect_equal(reading$n_typequ,AEDAR_TYPEQU_REGISTRY_COUNT)
    expect_equal(reading$n_addresses,2)
    expect_equal(reading$n_observed,sum(independent_facts$n_observed[source_rows]))
    expect_equal(reading$coverage_status,"covered")
    expect_equal(reading$source_id,projection$source$source_id)
    expect_equal(reading$vintage,projection$source$vintage)
    expect_equal(reading$source_url,projection$source$url)
    expect_equal(reading$licence,projection$source$licence)
    expect_equal(reading$attribution,projection$source$attribution)
    expect_equal(reading$reference_date,projection$source$reference_date)
    expect_equal(reading$publication_date,projection$source$publication_date)
  }
  commune <- subset(result,territory_type=="commune" & measure=="walk5Diversity")
  expected <- sum(facts$count_5_walk_share[facts$territory_type=="commune"])
  expect_equal(commune$value,expected)
  expect_equal(commune$status,"available")
  expect_equal(commune$n_typequ,AEDAR_TYPEQU_REGISTRY_COUNT)
  expect_equal(commune$n_addresses,2)
  expect_equal(commune$n_observed,235)
  expect_equal(commune$source_id,projection$source$source_id)
  car <- subset(result,territory_type=="commune" & measure=="meanVolume")
  expect_equal(car$value,sum(facts$count_15_car_mean[facts$territory_type=="commune"]))
  zero_facts <- facts
  zero_facts$count_5_walk_share[] <- 0
  zero <- subset(project_aedar_territory_summary(zero_facts,projection$source),measure=="walk5Diversity")
  expect_equal(zero$value,rep(0,4))
  partial <- project_aedar_territory_summary(facts[facts$TYPEQU!=facts$TYPEQU[[1L]],],projection$source)
  expect_true(all(is.na(subset(partial,measure=="walk5Diversity")$value)))
  partial_commune <- subset(partial,territory_type=="commune" & measure=="walk5Diversity")
  partial_commune_facts <- subset(facts[facts$TYPEQU!=facts$TYPEQU[[1L]],],territory_type=="commune")
  expect_equal(partial_commune$n_addresses,2)
  expect_equal(partial_commune$n_observed,sum(partial_commune_facts$n_observed))
  expect_equal(partial_commune$coverage_status,"covered")
  bad_support <- facts
  bad_support$n_addresses[bad_support$territory_type=="commune"] <- c(2,3,rep(2,AEDAR_TYPEQU_REGISTRY_COUNT-2L))
  unsupported <- subset(project_aedar_territory_summary(bad_support,projection$source),
    territory_type=="commune" & measure=="walk5Diversity")
  expect_true(is.na(unsupported$value))
  expect_true(is.na(unsupported$n_addresses))
  expect_equal(unsupported$n_observed,sum(bad_support$n_observed[bad_support$territory_type=="commune"]))
  varied_support <- facts
  commune_rows <- which(varied_support$territory_type=="commune")
  varied_support$n_observed[commune_rows] <- rep(c(1,2),length.out=length(commune_rows))
  varied_summary <- subset(project_aedar_territory_summary(varied_support,projection$source),
    territory_type=="commune" & measure=="walk5Diversity")
  expect_gt(varied_summary$n_observed,varied_summary$n_addresses)
  expect_equal(varied_summary$n_observed,sum(varied_support$n_observed[commune_rows]))
  bad_provenance <- projection$source
  bad_provenance$source_id <- NULL
  expect_error(project_aedar_territory_summary(facts,bad_provenance),"complete 40-reading binding")
})

test_that("AEDAR publication refuses an incomplete incoming TYPEQU snapshot before database access", {
  projection <- project_aedar_aggregates(make_aedar_test_inputs(),make_aedar_test_typequ_metadata())
  projection$facts <- projection$facts[-1L,,drop=FALSE]
  expect_error(publish_aedar_aggregates(projection,NULL),"territory × TYPEQU coverage is not dense")
})
