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
  # Issue #9 : la table des vintages entière passe au compute — chaque
  # indicateur est estampillé depuis le vintage de sa source de référence
  # déclarée (INDICATEURS_DEMOGRAPHIE), plus de tampon de fraîcheur du thème.
  payload <- compute_payload(brut, vintages = vintages)

  publish(payload, sortie)
  nanoparquet::write_parquet(vintages, file.path(sortie, "vintages.parquet"))

  payload
}
