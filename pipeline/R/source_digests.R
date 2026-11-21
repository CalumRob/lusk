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

ecrire_digests_source <- function(digests, chemin = file.path("public", "data", NOM_DIGESTS)) {
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
  ecrire_digests_source(c(deja, digests), chemin_digests_cache(cache))
  invisible(digests)
}

# verifier_digests_couvrent -----------------------------------------------------
# A source read by the run but absent from the digests fails the contract.
# "Read" = a positive statut (frais / à traiter à la main); a failed download
# has no bytes and is not expected to carry a digest.
verifier_digests_couvrent <- function(statuts, digests) {
  if (is.null(statuts) || !is.data.frame(statuts) || !"id" %in% names(statuts)) {
    return(invisible(TRUE))
  }
  lus <- as.character(statuts$id)
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
