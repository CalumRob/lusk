#!/usr/bin/env Rscript
# Matérialisation rapide des modèles de lecture par territoire (ADR-0031).
#
# Ce script ne reconstruit aucune donnée source : il relit les JSON canoniques
# déjà présents sous public/data/, puis ne projette que la ou les fiches
# demandées. Il est destiné au développement et aux prototypes ; le graphe
# targets reste l'autorité pour une publication complète.

script_arg <- grep("^--file=", commandArgs(trailingOnly = FALSE), value = TRUE)
script_path <- if (length(script_arg) == 1L) {
  normalizePath(sub("^--file=", "", script_arg), mustWork = TRUE)
} else {
  normalizePath(file.path(getwd(), "scripts", "publish-territory-models.R"),
                mustWork = TRUE)
}
pipeline_root <- dirname(dirname(script_path))
repo_root <- dirname(pipeline_root)

parse_args <- function(args) {
  valeurs <- list()
  i <- 1L
  while (i <= length(args)) {
    argument <- args[[i]]
    if (argument %in% c("--help", "-h")) valeurs$help <- TRUE
    else if (!grepl("^--", argument)) {
      stop("Argument inconnu `", argument, "`. Voir --help.", call. = FALSE)
    }
    else if (grepl("=", argument, fixed = TRUE)) {
      morceaux <- strsplit(sub("^--", "", argument), "=", fixed = TRUE)[[1L]]
      valeurs[[morceaux[[1L]]]] <- morceaux[[2L]]
    } else {
      cle <- sub("^--", "", argument)
      if (i == length(args) || grepl("^--", args[[i + 1L]])) {
        stop("Valeur manquante pour `", argument, "`.", call. = FALSE)
      }
      valeurs[[cle]] <- args[[i + 1L]]
      i <- i + 1L
    }
    i <- i + 1L
  }
  valeurs
}

args <- parse_args(commandArgs(trailingOnly = TRUE))
if (isTRUE(args$help)) {
  cat(paste0(
    "Usage: Rscript pipeline/scripts/publish-territory-models.R [options]\n\n",
    "Options:\n",
    "  --territory 35238       Une fiche ; plusieurs codes séparés par des virgules\n",
    "  --input DIR              Home JSON canonique (défaut: public/data)\n",
    "  --output DIR             Destination (défaut: input)\n",
    "\nSans --territory, toutes les fiches sont projetées ; cette forme est réservée\n",
    "à une publication complète et peut prendre plusieurs dizaines de secondes.\n"
  ))
  quit(save = "no", status = 0L)
}

input <- if (is.null(args$input)) file.path(repo_root, "public", "data") else args$input
output <- if (is.null(args$output)) input else args$output
if (!is.null(args$themes)) {
  stop("`--themes` a été retiré : un modèle de territoire porte toujours les six thèmes.",
       call. = FALSE)
}

if (!dir.exists(input)) {
  stop("Le home JSON canonique est absent : ", input, ".", call. = FALSE)
}
if (!requireNamespace("pkgload", quietly = TRUE)) {
  stop("Le package R `pkgload` est requis pour charger la pipeline.", call. = FALSE)
}
pkgload::load_all(pipeline_root, quiet = TRUE)

codes <- if (is.null(args$territory)) {
  NULL
} else {
  strsplit(args$territory, ",", fixed = TRUE)[[1L]]
}
if (!dir.exists(output)) dir.create(output, recursive = TRUE)
chemins <- publier_modeles_territoire_depuis_json(
  input, sortie = output, territoires = codes, strict = TRUE
)
cat(sprintf(
  "[read-models] %d modèle(s) complet(s) publié(s) sous %s\n",
  length(chemins), file.path(output, "modeles-lecture", "territoires")
))
