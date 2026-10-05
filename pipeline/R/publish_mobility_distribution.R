register_mobility_density_distribution_publisher <- function(registry) {
  if (!is.list(registry) || "mobility_density_distribution" %in% names(registry))
    stop("Invalid or duplicate mobility density distribution publisher", call.=FALSE)
  registry$mobility_density_distribution <- list(
    project=function(input) project_mobility_density_distribution(
      input$histories,input$vintages,input$metadata),
    publish=publish_mobility_density_distribution
  )
  registry
}

publish_mobility_density_distribution <- function(con, projection, input=NULL) {
  required_points <- c("territory_id","territory_type","ordinal","density","density_status","decile","decile_status")
  required_ranges <- c("territory_id","territory_type","range_min","range_max","status")
  if (!is.data.frame(projection$points) || !all(required_points %in% names(projection$points)) ||
      !is.data.frame(projection$ranges) || !all(required_ranges %in% names(projection$ranges)) ||
      anyDuplicated(projection$ranges[c("territory_type","territory_id")]) ||
      anyDuplicated(projection$points[c("territory_type","territory_id","ordinal")]))
    stop("Mobility distribution projection has invalid keys or columns",call.=FALSE)
  DBI::dbWithTransaction(con, {
    reference <- DBI::dbGetQuery(con,"SELECT content_version FROM table_publication WHERE table_name='territory_reference'")
    binding <- DBI::dbGetQuery(con,"SELECT descriptor_version,source_id,vintage_id,source_version,reference_date,publication_date
      FROM mobility_reading_descriptor WHERE singleton")
    if (nrow(reference)!=1L || !nzchar(reference$content_version[[1L]]) || nrow(binding)!=1L ||
        binding$source_id[[1L]]!=projection$source_id || binding$vintage_id[[1L]]!=projection$vintage_id ||
        binding$source_version[[1L]]!=projection$source_version ||
        !identical(as.character(binding$reference_date[[1L]]),as.character(projection$reference_date)) ||
        !identical(as.character(binding$publication_date[[1L]]),as.character(projection$publication_date)))
      stop("Mobility distribution does not match the immutable published snapshot binding",call.=FALSE)
    source <- DBI::dbGetQuery(con,"SELECT sd.name,sv.version,sv.reference_date,sv.publication_date
      FROM source_dataset sd JOIN source_vintage sv USING(source_id) WHERE sd.source_id=$1 AND sv.vintage_id=$2",
      params=list(projection$source_id,projection$vintage_id))
    date_value <- function(x) if(is.na(x)) NA_character_ else format(as.Date(x),"%Y-%m-%d")
    if (nrow(source)!=1L || source$name[[1L]]!=projection$source_name || source$version[[1L]]!=projection$source_version ||
        !identical(date_value(source$reference_date[[1L]]),date_value(projection$reference_date)) ||
        !identical(date_value(source$publication_date[[1L]]),date_value(projection$publication_date)))
      stop("Mobility distribution source vintage is not the immutable registered vintage",call.=FALSE)
    ids <- unique(projection$ranges[c("territory_id","territory_type")])
    for (i in seq_len(nrow(ids))) {
      found <- DBI::dbGetQuery(con,"SELECT 1 FROM territory_reference WHERE territory_id=$1 AND territory_type=$2",
        params=unname(as.list(ids[i,])))
      if (nrow(found)!=1L) stop("Mobility distribution territory is absent from the published reference",call.=FALSE)
    }
    if (any(!projection$points$ordinal %in% (seq_len(projection$axis_count)-1L)) ||
        any(vapply(split(projection$points,interaction(projection$points$territory_type,projection$points$territory_id,drop=TRUE)),
          function(x) nrow(x)!=projection$axis_count || !identical(sort(as.integer(x$ordinal)),seq_len(projection$axis_count)-1L),logical(1))))
      stop("Mobility distribution coordinates do not cover the producer-declared axis",call.=FALSE)
    expected_ranges <- nrow(projection$ranges); expected_points <- nrow(projection$points)
    marker <- DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version FROM table_publication WHERE table_name='mobility_density_distribution'")
    actual_ranges <- if(nrow(marker)) DBI::dbGetQuery(con,"SELECT count(*) n FROM mobility_density_distribution_range")$n[[1L]] else -1L
    actual_points <- if(nrow(marker)) DBI::dbGetQuery(con,"SELECT count(*) n FROM mobility_density_distribution_point")$n[[1L]] else -1L
    descriptor <- DBI::dbGetQuery(con,"SELECT descriptor_version,source_id,vintage_id,axis_count,
      array_to_json(allowed_levels)::text AS allowed_levels_json,density_unit,decile_unit
      FROM mobility_density_distribution_descriptor WHERE singleton")
    no_op <- nrow(marker)==1L && marker$content_version[[1L]]==projection$version &&
        marker$row_count[[1L]]==expected_ranges && marker$reference_content_version[[1L]]==reference$content_version[[1L]] &&
        actual_ranges==expected_ranges && actual_points==expected_points && nrow(descriptor)==1L &&
        descriptor$descriptor_version[[1L]]==projection$version && descriptor$source_id[[1L]]==projection$source_id &&
        descriptor$vintage_id[[1L]]==projection$vintage_id && descriptor$axis_count[[1L]]==projection$axis_count &&
        identical(as.character(jsonlite::fromJSON(descriptor$allowed_levels_json[[1L]])),projection$allowed_levels) &&
        descriptor$density_unit[[1L]]==projection$density_unit && descriptor$decile_unit[[1L]]==projection$decile_unit
    if (!no_op) {
    DBI::dbExecute(con,"DELETE FROM mobility_density_distribution_range")
    quoted_levels <- paste(as.character(DBI::dbQuoteString(con,projection$allowed_levels)),collapse=",")
    DBI::dbExecute(con,paste0("INSERT INTO mobility_density_distribution_descriptor(singleton,descriptor_version,source_id,vintage_id,axis_count,allowed_levels,density_unit,decile_unit)
      VALUES(true,$1,$2,$3,$4,ARRAY[",quoted_levels,"]::text[],$5,$6) ON CONFLICT(singleton) DO UPDATE SET descriptor_version=EXCLUDED.descriptor_version,
      source_id=EXCLUDED.source_id,vintage_id=EXCLUDED.vintage_id,axis_count=EXCLUDED.axis_count,
      allowed_levels=EXCLUDED.allowed_levels,density_unit=EXCLUDED.density_unit,decile_unit=EXCLUDED.decile_unit"),
      params=list(projection$version,projection$source_id,projection$vintage_id,projection$axis_count,
        projection$density_unit,projection$decile_unit))
    ranges <- projection$ranges
    names(ranges)[names(ranges)=="range_min"] <- "minimum"
    names(ranges)[names(ranges)=="range_max"] <- "maximum"
    ranges$source_id <- projection$source_id
    ranges$vintage_id <- projection$vintage_id
    DBI::dbWriteTable(con,"mobility_density_distribution_range",ranges,append=TRUE,row.names=FALSE)
    points <- transform(projection$points,source_id=projection$source_id,vintage_id=projection$vintage_id)
    DBI::dbWriteTable(con,"mobility_density_distribution_point",points,append=TRUE,row.names=FALSE)
    inserted_ranges <- DBI::dbGetQuery(con,"SELECT count(*) n FROM mobility_density_distribution_range")$n[[1L]]
    inserted_points <- DBI::dbGetQuery(con,"SELECT count(*) n FROM mobility_density_distribution_point")$n[[1L]]
    if (inserted_ranges!=expected_ranges || inserted_points!=expected_points)
      stop("Mobility distribution inserted count does not match validated projection",call.=FALSE)
    DBI::dbExecute(con,"INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version,published_at)
      VALUES('mobility_density_distribution',$1,$2,$3,now()) ON CONFLICT(table_name) DO UPDATE SET
      content_version=EXCLUDED.content_version,row_count=EXCLUDED.row_count,
      reference_content_version=EXCLUDED.reference_content_version,published_at=now()",
      params=list(projection$version,expected_ranges,reference$content_version[[1L]]))
    }
    list(changed=!no_op,content_version=projection$version,row_count=expected_ranges)
  })
}

publish_registered_mobility_density_distribution <- function(registry, name, input, con) {
  publisher <- registry[[name]]
  if (is.null(publisher)) stop("Unregistered mobility density distribution publisher",call.=FALSE)
  projection <- publisher$project(input)
  version <- projection$version
  result <- publisher$publish(con,projection,input)
  c(result,list(projection=projection))
}

publish_canonical_mobility_density_distribution <- function(con, canonical_dir="../public/data") {
  required <- c("histoires_mobilite.parquet","vintages.parquet")
  paths <- file.path(canonical_dir,required)
  if (any(!file.exists(paths))) stop("Canonical Mobility history and vintage artifacts are required",call.=FALSE)
  input <- list(histories=nanoparquet::read_parquet(paths[[1L]]),
    vintages=nanoparquet::read_parquet(paths[[2L]]),metadata=lire_theme_metadata("mobilite"))
  registry <- register_mobility_density_distribution_publisher(list())
  publish_registered_mobility_density_distribution(registry,"mobility_density_distribution",input,con)
}
