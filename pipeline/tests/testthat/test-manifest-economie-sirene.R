# Le manifeste Économie SIRENE (todo 1, plan economie-pipeline-contracts) ------
# Le CONTRAT de la source « SIRENE — fichier stock des établissements »
# (INSEE / data.gouv) : une ligne qui épingle le dernier stock mensuel
# disponible — URL stable de la ressource, nom de cache exact, dates de
# référence / extraction / publication, licence, version NAF, champs de
# filtrage (commune / actif / diffusion) et la règle de sélection documentée
# (actifs seuls, diffusion partielle « P » conservée). Le manifeste est le SEAM
# du téléchargement : testé pour son intégrité, JAMAIS exécuté contre le réseau
# dans la boucle de test (docs/architecture.md §Testing). Le contrat
# (verifier_contrat_sirene_snapshot) est vérifié sur le manifeste réel ET sur
# des fixtures négatives : une URL historique ou une version NAF manquante doit
# faire échouer la validation.

test_that("le manifeste a la forme du contrat : une source, colonnes standard + snapshot", {
  expect_s3_class(MANIFEST_ECONOMIE_SIRENE, "tbl_df")
  # les 11 colonnes standard du manifeste (Démographie / DVF), dans l'ordre,
  # puis les champs spécifiques au snapshot SIRENE
  expect_equal(
    names(MANIFEST_ECONOMIE_SIRENE)[1:11],
    c("id", "source", "url", "fichier", "vintage", "date_reference",
      "date_publication", "licence", "note", "mode", "type")
  )
  expect_true(all(c(
    "naf_version", "date_extraction", "champ_commune", "champ_actif",
    "champ_diffusion", "champ_naf", "regle_selection"
  ) %in% names(MANIFEST_ECONOMIE_SIRENE)))
  # UNE source, un id unique
  expect_equal(nrow(MANIFEST_ECONOMIE_SIRENE), 1L)
  expect_equal(MANIFEST_ECONOMIE_SIRENE$id, "sirene_snapshot")
  expect_equal(anyDuplicated(MANIFEST_ECONOMIE_SIRENE$id), 0L)
})

test_that("l'URL stable et le nom de cache sont uniques, HTTPS et cohérents", {
  # l'URL est l'URL STABLE de la ressource StockEtablissement (la notice
  # data.gouv recommande les URL stables pour l'automatisation — le fichier
  # mensuel est remplacé DERRIÈRE cette URL, jamais l'URL elle-même)
  expect_true(startsWith(MANIFEST_ECONOMIE_SIRENE$url, "https://"))
  expect_equal(MANIFEST_ECONOMIE_SIRENE$url, URL_SIRENE_STOCK_ETABLISSEMENTS)
  # aucune référence au fichier historique
  expect_false(grepl("historique", MANIFEST_ECONOMIE_SIRENE$url, ignore.case = TRUE))
  expect_false(grepl("historique", MANIFEST_ECONOMIE_SIRENE$fichier, ignore.case = TRUE))

  # le nom de cache : unique, au motif exact, il encode id + millésime
  expect_true(!duplicated(MANIFEST_ECONOMIE_SIRENE$fichier))
  expect_match(MANIFEST_ECONOMIE_SIRENE$fichier, "^sirene_snapshot_[0-9]{4}-[0-9]{2}\\.zip$")
  expect_equal(MANIFEST_ECONOMIE_SIRENE$fichier,
               paste0(MANIFEST_ECONOMIE_SIRENE$id, "_",
                      MANIFEST_ECONOMIE_SIRENE$vintage, ".zip"))
})

test_that("les dates : référence et extraction = image du répertoire au dernier jour du mois précédent", {
  # notice data.gouv : « les fichiers mis en ligne à partir du 1er du mois sont
  # une image du répertoire Sirene à la date du dernier jour du mois précédent »
  # — la règle du snapshot est encodée dans le manifeste et vérifiée ici
  attendue <- as.character(
    as.Date(paste0(MANIFEST_ECONOMIE_SIRENE$vintage, "-01")) - 1
  )
  expect_equal(MANIFEST_ECONOMIE_SIRENE$date_reference, attendue)
  # l'extraction est la même image (le fichier stock n'a pas de champ
  # dateExtraction : la notice la définit comme le dernier jour du mois préc.)
  expect_equal(MANIFEST_ECONOMIE_SIRENE$date_extraction, attendue)
  # publication : la mise en ligne réelle du fichier (vérifiée sur l'API
  # data.gouv le 2026-08-04 — last_modified de la ressource 2026-08-01T07:34:40Z)
  expect_equal(MANIFEST_ECONOMIE_SIRENE$date_publication, "2026-08-01")
  expect_true(all(grepl("^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
                        MANIFEST_ECONOMIE_SIRENE$date_reference)))
})

test_that("licence, NAF, mode/type et champs de filtrage exacts du dessin de fichier INSEE", {
  # Licence Ouverte 2.0 (même code « lov2 » que Démographie et DVF)
  expect_true(all(MANIFEST_ECONOMIE_SIRENE$licence == "lov2"))
  # mode « manuel » : le ZIP fait ~2,7 Go — trop gros pour le cron de GitHub
  # Actions (ADR-0004, même famille que OSM/BDNB) ; type « fichier » : URL ->
  # fichier, intégrité vérifiée par verifier_fichier (issue #13)
  expect_true(all(MANIFEST_ECONOMIE_SIRENE$mode == "manuel"))
  expect_true(all(MANIFEST_ECONOMIE_SIRENE$type == "fichier"))
  # version NAF déclarée : rév. 2, APET 5 chiffres (docs/research/relatedness.md §3.1)
  expect_match(MANIFEST_ECONOMIE_SIRENE$naf_version, "NAF")
  expect_match(MANIFEST_ECONOMIE_SIRENE$naf_version, "r[ée]v\\.? ?2")
  # les champs exacts du dessin de fichier StockEtablissement (INSEE, version 311)
  expect_equal(MANIFEST_ECONOMIE_SIRENE$champ_commune, "codeCommuneEtablissement")
  expect_equal(MANIFEST_ECONOMIE_SIRENE$champ_actif, "etatAdministratifEtablissement")
  expect_equal(MANIFEST_ECONOMIE_SIRENE$champ_diffusion, "statutDiffusionEtablissement")
  expect_equal(MANIFEST_ECONOMIE_SIRENE$champ_naf, "activitePrincipaleEtablissement")
  expect_false(is.na(MANIFEST_ECONOMIE_SIRENE$note))
  expect_match(MANIFEST_ECONOMIE_SIRENE$source, "SIRENE")
})

test_that("la règle de sélection active / diffusion partielle est documentée", {
  regle <- MANIFEST_ECONOMIE_SIRENE$regle_selection
  expect_false(is.na(regle))
  # actifs seuls : le statut administratif et la valeur 'A' sont documentés
  expect_match(regle, "etatAdministratifEtablissement")
  expect_match(regle, "'A'")
  # diffusion partielle : le champ et la valeur 'P' sont documentés, avec la
  # condition de conservation (commune + code APE exploitables)
  expect_match(regle, "statutDiffusionEtablissement")
  expect_match(regle, "'P'")
  # les exclusions explicites de la phase : ni historique, ni estimation
  # d'effectifs depuis les tranches
  expect_match(regle, "historique", ignore.case = TRUE)
  expect_match(regle, "tranche")
})

test_that("le contrat passe sur le manifeste réel", {
  expect_true(verifier_contrat_sirene_snapshot(MANIFEST_ECONOMIE_SIRENE))
})

test_that("le contrat refuse une URL historique (stocketablissementhistorique)", {
  mauvais <- MANIFEST_ECONOMIE_SIRENE
  # l'URL stable de la ressource HISTORIQUE StockEtablissementHistorique
  mauvais$url <- paste0(
    "https://www.data.gouv.fr/api/1/datasets/r/",
    "88fbb6b4-0320-443e-b739-b4376a012c32"
  )
  mauvais$fichier <- "sirene_snapshot_historique_2026-08.zip"
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
