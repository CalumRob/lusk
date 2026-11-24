# Plan de publication (ADR-0049 step 2, #1136) ---------------------------------
# Lecture pure de l'état construit (Artefacts de ressource, #1135) face à un
# listing live injecté (ressource, version). AUCUN lecteur de registre, AUCUNE
# connexion à la base de service, AUCUNE écriture : ce module ne fait que
# calculer et imprimer un verdict. `apply` (slice suivante) consommera ce plan.

# -- Lecture du magasin (sélecteur de build courant) ---------------------------

construites_depuis_magasin <- function(root = NULL) {
  listing <- lister_artefacts_ressource(root)
  vides <- data.frame(ressource = character(), forme = character(),
                      version = character(), stringsAsFactors = FALSE)
  if (!nrow(listing)) return(vides)
  # Une ressource peut avoir plusieurs versions retenues (ADR-0049 §5) ; le
  # candidat à la publication est le build le plus récent, la version servant
  # de départage déterministe en cas d'égalité de mtime.
  listing$mtime <- as.numeric(file.info(listing$chemin)$mtime)
  listing <- listing[order(listing$ressource, -listing$mtime, listing$version), ,
                     drop = FALSE]
  courantes <- listing[!duplicated(listing$ressource), , drop = FALSE]
  courantes <- courantes[c("ressource", "forme", "version")]
  rownames(courantes) <- NULL
  courantes
}

version_live_ressource <- function(ressource, live = NULL) {
  if (is.null(live) || !is.data.frame(live) || !nrow(live) ||
      !all(c("ressource", "version") %in% names(live)))
    return(NA_character_)
  lignes <- live[as.character(live$ressource) == ressource, , drop = FALSE]
  if (!nrow(lignes)) return(NA_character_)
  version <- as.character(lignes$version[[1L]])
  if (is.na(version) || !nzchar(version)) NA_character_ else version
}

#Listing live injecté : fichier JSON local, jamais une connexion de service.
lire_listing_live_fichier <- function(chemin) {
  if (is.null(chemin) || !nzchar(chemin) || !file.exists(chemin)) return(NULL)
  brut <- jsonlite::fromJSON(chemin, simplifyVector = FALSE)
  if (!is.list(brut) || !length(brut)) return(NULL)
  lignes <- lapply(brut, function(e)
    data.frame(ressource = as.character(e$ressource),
               version = as.character(e$version), stringsAsFactors = FALSE))
  do.call(rbind, lignes)
}

# -- Descripteur : lecture hétérogène liste / data.frame -----------------------

champ_descripteur <- function(descripteur, nom) {
  if (is.data.frame(descripteur) && nom %in% names(descripteur))
    return(descripteur[[nom]])
  if (is.list(descripteur) && nom %in% names(descripteur))
    return(descripteur[[nom]])
  NULL
}

# La sémantique de définition n'a qu'UNE source : SCALAR_DESCRIPTOR_SEMANTICS
# et identical_scalar_descriptor() (publish_scalar_scope.R). Le module n'a ni
# liste de champs ni règle d'ordre propres : il délègue au handler de forme, qui
# compose ce garde canonique. `descriptor_version` en est exclu par construction.
changement_definition_ressource <- function(live, built, forme = "scalar") {
  REGISTRE_FORMES_RESSOURCE[[forme]]$comparer_definition(live, built)
}

# -- Cascade à partir des dépendances déclarées --------------------------------

# La dépendance est une DÉCLARATION du descripteur producteur. Le plan ne
# connaît aucun identifiant de ressource en dur et ne lit pas le jeton scalaire
# global historique (relié à la version globale, #1137/#1138).
dependance_scalaire_ressource <- function(artefact) {
  dep <- champ_descripteur(artefact$contenu$descriptor, "comparison_scalar")
  if (is.null(dep) || !length(dep)) return(NA_character_)
  dep <- as.character(unlist(dep, use.names = FALSE))[[1L]]
  if (is.na(dep) || !nzchar(dep)) NA_character_ else dep
}

fermeture_cascade_publication <- function(changees, artefacts) {
  retenus <- unique(as.character(changees))
  repeat {
    ajoutes <- character()
    for (id in names(artefacts)) {
      if (id %in% retenus) next
      dep <- dependance_scalaire_ressource(artefacts[[id]])
      if (!is.na(dep) && dep %in% retenus) ajoutes <- c(ajoutes, id)
    }
    if (!length(ajoutes)) break
    retenus <- c(retenus, setdiff(ajoutes, retenus))
  }
  ordre <- names(artefacts)
  retenus_ordonnes <- ordre[ordre %in% retenus]
  c(retenus_ordonnes, setdiff(retenus, retenus_ordonnes))
}

# Fermetures au sens applicatif : composantes connexes du graphe de dépendances
# restreint aux membres de la cascade. Un refus (ou un changement de définition
# non confirmé) dans une composante bloque TOUS ses membres, pas seulement la
# ressource fautive : `apply` publie une fermeture dans une seule transaction.
composantes_cascade <- function(membres, artefacts) {
  restants <- unique(as.character(membres))
  composantes <- list()
  while (length(restants)) {
    file <- restants[[1L]]
    visites <- character()
    while (length(file)) {
      courant <- file[[1L]]
      file <- file[-1L]
      if (courant %in% visites) next
      visites <- c(visites, courant)
      voisins <- character()
      for (id in restants) {
        dep <- dependance_scalaire_ressource(artefacts[[id]])
        if (!is.na(dep) && identical(dep, courant)) voisins <- c(voisins, id)
      }
      dep <- dependance_scalaire_ressource(artefacts[[courant]])
      if (!is.na(dep) && dep %in% restants) voisins <- c(voisins, dep)
      file <- c(file, setdiff(voisins, visites))
    }
    composantes[[length(composantes) + 1L]] <- restants[restants %in% visites]
    restants <- setdiff(restants, visites)
  }
  composantes
}

source_blocage <- function(detail, raison) {
  if (identical(raison, "empreinte_absente")) {
    extrait <- regmatches(detail, regexpr("empreinte absente pour [^ ]+", detail))
    if (length(extrait))
      return(sub("^empreinte absente pour ", "", extrait))
    return("")
  }
  extrait <- regmatches(detail, regexpr("'[^']+'", detail))
  if (length(extrait)) return(gsub("'", "", extrait))
  ""
}

# -- Version de référence : une classification territoriale marque tout --------

version_reference_artefacts <- function(artefacts) {
  versions <- unlist(lapply(artefacts, function(a) {
    comparaison <- a$contenu$comparison
    if (is.list(comparaison) && !is.null(comparaison$reference_content_version))
      as.character(comparaison$reference_content_version)[[1L]] else NULL
  }), use.names = FALSE)
  versions <- versions[!is.na(versions) & nzchar(versions)]
  if (!length(versions)) NULL else unique(versions)
}

reference_changee <- function(artefacts, artefacts_live) {
  construite <- version_reference_artefacts(artefacts)
  if (is.null(construite)) return(FALSE)
  live <- version_reference_artefacts(artefacts_live)
  if (is.null(live)) return(FALSE)
  !identical(sort(construite), sort(live))
}

# -- Dérive entre les deux artefacts -------------------------------------------

# Le chemin vers le tableau territory_id/value appartient au handler de forme
# (`champ_faits_drift`) : le plan n'a aucune connaissance par forme. Par exemple
# le scalaire déclare "facts" (son grain groupe aussi `eligible_territories`,
# qui appartient à la référence et ne doit pas entrer dans la dérive).
faits_drift_ressource <- function(grain, handler) {
  chemin <- handler$champ_faits_drift
  if (!is.null(chemin)) {
    for (champ in as.character(chemin)) {
      if (!is.list(grain) || is.null(grain[[champ]])) return(NULL)
      grain <- grain[[champ]]
    }
  }
  if (is.data.frame(grain) && all(c("territory_id", "value") %in% names(grain)))
    grain else NULL
}

resume_derive_ressource <- function(artefact_live, artefact_built, forme = "scalar") {
  inconnue <- list(disponible = FALSE, nombre = NA_integer_,
                   territoires = character())
  handler <- REGISTRE_FORMES_RESSOURCE[[forme]]
  faits_live <- faits_drift_ressource(artefact_live$contenu$faits, handler)
  faits_built <- faits_drift_ressource(artefact_built$contenu$faits, handler)
  if (is.null(faits_live) || is.null(faits_built)) return(inconnue)
  scinder <- function(faits) split(as.character(faits$value),
                                   as.character(faits$territory_id))
  avant <- scinder(faits_live)
  apres <- scinder(faits_built)
  territoires <- union(names(avant), names(apres))
  modifies <- territoires[vapply(territoires, function(id) {
    a <- avant[[id]]
    b <- apres[[id]]
    if (is.null(a) || is.null(b)) return(TRUE)
    !identical(sort(a), sort(b))
  }, logical(1))]
  list(disponible = TRUE, nombre = as.integer(length(modifies)),
       territoires = sort(modifies))
}

# -- Gel restreint au lignage de la ressource ----------------------------------

verifier_gel_lignage_ressource <- function(artefact, registre = NULL, lock = NULL) {
  lignage <- artefact$digests_lignage
  if (!is.list(lignage)) lignage <- list()
  if (is.null(registre)) registre <- lire_lock(lock)
  # Le noyau partagé porte TOUTES les raisons de gel, y compris
  # `empreinte_absente` pour les entrées explicites `absent = TRUE`, et le
  # garde d'empreintes vides. Aucune raison n'est réimplémentée ici.
  evaluer_gel_empreintes(lignage, registre, ids = names(lignage),
                         exiger_couverture = FALSE,
                         chemin = paste0("lignage[", artefact$ressource, "]"))
}

raison_erreur_gel <- function(e) {
  if (inherits(e, "erreur_gel_release") && !is.null(e$raison)) e$raison else "erreur"
}

# -- Statut de vérification des données réelles --------------------------------

# Attribution ADR-0048 §4 amendée : une vérification n'appartient à une
# ressource que si TOUTES ses sources d'entrée sont dans le lignage de cette
# ressource (sous-ensemble complet, pas simple recouvrement). Une régression de
# code est FATAL AU BUILD (entrées identiques, sortie modifiée) : le build échoue,
# aucun artefact n'existe à planifier, donc aucune régression n'atteint jamais
# verif-attributions.json. Le plan ne rapporte que des dérives de données.
verifications_par_ressource <- function(attributions, artefacts) {
  if (is.null(attributions) || !length(attributions)) return(list())
  resultat <- list()
  for (attribution in attributions) {
    ids <- character()
    if (!is.null(attribution$sources)) {
      ids <- c(ids, unlist(lapply(attribution$sources, function(s) s$source_id),
                           use.names = FALSE))
    }
    if (!is.null(attribution$source)) ids <- c(ids, as.character(attribution$source))
    ids <- unique(ids[!is.na(ids)])
    if (!length(ids)) next
    message <- if (!is.null(attribution$message))
      as.character(attribution$message)[[1L]] else ""
    for (nom in names(artefacts)) {
      lignage <- names(artefacts[[nom]]$digests_lignage)
      if (!all(ids %in% lignage)) next
      if (is.null(resultat[[nom]])) {
        resultat[[nom]] <- list(type = "drift", message = message, sources = ids)
      } else {
        resultat[[nom]]$message <- paste(resultat[[nom]]$message, message, sep = " | ")
        resultat[[nom]]$sources <- union(resultat[[nom]]$sources, ids)
      }
    }
  }
  resultat
}

# -- Assemblage du plan ---------------------------------------------------------

assembler_plan_publication <- function(builds, artefacts, artefacts_live = list(),
                                       live = NULL, registre = list(),
                                       attributions = NULL) {
  ids <- as.character(builds$ressource)
  versions <- vapply(ids, function(id)
    as.character(builds$version[match(id, ids)]), character(1))
  lives <- vapply(ids, version_live_ressource, character(1), live = live)
  reference_basculee <- reference_changee(artefacts, artefacts_live)

  changees <- ids[is.na(lives) | lives != versions | reference_basculee]
  cascade <- fermeture_cascade_publication(changees, artefacts)
  verifs <- verifications_par_ressource(attributions, artefacts)

  gel_etat <- character(length(ids)); gel_raison <- rep("", length(ids))
  gel_detail <- rep("", length(ids)); definition <- logical(length(ids))
  definition_champs <- vector("list", length(ids))
  drift_disponible <- logical(length(ids)); drift_nb <- integer(length(ids))
  drift_territoires <- rep("", length(ids))
  check <- rep("none", length(ids)); check_detail <- rep("", length(ids))

  for (i in seq_along(ids)) {
    id <- ids[[i]]
    artefact <- artefacts[[id]]
    precedent <- artefacts_live[[id]]

    # Une version live égale à la version construite est le MÊME artefact :
    # la dérive est nulle par construction, quelle que soit la forme (y compris
    # celles dont le grain de faits n'a pas de tableau territory_id/value).
    versions_identiques <- !is.na(lives[[i]]) && identical(lives[[i]], versions[[i]])
    drift <- if (versions_identiques) {
      list(disponible = TRUE, nombre = 0L, territoires = character())
    } else if (is.null(precedent)) {
      list(disponible = FALSE, nombre = NA_integer_, territoires = character())
    } else resume_derive_ressource(precedent, artefact, as.character(artefact$forme))
    drift_disponible[[i]] <- drift$disponible
    drift_nb[[i]] <- drift$nombre
    drift_territoires[[i]] <- paste(drift$territoires, collapse = ",")

    changement <- if (is.null(precedent)) {
      list(change = FALSE, champs = character())
    } else changement_definition_ressource(precedent$contenu$descriptor,
                                           artefact$contenu$descriptor,
                                           as.character(artefact$forme))
    definition[[i]] <- changement$change
    definition_champs[[i]] <- changement$champs

    if (id %in% cascade) {
      verdict <- tryCatch({
        verifier_gel_lignage_ressource(artefact, registre = registre)
        list(etat = "ok", raison = "", detail = "")
      }, error = function(e) list(etat = "refused", raison = raison_erreur_gel(e),
                                  detail = conditionMessage(e)))
      gel_etat[[i]] <- verdict$etat
      gel_raison[[i]] <- verdict$raison
      gel_detail[[i]] <- verdict$detail
    } else {
      gel_etat[[i]] <- "not required"
    }

    verification <- verifs[[id]]
    if (!is.null(verification)) {
      check[[i]] <- as.character(verification$type)
      check_detail[[i]] <- as.character(verification$message)
    }
  }

  # Un refus dans une fermeture bloque ses autres membres, même si leur propre
  # gel est conforme : ils seraient publiés dans la même transaction.
  bloque <- rep(FALSE, length(ids))
  bloque_par <- rep("", length(ids))
  for (composante in composantes_cascade(cascade, artefacts)) {
    indices <- which(ids %in% composante)
    motifs <- character()
    for (i in indices) {
      if (identical(gel_etat[[i]], "refused")) {
        source <- source_blocage(gel_detail[[i]], gel_raison[[i]])
        motif_raison <- if (nzchar(source))
          paste0(gel_raison[[i]], ": ", source) else gel_raison[[i]]
        motifs <- c(motifs, paste0(ids[[i]], " (", motif_raison, ")"))
      } else if (isTRUE(definition[[i]])) {
        motifs <- c(motifs, paste0(ids[[i]], " (definition: ",
                                   paste(definition_champs[[i]], collapse = ","), ")"))
      }
    }
    if (length(motifs)) {
      bloque[indices] <- TRUE
      bloque_par[indices] <- paste(motifs, collapse = "; ")
    }
  }

  ressources <- data.frame(
    ressource = ids,
    forme = vapply(ids, function(id) as.character(artefacts[[id]]$forme), character(1)),
    version_live = lives,
    version_built = versions,
    statut_adoption = ifelse(is.na(lives), "not adopted", "adopted"),
    change = ids %in% changees,
    cascade = ids %in% cascade,
    bloque = bloque,
    bloque_par = bloque_par,
    gel = gel_etat,
    gel_raison = gel_raison,
    gel_detail = gel_detail,
    definition = definition,
    drift_disponible = drift_disponible,
    drift_nb = drift_nb,
    drift_territoires = drift_territoires,
    check = check,
    check_detail = check_detail,
    stringsAsFactors = FALSE
  )
  ressources$definition_champs <- I(definition_champs)

  refuses <- ressources[ressources$gel == "refused",
                        c("ressource", "gel_raison", "gel_detail"), drop = FALSE]
  rownames(refuses) <- NULL
  list(
    ressources = ressources,
    changees = changees,
    cascade = cascade,
    reference_changee = reference_basculee,
    gel = list(ok = nrow(refuses) == 0L, refuses = refuses),
    blocage = list(bloque = any(bloque), motifs = unique(bloque_par[nzchar(bloque_par)])),
    verifications = verifs,
    # `apply` (#1137) consumes the same artefacts to compute the closure and to
    # write one resource at a time. Exposing them keeps plan/apply on ONE source.
    artefacts = artefacts, artefacts_live = artefacts_live
  )
}

# -- Entrée publique : magasin + listing injecté --------------------------------

plan_publication <- function(root = NULL, builds = NULL, live = NULL, lock = NULL,
                             registre = NULL, attributions = NULL) {
  if (is.null(builds)) builds <- construites_depuis_magasin(root)
  if (is.character(live) && length(live) == 1L) live <- lire_listing_live_fichier(live)
  if (is.null(registre)) registre <- lire_lock(lock)
  # `attributions` est un dossier de sortie : on réutilise le lecteur canonique
  # de lock_attribution.R, jamais un lecteur de fichier parallèle.
  if (is.character(attributions) && length(attributions) == 1L)
    attributions <- lire_attributions(attributions)

  artefacts <- list()
  artefacts_live <- list()
  for (i in seq_len(nrow(builds))) {
    id <- as.character(builds$ressource[[i]])
    version <- as.character(builds$version[[i]])
    forme <- if ("forme" %in% names(builds)) as.character(builds$forme[[i]]) else NULL
    artefacts[[id]] <- lire_artefact_ressource(id, version, root = root, forme = forme)
    version_live <- version_live_ressource(id, live)
    if (!is.na(version_live)) {
      artefacts_live[[id]] <- if (identical(version_live, version)) artefacts[[id]] else
        tryCatch(lire_artefact_ressource(id, version_live, root = root, forme = forme),
                 error = function(e) NULL)
    }
  }
  assembler_plan_publication(builds, artefacts, artefacts_live, live, registre,
                             attributions)
}

imprimer_plan_publication <- function(plan, con = stdout()) {
  lignes <- plan$ressources
  for (i in seq_len(nrow(lignes))) {
    ligne <- lignes[i, , drop = FALSE]
    vis_live <- if (is.na(ligne$version_live)) "not adopted" else ligne$version_live
    gel <- if (identical(ligne$gel, "ok")) "ok" else
      paste0(ligne$gel, "(", ligne$gel_raison, ")")
    definition <- if (ligne$definition)
      paste0("changed(", paste(ligne$definition_champs[[1L]], collapse = "+"), ")")
    else "none"
    drift <- if (ligne$drift_disponible) as.character(ligne$drift_nb) else "unknown"
    cat(sprintf(paste0(
      "ressource=%s forme=%s live=%s built=%s adoption=%s status=%s cascade=%s ",
      "blocked=%s blocked_by=%s freeze=%s definition=%s drift=%s check=%s\n"),
      ligne$ressource, ligne$forme, vis_live, ligne$version_built,
      ligne$statut_adoption, ifelse(ligne$change, "changed", "unchanged"),
      ifelse(ligne$cascade, "yes", "no"),
      ifelse(ligne$bloque, "yes", "no"), ligne$bloque_par,
      gel, definition, drift, ligne$check),
      file = con)
  }
  cat(paste0("changed=", paste(plan$changees, collapse = ","), "\n"), file = con)
  cat(paste0("cascade=", paste(plan$cascade, collapse = ","), "\n"), file = con)
  cat(paste0("freeze=", if (plan$gel$ok) "ok" else "refused", "\n"), file = con)
  cat(paste0("blocked=", if (plan$blocage$bloque) "yes" else "no", "\n"), file = con)
  invisible(plan)
}
