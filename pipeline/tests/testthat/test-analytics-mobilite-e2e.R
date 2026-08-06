# test-analytics-mobilite-e2e --------------------------------------------------
# Le run de bout en bout de Mobilité sur le VRAI snapshot porté (issue #137,
# tracer bullet) : la couture de téléchargement est MOCKÉE, les builders et le
# chaînon analytique sont RÉELS, et les fixtures d'entrée sont le VRAI snapshot
# du worktree (pipeline/data/raw/bretagne_mobility_super_dashboard_gravity.csv,
# gitignoré — jamais le réseau). C'est le miroir de test-analytics-economie-e2e.R.
#
# Ce que le run de bout en bout doit prouver (acceptance de l'issue #137) :
#   - le snapshot porté est normalisé aux comptes verrouillés (mobilite_snapshot :
#     1 200 communes × 2 061 colonnes — le fichier de production, jamais
#     l'artefact non-production aux deltas vélo négatifs) ;
#   - les tables analytiques du tracer bullet (mobilite_communes : 1 200 ;
#     nb_buildings_territoires : 1 266 — les 1 200 communes + 61 EPCIs + 4
#     départements + la région, recalculés depuis les parties) ;
#   - le payload publié (indicateurs / histoires / territoires / vintages) sort
#     de run_pipeline(theme = theme_mobilite()) vers une cible TEMPORAIRE (le
#     public/data du worktree n'est jamais touché) : 1 268 territoires × 1 clé
#     (nb_buildings — la « Taille » du thème, le nombre de bâtiments analysés ;
#     les 5 parts d'isolation et la Story arrivent au ticket #138) ;
#   - le run est DÉTERMINISTE : un second run produit des tables et un payload
#     octet-pour-octet identiques (run-report.json excepté — horodaté par
#     conception, issue #10) ;
#   - AUCUN artefact de fiche hors de la cible de publication ;
#   - le chemin d'échec est verrouillé : un input corrompu arrête le run avant
#     un payload partiel (jamais de succès partiel silencieux).
# Aucun appel réseau dans la boucle de test (docs/architecture.md §Testing) :
# download_sources et publier_geometrie sont mockés, le snapshot réel est lu
# par les builders réels.

# Les fixtures réelles — le seam d'entrée du run mocké --------------------------
# Le vrai snapshot porté et le référentiel EPCI partagé vivent sous
# pipeline/data/ (gitignoré). Absents hors worktree, le test saute proprement
# (comme les autres tests « données réelles »).
fixture_e2e_raw <- function(...) {
  testthat::test_path("..", "..", "data", "raw", ...)
}

fixtures_reelles_presentes <- function() {
  all(file.exists(
    fixture_e2e_raw("bretagne_mobility_super_dashboard_gravity.csv"),
    fixture_e2e_raw("extracted", "EPCI_au_01-01-2025.xlsx")
  ))
}

# fabriquer_cache_e2e -----------------------------------------------------------
# La couture de téléchargement MOCKÉE écrit dans le cache les artefacts réels du
# worktree (le réseau n'entre jamais dans la boucle) : le snapshot porté (le
# cache EST le CSV) et le référentiel partagé EPCI (déjà extrait, la base que
# lire_epci consomme — jamais re-téléchargée).
fabriquer_cache_e2e <- function(cache) {
  dir.create(file.path(cache, "extracted"), recursive = TRUE, showWarnings = FALSE)
  file.copy(fixture_e2e_raw("bretagne_mobility_super_dashboard_gravity.csv"),
            cache, overwrite = TRUE)
  file.copy(fixture_e2e_raw("extracted", "EPCI_au_01-01-2025.xlsx"),
            file.path(cache, "extracted"), overwrite = TRUE)
  invisible(cache)
}

# statuts_mobilite ---------------------------------------------------------------
# La table des statuts que download_sources mocké renvoie (la même forme que
# test-run-pipeline-economie.R) : une ligne par source du manifeste Mobilité.
statuts_mobilite <- function(status = "frais") {
  tibble::tibble(
    id = MANIFEST_MOBILITE$id,
    mode = MANIFEST_MOBILITE$mode,
    status = rep(status, nrow(MANIFEST_MOBILITE))
  )
}

# executer_run_reel --------------------------------------------------------------
# LE run de bout en bout : la couture réseau mockée (téléchargement + géométrie
# WFS — jamais le réseau), le reste RÉEL — le builder lit le snapshot du cache,
# le chaînon analytique tourne, le payload sort vers la cible.
executer_run_reel <- function(cache, sortie) {
  local_mocked_bindings(
    download_sources = function(manifest, cache, mode) statuts_mobilite(),
    publier_geometrie = function(cible = "public/data", fetch = NULL) invisible(NULL),
    .package = "lusk"
  )
  run_pipeline(theme = theme_mobilite(), cache = cache, sortie = sortie)
}

# Les comptes verrouillés (issue #137 : « compute and lock them in the test ») --
# Verrouillés sur le run réel 2026-08-06 (le snapshot porté, figé 2026-02-28) :
#   - mobilite_snapshot             : 1 200 communes × 2 061 colonnes — les 1 202
#     communes de la base moins 29083 (Île-de-Sein) et 29084 (Île-Molène), que
#     l'analyse d'origine n'a pas couvertes (un fait du portage, à documenter) ;
#   - mobilite_communes             : 1 200 communes × nb_buildings (la Taille) ;
#   - nb_buildings_territoires      : 1 266 lignes — 1 200 communes + 61 EPCIs +
#     4 départements + la région, SOMME recalculée depuis les parties (jamais
#     une moyenne) ; les 2 communes hors snapshot n'y figurent pas ;
#   - payload : 1 268 territoires (1 202 communes + 61 EPCIs + 4 départements +
#     la région — le squelette partagé, les 2 communes hors snapshot portent NA
#     pour l'indicateur, jamais une ligne manquante), × 1 clé (nb_buildings) ;
#     histoires VIDE (le Story arrive au ticket #138), apercu vide (gating).
comptes_normalises_reels <- c(
  mobilite_snapshot = 1200
)
comptes_analytiques_reels <- c(
  mobilite_communes = 1200,
  nb_buildings_territoires = 1266
)
comptes_payload_reels <- c(
  indicateurs = 1268,  # nb_buildings × 1 268 territoires
  histoires = 0,       # le Story est la matière du ticket #138
  territoires = 1268,  # 1 202 communes + 61 EPCIs + 4 départements + 1 région
  apercu = 0,          # le gating du thème : la table est présente mais vide
  vintages = 1         # une ligne par source du manifeste Mobilité
)

# La référence du déterminisme, capturée par le premier test (le run de bout
# en bout) et comparée par le second (un run supplémentaire unique) : prouver
# la stabilité octet-pour-octet avec DEUX runs au total, jamais trois.
reference_determinisme <- NULL

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

test_that("le run de bout en bout : snapshot normalisé + payload publié, aux comptes verrouillés", {
  skip_sans_donnees_reelles(fixtures_reelles_presentes(),
              "les fixtures réelles ne sont pas présentes (data/ est gitignoré).")

  # tout vit dans des dossiers temporaires : le cache (les fixtures copiées), la
  # sortie analytique (le dossier processed du run) et la cible de publication —
  # le public/data du worktree n'est JAMAIS touché
  racine <- tempfile("e2e-mob-")
  dir.create(racine)
  cache <- file.path(racine, "cache")
  cwd_run <- file.path(racine, "cwd")   # le cwd du run : les sorties RELATIVES
  dir.create(cwd_run)                   # des builders (data/processed/mobilite)
  sortie <- file.path(racine, "pub")    # restent dans le temporaire
  on.exit(unlink(racine, recursive = TRUE), add = TRUE)

  fabriquer_cache_e2e(cache)
  withr::local_dir(cwd_run)

  payload <- executer_run_reel(cache, sortie)
  sortie_analytiques <- file.path(dirname(cache), "processed", "mobilite")

  # le payload complet du thème, aux comptes réels verrouillés
  expect_named(payload, c("indicateurs", "histoires", "territoires", "apercu"))
  expect_equal(nrow(payload$indicateurs), comptes_payload_reels[["indicateurs"]])
  expect_equal(nrow(payload$histoires), comptes_payload_reels[["histoires"]])
  expect_equal(nrow(payload$territoires), comptes_payload_reels[["territoires"]])
  expect_equal(nrow(payload$apercu), comptes_payload_reels[["apercu"]])
  # l'unique indicateur publié du tracer bullet : la « Taille » du thème (le
  # nombre de bâtiments analysés par commune — la grille d'isolation et la
  # Story arrivent au ticket #138), une ligne par territoire, avec ses rangs
  expect_setequal(unique(payload$indicateurs$key), "nb_buildings")
  expect_equal(sum(payload$indicateurs$key == "nb_buildings"), 1268)
  expect_true(all(c("rang_epci", "rang_dep", "rang_reg") %in%
                    names(payload$indicateurs)))
  # les deux communes hors snapshot (Île-de-Sein, Île-Molène) portent NA —
  # jamais une ligne manquante (l'alignement sur la référence du squelette)
  expect_true(all(is.na(payload$indicateurs$value[
    payload$indicateurs$territoire %in% c("29083", "29084")])))
  # la valeur de la région : la SOMME des 1 200 communes (recalculée depuis les
  # parties, jamais une moyenne) — le total verrouillé du fichier de production
  expect_equal(
    payload$indicateurs$value[payload$indicateurs$territoire == "53"],
    1223578
  )
  expect_equal(
    payload$indicateurs$value[payload$indicateurs$territoire == "22"],
    260617
  )
  # les estampilles T7 : l'indicateur porte le vintage de SA source de référence
  vintages <- vintages_mobilite()
  expect_true(all(payload$indicateurs$vintage_source == vintages$source))
  expect_true(all(payload$indicateurs$vintage_date_reference == "2026-02-28"))
  expect_true(all(payload$indicateurs$vintage_date_publication == "2026-08-06"))

  # la référence des territoires : le squelette partagé (communes + EPCIs +
  # départements + région), les noms réels, l'EPCI de chaque commune
  expect_setequal(unique(payload$territoires$type),
                  c("commune", "epci", "departement", "region"))
  expect_equal(
    payload$territoires$nom[payload$territoires$territoire == "29011"],
    "Bohars"
  )
  expect_equal(
    payload$territoires$epci[payload$territoires$territoire == "29011"],
    "242900314"  # Brest Métropole — le SIREN, jamais le nom
  )

  # les fichiers par thème + la référence partagée + vintages + rapport de run.
  # Issue #116 : l'Aperçu d'un run Mobilité est vide par design — le fichier
  # partagé apercu n'est NI écrit NI écrasé par un thème sans aperçu.
  for (f in c("indicateurs_mobilite.parquet", "indicateurs_mobilite.json",
              "histoires_mobilite.parquet", "histoires_mobilite.json",
              "territoires.parquet", "territoires.json",
              "vintages.parquet", "run-report.json")) {
    expect_true(file.exists(file.path(sortie, f)), info = f)
  }
  expect_false(file.exists(file.path(sortie, "apercu.parquet")))
  expect_false(file.exists(file.path(sortie, "apercu.json")))

  # le parquet relit exactement le payload publié
  ind <- nanoparquet::read_parquet(file.path(sortie, "indicateurs_mobilite.parquet"))
  expect_equal(nrow(ind), nrow(payload$indicateurs))
  expect_equal(ind$value, payload$indicateurs$value)
  # vintages.parquet : une ligne par source du manifeste Mobilité
  vint <- nanoparquet::read_parquet(file.path(sortie, "vintages.parquet"))
  expect_equal(nrow(vint), comptes_payload_reels[["vintages"]])
  expect_setequal(vint$id, MANIFEST_MOBILITE$id)

  # les tables NORMALISÉES persistées, aux comptes réels verrouillés (la forme
  # du portage : le snapshot complet, 1 200 communes × 2 061 colonnes)
  norm <- readRDS(file.path(cwd_run, "data", "processed", "mobilite",
                            "mobilite_snapshot.rds"))
  expect_equal(nrow(norm), comptes_normalises_reels[["mobilite_snapshot"]])
  expect_equal(ncol(norm), 2061)
  expect_equal(sum(norm$nb_buildings), 1223578)

  # les tables ANALYTIQUES persistées, aux comptes réels verrouillés
  for (nom in names(comptes_analytiques_reels)) {
    expect_equal(nrow(readRDS(file.path(sortie_analytiques, paste0(nom, ".rds")))),
                 unname(comptes_analytiques_reels[[nom]]), info = nom)
  }

  # AUCUN artefact de fiche hors de la cible de publication : ni indicateurs, ni
  # histoires, ni territoires, ni aperçu, ni vintages, ni rapport de run — les
  # preuves vivent sous data/processed/, jamais publiées avant publish().
  # La garde cible les NOMS PUBLIÉS exacts, ancrés au début du nom (les
  # artefact analytiques nb_buildings_territoires.rds / mobilite_communes.rds
  # contiennent les mots « territoires »/« mobilite » — légitimes ici, jamais
  # un nom publié).
  motifs_fiche <- paste(
    "^indicateurs_mobilite", "^histoires_mobilite", "^territoires",
    "^apercu", "^vintages", "^run-report", sep = "|"
  )
  hors_cible <- c(sortie_analytiques,
                  file.path(cwd_run, "data", "processed", "mobilite"))
  for (dossier in hors_cible) {
    expect_false(any(grepl(motifs_fiche,
                           list.files(dossier, recursive = TRUE))),
                 info = dossier)
  }

  # la référence du déterminisme : les empreintes de CE run — le second test
  # relance une seule fois et compare contre elles
  reference_determinisme <<- list(
    analytiques = empreintes_binaires(sortie_analytiques),
    payload = empreintes_binaires(sortie, exclure = "run-report.json")
  )
})

test_that("un second run produit des tables analytiques et un payload octet-pour-octet identiques (déterminisme)", {
  skip_sans_donnees_reelles(fixtures_reelles_presentes(),
              "les fixtures réelles ne sont pas présentes (data/ est gitignoré).")

  racine <- tempfile("e2e-mob-det-")
  dir.create(racine)
  cache <- file.path(racine, "cache")
  cwd_run <- file.path(racine, "cwd")
  dir.create(cwd_run)
  sortie2 <- file.path(racine, "pub2")
  on.exit(unlink(racine, recursive = TRUE), add = TRUE)

  fabriquer_cache_e2e(cache)
  withr::local_dir(cwd_run)
  sortie_analytiques <- file.path(dirname(cache), "processed", "mobilite")

  # le second run : relancer produit LES MÊMES fichiers que la référence du
  # premier test — octet-pour-octet
  executer_run_reel(cache, sortie2)
  analytiques2 <- empreintes_binaires(sortie_analytiques)
  payload2 <- empreintes_binaires(sortie2, exclure = "run-report.json")

  # le déterminisme du chaînon analytique : les artefacts réels identiques
  expect_identical(analytiques2, reference_determinisme$analytiques)
  # le déterminisme du payload : tous les fichiers publiés identiques (le
  # run-report.json est exclu — il porte un horodatage par conception)
  expect_identical(payload2, reference_determinisme$payload)
  # et les comptes restent ceux du run verrouillé (jamais de doublon : le payload
  # EST l'état complet, la relance écrase)
  expect_equal(
    nrow(nanoparquet::read_parquet(file.path(sortie2, "indicateurs_mobilite.parquet"))),
    comptes_payload_reels[["indicateurs"]]
  )
  expect_equal(
    nrow(readRDS(file.path(sortie_analytiques, "nb_buildings_territoires.rds"))),
    comptes_analytiques_reels[["nb_buildings_territoires"]]
  )
})

test_that("un input corrompu arrête le run avant un payload partiel (jamais de succès partiel silencieux)", {
  skip_sans_donnees_reelles(fixtures_reelles_presentes(),
              "les fixtures réelles ne sont pas présentes (data/ est gitignoré).")

  racine <- tempfile("e2e-mob-fail-")
  dir.create(racine)
  cache <- file.path(racine, "cache")
  cwd_run <- file.path(racine, "cwd")
  dir.create(cwd_run)
  sortie <- file.path(racine, "pub")
  on.exit(unlink(racine, recursive = TRUE), add = TRUE)

  fabriquer_cache_e2e(cache)
  withr::local_dir(cwd_run)

  # les tables normalisées RÉELLES, puis UN input analytique corrompu : le
  # snapshot porté perd sa colonne nb_buildings (une vague qui change de
  # structure) — le chaînon analytique s'arrête sur la garde de forme, AVANT la
  # moindre écriture
  donnees <- construire_donnees_mobilite(cache = cache)
  donnees$mobilite_snapshot$nb_buildings <- NULL

  local_mocked_bindings(
    download_sources = function(manifest, cache, mode) statuts_mobilite(),
    construire_donnees_mobilite = function(cache) donnees,
    publier_geometrie = function(cible = "public/data", fetch = NULL) invisible(NULL),
    .package = "lusk"
  )

  # le run s'arrête bruyamment sur l'input corrompu, en nommant la colonne
  expect_error(
    run_pipeline(theme = theme_mobilite(), cache = cache, sortie = sortie),
    "nb_buildings"
  )

  # ...AVANT un payload partiel : ni la cible de publication ni le dossier
  # analytique n'existent — le chaînon n'a rien persisté, publish n'a jamais
  # tourné
  expect_false(dir.exists(sortie))
  expect_false(dir.exists(file.path(dirname(cache), "processed", "mobilite")))
})
