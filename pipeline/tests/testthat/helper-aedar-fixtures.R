# Shared AEDAR fixtures for default unit tests and explicit whole-payload audits (#1172).

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
