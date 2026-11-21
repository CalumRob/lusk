# Release freeze (issue #1103) --------------------------------------------------
# ONE guard, called before ANY connection or write by EVERY DB-publication
# entry point (LUSK_PUBLISH_DB target, publish-serving-tables modes,
# publish-aedar-aggregates, retained/scoped publishers, declared profiles,
# offering bridge, operator connection via run_pipeline). It refuses with ZERO
# writes when the run's source-digests.json differs from sources.lock.json.
# Cron and static builds never call it — they adopt new bytes and record them.

erreur_gel_release <- function(raison, message) {
  structure(
    list(message = message, call = NULL, raison = raison),
    class = c("erreur_gel_release", "error", "condition")
  )
}

verifier_gel_release <- function(sortie = Sys.getenv("LUSK_SORTIE",
                                                     unset = file.path("..", "public", "data")),
                                 lock = NULL, digests = NULL) {
  chemin_digests <- file.path(sortie, NOM_DIGESTS)
  if (is.null(digests)) {
    if (!file.exists(chemin_digests)) {
      stop(erreur_gel_release(
        "digests_absents",
        paste0("Gel de release : ", chemin_digests,
               " absent — publication refusée, zéro écriture. Relock requis.")
      ))
    }
    digests <- lire_digests_source(chemin_digests)
  }
  if (!length(digests)) {
    stop(erreur_gel_release(
      "digests_absents",
      paste0("Gel de release : ", chemin_digests,
             " vide — publication refusée, zéro écriture. Relock requis.")
    ))
  }
  chemin_lock <- chemin_lock(lock)
  if (file.exists(chemin_lock) && file.exists(chemin_digests) &&
      file.mtime(chemin_digests) < file.mtime(chemin_lock)) {
    stop(erreur_gel_release(
      "digests_perimes",
      paste0("Gel de release : ", chemin_digests,
             " est plus ancien que ", chemin_lock,
             " — publication refusée, zéro écriture. Relock requis.")
    ))
  }
  registre <- lire_lock(lock)
  ids_digest <- vapply(digests, function(d) as.character(d$source_id %||% ""), character(1))
  for (i in seq_along(digests)) {
    id <- ids_digest[[i]]
    verrou <- registre[[id]]
    if (is.null(verrou)) {
      stop(erreur_gel_release(
        "sans_reference",
        paste0("Gel de release : aucune référence pour '", id,
               "' dans sources.lock.json — publication refusée, zéro écriture. Relock requis.")
      ))
    }
    attendu <- as.character(verrou$sha256)
    observe <- as.character(digests[[i]]$sha256)
    if (!identical(attendu, observe)) {
      stop(erreur_gel_release(
        "derive",
        paste0("Gel de release : dérive de '", id, "' depuis ",
               as.character(verrou$acquired_at),
               " — publication refusée, zéro écriture. Relock requis (attendu ",
               attendu, ", observé ", observe, ").")
      ))
    }
  }
  # A locked source the run did not read cannot be attested either.
  manquants <- setdiff(names(registre), ids_digest)
  if (length(manquants)) {
    stop(erreur_gel_release(
      "empreinte_absente",
      paste0("Gel de release : empreinte absente pour ",
             paste(manquants, collapse = ", "),
             " — publication refusée, zéro écriture. Relock requis.")
    ))
  }
  invisible(TRUE)
}

# ENTRY_POINTS_GEL_RELEASE -------------------------------------------------------
# Enumerated so a new publication path cannot silently skip the guard. Each
# entry is (file, symbol) — the test checks the guard call is present in each.
ENTRY_POINTS_GEL_RELEASE <- list(
  list(symbol = "publish_retained_backend_from_parquet",
       file = "R/publish_postgres_configuration.R",
       why = "cible publie_backend_retained (LUSK_PUBLISH_DB) et reprise CLI"),
  list(symbol = "publier_declared_profiles_postgres",
       file = "R/publish_profile.R",
       why = "profils déclarés, cible publie_profiles_declares"),
  list(symbol = "publier_structure_age_profile_postgres",
       file = "R/publish_profile.R",
       why = "profile structure_age -- publication directe"),
  # Le pont offre_tc (#1072) est un outil de RECOVERY hors périmètre (#1103,
  # « out of scope ») : il n'est pas une voie de publication ordinaire.
  list(symbol = "scripts/publish-serving-tables.R", file = "scripts/publish-serving-tables.R",
       why = "modes --programme-publish, --programme-series-publish, --owned-series-publish, --series-publish"),
  list(symbol = "scripts/publish-aedar-aggregates.R", file = "scripts/publish-aedar-aggregates.R",
       why = "mode --publish")
)
