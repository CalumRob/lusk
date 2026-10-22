# Offline, owner-scoped scalar serving artifact. Each generation is immutable;
# the small pointer is replaced only after every typed grain has been written
# and read back through the public reader.
scalar_artifact_grains <- c("facts", "descriptors", "provenance", "datasets",
                            "vintages", "eligible_territories")

scalar_artifact_files <- c(facts="facts.parquet", descriptors="descriptors.json",
  provenance="provenance.parquet", datasets="datasets.parquet",
  vintages="vintages.parquet", eligible_territories="eligible_territories.parquet")

scalar_artifact_digest <- function(paths) {
  hashes <- unname(tools::md5sum(paths))
  identity <- tempfile("scalar-artifact-digest-")
  on.exit(unlink(identity), add=TRUE)
  writeLines(paste(names(paths), hashes, sep="="), identity, useBytes=TRUE)
  unname(tools::md5sum(identity))
}

validate_scalar_artifact_projection <- function(projection) {
  validate_scalar_projection(projection$facts, projection$descriptors,
                             projection$eligible_territories)
  required <- c("indicator_id", "territory_id", "source_id", "vintage_id")
  if (!all(required %in% names(projection$provenance)) ||
      !all(c("source_id", "name") %in% names(projection$datasets)) ||
      !all(c("source_id", "vintage_id") %in% names(projection$vintages)) ||
      anyDuplicated(projection$provenance[required]) ||
      any(!paste(projection$facts$indicator_id, projection$facts$territory_id) %in%
          paste(projection$provenance$indicator_id, projection$provenance$territory_id)) ||
      any(!projection$provenance$indicator_id %in% projection$descriptors$indicator_id) ||
      any(!projection$provenance$source_id %in% projection$datasets$source_id) ||
      any(!paste(projection$provenance$source_id, projection$provenance$vintage_id) %in%
          paste(projection$vintages$source_id, projection$vintages$vintage_id)))
    stop("Scalar artifact provenance is incomplete or out of bounds", call.=FALSE)
  invisible(projection)
}

decode_scalar_descriptors <- function(rows, list_columns) {
  list_columns <- as.character(unlist(list_columns, use.names=FALSE))
  declared <- names(rows[[1L]])
  if (anyDuplicated(list_columns) ||
      (length(list_columns) && !all(list_columns %in% declared)))
    stop("Canonical scalar descriptor list columns disagree with the recorded schema", call.=FALSE)
  columns <- setdiff(declared, list_columns)
  frame <- as.data.frame(stats::setNames(lapply(columns, function(column)
    vapply(rows, function(row) {
      value <- row[[column]]
      if (is.list(value))
        stop("Canonical scalar descriptor column carries an unrecorded list value: ", column, call.=FALSE)
      if (is.null(value)) NA_character_ else as.character(unlist(value, use.names=FALSE)[[1L]])
    }, character(1))), columns),
    stringsAsFactors=FALSE)
  for (column in list_columns)
    frame[[column]] <- I(lapply(rows, function(row) as.character(unlist(row[[column]], use.names=FALSE))))
  frame[declared]
}

scalar_artifact_read_generation <- function(generation, expected_version=NULL) {
  manifest_path <- file.path(generation, "manifest.json")
  if (!file.exists(manifest_path)) stop("Canonical scalar artifact generation is incomplete", call.=FALSE)
  manifest <- jsonlite::fromJSON(manifest_path, simplifyVector=FALSE)
  if (!identical(manifest$grain, "scalar") ||
      !identical(unname(unlist(manifest$files)), unname(scalar_artifact_files)))
    stop("Canonical scalar artifact manifest is incoherent", call.=FALSE)
  paths <- file.path(generation, scalar_artifact_files)
  if (any(!file.exists(paths))) stop("Canonical scalar artifact grain is missing", call.=FALSE)
  actual_hashes <- unname(tools::md5sum(paths))
  if (!identical(unname(unlist(manifest$hashes)), actual_hashes))
    stop("Canonical scalar artifact grain checksum mismatch", call.=FALSE)
  version <- scalar_artifact_digest(stats::setNames(paths, names(scalar_artifact_files)))
  if (!identical(manifest$version, version) ||
      (!is.null(expected_version) && !identical(expected_version, version)))
    stop("Canonical scalar artifact version mismatch", call.=FALSE)
  result <- stats::setNames(lapply(names(scalar_artifact_files), function(grain) {
    path <- file.path(generation, scalar_artifact_files[[grain]])
    if (grain != "descriptors") {
      schema <- manifest$table_schemas[[grain]]
      validate_typed_value_schema(schema)
      return(restore_typed_value(
        as.data.frame(nanoparquet::read_parquet(path), stringsAsFactors=FALSE), schema))
    }
    rows <- jsonlite::fromJSON(path, simplifyVector=FALSE)
    decode_scalar_descriptors(rows, manifest$descriptor_list_columns)
  }), scalar_artifact_grains)
  validate_scalar_artifact_projection(result)
  result
}

materialize_theme_scalar_artifact <- function(payload, metadata, vintages, theme, directory) {
  ids <- names(metadata$scalar_contracts)
  if (!length(ids)) return(invisible(NULL))
  if (!is.list(payload) || !is.data.frame(payload$indicateurs) ||
      !is.data.frame(payload$territoires) || !is.data.frame(vintages))
    stop("Current theme scalar inputs are incomplete", call.=FALSE)
  canonical_rows <- payload$indicateurs
  rows <- canonical_rows[is.na(canonical_rows$detail), , drop=FALSE]
  required <- c("territoire", "type", "key", "value", "unit", "vintage_source",
    "vintage_version", "vintage_date_reference", "vintage_date_publication")
  if (!all(required %in% names(rows)) || !nrow(rows))
    stop("Current theme producer has no valid scalar fact rows", call.=FALSE)
  rows <- data.frame(territory_id=as.character(rows$territoire),
    territory_type=as.character(rows$type), indicator_id=as.character(rows$key),
    value=as.numeric(rows$value), unit=as.character(rows$unit),
    source_name=as.character(rows$vintage_source), source_version=as.character(rows$vintage_version),
    reference_date=as.character(rows$vintage_date_reference),
    publication_date=as.character(rows$vintage_date_publication),
    support=if ("n" %in% names(rows)) as.integer(rows$n) else rep(NA_integer_, nrow(rows)),
    stringsAsFactors=FALSE)
  levels <- unique(unlist(lapply(metadata$scalar_contracts, function(contract)
    as.character(unlist(contract$allowed_levels, use.names=FALSE))), use.names=FALSE))
  eligible <- payload$territoires[payload$territoires$type %in% levels,
    c("territoire", "type"), drop=FALSE]
  names(eligible) <- c("territory_id", "territory_type")
  if (identical(theme, "mobilite") && "raccordement_tc" %in% ids)
    validate_raccordement_scalar_bundle(canonical_rows, metadata, vintages)
  projection <- project_scalar_canonical_rows(rows, metadata, ids, eligible,
    source_vintages=vintages)
  write_scalar_serving_artifact(projection, file.path(directory, "scalar-serving", theme))
}

write_scalar_serving_artifact <- function(projection, directory) {
  if (!is.list(projection) || !all(scalar_artifact_grains %in% names(projection)))
    stop("Scalar serving projection is incomplete", call.=FALSE)
  validate_scalar_artifact_projection(projection)
  if (!dir.exists(directory)) dir.create(directory, recursive=TRUE)
  pending <- tempfile(".scalar-generation-", tmpdir=directory)
  generation <- NULL
  complete <- FALSE
  dir.create(pending)
  on.exit(if (!complete && dir.exists(pending)) unlink(pending, recursive=TRUE), add=TRUE)
  for (grain in scalar_artifact_grains) {
    path <- file.path(pending, scalar_artifact_files[[grain]])
    if (grain == "descriptors") {
      jsonlite::write_json(projection[[grain]], path, dataframe="rows", na="null",
        digits=17, auto_unbox=TRUE)
    } else nanoparquet::write_parquet(projection[[grain]], path)
  }
  paths <- file.path(pending, scalar_artifact_files)
  version <- scalar_artifact_digest(stats::setNames(paths, names(scalar_artifact_files)))
  generation <- file.path(directory, paste0("scalar-", version))
  hashes <- unname(tools::md5sum(paths))
  names(hashes) <- names(scalar_artifact_files)
  # The descriptor schema records which columns are list-typed so the reader
  # never has to hardcode them: a new list column is published and read back
  # from the manifest, and an unrecorded list value fails closed instead of
  # being silently coerced.
  descriptor_list_columns <- names(projection$descriptors)[
    vapply(projection$descriptors, is.list, logical(1))]
  # The typed Parquet schema is recorded exactly as the typed transport does so
  # the reader restores the projector's column types (e.g. a double-backed Date
  # read back as integer-backed from Parquet) and any missing-double payload.
  table_grains <- setdiff(scalar_artifact_grains, "descriptors")
  table_schemas <- stats::setNames(lapply(table_grains, function(grain)
    typed_value_schema(projection[[grain]])), table_grains)
  jsonlite::write_json(list(grain="scalar", version=version,
    files=as.list(scalar_artifact_files), hashes=as.list(hashes),
    descriptor_list_columns=as.list(descriptor_list_columns),
    table_schemas=table_schemas),
    file.path(pending, "manifest.json"), auto_unbox=TRUE, pretty=TRUE)
  # Validate the staged bytes via the same reader before making the generation
  # visible. Reuse is allowed only after validating the existing generation.
  scalar_artifact_read_generation(pending, version)
  if (!dir.exists(generation)) {
    if (!file.rename(pending, generation)) {
      if (!dir.exists(generation)) stop("Could not publish scalar generation", call.=FALSE)
      unlink(pending, recursive=TRUE)
    }
  } else {
    scalar_artifact_read_generation(generation, version)
    unlink(pending, recursive=TRUE)
  }
  complete <- TRUE
  scalar_artifact_read_generation(generation, version)
  current_path <- file.path(directory, "scalar-current.json")
  if (file.exists(current_path)) {
    current <- jsonlite::fromJSON(current_path, simplifyVector=FALSE)
    if (identical(current$grain, "scalar") && identical(current$version, version) &&
        identical(current$generation, basename(generation))) return(invisible(version))
  }
  pointer_tmp <- tempfile(".scalar-current-", tmpdir=directory)
  on.exit(unlink(pointer_tmp), add=TRUE)
  jsonlite::write_json(list(grain="scalar", version=version,
    generation=basename(generation)), pointer_tmp, auto_unbox=TRUE)
  fs::file_move(pointer_tmp, file.path(directory, "scalar-current.json"))
  invisible(version)
}

read_scalar_serving_artifact <- function(directory) {
  pointer_path <- file.path(directory, "scalar-current.json")
  if (!file.exists(pointer_path)) stop("Canonical scalar artifact is missing", call.=FALSE)
  pointer <- jsonlite::fromJSON(pointer_path, simplifyVector=FALSE)
  if (!identical(pointer$grain, "scalar") || length(pointer$version) != 1L ||
      !grepl("^[a-f0-9]{32}$", pointer$version) ||
      !identical(pointer$generation, paste0("scalar-", pointer$version)))
    stop("Canonical scalar artifact generation is incomplete", call.=FALSE)
  root <- normalizePath(directory, winslash="/", mustWork=TRUE)
  generation <- normalizePath(file.path(root, pointer$generation), winslash="/", mustWork=TRUE)
  if (!startsWith(paste0(generation, "/"), paste0(root, "/")))
    stop("Canonical scalar artifact generation escapes its owner directory", call.=FALSE)
  scalar_artifact_read_generation(generation, pointer$version)
}
