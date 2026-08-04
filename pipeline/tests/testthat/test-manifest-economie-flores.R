# Le manifeste Économie/Emploi — Flores A38/A88 (todo 2) ----------------------
# Deux contrats de source INDÉPENDANTS pour le produit INSEE 8266010 « Nombre
# d'établissements et effectifs salariés par secteur d'activité et tranche
# d'effectifs détaillés fin 2024 » (Flores), en nomenclatures agrégées A38 et
# A88 (docs/themes/economie-emploi.md, docs/research/relatedness.md §3.1).
# Tests déterministes, AUCUN appel réseau : le manifeste est déclaratif, sa
# vérification ne touche que la table ; le téléchargement, quand il est exercé,
# est mocké (download_sources, seam telecharger_fichier).
#
# Le contrat (acceptance du todo 2) : A38 et A88 ont des ids et des caches
# distincts ; chaque ligne déclare sa classification native, ses mesures emploi
# et établissements, sa sémantique de tranches d'effectifs, ses champs de
# géographie, son vintage, sa licence — et AUCUN champ de croisement (NAF) ni
# d'alignement de date. Le verificateur rejette les ids dupliqués et tout
# contrat qui étiquette la donnée Flores comme SIRENE/NAF.

# mini_zip_flores -------------------------------------------------------------
# Un zip minimal valide (une entrée stockée, vide) — pour fabriquer un « bon
# téléchargement » dans le test mocké sans réseau (même structure que
# test-download.R / test-manifest-habitat-rp.R — utils::unzip(list = TRUE)
# l'accepte).
mini_zip_flores <- function(nom = "a.txt") {
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

test_that("le manifeste liste deux sources Flores distinctes (A38 et A88)", {
  expect_s3_class(MANIFEST_ECONOMIE_FLORES, "tbl_df")
  # l'enveloppe commune du manifeste (mêmes colonnes que Démographie/Habitat)
  expect_true(all(c("id", "source", "url", "fichier", "vintage",
                    "date_reference", "date_publication", "licence", "note",
                    "mode", "type") %in%
                    names(MANIFEST_ECONOMIE_FLORES)))

  # deux contrats distincts, jamais une seule ligne « Flores »
  expect_equal(nrow(MANIFEST_ECONOMIE_FLORES), 2)
  expect_setequal(MANIFEST_ECONOMIE_FLORES$id, c("flores_a38", "flores_a88"))
  # ids ET cibles de cache distincts (le cache est plat : data/raw)
  expect_true(all(!duplicated(MANIFEST_ECONOMIE_FLORES$id)))
  expect_true(all(!duplicated(MANIFEST_ECONOMIE_FLORES$fichier)))

  # URL officielles du produit INSEE 8266010, en HTTPS
  expect_true(all(startsWith(MANIFEST_ECONOMIE_FLORES$url, "https://")))
  expect_match(
    MANIFEST_ECONOMIE_FLORES$url[MANIFEST_ECONOMIE_FLORES$id == "flores_a38"],
    "8266010/DS_FLORES_A38_2024_CSV_FR\\.zip$"
  )
  expect_match(
    MANIFEST_ECONOMIE_FLORES$url[MANIFEST_ECONOMIE_FLORES$id == "flores_a88"],
    "8266010/DS_FLORES_A88_2024_CSV_FR\\.zip$"
  )
})

test_that("chaque contrat déclare classification, mesures, tranches et géographie", {
  # classification native (A38/A88 — jamais un code NAF, jamais SIRENE)
  expect_equal(
    MANIFEST_ECONOMIE_FLORES$classification[
      MANIFEST_ECONOMIE_FLORES$id == "flores_a38"],
    "A38"
  )
  expect_equal(
    MANIFEST_ECONOMIE_FLORES$classification[
      MANIFEST_ECONOMIE_FLORES$id == "flores_a88"],
    "A88"
  )

  # les deux mesures natives de la source : établissements ET effectifs salariés
  expect_true(all(grepl("etablissements",
                        MANIFEST_ECONOMIE_FLORES$mesures)))
  expect_true(all(grepl("effectifs_salaries",
                        MANIFEST_ECONOMIE_FLORES$mesures)))

  # sémantique des tranches d'effectifs : A38 avec tranches, A88 sans
  expect_match(
    MANIFEST_ECONOMIE_FLORES$tranches_effectifs[
      MANIFEST_ECONOMIE_FLORES$id == "flores_a38"],
    "9 tranches"
  )
  expect_match(
    MANIFEST_ECONOMIE_FLORES$tranches_effectifs[
      MANIFEST_ECONOMIE_FLORES$id == "flores_a88"],
    "sans tranche"
  )

  # champs de géographie déclarés (grain natif : communes)
  expect_true(all(!is.na(MANIFEST_ECONOMIE_FLORES$geographie)))
  expect_true(all(grepl("communes", MANIFEST_ECONOMIE_FLORES$geographie)))
})

test_that("chaque source porte SON vintage, SA licence, sans croisement ni alignement", {
  # vintage propre à la source : millésime 2024 (données fin 2024), parution
  # le 31/03/2026 (vérifié en direct le 2026-08-04)
  expect_true(all(MANIFEST_ECONOMIE_FLORES$vintage == "2024"))
  expect_true(all(MANIFEST_ECONOMIE_FLORES$date_reference == "2024-12-31"))
  expect_true(all(MANIFEST_ECONOMIE_FLORES$date_publication == "2026-03-31"))
  expect_true(all(MANIFEST_ECONOMIE_FLORES$licence == "lov2"))
  expect_true(all(!is.na(MANIFEST_ECONOMIE_FLORES$note)))

  # mode et type : téléchargement direct sans clé, URL -> fichier (issue #8/#13)
  expect_true(all(MANIFEST_ECONOMIE_FLORES$mode == "cron"))
  expect_true(all(MANIFEST_ECONOMIE_FLORES$type == "fichier"))

  # AUCUN champ de croisement (NAF) ni d'alignement de date — ni colonne, ni
  # étiquette de source/classification
  expect_false(any(grepl("crosswalk|align|naf",
                         names(MANIFEST_ECONOMIE_FLORES), ignore.case = TRUE)))
  etiquettes <- tolower(paste(MANIFEST_ECONOMIE_FLORES$source,
                              MANIFEST_ECONOMIE_FLORES$classification))
  expect_false(any(grepl("sirene|naf", etiquettes)))
})

test_that("verifier_contrat_flores : le manifeste réel passe le contrat", {
  expect_no_error(verifier_contrat_flores(MANIFEST_ECONOMIE_FLORES))
})

test_that("verifier_contrat_flores : les ids dupliqués sont rejetés", {
  corrompu <- MANIFEST_ECONOMIE_FLORES
  corrompu$id <- "flores_a38"  # les deux lignes portent le même id
  expect_error(verifier_contrat_flores(corrompu), "ids dupliqués")
})

test_that("verifier_contrat_flores : un échange A38/A88 est rejeté", {
  # on échange seulement les ids : la classification native ne correspond plus
  corrompu <- MANIFEST_ECONOMIE_FLORES
  corrompu$id <- rev(corrompu$id)
  expect_error(verifier_contrat_flores(corrompu), "classification native")
})

test_that("verifier_contrat_flores : une déclaration de tranches manquante est rejetée", {
  corrompu <- MANIFEST_ECONOMIE_FLORES
  corrompu$tranches_effectifs[1] <- NA_character_
  expect_error(verifier_contrat_flores(corrompu), "tranches")
})

test_that("verifier_contrat_flores : une mesure manquante est rejetée", {
  corrompu <- MANIFEST_ECONOMIE_FLORES
  corrompu$mesures <- "etablissements"
  expect_error(verifier_contrat_flores(corrompu), "mesures")
})

test_that("verifier_contrat_flores : une donnée étiquetée SIRENE/NAF est rejetée", {
  sirene <- MANIFEST_ECONOMIE_FLORES
  sirene$source[1] <- "SIRENE — établissements actifs"
  expect_error(verifier_contrat_flores(sirene), "SIRENE")

  naf <- MANIFEST_ECONOMIE_FLORES
  naf$classification <- "NAF rév. 2"
  expect_error(verifier_contrat_flores(naf), "SIRENE ou NAF")
})

test_that("verifier_contrat_flores : un champ de croisement est rejeté", {
  corrompu <- MANIFEST_ECONOMIE_FLORES
  corrompu$naf_a38 <- "crosswalk"
  expect_error(verifier_contrat_flores(corrompu), "croisement")
})

test_that("les deux cibles de cache téléchargent distinctement (mock, sans réseau)", {
  cache <- tempfile("cache-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  # le téléchargement est mocké : jamais de réseau dans la boucle de test
  local_mocked_bindings(
    telecharger_fichier = function(url, cible) writeBin(mini_zip_flores(), cible),
    .package = "lusk"
  )

  statuts <- download_sources(MANIFEST_ECONOMIE_FLORES, cache, mode = "cron")

  expect_setequal(statuts$id, c("flores_a38", "flores_a88"))
  expect_true(all(statuts$status == "frais"))
  # chaque id a sa propre cible de cache, téléchargée et vérifiée
  for (i in seq_len(nrow(MANIFEST_ECONOMIE_FLORES))) {
    cible <- file.path(cache, MANIFEST_ECONOMIE_FLORES$fichier[i])
    expect_true(file.exists(cible))
    expect_true(verifier_fichier(cible))
  }
})
