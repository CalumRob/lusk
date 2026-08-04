# reshape_economie_rp -----------------------------------------------------------
# Le remodelage de la source RP Emploi du thème Économie/Emploi (plan
# economie-pipeline-contracts, todo 6) : le fichier long INSEE harmonisé
# « Activité des résidents » (DS_RP_TD_ACTIVITE_PCSACTIVITY_COMP — les tables
# ACT4/ACT5 du dossier complet, contrat MANIFEST_ECONOMIE_RP) vers la table de
# validation « rp_emploi » : une ligne longue et creuse par commune bretonne ×
# secteur d'activité économique NATIF du RP, portant l'enveloppe commune du
# thème (commune | activity_code | activity_label | value | measure | source |
# vintage) et le concept d'emploi au lieu de RÉSIDENCE.
#
# Le vocabulaire résolu par la recherche (todo 3, fichier 2023 vérifié le
# 2026-08-04) — la structure réelle du fichier long harmonisé, colonnes
# GEO;GEO_OBJECT;SEX;AGE;EMPSTA_ENQ;PCS;EMP_ACTIVITY;RP_MEASURE;FREQ;
# OBS_STATUS;TIME_PERIOD;OBS_VALUE :
#   - EMPSTA_ENQ = "1" : les actifs occupés (la seule modalité du fichier —
#     l'emploi des résidents, jamais les chômeurs)
#   - RP_MEASURE = "POP" : la mesure résidente. Toute AUTRE mesure (par
#     exemple EMPLT de l'Emploi-Activité) est l'emploi au LIEU DE TRAVAIL —
#     exclue et rapportée, jamais relabellée en emploi résident.
#   - EMP_ACTIVITY : le secteur d'activité économique NATIF du RP — les 5
#     postes AZ/BE/FZ/GU/OQ plus le total _T (dictionnaire du fichier)
#   - SEX / AGE / PCS : les dimensions détaillées ; les lignes TOTALES du
#     contrat sont SEX = "_T" × AGE = "Y_GE15" (15 ans ou plus — la modalité
#     totale du fichier) × PCS = "_T" : le croisement commune × secteur.
#   - OBS_STATUS = "A" écarte les doublons d'inclusion ; GEO_OBJECT = "COM"
#     écarte les réapparitions en BV2022/AAV2020/etc. ; TIME_PERIOD = 2023.
#
# La table est une perspective INDÉPENDANTE du marché du travail : elle ne
# fusionne pas avec l'emploi au lieu de travail de Flores (ids
# flores_a38/flores_a88) et ne porte aucun indicateur analytique, ratio,
# comparaison ni rang — elle est la source de validation, pas un payload.
# Le lecteur CSV partagé (lire_csv_long) et la base des EPCI bretonne
# (lire_epci — LE référentiel, la jointure filtre) sont réutilisés ;
# filter_bretagne reste la garde explicite du schéma.

# CONCEPT_RP_EMPLOI -------------------------------------------------------------
# Le concept d'emploi au lieu de RÉSIDENCE : une constante, jamais dérivée des
# données d'entrée — une ligne « lieu de travail » ne peut donc jamais être
# réinterprétée en emploi résident (elle est exclue et rapportée).
CONCEPT_RP_EMPLOI <- "Emploi au lieu de résidence"

# La mesure : la population active occupée de 15 ans ou plus (le « POP » du
# fichier, restreint aux actifs occupés — la perspective résidente).
MESURE_RP_EMPLOI <- "actifs_occupes"

# SECTEURS_RP_EMPLOI ------------------------------------------------------------
# Le secteur d'activité économique natif du RP — les libellés du dictionnaire
# du fichier (DS_RP_TD_ACTIVITE_PCSACTIVITY_COMP_2023_metadata.csv, variable
# EMP_ACTIVITY) : la classification en 5 postes + le total _T.
SECTEURS_RP_EMPLOI <- c(
  "AZ" = "Agriculture, sylviculture et pêche",
  "BE" = "Industrie manufacturière, industries extractives et autres",
  "FZ" = "Construction",
  "GU" = "Services principalement marchands",
  "OQ" = "Administration publique, enseignement, santé humaine et action sociale",
  "_T" = "Total"
)

# pivoter_emploi_rp -------------------------------------------------------------
# Du fichier long INSEE vers le croisement commune × secteur natif : les
# lignes TOTALES du contrat (SEX _T × AGE Y_GE15 × PCS _T), statut A,
# recensement 2023. La borne RP_MEASURE = "POP" fixe le concept : une mesure
# d'emploi au lieu de travail tombe ici, exclue — jamais relabellée.
pivoter_emploi_rp <- function(long) {
  long %>%
    dplyr::filter(
      GEO_OBJECT == "COM",
      RP_MEASURE == "POP", # la mesure résidente — l'emploi au lieu de travail est exclu
      EMPSTA_ENQ == "1",   # actifs occupés
      SEX == "_T",         # les deux sexes
      AGE == "Y_GE15",     # 15 ans ou plus (la modalité totale du fichier)
      PCS == "_T",         # tous les groupes socioprofessionnels
      TIME_PERIOD == 2023,
      OBS_STATUS == "A"
    ) %>%
    dplyr::transmute(
      commune = GEO,
      concept = CONCEPT_RP_EMPLOI,
      activity_code = EMP_ACTIVITY,
      activity_label = unname(SECTEURS_RP_EMPLOI[EMP_ACTIVITY]),
      value = OBS_VALUE,
      measure = MESURE_RP_EMPLOI
    )
}

# assembler_emploi_rp -----------------------------------------------------------
# Assemble le pivot dans la forme du contrat : la jointure avec le référentiel
# breton (lire_epci, limitée à la Bretagne) EST le filtre — les communes hors
# 22/29/35/56 tombent. Le département porté rend la garde filter_bretagne
# possible et la Bretagne des lignes conservées vérifiable. L'enveloppe du
# thème, le concept, la source et le millésime du manifeste complètent la
# ligne. Rien d'autre : aucune colonne Flores/SIRENE, aucun ratio ni rang.
assembler_emploi_rp <- function(pivote, reference,
                                source_id = MANIFEST_ECONOMIE_RP$id,
                                vintage_annee = MANIFEST_ECONOMIE_RP$vintage) {
  pivote %>%
    dplyr::inner_join(reference, by = c("commune" = "CODGEO")) %>%
    dplyr::transmute(
      commune,
      departement = as.character(DEP),
      concept,
      activity_code,
      activity_label,
      value,
      measure,
      source = source_id,
      vintage = vintage_annee
    ) %>%
    filter_bretagne() %>%
    dplyr::arrange(commune, activity_code)
}

# rapport_exclusions_emploi_rp --------------------------------------------------
# Le rapport des exclusions du contrat : la géographie invalide (commune
# présente dans la source au niveau COM mais absente du référentiel breton) et
# les lignes d'emploi au lieu de travail (mesure non résidente) — exclues,
# jamais réinterprétées. Une ligne par (commune, motif).
rapport_exclusions_emploi_rp <- function(long, reference) {
  communes_source <- unique(long$GEO[long$GEO_OBJECT == "COM"])

  dplyr::bind_rows(
    tibble::tibble(
      commune = setdiff(communes_source, reference$CODGEO),
      motif = "commune absente du référentiel Bretagne (exclue)"
    ),
    long %>%
      dplyr::filter(GEO_OBJECT == "COM", RP_MEASURE != "POP") %>%
      dplyr::distinct(GEO, RP_MEASURE) %>%
      dplyr::transmute(
        commune = GEO,
        motif = paste0(
          "mesure non résidente (", RP_MEASURE,
          ") : emploi au lieu de travail exclu, jamais relabellé en emploi résident"
        )
      )
  ) %>%
    dplyr::arrange(commune)
}

# normaliser_emploi_rp ----------------------------------------------------------
# L'acte « normaliser » de la source : la table du contrat + le rapport des
# exclusions — la source de validation indépendante du marché du travail.
normaliser_emploi_rp <- function(long, reference) {
  list(
    table = assembler_emploi_rp(pivoter_emploi_rp(long), reference),
    exclusions = rapport_exclusions_emploi_rp(long, reference)
  )
}

# construire_donnees_brut_emploi_rp ---------------------------------------------
# L'acte « trouver la donnée » : décompresse le cache brut (le zip du
# manifeste), lit le fichier long + le référentiel EPCI breton partagé, et
# persiste la table du contrat sous le dossier traité dédié du thème
# Économie/Emploi (data/processed/economie/). Comme les autres builders du
# pipeline, il lit les vrais fichiers — non testé dans la boucle ; les pivots
# et l'assemblage, eux, le sont sur la forme réelle (test-reshape-economie-rp.R).
construire_donnees_brut_emploi_rp <- function(cache = "data/raw",
                                              sortie = "data/processed/economie/rp_emploi.rds") {
  extrait <- file.path(cache, "extracted")
  if (!dir.exists(extrait)) dir.create(extrait, recursive = TRUE)
  if (!dir.exists(dirname(sortie))) dir.create(dirname(sortie), recursive = TRUE)

  # décompresse (idempotent : overwrite = FALSE — les fichiers déjà extraits
  # sont laissés intacts, sans spammer de warning à chaque relance)
  for (f in MANIFEST_ECONOMIE_RP$fichier) {
    suppressWarnings(
      utils::unzip(file.path(cache, f), exdir = extrait, overwrite = FALSE)
    )
  }

  long <- lire_csv_long(
    file.path(extrait, "DS_RP_TD_ACTIVITE_PCSACTIVITY_COMP_2023_data.csv")
  )
  reference <- lire_epci(file.path(extrait, "EPCI_au_01-01-2025.xlsx"))

  resultat <- normaliser_emploi_rp(long, reference)
  readr::write_rds(resultat$table, sortie)
  resultat
}
