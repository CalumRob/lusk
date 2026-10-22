# One coherent scalar table publication assembled only from canonical,
# producer-owned scalar-serving artifacts. Legacy service-share facts are not
# members of this snapshot.
scalar_indicators_with_serving_disposition <- function(metadata, disposition) {
  sources <- metadata$sources %||% list()
  records <- metadata$source_records %||% list()
  ids <- names(sources)
  if (!is.list(sources) || is.null(ids) || any(!nzchar(ids)) || anyDuplicated(ids) ||
      !is.list(records))
    stop("Producer scalar source declarations are invalid", call.=FALSE)
  missing_records <- unique(unlist(sources, use.names=FALSE))
  missing_records <- setdiff(missing_records, names(records))
  if (length(missing_records))
    stop("Producer scalar source record is missing: ", paste(sort(missing_records), collapse=", "),
      call.=FALSE)
  ids[vapply(ids, function(id) {
    record <- records[[sources[[id]]]]
    identical(record$serving_disposition, disposition)
  }, logical(1))]
}

retained_scalar_retirement_ids <- function(metadata_directory=NULL) {
  if (is.null(metadata_directory))
    metadata_directory <- system.file("extdata", "theme-metadata", package="lusk")
  files <- sort(list.files(metadata_directory, pattern="^theme_.*\\.json$", full.names=TRUE))
  if (!length(files)) stop("No producer theme metadata found for scalar retirement", call.=FALSE)
  ids <- unlist(lapply(files, function(path) {
    metadata <- jsonlite::fromJSON(path, simplifyVector=FALSE)
    scalar_indicators_with_serving_disposition(metadata, "excluded_legacy_accessibility")
  }), use.names=FALSE)
  sort(unique(as.character(ids)))
}

retained_scalar_artifact_owners <- function(metadata_directory=NULL) {
  if (is.null(metadata_directory)) {
    metadata_directory <- system.file("extdata", "theme-metadata", package="lusk")
  }
  files <- sort(list.files(metadata_directory, pattern="^theme_.*\\.json$", full.names=TRUE))
  if (!length(files)) stop("No producer theme metadata found for scalar publication", call.=FALSE)
  owners <- vapply(files, function(path) {
    metadata <- jsonlite::fromJSON(path, simplifyVector=FALSE)
    theme <- metadata$theme
    contracts <- metadata$scalar_contracts %||% list()
    retained <- setdiff(names(contracts),
      scalar_indicators_with_serving_disposition(metadata, "excluded_legacy_accessibility"))
    if (!length(retained)) return(NA_character_)
    if (!is.character(theme) || length(theme)!=1L || is.na(theme) || !nzchar(theme))
      stop("Scalar owner metadata is missing its theme identity", call.=FALSE)
    theme
  }, character(1))
  owners <- owners[!is.na(owners)]
  if (!length(owners) || anyDuplicated(owners))
    stop("Producer scalar artifact owner declarations are empty or duplicated", call.=FALSE)
  unname(owners)
}

project_theme_scalar_cohort <- function(sortie, eligible_territories, theme,
                                        artifact_directory=sortie) {
  projection <- read_scalar_serving_artifact(file.path(artifact_directory,
    "scalar-serving", theme))
  metadata <- lire_theme_metadata(theme)
  excluded <- scalar_indicators_with_serving_disposition(metadata,
    "excluded_legacy_accessibility")
  if (length(excluded)) {
    projection$descriptors <- projection$descriptors[
      !projection$descriptors$indicator_id %in% excluded, , drop=FALSE]
    projection$facts <- projection$facts[!projection$facts$indicator_id %in% excluded, , drop=FALSE]
    projection$provenance <- projection$provenance[
      !projection$provenance$indicator_id %in% excluded, , drop=FALSE]
    used_sources <- unique(projection$provenance$source_id)
    used_vintages <- unique(projection$provenance[c("source_id", "vintage_id")])
    projection$datasets <- projection$datasets[
      projection$datasets$source_id %in% used_sources, , drop=FALSE]
    projection$vintages <- projection$vintages[
      paste(projection$vintages$source_id, projection$vintages$vintage_id) %in%
        paste(used_vintages$source_id, used_vintages$vintage_id), , drop=FALSE]
  }
  allowed <- unique(unlist(lapply(projection$descriptors$allowed_levels, as.character),
    use.names=FALSE))
  expected <- eligible_territories[eligible_territories$territory_type %in% allowed,
    c("territory_id", "territory_type"), drop=FALSE]
  actual <- projection$eligible_territories[c("territory_id", "territory_type")]
  if (!setequal(paste(expected$territory_type, expected$territory_id),
                paste(actual$territory_type, actual$territory_id)))
    stop("Canonical scalar artifact eligibility differs from the current serving universe for owner ",
      theme, call.=FALSE)
  validate_scalar_projection(projection$facts, projection$descriptors,
    projection$eligible_territories)
  projection
}

project_retained_scalar_snapshot <- function(sortie, reference_projection=NULL,
                                             artifact_directory=sortie,
                                             metadata_directory=NULL) {
  territories_path <- file.path(sortie, "territoires.parquet")
  if (!file.exists(territories_path))
    stop("Canonical territory artifact is required for retained scalar publication", call.=FALSE)
  territories <- nanoparquet::read_parquet(territories_path)
  reference_projection <- reference_projection %||% project_territory_reference(territories)
  eligible <- reference_projection$rows[c("territory_id", "territory_type")]
  themes <- retained_scalar_artifact_owners(metadata_directory)
  projections <- lapply(themes, function(theme)
    project_theme_scalar_cohort(sortie, eligible, theme, artifact_directory))
  names(projections) <- themes
  scalar <- assemble_scalar_snapshot(projections[[1L]], projections[-1L])
  version <- scalar_content_version(scalar)
  comparison <- project_scalar_comparisons(scalar, reference_projection$rows,
    input_scalar_content_version=version,
    reference_content_version=reference_projection$content_version)
  list(reference=reference_projection, scalar=scalar, comparison=comparison,
    retired_indicator_ids=retained_scalar_retirement_ids(metadata_directory))
}

publish_retained_scalar_snapshot <- function(con, snapshot, sortie) {
  retired_indicator_ids <- snapshot$retired_indicator_ids %||% character()
  registry <- register_scalar_publisher(list(), "retained_scalar_snapshot",
    project=function(canonical) canonical,
    publish=function(projection, db, version) db$replace(projection, version))
  scalar <- publish_registered_scalar(registry, "retained_scalar_snapshot", snapshot$scalar,
    scalar_postgres_adapter(con), retired_indicator_ids=retired_indicator_ids)
  if (!identical(as.character(scalar$content_version),
                 as.character(snapshot$comparison$scalar_content_version)))
    stop("Scalar comparison projection was built from a different retained scalar snapshot", call.=FALSE)
  comparison <- publish_registered_scalar_comparison(snapshot$comparison,
    scalar_comparison_postgres_adapter(con))
  write_scalar_comparison_parquets(snapshot$comparison, sortie)
  list(scalar=scalar, comparison=comparison)
}

publish_retained_backend_snapshot <- function(con, sortie="../public/data",
                                             conso_source_path=NULL) {
  territory_path <- file.path(sortie, "territoires.parquet")
  if (!file.exists(territory_path))
    stop("Canonical territory artifact is required for retained publication", call.=FALSE)
  reference <- project_territory_reference(nanoparquet::read_parquet(territory_path))
  reference_result <- publish_territory_reference_projection(reference,
    territory_reference_postgres_adapter(con))
  scalar_snapshot <- project_retained_scalar_snapshot(sortie, reference)
  scalar_result <- publish_retained_scalar_snapshot(con, scalar_snapshot, sortie)

  # Mobility's old story/clock projection is excluded. These owner-scoped
  # canonical readings are retained and keep their independent publication
  # tokens and typed validators.
  demographic <- publish_canonical_demographic_reading(con, sortie)
  habitat <- publish_canonical_habitat_reading(con, sortie)
  economy_publication <- read_typed_reading_publication_from(sortie, "economie")
  economy <- publish_typed_reading_publication(
    register_typed_reading_artifact_publisher(list(), "economie", publish_economy_reading_family),
    "economie", economy_publication, con)
  milieux <- publish_canonical_milieux_reading(con, sortie,
    conso_source_path=conso_source_path)
  list(reference=reference_result, scalar=scalar_result,
    demographic=demographic, habitat=habitat, economy=economy,
    milieux=milieux$reading, milieux_state_series=milieux$owned_series)
}
