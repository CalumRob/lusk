# download --------------------------------------------------------------------
# Étape 1 : téléchargement. Lit le manifeste des sources, récupère les jeux de
# données vers le cache brut (data/raw, dans le dépôt — jamais sur C:).
# Le manifeste est le SEAM du téléchargement : une table de sources vérifiées
# (docs/research/rp-dossier-complet.md), testée pour son intégrité, jamais
# exécutée contre le réseau dans la boucle de test.

MANIFEST_DEMOGRAPHIE <- tibble::tribble(
  ~id, ~source, ~url, ~fichier, ~vintage, ~date, ~licence, ~note,
  "serie_historique",
  "INSEE — Série historique du recensement",
  "https://api.insee.fr/melodi/file/DS_RP_SERIE_HISTORIQUE/DS_RP_SERIE_HISTORIQUE_2023_CSV_FR",
  "DS_RP_SERIE_HISTORIQUE_2023_CSV_FR.zip", "2023", "2023-01-01", "lov2",
  "Population 1968-2023 (POP), superficie (SUP, km2), naissances/décès cumulés entre recensements (BRTH/DEATH)",
  "menages",
  "INSEE — Ménages (dossier complet)",
  "https://api.insee.fr/melodi/file/DS_RP_MENAGES_COMP/DS_RP_MENAGES_COMP_2023_CSV_FR",
  "DS_RP_MENAGES_COMP_2023_CSV_FR.zip", "2023", "2023-01-01", "lov2",
  "Nombre de ménages (DWELLINGS) et population des ménages (DWELLINGS_POPSIZE)",
  "age_detail",
  "INSEE — Population par sexe et âge (PRINC)",
  "https://api.insee.fr/melodi/file/DS_RP_POPULATION_PRINC/DS_RP_POPULATION_PRINC_2023_CSV_FR",
  "DS_RP_POPULATION_PRINC_2023_CSV_FR.zip", "2023", "2023-01-01", "lov2",
  "Structure par âge : 7 tranches exhaustives + agrégats (dont Y_LT20, moins de 20 ans)",
  "epci",
  "INSEE — Base des EPCI à fiscalité propre au 01/01/2025",
  "https://www.insee.fr/fr/statistiques/fichier/2510634/epci_au_01-01-2025.zip",
  "epci_au_01-01-2025.zip", "2025", "2025-01-01", "lov2",
  "Feuille Composition_communale : CODGEO -> EPCI (SIREN), LIBEPCI, DEP, REG"
)

# Télécharge les sources du manifeste vers le cache brut. Idempotent : un
# fichier déjà présent est laissé intact (aucun réseau, aucune corruption).
download_sources <- function(manifest = MANIFEST_DEMOGRAPHIE, cache = "data/raw") {
  if (!dir.exists(cache)) dir.create(cache, recursive = TRUE)

  for (i in seq_len(nrow(manifest))) {
    cible <- file.path(cache, manifest$fichier[i])
    if (file.exists(cible)) next
    utils::download.file(manifest$url[i], cible, mode = "wb", quiet = TRUE)
  }

  invisible(manifest)
}
