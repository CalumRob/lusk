# publish ---------------------------------------------------------------------
# Étape 5 : publication. Upsert du payload vers la cible. Aujourd'hui : parquet
# local (nanoparquet). Sémantique d'upsert documentée : le payload EST l'état
# complet des fiches — écrire écrase, donc relancer ne duplique jamais. Le
# backend Supabase viendra plus tard, même interface, upsert par
# (territoire, key) — câblage à suivre (issue #6).
# Trois tables : deux de faits (indicateurs, histoires) + la référence des
# territoires (les noms réels — la dimension que l'app joint).

publish <- function(payload, cible = "data/processed", backend = "parquet") {
  if (backend == "supabase") {
    stop(
      "publish(backend = 'supabase') n'est pas câblé — ",
      "voir le suivi de l'issue #6."
    )
  }
  if (!dir.exists(cible)) dir.create(cible, recursive = TRUE)

  nanoparquet::write_parquet(payload$indicateurs,
                             file.path(cible, "indicateurs.parquet"))
  nanoparquet::write_parquet(payload$histoires,
                             file.path(cible, "histoires.parquet"))
  nanoparquet::write_parquet(payload$territoires,
                             file.path(cible, "territoires.parquet"))

  invisible(payload)
}
