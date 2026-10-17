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

# Build the density-class aggregate directly from the address-grain sources.
build_aedar_density_aggregate <- function(mode_paths,origins_path,crosswalk,
    density_reference_identity,density_reference_sha256,density_reference_vintage,
    output_path,verify_hashes=TRUE) {
  if(!is.character(mode_paths)||is.null(names(mode_paths))||
     !setequal(names(mode_paths),AEDAR_ADDRESS_SOURCE_MODES)||anyDuplicated(names(mode_paths)))
    stop("All six registered AEDAR address-mode resources are required",call.=FALSE)
  mode_paths<-mode_paths[AEDAR_ADDRESS_SOURCE_MODES]
  if(length(density_reference_identity)!=1L||is.na(density_reference_identity)||!nzchar(density_reference_identity)||
     length(density_reference_sha256)!=1L||is.na(density_reference_sha256)||!grepl("^[0-9a-fA-F]{64}$",density_reference_sha256)||
     length(density_reference_vintage)!=1L||is.na(density_reference_vintage)||!nzchar(density_reference_vintage))
    stop("AEDAR density aggregate requires the pinned local density-reference identity",call.=FALSE)
  if(tolower(normalizePath(output_path,winslash="/",mustWork=FALSE))%in%
     tolower(normalizePath(c(unname(mode_paths),origins_path),winslash="/",mustWork=FALSE)))
    stop("AEDAR density output must not overwrite an address input",call.=FALSE)
  required_crosswalk<-c("code_insee","density_class_code","density_class_label")
  if(!is.data.frame(crosswalk)||!all(required_crosswalk%in%names(crosswalk)))
    stop("Invalid commune-to-density-class reference crosswalk",call.=FALSE)
  crosswalk<-as.data.frame(crosswalk[required_crosswalk],stringsAsFactors=FALSE)
  for(column in required_crosswalk) crosswalk[[column]]<-as.character(crosswalk[[column]])
  if(!nrow(crosswalk)||anyNA(crosswalk)||any(!nzchar(as.matrix(crosswalk)))||
     anyDuplicated(crosswalk$code_insee))
    stop("Commune-to-density-class crosswalk must be complete and unique",call.=FALSE)
  labels_by_class<-split(crosswalk$density_class_label,crosswalk$density_class_code)
  if(any(vapply(labels_by_class,function(x) length(unique(x))!=1L,logical(1))))
    stop("Density class codes must each have one authoritative label",call.=FALSE)
  resources<-AEDAR_SOURCE_RESOURCES[AEDAR_SOURCE_RESOURCES$kind=="address",,drop=FALSE]
  if(tolower(normalizePath(output_path,winslash="/",mustWork=FALSE)) %in%
      tolower(normalizePath(c(file.path(dirname(output_path),AEDAR_AGGREGATE_RESOURCES$filename),unname(mode_paths),origins_path),winslash="/",mustWork=FALSE)))
    stop("AEDAR density output cannot overwrite a registered input aggregate or address source",call.=FALSE)
  for(i in seq_along(mode_paths)) {
    if(!file.exists(mode_paths[[i]])) stop(paste("Registered AEDAR address source is missing:",names(mode_paths)[[i]]),call.=FALSE)
    if(verify_hashes) verify_aedar_source_hash(mode_paths[[i]],resources$sha1[match(names(mode_paths)[[i]],resources$mode)])
  }
  if(!file.exists(origins_path)) stop("Configured AEDAR address-origin spine is missing",call.=FALSE)
  if(!requireNamespace("arrow",quietly=TRUE)) stop("arrow is required for AEDAR density aggregation",call.=FALSE)
  spine<-as.data.frame(arrow::read_parquet(origins_path, col_select=c("address_id","code_insee")),stringsAsFactors=FALSE)
  spine$address_id<-as.character(spine$address_id); spine$code_insee<-as.character(spine$code_insee)
  if(!nrow(spine)||anyNA(spine)||any(!nzchar(spine$address_id))||any(!nzchar(spine$code_insee))||anyDuplicated(spine[c("code_insee","address_id")]))
    stop("AEDAR address-origin spine violates its complete unique identity contract",call.=FALSE)
  if(any(!spine$code_insee%in%crosswalk$code_insee)) stop("Address-origin commune is absent from density crosswalk",call.=FALSE)
  denoms<-as.data.frame(dplyr::count(dplyr::inner_join(spine,crosswalk,by="code_insee"),density_class_code,density_class_label,name="n_addresses"))
  axis<-read_aedar_typequ_registry()[c("TYPEQU","LIB_TYPEQU")]
  classes<-unique(crosswalk[c("density_class_code","density_class_label")])
  out<-merge(classes,axis,by=NULL,sort=FALSE)
  out<-merge(out,denoms,by=c("density_class_code","density_class_label"),all.x=TRUE,sort=FALSE)
  out$n_addresses[is.na(out$n_addresses)]<-0L
  out$territory_type<-"density_class"; out$territory_id<-out$density_class_code
  out$n_observed<-0L; out$coverage_status<-ifelse(out$n_addresses>0,"covered","uncovered_no_address_origins")
  probs<-seq(.1,.9,.1); suffixes<-c("share","min","max",paste0("decile",1:9),"mean")
  input_hashes<-c(stats::setNames(vapply(mode_paths,sha256_aedar_file,character(1)),paste0("mode:",names(mode_paths))),
    address_origins=sha256_aedar_file(origins_path),density_reference=tolower(density_reference_sha256))
  input_identity<-as.character(jsonlite::toJSON(as.list(input_hashes),auto_unbox=TRUE))
  input_version<-paste(as.character(openssl::sha256(charToRaw(input_identity))),collapse="")
  for(mode in AEDAR_ADDRESS_SOURCE_MODES) {
    dataset<-arrow::open_dataset(mode_paths[[mode]],format="parquet")
    cols<-AEDAR_ADDRESS_SOURCE_COLUMNS[[mode]]
    for(source_column in cols) {
      stem<-sub("_p1$","",source_column)
      metric<-sub(paste0("_",mode,"$"),"",stem)
      measure_stem<-paste0(metric,"_",mode)
      value_hist<-dataset |>
        dplyr::select(code_insee,cle_interop_adr,TYPEQU,value=dplyr::all_of(source_column)) |>
        dplyr::filter(!is.na(.data$value)) |>
        dplyr::left_join(dplyr::select(crosswalk,code_insee,density_class_code),by="code_insee") |>
        dplyr::group_by(density_class_code,TYPEQU,value) |>
        dplyr::summarise(n=dplyr::n(),.groups="drop") |>
        dplyr::collect()
      if(anyNA(value_hist$density_class_code)||any(!value_hist$TYPEQU%in%axis$TYPEQU)) stop("Address mode contains unknown density or TYPEQU keys",call.=FALSE)
      for(key in unique(paste(value_hist$density_class_code,value_hist$TYPEQU,sep="\r"))) {
        hit<-which(paste(value_hist$density_class_code,value_hist$TYPEQU,sep="\r")==key)
        row<-match(key,paste(out$density_class_code,out$TYPEQU,sep="\r")); hist<-value_hist[hit,,drop=FALSE]
        n<-out$n_addresses[[row]]; vals<-as.numeric(hist$value); weights<-as.numeric(hist$n)
        if(!n) stats<-rep(NA_real_,13L) else {
          zeros<-n-sum(weights); allv<-c(0,vals); allw<-c(zeros,weights); ord<-order(allv); allv<-allv[ord]; cumulative<-cumsum(allw[ord])
          at<-function(rank) allv[which(cumulative>=rank)[[1L]]]
          quant<-vapply(probs,function(p) {h<-1+(n-1)*p; lo<-floor(h); f<-h-lo; a<-at(lo); if(!f||lo==n)a else a+f*(at(lo+1)-a)},numeric(1))
          stats<-c(if(mode=="transit_gain")sum(weights[vals!=0])/n else sum(weights[vals>0])/n,
            if(zeros>0)0 else min(vals),if(zeros>0)max(c(0,vals)) else max(vals),quant,sum(vals*weights)/n)
        }
        out[row,paste0(measure_stem,"_",suffixes)]<-as.list(stats)
      }
    }
  }
  # Union observed source keys one TYPEQU at a time. The large car source has
  # hundreds of millions of address/TYPEQU rows; materializing its full key
  # table through a partition writer is not bounded on Windows Arrow.
  source_modes<-setdiff(AEDAR_ADDRESS_SOURCE_MODES,"transit_gain")
  observed_paths<-unname(mode_paths[source_modes])
  observed_dataset<-arrow::open_dataset(observed_paths,format="parquet")
  spine_arrow<-arrow::arrow_table(data.frame(code_insee=spine$code_insee,
    cle_interop_adr=spine$address_id,.__origin=TRUE,stringsAsFactors=FALSE))
  for(mode in AEDAR_ADDRESS_SOURCE_MODES) {
    dataset<-arrow::open_dataset(mode_paths[[mode]],format="parquet")
    types<-dataset |> dplyr::select(TYPEQU) |> dplyr::distinct() |> dplyr::collect()
    if(anyNA(types$TYPEQU)||any(!as.character(types$TYPEQU)%in%axis$TYPEQU))
      stop(paste("AEDAR source mode has TYPEQU outside the pinned registry:",mode),call.=FALSE)
    duplicates<-dataset |> dplyr::group_by(code_insee,cle_interop_adr,TYPEQU) |>
      dplyr::summarise(n=dplyr::n(),.groups="drop") |> dplyr::filter(.data$n>1L) |>
      dplyr::summarise(n=dplyr::n(),.groups="drop") |> dplyr::collect()
    if(nrow(duplicates)&&duplicates$n[[1L]]>0L) stop(paste("AEDAR source mode has duplicate address/TYPEQU keys:",mode),call.=FALSE)
  }
  typequ_batches<-split(axis$TYPEQU,ceiling(seq_along(axis$TYPEQU)/10L))
  for(batch_index in seq_along(typequ_batches)) {
    typequ_batch<-typequ_batches[[batch_index]]
    observed<-observed_dataset |>
      dplyr::select(code_insee,cle_interop_adr,TYPEQU) |>
      dplyr::filter(.data$TYPEQU%in%typequ_batch) |>
      dplyr::distinct(code_insee,cle_interop_adr,TYPEQU) |>
      dplyr::left_join(spine_arrow,by=c("code_insee","cle_interop_adr")) |>
      dplyr::left_join(dplyr::select(crosswalk,code_insee,density_class_code),by="code_insee") |>
      dplyr::group_by(density_class_code,TYPEQU) |>
      dplyr::summarise(n_observed=dplyr::n(),n_invalid=sum(is.na(.data$.__origin)),.groups="drop") |>
      dplyr::collect()
    if(any(observed$n_invalid>0L)||anyNA(observed$density_class_code))
      stop("AEDAR observed address/TYPEQU union contains keys outside the address-origin spine or density crosswalk",call.=FALSE)
    for(j in seq_len(nrow(observed))) {
      r<-match(paste(observed$density_class_code[j],observed$TYPEQU[j],sep="\r"),paste(out$density_class_code,out$TYPEQU,sep="\r"))
      if(!is.na(r)) out$n_observed[r]<-observed$n_observed[j]
    }
    cat("[aedar-density] observed TYPEQU batch",batch_index,"/",length(typequ_batches),"complete\n")
  }
  for(m in AEDAR_AGGREGATE_MEASURES) {
    if(!m%in%names(out)) out[[m]]<-NA_real_
    covered_missing<-out$coverage_status=="covered" & is.na(out[[m]])
    out[[m]][covered_missing]<-0
  }
  out$source_snapshot_id<-AEDAR_AGGREGATE_VINTAGE; out$density_reference_identity<-density_reference_identity
  out$density_reference_sha256<-tolower(density_reference_sha256); out$density_reference_vintage<-density_reference_vintage
  out$input_content_version<-input_version; out$input_identity<-input_identity
  out<-out[c("territory_type","territory_id","density_class_code","density_class_label","TYPEQU","LIB_TYPEQU","n_addresses","n_observed","coverage_status",AEDAR_AGGREGATE_MEASURES,"source_snapshot_id","density_reference_identity","density_reference_sha256","density_reference_vintage","input_content_version","input_identity")]
  out$content_version<-paste(as.character(openssl::sha256(serialize(out,NULL))),collapse="")
  dir.create(dirname(output_path),recursive=TRUE,showWarnings=FALSE)
  tmp<-paste0(output_path,".part"); on.exit(unlink(tmp),add=TRUE)
  arrow::write_parquet(out,tmp); check<-as.data.frame(arrow::read_parquet(tmp),stringsAsFactors=FALSE)
  if(nrow(check)!=nrow(classes)*AEDAR_TYPEQU_REGISTRY_COUNT||!all(AEDAR_AGGREGATE_MEASURES%in%names(check))||
     anyDuplicated(check[c("density_class_code","TYPEQU")])||
     any(vapply(split(check$TYPEQU,check$density_class_code),function(x)!setequal(x,axis$TYPEQU),logical(1))))
    stop("Generated AEDAR density artifact failed complete-schema validation",call.=FALSE)
  if(!file.rename(tmp,output_path)) stop("Could not atomically install AEDAR density artifact",call.=FALSE)
  out
}

sha256_aedar_file <- function(path) {
  if(!file.exists(path)||is.na(file.info(path)$size)||file.info(path)$size<1L)
    stop(paste("AEDAR input file is missing or empty:",basename(path)),call.=FALSE)
  paste(as.character(openssl::sha256(readBin(path,"raw",n=file.info(path)$size))),collapse="")
}

read_aedar_density_reference <- function(path=file.path("data","raw",MANIFEST_CLASSES_DENSITE[["fichier"]][[1L]])) {
  manifest<-MANIFEST_CLASSES_DENSITE
  expected_hash<-manifest[["sha256"]][[1L]]
  actual_hash<-sha256_aedar_file(path)
  if(!identical(tolower(actual_hash),tolower(expected_hash)))
    stop("Pinned local commune-density source checksum mismatch",call.=FALSE)
  classes<-lire_classes_densite(path)
  registry<-registre_classes_densite()
  class_index<-match(as.character(classes[["DENS7"]]),registry[["classe_densite_code"]])
  if(anyNA(class_index)||anyNA(classes[["CODGEO"]])||anyNA(classes[["LIBDENS7"]])||
     any(as.character(classes[["LIBDENS7"]])!=registry[["classe_densite_libelle_insee"]][class_index])||
     anyDuplicated(classes[["CODGEO"]]))
    stop("Local commune-density source disagrees with the authoritative class registry",call.=FALSE)
  crosswalk<-data.frame(code_insee=as.character(classes[["CODGEO"]]),
    density_class_code=as.character(classes[["DENS7"]]),
    density_class_label=as.character(registry[["classe_densite_libelle_public"]][class_index]),
    stringsAsFactors=FALSE)
  labels<-split(crosswalk$density_class_label,crosswalk$density_class_code)
  if(!setequal(unique(crosswalk$density_class_code),registry[["classe_densite_code"]])||
     any(vapply(labels,function(x)length(unique(x))!=1L,logical(1))))
    stop("Local commune-density source does not cover the registered classes consistently",call.=FALSE)
  list(crosswalk=crosswalk,identity=manifest[["id"]][[1L]],sha256=tolower(actual_hash),
    vintage=manifest[["vintage"]][[1L]],path=normalizePath(path,winslash="/",mustWork=TRUE))
}

validate_aedar_density_aggregate <- function(facts,density_reference) {
  measures<-AEDAR_AGGREGATE_MEASURES
  required<-c("territory_type","territory_id","density_class_code","density_class_label",
    "TYPEQU","LIB_TYPEQU","n_addresses","n_observed","coverage_status",measures,
    "source_snapshot_id","density_reference_identity","density_reference_sha256",
    "density_reference_vintage","input_content_version","input_identity","content_version")
  if(!is.data.frame(facts)||!setequal(names(facts),required)||ncol(facts)!=length(required))
    stop("AEDAR density aggregate has an unexpected or incomplete schema",call.=FALSE)
  content_columns<-c("territory_type","territory_id","density_class_code","density_class_label",
    "TYPEQU","LIB_TYPEQU","n_addresses","n_observed","coverage_status",measures,
    "source_snapshot_id","density_reference_identity","density_reference_sha256",
    "density_reference_vintage","input_content_version","input_identity")
  ref_fields<-c("crosswalk","identity","sha256","vintage")
  if(!is.list(density_reference)||!all(ref_fields%in%names(density_reference))||
     !is.data.frame(density_reference$crosswalk))
    stop("AEDAR density aggregate requires its authoritative local reference",call.=FALSE)
  cw<-density_reference$crosswalk
  if(!all(c("code_insee","density_class_code","density_class_label")%in%names(cw))||
     anyDuplicated(cw$code_insee)||anyNA(cw[c("code_insee","density_class_code","density_class_label")]))
    stop("Authoritative local density crosswalk is incomplete or ambiguous",call.=FALSE)
  if(!nrow(facts)||anyNA(facts[c("territory_type","territory_id","density_class_code","density_class_label",
      "TYPEQU","LIB_TYPEQU","n_addresses","n_observed","coverage_status","source_snapshot_id",
      "density_reference_identity","density_reference_sha256","density_reference_vintage",
      "input_content_version","input_identity","content_version")]))
    stop("AEDAR density aggregate has missing key/provenance fields",call.=FALSE)
  if(any(facts$territory_type!="density_class")||any(facts$source_snapshot_id!=AEDAR_AGGREGATE_VINTAGE)||
     any(facts$density_reference_identity!=density_reference$identity)||
     any(tolower(facts$density_reference_sha256)!=tolower(density_reference$sha256))||
     any(facts$density_reference_vintage!=density_reference$vintage))
    stop("AEDAR density aggregate source/reference provenance is incompatible",call.=FALSE)
  axis<-read_aedar_typequ_registry()
  if(anyDuplicated(axis$TYPEQU)||nrow(axis)!=AEDAR_TYPEQU_REGISTRY_COUNT||
     any(!facts$TYPEQU%in%axis$TYPEQU)||anyNA(axis$LIB_TYPEQU))
    stop("AEDAR density aggregate TYPEQU axis differs from the pinned registry",call.=FALSE)
  labels<-axis$LIB_TYPEQU[match(facts$TYPEQU,axis$TYPEQU)]
  if(any(!compare_aedar_typequ_labels_for_validation(facts$LIB_TYPEQU,labels,facts$TYPEQU)))
    stop("AEDAR density aggregate TYPEQU labels differ from the pinned registry",call.=FALSE)
  expected_classes<-unique(cw[c("density_class_code","density_class_label")])
  actual_classes<-unique(facts[c("density_class_code","density_class_label")])
  if(!setequal(expected_classes$density_class_code,actual_classes$density_class_code)||
     anyDuplicated(actual_classes$density_class_code)||anyDuplicated(facts[c("density_class_code","TYPEQU")])||
     !setequal(paste(expected_classes$density_class_code,expected_classes$density_class_label,sep="\r"),
       paste(actual_classes$density_class_code,actual_classes$density_class_label,sep="\r"))||
     any(as.character(facts$territory_id)!=as.character(facts$density_class_code)))
    stop("AEDAR density aggregate class axis is incomplete, duplicated, or mislabeled",call.=FALSE)
  groups<-split(facts$TYPEQU,facts$density_class_code)
  if(any(vapply(groups,function(x)length(x)!=AEDAR_TYPEQU_REGISTRY_COUNT||!setequal(x,axis$TYPEQU),logical(1))))
    stop("AEDAR density aggregate omits a density class × TYPEQU coordinate",call.=FALSE)
  denominator_groups<-split(facts$n_addresses,facts$density_class_code)
  if(any(vapply(denominator_groups,function(x)length(unique(x))!=1L,logical(1))))
    stop("AEDAR density aggregate has inconsistent class address denominators",call.=FALSE)
  if(any(!is.finite(facts$n_addresses))||any(!is.finite(facts$n_observed))||
     any(facts$n_addresses<0|facts$n_observed<0|facts$n_observed>facts$n_addresses)||
     any(!facts$coverage_status%in%c("covered","uncovered_no_address_origins"))||
     any((facts$n_addresses>0)!=(facts$coverage_status=="covered")))
    stop("AEDAR density aggregate denominators/coverage are invalid",call.=FALSE)
  values<-as.matrix(facts[,measures,drop=FALSE]); storage.mode(values)<-"double"
  covered<-facts$coverage_status=="covered"
  if(any(!is.finite(values[covered,,drop=FALSE]))||any(!is.na(values[!covered,,drop=FALSE])))
    stop("AEDAR density aggregate covered/uncovered measure states are invalid",call.=FALSE)
  content_version<-unique(as.character(facts$content_version))
  computed_content_version<-paste(as.character(openssl::sha256(serialize(facts[content_columns],NULL))),collapse="")
  if(length(content_version)!=1L||!grepl("^[0-9a-fA-F]{64}$",content_version)||
     !identical(tolower(content_version),tolower(computed_content_version)))
    stop("AEDAR density aggregate content identity is missing or does not match its facts",call.=FALSE)
  input_identity<-unique(as.character(facts$input_identity))
  input_version<-unique(as.character(facts$input_content_version))
  if(length(input_identity)!=1L||length(input_version)!=1L||!grepl("^[0-9a-fA-F]{64}$",input_version)||
     !identical(paste(as.character(openssl::sha256(charToRaw(input_identity))),collapse=""),input_version))
    stop("AEDAR density aggregate input provenance hash is invalid",call.=FALSE)
  identity<-tryCatch(jsonlite::fromJSON(input_identity,simplifyVector=TRUE),error=function(e) NULL)
  identity_values<-if(is.list(identity)) unlist(identity,use.names=TRUE) else identity
  expected_names<-c(paste0("mode:",AEDAR_ADDRESS_SOURCE_MODES),"address_origins","density_reference")
  if(is.null(identity_values)||!is.atomic(identity_values)||is.null(names(identity_values))||!setequal(names(identity_values),expected_names)||
     any(!grepl("^[0-9a-fA-F]{64}$",as.character(identity_values)))||
     !identical(tolower(as.character(identity_values[["density_reference"]])),tolower(density_reference$sha256)))
    stop("AEDAR density aggregate source input identity is incomplete or incompatible",call.=FALSE)
  invisible(list(input_hashes=identity_values,input_content_version=input_version[[1L]],
    content_version=content_version[[1L]],input_identity=input_identity[[1L]]))
}

read_aedar_density_aggregate <- function(path=file.path("data","raw","aedar_density_aggregate.parquet"),
    density_reference=read_aedar_density_reference(),expected_sha256=NULL) {
  artifact_sha256<-sha256_aedar_file(path)
  if(!is.null(expected_sha256)&&!identical(tolower(artifact_sha256),tolower(expected_sha256)))
    stop("AEDAR density aggregate artifact checksum mismatch",call.=FALSE)
  facts<-as.data.frame(nanoparquet::read_parquet(path),stringsAsFactors=FALSE)
  provenance<-validate_aedar_density_aggregate(facts,density_reference)
  list(facts=facts,crosswalk=density_reference$crosswalk,
    density_reference=density_reference,input_hashes=provenance$input_hashes,
    input_content_version=provenance$input_content_version,input_identity=provenance$input_identity,
    content_version=provenance$content_version,artifact_sha256=tolower(artifact_sha256),
    source_snapshot_id=AEDAR_AGGREGATE_VINTAGE)
}

validate_aedar_density_membership <- function(density_source,territory_reference) {
  required<-c("territory_type","territory_id","density_class_code")
  if(!is.list(density_source)||!is.data.frame(density_source$crosswalk)||!all(required%in%names(territory_reference)))
    stop("AEDAR density/reference membership inputs are incomplete",call.=FALSE)
  communes<-territory_reference[territory_reference$territory_type=="commune",,drop=FALSE]
  cw<-density_source$crosswalk
  idx<-match(as.character(communes$territory_id),as.character(cw$code_insee))
  if(anyNA(idx)||anyNA(communes$density_class_code)||
     any(as.character(communes$density_class_code)!=as.character(cw$density_class_code[idx])))
    stop("Published commune density membership disagrees with the pinned local INSEE source",call.=FALSE)
  if("density_class_label"%in%names(communes)&&any(!is.na(communes$density_class_label)&
      as.character(communes$density_class_label)!=as.character(cw$density_class_label[idx])))
    stop("Published commune density labels disagree with the pinned local INSEE source",call.=FALSE)
  invisible(TRUE)
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
    input_content_version=NULL,input_hashes=c(synthetic="fixture"),
    typequ_codes=NULL,calculate_content_version=TRUE) {
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
  if(!is.null(typequ_codes)) {
    if(!length(typequ_codes)||anyNA(typequ_codes)||anyDuplicated(typequ_codes)||any(!typequ_codes%in%typequ_axis))
      stop("AEDAR comparison partition TYPEQU selection is invalid",call.=FALSE)
    typequ_axis<-typequ_axis[typequ_axis%in%typequ_codes]
  }
  refs <- territory_reference
  refs$territory_id <- as.character(refs$territory_id)
  comm <- refs[refs$territory_type=="commune",,drop=FALSE]
  region <- refs$territory_id[refs$territory_type=="region"]
  if(length(region)!=1L) stop("AEDAR comparison reference requires one region",call.=FALSE)
  groups <- list(); territory_rows <- list(); ng <- nt <- 0L
  rank_scope <- function(context, group_id, type, ids, statistic_source=NULL) {
    ids<-as.character(ids)
    rows <- aggregate_facts[aggregate_facts$territory_type==type & aggregate_facts$territory_id %in% ids &
      aggregate_facts$TYPEQU%in%typequ_axis,,drop=FALSE]
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
       statistic<-if(context=="density_class") "pooled" else if(context%in%c("epci","bretagne")&&type=="commune") "direct" else "median"
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
  content_version<-if(isTRUE(calculate_content_version)) aedar_comparison_content_version(group_rows,result_rows) else NULL
  if(!is.null(content_version)) {group_rows$content_version<-content_version; result_rows$content_version<-content_version}
  list(groups=group_rows,territories=result_rows,aedar_content_version=aedar_content_version,
    reference_content_version=reference_content_version,input_content_version=input_content_version,
    input_identity=input_identity,content_version=content_version)
}

project_aedar_comparison_publication_fixture <- function(aggregate_projection,density_source,
    territory_reference,aedar_content_version=aedar_aggregate_content_version(aggregate_projection),
    reference_content_version) {
  if(!is.list(aggregate_projection)||!is.data.frame(aggregate_projection$facts))
    stop("AEDAR comparison requires the canonical territorial aggregate projection",call.=FALSE)
  if(is.null(aggregate_projection$source$vintage)||aggregate_projection$source$vintage!=AEDAR_AGGREGATE_VINTAGE||
     !nzchar(aedar_content_version)||!nzchar(reference_content_version))
    stop("AEDAR comparison source/reference version contract is invalid",call.=FALSE)
  if(!identical(aedar_content_version,aedar_aggregate_content_version(aggregate_projection)))
    stop("AEDAR comparison source version does not match canonical aggregate content",call.=FALSE)
  if(!all(c("territory_type","territory_id","epci_id","density_class_code")%in%names(territory_reference)))
    stop("AEDAR comparison requires versioned territory-reference membership",call.=FALSE)
  if(!is.list(density_source)||!is.data.frame(density_source$facts)||
     !is.list(density_source$density_reference)||length(density_source$artifact_sha256)!=1L||
     !grepl("^[0-9a-fA-F]{64}$",density_source$artifact_sha256))
    stop("AEDAR comparison requires a validated materialized density aggregate",call.=FALSE)
  validated_density<-validate_aedar_density_aggregate(density_source$facts,density_source$density_reference)
  if(!identical(validated_density$content_version,density_source$content_version)||
     !identical(validated_density$input_content_version,density_source$input_content_version)||
     !setequal(names(validated_density$input_hashes),names(density_source$input_hashes))||
     any(validated_density$input_hashes[names(density_source$input_hashes)]!=density_source$input_hashes)||
     !identical(density_source$source_snapshot_id,AEDAR_AGGREGATE_VINTAGE))
    stop("AEDAR materialized density source identity is inconsistent",call.=FALSE)
  validate_aedar_density_membership(density_source,territory_reference)
  communes<-territory_reference[territory_reference$territory_type=="commune",,drop=FALSE]
  density<-density_source$facts
  if(!all(c("density_class_code","TYPEQU","LIB_TYPEQU","n_addresses","n_observed","coverage_status",AEDAR_AGGREGATE_MEASURES)%in%names(density)))
    stop("Materialized AEDAR density aggregate is incomplete",call.=FALSE)
  input_hashes<-c(density_source$input_hashes,
    density_artifact=density_source$artifact_sha256,
    density_aggregate_content_version=density_source$content_version,
    density_reference_identity=density_source$density_reference$identity,
    density_reference_sha256=density_source$density_reference$sha256,
    density_reference_vintage=density_source$density_reference$vintage)
  input_identity<-as.character(jsonlite::toJSON(as.list(input_hashes),auto_unbox=TRUE))
  expected_input_version<-paste(as.character(openssl::sha256(charToRaw(input_identity))),collapse="")
  input_content_version<-expected_input_version
  project_aedar_fixed_comparisons(aggregate_projection$facts,territory_reference,
    aedar_content_version,reference_content_version,density,input_content_version,input_hashes)
}

project_aedar_comparison_publication <- function(aggregate_projection,density_source,
    territory_reference,reference_content_version,directory=file.path("data","processed","aedar"),
    aedar_content_version=aedar_aggregate_content_version(aggregate_projection)) {
  if(!is.list(aggregate_projection)||!is.data.frame(aggregate_projection$facts)||
     is.null(aggregate_projection$source$vintage)||aggregate_projection$source$vintage!=AEDAR_AGGREGATE_VINTAGE||
     !identical(aedar_content_version,aedar_aggregate_content_version(aggregate_projection))||
     length(reference_content_version)!=1L||is.na(reference_content_version)||!nzchar(reference_content_version))
    stop("AEDAR comparison source/reference version contract is invalid",call.=FALSE)
  required_ref<-c("territory_type","territory_id","epci_id","density_class_code")
  if(!all(required_ref%in%names(territory_reference))) stop("AEDAR comparison requires versioned territory-reference membership",call.=FALSE)
  if(!is.list(density_source)||!is.data.frame(density_source$facts)||
     !is.list(density_source$density_reference)||length(density_source$artifact_sha256)!=1L||
     !grepl("^[0-9a-fA-F]{64}$",density_source$artifact_sha256))
    stop("AEDAR comparison requires a validated materialized density aggregate",call.=FALSE)
  validated_density<-validate_aedar_density_aggregate(density_source$facts,density_source$density_reference)
  if(!identical(validated_density$content_version,density_source$content_version)||
     !identical(validated_density$input_content_version,density_source$input_content_version)||
     !setequal(names(validated_density$input_hashes),names(density_source$input_hashes))||
     any(validated_density$input_hashes[names(density_source$input_hashes)]!=density_source$input_hashes)||
     !identical(density_source$source_snapshot_id,AEDAR_AGGREGATE_VINTAGE))
    stop("AEDAR materialized density source identity is inconsistent",call.=FALSE)
  validate_aedar_density_membership(density_source,territory_reference)
  input_hashes<-c(density_source$input_hashes,density_artifact=density_source$artifact_sha256,
    density_aggregate_content_version=density_source$content_version,
    density_reference_identity=density_source$density_reference$identity,
    density_reference_sha256=density_source$density_reference$sha256,
    density_reference_vintage=density_source$density_reference$vintage)
  input_identity<-as.character(jsonlite::toJSON(as.list(input_hashes),auto_unbox=TRUE))
  input_content_version<-paste(as.character(openssl::sha256(charToRaw(input_identity))),collapse="")
  membership<-aedar_comparison_membership_rows(territory_reference)
  axis<-read_aedar_typequ_registry()
  writer<-function(typequ) {
    chunk<-project_aedar_fixed_comparisons(aggregate_projection$facts,territory_reference,
      aedar_content_version,reference_content_version,density_source$facts,input_content_version,
      input_hashes,typequ_codes=typequ,calculate_content_version=FALSE)
    chunk
  }
  write_aedar_comparison_canonical(writer,directory,list(
    source_snapshot_id=AEDAR_AGGREGATE_VINTAGE,aedar_content_version=aedar_content_version,
    reference_content_version=reference_content_version,input_content_version=input_content_version,
    input_identity=input_identity,membership=membership,typequ_axis=axis$TYPEQU,
    typequ_axis_sha256=AEDAR_TYPEQU_REGISTRY_SHA256))
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
     any(x$groups$statistic!=ifelse(x$groups$comparison_context=="density_class","pooled",
       ifelse(x$groups$comparison_context%in%c("epci","bretagne")&x$groups$territory_type=="commune","direct","median")))||
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

AEDAR_COMPARISON_GROUP_COLUMNS<-c("comparison_context","group_id","territory_type","TYPEQU","measure","statistic","value",
  "n_addresses","n_observed","coverage_status","member_count","eligible_count","missing_count")
AEDAR_COMPARISON_TERRITORY_COLUMNS<-c("comparison_context","group_id","territory_type","territory_id","TYPEQU","measure","value",
  "status","n_addresses","n_observed","coverage_status","rank","rank_size")

aedar_comparison_membership_rows <- function(territory_reference) {
  refs<-territory_reference; refs$territory_id<-as.character(refs$territory_id)
  region<-refs$territory_id[refs$territory_type=="region"]
  if(length(region)!=1L) stop("AEDAR comparison membership requires one region",call.=FALSE)
  communes<-refs[refs$territory_type=="commune",,drop=FALSE]
  rows<-list(); add<-function(context,id,type,members) {
    members<-sort(unique(as.character(members)))
    if(length(members)) rows[[length(rows)+1L]]<<-data.frame(comparison_context=context,
      group_id=as.character(id),territory_type=type,territory_id=members,stringsAsFactors=FALSE)
  }
  for(id in sort(unique(communes$density_class_code[!is.na(communes$density_class_code)&nzchar(communes$density_class_code)])))
    add("density_class",id,"commune",communes$territory_id[communes$density_class_code==id])
  for(id in sort(unique(communes$epci_id[!is.na(communes$epci_id)&nzchar(communes$epci_id)])))
    add("epci",id,"commune",communes$territory_id[communes$epci_id==id])
  add("bretagne",region,"commune",communes$territory_id)
  for(type in c("epci","departement")) add("same_level",region,type,refs$territory_id[refs$territory_type==type])
  result<-dplyr::bind_rows(rows)
  if(anyDuplicated(result[c("comparison_context","group_id","territory_type","territory_id")]))
    stop("AEDAR published comparison membership contains duplicate members",call.=FALSE)
  result
}

aedar_comparison_part_content_hash <- function(groups,territories) {
  aedar_comparison_content_version(groups,territories)
}

validate_aedar_comparison_part <- function(groups,territories,typequ,membership) {
  if(!identical(names(groups),AEDAR_COMPARISON_GROUP_COLUMNS)||
     !identical(names(territories),AEDAR_COMPARISON_TERRITORY_COLUMNS)||
     !nrow(groups)||!nrow(territories)||any(groups$TYPEQU!=typequ)||any(territories$TYPEQU!=typequ)||
     anyNA(groups[c("comparison_context","group_id","territory_type","measure","statistic","member_count","eligible_count","missing_count")])||
     anyNA(territories[c("comparison_context","group_id","territory_type","territory_id","measure","status")])||
     anyDuplicated(groups[c("comparison_context","group_id","territory_type","TYPEQU","measure")])||
     anyDuplicated(territories[c("comparison_context","group_id","territory_type","territory_id","TYPEQU","measure")]))
    stop("AEDAR comparison partition has an invalid schema or duplicate key",call.=FALSE)
  expected_statistic<-ifelse(groups$comparison_context=="density_class","pooled",
    ifelse(groups$comparison_context%in%c("epci","bretagne")&groups$territory_type=="commune","direct","median"))
  if(any(groups$statistic!=expected_statistic)) stop("AEDAR comparison partition has an invalid fixed-context statistic",call.=FALSE)
  expected_scopes<-unique(membership[c("comparison_context","group_id","territory_type")])
  actual_scopes<-unique(groups[c("comparison_context","group_id","territory_type")])
  key<-function(x) do.call(paste,c(x,sep="\r"))
  if(!setequal(key(expected_scopes),key(actual_scopes))) stop("AEDAR comparison partition omits fixed contexts or groups",call.=FALSE)
  for(i in seq_len(nrow(expected_scopes))) {
    s<-expected_scopes[i,,drop=FALSE]
    group<-groups[groups$comparison_context==s$comparison_context&groups$group_id==s$group_id&groups$territory_type==s$territory_type,,drop=FALSE]
    peers<-membership[membership$comparison_context==s$comparison_context&membership$group_id==s$group_id&membership$territory_type==s$territory_type,,drop=FALSE]
    territory<-territories[territories$comparison_context==s$comparison_context&territories$group_id==s$group_id&territories$territory_type==s$territory_type,,drop=FALSE]
    if(nrow(group)!=length(AEDAR_AGGREGATE_MEASURES)||!setequal(group$measure,AEDAR_AGGREGATE_MEASURES)||
       any(group$member_count!=nrow(peers))||any(group$member_count!=group$eligible_count+group$missing_count)||
       !setequal(unique(territory$territory_id),peers$territory_id)||nrow(territory)!=nrow(peers)*length(AEDAR_AGGREGATE_MEASURES))
      stop("AEDAR comparison partition has incomplete measure/member coverage",call.=FALSE)
    member_sizes<-table(territory$territory_id)
    if(any(member_sizes!=length(AEDAR_AGGREGATE_MEASURES))||
       anyDuplicated(territory[c("territory_id","measure")])||
       !setequal(territory$measure,AEDAR_AGGREGATE_MEASURES))
      stop("AEDAR comparison partition omits a member measure",call.=FALSE)
    mi<-match(territory$measure,group$measure); measured<-territory$status=="measured"
    if(any(measured!=is.finite(territory$value))||
       any(measured&(is.na(territory$rank)|is.na(territory$rank_size)|territory$rank_size!=group$eligible_count[mi]|territory$rank>territory$rank_size))||
       any(!measured&(!is.na(territory$rank)|!is.na(territory$rank_size))))
      stop("AEDAR comparison partition violates result/rank contracts",call.=FALSE)
  }
  invisible(TRUE)
}

aedar_comparison_manifest_version <- function(manifest) {
  persisted_fields<-c("schema_version","source_snapshot_id","aedar_content_version",
    "reference_content_version","input_content_version","input_identity","typequ_axis",
    "typequ_axis_sha256","group_columns","territory_columns","membership",
    "group_row_count","territory_row_count","parts")
  payload<-manifest[persisted_fields]
  payload$parts<-lapply(payload$parts,function(p) p[c("TYPEQU","group_rows","territory_rows","content_sha256")])
  paste(as.character(openssl::sha256(charToRaw(as.character(jsonlite::toJSON(payload,auto_unbox=TRUE,
    dataframe="rows",null="null",digits=NA,pretty=FALSE))))),collapse="")
}

install_aedar_comparison_manifest <- function(staged,target) fs::file_move(staged,target)

validate_aedar_comparison_input_identity <- function(identity,input_content_version) {
  expected_names<-c(paste0("mode:",AEDAR_ADDRESS_SOURCE_MODES),"address_origins","density_reference",
    "density_artifact","density_aggregate_content_version","density_reference_identity",
    "density_reference_sha256","density_reference_vintage")
  values<-tryCatch(jsonlite::fromJSON(identity,simplifyVector=TRUE),error=function(e) NULL)
  if(is.list(values)) values<-unlist(values,use.names=TRUE)
  manifest<-MANIFEST_CLASSES_DENSITE
  if(is.null(values)||!is.atomic(values)||is.null(names(values))||anyDuplicated(names(values))||
     !setequal(names(values),expected_names)||anyNA(values)||
     !identical(paste(as.character(openssl::sha256(charToRaw(identity))),collapse=""),input_content_version)||
     any(!grepl("^[0-9a-fA-F]{64}$",as.character(values[c(paste0("mode:",AEDAR_ADDRESS_SOURCE_MODES),
        "address_origins","density_reference","density_artifact","density_aggregate_content_version","density_reference_sha256")])) )||
     !identical(as.character(values[["density_reference_identity"]]),as.character(manifest[["id"]][[1L]]))||
     !identical(tolower(as.character(values[["density_reference_sha256"]])),tolower(as.character(manifest[["sha256"]][[1L]])))||
     !identical(as.character(values[["density_reference_vintage"]]),as.character(manifest[["vintage"]][[1L]])))
    stop("AEDAR comparison input identity omits or changes a pinned source/reference",call.=FALSE)
  invisible(values)
}

write_aedar_comparison_canonical <- function(part_builder,directory=file.path("data","processed","aedar"),metadata) {
  if(!is.function(part_builder)||!is.list(metadata)||!all(c("source_snapshot_id","aedar_content_version",
      "reference_content_version","input_content_version","input_identity","membership","typequ_axis","typequ_axis_sha256")%in%names(metadata)))
    stop("AEDAR comparison canonical writer requires a bounded part builder and complete manifest metadata",call.=FALSE)
  if(!identical(paste(as.character(openssl::sha256(charToRaw(metadata$input_identity))),collapse=""),metadata$input_content_version)||
     !identical(metadata$source_snapshot_id,AEDAR_AGGREGATE_VINTAGE)||
     !identical(metadata$typequ_axis_sha256,AEDAR_TYPEQU_REGISTRY_SHA256)||
     !identical(metadata$typequ_axis,read_aedar_typequ_registry()$TYPEQU))
    stop("AEDAR comparison manifest provenance or TYPEQU pin is invalid",call.=FALSE)
  dir.create(directory,recursive=TRUE,showWarnings=FALSE)
  generations<-file.path(directory,"generations"); dir.create(generations,recursive=TRUE,showWarnings=FALSE)
  generation<-tempfile("generation-",tmpdir=generations)
  if(!dir.create(generation)) stop("Could not create private AEDAR comparison generation",call.=FALSE)
  installed<-FALSE
  on.exit(if(!installed&&dir.exists(generation)) unlink(generation,recursive=TRUE,force=TRUE),add=TRUE)
  parts<-vector("list",length(metadata$typequ_axis)); total_groups<-total_territories<-0
  for(i in seq_along(metadata$typequ_axis)) {
    code<-metadata$typequ_axis[[i]]
    projection<-part_builder(code)
    groups<-as.data.frame(projection$groups[,AEDAR_COMPARISON_GROUP_COLUMNS,drop=FALSE],stringsAsFactors=FALSE)
    territories<-as.data.frame(projection$territories[,AEDAR_COMPARISON_TERRITORY_COLUMNS,drop=FALSE],stringsAsFactors=FALSE)
    rownames(groups)<-NULL; rownames(territories)<-NULL
    validate_aedar_comparison_part(groups,territories,code,metadata$membership)
    part_hash<-aedar_comparison_part_content_hash(groups,territories)
    group_path<-file.path(generation,paste0(code,"-groups.parquet"))
    territory_path<-file.path(generation,paste0(code,"-territories.parquet"))
    nanoparquet::write_parquet(groups,group_path); nanoparquet::write_parquet(territories,territory_path)
    check_groups<-as.data.frame(nanoparquet::read_parquet(group_path),stringsAsFactors=FALSE)
    check_territories<-as.data.frame(nanoparquet::read_parquet(territory_path),stringsAsFactors=FALSE)
    rownames(check_groups)<-NULL; rownames(check_territories)<-NULL
    validate_aedar_comparison_part(check_groups,check_territories,code,metadata$membership)
    if(!identical(aedar_comparison_part_content_hash(check_groups,check_territories),part_hash))
      stop("AEDAR comparison partition changed during Parquet round-trip",call.=FALSE)
    parts[[i]]<-list(TYPEQU=code,groups=paste0("generations/",basename(generation),"/",basename(group_path)),
      territories=paste0("generations/",basename(generation),"/",basename(territory_path)),
      group_rows=nrow(groups),territory_rows=nrow(territories),content_sha256=part_hash)
    total_groups<-total_groups+nrow(groups); total_territories<-total_territories+nrow(territories)
  }
  manifest<-list(schema_version=1L,source_snapshot_id=metadata$source_snapshot_id,
    aedar_content_version=metadata$aedar_content_version,reference_content_version=metadata$reference_content_version,
    input_content_version=metadata$input_content_version,input_identity=metadata$input_identity,
    typequ_axis=metadata$typequ_axis,typequ_axis_sha256=metadata$typequ_axis_sha256,
    group_columns=AEDAR_COMPARISON_GROUP_COLUMNS,territory_columns=AEDAR_COMPARISON_TERRITORY_COLUMNS,
    membership=metadata$membership,group_row_count=total_groups,territory_row_count=total_territories,parts=parts)
  manifest$content_version<-aedar_comparison_manifest_version(manifest)
  validate_aedar_comparison_manifest(manifest,directory,verify_parts=FALSE)
  target<-file.path(directory,"aedar_comparison_manifest.json")
  staged<-tempfile("aedar-manifest-",tmpdir=directory,fileext=".json")
  writeLines(as.character(jsonlite::toJSON(manifest,auto_unbox=TRUE,dataframe="rows",null="null",digits=NA,pretty=FALSE)),staged,useBytes=TRUE)
  validate_aedar_comparison_manifest_file(staged,directory)
  on.exit(if(file.exists(staged)) unlink(staged),add=TRUE)
  install_aedar_comparison_manifest(staged,target)
  installed<-TRUE
  manifest$manifest_path<-normalizePath(target,winslash="/",mustWork=TRUE)
  manifest$directory<-normalizePath(directory,winslash="/",mustWork=TRUE)
  invisible(manifest)
}

validate_aedar_comparison_manifest <- function(manifest,directory,verify_parts=TRUE) {
  required<-c("schema_version","source_snapshot_id","aedar_content_version","reference_content_version",
    "input_content_version","input_identity","typequ_axis","typequ_axis_sha256","group_columns",
    "territory_columns","membership","group_row_count","territory_row_count","parts","content_version")
  if(!is.list(manifest)||!all(required%in%names(manifest))||manifest$schema_version!=1L||
     manifest$source_snapshot_id!=AEDAR_AGGREGATE_VINTAGE||
     !identical(manifest$typequ_axis,read_aedar_typequ_registry()$TYPEQU)||
     !identical(manifest$typequ_axis_sha256,AEDAR_TYPEQU_REGISTRY_SHA256)||
     !identical(manifest$group_columns,AEDAR_COMPARISON_GROUP_COLUMNS)||
     !identical(manifest$territory_columns,AEDAR_COMPARISON_TERRITORY_COLUMNS)||
     !is.character(manifest$aedar_content_version)||length(manifest$aedar_content_version)!=1L||!nzchar(manifest$aedar_content_version)||
     !is.character(manifest$reference_content_version)||length(manifest$reference_content_version)!=1L||!nzchar(manifest$reference_content_version)||
     !is.character(manifest$input_content_version)||length(manifest$input_content_version)!=1L||
     !is.character(manifest$input_identity)||length(manifest$input_identity)!=1L||
     !isTRUE(tryCatch({validate_aedar_comparison_input_identity(manifest$input_identity,manifest$input_content_version);TRUE},error=function(e) FALSE))||
     !identical(aedar_comparison_manifest_version(manifest),manifest$content_version)||
     length(manifest$parts)!=length(manifest$typequ_axis))
    stop("AEDAR comparison manifest schema, axis, or provenance is invalid",call.=FALSE)
  membership<-as.data.frame(manifest$membership,stringsAsFactors=FALSE)
  if(!all(c("comparison_context","group_id","territory_type","territory_id")%in%names(membership))||anyDuplicated(membership))
    stop("AEDAR comparison manifest membership is malformed",call.=FALSE)
  root<-normalizePath(directory,winslash="/",mustWork=TRUE)
  count_groups<-count_territories<-0
  for(i in seq_along(manifest$parts)) {
    p<-manifest$parts[[i]]; code<-manifest$typequ_axis[[i]]
    if(!identical(p$TYPEQU,code)||!identical(basename(p$groups),paste0(code,"-groups.parquet"))||
       !identical(basename(p$territories),paste0(code,"-territories.parquet"))||
       grepl("(^|[/\\\\])[.][.]([/\\\\]|$)|^[A-Za-z]:",p$groups)||grepl("(^|[/\\\\])[.][.]([/\\\\]|$)|^[A-Za-z]:",p$territories))
      stop("AEDAR comparison manifest contains an unsafe part path",call.=FALSE)
    gp<-normalizePath(file.path(directory,p$groups),winslash="/",mustWork=TRUE)
    tp<-normalizePath(file.path(directory,p$territories),winslash="/",mustWork=TRUE)
    if(!startsWith(gp,paste0(root,"/generations/"))||!startsWith(tp,paste0(root,"/generations/"))||
       !file.exists(gp)||!file.exists(tp)) stop("AEDAR comparison manifest references a missing/out-of-root partition",call.=FALSE)
    count_groups<-count_groups+p$group_rows; count_territories<-count_territories+p$territory_rows
    if(verify_parts) {
      groups<-as.data.frame(nanoparquet::read_parquet(gp),stringsAsFactors=FALSE)
      territories<-as.data.frame(nanoparquet::read_parquet(tp),stringsAsFactors=FALSE)
      rownames(groups)<-NULL; rownames(territories)<-NULL
      validate_aedar_comparison_part(groups,territories,code,membership)
      if(nrow(groups)!=p$group_rows||nrow(territories)!=p$territory_rows||
         !identical(aedar_comparison_part_content_hash(groups,territories),p$content_sha256))
        stop("AEDAR comparison partition is missing, tampered, or inconsistent",call.=FALSE)
    }
  }
  if(count_groups!=manifest$group_row_count||count_territories!=manifest$territory_row_count)
    stop("AEDAR comparison manifest row totals do not match its partitions",call.=FALSE)
  invisible(manifest)
}

read_aedar_comparison_canonical <- function(directory=file.path("data","processed","aedar"),verify_parts=TRUE) {
  path<-file.path(directory,"aedar_comparison_manifest.json")
  if(!file.exists(path)) stop("Canonical AEDAR comparison manifest is missing",call.=FALSE)
  manifest<-validate_aedar_comparison_manifest_file(path,directory,verify_parts=verify_parts)
  manifest$manifest_path<-normalizePath(path,winslash="/",mustWork=TRUE)
  manifest$directory<-normalizePath(directory,winslash="/",mustWork=TRUE)
  manifest
}

validate_aedar_comparison_manifest_file <- function(path,directory,verify_parts=TRUE) {
  manifest<-jsonlite::fromJSON(path,simplifyVector=FALSE)
  manifest$typequ_axis<-unlist(manifest$typequ_axis,use.names=FALSE)
  manifest$group_columns<-unlist(manifest$group_columns,use.names=FALSE)
  manifest$territory_columns<-unlist(manifest$territory_columns,use.names=FALSE)
  manifest$membership<-jsonlite::fromJSON(as.character(jsonlite::toJSON(manifest$membership,auto_unbox=TRUE)),simplifyDataFrame=TRUE)
  validate_aedar_comparison_manifest(manifest,directory,verify_parts=verify_parts)
  manifest
}

# Deliberately separate small-fixture round trips; production canonical files
# are manifest/partition based and never reassemble the full territory table.
write_aedar_comparison_fixture <- function(x,directory) {
  validate_aedar_comparison_projection(x); dir.create(directory,recursive=TRUE,showWarnings=FALSE)
  nanoparquet::write_parquet(x$groups,file.path(directory,"fixture-groups.parquet"))
  nanoparquet::write_parquet(x$territories,file.path(directory,"fixture-territories.parquet"))
  invisible(directory)
}

read_aedar_comparison_fixture <- function(directory) {
  x<-list(groups=as.data.frame(nanoparquet::read_parquet(file.path(directory,"fixture-groups.parquet"))),
    territories=as.data.frame(nanoparquet::read_parquet(file.path(directory,"fixture-territories.parquet"))))
  fields<-c("content_version","aedar_content_version","reference_content_version","input_content_version","input_identity")
  versions<-lapply(fields,function(f) unique(as.character(c(x$groups[[f]],x$territories[[f]]))))
  if(any(lengths(versions)!=1L)) stop("AEDAR fixture comparison versions are inconsistent",call.=FALSE)
  names(versions)<-fields
  x$content_version<-versions$content_version; x$aedar_content_version<-versions$aedar_content_version
  x$reference_content_version<-versions$reference_content_version; x$input_content_version<-versions$input_content_version
  x$input_identity<-versions$input_identity; validate_aedar_comparison_projection(x); x
}

validate_aedar_comparison_manifest_membership <- function(manifest,territory_reference) {
  actual<-aedar_comparison_membership_rows(territory_reference)
  expected<-as.data.frame(manifest$membership,stringsAsFactors=FALSE)
  keycols<-c("comparison_context","group_id","territory_type","territory_id")
  sort_rows<-function(x) {x<-x[do.call(order,x[keycols]),keycols,drop=FALSE];rownames(x)<-NULL;x}
  if(!isTRUE(all.equal(sort_rows(actual),sort_rows(expected),check.attributes=FALSE)))
    stop("AEDAR comparison manifest membership is stale relative to published territory reference",call.=FALSE)
  invisible(TRUE)
}

publish_aedar_comparisons <- function(x,con) {
  progress_started <- proc.time()[[3L]]
  progress <- function(stage,...) if (identical(Sys.getenv("LUSK_AEDAR_PUBLISH_PROGRESS"),"1"))
    {cat(sprintf("AEDAR_PUBLISH elapsed=%.3fs stage=%s %s\n",proc.time()[[3L]]-progress_started,
      stage,paste(...,collapse=" ")));flush.console()}
  progress("validate-canonical")
  if(!is.list(x)||is.null(x$parts)||is.null(x$manifest_path))
    stop("AEDAR comparison publication requires the bounded canonical manifest",call.=FALSE)
  validate_aedar_comparison_manifest(x,x$directory,verify_parts=FALSE)
  progress("begin-transaction")
  result <- DBI::dbWithTransaction(con, {
    DBI::dbExecute(con,"SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
    DBI::dbGetQuery(con,"SELECT pg_advisory_xact_lock(594, 756)")
    deps<-DBI::dbGetQuery(con,"SELECT a.content_version aedar_content_version,r.content_version reference_content_version FROM table_publication a CROSS JOIN table_publication r WHERE a.table_name='aedar_territorial_aggregate' AND r.table_name='territory_reference' FOR SHARE OF a,r")
    if(nrow(deps)!=1L||deps$aedar_content_version[[1]]!=x$aedar_content_version||deps$reference_content_version[[1]]!=x$reference_content_version)
      stop("AEDAR comparison dependencies are stale",call.=FALSE)
    reference<-DBI::dbGetQuery(con,"SELECT territory_type,territory_id,epci_id,density_class_code FROM territory_reference")
    validate_aedar_comparison_manifest_membership(x,reference)
    validate_aedar_comparison_manifest(x,x$directory,verify_parts=FALSE)
    current<-DBI::dbGetQuery(con,"SELECT content_version,input_content_version,group_row_count,territory_row_count FROM aedar_comparison_publication WHERE singleton")
      unchanged<-nrow(current)==1L&&identical(as.character(current$content_version[[1L]]),x$content_version)&&
        identical(as.character(current$input_content_version[[1L]]),x$input_content_version)&&
         current$group_row_count[[1L]]==x$group_row_count&&current$territory_row_count[[1L]]==x$territory_row_count
      if(unchanged) {
      validate_aedar_comparison_manifest(x,x$directory,verify_parts=TRUE)
       transaction_result <- list(changed=FALSE,content_version=x$content_version,group_row_count=x$group_row_count,territory_row_count=x$territory_row_count)
     } else {
      progress("begin-replacement",groups=x$group_row_count,territories=x$territory_row_count)
      DBI::dbExecute(con,"DELETE FROM aedar_comparison_territory")
      DBI::dbExecute(con,"DELETE FROM aedar_comparison_group")
      chunk_size<-20000L
      group_buffer<-list(); group_buffer_rows<-0L
      territory_buffer<-list(); territory_buffer_rows<-0L
      flush_groups<-function() {
        if(length(group_buffer)) {
          batch<-do.call(rbind,group_buffer)
          DBI::dbWriteTable(con,"aedar_comparison_group",batch,append=TRUE,row.names=FALSE)
          group_buffer<<-list(); group_buffer_rows<<-0L
        }
      }
      flush_territories<-function() {
        if(length(territory_buffer)) {
          batch<-do.call(rbind,territory_buffer)
          DBI::dbWriteTable(con,"aedar_comparison_territory",batch,append=TRUE,row.names=FALSE)
          territory_buffer<<-list(); territory_buffer_rows<<-0L
        }
      }
      for(part_index in seq_along(x$parts)) {
        part <- x$parts[[part_index]]
        groups<-as.data.frame(nanoparquet::read_parquet(file.path(x$directory,part$groups)),stringsAsFactors=FALSE)
        territories<-as.data.frame(nanoparquet::read_parquet(file.path(x$directory,part$territories)),stringsAsFactors=FALSE)
        validate_aedar_comparison_part(groups,territories,part$TYPEQU,x$membership)
        if(nrow(groups)!=part$group_rows||nrow(territories)!=part$territory_rows||
           !identical(aedar_comparison_part_content_hash(groups,territories),part$content_sha256))
          stop("AEDAR comparison partition changed before database publication",call.=FALSE)
        names(groups)[names(groups)=="TYPEQU"]<-"typequ"
        names(territories)[names(territories)=="TYPEQU"]<-"typequ"
        group_buffer[[length(group_buffer)+1L]]<-groups
        group_buffer_rows<-group_buffer_rows+nrow(groups)
        territory_buffer[[length(territory_buffer)+1L]]<-territories
        territory_buffer_rows<-territory_buffer_rows+nrow(territories)
        if(group_buffer_rows>=chunk_size) flush_groups()
        if(territory_buffer_rows>=chunk_size) {
          # The territory table has an immediate FK to its group parent. Flush
          # all queued group rows first even when their own batch is smaller.
          flush_groups()
          flush_territories()
        }
        if(part_index %% 25L == 0L) progress("replacement-partitions",done=part_index,total=length(x$parts))
      }
      flush_groups(); flush_territories()
      progress("before-publication-marker")
      DBI::dbExecute(con,"INSERT INTO aedar_comparison_publication(singleton,content_version,source_snapshot_id,aedar_content_version,reference_content_version,input_content_version,input_identity,group_row_count,territory_row_count,published_at) VALUES(true,$1,'2026-v1',$2,$3,$4,$5::jsonb,$6,$7,now()) ON CONFLICT(singleton) DO UPDATE SET content_version=EXCLUDED.content_version,source_snapshot_id=EXCLUDED.source_snapshot_id,aedar_content_version=EXCLUDED.aedar_content_version,reference_content_version=EXCLUDED.reference_content_version,input_content_version=EXCLUDED.input_content_version,input_identity=EXCLUDED.input_identity,group_row_count=EXCLUDED.group_row_count,territory_row_count=EXCLUDED.territory_row_count,published_at=EXCLUDED.published_at",
        params=list(x$content_version,x$aedar_content_version,x$reference_content_version,x$input_content_version,
           x$input_identity,x$group_row_count,x$territory_row_count))
       transaction_result <- list(changed=TRUE,content_version=x$content_version,group_row_count=x$group_row_count,territory_row_count=x$territory_row_count)
     }
     progress("before-transaction-commit")
     transaction_result
  })
  progress("transaction-committed")
  result
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
