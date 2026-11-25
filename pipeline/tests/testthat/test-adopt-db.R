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

test_that("DPE-like fixture derives its semantic contract from the scalar descriptor", {
  reference <- artefacts_fixture_reference()
  source <- list(descriptor = list(indicator_id = "distribution_dpe", unit = "wrong",
      comparison_direction = "low", levels = "commune"),
    axes = data.frame(axis_name = "detail", axis_key = "d1", label = "D1",
      ordinal = 0L, unit = "wrong", stringsAsFactors = FALSE),
    provenance = data.frame(source_id = "s", vintage_id = "v", stringsAsFactors = FALSE),
    datasets = data.frame(source_id = "s", name = "S", stringsAsFactors = FALSE),
    vintages = data.frame(source_id = "s", vintage_id = "v", version = "v",
      reference_date = as.Date("2020-01-01"), publication_date = as.Date("2021-01-01"),
      stringsAsFactors = FALSE))
  scalar <- data.frame(indicator_id = "part_passoires", unit = "count",
    direction = "high", comparison_facet = "part_passoires",
    allowed_levels = I(list(c("commune", "epci", "departement", "region"))),
    stringsAsFactors = FALSE)
  profile <- .adopt_db_profile_projection(source, "distribution_dpe", reference,
    scalar_version = "facts-v1", comparison_scalar = "part_passoires",
    scalar_descriptor = scalar)
  expect_identical(profile$descriptor$unit, scalar$unit)
  expect_identical(profile$descriptor$comparison_direction, scalar$direction)
  expect_identical(profile$descriptor$comparison_scalar, scalar$comparison_facet)
  expect_true(all(profile$descriptor$levels %in%
    as.character(scalar$allowed_levels[[1L]])))
})

test_that("guarded: real full-path publication adopts every shape with unchanged data and plan", {
  con <- .adopt_db_connect()
  on.exit(DBI::dbDisconnect(con), add = TRUE)
  schema <- .adopt_db_schema(con)
  on.exit(DBI::dbExecute(con, paste0('DROP SCHEMA IF EXISTS "', schema, '" CASCADE')),
          add = TRUE, after = FALSE)
  fixture <- .adopt_db_fixture()
  on.exit(unlink(c(fixture$sortie, fixture$root, fixture$aedar_dir,
    fixture$metadata_directory), recursive = TRUE), add = TRUE, after = FALSE)
  .adopt_db_publish_all(con, fixture)
  avant <- .adopt_db_digest(con)

  resultat <- adopter_ressources(fixture$sortie, root = fixture$root,
    registre = fixture$lock, projections = fixture$projections, reference = fixture$reference,
    metadata_directory = fixture$metadata_directory, con = con)
  attendus <- c("densite", "part_passoires", "structure_age", "distribution_dpe",
    "artif_par_habitant", "acv", "membres", "aedar")
  expect_setequal(resultat$adopted, attendus)
  expect_identical(.adopt_db_digest(con), avant)
  pub <- DBI::dbGetQuery(con, paste0(
    "SELECT resource_id,shape,content_version,retired FROM resource_publication ",
    "ORDER BY resource_id"))
  expect_setequal(pub$resource_id, attendus)
  expect_false(any(pub$retired))
  descriptors <- DBI::dbGetQuery(con, paste0(
    "SELECT d.publication_resource_id,d.content_version,p.content_version AS registry_version ",
    "FROM resource_publication_descriptor d JOIN resource_publication p ",
    "ON p.resource_id=d.publication_resource_id ORDER BY d.publication_resource_id"))
  expect_equal(nrow(descriptors), length(attendus))
  expect_setequal(descriptors$publication_resource_id, attendus)
  expect_identical(descriptors$content_version, descriptors$registry_version)
  expect_equal(nrow(DBI::dbGetQuery(con, paste0(
    "SELECT * FROM resource_publication_event WHERE operation='adopt'"))), length(attendus))

  plan <- plan_publication(root = fixture$root,
    live = lire_listing_live_registre(con), registre = fixture$lock)
  expect_setequal(plan$ressources$ressource, attendus)
  expect_false(any(plan$ressources$change))
  expect_false(any(plan$ressources$cascade))
  expect_true(all(plan$ressources$drift_nb == 0L))
})

test_that("guarded: one altered live row in each shape refuses with zero writes", {
  con <- .adopt_db_connect()
  on.exit(DBI::dbDisconnect(con), add = TRUE)
  schema <- .adopt_db_schema(con)
  on.exit(DBI::dbExecute(con, paste0('DROP SCHEMA IF EXISTS "', schema, '" CASCADE')),
          add = TRUE, after = FALSE)
  fixture <- .adopt_db_fixture()
  on.exit(unlink(c(fixture$sortie, fixture$root, fixture$aedar_dir,
    fixture$metadata_directory), recursive = TRUE), add = TRUE, after = FALSE)
  .adopt_db_publish_all(con, fixture)
  cas <- list(
    list(ressource = "densite", table = "scalar_observation", colonne = "value",
      where = "indicator_id='densite'", num = TRUE),
    list(ressource = "structure_age", table = "profile_observation", colonne = "value",
      where = "indicator_id='structure_age'", num = TRUE),
    list(ressource = "artif_par_habitant", table = "series_dataset_observation",
      colonne = "value", where = "dataset_id='artif_par_habitant'", num = TRUE),
    list(ressource = "acv", table = "period_detail_observation", colonne = "value",
      where = "indicator_id='acv'", num = TRUE),
    list(ressource = "aedar", table = "aedar_territorial_aggregate", colonne = "n_observed",
      where = "territory_type='commune'", num = TRUE))
  for (x in cas) {
    key <- DBI::dbGetQuery(con, paste0("SELECT ctid::text AS rowid FROM ", x$table,
      " WHERE ", x$where, " ORDER BY ctid LIMIT 1"))$rowid[[1L]]
    old <- DBI::dbGetQuery(con, paste0("SELECT ", x$colonne, " FROM ", x$table,
      " WHERE ctid='", key, "'"))[[1L]][[1L]]
    DBI::dbExecute(con, paste0("ALTER TABLE ", x$table, " DISABLE TRIGGER USER"))
    DBI::dbExecute(con, paste0("UPDATE ", x$table, " SET ", x$colonne, "=", x$colonne,
      "+1 WHERE ctid='", key, "'"))
    DBI::dbExecute(con, paste0("ALTER TABLE ", x$table, " ENABLE TRIGGER USER"))
    avant <- .adopt_db_digest(con)
    registre_avant <- .adopt_db_registry_digest(con)
    err <- tryCatch(adopter_ressources(fixture$sortie, root = fixture$root,
      registre = fixture$lock, projections = fixture$projections, reference = fixture$reference,
      metadata_directory = fixture$metadata_directory, con = con), error = identity)
    expect_true(inherits(err, "erreur_adoption"), info = x$ressource)
    expect_match(conditionMessage(err), x$ressource, fixed = TRUE, info = x$ressource)
    expect_match(conditionMessage(err), x$table, fixed = TRUE, info = x$ressource)
    expect_identical(.adopt_db_digest(con), avant, info = x$ressource)
    expect_identical(.adopt_db_registry_digest(con), registre_avant, info = x$ressource)
    DBI::dbExecute(con, paste0("ALTER TABLE ", x$table, " DISABLE TRIGGER USER"))
    DBI::dbExecute(con, paste0("UPDATE ", x$table, " SET ", x$colonne, "=$1 WHERE ctid=$2"),
      params = list(old, key))
    DBI::dbExecute(con, paste0("ALTER TABLE ", x$table, " ENABLE TRIGGER USER"))
  }
})

test_that("guarded: a forced receipt failure rolls back every adopted registry row", {
  con <- .adopt_db_connect()
  on.exit(DBI::dbDisconnect(con), add = TRUE)
  schema <- .adopt_db_schema(con)
  on.exit(DBI::dbExecute(con, paste0('DROP SCHEMA IF EXISTS "', schema, '" CASCADE')),
          add = TRUE, after = FALSE)
  fixture <- .adopt_db_fixture()
  on.exit(unlink(c(fixture$sortie, fixture$root, fixture$aedar_dir,
    fixture$metadata_directory), recursive = TRUE), add = TRUE, after = FALSE)
  .adopt_db_publish_all(con, fixture)
  avant <- .adopt_db_digest(con)
  registre_avant <- .adopt_db_registry_digest(con)
  local_mocked_bindings(ecrire_recette_ressource = function(con, ressource, ...) {
    if (identical(ressource, "structure_age")) stop("forced adoption receipt failure")
    invisible(TRUE)
  }, .package = "lusk")
  err <- tryCatch(adopter_ressources(fixture$sortie, root = fixture$root,
    registre = fixture$lock, projections = fixture$projections, reference = fixture$reference,
    metadata_directory = fixture$metadata_directory, con = con), error = identity)
  expect_match(conditionMessage(err), "forced adoption receipt failure", fixed = TRUE)
  expect_identical(.adopt_db_digest(con), avant)
  expect_identical(.adopt_db_registry_digest(con), registre_avant)
})
