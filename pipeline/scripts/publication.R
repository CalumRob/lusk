#!/usr/bin/env Rscript
# Local publication commands (ADR-0049 step 2, #1135).
# `split <sortie>` turns one producer sortie into immutable per-resource
# artefacts under LUSK_ARTEFACTS (default pipeline/data/artefacts). This slice
# NEVER opens a serving-database connection and NEVER deletes an artefact.
# Run from pipeline/.
if (!requireNamespace("pkgload", quietly = TRUE)) {
  stop("pkgload is required to load the pipeline.", call. = FALSE)
}
pkgload::load_all(".", quiet = TRUE)

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 2L || !identical(args[[1L]], "split")) {
  stop("Usage: Rscript scripts/publication.R split <sortie> (from pipeline/)",
       call. = FALSE)
}
sortie <- args[[2L]]
resultat <- splitter_sortie(sortie)

for (i in seq_len(nrow(resultat))) {
  cat(sprintf("%s, %s, %s, %s\n", resultat$ressource[[i]], resultat$forme[[i]],
              resultat$version[[i]], resultat$statut[[i]]))
}
