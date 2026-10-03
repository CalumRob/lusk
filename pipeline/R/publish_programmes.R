# Programme serving projections reuse the canonical programme fact producer.
# Annual grant totals have a year coordinate; they are not timeless scalars.
read_programme_serving_inputs <- function(sortie="../public/data",
    metadata_path="inst/extdata/theme-metadata/theme_programmes.json") {
  paths <- c(membres=file.path(sortie,"programmes_membres.parquet"),
    subventions=file.path(sortie,"programmes_subventions.parquet"),
    vintages=file.path(sortie,"vintages.parquet"),territoires=file.path(sortie,"territoires.parquet"), metadata=metadata_path)
  read_stable_series_artifacts(paths, function(input) list(
    canonical=list(programmes=list(
      membres=nanoparquet::read_parquet(input[["membres"]]),
      subventions=nanoparquet::read_parquet(input[["subventions"]])),
      vintages=nanoparquet::read_parquet(input[["vintages"]]),territoires=nanoparquet::read_parquet(input[["territoires"]])),
    metadata=jsonlite::read_json(input[["metadata"]],simplifyVector=FALSE)))
}

project_annual_grants_owned_series <- function(canonical, metadata) {
  page <- metadata$indicator_pages$subventions_annuelles
  fields <- c("indicator","series_dataset_id","serving_levels","completeness","absence_semantics","label","unit","direction","sources","comparison")
  if (is.null(page) || !all(fields %in% names(page)) ||
      !identical(page$indicator,"subventions_annuelles") ||
      !identical(page$completeness,"may_be_missing") ||
      !identical(page$absence_semantics,"no_record") ||
      !identical(page$comparison$statistic,"median") ||
      !identical(page$comparison$scope,"default_group"))
    stop("Annual grant producer serving declaration is incomplete",call.=FALSE)
  facts <- construire_indicateurs_programmes(canonical$programmes$membres,
    canonical$programmes$subventions)
  raw <- facts[facts$key==page$indicator,,drop=FALSE]
  axes <- sort(unique(as.character(raw$dimension)))
  levels <- unlist(page$serving_levels,use.names=FALSE)
  facet <- as.character(page$comparison$dimension)
  source_id <- unlist(page$sources,use.names=FALSE)
  if (length(source_id)!=1L || !nrow(raw) || anyNA(raw[c("dimension","unit","type")]) ||
      any(!grepl("^[0-9]{4}$",axes)) || any(!raw$type %in% levels) ||
      any(raw$unit!=page$unit) || any(!is.na(raw$detail)) ||
      length(facet)!=1L || !facet %in% axes)
    stop("Annual grant facts differ from their declared year, level, unit or comparison",call.=FALSE)
  vintage <- canonical$vintages[canonical$vintages$id==source_id,,drop=FALSE]
  source_record <- metadata$source_records[[source_id]]
  declared <- source_record$vintages
  if (nrow(vintage)!=1L || is.null(source_record$dataset) ||
      length(declared)!=1L || !identical(as.character(vintage$version[[1L]]),as.character(declared[[1L]]$version)) ||
      !identical(as.character(vintage$date_reference[[1L]]),as.character(declared[[1L]]$dateReference)) ||
      !identical(as.character(vintage$date_publication[[1L]]),as.character(declared[[1L]]$datePublication)) ||
      anyNA(raw[c("vintage_source","vintage_version","vintage_date_reference","vintage_date_publication")]) ||
      any(raw$vintage_source!=vintage$source[[1L]]) ||
      any(raw$vintage_version!=vintage$version[[1L]]) ||
      any(as.character(raw$vintage_date_reference)!=as.character(vintage$date_reference[[1L]])) ||
      any(as.character(raw$vintage_date_publication)!=as.character(vintage$date_publication[[1L]])))
    stop("Annual grant source vintage differs from canonical facts or producer metadata",call.=FALSE)
  hash <- series_revision_hash(source_id,vintage$version[[1L]],vintage$source[[1L]],
    source_record$dataset,vintage$version[[1L]],vintage$date_reference[[1L]],vintage$date_publication[[1L]])
  revision_id <- paste0(source_id,"-",vintage$version[[1L]],"-",substr(hash,1L,16L))
  points <- data.frame(dataset_id=page$series_dataset_id,indicator_id=page$indicator,
    territory_id=as.character(raw$territoire),territory_type=as.character(raw$type),
    axis_value=as.character(raw$dimension),observation_period=as.character(raw$dimension),
    value=raw$value,status=ifelse(is.na(raw$value),"missing","measured"),stringsAsFactors=FALSE)
  projection <- list(dataset_id=page$series_dataset_id, points=points,
    descriptor=list(dataset_id=page$series_dataset_id,indicator_id=page$indicator,
      theme_id=metadata$theme,active_read_route=TRUE,axis_kind="year",axis_values=axes,
      completeness=page$completeness,comparison_point=facet,label=page$label,unit=page$unit,
      direction=page$direction,allowed_levels=levels,
      comparison_levels=unlist(page$levels,use.names=FALSE),
      comparison_statistic=page$comparison$statistic,comparison_scope=page$comparison$scope,
      absence_semantics=page$absence_semantics,
      descriptor_version=as.character(page$descriptor_version %||% "1")),
    context_parent_policy=data.frame(dataset_id=page$series_dataset_id,indicator_id=page$indicator,
      focal_level=names(page$context_parent_levels),
      parent_level=unlist(page$context_parent_levels,use.names=FALSE)),
    provenance=data.frame(provenance_revision_id=revision_id,source_id=source_id,
      vintage_id=as.character(vintage$version[[1L]]),source_name=as.character(vintage$source[[1L]]),
      dataset_name=source_record$dataset,source_version=as.character(vintage$version[[1L]]),
      reference_date=as.Date(vintage$date_reference[[1L]]),publication_date=as.Date(vintage$date_publication[[1L]]),
      revision_hash=hash,stringsAsFactors=FALSE),
    point_provenance=data.frame(dataset_id=points$dataset_id,indicator_id=points$indicator_id,
      territory_id=points$territory_id,axis_value=points$axis_value,provenance_revision_id=revision_id))
  validate_owned_series_projection(projection)
  projection
}

register_programme_series_publishers <- function(registry, metadata) {
  registry <- register_series_publisher(registry,"subventions_annuelles_owned",
    project=function(canonical) project_annual_grants_owned_series(canonical,metadata),
    publish=function(projection,db,version) db$replace_dataset(projection,version))
  registry$subventions_annuelles_owned$owned <- TRUE
  registry
}

read_programme_series_projections <- function(sortie="../public/data",
    metadata_path="inst/extdata/theme-metadata/theme_programmes.json") {
  inputs <- read_programme_serving_inputs(sortie,metadata_path)
  registry <- register_programme_series_publishers(list(),inputs$metadata)
  lapply(registry,function(publisher) publisher$project(inputs$canonical))
}
