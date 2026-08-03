# Le manifeste Habitat DVF (issue #15) ---------------------------------------
# Le fragment de manifeste de la source « DVF géolocalisées » (Etalab) : un
# fichier par département par année, pour chaque année de la fenêtre glissante
# (2021-2025 aujourd'hui ; le cache idempotent accumule les années à chaque
# livraison semestrielle — la série ne rétrécit jamais, docs/research/dvf.md
# §5). 20 lignes construites par programme (expand_grid année x département),
# mode « manuel » (premiers runs lourds, ADR-0004), type « fichier » (URL ->
# fichier, intégrité vérifiée — issue #13). Le manifeste est le SEAM du
# téléchargement : testé pour son intégrité, jamais exécuté contre le réseau
# dans la boucle de test.

test_that("le manifeste couvre 5 années x 4 départements, mêmes colonnes que Démographie", {
  expect_s3_class(MANIFEST_HABITAT_DVF, "tbl_df")
  expect_equal(
    names(MANIFEST_HABITAT_DVF),
    c("id", "source", "url", "fichier", "vintage", "date_reference",
      "date_publication", "licence", "note", "mode", "type")
  )
  # 20 lignes : 5 années (2021-2025) x 4 départements bretons
  expect_equal(nrow(MANIFEST_HABITAT_DVF), 20)
  # chaque couple (année, département) figure exactement une fois — le nom de
  # fichier local encode les deux (le cache plat l'exige)
  attendus <- as.vector(outer(
    as.character(2021:2025), DEPT_BRETAGNE,
    function(a, d) sprintf("dvf_%s_dep%s.csv.gz", a, d)
  ))
  expect_setequal(MANIFEST_HABITAT_DVF$fichier, attendus)
  expect_equal(MANIFEST_HABITAT_DVF$vintage,
               substr(MANIFEST_HABITAT_DVF$fichier, 5, 8))
})

test_that("chaque source a un id et un fichier uniques, une URL au motif stable", {
  # le cache est PLAT (data/raw, sans sous-dossiers) : le nom de fichier local
  # doit être unique par source — jamais de collision entre années
  expect_true(all(!duplicated(MANIFEST_HABITAT_DVF$id)))
  expect_true(all(!duplicated(MANIFEST_HABITAT_DVF$fichier)))
  expect_true(all(MANIFEST_HABITAT_DVF$fichier ==
                    paste0(MANIFEST_HABITAT_DVF$id, ".csv.gz")))

  # le motif stable de files.data.gouv.fr (docs/research/dvf.md §2.2)
  motif <- paste0(
    "^https://files\\.data\\.gouv\\.fr/geo-dvf/latest/csv/",
    "([0-9]{4})/departements/(22|29|35|56)\\.csv\\.gz$"
  )
  expect_true(all(grepl(motif, MANIFEST_HABITAT_DVF$url)))
  # chaque URL porte l'année et le département encodés dans l'id de sa ligne
  annee <- sub("^dvf_([0-9]{4})_dep[0-9]{2}$", "\\1",
               MANIFEST_HABITAT_DVF$id)
  dep <- sub("^dvf_[0-9]{4}_dep([0-9]{2})$", "\\1",
             MANIFEST_HABITAT_DVF$id)
  attendues <- sprintf(
    "https://files.data.gouv.fr/geo-dvf/latest/csv/%s/departements/%s.csv.gz",
    annee, dep
  )
  expect_equal(MANIFEST_HABITAT_DVF$url, attendues)
})

test_that("le manifeste déclare mode manuel et type fichier partout", {
  # issue #8 / ADR-0004 : premiers runs lourds -> « manuel », jamais tiré par le
  # cron ; issue #13 : URL -> fichier, intégrité vérifiée
  expect_true(all(MANIFEST_HABITAT_DVF$mode == "manuel"))
  expect_true(all(MANIFEST_HABITAT_DVF$type == "fichier"))
  expect_true(all(MANIFEST_HABITAT_DVF$licence == "lov2"))
  expect_true(all(!is.na(MANIFEST_HABITAT_DVF$note)))
  expect_true(all(MANIFEST_HABITAT_DVF$source == "Etalab — DVF géolocalisées"))
})

test_that("les dates du manifeste : référence par année, publication de la livraison", {
  # date_reference : la période couverte par le millésime (fin d'année)
  expect_equal(
    MANIFEST_HABITAT_DVF$date_reference,
    paste0(MANIFEST_HABITAT_DVF$vintage, "-12-31")
  )
  # date_publication : la livraison qui a régénéré les fichiers départementaux
  # (docs/research/dvf.md §5 — CSVs géolocalisées régénérés le 2026-05-18)
  expect_true(all(MANIFEST_HABITAT_DVF$date_publication == "2026-05-18"))
  expect_setequal(MANIFEST_HABITAT_DVF$vintage, as.character(2021:2025))
})

test_that("le manifeste est le seam du téléchargement : mode cron, rien n'est tiré", {
  # en mode cron, une source « manuel » est sautée SANS toucher le réseau et
  # enregistrée « à traiter à la main » — le comportement partagé de
  # download_sources (issue #8). Aucun mock nécessaire : le saut a lieu avant
  # tout appel réseau.
  cache <- tempfile("cache-dvf-")
  on.exit(unlink(cache, recursive = TRUE))

  statuts <- download_sources(MANIFEST_HABITAT_DVF, cache = cache,
                              mode = "cron")

  expect_equal(nrow(statuts), 20)
  expect_true(all(statuts$status == "à traiter à la main"))
  expect_true(all(statuts$mode == "manuel"))
  expect_equal(statuts$id, MANIFEST_HABITAT_DVF$id)
  # aucun fichier posé dans le cache
  expect_length(list.files(cache), 0)
})

test_that("en mode full, les 20 fichiers se téléchargent sans collision de cache", {
  cache <- tempfile("cache-dvf-")
  on.exit(unlink(cache, recursive = TRUE))

  local_mocked_bindings(
    telecharger_fichier = function(url, cible) writeLines("x", cible),
    .package = "lusk"
  )

  statuts <- download_sources(MANIFEST_HABITAT_DVF, cache = cache)

  expect_true(all(statuts$status == "frais"))
  expect_length(list.files(cache), 20)
  # chaque fichier est distinct (le cache plat exige des noms uniques)
  expect_equal(length(unique(list.files(cache))), 20)
})

test_that("le manifeste alimente la table des vintages partagée", {
  # vintages_depuis_manifest est la machinerie partagée (vintage.R) : le
  # fragment Habitat s'y branche comme le manifeste Démographie
  v <- vintages_depuis_manifest(MANIFEST_HABITAT_DVF)
  expect_equal(nrow(v), 20)
  expect_named(v, c("id", "source", "version", "licence",
                    "date_reference", "date_publication"))
  expect_setequal(v$version, as.character(2021:2025))
  expect_true(all(v$licence == "lov2"))
  expect_true(all(!is.na(v$date_reference)))
  expect_true(all(!is.na(v$date_publication)))
})
