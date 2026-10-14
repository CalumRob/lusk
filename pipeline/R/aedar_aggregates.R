# The AEDAR producer's four dense 2026-v1 territorial aggregates. These are
# authoritative precomputed aggregates: never derive them from address rows.
AEDAR_AGGREGATE_LEVELS <- c("commune", "epci", "departement", "region")
AEDAR_AGGREGATE_SOURCE_ID <- "aedar_bretagne"
AEDAR_AGGREGATE_VINTAGE <- "2026-v1"
# Current product-declared AEDAR comparison contexts. Keep this inventory
# explicit: arbitrary member selections are intentionally resolved at request time.
AEDAR_FIXED_COMPARISON_SCOPES <- list(
  commune=c("densite", "epci", "bretagne"),
  epci="epci",
  departement="departement")
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

AEDAR_ADDRESS_SOURCE_MODES <- AEDAR_SOURCE_RESOURCES$mode[AEDAR_SOURCE_RESOURCES$kind=="address"]
AEDAR_ADDRESS_SOURCE_COLUMNS <- stats::setNames(lapply(AEDAR_ADDRESS_SOURCE_MODES,function(mode) {
  suffix<-if(mode%in%c("transit","transit_gain")) paste0(mode,"_p1") else mode
  paste0("count_",c(5,10,15,20),"_",suffix)
}),AEDAR_ADDRESS_SOURCE_MODES)

sha256_aedar_file <- function(path) {
  if(!file.exists(path)||is.na(file.info(path)$size)||file.info(path)$size<1L)
    stop(paste("AEDAR input file is missing or empty:",basename(path)),call.=FALSE)
  paste(as.character(openssl::sha256(readBin(path,"raw",n=file.info(path)$size))),collapse="")
}

aedar_address_identity <- function(code_insee,address_key) paste(as.character(code_insee),as.character(address_key),sep="\r")

read_aedar_comparison_inputs <- function(mode_paths=NULL,origins_path=Sys.getenv("LUSK_AEDAR_ADDRESS_ORIGINS"),
    raw_dir=file.path("data","raw"),verify_hashes=TRUE) {
  if(length(origins_path)!=1L||is.na(origins_path)||!nzchar(origins_path)||!file.exists(origins_path))
    stop("Set LUSK_AEDAR_ADDRESS_ORIGINS to the complete address-origin Parquet",call.=FALSE)
  resources<-AEDAR_SOURCE_RESOURCES[AEDAR_SOURCE_RESOURCES$kind=="address",,drop=FALSE]
  if(is.null(mode_paths)) {
    paths<-download_aedar_sources(raw_dir,resources)
    mode_paths<-stats::setNames(unname(paths[resources$filename]),resources$mode)
  }
  if(!is.character(mode_paths)||is.null(names(mode_paths))||!setequal(names(mode_paths),AEDAR_ADDRESS_SOURCE_MODES)||anyDuplicated(names(mode_paths)))
    stop("All six registered AEDAR address-mode resources are required",call.=FALSE)
  mode_paths<-mode_paths[AEDAR_ADDRESS_SOURCE_MODES]
  for(mode in AEDAR_ADDRESS_SOURCE_MODES) {
    resource<-resources[resources$mode==mode,,drop=FALSE]
    if(verify_hashes) verify_aedar_source_hash(mode_paths[[mode]],resource$sha1[[1L]])
  }
  spine_hash<-sha256_aedar_file(origins_path)
  spine<-as.data.frame(nanoparquet::read_parquet(origins_path),stringsAsFactors=FALSE)
  if(!all(c("address_id","code_insee","lon","lat")%in%names(spine))||anyNA(spine[c("address_id","code_insee","lon","lat")])||
     any(!is.finite(as.numeric(spine$lon)))||any(!is.finite(as.numeric(spine$lat)))||
     anyDuplicated(spine[c("code_insee","address_id")]))
    stop("Configured AEDAR address-origin spine violates complete unique identity contract",call.=FALSE)
  spine$commune<-as.character(spine$code_insee)
  spine$address_id<-aedar_address_identity(spine$code_insee,spine$address_id)
  facts_by_mode<-stats::setNames(lapply(AEDAR_ADDRESS_SOURCE_MODES,function(mode) {
    x<-as.data.frame(nanoparquet::read_parquet(mode_paths[[mode]]),stringsAsFactors=FALSE)
    required<-c("code_insee","cle_interop_adr","TYPEQU",AEDAR_ADDRESS_SOURCE_COLUMNS[[mode]])
    if(!all(required%in%names(x))||anyNA(x[c("code_insee","cle_interop_adr","TYPEQU")])||
       anyDuplicated(x[c("code_insee","cle_interop_adr","TYPEQU")]))
      stop(paste("Registered AEDAR address resource violates sparse source schema:",mode),call.=FALSE)
    x[c("code_insee","cle_interop_adr","TYPEQU",AEDAR_ADDRESS_SOURCE_COLUMNS[[mode]])]
  }),AEDAR_ADDRESS_SOURCE_MODES)
  observed<-aedar_observed_address_type_keys(facts_by_mode)
  facts<-combine_aedar_address_mode_facts(facts_by_mode)
  expected_ids<-unique(spine$address_id)
  if(any(!facts$address_id%in%expected_ids)||any(!observed$address_id%in%expected_ids))
    stop("AEDAR address-mode facts contain keys outside configured origin spine",call.=FALSE)
  input_hashes<-c(stats::setNames(vapply(mode_paths,sha256_aedar_file,character(1)),paste0("mode:",names(mode_paths))),
    address_origins=spine_hash)
  input_identity<-as.character(jsonlite::toJSON(as.list(input_hashes),auto_unbox=TRUE))
  input_content_version<-paste(as.character(openssl::sha256(charToRaw(input_identity))),collapse="")
  list(address_origins=spine[c("address_id","commune")],address_facts=facts,observed_keys=observed,
    source_snapshot_id=AEDAR_AGGREGATE_VINTAGE,input_hashes=input_hashes,input_content_version=input_content_version)
}

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

aedar_aggregate_content_version <- function(projection) {
  projection$address_resource_paths<-NULL
  paste(as.character(openssl::sha256(serialize(projection,NULL))),collapse="")
}

# Source-address inputs retain one sparse address × TYPEQU table per mode.
# Build the density-class result from address facts, never from territorial
# aggregate rows. `address_facts` is sparse and wide: one row per address/TYPEQU
# with count_* source columns; absent pairs are implicit zeros.
aedar_observed_address_type_keys <- function(mode_keys) {
  if(!is.list(mode_keys)||is.null(names(mode_keys))||!length(mode_keys))
    stop("AEDAR observed-key inputs must be a named source-mode list",call.=FALSE)
  source_modes<-setdiff(names(mode_keys),"transit_gain")
  keys<-lapply(source_modes,function(mode) {
    x<-mode_keys[[mode]]
    if(all(c("code_insee","cle_interop_adr","TYPEQU")%in%names(x))) {
      out<-data.frame(address_id=aedar_address_identity(x$code_insee,x$cle_interop_adr),TYPEQU=x$TYPEQU)
    } else if(all(c("address_id","TYPEQU")%in%names(x))) out<-x[c("address_id","TYPEQU")]
    else stop("AEDAR mode keys require territorial and address identity plus TYPEQU",call.=FALSE)
    out
  })
  result<-unique(as.data.frame(dplyr::bind_rows(keys))); rownames(result)<-NULL; result
}

combine_aedar_address_mode_facts <- function(mode_facts) {
  if(!is.list(mode_facts)||!setequal(names(mode_facts),AEDAR_ADDRESS_SOURCE_MODES))
    stop("All six AEDAR address source modes are required",call.=FALSE)
  normalized<-lapply(AEDAR_ADDRESS_SOURCE_MODES,function(mode) {
    x<-as.data.frame(mode_facts[[mode]],stringsAsFactors=FALSE)
    needed<-AEDAR_ADDRESS_SOURCE_COLUMNS[[mode]]
    if(all(c("code_insee","cle_interop_adr","TYPEQU",needed)%in%names(x))) {
      x$address_id<-aedar_address_identity(x$code_insee,x$cle_interop_adr)
    } else if(!all(c("address_id","TYPEQU",needed)%in%names(x)))
      stop(paste("Incomplete AEDAR address source mode",mode),call.=FALSE)
    x<-x[c("address_id","TYPEQU",needed)]
    if(anyNA(x[c("address_id","TYPEQU")])||anyDuplicated(x[c("address_id","TYPEQU")]))
      stop(paste("Invalid address/TYPEQU keys in AEDAR source mode",mode),call.=FALSE)
    x
  }); names(normalized)<-AEDAR_ADDRESS_SOURCE_MODES
  Reduce(function(left,right) merge(left,right,by=c("address_id","TYPEQU"),all=TRUE,sort=FALSE),normalized)
}

project_aedar_density_comparisons <- function(address_origins, address_facts,
    membership, typequ_axis, measures=AEDAR_AGGREGATE_MEASURES, observed_keys=NULL) {
  measure_stems<-unique(sub("_(share|min|max|decile[1-9]|mean)$","",measures))
  source_columns<-vapply(measure_stems,function(stem) {
    if(grepl("_transit_gain$|_transit$",stem)) paste0(stem,"_p1") else stem
  },character(1))
  required_spine <- c("address_id", "commune")
  required_membership <- c("territory_id", "member_commune", "territory_type", "context")
  required_facts <- c("address_id", "TYPEQU", source_columns)
  if (!all(required_spine %in% names(address_origins)) ||
      !all(required_membership %in% names(membership)) ||
      !all(required_facts %in% names(address_facts)))
    stop("Invalid AEDAR density comparison inputs", call.=FALSE)
  if (anyDuplicated(address_origins$address_id) || anyNA(address_origins[c("address_id","commune")]))
    stop("AEDAR address origins must have unique, complete address identities", call.=FALSE)
  if (anyDuplicated(address_facts[c("address_id","TYPEQU")]) ||
      anyNA(address_facts[c("address_id","TYPEQU")]))
    stop("AEDAR address facts contain duplicate or incomplete address/TYPEQU keys", call.=FALSE)
  if(is.null(observed_keys)) observed_keys<-unique(address_facts[c("address_id","TYPEQU")])
  if(!all(c("address_id","TYPEQU")%in%names(observed_keys)) || anyDuplicated(observed_keys[c("address_id","TYPEQU")]) ||
     any(!observed_keys$address_id%in%address_origins$address_id))
    stop("AEDAR observed address/TYPEQU keys are invalid",call.=FALSE)
  if (any(!address_facts$address_id %in% address_origins$address_id))
    stop("AEDAR address facts contain addresses absent from the origin spine", call.=FALSE)
  if (!all(c("TYPEQU","LIB_TYPEQU") %in% names(typequ_axis)) ||
      anyDuplicated(typequ_axis$TYPEQU)) stop("Invalid AEDAR TYPEQU axis",call.=FALSE)
  pinned_axis<-read_aedar_typequ_registry()
  if(nrow(typequ_axis)!=nrow(pinned_axis)||!setequal(typequ_axis$TYPEQU,pinned_axis$TYPEQU)||
     !setequal(paste(typequ_axis$TYPEQU,typequ_axis$LIB_TYPEQU,sep="\r"),paste(pinned_axis$TYPEQU,pinned_axis$LIB_TYPEQU,sep="\r")))
    stop("AEDAR density comparison axis differs from pinned 235-code TYPEQU registry",call.=FALSE)
  if(any(!observed_keys$TYPEQU%in%typequ_axis$TYPEQU))
    stop("AEDAR observed keys contain TYPEQU outside the canonical axis",call.=FALSE)
  if(any(vapply(source_columns,function(column) !is.numeric(address_facts[[column]])||any(!is.finite(address_facts[[column]])),logical(1))))
    stop("AEDAR address counts must be finite numeric facts",call.=FALSE)
  density <- membership[membership$territory_type=="commune" & membership$context=="densite",,drop=FALSE]
  if (anyDuplicated(density[c("territory_id","member_commune")]))
    stop("Duplicate AEDAR density membership",call.=FALSE)
  origins <- merge(address_origins, density, by.x="commune", by.y="member_commune", all=FALSE)
  groups <- unique(density[c("territory_id","context")])
  members_by_group<-split(origins$address_id,origins$territory_id)
  membership_keys<-origins[c("address_id","territory_id")]
  joined<-merge(address_facts,membership_keys,by="address_id",all=FALSE,sort=FALSE)
  joined_key<-paste(joined$territory_id,joined$TYPEQU,sep="\r")
  facts_by_group_typequ<-split(seq_len(nrow(joined)),joined_key)
  probs <- seq(.1,.9,.1)
  metric_suffixes <- c("share","min","max",paste0("decile",1:9),"mean")
  output <- vector("list", nrow(groups)*nrow(typequ_axis)); k <- 0L
  for (g in seq_len(nrow(groups))) {
    addresses <- unique(members_by_group[[groups$territory_id[[g]]]])
    n <- length(addresses)
    for (t in seq_len(nrow(typequ_axis))) {
      k <- k+1L; code <- typequ_axis$TYPEQU[[t]]
      indices<-facts_by_group_typequ[[paste(groups$territory_id[[g]],code,sep="\r")]]
      group_facts<-if(length(indices)) joined[indices,,drop=FALSE] else joined[FALSE,,drop=FALSE]
      row <- data.frame(territory_type="commune", territory_id=groups$territory_id[[g]],
        context=groups$context[[g]], TYPEQU=code, LIB_TYPEQU=typequ_axis$LIB_TYPEQU[[t]],
        n_addresses=n, n_observed=length(unique(observed_keys$address_id[
          observed_keys$TYPEQU==code & observed_keys$address_id %in% addresses])),
        coverage_status=if(n) "covered" else "uncovered_no_address_origins", stringsAsFactors=FALSE)
      for (i in seq_along(measure_stems)) {
        measure<-measure_stems[[i]]; source_column<-source_columns[[i]]
        values <- group_facts[[source_column]]
        if (n==0L) stats <- rep(NA_real_,13L) else {
          hist <- as.data.frame(table(values),stringsAsFactors=FALSE)
          if(length(values)) {
            vals <- as.numeric(as.character(hist$values)); weights <- as.numeric(hist$Freq)
            ord <- order(vals); vals<-vals[ord]; weights<-weights[ord]
            zeros <- n-sum(weights); allv<-c(0,vals); allw<-c(zeros,weights)
            ord<-order(allv); allv<-allv[ord]; cumulative<-cumsum(allw[ord])
            at <- function(rank) allv[which(cumulative>=rank)[[1L]]]
            quant <- vapply(probs,function(p) {h<-1+(n-1)*p; lo<-floor(h); f<-h-lo; a<-at(lo); if(!f||lo==n)a else a+f*(at(lo+1)-a)},numeric(1))
            numerator <- if (grepl("_transit_gain$", measure)) sum(weights[vals!=0]) else sum(weights[vals>0])
            stats<-c(numerator/n, if(zeros>0) 0 else min(vals), if(zeros>0) max(c(0,vals)) else max(vals), quant, sum(vals*weights)/n)
          } else stats<-c(0,0,0,rep(0,9),0)
        }
        names(stats)<-paste0(measure,"_",metric_suffixes)
        row[names(stats)]<-as.list(stats)
      }
      output[[k]]<-row
    }
  }
  if (!length(output)) return(data.frame())
  dplyr::bind_rows(output)
}

# Project the declared fixed AEDAR scopes from published aggregate facts. The
# density-class reference is supplied by the address-grain projection above;
# commune ranks always use the commune's own published aggregate.
aedar_comparison_content_version <- function(groups,territories) {
  groups<-as.data.frame(groups,stringsAsFactors=FALSE); territories<-as.data.frame(territories,stringsAsFactors=FALSE)
  group_numeric<-c("value","n_addresses","n_observed")
  group_integer<-c("member_count","eligible_count","missing_count")
  territory_numeric<-c("value","n_addresses","n_observed")
  territory_integer<-c("rank","rank_size")
  for(column in group_numeric) groups[[column]]<-as.numeric(groups[[column]])
  for(column in group_integer) groups[[column]]<-as.integer(groups[[column]])
  for(column in territory_numeric) territories[[column]]<-as.numeric(territories[[column]])
  for(column in territory_integer) territories[[column]]<-as.integer(territories[[column]])
  rownames(groups)<-NULL; rownames(territories)<-NULL
  paste(as.character(openssl::sha256(serialize(list(groups,territories),NULL))),collapse="")
}

project_aedar_fixed_comparisons <- function(aggregate_facts, territory_reference,
    aedar_content_version, reference_content_version, density_group_facts,
    input_content_version=NULL,input_hashes=c(synthetic="fixture")) {
  input_identity<-as.character(jsonlite::toJSON(as.list(input_hashes),auto_unbox=TRUE))
  expected_input_version<-paste(as.character(openssl::sha256(charToRaw(input_identity))),collapse="")
  if(is.null(input_content_version)) input_content_version<-expected_input_version
  if(!identical(input_content_version,expected_input_version)) stop("AEDAR comparison input identity hash is inconsistent",call.=FALSE)
  required_ref <- c("territory_type","territory_id","epci_id","density_class_code")
  if (!all(c("territory_type","territory_id","TYPEQU") %in% names(aggregate_facts)) ||
      !all(required_ref %in% names(territory_reference)))
    stop("Invalid AEDAR fixed comparison inputs",call.=FALSE)
  measures <- intersect(AEDAR_AGGREGATE_MEASURES,names(aggregate_facts))
  if (length(measures)!=312L) stop("AEDAR comparisons require the exact 312 published measures",call.=FALSE)
  typequ_axis<-read_aedar_typequ_registry()$TYPEQU
  refs <- territory_reference
  refs$territory_id <- as.character(refs$territory_id)
  comm <- refs[refs$territory_type=="commune",,drop=FALSE]
  region <- refs$territory_id[refs$territory_type=="region"]
  if(length(region)!=1L) stop("AEDAR comparison reference requires one region",call.=FALSE)
  groups <- list(); territory_rows <- list(); ng <- nt <- 0L
  rank_scope <- function(context, group_id, type, ids, statistic_source=NULL) {
    ids<-as.character(ids)
    rows <- aggregate_facts[aggregate_facts$territory_type==type & aggregate_facts$territory_id %in% ids,,drop=FALSE]
    expected_pairs<-expand.grid(territory_id=ids,TYPEQU=typequ_axis,stringsAsFactors=FALSE)
    expected_keys<-paste(expected_pairs$territory_id,expected_pairs$TYPEQU,sep="\r")
    actual_keys<-paste(as.character(rows$territory_id),as.character(rows$TYPEQU),sep="\r")
    if(anyDuplicated(rows[c("territory_id","TYPEQU")])||length(actual_keys)!=length(expected_keys)||!setequal(actual_keys,expected_keys))
      stop("AEDAR fixed comparison membership is incompatible with territorial facts",call.=FALSE)
    rows<-rows[match(expected_keys,actual_keys),,drop=FALSE]
    for (typequ in typequ_axis) {
      axis_rows <- rows[rows$TYPEQU==typequ,,drop=FALSE]
      values<-as.matrix(axis_rows[,measures,drop=FALSE]); storage.mode(values)<-"double"
      eligible<-is.finite(values)&!is.na(axis_rows$coverage_status)&axis_rows$coverage_status=="covered"
      values[!eligible]<-NA_real_
      eligible_count<-colSums(eligible); group_value<-rep(NA_real_,length(measures))
      denominator<-observed<-rep(NA_real_,length(measures)); coverage<-rep(NA_character_,length(measures))
      statistic<-if(context%in%c("epci","bretagne")&&type=="commune") "direct" else "median"
      picked<-NULL
      if(!is.null(statistic_source)) {
        picked<-statistic_source[statistic_source$TYPEQU==typequ,,drop=FALSE]
        if(nrow(picked)>1L) stop("AEDAR density comparison has duplicate group/TYPEQU statistics",call.=FALSE)
      } else if(statistic=="direct") {
        target_type<-if(context=="epci") "epci" else "region"
        target_id<-if(context=="epci") group_id else region
        picked<-aggregate_facts[aggregate_facts$territory_type==target_type&aggregate_facts$territory_id==target_id&aggregate_facts$TYPEQU==typequ,,drop=FALSE]
        if(nrow(picked)>1L) stop("AEDAR direct reference has duplicate territory/TYPEQU facts",call.=FALSE)
      }
      if(!is.null(picked)&&nrow(picked)) {
        group_value<-as.numeric(picked[1L,measures,drop=TRUE])
        denominator[]<-as.numeric(picked$n_addresses[[1L]])
        observed[]<-as.numeric(picked$n_observed[[1L]])
        coverage[]<-as.character(picked$coverage_status[[1L]])
      } else if(is.null(statistic_source)&&statistic=="median") {
        for(j in seq_along(measures)) if(eligible_count[[j]]) group_value[[j]]<-stats::median(values[eligible[,j],j])
      }
      ranks<-matrix(NA_integer_,nrow=length(ids),ncol=length(measures))
      for(j in seq_along(measures)) if(eligible_count[[j]]) ranks[eligible[,j],j]<-rank(-values[eligible[,j],j],ties.method="min")
      rank_sizes<-matrix(rep(eligible_count,each=length(ids)),nrow=length(ids),ncol=length(measures))
      rank_sizes[!eligible]<-NA_integer_
      ng<<-ng+1L
      groups[[ng]]<<-data.frame(comparison_context=context,group_id=group_id,territory_type=type,
        TYPEQU=typequ,measure=measures,statistic=statistic,value=group_value,n_addresses=denominator,
        n_observed=observed,coverage_status=coverage,member_count=length(ids),eligible_count=eligible_count,
        missing_count=length(ids)-eligible_count,stringsAsFactors=FALSE)
      nt<<-nt+1L
      territory_rows[[nt]]<<-data.frame(comparison_context=context,group_id=group_id,territory_type=type,
        territory_id=rep(ids,each=length(measures)),TYPEQU=typequ,measure=rep(measures,times=length(ids)),
        value=as.vector(t(values)),status=as.vector(t(ifelse(eligible,"measured","not_available"))),
        n_addresses=rep(as.numeric(axis_rows$n_addresses),each=length(measures)),
        n_observed=rep(as.numeric(axis_rows$n_observed),each=length(measures)),
        coverage_status=rep(as.character(axis_rows$coverage_status),each=length(measures)),
        rank=as.vector(t(ranks)),rank_size=as.vector(t(rank_sizes)),stringsAsFactors=FALSE)
    }
  }
  for(id in sort(unique(comm$density_class_code[!is.na(comm$density_class_code)&nzchar(comm$density_class_code)]))) {
    members<-sort(comm$territory_id[comm$density_class_code==id])
    cohort<-density_group_facts[density_group_facts$territory_id==id,,drop=FALSE]
    rank_scope("density_class",id,"commune",members,cohort)
  }
  for(id in sort(unique(comm$epci_id[!is.na(comm$epci_id)&nzchar(comm$epci_id)])))
    rank_scope("epci",id,"commune",sort(comm$territory_id[comm$epci_id==id]))
  rank_scope("bretagne",region,"commune",sort(comm$territory_id))
  for(type in c("epci","departement"))
    rank_scope("same_level",region,type,sort(refs$territory_id[refs$territory_type==type]))
  group_rows<-dplyr::bind_rows(groups); result_rows<-dplyr::bind_rows(territory_rows)
  group_rows<-as.data.frame(group_rows); result_rows<-as.data.frame(result_rows)
  rownames(group_rows)<-NULL; rownames(result_rows)<-NULL
  group_rows$aedar_content_version<-aedar_content_version
  group_rows$reference_content_version<-reference_content_version
  result_rows$aedar_content_version<-aedar_content_version
  result_rows$reference_content_version<-reference_content_version
  group_rows$input_content_version<-input_content_version
  result_rows$input_content_version<-input_content_version
  group_rows$input_identity<-input_identity
  result_rows$input_identity<-input_identity
  content_version<-aedar_comparison_content_version(group_rows,result_rows)
  group_rows$content_version<-content_version; result_rows$content_version<-content_version
  list(groups=group_rows,territories=result_rows,aedar_content_version=aedar_content_version,
    reference_content_version=reference_content_version,input_content_version=input_content_version,
    input_identity=input_identity,content_version=content_version)
}

project_aedar_comparison_publication <- function(aggregate_projection,address_origins,
    address_facts,territory_reference,aedar_content_version=aedar_aggregate_content_version(aggregate_projection),
    reference_content_version,input_content_version=NULL,input_hashes=NULL,observed_keys=NULL) {
  if(!is.list(aggregate_projection)||!is.data.frame(aggregate_projection$facts))
    stop("AEDAR comparison requires the canonical territorial aggregate projection",call.=FALSE)
  if(is.null(aggregate_projection$source$vintage)||aggregate_projection$source$vintage!=AEDAR_AGGREGATE_VINTAGE||
     !nzchar(aedar_content_version)||!nzchar(reference_content_version))
    stop("AEDAR comparison source/reference version contract is invalid",call.=FALSE)
  if(!identical(aedar_content_version,aedar_aggregate_content_version(aggregate_projection)))
    stop("AEDAR comparison source version does not match canonical aggregate content",call.=FALSE)
  if(!all(c("territory_type","territory_id","epci_id","density_class_code")%in%names(territory_reference)))
    stop("AEDAR comparison requires versioned territory-reference membership",call.=FALSE)
  communes<-territory_reference[territory_reference$territory_type=="commune",,drop=FALSE]
  membership<-data.frame(territory_type="commune",territory_id=as.character(communes$density_class_code),
    member_commune=as.character(communes$territory_id),context="densite",stringsAsFactors=FALSE)
  membership<-membership[!is.na(membership$territory_id)&nzchar(membership$territory_id),,drop=FALSE]
  axis<-read_aedar_typequ_registry()
  if(is.list(address_facts)&&!is.data.frame(address_facts)) {
    if(is.null(observed_keys)) observed_keys<-aedar_observed_address_type_keys(address_facts)
    address_facts<-combine_aedar_address_mode_facts(address_facts)
  }
  density<-project_aedar_density_comparisons(address_origins,address_facts,membership,axis,observed_keys=observed_keys)
  if(is.null(input_hashes)) input_hashes<-c(address_origins="synthetic-input",address_modes="synthetic-input")
  input_identity<-as.character(jsonlite::toJSON(as.list(input_hashes),auto_unbox=TRUE))
  expected_input_version<-paste(as.character(openssl::sha256(charToRaw(input_identity))),collapse="")
  if(is.null(input_content_version)) input_content_version<-expected_input_version
  if(!identical(input_content_version,expected_input_version))
    stop("AEDAR comparison input identity hash is inconsistent",call.=FALSE)
  project_aedar_fixed_comparisons(aggregate_projection$facts,territory_reference,
    aedar_content_version,reference_content_version,density,input_content_version,input_hashes)
}

validate_aedar_comparison_projection <- function(x) {
  group_cols<-c("comparison_context","group_id","territory_type","TYPEQU","measure","statistic","value","n_addresses","n_observed","coverage_status",
    "member_count","eligible_count","missing_count","aedar_content_version","reference_content_version","input_content_version","input_identity","content_version")
  territory_cols<-c("comparison_context","group_id","territory_type","territory_id","TYPEQU","measure","value",
    "status","n_addresses","n_observed","coverage_status","rank","rank_size","aedar_content_version","reference_content_version","input_content_version","input_identity","content_version")
  if(!is.list(x)||!all(c("groups","territories","content_version","aedar_content_version","reference_content_version","input_content_version","input_identity")%in%names(x))||
     !setequal(names(x$groups),group_cols)||!setequal(names(x$territories),territory_cols))
    stop("Invalid AEDAR comparison projection shape",call.=FALSE)
  if(any(!x$groups$comparison_context%in%c("density_class","epci","bretagne","same_level"))||
     any(x$groups$territory_type!=ifelse(x$groups$comparison_context=="same_level",x$groups$territory_type,"commune"))||
     any(!x$groups$measure%in%AEDAR_AGGREGATE_MEASURES)||any(!x$territories$measure%in%AEDAR_AGGREGATE_MEASURES)||
     anyDuplicated(x$groups[c("comparison_context","group_id","territory_type","TYPEQU","measure")])||
     anyDuplicated(x$territories[c("comparison_context","group_id","territory_type","territory_id","TYPEQU","measure")])||
     any(x$groups$member_count!=x$groups$eligible_count+x$groups$missing_count)||
     any((x$territories$status=="measured")!=is.finite(x$territories$value)))
    stop("Invalid AEDAR fixed comparison keys or eligibility",call.=FALSE)
  if(!setequal(unique(x$groups$comparison_context),c("density_class","epci","bretagne","same_level")))
    stop("AEDAR fixed comparison projection omits a declared context",call.=FALSE)
  typequ_axis<-read_aedar_typequ_registry()$TYPEQU
  if(any(!x$groups$TYPEQU%in%typequ_axis)||any(!x$territories$TYPEQU%in%typequ_axis)||
     any(!x$groups$measure%in%AEDAR_AGGREGATE_MEASURES)||any(!x$territories$measure%in%AEDAR_AGGREGATE_MEASURES))
    stop("AEDAR comparison is missing the full TYPEQU × measure domain",call.=FALSE)
  scope_columns<-c("comparison_context","group_id","territory_type")
  scope_key<-function(frame) do.call(paste,c(frame[scope_columns],sep="\r"))
  expected_cross_product<-length(typequ_axis)*length(AEDAR_AGGREGATE_MEASURES)
  group_indices<-split(seq_len(nrow(x$groups)),scope_key(x$groups))
  territory_scope<-scope_key(x$territories)
  territory_indices<-split(seq_len(nrow(x$territories)),territory_scope)
  for(key in names(group_indices)) {
    gi_scope<-group_indices[[key]]
    if(length(gi_scope)!=expected_cross_product)
      stop("AEDAR comparison group is missing the full TYPEQU × measure cross product",call.=FALSE)
    member_count<-unique(x$groups$member_count[gi_scope])
    if(length(member_count)!=1L) stop("AEDAR comparison group has inconsistent member counts",call.=FALSE)
    ti_scope<-territory_indices[[key]]
    if(is.null(ti_scope)) stop("AEDAR comparison territory membership is incomplete",call.=FALSE)
    members<-unique(as.character(x$territories$territory_id[ti_scope]))
    if(length(members)!=member_count)
      stop("AEDAR comparison territory membership is incomplete",call.=FALSE)
    per_member<-table(as.character(x$territories$territory_id[ti_scope]))
    if(any(per_member!=expected_cross_product))
      stop("AEDAR comparison territory is missing the full TYPEQU × measure cross product",call.=FALSE)
  }
  keys<-c("comparison_context","group_id","territory_type","TYPEQU","measure")
  gi<-match(do.call(paste,c(x$territories[keys],sep="\r")),do.call(paste,c(x$groups[keys],sep="\r")))
  if(anyNA(gi)) stop("AEDAR comparison territory has no group statistic",call.=FALSE)
  measured<-x$territories$status=="measured"
  if(any(measured&(is.na(x$territories$rank)|is.na(x$territories$rank_size)|
      x$territories$rank_size!=x$groups$eligible_count[gi]|x$territories$rank>x$territories$rank_size))||
     any(!measured&(!is.na(x$territories$rank)|!is.na(x$territories$rank_size))))
    stop("Invalid AEDAR comparison rank contract",call.=FALSE)
  for(field in c("content_version","aedar_content_version","reference_content_version","input_content_version","input_identity")) {
    if(any(as.character(x$groups[[field]])!=x[[field]])||any(as.character(x$territories[[field]])!=x[[field]]))
      stop("AEDAR comparison rows disagree with publication versions",call.=FALSE)
  }
  unhashed_groups<-x$groups[setdiff(group_cols,"content_version")]
  unhashed_territories<-x$territories[setdiff(territory_cols,"content_version")]
  calculated<-aedar_comparison_content_version(unhashed_groups,unhashed_territories)
  if(!identical(calculated,x$content_version)) stop("AEDAR comparison content version does not match projection",call.=FALSE)
  if(!identical(paste(as.character(openssl::sha256(charToRaw(x$input_identity))),collapse=""),x$input_content_version))
    stop("AEDAR comparison input provenance hash does not match its identity",call.=FALSE)
  invisible(x)
}

validate_aedar_comparison_membership <- function(x,territory_reference) {
  required<-c("territory_type","territory_id","epci_id","density_class_code")
  if(!all(required%in%names(territory_reference))) stop("AEDAR comparison membership reference is incomplete",call.=FALSE)
  refs<-territory_reference
  refs$territory_id<-as.character(refs$territory_id)
  region<-refs$territory_id[refs$territory_type=="region"]
  if(length(region)!=1L) stop("AEDAR comparison membership requires one region",call.=FALSE)
  expected<-list()
  add<-function(context,id,type,members) {
    members<-sort(unique(as.character(members)))
    if(length(members)) expected[[length(expected)+1L]]<<-data.frame(comparison_context=context,
      group_id=as.character(id),territory_type=type,member_ids=I(list(members)),stringsAsFactors=FALSE)
  }
  communes<-refs[refs$territory_type=="commune",,drop=FALSE]
  for(id in sort(unique(communes$density_class_code[!is.na(communes$density_class_code)&nzchar(communes$density_class_code)])))
    add("density_class",id,"commune",communes$territory_id[communes$density_class_code==id])
  for(id in sort(unique(communes$epci_id[!is.na(communes$epci_id)&nzchar(communes$epci_id)])))
    add("epci",id,"commune",communes$territory_id[communes$epci_id==id])
  add("bretagne",region,"commune",communes$territory_id)
  for(type in c("epci","departement")) add("same_level",region,type,refs$territory_id[refs$territory_type==type])
  expected<-dplyr::bind_rows(expected)
  keycols<-c("comparison_context","group_id","territory_type")
  actual<-unique(x$groups[keycols])
  expected_keys<-unique(expected[keycols])
  key<-function(z) do.call(paste,c(z[keycols],sep="\r"))
  if(!setequal(key(actual),key(expected_keys))) stop("AEDAR comparison contexts/groups differ from published membership",call.=FALSE)
  for(i in seq_len(nrow(expected))) {
    hit<-x$territories$comparison_context==expected$comparison_context[[i]] &
      x$territories$group_id==expected$group_id[[i]] & x$territories$territory_type==expected$territory_type[[i]]
    if(!setequal(unique(as.character(x$territories$territory_id[hit])),expected$member_ids[[i]]))
      stop("AEDAR comparison territory membership is stale",call.=FALSE)
  }
  invisible(TRUE)
}

write_aedar_comparison_canonical <- function(x,directory=file.path("data","processed","aedar")) {
  validate_aedar_comparison_projection(x)
  dir.create(directory,recursive=TRUE,showWarnings=FALSE)
  targets<-file.path(directory,c("aedar_comparison_groups.parquet","aedar_comparison_territories.parquet"))
  staged<-vapply(targets,function(p) tempfile("aedar-comparison-",tmpdir=directory,fileext=".parquet"),character(1))
  backup<-vapply(targets,function(p) tempfile("aedar-comparison-backup-",tmpdir=directory,fileext=".parquet"),character(1))
  had<-file.exists(targets); installed<-rep(FALSE,2L); completed<-FALSE
  on.exit({
    unlink(staged[file.exists(staged)])
    if(!completed) for(i in seq_along(targets)) {
      if(installed[[i]]&&file.exists(targets[[i]])) unlink(targets[[i]])
      if(had[[i]]&&file.exists(backup[[i]])) file.rename(backup[[i]],targets[[i]])
    } else unlink(backup[file.exists(backup)])
  },add=TRUE)
  nanoparquet::write_parquet(x$groups,staged[[1L]])
  nanoparquet::write_parquet(x$territories,staged[[2L]])
  for(i in seq_along(targets)) if(had[[i]]&&!file.rename(targets[[i]],backup[[i]]))
    stop("Could not preserve previous AEDAR comparison artifact",call.=FALSE)
  for(i in seq_along(targets)) {
    if(!file.rename(staged[[i]],targets[[i]])) stop("Could not install complete AEDAR comparison artifacts",call.=FALSE)
    installed[[i]]<-TRUE
  }
  completed<-TRUE
  invisible(directory)
}

read_aedar_comparison_canonical <- function(directory=file.path("data","processed","aedar")) {
  gp<-file.path(directory,"aedar_comparison_groups.parquet"); tp<-file.path(directory,"aedar_comparison_territories.parquet")
  if(!file.exists(gp)||!file.exists(tp)) stop("Canonical AEDAR comparison Parquets are missing",call.=FALSE)
  groups<-as.data.frame(nanoparquet::read_parquet(gp)); territories<-as.data.frame(nanoparquet::read_parquet(tp))
  fields<-c("content_version","aedar_content_version","reference_content_version","input_content_version","input_identity")
  versions<-lapply(fields,function(f) unique(as.character(c(groups[[f]],territories[[f]]))))
  if(any(lengths(versions)!=1L)) stop("Canonical AEDAR comparison versions are inconsistent",call.=FALSE)
  names(versions)<-fields
  x<-list(groups=groups,territories=territories,content_version=versions$content_version,
    aedar_content_version=versions$aedar_content_version,reference_content_version=versions$reference_content_version,
    input_content_version=versions$input_content_version,input_identity=versions$input_identity)
  validate_aedar_comparison_projection(x); x
}

publish_aedar_comparisons <- function(x,con) {
  validate_aedar_comparison_projection(x)
  DBI::dbWithTransaction(con, {
    DBI::dbExecute(con,"SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
    DBI::dbGetQuery(con,"SELECT pg_advisory_xact_lock(594, 756)")
    deps<-DBI::dbGetQuery(con,"SELECT a.content_version aedar_content_version,r.content_version reference_content_version FROM table_publication a CROSS JOIN table_publication r WHERE a.table_name='aedar_territorial_aggregate' AND r.table_name='territory_reference' FOR SHARE OF a,r")
    if(nrow(deps)!=1L||deps$aedar_content_version[[1]]!=x$aedar_content_version||deps$reference_content_version[[1]]!=x$reference_content_version)
      stop("AEDAR comparison dependencies are stale",call.=FALSE)
    reference<-DBI::dbGetQuery(con,"SELECT territory_type,territory_id,epci_id,density_class_code FROM territory_reference")
    validate_aedar_comparison_membership(x,reference)
    current<-DBI::dbGetQuery(con,"SELECT content_version,input_content_version,group_row_count,territory_row_count FROM aedar_comparison_publication WHERE singleton")
    unchanged<-nrow(current)==1L&&identical(as.character(current$content_version[[1L]]),x$content_version)&&
       identical(as.character(current$input_content_version[[1L]]),x$input_content_version)&&
       current$group_row_count[[1L]]==nrow(x$groups)&&current$territory_row_count[[1L]]==nrow(x$territories)
    if(unchanged) {
      list(changed=FALSE,content_version=x$content_version,group_row_count=nrow(x$groups),territory_row_count=nrow(x$territories))
    } else {
      DBI::dbExecute(con,"DELETE FROM aedar_comparison_territory")
      DBI::dbExecute(con,"DELETE FROM aedar_comparison_group")
      group_data<-x$groups[c("comparison_context","group_id","territory_type","TYPEQU","measure","statistic","value","n_addresses","n_observed","coverage_status","member_count","eligible_count","missing_count")]
      territory_data<-x$territories[c("comparison_context","group_id","territory_type","territory_id","TYPEQU","measure","value","status","n_addresses","n_observed","coverage_status","rank","rank_size")]
      names(group_data)[names(group_data)=="TYPEQU"]<-"typequ"
      names(territory_data)[names(territory_data)=="TYPEQU"]<-"typequ"
      DBI::dbWriteTable(con,"aedar_comparison_group",group_data,append=TRUE,row.names=FALSE)
      DBI::dbWriteTable(con,"aedar_comparison_territory",territory_data,append=TRUE,row.names=FALSE)
      DBI::dbExecute(con,"INSERT INTO aedar_comparison_publication(singleton,content_version,source_snapshot_id,aedar_content_version,reference_content_version,input_content_version,input_identity,group_row_count,territory_row_count,published_at) VALUES(true,$1,'2026-v1',$2,$3,$4,$5::jsonb,$6,$7,now()) ON CONFLICT(singleton) DO UPDATE SET content_version=EXCLUDED.content_version,source_snapshot_id=EXCLUDED.source_snapshot_id,aedar_content_version=EXCLUDED.aedar_content_version,reference_content_version=EXCLUDED.reference_content_version,input_content_version=EXCLUDED.input_content_version,input_identity=EXCLUDED.input_identity,group_row_count=EXCLUDED.group_row_count,territory_row_count=EXCLUDED.territory_row_count,published_at=EXCLUDED.published_at",
        params=list(x$content_version,x$aedar_content_version,x$reference_content_version,x$input_content_version,
          x$input_identity,nrow(x$groups),nrow(x$territories)))
      list(changed=TRUE,content_version=x$content_version,group_row_count=nrow(x$groups),territory_row_count=nrow(x$territories))
    }
  })
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
    resource_paths<-download_aedar_sources(raw_dir)
    metadata_paths <- download_aedar_typequ_metadata(raw_dir)
    metadata <- project_aedar_typequ_metadata(metadata_paths[[1L]],metadata_paths[[2L]])
    projection<-project_aedar_aggregates(read_aedar_aggregate_inputs(download_aedar_aggregates(raw_dir)),metadata)
    address_resources<-AEDAR_SOURCE_RESOURCES[AEDAR_SOURCE_RESOURCES$kind=="address",,drop=FALSE]
    projection$address_resource_paths<-stats::setNames(unname(resource_paths[address_resources$filename]),address_resources$mode)
    projection
  }

publish_aedar_aggregates <- function(projection, db) {
  if (is.null(projection$typequ_metadata)) stop("AEDAR publication requires canonical TYPEQU metadata",call.=FALSE)
  projection$typequ_metadata <- validate_aedar_published_typequ_metadata(projection$typequ_metadata)
  facts <- projection$facts
  version <- aedar_aggregate_content_version(projection)
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
