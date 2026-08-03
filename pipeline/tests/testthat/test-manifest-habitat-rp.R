# Le manifeste Habitat RP Logements (issue #14) : l'intégrité de la source est
# testée (jamais exécutée contre le réseau — le téléchargement est mocké quand
# download_sources est exercé). La source : INSEE RP Logements (dossier
# complet), fichier résolu DS_RP_LOGEMENT_PRINC_2023_CSV_FR
# (docs/research/rp-logements.md). Mode « cron » (téléchargement direct sans
# clé), type « fichier » (URL -> fichier, intégrité vérifiée).

test_that("MANIFEST_HABITAT_RP : les colonnes du contrat, une source", {
  expect_s3_class(MANIFEST_HABITAT_RP, "tbl_df")
  expect_true(all(c("id", "source", "url", "fichier", "vintage",
                    "date_reference", "date_publication", "licence", "note",
                    "mode", "type") %in%
                    names(MANIFEST_HABITAT_RP)))
  expect_false(any(duplicated(MANIFEST_HABITAT_RP$id)))
  expect_true(all(startsWith(MANIFEST_HABITAT_RP$url, "https://")))
  expect_true(all(MANIFEST_HABITAT_RP$licence == "lov2"))
  expect_true(all(!is.na(MANIFEST_HABITAT_RP$note)))

  # une seule source : le fichier RP Logements (dossier complet)
  expect_equal(nrow(MANIFEST_HABITAT_RP), 1)
  expect_equal(MANIFEST_HABITAT_RP$id, "logements")
})

test_that("MANIFEST_HABITAT_RP : la source RP Logements résolue", {
  # le fichier résolu par la recherche (docs/research/rp-logements.md) : le
  # dossier complet Logements est DS_RP_LOGEMENT_PRINC (et NON DS_RP_LOGEMENT
  # _COMP, qui est le produit « sur-occupation »)
  expect_match(MANIFEST_HABITAT_RP$url, "DS_RP_LOGEMENT_PRINC/DS_RP_LOGEMENT_PRINC_2023_CSV_FR")
  expect_equal(MANIFEST_HABITAT_RP$fichier, "DS_RP_LOGEMENT_PRINC_2023_CSV_FR.zip")
  expect_equal(MANIFEST_HABITAT_RP$vintage, "2023")
  expect_equal(MANIFEST_HABITAT_RP$date_reference, "2023-01-01")
  # la ressource 2023 a été créée sur data.gouv le 2026-06-30 (vérifié 2026-08-03)
  expect_equal(MANIFEST_HABITAT_RP$date_publication, "2026-06-30")
})

test_that("MANIFEST_HABITAT_RP : mode cron, type fichier", {
  # mode de récupération (issue #8, ADR-0004) : téléchargement direct sans clé
  expect_true(all(MANIFEST_HABITAT_RP$mode == "cron"))
  # type de récupération (issue #13) : URL -> fichier, intégrité vérifiée
  # (le type « api » arrive avec le pull DPE)
  expect_true(all(MANIFEST_HABITAT_RP$type == "fichier"))
})

# zip minimal valide pour fabriquer un « bon téléchargement » sans réseau
# (même structure que test-download.R — utils::unzip(list = TRUE) l'accepte)
mini_zip_habitat <- function(nom = "a.txt") {
  nm <- charToRaw(nom)
  n <- length(nm)
  lh <- c(
    as.raw(c(0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 0, 0, 0, 0, 0x21, 0)),
    as.raw(c(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)),
    as.raw(c(n, 0, 0, 0)),
    nm
  )
  cd <- c(
    as.raw(c(0x50, 0x4b, 0x01, 0x02, 20, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0x21, 0)),
    as.raw(c(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)),
    as.raw(c(n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)),
    nm
  )
  eocd <- as.raw(c(0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 1, 0, 1, 0))
  cd_size <- length(cd)
  cd_off <- length(lh)
  eocd <- c(
    eocd,
    as.raw(c(
      cd_size %% 256, (cd_size %/% 256) %% 256,
      (cd_size %/% 65536) %% 256, cd_size %/% 16777216,
      cd_off %% 256, (cd_off %/% 256) %% 256,
      (cd_off %/% 65536) %% 256, cd_off %/% 16777216,
      0, 0
    ))
  )
  c(lh, cd, eocd)
}

test_that("MANIFEST_HABITAT_RP passe par download_sources en mode cron (mock)", {
  cache <- tempfile("cache-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  # le téléchargement est mocké : un vrai zip, jamais de réseau
  local_mocked_bindings(
    telecharger_fichier = function(url, cible) writeBin(mini_zip_habitat(), cible),
    .package = "lusk"
  )

  statuts <- download_sources(MANIFEST_HABITAT_RP, cache, mode = "cron")

  expect_equal(statuts$id, "logements")
  expect_equal(statuts$mode, "cron")
  expect_equal(statuts$status, "frais")
  expect_true(verifier_fichier(file.path(cache, MANIFEST_HABITAT_RP$fichier)))
})

test_that("MANIFEST_HABITAT_RP : idempotent — un fichier intact n'est pas re-téléchargé", {
  cache <- tempfile("cache-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  cible <- file.path(cache, MANIFEST_HABITAT_RP$fichier)
  writeBin(mini_zip_habitat(), cible)

  tire <- FALSE
  local_mocked_bindings(
    telecharger_fichier = function(url, cible) {
      tire <<- TRUE
      writeBin(mini_zip_habitat(), cible)
    },
    .package = "lusk"
  )

  statuts <- download_sources(MANIFEST_HABITAT_RP, cache, mode = "cron")

  expect_false(tire)  # jamais re-téléchargé
  expect_true(verifier_fichier(cible))
  expect_equal(statuts$status, "frais")
})

test_that("MANIFEST_HABITAT_RP : un téléchargement corrompu est re-téléchargé (point 3)", {
  cache <- tempfile("cache-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  # un fichier corrompu déjà présent (texte déguisé en zip)
  cible <- file.path(cache, MANIFEST_HABITAT_RP$fichier)
  writeLines("deja telecharge mais corrompu", cible)

  # le téléchargement est mocké : il écrit un vrai zip
  local_mocked_bindings(
    telecharger_fichier = function(url, cible) writeBin(mini_zip_habitat(), cible),
    .package = "lusk"
  )

  expect_no_error(download_sources(MANIFEST_HABITAT_RP, cache, mode = "cron"))
  expect_true(verifier_fichier(cible))  # le corrompu a été remplacé
})
