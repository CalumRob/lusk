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
# Le jeu couvre, à travers 15 lignes : 4 communes bretonnes (22001 · 29001 ·
# 35001 · 56001, une par département), un doublon de cellule (2 établissements
# sur 22001 × 01.11Z × « 0 salarié »), les deux jumelles d'une même cellule
# commune × APE (22001 × 47.11A × « 20 à 49 salariés ») qui NE se distinguent
# que par leur diffusion côté INSEE — le statut de diffusion n'étant PAS retenu
# (todo 9), elles fusionnent en UNE cellule — l'inconnue « 00.00Z » (une ligne,
# issue #427 : non mappable vers l'A17, exercée par le mapping + le rapport
# d'exclusion du chaînon LQ) — et le chemin d'échec : un établissement fermé
# (« Fermé »), une commune manquante, une commune hors Bretagne (44001), une
# commune au format invalide, un département non breton (12345), un code APE
# manquant et un code APE invalide.

load_fixture_sirene <- function() {
  readr::read_csv(
    testthat::test_path("fixtures", "sirene-snapshot-fixture.csv"),
    col_types = readr::cols(.default = readr::col_character()),
    show_col_types = FALSE
  )
}

# fixture_lq_analytique --------------------------------------------------------
# Le mini snapshot normalisé de l'analyse LQ (partagé par
# test-analytics-economie-lq.R et test-analytics-economie-territoires.R) : 15
# lignes, commune × code APE × tranche. Après regroupement des tranches :
#   22001 : 01.11Z = 2 · 47.11A = 3 · 86.10Z = 5 · 00.00Z = 1   (total 11)
#   29001 : 01.11Z = 4 · 47.11A = 1 · 86.10Z = 5               (total 10)
#   35001 : 01.11Z = 6 · 47.11A = 2 · 86.10Z = 2               (total 10)
#   56001 : 01.11Z = 1 · 47.11A = 1 · 86.10Z = 1               (total 3 — SOUS LE PLANCHER)
# Issue #427 — le mapping A17 (mapper_activites_a17, AVANT le plancher) :
#   - les trois sous-classes remontent à leurs postes officiels
#     (01.11Z → AZ · 47.11A → GZ · 86.10Z → OQ), libellés officiels de
#     l'artefact épinglé (#426) ;
#   - « 00.00Z » (inconnue, absente de la correspondance — comme dans le
#     snapshot réel : exactement 1 établissement) est EXCLUE et RAPPORTÉE —
#     jamais silencieuse ;
#   - les totaux par commune reviennent donc à 10 / 10 / 10 (56001 à 3) et les
#     attendus de LQ calculés à la main restent des fractions exactes :
# Totaux bretons retenus : AZ = 12 · GZ = 6 · OQ = 12 · total = 30
# → parts bretonnes 0,4 / 0,2 / 0,4.
#   LQ 22001 : (2/10)/0,4 = 0,5 · (3/10)/0,2 = 1,5 · (5/10)/0,4 = 1,25
#   LQ 29001 : (4/10)/0,4 = 1,0 · (1/10)/0,2 = 0,5 · (5/10)/0,4 = 1,25
#   LQ 35001 : (6/10)/0,4 = 1,5 · (2/10)/0,2 = 1,0 · (2/10)/0,4 = 0,5
fixture_lq_analytique <- function() {
  tibble::tribble(
    ~commune, ~activity_code, ~activity_label, ~value, ~measure, ~source,
    ~vintage, ~etat_administratif, ~tranche_effectifs, ~naf_version,
    # 22001 — 4 lignes (deux tranches sur 01.11Z : le regroupement est exercé)
    "22001", "01.11Z", "Culture de céréales", 1L, "ETABLISSEMENTS_ACTIFS",
    "data.bretagne.bzh — Base SIRENE", "2026-04", "Actif", "0 salarié",
    "NAF rév. 2",
    "22001", "01.11Z", "Culture de céréales", 1L, "ETABLISSEMENTS_ACTIFS",
    "data.bretagne.bzh — Base SIRENE", "2026-04", "Actif", "1 ou 2 salariés",
    "NAF rév. 2",
    "22001", "47.11A", "Commerce de détail non spécialisé", 3L, "ETABLISSEMENTS_ACTIFS",
    "data.bretagne.bzh — Base SIRENE", "2026-04", "Actif", "0 salarié",
    "NAF rév. 2",
    "22001", "86.10Z", "Activités hospitalières", 5L, "ETABLISSEMENTS_ACTIFS",
    "data.bretagne.bzh — Base SIRENE", "2026-04", "Actif", "1 ou 2 salariés",
    "NAF rév. 2",
    # 22001 — l'inconnue « 00.00Z » (issue #427) : absente de la correspondance
    # NAF rév. 2 → A17, comme dans le snapshot réel (exactement 1 établissement)
    # — le mapping l'exclut et la rapporte, jamais silencieusement
    "22001", "00.00Z", "Activité inconnue", 1L, "ETABLISSEMENTS_ACTIFS",
    "data.bretagne.bzh — Base SIRENE", "2026-04", "Actif", "0 salarié",
    "NAF rév. 2",
    # 29001 — 3 lignes
    "29001", "01.11Z", "Culture de céréales", 4L, "ETABLISSEMENTS_ACTIFS",
    "data.bretagne.bzh — Base SIRENE", "2026-04", "Actif", "0 salarié",
    "NAF rév. 2",
    "29001", "47.11A", "Commerce de détail non spécialisé", 1L, "ETABLISSEMENTS_ACTIFS",
    "data.bretagne.bzh — Base SIRENE", "2026-04", "Actif", "0 salarié",
    "NAF rév. 2",
    "29001", "86.10Z", "Activités hospitalières", 5L, "ETABLISSEMENTS_ACTIFS",
    "data.bretagne.bzh — Base SIRENE", "2026-04", "Actif", "1 ou 2 salariés",
    "NAF rév. 2",
    # 35001 — 4 lignes (deux tranches sur 01.11Z)
    "35001", "01.11Z", "Culture de céréales", 3L, "ETABLISSEMENTS_ACTIFS",
    "data.bretagne.bzh — Base SIRENE", "2026-04", "Actif", "0 salarié",
    "NAF rév. 2",
    "35001", "01.11Z", "Culture de céréales", 3L, "ETABLISSEMENTS_ACTIFS",
    "data.bretagne.bzh — Base SIRENE", "2026-04", "Actif", "1 ou 2 salariés",
    "NAF rév. 2",
    "35001", "47.11A", "Commerce de détail non spécialisé", 2L, "ETABLISSEMENTS_ACTIFS",
    "data.bretagne.bzh — Base SIRENE", "2026-04", "Actif", "0 salarié",
    "NAF rév. 2",
    "35001", "86.10Z", "Activités hospitalières", 2L, "ETABLISSEMENTS_ACTIFS",
    "data.bretagne.bzh — Base SIRENE", "2026-04", "Actif", "1 ou 2 salariés",
    "NAF rév. 2",
    # 56001 — sous le plancher (total 3)
    "56001", "01.11Z", "Culture de céréales", 1L, "ETABLISSEMENTS_ACTIFS",
    "data.bretagne.bzh — Base SIRENE", "2026-04", "Actif", "0 salarié",
    "NAF rév. 2",
    "56001", "47.11A", "Commerce de détail non spécialisé", 1L, "ETABLISSEMENTS_ACTIFS",
    "data.bretagne.bzh — Base SIRENE", "2026-04", "Actif", "0 salarié",
    "NAF rév. 2",
    "56001", "86.10Z", "Activités hospitalières", 1L, "ETABLISSEMENTS_ACTIFS",
    "data.bretagne.bzh — Base SIRENE", "2026-04", "Actif", "1 ou 2 salariés",
    "NAF rév. 2"
  )
}
