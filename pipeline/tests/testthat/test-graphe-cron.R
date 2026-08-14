# test-graphe-cron -------------------------------------------------------------
# Le seam de décision du build cron (revue #386) : la logique qui vivait dans
# l'étape « Build en mode cron » de .github/workflows/pipeline-cron.yml en un
# one-liner R non testable. La sémantique est verrouillée ici, avec les mocks
# de la suite (local_mocked_bindings) — jamais le réseau, jamais le store
# réel :
#   - aucune cible en échec -> succès, pas de rapport, pas de re-téléchargement ;
#   - cible sources_* en échec sans rapport existant -> rapport d'échec
#     (statuts « échec » portés par l'erreur, issue #8) + échec signalé ;
#   - cible en échec hors sources_* (ou rapport déjà écrit par le DAG) ->
#     aucun rapport écrit/écrasé, échec signalé ;
#   - la liste des manifestes est DÉRIVÉE de LUSK_THEMES (la même source de
#     vérité que _targets.R, jamais une liste en dur — la duplication que la
#     revue a supprimée).

# statuts_echec -----------------------------------------------------------------
# La table des statuts d'un run dont une source est en échec (la forme que
# download_sources renvoie / porte sur l'erreur, issue #8).
statuts_echec <- function() {
  tibble::tibble(
    id = c("serie_historique", "menages", "age_detail", "epci"),
    mode = c("cron", "cron", "cron", "cron"),
    status = c("frais", "frais", "échec", "frais")
  )
}

test_that("aucune cible en échec : succès, aucun rapport, aucun re-téléchargement", {
  sortie <- tempfile("pub-")
  dir.create(sortie)
  on.exit(unlink(sortie, recursive = TRUE))
  withr::local_envvar(
    LUSK_MODE = "cron",
    LUSK_CACHE = "data/raw",
    LUSK_SORTIE = sortie,
    LUSK_THEMES = "demographie,habitat,economie"
  )

  appels_make <- 0
  telecharges <- 0
  local_mocked_bindings(
    tar_make = function(callr_function = NULL) {
      appels_make <<- appels_make + 1
      invisible(NULL)
    },
    tar_errored = function() character(0),
    .package = "targets"
  )
  local_mocked_bindings(
    download_sources = function(manifest, cache = "data/raw",
                                mode = c("full", "cron")) {
      telecharges <<- telecharges + 1
      tibble::tibble(id = "x", mode = mode, status = "frais")
    },
    .package = "lusk"
  )

  expect_true(executer_graphe_cron())
  expect_equal(appels_make, 1)       # le graphe a été invoqué
  expect_equal(telecharges, 0)       # jamais de re-téléchargement
  expect_false(file.exists(file.path(sortie, "run-report.json")))
})

test_that("cible sources_* en échec sans rapport : rapport d'échec écrit, échec signalé", {
  sortie <- tempfile("pub-")
  dir.create(sortie)
  on.exit(unlink(sortie, recursive = TRUE))
  withr::local_envvar(
    LUSK_MODE = "cron",
    LUSK_CACHE = "data/raw",
    LUSK_SORTIE = sortie,
    LUSK_THEMES = "demographie,habitat,economie"
  )

  appels_make <- 0
  local_mocked_bindings(
    tar_make = function(callr_function = NULL) {
      appels_make <<- appels_make + 1
      invisible(NULL)
    },
    tar_errored = function() c("sources_demographie"),
    .package = "targets"
  )
  local_mocked_bindings(
    download_sources = function(manifest, cache = "data/raw",
                                mode = c("full", "cron")) {
      statuts_echec()
    },
    .package = "lusk"
  )

  expect_false(executer_graphe_cron())
  expect_equal(appels_make, 1)

  # le rapport d'échec est écrit à côté du payload — statuts « échec »
  rapport <- jsonlite::fromJSON(file.path(sortie, "run-report.json"))
  expect_equal(rapport$mode, "cron")
  expect_true(any(rapport$statuts$status == "échec"))
})

test_that("un échec de téléchargement porte les statuts sur l'erreur — la boucle s'arrête au premier thème fautif", {
  sortie <- tempfile("pub-")
  dir.create(sortie)
  on.exit(unlink(sortie, recursive = TRUE))
  withr::local_envvar(
    LUSK_MODE = "cron",
    LUSK_CACHE = "data/raw",
    LUSK_SORTIE = sortie,
    LUSK_THEMES = "demographie,habitat,economie"
  )

  manifestes_vus <- list()
  local_mocked_bindings(
    tar_make = function(callr_function = NULL) invisible(NULL),
    tar_errored = function() c("sources_demographie", "sources_habitat"),
    .package = "targets"
  )
  local_mocked_bindings(
    download_sources = function(manifest, cache = "data/raw",
                                mode = c("full", "cron")) {
      manifestes_vus <<- c(manifestes_vus, list(manifest))
      # le premier thème échoue : les statuts « échec » voyagent sur l'erreur
      # (issue #8) — le seam les récupère et s'arrête (break)
      if (length(manifestes_vus) == 1) {
        stop(erreur_telechargement(statuts_echec(),
                                   "https://example.invalid/source"))
      }
      tibble::tibble(id = "x", mode = mode, status = "frais")
    },
    .package = "lusk"
  )

  expect_false(executer_graphe_cron())

  # la boucle s'est arrêtée au premier thème en échec — un seul manifeste vu
  expect_length(manifestes_vus, 1)
  expect_identical(manifestes_vus[[1]], theme_demographie()$manifest)

  rapport <- jsonlite::fromJSON(file.path(sortie, "run-report.json"))
  expect_true(any(rapport$statuts$status == "échec"))
})

test_that("cible en échec hors sources_* : échec signalé, aucun re-téléchargement ni rapport", {
  sortie <- tempfile("pub-")
  dir.create(sortie)
  on.exit(unlink(sortie, recursive = TRUE))
  withr::local_envvar(
    LUSK_MODE = "cron",
    LUSK_CACHE = "data/raw",
    LUSK_SORTIE = sortie,
    LUSK_THEMES = "demographie,habitat,economie"
  )

  telecharges <- 0
  local_mocked_bindings(
    tar_make = function(callr_function = NULL) invisible(NULL),
    tar_errored = function() c("brut_demographie", "payload_habitat"),
    .package = "targets"
  )
  local_mocked_bindings(
    download_sources = function(manifest, cache = "data/raw",
                                mode = c("full", "cron")) {
      telecharges <<- telecharges + 1
      statuts_echec()
    },
    .package = "lusk"
  )

  expect_false(executer_graphe_cron())
  expect_equal(telecharges, 0)
  expect_false(file.exists(file.path(sortie, "run-report.json")))
})

test_that("le rapport existe déjà : jamais écrasé, échec signalé", {
  sortie <- tempfile("pub-")
  dir.create(sortie)
  on.exit(unlink(sortie, recursive = TRUE))
  withr::local_envvar(
    LUSK_MODE = "cron",
    LUSK_CACHE = "data/raw",
    LUSK_SORTIE = sortie,
    LUSK_THEMES = "demographie,habitat,economie"
  )

  # le DAG a déjà écrit le rapport (les rapports dépendent des sources — ils
  # existent quand ce n'est pas le téléchargement qui a échoué)
  ecrire_rapport_run(
    tibble::tibble(id = "x", mode = "cron", status = "frais"),
    "cron", sortie, timestamp = "2026-08-14T06:00:00Z"
  )
  avant <- readLines(file.path(sortie, "run-report.json"), warn = FALSE)

  local_mocked_bindings(
    tar_make = function(callr_function = NULL) invisible(NULL),
    tar_errored = function() c("sources_demographie"),
    .package = "targets"
  )
  local_mocked_bindings(
    download_sources = function(manifest, cache = "data/raw",
                                mode = c("full", "cron")) {
      statuts_echec()
    },
    .package = "lusk"
  )

  expect_false(executer_graphe_cron())
  expect_identical(
    readLines(file.path(sortie, "run-report.json"), warn = FALSE),
    avant
  )
})

test_that("le seam télécharge les manifestes des thèmes de LUSK_THEMES, dans l'ordre", {
  sortie <- tempfile("pub-")
  dir.create(sortie)
  on.exit(unlink(sortie, recursive = TRUE))
  withr::local_envvar(
    LUSK_MODE = "cron",
    LUSK_CACHE = "data/raw",
    LUSK_SORTIE = sortie,
    LUSK_THEMES = "demographie,habitat,economie"
  )

  manifestes_vus <- list()
  local_mocked_bindings(
    tar_make = function(callr_function = NULL) invisible(NULL),
    tar_errored = function() c("sources_demographie"),
    .package = "targets"
  )
  local_mocked_bindings(
    download_sources = function(manifest, cache = "data/raw",
                                mode = c("full", "cron")) {
      manifestes_vus <<- c(manifestes_vus, list(manifest))
      tibble::tibble(id = "x", mode = mode, status = "frais")
    },
    .package = "lusk"
  )

  # le re-téléchargement réussit (statuts frais) : aucun rapport écrit, mais
  # l'échec du graphe reste signalé — l'identique de l'ancien câblage
  expect_false(executer_graphe_cron())
  expect_false(file.exists(file.path(sortie, "run-report.json")))

  # les TROIS manifestes légers, dans l'ordre de LUSK_THEMES — jamais une
  # liste en dur dans le YAML (la duplication supprimée par la revue #386)
  expect_length(manifestes_vus, 3)
  expect_identical(manifestes_vus[[1]], theme_demographie()$manifest)
  expect_identical(manifestes_vus[[2]], theme_habitat()$manifest)
  expect_identical(manifestes_vus[[3]], theme_economie()$manifest)
})

test_that("manifestes_pour suit la convention du graphe pour LUSK_THEMES", {
  # les trois thèmes légers du cron, dans l'ordre de la variable
  legers <- manifestes_pour("demographie,habitat,economie")
  expect_identical(legers, list(
    demographie = theme_demographie()$manifest,
    habitat = theme_habitat()$manifest,
    economie = theme_economie()$manifest
  ))

  # vide = les CINQ thèmes du graphe (la convention THEMES_RUN de _targets.R)
  tous <- manifestes_pour("")
  expect_named(tous, c("demographie", "habitat", "economie", "mobilite",
                       "milieux"))

  # un nom inconnu est une erreur (la convention du graphe)
  expect_error(
    manifestes_pour("demographie,inconnu"),
    "LUSK_THEMES : thème\\(s\\) inconnu\\(s\\) : inconnu"
  )
})
