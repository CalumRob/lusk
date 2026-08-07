# test-run-pipeline-milieux -----------------------------------------------------
# run_pipeline(theme = theme_milieux()) — le run Milieux de bout en bout
# (issue #171, étendu par #172) : la source CONSOENAF téléchargée une seule
# fois (cache idempotent), le reshape RÉEL (m² -> ha + filtre Bretagne), le
# squelette partagé, le payload de L'INDICATEUR livré (les deux clés — la
# fenêtre 2021-2025 et la série annuelle 2011-2024, classées sur la part de
# surface), la validation générique et la publication — les fichiers par
# thème, la référence partagée, les vintages et le rapport de run. Le réseau
# et les vrais fichiers n'entrent jamais dans la boucle de test
# (download_sources / lire_epci / publier_geometrie mockés, la fixture CSV
# fournie dans le cache) ; la publication est RÉELLE — ce qui est testé est ce
# qui part.

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

# Le cache de test : la fixture CSV (le CONSOENAF), la base des EPCI mockée.
cache_milieux <- function() {
  cache <- tempfile("cache-milieux-")
  dir.create(cache)
  file.copy(
    testthat::test_path("fixtures", "consoenaf-fixture.csv"),
    file.path(cache, "conso-com.csv"),
    overwrite = TRUE
  )
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

  # le payload de l'indicateur livré : les deux clés du thème
  expect_named(payload, c("indicateurs", "histoires", "territoires", "apercu"))
  expect_true(all(payload$indicateurs$theme == "milieux"))
  expect_setequal(unique(payload$indicateurs$key),
                  c("conso_enaf_fenetre", "conso_enaf_annuel"))
  # 10 territoires x 1 (fenêtre) + 10 x 14 (annuels) = 150 lignes
  expect_equal(nrow(payload$indicateurs), 150)
  expect_equal(nrow(payload$territoires), 10)
  expect_setequal(unique(payload$territoires$type),
                  c("commune", "epci", "departement", "region"))
  # la valeur publiée : la fenêtre 2021-2025 en hectares (m² -> ha prouvé dans
  # le run complet — 233 202 m² -> 23,3202 ha pour la commune A1)
  expect_equal(
    payload$indicateurs$value[
      payload$indicateurs$territoire == "22001" &
        payload$indicateurs$key == "conso_enaf_fenetre"],
    233202 / 10000
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
  # les histoires vides se relisent (la table est présente, sans ligne)
  hist <- nanoparquet::read_parquet(file.path(cible, "histoires_milieux.parquet"))
  expect_equal(nrow(hist), 0L)

  # vintages.parquet : une ligne par source du manifeste Milieux (les deux)
  vint <- nanoparquet::read_parquet(file.path(cible, "vintages.parquet"))
  expect_equal(nrow(vint), nrow(MANIFEST_MILIEUX))
  expect_setequal(vint$id, c("epci", "consoenaf"))

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
  expect_equal(nrow(ind), 150)  # 10 territoires x (1 fenêtre + 14 annuels)
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

  # premier appel : les DEUX sources du manifeste sont téléchargées
  premier <- download_sources(MANIFEST_MILIEUX, cache)
  expect_setequal(telecharge, c("epci_au_01-01-2025.zip", "conso-com.csv"))
  expect_equal(premier$status, c("frais", "frais"))

  # deuxième appel : le cache fait foi, RIEN n'est re-téléchargé
  second <- download_sources(MANIFEST_MILIEUX, cache)
  expect_equal(telecharge, c("epci_au_01-01-2025.zip", "conso-com.csv"))
  expect_equal(second$status, c("frais", "frais"))
  # la source CONSOENAF n'a donc été téléchargée qu'UNE fois
  expect_equal(sum(telecharge == "conso-com.csv"), 1L)
})
