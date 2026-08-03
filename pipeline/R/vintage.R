# vintage ---------------------------------------------------------------------
# Étape 4 : vintages. Écrit source / version / licence / date pour chaque jeu
# de données, depuis le manifeste — la table des fraîcheurs et le SEAM du
# watchdog (ADR-0001 : la licence y figure). Un futur watchdog comparera les
# dates de publication de data.gouv à cette table pour déclencher le pipeline.

vintages_demographie <- function(manifest = MANIFEST_DEMOGRAPHIE) {
  manifest %>%
    dplyr::transmute(
      source = source,
      version = vintage,
      licence = licence,
      date = date
    )
}
