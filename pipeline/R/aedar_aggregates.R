# The AEDAR producer's four dense 2026-v1 territorial aggregates. These are
# authoritative precomputed aggregates: never derive them from address rows.
AEDAR_AGGREGATE_LEVELS <- c("commune", "epci", "departement", "region")
AEDAR_AGGREGATE_SOURCE_ID <- "aedar_bretagne"
AEDAR_AGGREGATE_VINTAGE <- "2026-v1"
AEDAR_AGGREGATE_ID_COLUMNS <- c(commune="code_insee", epci="epci_code",
  departement="code_departement", region="code_region")
AEDAR_AGGREGATE_LEVEL_COLUMNS <- list(
  commune=c("code_insee","code_departement","nom_commune","code_region","TYPEQU","epci_code","LIB_TYPEQU","n_addresses","n_observed","coverage_status"),
  epci=c("epci_code","code_region","TYPEQU","nom_epci","LIB_TYPEQU","n_addresses","n_observed","coverage_status"),
  departement=c("code_departement","code_region","TYPEQU","nom_departement","LIB_TYPEQU","n_addresses","n_observed","coverage_status"),
  region=c("code_region","TYPEQU","nom_region","LIB_TYPEQU","n_addresses","n_observed","coverage_status"))
AEDAR_TYPEQU_REGISTRY_FILE <- "aedar-typequ-2025.csv"
AEDAR_TYPEQU_REGISTRY_COUNT <- 235L
# Minimal code/label extract of the official INSEE TYPEQU_2025.csv. Upstream
# SHA-256: 5598b5939f6491e266276934c5526e442f773921d9baddb3873077cd2bce360e.
AEDAR_TYPEQU_REGISTRY_SHA256 <- "97e7b10f4cae822d765e594ac74daa54062cd03f52f84c86f5a541d07576a915"
AEDAR_TYPEQU_HIERARCHY_URL <- "https://www.insee.fr/fr/metadonnees/source/fichier/BPE25_liste_hierarchisee_TYPEQU.html"
AEDAR_TYPEQU_GAMME_URL <- "https://www.insee.fr/fr/statistiques/fichier/8217535/BPE_gammes_equipements_2025.xlsx"
AEDAR_TYPEQU_GAMME_SHEET <- "Gammes 2025 1 ligne 1 Typequ"
# SHA-256 pins for the owner-identified raw copies. Both matched their official
# INSEE URLs byte-for-byte on 2026-10-14 before being pinned here.
AEDAR_TYPEQU_METADATA_RESOURCES <- data.frame(
  url=c(AEDAR_TYPEQU_HIERARCHY_URL,AEDAR_TYPEQU_GAMME_URL),
  filename=c("BPE25_liste_hierarchisee_TYPEQU.html","BPE_gammes_equipements_2025.xlsx"),
  sha256=c("63c3f4708f2098b647ed54f8394ec4924515a5dc10ecb97d92d66fb0402f31c9",
    "c804a56f7aa43984da80809ad4a028a70f87fe996495b1abeec327dd8c87980e"),
  stringsAsFactors=FALSE)

verify_aedar_typequ_metadata_hash <- function(path, expected, source_name=basename(path)) {
  if (!file.exists(path) || is.na(file.info(path)$size) || file.info(path)$size<1L)
    stop(paste("AEDAR metadata source is missing or empty:",source_name),call.=FALSE)
  bytes <- readBin(path,"raw",n=file.info(path)$size)
  actual <- paste(as.character(openssl::sha256(bytes)),collapse="")
  if (!identical(tolower(actual),tolower(expected)))
    stop(paste("Pinned AEDAR metadata SHA-256 mismatch:",source_name),call.=FALSE)
  invisible(TRUE)
}

normalize_aedar_typequ_label_for_validation <- function(value) {
  value <- trimws(as.character(value))
  gsub("'","’",value,fixed=TRUE)
}

compare_aedar_typequ_labels_for_validation <- function(value, expected, typequ) {
  value <- normalize_aedar_typequ_label_for_validation(value)
  expected <- normalize_aedar_typequ_label_for_validation(expected)
  c401 <- !is.na(typequ) & typequ=="C401"
  value[c401] <- gsub("\r\n|\r|\n"," ",value[c401],perl=TRUE)
  expected[c401] <- gsub("\r\n|\r|\n"," ",expected[c401],perl=TRUE)
  value==expected
}

# Validate the two official metadata extracts against the pinned 2025 code/label
# registry. Keeping these as separate source-shaped inputs makes it impossible
# to accidentally join the regroupement code instead of individual TYPEQU.
validate_aedar_typequ_metadata <- function(registry, hierarchy, gamme) {
  if (!is.data.frame(hierarchy) || !all(c("TYPEQU","label","domain_code","domain_label",
      "subdomain_code","subdomain_label","source_order") %in% names(hierarchy)) ||
      !is.data.frame(gamme) || !all(c("TYPEQU","LIBELLE_TYPEQU","GAMME") %in% names(gamme)))
    stop("AEDAR TYPEQU metadata inputs are missing required fields",call.=FALSE)
  if (nrow(hierarchy)!=AEDAR_TYPEQU_REGISTRY_COUNT || anyDuplicated(hierarchy$TYPEQU) ||
      !setequal(hierarchy$TYPEQU,registry$TYPEQU))
    stop("AEDAR hierarchy must contain exactly one row for every TYPEQU",call.=FALSE)
  if (nrow(gamme)!=AEDAR_TYPEQU_REGISTRY_COUNT || anyDuplicated(gamme$TYPEQU) ||
      !setequal(gamme$TYPEQU,registry$TYPEQU))
    stop("AEDAR gamme must contain exactly one row for every TYPEQU",call.=FALSE)
  if (length(unique(hierarchy$domain_code))!=7L ||
      length(unique(paste(hierarchy$domain_code,hierarchy$subdomain_code,sep="\r")))!=27L)
    stop("AEDAR hierarchy must contain exactly 7 domains and 27 subdomains",call.=FALSE)
  expected <- registry$LIB_TYPEQU[match(hierarchy$TYPEQU,registry$TYPEQU)]
  if (anyNA(hierarchy$label) || any(!compare_aedar_typequ_labels_for_validation(hierarchy$label,
      expected,hierarchy$TYPEQU)))
    stop("AEDAR hierarchy TYPEQU label does not agree with the canonical registry",call.=FALSE)
  expected_gamme <- registry$LIB_TYPEQU[match(gamme$TYPEQU,registry$TYPEQU)]
  if (anyNA(gamme$LIBELLE_TYPEQU) || any(normalize_aedar_typequ_label_for_validation(gamme$LIBELLE_TYPEQU)!=
      normalize_aedar_typequ_label_for_validation(expected_gamme)))
    stop("AEDAR gamme TYPEQU label does not agree with the canonical registry",call.=FALSE)
  if (anyNA(hierarchy[c("domain_code","domain_label","subdomain_code","subdomain_label","source_order")]) ||
      anyDuplicated(hierarchy$source_order) || any(!is.finite(hierarchy$source_order)) ||
      !identical(sort(as.integer(hierarchy$source_order)),seq_len(AEDAR_TYPEQU_REGISTRY_COUNT)))
    stop("AEDAR hierarchy ordering and parent labels must be complete",call.=FALSE)
  domains <- unique(hierarchy[c("domain_code","domain_label")])
  subdomains <- unique(hierarchy[c("domain_code","domain_label","subdomain_code","subdomain_label")])
  if (anyDuplicated(domains$domain_code) || anyDuplicated(subdomains[c("domain_code","subdomain_code")]) ||
      nrow(domains)!=7L || nrow(subdomains)!=27L)
    stop("AEDAR hierarchy codes must map consistently to 7 domains and 27 subdomains",call.=FALSE)
  hierarchy <- hierarchy[order(hierarchy$source_order),,drop=FALSE]
  joined <- merge(hierarchy,gamme[,c("TYPEQU","GAMME"),drop=FALSE],by="TYPEQU",sort=FALSE)
  joined <- joined[match(hierarchy$TYPEQU,joined$TYPEQU),,drop=FALSE]
  joined$gamme_status <- ifelse(is.na(joined$GAMME),"absent",
    ifelse(trimws(joined$GAMME)=="Hors Gamme","hors_gamme","classified"))
  names(joined)[names(joined)=="label"] <- "LIB_TYPEQU"
  joined <- joined[,c("TYPEQU","LIB_TYPEQU","description","domain_code","domain_label","subdomain_code",
    "subdomain_label","GAMME","gamme_status","source_order"),drop=FALSE]
  rownames(joined) <- NULL
  joined
}

read_aedar_typequ_metadata_sources <- function(hierarchy_path, gamme_path) {
  if (!file.exists(hierarchy_path) || !file.exists(gamme_path))
    stop("Official AEDAR TYPEQU metadata sources are missing",call.=FALSE)
  html <- paste(readLines(hierarchy_path,warn=FALSE,encoding="UTF-8"),collapse="\n")
  tr <- gregexpr("(?s)<tr\\b[^>]*>.*?</tr>",html,perl=TRUE,ignore.case=TRUE)
  rows <- regmatches(html,tr)[[1L]]
  text_cell <- function(x) {
    x <- gsub("<[^>]*>","",x,perl=TRUE)
    x <- gsub("&nbsp;","\u00a0",x,fixed=TRUE)
    x <- gsub("&amp;","&",x,fixed=TRUE)
    x <- gsub("&quot;","\"",x,fixed=TRUE)
    x <- gsub("&#39;|&apos;","'",x,perl=TRUE)
    x <- gsub("&lt;","<",x,fixed=TRUE)
    x <- gsub("&gt;",">",x,fixed=TRUE)
    numeric <- gregexpr("&#(x[[:xdigit:]]+|[0-9]+);",x,perl=TRUE)
    tokens <- regmatches(x,numeric)[[1L]]
    for (token in tokens) {
      codepoint <- sub("^&#(x[[:xdigit:]]+|[0-9]+);$","\\1",token,perl=TRUE)
      value <- if(startsWith(codepoint,"x")) strtoi(sub("^x","",codepoint),16L) else as.integer(codepoint)
      if(!is.na(value)) x <- sub(token,intToUtf8(value),x,fixed=TRUE)
    }
    x
  }
  current_domain_code <- current_domain_label <- current_subdomain_code <- current_subdomain_label <- NA_character_
  records <- vector("list",length(rows)); n <- 0L
  for (row in rows) {
    cell_matches <- gregexpr("(?s)<td[^>]*>.*?</td>",row,perl=TRUE,ignore.case=TRUE)
    cells <- regmatches(row,cell_matches)[[1L]]
    if(length(cells)<3L) next
    attributes <- sub("(?s)^<td([^>]*)>.*$","\\1",cells[[1L]],perl=TRUE,ignore.case=TRUE)
    level <- as.integer(sub(".*indentlevel=['\"]?([0-9]+)['\"]?.*","\\1",attributes,perl=TRUE))
    if(is.na(level)) next
    cell_value <- function(cell) text_cell(sub("(?s)^<td[^>]*>(.*)</td>$","\\1",cell,perl=TRUE,ignore.case=TRUE))
    code <- trimws(cell_value(cells[[1L]])); label <- cell_value(cells[[2L]])
    description <- cell_value(cells[[3L]])
    if (level==1L) { current_domain_code <- code; current_domain_label <- label }
    if (level==2L) { current_subdomain_code <- code; current_subdomain_label <- label }
    if (level==3L) {
      n <- n+1L
      records[[n]] <- data.frame(TYPEQU=code,label=label,description=description,
        domain_code=current_domain_code,domain_label=current_domain_label,
        subdomain_code=current_subdomain_code,subdomain_label=current_subdomain_label,
        source_order=n,stringsAsFactors=FALSE)
    }
  }
  hierarchy <- if(n) do.call(rbind,records[seq_len(n)]) else data.frame()
  gamme <- readxl::read_excel(gamme_path,sheet=AEDAR_TYPEQU_GAMME_SHEET,
    col_types="text",skip=4,.name_repair="minimal")
  required <- c("TYPEQU_REGROUPEMENT","TYPEQU","LIBELLE_TYPEQU","GAMME","SDOM",
    "LIBELLE_SDOM","DOM","LIBELLE_DOM")
  if (!all(required %in% names(gamme))) stop("Official AEDAR gamme sheet has an unexpected header",call.=FALSE)
  if (nrow(gamme)!=AEDAR_TYPEQU_REGISTRY_COUNT || anyNA(gamme$TYPEQU) ||
      any(!nzchar(gamme$TYPEQU)) || anyDuplicated(gamme$TYPEQU))
    stop("Official AEDAR gamme sheet must contain exactly 235 unique individual TYPEQU rows",call.=FALSE)
  # Deliberately retain individual TYPEQU and its label; the regroupement field
  # is validated as present but is never used for the metadata join.
  gamme <- as.data.frame(gamme[,required,drop=FALSE],stringsAsFactors=FALSE)
  if (anyDuplicated(gamme$TYPEQU)) stop("Official AEDAR gamme sheet duplicates individual TYPEQU",call.=FALSE)
  list(hierarchy=hierarchy,gamme=gamme)
}

validate_aedar_published_typequ_metadata <- function(metadata) {
  required <- c("TYPEQU","LIB_TYPEQU","domain_code","domain_label","subdomain_code",
    "subdomain_label","description","GAMME","gamme_status","source_order")
  if (!is.data.frame(metadata) || !all(required %in% names(metadata)) || nrow(metadata)!=AEDAR_TYPEQU_REGISTRY_COUNT ||
      anyDuplicated(metadata$TYPEQU) || anyDuplicated(metadata$source_order) ||
      !setequal(metadata$TYPEQU,read_aedar_typequ_registry()$TYPEQU) ||
      !identical(sort(as.integer(metadata$source_order)),seq_len(AEDAR_TYPEQU_REGISTRY_COUNT)))
    stop("AEDAR publication TYPEQU metadata is incomplete or duplicated",call.=FALSE)
  registry <- read_aedar_typequ_registry()
  expected <- registry$LIB_TYPEQU[match(metadata$TYPEQU,registry$TYPEQU)]
  if (anyNA(metadata$LIB_TYPEQU) || any(!compare_aedar_typequ_labels_for_validation(metadata$LIB_TYPEQU,
      expected,metadata$TYPEQU)))
    stop("AEDAR publication TYPEQU label differs from the canonical registry",call.=FALSE)
  required_text <- c("LIB_TYPEQU","description","domain_code","domain_label","subdomain_code","subdomain_label","gamme_status")
  empty_text <- vapply(metadata[required_text],function(column)
    is.na(column) | !nzchar(trimws(as.character(column))),logical(nrow(metadata)))
  if (any(empty_text) ||
      any(!metadata$gamme_status %in% c("classified","hors_gamme","absent")) ||
      any((metadata$gamme_status=="absent") != is.na(metadata$GAMME)) ||
      any((metadata$gamme_status=="hors_gamme") != (!is.na(metadata$GAMME) & trimws(metadata$GAMME)=="Hors Gamme")))
    stop("AEDAR publication TYPEQU gamme state is inconsistent with its source value",call.=FALSE)
  if (length(unique(metadata$domain_code))!=7L ||
      length(unique(paste(metadata$domain_code,metadata$subdomain_code,sep="\r")))!=27L)
    stop("AEDAR publication TYPEQU hierarchy must contain 7 domains and 27 subdomains",call.=FALSE)
  domains <- unique(metadata[c("domain_code","domain_label")])
  subdomains <- unique(metadata[c("domain_code","domain_label","subdomain_code","subdomain_label")])
  if (anyDuplicated(domains$domain_code) || anyDuplicated(subdomains[c("domain_code","subdomain_code")]))
    stop("AEDAR publication TYPEQU parent codes have conflicting labels",call.=FALSE)
  metadata
}

download_aedar_typequ_metadata <- function(raw_dir=file.path("data","raw"),download=utils::download.file,
                                           resources=AEDAR_TYPEQU_METADATA_RESOURCES) {
  dir.create(raw_dir,recursive=TRUE,showWarnings=FALSE)
  required <- c("url","filename","sha256")
  if (!is.data.frame(resources) || !all(required %in% names(resources)) || anyNA(resources[required]) ||
      any(!grepl("^[0-9a-fA-F]{64}$",resources$sha256)) || anyDuplicated(resources$filename))
    stop("AEDAR metadata source registry is malformed",call.=FALSE)
  paths <- file.path(raw_dir,resources$filename)
  for(i in seq_along(paths)) {
    if(file.exists(paths[[i]])) {
      verify_aedar_typequ_metadata_hash(paths[[i]],resources$sha256[[i]],resources$filename[[i]])
      next
    }
    temp <- paste0(paths[[i]],".part")
    on.exit(unlink(temp),add=TRUE)
    download(resources$url[[i]],temp,mode="wb",quiet=TRUE)
    verify_aedar_typequ_metadata_hash(temp,resources$sha256[[i]],resources$filename[[i]])
    if(!file.rename(temp,paths[[i]])) stop("Could not atomically install AEDAR metadata source",call.=FALSE)
  }
  stats::setNames(paths,resources$filename)
}

project_aedar_typequ_metadata <- function(hierarchy_path,gamme_path,registry=read_aedar_typequ_registry()) {
  sources <- read_aedar_typequ_metadata_sources(hierarchy_path,gamme_path)
  validate_aedar_typequ_metadata(registry,sources$hierarchy,sources$gamme)
}
AEDAR_AGGREGATE_MEASURES <- as.vector(unlist(lapply(c(5,10,15,20), function(m)
  unlist(lapply(c("walk","transit","transit_gain","bike_lts2","bike_lts4","car"), function(mode)
    paste0("count_",m,"_",mode,"_",c("share","min","max",paste0("decile",1:9),"mean")))))))
AEDAR_SOURCE_RESOURCES <- data.frame(
  kind=c(rep("address",6),rep("aggregate",4),"documentation"),
  mode=c("walk","transit_gain","transit","car","bike_lts4","bike_lts2",rep(NA_character_,5)),
  level=c(rep(NA_character_,6),AEDAR_AGGREGATE_LEVELS,NA_character_),
  url=c(
    "https://static.data.gouv.fr/resources/acces-aux-equipements-depuis-les-adresses-residentielles-bretagne/20260930-152047/address-walk-53-2026v1.parquet",
    "https://static.data.gouv.fr/resources/acces-aux-equipements-depuis-les-adresses-residentielles-bretagne/20260930-151951/address-transit-gain-53-2026v1.parquet",
    "https://static.data.gouv.fr/resources/acces-aux-equipements-depuis-les-adresses-residentielles-bretagne/20260930-151815/address-transit-53-2026v1.parquet",
    "https://static.data.gouv.fr/resources/acces-aux-equipements-depuis-les-adresses-residentielles-bretagne/20260930-145712/address-car-53-2026v1.parquet",
    "https://static.data.gouv.fr/resources/acces-aux-equipements-depuis-les-adresses-residentielles-bretagne/20260930-145246/address-bike-lts4-53-2026v1.parquet",
    "https://static.data.gouv.fr/resources/acces-aux-equipements-depuis-les-adresses-residentielles-bretagne/20260930-145136/address-bike-lts2-53-2026v1.parquet",
    "https://static.data.gouv.fr/resources/acces-aux-equipements-depuis-les-adresses-residentielles-bretagne/20260930-152133/aggregates-commune-53-2026v1.parquet",
    "https://static.data.gouv.fr/resources/acces-aux-equipements-depuis-les-adresses-residentielles-bretagne/20260930-152216/aggregates-epci-53-2026v1.parquet",
    "https://static.data.gouv.fr/resources/acces-aux-equipements-depuis-les-adresses-residentielles-bretagne/20260930-152158/aggregates-departement-53-2026v1.parquet",
    "https://static.data.gouv.fr/resources/acces-aux-equipements-depuis-les-adresses-residentielles-bretagne/20260930-152247/aggregates-region-53-2026v1.parquet",
    "https://static.data.gouv.fr/resources/acces-aux-equipements-depuis-les-adresses-residentielles-bretagne/20260930-145023/aedar-doc-2026v1.pdf"),
  filename=c("address-walk-53-2026v1.parquet","address-transit-gain-53-2026v1.parquet",
    "address-transit-53-2026v1.parquet","address-car-53-2026v1.parquet",
    "address-bike-lts4-53-2026v1.parquet","address-bike-lts2-53-2026v1.parquet",
    paste0("aggregates-",AEDAR_AGGREGATE_LEVELS,"-53-2026v1.parquet"),"aedar-doc-2026v1.pdf"),
  sha1=c("34577f08beee9a11f38ea12a04430ed8702be175","f722d510f2c6565d5622def99d4f6fb843e376aa",
    "a44261ca5b75c29a06d9e833e5a9d9ceccfb21b8","0797dd3272450c69a5a8b6660e079b333843c826",
    "8a09890d0ab2b0c8efcd945a42df73daa81be83a","b0e987acc0ceebec6755452c7941fd198080bcee",
    "d1ab2520d0a259a97033f18133d4b953cce936f3","b5ef57a9de77cd471447597552d09ad9531a9d74",
    "d8a525355eee9719f0253e4cdb22cc523114f45a","c0e080c110de68a0dcddaad0e20a4a001c46965f",
    "e42a0618416db83280344b57bbbf22e2f4551f7e"),
  published_on=rep("2026-09-30",11), stringsAsFactors=FALSE)

AEDAR_AGGREGATE_RESOURCES <- AEDAR_SOURCE_RESOURCES[
  AEDAR_SOURCE_RESOURCES$kind=="aggregate",c("level","url","filename","sha1","published_on")]

verify_aedar_source_hash <- function(path, expected) {
  bytes <- readBin(path,"raw",n=file.info(path)$size)
  actual <- paste(as.character(openssl::sha1(bytes)),collapse="")
  if (!identical(tolower(actual),tolower(expected))) stop(paste("Pinned AEDAR checksum mismatch:",basename(path)),call.=FALSE)
  invisible(TRUE)
}

verify_aedar_resource_hash <- function(path, level) {
  i <- match(level,AEDAR_AGGREGATE_RESOURCES$level)
  if (is.na(i)) stop("Unknown AEDAR aggregate level",call.=FALSE)
  verify_aedar_source_hash(path,AEDAR_AGGREGATE_RESOURCES$sha1[[i]])
}

read_aedar_typequ_registry <- function() {
  path <- system.file("extdata",AEDAR_TYPEQU_REGISTRY_FILE,package="lusk")
  if (!nzchar(path)) path <- file.path("inst","extdata",AEDAR_TYPEQU_REGISTRY_FILE)
  if (!file.exists(path)) stop("Pinned 2025 BPE TYPEQU registry is missing",call.=FALSE)
  bytes <- readBin(path,"raw",n=file.info(path)$size)
  # Git's Windows checkout may translate this text CSV to CRLF. The pin is for
  # its canonical LF representation, so normalize only CRLF pairs before hashing.
  if (length(bytes)>1L) {
    crlf <- which(bytes[-length(bytes)]==as.raw(13) & bytes[-1L]==as.raw(10))
    if (length(crlf)) bytes <- bytes[-crlf]
  }
  actual <- paste(as.character(openssl::sha256(bytes)),collapse="")
  if (!identical(tolower(actual),AEDAR_TYPEQU_REGISTRY_SHA256))
    stop("Pinned 2025 BPE TYPEQU registry checksum mismatch",call.=FALSE)
  registry <- readr::read_csv(path,col_types=readr::cols(.default=readr::col_character()),
    trim_ws=FALSE,show_col_types=FALSE,progress=FALSE)
  if (!identical(names(registry),c("TYPEQU","LIB_TYPEQU")) ||
      nrow(registry)!=AEDAR_TYPEQU_REGISTRY_COUNT || anyNA(registry$TYPEQU) ||
      any(!grepl("^[A-Z][0-9]{3}$",registry$TYPEQU)) || anyDuplicated(registry$TYPEQU) ||
      anyNA(registry$LIB_TYPEQU) || any(!nzchar(trimws(registry$LIB_TYPEQU))))
    stop("Pinned 2025 BPE TYPEQU registry has an invalid code/label contract",call.=FALSE)
  registry
}

download_aedar_sources <- function(raw_dir=file.path("data","raw"), resources=AEDAR_SOURCE_RESOURCES,
                                   download=utils::download.file) {
  dir.create(raw_dir,recursive=TRUE,showWarnings=FALSE)
  required <- c("url","filename","sha1")
  if (!is.data.frame(resources) || !all(required %in% names(resources)) ||
      anyNA(resources[required]) || anyDuplicated(resources$filename))
    stop("AEDAR source resource selection is malformed",call.=FALSE)
  paths <- file.path(raw_dir,resources$filename)
  for (i in seq_along(paths)) {
    if (file.exists(paths[[i]])) {
      verify_aedar_source_hash(paths[[i]],resources$sha1[[i]])
      next
    }
    tmp <- paste0(paths[[i]],".part")
    on.exit(unlink(tmp),add=TRUE)
    download(resources$url[[i]],tmp,mode="wb",quiet=TRUE)
    if (!file.exists(tmp) || file.info(tmp)$size < 1) stop("Downloaded AEDAR source file is empty",call.=FALSE)
    verify_aedar_source_hash(tmp,resources$sha1[[i]])
    if (!file.rename(tmp,paths[[i]])) stop("Could not atomically install AEDAR source file",call.=FALSE)
  }
  stats::setNames(paths,resources$filename)
}

download_aedar_aggregates <- function(raw_dir=file.path("data","raw")) {
  resources <- AEDAR_SOURCE_RESOURCES[AEDAR_SOURCE_RESOURCES$kind=="aggregate",,drop=FALSE]
  paths <- download_aedar_sources(raw_dir,resources)
  paths <- paths[AEDAR_AGGREGATE_RESOURCES$filename]
  stats::setNames(unname(paths),AEDAR_AGGREGATE_LEVELS)
}

read_aedar_aggregate_inputs <- function(paths) {
  paths <- unlist(paths,use.names=TRUE)
  if (is.null(names(paths)) || !setequal(names(paths),AEDAR_AGGREGATE_LEVELS) || any(!file.exists(paths)))
    stop("All four pinned AEDAR aggregate Parquets are required",call.=FALSE)
  for (level in AEDAR_AGGREGATE_LEVELS) verify_aedar_resource_hash(paths[[level]],level)
  lapply(paths,nanoparquet::read_parquet)
}

validate_aedar_aggregates <- function(inputs, measure_columns=AEDAR_AGGREGATE_MEASURES) {
  if (!is.list(inputs) || !setequal(names(inputs),AEDAR_AGGREGATE_LEVELS)) stop("AEDAR requires exactly four territory-level Parquets",call.=FALSE)
  if (!setequal(measure_columns,AEDAR_AGGREGATE_MEASURES) || length(measure_columns)!=312L) stop("AEDAR producer schema must contain its exact 312 measures",call.=FALSE)
  out <- lapply(AEDAR_AGGREGATE_LEVELS,function(level) {
    x <- as.data.frame(inputs[[level]],stringsAsFactors=FALSE)
    idcol <- unname(AEDAR_AGGREGATE_ID_COLUMNS[[level]])
    required <- c(AEDAR_AGGREGATE_LEVEL_COLUMNS[[level]],measure_columns)
    if (!all(required %in% names(x)) || ncol(x)!=length(required)) stop(paste("Unexpected or incomplete AEDAR source schema:",level),call.=FALSE)
    if (!nrow(x) || anyNA(x[c(idcol,"TYPEQU","LIB_TYPEQU","n_addresses","n_observed","coverage_status")]) ||
        anyDuplicated(x[c(idcol,"TYPEQU")]) || any(x$n_addresses<0 | x$n_observed<0 | x$n_observed>x$n_addresses) ||
        any(!is.finite(x$n_addresses)) || any(!is.finite(x$n_observed))) stop(paste("Invalid AEDAR keys/denominators:",level),call.=FALSE)
    x$territory_id <- as.character(x[[idcol]])
    x$territory_type <- level
    x
  }) |> stats::setNames(AEDAR_AGGREGATE_LEVELS)
  axis <- read_aedar_typequ_registry()
  axis_key <- paste(axis$TYPEQU,axis$LIB_TYPEQU,sep="\r")
  for (level in AEDAR_AGGREGATE_LEVELS) {
    x <- out[[level]]
    pairs <- unique(data.frame(TYPEQU=as.character(x$TYPEQU),LIB_TYPEQU=as.character(x$LIB_TYPEQU),
      stringsAsFactors=FALSE))
    labels_key <- paste(pairs$TYPEQU,pairs$LIB_TYPEQU,sep="\r")
    if (!setequal(pairs$TYPEQU,axis$TYPEQU) || nrow(pairs)!=nrow(axis) || !setequal(axis_key,labels_key))
      stop(paste("AEDAR dense TYPEQU axis/labels differ from the pinned 2025 BPE TYPEQU registry at",level),call.=FALSE)
    groups <- split(x$TYPEQU,x[[unname(AEDAR_AGGREGATE_ID_COLUMNS[[level]])]])
    if (any(vapply(groups,function(g) !setequal(g,axis$TYPEQU),logical(1))))
      stop(paste("AEDAR territory × TYPEQU coverage is not dense at",level),call.=FALSE)
  }
  out
}

project_aedar_aggregates <- function(inputs, typequ_metadata=NULL) {
  facts <- dplyr::bind_rows(validate_aedar_aggregates(inputs)); rownames(facts)<-NULL
  if (!is.null(typequ_metadata)) typequ_metadata <- validate_aedar_published_typequ_metadata(typequ_metadata)
  if (!is.null(typequ_metadata)) {
    label_check <- typequ_metadata$LIB_TYPEQU[match(facts$TYPEQU,typequ_metadata$TYPEQU)]
    if (anyNA(label_check) || any(!compare_aedar_typequ_labels_for_validation(facts$LIB_TYPEQU,
        label_check,facts$TYPEQU)))
      stop("AEDAR aggregate labels disagree with published TYPEQU metadata",call.=FALSE)
  }
  list(facts=facts,typequ_metadata=typequ_metadata,measures=AEDAR_AGGREGATE_MEASURES,source=list(
    source_id=AEDAR_AGGREGATE_SOURCE_ID,name="Accès aux équipements depuis les adresses résidentielles — Bretagne",
    vintage=AEDAR_AGGREGATE_VINTAGE,url="https://www.data.gouv.fr/datasets/acces-aux-equipements-depuis-les-adresses-residentielles-bretagne",
    licence="ODbL",attribution="© OpenStreetMap contributors; données AEDAR — licence ODbL",
    reference_date=NA_character_,publication_date=AEDAR_AGGREGATE_RESOURCES$published_on[[1L]]))
}

write_aedar_canonical <- function(projection, directory=file.path("data","processed","aedar")) {
  if (!is.data.frame(projection$typequ_metadata) || nrow(projection$typequ_metadata)!=AEDAR_TYPEQU_REGISTRY_COUNT)
    stop("Canonical AEDAR publication requires TYPEQU metadata",call.=FALSE)
  dir.create(directory,recursive=TRUE,showWarnings=FALSE)
  ecrire_parquet_si_modifie(projection$facts,file.path(directory,"aedar_territorial_aggregate.parquet"))
  source <- as.data.frame(projection$source,stringsAsFactors=FALSE)
  ecrire_parquet_si_modifie(source,file.path(directory,"aedar_territorial_aggregate_source.parquet"))
  ecrire_parquet_si_modifie(projection$typequ_metadata,file.path(directory,"aedar_typequ_metadata.parquet"))
  invisible(directory)
}

read_aedar_canonical <- function(directory=file.path("data","processed","aedar")) {
  facts_path <- file.path(directory,"aedar_territorial_aggregate.parquet")
  source_path <- file.path(directory,"aedar_territorial_aggregate_source.parquet")
  metadata_path <- file.path(directory,"aedar_typequ_metadata.parquet")
  if (!file.exists(facts_path) || !file.exists(source_path) || !file.exists(metadata_path)) stop("Canonical AEDAR Parquet facts/provenance/TYPEQU metadata are missing",call.=FALSE)
  facts <- nanoparquet::read_parquet(facts_path); src <- nanoparquet::read_parquet(source_path)
  typequ_metadata <- as.data.frame(nanoparquet::read_parquet(metadata_path),stringsAsFactors=FALSE)
  if (nrow(src)!=1L || src$source_id[[1L]]!=AEDAR_AGGREGATE_SOURCE_ID || src$vintage[[1L]]!=AEDAR_AGGREGATE_VINTAGE)
    stop("Canonical AEDAR source identity is not the registered 2026-v1 vintage",call.=FALSE)
  inputs <- lapply(AEDAR_AGGREGATE_LEVELS,function(level) {
    x <- facts[facts$territory_type==level,,drop=FALSE]
    x[,c(AEDAR_AGGREGATE_LEVEL_COLUMNS[[level]],AEDAR_AGGREGATE_MEASURES),drop=FALSE]
  }); names(inputs)<-AEDAR_AGGREGATE_LEVELS
  projection <- project_aedar_aggregates(inputs,typequ_metadata)
  projection$source <- as.list(src[1,,drop=FALSE])
  projection
}

validate_aedar_territory_reference <- function(facts, reference_pairs) {
  required <- c("territory_type","territory_id")
  if (!all(required %in% names(facts)) || !all(required %in% names(reference_pairs)))
    stop("AEDAR territory reference validation requires typed identity pairs",call.=FALSE)
  projected <- unique(facts[required]); published <- unique(reference_pairs[required])
  key <- function(x) paste(x$territory_type,x$territory_id,sep="\r")
  if (any(!key(projected) %in% key(published)))
    stop("AEDAR territory type/id pairs do not exist in published territory_reference",call.=FALSE)
  invisible(TRUE)
}

serialize_aedar_json_rows <- function(x) {
  if (!nrow(x)) return(character())
  json_rows <- character()
  connection <- textConnection("json_rows",open="w",local=TRUE)
  connection_open <- TRUE
  on.exit(if (connection_open) close(connection),add=TRUE)
  jsonlite::stream_out(x,connection,pagesize=min(1000L,nrow(x)),verbose=FALSE,
    auto_unbox=TRUE,na="null",digits=17)
  close(connection)
  connection_open <- FALSE
  json_rows
}

read_aedar_aggregate_projection <- function(raw_dir=file.path("data","raw"))
  {
    download_aedar_sources(raw_dir)
    metadata_paths <- download_aedar_typequ_metadata(raw_dir)
    metadata <- project_aedar_typequ_metadata(metadata_paths[[1L]],metadata_paths[[2L]])
    project_aedar_aggregates(read_aedar_aggregate_inputs(download_aedar_aggregates(raw_dir)),metadata)
  }

publish_aedar_aggregates <- function(projection, db) {
  if (is.null(projection$typequ_metadata)) stop("AEDAR publication requires canonical TYPEQU metadata",call.=FALSE)
  projection$typequ_metadata <- validate_aedar_published_typequ_metadata(projection$typequ_metadata)
  facts <- projection$facts
  version <- paste(as.character(openssl::sha256(serialize(projection,NULL))),collapse="")
  DBI::dbWithTransaction(db, {
    DBI::dbExecute(db,"SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
    reference <- DBI::dbGetQuery(db,"SELECT content_version FROM table_publication WHERE table_name='territory_reference'")
    if (nrow(reference)!=1L) stop("AEDAR publication requires published territory reference",call.=FALSE)
    ref_version <- reference$content_version[[1L]]
    reference_pairs <- DBI::dbGetQuery(db,"SELECT territory_type,territory_id FROM territory_reference")
    validate_aedar_territory_reference(facts,reference_pairs)
    existing <- DBI::dbGetQuery(db,"SELECT content_version,reference_content_version FROM table_publication WHERE table_name='aedar_territorial_aggregate'")
    unchanged <- nrow(existing) && identical(existing$content_version[[1L]],version) && identical(existing$reference_content_version[[1L]],ref_version)
    if (!unchanged) {
      DBI::dbExecute(db,"DELETE FROM aedar_territorial_aggregate")
      chunk_size <- 2000L
      for (level in AEDAR_AGGREGATE_LEVELS) {
        level_indices <- which(facts$territory_type==level)
        identity_columns <- setdiff(AEDAR_AGGREGATE_LEVEL_COLUMNS[[level]],
          c("TYPEQU","LIB_TYPEQU","n_addresses","n_observed","coverage_status"))
        for (start in seq.int(1L,length(level_indices),by=chunk_size)) {
          selected <- level_indices[start:min(start+chunk_size-1L,length(level_indices))]
          x <- facts[selected,,drop=FALSE]
          typequ_metadata <- projection$typequ_metadata[match(x$TYPEQU,projection$typequ_metadata$TYPEQU),,drop=FALSE]
          rows <- data.frame(territory_type=x$territory_type,territory_id=x$territory_id,typequ=x$TYPEQU,
            typequ_label=x$LIB_TYPEQU,
            typequ_hierarchy_label=typequ_metadata$LIB_TYPEQU,
            typequ_description=typequ_metadata$description,
            typequ_domain_code=typequ_metadata$domain_code,typequ_domain_label=typequ_metadata$domain_label,
            typequ_subdomain_code=typequ_metadata$subdomain_code,typequ_subdomain_label=typequ_metadata$subdomain_label,
            typequ_gamme=typequ_metadata$GAMME,typequ_gamme_status=typequ_metadata$gamme_status,
            typequ_source_order=as.integer(typequ_metadata$source_order),
            identity=serialize_aedar_json_rows(as.data.frame(x[identity_columns],stringsAsFactors=FALSE)),
            n_addresses=as.numeric(x$n_addresses),n_observed=as.numeric(x$n_observed),coverage_status=x$coverage_status,
            measures=serialize_aedar_json_rows(as.data.frame(x[AEDAR_AGGREGATE_MEASURES],stringsAsFactors=FALSE)),
            source_id=projection$source$source_id,vintage_id=projection$source$vintage,
            source_url=projection$source$url,licence=projection$source$licence,
            attribution=projection$source$attribution,
            reference_date=as.Date(projection$source$reference_date),publication_date=as.Date(projection$source$publication_date),
            stringsAsFactors=FALSE)
          DBI::dbWriteTable(db,"aedar_territorial_aggregate",rows,append=TRUE,row.names=FALSE)
        }
      }
      DBI::dbExecute(db,"INSERT INTO source_dataset(source_id,name) VALUES($1,$2) ON CONFLICT(source_id) DO UPDATE SET name=EXCLUDED.name",params=list(projection$source$source_id,projection$source$name))
      DBI::dbExecute(db,"INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date) VALUES($1,$2,$3,$4,$5) ON CONFLICT(source_id,vintage_id) DO NOTHING",params=list(projection$source$source_id,projection$source$vintage,projection$source$vintage,as.Date(projection$source$reference_date),as.Date(projection$source$publication_date)))
      stored_source <- DBI::dbGetQuery(db,"SELECT version,reference_date,publication_date FROM source_vintage WHERE source_id=$1 AND vintage_id=$2",params=list(projection$source$source_id,projection$source$vintage))
      if (nrow(stored_source)!=1L || stored_source$version[[1L]]!=projection$source$vintage ||
          !identical(as.character(stored_source$reference_date[[1L]]),projection$source$reference_date) ||
          !identical(as.character(stored_source$publication_date[[1L]]),projection$source$publication_date))
        stop("AEDAR source vintage conflicts with stored provenance",call.=FALSE)
      DBI::dbExecute(db,"INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version,published_at) VALUES('aedar_territorial_aggregate',$1,$2,$3,now()) ON CONFLICT(table_name) DO UPDATE SET content_version=EXCLUDED.content_version,row_count=EXCLUDED.row_count,reference_content_version=EXCLUDED.reference_content_version,published_at=EXCLUDED.published_at",params=list(version,nrow(facts),ref_version))
    }
    list(changed=!unchanged,content_version=version,row_count=nrow(facts))
  })
}
