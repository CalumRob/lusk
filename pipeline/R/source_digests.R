# source digests ----------------------------------------------------------------
# Every run records {source_id, url, sha256, bytes, acquired_at, vintage_basis,
# vintage, date_reference} for every source it actually reads, in
# `source-digests.json` beside the payload (issue #1103). The same records are
# aggregated at cache level (<cache>/source-digests.json) so the per-theme
# targets of the DAG can be combined into one run-level file.

NOM_DIGESTS <- "source-digests.json"

lire_digests_source <- function(chemin = file.path("public", "data", NOM_DIGESTS)) {
  if (!file.exists(chemin)) return(list())
  brut <- tryCatch(
    jsonlite::fromJSON(chemin, simplifyVector = FALSE),
    error = function(e) NULL
  )
  if (is.null(brut)) return(list())
  enregistrements <- if (is.list(brut) && !is.null(brut$sources)) brut$sources else brut
  if (!is.list(enregistrements) || !length(enregistrements)) return(list())
  stats::setNames(
    enregistrements,
    vapply(enregistrements, function(e) as.character(e$source_id %||% ""), character(1))
  )
}

# Une seule empreinte par source_id — la plus récente gagne (issue #1103,
# revue). `lire_digests_source` nomme déjà les enregistrements par source_id.
deduper_digests <- function(digests) {
  if (!length(digests)) return(list())
  ids <- vapply(digests, function(d) as.character(d$source_id %||% ""), character(1))
  garder <- rev(!duplicated(rev(ids)))
  stats::setNames(digests[garder], ids[garder])
}

ecrire_digests_source <- function(digests, chemin = file.path("public", "data", NOM_DIGESTS)) {
  digests <- deduper_digests(digests)
  dossier <- dirname(chemin)
  dir.create(dossier, recursive = TRUE, showWarnings = FALSE)
  ecrire_atomique(
    function(temporaire) {
      jsonlite::write_json(
        unname(digests), temporaire, auto_unbox = TRUE,
        pretty = TRUE, na = "null", digits = 17
      )
    },
    chemin
  )
  invisible(digests)
}

chemin_digests_cache <- function(cache = "data/raw") {
  file.path(cache, NOM_DIGESTS)
}

lire_digests_cache_aggregate <- function(cache = "data/raw") {
  lire_digests_source(chemin_digests_cache(cache))
}

ecrire_digests_cache_aggregate <- function(digests, cache = "data/raw") {
  deja <- lire_digests_cache_aggregate(cache)
  fusion <- deduper_digests(c(deja, digests))
  ecrire_digests_source(fusion, chemin_digests_cache(cache))
  invisible(fusion)
}

# verifier_digests_couvrent -----------------------------------------------------
# A source read by the run but absent from the digests fails the contract.
# "Read" = a positive statut (frais / à traiter à la main); a failed download
# has no bytes and is not expected to carry a digest.
verifier_digests_couvrent <- function(statuts, digests) {
  if (is.null(statuts) || !is.data.frame(statuts) || !"id" %in% names(statuts)) {
    return(invisible(TRUE))
  }
  lus <- if ("status" %in% names(statuts)) {
    as.character(statuts$id[statuts$status %in% "frais"])
  } else {
    as.character(statuts$id)
  }
  manquants <- setdiff(lus, names(digests))
  if (length(manquants)) {
    stop(
      "Contrat source-digests.json : source lue sans empreinte — ",
      paste(manquants, collapse = ", "), ".",
      call. = FALSE
    )
  }
  invisible(TRUE)
}
