# Guarded end-to-end `apply` proof on the operator-owned lusk_it_contract
# database (#1137). NEVER connects to the serving database `lusk`. Skips before
# any connection unless the documented test-only DSNs and private passfile are
# present. Creates ONE random private schema, applies fresh api/schema.sql
# (which carries migration 046 parity) and always drops only that schema.

.guarded_apply_config <- function() {
  required <- c("LUSK_SCALAR_TEST_HOST", "LUSK_SCALAR_TEST_DATABASE",
                "LUSK_SCALAR_TEST_USER", "PGPASSFILE")
  env <- Sys.getenv(required, unset = "")
  if (any(!nzchar(env)) || !file.exists(Sys.getenv("PGPASSFILE", unset = "")) ||
      Sys.getenv("LUSK_SCALAR_TEST_DATABASE", unset = "") != "lusk_it_contract" ||
      !startsWith(Sys.getenv("LUSK_SCALAR_TEST_DATABASE", unset = ""), "lusk_it_") ||
      identical(Sys.getenv("LUSK_SCALAR_TEST_DATABASE", unset = ""), "lusk"))
    testthat::skip("guarded apply proof requires explicit lusk_it_* DSNs and private PGPASSFILE")
  if (Sys.getenv("LUSK_SCALAR_TEST_CLEANUP", unset = "") != "1")
    testthat::skip("set LUSK_SCALAR_TEST_CLEANUP=1 for the non-retained apply proof")
  list(host = env[["LUSK_SCALAR_TEST_HOST"]],
       port = suppressWarnings(as.integer(Sys.getenv("LUSK_SCALAR_TEST_PORT", "5432"))),
       dbname = env[["LUSK_SCALAR_TEST_DATABASE"]],
       user = env[["LUSK_SCALAR_TEST_USER"]],
       passfile = normalizePath(Sys.getenv("PGPASSFILE"), winslash = "/", mustWork = TRUE))
}

.guarded_apply_connect <- function() {
  cfg <- .guarded_apply_config()
  con <- DBI::dbConnect(RPostgres::Postgres(), dbname = cfg$dbname, host = cfg$host,
                        port = cfg$port, user = cfg$user, passfile = cfg$passfile,
                        connect_timeout = 5)
  identite <- DBI::dbGetQuery(con, paste0("SELECT current_database() AS db, current_user AS usr"))
  if (!identical(identite$db[[1L]], "lusk_it_contract") ||
      !identical(identite$usr[[1L]], "lusk_it_contract_pub")) {
    DBI::dbDisconnect(con)
    testthat::skip("guarded apply proof requires the lusk_it_contract test role")
  }
  con
}

# Publish the fixture territory reference through the EXISTING reference
# publisher, exactly as the retained path does. `apply` never publishes the
# reference itself (E-class release, ADR-0049) — it only READS its marker.
.guarded_apply_publish_reference <- function(con) {
  base <- artefacts_fixture_reference()$rows
  # The publisher binds unname(as.list(row)) POSITIONALLY, so column order must
  # exactly match its INSERT (territory_id, territory_type, name, department_id,
  # epci_id, density_class_code, density_class_label, littoral_code, source).
  # The fixture carries identity/level columns; remaining values are inert and
  # the reference CHECK permits NULL littoral on every row.
  rows <- data.frame(
    territory_id = base$territory_id,
    territory_type = base$territory_type,
    name = base$territory_id,
    department_id = rep(NA_character_, nrow(base)),
    epci_id = base$epci_id,
    density_class_code = base$density_class_code,
    density_class_label = base$density_class_code,
    littoral_code = rep(NA_character_, nrow(base)),
    littoral_classement_source = rep(NA_character_, nrow(base)),
    stringsAsFactors = FALSE)
  projection <- list(rows = rows, content_version = artefacts_fixture_reference()$content_version)
  publish_territory_reference_projection(projection,
    territory_reference_postgres_adapter(con))
  invisible(projection$content_version)
}

.guarded_apply_schema <- function(con) {
  .guarded_schema_build(con, "it_apply_", function(schema) {
    sql <- paste(readLines(testthat::test_path("..", "..", "..", "api", "schema.sql"),
                           warn = FALSE), collapse = "\n")
    for (statement in split_postgres_sql(sql)) DBI::dbExecute(con, statement)
    .guarded_apply_publish_reference(con)
    schema
  })$value
}

# Build scalar artefacts for one indicator and their lock registry.
.guarded_apply_artefact <- function(root, indicator, values, label = indicator,
                                    reference_version = "reference-v1") {
  projection <- artefacts_fixture_scalar_indicator(indicator, paste0("src_", indicator), values)
  projection$descriptors$label <- label
  projection$descriptors$descriptor_version <- paste0(indicator, "-", substr(label, 1L, 8L))
  reference <- artefacts_fixture_reference()
  reference$content_version <- reference_version
  comparison <- comparaison_scalaire_ressource(projection, indicator, reference)
  contenu <- contenu_artefact(
    faits_forme(REGISTRE_FORMES_RESSOURCE[["scalar"]], projection),
    projection$descriptors, projection$provenance, comparison)
  digests <- artefacts_fixture_digests(paste0("src_", indicator))
  ecrit <- ecrire_artefact_ressource(indicator, "scalar", contenu,
    digests_lignage = digests_lignage_ressource(
      sources_provenance_ressource(projection$provenance), digests), root = root)
  lock <- stats::setNames(list(list(sha256 = paste0("sha256-src_", indicator),
                                    acquired_at = "2026-01-01")),
                          paste0("src_", indicator))
  list(version = ecrit$version, lock = lock)
}

# Read a resource's full observation row set KEYED by territory. Ordering by
# column 1 (indicator_id) is constant and leaves row order undefined.
.guarded_apply_observations_a <- function(con) {
  DBI::dbGetQuery(con, paste0(
    "SELECT indicator_id,territory_id,territory_type,value,status,",
    "support_count,denominator_count FROM scalar_observation WHERE indicator_id='a' ",
    "ORDER BY territory_type,territory_id"))
}

.guarded_apply_faits_artefact <- function(root, version) {
  faits <- lire_artefact_ressource("a", version, root = root)$contenu$faits$facts
  faits <- faits[order(faits$territory_type, faits$territory_id), , drop = FALSE]
  rownames(faits) <- NULL
  faits
}

.guarded_apply_verifier_lignes <- function(con, table, indicator) {
  champs <- DBI::dbListFields(con, table)
  where <- if ("indicator_id" %in% champs) " WHERE indicator_id=$1" else
    if ("facet_id" %in% champs) " WHERE facet_id=$1" else ""
  params <- if (nzchar(where)) list(indicator) else NULL
  DBI::dbGetQuery(con, paste0("SELECT * FROM ", table, where, " ORDER BY 1"),
                  params = params)
}

test_that("guarded: apply A leaves every other scalar byte-identical, rollback and retire", {
  con <- .guarded_apply_connect()
  on.exit(DBI::dbDisconnect(con), add = TRUE)
  schema <- .guarded_apply_schema(con)
  on.exit(DBI::dbExecute(con, paste0('DROP SCHEMA IF EXISTS "', schema, '" CASCADE')),
          add = TRUE, after = FALSE)

  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE, after = FALSE)
  valeurs_a <- c(10, 10, 5, 3, NA, 100, 50, 8, 8, 30)
  valeurs_b <- c(2, 4, 6, 8, 10, 20, 40, 1, 2, 3)
  a <- .guarded_apply_artefact(root, "a", valeurs_a)
  b <- .guarded_apply_artefact(root, "b", valeurs_b)
  registre <- c(a$lock, b$lock)

  apply_publication("b", root = root, registre = registre, con = con)
  tables <- c("scalar_descriptor", "scalar_descriptor_source", "scalar_observation",
              "scalar_observation_source", "scalar_comparison_group",
              "scalar_comparison_territory", "comparison_source_lineage",
              "scalar_resource_comparison_publication")
  avant_b <- lapply(tables, .guarded_apply_verifier_lignes, con = con, indicator = "b")
  names(avant_b) <- tables

  apply_publication("a", root = root, registre = registre, con = con)
  apres_b <- lapply(tables, .guarded_apply_verifier_lignes, con = con, indicator = "b")
  names(apres_b) <- tables
  for (t in tables) expect_identical(apres_b[[t]], avant_b[[t]])
  expect_equal(nrow(DBI::dbGetQuery(con,
    "SELECT * FROM scalar_observation WHERE indicator_id='a'")), length(valeurs_a))
  expect_equal(nrow(DBI::dbGetQuery(con,
    "SELECT * FROM resource_publication WHERE resource_id='a' AND retired=false")), 1L)

  # Append-only receipts: two applies so far, one per resource.
  expect_equal(nrow(DBI::dbGetQuery(con, "SELECT * FROM resource_publication_event")), 2L)
  expect_error(DBI::dbExecute(con,
    "UPDATE resource_publication_event SET new_content_version='x'"),
    "append-only")

  # Rollback: a changed version then re-apply the previous version from its artefact.
  a2 <- .guarded_apply_artefact(root, "a", valeurs_a + 1)
  registre2 <- c(a2$lock, b$lock)
  apply_publication("a", root = root, registre = registre2, con = con)
  expect_equal(.guarded_apply_observations_a(con),
               .guarded_apply_faits_artefact(root, a2$version))
  apply_publication(paste0("a@", a$version), root = root, registre = registre, con = con)
  # Full restored row set equals the v1 artefact's rows exactly, keyed by
  # (territory_type, territory_id) — not an order-dependent value vector.
  expect_equal(.guarded_apply_observations_a(con),
               .guarded_apply_faits_artefact(root, a$version))

  # Retirement removes A's rows and leaves a receipt.
  apply_publication("a", retire = TRUE, root = root, registre = registre, con = con)
  expect_equal(nrow(DBI::dbGetQuery(con,
    "SELECT * FROM scalar_observation WHERE indicator_id='a'")), 0L)
  expect_equal(nrow(DBI::dbGetQuery(con,
    "SELECT * FROM resource_publication WHERE resource_id='a' AND retired=true")), 1L)
  expect_true(nrow(DBI::dbGetQuery(con,
    "SELECT * FROM resource_publication_event WHERE resource_id='a' AND operation='retire'")) >= 1L)
})

test_that("guarded: definition change refuses without confirmation, succeeds with it", {
  con <- .guarded_apply_connect()
  on.exit(DBI::dbDisconnect(con), add = TRUE)
  schema <- .guarded_apply_schema(con)
  on.exit(DBI::dbExecute(con, paste0('DROP SCHEMA IF EXISTS "', schema, '" CASCADE')),
          add = TRUE, after = FALSE)
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE, after = FALSE)
  valeurs <- c(10, 10, 5, 3, NA, 100, 50, 8, 8, 30)
  a1 <- .guarded_apply_artefact(root, "a", valeurs, label = "Anchor")
  apply_publication("a", root = root, registre = a1$lock, con = con)
  a2 <- .guarded_apply_artefact(root, "a", valeurs, label = "Redefined Anchor")
  registre <- a2$lock
  avant <- DBI::dbGetQuery(con, "SELECT count(*) AS n FROM resource_publication_event")$n[[1L]]

  err <- tryCatch(apply_publication("a", root = root, registre = registre, con = con),
                  error = identity)
  expect_s3_class(err, "erreur_apply")
  expect_identical(DBI::dbGetQuery(con, "SELECT count(*) AS n FROM resource_publication_event")$n[[1L]], avant)
  apply_publication("a", confirm_definition = "a", root = root, registre = registre, con = con)
  expect_identical(DBI::dbGetQuery(con, "SELECT count(*) AS n FROM resource_publication_event")$n[[1L]], avant + 1L)
})

test_that("guarded: a forced failure mid-apply rolls back registry and receipts", {
  con <- .guarded_apply_connect()
  on.exit(DBI::dbDisconnect(con), add = TRUE)
  schema <- .guarded_apply_schema(con)
  on.exit(DBI::dbExecute(con, paste0('DROP SCHEMA IF EXISTS "', schema, '" CASCADE')),
          add = TRUE, after = FALSE)
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE, after = FALSE)
  a <- .guarded_apply_artefact(root, "a", c(10, 10, 5, 3, NA, 100, 50, 8, 8, 30))
  local_mocked_bindings(
    ecrire_recette_ressource = function(...) stop("forced failure after serving writes"))
  err <- tryCatch(apply_publication("a", root = root, registre = a$lock, con = con),
                  error = identity)
  expect_match(conditionMessage(err), "forced failure")
  expect_equal(nrow(DBI::dbGetQuery(con, "SELECT * FROM scalar_observation WHERE indicator_id='a'")), 0L)
  expect_equal(nrow(DBI::dbGetQuery(con, "SELECT * FROM resource_publication")), 0L)
  expect_equal(nrow(DBI::dbGetQuery(con, "SELECT * FROM resource_publication_event")), 0L)
})

# Snapshot of everything a divergent-reference apply must leave untouched.
.guarded_apply_schema_digest <- function(con) {
  list(
    reference = DBI::dbGetQuery(con, paste0(
      "SELECT table_name,content_version,row_count,reference_content_version ",
      "FROM table_publication WHERE table_name='territory_reference'")),
    territory = DBI::dbGetQuery(con, "SELECT * FROM territory_reference ORDER BY territory_id"),
    registry = DBI::dbGetQuery(con, "SELECT * FROM resource_publication ORDER BY resource_id"),
    receipts = DBI::dbGetQuery(con, "SELECT * FROM resource_publication_event ORDER BY event_id"),
    observations = DBI::dbGetQuery(con, "SELECT * FROM scalar_observation ORDER BY indicator_id,territory_id")
  )
}

test_that("guarded: an artefact bound to another reference refuses with zero writes", {
  con <- .guarded_apply_connect()
  on.exit(DBI::dbDisconnect(con), add = TRUE)
  schema <- .guarded_apply_schema(con)
  on.exit(DBI::dbExecute(con, paste0('DROP SCHEMA IF EXISTS "', schema, '" CASCADE')),
          add = TRUE, after = FALSE)
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE, after = FALSE)
  # Live reference is "reference-v1" (published by the fixture); this artefact
  # is bound to a different reference generation.
  a <- .guarded_apply_artefact(root, "a", c(10, 10, 5, 3, NA, 100, 50, 8, 8, 30),
                               reference_version = "reference-autre")
  avant <- .guarded_apply_schema_digest(con)
  err <- tryCatch(apply_publication("a", root = root, registre = a$lock, con = con),
                  error = identity)
  expect_s3_class(err, "erreur_apply")
  expect_identical(err$refus, "reference_divergente")
  expect_match(conditionMessage(err), "reference-autre", fixed = TRUE)
  # No serving row, registry row, marker or receipt changed.
  expect_identical(.guarded_apply_schema_digest(con), avant)
})
