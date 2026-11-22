#!/usr/bin/env Rscript
# Relock délibéré des sources (issue #1103, ADR-0048).
#
#   Rscript pipeline/scripts/relock-sources.R <run-dir> [source_id...]  (racine)
#   Rscript scripts/relock-sources.R <run-dir> [source_id...]           (pipeline/)
#
# Réécrit les enregistrements de pipeline/sources.lock.json depuis le
# source-digests.json du run indiqué, en UNE écriture atomique. Sans ids,
# toutes les empreintes du run sont adoptées. Une écriture qui échoue laisse
# l'ancien lockfile intact. Le relock est COMMITTÉ avec les valeurs dérivées.

args <- commandArgs(trailingOnly = TRUE)
if (length(args) < 1L || !nzchar(args[[1L]])) {
  stop("Usage : Rscript pipeline/scripts/relock-sources.R <run-dir> [source_id...]",
       call. = FALSE)
}

fichier_script <- sub("^--file=", "",
                      grep("^--file=", commandArgs(FALSE), value = TRUE)[[1L]])
setwd(dirname(dirname(normalizePath(fichier_script))))
suppressPackageStartupMessages(pkgload::load_all(".", quiet = TRUE))

run_dir <- args[[1L]]
ids <- if (length(args) >= 2L) args[-1L] else NULL
resultat <- relock_sources(run_dir, ids)
cat(sprintf("Relock effectué — %d source(s) : %s\n",
            length(resultat), paste(names(resultat), collapse = ", ")))
