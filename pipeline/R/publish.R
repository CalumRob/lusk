# publish ---------------------------------------------------------------------
# Étape 5 : publication. Upsert du payload vers la cible. Deux backends :
#   - "static" (défaut, issue #10, ADR-0004) : écrit les trois tables en
#     parquet (l'artefact canonique téléchargeable) ET leurs projections JSON
#     (ce que l'app Vue fetch), vers le home public du payload (public/data/
#     à la racine du dépôt — là où Pages et l'app lisent). Les deux
#     sérialisations sortent des MÊMES tables en mémoire : un test lit le JSON
#     en retour et prouve qu'il égale exactement le parquet (dérive
#     impossible, pas juste improbable — ADR-0004).
#   - "parquet" (local, comportement historique inchangé) : parquet seul.
# Sémantique d'upsert documentée : le payload EST l'état complet des fiches —
# écrire écrase, donc relancer ne duplique jamais. Le backend Supabase
# s'arrête bruyamment — seam documenté, câblage à suivre (issue #6), même
# interface, upsert par (territoire, key).
# Trois tables : deux de faits (indicateurs, histoires) + la référence des
# territoires (les noms réels — la dimension que l'app joint).

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

  nanoparquet::write_parquet(payload$indicateurs,
                             file.path(cible, "indicateurs.parquet"))
  nanoparquet::write_parquet(payload$histoires,
                             file.path(cible, "histoires.parquet"))
  nanoparquet::write_parquet(payload$territoires,
                             file.path(cible, "territoires.parquet"))

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
    ecrire_projection(payload$indicateurs, "indicateurs.json")
    ecrire_projection(payload$histoires, "histoires.json")
    ecrire_projection(payload$territoires, "territoires.json")
  }

  invisible(payload)
}
