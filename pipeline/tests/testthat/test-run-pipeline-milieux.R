# test-run-pipeline-milieux -----------------------------------------------------
# run_pipeline(theme = theme_milieux()) — le TRACEUR de bout en bout (issue
# #171) : la source CONSOENAF téléchargée une seule fois (cache idempotent),
# le reshape RÉEL (m² -> ha + filtre Bretagne), le squelette partagé, le
# payload squelettique (la clé conso_enaf), la validation générique et la
# publication — les fichiers par thème, la référence partagée, les vintages et
# le rapport de run. Le réseau et les vrais fichiers n'entrent jamais dans la
# boucle de test (download_sources / lire_epci / publier_geometrie mockés, la
# fixture CSV fournie dans le cache) ; la publication est RÉELLE — ce qui est
# testé est ce qui part.

# statuts du run Milieux — une ligne par source du manifeste, dans son ordre
statuts_milieux <- function(status = "frais") {
  tibble::tibble(
    id = MANIFEST_MILIEUX$id,
    mode = MANIFEST_MILIEUX$mode,
    status = rep(status, nrow(MANIFEST_MILIEUX))
  )
}

# Un zip minimal valide (une entrée stockée, vide) — pour que la source EPCI
# (un .zip) passe verifier_fichier dans le test du téléchargement idempotent.
mini_zip_milieux <- function(nom = "a.txt") {
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

# Le cache de test : la fixture CSV (le CONSOENAF), la base des EPCI mockée, la
# série historique du recensement déposée extraite (la source partagée de la
# population de l'Histoire, #174).
cache_milieux <- function() {
  cache <- tempfile("cache-milieux-")
  dir.create(cache)
  file.copy(
    testthat::test_path("fixtures", "consoenaf-fixture.csv"),
    file.path(cache, "conso-com.csv"),
    overwrite = TRUE
  )
  copier_fixture_serie_historique(cache)
  cache
}

test_that("run_pipeline(theme = theme_milieux()) : le run Milieux complet, de bout en bout", {
  cible <- tempfile("pub-milieux-")
  on.exit(unlink(cible, recursive = TRUE))
  cache <- cache_milieux()
  on.exit(unlink(cache, recursive = TRUE))

  local_mocked_bindings(
    download_sources = function(manifest, cache, mode) statuts_milieux(),
    lire_epci = function(chemin) base_epci_milieux,
    publier_geometrie = function(cible = "public/data", fetch = NULL)
      invisible(NULL),
    .package = "lusk"
  )

  payload <- run_pipeline(theme = theme_milieux(), cache = cache, sortie = cible)

  # le payload squelettique : les quatre tables du contrat
  expect_named(payload, c("indicateurs", "histoires", "territoires", "apercu"))
  expect_true(all(payload$indicateurs$theme == "milieux"))
  expect_setequal(unique(payload$indicateurs$key), "conso_enaf")
  # une ligne par territoire : 5 communes + 2 EPCIs + 2 départements + région
  expect_equal(nrow(payload$indicateurs), 10)
  expect_equal(nrow(payload$territoires), 10)
  expect_setequal(unique(payload$territoires$type),
                  c("commune", "epci", "departement", "region"))
  # la valeur publiée : la consommation en hectares (m² -> ha prouvé dans le
  # run complet — 1 233 202 m² -> 123,3202 ha pour la commune A1)
  expect_equal(
    payload$indicateurs$value[payload$indicateurs$territoire == "22001"],
    1233202 / 10000
  )

  # les fichiers par thème + la référence partagée + vintages + rapport.
  # L'Aperçu est vide par design : le fichier partagé apercu n'est NI écrit
  # NI écrasé par un thème sans aperçu (issue #116).
  for (f in c("indicateurs_milieux.parquet", "indicateurs_milieux.json",
              "histoires_milieux.parquet", "histoires_milieux.json",
              "territoires.parquet", "territoires.json",
              "vintages.parquet", "run-report.json")) {
    expect_true(file.exists(file.path(cible, f)), info = f)
  }
  expect_false(file.exists(file.path(cible, "apercu.parquet")))
  expect_false(file.exists(file.path(cible, "apercu.json")))

  # le parquet relit exactement le payload publié
  ind <- nanoparquet::read_parquet(file.path(cible, "indicateurs_milieux.parquet"))
  expect_equal(nrow(ind), nrow(payload$indicateurs))
  expect_equal(ind$value, payload$indicateurs$value)
  # les histoires se relisent : une ligne par territoire, la lecture et les
  # forces de l'Histoire (#174)
  hist <- nanoparquet::read_parquet(file.path(cible, "histoires_milieux.parquet"))
  expect_equal(nrow(hist), nrow(payload$histoires))
  expect_equal(hist$territoire, payload$histoires$territoire)
  expect_equal(hist$classification, payload$histoires$classification)

  # vintages.parquet : une ligne par source du manifeste Milieux (les trois)
  vint <- nanoparquet::read_parquet(file.path(cible, "vintages.parquet"))
  expect_equal(nrow(vint), nrow(MANIFEST_MILIEUX))
  expect_setequal(vint$id, c("epci", "consoenaf", "serie_historique"))

  # le rapport de run : mode full, une ligne par source
  rapport <- jsonlite::fromJSON(file.path(cible, "run-report.json"))
  expect_equal(rapport$mode, "full")
  expect_equal(rapport$statuts$id, MANIFEST_MILIEUX$id)
})

test_that("un re-run Milieux écrase sans dupliquer (upsert, idempotence)", {
  cible <- tempfile("pub-milieux-")
  on.exit(unlink(cible, recursive = TRUE))
  cache <- cache_milieux()
  on.exit(unlink(cache, recursive = TRUE))

  local_mocked_bindings(
    download_sources = function(manifest, cache, mode) statuts_milieux(),
    lire_epci = function(chemin) base_epci_milieux,
    publier_geometrie = function(cible = "public/data", fetch = NULL)
      invisible(NULL),
    .package = "lusk"
  )

  run_pipeline(theme = theme_milieux(), cache = cache, sortie = cible)
  run_pipeline(theme = theme_milieux(), cache = cache, sortie = cible)

  # le payload EST l'état complet : relancer écrase, ne duplique jamais
  ind <- nanoparquet::read_parquet(file.path(cible, "indicateurs_milieux.parquet"))
  ref <- nanoparquet::read_parquet(file.path(cible, "territoires.parquet"))
  expect_equal(nrow(ind), 10)  # 10 territoires × 1 clé
  expect_equal(anyDuplicated(ind[c("territoire", "key", "detail")]), 0L)
  expect_equal(nrow(ref), 10)
})

test_that("le téléchargement CONSOENAF est idempotent : une seule fois, le cache fait foi", {
  cache <- tempfile("cache-dl-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  telecharge <- character(0)
  local_mocked_bindings(
    telecharger_fichier = function(url, cible) {
      telecharge <<- c(telecharge, basename(cible))
      if (grepl("\\.zip$", cible)) writeBin(mini_zip_milieux(), cible)
      else writeLines("idcom,idcomtxt,iddep", cible)
    },
    .package = "lusk"
  )

  # premier appel : les TROIS sources du manifeste sont téléchargées
  premier <- download_sources(MANIFEST_MILIEUX, cache)
  expect_setequal(telecharge, c("epci_au_01-01-2025.zip", "conso-com.csv",
                                "DS_RP_SERIE_HISTORIQUE_2023_CSV_FR.zip"))
  expect_equal(premier$status, c("frais", "frais", "frais"))

  # deuxième appel : le cache fait foi, RIEN n'est re-téléchargé
  second <- download_sources(MANIFEST_MILIEUX, cache)
  expect_equal(telecharge, c("epci_au_01-01-2025.zip", "conso-com.csv",
                             "DS_RP_SERIE_HISTORIQUE_2023_CSV_FR.zip"))
  expect_equal(second$status, c("frais", "frais", "frais"))
  # la source CONSOENAF n'a donc été téléchargée qu'UNE fois
  expect_equal(sum(telecharge == "conso-com.csv"), 1L)
})
