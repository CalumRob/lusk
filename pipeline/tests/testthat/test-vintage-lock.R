# Vintage publié et lockfile (issue #1103) --------------------------------------
# La table publiée porte le vintage DÉRIVÉ de chaque source. Quand les octets
# du run égalent le lockfile, la valeur vient du lockfile (déterministe).
# Les sources millésimées gardent leur vintage déclaré, à l'identique.

cache_vide <- function() tempfile("cache-vintage-")

digest_fixture <- function(id, sha, vintage, reference, acquired, base = "telechargement") {
  list(
    source_id = id, url = "https://example.invalid/x", sha256 = sha,
    bytes = 10, acquired_at = acquired, vintage_basis = base,
    vintage = vintage, date_reference = reference
  )
}

# Un sidecar n'est cru que s'il décrit les octets actuellement dans le cache.
ecrire_digest_manifest <- function(cache, manifest, d, contenu = charToRaw("fixture\n")) {
  dir.create(cache, recursive = TRUE, showWarnings = FALSE)
  f <- manifest$fichier[[1L]]
  cible <- file.path(cache, f)
  writeBin(contenu, cible)
  Sys.setFileTime(cible, as.POSIXct("2026-11-18T12:00:00", tz = "UTC"))
  d$fichier <- f
  d$bytes <- length(contenu)
  d$mtime <- as.numeric(file.mtime(cible))
  ecrire_digest_cache(d, cache)
  invisible(d)
}

test_that("des octets verrouillés publient le vintage du lockfile", {
  cache <- cache_vide()
  d <- digest_fixture("osm_reseaux", "abc", "2026-11", "2026-11-16", "2026-11-18",
                      "contenu_timestamp")
  ecrire_digest_manifest(cache, MANIFEST_MOBILITE_OSM_RESEAUX, d)
  l <- lire_lock()  # le lockfile commité porte exactement ces octets ? non :
  # on injecte un lock dont le sha correspond au digest du run.
  l$osm_reseaux$sha256 <- "abc"
  p <- tempfile("lock-vintage-")
  ecrire_lock(l, p)
  v <- vintages_depuis_manifest(MANIFEST_MOBILITE_OSM_RESEAUX, cache = cache, lock = p)
  expect_equal(v$version, "2026-11")
  expect_equal(v$date_reference, "2026-11-16")
  expect_equal(v$date_publication, "2026-11-18")
})

test_that("sans verrou mais avec digest, le vintage publié vient du run", {
  cache <- cache_vide()
  d <- digest_fixture("korrigo", "digest-korrigo", "2027-02", "2027-02-04",
                      "2027-02-04")
  ecrire_digest_manifest(cache, MANIFEST_MOBILITE_KORRIGO, d)
  v <- vintages_depuis_manifest(MANIFEST_MOBILITE_KORRIGO, cache = cache,
                                lock = tempfile("lock-vide-"))
  expect_equal(v$version, "2027-02")
  expect_equal(v$date_reference, "2027-02-04")
  expect_equal(v$date_publication, "2027-02-04")
})

test_that("les publications millésimées gardent leur vintage exact", {
  cache <- cache_vide()
  # RP 2023
  v <- vintages_depuis_manifest(MANIFEST_ECONOMIE_RP, cache = cache)
  expect_equal(v$version, "2023")
  expect_equal(v$date_reference, "2023-01-01")
  # DVF 2025 (le millésime est dans l'URL, pas l'horloge)
  vdvf <- vintages_depuis_manifest(MANIFEST_HABITAT_DVF, cache = cache)
  expect_equal(vdvf$version[vdvf$id == "dvf_2025_dep22"], "2025")
  expect_equal(vdvf$version[vdvf$id == "dvf_2021_dep56"], "2021")
  expect_equal(vdvf$date_reference[vdvf$id == "dvf_2025_dep22"], "2025-12-31")
  # BPE 2025
  vbpe <- vintages_depuis_manifest(MANIFEST_MOBILITE_BPE_B316, cache = cache)
  expect_equal(vbpe$version, "2025")
  # OCS-GE : toutes les années de état restent millésimées
  vocs <- vintages_depuis_manifest(MANIFEST_MILIEUX_OCSGE, cache = cache)
  expect_equal(vocs$version, MANIFEST_MILIEUX_OCSGE$vintage)
})

test_that("aucune source telechargement ne publie un littéral de manifeste", {
  cache <- cache_vide()
  # Korrigo : le manifeste dit 2026-08, le run (digest) dit 2027-02.
  d <- digest_fixture("korrigo", "digest-k", "2027-02", "2027-02-04", "2027-02-04")
  ecrire_digest_manifest(cache, MANIFEST_MOBILITE_KORRIGO, d)
  v <- vintages_depuis_manifest(MANIFEST_MOBILITE_KORRIGO, cache = cache,
                                lock = tempfile("lock-vide-"))
  expect_false(identical(v$version, MANIFEST_MOBILITE_KORRIGO$vintage))
  expect_equal(v$version, "2027-02")
})

test_that("le paramètre cache pilote réellement la dérivation", {
  c1 <- cache_vide()
  c2 <- cache_vide()
  ecrire_digest_manifest(
    c1, MANIFEST_MOBILITE_KORRIGO,
    digest_fixture("korrigo", "a", "2026-06", "2026-06-01", "2026-06-01"))
  ecrire_digest_manifest(
    c2, MANIFEST_MOBILITE_KORRIGO,
    digest_fixture("korrigo", "b", "2027-06", "2027-06-01", "2027-06-01"))
  lock_vide <- tempfile("lock-vide-")
  v1 <- vintages_depuis_manifest(MANIFEST_MOBILITE_KORRIGO, cache = c1, lock = lock_vide)
  v2 <- vintages_depuis_manifest(MANIFEST_MOBILITE_KORRIGO, cache = c2, lock = lock_vide)
  expect_false(identical(v1$version, v2$version))
})
