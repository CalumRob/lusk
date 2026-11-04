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

# Les thèmes dont les grains de service sont désormais servis par les artefacts
# dédiés (scalaire `scalar-serving/`, séries `series-serving/`, profils
# `profile-serving/`, lecture typée `typed-reading-serving/`) : leurs fichiers
# de faits `indicateurs_<theme>.parquet` / `histoires_<theme>.parquet` ne sont
# PLUS écrits par publish (#757). La Mobilité est l'EXCEPTION : elle conserve
# ses parquets de thème (#619). La liste se DÉRIVE du registre canonique des
# thèmes de données (THEMES_METADATA) plutôt que d'être recopiée : un thème
# ajouté y entre automatiquement, et le test de complétude de l'inventaire
# échoue si un thème canonique est oublié. Les projections JSON
# (indicateurs_<theme>.json / histoires_<theme>.json) restent écrites — seule
# la sérialisation PARQUET par thème est retirée.
themes_parquet_retires <- function() {
  setdiff(THEMES_METADATA, "mobilite")
}

# Prédicat documenté consommé par publish() : vrai pour un thème dont les
# parquets de faits par-thème sont retirés (les cinq thèmes non-mobilité).
theme_parquet_retire <- function(theme) {
  length(theme) == 1L && !is.na(theme) && theme %in% themes_parquet_retires()
}

# Issue #892 : les six colonnes de rang à portée fixe (rang_epci / rang_dep /
# rang_reg et leurs tailles _n) sont OMISES des FUTURES projections JSON
# `indicateurs_<theme>.json` — le repli de rang statique est retiré côté app
# (rangEnContexte / detailsRangEnContexte ne lisent plus que la comparaison
# API, avec sa portée exacte déclarée). Les faits canoniques EN MÉMOIRE, le
# parquet retenu (Mobilité seule, #619), les calculs de rangs (compute_ranks,
# analytics_economie_ranks, thème Mobilité) et le contrat de comparaison API
# (rang exact + portée, rank_field de série ordonnée à sa coordonnée déclarée)
# les conservent INCHANGÉS. Aucun fichier commité n'est réécrit par cette
# modification — elle ne gouverne que la prochaine génération.
COLONNES_RANG_JSON_OMISES <- c(
  "rang_epci", "rang_epci_n",
  "rang_dep", "rang_dep_n",
  "rang_reg", "rang_reg_n"
)

# La projection JSON des indicateurs sans les colonnes de rang omises (#892).
# setdiff tolère une table qui ne les porterait pas : elles restent omises.
projection_json_indicateurs <- function(indicateurs) {
  indicateurs[, setdiff(names(indicateurs), COLONNES_RANG_JSON_OMISES),
               drop = FALSE]
}
# publish ---------------------------------------------------------------------
# Étape 5 : publication. Upsert du payload vers la cible. Deux backends :
#   - "static" (défaut, issue #10, ADR-0004) : écrit les tables vers le home
#     public du payload (public/data/ à la racine du dépôt — là où Pages et
#     l'app lisent), en parquet (l'artefact canonique téléchargeable) et/ou en
#     projection JSON (ce que l'app Vue fetch) — SELON la table, pas les deux
#     formats partout : les règles par projection sont détaillées ci-dessous
#     (pas de parquet par thème hors Mobilité, #757 ; pas de apercu.json
#     depuis #894, le parquet apercu.parquet reste). Chaque sérialisation
#     écrite sort de la MÊME table en mémoire : le test d'égalité
#     (test-publish.R) verrouille la non-dérive — pour les thèmes retirés
#     (#757) il compare la projection JSON à la table en mémoire, pour la
#     Mobilité il compare JSON et parquet l'un à l'autre (dérive impossible,
#     pas juste improbable — ADR-0004).
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
# territoires.parquet/.json, apercu.parquet (la projection apercu.json est
# retirée depuis #894 — source-only, aucun lecteur navigateur), vintages.parquet
# (écrit par run_pipeline). Le thème se lit sur le payload lui-même (la colonne `theme`
# des deux tables de faits) : publish ne peut pas écrire un thème différent de
# celui des données.
# Issue #757 : la sérialisation PARQUET par thème est RETIRÉE pour les cinq
# thèmes non-mobilité (theme_parquet_retire) — leurs grains de service sont
# servis par les artefacts dédiés. Les projections JSON restent écrites pour
# TOUS les thèmes (l'app Vue les fetch) ; seule la copie parquet par thème
# disparaît. La Mobilité reste l'exception (#619) : elle écrit toujours
# indicateurs_mobilite.parquet / histoires_mobilite.parquet. Les fichiers
# partagés (territoires, apercu, vintages) et les parquets BPE dédiés ne sont
# pas concernés ; depuis #894 seule la projection JSON apercu.json disparaît
# (le parquet apercu.parquet reste).

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

  # Issue #757 : la sérialisation PARQUET par thème est retirée pour les cinq
  # thèmes non-mobilité ; la Mobilité garde ses parquets de thème (#619).
  if (!theme_parquet_retire(theme)) {
    ecrire_parquet_si_modifie(
      payload$indicateurs,
      file.path(cible, paste0("indicateurs_", theme, ".parquet"))
    )
    ecrire_parquet_si_modifie(
      payload$histoires,
      file.path(cible, paste0("histoires_", theme, ".parquet"))
    )
  }
  ecrire_parquet_si_modifie(payload$territoires,
                             file.path(cible, "territoires.parquet"))
  # Issue #116 : apercu est un fichier PARTAGÉ (pas par-thème) — seule la
  # table Démographie le peuple (les thèmes sans aperçu ont une table vide par
  # design). Un thème sans aperçu ne doit NI écrire NI écraser le fichier
  # partagé : last-writer-wins, un run Habitat/Économie écraserait l'aperçu
  # Démographie par `[]`. La table du payload reste présente et vide (le
  # contrat, validate_payload l'exige) ; publish ne la sérialise que lorsqu'elle
  # porte des lignes.
  # Issue #894 : seule la sérialisation PARQUET partagée reste — la projection
  # JSON apercu.json n'est plus écrite (voir le backend static ci-dessous).
  if (nrow(payload$apercu) > 0) {
    ecrire_parquet_si_modifie(payload$apercu,
                               file.path(cible, "apercu.parquet"))
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
    # non-dérive, à l'asymétrie #892 près pour les indicateurs (les six
    # colonnes de rang y sont omises du JSON seulement) et à l'omission #894
    # de la table partagée apercu (parquet retenu, JSON retiré). Un tableau = un
    # tableau JSON (dataframe = "rows" : une liste d'objets, la forme native
    # de fetch().json() côté app).
    # digits = 17 : assez de décimales pour qu'un double relu en JSON soit
    # BIT À BIT le double du parquet (17 chiffres significatifs suffisent
    # toujours à un aller-retour exact — le défaut jsonlite, 4 chiffres,
    # tronquerait les parts d'âge).
    ecrire_projection <- function(table, nom) {
      ecrire_json_si_modifie(table, file.path(cible, nom),
                             dataframe = "rows", na = "null",
                             digits = 17, pretty = TRUE)
    }
    # #892 : la projection JSON des indicateurs omet exactement les six
    # colonnes de rang à portée fixe ; la table en mémoire (et le parquet
    # retenu pour la Mobilité) les conservent — asymétrie voulue, verrouillée
    # par test-publish.R.
    ecrire_projection(projection_json_indicateurs(payload$indicateurs),
                      paste0("indicateurs_", theme, ".json"))
    ecrire_projection(payload$histoires, paste0("histoires_", theme, ".json"))
    ecrire_projection(payload$territoires, "territoires.json")
    # #894 : la projection navigateur apercu.json est RETIRÉE (source-only) —
    # plus aucun chemin ne l'écrit. La table canonique en mémoire et le
    # parquet partagé apercu.parquet (écrit plus haut, règle non-vide #116)
    # restent inchangés ; un apercu.json périmé préexistant est une relique :
    # ni réécrit ni supprimé par le run.
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
