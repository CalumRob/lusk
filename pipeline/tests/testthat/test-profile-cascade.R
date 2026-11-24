# Cascade at the apply seam (#1138): applying part_passoires republishes the
# DPE declared profile in the SAME transaction; applying an unrelated scalar or
# an independent profile never touches the other shape. The registry adapter
# fields are spied here — the real SQL is exercised in test-adaptateur-profil.R.

fixture_cascade_magasin <- function(root) {
  projection <- artefacts_fixture_scalar_indicator(
    "part_passoires", "dpe_22", c(10, 10, 5, 3, NA, 100, 50, 8, 8, 30))
  reference <- artefacts_fixture_reference()
  handler <- REGISTRE_FORMES_RESSOURCE[["scalar"]]
  comparaison <- comparaison_scalaire_ressource(projection, "part_passoires", reference)
  contenu <- contenu_artefact(faits_forme(handler, projection), projection$descriptors,
                              projection$provenance, comparaison)
  digests <- artefacts_fixture_digests("dpe_22")
  scalar <- ecrire_artefact_ressource("part_passoires", "scalar", contenu,
    digests_lignage = digests_lignage_ressource("dpe_22", digests), root = root)
  # The profile records, at build time, the FACTS version of the dependency.
  faits_part <- version_faits_ressource(handler, projection)
  profil <- artefacts_fixture_profile_artefact(root = root,
    comparison_scalar = "part_passoires", required_scalar_version = faits_part)
  list(
    builds = data.frame(ressource = c("part_passoires", "distribution_dpe"),
      forme = c("scalar", "declared_profile"),
      version = c(scalar$version, profil$version), stringsAsFactors = FALSE),
    lock = c(stats::setNames(list(list(sha256 = "sha256-dpe_22",
      acquired_at = "2026-01-01")), "dpe_22"), profil$lock),
    faits_part = faits_part,
    versions = c(part_passoires = scalar$version, distribution_dpe = profil$version))
}

fixture_cascade_apply <- function(root, ids, magasin) {
  appels <- list(); transactions <- 0L
  registry <- REGISTRE_FORMES_RESSOURCE
  registry$scalar$remplacer <- function(con, ressource, rows, version, ..., artefacts = NULL) {
    appels[[length(appels) + 1L]] <<- list(forme = "scalar", ressource = ressource,
      version = version, artefacts = artefacts)
    invisible(NULL)
  }
  registry$declared_profile$remplacer <- function(con, ressource, rows, version, ..., artefacts = NULL) {
    appels[[length(appels) + 1L]] <<- list(forme = "declared_profile", ressource = ressource,
      version = version, artefacts = artefacts)
    invisible(NULL)
  }
  local_mocked_bindings(
    lire_listing_live_registre = function(con) data.frame(ressource = character(),
      version = character()),
    ecrire_recette_ressource = function(...) invisible(TRUE),
    ecrire_recette_locale = function(recette, dir = NULL) "x.json",
    REGISTRE_FORMES_RESSOURCE = registry)
  local_mocked_bindings(
    dbWithTransaction = function(con, expr) { transactions <<- transactions + 1L; force(expr) },
    dbExecute = function(con, sql, params = list()) 1L,
    dbGetQuery = function(con, sql, params = list()) {
      if (grepl("table_publication WHERE table_name='territory_reference'", sql, fixed = TRUE))
        return(data.frame(content_version = "reference-v1"))
      data.frame()
    }, .package = "DBI")
  resultat <- apply_publication(ids, root = root, registre = magasin$lock,
                                con = structure(list(), class = "mock"))
  list(appels = appels, transactions = transactions, resultat = resultat)
}

test_that("apply part_passoires cascades to the DPE profile in ONE transaction", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  magasin <- fixture_cascade_magasin(root)
  r <- fixture_cascade_apply(root, "part_passoires", magasin)
  expect_identical(r$transactions, 1L)
  expect_identical(vapply(r$appels, `[[`, character(1), "ressource"),
                   c("part_passoires", "distribution_dpe"))
  expect_identical(r$resultat$cascade, c("part_passoires", "distribution_dpe"))
  # The profile adapter receives the dependency's ARTEFACT in the closure and
  # verifies its FACTS version against the token recorded at build time (the
  # actual comparison/verification is proven in test-adaptateur-profil.R).
  profil <- Filter(function(a) identical(a$forme, "declared_profile"), r$appels)[[1L]]
  expect_identical(version_faits_artefact(profil$artefacts$part_passoires),
                   magasin$faits_part)
})

test_that("applying an independent scalar never touches the DPE profile", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  magasin <- fixture_cascade_magasin(root)
  # A second scalar with no dependent profile.
  projection <- artefacts_fixture_scalar_indicator("densite", "census_densite", rep(1L, 10))
  handler <- REGISTRE_FORMES_RESSOURCE[["scalar"]]
  contenu <- contenu_artefact(faits_forme(handler, projection), projection$descriptors,
                              projection$provenance, NULL)
  ecrire_artefact_ressource("densite", "scalar", contenu,
    digests_lignage = digests_lignage_ressource("census_densite",
      artefacts_fixture_digests("census_densite")), root = root)
  magasin$lock <- c(magasin$lock, stats::setNames(list(list(sha256 = "sha256-census_densite",
    acquired_at = "2026-01-01")), "census_densite"))
  r <- fixture_cascade_apply(root, "densite", magasin)
  expect_identical(vapply(r$appels, `[[`, character(1), "ressource"), "densite")
  expect_false(any(vapply(r$appels, `[[`, character(1), "forme") == "declared_profile"))
})

test_that("splitter records the dependency facts version at build time", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  scalaire <- artefacts_fixture_scalar_indicator(
    "part_passoires", "dpe_22", c(10, 10, 5, 3, NA, 100, 50, 8, 8, 30))
  profils <- artefacts_fixture_profile_projections()
  # DPE is scalar-backed: no profile comparison object of its own.
  profils$distribution_dpe$comparison <- NULL
  projections <- list(scalar = list(part_passoires = scalaire),
                      declared_profile = profils)
  handler <- REGISTRE_FORMES_RESSOURCE[["scalar"]]
  attendu <- version_faits_ressource(handler, scalaire)
  resultat <- splitter_sortie(tempdir(), root = root, projections = projections,
    reference = artefacts_fixture_reference(), digests = artefacts_fixture_all_digests())
  version <- resultat$version[resultat$ressource == "distribution_dpe"]
  artefact <- lire_artefact_ressource("distribution_dpe", version, root = root)
  expect_identical(artefact$contenu$descriptor$required_scalar_version, attendu)
  expect_false(identical(artefact$contenu$descriptor$required_scalar_version,
                         "part-passoires-v1"))
  expect_false(identical(artefact$version, attendu))  # artefact ≠ facts version
})

test_that("applying a profile with no scalar dependency touches only that profile", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  profil <- artefacts_fixture_profile_artefact(root = root, owner = "reseaux",
    comparison_scalar = NULL, required_scalar_version = NULL)
  r <- fixture_cascade_apply(root, "reseaux",
    list(lock = profil$lock, versions = c(reseaux = profil$version)))
  expect_identical(vapply(r$appels, `[[`, character(1), "ressource"), "reseaux")
  expect_identical(vapply(r$appels, `[[`, character(1), "forme"), "declared_profile")
  expect_identical(r$transactions, 1L)
})
