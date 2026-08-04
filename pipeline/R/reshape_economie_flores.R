# reshape_economie_flores -------------------------------------------------------
# Le remodelage de la source Flores du thème Économie/Emploi (plan
# economie-pipeline-contracts, todo 5) : le produit INSEE 8266010 « Nombre
# d'établissements et effectifs salariés par secteur d'activité et tranche
# d'effectifs détaillés fin 2024 » (Flores, contrat MANIFEST_ECONOMIE_FLORES)
# vers DEUX tables longues et creuses indépendantes — flores_a38 et
# flores_a88 — une par nomenclature agrégée NATIVE, jamais fusionnées (le
# manifeste : « DEUX ids et DEUX caches distincts — jamais une seule ligne
# Flores »). Chaque ligne porte l'enveloppe commune du thème (commune |
# activity_code | activity_label | value | measure | source | vintage), le
# concept d'emploi au LIEU DE TRAVAIL, la classification native, la tranche
# d'effectifs native (A38 seulement) et le statut d'observation natif.
#
# Le vocabulaire résolu par la recherche (todo 2 ; fichiers 2024 téléchargés et
# inspectés en direct le 2026-08-04 — format RÉEL des CSV) :
#   - A38  : DS_FLORES_A38_2024_data.csv, 9 colonnes GEO;GEO_OBJECT;ACTIVITY;
#            NUMBER_EMPL;LEGAL_FORM_WITH_PUBLIC;FLORES_MEASURE;OBS_STATUS;
#            TIME_PERIOD;OBS_VALUE — ACTIVITY = 38 postes A38 (2 lettres) + _T,
#            NUMBER_EMPL = 9 tranches d'effectifs (E0, E1T4, ..., E_GE500) + _T.
#   - A88  : DS_FLORES_A88_2024_data.csv, 8 colonnes (SANS NUMBER_EMPL — les
#            fichiers A88 ne sont pas déclinés par tranche) — ACTIVITY = 86
#            divisions (2 chiffres) + _T.
#   - FLORES_MEASURE : UNIT_LOC (nombre d'établissements) et EMPL3112 (effectifs
#            présents la dernière semaine de décembre) — les deux mesures de la
#            source, conservées telles quelles.
#   - LEGAL_FORM_WITH_PUBLIC = "1T9X7" (« Ensemble hors particuliers
#            employeurs ») : la seule modalité du fichier au niveau communal.
#   - OBS_STATUS : "A" (normale), "K" (« données inclues dans une autre
#            catégorie » — la valeur n'est PAS diffusée), "W" (« inclut les
#            données d'une autre catégorie » — valeur diffusée à un niveau
#            d'inclusion). Vérifié sur le fichier réel : les lignes K/W ne
#            partagent JAMAIS la clé (GEO, activité, tranche, mesure) d'une
#            ligne A — ce sont des observations à part entière, non des
#            doublons. Les lignes K (valeur vide) SONT les cellules non
#            diffusées de la source : elles restent dans la table avec leur
#            statut et une valeur NA — jamais converties en zéro observé.
#   - TIME_PERIOD = 2024, GEO_OBJECT = "COM" (les réapparitions en BV2022/
#            AAV2020/etc. ne sont pas le grain commune).
#
# La table est la perspective « lieu de travail » du marché du travail :
# le concept est une CONSTANTE (CONCEPT_FLORES) — jamais dérivée des données,
# donc jamais relabellée en emploi au lieu de résidence (contraire au contrat,
# cf. la table rp_emploi du todo 6). Aucune jointure à SIRENE, aucun code NAF
# ni table de passage, aucun grain primaire choisi : chaque nomenclature garde
# SA classification, SES tranches, SON vintage. Le lecteur CSV partagé
# (lire_csv_long) et la base des EPCI bretonne (lire_epci — LE référentiel, la
# jointure filtre) sont réutilisés ; filter_bretagne reste la garde explicite
# du schéma.

# CONCEPT_FLORES ----------------------------------------------------------------
# L'emploi au LIEU DE TRAVAIL : la perspective Flores (établissements localisés
# et leurs effectifs salariés). Constante — une ligne ne peut jamais être
# réinterprétée en emploi résident.
CONCEPT_FLORES <- "Emploi au lieu de travail"

# MESURES_FLORES ----------------------------------------------------------------
# Les deux mesures natives de la source (le champ FLORES_MEASURE du fichier)
# vers le vocabulaire du manifeste (mesures = "etablissements;effectifs_
# salaries") : UNIT_LOC = nombre d'établissements, EMPL3112 = effectifs
# présents la dernière semaine de décembre.
MESURES_FLORES <- c(
  "UNIT_LOC" = "etablissements",
  "EMPL3112" = "effectifs_salaries"
)

# FORME_JURIDIQUE_FLORES --------------------------------------------------------
# La forme légale du fichier au niveau communal : « Ensemble hors particuliers
# employeurs ». La seule modalité du produit (vérifiée sur les fichiers 2024) ;
# le contrat garde cette modalité et écarte (en le rapportant) tout autre code.
FORME_JURIDIQUE_FLORES <- "1T9X7"

# TRANCHES_FLORES_A38 -----------------------------------------------------------
# La dimension native des tranches d'effectifs de la nomenclature A38 (le
# champ NUMBER_EMPL du fichier) — les libellés du dictionnaire du produit
# (DS_FLORES_A38_2024_metadata.csv) : 9 tranches + le total _T. A88 n'a PAS de
# tranche — sa table ne porte donc aucune colonne de tranche (source-native).
TRANCHES_FLORES_A38 <- c(
  "E0" = "0 salarié",
  "E1T4" = "1 à 4 salariés",
  "E5T9" = "5 à 9 salariés",
  "E10T19" = "10 à 19 salariés",
  "E20T49" = "20 à 49 salariés",
  "E50T99" = "50 à 99 salariés",
  "E100T199" = "100 à 199 salariés",
  "E200T499" = "200 à 499 salariés",
  "E_GE500" = "500 salariés et plus",
  "_T" = "Total"
)

# pivoter_flores_a38 ------------------------------------------------------------
# Du fichier long INSEE vers le croisement commune × poste A38 × tranche
# d'effectifs × mesure : les lignes communales (COM) de la période du contrat
# (2024), de la forme juridique du contrat, des deux mesures de la source.
# TOUS les statuts d'observation sont conservés : une ligne K (valeur non
# diffusée) reste dans la table avec sa valeur NA et son statut — jamais
# transformée en zéro observé ; une ligne W reste avec sa valeur et son statut.
# Les combinaisons absentes du fichier restent absentes de la table (creuse).
pivoter_flores_a38 <- function(long) {
  long %>%
    dplyr::filter(
      GEO_OBJECT == "COM",
      LEGAL_FORM_WITH_PUBLIC == FORME_JURIDIQUE_FLORES,
      TIME_PERIOD == 2024,
      FLORES_MEASURE %in% names(MESURES_FLORES)
    ) %>%
    dplyr::transmute(
      commune = GEO,
      activity_code = ACTIVITY,
      tranche_effectifs = NUMBER_EMPL,
      measure = dplyr::recode(FLORES_MEASURE,
                              UNIT_LOC = "etablissements",
                              EMPL3112 = "effectifs_salaries"),
      value = OBS_VALUE,
      statut_observation = OBS_STATUS
    )
}

# pivoter_flores_a88 ------------------------------------------------------------
# Idem pour la nomenclature A88 — SANS la dimension tranche d'effectifs (les
# fichiers A88 ne sont pas déclinés par tranche) : le croisement commune ×
# division A88 × mesure.
pivoter_flores_a88 <- function(long) {
  long %>%
    dplyr::filter(
      GEO_OBJECT == "COM",
      LEGAL_FORM_WITH_PUBLIC == FORME_JURIDIQUE_FLORES,
      TIME_PERIOD == 2024,
      FLORES_MEASURE %in% names(MESURES_FLORES)
    ) %>%
    dplyr::transmute(
      commune = GEO,
      activity_code = ACTIVITY,
      measure = dplyr::recode(FLORES_MEASURE,
                              UNIT_LOC = "etablissements",
                              EMPL3112 = "effectifs_salaries"),
      value = OBS_VALUE,
      statut_observation = OBS_STATUS
    )
}

# assembler_flores_a38 ----------------------------------------------------------
# Assemble le pivot dans la forme du contrat : la jointure avec le référentiel
# breton (lire_epci, limitée à la Bretagne) EST le filtre — les communes hors
# 22/29/35/56 tombent. La classification native, le concept « lieu de travail »,
# les libellés natifs du dictionnaire du produit, la source et le millésime du
# manifeste complètent la ligne. Aucune colonne NAF/crosswalk/SIRENE ; les deux
# nomenclatures restent des tables SÉPARÉES (jamais fusionnées).
assembler_flores_a38 <- function(
    pivote, reference, dictionnaire_activites,
    source_id = MANIFEST_ECONOMIE_FLORES$id[
      MANIFEST_ECONOMIE_FLORES$classification == "A38"],
    vintage_annee = MANIFEST_ECONOMIE_FLORES$vintage[
      MANIFEST_ECONOMIE_FLORES$classification == "A38"]) {
  pivote %>%
    dplyr::inner_join(reference, by = c("commune" = "CODGEO")) %>%
    dplyr::transmute(
      commune,
      departement = as.character(DEP),
      concept = CONCEPT_FLORES,
      classification = "A38",
      activity_code,
      activity_label = unname(dictionnaire_activites[activity_code]),
      tranche_effectifs,
      tranche_libelle = unname(TRANCHES_FLORES_A38[tranche_effectifs]),
      measure,
      value,
      statut_observation,
      source = source_id,
      vintage = vintage_annee
    ) %>%
    filter_bretagne() %>%
    dplyr::arrange(commune, activity_code, tranche_effectifs, measure)
}

# assembler_flores_a88 ----------------------------------------------------------
# Même contrat pour la nomenclature A88 — sans tranche d'effectifs.
assembler_flores_a88 <- function(
    pivote, reference, dictionnaire_activites,
    source_id = MANIFEST_ECONOMIE_FLORES$id[
      MANIFEST_ECONOMIE_FLORES$classification == "A88"],
    vintage_annee = MANIFEST_ECONOMIE_FLORES$vintage[
      MANIFEST_ECONOMIE_FLORES$classification == "A88"]) {
  pivote %>%
    dplyr::inner_join(reference, by = c("commune" = "CODGEO")) %>%
    dplyr::transmute(
      commune,
      departement = as.character(DEP),
      concept = CONCEPT_FLORES,
      classification = "A88",
      activity_code,
      activity_label = unname(dictionnaire_activites[activity_code]),
      measure,
      value,
      statut_observation,
      source = source_id,
      vintage = vintage_annee
    ) %>%
    filter_bretagne() %>%
    dplyr::arrange(commune, activity_code, measure)
}

# rapport_exclusions_flores -----------------------------------------------------
# Le rapport des exclusions du contrat (partagé par les deux nomenclatures) :
# la géographie invalide (commune présente dans la source au niveau COM mais
# absente du référentiel breton) et les lignes communales écartées par le
# contrat d'observation (période, forme juridique ou mesure hors contrat) —
# exclues, jamais réinterprétées. Les cellules non diffusées (statut K, valeur
# NA) ne sont PAS des exclusions : elles restent dans la table avec leur statut.
rapport_exclusions_flores <- function(long, reference) {
  com <- dplyr::filter(long, GEO_OBJECT == "COM")

  dplyr::bind_rows(
    tibble::tibble(
      commune = setdiff(unique(com$GEO), reference$CODGEO),
      motif = "commune absente du référentiel Bretagne (exclue)"
    ),
    com %>%
      dplyr::filter(TIME_PERIOD != 2024) %>%
      dplyr::distinct(GEO, TIME_PERIOD) %>%
      dplyr::transmute(
        commune = GEO,
        motif = paste0("période hors contrat (", TIME_PERIOD, ") : exclue")
      ),
    com %>%
      dplyr::filter(LEGAL_FORM_WITH_PUBLIC != FORME_JURIDIQUE_FLORES) %>%
      dplyr::distinct(GEO, LEGAL_FORM_WITH_PUBLIC) %>%
      dplyr::transmute(
        commune = GEO,
        motif = paste0("forme juridique hors contrat (",
                       LEGAL_FORM_WITH_PUBLIC, ") : exclue")
      ),
    com %>%
      dplyr::filter(!FLORES_MEASURE %in% names(MESURES_FLORES)) %>%
      dplyr::distinct(GEO, FLORES_MEASURE) %>%
      dplyr::transmute(
        commune = GEO,
        motif = paste0("mesure hors contrat (", FLORES_MEASURE,
                       ") : exclue")
      )
  ) %>%
    dplyr::arrange(commune)
}

# normaliser_flores_a38 ----------------------------------------------------------
# L'acte « normaliser » de la nomenclature A38 : la table du contrat + le
# rapport des exclusions.
normaliser_flores_a38 <- function(long, reference, dictionnaire_activites) {
  list(
    table = assembler_flores_a38(
      pivoter_flores_a38(long), reference, dictionnaire_activites
    ),
    exclusions = rapport_exclusions_flores(long, reference)
  )
}

# normaliser_flores_a88 ----------------------------------------------------------
# L'acte « normaliser » de la nomenclature A88 — table et exclusions propres.
normaliser_flores_a88 <- function(long, reference, dictionnaire_activites) {
  list(
    table = assembler_flores_a88(
      pivoter_flores_a88(long), reference, dictionnaire_activites
    ),
    exclusions = rapport_exclusions_flores(long, reference)
  )
}

# lire_dictionnaire_flores ------------------------------------------------------
# Le dictionnaire des libellés d'activité du produit (DS_FLORES_*_metadata.csv,
# variable ACTIVITY) : un vecteur nommé code -> libellé, lu dans le fichier de
# métadonnées du zip — jamais codé en dur (38 postes A38, 86 divisions A88).
lire_dictionnaire_flores <- function(chemin) {
  readr::read_delim(
    chemin, delim = ";",
    col_types = readr::cols(.default = readr::col_character()),
    show_col_types = FALSE, progress = FALSE
  ) %>%
    dplyr::filter(COD_VAR == "ACTIVITY") %>%
    dplyr::pull(LIB_MOD, name = COD_MOD)
}

# construire_donnees_brut_flores -------------------------------------------------
# L'acte « trouver la donnée » : décompresse les caches bruts des DEUX fichiers
# (les zips du manifeste), lit les fichiers longs + les dictionnaires + le
# référentiel EPCI breton partagé, et persiste les DEUX tables du contrat sous
# le dossier traité dédié du thème Économie/Emploi (data/processed/economie/).
# Deux artefacts SÉPARÉS — flores_a38.rds et flores_a88.rds, jamais une table
# fusionnée. Comme les autres builders du pipeline, il lit les vrais fichiers —
# non testé dans la boucle ; les pivots et l'assemblage, eux, le sont sur la
# forme réelle (test-reshape-economie-flores.R).
construire_donnees_brut_flores <- function(cache = "data/raw",
                                           sortie = "data/processed/economie") {
  extrait <- file.path(cache, "extracted")
  if (!dir.exists(extrait)) dir.create(extrait, recursive = TRUE)
  if (!dir.exists(sortie)) dir.create(sortie, recursive = TRUE)

  # décompresse (idempotent : overwrite = FALSE — les fichiers déjà extraits
  # sont laissés intacts, sans spammer de warning à chaque relance)
  for (f in MANIFEST_ECONOMIE_FLORES$fichier) {
    suppressWarnings(
      utils::unzip(file.path(cache, f), exdir = extrait, overwrite = FALSE)
    )
  }

  reference <- lire_epci(file.path(extrait, "EPCI_au_01-01-2025.xlsx"))
  long_a38 <- lire_csv_long(
    file.path(extrait, "DS_FLORES_A38_2024_data.csv")
  )
  long_a88 <- lire_csv_long(
    file.path(extrait, "DS_FLORES_A88_2024_data.csv")
  )
  dict_a38 <- lire_dictionnaire_flores(
    file.path(extrait, "DS_FLORES_A38_2024_metadata.csv")
  )
  dict_a88 <- lire_dictionnaire_flores(
    file.path(extrait, "DS_FLORES_A88_2024_metadata.csv")
  )

  a38 <- normaliser_flores_a38(long_a38, reference, dict_a38)
  a88 <- normaliser_flores_a88(long_a88, reference, dict_a88)

  readr::write_rds(a38$table, file.path(sortie, "flores_a38.rds"))
  readr::write_rds(a88$table, file.path(sortie, "flores_a88.rds"))
  list(flores_a38 = a38, flores_a88 = a88)
}
