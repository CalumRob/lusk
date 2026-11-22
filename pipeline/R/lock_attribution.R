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
  vide <- function(type, message) {
    list(
      type = type, sources = list(), source = NULL, date_lockfile = NULL,
      message = message, expected = NULL, observed = NULL
    )
  }
  if (!length(digests)) {
    return(vide(
      "drift", "données : aucun source-digests.json, pas de référence — relock requis"
    ))
  }
  # #1109 : on ne s'arrête PAS au premier coupable. Chaque entrée du verrou
  # dont l'empreinte diffère ou qui n'a pas de référence est nommée dans le
  # message, avec sa date de lockfile. Les entrées conformes sont tues.
  anomalie <- list()
  for (id in ids_sources) {
    verrou <- registre[[id]]
    digest <- digests[[id]]
    if (is.null(verrou)) {
      anomalie[[id]] <- list(
        source_id = id, date_lockfile = NULL, expected = NULL,
        observed = if (is.null(digest)) NULL else as.character(digest$sha256),
        raison = "sans_reference"
      )
      next
    }
    date <- champ_caractere(verrou$acquired_at)
    sha_attendu <- champ_caractere(verrou$sha256)
    if (is.null(digest)) {
      anomalie[[id]] <- list(
        source_id = id, date_lockfile = date, expected = sha_attendu,
        observed = NULL, raison = "empreinte_absente"
      )
      next
    }
    sha_observe <- as.character(digest$sha256)
    if (!identical(sha_attendu, sha_observe)) {
      anomalie[[id]] <- list(
        source_id = id, date_lockfile = date, expected = sha_attendu,
        observed = sha_observe, raison = "dérive"
      )
    }
  }
  if (!length(anomalie)) {
    return(vide(
      "regression", "régression de code : entrées identiques, sortie modifiée"
    ))
  }
  decrire <- function(x) {
    if (is.null(x$date_lockfile)) {
      sprintf("pas de référence pour %s", x$source_id)
    } else {
      sprintf("%s depuis %s", x$source_id, x$date_lockfile)
    }
  }
  prefixe <- if (length(anomalie) == 1L &&
                 is.null(anomalie[[1L]]$date_lockfile)) {
    "données : "
  } else {
    "données : dérive de "
  }
  message <- paste0(
    prefixe,
    paste(vapply(anomalie, decrire, character(1)), collapse = ", "),
    ", relock requis"
  )
  if (length(anomalie) == 1L) {
    x <- anomalie[[1L]]
    detail <- character(0)
    if (!is.null(x$expected)) detail <- c(detail, paste("attendu", x$expected))
    detail <- c(detail, if (is.null(x$observed)) "empreinte observée absente" else paste("observé", x$observed))
    message <- paste0(message, " — ", paste(detail, collapse = ", "))
  }
  first <- anomalie[[1L]]
  list(
    type = "drift", sources = anomalie, source = first$source_id,
    date_lockfile = first$date_lockfile, message = message,
    expected = first$expected, observed = first$observed
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
        pretty = TRUE, na = "null", null = "null", digits = 17
      )
    },
    p
  )
  invisible(attribution)
}

# verifier_avec_attribution -----------------------------------------------------
# Wraps a verifier so a data drift is reported (non-fatal) and a code
# regression is fatal. The verifier's own error message is preserved in both.
# Only a broken lock VALUE (condition `verrou_casse`) is attributed: any other
# error propagates unchanged, unattributed (#1118).
verifier_avec_attribution <- function(verifier, args = list(),
                                      ids_sources = character(0),
                                      cache = "data/raw", sortie = "public/data",
                                      lock = NULL, digests = NULL) {
  echec <- tryCatch({
    do.call(verifier, args)
    NULL
  }, error = function(e) e)
  if (is.null(echec)) return(list())
  # #1118 : n'attribuer qu'une VALEUR de verrou cassée — la condition nommée
  # `verrou_casse` des helpers verifier_egale/verifier_vrai. Toute autre
  # erreur (artefact amont absent, lecture impossible, échec réseau) n'est pas
  # une affaire de dérive/régression de source : elle propage son message
  # d'origine, sans attribution écrite. Le run3 avait ainsi étiqueté un Parquet
  # Mobilité manquant « régression de code : entrées identiques, sortie
  # modifiée » — le wrapper comparait les digests avant de savoir QUE l'erreur
  # venait du verrou.
  if (!inherits(echec, "verrou_casse")) stop(echec)
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
