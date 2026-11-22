# Champs null d'un enregistrement de lockfile — review PR #1121 -----------------
# Le relock du run #1105 écrit un enregistrement pour CHAQUE source, y compris
# les DPE (base roulante ADR-0009) dont `date_reference` est NA : le JSON porte
# alors `null`. Les deux cold rebuilds suivants résolvent ces sources avec leur
# enregistrement présent. Un `as.character(NULL)` donne `character(0)`, ce qui
# écrivait `[]` dans le lockfile puis cassait la projection — d'où UN seul
# normaliseur (champ_caractere) appliqué à toute lecture d'enregistrement.

test_that("relock DPE à date_reference null : lockfile null, résolution et vintages sans erreur (#1121)", {
  cache <- tempfile("cache-relock-dpe-")
  run_dir <- tempfile("run-relock-dpe-")
  lock <- tempfile("lock-relock-dpe-")
  dir.create(cache, recursive = TRUE)
  dir.create(run_dir, recursive = TRUE)
  on.exit(unlink(c(cache, run_dir, lock), recursive = TRUE), add = TRUE)

  id <- "dpe_22"
  m <- MANIFEST_HABITAT_DPE[MANIFEST_HABITAT_DPE$id == id, , drop = FALSE]
  fichier <- m$fichier[[1L]]
  cible <- file.path(cache, fichier)
  readr::write_rds(tibble::tibble(x = 1), cible)
  h <- empreinte_fichier(cible)
  acquisition <- "2026-11-18"

  # Le digest tel qu'un run le publie pour une base roulante : date_reference
  # absente (NA), exactement ce que deriver_vintage() produit pour les DPE.
  digest <- list(
    source_id = id, url = "https://example.invalid/dpe", sha256 = h,
    bytes = as.numeric(file.size(cible)), fichier = fichier,
    mtime = as.numeric(file.mtime(cible)), acquired_at = acquisition,
    vintage_basis = "telechargement", vintage = "2026-11",
    date_reference = NA_character_
  )
  # Un run RÉEL : son source-digests.json, puis un relock depuis CE fichier —
  # pas un lockfile écrit à la main.
  ecrire_digests_source(list(digest), file.path(run_dir, NOM_DIGESTS))
  relock_sources(run_dir, ids = id, lock = lock)

  # Le lockfile écrit par relock_sources porte un VRAI null JSON (pas [], pas
  # un champ absent) — c'est ce que lira le cold rebuild suivant.
  lignes <- readLines(lock, warn = FALSE)
  expect_true(any(grepl('"date_reference": null', lignes, fixed = TRUE)),
              info = paste(lignes, collapse = "\n"))
  expect_false(any(grepl('"date_reference": []', lignes, fixed = TRUE)))
  brut <- jsonlite::fromJSON(lock, simplifyVector = FALSE)
  expect_true(is.null(brut[[1L]]$date_reference))

  # La lecture du lockfile normalise null/absent en NA_character_.
  l <- lire_lock(lock)
  expect_true(is.na(l[[id]]$date_reference))
  expect_identical(l[[id]]$acquired_at, acquisition)

  # Résolution avec les octets verrouillés : aucun téléchargement, aucune erreur.
  r <- resoudre_source(
    id = id, url = "https://example.invalid/dpe", fichier = fichier,
    cache = cache, lock = lock, vintage_basis = "telechargement",
    vintage_declare = NA_character_, reference_declaree = NA_character_,
    tirer = function(url, cible) stop("aucun téléchargement attendu")
  )
  expect_true(isTRUE(r$verrouille))
  expect_true(is.na(r$date_reference))
  expect_identical(r$acquired_at, acquisition)
  expect_identical(r$vintage, "2026-11")

  # Projection des vintages : la base roulante garde SON horloge d'acquisition.
  v <- vintages_depuis_manifest(m, cache = cache, lock = lock,
                                exiger_attestation = TRUE)
  expect_identical(v$version[[1L]], "2026-11")
  expect_identical(v$date_publication[[1L]], acquisition)
  expect_true(is.na(v$date_reference[[1L]]))
})

test_that("aucun champ d'enregistrement de lockfile n'est lu en direct hors du normaliseur (#1121)", {
  racine <- pkgload::pkg_path()
  modules <- c("source_lock.R", "vintage.R", "lock_attribution.R", "release_freeze.R")
  # `verrouille` / `verrou` : enregistrement lu par le résolveur, l'attribution
  # et le gel ; `d` : empreinte du run que relock_sources recopie dans le lock.
  motif <- paste0(
    "as\\.character\\(\\s*(verrouille|verrou|d|registre\\[\\[[^]]+\\]\\])\\$",
    "(source_id|url|sha256|acquired_at|vintage_basis|vintage|date_reference)"
  )
  coupables <- character(0)
  for (rel in modules) {
    lignes <- readLines(file.path(racine, "R", rel), warn = FALSE)
    for (l in lignes[grepl(motif, lignes)]) {
      coupables <- c(coupables, paste0(rel, " : ", l))
    }
  }
  expect_length(coupables, 0L)

  # L'unique normaliseur vit dans source_lock.R et est appliqué à la lecture
  # du lockfile — jamais redéfini dans un module consommateur.
  src_lock <- paste(
    readLines(file.path(racine, "R", "source_lock.R"), warn = FALSE),
    collapse = "\n"
  )
  expect_true(grepl("champ_caractere <- function", src_lock, fixed = TRUE))
  expect_true(grepl("champ_caractere\\(e\\[\\[champ\\]\\]\\)", src_lock))
  for (rel in setdiff(modules, "source_lock.R")) {
    src <- paste(readLines(file.path(racine, "R", rel), warn = FALSE), collapse = "\n")
    expect_false(grepl("champ_caractere <- function", src, fixed = TRUE), info = rel)
  }
})
