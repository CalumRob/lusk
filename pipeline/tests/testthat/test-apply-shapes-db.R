# Guarded end-to-end `apply` proofs for the three #1139 shape adapters on the
# operator-owned lusk_it_contract database. NEVER connects to `lusk`. Skips
# before any connection unless the documented test-only DSNs, private passfile
# and cleanup opt-in are present. One random private schema per test, fresh
# api/schema.sql, always dropped only that schema in `finally`.

.guarded_shapes_config <- function() {
  required <- c("LUSK_SCALAR_TEST_HOST", "LUSK_SCALAR_TEST_DATABASE",
                "LUSK_SCALAR_TEST_USER", "PGPASSFILE")
  env <- Sys.getenv(required, unset = "")
  database <- Sys.getenv("LUSK_SCALAR_TEST_DATABASE", unset = "")
  if (any(!nzchar(env)) || !file.exists(Sys.getenv("PGPASSFILE", unset = "")) ||
      database != "lusk_it_contract" || !startsWith(database, "lusk_it_") ||
      identical(database, "lusk"))
    testthat::skip("guarded shape-apply proof requires explicit lusk_it_* DSNs and private PGPASSFILE")
  if (Sys.getenv("LUSK_SCALAR_TEST_CLEANUP", unset = "") != "1")
    testthat::skip("set LUSK_SCALAR_TEST_CLEANUP=1 for the non-retained shape-apply proof")
  list(host = env[["LUSK_SCALAR_TEST_HOST"]],
       port = suppressWarnings(as.integer(Sys.getenv("LUSK_SCALAR_TEST_PORT", "5432"))),
       dbname = database, user = env[["LUSK_SCALAR_TEST_USER"]],
       passfile = normalizePath(Sys.getenv("PGPASSFILE"), winslash = "/", mustWork = TRUE))
}

.guarded_shapes_connect <- function() {
  cfg <- .guarded_shapes_config()
  con <- DBI::dbConnect(RPostgres::Postgres(), dbname = cfg$dbname, host = cfg$host,
                        port = cfg$port, user = cfg$user, passfile = cfg$passfile,
                        connect_timeout = 5)
  identite <- DBI::dbGetQuery(con, "SELECT current_database() AS db, current_user AS usr")
  if (!identical(identite$db[[1L]], "lusk_it_contract") ||
      !identical(identite$usr[[1L]], "lusk_it_contract_pub")) {
    DBI::dbDisconnect(con)
    testthat::skip("guarded shape-apply proof requires the lusk_it_contract test role")
  }
  con
}

# Publish the fixture territory reference through the EXISTING reference
# publisher, exactly as the retained path does. `apply` never publishes it.
.guarded_shapes_publish_reference <- function(con) {
  base <- artefacts_fixture_reference()$rows
  rows <- data.frame(
    territory_id = base$territory_id, territory_type = base$territory_type,
    name = base$territory_id, department_id = rep(NA_character_, nrow(base)),
    epci_id = base$epci_id, density_class_code = base$density_class_code,
    density_class_label = base$density_class_code,
    littoral_code = rep(NA_character_, nrow(base)),
    littoral_classement_source = rep(NA_character_, nrow(base)),
    stringsAsFactors = FALSE)
  projection <- list(rows = rows, content_version = artefacts_fixture_reference()$content_version)
  publish_territory_reference_projection(projection,
    territory_reference_postgres_adapter(con))
  invisible(projection$content_version)
}

.guarded_shapes_schema <- function(con) {
  schema <- paste0("it_shapes_", paste(sample(c(letters, 0:9), 12, TRUE), collapse = ""))
  DBI::dbExecute(con, paste0('CREATE SCHEMA "', schema, '"'))
  DBI::dbExecute(con, paste0('SET search_path TO "', schema, '"'))
  sql <- paste(readLines(testthat::test_path("..", "..", "..", "api", "schema.sql"),
                         warn = FALSE), collapse = "\n")
  for (statement in split_postgres_sql(sql)) DBI::dbExecute(con, statement)
  .guarded_shapes_publish_reference(con)
  schema
}

# Scalar artefact for the cross-shape snapshot (the scalar apply itself is
# proven by test-apply-scalar-db.R; here it is only an "other resource").
.guarded_shapes_scalar_artefact <- function(root, indicator, values) {
  projection <- artefacts_fixture_scalar_indicator(indicator, paste0("src_", indicator), values)
  reference <- artefacts_fixture_reference()
  comparison <- comparaison_scalaire_ressource(projection, indicator, reference)
  contenu <- contenu_artefact(
    faits_forme(REGISTRE_FORMES_RESSOURCE[["scalar"]], projection),
    projection$descriptors, projection$provenance, comparison)
  ecrit <- ecrire_artefact_ressource(indicator, "scalar", contenu,
    digests_lignage = digests_lignage_ressource(
      sources_provenance_ressource(projection$provenance),
      artefacts_fixture_digests(paste0("src_", indicator))), root = root)
  lire_artefact_ressource(indicator, ecrit$version, root = root)
}

.guarded_shapes_lock <- function(sources) {
  stats::setNames(lapply(as.character(sources), function(source)
    list(sha256 = paste0("sha256-", source), acquired_at = "2026-01-01")),
    as.character(sources))
}

# Each snapshot is scoped to ONE resource: never a whole-table snapshot, which
# would mix the applied resource's new rows into the "other resource" baseline.
.guarded_shapes_colonne <- function(table) {
  if (identical(table, "resource_publication")) return("resource_id")
  if (identical(table, "comparison_source_lineage")) return("facet_id")
  if (identical(table, "series_provenance_revision")) return(NA_character_) # immuable, partagé
  if (grepl("^series_dataset_|^series_observation_provenance$|^ordered_series_comparison_", table))
    return("dataset_id")
  if (grepl("^observed_collection_|^period_detail_observation$|^anchored_membership$", table))
    return("indicator_id")
  if (grepl("^scalar_descriptor|^scalar_observation|^scalar_resource_comparison", table))
    return("indicator_id")
  NA_character_  # AEDAR: tables globales (une seule ressource)
}

.guarded_shapes_lignes <- function(con, table, colonne = NULL, valeur = NULL) {
  champs <- DBI::dbListFields(con, table)
  if (!is.null(colonne) && colonne %in% champs) {
    DBI::dbGetQuery(con, paste0("SELECT * FROM ", table, " WHERE ", colonne, "=$1 ORDER BY 1"),
                    params = list(valeur))
  } else {
    DBI::dbGetQuery(con, paste0("SELECT * FROM ", table, " ORDER BY 1"))
  }
}

.guarded_shapes_spec <- function(tables, ressource) {
  spec <- lapply(tables, function(t) {
    colonne <- .guarded_shapes_colonne(t)
    if (is.na(colonne)) list(colonne = NULL, valeur = NULL) else
      list(colonne = colonne, valeur = ressource)
  })
  names(spec) <- tables
  spec
}

.guarded_shapes_snapshot <- function(con, spec) {
  out <- lapply(names(spec), function(t)
    .guarded_shapes_lignes(con, t, spec[[t]]$colonne, spec[[t]]$valeur))
  names(out) <- names(spec)
  out
}

.guarded_shapes_marqueurs <- function(con) {
  DBI::dbGetQuery(con, paste0(
    "SELECT table_name,content_version,row_count,reference_content_version ",
    "FROM table_publication WHERE table_name LIKE 'aedar%' OR ",
    "table_name='territory_reference' ORDER BY table_name"))
}

TABLES_SERIE <- c("series_dataset_publication", "series_dataset_descriptor",
  "series_dataset_observation", "series_observation_provenance",
  "series_provenance_revision", "ordered_series_comparison_publication")
TABLES_COLLECTION <- c("observed_collection_publication", "observed_collection_descriptor",
  "observed_collection_category", "period_detail_observation",
  "observed_collection_comparison_publication", "observed_collection_comparison_group",
  "observed_collection_comparison_territory", "observed_collection_comparison_lineage")
TABLES_SCALAIRES <- c("scalar_descriptor", "scalar_descriptor_source", "scalar_observation",
  "scalar_observation_source", "scalar_comparison_group", "scalar_comparison_territory",
  "comparison_source_lineage", "scalar_resource_comparison_publication")
TABLES_AEDAR <- c("aedar_territorial_aggregate", "aedar_territory_summary",
  "aedar_comparison_publication", "aedar_comparison_group",
  "aedar_density_class_summary", "aedar_littoral_summary")

test_that("guarded: applying one owned series leaves every other series byte-identical", {
  con <- .guarded_shapes_connect()
  on.exit(DBI::dbDisconnect(con), add = TRUE)
  schema <- .guarded_shapes_schema(con)
  on.exit(DBI::dbExecute(con, paste0('DROP SCHEMA IF EXISTS "', schema, '" CASCADE')),
          add = TRUE, after = FALSE)
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE, after = FALSE)

  adaptateur_series_artefact(root, "artif_par_habitant", 10)
  adaptateur_series_artefact(root, "prix_m2", 20)
  lock <- .guarded_shapes_lock("ocsge")
  spec <- .guarded_shapes_spec(c(TABLES_SERIE, "resource_publication"), "prix_m2")
  apply_publication("prix_m2", root = root, registre = lock, con = con)
  avant_b <- .guarded_shapes_snapshot(con, spec)
  apply_publication("artif_par_habitant", root = root, registre = lock, con = con)
  apres_b <- .guarded_shapes_snapshot(con, spec)
  for (t in names(spec)) expect_identical(apres_b[[t]], avant_b[[t]], info = t)
  expect_equal(nrow(DBI::dbGetQuery(con,
    "SELECT * FROM series_dataset_publication WHERE dataset_id='artif_par_habitant' AND retired=false")), 1L)
  expect_equal(nrow(DBI::dbGetQuery(con,
    "SELECT * FROM resource_publication WHERE resource_id='artif_par_habitant' AND retired=false")), 1L)
})

test_that("guarded: applying one observed collection leaves every other collection byte-identical", {
  con <- .guarded_shapes_connect()
  on.exit(DBI::dbDisconnect(con), add = TRUE)
  schema <- .guarded_shapes_schema(con)
  on.exit(DBI::dbExecute(con, paste0('DROP SCHEMA IF EXISTS "', schema, '" CASCADE')),
          add = TRUE, after = FALSE)
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE, after = FALSE)

  adaptateur_collection_artefact(root, "acv", 5)
  adaptateur_collection_artefact(root, "acv_b", 9)
  lock <- .guarded_shapes_lock("programme_source")
  spec <- .guarded_shapes_spec(c(TABLES_COLLECTION, "resource_publication"), "acv_b")
  apply_publication("acv_b", root = root, registre = lock, con = con)
  avant_b <- .guarded_shapes_snapshot(con, spec)
  apply_publication("acv", root = root, registre = lock, con = con)
  apres_b <- .guarded_shapes_snapshot(con, spec)
  for (t in names(spec)) expect_identical(apres_b[[t]], avant_b[[t]], info = t)
  expect_equal(nrow(DBI::dbGetQuery(con,
    "SELECT * FROM observed_collection_publication WHERE indicator_id='acv'")), 1L)
  expect_equal(nrow(DBI::dbGetQuery(con,
    "SELECT * FROM resource_publication WHERE resource_id='acv' AND retired=false")), 1L)
})

test_that("guarded: AEDAR apply passes the deferred validator, with and without littoral summaries", {
  con <- .guarded_shapes_connect()
  on.exit(DBI::dbDisconnect(con), add = TRUE)
  schema <- .guarded_shapes_schema(con)
  on.exit(DBI::dbExecute(con, paste0('DROP SCHEMA IF EXISTS "', schema, '" CASCADE')),
          add = TRUE, after = FALSE)
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE, after = FALSE)

  lock <- .guarded_shapes_lock("aedar_bretagne")
  adaptateur_aedar_artefact(root, with_littoral = FALSE)
  # The deferred check_aedar_comparison_publication trigger fires at the commit
  # of apply's outer transaction: a failure here is an apply error.
  expect_no_error(apply_publication("aedar", root = root, registre = lock, con = con))
  marqueur <- DBI::dbGetQuery(con,
    "SELECT group_row_count,density_summary_row_count,littoral_summary_row_count FROM aedar_comparison_publication")
  expect_equal(nrow(marqueur), 1L)
  expect_equal(marqueur$littoral_summary_row_count[[1L]], 0L)
  expect_equal(nrow(DBI::dbGetQuery(con, "SELECT * FROM aedar_littoral_summary")), 0L)

  adaptateur_aedar_artefact(root, with_littoral = TRUE)
  expect_no_error(apply_publication("aedar", root = root, registre = lock, con = con))
  marqueur2 <- DBI::dbGetQuery(con,
    "SELECT littoral_summary_row_count FROM aedar_comparison_publication")
  expect_true(marqueur2$littoral_summary_row_count[[1L]] > 0L)
  expect_equal(nrow(DBI::dbGetQuery(con, "SELECT * FROM aedar_littoral_summary")),
               marqueur2$littoral_summary_row_count[[1L]])
})

test_that("guarded: applying one series leaves scalar, collection and AEDAR byte-identical", {
  con <- .guarded_shapes_connect()
  on.exit(DBI::dbDisconnect(con), add = TRUE)
  schema <- .guarded_shapes_schema(con)
  on.exit(DBI::dbExecute(con, paste0('DROP SCHEMA IF EXISTS "', schema, '" CASCADE')),
          add = TRUE, after = FALSE)
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE, after = FALSE)

  .guarded_shapes_scalar_artefact(root, "densite", c(10, 10, 5, 3, NA, 100, 50, 8, 8, 30))
  adaptateur_collection_artefact(root, "acv", 5)
  adaptateur_aedar_artefact(root, with_littoral = FALSE)
  adaptateur_series_artefact(root, "artif_par_habitant", 10)
  adaptateur_series_artefact(root, "prix_m2", 20)
  lock <- .guarded_shapes_lock(c("src_densite", "programme_source", "aedar_bretagne", "ocsge"))
  apply_publication("densite", root = root, registre = lock, con = con)
  apply_publication("acv", root = root, registre = lock, con = con)
  apply_publication("aedar", root = root, registre = lock, con = con)
  apply_publication("artif_par_habitant", root = root, registre = lock, con = con)

  autres <- c(TABLES_SCALAIRES, TABLES_COLLECTION, TABLES_AEDAR,
    intersect(TABLES_SERIE, setdiff(TABLES_SERIE, character())))  # toutes les tables série
  spec <- .guarded_shapes_spec(autres, "prix_m2")  # l'autre série est préservée aussi
  # Les tables scalar/collection sont filtrées sur LEUR ressource, pas sur prix_m2.
  for (t in c(TABLES_SCALAIRES, TABLES_COLLECTION)) spec[[t]]$valeur <-
    if (t %in% TABLES_SCALAIRES) "densite" else "acv"
  avant <- .guarded_shapes_snapshot(con, spec)
  marqueurs_avant <- .guarded_shapes_marqueurs(con)
  apply_publication("prix_m2", root = root, registre = lock, con = con)
  apres <- .guarded_shapes_snapshot(con, spec)
  for (t in names(spec)) expect_identical(apres[[t]], avant[[t]], info = t)
  expect_identical(.guarded_shapes_marqueurs(con), marqueurs_avant)
})

test_that("guarded: applying one collection leaves scalar, series and AEDAR byte-identical", {
  con <- .guarded_shapes_connect()
  on.exit(DBI::dbDisconnect(con), add = TRUE)
  schema <- .guarded_shapes_schema(con)
  on.exit(DBI::dbExecute(con, paste0('DROP SCHEMA IF EXISTS "', schema, '" CASCADE')),
          add = TRUE, after = FALSE)
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE, after = FALSE)

  .guarded_shapes_scalar_artefact(root, "densite", c(10, 10, 5, 3, NA, 100, 50, 8, 8, 30))
  adaptateur_series_artefact(root, "artif_par_habitant", 10)
  adaptateur_aedar_artefact(root, with_littoral = FALSE)
  adaptateur_collection_artefact(root, "acv", 5)
  adaptateur_collection_artefact(root, "acv_b", 9)
  lock <- .guarded_shapes_lock(c("src_densite", "ocsge", "aedar_bretagne", "programme_source"))
  apply_publication("densite", root = root, registre = lock, con = con)
  apply_publication("artif_par_habitant", root = root, registre = lock, con = con)
  apply_publication("aedar", root = root, registre = lock, con = con)
  apply_publication("acv", root = root, registre = lock, con = con)

  autres <- c(TABLES_SCALAIRES, TABLES_SERIE, TABLES_AEDAR,
    intersect(TABLES_COLLECTION, setdiff(TABLES_COLLECTION, character())))
  spec <- .guarded_shapes_spec(autres, "acv_b")  # l'autre collection est préservée aussi
  for (t in c(TABLES_SCALAIRES, TABLES_SERIE)) spec[[t]]$valeur <-
    if (t %in% TABLES_SCALAIRES) "densite" else "artif_par_habitant"
  avant <- .guarded_shapes_snapshot(con, spec)
  marqueurs_avant <- .guarded_shapes_marqueurs(con)
  apply_publication("acv_b", root = root, registre = lock, con = con)
  apres <- .guarded_shapes_snapshot(con, spec)
  for (t in names(spec)) expect_identical(apres[[t]], avant[[t]], info = t)
  expect_identical(.guarded_shapes_marqueurs(con), marqueurs_avant)
})

test_that("guarded: applying AEDAR leaves every scalar, series and collection byte-identical", {
  con <- .guarded_shapes_connect()
  on.exit(DBI::dbDisconnect(con), add = TRUE)
  schema <- .guarded_shapes_schema(con)
  on.exit(DBI::dbExecute(con, paste0('DROP SCHEMA IF EXISTS "', schema, '" CASCADE')),
          add = TRUE, after = FALSE)
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE, after = FALSE)

  .guarded_shapes_scalar_artefact(root, "densite", c(10, 10, 5, 3, NA, 100, 50, 8, 8, 30))
  adaptateur_series_artefact(root, "artif_par_habitant", 10)
  adaptateur_collection_artefact(root, "acv", 5)
  lock <- .guarded_shapes_lock(c("src_densite", "ocsge", "programme_source", "aedar_bretagne"))
  apply_publication("densite", root = root, registre = lock, con = con)
  apply_publication("artif_par_habitant", root = root, registre = lock, con = con)
  apply_publication("acv", root = root, registre = lock, con = con)
  tables <- c(TABLES_SCALAIRES, TABLES_SERIE, TABLES_COLLECTION)
  spec <- .guarded_shapes_spec(tables, "densite")
  for (t in c(TABLES_SERIE, TABLES_COLLECTION)) spec[[t]]$valeur <-
    if (t %in% TABLES_SERIE) "artif_par_habitant" else "acv"
  avant <- .guarded_shapes_snapshot(con, spec)
  adaptateur_aedar_artefact(root, with_littoral = FALSE)
  expect_no_error(apply_publication("aedar", root = root, registre = lock, con = con))
  apres <- .guarded_shapes_snapshot(con, spec)
  for (t in names(spec)) expect_identical(apres[[t]], avant[[t]], info = t)
})
