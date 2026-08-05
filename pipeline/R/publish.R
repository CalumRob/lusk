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

  nanoparquet::write_parquet(payload$indicateurs,
                             file.path(cible, paste0("indicateurs_", theme, ".parquet")))
  nanoparquet::write_parquet(payload$histoires,
                             file.path(cible, paste0("histoires_", theme, ".parquet")))
  nanoparquet::write_parquet(payload$territoires,
                             file.path(cible, "territoires.parquet"))
  # Issue #116 : apercu est un fichier PARTAGÉ (pas par-thème) — seule la
  # table Démographie le peuple (les thèmes sans aperçu ont une table vide par
  # design). Un thème sans aperçu ne doit NI écrire NI écraser le fichier
  # partagé : last-writer-wins, un run Habitat/Économie écraserait l'aperçu
  # Démographie par `[]`. La table du payload reste présente et vide (le
  # contrat, validate_payload l'exige) ; publish ne la sérialise que lorsqu'elle
  # porte des lignes.
  if (nrow(payload$apercu) > 0) {
    nanoparquet::write_parquet(payload$apercu,
                               file.path(cible, "apercu.parquet"))
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
      jsonlite::write_json(table, file.path(cible, nom),
                           dataframe = "rows", na = "null",
                           digits = 17, pretty = TRUE)
    }
    ecrire_projection(payload$indicateurs, paste0("indicateurs_", theme, ".json"))
    ecrire_projection(payload$histoires, paste0("histoires_", theme, ".json"))
    ecrire_projection(payload$territoires, "territoires.json")
    if (nrow(payload$apercu) > 0) {
      ecrire_projection(payload$apercu, "apercu.json")
    }
  }

  invisible(payload)
}
