# Bootstrap du registre de publication (ADR-0049 step 2, #1142).
# `adopt` ne réécrit JAMAIS une ligne de service : il prouve chaque ressource
# contre son Artefact de ressource puis écrit uniquement registre + reçus, dans
# UNE transaction. Toute divergence refuse avant la première écriture.

erreur_adoption <- function(refus, message, comparaisons = NULL) {
  structure(list(message = message, call = NULL, refus = refus,
                 comparaisons = comparaisons),
            class = c("erreur_adoption", "error", "condition"))
}

# Adoption is the one-time bootstrap BEFORE contract migration 049. It carries
# over the legacy global comparison tokens, so a post-049 schema must refuse with
# a typed reason before any live resource or dropped global marker is read.
verifier_schema_adoption_globale <- function(con) {
  etat <- DBI::dbGetQuery(con, paste0(
    "SELECT to_regclass(current_schema() || '.scalar_comparison_publication') IS NOT NULL AS scalaire, ",
    "to_regclass(current_schema() || '.profile_comparison_publication') IS NOT NULL AS profil"))
  if (!is.data.frame(etat) || nrow(etat) != 1L ||
      !isTRUE(etat$scalaire[[1L]]) || !isTRUE(etat$profil[[1L]]))
    stop(erreur_adoption("adoption_globale_retiree", paste0(
      "adopt : adoption_globale_retiree: l'adoption est l'étape unique antérieure ",
      "à la migration 049 ; les marqueurs globaux de comparaison n'existent plus, ",
      "aucun jeton ne peut être reporté — zéro écriture.")))
  invisible(TRUE)
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
comparer_adoption_artefacts <- function(artefacts, lectures, attestations = list(),
                                        reference = NULL) {
  resultats <- lapply(names(artefacts), function(id) {
    artefact <- artefacts[[id]]
    handler <- REGISTRE_FORMES_RESSOURCE[[artefact$forme]]
    comparaison <- tryCatch({
      if (inherits(lectures[[id]], "error")) stop(lectures[[id]])
      live <- lectures[[id]]
      # Explicit, verified global-token chains only (adoption_liaisons_globales.R):
      # the handler names the columns the chain lets the comparison ignore; the
      # live rows themselves are never rewritten.
      ignorer <- if (is.function(handler$liaisons_globales))
        handler$liaisons_globales(live, artefacts, attestations) else list()
      comparaison <- comparer_lignes_persistees(handler$lignes_persistees(artefact), live,
                                                handler, ignorer)
      comparaison$motif <- if (comparaison$identique) NA_character_ else "divergence"
      # Rows equal: the per-resource marker the adoption would write must be derivable
      # from the live tokens (no invented token, no divergent existing marker). Planned
      # HERE so --dry-run and a real adopt refuse identically, before any write.
      if (comparaison$identique && is.function(handler$planifier_marqueur_adoption))
        handler$planifier_marqueur_adoption(id, artefact, live, reference, lectures, artefacts)
      comparaison
    }, error = function(e) if (inherits(e, "erreur_adoption"))
      list(identique = FALSE, motif = e$refus,
           parties = paste0(e$refus, ": ", conditionMessage(e))) else
      list(identique = FALSE, motif = "lecture",
           parties = paste0("lecture: ", conditionMessage(e))))
    data.frame(ressource = id, forme = as.character(artefact$forme),
      version = as.character(artefact$version), identique = comparaison$identique,
      motif = as.character(comparaison$motif),
      parties = paste(comparaison$parties, collapse = ","), stringsAsFactors = FALSE)
  })
  do.call(rbind, resultats)
}

adopter_artefacts <- function(builds, artefacts, dry_run = FALSE, lock = NULL,
                              registre = NULL, con = NULL, receipts_dir = NULL,
                              commit_sha = NULL, attestations = list()) {
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
      verifier_schema_adoption_globale(con)
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
      comparaisons <- comparer_adoption_artefacts(artefacts, lectures, attestations, reference)
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
          # Per-resource comparison marker, carrying over the token the live
          # comparison rows already carry (adoption_marqueurs.R); never a row rewrite.
          handler <- REGISTRE_FORMES_RESSOURCE[[as.character(artefact$forme)]]
          marqueur <- if (is.function(handler$planifier_marqueur_adoption))
            ecrire_marqueur_adoption(con, handler$planifier_marqueur_adoption(
              id, artefact, lectures[[id]], reference, lectures, artefacts)) else NULL
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
            # The comparison token adopted (the API's identity key), recorded in the
            # local receipt; the durable DB record is the marker row itself.
            comparison_token = marqueur$content_version %||% NA_character_,
            comparison_marker = marqueur$table %||% NA_character_,
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

# La ressource `aedar` est la seule dont la sortie peut manquer des fichiers
# (canoniques ou manifeste de comparaison) sans que le splitter échoue : il
# l'omet, ou la bâtit sans comparaison. Adopter « tout » sur cette sortie
# l'accepterait en silence ou planterait plus loin. Refus TYPÉ, par ressource,
# avant toute connexion : `aedar_canonique_absent` / `aedar_manifeste_absent`.
refus_aedar_adoption <- function(builds, artefacts) {
  refus <- function(motif, detail)
    data.frame(ressource = "aedar", forme = "aedar", version = NA_character_,
      identique = FALSE, motif = motif, parties = paste0(motif, ": ", detail),
      stringsAsFactors = FALSE)
  ids <- as.character(builds$ressource[as.character(builds$forme) == "aedar"])
  if (!length(ids))
    return(refus("aedar_canonique_absent", paste0("la sortie ne porte pas les fichiers ",
      "canoniques AEDAR (", paste(AEDAR_CANONICAL_FILES, collapse = ", "), ")")))
  sans <- ids[vapply(ids, function(id) is.null(artefacts[[id]]$contenu$comparison),
                     logical(1))]
  if (length(sans))
    return(refus("aedar_manifeste_absent", paste0("la sortie ne porte pas ",
      NOM_MANIFESTE_COMPARAISON_AEDAR, " : la ressource ", paste(sans, collapse = ","),
      " n'a pas de comparaison à prouver")))
  NULL
}

adopter_ressources <- function(sortie, dry_run = FALSE, root = NULL, lock = NULL,
                               registre = NULL, con = NULL, receipts_dir = NULL,
                               commit_sha = NULL, projections = NULL, reference = NULL,
                               digests = NULL, metadata_directory = NULL) {
  builds <- splitter_sortie(sortie, root = root, projections = projections,
    reference = reference, digests = digests, metadata_directory = metadata_directory)
  artefacts <- charger_artefacts_construits(builds, root)
  absent <- refus_aedar_adoption(builds, artefacts)
  if (!is.null(absent))
    stop(erreur_adoption(absent$motif, paste0("adopt : ressource aedar refusée (",
      absent$parties, ") — zéro connexion, zéro écriture."), comparaisons = absent))
  adopter_artefacts(builds, artefacts, dry_run = dry_run, lock = lock,
    registre = registre, con = con, receipts_dir = receipts_dir, commit_sha = commit_sha,
    attestations = attestations_sortie_adoption(sortie))
}

# Jetons que la SORTIE a elle-même enregistrés, lus sans connexion : la liaison
# scalaire d'un profil (scalar-serving/binding.json). Absent => NA, et la chaîne
# globale d'un profil ne peut alors pas être attestée.
attestations_sortie_adoption <- function(sortie) {
  list(scalar_binding = tryCatch(read_profile_scalar_binding(sortie),
                                 error = function(e) NA_character_))
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
