# run_pipeline(theme = theme_habitat()) ----------------------------------------
# L'entrée unique du thème Habitat (issue #19) : le run complet de bout en bout,
# à étapes mockées — le réseau et les vrais fichiers n'entrent jamais dans la
# boucle de test. Le compute et le publish sont RÉELS (le seam du payload) :
# ce qui est testé est ce qui part — le payload Habitat complet sur les fichiers
# par thème, la référence partagée, les vintages et le rapport de run.
# Issue #19 : le cache du run atteint le builder de vintages du thème (les DPE
# sont estampillés depuis la date de pull lue sur le cache — vintages_habitat a
# une signature AVEC cache, contrairement à vintages_demographie).

# statuts du run Habitat — une ligne par source du manifeste, dans son ordre
statuts_habitat <- function(status = "frais") {
  tibble::tibble(
    id = MANIFEST_HABITAT$id,
    mode = MANIFEST_HABITAT$mode,
    status = rep(status, nrow(MANIFEST_HABITAT))
  )
}

test_that("run_pipeline(theme = theme_habitat()) : le cache atteint les vintages", {
  # la signature de vintages_habitat prend le cache (contrairement à
  # vintages_demographie) : run_pipeline doit lui transmettre le cache du run,
  # sinon la date de pull des DPE ne peut jamais être lue sur le cache.
  cache_vu <- NULL
  faux_vintages <- tibble::tibble(
    id = c("epci", "logements", "dvf_2021_dep22", "dpe_22"),
    source = c("INSEE — EPCI", "INSEE — Logements", "Etalab — DVF",
               "ADEME — DPE"),
    version = c("2025", "2023", "2021", NA_character_),
    licence = c("lov2", "lov2", "lov2", "lov2"),
    date_reference = c("2025-01-01", "2023-01-01", "2021-12-31", NA_character_),
    date_publication = c(NA_character_, "2026-06-30", "2026-05-18", NA_character_)
  )

  local_mocked_bindings(
    download_sources = function(manifest, cache, mode) statuts_habitat(),
    construire_donnees_habitat = function(cache) load_fixture_habitat(),
    vintages_habitat = function(cache) {
      cache_vu <<- cache
      faux_vintages
    },
    compute_payload = function(data, theme = NULL, vintages = NULL)
      list(indicateurs = data.frame(x = 1),
           histoires = data.frame(y = 2),
           territoires = data.frame(territoire = "53", nom = "Bretagne")),
    publish = function(payload, cible, backend = NULL) invisible(payload),
    # issue #311 : le seam des métadonnées est mocké ici (test 1 — sortie par
    # défaut, la publication réelle est couverte par test 2 + le test dédié) ;
    # issue #506 : le mock porte le paramètre directions_module que le run
    # transmet désormais au seam (les directions du module de thème)
    publier_theme_metadata = function(metadata, sortie, vintages = NULL,
                                      theme_attendu = NULL,
                                      directions_module = NULL)
      invisible(metadata),
    ecrire_rapport_run = function(statuts, mode, cible, timestamp = NULL,
                                  couverture = NULL)
      invisible(NULL),
    # issue #60 : la géométrie (ADR-0008) est publiée par le run — jamais de
    # réseau dans la boucle de test (le fetch WFS réel est hors de la boucle).
    publier_geometrie = function(cible = "public/data", fetch = NULL) {
      # le vrai publier_geometrie crée la cible avant d'écrire (R/geometrie.R) ;
      # le test 1 (sortie par défaut) s'appuie sur cet effet de bord
      if (!dir.exists(cible)) dir.create(cible, recursive = TRUE)
      invisible(NULL)
    },
    .package = "lusk"
  )
  local_mocked_bindings(
    write_parquet = function(x, file) invisible(NULL),
    .package = "nanoparquet"
  )

  run_pipeline(theme = theme_habitat(), cache = "data/raw/test-cache")
  expect_equal(cache_vu, "data/raw/test-cache")
})

test_that("run_pipeline(theme = theme_habitat()) : le run Habitat complet, de bout en bout", {
  cible <- tempfile("pub-habitat-")
  on.exit(unlink(cible, recursive = TRUE))
  cache <- tempfile("cache-habitat-")
  on.exit(unlink(cache, recursive = TRUE))

  # les étapes réseau / fichiers sont mockées ; le compute et le publish sont
  # réels — le payload Habitat complet part sur les fichiers par thème
  local_mocked_bindings(
    download_sources = function(manifest, cache, mode) statuts_habitat(),
    construire_donnees_habitat = function(cache) load_fixture_habitat(),
    publier_geometrie = function(cible = "public/data", fetch = NULL) {
      # le vrai publier_geometrie crée la cible avant d'écrire (R/geometrie.R) ;
      # le test 1 (sortie par défaut) s'appuie sur cet effet de bord
      if (!dir.exists(cible)) dir.create(cible, recursive = TRUE)
      invisible(NULL)
    },
    .package = "lusk"
  )

  payload <- run_pipeline(theme = theme_habitat(), cache = cache, sortie = cible)

  # le payload complet du thème
  expect_named(payload, c("indicateurs", "histoires", "territoires", "apercu"))
  expect_true(all(payload$indicateurs$theme == "habitat"))
  expect_setequal(unique(payload$indicateurs$key),
                  c("mix_logements", "statut", "age_du_bati", "type",
                    "prix_m2", "part_passoires", "distribution_dpe"))
  expect_true(all(payload$histoires$theme == "habitat"))
  # l'Aperçu d'un run Habitat : la table du contrat, vide (gating par thème)
  expect_named(payload$apercu, c("territoire", "type", "key", "value", "unit"))
  expect_equal(nrow(payload$apercu), 0)

  # les fichiers par thème + la référence partagée + vintages + rapport.
  # Issue #116 : l'Aperçu d'un run Habitat est vide par design — le fichier
  # partagé apercu n'est NI écrit NI écrasé par un thème sans aperçu (seul
  # Démographie le peuple). Issue #311 : les métadonnées du thème partent
  # avec le run (theme_habitat.json).
  for (f in c("indicateurs_habitat.parquet", "indicateurs_habitat.json",
              "histoires_habitat.parquet", "histoires_habitat.json",
              "territoires.parquet", "territoires.json",
              "vintages.parquet", "run-report.json",
              "theme_habitat.json")) {
    expect_true(file.exists(file.path(cible, f)), info = f)
  }
  expect_false(file.exists(file.path(cible, "apercu.parquet")))
  expect_false(file.exists(file.path(cible, "apercu.json")))

  # le parquet relit exactement le payload publié
  ind <- nanoparquet::read_parquet(file.path(cible, "indicateurs_habitat.parquet"))
  expect_equal(nrow(ind), nrow(payload$indicateurs))
  expect_equal(ind$value, payload$indicateurs$value)
  hist <- nanoparquet::read_parquet(file.path(cible, "histoires_habitat.parquet"))
  expect_equal(hist$classification, payload$histoires$classification)

  # vintages.parquet : une ligne par source du manifeste Habitat
  vint <- nanoparquet::read_parquet(file.path(cible, "vintages.parquet"))
  expect_equal(nrow(vint), nrow(MANIFEST_HABITAT))
  expect_setequal(vint$id, MANIFEST_HABITAT$id)

  # le rapport de run : mode full, une ligne par source
  rapport <- jsonlite::fromJSON(file.path(cible, "run-report.json"))
  expect_equal(rapport$mode, "full")
  expect_equal(rapport$statuts$id, MANIFEST_HABITAT$id)
})

test_that("un re-run Habitat écrase sans dupliquer (upsert, issue #19)", {
  cible <- tempfile("pub-habitat-")
  on.exit(unlink(cible, recursive = TRUE))
  cache <- tempfile("cache-habitat-")
  on.exit(unlink(cache, recursive = TRUE))

  local_mocked_bindings(
    download_sources = function(manifest, cache, mode) statuts_habitat(),
    construire_donnees_habitat = function(cache) load_fixture_habitat(),
    publier_geometrie = function(cible = "public/data", fetch = NULL) {
      # le vrai publier_geometrie crée la cible avant d'écrire (R/geometrie.R) ;
      # le test 1 (sortie par défaut) s'appuie sur cet effet de bord
      if (!dir.exists(cible)) dir.create(cible, recursive = TRUE)
      invisible(NULL)
    },
    .package = "lusk"
  )

  run_pipeline(theme = theme_habitat(), cache = cache, sortie = cible)
  run_pipeline(theme = theme_habitat(), cache = cache, sortie = cible)

  # le payload EST l'état complet : relancer écrase, ne duplique jamais
  ind <- nanoparquet::read_parquet(file.path(cible, "indicateurs_habitat.parquet"))
  ref <- nanoparquet::read_parquet(file.path(cible, "territoires.parquet"))
  expect_equal(nrow(ind), nrow(payload_habitat()$indicateurs))
  expect_equal(nrow(ref), nrow(payload_habitat()$territoires))
})

test_that("en mode cron, le rapport enregistre les sources manuel « à traiter à la main »", {
  # issue #19 : DPE et DVF sont « manuel » (ADR-0004) — en mode cron elles sont
  # sautées et enregistrées « à traiter à la main » (jamais de réseau), en mode
  # full elles tournent. download_sources gère le saut (test-download.R) ; ici
  # on verrouille le câblage : les statuts du run cron arrivent tels quels dans
  # le rapport.
  cible <- tempfile("pub-habitat-")
  on.exit(unlink(cible, recursive = TRUE))
  cache <- tempfile("cache-habitat-")
  on.exit(unlink(cache, recursive = TRUE))

  # ce que download_sources renvoie en mode cron : cron -> frais,
  # manuel -> à traiter à la main
  statuts_cron <- tibble::tibble(
    id = MANIFEST_HABITAT$id,
    mode = MANIFEST_HABITAT$mode,
    status = dplyr::if_else(MANIFEST_HABITAT$mode == "cron",
                            "frais", "à traiter à la main")
  )

  local_mocked_bindings(
    download_sources = function(manifest, cache, mode) statuts_cron,
    construire_donnees_habitat = function(cache) load_fixture_habitat(),
    publier_geometrie = function(cible = "public/data", fetch = NULL) {
      # le vrai publier_geometrie crée la cible avant d'écrire (R/geometrie.R) ;
      # le test 1 (sortie par défaut) s'appuie sur cet effet de bord
      if (!dir.exists(cible)) dir.create(cible, recursive = TRUE)
      invisible(NULL)
    },
    .package = "lusk"
  )

  run_pipeline(theme = theme_habitat(), cache = cache, sortie = cible, mode = "cron")

  rapport <- jsonlite::fromJSON(file.path(cible, "run-report.json"))
  expect_equal(rapport$mode, "cron")
  manuels <- rapport$statuts[rapport$statuts$mode == "manuel", , drop = FALSE]
  expect_true(all(manuels$status == "à traiter à la main"))
  # ce sont bien DPE et DVF qui sont manuel — jamais le RP ni la base EPCI
  expect_setequal(manuels$id, c(MANIFEST_HABITAT_DVF$id, MANIFEST_HABITAT_DPE$id))
})

test_that("le run Habitat estampille les DPE depuis le cache (base roulante)", {
  # issue #19 : le vintage d'une base roulante est la date du pull, lue sur le
  # mtime du cache .rds — pas une date inventée. Le cache porte les .rds DPE
  # (mtime fixé) : le payload publié porte la date du pull.
  cible <- tempfile("pub-habitat-")
  on.exit(unlink(cible, recursive = TRUE))
  cache <- tempfile("cache-habitat-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  for (id in MANIFEST_HABITAT_DPE$id) {
    chemin <- file.path(cache, MANIFEST_HABITAT_DPE$fichier[
      MANIFEST_HABITAT_DPE$id == id])
    readr::write_rds(tibble::tibble(x = 1), chemin)
    Sys.setFileTime(chemin, as.POSIXct("2026-07-01 12:00:00", tz = "UTC"))
  }

  local_mocked_bindings(
    download_sources = function(manifest, cache, mode) statuts_habitat(),
    construire_donnees_habitat = function(cache) load_fixture_habitat(),
    publier_geometrie = function(cible = "public/data", fetch = NULL) {
      # le vrai publier_geometrie crée la cible avant d'écrire (R/geometrie.R) ;
      # le test 1 (sortie par défaut) s'appuie sur cet effet de bord
      if (!dir.exists(cible)) dir.create(cible, recursive = TRUE)
      invisible(NULL)
    },
    .package = "lusk"
  )

  payload <- run_pipeline(theme = theme_habitat(), cache = cache, sortie = cible)

  # les estampilles DPE portent la date du pull — pas NA, jamais une date inventée
  for (cle in c("part_passoires", "distribution_dpe")) {
    expect_equal(
      unique(payload$indicateurs$vintage_date_publication[
        payload$indicateurs$key == cle]),
      "2026-07-01",
      info = cle
    )
    expect_equal(
      unique(payload$indicateurs$vintage_version[
        payload$indicateurs$key == cle]),
      "2026-07-01",
      info = cle
    )
  }
  # les autres sources restent sur leurs dates du manifeste
  expect_equal(
    unique(payload$indicateurs$vintage_date_publication[
      payload$indicateurs$key == "prix_m2"]),
    "2026-05-18"
  )
  expect_equal(
    unique(payload$indicateurs$vintage_date_publication[
      payload$indicateurs$key == "mix_logements"]),
    "2026-06-30"
  )
})
