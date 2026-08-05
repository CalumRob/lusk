# helper-fixture-sirene --------------------------------------------------------
# Le jeu de données synthétique de la normalisation SIRENE (todo 9, plan
# economie-pipeline-contracts — la bascule régionale) : un mini extrait de
# l'export data.bretagne.bzh du jeu « sirene-v3-consolidee » (Base SIRENE -
# Région Bretagne) DANS LA FORME du vocabulaire ODS — les champs épinglés par
# le manifeste (codecommuneetablissement, etatadministratifetablissement,
# activiteprincipaleetablissement, classeetablissement pour le libellé APET,
# datederniertraitementetablissement pour la date de fraîcheur) plus la
# tranche d'effectifs en LIBELLÉS ODS (trancheeffectifsetablissement), et une
# colonne leurre (libellecommuneetablissement) que la normalisation doit
# écarter. Le statut administratif est en libellés ODS enrichis
# (« Actif »/« Fermé »), jamais en codes nationaux « A »/« F ». La colonne
# datederniertraitementetablissement porte des horodatages ISO plausibles :
# le MAXIMUM parmi les lignes RETENUES (actifs bretons exploitables) est
# 2026-03-31 — la date de référence épinglée par le manifeste — l'auto-
# vérification de fraîcheur du normaliseur passe. Les lignes exclues portent
# aussi des dates (le contrôle ne court que sur les lignes retenues, mais la
# colonne est ainsi exercée partout).
# Le jeu couvre, à travers 14 lignes : 4 communes bretonnes (22001 · 29001 ·
# 35001 · 56001, une par département), un doublon de cellule (2 établissements
# sur 22001 × 01.11Z × « 0 salarié »), les deux jumelles d'une même cellule
# commune × APE (22001 × 47.11Z × « 20 à 49 salariés ») qui NE se distinguent
# que par leur diffusion côté INSEE — le statut de diffusion n'étant PAS retenu
# (todo 9), elles fusionnent en UNE cellule — et le chemin d'échec : un
# établissement fermé (« Fermé »), une commune manquante, une commune hors
# Bretagne (44001), une commune au format invalide, un département non breton
# (12345), un code APE manquant et un code APE invalide.

load_fixture_sirene <- function() {
  readr::read_csv(
    testthat::test_path("fixtures", "sirene-snapshot-fixture.csv"),
    col_types = readr::cols(.default = readr::col_character()),
    show_col_types = FALSE
  )
}
