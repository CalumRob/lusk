#!/usr/bin/env Rscript
# Rebuild the compact building cohorts from the cached Mobilité source target.
# Run from pipeline/ after `targets::tar_make(names = 'brut_mobilite')`.
# Then run `Rscript scripts/publish-territory-models.R` to refresh the fiches.
# The full graph remains the authority for regular releases; this targeted
# refresh keeps the other published themes and their snapshots untouched.

if (!requireNamespace("pkgload", quietly = TRUE)) {
  stop("pkgload is required to load the pipeline.", call. = FALSE)
}
pkgload::load_all(".", quiet = TRUE)

output <- if (length(commandArgs(trailingOnly = TRUE)) == 1L) {
  commandArgs(trailingOnly = TRUE)[[1L]]
} else if (length(commandArgs(trailingOnly = TRUE)) == 0L) {
  file.path("..", "public", "data")
} else {
  stop("Usage: Rscript scripts/publish-building-comparisons.R [output-dir]",
       call. = FALSE)
}
reference_file <- file.path(output, "territoires.json")
if (!file.exists(reference_file)) {
  stop("Published territory reference missing: ", reference_file, call. = FALSE)
}
reference <- jsonlite::fromJSON(reference_file)
source <- targets::tar_read(brut_mobilite)
if (is.null(source$accessibilite_batiments) ||
    is.null(source$rampe_acces_batiments)) {
  stop("The Mobilité source target lacks building-level evidence.", call. = FALSE)
}
projections <- construire_contextes_acces_batiments(
  source$accessibilite_batiments,
  source$rampe_acces_batiments,
  base_epci = NULL,
  territoires_reference = reference
)
verifier_integrite_projections_acces_batiments(list(
  territoires = reference,
  distribution_acces_batiments_comparaisons = projections$distribution,
  rampe_acces_batiments_comparaisons = projections$rampe
))

for (kind in c("distribution", "rampe")) {
  file <- file.path(output, paste0(
    if (kind == "distribution") "distribution_acces_batiments_comparaisons" else
      "rampe_acces_batiments_comparaisons", ".json"
  ))
  temporary <- tempfile(".building-comparisons-", tmpdir = output, fileext = ".json")
  jsonlite::write_json(
    projections[[kind]], temporary,
    dataframe = "rows", na = "null", digits = 17, pretty = TRUE
  )
  if (file.exists(file)) unlink(file)
  if (!file.rename(temporary, file)) {
    stop("Cannot publish ", file, call. = FALSE)
  }
  cat(sprintf("%s: %d rows\n", file, nrow(projections[[kind]])))
}
