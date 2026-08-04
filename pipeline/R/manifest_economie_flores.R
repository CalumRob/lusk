# manifest_economie_flores ----------------------------------------------------
# Les deux sources Flores du thème Économie/Emploi (plan economie-pipeline-
# contracts, todo 2) : INSEE 8266010 « Nombre d'établissements et effectifs
# salariés par secteur d'activité et tranche d'effectifs détaillés fin 2024 »
# (Fichier localisé des rémunérations et de l'emploi salarié — Flores).
# Vérifié en direct le 2026-08-04 (https://www.insee.fr/fr/statistiques/8266010) :
#   - A38 : DS_FLORES_A38_2024_CSV_FR.zip (csv, 21 Mo) — 9 tranches d'effectifs.
#   - A88 : DS_FLORES_A88_2024_CSV_FR.zip (csv, 8 Mo) — SANS tranche d'effectifs
#     (les fichiers A88 ne sont pas proposés selon la tranche d'effectifs).
#   - Mesures (FLORES_MEASURE) : UNIT_LOC (nombre d'établissements) et EMPL3112
#     (effectifs présents la dernière semaine de décembre).
#   - Géographie : communale au 1er janvier 2025 (GEO / GEO_OBJECT), tous les
#     niveaux géographiques du produit.
#   - Avertissement INSEE : à l'échelle communale, les données n'ont pas fait
#     l'objet d'une validation par des experts ; la comparabilité entre
#     millésimes n'est pas garantie.
#   - Parution le 31/03/2026 ; données fin 2024.
#
# Ce sont des FRAGMENTS de manifeste « par source » (convention vague 2, issue
# #13) : le manifeste du thème Économie/Emploi concatènera ces deux lignes avec
# SIRENE (todo 1) et RP Emploi (todo 3). DEUX ids et DEUX caches distincts —
# jamais une seule ligne « Flores » : chaque nomenclature garde SON contrat.
# Chaque source garde SON vintage (2024), SA date de référence (fin 2024) et SA
# date de publication (31/03/2026) — AUCUN alignement de date entre sources,
# AUCUNE table de passage vers NAF (la classification native A38/A88 n'est pas
# un code NAF ; pas de croisement dans cette phase). Mode « cron »
# (téléchargement direct sans clé), type « fichier » (URL -> fichier, intégrité
# vérifiée).
#
# Au-delà de l'enveloppe commune (id, source, url, fichier, vintage,
# date_reference, date_publication, licence, note, mode, type), chaque ligne
# porte les dimensions natives du contrat Flores en colonnes vérifiables :
#   - classification     : la nomenclature agrégée native (A38 ou A88) ;
#   - mesures            : les deux mesures de la source (établissements ET
#                          effectifs salariés) ;
#   - tranches_effectifs : la sémantique des tranches d'effectifs (9 tranches
#                          pour A38, absentes pour A88) ;
#   - geographie         : le grain géographique natif (communes).
MANIFEST_ECONOMIE_FLORES <- tibble::tribble(
  ~id, ~source, ~url, ~fichier, ~vintage, ~date_reference, ~date_publication, ~licence, ~note, ~mode, ~type, ~classification, ~mesures, ~tranches_effectifs, ~geographie,
  "flores_a38",
  "INSEE — Flores : nombre d'établissements et effectifs salariés par secteur d'activité (A38)",
  "https://www.insee.fr/fr/statistiques/fichier/8266010/DS_FLORES_A38_2024_CSV_FR.zip",
  "DS_FLORES_A38_2024_CSV_FR.zip", "2024", "2024-12-31", "2026-03-31", "lov2",
  "Nombre d'établissements (UNIT_LOC) et effectifs salariés (EMPL3112) par secteur d'activité A38 et tranche d'effectifs ; géographie communale au 01/01/2025 ; données communales non validées par des experts (avertissement INSEE)",
  "cron", "fichier",
  "A38", "etablissements;effectifs_salaries", "9 tranches", "communes",
  "flores_a88",
  "INSEE — Flores : nombre d'établissements et effectifs salariés par secteur d'activité (A88)",
  "https://www.insee.fr/fr/statistiques/fichier/8266010/DS_FLORES_A88_2024_CSV_FR.zip",
  "DS_FLORES_A88_2024_CSV_FR.zip", "2024", "2024-12-31", "2026-03-31", "lov2",
  "Nombre d'établissements (UNIT_LOC) et effectifs salariés (EMPL3112) par secteur d'activité A88 — sans tranche d'effectifs (les fichiers A88 ne sont pas déclinés par tranche) ; géographie communale au 01/01/2025 ; données communales non validées par des experts (avertissement INSEE)",
  "cron", "fichier",
  "A88", "etablissements;effectifs_salaries", "sans tranche", "communes"
)

# verifier_contrat_flores -----------------------------------------------------
# Le contrat du manifeste Flores (todo 2) : ce que la machinerie et les tests
# exigent de CHAQUE ligne — ids et caches distincts, classification native,
# les deux mesures, la sémantique des tranches, la géographie, le vintage propre
# à chaque source, la licence, et AUCUN champ de croisement (NAF) ni
# d'alignement de date. stop() sur violation ; invisible(manifest) sinon. Le
# fichier de test exerce le chemin heureux (le manifeste réel) et les chemins
# d'échec (ids dupliqués, ids échangés A38/A88, déclaration de tranches
# manquante, donnée étiquetée SIRENE/NAF).
verifier_contrat_flores <- function(manifest = MANIFEST_ECONOMIE_FLORES) {
  colonnes <- c("id", "source", "url", "fichier", "vintage", "date_reference",
                "date_publication", "licence", "note", "mode", "type",
                "classification", "mesures", "tranches_effectifs", "geographie")
  manquantes <- setdiff(colonnes, names(manifest))
  if (length(manquantes) > 0) {
    stop("Manifeste Flores : colonnes manquantes (",
         paste(manquantes, collapse = ", "), ").", call. = FALSE)
  }

  # deux contrats distincts : A38 et A88, ids et caches distincts
  if (nrow(manifest) != 2) {
    stop("Manifeste Flores : exactement deux sources attendues (A38 et A88).",
         call. = FALSE)
  }
  if (any(duplicated(manifest$id))) {
    stop("Manifeste Flores : ids dupliqués.", call. = FALSE)
  }
  if (any(duplicated(manifest$fichier))) {
    stop("Manifeste Flores : cibles de cache dupliquées.", call. = FALSE)
  }
  if (!setequal(manifest$id, c("flores_a38", "flores_a88"))) {
    stop("Manifeste Flores : ids inattendus.", call. = FALSE)
  }

  # une donnée Flores n'est JAMAIS étiquetée SIRENE ni NAF (le label de la
  # source et de la classification — vérifié AVANT la cohérence id/classification
  # pour que l'erreur porte l'étiquette fautive)
  etiquettes <- tolower(paste(manifest$source, manifest$classification))
  if (any(grepl("sirene|naf", etiquettes))) {
    stop("Manifeste Flores : une source étiquetée SIRENE ou NAF.", call. = FALSE)
  }

  # chaque id correspond à SA classification native (flores_a38 <-> A38, etc.)
  classes <- stats::setNames(manifest$classification, manifest$id)
  if (!all(classes[c("flores_a38", "flores_a88")] == c("A38", "A88"))) {
    stop("Manifeste Flores : id et classification native incohérents.",
         call. = FALSE)
  }

  # les deux mesures déclarées : établissements ET effectifs salariés
  if (!all(grepl("etablissements", manifest$mesures) &
           grepl("effectifs_salaries", manifest$mesures))) {
    stop("Manifeste Flores : les deux mesures (établissements et effectifs ",
         "salariés) doivent être déclarées.", call. = FALSE)
  }

  # la sémantique des tranches d'effectifs déclarée pour chaque source
  if (any(is.na(manifest$tranches_effectifs)) ||
      any(!nzchar(manifest$tranches_effectifs))) {
    stop("Manifeste Flores : sémantique des tranches d'effectifs manquante.",
         call. = FALSE)
  }

  # les champs de géographie déclarés
  if (any(is.na(manifest$geographie)) ||
      any(!nzchar(manifest$geographie))) {
    stop("Manifeste Flores : champs de géographie manquants.", call. = FALSE)
  }

  # le vintage : chaque source porte SA date de référence et SA publication
  if (any(is.na(manifest$vintage)) || any(is.na(manifest$date_reference)) ||
      any(is.na(manifest$date_publication))) {
    stop("Manifeste Flores : vintage, date de référence ou date de publication ",
         "manquants.", call. = FALSE)
  }

  # la licence, l'URL et le mode/type
  if (!all(manifest$licence == "lov2")) {
    stop("Manifeste Flores : licence inattendue.", call. = FALSE)
  }
  if (!all(startsWith(manifest$url, "https://"))) {
    stop("Manifeste Flores : URL non HTTPS.", call. = FALSE)
  }
  if (!all(manifest$mode == "cron") || !all(manifest$type == "fichier")) {
    stop("Manifeste Flores : mode ou type inattendus.", call. = FALSE)
  }

  # AUCUN champ de croisement (NAF) ni d'alignement de date — ni colonne, ni
  # étiquette (l'étiquette SIRENE/NAF est déjà vérifiée plus haut)
  if (any(grepl("crosswalk|align|naf", tolower(names(manifest))))) {
    stop("Manifeste Flores : champ de croisement ou d'alignement de date.",
         call. = FALSE)
  }

  invisible(manifest)
}
