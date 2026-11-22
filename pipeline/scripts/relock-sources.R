#!/usr/bin/env Rscript
# Relock deliberé des sources (issue #1103, ADR-0048, #1122).
#
#   cd pipeline && Rscript scripts/relock-sources.R <run-dir> [source_id...]
#
# Une SEULE forme est documentée : celle qui marche. Elle doit être lancée
# depuis `pipeline/` pour que le .Rprofile du projet active la bibliothèque
# renv (sinon pkgload::load_all() échoue avec « package "targets" is required »).
# Depuis la racine du dépôt, le script refuse tôt avec un message explicite :
# il n'active PAS renv lui-même (jamais de renv::restore/install/snapshot).
#
# Réécrit les enregistrements de pipeline/sources.lock.json depuis le
# source-digests.json du run indiqué, en UNE écriture atomique. Sans ids,
# toutes les empreintes du run sont adoptées — y compris les lectures réseau
# non-manifeste `geometrie_*` (#1122). Une écriture qui échoue laisse l'ancien
# lockfile intact. Le relock est COMMITTÉ avec les valeurs dérivées.

args <- commandArgs(trailingOnly = TRUE)
if (length(args) < 1L || !nzchar(args[[1L]])) {
  stop("Usage : cd pipeline && Rscript scripts/relock-sources.R <run-dir> [source_id...]",
       call. = FALSE)
}

fichier_script <- sub("^--file=", "",
                      grep("^--file=", commandArgs(FALSE), value = TRUE)[[1L]])
racine_pipeline <- dirname(dirname(normalizePath(fichier_script)))

# Le projet renv de pipeline/ doit être actif. On ne l'active PAS ici : c'est
# le .Rprofile de pipeline/ qui le fait au démarrage de R. Échouer tôt rend la
# commande documentée honnête et évite un load_all() obscur depuis la racine.
projet_renv <- Sys.getenv("RENV_PROJECT", unset = "")
if (!nzchar(projet_renv) ||
    !identical(normalizePath(projet_renv, mustWork = FALSE),
               normalizePath(racine_pipeline, mustWork = FALSE))) {
  stop(
    "Projet renv de pipeline/ inactif : lancez la commande depuis pipeline/.\n",
    "  cd pipeline && Rscript scripts/relock-sources.R <run-dir> [source_id...]\n",
    "Depuis la racine, renv n'est pas activé et pkgload::load_all() échoue (issue #1122).",
    call. = FALSE
  )
}

setwd(racine_pipeline)
suppressPackageStartupMessages(pkgload::load_all(".", quiet = TRUE))

run_dir <- args[[1L]]
ids <- if (length(args) >= 2L) args[-1L] else NULL
resultat <- relock_sources(run_dir, ids)
cat(sprintf("Relock effectué → %d source(s) : %s\n",
            length(resultat), paste(names(resultat), collapse = ", ")))
