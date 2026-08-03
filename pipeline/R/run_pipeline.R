# run_pipeline ----------------------------------------------------------------
# L'entrée unique et documentée du pipeline (docs/architecture.md §Pipeline) :
# download -> construire (filter/reshape) -> vintage -> compute -> publish.
# Idempotent par construction : les téléchargements sautent ce qui existe, le
# rebuild est déterministe, la publication écrase (sémantique d'upsert).

run_pipeline <- function(cache = "data/raw", sortie = "data/processed") {
  download_sources(MANIFEST_DEMOGRAPHIE, cache = cache)

  brut <- construire_donnees_brut(cache = cache)

  vintages <- vintages_demographie()
  vintage_rp <- vintages[vintages$version == "2023", ][1, ]
  vintage_payload <- list(
    source = "INSEE RP",
    version = vintage_rp$version,
    date = vintage_rp$date
  )

  payload <- compute_payload(brut, vintage = vintage_payload)

  publish(payload, sortie)
  nanoparquet::write_parquet(vintages, file.path(sortie, "vintages.parquet"))

  payload
}
