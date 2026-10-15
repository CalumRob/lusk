# Offline, owner-scoped scalar serving artifact. Each generation is immutable;
# the small pointer is replaced only after every typed grain has been written.
scalar_artifact_grains <- c("facts", "descriptors", "provenance", "datasets",
                            "vintages", "eligible_territories")

write_scalar_serving_artifact <- function(projection, directory) {
  if (!is.list(projection) || !all(scalar_artifact_grains %in% names(projection)))
    stop("Scalar serving projection is incomplete", call.=FALSE)
  validate_scalar_projection(projection$facts, projection$descriptors,
                             projection$eligible_territories)
  version <- scalar_content_version(projection[scalar_artifact_grains])
  if (!dir.exists(directory)) dir.create(directory, recursive=TRUE)
  generation <- file.path(directory, paste0("scalar-", version))
  if (!dir.exists(generation)) {
    pending <- tempfile(".scalar-generation-", tmpdir=directory)
    dir.create(pending)
    complete <- FALSE
    on.exit(if (!complete) unlink(pending, recursive=TRUE), add=TRUE)
    for (grain in scalar_artifact_grains) {
      if (grain == "descriptors") {
        # Descriptor contracts contain ordered list columns; preserve their R
        # types rather than coercing them to strings in a Parquet round-trip.
        saveRDS(projection[[grain]], file.path(pending, "descriptors.rds"), version=3)
      } else {
        nanoparquet::write_parquet(projection[[grain]], file.path(pending, paste0(grain, ".parquet")))
      }
    }
    jsonlite::write_json(list(grain="scalar", version=version,
      files=c("facts.parquet", "descriptors.rds", "provenance.parquet",
              "datasets.parquet", "vintages.parquet", "eligible_territories.parquet")),
      file.path(pending, "manifest.json"), auto_unbox=TRUE, pretty=TRUE)
    if (!file.rename(pending, generation)) {
      if (!dir.exists(generation)) stop("Could not publish scalar generation", call.=FALSE)
      unlink(pending, recursive=TRUE)
    }
    complete <- TRUE
  }
  pointer_tmp <- tempfile(".scalar-current-", tmpdir=directory)
  on.exit(unlink(pointer_tmp), add=TRUE)
  jsonlite::write_json(list(grain="scalar", version=version,
    generation=basename(generation)), pointer_tmp, auto_unbox=TRUE)
  remplacer_fichier_si_modifie(pointer_tmp, file.path(directory, "scalar-current.json"))
  invisible(version)
}

read_scalar_serving_artifact <- function(directory) {
  pointer_path <- file.path(directory, "scalar-current.json")
  if (!file.exists(pointer_path)) stop("Canonical scalar artifact is missing", call.=FALSE)
  pointer <- jsonlite::fromJSON(pointer_path)
  generation <- file.path(directory, pointer$generation)
  manifest_path <- file.path(generation, "manifest.json")
  if (!identical(pointer$grain, "scalar") || !dir.exists(generation) || !file.exists(manifest_path))
    stop("Canonical scalar artifact generation is incomplete", call.=FALSE)
  manifest <- jsonlite::fromJSON(manifest_path)
  expected_files <- c("facts.parquet", "descriptors.rds", "provenance.parquet",
    "datasets.parquet", "vintages.parquet", "eligible_territories.parquet")
  if (!identical(manifest$grain, "scalar") || !identical(manifest$version, pointer$version) ||
      !setequal(manifest$files, expected_files))
    stop("Canonical scalar artifact manifest is incoherent", call.=FALSE)
  paths <- file.path(generation, expected_files)
  if (any(!file.exists(paths))) stop("Canonical scalar artifact grain is missing", call.=FALSE)
  result <- stats::setNames(lapply(seq_along(paths), function(i) {
    if (scalar_artifact_grains[[i]] == "descriptors") readRDS(paths[[i]])
    else nanoparquet::read_parquet(paths[[i]])
  }), scalar_artifact_grains)
  validate_scalar_projection(result$facts, result$descriptors, result$eligible_territories)
  result
}
