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
# échoue si un thème canonique est oublié. Les projections numériques navigateur sont retirées.
themes_parquet_retires <- function() {
  setdiff(THEMES_METADATA, "mobilite")
}

# Prédicat documenté consommé par publish() : vrai pour un thème dont les
# parquets de faits par-thème sont retirés (les cinq thèmes non-mobilité).
theme_parquet_retire <- function(theme) {
  length(theme) == 1L && !is.na(theme) && theme %in% themes_parquet_retires()
}

# publish ---------------------------------------------------------------------
# Étape 5 : publication. Upsert du payload vers la cible. Deux backends :
#   - "static" (défaut, issue #10, ADR-0004) : écrit les tables vers le home
#     public du payload (public/data/ à la racine du dépôt — là où Pages et
#     l'app lisent), avec les Parquets canoniques conservés et les projections
#     JSON des ressources partagées encore publiées. Les projections numériques
#     par thème sont retirées : leurs faits restent dans le payload en mémoire
#     et dans les artefacts producteurs qui ont leur propre contrat.
#   - "parquet" (local, comportement historique inchangé) : parquet seul.
# Sémantique d'upsert documentée : le payload EST l'état complet des fiches —
# écrire écrase, donc relancer ne duplique jamais. Le backend Supabase
# s'arrête bruyamment — seam documenté, câblage à suivre (issue #6), même
# interface, upsert par (territoire, key).
# Issue #13 : les tables canoniques de FAITS restent par thème en mémoire. La
# référence des territoires (les noms réels — la dimension que l'app joint),
# la table apercu et les vintages restent partagés :
# territoires.parquet/.json, apercu.parquet (la projection apercu.json est
# retirée depuis #894 — source-only, aucun lecteur navigateur), vintages.parquet
# (écrit par run_pipeline). Le thème se lit sur le payload lui-même (la colonne `theme`
# des deux tables de faits) : publish ne peut pas écrire un thème différent de
# celui des données.
# Issue #757 : la sérialisation PARQUET par thème est RETIRÉE pour les cinq
# thèmes non-mobilité (theme_parquet_retire) — leurs grains de service sont
# servis par les artefacts dédiés. La Mobilité reste l'exception (#619) : elle écrit toujours
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

  if (backend == "static") {
    # Référentiel partagé conservé. Les faits numériques par thème ne sont
    # plus sérialisés ici : leurs lecteurs utilisent les contrats producteurs
    # dédiés et le payload conserve les tables canoniques en mémoire.
    ecrire_json_si_modifie(
      payload$territoires,
      file.path(cible, "territoires.json"),
      dataframe = "rows", na = "null", digits = 17, pretty = TRUE
    )
    # #894 : la projection navigateur apercu.json est RETIRÉE (source-only) —
    # plus aucun chemin ne l'écrit. La table canonique en mémoire et le
    # parquet partagé apercu.parquet (écrit plus haut, règle non-vide #116)
    # restent inchangés ; un apercu.json périmé préexistant est une relique :
    # ni réécrit ni supprimé par le run.
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
