# publier_comparaisons_acces_batiments -----------------------------------------
# Refresh ciblé : le même résultat R sert aux modèles JSON existants et au
# Parquet canonique que pourra importer la projection SQL. On prépare les
# quatre fichiers avant de remplacer les précédents ; la release Git reste
# l'unité atomique de publication des fichiers du site.
publier_comparaisons_acces_batiments <- function(projections, cible) {
  if (!dir.exists(cible)) {
    stop("Répertoire de publication introuvable : ", cible, call. = FALSE)
  }
  noms <- c(
    distribution = "distribution_acces_batiments_comparaisons",
    rampe = "rampe_acces_batiments_comparaisons"
  )
  if (!all(names(noms) %in% names(projections)) ||
      any(!vapply(projections[names(noms)], is.data.frame, logical(1)))) {
    stop("Comparaisons de bâtiments incomplètes.", call. = FALSE)
  }
  rampe <- projections$rampe
  colonnes <- c("territoire", "type", "comparison_mode", "scope_kind",
                "scope_label", "mode", "quantile", "comparison_total_buildings",
                "comparison_accessible_types")
  if (!all(colonnes %in% names(rampe)) ||
      anyNA(rampe[, colonnes]) ||
      any(!rampe$mode %in% c("b", "c", "t")) ||
      any(!is.finite(rampe$comparison_accessible_types)) ||
      any(!is.finite(rampe$comparison_total_buildings)) ||
      any(rampe$comparison_total_buildings <= 0)) {
    stop("Comparaisons de bâtiments : rampe invalide.", call. = FALSE)
  }
  # Une comparaison absente n'a aucune ligne ; si elle existe, elle porte
  # exactement les 11 positions pour chacun des trois modes.
  groupes <- split(seq_len(nrow(rampe)),
                   interaction(rampe$territoire, rampe$comparison_mode, drop = TRUE))
  if (any(vapply(groupes, function(indices) {
    points <- rampe[indices, , drop = FALSE]
    if (nrow(points) != 3L * length(RAMPE_ACCES_BATIMENTS_QUANTILES) ||
        anyDuplicated(paste(points$mode, points$quantile)) ||
        length(unique(points$scope_kind)) != 1L ||
        length(unique(points$scope_label)) != 1L) return(TRUE)
    any(vapply(c("b", "c", "t"), function(mode) {
      courbe <- points[points$mode == mode, , drop = FALSE]
      if (nrow(courbe) != length(RAMPE_ACCES_BATIMENTS_QUANTILES) ||
          !isTRUE(all.equal(sort(courbe$quantile),
                            RAMPE_ACCES_BATIMENTS_QUANTILES, tolerance = 1e-12)) ||
          length(unique(courbe$comparison_total_buildings)) != 1L) return(TRUE)
      any(diff(courbe$comparison_accessible_types[order(courbe$quantile)]) < 0)
    }, logical(1)))
  }, logical(1)))) {
    stop("Comparaisons de bâtiments : rampe incomplète ou incohérente.",
         call. = FALSE)
  }
  fichiers <- list()
  temporaires <- character()
  on.exit(unlink(temporaires), add = TRUE)
  for (kind in names(noms)) {
    table <- projections[[kind]]
    for (extension in c("parquet", "json")) {
      cible_fichier <- file.path(cible, paste0(noms[[kind]], ".", extension))
      temporaire <- tempfile(".building-comparisons-", tmpdir = cible,
                            fileext = paste0(".", extension))
      temporaires <- c(temporaires, temporaire)
      if (extension == "parquet") {
        nanoparquet::write_parquet(table, temporaire)
      } else {
        jsonlite::write_json(table, temporaire, dataframe = "rows", na = "null",
                             digits = 17, pretty = TRUE)
      }
      fichiers[[length(fichiers) + 1L]] <- c(temporaire, cible_fichier)
    }
  }
  for (fichier in fichiers) {
    remplacer_fichier_si_modifie(fichier[[1L]], fichier[[2L]])
  }
  invisible(noms)
}

# Same-directory rename avoids touching a published file whose bytes have not
# changed. Keep the old file as a rollback candidate on platforms where rename
# cannot replace an existing destination (notably Windows).
remplacer_fichier_si_modifie <- function(temporaire, fichier) {
  if (file.exists(fichier) &&
      identical(unname(tools::md5sum(temporaire)), unname(tools::md5sum(fichier)))) {
    return(invisible(FALSE))
  }
  precedent <- NULL
  if (file.exists(fichier)) {
    precedent <- tempfile(".previous-", tmpdir = dirname(fichier))
    if (!file.rename(fichier, precedent)) {
      stop("Publication impossible : ", fichier, call. = FALSE)
    }
  }
  if (!file.rename(temporaire, fichier)) {
    if (!is.null(precedent) && !file.rename(precedent, fichier)) {
      stop("Publication et restauration impossibles : ", fichier, call. = FALSE)
    }
    stop("Publication impossible : ", fichier, call. = FALSE)
  }
  if (!is.null(precedent)) unlink(precedent)
  invisible(TRUE)
}

ecrire_json_si_modifie <- function(objet, fichier, ...) {
  temporaire <- tempfile(".publish-", tmpdir = dirname(fichier), fileext = ".json")
  on.exit(unlink(temporaire), add = TRUE)
  jsonlite::write_json(objet, temporaire, ...)
  remplacer_fichier_si_modifie(temporaire, fichier)
}

ecrire_parquet_si_modifie <- function(table, fichier) {
  temporaire <- tempfile(".publish-", tmpdir = dirname(fichier),
                         fileext = ".parquet")
  on.exit(unlink(temporaire), add = TRUE)
  if (file.exists(fichier)) {
    existant <- tryCatch(nanoparquet::read_parquet(fichier), error = function(e) NULL)
    memes_colonnes <- !is.null(existant) &&
      identical(names(existant), names(table)) && nrow(existant) == nrow(table)
    memes_valeurs <- memes_colonnes && all(vapply(names(table), function(nom) {
      identical(class(existant[[nom]]), class(table[[nom]])) &&
        identical(unname(existant[[nom]]), unname(table[[nom]]))
    }, logical(1)))
    if (memes_valeurs) {
      return(invisible(FALSE))
    }
  }
  nanoparquet::write_parquet(table, temporaire)
  remplacer_fichier_si_modifie(temporaire, fichier)
}
# publish ---------------------------------------------------------------------
# Étape 5 : publication. Upsert du payload vers la cible. Deux backends :
#   - "static" (défaut, issue #10, ADR-0004) : écrit les tables en parquet
#     (l'artefact canonique téléchargeable) ET leurs projections JSON (ce que
#     l'app Vue fetch), vers le home public du payload (public/data/ à la
#     racine du dépôt — là où Pages et l'app lisent). Les deux sérialisations
#     sortent des MÊMES tables en mémoire : un test lit le JSON en retour et
#     prouve qu'il égale exactement le parquet (dérive impossible, pas juste
#     improbable — ADR-0004).
#   - "parquet" (local, comportement historique inchangé) : parquet seul.
# Sémantique d'upsert documentée : le payload EST l'état complet des fiches —
# écrire écrase, donc relancer ne duplique jamais. Le backend Supabase
# s'arrête bruyamment — seam documenté, câblage à suivre (issue #6), même
# interface, upsert par (territoire, key).
# Issue #13 : les fichiers de FAITS sont par thème — indicateurs_<theme> et
# histoires_<theme> (parquet + JSON) — pour que les thèmes ne se marchent
# jamais dessus et que l'app récupère par thème. La référence des territoires
# (les noms réels — la dimension que l'app joint), la table apercu (les stats
# de base de l'onglet Aperçu, issue #32) et les vintages restent partagés :
# territoires.parquet/.json, apercu.parquet/.json, vintages.parquet (écrit par
# run_pipeline). Le thème se lit sur le payload lui-même (la colonne `theme`
# des deux tables de faits) : publish ne peut pas écrire un thème différent de
# celui des données.

publish <- function(payload, cible = "public/data", backend = "static") {
  if (backend == "supabase") {
    stop(
      "publish(backend = 'supabase') n'est pas câblé — ",
      "voir le suivi de l'issue #6."
    )
  }
  if (!backend %in% c("static", "parquet")) {
    stop("publish(backend = '", backend, "') n'existe pas — ",
         "'static' ou 'parquet' attendus.")
  }
  if (!dir.exists(cible)) dir.create(cible, recursive = TRUE)

  # le thème du payload : exactement un — les faits sont publiés par thème
  themes <- unique(payload$indicateurs$theme)
  if (length(themes) != 1L) {
    stop("publish : le payload porte ", length(themes),
         " thèmes — la publication est par thème, un seul attendu.",
         call. = FALSE)
  }
  theme <- themes[[1L]]

  ecrire_parquet_si_modifie(payload$indicateurs,
                             file.path(cible, paste0("indicateurs_", theme, ".parquet")))
  ecrire_parquet_si_modifie(payload$histoires,
                             file.path(cible, paste0("histoires_", theme, ".parquet")))
  ecrire_parquet_si_modifie(payload$territoires,
                             file.path(cible, "territoires.parquet"))
  # Issue #116 : apercu est un fichier PARTAGÉ (pas par-thème) — seule la
  # table Démographie le peuple (les thèmes sans aperçu ont une table vide par
  # design). Un thème sans aperçu ne doit NI écrire NI écraser le fichier
  # partagé : last-writer-wins, un run Habitat/Économie écraserait l'aperçu
  # Démographie par `[]`. La table du payload reste présente et vide (le
  # contrat, validate_payload l'exige) ; publish ne la sérialise que lorsqu'elle
  # porte des lignes.
  if (nrow(payload$apercu) > 0) {
    ecrire_parquet_si_modifie(payload$apercu,
                               file.path(cible, "apercu.parquet"))
  }
  # Le profil BPE est une projection publique bornée du thème Mobilité. Il est
  # optionnel pour les autres thèmes et absent signifie « élément non construit »
  # (comme l'aperçu), jamais une table vide fabriquée par publish.
  if ("profils_acces_bpe" %in% names(payload) &&
      !is.null(payload$profils_acces_bpe)) {
    ecrire_parquet_si_modifie(payload$profils_acces_bpe,
                               file.path(cible, "profils_acces_bpe.parquet"))
  }
  if ("profils_acces_bpe_univers" %in% names(payload) &&
      !is.null(payload$profils_acces_bpe_univers)) {
    ecrire_parquet_si_modifie(payload$profils_acces_bpe_univers,
                               file.path(cible, "profils_acces_bpe_univers.parquet"))
  }
  if ("distribution_acces_batiments" %in% names(payload) &&
      !is.null(payload$distribution_acces_batiments)) {
    ecrire_parquet_si_modifie(
      payload$distribution_acces_batiments,
      file.path(cible, "distribution_acces_batiments.parquet")
    )
  }
  if ("rampe_acces_batiments" %in% names(payload) &&
      !is.null(payload$rampe_acces_batiments)) {
    ecrire_parquet_si_modifie(
      payload$rampe_acces_batiments,
      file.path(cible, "rampe_acces_batiments.parquet")
    )
  }
  if ("distribution_acces_batiments_comparaisons" %in% names(payload) &&
      !is.null(payload$distribution_acces_batiments_comparaisons)) {
    ecrire_parquet_si_modifie(
      payload$distribution_acces_batiments_comparaisons,
      file.path(cible, "distribution_acces_batiments_comparaisons.parquet")
    )
  }
  if ("rampe_acces_batiments_comparaisons" %in% names(payload) &&
      !is.null(payload$rampe_acces_batiments_comparaisons)) {
    ecrire_parquet_si_modifie(
      payload$rampe_acces_batiments_comparaisons,
      file.path(cible, "rampe_acces_batiments_comparaisons.parquet")
    )
  }

  if (backend == "static") {
    # Les projections JSON : générées depuis les MÊMES tables en mémoire que
    # le parquet — le test d'égalité (test-publish.R) verrouille la
    # non-dérive. Un tableau = un tableau JSON (dataframe = "rows" : une
    # liste d'objets, la forme native de fetch().json() côté app).
    # digits = 17 : assez de décimales pour qu'un double relu en JSON soit
    # BIT À BIT le double du parquet (17 chiffres significatifs suffisent
    # toujours à un aller-retour exact — le défaut jsonlite, 4 chiffres,
    # tronquerait les parts d'âge).
    ecrire_projection <- function(table, nom) {
      ecrire_json_si_modifie(table, file.path(cible, nom),
                             dataframe = "rows", na = "null",
                             digits = 17, pretty = TRUE)
    }
    ecrire_projection(payload$indicateurs, paste0("indicateurs_", theme, ".json"))
    ecrire_projection(payload$histoires, paste0("histoires_", theme, ".json"))
    ecrire_projection(payload$territoires, "territoires.json")
    if (nrow(payload$apercu) > 0) {
      ecrire_projection(payload$apercu, "apercu.json")
    }
    if ("profils_acces_bpe" %in% names(payload) &&
        !is.null(payload$profils_acces_bpe)) {
      ecrire_projection(payload$profils_acces_bpe, "profils_acces_bpe.json")
    }
    if ("distribution_acces_batiments" %in% names(payload) &&
        !is.null(payload$distribution_acces_batiments)) {
      ecrire_projection(
        payload$distribution_acces_batiments,
        "distribution_acces_batiments.json"
      )
    }
    if ("rampe_acces_batiments" %in% names(payload) &&
        !is.null(payload$rampe_acces_batiments)) {
      ecrire_projection(
        payload$rampe_acces_batiments,
        "rampe_acces_batiments.json"
      )
    }
    if ("distribution_acces_batiments_comparaisons" %in% names(payload) &&
        !is.null(payload$distribution_acces_batiments_comparaisons)) {
      ecrire_projection(
        payload$distribution_acces_batiments_comparaisons,
        "distribution_acces_batiments_comparaisons.json"
      )
    }
    if ("rampe_acces_batiments_comparaisons" %in% names(payload) &&
        !is.null(payload$rampe_acces_batiments_comparaisons)) {
      ecrire_projection(
        payload$rampe_acces_batiments_comparaisons,
        "rampe_acces_batiments_comparaisons.json"
      )
    }
    # Référentiel territorial partagé : la classe de densité est une propriété
    # de la dimension des territoires, pas un indicateur de thème. Elle voyage
    # avec les lignes de territoires et sa provenance vit dans un petit sidecar
    # afin que Sources puisse l'exposer sans l'attacher à « densité de
    # population ».
    champs_densite <- c(
      "classe_densite_code",
      "classe_densite_libelle_insee",
      "classe_densite_libelle_public"
    )
    if (all(champs_densite %in% names(payload$territoires))) {
      ecrire_json_si_modifie(
        metadata_classes_densite(),
        file.path(cible, "territoires-metadata.json"),
        dataframe = "rows", na = "null", digits = 17, pretty = TRUE,
        auto_unbox = TRUE
      )
    }
  }

  invisible(payload)
}
