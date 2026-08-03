# vintage ---------------------------------------------------------------------
# Étape 4 : vintages. Écrit source / version / licence / dates pour chaque jeu
# de données, depuis le manifeste — la table des fraîcheurs et le SEAM du
# watchdog (ADR-0001 : la licence y figure). Deux dates par source (point 5) :
# date_reference (ce que « RP 2023 » veut dire) et date_publication (la mise
# en ligne réelle — ce que le watchdog comparera à data.gouv pour déclencher
# le pipeline). `id` reste dans la table pour un pointage explicite par source.
# Issue #13 : le build des vintages est générique — il se projette depuis le
# manifeste DU THÈME ; le module du thème expose son builder (vintages_<theme>)
# qui passe son propre manifeste.

vintages_depuis_manifest <- function(manifest) {
  manifest %>%
    dplyr::transmute(
      id = id,
      source = source,
      version = vintage,
      licence = licence,
      date_reference = date_reference,
      date_publication = date_publication
    )
}
