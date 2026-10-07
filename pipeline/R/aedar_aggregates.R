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
  filename=paste0("aggregates-",AEDAR_AGGREGATE_LEVELS,"-53-2026v1.parquet"), stringsAsFactors=FALSE)

download_aedar_aggregates <- function(raw_dir=file.path("data","raw")) {
  dir.create(raw_dir,recursive=TRUE,showWarnings=FALSE)
  paths <- file.path(raw_dir,AEDAR_AGGREGATE_RESOURCES$filename)
  for (i in seq_along(paths)) if (!file.exists(paths[[i]])) {
    tmp <- paste0(paths[[i]],".part")
    utils::download.file(AEDAR_AGGREGATE_RESOURCES$url[[i]],tmp,mode="wb",quiet=TRUE)
    if (file.info(tmp)$size < 1000) { unlink(tmp); stop("Downloaded AEDAR Parquet is implausibly small",call.=FALSE) }
    if (!file.rename(tmp,paths[[i]])) stop("Could not atomically install AEDAR source file",call.=FALSE)
  }
  stats::setNames(paths,AEDAR_AGGREGATE_LEVELS)
}

read_aedar_aggregate_inputs <- function(paths) {
  paths <- unlist(paths,use.names=TRUE)
  if (is.null(names(paths)) || !setequal(names(paths),AEDAR_AGGREGATE_LEVELS) || any(!file.exists(paths)))
    stop("All four pinned AEDAR aggregate Parquets are required",call.=FALSE)
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
    if (!setequal(unique(x$TYPEQU),axis$TYPEQU) || nrow(unique(x[c("TYPEQU","LIB_TYPEQU")]))!=nrow(axis))
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
    licence="ODbL",attribution="AEDAR — données publiées sous ODbL"))
}

read_aedar_aggregate_projection <- function(raw_dir=file.path("data","raw"))
  project_aedar_aggregates(read_aedar_aggregate_inputs(download_aedar_aggregates(raw_dir)))

publish_aedar_aggregates <- function(projection, db) {
  facts <- projection$facts
  reference <- DBI::dbGetQuery(db,"SELECT content_version FROM table_publication WHERE table_name='territory_reference'")
  if (nrow(reference)!=1L) stop("AEDAR publication requires published territory reference",call.=FALSE)
  version <- paste(as.character(openssl::sha256(serialize(projection,NULL))),collapse="")
  existing <- DBI::dbGetQuery(db,"SELECT content_version,reference_content_version FROM table_publication WHERE table_name='aedar_territorial_aggregate'")
  ref_version <- reference$content_version[[1L]]
  if (nrow(existing) && identical(existing$content_version[[1L]],version) && identical(existing$reference_content_version[[1L]],ref_version))
    return(list(changed=FALSE,content_version=version,row_count=nrow(facts)))
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
      attribution=projection$source$attribution,stringsAsFactors=FALSE)
  })
  rows <- do.call(rbind,rows)
  DBI::dbWithTransaction(db, {
    DBI::dbExecute(db,"DELETE FROM aedar_territorial_aggregate")
    DBI::dbWriteTable(db,"aedar_territorial_aggregate",rows,append=TRUE,row.names=FALSE,field.types=c(identity="jsonb",measures="jsonb"))
    DBI::dbExecute(db,"INSERT INTO source_dataset(source_id,name) VALUES($1,$2) ON CONFLICT(source_id) DO UPDATE SET name=EXCLUDED.name",params=list(projection$source$source_id,projection$source$name))
    DBI::dbExecute(db,"INSERT INTO source_vintage(source_id,vintage_id,version) VALUES($1,$2,$3) ON CONFLICT(source_id,vintage_id) DO UPDATE SET version=EXCLUDED.version",params=list(projection$source$source_id,projection$source$vintage,projection$source$vintage))
    DBI::dbExecute(db,"INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version,published_at) VALUES('aedar_territorial_aggregate',$1,$2,$3,now()) ON CONFLICT(table_name) DO UPDATE SET content_version=EXCLUDED.content_version,row_count=EXCLUDED.row_count,reference_content_version=EXCLUDED.reference_content_version,published_at=EXCLUDED.published_at",params=list(version,nrow(rows),ref_version))
  })
  list(changed=TRUE,content_version=version,row_count=nrow(rows))
}
