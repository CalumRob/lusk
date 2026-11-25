# Bootstrap du registre de publication (ADR-0049 step 2, #1142).
# `adopt` ne réécrit JAMAIS une ligne de service : il prouve chaque ressource
# contre son Artefact de ressource puis écrit uniquement registre + reçus, dans
# UNE transaction. Toute divergence refuse avant la première écriture.

erreur_adoption <- function(refus, message, comparaisons = NULL) {
  structure(list(message = message, call = NULL, refus = refus,
                 comparaisons = comparaisons),
            class = c("erreur_adoption", "error", "condition"))
}

verifier_lecteurs_adoption <- function(artefacts) {
  manquants <- character()
  for (id in names(artefacts)) {
    artefact <- artefacts[[id]]
    handler <- if (is.list(artefact)) REGISTRE_FORMES_RESSOURCE[[artefact$forme]] else NULL
    if (is.null(handler) || !is.function(handler$projeter) ||
        !is.function(handler$lire_live) || !is.function(handler$lignes_persistees))
      manquants <- c(manquants, paste0(id, "(", artefact$forme, ")"))
  }
  if (length(manquants))
    stop(erreur_adoption("lecteur_absent", paste0(
      "adopt : lecteur live absent pour ", paste(manquants, collapse = ", "),
      " — zéro connexion, zéro écriture.")))
  invisible(TRUE)
}

# Comparaison pure d'un jeu d'artefacts contre des lignes live déjà lues. Elle
# est séparée de l'orchestration pour que tous les refus soient cumulés avant
# tout write, au lieu de s'arrêter au premier indicateur fautif.
comparer_adoption_artefacts <- function(artefacts, lectures) {
  resultats <- lapply(names(artefacts), function(id) {
    artefact <- artefacts[[id]]
    handler <- REGISTRE_FORMES_RESSOURCE[[artefact$forme]]
    comparaison <- tryCatch({
      if (inherits(lectures[[id]], "error")) stop(lectures[[id]])
      live <- if (is.function(handler$normaliser_live))
        handler$normaliser_live(lectures[[id]], artefacts, lectures) else lectures[[id]]
      comparer_lignes_persistees(handler$lignes_persistees(artefact), live, handler)
    }, error = function(e) list(identique = FALSE,
      parties = paste0("lecture: ", conditionMessage(e))))
    data.frame(ressource = id, forme = as.character(artefact$forme),
      version = as.character(artefact$version), identique = comparaison$identique,
      parties = paste(comparaison$parties, collapse = ","), stringsAsFactors = FALSE)
  })
  do.call(rbind, resultats)
}

adopter_artefacts <- function(builds, artefacts, dry_run = FALSE, lock = NULL,
                              registre = NULL, con = NULL, receipts_dir = NULL,
                              commit_sha = NULL) {
  if (!is.data.frame(builds) || !nrow(builds) ||
      !all(c("ressource", "forme", "version") %in% names(builds)))
    stop(erreur_adoption("artefact_absent",
      "adopt : la sortie ne contient aucune ressource — zéro connexion, zéro écriture."))
  ids <- as.character(builds$ressource)
  if (anyDuplicated(ids) || !setequal(ids, names(artefacts)))
    stop(erreur_adoption("artefact_absent",
      "adopt : les artefacts ne correspondent pas exactement à la sortie — zéro écriture."))
  artefacts <- artefacts[ids]
  incoherents <- vapply(seq_along(ids), function(i) {
    artefact <- artefacts[[i]]
    !identical(as.character(artefact$forme), as.character(builds$forme[[i]])) ||
      !identical(as.character(artefact$version), as.character(builds$version[[i]]))
  }, logical(1))
  if (any(incoherents))
    stop(erreur_adoption("artefact_absent",
      "adopt : une adresse d'artefact ne correspond pas à la sortie — zéro écriture."))
  verifier_lecteurs_adoption(artefacts)

  avec_session_service_publication(artefacts, ids, lock = lock, registre = registre,
    con = con, code = function(con) {
    comparaisons <- list()
    with_publication_transaction(con, {
      # EXACTEMENT le même setup de session qu'apply : isolation, verrou et
      # préflight de référence partagés, avant la première lecture live.
      reference <- preparer_session_service_publication(con, artefacts, ids,
                                                         operation = "adopt")

      lectures <- list()
      for (id in ids) {
        artefact <- artefacts[[id]]
        handler <- REGISTRE_FORMES_RESSOURCE[[artefact$forme]]
        lectures[[id]] <- tryCatch({
          lignes_attendues <- handler$lignes_persistees(artefact)
          handler$lire_live(con, id, reference, lignes_attendues,
                            handler$colonnes_tableau %||% list(),
                            handler$colonnes_stockage %||% list())
        }, error = function(e) e)
      }
      comparaisons <- comparer_adoption_artefacts(artefacts, lectures)
      if (!dry_run && any(!comparaisons$identique)) {
        details <- paste0(comparaisons$ressource[!comparaisons$identique],
                          " (", comparaisons$parties[!comparaisons$identique], ")")
        stop(erreur_adoption("ressource_divergente", paste0(
          "adopt : ressources divergentes : ", paste(details, collapse = "; "),
          " — zéro écriture."), comparaisons = comparaisons))
      }
      recettes <- list()
      if (!dry_run) {
        recettes <- lapply(ids, function(id) {
          artefact <- artefacts[[id]]
          ecrire_registre_ressource(con, id, as.character(artefact$forme),
            as.character(artefact$version),
            reference_content_version = reference$version, retired = FALSE)
          # Migration 048: discovery descriptors are version-bound to the
          # registry row and travel through the SAME shared writer as apply.
          ecrire_descripteurs_ressource(con, artefact)
          ecrire_recette_ressource(con = con, ressource = id,
            # The DB event stores the verb allowed by api/schema.sql:1376
            # (apply/retire/adopt); the local receipt keeps the "adopted" status.
            forme = as.character(artefact$forme), operation = "adopt",
            old_version = NULL, new_version = as.character(artefact$version),
            commit_sha = commit_sha, confirmed_definition = FALSE,
            lineage_digests = artefact$digests_lignage)
          list(ressource = id, forme = as.character(artefact$forme),
            operation = "adopted", old_version = NULL,
            new_version = as.character(artefact$version), confirmed_definition = FALSE,
            lineage_digests = artefact$digests_lignage, commit_sha = commit_sha,
            recorded_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3Z", tz = "UTC"))
        })
      }
      # Force receipt creation inside the transaction; lapply's value is the
      # commit boundary's only result and no serving writer is ever called.
      recettes
    })
    if (!dry_run) for (recette in recettes) ecrire_recette_locale(recette, receipts_dir)
    invisible(list(adopted = if (dry_run) character() else ids,
      comparaisons = comparaisons, receipts = if (dry_run) list() else recettes))
  })
}

adopter_ressources <- function(sortie, dry_run = FALSE, root = NULL, lock = NULL,
                               registre = NULL, con = NULL, receipts_dir = NULL,
                               commit_sha = NULL, projections = NULL, reference = NULL,
                               digests = NULL, metadata_directory = NULL) {
  builds <- splitter_sortie(sortie, root = root, projections = projections,
    reference = reference, digests = digests, metadata_directory = metadata_directory)
  artefacts <- charger_artefacts_construits(builds, root)
  adopter_artefacts(builds, artefacts, dry_run = dry_run, lock = lock,
    registre = registre, con = con, receipts_dir = receipts_dir, commit_sha = commit_sha)
}

imprimer_adoption <- function(resultat, con = stdout()) {
  for (i in seq_len(nrow(resultat$comparaisons))) {
    ligne <- resultat$comparaisons[i, , drop = FALSE]
    cat(sprintf(paste0("adoption ressource=%s forme=%s version=%s status=%s parties=%s\n"),
      ligne$ressource, ligne$forme, ligne$version,
      if (ligne$identique) "match" else "refused", ligne$parties), file = con)
  }
  refuse <- any(!resultat$comparaisons$identique)
  cat(sprintf(paste0("adoption=%s adopted=%s zero_data_writes=true\n"),
    if (refuse) "refused" else "match", paste(resultat$adopted, collapse = ",")), file = con)
  invisible(resultat)
}
