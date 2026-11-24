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

# Noyau UNIQUE du gel de release (refactor #1136). `verifier_gel_release` et
# le gel de lignage du Plan de publication appellent la même fonction : il n'y
# a qu'une sémantique de gel, pas deux.
#   ids = NULL                     -> toutes les empreintes fournies ;
#   ids = <ids du lignage>         -> seulement ces sources (ADR-0049 déc. 5
#                                     amendée : une source hors lignage est
#                                     étrangère à la ressource, elle ne la
#                                     refuse pas).
#   exiger_couverture = TRUE       -> une source verrouillée que le run n'a pas
#                                     lue refuse (comportement historique) ;
#   exiger_couverture = FALSE      -> le gel de lignage n'impose pas cette
#                                     couverture globale.
evaluer_gel_empreintes <- function(digests, registre, ids = NULL,
                                   exiger_couverture = TRUE,
                                   chemin = "source-digests.json") {
  if (!length(digests)) {
    stop(erreur_gel_release(
      "digests_absents",
      paste0("Gel de release : ", chemin,
             " vide — publication refusée, zéro écriture. Relock requis.")
    ))
  }
  ids_digest <- vapply(digests, function(d) {
    id <- champ_caractere(d$source_id)
    if (is.na(id)) "" else id
  }, character(1))
  cibles <- if (is.null(ids)) seq_along(digests) else which(ids_digest %in% as.character(ids))
  for (i in cibles) {
    id <- ids_digest[[i]]
    # Une entrée explicite `absent = TRUE` (source de la provenance sans
    # empreinte dans source-digests.json) n'est pas une attestation. Même
    # raison, même message que le garde global : une seule implementation.
    digest <- digests[[i]]
    if (isTRUE(digest$absent) || is.na(champ_caractere(digest$sha256))) {
      stop(erreur_gel_release(
        "empreinte_absente",
        paste0("Gel de release : empreinte absente pour ", id,
               " — publication refusée, zéro écriture. Relock requis.")
      ))
    }
    verrou <- registre[[id]]
    if (is.null(verrou)) {
      stop(erreur_gel_release(
        "sans_reference",
        paste0("Gel de release : aucune référence pour '", id,
               "' dans sources.lock.json — publication refusée, zéro écriture. Relock requis.")
      ))
    }
    attendu <- champ_caractere(verrou$sha256)
    observe <- champ_caractere(digests[[i]]$sha256)
    if (!identical(attendu, observe)) {
      stop(erreur_gel_release(
        "derive",
        paste0("Gel de release : dérive de '", id, "' depuis ",
               champ_caractere(verrou$acquired_at),
               " — publication refusée, zéro écriture. Relock requis (attendu ",
               attendu, ", observé ", observe, ").")
      ))
    }
  }
  if (exiger_couverture) {
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
  }
  invisible(TRUE)
}

verifier_gel_release <- function(sortie, lock = NULL, digests = NULL) {
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
  evaluer_gel_empreintes(digests, lire_lock(lock), chemin = chemin_digests)
}

# La couverture des points d'entree n'est PLUS une liste statique : le test structurel (helper-provenance-audit.R) parcourt tous les appels a dbConnect / configuration_service_postgres dans R/ et scripts/ et exige un garde ou une exception documentee. Une nouvelle voie non gardee fait donc echouer la suite.
