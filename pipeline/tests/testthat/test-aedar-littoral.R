# Littoral AEDAR fixed context (#1043, child of #1040). The pooled reference
# must be produced from the already-pooled littoral artifact - never by
# averaging commune summaries - and the fixed group rows must carry the pooled
# statistic for both C and NC, like the density preset.

read_aedar_region_typequ_fixture <- function() {
  readr::read_csv(testthat::test_path("fixtures","aedar-region-2026v1-typequ.csv"),
    col_types=readr::cols(.default=readr::col_character()),trim_ws=FALSE,show_col_types=FALSE)
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

aedar_littoral_test_source <- function() {
  list(source_id="aedar_bretagne",vintage="2026-v1",url="https://example.test/aedar",
    licence="ODbL",attribution="AEDAR fixture",reference_date=NA_character_,
    publication_date="2026-09-30")
}

aedar_littoral_pooled_facts <- function() {
  bindings <- aedar_aggregate_reading_bindings()
  facts <- expand.grid(territory_id=c("C","NC"),TYPEQU=c("A","B"),stringsAsFactors=FALSE)
  facts$territory_type <- "littoral"
  facts$littoral_code <- facts$territory_id
  # C is fully supported; NC is an honestly uncovered/incomplete group.
  facts$n_addresses <- ifelse(facts$territory_id=="C",2L,0L)
  facts$n_observed <- ifelse(facts$territory_id=="C",2L,0L)
  facts$coverage_status <- ifelse(facts$territory_id=="C","covered",
    "uncovered_no_address_origins")
  for (i in seq_len(nrow(bindings))) {
    base <- if(endsWith(bindings$underlying[[i]],"_share")) 0.5 else i/1000
    facts[[bindings$underlying[[i]]]] <- ifelse(facts$territory_id=="C",base,NA_real_)
  }
  facts
}

test_that("both AEDAR pool builders resolve the registered address-origin spine identically", {
  dir <- tempfile("aedar-littoral-spine-"); dir.create(dir)
  on.exit(unlink(dir,recursive=TRUE),add=TRUE)
  registered <- file.path(dir,AEDAR_ADDRESS_ORIGIN_FILE)
  override <- file.path(dir,"explicit-origin.parquet")
  origins <- data.frame(address_id=c("a","b"),code_insee=c("22001","22002"),lon=1:2,lat=1:2)
  nanoparquet::write_parquet(origins,registered)
  nanoparquet::write_parquet(origins,override)
  previous <- Sys.getenv("LUSK_AEDAR_ADDRESS_ORIGINS",unset=NA_character_)
  Sys.unsetenv("LUSK_AEDAR_ADDRESS_ORIGINS")
  on.exit({
    if(is.na(previous)) Sys.unsetenv("LUSK_AEDAR_ADDRESS_ORIGINS")
    else Sys.setenv(LUSK_AEDAR_ADDRESS_ORIGINS=previous)
  },add=TRUE)
  # Default: no env var -> the registered file in the raw cache is found.
  expect_equal(aedar_address_origin_path(dir),registered)
  # Explicit override always wins over the registered default.
  Sys.setenv(LUSK_AEDAR_ADDRESS_ORIGINS=override)
  expect_equal(aedar_address_origin_path(dir),override)
  Sys.unsetenv("LUSK_AEDAR_ADDRESS_ORIGINS")
  expect_error(aedar_address_origin_path(tempfile("empty-")),AEDAR_ADDRESS_ORIGIN_FILE)
  # Both builders use that ONE seam, so their precedence cannot drift.
  pipeline_root <- testthat::test_path("..","..")
  for(script in c("build-aedar-density-aggregate.R","build-aedar-littoral-aggregate.R")) {
    text <- paste(readLines(file.path(pipeline_root,"scripts",script),warn=FALSE),collapse="\n")
    expect_match(text,"origins_path<-aedar_address_origin_path\\(raw_dir\\)")
  }
})

test_that("littoral summary projects the pooled law from already-pooled facts", {
  bindings <- aedar_aggregate_reading_bindings()
  source <- aedar_littoral_test_source()
  facts <- aedar_littoral_pooled_facts()

  projected <- project_aedar_littoral_summary(facts,source,registry_size=2L)
  expect_identical(names(projected),AEDAR_LITTORAL_SUMMARY_COLUMNS)
  expect_equal(nrow(projected),2L*nrow(bindings))
  available <- projected[projected$group_id=="C",]
  unavailable <- projected[projected$group_id=="NC",]
  expected <- vapply(seq_len(nrow(bindings)),function(i)
    sum(facts[facts$territory_id=="C",bindings$underlying[[i]]]),numeric(1))
  expect_equal(available$value,expected)
  expect_true(all(available$status=="available" & available$n_typequ==2L))
  expect_true(all(available$n_addresses==2L & available$n_observed==4L))
  expect_true(all(available$coverage_status=="covered"))
  expect_true(all(unavailable$status=="unavailable" & is.na(unavailable$value) &
    is.na(unavailable$n_typequ)))

  # A commune-summary average must not be substituted: partial members with no
  # complete registry stay unavailable (the producer pooling law is inherited).
  partial <- facts[facts$territory_id=="C" & facts$TYPEQU=="A",]
  expect_true(all(project_aedar_littoral_summary(partial,source,registry_size=2L)$status==
    "unavailable"))
  # Pooled facts carrying a density-class key are rejected outright.
  bad <- facts; bad$territory_type <- "density_class"
  expect_error(project_aedar_littoral_summary(bad,source,registry_size=2L),
    "already-pooled littoral facts")
})

test_that("littoral builder pools C/NC address evidence, never commune summaries", {
  skip_if_not_installed("nanoparquet")
  skip_if_not_installed("arrow")
  axis <- read_aedar_typequ_registry()
  dir <- tempfile("aedar-littoral-only-"); dir.create(dir)
  on.exit(unlink(dir,recursive=TRUE),add=TRUE)
  origins_path <- file.path(dir,"origins.parquet")
  nanoparquet::write_parquet(data.frame(address_id=c("a","b","c","d","e"),
    code_insee=c("c1","c1","c2","c2","c3"),lon=1:5,lat=1:5),origins_path)
  mode_paths <- stats::setNames(vapply(AEDAR_ADDRESS_SOURCE_MODES,function(mode)
    file.path(dir,paste0(mode,".parquet")),character(1)),AEDAR_ADDRESS_SOURCE_MODES)
  keys <- list(walk=data.frame(code_insee=c("c1","c1","c2"),cle_interop_adr=c("a","b","c"),TYPEQU="A104"))
  for(mode in AEDAR_ADDRESS_SOURCE_MODES) {
    x <- keys[[mode]]
    if(is.null(x)) x <- data.frame(code_insee=character(),cle_interop_adr=character(),TYPEQU=character())
    for(column in AEDAR_ADDRESS_SOURCE_COLUMNS[[mode]]) x[[column]] <- rep(0,nrow(x))
    if(mode=="walk"&&nrow(x)) x$count_5_walk <- c(1,3,9)
    nanoparquet::write_parquet(x,mode_paths[[mode]])
  }
  crosswalk <- data.frame(code_insee=c("c1","c2","c3"),littoral_code=c("C","C","NC"),
    littoral_label=c("Littoral","Littoral","Non littoral"),stringsAsFactors=FALSE)
  output_path <- file.path(dir,"littoral.parquet")
  result <- build_aedar_littoral_aggregate(mode_paths,origins_path,crosswalk,
    "classe_littorale_communale",paste(rep("a",64),collapse=""),"test-vintage",output_path,
    verify_hashes=FALSE)
  expect_equal(nrow(result),2L*nrow(axis))
  pooled <- result[result$littoral_code=="C" & result$TYPEQU=="A104",,drop=FALSE]
  expect_equal(pooled$n_addresses,4)
  expect_equal(pooled$count_5_walk_mean,13/4)
  expect_equal(pooled$count_5_walk_share,3/4)
  uncovered <- result[result$littoral_code=="NC" & result$TYPEQU=="A104",,drop=FALSE]
  expect_equal(uncovered$coverage_status,"covered")
  expect_equal(uncovered$n_addresses,1)
  identity <- jsonlite::fromJSON(unique(result$input_identity))
  expect_setequal(names(identity),c("address_origins","littoral_reference",paste0("mode:",AEDAR_ADDRESS_SOURCE_MODES)))
  expect_equal(unique(result$littoral_reference_identity),"classe_littorale_communale")
})

test_that("littoral membership uses the served C/NC classification exactly", {
  ref <- data.frame(territory_type=c("commune","commune","commune","epci","region"),
    territory_id=c("22001","22002","22003","E1","53"),
    epci_id=c("E1","E1","E2",NA_character_,NA_character_),
    density_class_code=c("1","1","2",NA_character_,NA_character_),
    littoral_code=c("C","C","NC",NA_character_,NA_character_),stringsAsFactors=FALSE)
  rows <- aedar_comparison_membership_rows(ref)
  lit <- rows[rows$comparison_context=="littoral",]
  expect_setequal(lit$group_id,c("C","NC"))
  expect_true(all(lit$territory_type=="commune"))
  # Same-status peers are exactly the produced scopes.
  expect_equal(lit$group_id[order(lit$group_id)],c("C","NC"))
  # membership set-equality validation accepts matching scopes and rejects a
  # missing C/NC group.
  expect_silent(validate_aedar_comparison_membership(list(groups=rows),ref))
  short <- rows[!(rows$comparison_context=="littoral" & rows$group_id=="NC"),]
  expect_error(validate_aedar_comparison_membership(list(groups=short),ref),
    "contexts/groups differ")
})

test_that("fixed partition requires pooled statistic for both density and littoral", {
  membership <- function(context,group) data.frame(comparison_context=context,
    group_id=group,territory_type="commune",stringsAsFactors=FALSE)
  measures <- AEDAR_AGGREGATE_MEASURES
  mk <- function(context,group,statistic) data.frame(
    comparison_context=context,group_id=group,territory_type="commune",
    TYPEQU="A104",measure=measures,statistic=statistic,
    value=1,n_addresses=1,n_observed=1,coverage_status="covered",stringsAsFactors=FALSE)
  # Both pooled contexts validate against their produced scope.
  expect_silent(validate_aedar_comparison_part(mk("density_class","1","pooled"),
    data.frame(),"A104",membership("density_class","1")))
  expect_silent(validate_aedar_comparison_part(mk("littoral","C","pooled"),
    data.frame(),"A104",membership("littoral","C")))
  expect_silent(validate_aedar_comparison_part(mk("littoral","NC","pooled"),
    data.frame(),"A104",membership("littoral","NC")))
  # A median littoral group is rejected.
  expect_error(validate_aedar_comparison_part(mk("littoral","C","median"),
    data.frame(),"A104",membership("littoral","C")),"invalid fixed-context statistic")
})

aedar_littoral_test_source_artifact <- function(communes=c("22001","22002")) {
  axis <- read_aedar_typequ_registry()
  ref <- list(crosswalk=data.frame(code_insee=communes,
      littoral_code=c("C","NC")[seq_along(communes)],
      littoral_label=ifelse(seq_along(communes)==1L,"Littoral","Non littoral"),
      stringsAsFactors=FALSE),
    identity=MANIFEST_CLASSES_LITTORAL[["id"]][[1L]],
    sha256=MANIFEST_CLASSES_LITTORAL[["sha256"]][[1L]],
    vintage=MANIFEST_CLASSES_LITTORAL[["vintage"]][[1L]])
  grid <- expand.grid(littoral_code=c("C","NC"),TYPEQU=axis$TYPEQU,stringsAsFactors=FALSE)
  facts <- data.frame(territory_type="littoral",territory_id=grid$littoral_code,
    littoral_code=grid$littoral_code,
    littoral_label=ifelse(grid$littoral_code=="C","Littoral","Non littoral"),
    TYPEQU=grid$TYPEQU,
    LIB_TYPEQU=axis$LIB_TYPEQU[match(grid$TYPEQU,axis$TYPEQU)],
    n_addresses=1L,n_observed=1L,coverage_status="covered",
    source_snapshot_id=AEDAR_AGGREGATE_VINTAGE,
    littoral_reference_identity=ref$identity,littoral_reference_sha256=ref$sha256,
    littoral_reference_vintage=ref$vintage,input_content_version="",input_identity="",
    content_version=paste(rep("b",64),collapse=""),stringsAsFactors=FALSE)
  for (measure in AEDAR_AGGREGATE_MEASURES) facts[[measure]] <- 1
  hashes <- c(stats::setNames(rep(paste(rep("1",64),collapse=""),length(AEDAR_ADDRESS_SOURCE_MODES)),
    paste0("mode:",AEDAR_ADDRESS_SOURCE_MODES)),address_origins=paste(rep("2",64),collapse=""),
    littoral_reference=ref$sha256)
  facts$input_identity <- as.character(jsonlite::toJSON(as.list(hashes),auto_unbox=TRUE))
  facts$input_content_version <- paste(as.character(openssl::sha256(charToRaw(facts$input_identity[[1L]]))),collapse="")
  content_cols <- c("territory_type","territory_id","littoral_code","littoral_label","TYPEQU","LIB_TYPEQU",
    "n_addresses","n_observed","coverage_status",AEDAR_AGGREGATE_MEASURES,"source_snapshot_id",
    "littoral_reference_identity","littoral_reference_sha256","littoral_reference_vintage",
    "input_content_version","input_identity")
  facts <- facts[content_cols]
  facts$content_version <- paste(as.character(openssl::sha256(serialize(facts[content_cols],NULL))),collapse="")
  list(facts=facts,littoral_reference=ref,input_hashes=hashes,crosswalk=ref$crosswalk,
    input_content_version=facts$input_content_version[[1L]],content_version=facts$content_version[[1L]],
    artifact_sha256=paste(rep("c",64),collapse=""),source_snapshot_id=AEDAR_AGGREGATE_VINTAGE)
}

test_that("littoral publication is a sibling that leaves density counters intact", {
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
  result <- project_aedar_comparison_publication(projection,density_source,refs,
    reference_content_version=paste(rep("d",64),collapse=""),directory=dir,
    littoral_source=aedar_littoral_test_source_artifact())
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
    reference_content_version=paste(rep("d",64),collapse=""),directory=tempfile("x"),
    littoral_source=aedar_littoral_test_source_artifact()),"membership|disagrees")
})

# #1150: the AEDAR reader must consume the builder's ACTUAL crosswalk output.
# The pinned DREAL positive-list fixture and the 1202-commune canonical universe
# are both committed, so the membership proof below needs no DB and no network.
aedar_littoral_fixture_chemin <- function() {
  testthat::test_path("fixtures", "littoral-dreal-bretagne-2023-04-21.csv")
}

aedar_littoral_univers_canonique <- function() {
  readr::read_csv(
    testthat::test_path("..", "..", "inst", "extdata", "population_communes_2023.csv"),
    col_types = readr::cols(code_commune = readr::col_character()),
    show_col_types = FALSE, progress = FALSE
  )$code_commune
}

test_that("littoral reference binds to the builder crosswalk and the pinned DREAL positive list", {
  path <- aedar_littoral_fixture_chemin()
  communes <- aedar_littoral_univers_canonique()
  source <- lire_classes_littoral(path)
  # On the pre-#1150 code this call is the immediate failure: the reader selects
  # code_insee from a builder that now returns code_commune.
  ref <- read_aedar_littoral_reference(path, communes = communes)
  built <- construire_crosswalk_littoral(source, communes)

  # The expectation is bound to the builder's declared output contract, not to
  # a second literal list: renaming a builder column without moving the
  # declaration fails HERE instead of drifting silently downstream (#1150).
  expect_setequal(names(built), CROSSWALK_LITTORAL_COLUMNS)
  code_column <- CROSSWALK_LITTORAL_COLUMNS[[1L]]
  statut_column <- CROSSWALK_LITTORAL_COLUMNS[[2L]]

  cw <- ref$crosswalk
  expect_setequal(names(cw), c("code_insee", "littoral_code", "littoral_label"))
  expect_identical(cw$code_insee, as.character(built[[code_column]]))
  expect_identical(cw$littoral_code, as.character(built[[statut_column]]))
  expect_identical(cw$littoral_label,
    ifelse(cw$littoral_code == "C", "Littoral", "Non littoral"))

  # The served C/NC membership IS the DREAL positive list joined to the canon.
  positifs <- intersect(source$Code_insee, communes)
  expect_length(communes, 1202L)
  expect_equal(nrow(cw), 1202L)
  expect_setequal(cw$code_insee[cw$littoral_code == "C"], positifs)
  expect_setequal(cw$code_insee[cw$littoral_code == "NC"], setdiff(communes, positifs))
  expect_equal(cw$littoral_code[match(c("29083", "29084"), cw$code_insee)], c("C", "C"))
  expect_identical(ref$sha256, tolower(sha256_aedar_file(path)))
})

test_that("littoral reference fails closed when the builder crosswalk columns are renamed", {
  path <- aedar_littoral_fixture_chemin()
  communes <- aedar_littoral_univers_canonique()
  original <- construire_crosswalk_littoral
  local_mocked_bindings(construire_crosswalk_littoral = function(source, communes, ...) {
    x <- original(source, communes, ...)
    names(x) <- c("commune", "statut", "classement_source")
    x
  })
  expect_error(read_aedar_littoral_reference(path, communes = communes),
    "crosswalk|contract|inattendu|unexpected")
})

test_that("the built littoral artifact pools the fixture crosswalk's C/NC membership", {
  skip_if_not_installed("nanoparquet")
  skip_if_not_installed("arrow")
  path <- aedar_littoral_fixture_chemin()
  communes <- aedar_littoral_univers_canonique()
  ref <- read_aedar_littoral_reference(path, communes = communes)
  cw <- ref$crosswalk

  dir <- tempfile("aedar-littoral-fixture-"); dir.create(dir)
  on.exit(unlink(dir, recursive = TRUE), add = TRUE)
  # Two real canonical communes from the pinned fixture: 29083 is C, 29209 NC.
  origins_path <- file.path(dir, "origins.parquet")
  nanoparquet::write_parquet(data.frame(address_id = c("a", "b", "c"),
    code_insee = c("29083", "29083", "29209"), lon = 1:3, lat = 1:3), origins_path)
  mode_paths <- stats::setNames(vapply(AEDAR_ADDRESS_SOURCE_MODES, function(mode)
    file.path(dir, paste0(mode, ".parquet")), character(1)), AEDAR_ADDRESS_SOURCE_MODES)
  keys <- list(walk = data.frame(code_insee = c("29083", "29083", "29209"),
    cle_interop_adr = c("a", "b", "c"), TYPEQU = "A104"))
  for (mode in AEDAR_ADDRESS_SOURCE_MODES) {
    x <- keys[[mode]]
    if (is.null(x)) x <- data.frame(code_insee = character(), cle_interop_adr = character(), TYPEQU = character())
    for (column in AEDAR_ADDRESS_SOURCE_COLUMNS[[mode]]) x[[column]] <- rep(0, nrow(x))
    if (mode == "walk" && nrow(x)) x$count_5_walk <- c(1, 3, 9)
    nanoparquet::write_parquet(x, mode_paths[[mode]])
  }
  output_path <- file.path(dir, "littoral.parquet")
  result <- build_aedar_littoral_aggregate(mode_paths, origins_path, cw,
    ref$identity, ref$sha256, ref$vintage, output_path, verify_hashes = FALSE)
  expect_setequal(unique(result$littoral_code), c("C", "NC"))
  expect_setequal(unique(result[c("littoral_code", "littoral_label")])$littoral_label,
    c("Littoral", "Non littoral"))
  expect_silent(validate_aedar_littoral_aggregate(result, ref))
  served <- data.frame(territory_type = "commune", territory_id = cw$code_insee,
    littoral_code = cw$littoral_code, stringsAsFactors = FALSE)
  expect_silent(validate_aedar_littoral_membership(ref, served))
  stale <- served
  stale$littoral_code[stale$territory_id == "29083"] <- "NC"
  expect_error(validate_aedar_littoral_membership(ref, stale), "disagrees")
})

test_that("comparison input identity pins the littoral classification and reference", {
  hashes <- c(`mode:walk`=paste(rep("a",64),collapse=""),
    `mode:transit_gain`=paste(rep("b",64),collapse=""),
    `mode:transit`=paste(rep("c",64),collapse=""),
    `mode:car`=paste(rep("d",64),collapse=""),
    `mode:bike_lts4`=paste(rep("e",64),collapse=""),
    `mode:bike_lts2`=paste(rep("f",64),collapse=""),
    address_origins=paste(rep("1",64),collapse=""),
    density_reference=paste(rep("2",64),collapse=""),
    density_artifact=paste(rep("3",64),collapse=""),
    density_aggregate_content_version=paste(rep("4",64),collapse=""),
    density_reference_identity=MANIFEST_CLASSES_DENSITE$id[[1L]],
    density_reference_sha256=MANIFEST_CLASSES_DENSITE$sha256[[1L]],
    density_reference_vintage=MANIFEST_CLASSES_DENSITE$vintage[[1L]],
    littoral_artifact=paste(rep("7",64),collapse=""),
    littoral_aggregate_content_version=paste(rep("8",64),collapse=""),
    littoral_reference_identity="classe_littorale_communale",
    littoral_reference_sha256=MANIFEST_CLASSES_LITTORAL$sha256[[1L]],
    littoral_classification_content_version=paste(rep("6",64),collapse=""),
    littoral_reference_vintage=MANIFEST_CLASSES_LITTORAL$vintage[[1L]])
  identity <- as.character(jsonlite::toJSON(as.list(hashes),auto_unbox=TRUE))
  version <- paste(as.character(openssl::sha256(charToRaw(identity))),collapse="")
  expect_silent(validate_aedar_comparison_input_identity(identity,version,require_littoral=TRUE))
  stale <- hashes
  stale["littoral_reference_sha256"] <- paste(rep("0",64),collapse="")
  stale_identity <- as.character(jsonlite::toJSON(as.list(stale),auto_unbox=TRUE))
  stale_version <- paste(as.character(openssl::sha256(charToRaw(stale_identity))),collapse="")
  expect_error(validate_aedar_comparison_input_identity(stale_identity,stale_version,require_littoral=TRUE),
    "pinned source/reference")
  missing <- hashes[setdiff(names(hashes),"littoral_classification_content_version")]
  missing_identity <- as.character(jsonlite::toJSON(as.list(missing),auto_unbox=TRUE))
  missing_version <- paste(as.character(openssl::sha256(charToRaw(missing_identity))),collapse="")
  expect_error(validate_aedar_comparison_input_identity(missing_identity,missing_version,require_littoral=TRUE),
    "pinned source/reference")
})
