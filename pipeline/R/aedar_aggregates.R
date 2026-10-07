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
AEDAR_AGGREGATE_MEASURES <- as.vector(unlist(lapply(c(5,10,15,20), function(m)
  unlist(lapply(c("walk","transit","transit_gain","bike_lts2","bike_lts4","car"), function(mode)
    paste0("count_",m,"_",mode,"_",c("share","min","max",paste0("decile",1:9),"mean")))))))
AEDAR_AGGREGATE_RESOURCES <- data.frame(
  level=AEDAR_AGGREGATE_LEVELS,
  url=c("https://static.data.gouv.fr/resources/acces-aux-equipements-depuis-les-adresses-residentielles-bretagne/20260930-152133/aggregates-commune-53-2026v1.parquet",
    "https://static.data.gouv.fr/resources/acces-aux-equipements-depuis-les-adresses-residentielles-bretagne/20260930-152216/aggregates-epci-53-2026v1.parquet",
    "https://static.data.gouv.fr/resources/acces-aux-equipements-depuis-les-adresses-residentielles-bretagne/20260930-152158/aggregates-departement-53-2026v1.parquet",
    "https://static.data.gouv.fr/resources/acces-aux-equipements-depuis-les-adresses-residentielles-bretagne/20260930-152247/aggregates-region-53-2026v1.parquet"),
  filename=paste0("aggregates-",AEDAR_AGGREGATE_LEVELS,"-53-2026v1.parquet"),
  sha1=c("d1ab2520d0a259a97033f18133d4b953cce936f3","b5ef57a9de77cd471447597552d09ad9531a9d74",
    "d8a525355eee9719f0253e4cdb22cc523114f45a","c0e080c110de68a0dcddaad0e20a4a001c46965f"),
  published_on="2026-09-30", stringsAsFactors=FALSE)

verify_aedar_resource_hash <- function(path, level) {
  expected <- AEDAR_AGGREGATE_RESOURCES$sha1[match(level,AEDAR_AGGREGATE_RESOURCES$level)]
  bytes <- readBin(path,"raw",n=file.info(path)$size)
  actual <- paste(as.character(openssl::sha1(bytes)),collapse="")
  if (!identical(tolower(actual),expected)) stop(paste("Pinned AEDAR checksum mismatch:",level),call.=FALSE)
  invisible(TRUE)
}

download_aedar_aggregates <- function(raw_dir=file.path("data","raw")) {
  dir.create(raw_dir,recursive=TRUE,showWarnings=FALSE)
  paths <- file.path(raw_dir,AEDAR_AGGREGATE_RESOURCES$filename)
  for (i in seq_along(paths)) if (!file.exists(paths[[i]])) {
    tmp <- paste0(paths[[i]],".part")
    utils::download.file(AEDAR_AGGREGATE_RESOURCES$url[[i]],tmp,mode="wb",quiet=TRUE)
    if (file.info(tmp)$size < 1000) { unlink(tmp); stop("Downloaded AEDAR Parquet is implausibly small",call.=FALSE) }
    if (!file.rename(tmp,paths[[i]])) stop("Could not atomically install AEDAR source file",call.=FALSE)
  }
  for (i in seq_along(paths)) verify_aedar_resource_hash(paths[[i]],AEDAR_AGGREGATE_RESOURCES$level[[i]])
  stats::setNames(paths,AEDAR_AGGREGATE_LEVELS)
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
  axis <- unique(out$region[c("TYPEQU","LIB_TYPEQU")])
  if (anyDuplicated(axis$TYPEQU)) stop("AEDAR source TYPEQU registry has duplicate codes",call.=FALSE)
  axis <- axis[order(axis$TYPEQU),,drop=FALSE]
  for (level in AEDAR_AGGREGATE_LEVELS) {
    x <- out[[level]]
    axis_key <- paste(axis$TYPEQU,axis$LIB_TYPEQU,sep="\r")
    labels_key <- with(unique(x[c("TYPEQU","LIB_TYPEQU")]),paste(TYPEQU,LIB_TYPEQU,sep="\r"))
    if (!setequal(unique(x$TYPEQU),axis$TYPEQU) || nrow(unique(x[c("TYPEQU","LIB_TYPEQU")]))!=nrow(axis) ||
        !setequal(axis_key,labels_key))
      stop(paste("AEDAR dense TYPEQU axis/labels differ from source registry at",level),call.=FALSE)
    groups <- split(x$TYPEQU,x[[unname(AEDAR_AGGREGATE_ID_COLUMNS[[level]])]])
    if (any(vapply(groups,function(g) !setequal(g,axis$TYPEQU),logical(1))))
      stop(paste("AEDAR territory × TYPEQU coverage is not dense at",level),call.=FALSE)
  }
  out
}

project_aedar_aggregates <- function(inputs) {
  facts <- dplyr::bind_rows(validate_aedar_aggregates(inputs)); rownames(facts)<-NULL
  list(facts=facts,measures=AEDAR_AGGREGATE_MEASURES,source=list(
    source_id=AEDAR_AGGREGATE_SOURCE_ID,name="Accès aux équipements depuis les adresses résidentielles — Bretagne",
    vintage=AEDAR_AGGREGATE_VINTAGE,url="https://www.data.gouv.fr/datasets/acces-aux-equipements-depuis-les-adresses-residentielles-bretagne",
    licence="ODbL",attribution="© OpenStreetMap contributors; données AEDAR — licence ODbL",
    reference_date=NA_character_,publication_date=AEDAR_AGGREGATE_RESOURCES$published_on[[1L]]))
}

write_aedar_canonical <- function(projection, directory=file.path("data","processed","aedar")) {
  dir.create(directory,recursive=TRUE,showWarnings=FALSE)
  ecrire_parquet_si_modifie(projection$facts,file.path(directory,"aedar_territorial_aggregate.parquet"))
  source <- as.data.frame(projection$source,stringsAsFactors=FALSE)
  ecrire_parquet_si_modifie(source,file.path(directory,"aedar_territorial_aggregate_source.parquet"))
  invisible(directory)
}

read_aedar_canonical <- function(directory=file.path("data","processed","aedar")) {
  facts_path <- file.path(directory,"aedar_territorial_aggregate.parquet")
  source_path <- file.path(directory,"aedar_territorial_aggregate_source.parquet")
  if (!file.exists(facts_path) || !file.exists(source_path)) stop("Canonical AEDAR Parquet facts/provenance are missing",call.=FALSE)
  facts <- nanoparquet::read_parquet(facts_path); src <- nanoparquet::read_parquet(source_path)
  if (nrow(src)!=1L || src$source_id[[1L]]!=AEDAR_AGGREGATE_SOURCE_ID || src$vintage[[1L]]!=AEDAR_AGGREGATE_VINTAGE)
    stop("Canonical AEDAR source identity is not the registered 2026-v1 vintage",call.=FALSE)
  inputs <- lapply(AEDAR_AGGREGATE_LEVELS,function(level) {
    x <- facts[facts$territory_type==level,,drop=FALSE]
    x[,c(AEDAR_AGGREGATE_LEVEL_COLUMNS[[level]],AEDAR_AGGREGATE_MEASURES),drop=FALSE]
  }); names(inputs)<-AEDAR_AGGREGATE_LEVELS
  projection <- project_aedar_aggregates(inputs)
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

read_aedar_aggregate_projection <- function(raw_dir=file.path("data","raw"))
  project_aedar_aggregates(read_aedar_aggregate_inputs(download_aedar_aggregates(raw_dir)))

publish_aedar_aggregates <- function(projection, db) {
  facts <- projection$facts
  version <- paste(as.character(openssl::sha256(serialize(projection,NULL))),collapse="")
  rows <- lapply(seq_len(nrow(facts)),function(i) {
    x <- facts[i,,drop=FALSE]
    identity <- as.list(x[setdiff(AEDAR_AGGREGATE_LEVEL_COLUMNS[[as.character(x$territory_type)]],
      c("TYPEQU","LIB_TYPEQU","n_addresses","n_observed","coverage_status"))])
    measures <- as.list(x[AEDAR_AGGREGATE_MEASURES])
    data.frame(territory_type=x$territory_type,territory_id=x$territory_id,typequ=x$TYPEQU,
      typequ_label=x$LIB_TYPEQU,identity=as.character(jsonlite::toJSON(identity,auto_unbox=TRUE,na="null")),
      n_addresses=as.numeric(x$n_addresses),n_observed=as.numeric(x$n_observed),coverage_status=x$coverage_status,
      measures=as.character(jsonlite::toJSON(measures,auto_unbox=TRUE,na="null")),
      source_id=projection$source$source_id,vintage_id=projection$source$vintage,
      source_url=projection$source$url,licence=projection$source$licence,
      attribution=projection$source$attribution,
      reference_date=as.Date(projection$source$reference_date),publication_date=as.Date(projection$source$publication_date),
      stringsAsFactors=FALSE)
  })
  rows <- do.call(rbind,rows)
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
      DBI::dbWriteTable(db,"aedar_territorial_aggregate",rows,append=TRUE,row.names=FALSE,field.types=c(identity="jsonb",measures="jsonb"))
      DBI::dbExecute(db,"INSERT INTO source_dataset(source_id,name) VALUES($1,$2) ON CONFLICT(source_id) DO UPDATE SET name=EXCLUDED.name",params=list(projection$source$source_id,projection$source$name))
      DBI::dbExecute(db,"INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date) VALUES($1,$2,$3,$4,$5) ON CONFLICT(source_id,vintage_id) DO NOTHING",params=list(projection$source$source_id,projection$source$vintage,projection$source$vintage,as.Date(projection$source$reference_date),as.Date(projection$source$publication_date)))
      stored_source <- DBI::dbGetQuery(db,"SELECT version,reference_date,publication_date FROM source_vintage WHERE source_id=$1 AND vintage_id=$2",params=list(projection$source$source_id,projection$source$vintage))
      if (nrow(stored_source)!=1L || stored_source$version[[1L]]!=projection$source$vintage ||
          !identical(as.character(stored_source$reference_date[[1L]]),projection$source$reference_date) ||
          !identical(as.character(stored_source$publication_date[[1L]]),projection$source$publication_date))
        stop("AEDAR source vintage conflicts with stored provenance",call.=FALSE)
      DBI::dbExecute(db,"INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version,published_at) VALUES('aedar_territorial_aggregate',$1,$2,$3,now()) ON CONFLICT(table_name) DO UPDATE SET content_version=EXCLUDED.content_version,row_count=EXCLUDED.row_count,reference_content_version=EXCLUDED.reference_content_version,published_at=EXCLUDED.published_at",params=list(version,nrow(rows),ref_version))
    }
    list(changed=!unchanged,content_version=version,row_count=nrow(facts))
  })
}
