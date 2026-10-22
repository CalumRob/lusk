# Offline, owner-scoped declared-profile serving artifact. One owner is one
# declared profile (indicator_id); each generation is immutable and the small
# pointer is replaced only after the typed grain has been written and read back
# through the public reader. The transport is shared with the scalar and
# ordered-series grains; this file owns the profile family schema, the
# projector dispatch, and the DPE scalar binding.
profile_serving_table_fields <- c("facts", "axes", "provenance", "datasets",
                                  "vintages", "eligible_territories")
profile_serving_json_fields <- "descriptor"
profile_serving_family <- "declared-profile"

# A projector can attach R's internal "hashed string" flag (and a materialised
# row-names form) to a character column or to the NAME vector of a table — for
# the declared-profile provenance table rbind()/unique() do, and a subset of a
# data.frame does to its names. Those flags are invisible to identical() but are
# written by saveRDS, so two semantically equal projections would otherwise hash
# to different content versions. The transport's reader rebuilds every column
# and every name vector from Parquet, which clears the flags; re-materialising
# each atomic vector here reproduces exactly that canonical form, so
# profile_content_version(projected) equals profile_content_version(read back).
# Values, classes and attributes are unchanged; only volatile allocation flags
# are normalised.
materialize_profile_value <- function(value) {
  if (is.null(value)) return(NULL)
  if (is.data.frame(value)) {
    out <- value
    for (column in names(value)) out[[column]] <- materialize_profile_value(value[[column]])
    names(out) <- names(value)[]
    return(out)
  }
  if (is.list(value)) {
    out <- lapply(value, materialize_profile_value)
    names(out) <- names(value)[]
    return(out)
  }
  value[]
}

canonicalize_profile_projection <- function(projection) {
  restore_typed_value(materialize_profile_value(projection), typed_value_schema(projection))
}

# JSON null must be reconstructed as a length-one typed NA, not dropped: the
# transport records no per-value NA payload for character vectors, and
# character(0) (e.g. a profile without a sex axis) is written as an empty array
# that must stay character(0). Both cases therefore need an explicit decode.
restore_profile_descriptor_json <- function(value) {
  if (is.null(value)) return(NA_character_)
  if (is.list(value)) {
    if (!length(value)) return(character(0))
    restored <- lapply(value, restore_profile_descriptor_json)
    names(restored) <- names(value)
    return(restored)
  }
  value
}

decode_profile_serving_json <- function(value, field) {
  if (identical(field, "descriptor")) return(restore_profile_descriptor_json(value))
  value
}

validate_profile_serving_projection <- function(projection, scalar_binding = NULL) {
  if (!is.list(projection) ||
      !all(c(profile_serving_table_fields, profile_serving_json_fields) %in% names(projection)) ||
      !is.data.frame(projection$eligible_territories))
    stop("Declared profile serving projection is incomplete", call.=FALSE)
  validate_declared_profile(projection$facts, projection$descriptor,
    projection$axes, projection$eligible_territories)
  validate_profile_provenance(projection)
  descriptor <- projection$descriptor
  if (!is.null(descriptor$comparison_scalar)) {
    if (is.null(scalar_binding) || length(scalar_binding) != 1L || is.na(scalar_binding) ||
        !nzchar(scalar_binding) ||
        !identical(as.character(descriptor$required_scalar_version), as.character(scalar_binding)))
      stop("Declared profile scalar binding is missing, stale or incompatible", call.=FALSE)
  } else if (!is.null(scalar_binding) && !is.null(descriptor$required_scalar_version)) {
    stop("Declared profile without a scalar facet carries a scalar binding", call.=FALSE)
  }
  invisible(projection)
}

# The typed transport validator is a closure: a stale or missing scalar binding
# must fail on read exactly as it fails on write. The closure is captured by the
# writer and the reader, so a generation can never be silently reinterpreted
# under a different binding.
profile_serving_validator <- function(scalar_binding = NULL) {
  force(scalar_binding)
  function(projection) validate_profile_serving_projection(projection, scalar_binding)
}

write_profile_serving_artifact <- function(projection, directory, scalar_binding = NULL) {
  owner <- projection$descriptor$indicator_id
  if (!is.character(owner) || length(owner) != 1L || is.na(owner) || !nzchar(owner))
    stop("Declared profile serving owner is required", call.=FALSE)
  projection <- canonicalize_profile_projection(projection)
  validate_profile_serving_projection(projection, scalar_binding)
  write_typed_artifact(projection, directory, profile_serving_family, owner,
    profile_serving_table_fields, profile_serving_json_fields,
    profile_content_version, profile_serving_validator(scalar_binding),
    decode_profile_serving_json)
}

read_profile_serving_artifact <- function(directory, owner, scalar_binding = NULL, universe = NULL) {
  if (!is.character(owner) || length(owner) != 1L || is.na(owner) || !nzchar(owner))
    stop("Declared profile serving owner is required", call.=FALSE)
  projection <- read_typed_artifact(directory, profile_serving_family, owner,
    profile_serving_table_fields, profile_serving_json_fields,
    profile_content_version, profile_serving_validator(scalar_binding),
    decode_profile_serving_json)
  if (!identical(as.character(projection$descriptor$indicator_id), owner))
    stop("Declared profile serving artifact owner mismatch", call.=FALSE)
  if (!is.null(universe)) {
    if (!is.data.frame(universe) || !all(c("territory_id", "territory_type") %in% names(universe)))
      stop("Declared profile serving universe is invalid", call.=FALSE)
    expected <- unique(universe[c("territory_id", "territory_type")])
    actual <- projection$eligible_territories[c("territory_id", "territory_type")]
    if (!setequal(paste(expected$territory_type, expected$territory_id),
                  paste(actual$territory_type, actual$territory_id)))
      stop("Declared profile eligible universe differs from the current serving universe", call.=FALSE)
  }
  projection
}

read_profile_serving_profiles <- function(directory, owners, scalar_binding = NULL, universe = NULL) {
  if (!is.character(owners) || !length(owners) || anyNA(owners) || anyDuplicated(owners))
    stop("Declared profile serving owners are invalid", call.=FALSE)
  profiles <- lapply(owners, function(owner)
    read_profile_serving_artifact(file.path(directory, "profile-serving", owner), owner,
      scalar_binding = scalar_binding, universe = universe))
  names(profiles) <- owners
  profiles
}

# Owner inventory is derived from the producer contracts, never from a second
# domain-ID list: a page that declares the pyramid dimensions, or a dense
# profile contract that declares detail units or a scalar support field.
profile_serving_owners <- function(metadata) {
  if (!is.list(metadata) || !is.list(metadata$indicator_pages)) return(character())
  config <- metadata$indicator_pages
  contracts <- metadata$profile_contracts
  if (is.null(contracts)) contracts <- list()
  pyramids <- names(Filter(function(page) is.list(page) &&
    identical(page$family, "pyramid") &&
    identical(as.character(unlist(page$pyramid$dimensions, use.names=FALSE)), c("detail", "sex")),
    config))
  dense <- names(Filter(function(contract) is.list(contract) &&
    identical(contract$completeness, "dense_complete") &&
    (!is.null(contract$detail_units) || !is.null(contract$support_count_field)),
    contracts))
  owners <- unique(c(sort(pyramids), sort(dense)))
  owners[!vapply(owners, function(owner) {
    source_id <- (metadata$sources %||% list())[[owner]]
    source <- (metadata$source_records %||% list())[[source_id]]
    identical(source$serving_disposition, "excluded_legacy_accessibility")
  }, logical(1))]
}

profile_serving_scalar_owners <- function(metadata) {
  owners <- profile_serving_owners(metadata)
  owners[vapply(owners, function(owner) {
    contract <- metadata$profile_contracts[[owner]]
    is.list(contract) && !is.null(contract$support_count_field)
  }, logical(1))]
}

# Project one owner from the current in-memory French-column payload. The
# projector contract is selected by the declared page/contract shape; no
# projector logic is duplicated or changed here.
project_profile_serving_owner <- function(payload, metadata, vintages, theme, owner,
    scalar_binding = NULL) {
  canonical <- list(indicateurs=payload$indicateurs, territoires=payload$territoires)
  page <- metadata$indicator_pages[[owner]]
  contract <- metadata$profile_contracts[[owner]]
  projection <- if (is.list(page) && identical(page$family, "pyramid")) {
    project_structure_age_profile(canonical$indicateurs, metadata, canonical$territoires)
  } else if (is.list(contract) && !is.null(contract$support_count_field)) {
    project_dpe_profile(canonical, metadata, scalar_binding)
  } else if (is.list(contract) && !is.null(contract$detail_units)) {
    # Mobility detail profiles are projected against the canonical merged
    # vintage universe, matching the established database publication path;
    # Habitat detail profiles remain metadata-derived.
    source_vintages <- if (identical(as.character(theme), "mobilite")) vintages else NULL
    project_declared_detail_profile(canonical, metadata, owner, source_vintages)
  } else stop("Unknown declared profile serving owner: ", owner, call.=FALSE)
  canonicalize_profile_projection(projection)
}

materialize_theme_profile_artifacts <- function(payload, metadata, vintages, theme,
    directory, scalar_binding = NULL) {
  owners <- profile_serving_owners(metadata)
  if (!length(owners)) return(invisible(NULL))
  if (!is.list(payload) || !is.data.frame(payload$indicateurs) || !is.data.frame(payload$territoires))
    stop("Current theme profile inputs are incomplete", call.=FALSE)
  scalar_owners <- profile_serving_scalar_owners(metadata)
  published <- list()
  for (owner in owners) {
    scalar_backed <- owner %in% scalar_owners
    # A scalar-backed owner whose binding is unavailable is skipped, never
    # stubbed: the partial/cron run degrades to the declared detail profiles
    # and the previous immutable DPE generation stays readable.
    if (scalar_backed && is.null(scalar_binding)) next
    binding <- if (scalar_backed) scalar_binding else NULL
    projection <- project_profile_serving_owner(payload, metadata, vintages, theme, owner, binding)
    published[[owner]] <- write_profile_serving_artifact(projection,
      file.path(directory, "profile-serving", owner), binding)
  }
  invisible(published)
}

# The DPE facet binds to the validated retained scalar snapshot, assembled from
# the same owner-scoped scalar artifacts used by its publisher.
profile_scalar_binding <- function(sortie = "../public/data") {
  snapshot <- project_retained_scalar_snapshot(sortie)
  scalar_content_version(snapshot$scalar)
}

profile_scalar_binding_inputs_available <- function(sortie = "../public/data") {
  required <- c("territoires.parquet",
    file.path("scalar-serving", "economie", "scalar-current.json"),
    file.path("scalar-serving", "demographie", "scalar-current.json"),
    file.path("scalar-serving", "mobilite", "scalar-current.json"),
    file.path("scalar-serving", "habitat", "scalar-current.json"))
  all(file.exists(file.path(sortie, required)))
}

cache_profile_scalar_binding <- function(binding, directory, write_fn = jsonlite::write_json) {
  if (!is.character(binding) || length(binding) != 1L || is.na(binding) ||
      !grepl("^[a-f0-9]{32}$", binding))
    stop("Declared profile scalar binding is invalid", call.=FALSE)
  path <- file.path(directory, "scalar-serving")
  if (!dir.exists(path)) dir.create(path, recursive=TRUE)
  staged <- tempfile(".profile-binding-", tmpdir=path)
  on.exit(unlink(staged), add=TRUE)
  write_fn(list(binding=binding), staged, auto_unbox=TRUE, pretty=TRUE)
  fs::file_move(staged, file.path(path, "binding.json"))
  invisible(binding)
}

read_profile_scalar_binding <- function(directory) {
  path <- file.path(directory, "scalar-serving", "binding.json")
  if (!file.exists(path)) stop("Declared profile scalar binding is missing", call.=FALSE)
  binding <- jsonlite::fromJSON(path, simplifyVector=FALSE)$binding
  if (!is.character(binding) || length(binding) != 1L || is.na(binding) ||
      !grepl("^[a-f0-9]{32}$", binding))
    stop("Declared profile scalar binding is invalid", call.=FALSE)
  binding
}
