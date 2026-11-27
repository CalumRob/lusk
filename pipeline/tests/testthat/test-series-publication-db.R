# Guarded owned-series contracts without typed readings: historical migration-011
# parity plus immutable parent/sibling refresh, no-op/rebind, rollback and reader
# write denial on the current post-049 schema.

.series_db_reference <- function() {
  base <- artefacts_fixture_reference()$rows
  rows <- data.frame(territory_id = base$territory_id,
    territory_type = base$territory_type, name = base$territory_id,
    department_id = rep(NA_character_, nrow(base)), epci_id = base$epci_id,
    density_class_code = base$density_class_code,
    density_class_label = base$density_class_code,
    littoral_code = rep(NA_character_, nrow(base)),
    littoral_classement_source = rep(NA_character_, nrow(base)), stringsAsFactors = FALSE)
  list(rows = rows, content_version = "reference-v1")
}

.series_db_seed_reference <- function(con) {
  reference <- .series_db_reference()
  publish_territory_reference_projection(reference,
    territory_reference_postgres_adapter(con))
  reference
}

.series_db_projection <- function(dataset_id, value) {
  projection <- adaptateur_series_projection(dataset_id, value)
  if (identical(dataset_id, "artif_par_habitant"))
    projection$excluded <- list(region = list(policy = "territory_fiche_only", row_count = 0L))
  projection
}

.series_db_artifact <- function(projection, root) {
  owner <- projection$descriptor$dataset_id
  directory <- file.path(root, owner)
  write_owned_series_artifact(projection, directory, owner)
  read_owned_series_artifact(directory, owner)
}

.series_db_snapshot <- function(con, dataset) {
  list(
    marker = DBI::dbGetQuery(con,
      "SELECT * FROM series_dataset_publication WHERE dataset_id=$1", params = list(dataset)),
    descriptor = DBI::dbGetQuery(con,
      "SELECT * FROM series_dataset_descriptor WHERE dataset_id=$1 ORDER BY indicator_id",
      params = list(dataset)),
    facts = DBI::dbGetQuery(con,
      "SELECT * FROM series_dataset_observation WHERE dataset_id=$1 ORDER BY indicator_id,territory_id,axis_value",
      params = list(dataset)),
    links = DBI::dbGetQuery(con,
      "SELECT * FROM series_observation_provenance WHERE dataset_id=$1 ORDER BY indicator_id,territory_id,axis_value,provenance_revision_id",
      params = list(dataset)))
}

.series_db_catalog <- function(con, schema, tables, functions) {
  pg_array <- function(values) paste0("{", paste(values, collapse = ","), "}")
  normalize <- function(value) {
    value <- gsub(paste0('"', schema, '".'), "", value, fixed = TRUE)
    gsub(paste0(schema, "."), "", value, fixed = TRUE)
  }
  columns <- DBI::dbGetQuery(con, "SELECT table_name,column_name,data_type,is_nullable,column_default
    FROM information_schema.columns WHERE table_schema=$1 AND table_name=ANY($2::text[])
    ORDER BY table_name,ordinal_position", params = list(schema, pg_array(tables)))
  constraints <- DBI::dbGetQuery(con, "SELECT r.relname,c.conname,pg_get_constraintdef(c.oid,true) AS definition,
      c.convalidated,c.condeferrable,c.condeferred
    FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=r.relnamespace
    WHERE n.nspname=$1 AND r.relname=ANY($2::text[]) ORDER BY r.relname,c.conname",
    params = list(schema, pg_array(tables)))
  triggers <- DBI::dbGetQuery(con, "SELECT r.relname,t.tgname,pg_get_triggerdef(t.oid,true) AS definition
    FROM pg_trigger t JOIN pg_class r ON r.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=r.relnamespace
    WHERE n.nspname=$1 AND NOT t.tgisinternal AND r.relname=ANY($2::text[])
    ORDER BY r.relname,t.tgname", params = list(schema, pg_array(tables)))
  indexes <- DBI::dbGetQuery(con, "SELECT tablename,indexname,indexdef FROM pg_indexes
    WHERE schemaname=$1 AND tablename=ANY($2::text[]) ORDER BY tablename,indexname",
    params = list(schema, pg_array(tables)))
  function_defs <- DBI::dbGetQuery(con, "SELECT p.proname,pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname=$1 AND p.proname=ANY($2::text[]) ORDER BY p.proname",
    params = list(schema, pg_array(functions)))
  constraints$definition <- normalize(constraints$definition)
  triggers$definition <- normalize(triggers$definition)
  indexes$indexdef <- normalize(indexes$indexdef)
  function_defs$definition <- normalize(function_defs$definition)
  list(columns = columns, constraints = constraints, triggers = triggers,
       indexes = indexes, functions = function_defs)
}

test_that("guarded: migration 011 recreates the historical owned-series contract", {
  con <- .adopt_db_connect()
  on.exit(DBI::dbDisconnect(con), add = TRUE, after = FALSE)
  root <- normalizePath(testthat::test_path("..", "..", ".."), winslash = "/", mustWork = TRUE)
  historical_base <- system2("git", c("-C", root, "show", "d8bf2a66^:api/schema.sql"),
                             stdout = TRUE, stderr = TRUE)
  historical_fresh <- system2("git", c("-C", root, "show", "0730183f:api/schema.sql"),
                              stdout = TRUE, stderr = TRUE)
  if ((attr(historical_base, "status") %||% 0L) != 0L ||
      (attr(historical_fresh, "status") %||% 0L) != 0L)
    stop("Could not read reviewed migration-011 schemas")
  migrated <- .guarded_schema_build(con, "it_series_m011_", function(schema) {
    for (statement in split_postgres_sql(paste(historical_base, collapse = "\n")))
      DBI::dbExecute(con, statement)
    migration <- paste(readLines(testthat::test_path("..", "..", "..", "api", "migrations",
      "011_owned_series_publications.sql"), warn = FALSE), collapse = "\n")
    for (statement in split_postgres_sql(migration)) DBI::dbExecute(con, statement)
    schema
  })$value
  fresh <- .guarded_schema_build(con, "it_series_fresh_", function(schema) {
    for (statement in split_postgres_sql(paste(historical_fresh, collapse = "\n")))
      DBI::dbExecute(con, statement)
    schema
  })$value
  on.exit({
    DBI::dbExecute(con, paste0('DROP SCHEMA IF EXISTS "', migrated, '" CASCADE'))
    DBI::dbExecute(con, paste0('DROP SCHEMA IF EXISTS "', fresh, '" CASCADE'))
  }, add = TRUE, after = FALSE)

  tables <- c("series_provenance_revision", "series_dataset_publication",
    "series_dataset_descriptor", "series_dataset_observation", "series_observation_provenance")
  functions <- c("reject_series_provenance_revision_mutation", "validate_series_dataset_write",
    "validate_series_dataset_descriptor", "validate_series_dataset_observation",
    "validate_series_dataset_publication", "validate_series_observation_provenance")
  expect_identical(.series_db_catalog(con, migrated, tables, functions),
                   .series_db_catalog(con, fresh, tables, functions))
})

test_that("guarded: owned series keeps immutable parent and sibling rows through refresh, rollback and reader denial", {
  con <- .adopt_db_connect()
  on.exit(DBI::dbDisconnect(con), add = TRUE, after = FALSE)
  schema <- .guarded_schema_build(con, "it_series_", function(schema) {
    sql <- paste(readLines(testthat::test_path("..", "..", "..", "api", "schema.sql"),
                           warn = FALSE), collapse = "\n")
    for (statement in split_postgres_sql(sql)) DBI::dbExecute(con, statement)
    .series_db_seed_reference(con)
    schema
  })$value
  on.exit(DBI::dbExecute(con, paste0('DROP SCHEMA IF EXISTS "', schema, '" CASCADE')),
          add = TRUE, after = FALSE)
  root <- tempfile("series-db-artifacts-")
  on.exit(unlink(root, recursive = TRUE), add = TRUE, after = FALSE)

  parent <- .series_db_artifact(.series_db_projection("artif_par_habitant", 10), root)
  sibling <- .series_db_artifact(.series_db_projection("conso_enaf_annuel", 20), root)
  expect_identical(parent$provenance$provenance_revision_id,
                   sibling$provenance$provenance_revision_id)
  adapter <- owned_series_postgres_adapter(con)
  expect_true(publish_owned_series_projection(parent, adapter)$changed)
  expect_true(publish_owned_series_projection(sibling, adapter)$changed)
  parent_before <- .series_db_snapshot(con, "artif_par_habitant")
  sibling_before <- .series_db_snapshot(con, "conso_enaf_annuel")
  provenance_before <- DBI::dbGetQuery(con,
    "SELECT * FROM series_provenance_revision ORDER BY provenance_revision_id")

  noop <- publish_owned_series_projection(parent, adapter)
  expect_false(noop$changed)
  expect_false(noop$rebound)
  expect_identical(.series_db_snapshot(con, "artif_par_habitant"), parent_before)

  changed <- parent
  changed$points$value <- changed$points$value + 1
  expect_true(publish_owned_series_projection(changed, adapter)$changed)
  expect_identical(.series_db_snapshot(con, "conso_enaf_annuel"), sibling_before)
  expect_identical(DBI::dbGetQuery(con,
    "SELECT * FROM series_provenance_revision ORDER BY provenance_revision_id"), provenance_before)
  parent_changed <- .series_db_snapshot(con, "artif_par_habitant")

  DBI::dbExecute(con,
    "UPDATE table_publication SET content_version='reference-v2' WHERE table_name='territory_reference'")
  rebound <- publish_owned_series_projection(changed, adapter)
  expect_false(rebound$changed)
  expect_true(rebound$rebound)
  expect_identical(.series_db_snapshot(con, "conso_enaf_annuel"), sibling_before)
  expect_identical(.series_db_snapshot(con, "artif_par_habitant")$marker$content_version,
                   parent_changed$marker$content_version)
  DBI::dbExecute(con,
    "UPDATE table_publication SET content_version='reference-v1' WHERE table_name='territory_reference'")
  expect_true(publish_owned_series_projection(changed, adapter)$rebound)

  before_failure <- .series_db_snapshot(con, "artif_par_habitant")
  DBI::dbExecute(con, "CREATE FUNCTION reject_series_db_refresh() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected owned-series refresh failure'; END $$")
  DBI::dbExecute(con, "CREATE TRIGGER reject_series_db_refresh BEFORE INSERT ON series_dataset_observation
    FOR EACH ROW EXECUTE FUNCTION reject_series_db_refresh()")
  failed <- tryCatch({ publish_owned_series_projection(parent, adapter); NULL }, error = identity)
  expect_match(conditionMessage(failed), "injected owned-series refresh failure", fixed = TRUE)
  expect_identical(.series_db_snapshot(con, "artif_par_habitant"), before_failure)
  expect_identical(.series_db_snapshot(con, "conso_enaf_annuel"), sibling_before)
  expect_identical(DBI::dbGetQuery(con,
    "SELECT * FROM series_provenance_revision ORDER BY provenance_revision_id"), provenance_before)
  DBI::dbExecute(con, "DROP TRIGGER reject_series_db_refresh ON series_dataset_observation")
  DBI::dbExecute(con, "DROP FUNCTION reject_series_db_refresh()")

  immutable <- tryCatch({
    DBI::dbExecute(con, "UPDATE series_provenance_revision SET source_name='mutated'")
    NULL
  }, error = identity)
  expect_match(conditionMessage(immutable), "series provenance revisions are immutable", fixed = TRUE)

  cfg <- .adopt_db_config()
  reader <- DBI::dbConnect(RPostgres::Postgres(), dbname = cfg$dbname, host = cfg$host,
    port = cfg$port, user = "lusk_it_contract_read", passfile = cfg$passfile,
    connect_timeout = 5)
  on.exit(DBI::dbDisconnect(reader), add = TRUE, after = FALSE)
  DBI::dbExecute(reader, paste0("SET search_path TO ", DBI::dbQuoteIdentifier(reader, schema)))
  DBI::dbExecute(con, paste0("GRANT USAGE ON SCHEMA ", DBI::dbQuoteIdentifier(con, schema),
    " TO ", DBI::dbQuoteIdentifier(con, "lusk_it_contract_read")))
  DBI::dbExecute(con, paste0("GRANT SELECT ON ALL TABLES IN SCHEMA ",
    DBI::dbQuoteIdentifier(con, schema), " TO ", DBI::dbQuoteIdentifier(con, "lusk_it_contract_read")))
  reader_identity <- DBI::dbGetQuery(reader,
    "SELECT current_database() AS db,current_user AS usr,current_schema() AS schema")
  expect_identical(reader_identity$db[[1L]], "lusk_it_contract")
  expect_identical(reader_identity$usr[[1L]], "lusk_it_contract_read")
  expect_identical(reader_identity$schema[[1L]], schema)
  denied <- tryCatch({
    DBI::dbExecute(reader, "UPDATE series_provenance_revision SET source_name='forbidden'")
    NULL
  }, error = identity)
  expect_s3_class(denied, "error")
})
