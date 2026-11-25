# Golden persisted-row contracts (#1142). The expected rows are LITERALS captured
# by running origin/main's PRE-REFACTOR writers on these fixtures; see the header of
# helper-golden-lignes-main.R for exactly how. Nothing here derives `expected`
# from the new row builders, so the comparison is not circular: the refactor that
# extracted lignes_*_persistees() must persist what the old writers persisted.
#
# Columns that are NOT compared, and why (each is also stated in the PR):
#   * scalar_observation.published_at : write-time stamp (now()), storage-only.
#   * source_dataset.name             : shared last-writer-wins label, storage-only
#                                       (STOCKAGE_SOURCE_DATASET_NAME).
# INTENTIONAL differences from origin/main are not hidden: they are listed in
# `.differences_intentionnelles` and pinned by their own tests below.

.lignes_canoniques <- function(df) {
  cell <- function(x) {
    if (inherits(x, "Date")) x <- as.character(x)
    if (is.numeric(x)) return(ifelse(is.na(x), "<NA>", sprintf("%.15g", x)))
    ifelse(is.na(x), "<NA>", as.character(x))
  }
  cols <- sort(names(df))
  sort(do.call(paste, c(lapply(cols, function(c) cell(df[[c]])), sep = "\x1f")),
       method = "radix")
}

.digest_lignes <- function(df) {
  paste(as.character(openssl::sha256(charToRaw(paste(
    c(paste(sort(names(df)), collapse = ","), .lignes_canoniques(df)), collapse = "\n")))),
    collapse = "")
}

.golden_ignore <- list(scalar_observation = "published_at", source_dataset = "name")

# Columns the OLD writers never sent and PostgreSQL filled with the schema default
# (api/schema.sql). The new builders spell them out, because adoption compares full
# live rows; the golden gets the very same default, with the schema line as evidence.
.defauts_bd <- list(
  profile_observation = list(detail_axis_name = "detail"),            # schema.sql:46 DEFAULT 'detail'
  series_dataset_descriptor = list(absence_semantics = "unavailable"), # schema.sql:472 DEFAULT 'unavailable'
  series_dataset_observation = list(state_role = NA_character_,        # schema.sql:507 nullable, no default
                                    missing_reason = NA_character_),   # schema.sql:509 nullable, no default
  observed_collection_category = list(anchor_levels = NA_character_,   # schema.sql:917 nullable
                                      rider_label = NA_character_,     # schema.sql:917 nullable
                                      clock_policy = "dataset"))       # schema.sql:918 DEFAULT 'dataset'

.avec_defauts_bd <- function(golden, table) {
  for (colonne in setdiff(names(.defauts_bd[[table]]), names(golden)))
    golden[[colonne]] <- rep(.defauts_bd[[table]][[colonne]], nrow(golden))
  golden
}

# Compare one table of the new builder against the golden literal, column by column
# so a failure names the column.
.attendre_table_golden <- function(actual, golden, table, ignore = character()) {
  golden <- .avec_defauts_bd(golden, table)
  ignore <- unique(c(ignore, .golden_ignore[[table]]))
  colonnes <- setdiff(union(names(actual), names(golden)), ignore)
  expect_setequal(setdiff(names(actual), ignore), setdiff(names(golden), ignore))
  commun <- intersect(colonnes, intersect(names(actual), names(golden)))
  expect_identical(nrow(actual), nrow(golden), info = table)
  a <- normaliser_adoption(actual[commun]); g <- normaliser_adoption(golden[commun])
  for (colonne in commun)
    expect_identical(a[[colonne]], g[[colonne]], info = paste(table, colonne))
}

.attendre_golden <- function(actual, golden, ignorer = list()) {
  for (table in names(golden))
    .attendre_table_golden(actual[[table]], golden[[table]], table, ignorer[[table]])
  # Anything the builder produces beyond the golden tables must be an empty table.
  for (table in setdiff(names(actual), names(golden)))
    expect_identical(nrow(actual[[table]]), 0L, info = paste("extra table", table))
}

.artefacts_golden <- function(root) {
  reference <- artefacts_fixture_reference()
  projection <- artefacts_fixture_scalar_indicator("a", "src_a",
    c(10, 10, 5, 3, NA, 100, 50, 8, 8, 30))
  comparison <- comparaison_scalaire_ressource(projection, "a", reference)
  contenu <- contenu_artefact(faits_forme(REGISTRE_FORMES_RESSOURCE[["scalar"]], projection),
    projection$descriptors, projection$provenance, comparison)
  ecrit <- ecrire_artefact_ressource("a", "scalar", contenu, root = root)
  scalaire <- artefacts_fixture_scalar_indicator("part_passoires", "dpe_22",
    c(10, 10, 5, 3, NA, 100, 50, 8, 8, 30))
  faits_attendus <- version_faits_ressource(REGISTRE_FORMES_RESSOURCE[["scalar"]], scalaire)
  list(scalar = lire_artefact_ressource("a", ecrit$version, root = root),
    declared_profile = artefacts_fixture_profile_artefact(root = root,
      required_scalar_version = faits_attendus)$artefact,
    owned_series = adaptateur_series_artefact(root),
    observed_collection = adaptateur_collection_artefact(root),
    aedar = adaptateur_aedar_artefact(root))
}

# Differences from origin/main that are INTENTIONAL (table -> columns), each pinned
# by a dedicated test below. Empty means: byte-for-byte what the old writers wrote.
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
  artefacts <- .artefacts_golden(root)
  actual <- REGISTRE_FORMES_RESSOURCE$scalar$lignes_persistees(artefacts$scalar)
  .attendre_golden(actual, golden_lignes_main$scalar, .differences_intentionnelles$scalar)
})

test_that("refactor persists the rows the old declared-profile writer persisted", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  artefacts <- .artefacts_golden(root)
  actual <- REGISTRE_FORMES_RESSOURCE$declared_profile$lignes_persistees(
    artefacts$declared_profile)
  .attendre_golden(actual, golden_lignes_main$declared_profile,
                   .differences_intentionnelles$declared_profile)
})

test_that("refactor persists the rows the old owned-series writer persisted", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  artefacts <- .artefacts_golden(root)
  actual <- REGISTRE_FORMES_RESSOURCE$owned_series$lignes_persistees(artefacts$owned_series)
  .attendre_golden(actual, golden_lignes_main$owned_series,
                   .differences_intentionnelles$owned_series)
})

test_that("refactor persists the rows the old observed-collection writer persisted", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  artefacts <- .artefacts_golden(root)
  actual <- REGISTRE_FORMES_RESSOURCE$observed_collection$lignes_persistees(
    artefacts$observed_collection)
  .attendre_golden(actual, golden_lignes_main$observed_collection,
                   .differences_intentionnelles$observed_collection)
})

test_that("INTENTIONAL difference: collection comparison rows carry the artefact's own tokens", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  artefact <- .artefacts_golden(root)$observed_collection
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
  serie <- adaptateur_series_artefact(root)
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

test_that("refactor persists the rows the old AEDAR writers persisted", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  actual <- lignes_aedar_persistees(.artefacts_golden(root)$aedar)
  small <- golden_lignes_main$aedar
  # comparison_content_version / aedar_content_version are md5 hashes recorded in
  # the ARTEFACT (an input, not a builder output) and they are not stable across R
  # sessions (the same fixture hashes differently under testthat and under Rscript),
  # so they cannot be pinned as literals. They are pinned by relation instead: the old
  # writer copied the artefact comparison's own tokens onto every summary row.
  for (table in names(small))
    .attendre_table_golden(actual[[table]], small[[table]], table,
      if (identical(table, "aedar_density_class_summary"))
        c("comparison_content_version", "aedar_content_version") else character())
  comparaison <- .artefacts_golden(root)$aedar$contenu$comparison
  densite <- actual$aedar_density_class_summary
  expect_identical(unique(as.character(densite$comparison_content_version)),
                   as.character(comparaison$content_version))
  expect_identical(unique(as.character(densite$aedar_content_version)),
                   as.character(comparaison$aedar_content_version))
  for (table in names(golden_aedar_volumineux)) {
    pin <- golden_aedar_volumineux[[table]]
    x <- actual[[table]]
    expect_identical(nrow(x), pin$rows, info = table)
    expect_identical(sort(names(x)), pin$columns, info = table)
    expect_identical(.digest_lignes(x), pin$digest, info = table)
    # Two rows of the same table, literally, for a readable failure.
    expect_true(all(.lignes_canoniques(pin$head) %in% .lignes_canoniques(x)), info = table)
  }
  # Every table the builder returns is covered by one of the two pins.
  couvertes <- c(names(small), names(golden_aedar_volumineux))
  for (table in setdiff(names(actual), couvertes))
    expect_identical(nrow(actual[[table]]), 0L, info = paste("extra table", table))
})
