#!/usr/bin/env Rscript
# Local publication commands (ADR-0049 step 2, #1135/#1136).
# `split <sortie>` turns one producer sortie into immutable per-resource
# artefacts under LUSK_ARTEFACTS (default pipeline/data/artefacts).
# `plan [sortie]` prints the read-only publication plan over that artefact
# store and an injected live listing (LUSK_LIVE_LISTING, JSON). It NEVER opens
# a serving-database connection, NEVER reads a registry and NEVER writes a file.
# Run from pipeline/.
if (!requireNamespace("pkgload", quietly = TRUE)) {
  stop("pkgload is required to load the pipeline.", call. = FALSE)
}
pkgload::load_all(".", quiet = TRUE)

args <- commandArgs(trailingOnly = TRUE)
commande <- if (length(args)) args[[1L]] else ""

if (identical(commande, "split")) {
  if (length(args) != 2L) {
    stop("Usage: Rscript scripts/publication.R split <sortie> (from pipeline/)",
         call. = FALSE)
  }
  resultat <- splitter_sortie(args[[2L]])
  for (i in seq_len(nrow(resultat))) {
    cat(sprintf("%s, %s, %s, %s\n", resultat$ressource[[i]], resultat$forme[[i]],
                resultat$version[[i]], resultat$statut[[i]]))
  }
} else if (identical(commande, "plan")) {
  if (length(args) > 2L) {
    stop("Usage: Rscript scripts/publication.R plan [sortie] (from pipeline/)",
         call. = FALSE)
  }
  sortie <- if (length(args) == 2L) args[[2L]] else ""
  attributions <- Sys.getenv("LUSK_ATTRIBUTIONS", unset = "")
  if (!nzchar(attributions) && nzchar(sortie))
    attributions <- file.path(sortie, NOM_ATTRIBUTIONS)
  plan <- plan_publication(
    live = Sys.getenv("LUSK_LIVE_LISTING", unset = ""),
    attributions = if (nzchar(attributions)) attributions else NULL)
  imprimer_plan_publication(plan)
} else {
  stop("Usage: Rscript scripts/publication.R split <sortie> | plan [sortie]",
       call. = FALSE)
}
