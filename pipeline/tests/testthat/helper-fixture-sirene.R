# helper-fixture-sirene --------------------------------------------------------
# Le jeu de données synthétique de la normalisation SIRENE (todo 4, plan
# economie-pipeline-contracts) : un mini snapshot mensuel des établissements
# DANS LA FORME du dessin de fichier INSEE StockEtablissement (version 311) —
# les champs épinglés par le manifeste (codeCommuneEtablissement,
# etatAdministratifEtablissement, statutDiffusionEtablissement,
# activitePrincipaleEtablissement) plus la tranche d'effectifs (métadonnée),
# la nomenclature du code APE et le libellé (porté « quand disponible » par
# l'enveloppe commune), et deux colonnes leurres (codePostalEtablissement) que
# la normalisation doit écarter.
# Le jeu couvre, à travers 14 lignes : 4 communes bretonnes (22001 · 29001 ·
# 35001 · 56001, une par département), un doublon de cellule (2 établissements
# sur 22001 × 01.11Z × O × 00), une diffusion partielle « P » conservée et sa
# jumelle « O » (22001 × 47.11Z × tranche 12) — et le chemin d'échec : un
# établissement fermé (F), une commune manquante, une commune hors Bretagne
# (44001), une commune au format invalide, un département non breton (12345),
# un code APE manquant et un code APE invalide.

load_fixture_sirene <- function() {
  readr::read_csv(
    testthat::test_path("fixtures", "sirene-snapshot-fixture.csv"),
    col_types = readr::cols(.default = readr::col_character()),
    show_col_types = FALSE
  )
}
