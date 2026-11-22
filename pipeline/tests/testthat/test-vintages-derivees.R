# Vintages dérivées — fail closed et format (issue #1114) -----------------------
# La table publiée ne doit JAMAIS porter le littéral d'un manifeste pour une
# source à base dérivée : sans attestation (lockfile ou sidecar valide) on échoue
# bruyamment en mode run, et toute base dérivée publie `version = YYYY-MM`.
# Hors run (appel direct d'un builder de thème, fixtures), le vintage déclaré
# reste — ADR-0048 : aucun run n'atteste d'acquisition, on n'en invente pas.

manifest_telechargement_fixture <- function(vintage = "2026-08") {
  tibble::tibble(
    id = "korrigo_fixture", source = "Korrigo (fixture)",
    url = "https://example.invalid/korrigo", fichier = "korrigo_fixture.csv",
    vintage = vintage, date_reference = "2026-08-25",
    date_publication = "2026-08-25", licence = "lov2",
    vintage_basis = "telechargement"
  )
}

test_that("une source dérivée sans lock ni sidecar échoue en mode run (erreur nommée)", {
  cache <- tempfile("cache-sans-attestation-")
  dir.create(cache, recursive = TRUE)
  on.exit(unlink(cache, recursive = TRUE))
  lock_vide <- tempfile("lock-vide-")
  m <- manifest_telechargement_fixture()

  err <- expect_error(
    vintages_depuis_manifest(m, cache = cache, lock = lock_vide,
                             exiger_attestation = TRUE),
    class = "erreur_vintage_non_attestee"
  )
  expect_match(conditionMessage(err), "korrigo_fixture", fixed = TRUE)
})

test_that("hors run, une source dérivée sans attestation garde son vintage déclaré (ADR-0048)", {
  cache <- tempfile("cache-hors-run-")
  dir.create(cache, recursive = TRUE)
  on.exit(unlink(cache, recursive = TRUE))
  m <- manifest_telechargement_fixture()

  v <- vintages_depuis_manifest(m, cache = cache, lock = tempfile("lock-vide-"))
  expect_equal(v$version, "2026-08")
})

test_that("une source declaree garde son vintage déclaré même en fail-closed", {
  cache <- tempfile("cache-declaree-")
  dir.create(cache, recursive = TRUE)
  on.exit(unlink(cache, recursive = TRUE))
  m <- manifest_telechargement_fixture(vintage = "2023")
  m$vintage_basis <- "declaree"

  v <- vintages_depuis_manifest(m, cache = cache, lock = tempfile("lock-vide-"),
                                exiger_attestation = TRUE)
  expect_equal(v$version, "2023")
})

test_that("un sidecar valide atteste la source : le vintage dérivé est publié en YYYY-MM", {
  cache <- tempfile("cache-atteste-")
  dir.create(cache, recursive = TRUE)
  on.exit(unlink(cache, recursive = TRUE))
  m <- manifest_telechargement_fixture()

  cible <- file.path(cache, m$fichier[[1L]])
  writeBin(charToRaw("octets du run\n"), cible)
  Sys.setFileTime(cible, as.POSIXct("2026-11-18T12:00:00", tz = "UTC"))
  ecrire_digest_cache(list(
    source_id = m$id[[1L]], url = m$url[[1L]], sha256 = "abc",
    bytes = file.size(cible), fichier = m$fichier[[1L]],
    mtime = as.numeric(file.mtime(cible)), acquired_at = "2026-11-18",
    vintage_basis = "telechargement", vintage = "2026-11",
    date_reference = NA_character_
  ), cache)

  v <- vintages_depuis_manifest(m, cache = cache, lock = tempfile("lock-vide-"),
                                exiger_attestation = TRUE)
  expect_equal(v$version, "2026-11")
  expect_equal(v$date_publication, "2026-11-18")
  expect_true(is.na(v$date_reference))
  expect_true(grepl("^\\d{4}-\\d{2}$", v$version))
})

test_that("verifier_vintages_attestees : une table dont le vintage dérivé n'est pas YYYY-MM échoue", {
  cache <- tempfile("cache-format-")
  dir.create(cache, recursive = TRUE)
  on.exit(unlink(cache, recursive = TRUE))
  m <- manifest_telechargement_fixture()

  # une attestation VALIDE, mais qui porte un jour au lieu d'un mois — le garde
  # de format doit rejeter la table publiée
  cible <- file.path(cache, m$fichier[[1L]])
  writeBin(charToRaw("octets\n"), cible)
  Sys.setFileTime(cible, as.POSIXct("2026-08-25T12:00:00", tz = "UTC"))
  ecrire_digest_cache(list(
    source_id = m$id[[1L]], url = m$url[[1L]], sha256 = "abc",
    bytes = file.size(cible), fichier = m$fichier[[1L]],
    mtime = as.numeric(file.mtime(cible)), acquired_at = "2026-08-25",
    vintage_basis = "telechargement", vintage = "2026-08-25",
    date_reference = NA_character_
  ), cache)
  lock_vide <- tempfile("lock-vide-")

  v <- vintages_depuis_manifest(m, cache = cache, lock = lock_vide)
  expect_equal(v$version, "2026-08-25")  # ce que le bug publierait

  err <- expect_error(
    verifier_vintages_attestees(v, m, cache = cache, lock = lock_vide),
    class = "erreur_format_vintage"
  )
  expect_match(conditionMessage(err), "korrigo_fixture", fixed = TRUE)
})
