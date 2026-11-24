# `apply` du Plan de publication (ADR-0049 step 2, #1137) ----------------------
# SEUL nouveau code qui ouvre une connexion de service. Tout refus (gel de
# lignage, régression de code, définition non confirmée, fermeture bloquée)
# intervient AVANT LA PREMIÈRE ÉCRITURE. Une seule transaction couvre toutes les
# ressources de la fermeture ; les reçus (base + JSON local) suivent le commit.
#
# Le lecteur de registre (`lire_listing_live_registre`) remplace le listing
# injecté LUSK_LIVE_LISTING comme source vive du plan. Le listing fichier reste
# une option hors-ligne explicite côn côté de `plan` uniquement.

erreur_apply <- function(refus, message) {
  structure(list(message = message, call = NULL, refus = refus),
            class = c("erreur_apply", "error", "condition"))
}

# Analyser `ids` : "ressource" ou "ressource@version" (rollback depuis l'artefact).
analyser_ids_apply <- function(ids) {
  if (!is.character(ids) || !length(ids))
    stop("apply requires at least one resource id", call. = FALSE)
  parties <- strsplit(ids, "@", fixed = TRUE)
  ressources <- vapply(parties, `[[`, character(1), 1L)
  versions <- vapply(parties, function(p) if (length(p) > 1L) p[[2L]] else NA_character_,
                     character(1))
  for (id in ressources) valider_identite_ressource(id)
  if (anyDuplicated(ressources))
    stop("apply received a duplicate resource id", call. = FALSE)
  data.frame(ressource = ressources, version = versions, stringsAsFactors = FALSE)
}

# Refus PUR : aucun accès à la base, aucun write. `plan` est celui que `apply`
# vient de calculer. Un refus dans une composante bloque TOUTE la fermeture.
verifier_refus_apply <- function(plan, cibles, confirm_definition = character()) {
  lignes <- plan$ressources
  indices <- match(cibles, as.character(lignes$ressource))
  if (anyNA(indices))
    stop(erreur_apply("artefact_absent",
      paste0("apply : ressource sans artefact construit : ",
             paste(cibles[is.na(indices)], collapse = ","), " — zéro écriture.")))
  cibles_lignes <- lignes[indices, , drop = FALSE]

  gel_refuse <- cibles_lignes[identical_or_false(cibles_lignes$gel, "refused"), , drop = FALSE]
  if (nrow(gel_refuse))
    stop(erreur_apply("gel", paste0(
      "apply : gel de lignage refusé pour ",
      paste(gel_refuse$ressource, gel_refuse$gel_raison, sep = "(", collapse = "), "),
      ") — zéro écriture.")))

  bloquees <- cibles_lignes[isTRUE(cibles_lignes$bloque), , drop = FALSE]
  if (nrow(bloquees))
    stop(erreur_apply("fermeture_bloquee", paste0(
      "apply : fermeture bloquée pour ",
      paste(bloquees$ressource, "(", bloquees$bloque_par, ")", collapse = "; "),
      " — zéro écriture.")))

  regressions <- cibles_lignes[identical_or_false(cibles_lignes$check, "regression"), ,
                               drop = FALSE]
  if (nrow(regressions))
    stop(erreur_apply("regression", paste0(
      "apply : régression de code pour ", paste(regressions$ressource, collapse = ","),
      " — zéro écriture.")))

  changees <- cibles_lignes[isTRUE(cibles_lignes$definition) &
                              !cibles_lignes$ressource %in% as.character(confirm_definition), ,
                            drop = FALSE]
  if (nrow(changees))
    stop(erreur_apply("definition", paste0(
      "apply : définition modifiée non confirmée pour ",
      paste(changees$ressource, "(", vapply(changees$definition_champs,
        function(x) paste(as.character(x), collapse = "+"), character(1)), ")",
        collapse = "; "),
      " — passer --confirm-definition <id> — zéro écriture.")))
  invisible(TRUE)
}

identical_or_false <- function(x, value) !is.na(x) & x == value

# Orchestration. `con` peut être injecté (tests) ; sinon la SEULE ouverture de
# connexion de service du nouveau chemin a lieu ici, avec la configuration
# privée (passfile hors dépôt). Les refus sont évalués avant toute écriture.
apply_publication <- function(ids, confirm_definition = character(), retire = FALSE,
                              root = NULL, lock = NULL, registre = NULL,
                              attributions = NULL, con = NULL,
                              receipts_dir = NULL, commit_sha = NULL) {
  analysés <- analyser_ids_apply(ids)
  owns_con <- FALSE
  if (is.null(con)) {
    config <- configuration_service_postgres()
    con <- do.call(DBI::dbConnect, c(list(drv = RPostgres::Postgres()), config))
    owns_con <- TRUE
  }
  on.exit(if (owns_con) try(DBI::dbDisconnect(con), silent = TRUE), add = TRUE)

  # Le registre vivant est la source du plan (remplace LUSK_LIVE_LISTING).
  live <- lire_listing_live_registre(con)
  builds <- construites_depuis_magasin(root)
  # Version override -> rollback depuis l'artefact de cette version.
  for (i in seq_len(nrow(analysés))) {
    if (!is.na(analysés$version[[i]])) {
      j <- match(analysés$ressource[[i]], as.character(builds$ressource))
      if (is.na(j)) stop(erreur_apply("artefact_absent", paste0(
        "apply : ressource inconnue dans le magasin : ", analysés$ressource[[i]],
        " — zéro écriture.")))
      builds$version[[j]] <- analysés$version[[i]]
    }
  }
  plan <- plan_publication(builds = builds, live = live, lock = lock,
                           registre = registre, attributions = attributions, root = root)
  cibles <- if (isTRUE(retire)) {
    analysés$ressource
  } else {
    fermeture_cascade_publication(analysés$ressource, plan$artefacts)
  }
  verifier_refus_apply(plan, cibles, confirm_definition)

  recettes <- list()
  with_publication_transaction(con, {
    for (ressource in cibles) {
      artefact <- plan$artefacts[[ressource]]
      if (is.null(artefact))
        stop(erreur_apply("artefact_absent", paste0(
          "apply : artefact absent pour ", ressource, " — zéro écriture.")))
      handler <- REGISTRE_FORMES_RESSOURCE[[as.character(artefact$forme)]]
      if (is.null(handler) || !is.function(handler$remplacer))
        stop(erreur_apply("adaptateur_absent", paste0(
          "apply : aucun adaptateur pour la forme ", artefact$forme,
          " — zéro écriture.")))
      old <- version_live_ressource(ressource, live)
      rows <- if (isTRUE(retire)) NULL else handler$projeter(artefact)
      handler$remplacer(con, ressource, rows, as.character(artefact$version),
                        retire = isTRUE(retire))
      operation <- if (isTRUE(retire)) "retire" else "apply"
      ecrire_recette_ressource(con = con, ressource = ressource,
        forme = as.character(artefact$forme), operation = operation,
        old_version = if (is.na(old)) NULL else old,
        new_version = as.character(artefact$version), commit_sha = commit_sha,
        confirmed_definition = ressource %in% as.character(confirm_definition),
        lineage_digests = artefact$digests_lignage)
      recettes[[length(recettes) + 1L]] <- list(
        ressource = ressource, forme = as.character(artefact$forme),
        operation = operation, old_version = if (is.na(old)) NULL else old,
        new_version = as.character(artefact$version),
        confirmed_definition = ressource %in% as.character(confirm_definition),
        lineage_digests = artefact$digests_lignage, commit_sha = commit_sha,
        recorded_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3Z", tz = "UTC"))
    }
  })

  # Copie locale APRÈS LE COMMIT (jamais dans la transaction).
  for (recette in recettes) ecrire_recette_locale(recette, receipts_dir)
  invisible(list(applied = vapply(recettes, `[[`, character(1), "ressource"),
                 receipts = recettes, cascade = cibles))
}
