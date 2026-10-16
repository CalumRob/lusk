# Contract validator for registered scalar projections. DBI adapters may
# register a named projection; arbitrary SQL and inferred descriptors are not
# part of this interface.
validate_scalar_projection <- function(facts, descriptors, eligible_territories = NULL) {
  required_facts <- c("indicator_id", "territory_id", "territory_type", "value",
                      "status", "support_count", "denominator_count")
  required_descriptors <- c("indicator_id", "theme_id", "allowed_sources", "label", "unit", "direction",
                            "comparison_facet", "allowed_levels", "denominator_semantics",
                            "completeness", "descriptor_version")
  if (!is.data.frame(facts) || !all(required_facts %in% names(facts)) ||
      !is.data.frame(descriptors) || !all(required_descriptors %in% names(descriptors)))
    stop("Scalar projection is missing contract fields", call. = FALSE)
  if (!setequal(names(facts), required_facts) ||
      !setequal(names(descriptors), required_descriptors))
    stop("Scalar projection contains undeclared fields", call. = FALSE)
  if (anyNA(facts[c("indicator_id", "territory_id", "territory_type", "status")]) ||
      any(!nzchar(as.character(facts$territory_id))) ||
      any(!grepl("^[a-z][a-z0-9_]{0,95}$", facts$indicator_id)) ||
      any(!facts$territory_type %in% c("commune", "epci", "departement", "region")))
    stop("Invalid or missing scalar identity/key fields", call. = FALSE)
  allowed <- lapply(descriptors$allowed_levels, as.character)
  allowed_sources <- lapply(descriptors$allowed_sources, as.character)
  if (anyNA(descriptors[c("indicator_id", "theme_id", "label", "unit", "direction",
                          "denominator_semantics", "completeness", "descriptor_version")]) ||
      any(!grepl("^[a-z][a-z0-9_]{0,95}$", descriptors$indicator_id)) ||
      any(!grepl("^[a-z][a-z0-9_]{0,63}$", descriptors$theme_id)) ||
      any(!nzchar(trimws(descriptors$label))) ||
      any(!nzchar(descriptors$unit)) || any(!nzchar(descriptors$denominator_semantics)) ||
      any(!nzchar(descriptors$descriptor_version)) ||
      any(!descriptors$direction %in% c("high", "low", "none")) ||
      any(!descriptors$completeness %in% c("dense_complete", "sparse")) ||
      any(vapply(allowed, function(x) !length(x) || anyNA(x) || anyDuplicated(x) ||
        any(!x %in% c("commune", "epci", "departement", "region")), logical(1))) ||
      any(vapply(allowed_sources, function(x) !length(x) || anyNA(x) || anyDuplicated(x) ||
        any(!nzchar(x)), logical(1))) ||
      any(!is.na(descriptors$comparison_facet) & !nzchar(descriptors$comparison_facet)))
    stop("Invalid or missing scalar descriptor fields", call. = FALSE)
  if (anyDuplicated(facts[c("indicator_id", "territory_id")]))
    stop("Duplicate scalar observation key", call. = FALSE)
  if (anyDuplicated(descriptors$indicator_id)) stop("Duplicate scalar descriptor", call. = FALSE)
  if (any(!facts$indicator_id %in% descriptors$indicator_id)) stop("Undeclared scalar indicator", call. = FALSE)
  descriptor <- descriptors[match(facts$indicator_id, descriptors$indicator_id), , drop = FALSE]
  levels_ok <- mapply(function(level, allowed) level %in% allowed,
                      facts$territory_type, descriptor$allowed_levels)
  if (any(!levels_ok)) stop("Scalar territory level is not eligible", call. = FALSE)
  if (any(!facts$status %in% c("measured", "suppressed", "unsupported", "not_available")) ||
      any((facts$status == "measured") != !is.na(facts$value)))
    stop("Scalar null/status mismatch", call. = FALSE)
  if (any(!is.na(facts$value) & !is.finite(facts$value)) ||
      any(!is.na(facts$support_count) & (facts$support_count < 0 | facts$support_count %% 1 != 0)) ||
      any(!is.na(facts$denominator_count) & (facts$denominator_count < 0 | facts$denominator_count %% 1 != 0)))
    stop("Invalid scalar value or support/denominator count", call. = FALSE)
  if (any(!is.na(facts$denominator_count) & !is.na(facts$support_count) &
          facts$denominator_count < facts$support_count))
    stop("Scalar denominator is smaller than support", call. = FALSE)
  dense <- descriptors$indicator_id[descriptors$completeness == "dense_complete"]
  if (length(dense)) {
    if (!is.data.frame(eligible_territories) ||
        !all(c("territory_id", "territory_type") %in% names(eligible_territories)))
      stop("Dense scalar projection requires its eligible territory universe", call. = FALSE)
    for (id in dense) {
      desc <- descriptors[match(id, descriptors$indicator_id), , drop=FALSE]
      eligible <- eligible_territories[eligible_territories$territory_type %in% desc$allowed_levels[[1L]], , drop=FALSE]
      actual <- facts[facts$indicator_id == id, c("territory_id", "territory_type"), drop=FALSE]
      if (!setequal(paste(eligible$territory_id, eligible$territory_type),
                    paste(actual$territory_id, actual$territory_type)))
        stop("Dense scalar observations do not cover eligible territories", call. = FALSE)
    }
  }
  if (!is.null(eligible_territories)) {
    if (!is.data.frame(eligible_territories) ||
        !all(c("territory_id", "territory_type") %in% names(eligible_territories)) ||
        anyNA(eligible_territories[c("territory_id", "territory_type")]) ||
        any(!eligible_territories$territory_type %in% c("commune", "epci", "departement", "region")) ||
        anyDuplicated(eligible_territories[c("territory_id", "territory_type")]))
      stop("Invalid eligible territory universe", call. = FALSE)
    if (any(!paste(facts$territory_id, facts$territory_type) %in%
            paste(eligible_territories$territory_id, eligible_territories$territory_type)))
      stop("Scalar fact references an unknown eligible territory", call. = FALSE)
  }
  invisible(facts)
}

register_scalar_publisher <- function(registry, name, project, publish) {
  if (!is.list(registry) || !is.function(project) || !is.function(publish) ||
      length(name) != 1L || !nzchar(name) || name %in% names(registry))
    stop("Invalid or duplicate scalar publisher registration", call. = FALSE)
  registry[[name]] <- list(project = project, publish = publish)
  registry
}

project_fixture_scalar <- function(payload, descriptor, completeness, indicator_id = "densite") {
  if (length(completeness) != 1L || !completeness %in% c("dense_complete", "sparse"))
    stop("Fixture completeness must be explicitly declared", call. = FALSE)
  ids <- as.character(indicator_id)
  rows <- payload$indicateurs[payload$indicateurs$key %in% ids, , drop=FALSE]
  names(rows)[match(c("territoire", "type", "key", "vintage_source", "vintage_version",
    "vintage_date_reference", "vintage_date_publication"), names(rows))] <-
    c("territory_id", "territory_type", "indicator_id", "source_name", "source_version",
      "reference_date", "publication_date")
  page <- descriptor$indicator_pages[[ids[[1L]]]]
  if (is.null(page)) stop("Fixture indicator is not declared", call.=FALSE)
  eligible <- payload$territoires[payload$territoires$type %in% unlist(page$levels), c("territoire", "type"), drop=FALSE]
  eligible <- stats::setNames(eligible, c("territory_id", "territory_type"))
  source_ids <- as.character(unlist(page$sources, use.names=FALSE))
  if (length(source_ids) != 1L)
    stop("Canonical fixture projection requires exactly one declared source with fixture-backed provenance", call.=FALSE)
  rows$unit <- as.character(page$unit)
  fixture_policy <- list(completeness=completeness, missing_status="not_available",
    allowed_levels=unlist(page$levels, use.names=FALSE), comparison_facet=NA_character_,
    counts_available=FALSE)
  project_scalar_canonical_rows(rows, descriptor, ids, eligible, fixture_policy)
}

# Project the canonical service-share relation into the shared scalar grain.
# The Parquet key remains indicator_id; service/mode are grouping dimensions
# only for the legacy bounded response and never replace the declared identity.
project_service_share_scalars <- function(access, metadata, eligible_territories) {
  required <- c("territory_id", "territory_type", "indicator_id", "value",
    "unit", "label", "direction", "source_id", "source_name", "source_version",
    "reference_date", "publication_date")
  if (!is.data.frame(access) || !all(required %in% names(access)) || !is.list(metadata) ||
      !is.data.frame(eligible_territories) ||
      !setequal(names(eligible_territories), c("territory_id", "territory_type")))
    stop("Canonical service shares are missing contract fields", call.=FALSE)
  if (any(!grepl("^share_[a-z0-9]+_[tbc]$", access$indicator_id)))
    stop("Canonical service share has an invalid indicator key", call.=FALSE)
  declared <- unique(unlist(lapply(metadata$subgroups, `[[`, "indicators"), use.names=FALSE))
  ids <- sort(declared[grepl("^share_", declared)])
  scalar_contract <- metadata$service_share_scalar
  if (length(ids) != 15L || anyDuplicated(ids) ||
      !is.list(metadata$indicator_labels) || !is.list(metadata$indicator_directions) ||
      !is.list(metadata$sources) || !is.list(scalar_contract) ||
      !identical(scalar_contract$completeness, "dense_complete") ||
      !is.character(scalar_contract$denominator_semantics) ||
      length(scalar_contract$denominator_semantics) != 1L ||
      !nzchar(trimws(scalar_contract$denominator_semantics)) ||
      any(!ids %in% names(metadata$indicator_labels)) ||
      any(!ids %in% names(metadata$indicator_directions)) || any(!ids %in% names(metadata$sources)))
    stop("Metadata must declare fifteen complete service-share descriptors", call.=FALSE)
  if (!setequal(unique(as.character(access$indicator_id)), ids) ||
      any(!access$unit %in% "%"))
    stop("Canonical service shares do not match declared metadata or percent unit", call.=FALSE)
  if (length(ids) != 15L || anyDuplicated(access[c("territory_id", "indicator_id")]))
    stop("Canonical service scalar projection must contain fifteen complete indicator keys", call.=FALSE)
  access <- access[order(access$indicator_id, access$territory_id), , drop=FALSE]
  eligible_territories <- unique(eligible_territories[c("territory_id", "territory_type")])
  eligible_territories <- eligible_territories[order(eligible_territories$territory_type,
                                                       eligible_territories$territory_id), , drop=FALSE]
  group <- split(access, access$indicator_id)
  descriptors <- do.call(rbind, lapply(ids, function(id) {
    rows <- group[[id]]
    sources <- as.character(metadata$sources[[id]])
    if (length(sources) != 1L || !nzchar(sources) ||
        !identical(unique(as.character(rows$source_id)), sources) ||
        length(unique(rows$label)) != 1L || rows$label[[1L]] != metadata$indicator_labels[[id]] ||
        length(unique(rows$direction)) != 1L || rows$direction[[1L]] != metadata$indicator_directions[[id]])
      stop("Canonical service scalar descriptor is inconsistent", call.=FALSE)
    theme_id <- as.character(metadata$theme)
    if (length(theme_id) != 1L || is.na(theme_id) || !grepl("^[a-z][a-z0-9_]{0,63}$", theme_id))
      stop("Canonical theme identity is missing for service scalar metadata", call.=FALSE)
    data.frame(indicator_id=id, theme_id=theme_id, allowed_sources=I(list(sources)),
      label=as.character(rows$label[[1L]]), unit=as.character(rows$unit[[1L]]),
      direction=as.character(rows$direction[[1L]]),
      comparison_facet=id, allowed_levels=I(list(unique(as.character(rows$territory_type)))),
      denominator_semantics=scalar_contract$denominator_semantics,
      completeness=scalar_contract$completeness, descriptor_version=scalar_content_version(list(
         indicator_id=id, theme_id=theme_id,
        label=metadata$indicator_labels[[id]], direction=metadata$indicator_directions[[id]],
        source=sources, levels=unique(as.character(rows$territory_type)), unit=unique(as.character(rows$unit)),
        scalar_contract=scalar_contract)),
      stringsAsFactors=FALSE)
  }))
  facts <- data.frame(indicator_id=as.character(access$indicator_id),
    territory_id=as.character(access$territory_id), territory_type=as.character(access$territory_type),
    value=as.numeric(access$value), status=ifelse(is.na(access$value), "not_available", "measured"),
    support_count=NA_integer_, denominator_count=NA_integer_, stringsAsFactors=FALSE)
  provenance <- unique(data.frame(indicator_id=as.character(access$indicator_id),
    territory_id=as.character(access$territory_id), source_id=as.character(access$source_id),
    vintage_id=paste(access$source_version, access$reference_date, sep="/"), stringsAsFactors=FALSE))
  datasets <- unique(data.frame(source_id=as.character(access$source_id),
    name=as.character(access$source_name), stringsAsFactors=FALSE))
  vintages <- unique(data.frame(source_id=as.character(access$source_id),
    vintage_id=paste(access$source_version, access$reference_date, sep="/"),
    version=as.character(access$source_version), reference_date=as.Date(access$reference_date),
    publication_date=as.Date(access$publication_date), stringsAsFactors=FALSE))
  eligible <- unique(eligible_territories[c("territory_id", "territory_type")])
  list(facts=facts, descriptors=descriptors, provenance=provenance,
    datasets=datasets, vintages=vintages, eligible_territories=eligible)
}

register_service_share_scalar_publisher <- function(registry, metadata) {
  register_scalar_publisher(registry, "services_essentiels_scalar",
    project=function(canonical) {
      if (!is.list(canonical) || !is.data.frame(canonical$access))
        stop("Service scalar publisher requires canonical access facts", call.=FALSE)
      if (!is.data.frame(canonical$eligible_territories))
        stop("Service scalar publisher requires the canonical territory universe", call.=FALSE)
      project_service_share_scalars(canonical$access, metadata,
                                    canonical$eligible_territories)
    },
    publish=function(projection, db, version) db$replace(projection, version))
}

publish_service_share_scalars <- function(con, access, metadata, eligible_territories,
                                          additional_projections=list()) {
  publisher <- register_service_share_scalar_publisher(list(), metadata)
  if (!is.list(additional_projections)) stop("Additional scalar cohorts must be registered projections", call.=FALSE)
  project <- publisher$services_essentiels_scalar$project
  publisher$services_essentiels_scalar$project <- function(canonical) {
    attach_essential_service_denominators(
      assemble_scalar_snapshot(project(canonical), additional_projections))
  }
  db <- scalar_postgres_adapter(con)
  publish_registered_scalar(publisher, "services_essentiels_scalar",
    canonical=list(access=access, eligible_territories=eligible_territories), db=db)
}

attach_essential_service_denominators <- function(projection) {
  service_rows <- grepl("^share_", projection$facts$indicator_id)
  if (!any(service_rows)) return(projection)
  building_rows <- projection$facts[projection$facts$indicator_id == "nb_buildings", , drop=FALSE]
  if (!nrow(building_rows) || anyDuplicated(building_rows$territory_id) ||
      any(building_rows$status == "measured" & (is.na(building_rows$value) |
        building_rows$value < 0 | building_rows$value != floor(building_rows$value))))
    stop("Canonical nb_buildings facts have invalid measured denominators", call.=FALSE)
  denominator <- building_rows$value[match(projection$facts$territory_id[service_rows], building_rows$territory_id)]
  unavailable_denominator <- is.na(denominator)
  service_fact_status <- projection$facts$status[service_rows]
  service_fact_value <- projection$facts$value[service_rows]
  if (any(unavailable_denominator & service_fact_status == "measured" & !is.na(service_fact_value)))
    stop("Measured essential-service fact has no canonical nb_buildings denominator", call.=FALSE)
  projection$facts$denominator_count[service_rows] <- as.integer(denominator)
  validate_scalar_projection(projection$facts, projection$descriptors, projection$eligible_territories)
  projection
}

# Shared canonical fact-to-serving projection. Fixture-only completeness is
# explicitly passed by the fixture adapter; production uses metadata's
# producer-owned scalar_contract for eligible levels, completeness, facet and
# null status.
project_scalar_canonical_rows <- function(rows, metadata, indicator_ids,
    eligible_territories, fixture_policy=NULL, source_vintages=NULL) {
  required <- c("territory_id", "territory_type", "indicator_id", "value", "unit",
    "source_name", "source_version", "reference_date", "publication_date")
  if (!is.data.frame(rows) || !all(required %in% names(rows)) ||
      !is.list(metadata$indicator_pages) || !length(indicator_ids) ||
      !is.data.frame(eligible_territories) ||
      !setequal(names(eligible_territories), c("territory_id", "territory_type")))
    stop("Canonical scalar indicator projection is missing contract fields", call.=FALSE)
  facts_out <- descriptors_out <- provenance_out <- datasets_out <- vintages_out <- list()
  for (id in indicator_ids) {
    page <- metadata$indicator_pages[[id]]
    if (is.null(page) || !identical(as.character(page$indicator), id))
      stop("Scalar indicator is not declared by canonical metadata: ", id, call.=FALSE)
    source_ids <- as.character(unlist(page$sources, use.names=FALSE))
    # An explicit fixture policy is intentionally authoritative for fixtures;
    # production projections pass no override and always use producer metadata.
    policy <- if (!is.null(fixture_policy)) fixture_policy else metadata$scalar_contracts[[id]]
    if (!is.list(policy) || !all(c("allowed_levels", "completeness", "comparison_facet", "missing_status", "counts_available") %in% names(policy)))
      stop("Producer scalar contract is missing for indicator: ", id, call.=FALSE)
    levels <- as.character(unlist(policy$allowed_levels, use.names=FALSE))
    completeness <- as.character(policy$completeness)
    missing_status <- as.character(policy$missing_status)
    if (length(completeness) != 1L || !completeness %in% c("sparse", "dense_complete") ||
        length(missing_status) != 1L || !missing_status %in% c("suppressed", "unsupported", "not_available") ||
        length(levels) == 0L || any(!levels %in% c("commune", "epci", "departement", "region")) ||
        !is.logical(policy$counts_available) || length(policy$counts_available) != 1L ||
        (!identical(policy$counts_available, FALSE) &&
          (!is.character(policy$support_count_field) || length(policy$support_count_field) != 1L ||
            !policy$support_count_field %in% names(rows))) || length(policy$comparison_facet) != 1L ||
        (!is.null(policy$zero_support_status) && !policy$zero_support_status %in% c("unsupported", "not_available")) ||
        (!is.null(policy$suppressed_below) && (!is.numeric(policy$suppressed_below) ||
          length(policy$suppressed_below) != 1L || policy$suppressed_below <= 0)) ||
        (!is.na(policy$comparison_facet) && !nzchar(policy$comparison_facet)))
      stop("Producer scalar contract is invalid for indicator: ", id, call.=FALSE)
    selected <- rows[rows$indicator_id == id & rows$territory_type %in% levels, , drop=FALSE]
    if (!nrow(selected) || !length(source_ids))
      stop("Canonical indicator facts or source provenance are unavailable: ", id, call.=FALSE)
    if (anyNA(selected$unit) || any(unique(as.character(selected$unit)) != as.character(page$unit)))
      stop("Canonical scalar unit disagrees with declared metadata: ", id, call.=FALSE)
    selected <- selected[order(selected$territory_type, selected$territory_id), , drop=FALSE]
    support <- if (isTRUE(policy$counts_available)) as.integer(selected[[policy$support_count_field]]) else NA_integer_
    if (isTRUE(policy$counts_available) && (anyNA(support) || any(support < 0L)))
      stop("Canonical scalar support count is invalid for indicator: ", id, call.=FALSE)
    missing <- rep(missing_status, nrow(selected))
    if (isTRUE(policy$counts_available)) {
      if (!is.null(policy$zero_support_status) && length(policy$zero_support_status) == 1L)
        missing[is.na(selected$value) & support == 0L] <- policy$zero_support_status
      if (!is.null(policy$suppressed_below) && length(policy$suppressed_below) == 1L &&
          is.numeric(policy$suppressed_below))
        missing[is.na(selected$value) & support > 0L & support < policy$suppressed_below] <- "suppressed"
    }
    facts_out[[id]] <- data.frame(indicator_id=id, territory_id=as.character(selected$territory_id),
      territory_type=as.character(selected$territory_type), value=as.numeric(selected$value),
      status=ifelse(is.na(selected$value), missing, "measured"),
      support_count=support, denominator_count=support, stringsAsFactors=FALSE)
    theme_id <- as.character(metadata$theme)
    if (length(theme_id) != 1L || is.na(theme_id) || !grepl("^[a-z][a-z0-9_]{0,63}$", theme_id))
      stop("Canonical theme identity is missing for scalar metadata: ", id, call.=FALSE)
    descriptors_out[[id]] <- data.frame(indicator_id=id, theme_id=theme_id, allowed_sources=I(list(source_ids)),
      label=as.character(page$label), unit=as.character(page$unit), direction=as.character(page$direction),
      comparison_facet=as.character(policy$comparison_facet), allowed_levels=I(list(levels)),
      denominator_semantics=as.character(page$calculation), completeness=completeness,
      descriptor_version=scalar_content_version(list(theme=theme_id, page=page, scalar_contract=policy)), stringsAsFactors=FALSE)
    if (length(source_ids) == 1L) {
      provenance_out[[id]] <- unique(data.frame(indicator_id=id, territory_id=as.character(selected$territory_id),
        source_id=source_ids[[1L]], vintage_id=paste(selected$source_version, selected$reference_date, sep="/"),
        stringsAsFactors=FALSE))
      datasets_out[[id]] <- unique(data.frame(source_id=source_ids[[1L]], name=as.character(selected$source_name), stringsAsFactors=FALSE))
      vintages_out[[id]] <- unique(data.frame(source_id=source_ids[[1L]], vintage_id=paste(selected$source_version, selected$reference_date, sep="/"),
        version=as.character(selected$source_version), reference_date=as.Date(selected$reference_date),
        publication_date=as.Date(selected$publication_date), stringsAsFactors=FALSE))
    } else {
      if (!is.data.frame(source_vintages) || !all(c("id", "source", "version", "date_reference", "date_publication") %in% names(source_vintages)))
        stop("Declared multi-source scalar requires canonical source vintages: ", id, call.=FALSE)
      if (anyDuplicated(source_ids))
        stop("Declared multi-source scalar contains duplicate source IDs: ", id, call.=FALSE)
      reference_source <- metadata$sources[[id]]
      if (!is.character(reference_source) || length(reference_source) != 1L ||
          is.na(reference_source) || !nzchar(reference_source) ||
          !reference_source %in% source_ids)
        stop("Scalar reference source is not declared among indicator sources: ", id, call.=FALSE)
      records <- source_vintages[as.character(source_vintages$id) %in% source_ids, , drop=FALSE]
      if (anyDuplicated(as.character(records$id)) || !setequal(as.character(records$id), source_ids))
        stop("Missing or duplicate canonical source vintage for scalar: ", id, call.=FALSE)
      primary <- match(reference_source, as.character(records$id))
      if (any(as.character(selected$source_version) != as.character(records$version[[primary]]) |
          as.character(selected$reference_date) != as.character(records$date_reference[[primary]]) |
          as.character(selected$publication_date) != as.character(records$date_publication[[primary]]) |
          as.character(selected$source_name) != as.character(records$source[[primary]])))
        stop("Canonical scalar freshness stamp disagrees with primary source vintage: ", id, call.=FALSE)
      provenance_out[[id]] <- do.call(rbind, lapply(source_ids, function(source_id)
        data.frame(indicator_id=id, territory_id=as.character(selected$territory_id), source_id=source_id,
          vintage_id=paste(records$version[match(source_id, records$id)], records$date_reference[match(source_id, records$id)], sep="/"), stringsAsFactors=FALSE)))
      datasets_out[[id]] <- data.frame(source_id=source_ids, name=as.character(records$source[match(source_ids, records$id)]), stringsAsFactors=FALSE)
      vintages_out[[id]] <- data.frame(source_id=source_ids,
        vintage_id=paste(records$version[match(source_ids, records$id)], records$date_reference[match(source_ids, records$id)], sep="/"),
        version=as.character(records$version[match(source_ids, records$id)]),
        reference_date=as.Date(records$date_reference[match(source_ids, records$id)]),
        publication_date=as.Date(records$date_publication[match(source_ids, records$id)]), stringsAsFactors=FALSE)
    }
  }
  projection <- list(facts=do.call(rbind, facts_out), descriptors=do.call(rbind, descriptors_out),
    provenance=do.call(rbind, provenance_out), datasets=unique(do.call(rbind, datasets_out)),
    vintages=unique(do.call(rbind, vintages_out)),
     eligible_territories=eligible_territories[c("territory_id", "territory_type")])
  for (field in names(projection)) rownames(projection[[field]]) <- NULL
  validate_scalar_projection(projection$facts, projection$descriptors, projection$eligible_territories)
  projection
}

# A coordinate-free public scalar is still producer-owned: for raccordement it
# must be the exact 90-minute projection of the owned curve and its provenance
# must resolve against the matching metadata/vintage bundle. In particular, a
# current descriptor cannot relabel an older static Parquet snapshot.
validate_raccordement_scalar_bundle <- function(rows, metadata, source_vintages) {
  required <- c("territoire", "type", "key", "detail", "value", "unit", "vintage_source",
    "vintage_version", "vintage_date_reference", "vintage_date_publication")
  abort <- function(...) stop(..., call.=FALSE)
  if (!is.data.frame(rows) || !all(required %in% names(rows)) ||
      !is.list(metadata$sources) || !is.list(metadata$indicator_pages) ||
      !is.data.frame(source_vintages) ||
      !all(c("id", "source", "version", "date_reference", "date_publication") %in% names(source_vintages)))
    abort("Raccordement scalar canonical producer bundle is incomplete")
  source_id <- metadata$sources[["raccordement_tc"]]
  page <- metadata$indicator_pages[["raccordement_tc"]]
  curve_page <- metadata$indicator_pages[["raccordement_courbe"]]
  if (!is.character(source_id) || length(source_id)!=1L || is.na(source_id) || !nzchar(source_id) ||
      is.null(page) || is.null(curve_page) ||
      !source_id %in% as.character(unlist(page$sources, use.names=FALSE)) ||
      !source_id %in% as.character(unlist(curve_page$sources, use.names=FALSE)))
    abort("Raccordement scalar source is not declared by its producer metadata")
  vintage <- source_vintages[as.character(source_vintages$id)==source_id, , drop=FALSE]
  if (nrow(vintage)!=1L)
    abort("Raccordement scalar source vintage is unavailable in its metadata bundle")
  levels <- as.character(unlist(metadata$scalar_contracts$raccordement_tc$allowed_levels, use.names=FALSE))
  if (!length(levels)) levels <- as.character(unlist(page$levels, use.names=FALSE))
  scalar <- rows[rows$key=="raccordement_tc" & is.na(rows$detail) & rows$type %in% levels, , drop=FALSE]
  curve <- rows[rows$key=="raccordement_courbe" & rows$detail=="t0090" & rows$type %in% levels, , drop=FALSE]
  key <- function(x) paste(as.character(x$territoire), as.character(x$type), sep="\r")
  if (!nrow(scalar) || !nrow(curve) || anyDuplicated(key(scalar)) || anyDuplicated(key(curve)) ||
      !setequal(key(scalar), key(curve)))
    abort("Raccordement scalar and t0090 trajectory territories are incomplete or duplicated")
  expected_source <- as.character(vintage$source[[1L]])
  expected_version <- as.character(vintage$version[[1L]])
  expected_reference <- as.character(vintage$date_reference[[1L]])
  expected_publication <- as.character(vintage$date_publication[[1L]])
  source_matches <- function(facts) {
    all(as.character(facts$vintage_source)==expected_source) &&
      all(as.character(facts$vintage_version)==expected_version) &&
      all(as.character(as.Date(facts$vintage_date_reference))==expected_reference) &&
      all(as.character(as.Date(facts$vintage_date_publication))==expected_publication)
  }
  if (!source_matches(scalar) || !source_matches(curve))
    abort("Raccordement scalar provenance disagrees with its producer vintage")
  scalar <- scalar[match(key(curve), key(scalar)), , drop=FALSE]
  same_value <- (is.na(scalar$value) & is.na(curve$value)) |
    (!is.na(scalar$value) & !is.na(curve$value) & as.numeric(scalar$value)==as.numeric(curve$value))
  if (any(as.character(scalar$unit)!=as.character(curve$unit)) ||
      any(!same_value))
    abort("Raccordement scalar does not match its t0090 trajectory fact")
  invisible(TRUE)
}

# Build one canonical table-owned scalar snapshot from the projections of
# registered publishers. It remains neutral: no cohort owns another publisher.
assemble_scalar_snapshot <- function(base_projection, additional_projections=list()) {
  if (!is.list(additional_projections)) stop("Additional scalar cohorts must be a list of registered projections", call.=FALSE)
  flatten <- function(x) {
    if (is.list(x) && all(c("facts", "descriptors", "provenance", "datasets", "vintages",
        "eligible_territories") %in% names(x))) return(list(x))
    if (!is.list(x)) stop("Additional scalar cohorts must be registered projections", call.=FALSE)
    unlist(lapply(x, flatten), recursive=FALSE)
  }
  do.call(combine_scalar_projections, c(list(base_projection), flatten(additional_projections)))
}

combine_scalar_projections <- function(...) {
  projections <- list(...)
  if (!length(projections) || !all(vapply(projections, is.list, logical(1))))
    stop("At least one validated scalar projection is required", call.=FALSE)
  fields <- c("facts", "descriptors", "provenance", "datasets", "vintages", "eligible_territories")
  if (any(!vapply(projections, function(p) all(fields %in% names(p)), logical(1))))
    stop("Scalar cohort projection is incomplete", call.=FALSE)
  bind <- function(field) do.call(rbind, lapply(projections, `[[`, field))
  result <- setNames(lapply(fields, bind), fields)
  # Stable ordering makes content identity independent of registry iteration.
  order_rows <- function(x, keys) x[do.call(order, x[keys]), , drop=FALSE]
  result$facts <- order_rows(result$facts, c("indicator_id", "territory_id"))
  result$descriptors <- order_rows(result$descriptors, "indicator_id")
  result$provenance <- order_rows(unique(result$provenance), c("indicator_id", "territory_id", "source_id", "vintage_id"))
  for (key in list("source_id", c("source_id", "vintage_id"))) {
    frame_name <- if (identical(key, "source_id")) "datasets" else "vintages"
    frame <- result[[frame_name]]
    identity <- do.call(paste, c(frame[key], sep="\r"))
    for (group in split(seq_len(nrow(frame)), identity))
      if (nrow(unique(frame[group, , drop=FALSE])) > 1L)
        stop("Scalar cohorts conflict on source/vintage identity", call.=FALSE)
    result[[frame_name]] <- frame[!duplicated(identity), , drop=FALSE]
  }
  result$datasets <- order_rows(result$datasets, "source_id")
  result$vintages <- order_rows(result$vintages, c("source_id", "vintage_id"))
  result$eligible_territories <- unique(result$eligible_territories[c("territory_id", "territory_type")])
  result$eligible_territories <- order_rows(result$eligible_territories, c("territory_type", "territory_id"))
  for (field in fields) rownames(result[[field]]) <- NULL
  if (anyDuplicated(result$descriptors$indicator_id) || anyDuplicated(result$facts[c("indicator_id", "territory_id")]))
    stop("Scalar cohorts contain conflicting indicator or observation ownership", call.=FALSE)
  validate_scalar_projection(result$facts, result$descriptors, result$eligible_territories)
  result
}

assert_complete_scalar_snapshot <- function(published_indicator_ids, projection) {
  omitted <- setdiff(as.character(published_indicator_ids), as.character(projection$descriptors$indicator_id))
  if (length(omitted)) stop("Refusing partial scalar snapshot; omitted registered indicators: ",
    paste(sort(omitted), collapse=", "), call.=FALSE)
  invisible(TRUE)
}

register_fixture_scalar_publisher <- function(registry, descriptor, completeness) {
  register_scalar_publisher(registry, "canonical_fixture_densite",
    project=function(payload) project_fixture_scalar(payload, descriptor, completeness, "densite"),
    publish=function(projection, db, version) db$replace(projection, version))
}

scalar_content_version <- function(projection) {
  path <- tempfile("scalar-version-")
  on.exit(unlink(path), add = TRUE)
  saveRDS(projection, path, version = 3)
  unname(tools::md5sum(path))
}

validate_scalar_comparison_projection <- function(projection) {
  group_fields <- c("comparison_context", "group_id", "territory_type", "indicator_id",
    "statistic", "median", "member_count", "eligible_count", "missing_count", "lineage_source_count",
    "scalar_content_version", "reference_content_version", "content_version")
  territory_fields <- c("comparison_context", "group_id", "territory_type", "indicator_id",
    "territory_id", "value", "status", "rank", "tie_count", "rank_size",
    "scalar_content_version", "reference_content_version", "content_version")
  if (!is.list(projection) || !all(c("groups", "territories", "lineage", "scalar_content_version",
      "reference_content_version", "content_version") %in% names(projection)) ||
      !is.data.frame(projection$groups) || !is.data.frame(projection$territories) ||
      !setequal(names(projection$groups), group_fields) ||
      !setequal(names(projection$territories), territory_fields) ||
      !is.data.frame(projection$lineage) ||
      !setequal(names(projection$lineage), c("comparison_context", "group_id", "territory_type",
        "facet_id", "source_id", "vintage_id", "comparison_content_version")))
    stop("Scalar comparison projection is missing or contains undeclared fields", call.=FALSE)
  if (anyNA(projection[c("scalar_content_version", "reference_content_version", "content_version")]) ||
      any(!nzchar(unlist(projection[c("scalar_content_version", "reference_content_version", "content_version")]))))
    stop("Scalar comparison publication versions are invalid", call.=FALSE)
  groups <- projection$groups
  territories <- projection$territories
  lineage <- projection$lineage
  if (any(as.character(lineage$comparison_content_version) != projection$content_version))
    stop("Scalar comparison lineage version is stale", call.=FALSE)
  contexts <- c("density_class", "epci", "bretagne", "same_level")
  levels <- c("commune", "epci", "departement")
  if (anyNA(groups[c("comparison_context", "group_id", "territory_type", "indicator_id", "statistic")]) ||
      any(!groups$comparison_context %in% contexts) || any(!groups$territory_type %in% levels) ||
      any(!grepl("^[a-z][a-z0-9_]{0,95}$", groups$indicator_id)) ||
      any(!nzchar(trimws(groups$group_id))) || any(groups$statistic != "median") ||
      anyDuplicated(groups[c("comparison_context", "group_id", "territory_type", "indicator_id")]) ||
      any(!is.na(groups$median) & !is.finite(groups$median)) ||
      any(is.na(groups$member_count) | groups$member_count < 1L) ||
      any(is.na(groups$eligible_count) | groups$eligible_count < 0L) ||
      any(is.na(groups$missing_count) | groups$missing_count < 0L) ||
      any(groups$member_count != groups$eligible_count + groups$missing_count) ||
      any((groups$eligible_count == 0L) != is.na(groups$median)))
    stop("Scalar comparison group statistics are invalid", call.=FALSE)
  if (anyNA(territories[c("comparison_context", "group_id", "territory_type", "indicator_id", "territory_id", "status")]) ||
      any(!territories$comparison_context %in% contexts) || any(!territories$territory_type %in% levels) ||
      any(!grepl("^[a-z][a-z0-9_]{0,95}$", territories$indicator_id)) ||
      any(!nzchar(trimws(territories$group_id)) | !nzchar(trimws(territories$territory_id))) ||
      any(!territories$status %in% c("measured", "suppressed", "unsupported", "not_available", "not_published")) ||
      anyDuplicated(territories[c("comparison_context", "group_id", "territory_type", "indicator_id", "territory_id")]) ||
      any(!is.na(territories$value) & !is.finite(territories$value)) ||
      any((territories$status == "measured") != !is.na(territories$value)))
    stop("Scalar comparison territory results are invalid", call.=FALSE)
  if (nrow(territories)) {
    group_key <- paste(groups$comparison_context, groups$group_id, groups$territory_type,
      groups$indicator_id, sep="\r")
    territory_group_key <- paste(territories$comparison_context, territories$group_id,
      territories$territory_type, territories$indicator_id, sep="\r")
    if (any(!territory_group_key %in% group_key))
      stop("Scalar comparison territory result has no matching group statistic", call.=FALSE)
    expected_size <- groups$eligible_count[match(territory_group_key, group_key)]
    measured <- territories$status == "measured"
    if (any(measured & (is.na(territories$rank) | territories$rank < 1L |
        is.na(territories$tie_count) | territories$tie_count < 1L |
        is.na(territories$rank_size) | territories$rank_size != expected_size |
        territories$rank > territories$rank_size |
        territories$tie_count > territories$rank_size)) ||
        any(!measured & (!is.na(territories$rank) | !is.na(territories$tie_count) |
        !is.na(territories$rank_size))))
      stop("Scalar comparison ranks or tie counts are invalid", call.=FALSE)
  }
  if (anyNA(lineage) || any(!lineage$comparison_context %in% contexts) ||
      any(!lineage$territory_type %in% levels) ||
      any(!grepl("^[a-z][a-z0-9_]{0,95}$", lineage$facet_id)) ||
      any(!nzchar(trimws(lineage$group_id)) | !nzchar(trimws(lineage$source_id)) |
        !nzchar(trimws(lineage$vintage_id))) ||
      anyDuplicated(lineage) || any(!paste(lineage$comparison_context,lineage$group_id,
        lineage$territory_type,lineage$facet_id,sep="\r") %in%
        paste(groups$comparison_context,groups$group_id,groups$territory_type,groups$indicator_id,sep="\r")))
    stop("Scalar comparison source lineage is invalid or has no published group", call.=FALSE)
  lineage_key <- paste(lineage$comparison_context, lineage$group_id,
    lineage$territory_type, lineage$facet_id, sep="\r")
  group_lineage_key <- paste(groups$comparison_context, groups$group_id,
    groups$territory_type, groups$indicator_id, sep="\r")
  actual_lineage_counts <- tabulate(match(lineage_key, group_lineage_key), nbins=nrow(groups))
  if (any(groups$lineage_source_count != actual_lineage_counts))
    stop("Scalar comparison lineage counts do not match their groups", call.=FALSE)
  for (field in c("scalar_content_version", "reference_content_version", "content_version")) {
    if (any(as.character(groups[[field]]) != projection[[field]]) ||
        any(as.character(territories[[field]]) != projection[[field]]))
      stop("Scalar comparison rows disagree with their publication versions", call.=FALSE)
  }
  dependency_columns <- c("scalar_content_version", "reference_content_version", "content_version")
  computed_version <- scalar_content_version(list(
    scalar_content_version=projection$scalar_content_version,
    reference_content_version=projection$reference_content_version,
    groups=groups[setdiff(names(groups), dependency_columns)],
    territories=territories[setdiff(names(territories), dependency_columns)],
    lineage=lineage[setdiff(names(lineage), "comparison_content_version")]))
  if (!identical(computed_version, projection$content_version))
    stop("Scalar comparison content version does not match its rows and dependencies", call.=FALSE)
  invisible(projection)
}

# The one canonical inventory of default comparison memberships shared by
# every published comparison family. Membership is derived only from the
# versioned territory reference; callers filter by their declared levels.
comparison_context_membership <- function(territory_reference, comparison_levels) {
  required_reference <- c("territory_id", "territory_type", "epci_id", "density_class_code")
  if (!is.data.frame(territory_reference) || !all(required_reference %in% names(territory_reference)) ||
      anyNA(territory_reference[c("territory_id", "territory_type")]) ||
      any(!territory_reference$territory_type %in% c("commune", "epci", "departement", "region")) ||
      anyDuplicated(territory_reference[c("territory_id", "territory_type")]))
    stop("Comparison territory reference is invalid", call.=FALSE)
  comparison_levels <- unique(as.character(comparison_levels))
  if (!length(comparison_levels) || anyNA(comparison_levels) ||
      any(!comparison_levels %in% c("commune", "epci", "departement", "region")))
    stop("Comparison levels are invalid", call.=FALSE)
  region_id <- as.character(territory_reference$territory_id[territory_reference$territory_type == "region"])
  if (length(region_id) != 1L || is.na(region_id) || !nzchar(region_id))
    stop("Comparison territory reference must contain exactly one Bretagne region row", call.=FALSE)
  refs <- territory_reference
  refs$territory_id <- as.character(refs$territory_id)
  refs$territory_type <- as.character(refs$territory_type)
  refs$epci_id <- as.character(refs$epci_id)
  refs$density_class_code <- as.character(refs$density_class_code)
  members <- list()
  add_group <- function(context, group_id, territory_type, ids) {
    ids <- sort(unique(as.character(ids)))
    if (!length(ids)) return(invisible(NULL))
    members[[length(members) + 1L]] <<- data.frame(comparison_context=context,
      group_id=as.character(group_id), territory_type=territory_type,
      member_ids=I(list(ids)), stringsAsFactors=FALSE)
    invisible(NULL)
  }
  communes <- refs[refs$territory_type == "commune", , drop=FALSE]
  for (group_id in sort(unique(communes$density_class_code[!is.na(communes$density_class_code) &
      nzchar(communes$density_class_code)])))
    add_group("density_class", group_id, "commune", communes$territory_id[communes$density_class_code == group_id])
  for (group_id in sort(unique(communes$epci_id[!is.na(communes$epci_id) & nzchar(communes$epci_id)])))
    add_group("epci", group_id, "commune", communes$territory_id[communes$epci_id == group_id])
  add_group("bretagne", region_id, "commune", communes$territory_id)
  for (territory_type in intersect(c("epci", "departement"), comparison_levels))
    add_group("same_level", region_id, territory_type,
      refs$territory_id[refs$territory_type == territory_type])
  membership <- do.call(rbind, members)
  rownames(membership) <- NULL
  membership
}

# Produce the two scalar comparison grains from the same canonical snapshot.
# The cohort registry is intentionally closed: a scope is emitted only where
# its membership comes from the published territory reference.
project_scalar_comparisons <- function(scalar_projection, territory_reference,
    input_scalar_content_version, reference_content_version) {
  if (!is.list(scalar_projection) || !all(c("facts", "descriptors", "eligible_territories") %in% names(scalar_projection)))
    stop("Scalar comparison requires a validated scalar fact projection", call.=FALSE)
  validate_scalar_projection(scalar_projection$facts, scalar_projection$descriptors,
    scalar_projection$eligible_territories)
  valid_version <- function(x) is.character(x) && length(x) == 1L && !is.na(x) && nzchar(trimws(x))
  if (!valid_version(input_scalar_content_version) || !valid_version(reference_content_version))
    stop("Scalar comparison input publication version is invalid", call.=FALSE)
  descriptors <- scalar_projection$descriptors
  allowed_levels <- unique(unlist(lapply(descriptors$allowed_levels, as.character), use.names=FALSE))
  reference_universe <- unique(territory_reference[territory_reference$territory_type %in% allowed_levels,
    c("territory_id", "territory_type"), drop=FALSE])
  eligible_universe <- unique(scalar_projection$eligible_territories[
    scalar_projection$eligible_territories$territory_type %in% allowed_levels,
    c("territory_id", "territory_type"), drop=FALSE])
  if (!setequal(paste(reference_universe$territory_type, reference_universe$territory_id),
      paste(eligible_universe$territory_type, eligible_universe$territory_id)))
    stop("Comparison territory reference differs from the canonical scalar universe", call.=FALSE)
  membership <- comparison_context_membership(territory_reference, allowed_levels)

  group_rows <- list()
  territory_rows <- list()
  lineage_rows <- list()
  facts <- scalar_projection$facts
  for (descriptor_index in seq_len(nrow(descriptors))) {
    descriptor <- descriptors[descriptor_index, , drop=FALSE]
    indicator_id <- as.character(descriptor$indicator_id[[1L]])
    direction <- as.character(descriptor$direction[[1L]])
    facet <- as.character(descriptor$comparison_facet[[1L]])
    if (is.na(facet) || !identical(facet, indicator_id) || !direction %in% c("high", "low")) next
    permitted <- as.character(descriptor$allowed_levels[[1L]])
    indicator_facts <- facts[facts$indicator_id == indicator_id, , drop=FALSE]
    for (group_index in seq_len(nrow(membership))) {
      group <- membership[group_index, , drop=FALSE]
      territory_type <- as.character(group$territory_type[[1L]])
      if (!territory_type %in% permitted) next
      ids <- as.character(group$member_ids[[1L]])
      selected <- indicator_facts[indicator_facts$territory_type == territory_type &
        indicator_facts$territory_id %in% ids, , drop=FALSE]
      selected <- selected[match(ids, selected$territory_id), , drop=FALSE]
      source_rows <- scalar_projection$provenance[
        scalar_projection$provenance$indicator_id == indicator_id &
          scalar_projection$provenance$territory_id %in% ids, , drop=FALSE]
      if (nrow(source_rows)) {
        lineage_rows[[length(lineage_rows) + 1L]] <- unique(data.frame(
          comparison_context=as.character(group$comparison_context[[1L]]),
          group_id=as.character(group$group_id[[1L]]), territory_type=territory_type,
          facet_id=indicator_id, source_id=as.character(source_rows$source_id),
          vintage_id=as.character(source_rows$vintage_id), stringsAsFactors=FALSE))
      }
      source_count <- nrow(unique(source_rows[c("source_id", "vintage_id")]))
      status <- as.character(selected$status)
      status[is.na(status)] <- "not_published"
      value <- as.numeric(selected$value)
      measured <- !is.na(value) & status == "measured"
      values <- value[measured]
      ranks <- ties <- rank_sizes <- rep(NA_integer_, length(ids))
      for (i in which(measured)) {
        better <- if (direction == "high") values > value[[i]] else values < value[[i]]
        ranks[[i]] <- 1L + sum(better)
        ties[[i]] <- sum(values == value[[i]])
        rank_sizes[[i]] <- length(values)
      }
      key <- paste(group$comparison_context[[1L]], group$group_id[[1L]], territory_type,
        indicator_id, sep="\r")
      group_rows[[length(group_rows) + 1L]] <- data.frame(
        comparison_context=as.character(group$comparison_context[[1L]]),
        group_id=as.character(group$group_id[[1L]]), territory_type=territory_type,
        indicator_id=indicator_id, statistic="median",
        median=if (length(values)) stats::median(values) else NA_real_,
        member_count=as.integer(length(ids)), eligible_count=as.integer(length(values)),
        missing_count=as.integer(length(ids) - length(values)),
        lineage_source_count=as.integer(source_count), stringsAsFactors=FALSE)
      territory_rows[[length(territory_rows) + 1L]] <- data.frame(
        comparison_context=as.character(group$comparison_context[[1L]]),
        group_id=as.character(group$group_id[[1L]]), territory_type=territory_type,
        indicator_id=indicator_id, territory_id=ids, value=value, status=status,
        rank=ranks, tie_count=ties, rank_size=rank_sizes, stringsAsFactors=FALSE)
    }
  }
  if (!length(group_rows)) stop("No declared comparable scalar contexts were projected", call.=FALSE)
  groups <- do.call(rbind, group_rows)
  territories <- do.call(rbind, territory_rows)
  group_key <- c("comparison_context", "group_id", "territory_type", "indicator_id")
  groups <- groups[!duplicated(groups[group_key]), , drop=FALSE]
  order_rows <- function(x, keys) {
    x <- x[do.call(order, c(x[keys], list(na.last=TRUE, method="radix"))), , drop=FALSE]
    rownames(x) <- NULL
    x
  }
  groups <- order_rows(groups, group_key)
  territories <- order_rows(territories, c(group_key, "territory_id"))
  lineage <- if (length(lineage_rows)) do.call(rbind,lineage_rows) else data.frame(
    comparison_context=character(),group_id=character(),territory_type=character(),
    facet_id=character(),source_id=character(),vintage_id=character(),stringsAsFactors=FALSE)
  lineage <- order_rows(unique(lineage),c("comparison_context","group_id","territory_type","facet_id","source_id","vintage_id"))
  version <- scalar_content_version(list(scalar_content_version=input_scalar_content_version,
    reference_content_version=reference_content_version, groups=groups, territories=territories,
    lineage=lineage))
  add_versions <- function(x) {
    x$scalar_content_version <- input_scalar_content_version
    x$reference_content_version <- reference_content_version
    x$content_version <- version
    x
  }
  result <- list(groups=add_versions(groups), territories=add_versions(territories), lineage=lineage,
    scalar_content_version=input_scalar_content_version,
    reference_content_version=reference_content_version, content_version=version)
  result$lineage$comparison_content_version <- version
  validate_scalar_comparison_projection(result)
  result
}

write_scalar_comparison_parquets <- function(projection, directory) {
  validate_scalar_comparison_projection(projection)
  if (!requireNamespace("nanoparquet", quietly=TRUE))
    stop("nanoparquet is required to write scalar comparison projections", call.=FALSE)
  if (length(directory) != 1L || is.na(directory) || !nzchar(directory))
    stop("Scalar comparison Parquet directory is invalid", call.=FALSE)
  dir.create(directory, recursive=TRUE, showWarnings=FALSE)
  targets <- file.path(directory, c("scalar_comparison_groups.parquet",
    "scalar_comparison_territories.parquet", "scalar_comparison_lineage.parquet"))
  staged <- vapply(targets, function(path) tempfile(pattern="scalar-comparison-",
    tmpdir=dirname(path), fileext=".parquet"), character(1))
  backups <- vapply(targets, function(path) tempfile(pattern="scalar-comparison-backup-",
    tmpdir=dirname(path), fileext=".parquet"), character(1))
  backed_up <- rep(FALSE, length(targets))
  installed <- rep(FALSE, length(targets))
  completed <- FALSE
  on.exit({
    unlink(staged[file.exists(staged)])
    if (!completed) {
      for (i in seq_along(targets)) {
        if (installed[[i]] && file.exists(targets[[i]])) unlink(targets[[i]])
        if (backed_up[[i]] && file.exists(backups[[i]])) {
          if (file.exists(targets[[i]])) unlink(targets[[i]])
          file.rename(backups[[i]], targets[[i]])
        }
      }
    } else {
      unlink(backups[file.exists(backups)])
    }
  }, add=TRUE)
  nanoparquet::write_parquet(projection$groups, staged[[1L]])
  nanoparquet::write_parquet(projection$territories, staged[[2L]])
  nanoparquet::write_parquet(projection$lineage, staged[[3L]])
  for (i in seq_along(targets)) {
    if (file.exists(targets[[i]])) {
      if (!file.rename(targets[[i]], backups[[i]]))
        stop("Could not stage the previous scalar comparison Parquet", call.=FALSE)
      backed_up[[i]] <- TRUE
    }
  }
  for (i in seq_along(targets)) {
    if (!file.rename(staged[[i]], targets[[i]]))
      stop("Could not install the complete scalar comparison Parquet set", call.=FALSE)
    installed[[i]] <- TRUE
  }
  completed <- TRUE
  invisible(targets)
}

publish_registered_scalar_comparison <- function(projection, db) {
  validate_scalar_comparison_projection(projection)
  if (!is.list(db) || !is.function(db$transaction) || !is.function(db$input_markers) ||
      !is.function(db$marker) || !is.function(db$replace))
    stop("Invalid scalar comparison database adapter", call.=FALSE)
  db$transaction({
    if (is.function(db$lock)) db$lock()
    inputs <- db$input_markers()
    if (!is.data.frame(inputs) || nrow(inputs) != 1L ||
        !identical(as.character(inputs$scalar_content_version[[1L]]), projection$scalar_content_version) ||
        !identical(as.character(inputs$reference_content_version[[1L]]), projection$reference_content_version))
      stop("Scalar comparison input publications are stale or unavailable", call.=FALSE)
    marker <- db$marker()
    changed <- !(is.data.frame(marker) && nrow(marker) == 1L &&
      identical(as.character(marker$content_version[[1L]]), projection$content_version) &&
      identical(as.character(marker$scalar_content_version[[1L]]), projection$scalar_content_version) &&
      identical(as.character(marker$reference_content_version[[1L]]), projection$reference_content_version) &&
      isTRUE(marker$lineage_row_count[[1L]] == nrow(projection$lineage)))
    if (changed) db$replace(projection)
    invisible(list(changed=changed, content_version=projection$content_version,
      scalar_content_version=projection$scalar_content_version,
      reference_content_version=projection$reference_content_version,
      group_row_count=nrow(projection$groups), territory_row_count=nrow(projection$territories)))
  })
}

scalar_comparison_postgres_adapter <- function(con) {
  if (!requireNamespace("DBI", quietly=TRUE)) stop("DBI is required")
  list(
    transaction=function(expr) DBI::dbWithTransaction(con, expr),
    lock=function() DBI::dbGetQuery(con, "SELECT pg_advisory_xact_lock(594, 1)"),
    input_markers=function() DBI::dbGetQuery(con, paste(
      "SELECT scalar.content_version AS scalar_content_version,",
      "reference.content_version AS reference_content_version",
      "FROM table_publication scalar CROSS JOIN table_publication reference",
      "WHERE scalar.table_name='scalar_observation'",
      "AND reference.table_name='territory_reference'",
      "FOR SHARE OF scalar, reference")),
    marker=function() DBI::dbGetQuery(con, "SELECT content_version, scalar_content_version,lineage_row_count,
      reference_content_version FROM scalar_comparison_publication WHERE singleton"),
    replace=function(projection) {
      DBI::dbExecute(con, "DELETE FROM comparison_source_lineage WHERE comparison_family='scalar'")
      DBI::dbExecute(con, "DELETE FROM scalar_comparison_territory")
      DBI::dbExecute(con, "DELETE FROM scalar_comparison_group")
      group_fields <- c("comparison_context", "group_id", "territory_type", "indicator_id",
        "statistic", "median", "member_count", "eligible_count", "missing_count", "lineage_source_count")
      territory_fields <- c("comparison_context", "group_id", "territory_type", "indicator_id",
        "territory_id", "value", "status", "rank", "tie_count", "rank_size")
      DBI::dbWriteTable(con, "scalar_comparison_group",
        projection$groups[group_fields], append=TRUE, row.names=FALSE)
      DBI::dbWriteTable(con, "scalar_comparison_territory",
        projection$territories[territory_fields], append=TRUE, row.names=FALSE)
      lineage <- projection$lineage
      lineage$comparison_family <- "scalar"
      lineage$comparison_content_version <- projection$content_version
      DBI::dbWriteTable(con, "comparison_source_lineage",
        lineage[c("comparison_family","comparison_context","group_id","territory_type",
          "facet_id","source_id","vintage_id","comparison_content_version")], append=TRUE, row.names=FALSE)
      DBI::dbExecute(con, paste(
        "INSERT INTO scalar_comparison_publication(singleton, content_version, scalar_content_version,",
        "reference_content_version, group_row_count, territory_row_count, lineage_row_count, published_at)",
        "VALUES (true, $1, $2, $3, $4, $5, $6, now())",
        "ON CONFLICT(singleton) DO UPDATE SET content_version=EXCLUDED.content_version,",
        "scalar_content_version=EXCLUDED.scalar_content_version,",
        "reference_content_version=EXCLUDED.reference_content_version,",
        "group_row_count=EXCLUDED.group_row_count,",
        "territory_row_count=EXCLUDED.territory_row_count, lineage_row_count=EXCLUDED.lineage_row_count, published_at=EXCLUDED.published_at"),
        params=list(projection$content_version, projection$scalar_content_version,
        projection$reference_content_version, nrow(projection$groups), nrow(projection$territories), nrow(projection$lineage)))
      invisible(TRUE)
    }
  )
}

# Split the repository's PostgreSQL DDL script without altering quoted SQL.
# Supports standard doubled quote escapes, line comments and dollar-quoted
# function bodies used by api/schema.sql.
split_postgres_sql <- function(sql) {
  stopifnot(is.character(sql), length(sql) == 1L)
  chars <- strsplit(sql, "", fixed=TRUE)[[1L]]
  statements <- character(); buffer <- character()
  single <- double <- line_comment <- FALSE; dollar <- NULL; i <- 1L
  while (i <= length(chars)) {
    ch <- chars[[i]]; next_ch <- if (i < length(chars)) chars[[i+1L]] else ""
    if (line_comment) {
      if (ch == "\n") { line_comment <- FALSE; buffer <- c(buffer, ch) }
    } else if (!single && !double && is.null(dollar) && ch == "-" && next_ch == "-") {
      line_comment <- TRUE; buffer <- c(buffer, " "); i <- i + 1L
    } else if (!double && is.null(dollar) && ch == "'") {
      buffer <- c(buffer, ch)
      if (single && next_ch == "'") { buffer <- c(buffer, next_ch); i <- i + 1L }
      else single <- !single
    } else if (!single && is.null(dollar) && ch == '"') {
      buffer <- c(buffer, ch)
      if (double && next_ch == '"') { buffer <- c(buffer, next_ch); i <- i + 1L }
      else double <- !double
    } else if (!single && !double && ch == "$") {
      rest <- paste0(chars[i:length(chars)], collapse="")
      tag <- regmatches(rest, regexpr("^\\$[A-Za-z_0-9]*\\$", rest))
      if (length(tag) && nzchar(tag)) {
        if (is.null(dollar)) dollar <- tag
        else if (identical(dollar, tag)) dollar <- NULL
        buffer <- c(buffer, strsplit(tag, "", fixed=TRUE)[[1L]])
        i <- i + nchar(tag) - 1L
      } else buffer <- c(buffer, ch)
    } else if (!single && !double && is.null(dollar) && ch == ";") {
      statement <- trimws(paste(buffer, collapse=""))
      if (nzchar(statement)) statements <- c(statements, statement)
      buffer <- character()
    } else buffer <- c(buffer, ch)
    i <- i + 1L
  }
  tail <- trimws(paste(buffer, collapse=""))
  if (nzchar(tail)) statements <- c(statements, tail)
  statements
}

# Exact inventory created by api/schema.sql and the profile smoke's injected
# trigger. Drop dependents before referenced tables, then functions, then the
# owned schema using RESTRICT. Every object is schema-qualified.
serving_smoke_schema_cleanup_sql <- function(quote_identifier, schema) {
  if (!is.function(quote_identifier) || length(schema) != 1L ||
      !grepl("^(scalar_it|profile_it|series_it|reading_it|distribution_it|distribution_canonical|it_building_publisher)_[A-Za-z0-9_]+$", schema))
    stop("Cleanup requires an owned smoke schema", call. = FALSE)
  qualified <- function(name) paste(as.character(quote_identifier(c(schema, name))), collapse=".")
  tables <- c("comparison_source_lineage", "aedar_comparison_territory", "aedar_comparison_group",
    "aedar_comparison_publication",
    "observed_collection_comparison_territory", "observed_collection_comparison_group", "observed_collection_comparison_publication",
    "observed_collection_comparison_lineage", "profile_comparison_territory", "profile_comparison_group", "profile_comparison_publication",
    "scalar_comparison_territory", "scalar_comparison_group", "scalar_comparison_publication",
    "ordered_series_comparison_territory", "ordered_series_comparison_group", "ordered_series_comparison_publication",
    "milieux_reading_absence", "aedar_territorial_aggregate",
    "milieux_reading_source", "series_observation_provenance", "series_dataset_observation", "series_named_reference_provenance", "series_named_reference",
    "economy_activity_evidence", "economy_typed_reading", "milieux_typed_reading", "mobility_typed_reading",
    "series_context_parent_policy", "habitat_typed_reading", "mobility_reading_clock", "mobility_reading_story", "mobility_reading_descriptor",
    "selected_reading_publication", "selected_reading_descriptor", "demographic_typed_reading", "demographic_reading_descriptor",
    "period_detail_observation", "anchored_membership", "observed_collection_category",
    "observed_collection_descriptor", "observed_collection_publication",
    "mobility_density_distribution_point", "mobility_density_distribution_range", "mobility_density_distribution_descriptor",
    "series_named_reference_descriptor", "series_dataset_descriptor",
    "series_dataset_publication", "series_provenance_revision", "milieux_population_provenance_revision", "ordered_series", "series_descriptor", "profile_observation_source",
    "profile_observation", "profile_descriptor_source", "profile_axis", "profile_descriptor",
    "bpe_profile_evidence_source", "bpe_profile_evidence", "bpe_profile_class_axis", "bpe_profile_evidence_descriptor",
    "scalar_observation_source", "scalar_observation", "scalar_descriptor_source",
    "scalar_descriptor", "building_ramp", "building_grid", "building_evidence_descriptor_source",
    "building_evidence_descriptor", "essential_service_access", "service_registry",
    "territory_reference", "source_vintage", "source_dataset", "access_publication_metadata",
    "table_publication")
  functions <- c("check_aedar_comparison_publication()", "reject_profile_insert()", "reject_smoke_value()", "reject_combined_smoke_value()", "reject_smoke_ramp()",
    "reject_series_smoke_insert()",
    "assert_profile_territory_level()", "assert_scalar_observation_has_source()",
    "assert_scalar_descriptor_sources()", "assert_scalar_levels()",
    "assert_scalar_descriptor_update()", "assert_scalar_territory_update()",
    "assert_building_dataset_complete(integer, integer)", "assert_building_fact_source()",
    "assert_building_descriptor_publication()", "assert_current_dataset_complete(integer)",
    "validate_series_dataset_descriptor()", "validate_series_dataset_observation()",
     "validate_series_dataset_publication()", "validate_series_observation_provenance()",
     "assert_bpe_profile_evidence_complete()",
     "validate_series_named_reference()", "validate_series_named_reference_provenance()",
       "validate_observed_collection_comparison_write()", "validate_observed_collection_comparison_publication()", "validate_observed_collection_comparison_lineage()",
      "validate_observed_collection_write()", "validate_anchored_membership()",
     "validate_period_detail_observation()", "validate_observed_collection_publication()",
      "validate_series_dataset_write()", "reject_series_provenance_revision_mutation()",
     "reject_milieux_population_provenance_mutation()",
    "validate_ordered_series()", "validate_anchored_membership()",
     "validate_period_detail_observation()", "validate_observed_collection_write()",
      "validate_observed_collection_publication()", "assert_bpe_profile_evidence_complete()",
      "assert_mobility_density_distribution_complete()", "validate_mobility_density_distribution_territory()")
  c(paste("DROP TABLE IF EXISTS", vapply(tables, qualified, character(1)), "RESTRICT"),
    paste("DROP FUNCTION IF EXISTS", vapply(functions, function(signature) {
      split <- strsplit(signature, "(", fixed=TRUE)[[1L]]
      paste0(qualified(split[[1L]]), "(", split[[2L]])
    }, character(1)), "RESTRICT"),
    paste("DROP SCHEMA IF EXISTS", as.character(quote_identifier(schema)), "RESTRICT"))
}

# Cleanup is destructive even in a disposable database: check both database
# identity and ownership immediately before issuing any DROP statement.

scalar_smoke_schema_cleanup_sql <- function(quote_identifier, schema) {
  if (length(schema) != 1L || !grepl("^scalar_it_[A-Za-z0-9_]+$", schema))
    stop("Cleanup requires an owned smoke schema", call. = FALSE)
  serving_smoke_schema_cleanup_sql(quote_identifier, schema)
}

profile_smoke_schema_cleanup_sql <- function(quote_identifier, schema) {
  if (length(schema) != 1L || !grepl("^profile_it_[A-Za-z0-9_]+$", schema))
    stop("Cleanup requires an owned profile smoke schema", call. = FALSE)
  serving_smoke_schema_cleanup_sql(quote_identifier, schema)
}

reading_smoke_schema_cleanup_sql <- function(quote_identifier, schema) {
  if (length(schema) != 1L || !grepl("^reading_it_[A-Za-z0-9_]+$", schema))
    stop("Cleanup requires an owned reading smoke schema", call. = FALSE)
  serving_smoke_schema_cleanup_sql(quote_identifier, schema)
}

series_smoke_schema_cleanup_sql <- function(quote_identifier, schema) {
  if (length(schema) != 1L || !grepl("^series_it_[A-Za-z0-9_]+$", schema))
    stop("Cleanup requires an owned series smoke schema", call. = FALSE)
  serving_smoke_schema_cleanup_sql(quote_identifier, schema)
}


cleanup_serving_smoke_schema <- function(connection, schema, kind) {
  expected_schema <- switch(kind, scalar="^scalar_it_[A-Za-z0-9_]+$",
    profile="^profile_it_[A-Za-z0-9_]+$",
    reading="^reading_it_[A-Za-z0-9_]+$",
    distribution="^distribution_it_[A-Za-z0-9_]+$",
    distribution_canonical="^distribution_canonical_[A-Za-z0-9_]+$",
    building="^it_building_publisher_[A-Za-z0-9_]+$",
    series="^series_it_[A-Za-z0-9_]+$", NULL)
  if (length(kind) != 1L || is.na(kind) || is.null(expected_schema) ||
      length(schema) != 1L || is.na(schema) || !grepl(expected_schema, schema))
    stop("Cleanup requires an owned ", kind, " smoke schema; received ", schema, call. = FALSE)
  identity <- DBI::dbGetQuery(connection, "SELECT current_database() AS database,
    EXISTS (SELECT 1 FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner
      WHERE n.nspname=$1 AND r.rolname=current_user) AS owned", params=list(schema))
  if (!grepl("^lusk_it_[A-Za-z0-9_]+$", identity$database[[1L]]) ||
      identity$database[[1L]] %in% c("lusk", "postgres", "template0", "template1") ||
      !isTRUE(identity$owned[[1L]]))
    stop("Refusing cleanup: database is not guarded lusk_it_* or schema is not owned by current user", call. = FALSE)
  statements <- serving_smoke_schema_cleanup_sql(function(parts)
    DBI::dbQuoteIdentifier(connection, parts), schema)
  for (statement in statements) DBI::dbExecute(connection, statement)
  invisible(TRUE)
}

# db is a narrow transaction adapter (transaction, marker, replace). Keeping
# it injectable makes retry/rollback behavior testable without a live service.
publish_registered_scalar <- function(registry, name, canonical, db) {
  publisher <- registry[[name]]
  if (is.null(publisher)) stop("Unregistered scalar publisher", call. = FALSE)
  if (!is.function(db$transaction) || !is.function(db$marker) || !is.function(db$replace) ||
      !is.function(db$reference_marker) || !is.function(db$validate_territories) ||
      !is.function(db$set_reference_version))
    stop("Invalid scalar database adapter", call. = FALSE)
  projection <- publisher$project(canonical)
  if (!is.list(projection) || !all(c("facts", "descriptors", "provenance", "datasets", "vintages", "eligible_territories") %in% names(projection)))
    stop("Scalar projection must contain facts, descriptors, provenance, datasets, vintages, and eligible territories", call. = FALSE)
  validate_scalar_projection(projection$facts, projection$descriptors, projection$eligible_territories)
  provenance <- projection$provenance
  provenance_columns <- c("indicator_id", "territory_id", "source_id", "vintage_id")
  if (!is.data.frame(provenance) || !setequal(names(provenance), provenance_columns) ||
      anyNA(provenance[provenance_columns]) ||
      any(!nzchar(provenance$indicator_id) | !nzchar(provenance$territory_id) |
          !nzchar(provenance$source_id) | !nzchar(provenance$vintage_id)) ||
      anyDuplicated(provenance[provenance_columns]) ||
      any(!paste(projection$facts$indicator_id, projection$facts$territory_id) %in%
          paste(provenance$indicator_id, provenance$territory_id)))
    stop("Invalid or incomplete scalar provenance associations", call. = FALSE)
  provenance_descriptors <- projection$descriptors[match(provenance$indicator_id,
                                                projection$descriptors$indicator_id), , drop=FALSE]
  if (any(!mapply(function(source, allowed) source %in% allowed,
                  provenance$source_id, provenance_descriptors$allowed_sources)))
    stop("Observation source is not permitted by its descriptor", call. = FALSE)
  datasets <- projection$datasets
  vintages <- projection$vintages
  if (!is.data.frame(datasets) || !setequal(names(datasets), c("source_id", "name")) ||
      anyNA(datasets[c("source_id", "name")]) || any(!nzchar(datasets$source_id)) ||
      any(!nzchar(trimws(datasets$name))) ||
      anyDuplicated(datasets$source_id) ||
      !is.data.frame(vintages) ||
      !setequal(names(vintages), c("source_id", "vintage_id", "version", "reference_date", "publication_date")) ||
      anyNA(vintages[c("source_id", "vintage_id", "version")]) ||
      any(!nzchar(vintages$source_id) | !nzchar(vintages$vintage_id) | !nzchar(vintages$version)) ||
      anyDuplicated(vintages[c("source_id", "vintage_id")]) ||
      any(!provenance$source_id %in% datasets$source_id) ||
      any(!paste(provenance$source_id, provenance$vintage_id) %in%
          paste(vintages$source_id, vintages$vintage_id)))
    stop("Scalar provenance refers to an undeclared dataset or vintage", call. = FALSE)
  version <- scalar_content_version(projection)
  db$transaction({
    if (is.function(db$lock)) db$lock()
    reference <- db$reference_marker()
    if (!nrow(reference) || is.na(reference$content_version[[1L]]) ||
        !nzchar(reference$content_version[[1L]]) ||
        (all(c("row_count", "actual_rows") %in% names(reference)) &&
         reference$row_count[[1L]] != reference$actual_rows[[1L]]))
      stop("Territory reference has no committed publication marker", call. = FALSE)
    db$validate_territories(projection$eligible_territories, projection$descriptors)
    marker <- db$marker("scalar_observation")
    changed <- !(nrow(marker) && identical(as.character(marker$content_version[[1L]]), version))
    reference_changed <- nrow(marker) && !identical(
      as.character(marker$reference_content_version[[1L]]),
      as.character(reference$content_version[[1L]]))
    if (changed) publisher$publish(projection, db, version)
    else if (reference_changed) db$set_reference_version(reference$content_version[[1L]])
    invisible(list(changed = changed, compatibility_updated = reference_changed,
                   content_version = version))
  })
}

scalar_postgres_adapter <- function(con) {
  if (!requireNamespace("DBI", quietly = TRUE)) stop("DBI is required")
  list(
    transaction = function(expr) DBI::dbWithTransaction(con, expr),
    lock = function() DBI::dbGetQuery(con, "SELECT pg_advisory_xact_lock(594, 1)"),
    marker = function(name) DBI::dbGetQuery(con,
      "SELECT content_version, reference_content_version FROM table_publication WHERE table_name = $1", params = list(name)),
    reference_marker = function() DBI::dbGetQuery(con,
      "SELECT p.content_version, p.row_count, (SELECT count(*) FROM territory_reference) AS actual_rows FROM table_publication p WHERE p.table_name='territory_reference'"),
    validate_territories = function(territories, descriptors) {
      expected <- unique(territories[c("territory_id", "territory_type")])
      actual <- DBI::dbGetQuery(con, "SELECT territory_id, territory_type FROM territory_reference")
      levels <- unique(unlist(descriptors$allowed_levels, use.names=FALSE))
      actual <- actual[actual$territory_type %in% levels, , drop=FALSE]
      if (!setequal(paste(expected$territory_id, expected$territory_type),
                    paste(actual$territory_id, actual$territory_type)))
        stop("Scalar eligible territory universe differs from the committed reference", call. = FALSE)
    },
    set_reference_version = function(version) DBI::dbExecute(con,
      "UPDATE table_publication SET reference_content_version=$1 WHERE table_name='scalar_observation'",
      params = list(version)),
    replace = function(projection, version) {
      facts <- projection$facts
      descriptors <- projection$descriptors
      provenance <- projection$provenance
      quote_value <- function(x) {
        if (length(x) == 1L && is.na(x)) return("NULL")
        as.character(DBI::dbQuoteString(con, as.character(x)))
      }
      for (row in seq_len(nrow(projection$datasets))) {
        d <- projection$datasets[row, , drop = FALSE]
        DBI::dbExecute(con, "INSERT INTO source_dataset(source_id,name) VALUES($1,$2) ON CONFLICT(source_id) DO UPDATE SET name=EXCLUDED.name",
                       params = unname(as.list(d[c("source_id", "name")])))
      }
      for (row in seq_len(nrow(projection$vintages))) {
        v <- projection$vintages[row, , drop = FALSE]
        DBI::dbExecute(con, "INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date) VALUES($1,$2,$3,$4,$5) ON CONFLICT(source_id,vintage_id) DO UPDATE SET version=EXCLUDED.version,reference_date=EXCLUDED.reference_date,publication_date=EXCLUDED.publication_date",
                       params = unname(as.list(v[c("source_id", "vintage_id", "version", "reference_date", "publication_date")])))
      }
      # The scalar table is one table-owned snapshot. Refuse an incomplete
      # replacement before deleting anything if it would drop a live cohort.
      present <- DBI::dbGetQuery(con, "SELECT DISTINCT indicator_id FROM scalar_descriptor")$indicator_id
      assert_complete_scalar_snapshot(present, projection)
      DBI::dbExecute(con, "DELETE FROM scalar_observation")
      DBI::dbExecute(con, "DELETE FROM scalar_descriptor_source")
      DBI::dbExecute(con, "DELETE FROM scalar_descriptor")
      for (i in seq_len(nrow(descriptors))) {
        d <- descriptors[i, , drop = FALSE]
        levels <- as.character(d$allowed_levels[[1L]])
        array_sql <- paste0("ARRAY[", paste(vapply(levels, quote_value, character(1)), collapse=","), "]::text[]")
        fields <- c("indicator_id", "theme_id", "label", "unit", "direction",
                    "comparison_facet", "denominator_semantics", "completeness", "descriptor_version")
        values <- vapply(fields, function(field) quote_value(d[[field]][[1L]]), character(1))
        sql <- paste0("INSERT INTO scalar_descriptor(", paste(fields, collapse=","), ",allowed_levels) VALUES (",
          paste(c(values, array_sql), collapse=","), ")")
        DBI::dbExecute(con, sql)
        allowed_sources <- as.character(d$allowed_sources[[1L]])
        for (source_id in allowed_sources) {
          DBI::dbExecute(con,
            "INSERT INTO scalar_descriptor_source(indicator_id,source_id) VALUES($1,$2)",
            params=list(d$indicator_id[[1L]], source_id))
        }
      }
      DBI::dbWriteTable(con, "scalar_observation", facts, append = TRUE, row.names = FALSE)
      DBI::dbWriteTable(con, "scalar_observation_source", provenance, append = TRUE, row.names = FALSE)
      reference <- DBI::dbGetQuery(con, "SELECT content_version FROM table_publication WHERE table_name='territory_reference'")
      if (!nrow(reference)) stop("Territory reference publication is unavailable", call. = FALSE)
      DBI::dbExecute(con, "INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version,published_at) VALUES ('scalar_observation',$1,$2,$3,now()) ON CONFLICT(table_name) DO UPDATE SET content_version=EXCLUDED.content_version,row_count=EXCLUDED.row_count,reference_content_version=EXCLUDED.reference_content_version,published_at=EXCLUDED.published_at",
                     params = list(version, nrow(facts), reference$content_version[[1L]]))
    }
  )
}
