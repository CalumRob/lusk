# test-analytics-economie-e2e ---------------------------------------------------
# T10 — le run de bout en bout sur les données RÉELLES (plan economie-analytical-
# phase, todo 10) : les tables normalisées réelles traversent le chaînon
# analytique complet (T1-T6) puis la publication (T7-T8), et l'ensemble est
# verrouillé. C'est le miroir analytique de test-run-economie-contracts.R (le
# run source-table) : la couture de téléchargement est MOCKÉE, les builders et
# le chaînon analytique sont RÉELS, et les fixtures d'entrée sont les VRAIES
# tables brutes du worktree (pipeline/data/, gitignoré — jamais le réseau).
#
# Ce que le run de bout en bout doit prouver (acceptance du todo 10) :
#   - les tables analytiques réelles sont produites aux comptes verrouillés
#     (lq_economie.rds : 135 784 cellules — les 181 481 lignes SIRENE regroupées
#     par commune × APE ; lq_emploi_a88.rds : 22 616 ; eco_activites_economie.rds,
#     dormitory_economie.rds, chomage_economie.rds : 1 202 communes chacune) +
#     les artefacts *_rangs.rds de T6 (mêmes comptes que leurs tables) ;
#   - le payload publié (indicateurs / histoires / territoires / vintages) sort
#     de run_pipeline(theme = theme_economie()) vers une cible TEMPORAIRE (le
#     public/data du worktree n'est jamais touché) ;
#   - le run est DÉTERMINISTE : un second run produit des tables analytiques et
#     un payload octet-pour-octet identiques (run-report.json excepté — il porte
#     un horodatage par conception, issue #10) ;
#   - AUCUN artefact de fiche hors de la cible de publication : le dossier
#     analytique et le dossier des tables normalisées ne portent ni indicateurs,
#     ni histoires, ni territoires, ni vintages, ni rapport de run ;
#   - le chemin d'échec est verrouillé : un input analytique corrompu arrête le
#     run avant un payload partiel (jamais de succès partiel silencieux).
# Aucun appel réseau dans la boucle de test (docs/architecture.md §Testing) :
# download_sources et publier_geometrie sont mockés, les zips réels du cache
# (Flores, RP Emploi, RP Chômage) sont décompressés par les builders réels.

# Les fixtures réelles — le seam d'entrée du run mocké ---------------------------
# Les vraies tables brutes vivent sous pipeline/data/ (gitignoré). Absentes hors
# worktree, le test saute proprement (comme les autres tests « données réelles »).
fixture_e2e_raw <- function(...) {
  testthat::test_path("..", "..", "data", "raw", ...)
}

fixtures_reelles_presentes <- function() {
  all(file.exists(
    fixture_e2e_raw("sirene_snapshot_2026-04.csv"),
    fixture_e2e_raw("DS_FLORES_A38_2024_CSV_FR.zip"),
    fixture_e2e_raw("DS_FLORES_A88_2024_CSV_FR.zip"),
    fixture_e2e_raw("DS_RP_TD_ACTIVITE_PCSACTIVITY_COMP_2023_CSV_FR.zip"),
    fixture_e2e_raw("DS_RP_EMPLOI_LR_PRINC_2023_CSV_FR.zip"),
    fixture_e2e_raw("extracted", "EPCI_au_01-01-2025.xlsx")
  ))
}

# fabriquer_cache_e2e -----------------------------------------------------------
# La couture de téléchargement MOCKÉE écrit dans le cache les artefacts réels du
# worktree (le réseau n'entre jamais dans la boucle) : le CSV d'export SIRENE
# (le cache EST le CSV régional), les zips Flores / RP Emploi / RP Chômage (les
# builders les décompressent) et le référentiel partagé EPCI (déjà extrait, la
# base que lire_epci consomme — jamais re-téléchargée).
fabriquer_cache_e2e <- function(cache) {
  dir.create(file.path(cache, "extracted"), recursive = TRUE, showWarnings = FALSE)
  file.copy(fixture_e2e_raw("sirene_snapshot_2026-04.csv"), cache, overwrite = TRUE)
  for (z in c("DS_FLORES_A38_2024_CSV_FR.zip", "DS_FLORES_A88_2024_CSV_FR.zip",
              "DS_RP_TD_ACTIVITE_PCSACTIVITY_COMP_2023_CSV_FR.zip",
              "DS_RP_EMPLOI_LR_PRINC_2023_CSV_FR.zip")) {
    file.copy(fixture_e2e_raw(z), cache, overwrite = TRUE)
  }
  file.copy(fixture_e2e_raw("extracted", "EPCI_au_01-01-2025.xlsx"),
            file.path(cache, "extracted"), overwrite = TRUE)
  invisible(cache)
}

# statuts_economie ---------------------------------------------------------------
# La table des statuts que download_sources mocké renvoie (la même forme que
# test-run-pipeline-economie.R) : une ligne par source du manifeste Économie.
statuts_economie <- function(status = "frais") {
  tibble::tibble(
    id = MANIFEST_ECONOMIE$id,
    mode = MANIFEST_ECONOMIE$mode,
    status = rep(status, nrow(MANIFEST_ECONOMIE))
  )
}

# executer_run_reel --------------------------------------------------------------
# LE run de bout en bout : la couture réseau mockée (téléchargement + géométrie
# WFS — jamais le réseau), le reste RÉEL — les builders lisent les fixtures du
# cache, le chaînon analytique T1-T6 tourne, le payload sort vers la cible.
# Retourne le payload, comme run_pipeline.
executer_run_reel <- function(cache, sortie) {
  local_mocked_bindings(
    download_sources = function(manifest, cache, mode) statuts_economie(),
    publier_geometrie = function(cible = "public/data", fetch = NULL) invisible(NULL),
    .package = "lusk"
  )
  run_pipeline(theme = theme_economie(), cache = cache, sortie = sortie)
}

# Les comptes verrouillés (todo 10 : « compute and lock them in the test ») -----
# Les tables ANALYTIQUES réelles — verrouillées sur le run réel 2026-08-05 :
#   - lq_economie.rds            : 135 784 cellules (commune × APE), 1202 communes
#     — les 181 481 lignes SIRENE (commune × APE × tranche) regroupées au grain
#     fin (0 commune sous le plancher gate D : min 10 établissements) ;
#   - lq_emploi_a88.rds          : 22 616 cellules, 1196 communes (1202 − 6 sous
#     le plancher gate D : min 2 salariés — les 6 comptées dans le rapport) ;
#   - eco_activites_economie.rds : 1 202 communes × 1 part (0 supprimée) ;
#   - dormitory_economie.rds     : 1 202 communes (304 dortoirs profonds,
#     55 pôles d'emploi, 6 supprimées — la distribution verrouillée T4) ;
#   - chomage_economie.rds       : 1 202 communes × 1 taux (0 supprimée).
# Les artefacts *_rangs.rds de T6 portent EXACTEMENT les comptes de leur table.
comptes_analytiques_reels <- c(
  lq_economie = 135784,
  lq_emploi_a88 = 22616,
  eco_activites_economie = 1202,
  dormitory_economie = 1202,
  chomage_economie = 1202
)
# les tables *support* du chaînon (T1/T2 — pas des indicateurs publiés)
comptes_support_reels <- c(
  lq_emploi_a38 = 16019,
  histoires_lq_economie = 1202 * 3,
  m_economie = 835390
)
# les tables normalisées réelles (verrouillées par la phase source-table)
comptes_normalises_reels <- c(
  sirene_snapshot = 181481,
  flores_a38 = 109413,
  flores_a88 = 48821,
  rp_emploi = 7212,
  rp_chomage = 1202 * 3
)
# le payload publié (T7-T8) — comptes verrouillés sur le run réel
comptes_payload_reels <- c(
  indicateurs = 135784 + 22616 + 1202 + 1202,  # lq + lq_emploi + eco + chomage
  histoires = 1202,
  territoires = 1269,  # 1202 communes + 62 EPCIs + 4 départements + 1 région
  apercu = 0,          # le gating du thème : la table est présente mais vide
  vintages = 5         # une ligne par source du manifeste Économie
)

# empreintes_binaires -------------------------------------------------------------
# Les empreintes octet-pour-octet des fichiers d'un dossier (le déterminisme du
# run : relancer produit des fichiers identiques). `exclure` nomme les fichiers
# à écarter (run-report.json — horodaté par conception, issue #10).
empreintes_binaires <- function(dossier, exclure = character()) {
  fichiers <- setdiff(list.files(dossier, recursive = TRUE), exclure)
  stats::setNames(lapply(fichiers, function(f) {
    readBin(file.path(dossier, f), "raw", n = file.info(file.path(dossier, f))$size)
  }), fichiers)
}

# 1. Le chemin de joie RÉEL ------------------------------------------------------

test_that("le run de bout en bout : tables analytiques réelles + payload publié, aux comptes verrouillés", {
  skip_if_not(fixtures_reelles_presentes(),
              "les fixtures réelles ne sont pas présentes (data/ est gitignoré).")

  # tout vit dans des dossiers temporaires : le cache (les fixtures copiées), la
  # sortie analytique (le dossier processed du run) et la cible de publication —
  # le public/data du worktree n'est JAMAIS touché
  racine <- tempfile("e2e-")
  dir.create(racine)
  cache <- file.path(racine, "cache")
  cwd_run <- file.path(racine, "cwd")   # le cwd du run : les sorties RELATIVES
  dir.create(cwd_run)                   # des builders (data/processed/economie)
  sortie <- file.path(racine, "pub")    # restent dans le temporaire
  on.exit(unlink(racine, recursive = TRUE), add = TRUE)

  fabriquer_cache_e2e(cache)
  withr::local_dir(cwd_run)

  payload <- executer_run_reel(cache, sortie)
  sortie_analytiques <- file.path(dirname(cache), "processed", "economie")

  # le payload complet du thème, aux comptes réels verrouillés
  expect_named(payload, c("indicateurs", "histoires", "territoires", "apercu"))
  expect_equal(nrow(payload$indicateurs), comptes_payload_reels[["indicateurs"]])
  expect_equal(nrow(payload$histoires), comptes_payload_reels[["histoires"]])
  expect_equal(nrow(payload$territoires), comptes_payload_reels[["territoires"]])
  expect_equal(nrow(payload$apercu), comptes_payload_reels[["apercu"]])
  # les quatre indicateurs publiés, avec leurs rangs T6 — les comptes par clé
  expect_setequal(unique(payload$indicateurs$key),
                  c("lq", "lq_emploi", "eco_activites", "chomage"))
  expect_true(all(c("rang_epci", "rang_dep", "rang_reg") %in%
                    names(payload$indicateurs)))
  expect_equal(sum(payload$indicateurs$key == "lq"), 135784)
  expect_equal(sum(payload$indicateurs$key == "lq_emploi"), 22616)
  expect_equal(sum(payload$indicateurs$key == "eco_activites"), 1202)
  expect_equal(sum(payload$indicateurs$key == "chomage"), 1202)

  # les fichiers par thème + la référence partagée + vintages + rapport de run
  for (f in c("indicateurs_economie.parquet", "indicateurs_economie.json",
              "histoires_economie.parquet", "histoires_economie.json",
              "territoires.parquet", "territoires.json",
              "apercu.parquet", "apercu.json",
              "vintages.parquet", "run-report.json")) {
    expect_true(file.exists(file.path(sortie, f)), info = f)
  }
  # le parquet relit exactement le payload publié
  ind <- nanoparquet::read_parquet(file.path(sortie, "indicateurs_economie.parquet"))
  expect_equal(nrow(ind), nrow(payload$indicateurs))
  expect_equal(ind$value, payload$indicateurs$value)
  # vintages.parquet : une ligne par source du manifeste Économie (les 5)
  vint <- nanoparquet::read_parquet(file.path(sortie, "vintages.parquet"))
  expect_equal(nrow(vint), comptes_payload_reels[["vintages"]])
  expect_setequal(vint$id, MANIFEST_ECONOMIE$id)

  # les tables ANALYTIQUES persistées, aux comptes réels verrouillés
  for (nom in names(comptes_analytiques_reels)) {
    expect_equal(nrow(readRDS(file.path(sortie_analytiques, paste0(nom, ".rds")))),
                 unname(comptes_analytiques_reels[[nom]]), info = nom)
  }
  # les artefacts T6 (*_rangs.rds) portent les comptes de leur table
  attendus_rangs <- c(
    lq_economie_rangs = comptes_analytiques_reels[["lq_economie"]],
    lq_emploi_a88_rangs = comptes_analytiques_reels[["lq_emploi_a88"]],
    eco_activites_economie_rangs = comptes_analytiques_reels[["eco_activites_economie"]],
    chomage_economie_rangs = comptes_analytiques_reels[["chomage_economie"]]
  )
  for (nom in names(attendus_rangs)) {
    expect_equal(nrow(readRDS(file.path(sortie_analytiques, paste0(nom, ".rds")))),
                 unname(attendus_rangs[[nom]]), info = nom)
  }
  # les tables support du chaînon (T1/T2, jamais publiées comme indicateurs)
  for (nom in names(comptes_support_reels)) {
    expect_equal(nrow(readRDS(file.path(sortie_analytiques, paste0(nom, ".rds")))),
                 unname(comptes_support_reels[[nom]]), info = nom)
  }
  # les tables normalisées réelles (la phase source-table traversée par le run)
  for (nom in names(comptes_normalises_reels)) {
    expect_equal(nrow(readRDS(file.path(cwd_run, "data", "processed", "economie",
                                        paste0(nom, ".rds")))),
                 unname(comptes_normalises_reels[[nom]]), info = nom)
  }

  # AUCUN artefact de fiche hors de la cible de publication : ni indicateurs, ni
  # histoires, ni territoires, ni aperçu, ni vintages, ni rapport de run — ni
  # dans le dossier analytique, ni dans le dossier des tables normalisées (les
  # preuves vivent sous data/processed/, jamais publiées avant publish()).
  # La garde cible les NOMS PUBLIÉS exacts (indicateurs_economie, histoires_
  # economie, territoires, apercu, vintages, run-report) : l'artefact analytique
  # histoires_lq_economie.rds (le pool de l'Histoire LQ, T1) est légitime ici.
  motifs_fiche <- paste(
    "indicateurs_economie", "histoires_economie", "territoires",
    "apercu", "vintages", "run-report", sep = "|"
  )
  hors_cible <- c(sortie_analytiques,
                  file.path(cwd_run, "data", "processed", "economie"))
  for (dossier in hors_cible) {
    expect_false(any(grepl(motifs_fiche,
                           list.files(dossier, recursive = TRUE))),
                 info = dossier)
  }
})

test_that("un second run produit des tables analytiques et un payload octet-pour-octet identiques (déterminisme)", {
  skip_if_not(fixtures_reelles_presentes(),
              "les fixtures réelles ne sont pas présentes (data/ est gitignoré).")

  racine <- tempfile("e2e-det-")
  dir.create(racine)
  cache <- file.path(racine, "cache")
  cwd_run <- file.path(racine, "cwd")
  dir.create(cwd_run)
  sortie1 <- file.path(racine, "pub1")
  sortie2 <- file.path(racine, "pub2")
  on.exit(unlink(racine, recursive = TRUE), add = TRUE)

  fabriquer_cache_e2e(cache)
  withr::local_dir(cwd_run)
  sortie_analytiques <- file.path(dirname(cache), "processed", "economie")

  # premier run : les empreintes des tables analytiques + du payload
  executer_run_reel(cache, sortie1)
  analytiques1 <- empreintes_binaires(sortie_analytiques)
  payload1 <- empreintes_binaires(sortie1, exclure = "run-report.json")

  # second run : relancer produit LES MÊMES fichiers — octet-pour-octet
  executer_run_reel(cache, sortie2)
  analytiques2 <- empreintes_binaires(sortie_analytiques)
  payload2 <- empreintes_binaires(sortie2, exclure = "run-report.json")

  # le déterminisme du chaînon analytique : les artefacts réels identiques
  # (mêmes noms de fichiers, mêmes octets — le run est un état complet, jamais
  # un append : relancer écrase, ne duplique pas)
  expect_identical(analytiques1, analytiques2)
  # le déterminisme du payload : tous les fichiers publiés identiques (le
  # run-report.json est exclu — il porte un horodatage par conception)
  expect_identical(payload1, payload2)
  # et les comptes restent ceux du run verrouillé (jamais de doublon : le payload
  # EST l'état complet, la relance écrase)
  expect_equal(
    nrow(nanoparquet::read_parquet(file.path(sortie2, "indicateurs_economie.parquet"))),
    comptes_payload_reels[["indicateurs"]]
  )
  expect_equal(
    nrow(readRDS(file.path(sortie_analytiques, "lq_economie.rds"))),
    comptes_analytiques_reels[["lq_economie"]]
  )
})

test_that("un input analytique corrompu arrête le run avant un payload partiel (jamais de succès partiel silencieux)", {
  skip_if_not(fixtures_reelles_presentes(),
              "les fixtures réelles ne sont pas présentes (data/ est gitignoré).")

  racine <- tempfile("e2e-fail-")
  dir.create(racine)
  cache <- file.path(racine, "cache")
  cwd_run <- file.path(racine, "cwd")
  dir.create(cwd_run)
  sortie <- file.path(racine, "pub")
  on.exit(unlink(racine, recursive = TRUE), add = TRUE)

  fabriquer_cache_e2e(cache)
  withr::local_dir(cwd_run)

  # les tables normalisées RÉELLES, puis UN input analytique corrompu : le
  # snapshot SIRENE perd sa colonne value (une vague qui change de structure) —
  # T1 (la LQ) s'arrête sur la garde de forme, AVANT la moindre écriture
  donnees <- construire_donnees_economie(cache = cache)
  donnees$sirene_snapshot$value <- NULL

  local_mocked_bindings(
    download_sources = function(manifest, cache, mode) statuts_economie(),
    construire_donnees_economie = function(cache) donnees,
    publier_geometrie = function(cible = "public/data", fetch = NULL) invisible(NULL),
    .package = "lusk"
  )

  # le run s'arrête bruyamment sur l'input corrompu, en nommant la colonne
  expect_error(
    run_pipeline(theme = theme_economie(), cache = cache, sortie = sortie),
    "value"
  )

  # ...AVANT un payload partiel : ni la cible de publication ni le dossier
  # analytique n'existent — T1 n'a rien persisté, publish n'a jamais tourné
  expect_false(dir.exists(sortie))
  expect_false(dir.exists(file.path(dirname(cache), "processed", "economie")))
})
