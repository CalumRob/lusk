# run_pipeline ----------------------------------------------------------------
# L'entrée unique et documentée du pipeline (docs/architecture.md §Pipeline) :
# download -> construire (filter/reshape) -> vintage -> compute -> publish.
# Idempotent par construction : les téléchargements sautent ce qui existe (et
# valide), le rebuild est déterministe, la publication écrase (sémantique
# d'upsert).
# mode (issue #8, ADR-0004) : "full" (défaut, local) télécharge tout ; "cron"
# (runner GitHub Actions) ne télécharge que les sources « cron » du manifeste,
# saute les « manuel » (enregistrées « à traiter à la main ») et s'arrête
# bruyamment si une source cron échoue après les retries. Transmis tel quel à
# download_sources(), qui renvoie les statuts par source pour le rapport de run.

run_pipeline <- function(cache = "data/raw", sortie = "data/processed",
                         mode = c("full", "cron")) {
  mode <- match.arg(mode)
  download_sources(MANIFEST_DEMOGRAPHIE, cache = cache, mode = mode)

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
