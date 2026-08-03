# run_pipeline ----------------------------------------------------------------
# L'entrée unique et documentée du pipeline (docs/architecture.md §Pipeline) :
# download -> construire (filter/reshape) -> vintage -> compute -> publish.
# Idempotent par construction : les téléchargements sautent ce qui existe (et
# valide), le rebuild est déterministe, la publication écrase (sémantique
# d'upsert).

run_pipeline <- function(cache = "data/raw", sortie = "data/processed") {
  download_sources(MANIFEST_DEMOGRAPHIE, cache = cache)

  brut <- construire_donnees_brut(cache = cache)

  vintages <- vintages_demographie()
  # Le tampon de fraîcheur du thème = la source de référence des indicateurs :
  # la série historique (POP, SUP, BRTH/DEATH). Pointée par son id, jamais par
  # un sous-ensemble implicite (point 9).
  vintage_rp <- vintages[vintages$id == "serie_historique", ]
  stopifnot(nrow(vintage_rp) == 1)
  vintage_payload <- list(
    source = vintage_rp$source,
    version = vintage_rp$version,
    date_reference = vintage_rp$date_reference,
    date_publication = vintage_rp$date_publication
  )

  payload <- compute_payload(brut, vintage = vintage_payload)

  publish(payload, sortie)
  nanoparquet::write_parquet(vintages, file.path(sortie, "vintages.parquet"))

  payload
}
