#!/usr/bin/env Rscript
# Rebuild the building cohorts from the cached Mobilité source target as
# canonical Parquet plus the existing static JSON projection.
# Run from pipeline/ after `targets::tar_make(names = 'brut_mobilite')`.
# The full graph remains the authority for regular releases; this targeted
# refresh keeps the other published themes and their snapshots untouched.
# (#891: the manual territory-model refresh helper is retired — no CLI
# rebuilds the per-territory read models from the published JSON anymore.)

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
if (is.null(source$rampe_acces_batiments)) {
  stop("The Mobilité source target lacks building ramp evidence.", call. = FALSE)
}
projections <- construire_contextes_acces_batiments(
  NULL,
  source$rampe_acces_batiments,
  base_epci = NULL,
  territoires_reference = reference
)
verifier_integrite_projections_acces_batiments(list(
  territoires = reference,
  rampe_acces_batiments_comparaisons = projections$rampe
))

publier_comparaisons_acces_batiments(projections, output)
cat(sprintf("%s: %d rows\n",
            file.path(output, "rampe_acces_batiments_comparaisons.parquet"),
            nrow(projections$rampe)))
