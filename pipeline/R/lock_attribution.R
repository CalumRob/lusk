# Lock attribution (issue #1103) ------------------------------------------------
# When a real-data lock (`verifier_*_reel`) fails, its inputs are compared to
# the committed source lockfile using the run's recorded digests:
#   - at least one input differs from the lockfile (or has no baseline) =>
#     DATA DRIFT: report "données : dérive de <source> depuis <date>, relock
#     requis" with expected/observed, NOT fatal, recorded in the run report;
#   - every input equals the lockfile and the value moved => CODE REGRESSION:
#     "régression de code : entrées identiques, sortie modifiée", fatal.
# Safety: publication requires every digest to equal the lockfile, so in a
# publishable run a failing lock is always a regression, never masked drift.

NOM_ATTRIBUTIONS <- "verif-attributions.json"

# sources_verification ----------------------------------------------------------
# The per-lock input source ids: the `args` ids (excluding sentinelles) or,
# for `sur_brut`, every source of the theme manifest.
sources_verification <- function(spec, manifest = NULL) {
  ids <- character(0)
  if (isTRUE(spec$sur_brut) && !is.null(manifest)) {
    ids <- c(ids, as.character(manifest$id))
  }
  for (param in names(spec$args)) {
    id <- spec$args[[param]]
    if (!id %in% c("epci", "raccordement", "published")) ids <- c(ids, id)
  }
  unique(ids)
}

# attribuer_echec_lock ----------------------------------------------------------
attribuer_echec_lock <- function(ids_sources, digests = list(), lock = NULL) {
  registre <- lire_lock(lock)
  if (!length(digests)) {
    return(list(
      type = "drift", source = NULL,
      message = "données : aucun source-digests.json, pas de référence — relock requis",
      expected = NULL, observed = NULL
    ))
  }
  for (id in ids_sources) {
    verrou <- registre[[id]]
    digest <- digests[[id]]
    if (is.null(verrou)) {
      return(list(
        type = "drift", source = id, date_lockfile = NULL,
        message = sprintf("données : pas de référence pour %s, relock requis", id),
        expected = NULL, observed = if (is.null(digest)) NULL else digest$sha256
      ))
    }
    if (is.null(digest)) {
      return(list(
        type = "drift", source = id, date_lockfile = as.character(verrou$acquired_at),
        message = sprintf(
          "données : dérive de %s depuis %s, relock requis (empreinte observée absente)",
          id, as.character(verrou$acquired_at)
        ),
        expected = as.character(verrou$sha256), observed = NULL
      ))
    }
    sha_attendu <- as.character(verrou$sha256)
    sha_observe <- as.character(digest$sha256)
    if (!identical(sha_attendu, sha_observe)) {
      return(list(
        type = "drift", source = id, date_lockfile = as.character(verrou$acquired_at),
        message = sprintf(
          "données : dérive de %s depuis %s, relock requis — attendu %s, observé %s",
          id, as.character(verrou$acquired_at), sha_attendu, sha_observe
        ),
        expected = sha_attendu, observed = sha_observe
      ))
    }
  }
  list(
    type = "regression", source = NULL, message = "régression de code : entrées identiques, sortie modifiée",
    expected = NULL, observed = NULL
  )
}

# enregistrer_attribution_derive / lire_attributions ---------------------------
lire_attributions <- function(sortie = "public/data") {
  p <- file.path(sortie, NOM_ATTRIBUTIONS)
  if (!file.exists(p)) return(list())
  tryCatch(jsonlite::fromJSON(p, simplifyVector = FALSE), error = function(e) list())
}

enregistrer_attribution_derive <- function(attribution, sortie = "public/data") {
  p <- file.path(sortie, NOM_ATTRIBUTIONS)
  dir.create(sortie, recursive = TRUE, showWarnings = FALSE)
  deja <- lire_attributions(sortie)
  ecrire_atomique(
    function(temporaire) {
      jsonlite::write_json(
        c(deja, list(attribution)), temporaire, auto_unbox = TRUE,
        pretty = TRUE, na = "null", digits = 17
      )
    },
    p
  )
  invisible(attribution)
}

# verifier_avec_attribution -----------------------------------------------------
# Wraps a verifier so a data drift is reported (non-fatal) and a code
# regression is fatal. The verifier's own error message is preserved in both.
verifier_avec_attribution <- function(verifier, args = list(),
                                      ids_sources = character(0),
                                      cache = "data/raw", sortie = "public/data",
                                      lock = NULL, digests = NULL) {
  echec <- tryCatch({
    do.call(verifier, args)
    NULL
  }, error = function(e) e)
  if (is.null(echec)) return(list())
  if (is.null(digests)) digests <- lire_digests_source(chemin_digests_cache(cache))
  attribution <- attribuer_echec_lock(ids_sources, digests, lock)
  if (identical(attribution$type, "regression")) {
    stop(
      attribution$message, " — ", conditionMessage(echec),
      call. = FALSE
    )
  }
  attribution$verrou <- conditionMessage(echec)
  enregistrer_attribution_derive(attribution, sortie)
  # La valeur de la cible EST l'attribution : le rapport du run en dépend
  # directement (pas seulement d'un fichier latéral, #1103 revue).
  attribution
}
