# Validate the metadata-owned annual-series projection without filling gaps.
`%||%` <- function(x, y) if (is.null(x)) y else x
validate_series_projection <- function(points, descriptor) {
  required <- c("indicator_id", "territory_id", "territory_type", "axis_value",
                "observation_period", "value", "status", "source_id", "vintage_id")
  if (!is.data.frame(points) || !setequal(names(points), required) ||
      !is.list(descriptor) || !all(c("indicator_id", "axis_kind", "axis_values", "completeness",
        "comparison_point", "label", "unit", "direction", "allowed_levels", "source_id", "vintage_id") %in% names(descriptor)))
    stop("Series projection is missing contract fields", call.=FALSE)
  if (!nrow(points)) stop("Series projection cannot publish an empty dataset", call.=FALSE)
  axis <- as.character(descriptor$axis_values)
  if (descriptor$axis_kind != "year" || !length(axis) || anyDuplicated(axis) ||
      any(!grepl("^\\d{4}$", axis)) || !identical(axis, axis[order(as.integer(axis))]) ||
      !descriptor$completeness %in% c("dense_complete", "may_be_missing") ||
      (!is.null(descriptor$comparison_point) && (!descriptor$comparison_point %in% axis ||
        !descriptor$direction %in% c("high", "low"))))
    stop("Invalid series descriptor axis/order/comparison", call.=FALSE)
  if (anyNA(points[c("indicator_id", "territory_id", "territory_type", "axis_value", "status", "source_id", "vintage_id")]) ||
      any(points$indicator_id != descriptor$indicator_id) || any(!points$axis_value %in% axis) ||
      anyDuplicated(points[c("indicator_id", "territory_id", "axis_value")]))
    stop("Undeclared or duplicate series point", call.=FALSE)
  if (any(points$source_id != descriptor$source_id) || any(points$vintage_id != descriptor$vintage_id))
    stop("Series provenance differs from descriptor", call.=FALSE)
  if (!length(descriptor$allowed_levels) || any(!descriptor$allowed_levels %in% c("commune","epci","departement","region")) ||
      any(!points$territory_type %in% descriptor$allowed_levels))
    stop("Series territory level is not declared", call.=FALSE)
  if (any(!points$status %in% c("measured", "missing")) ||
      any((points$status == "measured") != !is.na(points$value)) ||
      any(!is.na(points$value) & !is.finite(points$value)))
    stop("Series missing status/value mismatch", call.=FALSE)
  if (descriptor$completeness == "dense_complete") {
    observed <- split(as.character(points$axis_value), as.character(points$territory_id))
    if (any(vapply(observed, function(values) !setequal(values, axis), logical(1))))
      stop("Dense-complete series is missing declared axis points", call.=FALSE)
  }
  invisible(points[order(match(points$axis_value, axis)), , drop=FALSE])
}

project_conso_enaf_series <- function(payload, metadata) {
  page <- metadata$indicator_pages$conso_enaf_annuel
  if (is.null(page) || !is.list(page))
    stop("Annual series metadata descriptor is missing", call.=FALSE)
  comparison <- page$comparison
  if (is.null(comparison) || is.null(comparison$details) || is.null(comparison$detail))
    stop("Annual series metadata must declare its points and comparison point", call.=FALSE)
  axis <- as.character(comparison$details)
  allowed_levels <- unlist(page$levels, use.names=FALSE)
  source_id <- unlist(page$sources, use.names=FALSE)
  if (!length(axis) || anyNA(axis) || any(!grepl("^\\d{4}$", axis)) || anyDuplicated(axis) ||
      !identical(axis, axis[order(as.integer(axis))]) || length(allowed_levels) == 0L ||
      anyNA(allowed_levels) || any(!allowed_levels %in% c("commune","epci","departement","region")) ||
      length(source_id) != 1L || is.na(source_id) || !nzchar(source_id) ||
      length(comparison$detail) != 1L || is.na(comparison$detail) ||
      !as.character(comparison$detail) %in% axis ||
      !is.character(page$label) || length(page$label) != 1L || is.na(page$label) || !nzchar(page$label) ||
      !is.character(page$unit) || length(page$unit) != 1L || is.na(page$unit) || !nzchar(page$unit) ||
      length(page$direction) != 1L || is.na(page$direction) || !page$direction %in% c("high", "low"))
    stop("Annual series metadata descriptor is invalid or incomplete", call.=FALSE)
  required <- c("key", "theme", "detail", "type", "territoire", "value", "vintage_source", "vintage_version",
                "vintage_date_reference", "vintage_date_publication")
  if (!is.data.frame(payload$indicateurs) || !all(required %in% names(payload$indicateurs)))
    stop("Canonical annual indicator Parquet is missing required fields", call.=FALSE)
  all_annual <- payload$indicateurs[!is.na(payload$indicateurs$key) &
    payload$indicateurs$key == "conso_enaf_annuel", , drop=FALSE]
  if (!nrow(all_annual)) stop("Canonical annual series is empty", call.=FALSE)
  if (anyNA(all_annual$theme) || any(as.character(all_annual$theme) != "milieux"))
    stop("Canonical annual series is mislabeled with a different theme", call.=FALSE)
  if (anyNA(all_annual$detail) || any(!as.character(all_annual$detail) %in% axis))
    stop("Canonical annual series contains an undeclared axis point", call.=FALSE)
  # Canonical territory-fiche data also contains the Région observation. It is
  # explicitly accounted for and excluded from this indicator-page series;
  # all other non-eligible levels fail rather than disappearing in a filter.
  recognized_levels <- c(allowed_levels, "region")
  if (anyNA(all_annual$type) || any(!as.character(all_annual$type) %in% recognized_levels))
    stop("Canonical annual series contains an unexpected territory level", call.=FALSE)
  if (anyNA(all_annual$territoire) || anyDuplicated(all_annual[c("key", "territoire", "type", "detail")]))
    stop("Canonical annual series contains missing or duplicate territory/axis keys", call.=FALSE)
  raw <- all_annual[as.character(all_annual$type) %in% allowed_levels, , drop=FALSE]
  if (!nrow(raw)) stop("Canonical annual series is empty", call.=FALSE)
  if (anyNA(all_annual[c("vintage_source", "vintage_version", "vintage_date_reference", "vintage_date_publication")]) ||
      length(unique(as.character(all_annual$vintage_source))) != 1L)
    stop("Canonical annual series provenance/identity is incomplete", call.=FALSE)
  if (length(unique(paste(all_annual$vintage_version, all_annual$vintage_date_reference,
                          all_annual$vintage_date_publication, sep="/"))) != 1L)
    stop("Annual series source vintage is inconsistent", call.=FALSE)
  points <- data.frame(indicator_id="conso_enaf_annuel", territory_id=raw$territoire,
    territory_type=raw$type, axis_value=as.character(raw$detail),
    observation_period=as.character(raw$detail), value=raw$value,
    status=ifelse(is.na(raw$value), "missing", "measured"), source_id=source_id,
    vintage_id=paste(as.character(raw$vintage_version), raw$vintage_date_reference, sep="/"),
    stringsAsFactors=FALSE)
  vintage_id <- unique(points$vintage_id)
  if (length(vintage_id) != 1L) stop("Annual series source vintage is inconsistent", call.=FALSE)
  source_record <- metadata$source_records[[source_id]]
  if (is.null(source_record) || is.null(source_record$dataset) || is.na(source_record$dataset) ||
      !nzchar(source_record$dataset)) stop("Annual series source metadata is incomplete", call.=FALSE)
  if (!is.list(source_record$vintages) || !length(source_record$vintages))
    stop("Annual series source vintage metadata is missing", call.=FALSE)
  declared_vintage <- source_record$vintages[[1L]]
  if (is.null(declared_vintage) || length(declared_vintage$version) != 1L || is.na(declared_vintage$version) ||
      length(declared_vintage$dateReference) != 1L || is.na(declared_vintage$dateReference) ||
      length(declared_vintage$datePublication) != 1L || is.na(declared_vintage$datePublication) ||
      !identical(as.character(declared_vintage$version), as.character(raw$vintage_version[[1L]])) ||
      !identical(as.character(declared_vintage$dateReference), as.character(raw$vintage_date_reference[[1L]])) ||
      !identical(as.character(declared_vintage$datePublication), as.character(raw$vintage_date_publication[[1L]])))
    stop("Canonical annual series vintage disagrees with source metadata", call.=FALSE)
  vintage <- unique(data.frame(source_id=source_id, vintage_id=vintage_id,
    version=as.character(raw$vintage_version[[1L]]),
    reference_date=as.Date(raw$vintage_date_reference[[1L]]),
    publication_date=as.Date(raw$vintage_date_publication[[1L]])))
  descriptor <- list(indicator_id="conso_enaf_annuel", axis_kind="year", axis_values=axis,
    completeness="may_be_missing", comparison_point=as.character(comparison$detail),
    label=page$label, unit=page$unit, direction=page$direction, allowed_levels=allowed_levels, source_id=source_id,
    vintage_id=vintage_id, descriptor_version=as.character(page$descriptor_version %||% "1"))
  validate_series_projection(points, descriptor)
  list(points=points, descriptor=descriptor, dataset_name=source_record$dataset, vintage=vintage,
    excluded=list(region=list(policy="territory_fiche_only", row_count=sum(all_annual$type == "region"),
      keys=all_annual[all_annual$type == "region", c("territoire", "detail"), drop=FALSE])))
}

# Production entry point: the canonical build has already written these Parquets
# and the descriptor snapshot. This deliberately does not invoke fixture builders
# or recompute indicator values.
read_conso_enaf_series_projection <- function(sortie = "../public/data",
                                              metadata_path = "inst/extdata/theme-metadata/theme_milieux.json") {
  parquet <- file.path(sortie, "indicateurs_milieux.parquet")
  vintages_path <- file.path(sortie, "vintages.parquet")
  if (!file.exists(parquet) || !file.exists(vintages_path))
    stop("Canonical Milieux indicator/vintage Parquet is missing", call.=FALSE)
  indicators <- nanoparquet::read_parquet(parquet)
  vintages <- nanoparquet::read_parquet(vintages_path)
  metadata <- jsonlite::read_json(metadata_path, simplifyVector=FALSE)
  projection <- project_conso_enaf_series(list(indicateurs=indicators), metadata)
  source <- projection$descriptor$source_id
  record <- vintages[as.character(vintages$id) == source, , drop=FALSE]
  if (nrow(record) != 1L) stop("Canonical vintage Parquet must declare exactly one source vintage", call.=FALSE)
  expected <- projection$vintage
  if (!identical(as.character(record$version[[1L]]), as.character(expected$version[[1L]])) ||
      !identical(as.character(record$date_reference[[1L]]), as.character(expected$reference_date[[1L]])) ||
      !identical(as.character(record$date_publication[[1L]]), as.character(expected$publication_date[[1L]])))
    stop("Series provenance differs from canonical vintage Parquet", call.=FALSE)
  projection
}

require_series_publish_opt_in <- function(value=Sys.getenv("LUSK_PUBLISH_SERIES", unset="")) {
  if (!identical(value, "1"))
    stop("Real series publication requires explicit LUSK_PUBLISH_SERIES=1", call.=FALSE)
  invisible(TRUE)
}

register_conso_enaf_series_publisher <- function(registry, metadata) {
  register_series_publisher(registry, "conso_enaf_annuel",
    project=function(canonical) project_conso_enaf_series(canonical, metadata),
    publish=function(projection, db, version) db$replace(projection, version))
}

series_postgres_adapter <- function(con) {
  if (!requireNamespace("DBI", quietly=TRUE)) stop("DBI is required")
  quote <- function(x) if (length(x) == 1L && is.na(x)) "NULL" else
    as.character(DBI::dbQuoteString(con, as.character(x)))
  list(
    transaction=function(expr) DBI::dbWithTransaction(con, expr),
    lock=function() DBI::dbGetQuery(con, "SELECT pg_advisory_xact_lock(597, 1)"),
    marker=function(name) DBI::dbGetQuery(con,
      "SELECT content_version,reference_content_version FROM table_publication WHERE table_name=$1", params=list(name)),
    replace=function(projection, version) {
      d <- projection$descriptor
      levels_sql <- paste0("ARRAY[", paste(vapply(d$allowed_levels, quote, character(1)), collapse=","), "]::text[]")
      DBI::dbExecute(con, "INSERT INTO source_dataset(source_id,name) VALUES($1,$2) ON CONFLICT(source_id) DO UPDATE SET name=EXCLUDED.name",
        params=list(d$source_id, projection$dataset_name))
      vintage <- projection$vintage
      DBI::dbExecute(con, "INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date) VALUES($1,$2,$3,$4,$5) ON CONFLICT(source_id,vintage_id) DO UPDATE SET version=EXCLUDED.version,reference_date=EXCLUDED.reference_date,publication_date=EXCLUDED.publication_date",
        params=as.list(vintage[c("source_id","vintage_id","version","reference_date","publication_date")]))
      DBI::dbExecute(con, "DELETE FROM ordered_series")
      DBI::dbExecute(con, "DELETE FROM series_descriptor")
      fields <- c("indicator_id","axis_kind","completeness","comparison_point","label","unit","direction","source_id","vintage_id","descriptor_version")
      values <- vapply(fields, function(field) quote(d[[field]]), character(1))
      DBI::dbExecute(con, paste0("INSERT INTO series_descriptor(",paste(fields,collapse=","),",axis_values,allowed_levels) VALUES(",
        paste(c(values,paste0("ARRAY[",paste(vapply(d$axis_values,quote,character(1)),collapse=","),"]::text[]"),levels_sql),collapse=","),")"))
      DBI::dbWriteTable(con,"ordered_series",projection$points,append=TRUE,row.names=FALSE)
      published_rows <- DBI::dbGetQuery(con,"SELECT count(*) AS n FROM ordered_series")$n[[1L]]
      if (!identical(as.integer(published_rows), as.integer(nrow(projection$points))))
        stop("Ordered-series row count differs from the validated projection", call.=FALSE)
      reference <- DBI::dbGetQuery(con,"SELECT content_version FROM table_publication WHERE table_name='territory_reference'")
      if (!nrow(reference)) stop("Territory reference publication is unavailable",call.=FALSE)
      DBI::dbExecute(con,"INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version,published_at) VALUES('ordered_series',$1,$2,$3,now()) ON CONFLICT(table_name) DO UPDATE SET content_version=EXCLUDED.content_version,row_count=EXCLUDED.row_count,reference_content_version=EXCLUDED.reference_content_version,published_at=EXCLUDED.published_at",
        params=list(version,nrow(projection$points),reference$content_version[[1L]]))
    })
}

register_series_publisher <- function(registry, name, project, publish) {
  if (!is.list(registry) || !is.function(project) || !is.function(publish) ||
      !nzchar(name) || name %in% names(registry)) stop("Invalid or duplicate series publisher", call.=FALSE)
  registry[[name]] <- list(project=project, publish=publish)
  registry
}

publish_registered_series <- function(registry, name, canonical, db) {
  publisher <- registry[[name]]
  if (is.null(publisher)) stop("Unregistered series publisher", call.=FALSE)
  projection <- publisher$project(canonical)
  publish_series_projection(projection, db, publisher$publish)
}

publish_series_projection <- function(projection, db, publish) {
  validate_series_projection(projection$points, projection$descriptor)
  if (!is.function(publish) || !is.function(db$transaction) || !is.function(db$marker))
    stop("Invalid series database adapter", call.=FALSE)
  version <- scalar_content_version(projection)
  db$transaction({
    if (is.function(db$lock)) db$lock()
    marker <- db$marker("ordered_series")
    reference <- db$marker("territory_reference")
    if (!nrow(reference)) stop("Territory reference publication is unavailable", call.=FALSE)
    changed <- !nrow(marker) || !identical(as.character(marker$content_version[[1L]]), version)
    rebound <- nrow(marker) && !identical(as.character(marker$reference_content_version[[1L]]),
      as.character(reference$content_version[[1L]]))
    if (changed || rebound) publish(projection, db, version)
    invisible(list(changed=changed, rebound=rebound, content_version=version))
  })
}

series_comparison <- function(values, focal_id, direction) {
  if (!is.data.frame(values) || !all(c("territory_id", "value") %in% names(values)) ||
      anyDuplicated(values$territory_id) || !direction %in% c("high", "low"))
    stop("Invalid bounded series comparison input", call.=FALSE)
  focal <- values$value[match(focal_id, values$territory_id)]
  eligible <- values$value[!is.na(values$value)]
  if (!length(focal) || is.na(focal)) return(list(value=focal, median=if(length(eligible)) stats::median(eligible) else NULL,
    rank=NULL, comparable_count=length(eligible)))
  ahead <- if (direction == "high") sum(eligible > focal) else sum(eligible < focal)
  list(value=focal, median=if(length(eligible)) stats::median(eligible) else NULL,
       rank=1L + ahead, tied=sum(eligible == focal), comparable_count=length(eligible))
}
