# Contract validator for registered scalar projections. DBI adapters may
# register a named projection; arbitrary SQL and inferred descriptors are not
# part of this interface.
validate_scalar_projection <- function(facts, descriptors, eligible_territories = NULL) {
  required_facts <- c("indicator_id", "territory_id", "territory_type", "value",
                      "status", "support_count", "denominator_count")
  required_descriptors <- c("indicator_id", "allowed_sources", "label", "unit", "direction",
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
  if (anyNA(descriptors[c("indicator_id", "label", "unit", "direction",
                          "denominator_semantics", "completeness", "descriptor_version")]) ||
      any(!grepl("^[a-z][a-z0-9_]{0,95}$", descriptors$indicator_id)) ||
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
    data.frame(indicator_id=id, allowed_sources=I(list(sources)),
      label=as.character(rows$label[[1L]]), unit=as.character(rows$unit[[1L]]),
      direction=as.character(rows$direction[[1L]]),
      comparison_facet=id, allowed_levels=I(list(unique(as.character(rows$territory_type)))),
      denominator_semantics=scalar_contract$denominator_semantics,
      completeness=scalar_contract$completeness, descriptor_version=scalar_content_version(list(
        indicator_id=id,
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
    assemble_scalar_snapshot(project(canonical), additional_projections)
  }
  db <- scalar_postgres_adapter(con)
  publish_registered_scalar(publisher, "services_essentiels_scalar",
    canonical=list(access=access, eligible_territories=eligible_territories), db=db)
}

# Shared canonical fact-to-serving projection. Fixture-only completeness is
# explicitly passed by the fixture adapter; production uses metadata's
# producer-owned scalar_contract for eligible levels, completeness, facet and
# null status.
project_scalar_canonical_rows <- function(rows, metadata, indicator_ids,
    eligible_territories, fixture_policy=NULL) {
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
        !identical(policy$counts_available, FALSE) || length(policy$comparison_facet) != 1L ||
        (!is.na(policy$comparison_facet) && !nzchar(policy$comparison_facet)))
      stop("Producer scalar contract is invalid for indicator: ", id, call.=FALSE)
    selected <- rows[rows$indicator_id == id & rows$territory_type %in% levels, , drop=FALSE]
    if (!nrow(selected) || length(source_ids) != 1L)
      stop("Canonical indicator facts or single-source provenance are unavailable: ", id, call.=FALSE)
    if (anyNA(selected$unit) || any(unique(as.character(selected$unit)) != as.character(page$unit)))
      stop("Canonical scalar unit disagrees with declared metadata: ", id, call.=FALSE)
    selected <- selected[order(selected$territory_type, selected$territory_id), , drop=FALSE]
    facts_out[[id]] <- data.frame(indicator_id=id, territory_id=as.character(selected$territory_id),
      territory_type=as.character(selected$territory_type), value=as.numeric(selected$value),
      status=ifelse(is.na(selected$value), missing_status, "measured"),
      support_count=NA_integer_, denominator_count=NA_integer_, stringsAsFactors=FALSE)
    descriptors_out[[id]] <- data.frame(indicator_id=id, allowed_sources=I(list(source_ids)),
      label=as.character(page$label), unit=as.character(page$unit), direction=as.character(page$direction),
      comparison_facet=as.character(policy$comparison_facet), allowed_levels=I(list(levels)),
      denominator_semantics=as.character(page$calculation), completeness=completeness,
      descriptor_version=scalar_content_version(list(page=page, scalar_contract=policy)), stringsAsFactors=FALSE)
    provenance_out[[id]] <- unique(data.frame(indicator_id=id, territory_id=as.character(selected$territory_id),
      source_id=source_ids[[1L]], vintage_id=paste(selected$source_version, selected$reference_date, sep="/"),
      stringsAsFactors=FALSE))
    datasets_out[[id]] <- unique(data.frame(source_id=source_ids[[1L]], name=as.character(selected$source_name),
      stringsAsFactors=FALSE))
    vintages_out[[id]] <- unique(data.frame(source_id=source_ids[[1L]],
      vintage_id=paste(selected$source_version, selected$reference_date, sep="/"),
      version=as.character(selected$source_version), reference_date=as.Date(selected$reference_date),
      publication_date=as.Date(selected$publication_date), stringsAsFactors=FALSE))
  }
  projection <- list(facts=do.call(rbind, facts_out), descriptors=do.call(rbind, descriptors_out),
    provenance=do.call(rbind, provenance_out), datasets=unique(do.call(rbind, datasets_out)),
    vintages=unique(do.call(rbind, vintages_out)),
     eligible_territories=eligible_territories[c("territory_id", "territory_type")])
  for (field in names(projection)) rownames(projection[[field]]) <- NULL
  validate_scalar_projection(projection$facts, projection$descriptors, projection$eligible_territories)
  projection
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
      !grepl("^(scalar_it|profile_it|series_it|it_building_publisher)_[A-Za-z0-9_]+$", schema))
    stop("Cleanup requires an owned smoke schema", call. = FALSE)
  qualified <- function(name) paste(as.character(quote_identifier(c(schema, name))), collapse=".")
  tables <- c("series_observation_provenance", "series_dataset_observation", "series_dataset_descriptor",
    "series_dataset_publication", "series_provenance_revision", "ordered_series", "series_descriptor", "profile_observation_source",
    "profile_observation", "profile_descriptor_source", "profile_axis", "profile_descriptor",
    "scalar_observation_source", "scalar_observation", "scalar_descriptor_source",
    "scalar_descriptor", "building_ramp", "building_grid", "building_evidence_descriptor_source",
    "building_evidence_descriptor", "essential_service_access", "service_registry",
    "territory_reference", "source_vintage", "source_dataset", "access_publication_metadata",
    "table_publication")
  functions <- c("reject_profile_insert()", "reject_smoke_value()", "reject_combined_smoke_value()", "reject_smoke_ramp()",
    "reject_series_smoke_insert()",
    "assert_profile_territory_level()", "assert_scalar_observation_has_source()",
    "assert_scalar_descriptor_sources()", "assert_scalar_levels()",
    "assert_scalar_descriptor_update()", "assert_scalar_territory_update()",
    "assert_building_dataset_complete(integer, integer)", "assert_building_fact_source()",
    "assert_building_descriptor_publication()", "assert_current_dataset_complete(integer)",
    "validate_series_dataset_descriptor()", "validate_series_dataset_observation()",
    "validate_series_dataset_publication()", "validate_series_observation_provenance()",
    "validate_series_dataset_write()", "reject_series_provenance_revision_mutation()",
    "validate_ordered_series()")
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

series_smoke_schema_cleanup_sql <- function(quote_identifier, schema) {
  if (length(schema) != 1L || !grepl("^series_it_[A-Za-z0-9_]+$", schema))
    stop("Cleanup requires an owned series smoke schema", call. = FALSE)
  serving_smoke_schema_cleanup_sql(quote_identifier, schema)
}


cleanup_serving_smoke_schema <- function(connection, schema, kind) {
  expected_schema <- switch(kind, scalar="^scalar_it_[A-Za-z0-9_]+$",
    profile="^profile_it_[A-Za-z0-9_]+$",
    building="^it_building_publisher_[A-Za-z0-9_]+$",
    series="^series_it_[A-Za-z0-9_]+$", NULL)
  if (length(kind) != 1L || is.na(kind) || is.null(expected_schema) ||
      length(schema) != 1L || is.na(schema) || !grepl(expected_schema, schema))
    stop("Cleanup requires an owned ", kind, " smoke schema", call. = FALSE)
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
        fields <- c("indicator_id", "label", "unit", "direction",
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
