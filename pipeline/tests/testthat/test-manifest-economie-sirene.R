# Le manifeste Économie SIRENE (todo 9, plan economie-pipeline-contracts — la
# bascule régionale) ------------------------------------------------------------
# Le CONTRAT de la source « SIRENE — extrait régional data.bretagne.bzh » :
# une ligne qui épingle l'export API ODS du jeu « sirene-v3-consolidee »
# (Base SIRENE - Région Bretagne), pré-découpé à la Bretagne et filtré aux
# seuls établissements ACTIFS via le where de l'URL — nom de cache exact,
# dates de référence / extraction / publication (la convention régionale :
# référence = dernier jour du mois du millésime, extraction = data_processed
# ODS, publication = mise en ligne), licence, version NAF, champs de filtrage
# (commune / actif / NAF / libellé APET en vocabulaire ODS minuscules) et la
# règle de sélection documentée (actifs seuls, diffusion NON retenue). Le
# manifeste est le SEAM du téléchargement : testé pour son intégrité, JAMAIS
# exécuté contre le réseau dans la boucle de test (docs/architecture.md
# §Testing). Le contrat (verifier_contrat_sirene_snapshot) est vérifié sur le
# manifeste réel ET sur des fixtures négatives : une URL historique data.gouv
# ou une version NAF manquante doit faire échouer la validation.

test_that("le manifeste a la forme du contrat : une source, colonnes standard + snapshot", {
  expect_s3_class(MANIFEST_ECONOMIE_SIRENE, "tbl_df")
  # les 11 colonnes standard du manifeste (Démographie / DVF), dans l'ordre,
  # puis les champs spécifiques au snapshot SIRENE régional
  expect_equal(
    names(MANIFEST_ECONOMIE_SIRENE)[1:11],
    c("id", "source", "url", "fichier", "vintage", "date_reference",
      "date_publication", "licence", "note", "mode", "type")
  )
  expect_true(all(c(
    "naf_version", "date_extraction", "champ_commune", "champ_actif",
    "champ_naf", "champ_libelle", "regle_selection"
  ) %in% names(MANIFEST_ECONOMIE_SIRENE)))
  # le statut de diffusion n'est PAS épinglé (décision todo 9 : on ne retient
  # pas la diffusion O/P tant que la commune est présente)
  expect_false("champ_diffusion" %in% names(MANIFEST_ECONOMIE_SIRENE))
  # UNE source, un id unique
  expect_equal(nrow(MANIFEST_ECONOMIE_SIRENE), 1L)
  expect_equal(MANIFEST_ECONOMIE_SIRENE$id, "sirene_snapshot")
  expect_equal(anyDuplicated(MANIFEST_ECONOMIE_SIRENE$id), 0L)
})

test_that("l'URL de l'export régional et le nom de cache sont uniques, HTTPS et cohérents", {
  # l'URL est l'URL STABLE de l'export API ODS du jeu régional
  # sirene-v3-consolidee : select + where (etatadministratifetablissement =
  # 'Actif') encodés dans l'URL — aucun ZIP national 2,7 Go
  expect_true(startsWith(MANIFEST_ECONOMIE_SIRENE$url, "https://"))
  expect_equal(MANIFEST_ECONOMIE_SIRENE$url, URL_SIRENE_REGIONAL)
  expect_match(MANIFEST_ECONOMIE_SIRENE$url, "data\\.bretagne\\.bzh")
  expect_match(MANIFEST_ECONOMIE_SIRENE$url, "sirene-v3-consolidee")
  expect_match(MANIFEST_ECONOMIE_SIRENE$url, "etatadministratifetablissement")
  # aucune référence au fichier historique (national ou régional)
  expect_false(grepl("historique", MANIFEST_ECONOMIE_SIRENE$url, ignore.case = TRUE))
  expect_false(grepl("historique", MANIFEST_ECONOMIE_SIRENE$fichier, ignore.case = TRUE))

  # le nom de cache : unique, au motif exact, il encode id + millésime ; le
  # cache EST le CSV d'export (pas de zip à décompresser)
  expect_true(!duplicated(MANIFEST_ECONOMIE_SIRENE$fichier))
  expect_match(MANIFEST_ECONOMIE_SIRENE$fichier, "^sirene_snapshot_[0-9]{4}-[0-9]{2}\\.csv$")
  expect_equal(MANIFEST_ECONOMIE_SIRENE$fichier,
               paste0(MANIFEST_ECONOMIE_SIRENE$id, "_",
                      MANIFEST_ECONOMIE_SIRENE$vintage, ".csv"))
})

test_that("les dates : référence = dernier jour du mois du millésime, extraction >= référence, publication >= extraction", {
  # la convention régionale (data.bretagne.bzh) : la référence est l'image du
  # répertoire SIRENE au DERNIER JOUR du mois du millésime (2026-04-30) ;
  # l'extraction est la date data_processed de la coupe ODS (2026-05-01) ; la
  # publication est la mise en ligne sur le portail (2026-05-01). Les règles
  # du stock national (référence = mois précédent, extraction = référence)
  # ne s'appliquent plus.
  attendue <- as.character(
    seq(as.Date(paste0(MANIFEST_ECONOMIE_SIRENE$vintage, "-01")),
        by = "month", length.out = 2)[2] - 1
  )
  expect_equal(MANIFEST_ECONOMIE_SIRENE$date_reference, attendue)
  expect_equal(MANIFEST_ECONOMIE_SIRENE$date_reference, "2026-04-30")
  expect_equal(MANIFEST_ECONOMIE_SIRENE$date_extraction, "2026-05-01")
  expect_equal(MANIFEST_ECONOMIE_SIRENE$date_publication, "2026-05-01")
  expect_true(all(grepl("^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
                        MANIFEST_ECONOMIE_SIRENE$date_reference)))
  expect_true(as.Date(MANIFEST_ECONOMIE_SIRENE$date_extraction) >=
                as.Date(MANIFEST_ECONOMIE_SIRENE$date_reference))
  expect_true(as.Date(MANIFEST_ECONOMIE_SIRENE$date_publication) >=
                as.Date(MANIFEST_ECONOMIE_SIRENE$date_extraction))
})

test_that("licence, NAF, mode/type et champs de filtrage exacts du vocabulaire ODS", {
  # Licence Ouverte 2.0 (même code « lov2 » que Démographie et DVF)
  expect_true(all(MANIFEST_ECONOMIE_SIRENE$licence == "lov2"))
  # mode « manuel » (pas de cron : la fraîcheur du jeu régional est liée aux
  # rafraîchissements ODS, suspendus depuis février 2026 — ADR-0004) ; type
  # « fichier » : URL -> fichier, le cache est le CSV d'export
  expect_true(all(MANIFEST_ECONOMIE_SIRENE$mode == "manuel"))
  expect_true(all(MANIFEST_ECONOMIE_SIRENE$type == "fichier"))
  # version NAF déclarée : rév. 2, APET 5 chiffres (docs/research/relatedness.md §3.1)
  expect_match(MANIFEST_ECONOMIE_SIRENE$naf_version, "NAF")
  expect_match(MANIFEST_ECONOMIE_SIRENE$naf_version, "r[ée]v\\.? ?2")
  # les champs exacts du vocabulaire ODS régional (minuscules, noms de la
  # donnée exposée par l'API data.bretagne.bzh) — le libellé APET vit dans
  # classeetablissement (il n'y a PAS de libelleActivitePrincipaleEtablissement
  # dans ce jeu)
  expect_equal(MANIFEST_ECONOMIE_SIRENE$champ_commune, "codecommuneetablissement")
  expect_equal(MANIFEST_ECONOMIE_SIRENE$champ_actif, "etatadministratifetablissement")
  expect_equal(MANIFEST_ECONOMIE_SIRENE$champ_naf, "activiteprincipaleetablissement")
  expect_equal(MANIFEST_ECONOMIE_SIRENE$champ_libelle, "classeetablissement")
  expect_false(is.na(MANIFEST_ECONOMIE_SIRENE$note))
  expect_match(MANIFEST_ECONOMIE_SIRENE$source, "SIRENE")
})

test_that("la règle de sélection actifs seuls est documentée (diffusion non retenue)", {
  regle <- MANIFEST_ECONOMIE_SIRENE$regle_selection
  expect_false(is.na(regle))
  # actifs seuls : le champ et la valeur ODS 'Actif' sont documentés
  expect_match(regle, "etatadministratifetablissement")
  expect_match(regle, "Actif")
  # la diffusion n'est pas retenue : la règle le dit, et ne documente AUCUN
  # vocabulaire de statut de diffusion
  expect_match(regle, "diffusion", ignore.case = TRUE)
  expect_false(grepl("statutDiffusionEtablissement", regle))
  # les exclusions explicites de la phase : ni historique, ni estimation
  # d'effectifs depuis les tranches
  expect_match(regle, "historique", ignore.case = TRUE)
  expect_match(regle, "tranche")
})

test_that("le contrat passe sur le manifeste réel", {
  expect_true(verifier_contrat_sirene_snapshot(MANIFEST_ECONOMIE_SIRENE))
})

test_that("le contrat refuse une URL historique data.gouv (stocketablissementhistorique)", {
  mauvais <- MANIFEST_ECONOMIE_SIRENE
  # l'URL stable de la ressource HISTORIQUE StockEtablissementHistorique sur
  # data.gouv — un autre identifiant de ressource que l'export régional
  mauvais$url <- paste0(
    "https://www.data.gouv.fr/api/1/datasets/r/",
    "88fbb6b4-0320-443e-b739-b4376a012c32"
  )
  mauvais$fichier <- "sirene_snapshot_2026-04.csv"
  expect_error(verifier_contrat_sirene_snapshot(mauvais), "historique")
})

test_that("le contrat refuse un manifeste sans version NAF", {
  sans_naf <- MANIFEST_ECONOMIE_SIRENE
  sans_naf$naf_version <- NA_character_
  expect_error(verifier_contrat_sirene_snapshot(sans_naf), "naf_version")
})

test_that("le contrat refuse un id dupliqué ou une URL absente", {
  duplique <- dplyr::bind_rows(MANIFEST_ECONOMIE_SIRENE,
                               MANIFEST_ECONOMIE_SIRENE)
  expect_error(verifier_contrat_sirene_snapshot(duplique), "UNE source")

  sans_url <- MANIFEST_ECONOMIE_SIRENE
  sans_url$url <- NA_character_
  expect_error(verifier_contrat_sirene_snapshot(sans_url), "URL")
})

test_that("le manifeste est le seam du téléchargement : mode manuel, rien n'est tiré en cron", {
  # en mode cron, une source « manuel » est sautée SANS toucher le réseau et
  # enregistrée « à traiter à la main » — le comportement partagé de
  # download_sources (issue #8, ADR-0004). Aucun mock nécessaire : le saut a
  # lieu avant tout appel réseau.
  cache <- tempfile("cache-sirene-")
  on.exit(unlink(cache, recursive = TRUE))

  statuts <- download_sources(MANIFEST_ECONOMIE_SIRENE, cache = cache,
                              mode = "cron")

  expect_equal(nrow(statuts), 1)
  expect_true(all(statuts$status == "à traiter à la main"))
  expect_true(all(statuts$mode == "manuel"))
  expect_equal(statuts$id, MANIFEST_ECONOMIE_SIRENE$id)
  # aucun fichier posé dans le cache
  expect_length(list.files(cache), 0)
})

test_that("le manifeste alimente la table des vintages partagée", {
  # vintages_depuis_manifest est la machinerie partagée (vintage.R) : le
  # fragment Économie s'y branche comme les manifestes Démographie / Habitat
  v <- vintages_depuis_manifest(MANIFEST_ECONOMIE_SIRENE)
  expect_equal(nrow(v), 1)
  expect_named(v, c("id", "source", "version", "licence",
                    "date_reference", "date_publication"))
  expect_equal(v$version, MANIFEST_ECONOMIE_SIRENE$vintage)
  expect_true(all(v$licence == "lov2"))
  expect_true(all(!is.na(v$date_reference)))
  expect_true(all(!is.na(v$date_publication)))
})
