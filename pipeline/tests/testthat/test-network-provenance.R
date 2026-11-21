# Lectures réseau et provenance (issue #1103, revue) -----------------------------
# Toute lecture réseau est couverte par un digest déclaré ou explicitement
# autorisée. Les couches WFS du fond de carte entrent dans la couverture et le
# gel ; les acquisitions AEDAR sont un périmètre séparé, autorisé avec raison.

test_that("toute lecture réseau est couverte ou autorisée", {
  racine <- normalizePath(testthat::test_path("..", ".."))
  sites <- auditer_appels_reseau(racine)
  expect_true(nrow(sites) > 0L)
  expect_equal(nrow(sites[!sites$autorise, , drop = FALSE]), 0L)
  expect_false(any(sites$autorise & !nzchar(sites$raison)))
  # Les trois couches WFS sont couvertes, pas seulement autorisées.
  geom <- sites[grepl("geometrie\\.R", sites$fichier) & sites$source != "", ]
  expect_true(nrow(geom) > 0L)
  expect_true(all(geom$couvert))
})

test_that("l'audit réseau échoue sur une lecture non déclarée (preuve)", {
  d <- tempfile("audit-reseau-")
  dir.create(file.path(d, "R"), recursive = TRUE)
  writeLines(c("foo <- function() {", "  httr2::req_perform(httr2::request('https://x'))", "}"),
             file.path(d, "R", "new-read.R"))
  sites <- auditer_appels_reseau(d)
  expect_true(any(grepl("new-read\\.R", sites$fichier)))
  expect_error(verifier_structure_reseau(d), "undeclared network read")
})

test_that("publier_geometrie enregistre une empreinte par couche WFS", {
  sortie <- tempfile("sortie-geom-")
  dir.create(sortie)
  on.exit(unlink(sortie, recursive = TRUE))
  sain <- fixture_geometrie_wfs_saine()
  publier_geometrie(sortie, fetch = function(niveau) sain[[niveau]],
                    horloge = as.Date("2026-11-18"))

  digests <- lire_digests_source(file.path(sortie, NOM_DIGESTS))
  ids <- paste0("geometrie_", names(NIVEAUX_GEOMETRIE))
  expect_setequal(names(digests), ids)
  for (id in ids) {
    expect_identical(digests[[id]]$vintage_basis, "telechargement")
    expect_identical(digests[[id]]$acquired_at, "2026-11-18")
    expect_true(grepl("^[0-9a-f]{64}$", digests[[id]]$sha256))
  }
  expect_true(isTRUE(verifier_digests_couvrent_lectures_reseau(digests)))
})

test_that("le gel refuse une empreinte de géométrie sans référence au lock", {
  sortie <- tempfile("sortie-geom-gel-")
  dir.create(sortie)
  on.exit(unlink(sortie, recursive = TRUE))
  sain <- fixture_geometrie_wfs_saine()
  publier_geometrie(sortie, fetch = function(niveau) sain[[niveau]],
                    horloge = as.Date("2026-11-18"))
  erreur <- tryCatch(verifier_gel_release(sortie), error = function(e) e)
  expect_s3_class(erreur, "erreur_gel_release")
  expect_identical(erreur$raison, "sans_reference")
})
