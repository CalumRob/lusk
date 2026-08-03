# manifest_habitat_rp ----------------------------------------------------------
# La source RP Logements (dossier complet) du thème Habitat (issue #14) : le
# fichier résolu par la recherche (docs/research/rp-logements.md), vérifié
# contre les sources primaires le 2026-08-03.
#
# ⚠️ Le dossier complet Logements est DS_RP_LOGEMENT_PRINC — et NON
# DS_RP_LOGEMENT_COMP (qui existe sur data.gouv mais est le petit produit
# « résidences principales selon l'état d'occupation », sur-occupation) ni
# DS_RP_LOGEMENTS_COMP (id inexistant). La table des codes est documentée dans
# le fichier de recherche : OCS (DW_MAIN / DW_SEC_DW_OCC / DW_VAC / _T), TSH
# (statut : 100 / 200 / 300), L_STAY (ancienneté : Y_LT2 ... Y_GE30), NOR
# (taille : R1 ... R_GE5), RP_MEASURE (DWELLINGS pour les comptes).
#
# C'est un FRAGMENT de manifeste « par source » (convention vague 2, issue
# #13) : T3 concatènera MANIFEST_HABITAT_RP avec les fragments DVF (issue #15)
# et DPE (issue #16) dans le manifeste du thème Habitat. Une source, mode
# « cron » (téléchargement direct sans clé — vérifié en direct le 2026-08-03),
# type « fichier » (URL -> fichier, intégrité vérifiée).
MANIFEST_HABITAT_RP <- tibble::tribble(
  ~id, ~source, ~url, ~fichier, ~vintage, ~date_reference, ~date_publication, ~licence, ~note, ~mode, ~type,
  "logements",
  "INSEE — Logements (dossier complet)",
  "https://api.insee.fr/melodi/file/DS_RP_LOGEMENT_PRINC/DS_RP_LOGEMENT_PRINC_2023_CSV_FR",
  "DS_RP_LOGEMENT_PRINC_2023_CSV_FR.zip", "2023", "2023-01-01", "2026-06-30", "lov2",
  "Nombre de logements (DWELLINGS) par catégorie OCS (RP/RS+occ/vacants), statut TSH, ancienneté L_STAY, pièces NOR",
  "cron", "fichier"
)
