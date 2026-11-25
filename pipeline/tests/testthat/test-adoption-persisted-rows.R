# Golden persisted-row contracts (#1142). The expected rows are LITERALS captured
# by running origin/main's PRE-REFACTOR writers on these fixtures; see the header of
# helper-golden-lignes-main.R for exactly how, and helper-golden-lignes-outils.R for
# the comparison tools and the columns that are not compared (and why). Nothing here
# derives `expected` from the new row builders, so the comparison is not circular: the
# refactor that extracted lignes_*_persistees() must persist what the old writers
# persisted. The dense AEDAR proof is slow-tier: slow-tests/test-adoption-aedar-golden-rows.R.
#
# INTENTIONAL differences from origin/main are not hidden: they are listed in
# `.differences_intentionnelles` and pinned by their own tests below.

.differences_intentionnelles <- list(
  scalar = list(), declared_profile = list(), owned_series = list(),
  # origin/main's collection adapter RE-COMPUTED the comparison with the whole
  # artefact version as its token; this branch persists the artefact's own recorded
  # comparison, bound to its collection_content_version (adaptateur_collection.R,
  # "ONE source of truth for the storage token"). Pinned below.
  observed_collection = list(
    observed_collection_comparison_group = "collection_content_version",
    observed_collection_comparison_territory = "collection_content_version",
    observed_collection_comparison_lineage = "comparison_content_version"))

test_that("the golden literals come from the pre-refactor writers, not from this branch", {
  expect_setequal(names(golden_lignes_main),
    c("scalar", "declared_profile", "owned_series", "observed_collection", "aedar"))
  # A frame can only be a golden literal if no row builder can have produced it:
  # the helper is plain data (no function) and is not generated at load time.
  expect_false(any(vapply(unlist(golden_lignes_main, recursive = FALSE), is.function, logical(1))))
})

test_that("refactor persists the rows the old scalar writer persisted", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  artefacts <- .artefacts_golden(root, "scalar")
  actual <- REGISTRE_FORMES_RESSOURCE$scalar$lignes_persistees(artefacts$scalar)
  .attendre_golden(actual, golden_lignes_main$scalar, .differences_intentionnelles$scalar)
})

test_that("refactor persists the rows the old declared-profile writer persisted", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  artefacts <- .artefacts_golden(root, "declared_profile")
  actual <- REGISTRE_FORMES_RESSOURCE$declared_profile$lignes_persistees(
    artefacts$declared_profile)
  .attendre_golden(actual, golden_lignes_main$declared_profile,
                   .differences_intentionnelles$declared_profile)
})

test_that("refactor persists the rows the old owned-series writer persisted", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  artefacts <- .artefacts_golden(root, "owned_series")
  actual <- REGISTRE_FORMES_RESSOURCE$owned_series$lignes_persistees(artefacts$owned_series)
  .attendre_golden(actual, golden_lignes_main$owned_series,
                   .differences_intentionnelles$owned_series)
})

test_that("refactor persists the rows the old observed-collection writer persisted", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  artefacts <- .artefacts_golden(root, "observed_collection")
  actual <- REGISTRE_FORMES_RESSOURCE$observed_collection$lignes_persistees(
    artefacts$observed_collection)
  .attendre_golden(actual, golden_lignes_main$observed_collection,
                   .differences_intentionnelles$observed_collection)
})

test_that("INTENTIONAL difference: collection comparison rows carry the artefact's own tokens", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  artefact <- .artefacts_golden(root, "observed_collection")$observed_collection
  comparison <- artefact$contenu$comparison
  actual <- REGISTRE_FORMES_RESSOURCE$observed_collection$lignes_persistees(artefact)
  jeton <- as.character(comparison$collection_content_version)
  expect_length(jeton, 1L)
  expect_identical(unique(as.character(
    actual$observed_collection_comparison_group$collection_content_version)), jeton)
  expect_identical(unique(as.character(
    actual$observed_collection_comparison_territory$collection_content_version)), jeton)
  expect_identical(unique(as.character(
    actual$observed_collection_comparison_lineage$comparison_content_version)),
    scalar_content_version(comparison))
  # What origin/main did instead, recorded in the golden literals: it bound the
  # rows to the WHOLE artefact version (which also hashes the comparison itself).
  groupe <- golden_lignes_main$observed_collection$observed_collection_comparison_group
  expect_identical(unique(as.character(groupe$collection_content_version)),
                   as.character(artefact$version))
  expect_false(identical(jeton, as.character(artefact$version)))
})

test_that("absent comparison_levels and a missing comparison persist as origin/main did; all-NA is pinned as a builder-only case", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  serie <- .artefacts_golden(root, "owned_series")$owned_series
  rows <- projeter_artefact_series(serie)
  # origin/main: `if (!is.null(d$comparison_levels)) UPDATE ... comparison_levels`,
  # and the comparison tables only written when comparison_levels is not NULL. A
  # descriptor without levels therefore persists NO comparison row and a NULL level
  # set (litteral_tableau_postgres(NULL/NA) is SQL NULL, never '{}').
  sans_niveaux <- rows
  sans_niveaux$projection$descriptor$comparison_levels <- NULL
  sans_niveaux$comparison <- list(reference_content_version = "reference-v1",
                                  kind = "owned_series")
  lignes <- .lignes_series_projection(sans_niveaux)
  expect_true(is.na(lignes$series_dataset_descriptor$comparison_levels))
  for (table in c("ordered_series_comparison_group", "ordered_series_comparison_territory",
                  "ordered_series_comparison_lineage", "ordered_series_comparison_zero_reason"))
    expect_identical(nrow(lignes[[table]]), 0L, info = table)
  # An all-NA level vector: origin/main's writer REFUSES it ("Owned series comparison
  # levels must be a declared subset of focal levels", checked by running main's
  # remplacer_series with NA, c(NA, NA) and character()), so there is no old row set
  # to preserve. The row builder only describes rows and spells it as SQL NULL, never
  # an empty '{}' array; adoption then compares NULL to the live NULL.
  tout_na <- rows
  tout_na$projection$descriptor$comparison_levels <- c(NA_character_, NA_character_)
  expect_true(is.na(.lignes_series_projection(tout_na)$series_dataset_descriptor$comparison_levels))
})
