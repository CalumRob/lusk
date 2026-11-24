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

# Refus PUR : aucun accès à la base, aucun write. Le verdict est recomposé à
# partir des CAUSES du plan (gel, régression, définition), puis propagé à toute
# la composante de fermeture. Une confirmation ne lève QUE la cause « définition
# modifiée » de la ressource nommée : gel / empreinte absente / régression /
# autre membre non confirmé continuent de bloquer. Le champ `bloque` du plan
# reste le verdict d'affichage (sans confirmation) — on ne le contourne pas, on
# réévalue ses causes avec la confirmation fournie.
verifier_refus_apply <- function(plan, cibles, confirm_definition = character()) {
  lignes <- plan$ressources
  indices <- match(cibles, as.character(lignes$ressource))
  if (anyNA(indices))
    stop(erreur_apply("artefact_absent",
      paste0("apply : ressource sans artefact construit : ",
             paste(cibles[is.na(indices)], collapse = ","), " — zéro écriture.")))
  confirmes <- as.character(confirm_definition)

  cause_ligne <- function(i) {
    ressource <- as.character(lignes$ressource[[i]])
    causes <- list()
    if (isTRUE(identical_or_false(lignes$gel[[i]], "refused"))) {
      detail <- if ("gel_detail" %in% names(lignes) &&
                    !is.na(lignes$gel_detail[[i]]) && nzchar(lignes$gel_detail[[i]]))
        paste0(": ", lignes$gel_detail[[i]]) else ""
      causes[[length(causes) + 1L]] <- list(
        type = "gel", ressource = ressource,
        motif = paste0(ressource, " (", lignes$gel_raison[[i]], detail, ")"))
    }
    if (isTRUE(identical_or_false(lignes$check[[i]], "regression")))
      causes[[length(causes) + 1L]] <- list(
        type = "regression", ressource = ressource,
        motif = paste0(ressource, " (régression)"))
    if (isTRUE(lignes$definition[[i]]) && !ressource %in% confirmes) {
      champs <- lignes$definition_champs[[i]]
      causes[[length(causes) + 1L]] <- list(
        type = "definition", ressource = ressource,
        motif = paste0(ressource, " (definition: ",
                       paste(as.character(champs), collapse = "+"), ")"))
    }
    causes
  }

  # Propagation au sein de la fermeture : une cause sur un membre bloque TOUTE
  # sa composante, car les ressources sont publiées dans la même transaction.
  groupes <- if (!is.null(plan$artefacts) && length(plan$artefacts))
    composantes_cascade(cibles, plan$artefacts) else list(cibles)
  for (groupe in groupes) {
    causes <- unlist(lapply(groupe, function(id)
      cause_ligne(match(id, as.character(lignes$ressource)))), recursive = FALSE)
    if (!length(causes)) next
    types <- unique(vapply(causes, `[[`, character(1), "type"))
    refus <- if (length(types) == 1L) types[[1L]] else "fermeture_bloquee"
    prefix <- switch(refus,
      gel = "gel de lignage refusé pour ",
      regression = "régression de code pour ",
      definition = "définition modifiée non confirmée pour ",
      "fermeture bloquée pour ")
    suffix <- if (identical(refus, "definition"))
      " — passer --confirm-definition <id> — zéro écriture." else " — zéro écriture."
    stop(erreur_apply(refus, paste0("apply : ", prefix,
      paste(vapply(causes, `[[`, character(1), "motif"), collapse = "; "), suffix)))
  }
  invisible(TRUE)
}

identical_or_false <- function(x, value) !is.na(x) & x == value

# Charger les artefacts construits SANS connexion : le préflight (adaptateurs,
# gel) travaille sur le magasin local avant même l'ouverture de la base.
charger_artefacts_construits <- function(builds, root = NULL) {
  artefacts <- list()
  for (i in seq_len(nrow(builds))) {
    id <- as.character(builds$ressource[[i]])
    version <- as.character(builds$version[[i]])
    forme <- if ("forme" %in% names(builds)) as.character(builds$forme[[i]]) else NULL
    artefacts[[id]] <- lire_artefact_ressource(id, version, root = root, forme = forme)
  }
  artefacts
}

# Refus PRÉFLIGHT : chaque membre de la fermeture doit avoir un adaptateur de
# sa forme. Aucune connexion, aucune écriture — y compris `projeter` pour un
# `apply` normal (la retirement n'a besoin que de `remplacer`).
verifier_adaptateurs_apply <- function(cibles, artefacts, retire = FALSE) {
  manquants <- character()
  for (ressource in cibles) {
    artefact <- artefacts[[ressource]]
    forme <- if (is.null(artefact)) NA_character_ else as.character(artefact$forme)
    handler <- if (is.na(forme)) NULL else REGISTRE_FORMES_RESSOURCE[[forme]]
    if (is.na(forme) || is.null(handler) || !is.function(handler$remplacer) ||
        (!isTRUE(retire) && !is.function(handler$projeter))) {
      manquants <- c(manquants, paste0(ressource, "(",
        if (is.na(forme)) "?" else forme, ")"))
    }
  }
  if (length(manquants))
    stop(erreur_apply("adaptateur_absent", paste0(
      "apply : aucun adaptateur pour ", paste(manquants, collapse = ", "),
      " — zéro connexion, zéro écriture.")))
  invisible(TRUE)
}

# Référence territoriale : `apply` ne la publie JAMAIS (changement de classe E,
# ADR-0049) — il la LIT sous le verrou du producteur de référence, dans sa
# propre transaction et AVANT tout write. Un artefact est lié à la version de
# référence portée par sa comparaison ; lire une autre version (ou aucune)
# doit refuser avec une raison NOMMÉE, jamais une erreur de trigger SQL.
verifier_reference_live_apply <- function(con, artefacts, cibles) {
  attendus <- unique(unlist(lapply(cibles, function(id) {
    artefact <- artefacts[[id]]
    comparaison <- if (is.list(artefact)) artefact$contenu$comparison else NULL
    if (is.list(comparaison) && !is.null(comparaison$reference_content_version))
      as.character(comparaison$reference_content_version)[[1L]] else NULL
  }), use.names = FALSE))
  attendus <- attendus[!is.na(attendus) & nzchar(attendus)]
  if (!length(attendus)) return(invisible(TRUE))
  if (length(attendus) > 1L)
    stop(erreur_apply("reference_divergente", paste0(
      "apply : reference_divergente: artefacts liés à plusieurs références (",
      paste(attendus, collapse = ","), ") — zéro écriture.")))
  live <- DBI::dbGetQuery(con,
    "SELECT content_version FROM table_publication WHERE table_name='territory_reference'")
  version_live <- if (is.data.frame(live) && nrow(live) &&
                      !is.na(live$content_version[[1L]]))
    as.character(live$content_version[[1L]]) else NA_character_
  if (is.na(version_live) || !nzchar(version_live))
    stop(erreur_apply("reference_absente", paste0(
      "apply : reference_absente: aucune référence territoriale publiée ",
      "(table_publication['territory_reference']) — zéro écriture.")))
  if (!identical(version_live, attendus[[1L]]))
    stop(erreur_apply("reference_divergente", paste0(
      "apply : reference_divergente: live ", version_live,
      ", artefact ", attendus[[1L]], " — zéro écriture.")))
  invisible(TRUE)
}

# Orchestration. `con` peut être injecté (tests) ; sinon la SEULE ouverture de
# connexion de service du nouveau chemin a lieu ici, avec la configuration
# privée (passfile hors dépôt). Les refus sont évalués avant toute écriture.
apply_publication <- function(ids, confirm_definition = character(), retire = FALSE,
                              root = NULL, lock = NULL, registre = NULL,
                              attributions = NULL, con = NULL,
                              receipts_dir = NULL, commit_sha = NULL) {
  analysés <- analyser_ids_apply(ids)

  # --- PRÉFLIGHT 100% LOCAL : aucune connexion, aucune écriture -------------
  builds <- construites_depuis_magasin(root)
  # Version override -> rollback depuis l'artefact de cette version.
  for (i in seq_len(nrow(analysés))) {
    if (!is.na(analysés$version[[i]])) {
      j <- match(analysés$ressource[[i]], as.character(builds$ressource))
      if (is.na(j)) stop(erreur_apply("artefact_absent", paste0(
        "apply : ressource inconnue dans le magasin : ", analysés$ressource[[i]],
        " — zéro connexion, zéro écriture.")))
      builds$version[[j]] <- analysés$version[[i]]
    }
  }
  artefacts_pre <- charger_artefacts_construits(builds, root)
  cibles <- if (isTRUE(retire)) {
    analysés$ressource
  } else {
    fermeture_cascade_publication(analysés$ressource, artefacts_pre)
  }
  verifier_adaptateurs_apply(cibles, artefacts_pre, retire = retire)

  # Gel de lignage (noyau partagé) AU SEUIL DE LA CONNEXION (ADR-0048 §5
  # amendée) : le garde est évalué ici, avant le dbConnect ci-dessous, et avant
  # toute écriture. Le plan porte le même verdict pour l'affichage ; c'est ce
  # garde-ci que l'audit structurel reconnaît sur le site d'ouverture.
  for (ressource in cibles) {
    verifier_gel_lignage_ressource(artefacts_pre[[ressource]],
                                   registre = registre, lock = lock)
  }

  owns_con <- FALSE
  if (is.null(con)) {
    config <- configuration_service_postgres()
    con <- do.call(DBI::dbConnect, c(list(drv = RPostgres::Postgres()), config))
    owns_con <- TRUE
  }
  on.exit(if (owns_con) try(DBI::dbDisconnect(con), silent = TRUE), add = TRUE)

  # Le registre vivant est la source du plan (remplace LUSK_LIVE_LISTING).
  live <- lire_listing_live_registre(con)
  plan <- plan_publication(builds = builds, live = live, lock = lock,
                           registre = registre, attributions = attributions, root = root)
  verifier_refus_apply(plan, cibles, confirm_definition)

  recettes <- list()
  with_publication_transaction(con, {
    # Verrou du producteur de référence (593, 1) : la version live ne peut pas
    # bouger entre la lecture et nos écritures. Puis garde NOMMÉ, avant tout
    # write : une référence absente ou divergente refuse la publication entière.
    DBI::dbGetQuery(con, "SELECT pg_advisory_xact_lock(593, 1)")
    verifier_reference_live_apply(con, plan$artefacts, cibles)
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
