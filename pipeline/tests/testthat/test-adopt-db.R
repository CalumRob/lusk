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

.adopt_db_scalar_indicator <- function(id, source, values) {
  p <- artefacts_fixture_scalar_indicator(id, source, values)
  p$datasets <- data.frame(source_id = source, name = source, stringsAsFactors = FALSE)
  p$vintages <- data.frame(source_id = source, vintage_id = "2020", version = "2020",
    reference_date = as.Date("2020-01-01"), publication_date = as.Date("2021-01-01"),
    stringsAsFactors = FALSE)
  p
}

.adopt_db_profile_projection <- function(source, id, reference, scalar_version = NULL,
                                         comparison_scalar = NULL) {
  descriptor <- source$descriptor
  descriptor$indicator_id <- id
  descriptor$required_scalar_version <- scalar_version
  descriptor$comparison_scalar <- comparison_scalar
  if (!is.null(comparison_scalar)) {
    descriptor$comparison_detail <- NA_character_
    descriptor$comparison_sex <- NA_character_
  }
  eligible <- reference$rows[reference$rows$territory_type %in% descriptor$levels,
                            c("territory_id", "territory_type"), drop = FALSE]
  details <- source$axes$axis_key[source$axes$axis_name == "detail"]
  sexes <- source$axes$axis_key[source$axes$axis_name == "sex"]
  if (!length(sexes)) sexes <- ""
  coordinates <- expand.grid(detail = details, sex = sexes, stringsAsFactors = FALSE)
  grid <- cbind(eligible[rep(seq_len(nrow(eligible)), each = nrow(coordinates)), , drop = FALSE],
    coordinates[rep(seq_len(nrow(coordinates)), times = nrow(eligible)), , drop = FALSE])
  rownames(grid) <- NULL
  facts <- data.frame(territory_id = grid$territory_id, territory_type = grid$territory_type,
    detail = grid$detail, sex = grid$sex, value = seq_len(nrow(grid)),
    status = "measured", stringsAsFactors = FALSE)
  p <- source$provenance[1L, , drop = FALSE]
  provenance <- data.frame(indicator_id = id, territory_id = grid$territory_id,
    detail_key = grid$detail, sex_key = grid$sex, source_id = p$source_id,
    vintage_id = p$vintage_id, stringsAsFactors = FALSE)
  list(descriptor = descriptor, facts = facts, axes = source$axes,
    provenance = provenance, datasets = source$datasets, vintages = source$vintages,
    eligible_territories = eligible)
}

.adopt_db_anchored_collection <- function(reference) {
  eligible <- reference$rows[reference$rows$territory_type == "commune",
                            c("territory_id", "territory_type"), drop = FALSE]
  indicator <- "membres"
  descriptor <- list(indicator_id = indicator, theme_id = "programmes",
    kind = "anchored_membership", label = "Membres", unit = "count",
    allowed_levels = "commune", comparison_detail = NA_character_,
    comparison_period = NA_character_, direction = "none", descriptor_version = "membres-v1")
  categories <- data.frame(indicator_id = indicator, detail_key = "petite_ville",
    label = "Petite ville", ordinal = 0L, source_id = "programme_source",
    anchor_levels = "{commune}", rider_label = NA_character_, clock_policy = "dataset",
    stringsAsFactors = FALSE)
  facts <- data.frame(indicator_id = indicator, territory_id = eligible$territory_id,
    territory_type = eligible$territory_type, detail_key = "petite_ville",
    convention_valant_ort = FALSE, source_id = "programme_source", vintage_id = "v1",
    stringsAsFactors = FALSE)
  structure(list(descriptor = descriptor, categories = categories, facts = facts,
    datasets = data.frame(source_id = "programme_source", name = "Programmes",
      stringsAsFactors = FALSE),
    vintages = data.frame(source_id = "programme_source", vintage_id = "v1", version = "v1",
      reference_date = as.Date("2023-01-01"), publication_date = as.Date("2024-01-01"),
      stringsAsFactors = FALSE), provenance = data.frame(source_id = character(),
        vintage_id = character(), stringsAsFactors = FALSE)), class = "collection-projection")
}

.adopt_db_series_projection <- function() {
  p <- adaptateur_series_projection()
  p$descriptor$direction <- "high"
  p$descriptor$comparison_point <- "M3"
  p$descriptor$comparison_statistic <- "median"
  p$descriptor$comparison_levels <- "commune"
  p$descriptor$comparison_axis_values <- c("M2", "M3")
  p
}

.adopt_db_aedar_manifest <- function(projection, reference) {
  comparison <- adaptateur_aedar_comparaison(projection, with_littoral = FALSE,
    reference_version = reference$content_version)
  comparison$membership <- aedar_comparison_membership_rows(
    adaptateur_aedar_reference_rows(FALSE))
  hashes <- stats::setNames(rep(paste(rep("a", 64), collapse = ""),
    length(c(paste0("mode:", AEDAR_ADDRESS_SOURCE_MODES), "address_origins", "density_reference",
      "density_artifact", "density_aggregate_content_version", "density_reference_identity",
      "density_reference_sha256", "density_reference_vintage"))),
    c(paste0("mode:", AEDAR_ADDRESS_SOURCE_MODES), "address_origins", "density_reference",
      "density_artifact", "density_aggregate_content_version", "density_reference_identity",
      "density_reference_sha256", "density_reference_vintage"))
  hashes[["density_reference_identity"]] <- MANIFEST_CLASSES_DENSITE$id[[1L]]
  hashes[["density_reference_sha256"]] <- MANIFEST_CLASSES_DENSITE$sha256[[1L]]
  hashes[["density_reference_vintage"]] <- MANIFEST_CLASSES_DENSITE$vintage[[1L]]
  identity <- as.character(jsonlite::toJSON(as.list(hashes), auto_unbox = TRUE))
  input_version <- paste(as.character(openssl::sha256(charToRaw(identity))), collapse = "")
  directory <- tempfile("adopt-aedar-")
  metadata <- list(source_snapshot_id = comparison$source_snapshot_id,
    aedar_content_version = comparison$aedar_content_version,
    reference_content_version = comparison$reference_content_version,
    input_content_version = input_version, input_identity = identity,
    membership = comparison$membership, typequ_axis = read_aedar_typequ_registry()$TYPEQU,
    typequ_axis_sha256 = AEDAR_TYPEQU_REGISTRY_SHA256,
    density_class_summaries = comparison$density_rows, littoral_summaries = NULL)
  part_builder <- function(code) {
    groups <- comparison$groups[comparison$groups$typequ == code, , drop = FALSE]
    names(groups)[names(groups) == "typequ"] <- "TYPEQU"
    list(groups = groups[AEDAR_COMPARISON_GROUP_COLUMNS],
      territories = data.frame())
  }
  manifest <- write_aedar_comparison_canonical(part_builder, directory, metadata)
  list(directory = directory, manifest = manifest,
    comparison = comparaison_aedar_pour_artefact(directory, reference))
}

.adopt_db_fixture <- function() {
  sortie <- tempfile("adopt-sortie-")
  root <- artefacts_fixture_root()
  aedar_dir <- NULL
  dir.create(sortie, recursive = TRUE)
  base <- artefacts_fixture_reference()$rows
  canonical <- data.frame(territoire = base$territory_id, type = base$territory_type,
    nom = base$territory_id, departement = rep(NA_character_, nrow(base)),
    epci = base$epci_id, classe_densite_code = base$density_class_code,
    classe_densite_libelle_public = base$density_class_code, stringsAsFactors = FALSE)
  nanoparquet::write_parquet(canonical, file.path(sortie, "territoires.parquet"))
  reference <- project_territory_reference(canonical)

  densite <- .adopt_db_scalar_indicator("densite", "src_densite", seq_len(nrow(base)))
  passoires <- .adopt_db_scalar_indicator("part_passoires", "dpe_22",
    seq_len(nrow(base)) + 100L)
  scalar <- list(facts = rbind(densite$facts, passoires$facts),
    descriptors = rbind(densite$descriptors, passoires$descriptors),
    provenance = rbind(densite$provenance, passoires$provenance),
    datasets = rbind(densite$datasets, passoires$datasets),
    vintages = rbind(densite$vintages, passoires$vintages),
    eligible_territories = densite$eligible_territories)
  scalar_version <- scalar_content_version(scalar)
  write_scalar_serving_artifact(scalar, file.path(sortie, "scalar-serving", "demographie"))
  snapshot <- list(scalar = scalar,
    comparison = project_scalar_comparisons(scalar, reference$rows, scalar_version,
      reference$content_version), retired_indicator_ids = character())

  payload <- compute_payload_test(load_fixture())
  habitat <- payload_habitat()
  structure_source <- project_structure_age_profile(payload, lire_theme_metadata("demographie"))
  structure_age <- .adopt_db_profile_projection(structure_source, "structure_age", reference)
  dpe_source <- project_dpe_profile(habitat, lire_theme_metadata("habitat"), scalar_version)
  dpe <- .adopt_db_profile_projection(dpe_source, "distribution_dpe", reference,
    scalar_version = scalar_version, comparison_scalar = "part_passoires")
  write_profile_serving_artifact(structure_age,
    file.path(sortie, "profile-serving", "structure_age"))
  write_profile_serving_artifact(dpe, file.path(sortie, "profile-serving", "distribution_dpe"),
    scalar_binding = scalar_version)

  serie <- .adopt_db_series_projection()
  period <- adaptateur_collection_projection()
  membres <- .adopt_db_anchored_collection(reference)
  aedar <- adaptateur_aedar_projection()
  aedar_manifest <- .adopt_db_aedar_manifest(aedar, reference)
  aedar_dir <- aedar_manifest$directory
  projections <- list(
    scalar = list(densite = densite, part_passoires = passoires),
    declared_profile = list(structure_age = structure_age, distribution_dpe = dpe),
    owned_series = list(artif_par_habitant = serie),
    observed_collection = list(acv = period, membres = membres),
    aedar = list(aedar = aedar))
  sources <- sort(unique(c(scalar$provenance$source_id, structure_age$provenance$source_id,
    dpe$provenance$source_id, serie$provenance$source_id, period$facts$source_id,
    membres$facts$source_id, aedar$source$source_id)))
  digests <- artefacts_fixture_digests(sources)
  jsonlite::write_json(unname(digests), file.path(sortie, "source-digests.json"),
    auto_unbox = TRUE)
  typed <- new.env(parent = emptyenv())
  typed$hits <- integer()
  list(sortie = sortie, root = root, reference = reference, snapshot = snapshot,
    scalar_version = scalar_version, lock = digests, projections = projections,
    aedar_manifest = aedar_manifest$manifest, aedar_dir = aedar_dir, typed = typed)
}

.adopt_db_publish_all <- function(con, fixture) {
  typed <- fixture$typed
  local_mocked_bindings(
    project_retained_scalar_snapshot = function(...) fixture$snapshot,
    declared_profile_owners = function() c("structure_age", "distribution_dpe"),
    profile_scalar_binding = function(...) fixture$scalar_version,
    publish_canonical_demographic_reading = function(...) {
      typed$hits <- c(typed$hits, "demographic"); list()
    },
    publish_canonical_habitat_reading = function(...) {
      typed$hits <- c(typed$hits, "habitat"); list()
    },
    read_typed_reading_publication_from = function(...) {
      typed$hits <- c(typed$hits, "economy-read"); list()
    },
    publish_typed_reading_publication = function(...) {
      typed$hits <- c(typed$hits, "economy-publish"); list()
    },
    publish_canonical_milieux_reading = function(...) {
      typed$hits <- c(typed$hits, "milieux"); list(reading = list(), owned_series = list())
    }, .package = "lusk")
  publish_retained_backend_snapshot(con, sortie = fixture$sortie, atomic = TRUE,
    companion_profiles = TRUE)
  expect_setequal(typed$hits, c("demographic", "habitat", "economy-read",
    "economy-publish", "milieux"))
  publish_owned_series_projection(fixture$projections$owned_series$artif_par_habitant,
    owned_series_postgres_adapter(con))
  for (projection in fixture$projections$observed_collection)
    publish_observed_collection(projection, con)
  aedar <- fixture$projections$aedar$aedar
  comparison <- fixture$aedar_manifest
  publish_aedar_aggregates(aedar, con,
    reference_version = fixture$reference$content_version,
    reference_pairs = adaptateur_aedar_reference_rows(FALSE),
    version = comparison$aedar_content_version)
  publish_aedar_comparisons(comparison, con)
  invisible(TRUE)
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

test_that("guarded: real full-path publication adopts every shape with unchanged data and plan", {
  con <- .adopt_db_connect()
  on.exit(DBI::dbDisconnect(con), add = TRUE)
  schema <- .adopt_db_schema(con)
  on.exit(DBI::dbExecute(con, paste0('DROP SCHEMA IF EXISTS "', schema, '" CASCADE')),
          add = TRUE, after = FALSE)
  fixture <- .adopt_db_fixture()
  on.exit(unlink(c(fixture$sortie, fixture$root, fixture$aedar_dir), recursive = TRUE),
          add = TRUE, after = FALSE)
  .adopt_db_publish_all(con, fixture)
  avant <- .adopt_db_digest(con)

  resultat <- adopter_ressources(fixture$sortie, root = fixture$root,
    lock = fixture$lock, projections = fixture$projections, reference = fixture$reference,
    con = con)
  attendus <- c("densite", "part_passoires", "structure_age", "distribution_dpe",
    "artif_par_habitant", "acv", "membres", "aedar")
  expect_setequal(resultat$adopted, attendus)
  expect_identical(.adopt_db_digest(con), avant)
  pub <- DBI::dbGetQuery(con, paste0(
    "SELECT resource_id,shape,content_version,retired FROM resource_publication ",
    "ORDER BY resource_id"))
  expect_setequal(pub$resource_id, attendus)
  expect_false(any(pub$retired))
  expect_equal(nrow(DBI::dbGetQuery(con, paste0(
    "SELECT * FROM resource_publication_event WHERE operation='adopted'"))), length(attendus))

  plan <- plan_publication(root = fixture$root,
    live = lire_listing_live_registre(con), lock = fixture$lock)
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
  on.exit(unlink(c(fixture$sortie, fixture$root, fixture$aedar_dir), recursive = TRUE),
          add = TRUE, after = FALSE)
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
      lock = fixture$lock, projections = fixture$projections, reference = fixture$reference,
      con = con), error = identity)
    expect_s3_class(err, "erreur_adoption", info = x$ressource)
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
  on.exit(unlink(c(fixture$sortie, fixture$root, fixture$aedar_dir), recursive = TRUE),
          add = TRUE, after = FALSE)
  .adopt_db_publish_all(con, fixture)
  avant <- .adopt_db_digest(con)
  registre_avant <- .adopt_db_registry_digest(con)
  local_mocked_bindings(ecrire_recette_ressource = function(con, ressource, ...) {
    if (identical(ressource, "structure_age")) stop("forced adoption receipt failure")
    invisible(TRUE)
  }, .package = "lusk")
  err <- tryCatch(adopter_ressources(fixture$sortie, root = fixture$root,
    lock = fixture$lock, projections = fixture$projections, reference = fixture$reference,
    con = con), error = identity)
  expect_match(conditionMessage(err), "forced adoption receipt failure", fixed = TRUE)
  expect_identical(.adopt_db_digest(con), avant)
  expect_identical(.adopt_db_registry_digest(con), registre_avant)
})
