# manifest_economie_rp ---------------------------------------------------------
# La source RP Emploi du thème Économie/Emploi (plan economie-pipeline-contracts,
# todo 3) : le contrat de la table de validation « rp_emploi »
# (docs/themes/economie-emploi.md §Source tables) — l'emploi au lieu de
# RÉSIDENCE du dossier complet du recensement, classifié dans le secteur
# d'activité économique NATIF du RP (tables ACT4/ACT5 de « Population active
# selon la PCS et l'activité économique », DS_RP_TD_ACTIVITE_PCSACTIVITY_COMP).
# Résolu contre les sources primaires le 2026-08-04 : catalogue INSEE
# https://catalogue-donnees.insee.fr/fr/catalogue/recherche/DS_RP_TD_ACTIVITE_PCSACTIVITY_COMP,
# page data.gouv « population-active-selon-la-pcs-et-lactivite-economique-
# donnees-detaillees-act4-et-act5 », resource 2023 créée le 2026-06-30
# (vérifié sur l'API data.gouv — même vague que les 2023 Démographie).
#
# C'est un FRAGMENT de manifeste « par source » (convention vague 2, issue
# #13), comme MANIFEST_HABITAT_RP : une seule source, mode « cron »
# (téléchargement direct sans clé — même famille melodi que Démographie),
# type « fichier » (URL -> fichier, intégrité vérifiée).
#
# ⚠️ Emploi au lieu de RÉSIDENCE, jamais au lieu de travail : la table
# rp_emploi est la perspective résidente du marché du travail (perspective
# indépendante + source de validation — elle ne fusionne pas avec l'emploi au
# lieu de travail de Flores, ids flores_a38/flores_a88, et ne porte aucune
# charge d'indicateur analytique ni de ratio). Le code sectoriel est celui du
# RP (le « secteur d'activité économique » du dossier complet) — pas une
# crosswalk NAF. La clé commune est GEO (GEO_OBJECT=COM), filtrée Bretagne via
# DEPT_BRETAGNE comme les autres sources du pipeline.
MANIFEST_ECONOMIE_RP <- tibble::tribble(
  ~id, ~source, ~url, ~fichier, ~vintage, ~date_reference, ~date_publication, ~licence, ~note, ~mode, ~type,
  "rp_emploi",
  "INSEE — Emploi au lieu de résidence (dossier complet, ACT4/ACT5)",
  "https://api.insee.fr/melodi/file/DS_RP_TD_ACTIVITE_PCSACTIVITY_COMP/DS_RP_TD_ACTIVITE_PCSACTIVITY_COMP_2023_CSV_FR",
  "DS_RP_TD_ACTIVITE_PCSACTIVITY_COMP_2023_CSV_FR.zip", "2023", "2023-01-01", "2026-06-30", "lov2",
  "Emploi au lieu de résidence — population active occupée (15 ans ou plus ayant un emploi) par sexe, âge, groupe socioprofessionnel (PCS) et secteur d'activité économique (code natif RP, tables ACT4/ACT5 du dossier complet) ; perspective résidente du marché du travail, source de validation indépendante des sources d'emploi Flores ; clé commune GEO (GEO_OBJECT=COM), filtre Bretagne DEPT_BRETAGNE",
  "cron", "fichier"
)
