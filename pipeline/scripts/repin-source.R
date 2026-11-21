#!/usr/bin/env Rscript
# Repin deliberate d'une source épinglée (issue #1099, ADR-0047).
#
#   Rscript pipeline/scripts/repin-source.R <source_id> [cache]     (depuis la racine)
#   Rscript scripts/repin-source.R <source_id> [cache]              (depuis pipeline/)
#
# Télécharge une fois la source, recalcule son empreinte et son vintage, puis
# REMPLACE son pin. C'est la SEULE manière autorisée de faire avancer le pin
# d'une source à pin obligatoire : aucun run ne le fait en silence.
# Sans argument valide, la source est inconnue ou absente du manifeste, le
# script échoue bruyamment.

args <- commandArgs(trailingOnly = TRUE)
if (length(args) < 1L || !nzchar(args[[1L]])) {
  stop("Usage : Rscript pipeline/scripts/repin-source.R <source_id> [cache]",
       call. = FALSE)
}

# Se placer dans pipeline/ quel que soit le répertoire d'appel : pkgload et
# les chemins relatifs du manifeste (data/raw) en dépendent.
fichier_script <- sub("^--file=", "",
                      grep("^--file=", commandArgs(FALSE), value = TRUE)[[1L]])
setwd(dirname(dirname(normalizePath(fichier_script))))
suppressPackageStartupMessages(pkgload::load_all(".", quiet = TRUE))

id <- args[[1L]]
cache <- if (length(args) >= 2L) args[[2L]] else Sys.getenv("LUSK_CACHE", unset = "data/raw")

resultat <- repin_source(id, cache = cache)
cat(sprintf(
  "Pin actualisé — %s : sha256=%s, octets=%s, téléchargé=%s, vintage=%s (%s)\n",
  id, resultat$sha256, format(resultat$bytes, scientific = FALSE),
  resultat$downloaded_at, resultat$vintage, resultat$vintage_basis
))
