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

# Lectures réseau hors manifeste (issue #1103, revue) ---------------------------
# Les couches WFS du fond de carte sont lues à chaque run mais ne sont dans
# aucun MANIFEST_* : elles portent une base `telechargement` déclarée ici et
# entrent dans la couverture comme dans le gel.
LECTURES_RESEAU <- stats::setNames(
  lapply(c("geometrie_communes", "geometrie_epcis", "geometrie_departements"),
         function(id) list(source_id = id, vintage_basis = "telechargement")),
  c("geometrie_communes", "geometrie_epcis", "geometrie_departements")
)

verifier_digests_couvrent_lectures_reseau <- function(digests) {
  manquants <- setdiff(names(LECTURES_RESEAU), names(digests))
  if (length(manquants)) {
    stop(
      "Contrat lectures réseau : couche lue sans empreinte — ",
      paste(manquants, collapse = ", "), ".", call. = FALSE
    )
  }
  invisible(TRUE)
}

# ids_digests_publication / filtrer_digests_ids ---------------------------------
# Le cache agrégé survit aux runs : on ne projette que les sources encore
# déclarées par les manifestes du run ET les lectures réseau enregistrées
# (géométrie). Une source retirée ne doit pas rester dans source-digests.json —
# le garde la refuserait ensuite avec `sans_reference` (issue #1103, revue 2).
# `manifestes` est la LISTE des manifestes que LE GRAPHE télécharge réellement
# (thèmes du run + classifications partagées + Programmes sur run complet).
# `themes` reste accepté pour les appelants historiques (descripteurs de thème).
# Aucune liste d'ids maintenue à la main : un manifeste ajouté au run entre
# automatiquement dans la couverture (issue #1109).
ids_digests_publication <- function(themes = NULL, manifestes = list()) {
  manifestes <- c(
    if (is.null(themes)) list() else lapply(themes, function(t) {
      if (!is.null(t$manifest)) t$manifest else NULL
    }),
    manifestes
  )
  ids <- unlist(lapply(manifestes, function(m) {
    if (is.data.frame(m) && "id" %in% names(m)) as.character(m$id) else character(0)
  }), use.names = FALSE)
  unique(c(ids, names(LECTURES_RESEAU)))
}

filtrer_digests_ids <- function(digests, ids) {
  digests[names(digests) %in% ids]
}

# Sources réellement lues par un run --------------------------------------------
# Les statuts renvoyés par chaque `download_sources()` du graphe portent en
# attribut les digests calculés par le résolveur. Un id au statut « frais » est
# une source LUE : son empreinte doit figurer dans le fichier publié. Les
# sources « à traiter à la main » (mode cron) ne sont pas lues et n'attendent
# donc pas d'empreinte.
statuts_liste <- function(statuts) {
  if (is.null(statuts)) return(list())
  if (is.data.frame(statuts)) list(statuts) else statuts
}

ids_sources_lues <- function(statuts) {
  ids <- unlist(lapply(statuts_liste(statuts), function(s) {
    if (!is.data.frame(s) || !"id" %in% names(s)) return(character(0))
    if ("status" %in% names(s)) as.character(s$id[s$status %in% "frais"]) else as.character(s$id)
  }), use.names = FALSE)
  unique(ids)
}

digests_sources_lus <- function(statuts) {
  digests <- unlist(lapply(statuts_liste(statuts), function(s) attr(s, "digests")),
                    recursive = FALSE)
  deduper_digests(digests)
}

verifier_digests_couvrent_ids <- function(ids, digests) {
  manquants <- setdiff(as.character(ids), names(digests))
  if (length(manquants)) {
    stop(
      "Contrat source-digests.json : source lue sans empreinte publiée — ",
      paste(manquants, collapse = ", "), ".",
      call. = FALSE
    )
  }
  invisible(TRUE)
}

# Projection finale du run : on ne publie que les sources réellement lues
# (téléchargements du graphe + lectures réseau géométrie), jamais le résidu
# d'un cache longuement partagé. Le contrat porte sur le FICHIER PUBLÉ — une
# source lue absente du fichier fait échouer `digests_run` (#1109).
publier_digests_run <- function(statuts = list(), cache = "data/raw",
                                sortie = "public/data") {
  ids_attendus <- c(ids_sources_lues(statuts), names(LECTURES_RESEAU))
  digests <- filtrer_digests_ids(
    c(
      lire_digests_source(file.path(sortie, NOM_DIGESTS)),  # géométrie / lectures réseau
      lire_digests_source(chemin_digests_cache(cache)),     # manifestes du cache
      digests_sources_lus(statuts)                          # téléchargements du run
    ),
    ids_attendus
  )
  ecrire_digests_source(digests, file.path(sortie, NOM_DIGESTS))
  verifier_digests_couvrent_ids(
    ids_attendus, lire_digests_source(file.path(sortie, NOM_DIGESTS))
  )
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
