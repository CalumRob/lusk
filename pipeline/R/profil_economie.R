# profil_economie ----------------------------------------------------------------
# Le profilage et la validation « commune d'abord » du thème Économie/Emploi
# (plan economie-pipeline-contracts, todo 7 ; docs/themes/economie-emploi.md
# §Pipeline notes — étape 3 « profile »). Il s'exécute indépendamment pour
# CHAQUE table normalisée (sirene_snapshot, flores_a38, flores_a88, rp_emploi)
# et produit, pour chacune, une preuve déterministe du contrat : couverture
# communale (communes présentes / attendues depuis LE référentiel partagé
# qu'utilisent les normalisateurs — lire_epci), comptes de lignes, couverture
# des activités, comportement des cellules (zéro OBSERVÉ / cellule omise /
# valeur manquante — jamais confondus), suppression (diffusion partielle
# SIRENE, statuts d'observation Flores K/W, exclusions RP), exclusions
# d'éligibilité SIRENE, et résumés de sparsité / fiabilité.
#
# Deux engagements du plan (acceptance criteria du todo 7) :
#   - DÉTERMINISME : le rapport d'une table est une liste de tibbles purement
#     fonctionnelle (aucun horodatage, aucun ordre d'apparition, aucun état
#     global) — relancer le profilage sur les mêmes fixtures produit des
#     preuves OCTET-POUR-OCTET identiques (test-profile-economie.R) ;
#   - ÉCHEC BRUYANT : le profilage est AUSSI la validation de bon sens des
#     tables normalisées (le même rôle que validate_payload, compute.R:265).
#     Une commune inconnue du référentiel, un code mal formé ou un statut de
#     suppression non classé arrête le profilage en NOMmant la source/table
#     fautive — jamais de chiffres faux publiés silencieusement.
#
# Garde-fous du plan (MUST NOT) : aucun LQ, relatedness, vert/nitrogen,
# matrice, seuil de présence, rang ni colonne analytique — le rapport décrit
# l'observation, il ne calcule rien au-delà de comptages et de moyennes
# descriptives. Aucun payload de fiche publié : les preuves ne sortent QUE
# sous pipeline/data/processed/ (le dossier data/ reste gitignoré).

# TABLES_ECONOMIE_PROFIL --------------------------------------------------------
# Les quatre tables profilées, dans l'ordre du contrat (une section de rapport
# par table, jamais de table fusionnée). L'ordre est figé : le rapport agrégé
# est déterministe.
TABLES_ECONOMIE_PROFIL <- c(
  "sirene_snapshot", "flores_a38", "flores_a88", "rp_emploi"
)

# STATUTS_OBSERVATION_FLORES ----------------------------------------------------
# Le vocabulaire fermé des statuts d'observation Flores (résolu sur le fichier
# réel 2024, reshape_economie_flores.R) : A = observation normale, K = valeur
# NON diffusée (cellule non publiée — valeur NA, jamais convertie en zéro),
# W = observation d'inclusion (valeur d'une autre catégorie incluse ici).
# Tout autre statut est une suppression non classée : le profilage refuse.
STATUTS_OBSERVATION_FLORES <- c("A", "K", "W")

# NOTE_FIABILITE_FLORES ---------------------------------------------------------
# L'avertissement de fiabilité de la source, porté par le manifeste
# (MANIFEST_ECONOMIE_FLORES$note) : à l'échelle communale, les données Flores
# n'ont pas été validées par des experts. Le rapport le répète — la sparsité
# et la suppression se lisent à la lumière de cet avertissement.
NOTE_FIABILITE_FLORES <- paste0(
  "Données communales non validées par des experts ; comparabilité entre ",
  "millésimes non garantie (avertissement INSEE)."
)

# valider_communes_table --------------------------------------------------------
# La validation « commune d'abord » partagée par les quatre profils : toutes
# les communes d'une table normalisée doivent être des codes COG 5 chiffres du
# référentiel breton partagé (lire_epci). C'est LE garde-fou référentiel du
# profilage — une commune corrompue (format invalide) ou hors référentiel
# (code breton inconnu de la base EPCI) arrête le profilage en nommant la
# table fautive (l'acceptance du todo 7 : « corrupt a commune code ... fail
# loudly with the source/table name »).
valider_communes_table <- function(table, reference, nom_table) {
  if (!"commune" %in% names(table)) {
    stop(sprintf(
      "Profil Économie — %s : la colonne commune manque à la table normalisée.",
      nom_table
    ), call. = FALSE)
  }
  communes <- unique(table$commune)

  # format COG : 5 chiffres — un code corrompu (tronqué, lettres, NA) est une
  # violation du contrat même s'il figurait par hasard dans le référentiel
  mal_formees <- communes[is.na(communes) | !grepl("^[0-9]{5}$", communes)]
  if (length(mal_formees) > 0) {
    affichees <- ifelse(is.na(mal_formees), "<NA>", mal_formees)
    stop(sprintf(
      "Profil Économie — %s : commune(s) au format COG invalide : %s.",
      nom_table, paste(sort(affichees), collapse = ", ")
    ), call. = FALSE)
  }

  # intégrité référentielle : chaque commune citée doit exister dans la base
  # EPCI bretonne — la MÊME référence que la jointure des normalisateurs
  inconnues <- setdiff(communes, reference$CODGEO)
  if (length(inconnues) > 0) {
    stop(sprintf(
      "Profil Économie — %s : commune(s) absente(s) du référentiel Bretagne : %s.",
      nom_table, paste(sort(inconnues), collapse = ", ")
    ), call. = FALSE)
  }

  invisible(TRUE)
}

# valider_vocabulaire -----------------------------------------------------------
# La validation d'un vocabulaire fermé (statut de diffusion SIRENE, statut
# d'observation Flores, motif d'exclusion...) : toute valeur hors vocabulaire
# — y compris NA — est une valeur non classée et arrête le profilage en
# nommant la table. `libelle` nomme le champ dans le message d'erreur.
valider_vocabulaire <- function(donnees, var, vocabulaire, nom_table, libelle) {
  valeurs <- unique(donnees[[var]])
  inconnues <- setdiff(valeurs, vocabulaire)
  if (length(inconnues) > 0) {
    affichees <- ifelse(is.na(inconnues), "<NA>", inconnues)
    stop(sprintf(
      "Profil Économie — %s : %s non classé(s) : %s.",
      nom_table, libelle, paste(sort(affichees), collapse = ", ")
    ), call. = FALSE)
  }
  invisible(TRUE)
}

# compter_par -------------------------------------------------------------------
# Le décompte d'une colonne catégorielle en tibble (statut, lignes), trié par
# statut — l'ordre du rapport est l'ordre trié, jamais l'ordre de première
# apparition (le déterminisme du rapport en dépend). NA compte comme une
# catégorie (le profilage la signale, il ne la masque pas).
compter_par <- function(donnees, var) {
  compte <- table(donnees[[var]], useNA = "ifany")
  tibble::tibble(
    statut = names(compte),
    lignes = as.integer(unname(compte))
  ) %>%
    dplyr::arrange(statut)
}

# couverture_communes -----------------------------------------------------------
# La couverture communale d'une table : combien de communes du référentiel
# sont présentes / absentes, et combien de communes de la table sont inconnues
# du référentiel (doit toujours être 0 — valider_communes_table a déjà stoppé
# sinon ; la ligne reste dans le rapport pour la preuve). La colonne `detail`
# porte les codes concernés (rien n'est perdu silencieusement).
couverture_communes <- function(communes_table, reference) {
  ref <- unique(reference$CODGEO)
  presentes <- unique(communes_table)
  absentes <- setdiff(ref, presentes)
  inconnues <- setdiff(presentes, ref)
  tibble::tibble(
    metric = c(
      "communes_reference", "communes_presentes",
      "communes_absentes", "communes_inconnues"
    ),
    valeur = c(
      length(ref), length(presentes), length(absentes), length(inconnues)
    ),
    detail = c(
      "", "",
      paste(sort(absentes), collapse = ","),
      paste(sort(inconnues), collapse = ",")
    )
  )
}

# profil_table_sirene -----------------------------------------------------------
# Le profil de la table sirene_snapshot (normaliser_sirene_snapshot, todo 4 ;
# bascule régionale todo 9) : une ligne par cellule commune × code APE ×
# tranche d'effectifs, la valeur = nombre d'établissements ACTIFS (jamais 0,
# jamais NA — le snapshot ne garde que des cellules observées, les zéros et
# les manquants n'existent pas dans la table). Les cellules omises
# (combinaison commune × activité × tranche absente) sont donc LE signal de
# sparsité de la source. La suppression ne se lit plus dans la table : le
# statut de diffusion de la source n'est pas retenu (todo 9) — chaque
# établissement actif avec commune et code APE exploitables compte, quelle que
# soit sa diffusion — le rapport le dit explicitement par un tibble vide, et la
# suppression d'éligibilité se lit dans le rapport d'exclusions (fermé,
# commune/NAF inutilisable...).
profil_table_sirene <- function(resultat, reference, nom_table = "sirene_snapshot") {
  table <- resultat$table
  exclusions <- resultat$exclusions

  valider_communes_table(table, reference, nom_table)
  valider_vocabulaire(table, "etat_administratif", "Actif",
                      nom_table, "statut administratif")
  valider_vocabulaire(exclusions, "raison", RAISONS_EXCLUSION_SIRENE,
                      nom_table, "motif d'exclusion")

  n_communes <- dplyr::n_distinct(table$commune)
  n_activites <- dplyr::n_distinct(table$activity_code)
  n_tranches <- dplyr::n_distinct(table$tranche_effectifs)
  potentielles <- n_communes * n_activites * n_tranches
  observees <- nrow(table)
  zero_observe <- sum(table$value == 0, na.rm = TRUE)
  manquantes <- sum(is.na(table$value))
  omises <- potentielles - observees

  list(
    couverture = couverture_communes(table$commune, reference),
    comptes = tibble::tibble(
      metric = c(
        "lignes", "communes", "activites_distinctes",
        "mesures_distinctes", "valeur_totale_brute"
      ),
      valeur = c(
        observees, n_communes, n_activites,
        dplyr::n_distinct(table$measure), sum(table$value, na.rm = TRUE)
      )
    ),
    cellules = tibble::tibble(
      statut_cellule = c(
        "potentielles", "observees", "zero_observe", "manquantes", "omises"
      ),
      lignes = c(potentielles, observees, zero_observe, manquantes, omises)
    ),
    # le statut de diffusion de la source n'est pas retenu (todo 9) — la table
    # n'en porte aucune ligne : le tibble vide est la preuve explicite
    suppression = tibble::tibble(statut = character(), lignes = integer()),
    exclusions = dplyr::bind_rows(
      tibble::tibble(motif = "total", lignes = nrow(exclusions)),
      compter_par(exclusions, "raison") %>%
        dplyr::rename(motif = statut)
    ),
    sparsite = tibble::tibble(
      metric = c(
        "densite_cellules", "valeur_max", "valeur_moyenne",
        "part_zero_observe", "part_manquante"
      ),
      valeur = c(
        if (potentielles > 0) observees / potentielles else NA_real_,
        if (observees > 0) max(table$value, na.rm = TRUE) else NA_real_,
        if (observees > 0) mean(table$value, na.rm = TRUE) else NA_real_,
        if (observees > 0) zero_observe / observees else NA_real_,
        if (observees > 0) manquantes / observees else NA_real_
      )
    ),
    fiabilite = tibble::tibble(
      cle = c(
        "source", "vintage", "mesure", "naf_version", "etat_administratif",
        "note_diffusion", "note_eligibilite"
      ),
      valeur = c(
        paste(unique(table$source), collapse = ","),
        paste(unique(table$vintage), collapse = ","),
        paste(unique(table$measure), collapse = ","),
        paste(unique(table$naf_version), collapse = ","),
        "Actif (actifs seuls — les établissements fermés sont exclus et rapportés)",
        paste0(
          "Le statut de diffusion de la source n'est pas retenu — chaque ",
          "établissement actif avec commune et code APE exploitables compte, ",
          "quelle que soit sa diffusion ; aucune dimension de suppression ",
          "dans la table"
        ),
        paste0(
          "Établissements hors éligibilité (fermés, commune ou code APE ",
          "inutilisables) comptés dans le rapport d'exclusions — jamais ",
          "converti en effectif salarié (les tranches restent de la métadonnée)"
        )
      )
    )
  )
}

# profil_table_flores -----------------------------------------------------------
# Le profil d'une table Flores (normaliser_flores_a38 / _a88, todo 5) : une
# ligne par cellule commune × poste natif (× tranche pour A38) × mesure, avec
# le statut d'observation natif. C'est LA table qui porte la distinction
# explicite exigée par le plan : zéro OBSERVÉ (valeur 0, statut A), cellule
# non diffusée (statut K, valeur NA), observation d'inclusion (statut W) et
# cellule OMISE (combinaison absente du fichier). Le rapport compte chaque
# état séparément — la source ne les confond jamais.
profil_table_flores <- function(resultat, reference) {
  table <- resultat$table
  exclusions <- resultat$exclusions
  nom_table <- unique(table$source)[1]
  classification <- unique(table$classification)[1]

  valider_communes_table(table, reference, nom_table)
  valider_vocabulaire(table, "statut_observation", STATUTS_OBSERVATION_FLORES,
                      nom_table, "statut d'observation")
  valider_vocabulaire(table, "measure", c("etablissements", "effectifs_salaries"),
                      nom_table, "mesure")
  valider_vocabulaire(table, "concept", CONCEPT_FLORES,
                      nom_table, "concept")

  n_communes <- dplyr::n_distinct(table$commune)
  n_activites <- dplyr::n_distinct(table$activity_code)
  n_mesures <- dplyr::n_distinct(table$measure)
  n_tranches <- if (classification == "A38") {
    dplyr::n_distinct(table$tranche_effectifs)
  } else {
    1L  # les fichiers A88 ne sont pas déclinés par tranche d'effectifs
  }
  potentielles <- n_communes * n_activites * n_mesures * n_tranches
  observees <- nrow(table)
  zero_observe <- sum(table$value == 0, na.rm = TRUE)
  manquantes <- sum(is.na(table$value))
  omises <- potentielles - observees

  list(
    couverture = couverture_communes(table$commune, reference),
    comptes = tibble::tibble(
      metric = c(
        "lignes", "communes", "activites_distinctes",
        "mesures_distinctes", "valeur_totale_brute"
      ),
      valeur = c(
        observees, n_communes, n_activites,
        n_mesures, sum(table$value, na.rm = TRUE)
      )
    ),
    cellules = tibble::tibble(
      statut_cellule = c(
        "potentielles", "observees", "zero_observe", "manquantes", "omises"
      ),
      lignes = c(potentielles, observees, zero_observe, manquantes, omises)
    ),
    suppression = compter_par(table, "statut_observation"),
    exclusions = dplyr::bind_rows(
      tibble::tibble(motif = "total", lignes = nrow(exclusions)),
      compter_par(exclusions, "motif") %>%
        dplyr::rename(motif = statut)
    ),
    sparsite = tibble::tibble(
      metric = c(
        "densite_cellules", "valeur_max", "valeur_moyenne",
        "part_zero_observe", "part_manquante", "part_non_diffusee"
      ),
      valeur = c(
        if (potentielles > 0) observees / potentielles else NA_real_,
        if (observees > 0) max(table$value, na.rm = TRUE) else NA_real_,
        if (observees > 0) mean(table$value, na.rm = TRUE) else NA_real_,
        if (observees > 0) zero_observe / observees else NA_real_,
        if (observees > 0) manquantes / observees else NA_real_,
        if (observees > 0) {
          sum(table$statut_observation == "K") / observees
        } else {
          NA_real_
        }
      )
    ),
    fiabilite = tibble::tibble(
      cle = c(
        "source", "vintage", "concept", "classification",
        "statut_observation", "note_fiabilite"
      ),
      valeur = c(
        paste(unique(table$source), collapse = ","),
        paste(unique(table$vintage), collapse = ","),
        paste(unique(table$concept), collapse = ","),
        paste(unique(table$classification), collapse = ","),
        paste0(
          "'A' observé ; 'K' valeur non diffusée (NA, jamais convertie en ",
          "zéro observé) ; 'W' observation d'inclusion (valeur d'une autre ",
          "catégorie incluse)"
        ),
        NOTE_FIABILITE_FLORES
      )
    )
  )
}

# profil_table_emploi_rp --------------------------------------------------------
# Le profil de la table rp_emploi (normaliser_emploi_rp, todo 6) : une ligne
# par commune bretonne × secteur natif du RP — l'emploi au lieu de RÉSIDENCE,
# source de validation indépendante. Le statut de suppression de la source
# (OBS_STATUS ≠ 'A') est filtré au pivot du contrat : il n'en subsiste AUCUNE
# ligne dans la table — le rapport le dit explicitement (la table RP est une
# source de validation, jamais un payload ; les exclusions EMPLT / hors
# Bretagne sont rapportées par le normalisateur).
profil_table_emploi_rp <- function(resultat, reference, nom_table = "rp_emploi") {
  table <- resultat$table
  exclusions <- resultat$exclusions

  valider_communes_table(table, reference, nom_table)
  valider_vocabulaire(table, "measure", MESURE_RP_EMPLOI,
                      nom_table, "mesure")
  valider_vocabulaire(table, "concept", CONCEPT_RP_EMPLOI,
                      nom_table, "concept")

  n_communes <- dplyr::n_distinct(table$commune)
  n_activites <- dplyr::n_distinct(table$activity_code)
  potentielles <- n_communes * n_activites
  observees <- nrow(table)
  zero_observe <- sum(table$value == 0, na.rm = TRUE)
  manquantes <- sum(is.na(table$value))
  omises <- potentielles - observees

  list(
    couverture = couverture_communes(table$commune, reference),
    comptes = tibble::tibble(
      metric = c(
        "lignes", "communes", "activites_distinctes",
        "mesures_distinctes", "valeur_totale_brute"
      ),
      valeur = c(
        observees, n_communes, n_activites,
        dplyr::n_distinct(table$measure), sum(table$value, na.rm = TRUE)
      )
    ),
    cellules = tibble::tibble(
      statut_cellule = c(
        "potentielles", "observees", "zero_observe", "manquantes", "omises"
      ),
      lignes = c(potentielles, observees, zero_observe, manquantes, omises)
    ),
    # le statut de suppression de la source est filtré au pivot — la table
    # n'en porte aucune ligne : le tibble vide est la preuve explicite
    suppression = tibble::tibble(statut = character(), lignes = integer()),
    exclusions = dplyr::bind_rows(
      tibble::tibble(motif = "total", lignes = nrow(exclusions)),
      compter_par(exclusions, "motif") %>%
        dplyr::rename(motif = statut)
    ),
    sparsite = tibble::tibble(
      metric = c(
        "densite_cellules", "valeur_max", "valeur_moyenne",
        "part_zero_observe", "part_manquante"
      ),
      valeur = c(
        if (potentielles > 0) observees / potentielles else NA_real_,
        if (observees > 0) max(table$value, na.rm = TRUE) else NA_real_,
        if (observees > 0) mean(table$value, na.rm = TRUE) else NA_real_,
        if (observees > 0) zero_observe / observees else NA_real_,
        if (observees > 0) manquantes / observees else NA_real_
      )
    ),
    fiabilite = tibble::tibble(
      cle = c(
        "source", "vintage", "concept", "mesure", "note_suppression"
      ),
      valeur = c(
        paste(unique(table$source), collapse = ","),
        paste(unique(table$vintage), collapse = ","),
        paste(unique(table$concept), collapse = ","),
        paste(unique(table$measure), collapse = ","),
        paste0(
          "Le statut de suppression de la source (OBS_STATUS ≠ 'A') est ",
          "filtré au pivot du contrat — la table rp_emploi n'en porte aucune ",
          "ligne ; l'emploi au lieu de travail (mesure non résidente) est ",
          "exclu et rapporté, jamais relabellé en emploi résident"
        )
      )
    )
  )
}

# profil_economie ---------------------------------------------------------------
# L'acte « profiler » du thème : les QUATRE tables normalisées (les listes
# {table, exclusions} renvoyées par les normalisateurs) + LE référentiel
# partagé (lire_epci — la MÊME référence que les jointures) -> la preuve
# profilée, une section par table. La référence doit porter CODGEO (la clé
# que les normalisateurs joignent). `cible` : quand il est fourni, les preuves
# sont écrites sous ce dossier (défaut : data/processed/economie/profil/) ;
# sans cible, le profil est retourné pur — la forme de test.
profil_economie <- function(tables, reference, cible = NULL) {
  ids <- names(tables)
  manquantes <- setdiff(TABLES_ECONOMIE_PROFIL, ids)
  if (length(manquantes) > 0) {
    stop("Profil Économie — tables absentes : ",
         paste(manquantes, collapse = ", "), ".", call. = FALSE)
  }
  inattendues <- setdiff(ids, TABLES_ECONOMIE_PROFIL)
  if (length(inattendues) > 0) {
    stop("Profil Économie — tables inattendues : ",
         paste(inattendues, collapse = ", "), ".", call. = FALSE)
  }
  if (!"CODGEO" %in% names(reference)) {
    stop("Profil Économie — la référence doit porter la colonne CODGEO ",
         "(la base EPCI bretonne de lire_epci).", call. = FALSE)
  }

  profil <- list(
    sirene_snapshot = profil_table_sirene(tables$sirene_snapshot, reference),
    flores_a38 = profil_table_flores(tables$flores_a38, reference),
    flores_a88 = profil_table_flores(tables$flores_a88, reference),
    rp_emploi = profil_table_emploi_rp(tables$rp_emploi, reference)
  )

  if (!is.null(cible)) ecrire_profil_economie(profil, cible)

  profil
}

# ecrire_profil_economie --------------------------------------------------------
# Persiste les preuves profilées sous le dossier Économie/Emploi des données
# processées (data/processed/economie/profil/) : un JSON par table,
# <id>-profil.json. Écriture déterministe (dataframe = "rows", ordre de lignes
# fixé par les tibbles, digits = 17, na = "null") : deux écritures des mêmes
# fixtures produisent des fichiers OCTET-POUR-OCTET identiques — la preuve
# demandée par l'acceptance du todo 7. Jamais de payload de fiche ici : la
# cible vit sous pipeline/data/ (gitignoré), pas sous public/.
ecrire_profil_economie <- function(profil, cible = "data/processed/economie/profil") {
  if (!dir.exists(cible)) dir.create(cible, recursive = TRUE)
  for (id in names(profil)) {
    jsonlite::write_json(
      profil[[id]],
      file.path(cible, paste0(id, "-profil.json")),
      dataframe = "rows", na = "null", pretty = TRUE,
      auto_unbox = TRUE, digits = 17
    )
  }
  invisible(profil)
}
