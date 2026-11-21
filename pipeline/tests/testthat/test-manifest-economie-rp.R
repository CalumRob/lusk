# test-manifest-economie-rp -----------------------------------------------------
# Le contrat de la source RP Emploi du thème Économie/Emploi (plan
# economie-pipeline-contracts, todo 3) : le manifeste MANIFEST_ECONOMIE_RP
# déclare la table de validation « rp_emploi » — l'emploi au lieu de RÉSIDENCE
# du dossier complet du recensement (population active occupée par sexe, âge,
# PCS et secteur d'activité économique — le code sectoriel NATIF du RP).
# L'intégrité du contrat est testée, jamais exécutée contre le réseau : aucun
# téléchargement réel dans cette boucle.

# Les ids réservés par le contrat Flores (todo 2) : le contrat RP doit les
# éviter — les deux sources d'emploi restent indépendantes (la table rp_emploi
# ne fusionne jamais avec l'emploi au lieu de travail de Flores).
IDS_FLORES <- c("flores_a38", "flores_a88")

# Le vérificateur du contrat : retourne un vecteur de problèmes (vide si le
# contrat est valide). Il définit ce que « le contrat RP emploi » exige : une
# seule source, un id unique hors des ids Flores, une URL officielle INSEE, le
# concept d'emploi au lieu de RÉSIDENCE (jamais au lieu de travail), la
# classification sectorielle native du RP, la clé commune GEO de Bretagne, et
# les métadonnées vintage / licence / mode / type.
verifier_contrat_rp_emploi <- function(contrat) {
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
  if (any(contrat$id %in% IDS_FLORES)) {
    problemes <- c(problemes, "id en collision avec un id Flores")
  }
  if (anyNA(contrat$source) || anyNA(contrat$fichier)) {
    problemes <- c(problemes, "source ou fichier absent")
  }
  if (!grepl("^https://", contrat$url)) {
    problemes <- c(problemes, "URL non officielle (https exigé)")
  }
  # le concept : emploi au lieu de RÉSIDENCE — jamais l'emploi au lieu de
  # travail (le miroir travailleur vit dans le contrat Flores)
  if (!grepl("lieu de résidence", contrat$note)) {
    problemes <- c(problemes, "le concept d'emploi au lieu de résidence est absent")
  }
  if (grepl("lieu de travail", contrat$note)) {
    problemes <- c(problemes, "le contrat labellise la mesure comme emploi au lieu de travail")
  }
  # classification sectorielle NATIVE du RP (jamais NAF, jamais A38/A88 Flores)
  if (!grepl("secteur d'activité", contrat$note)) {
    problemes <- c(problemes, "classification sectorielle native absente")
  }
  # la clé commune bretonne : GEO (GEO_OBJECT=COM) filtré par DEPT_BRETAGNE
  if (!grepl("GEO_OBJECT=COM", contrat$note)) {
    problemes <- c(problemes, "clé commune GEO absente")
  }
  if (!grepl("DEPT_BRETAGNE", contrat$note)) {
    problemes <- c(problemes, "filtre Bretagne absent")
  }
  # métadonnées : vintage, dates de référence/publication, licence, mode, type
  if (anyNA(contrat$vintage) || anyNA(contrat$date_reference) ||
      anyNA(contrat$date_publication)) {
    problemes <- c(problemes, "métadonnées vintage / dates incomplètes")
  }
  if (!all(contrat$licence == "lov2")) {
    problemes <- c(problemes, "licence différente de lov2")
  }
  if (!all(contrat$mode == "cron") || !all(contrat$type == "fichier")) {
    problemes <- c(problemes, "mode/type hors contrat (cron + fichier attendus)")
  }

  problemes
}

test_that("MANIFEST_ECONOMIE_RP : le contrat déclare une seule source, mêmes colonnes que Démographie", {
  expect_s3_class(MANIFEST_ECONOMIE_RP, "tbl_df")
  expect_equal(
    names(MANIFEST_ECONOMIE_RP),
    c("id", "source", "url", "fichier", "vintage", "date_reference",
      "date_publication", "licence", "note", "mode", "type")
  )
  # une seule source : l'emploi au lieu de résidence
  expect_equal(nrow(MANIFEST_ECONOMIE_RP), 1)
  expect_equal(MANIFEST_ECONOMIE_RP$id, "rp_emploi")
  expect_true(all(!is.na(MANIFEST_ECONOMIE_RP$note)))
  # le contrat est valide au sens du vérificateur
  expect_length(verifier_contrat_rp_emploi(MANIFEST_ECONOMIE_RP), 0)
})

test_that("MANIFEST_ECONOMIE_RP : source officielle INSEE et fichier résolus", {
  # le dossier complet du recensement, table ACT4/ACT5 « Population active
  # selon la PCS et l'activité économique » (DS_RP_TD_ACTIVITE_PCSACTIVITY_COMP)
  # — résolue contre les sources primaires le 2026-08-04 (catalogue INSEE)
  expect_match(
    MANIFEST_ECONOMIE_RP$url,
    "DS_RP_TD_ACTIVITE_PCSACTIVITY_COMP/DS_RP_TD_ACTIVITE_PCSACTIVITY_COMP_2023_CSV_FR"
  )
  expect_equal(MANIFEST_ECONOMIE_RP$fichier,
               "DS_RP_TD_ACTIVITE_PCSACTIVITY_COMP_2023_CSV_FR.zip")
  expect_equal(MANIFEST_ECONOMIE_RP$vintage, "2023")
  expect_equal(MANIFEST_ECONOMIE_RP$date_reference, "2023-01-01")
  # la ressource 2023 a été créée sur data.gouv le 2026-06-30 (API data.gouv,
  # vérifié 2026-08-04 — même vague que les ressources 2023 Démographie)
  expect_equal(MANIFEST_ECONOMIE_RP$date_publication, "2026-06-30")
  expect_true(all(MANIFEST_ECONOMIE_RP$licence == "lov2"))
  expect_true(all(MANIFEST_ECONOMIE_RP$mode == "cron"))
  expect_true(all(MANIFEST_ECONOMIE_RP$type == "fichier"))
})

test_that("MANIFEST_ECONOMIE_RP : concept résident, classification native, clé commune GEO", {
  # l'emploi compté est celui des RÉSIDENTS (population active occupée),
  # classifié dans le secteur d'activité économique NATIF du RP — jamais
  # l'emploi au lieu de travail, jamais un libellé NAF/A38 Flores
  expect_match(MANIFEST_ECONOMIE_RP$note, "lieu de résidence")
  expect_match(MANIFEST_ECONOMIE_RP$note, "secteur d'activité")
  expect_false(grepl("lieu de travail", MANIFEST_ECONOMIE_RP$note))
  # la clé commune GEO (GEO_OBJECT=COM) et le filtre Bretagne sont déclarés
  expect_match(MANIFEST_ECONOMIE_RP$note, "GEO_OBJECT=COM")
  expect_match(MANIFEST_ECONOMIE_RP$note, "DEPT_BRETAGNE")
})

test_that("le vérificateur rejette un contrat qui labellise la mesure comme emploi au lieu de travail", {
  mauvais <- MANIFEST_ECONOMIE_RP
  mauvais$note <- sub("lieu de résidence", "lieu de travail", mauvais$note)
  problemes <- verifier_contrat_rp_emploi(mauvais)
  # les deux gardes sautent : le libellé lieu de travail apparaît ET le
  # concept résident disparaît
  expect_true(any(grepl("lieu de travail", problemes)))
  expect_true(any(grepl("résidence", problemes)))
})

test_that("le vérificateur rejette un contrat qui duplique un id Flores", {
  mauvais <- MANIFEST_ECONOMIE_RP
  mauvais$id <- "flores_a38"
  problemes <- verifier_contrat_rp_emploi(mauvais)
  expect_true(any(grepl("Flores", problemes)))
})

test_that("MANIFEST_ECONOMIE_RP alimente la table des vintages partagée", {
  # vintages_depuis_manifest est la machinerie partagée (vintage.R) : le
  # fragment Économie s'y branche comme les manifestes Démographie/Habitat
  v <- vintages_depuis_manifest(MANIFEST_ECONOMIE_RP)
  expect_equal(nrow(v), 1)
  expect_named(v, c("id", "source", "version", "licence",
                    "date_reference", "date_publication"))
  expect_equal(v$id, "rp_emploi")
  expect_equal(v$version, "2023")
  expect_true(all(v$licence == "lov2"))
  expect_true(all(!is.na(v$date_reference)))
  expect_true(all(!is.na(v$date_publication)))
})
