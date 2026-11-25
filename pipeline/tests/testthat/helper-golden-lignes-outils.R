# Shared tools of the golden persisted-row proofs (#1142): the default-suite test
# (test-adoption-persisted-rows.R) and the slow-tier AEDAR proof
# (slow-tests/test-adoption-aedar-golden-rows.R). The golden LITERALS themselves live
# in helper-golden-lignes-main.R (captured from origin/main's pre-refactor writers).

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

# Columns that are NOT compared against the golden, and why (also stated in the PR):
#   * scalar_observation.published_at : write-time stamp (now()), storage-only.
#   * source_dataset.name             : shared last-writer-wins label, storage-only
#                                       (STOCKAGE_SOURCE_DATASET_NAME).
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
  testthat::expect_setequal(setdiff(names(actual), ignore), setdiff(names(golden), ignore))
  commun <- intersect(colonnes, intersect(names(actual), names(golden)))
  testthat::expect_identical(nrow(actual), nrow(golden), info = table)
  a <- normaliser_adoption(actual[commun]); g <- normaliser_adoption(golden[commun])
  for (colonne in commun)
    testthat::expect_identical(a[[colonne]], g[[colonne]], info = paste(table, colonne))
}

.attendre_golden <- function(actual, golden, ignorer = list()) {
  for (table in names(golden))
    .attendre_table_golden(actual[[table]], golden[[table]], table, ignorer[[table]])
  # Anything the builder produces beyond the golden tables must be an empty table.
  for (table in setdiff(names(actual), names(golden)))
    testthat::expect_identical(nrow(actual[[table]]), 0L, info = paste("extra table", table))
}

# The fixtures the golden literals were captured on, built ONLY for the shapes asked
# (the dense AEDAR one costs ~15 s and belongs to the slow tier).
.artefacts_golden <- function(root, formes = c("scalar", "declared_profile", "owned_series",
                                               "observed_collection")) {
  reference <- artefacts_fixture_reference()
  out <- list()
  if ("scalar" %in% formes) {
    projection <- artefacts_fixture_scalar_indicator("a", "src_a",
      c(10, 10, 5, 3, NA, 100, 50, 8, 8, 30))
    comparison <- comparaison_scalaire_ressource(projection, "a", reference)
    contenu <- contenu_artefact(faits_forme(REGISTRE_FORMES_RESSOURCE[["scalar"]], projection),
      projection$descriptors, projection$provenance, comparison)
    ecrit <- ecrire_artefact_ressource("a", "scalar", contenu, root = root)
    out$scalar <- lire_artefact_ressource("a", ecrit$version, root = root)
  }
  if ("declared_profile" %in% formes) {
    scalaire <- artefacts_fixture_scalar_indicator("part_passoires", "dpe_22",
      c(10, 10, 5, 3, NA, 100, 50, 8, 8, 30))
    faits_attendus <- version_faits_ressource(REGISTRE_FORMES_RESSOURCE[["scalar"]], scalaire)
    out$declared_profile <- artefacts_fixture_profile_artefact(root = root,
      required_scalar_version = faits_attendus)$artefact
  }
  if ("owned_series" %in% formes) out$owned_series <- adaptateur_series_artefact(root)
  if ("observed_collection" %in% formes)
    out$observed_collection <- adaptateur_collection_artefact(root)
  if ("aedar" %in% formes) out$aedar <- adaptateur_aedar_artefact(root)
  out
}
