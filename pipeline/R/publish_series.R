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

project_prix_m2_owned_series <- function(indicators, vintages, metadata) {
  page <- metadata$indicator_pages$prix_m2
  if (is.null(page) || is.null(page$series_dataset_id) || page$series_publication != "owned")
    stop("prix_m2 owned-series identity is missing from metadata", call.=FALSE)
  axis <- as.character(unlist(page$comparison$details, use.names=FALSE))
  levels <- as.character(unlist(page$levels, use.names=FALSE))
  raw_all <- indicators[!is.na(indicators$key) & indicators$key == "prix_m2", , drop=FALSE]
  raw <- raw_all[!is.na(raw_all$detail) & raw_all$type %in% levels, , drop=FALSE]
  if (!nrow(raw) || !all(c("territoire", "type", "detail", "value", "vintage_source", "vintage_version",
      "vintage_date_reference", "vintage_date_publication") %in% names(raw)))
    stop("Canonical prix_m2 annual facts or lineage fields are missing", call.=FALSE)
  if (any(!as.character(raw$detail) %in% axis) || anyNA(raw[c("territoire", "type", "detail", "vintage_version",
      "vintage_date_publication")]) || anyDuplicated(raw[c("territoire", "type", "detail")]))
    stop("Canonical prix_m2 annual facts have invalid axes or duplicate keys", call.=FALSE)
  if (!is.data.frame(vintages) || !all(c("id", "source", "version", "date_reference", "date_publication") %in% names(vintages)))
    stop("Canonical Habitat vintages are incomplete", call.=FALSE)
  source_default <- as.character(unlist(page$sources, use.names=FALSE))
  if (!length(source_default) || anyNA(source_default) || any(!nzchar(source_default)))
    stop("prix_m2 source metadata is incomplete", call.=FALSE)
  references <- if ("source_reference" %in% names(raw)) as.character(raw$source_reference) else rep(NA_character_, nrow(raw))
  references[is.na(references) | !nzchar(references)] <- source_default[[1L]]
  source_records <- metadata$source_records
  all_vintages <- unlist(lapply(source_records, function(record) record$vintages), recursive=FALSE)
  declared <- do.call(rbind, lapply(all_vintages, function(v) data.frame(id=as.character(v$id),
    version=as.character(v$version), reference_date=as.character(v$dateReference),
    stringsAsFactors=FALSE)))
  points <- data.frame(dataset_id=page$series_dataset_id, indicator_id="prix_m2",
    territory_id=as.character(raw$territoire), territory_type=as.character(raw$type),
    axis_value=as.character(raw$detail), observation_period=as.character(raw$detail), value=raw$value,
    status=ifelse(is.na(raw$value), "missing", "measured"), stringsAsFactors=FALSE)
  revisions <- list(); links <- list()
  for (i in seq_len(nrow(raw))) {
    source_id <- references[[i]]
    canonical <- vintages[as.character(vintages$id) == source_id,,drop=FALSE]
    pinned <- declared[declared$id == source_id,,drop=FALSE]
    if (nrow(canonical) != 1L || nrow(pinned) != 1L || as.character(canonical$version[[1L]]) != pinned$version[[1L]] ||
        as.character(canonical$date_reference[[1L]]) != pinned$reference_date[[1L]] ||
        as.character(canonical$version[[1L]]) != as.character(raw$vintage_version[[i]]) ||
        as.character(canonical$date_reference[[1L]]) != as.character(raw$vintage_date_reference[[i]]) ||
        as.character(canonical$date_publication[[1L]]) != as.character(raw$vintage_date_publication[[i]]) ||
        as.character(canonical$source[[1L]]) != as.character(raw$vintage_source[[i]]))
      stop("Canonical prix_m2 point lineage differs from its effective source vintage: ", source_id, call.=FALSE)
    source_record <- source_records[[source_id]]
    if (is.null(source_record$dataset) || !nzchar(source_record$dataset))
      stop("prix_m2 source dataset metadata is incomplete: ", source_id, call.=FALSE)
    hash <- series_revision_hash(source_id, canonical$version[[1L]], canonical$source[[1L]], source_record$dataset,
      canonical$version[[1L]], canonical$date_reference[[1L]], canonical$date_publication[[1L]])
    revision_id <- paste0(source_id, "-", canonical$version[[1L]], "-", substr(hash, 1L, 16L))
    revisions[[revision_id]] <- data.frame(provenance_revision_id=revision_id, source_id=source_id,
      vintage_id=as.character(canonical$version[[1L]]), source_name=as.character(canonical$source[[1L]]),
      dataset_name=as.character(source_record$dataset), source_version=as.character(canonical$version[[1L]]),
      reference_date=as.Date(canonical$date_reference[[1L]]), publication_date=as.Date(canonical$date_publication[[1L]]),
      revision_hash=hash, stringsAsFactors=FALSE)
    links[[length(links)+1L]] <- data.frame(dataset_id=page$series_dataset_id, indicator_id="prix_m2",
      territory_id=as.character(raw$territoire[[i]]), axis_value=as.character(raw$detail[[i]]),
      provenance_revision_id=revision_id, stringsAsFactors=FALSE)
  }
  descriptor <- list(dataset_id=page$series_dataset_id, indicator_id="prix_m2", axis_kind="year", axis_values=axis,
    completeness="may_be_missing", comparison_point=as.character(page$comparison$detail), label=page$label,
    unit=page$unit, direction=page$direction, allowed_levels=levels,
    descriptor_version=as.character(page$descriptor_version %||% "1"))
  result <- list(dataset_id=page$series_dataset_id, points=points, descriptor=descriptor,
    provenance=do.call(rbind, revisions), point_provenance=unique(do.call(rbind, links)))
  validate_owned_series_projection(result)
  result
}

project_raccordement_owned_series <- function(indicators,vintages,metadata) {
  declaration <- metadata$owned_series_routes$raccordement_courbe
  page <- metadata$indicator_pages$raccordement_courbe
  route_key <- "raccordement_courbe"
  indicator_id <- as.character(page$indicator %||% NA_character_)
  reference_contract <- declaration$reference
  if (is.null(declaration) || is.null(page) || is.null(reference_contract) ||
      length(indicator_id)!=1L || is.na(indicator_id) || !nzchar(indicator_id) ||
      !identical(indicator_id,route_key) || !identical(as.character(declaration$indicator_id),indicator_id) ||
      !isTRUE(declaration$active_read_route) ||
      !isTRUE(declaration$reference_read_route) ||
      !nzchar(as.character(declaration$reference_indicator %||% "")) ||
      !identical(declaration$axis_kind,"duration_minute") ||
      !identical(reference_contract$role,"analytical_reference") ||
      !nzchar(reference_contract$id %||% "") || !nzchar(reference_contract$label %||% "") ||
      !nzchar(reference_contract$statistic %||% "") ||
      !identical(declaration$observation_period_contract$kind,"snapshot_date") ||
      !identical(declaration$observation_period_contract$source,"raccordement_recipe_date_mesure") ||
      !grepl("^[0-9]{4}-[0-9]{2}-[0-9]{2}$",declaration$observation_period_contract$expected_date %||% "") ||
      !identical(declaration$comparison_contract$statistic,"median") ||
      !identical(declaration$comparison_contract$scope,"default_group"))
    stop("Raccordement duration/reference metadata contract is incomplete",call.=FALSE)
  minutes <- as.integer(unlist(declaration$axis_values,use.names=FALSE))
  axes <- paste0("t",sprintf("%04d",minutes))
  if (!length(axes) || anyNA(minutes) || any(minutes<0 | minutes>9999) ||
      anyDuplicated(minutes) || any(diff(minutes)<=0))
    stop("Raccordement duration axis must be explicitly ordered",call.=FALSE)
  page_axes <- as.character(unlist(page$comparison$details,use.names=FALSE))
  if (!length(page_axes) || !identical(page_axes,axes) ||
      !identical(as.character(declaration$theme_id),as.character(metadata$theme)) ||
      !identical(as.character(declaration$source_id),as.character(unlist(page$sources,use.names=FALSE))))
    stop("Raccordement route axes, theme or source differ from the indicator producer contract",call.=FALSE)
  keys <- c(indicator_id,as.character(declaration$reference_indicator))
  raw <- indicators[!is.na(indicators$key) & indicators$key %in% keys,,drop=FALSE]
  if (!nrow(raw) || !"observation_period" %in% names(raw) ||
      anyNA(raw[c("theme","key","detail","type","territoire","unit","vintage_source","vintage_version","vintage_date_reference","vintage_date_publication","observation_period")]) ||
      any(raw$theme!=declaration$theme_id) || any(raw$unit!=page$unit) || any(!raw$detail %in% axes))
    stop("Canonical raccordement rows are incomplete or outside declared duration axis",call.=FALSE)
  focal_all <- raw[raw$key==indicator_id,,drop=FALSE]
  reference <- raw[raw$key==declaration$reference_indicator,,drop=FALSE]
  allowed_levels <- as.character(unlist(page$levels,use.names=FALSE))
  declared_reference_territory <- as.character(page$trajectory$reference$territoire %||% "")
  if (any(!focal_all$type %in% c(allowed_levels,"region")) ||
      anyDuplicated(focal_all[c("territoire","type","detail")]) || anyDuplicated(reference$detail))
    stop("Canonical raccordement focal/reference identities are invalid",call.=FALSE)
  if (length(unique(reference$type))!=1L || length(unique(reference$territoire))!=1L ||
      reference$type[[1L]]!="region" || (nzchar(declared_reference_territory) &&
        as.character(reference$territoire[[1L]])!=declared_reference_territory) ||
      !identical(as.character(declaration$reference_indicator),as.character(page$trajectory$reference$indicator)) ||
      !identical(as.character(reference_contract$label),as.character(page$trajectory$reference$label)) ||
      !identical(as.character(reference_contract$id),as.character(declaration$reference_id)) ||
      !identical(as.character(reference_contract$label),as.character(declaration$reference_label)) ||
      !identical(as.character(reference_contract$role),as.character(declaration$reference_role)) ||
      !identical(as.character(reference_contract$statistic),as.character(declaration$reference_statistic)))
    stop("Canonical reference artifact does not match its producer reference locator",call.=FALSE)
  excluded <- focal_all[!focal_all$type %in% allowed_levels,,drop=FALSE]
  focal <- focal_all[focal_all$type %in% allowed_levels,,drop=FALSE]
  for (id in unique(focal$territoire)) if (!setequal(as.character(focal$detail[focal$territoire==id]),axes))
    stop("Canonical focal raccordement curve is missing a declared point",call.=FALSE)
  if (!setequal(as.character(reference$detail),axes) || length(unique(reference$territoire))!=1L)
    stop("Canonical named raccordement reference is incomplete",call.=FALSE)
  source_id <- as.character(declaration$source_id)
  vr <- vintages[as.character(vintages$id)==source_id,,drop=FALSE]
  if (nrow(vr)!=1L || length(unique(raw$vintage_version))!=1L ||
      as.character(vr$version[[1L]])!=as.character(raw$vintage_version[[1L]]) ||
      as.character(vr$date_reference[[1L]])!=as.character(raw$vintage_date_reference[[1L]]) ||
      as.character(vr$date_publication[[1L]])!=as.character(raw$vintage_date_publication[[1L]]) ||
      as.character(vr$source[[1L]])!=as.character(raw$vintage_source[[1L]]) ||
      length(unique(raw$vintage_source))!=1L || length(unique(raw$vintage_date_reference))!=1L ||
      length(unique(raw$vintage_date_publication))!=1L)
    stop("Canonical raccordement source vintage does not match vintage artifact",call.=FALSE)
  if (length(unique(raw$observation_period))!=1L ||
      !grepl("^[0-9]{4}-[0-9]{2}-[0-9]{2}$",raw$observation_period[[1L]]) ||
      !identical(as.character(raw$observation_period[[1L]]),
        as.character(declaration$observation_period_contract$expected_date)))
    stop("Canonical raccordement observation period violates its producer snapshot-date contract",call.=FALSE)
  source_record <- metadata$source_records[[source_id]]
  if (is.null(source_record$dataset) || !nzchar(source_record$dataset))
    stop("Raccordement source dataset metadata is incomplete",call.=FALSE)
  dataset_name <- as.character(source_record$dataset)
  version <- as.character(vr$version[[1L]])
  reference_date <- as.Date(vr$date_reference[[1L]])
  publication_date <- as.Date(vr$date_publication[[1L]])
  source_name <- as.character(vr$source[[1L]])
  hash <- series_revision_hash(source_id,version,source_name,dataset_name,version,
    as.character(reference_date),as.character(publication_date))
  revision_id <- paste0(source_id,"-",version,"-",substr(hash,1L,16L))
  provenance <- data.frame(provenance_revision_id=revision_id,source_id=source_id,vintage_id=version,
    source_name=source_name,dataset_name=dataset_name,source_version=version,
    reference_date=reference_date,publication_date=publication_date,revision_hash=hash,stringsAsFactors=FALSE)
  make_points <- function(rows) data.frame(dataset_id=declaration$dataset_id,indicator_id=indicator_id,
    territory_id=as.character(rows$territoire),territory_type=as.character(rows$type),axis_value=as.character(rows$detail),
     observation_period=as.character(rows$observation_period),value=as.numeric(rows$value),status=ifelse(is.na(rows$value),"missing","measured"),
    missing_reason=as.character(rows$rider %||% NA_character_),stringsAsFactors=FALSE)
  points <- make_points(focal)
  reference_descriptor <- data.frame(dataset_id=declaration$dataset_id,indicator_id=indicator_id,
    reference_id=reference_contract$id,reference_label=reference_contract$label,
    reference_role=reference_contract$role,reference_statistic=reference_contract$statistic,
    required=TRUE,reference_indicator_id=as.character(declaration$reference_indicator),
    active_read_route=isTRUE(declaration$reference_read_route),stringsAsFactors=FALSE)
  ref <- data.frame(dataset_id=declaration$dataset_id,indicator_id=indicator_id,
    reference_id=reference_contract$id,axis_value=as.character(reference$detail),
     observation_period=as.character(reference$observation_period),value=as.numeric(reference$value),
    status=ifelse(is.na(reference$value),"missing","measured"),
    missing_reason=as.character(reference$rider %||% NA_character_),stringsAsFactors=FALSE)
  descriptor <- list(dataset_id=declaration$dataset_id,indicator_id=indicator_id,
    axis_kind="duration_minute",axis_values=axes,axis_numeric_values=minutes,
    completeness="dense_complete",comparison_point=as.character(page$comparison$detail),
    label=as.character(page$label),unit=as.character(page$unit),direction=as.character(page$direction),allowed_levels=allowed_levels,
    descriptor_version="1",active_read_route=isTRUE(declaration$active_read_route),
    theme_id=as.character(declaration$theme_id),
    comparison_statistic=as.character(declaration$comparison_contract$statistic),
    comparison_scope=as.character(declaration$comparison_contract$scope),
    observation_period_kind=as.character(declaration$observation_period_contract$kind))
  projection <- list(dataset_id=declaration$dataset_id,points=points,descriptor=descriptor,
    provenance=provenance,point_provenance=data.frame(dataset_id=points$dataset_id,indicator_id=points$indicator_id,
      territory_id=points$territory_id,axis_value=points$axis_value,provenance_revision_id=revision_id),
    named_reference=ref,named_reference_descriptors=reference_descriptor,
    named_reference_provenance=data.frame(dataset_id=ref$dataset_id,indicator_id=ref$indicator_id,
      reference_id=ref$reference_id,axis_value=ref$axis_value,provenance_revision_id=revision_id),
    dataset_name=dataset_name,vintage=vr,excluded=list(not_eligible=list(
      policy="indicator_page_levels",reason="territory_level_not_declared",row_count=nrow(excluded),rows=excluded[c("territoire","type","detail")])))
  validate_owned_series_projection(projection)
  projection
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
  if (identical(d$axis_kind,"duration_minute")) valid_axis <- !anyNA(axes) &&
    all(grepl("^t[0-9]{4}$",axes)) && !is.null(d$axis_numeric_values) &&
    !anyNA(d$axis_numeric_values) && !any(d$axis_numeric_values<0 | d$axis_numeric_values>9999) &&
    identical(as.integer(d$axis_numeric_values),as.integer(d$axis_numeric_values[order(d$axis_numeric_values)])) &&
    length(d$axis_numeric_values)==length(axes) &&
    identical(axes,paste0("t",sprintf("%04d",as.integer(d$axis_numeric_values))))
  if (length(d$dataset_id)!=1L || is.na(d$dataset_id) || !nzchar(d$dataset_id) ||
      length(d$indicator_id)!=1L || is.na(d$indicator_id) || !nzchar(d$indicator_id) ||
      !length(axes) || anyDuplicated(axes) || !valid_axis ||
      !d$completeness %in% c("dense_complete","may_be_missing") ||
      !length(d$allowed_levels) || anyDuplicated(d$allowed_levels) ||
      any(!d$allowed_levels %in% c("commune","epci","departement","region")) ||
      (is.null(d$comparison_point) && d$direction!="none") ||
      (!is.null(d$comparison_point) && (!d$comparison_point %in% axes || !d$direction %in% c("high","low"))))
    stop("Invalid owned series descriptor axes, ownership, levels or comparison: ",paste(d$dataset_id,d$indicator_id,d$axis_kind,d$completeness,d$comparison_point,d$direction,paste(d$allowed_levels,collapse=","),valid_axis,sep=" | "),call.=FALSE)
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
  if (!is.null(projection$named_reference)) {
    refs <- projection$named_reference; ref_links <- projection$named_reference_provenance
    ref_descriptors <- projection$named_reference_descriptors
    fields <- c("dataset_id","indicator_id","reference_id","axis_value","observation_period","value","status")
    descriptor_fields <- c("dataset_id","indicator_id","reference_id","reference_label","reference_role","reference_statistic","required","reference_indicator_id","active_read_route")
    link_fields <- c("dataset_id","indicator_id","reference_id","axis_value","provenance_revision_id")
    if (!identical(d$axis_kind,"duration_minute") || !all(fields %in% names(refs)) ||
        !all(descriptor_fields %in% names(ref_descriptors)) ||
        !all(link_fields %in% names(ref_links)) || !nrow(refs) ||
        !nrow(ref_descriptors) || anyNA(refs[fields[c(1:5,7)]]) || anyNA(ref_descriptors[descriptor_fields]) ||
        any(refs$dataset_id!=d$dataset_id) || any(ref_descriptors$dataset_id!=d$dataset_id) ||
        any(refs$indicator_id!=d$indicator_id) || any(!refs$axis_value %in% axes) ||
        any(!nzchar(trimws(ref_descriptors$reference_label))) ||
        any(!nzchar(trimws(ref_descriptors$reference_statistic))) ||
        any((refs$status=="measured")!=!is.na(refs$value)) ||
        any(!is.na(refs$value)&!is.finite(refs$value)) ||
        any(!ref_links$provenance_revision_id %in% provenance$provenance_revision_id))
      stop("Invalid owned named-reference projection",call.=FALSE)
    if (any(ref_descriptors$reference_role!="analytical_reference") ||
        any(!refs$reference_id %in% ref_descriptors$reference_id) ||
        anyDuplicated(ref_descriptors[c("dataset_id","indicator_id","reference_id")]))
      stop("Named reference facts are outside declared reference identities",call.=FALSE)
    for (reference_id in ref_descriptors$reference_id[ref_descriptors$required]) if (!setequal(refs$axis_value[refs$reference_id==reference_id],axes))
      stop("Named reference is missing a declared duration point",call.=FALSE)
    rk <- paste(refs$dataset_id,refs$indicator_id,refs$reference_id,refs$axis_value,sep="\x1f")
    lk <- paste(ref_links$dataset_id,ref_links$indicator_id,ref_links$reference_id,ref_links$axis_value,sep="\x1f")
    if (!all(rk %in% lk) || anyNA(ref_links[link_fields]) ||
        any(ref_links$dataset_id!=d$dataset_id) || any(ref_links$indicator_id!=d$indicator_id) ||
        any(!ref_links$reference_id %in% ref_descriptors$reference_id) ||
        any(!ref_links$axis_value %in% axes) || anyDuplicated(ref_links))
      stop("Every named reference point requires declared provenance",call.=FALSE)
  }
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

register_prix_m2_owned_publisher <- function(registry, metadata) {
  registry <- register_series_publisher(registry,"prix_m2_owned",
    project=function(canonical) project_prix_m2_owned_series(canonical$habitat$indicateurs,
      canonical$vintages,metadata),
    publish=function(projection,db,version) db$replace_dataset(projection,version))
  registry$prix_m2_owned$owned <- TRUE
  registry
}

register_raccordement_owned_publisher <- function(registry,metadata) {
  registry <- register_series_publisher(registry,"raccordement_courbe_owned",
    project=function(canonical) project_raccordement_owned_series(canonical$mobilite$indicateurs,canonical$vintages,metadata),
    publish=function(projection,db,version) db$replace_dataset(projection,version))
  registry$raccordement_courbe_owned$owned <- TRUE
  registry
}

register_owned_series_publishers <- function(registry, metadata, habitat_metadata=NULL) {
  registry <- register_conso_enaf_owned_publisher(registry,metadata)
  registry <- register_artif_m2m3_owned_publisher(registry,metadata)
  if (!is.null(habitat_metadata)) registry <- register_prix_m2_owned_publisher(registry,habitat_metadata)
  registry
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
      published_count <- nrow(projection$points) + if (is.null(projection$named_reference)) 0L else nrow(projection$named_reference)
      DBI::dbExecute(con,"INSERT INTO series_dataset_publication(dataset_id,content_version,reference_content_version,row_count,published_at) VALUES($1,$2,$3,$4,now())",
        params=list(dataset_id,version,reference$content_version[[1L]],published_count))
      array_literal <- function(x) paste0("{",paste0('"',gsub('"','\\\\"',as.character(x),fixed=TRUE),'"',collapse=","),"}")
      numeric_axis <- if (is.null(d$axis_numeric_values)) NA_character_ else paste0("{",paste(d$axis_numeric_values,collapse=","),"}")
       DBI::dbExecute(con,"INSERT INTO series_dataset_descriptor(dataset_id,indicator_id,axis_kind,axis_values,completeness,comparison_point,label,unit,direction,allowed_levels,descriptor_version,active_read_route,axis_numeric_values,theme_id,comparison_statistic,comparison_scope,observation_period_kind) VALUES($1,$2,$3,$4::text[],$5,$6,$7,$8,$9,$10::text[],$11,$12,$13::integer[],$14,$15,$16,$17)",
        params=list(dataset_id,d$indicator_id,d$axis_kind,array_literal(d$axis_values),d$completeness,
          d$comparison_point %||% NA_character_,d$label,d$unit,d$direction,
          array_literal(d$allowed_levels),d$descriptor_version,isTRUE(d$active_read_route),numeric_axis,d$theme_id %||% NA_character_,
          d$comparison_statistic %||% NA_character_,d$comparison_scope %||% NA_character_,d$observation_period_kind %||% NA_character_))
      point_columns <- c("dataset_id","indicator_id","territory_id","territory_type","axis_value",
        "observation_period","value","status")
      optional_columns <- intersect(c("state_role","missing_reason"),names(projection$points))
      DBI::dbWriteTable(con,"series_dataset_observation",projection$points[
        c(point_columns,optional_columns)],append=TRUE,row.names=FALSE)
      DBI::dbWriteTable(con,"series_observation_provenance",projection$point_provenance,append=TRUE,row.names=FALSE)
      if (!is.null(projection$named_reference)) {
        if (!is.null(projection$named_reference_descriptors))
          DBI::dbWriteTable(con,"series_named_reference_descriptor",projection$named_reference_descriptors,append=TRUE,row.names=FALSE)
        DBI::dbWriteTable(con,"series_named_reference",projection$named_reference[
          c("dataset_id","indicator_id","reference_id","axis_value","observation_period","value","status","missing_reason")],append=TRUE,row.names=FALSE)
        DBI::dbWriteTable(con,"series_named_reference_provenance",projection$named_reference_provenance,append=TRUE,row.names=FALSE)
      }
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

# Read one fingerprinted snapshot for the registered owned projections across
# Milieux and Habitat. Canonical Parquet and pinned metadata own each projection.
read_owned_series_projections <- function(sortie="../public/data",
    metadata_path="inst/extdata/theme-metadata/theme_milieux.json",
    habitat_metadata_path="inst/extdata/theme-metadata/theme_habitat.json",
    mobility_metadata_path="inst/extdata/theme-metadata/theme_mobilite.json") {
  paths <- c(indicators=file.path(sortie,"indicateurs_milieux.parquet"),
    histories=file.path(sortie,"histoires_milieux.parquet"),
    habitat_indicators=file.path(sortie,"indicateurs_habitat.parquet"),
    vintages=file.path(sortie,"vintages.parquet"), metadata=metadata_path, habitat_metadata=habitat_metadata_path)
  mobility_path <- file.path(sortie,"indicateurs_mobilite.parquet")
  if (file.exists(mobility_path) && file.exists(mobility_metadata_path))
    paths <- c(paths,mobility_indicators=mobility_path,mobility_metadata=mobility_metadata_path)
  read_stable_series_artifacts(paths,function(input) {
    canonical <- list(indicateurs=nanoparquet::read_parquet(input[["indicators"]]),
      histoires=nanoparquet::read_parquet(input[["histories"]]),
      habitat=list(indicateurs=nanoparquet::read_parquet(input[["habitat_indicators"]])),
      mobilite=list(indicateurs=if("mobility_indicators" %in% names(input)) nanoparquet::read_parquet(input[["mobility_indicators"]]) else data.frame()),
      vintages=nanoparquet::read_parquet(input[["vintages"]]))
    metadata <- jsonlite::read_json(input[["metadata"]],simplifyVector=FALSE)
    habitat_metadata <- jsonlite::read_json(input[["habitat_metadata"]],simplifyVector=FALSE)
     registry <- register_owned_series_publishers(list(),metadata,habitat_metadata)
     mobility_metadata <- if("mobility_metadata" %in% names(input)) jsonlite::read_json(input[["mobility_metadata"]],simplifyVector=FALSE) else NULL
     if(!is.null(mobility_metadata)) registry <- register_raccordement_owned_publisher(registry,mobility_metadata)
    projections <- lapply(registry,function(publisher) publisher$project(canonical))
    lapply(projections,validate_owned_series_projection)
    # Reporting-only exclusion metadata belongs to the reader result, not the
    # owned projection whose serialized identity is the publication version.
    enaf <- project_conso_enaf_series_from_artifacts(canonical$indicateurs,
      canonical$vintages,metadata)
     excluded <- list(conso_enaf_annuel_owned=enaf$excluded)
     if(!is.null(projections$raccordement_courbe_owned)) excluded$raccordement_courbe_owned <- projections$raccordement_courbe_owned$excluded
     attr(projections,"excluded") <- excluded
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
  },logical(1)))) stop("All owned series projections must validate before publication",call.=FALSE)
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
