# manifest_economie_chomage ------------------------------------------------------
# La source RP Chômage du thème Économie/Emploi (plan economie-analytical-phase,
# gate G — NOUVELLE source RP, ticket #94) : le contrat de la table
# « rp_chomage » et de l'indicateur « chomage_economie » (docs/themes/
# economie-emploi.md, indicateur 3 « Chômage (population active) », dimension
# santé) — la part de la population active résidente de 15 à 64 ans au chômage,
# commune par commune.
#
# Résolu contre les sources primaires le 2026-08-05 : catalogue Melodi
# https://api.insee.fr/melodi/catalog/DS_RP_EMPLOI_LR_PRINC (produit
# DS_RP_EMPLOI_LR_PRINC_2023_CSV_FR émis le 2026-07-15, 17 877 132 observations,
# 121 040 685 octets), page insee.fr « Emploi-Population active en 2023 »
# (https://www.insee.fr/fr/statistiques/9002680), table EMP T4 « Chômage (au
# sens du recensement) des 15-64 ans » et « Formules Emploi – Population
# active » (formules_emp.pdf). ⚠️ Le fichier ACT4/ACT5 déjà ingéré (rp_emploi,
# DS_RP_TD_ACTIVITE_PCSACTIVITY_COMP) ne porte AUCUN chômage — vérifié sur le
# fichier réel le 2026-08-05 : EMPSTA_ENQ n'y expose que la modalité "1"
# (14,9 M lignes). Une source sœur EST requise : DS_RP_EMPLOI_LR_PRINC.
#
# C'est un FRAGMENT de manifeste « par source » (convention vague 2, issue #13),
# même squelette que MANIFEST_ECONOMIE_RP : une seule source, mode « cron »
# (téléchargement direct sans clé — même famille melodi que Démographie), type
# « fichier » (URL -> fichier, intégrité vérifiée).
#
# ⚠️ Le concept (caveat du recensement — documenté dans le code et dans la
# note) : l'indicateur est le chômage AU SENS DU RECENSEMENT — PAS la mesure
# BIT de l'enquête Emploi (les taux censitaires sont systématiquement
# supérieurs de 2 à 3 points), PAS la mesure administrative France Travail/
# DARES (le classement au recensement est totalement déconnecté de
# l'inscription à France Travail), et PAS les taux localisés (enquête Emploi +
# France Travail, qui n'existent pas à la commune). Le recensement lisse la
# collecte sur cinq années : la valeur 2023 est une moyenne quinquennale.
# La clé commune est GEO (GEO_OBJECT=COM), filtrée Bretagne via DEPT_BRETAGNE.
MANIFEST_ECONOMIE_CHOMAGE <- tibble::tribble(
  ~id, ~source, ~url, ~fichier, ~vintage, ~date_reference, ~date_publication, ~licence, ~note, ~mode, ~type,
  "rp_chomage",
  "INSEE — Population active et chômage (dossier complet, principaux indicateurs, exploitation principale)",
  "https://api.insee.fr/melodi/file/DS_RP_EMPLOI_LR_PRINC/DS_RP_EMPLOI_LR_PRINC_2023_CSV_FR",
  "DS_RP_EMPLOI_LR_PRINC_2023_CSV_FR.zip", "2023", "2023-01-01", "2026-07-15", "lov2",
  "Chômage au sens du recensement (dossier complet, principaux indicateurs, exploitation principale — table EMP T4 des 15-64 ans) : part de la population active résidente au chômage, par commune ; concept CENSITAIRE (recensement — PAS la mesure BIT de l'enquête Emploi, PAS la mesure administrative France Travail/DARES, PAS les taux localisés) ; taux INSEE = chômeurs (EMPSTA_ENQ==\"2\") / population active (EMPSTA_ENQ==\"1T2\"), actifs occupés = \"1\" ; filtres exacts GEO_OBJECT=COM × RP_MEASURE=POP (mesure résidente — l'emploi au lieu de travail est exclu, jamais relabellé) × SEX=_T × OBS_STATUS=A × TIME_PERIOD=2023 × EDUC=_T × AGE=Y15T64 ; clé commune GEO, filtre Bretagne DEPT_BRETAGNE ; source sœur du fichier ACT4/ACT5 (rp_emploi, qui ne porte aucun chômage) — tables jamais fusionnées",
  "cron", "fichier"
)

# verifier_contrat_rp_chomage ----------------------------------------------------
# Le vérificateur du contrat (même forme que verifier_contrat_rp_emploi) :
# retourne un vecteur de problèmes (vide si le contrat est valide). Il définit
# ce que « le contrat rp_chomage » exige : une seule source, un id unique et
# hors des ids déjà réservés (rp_emploi, flores_a38/flores_a88), une URL
# officielle INSEE épinglée, le concept censitaire (recensement — jamais BIT,
# jamais France Travail/DARES comme mesure de l'indicateur), les filtres du
# taux (GEO_OBJECT=COM, DEPT_BRETAGNE, EMPSTA_ENQ, Y15T64), et les métadonnées
# vintage / dates / licence / mode / type.
verifier_contrat_rp_chomage <- function(contrat) {
  problemes <- character()

  attendues <- c("id", "source", "url", "fichier", "vintage",
                 "date_reference", "date_publication", "licence", "note",
                 "mode", "type")
  if (!all(attendues %in% names(contrat))) {
    problemes <- c(problemes, "colonnes du contrat manquantes")
  }
  if (nrow(contrat) != 1L) {
    problemes <- c(problemes, "le contrat doit déclarer exactement une source")
  }
  if (anyNA(contrat$id) || anyDuplicated(contrat$id)) {
    problemes <- c(problemes, "id absent ou dupliqué")
  }
  if (!identical(contrat$id, "rp_chomage")) {
    problemes <- c(problemes,
                   "id : le contrat doit être 'rp_chomage' (unique, hors rp_emploi et Flores)")
  }
  if (anyNA(contrat$source) || anyNA(contrat$fichier)) {
    problemes <- c(problemes, "source ou fichier absent")
  }
  # URL : HTTPS et EXACTEMENT l'URL Melodi épinglée du dossier complet
  # DS_RP_EMPLOI_LR_PRINC (résolue contre le catalogue le 2026-08-05)
  if (!grepl("^https://", contrat$url)) {
    problemes <- c(problemes, "URL non officielle (https exigé)")
  }
  if (!grepl(
    "DS_RP_EMPLOI_LR_PRINC/DS_RP_EMPLOI_LR_PRINC_2023_CSV_FR",
    contrat$url
  )) {
    problemes <- c(problemes,
                   "URL : doit être l'URL Melodi DS_RP_EMPLOI_LR_PRINC_2023_CSV_FR")
  }
  if (!identical(contrat$fichier, "DS_RP_EMPLOI_LR_PRINC_2023_CSV_FR.zip")) {
    problemes <- c(problemes,
                   "fichier : DS_RP_EMPLOI_LR_PRINC_2023_CSV_FR.zip attendu")
  }
  # le concept censitaire : recensement, JAMAIS BIT, JAMAIS France
  # Travail/DARES comme mesure — le caveat doit être déclaré dans la note
  if (!grepl("chômage", contrat$note)) {
    problemes <- c(problemes, "le concept de chômage est absent de la note")
  }
  if (!grepl("recensement", contrat$note)) {
    problemes <- c(problemes,
                   "le concept censitaire 'recensement' est absent de la note")
  }
  if (!grepl("BIT", contrat$note) || !grepl("France Travail", contrat$note) ||
      !grepl("DARES", contrat$note)) {
    problemes <- c(problemes,
                   "le caveat du concept est incomplet (BIT / France Travail / DARES doivent être nommés comme ce que l'indicateur n'est PAS)")
  }
  # les filtres du taux et la clé commune bretonne
  if (!grepl("GEO_OBJECT=COM", contrat$note)) {
    problemes <- c(problemes, "clé commune GEO absente")
  }
  if (!grepl("DEPT_BRETAGNE", contrat$note)) {
    problemes <- c(problemes, "filtre Bretagne absent")
  }
  if (!grepl("EMPSTA_ENQ", contrat$note)) {
    problemes <- c(problemes, "la sémantique EMPSTA_ENQ est absente de la note")
  }
  if (!grepl("Y15T64", contrat$note)) {
    problemes <- c(problemes, "la tranche d'âge Y15T64 est absente de la note")
  }
  # métadonnées : vintage, dates de référence/publication, licence, mode, type
  if (anyNA(contrat$vintage) || anyNA(contrat$date_reference) ||
      anyNA(contrat$date_publication)) {
    problemes <- c(problemes, "métadonnées vintage / dates incomplètes")
  }
  if (!identical(contrat$vintage, "2023")) {
    problemes <- c(problemes, "vintage : 2023 attendu")
  }
  if (!grepl("^[0-9]{4}-[0-9]{2}-[0-9]{2}$", contrat$date_reference) ||
      !grepl("^[0-9]{4}-[0-9]{2}-[0-9]{2}$", contrat$date_publication)) {
    problemes <- c(problemes, "dates mal formées (ISO AAAA-MM-JJ attendu)")
  }
  if (!identical(contrat$date_reference, "2023-01-01")) {
    problemes <- c(problemes, "date_reference : 2023-01-01 attendue")
  }
  if (!identical(contrat$date_publication, "2026-07-15")) {
    problemes <- c(problemes, "date_publication : 2026-07-15 attendue")
  }
  if (as.Date(contrat$date_publication) < as.Date(contrat$date_reference)) {
    problemes <- c(problemes,
                   "date_publication : antérieure à la date de référence — dates incohérentes")
  }
  if (!all(contrat$licence == "lov2")) {
    problemes <- c(problemes, "licence différente de lov2")
  }
  if (!all(contrat$mode == "cron") || !all(contrat$type == "fichier")) {
    problemes <- c(problemes, "mode/type hors contrat (cron + fichier attendus)")
  }

  problemes
}
