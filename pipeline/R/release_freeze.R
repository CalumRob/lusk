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
  # Pas de règle de mtime : le flux opérateur est build -> relock depuis CE run
  # -> commit du lockfile -> publication de CE run. Le lockfile est donc
  # normalement PLUS RÉCENT que les empreintes, et un checkout/merge peut en
  # réinitialiser le mtime. La fraîcheur est garantie par l'égalité de contenu
  # et par la dépendance des targets de publication à `digests_run`.
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

# La couverture des points d'entree n'est PLUS une liste statique : le test structurel (helper-provenance-audit.R) parcourt tous les appels a dbConnect / configuration_service_postgres dans R/ et scripts/ et exige un garde ou une exception documentee. Une nouvelle voie non gardee fait donc echouer la suite.
