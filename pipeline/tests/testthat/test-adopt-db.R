# Guarded adoption proofs (#1142) on the operator-owned lusk_it_contract DB.
# NEVER connects to `lusk`. Without the exact test DSNs/private passfile and
# cleanup opt-in, every test skips before dbConnect. One random schema per test;
# only that schema is dropped in on.exit.
#
# Fixture-scale limitation (deliberate, no SQL seeds): the normal full backend
# entry point also publishes four typed-reading families which adoption ignores
# and whose complete canonical fixtures are not available at this scale. These
# proofs call publish_retained_backend_snapshot(atomic=TRUE) with ONLY those
# retired families stubbed to no-ops. Territory reference, scalar snapshot,
# declared profile, comparisons and every serving write are the real publishers.
# project_retained_scalar_snapshot supplies the bounded fixture snapshot and the
# profile binding is the matching real scalar token; no expected serving rows
# are inserted directly in SQL.

.adopt_db_config <- function() {
  required <- c("LUSK_SCALAR_TEST_HOST", "LUSK_SCALAR_TEST_DATABASE",
                "LUSK_SCALAR_TEST_USER", "PGPASSFILE")
  env <- Sys.getenv(required, unset = "")
  database <- Sys.getenv("LUSK_SCALAR_TEST_DATABASE", unset = "")
  if (any(!nzchar(env)) || !file.exists(Sys.getenv("PGPASSFILE", unset = "")) ||
      database != "lusk_it_contract" || !startsWith(database, "lusk_it_") ||
      identical(database, "lusk"))
    testthat::skip("guarded adopt proof requires explicit lusk_it_* DSNs and private PGPASSFILE")
  if (Sys.getenv("LUSK_SCALAR_TEST_CLEANUP", unset = "") != "1")
    testthat::skip("set LUSK_SCALAR_TEST_CLEANUP=1 for the non-retained adopt proof")
  list(host = env[["LUSK_SCALAR_TEST_HOST"]],
       port = suppressWarnings(as.integer(Sys.getenv("LUSK_SCALAR_TEST_PORT", "5432"))),
       dbname = database, user = env[["LUSK_SCALAR_TEST_USER"]],
       passfile = normalizePath(Sys.getenv("PGPASSFILE"), winslash = "/", mustWork = TRUE))
}

.adopt_db_connect <- function() {
  cfg <- .adopt_db_config()
  con <- DBI::dbConnect(RPostgres::Postgres(), dbname = cfg$dbname, host = cfg$host,
                        port = cfg$port, user = cfg$user, passfile = cfg$passfile,
                        connect_timeout = 5)
  identite <- DBI::dbGetQuery(con,
    "SELECT current_database() AS db, current_user AS usr")
  if (!identical(identite$db[[1L]], "lusk_it_contract") ||
      !identical(identite$usr[[1L]], "lusk_it_contract_pub")) {
    DBI::dbDisconnect(con)
    testthat::skip("guarded adopt proof requires the lusk_it_contract test role")
  }
  con
}

.adopt_db_schema <- function(con) {
  schema <- paste0("it_adopt_", paste(sample(c(letters, 0:9), 12, TRUE), collapse = ""))
  DBI::dbExecute(con, paste0('CREATE SCHEMA "', schema, '"'))
  DBI::dbExecute(con, paste0('SET search_path TO "', schema, '"'))
  sql <- paste(readLines(testthat::test_path("..", "..", "..", "api", "schema.sql"),
                         warn = FALSE), collapse = "\n")
  for (statement in split_postgres_sql(sql)) DBI::dbExecute(con, statement)
  schema
}

.adopt_db_fixture <- function() {
  sortie <- tempfile("adopt-sortie-")
  root <- artefacts_fixture_root()
  dir.create(sortie, recursive = TRUE)
  on.exit(unlink(c(sortie, root), recursive = TRUE), add = TRUE)
  base <- artefacts_fixture_reference()$rows
  canonical <- data.frame(territoire = base$territory_id, type = base$territory_type,
    nom = base$territory_id, departement = rep(NA_character_, nrow(base)),
    epci = base$epci_id, classe_densite_code = base$density_class_code,
    classe_densite_libelle_public = base$density_class_code, stringsAsFactors = FALSE)
  nanoparquet::write_parquet(canonical, file.path(sortie, "territoires.parquet"))
  reference <- project_territory_reference(canonical)

  scalar <- artefacts_fixture_scalar_indicator("densite", "src_densite",
    c(10, 10, 5, 3, NA, 100, 50, 8, 8, 30))
  scalar$datasets <- data.frame(source_id = "src_densite", name = "Densité",
                                stringsAsFactors = FALSE)
  scalar$vintages <- data.frame(source_id = "src_densite", vintage_id = "2020",
    version = "2020", reference_date = as.Date("2020-01-01"),
    publication_date = as.Date("2021-01-01"), stringsAsFactors = FALSE)
  write_scalar_serving_artifact(scalar, file.path(sortie, "scalar-serving", "demographie"))
  snapshot <- list(scalar = scalar,
    comparison = project_scalar_comparisons(scalar, reference$rows,
      scalar_content_version(scalar), reference$content_version),
    retired_indicator_ids = character())

  profile <- artefacts_fixture_profile_artefact(root = root)$artefact$contenu
  descriptor <- profile$descriptor
  descriptor$indicator_id <- "structure_age"
  descriptor$comparison_scalar <- NULL
  descriptor$required_scalar_version <- NULL
  descriptor$comparison_detail <- "d1"
  descriptor$comparison_sex <- NULL
  descriptor$levels <- "commune"
  descriptor$source <- "profile_source"
  profile$descriptor <- descriptor
  profile$faits$axes$indicator_id <- "structure_age"
  profile$faits$eligible_territories <- reference$rows[c("territory_id", "territory_type")]
  profile$provenance$indicator_id <- "structure_age"
  write_profile_serving_artifact(profile, file.path(sortie, "profile-serving", "structure_age"))
  jsonlite::write_json(list(
    list(source_id = "src_densite", sha256 = "sha256-src_densite", bytes = 10L),
    list(source_id = "profile_source", sha256 = "sha256-profile_source", bytes = 10L)),
    file.path(sortie, "source-digests.json"), auto_unbox = TRUE)
  lock <- artefacts_fixture_digests(c("src_densite", "profile_source"))
  list(sortie = sortie, root = root, reference = reference, snapshot = snapshot,
       scalar_version = scalar_content_version(scalar), lock = lock)
}

.adopt_db_publish_full_path <- function(con, fixture) {
  local_mocked_bindings(
    # Bounded fixture input to the normal snapshot publisher.
    project_retained_scalar_snapshot = function(...) fixture$snapshot,
    profile_scalar_binding = function(...) fixture$scalar_version,
    # Typed readings are ignored by adoption and retired separately (#1141).
    publish_canonical_demographic_reading = function(...) list(),
    publish_canonical_habitat_reading = function(...) list(),
    read_typed_reading_publication_from = function(...) list(),
    publish_typed_reading_publication = function(...) list(),
    publish_canonical_milieux_reading = function(...) list(reading = list(), owned_series = list()))
  with_publication_transaction(con,
    publish_retained_backend_snapshot(con, sortie = fixture$sortie, atomic = TRUE,
                                      companion_profiles = TRUE))
}

.adopt_db_digest <- function(con) {
  tables <- DBI::dbGetQuery(con, paste0(
    "SELECT tablename FROM pg_tables WHERE schemaname=current_schema() ",
    "AND tablename NOT IN ('resource_publication','resource_publication_event') ",
    "ORDER BY tablename"))$tablename
  out <- lapply(tables, function(table) {
    champs <- DBI::dbListFields(con, table)
    ordre <- paste(vapply(champs, function(champ)
      as.character(DBI::dbQuoteIdentifier(con, champ)), character(1)), collapse = ",")
    DBI::dbGetQuery(con, paste0("SELECT * FROM ", table, " ORDER BY ", ordre))
  })
  names(out) <- tables
  serialize(out, NULL)
}

.adopt_db_registry_digest <- function(con) {
  serialize(list(
    registry = DBI::dbGetQuery(con,
      "SELECT * FROM resource_publication ORDER BY resource_id"),
    receipts = DBI::dbGetQuery(con,
      "SELECT * FROM resource_publication_event ORDER BY event_id")), NULL)
}

test_that("guarded: normal full-path publication adopts with unchanged data and an unchanged plan", {
  con <- .adopt_db_connect()
  on.exit(DBI::dbDisconnect(con), add = TRUE)
  schema <- .adopt_db_schema(con)
  on.exit(DBI::dbExecute(con, paste0('DROP SCHEMA IF EXISTS "', schema, '" CASCADE')),
          add = TRUE, after = FALSE)
  fixture <- .adopt_db_fixture()
  .adopt_db_publish_full_path(con, fixture)
  avant <- .adopt_db_digest(con)

  resultat <- adopter_ressources(fixture$sortie, root = fixture$root,
    lock = fixture$lock, con = con)
  expect_setequal(resultat$adopted, c("densite", "structure_age"))
  expect_identical(.adopt_db_digest(con), avant)
  pub <- DBI::dbGetQuery(con, paste0(
    "SELECT resource_id,shape,content_version,retired FROM resource_publication ",
    "ORDER BY resource_id"))
  expect_identical(pub$resource_id, c("densite", "structure_age"))
  expect_false(any(pub$retired))
  expect_equal(nrow(DBI::dbGetQuery(con, paste0(
    "SELECT * FROM resource_publication_event WHERE operation='adopted'"))), 2L)

  plan <- plan_publication(root = fixture$root,
    live = lire_listing_live_registre(con), lock = fixture$lock)
  expect_false(any(plan$ressources$change))
  expect_false(any(plan$ressources$cascade))
  expect_true(all(plan$ressources$drift_nb == 0L))
})

test_that("guarded: one altered live row refuses adoption with zero writes and names the resource", {
  con <- .adopt_db_connect()
  on.exit(DBI::dbDisconnect(con), add = TRUE)
  schema <- .adopt_db_schema(con)
  on.exit(DBI::dbExecute(con, paste0('DROP SCHEMA IF EXISTS "', schema, '" CASCADE')),
          add = TRUE, after = FALSE)
  fixture <- .adopt_db_fixture()
  .adopt_db_publish_full_path(con, fixture)
  DBI::dbExecute(con, paste0(
    "UPDATE scalar_observation SET value=value+1 WHERE indicator_id='densite' ",
    "AND territory_id='c1'"))
  avant <- .adopt_db_digest(con)
  registre_avant <- .adopt_db_registry_digest(con)

  err <- tryCatch(adopter_ressources(fixture$sortie, root = fixture$root,
    lock = fixture$lock, con = con), error = identity)
  expect_s3_class(err, "erreur_adoption")
  expect_identical(err$refus, "ressource_divergente")
  expect_match(conditionMessage(err), "densite", fixed = TRUE)
  expect_match(conditionMessage(err), "observations", fixed = TRUE)
  expect_identical(.adopt_db_digest(con), avant)
  expect_identical(.adopt_db_registry_digest(con), registre_avant)
})

test_that("guarded: a forced receipt failure rolls back every adopted registry row", {
  con <- .adopt_db_connect()
  on.exit(DBI::dbDisconnect(con), add = TRUE)
  schema <- .adopt_db_schema(con)
  on.exit(DBI::dbExecute(con, paste0('DROP SCHEMA IF EXISTS "', schema, '" CASCADE')),
          add = TRUE, after = FALSE)
  fixture <- .adopt_db_fixture()
  .adopt_db_publish_full_path(con, fixture)
  avant <- .adopt_db_digest(con)
  registre_avant <- .adopt_db_registry_digest(con)
  local_mocked_bindings(ecrire_recette_ressource = function(con, ressource, ...) {
    if (identical(ressource, "structure_age")) stop("forced adoption receipt failure")
    invisible(TRUE)
  })
  err <- tryCatch(adopter_ressources(fixture$sortie, root = fixture$root,
    lock = fixture$lock, con = con), error = identity)
  expect_match(conditionMessage(err), "forced adoption receipt failure", fixed = TRUE)
  expect_identical(.adopt_db_digest(con), avant)
  expect_identical(.adopt_db_registry_digest(con), registre_avant)
})
