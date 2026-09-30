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

owned_conso_enaf_projection <- function(canonical, metadata) {
  projection <- if (is.list(canonical) && is.data.frame(canonical$indicateurs) && is.data.frame(canonical$vintages))
    project_conso_enaf_series_from_artifacts(canonical$indicateurs, canonical$vintages, metadata) else
    project_conso_enaf_series(canonical, metadata)
  d <- projection$descriptor
  points <- projection$points
  dataset_id <- metadata$indicator_pages$conso_enaf_annuel$series_dataset_id
  if (is.null(dataset_id) || length(dataset_id)!=1L || !nzchar(dataset_id))
    stop("ENAF owned-series identity is missing from metadata",call.=FALSE)
  d$dataset_id <- dataset_id
  points$dataset_id <- dataset_id
  source <- d$source_id; vintage_id <- unique(points$vintage_id)
  source_name <- projection$canonical_vintage_source %||% unique(points$source_id)[[1L]]
  v <- projection$vintage
  revision_hash <- series_revision_hash(source,vintage_id,source_name,projection$dataset_name,
    v$version[[1L]],as.character(v$reference_date[[1L]]),as.character(v$publication_date[[1L]]))
  revision_id <- paste0(source, "-", vintage_id, "-", substr(revision_hash, 1L, 16L))
  provenance <- data.frame(provenance_revision_id=revision_id, source_id=source,
    vintage_id=vintage_id, source_name=source_name, dataset_name=projection$dataset_name,
    source_version=as.character(v$version[[1L]]), reference_date=as.Date(v$reference_date[[1L]]),
    publication_date=as.Date(v$publication_date[[1L]]), revision_hash=revision_hash,
    stringsAsFactors=FALSE)
  list(dataset_id=dataset_id, points=points, descriptor=d, provenance=provenance,
    point_provenance=unique(data.frame(dataset_id=dataset_id,indicator_id=points$indicator_id,
      territory_id=points$territory_id,axis_value=points$axis_value,
      provenance_revision_id=revision_id,stringsAsFactors=FALSE)))
}

project_artif_m2m3_projection <- function(indicators, histories, vintages, metadata) {
  indicator_id <- "artif_par_habitant"
  page <- metadata$indicator_pages[[indicator_id]]
  dataset_id <- page$series_dataset_id
  if (is.null(dataset_id) || length(dataset_id)!=1L || !nzchar(dataset_id))
    stop("OCS-GE owned-series identity is missing from metadata",call.=FALSE)
  levels <- unlist(page$levels, use.names=FALSE)
  raw <- indicators[!is.na(indicators$key) & indicators$key==indicator_id,,drop=FALSE]
  if (!nrow(raw) || !all(c("state_role","source_components") %in% names(raw)) ||
      anyNA(raw[c("territoire","type","detail","state_role","source_components","source_reference",
      "vintage_source","vintage_version","vintage_date_reference","vintage_date_publication")]))
    stop("Canonical state observations, typed roles or source components are incomplete",call.=FALSE)
  if (any(!raw$type %in% c(levels,"region"))) stop("Canonical state has an unexpected territory level",call.=FALSE)
  excluded_region <- raw[raw$type=="region",,drop=FALSE]
  raw <- raw[raw$type %in% levels,,drop=FALSE]
  history <- histories[!is.na(histories$theme) & histories$theme=="milieux" &
    histories$territoire %in% raw$territoire & histories$type %in% levels,,drop=FALSE]
  if (anyDuplicated(history[c("territoire","type")])) stop("Canonical state history has duplicate territory keys",call.=FALSE)
  hidx <- match(paste(raw$territoire,raw$type),paste(history$territoire,history$type))
  if (anyNA(hidx)) stop("Canonical state lacks its authoritative OCS-GE window",call.=FALSE)
  roles <- as.character(raw$state_role)
  details <- as.character(raw$detail)
  points <- data.frame(dataset_id=dataset_id,indicator_id=indicator_id,
    territory_id=as.character(raw$territoire),territory_type=as.character(raw$type),axis_value=details,
    state_role=roles,observation_period=as.character(history$periode_artif[hidx]),
    value=raw$value,status=ifelse(is.na(raw$value),"missing","measured"),
    stringsAsFactors=FALSE)
  components <- lapply(as.character(raw$source_components),jsonlite::fromJSON,simplifyVector=FALSE)
  if (anyDuplicated(points[c("dataset_id","indicator_id","territory_id","axis_value")]))
    stop("Canonical OCS-GE role projection contains duplicate territory states",call.=FALSE)
  metadata_vintages <- unlist(lapply(metadata$source_records,function(rec) rec$vintages),recursive=FALSE)
  indicator_source <- unlist(page$sources,use.names=FALSE)[[1L]]
  source_record <- metadata$source_records[[indicator_source]]
  if(is.null(source_record$dataset) || !nzchar(source_record$dataset))
    stop("OCS-GE dataset identity is missing from canonical source metadata",call.=FALSE)
  declared <- do.call(rbind,lapply(metadata_vintages,function(v) data.frame(id=as.character(v$id),
    version=as.character(v$version),reference_date=as.character(v$dateReference),
    publication_date=as.character(v$datePublication),stringsAsFactors=FALSE)))
  vintages <- as.data.frame(vintages,stringsAsFactors=FALSE)
  revision_rows <- list(); links <- list()
  for (i in seq_len(nrow(raw))) {
    role_sources <- components[[i]][[roles[[i]]]]
    if (is.null(role_sources) || !length(role_sources)) stop("Canonical state role has no typed source components",call.=FALSE)
    source_ids <- as.character(role_sources)
    for (source_id in source_ids) {
    vr <- vintages[as.character(vintages$id)==source_id,,drop=FALSE]
    md <- declared[declared$id==source_id,,drop=FALSE]
    # The emitted vintages Parquet is the canonical publication-date authority.
    # Pinned descriptor metadata must still agree on identity, source vintage,
    # and reference date; it may lag a republished source publication date.
    if(nrow(vr)!=1L || nrow(md)!=1L || as.character(vr$version[[1L]])!=md$version[[1L]] ||
       as.character(vr$date_reference[[1L]])!=md$reference_date[[1L]])
      stop("OCS-GE source/vintage identity differs from metadata: ",source_id,call.=FALSE)
    hash <- series_revision_hash(source_id,vr$version[[1L]],vr$source[[1L]],source_record$dataset,
      vr$version[[1L]],vr$date_reference[[1L]],vr$date_publication[[1L]])
    revision_id <- paste0(source_id,"-",vr$version[[1L]],"-",substr(hash,1L,16L))
    revision_rows[[revision_id]] <- data.frame(provenance_revision_id=revision_id,source_id=source_id,
      vintage_id=as.character(vr$version[[1L]]),source_name=as.character(vr$source[[1L]]),
      dataset_name=as.character(source_record$dataset),source_version=as.character(vr$version[[1L]]),
      reference_date=as.Date(vr$date_reference[[1L]]),publication_date=as.Date(vr$date_publication[[1L]]),
      revision_hash=hash,stringsAsFactors=FALSE)
    links[[length(links)+1L]] <- data.frame(dataset_id=dataset_id,indicator_id=indicator_id,
      territory_id=points$territory_id[[i]],axis_value=details[[i]],provenance_revision_id=revision_id,
      stringsAsFactors=FALSE)
    }
  }
  provenance <- do.call(rbind,revision_rows); rownames(provenance)<-NULL
  point_provenance <- unique(do.call(rbind,links)); rownames(point_provenance)<-NULL
  descriptor <- list(dataset_id=dataset_id,indicator_id=indicator_id,axis_kind="declared_detail",
    axis_values=as.character(unlist(page$comparison$details,use.names=FALSE)),completeness="may_be_missing",
    comparison_point=as.character(page$comparison$detail),
    label=page$label,unit=page$unit,direction=as.character(page$comparison$direction %||% page$direction),allowed_levels=levels,
    descriptor_version=as.character(page$descriptor_version %||% "1"))
  result <- list(dataset_id=dataset_id,points=points,descriptor=descriptor,
    provenance=provenance,point_provenance=point_provenance,
    excluded=list(region=list(policy="territory_fiche_only",row_count=nrow(excluded_region))))
  validate_owned_series_projection(result)
  result
}

series_revision_hash <- function(...) {
  text <- paste(..., collapse="\x1f")
  if (requireNamespace("digest", quietly=TRUE)) digest::digest(text, algo="sha256", serialize=FALSE)
  else {
    path <- tempfile("series-provenance-")
    on.exit(unlink(path),add=TRUE)
    writeBin(charToRaw(text),path)
    unname(tools::md5sum(path))
  }
}

validate_owned_series_projection <- function(projection) {
  if (!is.list(projection) || !is.data.frame(projection$points) ||
      !is.list(projection$descriptor) || !is.data.frame(projection$provenance) ||
      !is.data.frame(projection$point_provenance)) stop("Owned series projection is incomplete", call.=FALSE)
  d <- projection$descriptor; points <- projection$points; provenance <- projection$provenance
  required_descriptor <- c("dataset_id","indicator_id","axis_kind","axis_values","completeness",
    "comparison_point","label","unit","direction","allowed_levels","descriptor_version")
  required_points <- c("dataset_id","indicator_id","territory_id","territory_type","axis_value",
    "observation_period","value","status")
  required_prov <- c("provenance_revision_id","source_id","vintage_id","source_name","dataset_name",
    "source_version","reference_date","publication_date","revision_hash")
  required_links <- c("dataset_id","indicator_id","territory_id","axis_value","provenance_revision_id")
  if (!all(required_descriptor %in% names(d)) || !all(required_points %in% names(points)) ||
      !all(required_prov %in% names(provenance)) || !all(required_links %in% names(projection$point_provenance)))
    stop("Owned series projection is missing contract fields", call.=FALSE)
  axes <- as.character(d$axis_values)
  valid_axis <- if (identical(d$axis_kind, "year")) !anyNA(axes) && all(grepl("^\\d{4}$", axes)) &&
    identical(axes, axes[order(as.integer(axes))]) else identical(d$axis_kind, "state_role") &&
    identical(axes, c("M2", "M3"))
  if (identical(d$axis_kind,"declared_detail")) valid_axis <- !anyNA(axes) && length(axes)>0L
  if (length(d$dataset_id)!=1L || is.na(d$dataset_id) || !nzchar(d$dataset_id) ||
      length(d$indicator_id)!=1L || is.na(d$indicator_id) || !nzchar(d$indicator_id) ||
      !length(axes) || anyDuplicated(axes) || !valid_axis ||
      !d$completeness %in% c("dense_complete","may_be_missing") ||
      !length(d$allowed_levels) || anyDuplicated(d$allowed_levels) ||
      any(!d$allowed_levels %in% c("commune","epci","departement","region")) ||
      (is.null(d$comparison_point) && d$direction!="none") ||
      (!is.null(d$comparison_point) && (!d$comparison_point %in% axes || !d$direction %in% c("high","low"))))
    stop("Invalid owned series descriptor axes, ownership, levels or comparison", call.=FALSE)
  if (!nrow(points) || anyNA(points[required_points[c(1:6,8)]]) ||
      any(points$dataset_id!=d$dataset_id) || any(points$indicator_id!=d$indicator_id) ||
      any(!points$territory_type %in% d$allowed_levels) || any(!points$axis_value %in% axes) ||
      anyDuplicated(points[c("dataset_id","indicator_id","territory_id","axis_value")]) ||
      any(!points$status %in% c("measured","missing")) ||
      any((points$status=="measured") != !is.na(points$value)) ||
      any(!is.na(points$value) & !is.finite(points$value)))
    stop("Invalid owned series observation or undeclared axis/level", call.=FALSE)
  if (identical(d$axis_kind,"declared_detail") &&
      (!"state_role" %in% names(points) || anyNA(points$state_role) ||
       any(!points$state_role %in% c("M2","M3")) ||
       anyDuplicated(points[c("dataset_id","indicator_id","territory_id","state_role")])))
    stop("Declared-detail state facts require unique typed M2/M3 roles",call.=FALSE)
  if (identical(d$axis_kind,"declared_detail")) {
    roles_by_territory <- split(points$state_role,points$territory_id)
    if (any(!vapply(roles_by_territory,function(roles) setequal(roles,c("M2","M3")),logical(1))))
      stop("Every declared-detail territory requires both canonical state roles",call.=FALSE)
  }
  if (anyNA(provenance[required_prov]) || anyDuplicated(provenance$provenance_revision_id) ||
      anyDuplicated(provenance$revision_hash)) stop("Invalid or duplicate immutable provenance revision",call.=FALSE)
  expected_hash <- vapply(seq_len(nrow(provenance)),function(i) series_revision_hash(
    provenance$source_id[[i]],provenance$vintage_id[[i]],provenance$source_name[[i]],
    provenance$dataset_name[[i]],provenance$source_version[[i]],
    as.character(provenance$reference_date[[i]]),as.character(provenance$publication_date[[i]])),character(1))
  expected_id <- paste0(provenance$source_id,"-",provenance$vintage_id,"-",substr(expected_hash,1L,16L))
  if(any(provenance$revision_hash!=expected_hash) || any(provenance$provenance_revision_id!=expected_id))
    stop("Immutable provenance revision fingerprint does not match its source fields",call.=FALSE)
  links <- projection$point_provenance
  if (anyNA(links[required_links]) || any(links$dataset_id!=d$dataset_id) ||
      any(links$indicator_id!=d$indicator_id) || any(!links$axis_value %in% axes) ||
      anyDuplicated(links) || any(!links$provenance_revision_id %in% provenance$provenance_revision_id))
    stop("Invalid owned series provenance association",call.=FALSE)
  point_keys <- paste(points$dataset_id,points$indicator_id,points$territory_id,points$axis_value,sep="\x1f")
  link_keys <- paste(links$dataset_id,links$indicator_id,links$territory_id,links$axis_value,sep="\x1f")
  if (!all(point_keys %in% link_keys)) stop("Every observation requires at least one provenance revision",call.=FALSE)
  invisible(projection)
}

register_conso_enaf_owned_publisher <- function(registry, metadata) {
  registry <- register_series_publisher(registry, "conso_enaf_annuel_owned",
    project=function(canonical) owned_conso_enaf_projection(canonical, metadata),
    publish=function(projection, db, version) db$replace_dataset(projection, version))
  registry$conso_enaf_annuel_owned$owned <- TRUE
  registry
}

register_artif_m2m3_owned_publisher <- function(registry, metadata) {
  registry <- register_series_publisher(registry,"artif_par_habitant_owned",
    project=function(canonical) project_artif_m2m3_projection(canonical$indicateurs,
      canonical$histoires,canonical$vintages,metadata),
    publish=function(projection,db,version) db$replace_dataset(projection,version))
  registry$artif_par_habitant_owned$owned <- TRUE
  registry
}

register_owned_series_publishers <- function(registry, metadata) {
  registry <- register_conso_enaf_owned_publisher(registry,metadata)
  register_artif_m2m3_owned_publisher(registry,metadata)
}

owned_series_postgres_adapter <- function(con) {
  if (!requireNamespace("DBI", quietly=TRUE)) stop("DBI is required")
  list(
    transaction=function(expr) DBI::dbWithTransaction(con, expr),
    lock=function(dataset_id) DBI::dbGetQuery(con,
      "SELECT pg_advisory_xact_lock(hashtext('owned-series'),hashtext($1))", params=list(dataset_id)),
    dataset_marker=function(dataset_id) DBI::dbGetQuery(con,
      "SELECT content_version,reference_content_version FROM series_dataset_publication WHERE dataset_id=$1",
      params=list(dataset_id)),
    reference_marker=function() DBI::dbGetQuery(con,
      "SELECT content_version FROM table_publication WHERE table_name='territory_reference'"),
    replace_dataset=function(projection, version) {
      validate_owned_series_projection(projection)
      d <- projection$descriptor; dataset_id <- d$dataset_id
      reference <- DBI::dbGetQuery(con,
        "SELECT content_version FROM table_publication WHERE table_name='territory_reference'")
      if (nrow(reference)!=1L) stop("Territory reference publication is unavailable",call.=FALSE)
      # Revision records are insert-only; a reused ID/hash with different content is rejected.
      for (i in seq_len(nrow(projection$provenance))) {
        p <- projection$provenance[i,,drop=FALSE]
        DBI::dbExecute(con, "INSERT INTO series_provenance_revision(provenance_revision_id,source_id,vintage_id,source_name,dataset_name,source_version,reference_date,publication_date,revision_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(provenance_revision_id) DO NOTHING",
          params=unname(as.list(p[1,c("provenance_revision_id","source_id","vintage_id","source_name","dataset_name","source_version","reference_date","publication_date","revision_hash")])) )
        same <- DBI::dbGetQuery(con, "SELECT count(*) AS n FROM series_provenance_revision WHERE provenance_revision_id=$1 AND source_id=$2 AND vintage_id=$3 AND source_name=$4 AND dataset_name=$5 AND source_version=$6 AND reference_date IS NOT DISTINCT FROM $7::date AND publication_date IS NOT DISTINCT FROM $8::date AND revision_hash=$9",
          params=unname(as.list(p[1,c("provenance_revision_id","source_id","vintage_id","source_name","dataset_name","source_version","reference_date","publication_date","revision_hash")])) )$n[[1L]]
        if (same!=1L) {
          stop("Immutable provenance revision ID collision: ",p$provenance_revision_id[[1L]],call.=FALSE)
        }
      }
      DBI::dbExecute(con,"DELETE FROM series_dataset_publication WHERE dataset_id=$1",params=list(dataset_id))
      DBI::dbExecute(con,"INSERT INTO series_dataset_publication(dataset_id,content_version,reference_content_version,row_count,published_at) VALUES($1,$2,$3,$4,now())",
        params=list(dataset_id,version,reference$content_version[[1L]],nrow(projection$points)))
      array_literal <- function(x) paste0("{",paste0('"',gsub('"','\\\\"',as.character(x),fixed=TRUE),'"',collapse=","),"}")
      DBI::dbExecute(con,"INSERT INTO series_dataset_descriptor(dataset_id,indicator_id,axis_kind,axis_values,completeness,comparison_point,label,unit,direction,allowed_levels,descriptor_version) VALUES($1,$2,$3,$4::text[],$5,$6,$7,$8,$9,$10::text[],$11)",
        params=list(dataset_id,d$indicator_id,d$axis_kind,array_literal(d$axis_values),d$completeness,
          d$comparison_point %||% NA_character_,d$label,d$unit,d$direction,
          array_literal(d$allowed_levels),d$descriptor_version))
      point_columns <- c("dataset_id","indicator_id","territory_id","territory_type","axis_value",
        "observation_period","value","status")
      optional_columns <- intersect(c("state_role"),names(projection$points))
      DBI::dbWriteTable(con,"series_dataset_observation",projection$points[
        c(point_columns,optional_columns)],append=TRUE,row.names=FALSE)
      DBI::dbWriteTable(con,"series_observation_provenance",projection$point_provenance,append=TRUE,row.names=FALSE)
    })
}

publish_owned_series_projection <- function(projection, db) {
  validate_owned_series_projection(projection)
  if (!is.function(db$transaction) || !is.function(db$lock) ||
      !is.function(db$dataset_marker) || !is.function(db$reference_marker) || !is.function(db$replace_dataset))
    stop("Invalid owned series database adapter",call.=FALSE)
  version <- scalar_content_version(projection); dataset <- projection$descriptor$dataset_id
  db$transaction({
    db$lock(dataset)
    marker <- db$dataset_marker(dataset); ref <- db$reference_marker()
    if (!nrow(ref)) stop("Territory reference publication is unavailable",call.=FALSE)
    changed <- !nrow(marker) || !identical(as.character(marker$content_version[[1L]]),version)
    rebound <- nrow(marker) && !identical(as.character(marker$reference_content_version[[1L]]),as.character(ref$content_version[[1L]]))
    if (changed || rebound) db$replace_dataset(projection,version)
    invisible(list(changed=changed,rebound=rebound,content_version=version,dataset_id=dataset))
  })
}

# Fingerprint all authoritative inputs on both sides of one read window. This
# detects persistent concurrent replacements; it is not an atomic build lock.
read_stable_series_artifacts <- function(paths, reader) {
  if (!is.character(paths) || !length(paths) || is.null(names(paths)) ||
      any(!nzchar(names(paths))) || anyDuplicated(names(paths)) ||
      anyNA(paths) || any(!file.exists(paths)) || !is.function(reader))
    stop("Stable series input paths/reader are invalid or missing", call.=FALSE)
  before <- unname(tools::md5sum(paths))
  value <- reader(paths)
  after <- unname(tools::md5sum(paths))
  if (!identical(before, after))
    stop("Canonical series inputs changed while reading", call.=FALSE)
  value
}

project_conso_enaf_series_from_artifacts <- function(indicators, vintages, metadata) {
  projection <- project_conso_enaf_series(list(indicateurs=indicators), metadata)
  source <- projection$descriptor$source_id
  required_vintages <- c("id", "source", "version", "date_reference", "date_publication")
  if (!is.data.frame(vintages) || !all(required_vintages %in% names(vintages)))
    stop("Canonical vintage Parquet is missing required source identity fields", call.=FALSE)
  record <- vintages[as.character(vintages$id) == source, , drop=FALSE]
  if (nrow(record) != 1L) stop("Canonical vintage Parquet must declare exactly one source vintage", call.=FALSE)
  expected <- projection$vintage
  annual <- indicators[!is.na(indicators$key) & indicators$key == "conso_enaf_annuel", , drop=FALSE]
  source_labels <- unique(as.character(annual$vintage_source))
  if (length(source_labels) != 1L || is.na(record$source[[1L]]) ||
      !identical(source_labels[[1L]], as.character(record$source[[1L]])))
    stop("Canonical annual source label differs from its source-key vintage record", call.=FALSE)
  if (!identical(as.character(record$version[[1L]]), as.character(expected$version[[1L]])) ||
      !identical(as.character(record$date_reference[[1L]]), as.character(expected$reference_date[[1L]])) ||
      !identical(as.character(record$date_publication[[1L]]), as.character(expected$publication_date[[1L]])))
    stop("Series provenance differs from canonical vintage Parquet", call.=FALSE)
  projection$canonical_vintage_source <- as.character(record$source[[1L]])
  projection
}

# Production entry point: read real Parquet + pinned metadata exactly once.
# Never invoke fixture builders or recompute canonical indicator values here.
read_conso_enaf_series_projection <- function(sortie = "../public/data",
                                              metadata_path = "inst/extdata/theme-metadata/theme_milieux.json") {
  paths <- c(indicators=file.path(sortie, "indicateurs_milieux.parquet"),
    vintages=file.path(sortie, "vintages.parquet"), metadata=metadata_path)
  read_stable_series_artifacts(paths, function(input) {
    indicators <- nanoparquet::read_parquet(input[["indicators"]])
    vintages <- nanoparquet::read_parquet(input[["vintages"]])
    metadata <- jsonlite::read_json(input[["metadata"]], simplifyVector=FALSE)
    project_conso_enaf_series_from_artifacts(indicators, vintages, metadata)
  })
}

# Read one fingerprinted snapshot for both registered owned projections. The
# four canonical inputs and pinned descriptor are the only publication inputs.
read_owned_series_projections <- function(sortie="../public/data",
    metadata_path="inst/extdata/theme-metadata/theme_milieux.json") {
  paths <- c(indicators=file.path(sortie,"indicateurs_milieux.parquet"),
    histories=file.path(sortie,"histoires_milieux.parquet"),
    vintages=file.path(sortie,"vintages.parquet"), metadata=metadata_path)
  read_stable_series_artifacts(paths,function(input) {
    canonical <- list(indicateurs=nanoparquet::read_parquet(input[["indicators"]]),
      histoires=nanoparquet::read_parquet(input[["histories"]]),
      vintages=nanoparquet::read_parquet(input[["vintages"]]))
    metadata <- jsonlite::read_json(input[["metadata"]],simplifyVector=FALSE)
    registry <- register_owned_series_publishers(list(),metadata)
    projections <- lapply(registry,function(publisher) publisher$project(canonical))
    lapply(projections,validate_owned_series_projection)
    # Reporting-only exclusion metadata belongs to the reader result, not the
    # owned projection whose serialized identity is the publication version.
    enaf <- project_conso_enaf_series_from_artifacts(canonical$indicateurs,
      canonical$vintages,metadata)
    attr(projections,"excluded") <- list(conso_enaf_annuel_owned=enaf$excluded)
    projections
  })
}

require_owned_series_publish_opt_in <- function(value=Sys.getenv("LUSK_PUBLISH_OWNED_SERIES",unset="")) {
  if (!identical(value,"1")) stop("Owned series publication requires LUSK_PUBLISH_OWNED_SERIES=1",call.=FALSE)
  invisible(TRUE)
}

# Injectable dispatch keeps operational ordering testable without a database.
dispatch_owned_series_cli <- function(mode, projections, connect,
    opt_in=Sys.getenv("LUSK_PUBLISH_OWNED_SERIES",unset=""),
    lusk_mode=Sys.getenv("LUSK_MODE",unset="full")) {
  if (!mode %in% c("check","publish")) stop("Unknown owned series action",call.=FALSE)
  if (mode=="publish") {
    require_owned_series_publish_opt_in(opt_in)
    if (identical(lusk_mode,"cron")) stop("Owned series publication is not enabled for cron mode",call.=FALSE)
  }
  if (!length(projections) || any(!vapply(projections,function(p) {
    tryCatch({validate_owned_series_projection(p); TRUE},error=function(e) FALSE)
  },logical(1)))) stop("Both owned series projections must validate before publication",call.=FALSE)
  versions <- lapply(projections,scalar_content_version)
  if (mode=="check") return(list(projections=projections,versions=versions))
  connection <- connect()
  on.exit(DBI::dbDisconnect(connection),add=TRUE)
  adapter <- owned_series_postgres_adapter(connection)
  results <- lapply(projections,function(p) publish_owned_series_projection(p,adapter))
  list(projections=projections,versions=versions,results=results)
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
      if (!is.list(d) || length(d$indicator_id) != 1L || is.na(d$indicator_id) ||
          !nzchar(d$indicator_id))
        stop("Series whole-table snapshot requires exactly one descriptor identity", call.=FALSE)
      existing_ids <- DBI::dbGetQuery(con,
        "SELECT indicator_id FROM series_descriptor UNION SELECT indicator_id FROM ordered_series")$indicator_id
      foreign_ids <- setdiff(unique(as.character(existing_ids)), as.character(d$indicator_id))
      if (length(foreign_ids))
        stop("Refusing whole-table series replacement: existing other indicator snapshot(s) found", call.=FALSE)
      levels_sql <- paste0("ARRAY[", paste(vapply(d$allowed_levels, quote, character(1)), collapse=","), "]::text[]")
      DBI::dbExecute(con, "INSERT INTO source_dataset(source_id,name) VALUES($1,$2) ON CONFLICT(source_id) DO UPDATE SET name=EXCLUDED.name",
        params=list(d$source_id, projection$dataset_name))
      vintage <- projection$vintage
      DBI::dbExecute(con, "INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date) VALUES($1,$2,$3,$4,$5) ON CONFLICT(source_id,vintage_id) DO UPDATE SET version=EXCLUDED.version,reference_date=EXCLUDED.reference_date,publication_date=EXCLUDED.publication_date",
        params=unname(as.list(vintage[c("source_id","vintage_id","version","reference_date","publication_date")])) )
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
  if (isTRUE(publisher$owned)) return(publish_owned_series_projection(projection, db))
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
