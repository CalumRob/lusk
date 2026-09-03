# run_pipeline ----------------------------------------------------------------
# L'entrée unique. Point 11 : la composition des étapes (download -> construire
# -> vintage -> compute -> publish) est verrouillée par un test à étapes
# mockées — le réseau et les vrais fichiers n'entrent jamais dans la boucle de
# test. Issue #9 : la table des vintages entière passe au compute — les
# estampilles sont par indicateur (source de référence déclarée), plus de
# tampon de thème pointé par un id. Issue #10 : download_sources() renvoie les
# statuts par source, run_pipeline les capture et écrit le rapport de run
# (mode + horodatage + statuts) à côté du payload — et, sur un échec cron, le
# rapport est écrit AVANT l'arrêt bruyant.

test_that("run_pipeline est l'entrée unique, sur les dossiers du dépôt", {
  expect_type(run_pipeline, "closure")
  # les chemins par défaut vivent dans le dépôt (jamais sur C:)
  expect_equal(formals(run_pipeline)$cache, "data/raw")
  # issue #10 : la cible par défaut est le home public du payload (public/data/
  # à la racine du dépôt, ADR-0004) — le cron écrit là où Pages et l'app lisent
  expect_equal(formals(run_pipeline)$sortie, "public/data")
  # le mode de run (issue #8) : "full" par défaut (local), "cron" pour le runner
  expect_true("mode" %in% names(formals(run_pipeline)))
  expect_equal(formals(run_pipeline)$mode, quote(c("full", "cron")))
})

test_that("run_pipeline compose les étapes dans l'ordre, à étapes mockées (point 11)", {
  # trace des appels : chaque étape enregistre ce qu'elle reçoit
  appels <- new.env(parent = emptyenv())
  appels$download <- 0
  appels$construire <- 0
  appels$publish <- 0
  appels$parquet <- 0
  appels$geometrie <- 0
  appels$donnees_vues <- NULL
  appels$vintages_compute_vus <- NULL
  appels$noms_epci_geo_api_vus <- NULL
  appels$payload_vu <- NULL
  appels$vintages_vus <- NULL
  appels$mode_vu <- NULL
  appels$publish_cible_vue <- NULL
  appels$backend_vu <- NULL
  appels$rapport_statuts_vus <- NULL
  appels$rapport_mode_vu <- NULL
  appels$rapport_cible_vue <- NULL
  appels$geometrie_cible_vue <- NULL
  appels$vintages_json <- 0
  appels$meta <- 0

  faux_payload <- list(
    indicateurs = data.frame(x = 1),
    histoires = data.frame(y = 2),
    territoires = data.frame(territoire = "53", nom = "Bretagne")
  )
  faux_statuts <- tibble::tibble(
    id = c("serie_historique", "menages", "age_detail", "epci"),
    mode = c("cron", "cron", "cron", "cron"),
    status = c("frais", "frais", "frais", "frais")
  )
  faux_vintages <- tibble::tibble(
    id = c("serie_historique", "menages"),
    source = c("INSEE — Série historique du recensement", "INSEE — Ménages"),
    version = c("2023", "2023"),
    licence = c("lov2", "lov2"),
    date_reference = c("2023-01-01", "2023-01-01"),
    date_publication = c("2026-06-30", "2026-06-30")
  )

  local_mocked_bindings(
    download_sources = function(manifest, cache, mode) {
      appels$download <- appels$download + 1
      appels$mode_vu <- mode
      faux_statuts
    },
    construire_donnees_brut = function(cache) {
      appels$construire <- appels$construire + 1
      load_fixture()
    },
    vintages_demographie = function() faux_vintages,
    compute_payload = function(data, theme = NULL, vintages = NULL,
                               noms_epci_geo_api = NULL) {
      appels$donnees_vues <- data
      appels$vintages_compute_vus <- vintages
      appels$noms_epci_geo_api_vus <- noms_epci_geo_api
      faux_payload
    },
    publish = function(payload, cible, backend = "static") {
      appels$publish <- appels$publish + 1
      appels$payload_vu <- payload
      appels$publish_cible_vue <- cible
      appels$backend_vu <- backend
      invisible(payload)
    },
    # issue #60 : la géométrie (ADR-0008) est publiée par le run, vers la même
    # cible que le payload — un artefact partagé, pas une table du thème.
    publier_geometrie = function(cible = "public/data", fetch = NULL) {
      appels$geometrie <- appels$geometrie + 1
      appels$geometrie_cible_vue <- cible
      invisible(NULL)
    },
    # issue #311 : la publication des métadonnées (theme_<theme>.json) est une
    # étape SÉPARÉE du payload — le run la branche après les faits, avec les
    # vintages du thème, la garde theme_attendu et les directions du module
    # (#506) (le seam lui-même est testé dans test-publier-theme-metadata.R)
    publier_theme_metadata = function(metadata, sortie, vintages = NULL,
                                      theme_attendu = NULL,
                                      directions_module = NULL) {
      appels$meta <- appels$meta + 1
      appels$meta_metadata <- metadata
      appels$meta_cible <- sortie
      appels$meta_vintages <- vintages
      appels$meta_attendu <- theme_attendu
      appels$meta_directions <- directions_module
      invisible(metadata)
    },
    ecrire_rapport_run = function(statuts, mode, cible, timestamp = NULL,
                                  couverture = NULL) {
      appels$rapport_statuts_vus <- statuts
      appels$rapport_mode_vu <- mode
      appels$rapport_cible_vue <- cible
      invisible(NULL)
    },
    .package = "lusk"
  )
  local_mocked_bindings(
    write_parquet = function(x, file) {
      appels$parquet <- appels$parquet + 1
      appels$vintages_vus <- x
      invisible(NULL)
    },
    .package = "nanoparquet"
  )
  local_mocked_bindings(
    # issue #73 : le run projette la table des vintages en JSON — la table que
    # l'app lit pour citer les sources d'un bloc.
    write_json = function(x, path, ...) {
      appels$vintages_json <- appels$vintages_json + 1
      appels$vintages_json_vus <- x
      invisible(NULL)
    },
    .package = "jsonlite"
  )

  resultat <- run_pipeline()

  # chaque étape est appelée exactement une fois, dans l'ordre
  expect_equal(appels$download, 1)
  expect_equal(appels$construire, 1)
  expect_equal(appels$publish, 1)
  expect_equal(appels$parquet, 1)
  expect_equal(appels$geometrie, 1)
  expect_equal(appels$vintages_json, 1)
  expect_equal(appels$meta, 1)
  expect_identical(appels$vintages_json_vus, faux_vintages)

  # la donnée du compute vient de construire_donnees_brut
  expect_s3_class(appels$donnees_vues, "tbl_df")

  # issue #9 : la table des vintages entière passe au compute — l'estampillage
  # est par indicateur (source de référence déclarée), plus de tampon de thème
  expect_identical(appels$vintages_compute_vus, faux_vintages)

  # le compute reçoit le canon public épinglé — aucune requête Geo API live
  expect_identical(
    unname(appels$noms_epci_geo_api_vus[["200042174"]]),
    "CA Lorient Agglomération"
  )

  # publish reçoit le payload de compute, vers la cible du run, en "static"
  # (issue #10 : le run écrit l'artefact complet — parquet + JSON) ; les
  # vintages partent en parquet ; la géométrie (issue #60) part vers la même
  # cible que le payload
  expect_identical(appels$payload_vu, faux_payload)
  expect_equal(appels$publish_cible_vue, "public/data")
  expect_equal(appels$backend_vu, "static")
  expect_equal(appels$geometrie_cible_vue, "public/data")
  expect_equal(nrow(appels$vintages_vus), 2)

  # le mode par défaut est "full" — le comportement local est inchangé
  expect_equal(appels$mode_vu, "full")

  # issue #311 : les métadonnées du thème partent après le payload — la même
  # cible, les vintages du thème, la garde theme_attendu (le thème du run)
  expect_identical(appels$meta_metadata$theme, "demographie")
  expect_equal(appels$meta_cible, "public/data")
  expect_identical(appels$meta_vintages, faux_vintages)
  expect_equal(appels$meta_attendu, "demographie")
  # issue #506 : le run transmet les directions du module — la croisée
  # descripteur ↔ module vit à la publication
  expect_identical(appels$meta_directions, theme_demographie()$directions)

  # issue #10 : le rapport de run est écrit avec les statuts capturés depuis
  # download_sources(), le mode du run et la même cible que le payload
  expect_identical(appels$rapport_statuts_vus, faux_statuts)
  expect_equal(appels$rapport_mode_vu, "full")
  expect_equal(appels$rapport_cible_vue, "public/data")

  # le retour est le payload
  expect_identical(resultat, faux_payload)
})

test_that("run_pipeline transmet le mode à l'étape de téléchargement (issue #8)", {
  mode_vu <- NULL
  faux_statuts <- tibble::tibble(
    id = "serie_historique",
    mode = "cron",
    status = "frais"
  )
  faux_vintages <- tibble::tibble(
    id = "serie_historique",
    source = "INSEE — Série historique du recensement",
    version = "2023",
    licence = "lov2",
    date_reference = "2023-01-01",
    date_publication = "2026-06-30"
  )

  local_mocked_bindings(
    download_sources = function(manifest, cache, mode) {
      mode_vu <<- mode
      faux_statuts
    },
    construire_donnees_brut = function(cache) load_fixture(),
    vintages_demographie = function() faux_vintages,
    compute_payload = function(data, theme = NULL, vintages = NULL) list(),
    publish = function(payload, cible, backend = NULL) invisible(payload),
    publier_theme_metadata = function(metadata, sortie, vintages = NULL,
                                      theme_attendu = NULL,
                                      directions_module = NULL)
      invisible(metadata),
    ecrire_rapport_run = function(statuts, mode, cible, timestamp = NULL,
                                  couverture = NULL)
      invisible(NULL),
    .package = "lusk"
  )
  local_mocked_bindings(
    write_parquet = function(x, file) invisible(NULL),
    .package = "nanoparquet"
  )

  run_pipeline(mode = "cron")
  expect_equal(mode_vu, "cron")

  run_pipeline()
  expect_equal(mode_vu, "full")
})

test_that("run_pipeline porte le diagnostic de couverture du thème dans le rapport (issue #233)", {
  # le seam d'entrée porte la couverture (la Mobilité via son orchestrateur
  # Geovelo) — le run la transmet telle quelle au rapport, un fait de première
  # classe du run, distinct des statuts par source
  couverture <- tibble::tibble(
    departement = c("22", "29", "35", "56"),
    lignes_actuel = c(100, 200, 300, 400),
    km_actuel = c(10, 20, 30, 40),
    lignes_precedent = c(100, 200, 300, 400),
    km_precedent = c(10, 20, 30, 40),
    regression = c(FALSE, FALSE, FALSE, FALSE)
  )
  recu <- NULL
  faux_statuts <- tibble::tibble(
    id = "amenagements_cyclables", mode = "cron", status = "frais"
  )
  faux_vintages <- tibble::tibble(
    id = "amenagements_cyclables",
    source = "Geovelo — Aménagements cyclables France Métropolitaine",
    version = "2026-08",
    licence = "odbl",
    date_reference = "2026-08-07",
    date_publication = "2026-08-07"
  )

  local_mocked_bindings(
    download_sources = function(manifest, cache, mode) faux_statuts,
    construire_donnees_brut = function(cache) list(couverture = couverture),
    vintages_demographie = function() faux_vintages,
    compute_payload = function(data, theme = NULL, vintages = NULL) list(),
    publish = function(payload, cible, backend = NULL) invisible(payload),
    publier_geometrie = function(cible = "public/data", fetch = NULL)
      invisible(NULL),
    publier_theme_metadata = function(metadata, sortie, vintages = NULL,
                                      theme_attendu = NULL,
                                      directions_module = NULL)
      invisible(metadata),
    ecrire_rapport_run = function(statuts, mode, cible, timestamp = NULL,
                                  couverture = NULL) {
      recu <<- couverture
      invisible(NULL)
    },
    .package = "lusk"
  )
  local_mocked_bindings(
    write_parquet = function(x, file) invisible(NULL),
    .package = "nanoparquet"
  )
  local_mocked_bindings(
    write_json = function(x, path, ...) invisible(NULL),
    .package = "jsonlite"
  )

  run_pipeline()
  expect_identical(recu, couverture)
})

test_that("un échec cron écrit le rapport de run avant l'arrêt bruyant", {
  # issue #10 : sur un échec cron, les statuts (dont le « échec » de la source
  # fautive) sont portés par l'erreur (issue #8) — le rapport est écrit AVANT
  # que run_pipeline re-signale l'erreur. L'échec reste tracé.
  statuts_echec <- tibble::tibble(
    id = c("serie_historique", "menages", "age_detail", "epci"),
    mode = c("cron", "cron", "cron", "cron"),
    status = c("frais", "frais", "frais", "échec")
  )
  ecrit <- NULL

  local_mocked_bindings(
    download_sources = function(manifest, cache, mode) {
      stop(erreur_telechargement(statuts_echec, "https://example.invalid/epci.zip"))
    },
    ecrire_rapport_run = function(statuts, mode, cible, timestamp = NULL,
                                  couverture = NULL) {
      ecrit <<- list(statuts = statuts, mode = mode, cible = cible)
      invisible(NULL)
    },
    .package = "lusk"
  )

  expect_error(run_pipeline(mode = "cron"), class = "erreur_telechargement")

  # le rapport a été écrit avant l'arrêt, avec les statuts du run échoué
  expect_identical(ecrit$statuts, statuts_echec)
  expect_equal(ecrit$mode, "cron")
  expect_equal(ecrit$cible, "public/data")
})
