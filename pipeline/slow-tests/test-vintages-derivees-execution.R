# Slow tier (#1172): execution is the contract: two tar_make calls on the three-target vintage fixture prove changed bytes and publication clocks.
# Run explicitly with testthat::test_file(..., package="lusk") from pipeline/.

local({
  withr::local_dir(file.path(pkgload::pkg_path(), "tests", "testthat"))
  for (helper in list.files(file.path(pkgload::pkg_path(), "tests", "testthat"), pattern = "^helper.*\\.R$", full.names = TRUE)) source(helper, local = environment())

ecrire_projet_vintages <- function(projet, horloge, payload, pipe) {
  dir.create(file.path(projet, "data", "raw"), recursive = TRUE, showWarnings = FALSE)
  writeLines(payload, file.path(projet, "payload.txt"))
  writeLines("[]", file.path(projet, "lock.json"))
  pipeline <- gsub("\\\\", "/", normalizePath(pipe))
  cible <- file.path(projet, "_targets.R")
  lignes <- c(
    "library(targets)",
    sprintf("if (!requireNamespace('lusk', quietly = TRUE)) pkgload::load_all('%s', quiet = TRUE)", pipeline),
    "tar_option_set(imports = 'lusk', trust_timestamps = FALSE, error = 'stop')",
    'CACHE <- "data/raw"',
    sprintf('HORLOGE <- "%s"', horloge),
    sprintf('LOCK <- "%s"', gsub("\\\\", "/", file.path(projet, "lock.json"))),
    sprintf('PAYLOAD <- "%s"', gsub("\\\\", "/", file.path(projet, "payload.txt"))),
    "MANIFESTE <- data.frame(",
    '  id = "korrigo_fixture", source = "Korrigo (fixture)",',
    '  url = "https://example.invalid/korrigo", fichier = "src.csv",',
    '  vintage = "2020-01", date_reference = "2020-01-01",',
    '  date_publication = "2020-01-01", licence = "lov2",',
    '  vintage_basis = "telechargement", stringsAsFactors = FALSE',
    ")",
    "tirer_fixture <- function(url, cible) {",
    "  file.copy(PAYLOAD, cible, overwrite = TRUE)",
    "  invisible(NULL)",
    "}",
    "list(",
    "  tar_target(sources_fixture, {",
    "    resoudre_source(",
    "      id = MANIFESTE$id, url = MANIFESTE$url, fichier = MANIFESTE$fichier,",
    "      cache = CACHE, vintage_basis = MANIFESTE$vintage_basis,",
    "      vintage_declare = MANIFESTE$vintage, horloge = HORLOGE,",
    "      tirer = tirer_fixture, lock = LOCK)",
    "  }),",
    "  tar_target(fichiers_fixture, {",
    "    sources_fixture",
    "    file.path(CACHE, MANIFESTE$fichier)",
    '  }, format = "file"),',
    "  tar_target(vintages_fixture, {",
    "    sources_fixture",
    "    fichiers_fixture",
    "    t <- vintages_depuis_manifest(MANIFESTE, cache = CACHE, lock = LOCK,",
    "                                  exiger_attestation = TRUE)",
    "    verifier_vintages_attestees(t, MANIFESTE, cache = CACHE, lock = LOCK)",
    "    t",
    "  })",
    ")"
  )
  writeLines(lignes, cible)
  invisible(projet)
}

test_that("fixture : les octets changent entre deux tar_make et la version publiée suit", {
  projet <- tempfile("vintages-fixture-")
  on.exit(unlink(projet, recursive = TRUE))
  pipe <- pkgload::pkg_path()
  ecrire_projet_vintages(projet, "2026-11-18", "octets-v1", pipe)

  withr::local_dir(projet)
  targets::tar_make(callr_function = NULL)
  v1 <- targets::tar_read(vintages_fixture)
  expect_equal(v1$version, "2026-11")
  expect_equal(v1$date_publication, "2026-11-18")

  # de nouveaux octets sont résolus à une autre date d'acquisition
  writeLines("octets-v2", file.path(projet, "payload.txt"))
  unlink(file.path(projet, "data", "raw", "src.csv"))
  # réécrire _targets.R avec la nouvelle horloge (le store est, lui, conservé)
  ecrire_projet_vintages(projet, "2026-12-20", "octets-v2", pipe)
  targets::tar_make(callr_function = NULL)
  v2 <- targets::tar_read(vintages_fixture)
  expect_equal(v2$version, "2026-12")
  expect_equal(v2$date_publication, "2026-12-20")
})

})
