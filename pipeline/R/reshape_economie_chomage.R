# reshape_economie_chomage ------------------------------------------------------
# Le remodelage de la source RP Chômage du thème Économie/Emploi (plan
# economie-analytical-phase, gate G, ticket #94) : le fichier long INSEE
# harmonisé « Population active et chômage » (DS_RP_EMPLOI_LR_PRINC — le
# dossier complet des principaux indicateurs, contrat MANIFEST_ECONOMIE_CHOMAGE)
# vers la table « rp_chomage » : une ligne longue et creuse par commune bretonne
# × mesure du chômage (chômeurs | actifs occupés | population active), portant
# l'enveloppe commune du thème (commune | departement | concept | measure |
# value | source | vintage) et le concept de chômage au sens du recensement.
#
# Le vocabulaire résolu par la recherche (gate G, fichier réel vérifié le
# 2026-08-05, 17 877 132 lignes) — la structure réelle du fichier long
# harmonisé, colonnes GEO;GEO_OBJECT;SEX;EMPSTA_ENQ;AGE;EDUC;RP_MEASURE;FREQ;
# OBS_STATUS;TIME_PERIOD;OBS_VALUE :
#   - EMPSTA_ENQ, l'interrupteur du chômage : "2" = chômeurs (le NUMÉRATEUR),
#     "1T2" = actifs = population active (le DÉNOMINATEUR), "1" = actifs
#     occupés (partie du dénominateur) ; "3"/"31"/"33"/"35"/"36"/"35T36" = les
#     inactifs — JAMAIS une mesure du contrat ; "_T" = le total.
#   - RP_MEASURE = "POP" : la mesure résidente. Toute AUTRE mesure (par exemple
#     EMPLT de l'Emploi-Activité) est l'emploi au LIEU DE TRAVAIL — exclue et
#     rapportée, JAMAIS relabellée en chômage.
#   - AGE = "Y15T64" (15-64 ans — la sémantique EMP T4 du dossier complet) ;
#     EDUC = "_T" (tous niveaux de diplôme) ; SEX = "_T" (les deux sexes) ;
#     OBS_STATUS = "A" écarte les doublons d'inclusion ; GEO_OBJECT = "COM"
#     écarte les réapparitions en BV2022/AAV2020/etc. ; TIME_PERIOD = 2023 (le
#     fichier porte aussi l'historique 2012/2017 — hors contrat).
#
# Le taux INSEE officiel (formules_emp.pdf, table EMP T4) : chômeurs /
# population active = "2" / "1T2" — calculé dans analytics_economie_chomage.R,
# pas ici : la table rp_chomage porte les MESURES, jamais le ratio.
#
# ⚠️ CAVEAT DU CONCEPT (fiche conseils INSEE « Activité – Emploi – Chômage »,
# juin 2026) : chômage AU SENS DU RECENSEMENT — PAS la mesure BIT de l'enquête
# Emploi, PAS la mesure administrative France Travail/DARES, PAS les taux
# localisés. La table est une perspective censitaire indépendante : elle ne
# fusionne pas avec l'emploi au lieu de résidence de rp_emploi (le fichier
# ACT4/ACT5 ne porte aucun chômage — vérifié sur le réel), ni avec l'emploi au
# lieu de travail de Flores.
# Le lecteur CSV partagé (lire_csv_long) et la base des EPCI bretonne
# (lire_epci — LE référentiel, la jointure filtre) sont réutilisés ;
# filter_bretagne reste la garde explicite du schéma.

# CONCEPT_RP_CHOMAGE ------------------------------------------------------------
# Le concept de chômage au sens du recensement (15-64 ans, population active) :
# une constante, jamais dérivée des données d'entrée — une ligne « emploi au
# lieu de travail » ne peut donc jamais être réinterprétée en chômage (elle est
# exclue et rapportée).
CONCEPT_RP_CHOMAGE <- "Chômage au sens du recensement (15-64 ans, population active)"

# MESURES_RP_CHOMAGE ------------------------------------------------------------
# Le vocabulaire fermé des mesures du chômage — les modalités EMPSTA_ENQ du
# contrat, nommées dans la langue du thème (même vocabulaire que rp_emploi pour
# les actifs occupés ; la table rp_chomage porte la tranche 15-64 ans, jamais
# confondue avec les actifs occupés 15 ans ou plus de rp_emploi) :
#   - "2"   -> chomeurs          (le NUMÉRATEUR du taux) ;
#   - "1"   -> actifs_occupes    (partie du dénominateur) ;
#   - "1T2" -> population_active (le DÉNOMINATEUR — la population active).
# Les inactifs ("3"/"31"/"33"/"35"/"36"/"35T36") et le total ("_T") n'ont pas
# de mesure : ils tombent au pivot, jamais au numérateur, jamais au dénominateur.
MESURES_RP_CHOMAGE <- c(
  "2" = "chomeurs",
  "1" = "actifs_occupes",
  "1T2" = "population_active"
)

# pivoter_chomage ---------------------------------------------------------------
# Du fichier long INSEE vers le croisement commune × mesure : les lignes TOTALES
# du contrat (SEX _T × AGE Y15T64 × EDUC _T), statut A, recensement 2023, et les
# trois modalités EMPSTA_ENQ du chômage. La borne RP_MEASURE = "POP" fixe le
# concept : une mesure d'emploi au lieu de travail tombe ici, exclue — jamais
# relabellée.
pivoter_chomage <- function(long) {
  long %>%
    dplyr::filter(
      GEO_OBJECT == "COM",
      RP_MEASURE == "POP",        # la mesure résidente — l'emploi au lieu de travail est exclu
      SEX == "_T",                # les deux sexes
      AGE == "Y15T64",            # 15-64 ans (la sémantique EMP T4 du dossier complet)
      EDUC == "_T",               # tous niveaux de diplôme
      EMPSTA_ENQ %in% names(MESURES_RP_CHOMAGE),  # chômeurs | actifs occupés | population active
      TIME_PERIOD == 2023,        # le millésime du contrat (l'historique 2012/2017 tombe)
      OBS_STATUS == "A"           # les doublons d'inclusion tombent
    ) %>%
    dplyr::transmute(
      commune = GEO,
      concept = CONCEPT_RP_CHOMAGE,
      measure = unname(MESURES_RP_CHOMAGE[EMPSTA_ENQ]),
      value = OBS_VALUE
    )
}

# assembler_chomage -------------------------------------------------------------
# Assemble le pivot dans la forme du contrat : la jointure avec le référentiel
# breton (lire_epci, limitée à la Bretagne) EST le filtre — les communes hors
# 22/29/35/56 tombent. Le département porté rend la garde filter_bretagne
# possible et la Bretagne des lignes conservées vérifiable. L'enveloppe du
# thème, le concept, la source et le millésime du manifeste complètent la
# ligne. Rien d'autre : aucune colonne Flores/SIRENE, aucun ratio ni rang — la
# table porte les mesures, jamais le taux.
assembler_chomage <- function(pivote, reference,
                              source_id = MANIFEST_ECONOMIE_CHOMAGE$id,
                              vintage_annee = MANIFEST_ECONOMIE_CHOMAGE$vintage) {
  pivote %>%
    dplyr::inner_join(reference, by = c("commune" = "CODGEO")) %>%
    dplyr::transmute(
      commune,
      departement = as.character(DEP),
      concept,
      measure,
      value,
      source = source_id,
      vintage = vintage_annee
    ) %>%
    filter_bretagne() %>%
    dplyr::arrange(commune, measure)
}

# rapport_exclusions_chomage ----------------------------------------------------
# Le rapport des exclusions du contrat : la géographie invalide (commune
# présente dans la source au niveau COM mais absente du référentiel breton) et
# les lignes d'emploi au lieu de travail (mesure non résidente) — exclues,
# jamais réinterprétées en chômage. Une ligne par (commune, motif).
rapport_exclusions_chomage <- function(long, reference) {
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
          ") : emploi au lieu de travail exclu, jamais relabellé en chômage"
        )
      )
  ) %>%
    dplyr::arrange(commune)
}

# normaliser_chomage ------------------------------------------------------------
# L'acte « normaliser » de la source : la table du contrat + le rapport des
# exclusions — la perspective censitaire du chômage au lieu de résidence.
normaliser_chomage <- function(long, reference) {
  list(
    table = assembler_chomage(pivoter_chomage(long), reference),
    exclusions = rapport_exclusions_chomage(long, reference)
  )
}

# construire_donnees_brut_chomage -----------------------------------------------
# L'acte « trouver la donnée » : décompresse le cache brut (le zip du
# manifeste), lit le fichier long + le référentiel EPCI breton partagé, et
# persiste la table du contrat sous le dossier traité dédié du thème
# Économie/Emploi (data/processed/economie/). Comme les autres builders du
# pipeline, il lit les vrais fichiers — non testé dans la boucle ; les pivots
# et l'assemblage, eux, le sont sur la forme réelle (test-analytics-economie-
# chomage.R).
construire_donnees_brut_chomage <- function(cache = "data/raw",
                                            sortie = "data/processed/economie/rp_chomage.rds") {
  extrait <- file.path(cache, "extracted")
  if (!dir.exists(extrait)) dir.create(extrait, recursive = TRUE)
  if (!dir.exists(dirname(sortie))) dir.create(dirname(sortie), recursive = TRUE)

  # décompresse (idempotent : overwrite = FALSE — les fichiers déjà extraits
  # sont laissés intacts, sans spammer de warning à chaque relance)
  for (f in MANIFEST_ECONOMIE_CHOMAGE$fichier) {
    suppressWarnings(
      utils::unzip(file.path(cache, f), exdir = extrait, overwrite = FALSE)
    )
  }

  long <- lire_csv_long(
    file.path(extrait, "DS_RP_EMPLOI_LR_PRINC_2023_data.csv")
  )
  reference <- lire_epci(file.path(extrait, "EPCI_au_01-01-2025.xlsx"))

  resultat <- normaliser_chomage(long, reference)
  readr::write_rds(resultat$table, sortie)
  resultat
}
