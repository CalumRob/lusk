# Guarded end-to-end `apply` proof for the declared-profile cascade (#1138).
# NEVER connects to the serving database `lusk`. Skips before any connection
# unless the documented test-only DSNs and private passfile are present. Creates
# ONE random private schema, applies fresh api/schema.sql (migrations 046/047
# parity), publishes the fixture territory reference through the EXISTING
# publisher and always drops only that schema in `on.exit` (every path).

.gp_config <- function() {
  required <- c("LUSK_SCALAR_TEST_HOST", "LUSK_SCALAR_TEST_DATABASE",
                "LUSK_SCALAR_TEST_USER", "PGPASSFILE")
  env <- Sys.getenv(required, unset = "")
  if (any(!nzchar(env)) || !file.exists(Sys.getenv("PGPASSFILE", unset = "")) ||
      Sys.getenv("LUSK_SCALAR_TEST_DATABASE", unset = "") != "lusk_it_contract" ||
      !startsWith(Sys.getenv("LUSK_SCALAR_TEST_DATABASE", unset = ""), "lusk_it_") ||
      identical(Sys.getenv("LUSK_SCALAR_TEST_DATABASE", unset = ""), "lusk"))
    testthat::skip("guarded profile apply proof requires explicit lusk_it_* DSNs and private PGPASSFILE")
  if (Sys.getenv("LUSK_SCALAR_TEST_CLEANUP", unset = "") != "1")
    testthat::skip("set LUSK_SCALAR_TEST_CLEANUP=1 for the non-retained profile apply proof")
  list(host = env[["LUSK_SCALAR_TEST_HOST"]],
       port = suppressWarnings(as.integer(Sys.getenv("LUSK_SCALAR_TEST_PORT", "5432"))),
       dbname = env[["LUSK_SCALAR_TEST_DATABASE"]],
       user = env[["LUSK_SCALAR_TEST_USER"]],
       passfile = normalizePath(Sys.getenv("PGPASSFILE"), winslash = "/", mustWork = TRUE))
}

.gp_connect <- function() {
  cfg <- .gp_config()
  con <- DBI::dbConnect(RPostgres::Postgres(), dbname = cfg$dbname, host = cfg$host,
                        port = cfg$port, user = cfg$user, passfile = cfg$passfile,
                        connect_timeout = 5)
  identite <- DBI::dbGetQuery(con, "SELECT current_database() AS db, current_user AS usr")
  if (!identical(identite$db[[1L]], "lusk_it_contract") ||
      !identical(identite$usr[[1L]], "lusk_it_contract_pub")) {
    DBI::dbDisconnect(con)
    testthat::skip("guarded profile apply proof requires the lusk_it_contract test role")
  }
  con
}

.gp_schema <- function(con) {
  .guarded_schema_build(con, "it_apply_profil_", function(schema) {
    sql <- paste(readLines(testthat::test_path("..", "..", "..", "api", "schema.sql"),
                           warn = FALSE), collapse = "\n")
    for (statement in split_postgres_sql(sql)) DBI::dbExecute(con, statement)
    # Reference marker: apply READS it under the producer lock, never publishes it.
    base <- artefacts_fixture_reference()$rows
    rows <- data.frame(territory_id = base$territory_id,
      territory_type = base$territory_type, name = base$territory_id,
      department_id = rep(NA_character_, nrow(base)), epci_id = base$epci_id,
      density_class_code = base$density_class_code,
      density_class_label = base$density_class_code,
      littoral_code = rep(NA_character_, nrow(base)),
      littoral_classement_source = rep(NA_character_, nrow(base)), stringsAsFactors = FALSE)
    projection <- list(rows = rows, content_version = artefacts_fixture_reference()$content_version)
    publish_territory_reference_projection(projection,
      territory_reference_postgres_adapter(con))
    schema
  })$value
}

# Version des FAITS d'une ressource scalaire (#1135), telle que le profil la
# construit et l'enregistre à la construction.
.gp_faits <- function(id, source_id, values) {
  projection <- artefacts_fixture_scalar_indicator(id, source_id, values)
  version_faits_ressource(REGISTRE_FORMES_RESSOURCE[["scalar"]], projection)
}

# Build a scalar resource artefact with a per-resource comparison bound to the
# fixture reference, plus its lock entry.
.gp_scalaire <- function(root, id, source_id, values) {
  projection <- artefacts_fixture_scalar_indicator(id, source_id, values)
  reference <- artefacts_fixture_reference()
  handler <- REGISTRE_FORMES_RESSOURCE[["scalar"]]
  comparaison <- comparaison_scalaire_ressource(projection, id, reference)
  contenu <- contenu_artefact(faits_forme(handler, projection), projection$descriptors,
                              projection$provenance, comparaison)
  digests <- artefacts_fixture_digests(source_id)
  ecrit <- ecrire_artefact_ressource(id, "scalar", contenu,
    digests_lignage = digests_lignage_ressource(source_id, digests), root = root)
  list(version = ecrit$version,
       lock = stats::setNames(list(list(sha256 = paste0("sha256-", source_id),
         acquired_at = "2026-01-01")), source_id))
}

.gp_dans <- function(ids) paste0("('", paste(ids, collapse = "','"), "')")

.gp_global <- function(con) {
  list(
    publication = DBI::dbGetQuery(con, paste0(
      "SELECT table_name,content_version,row_count,reference_content_version ",
      "FROM table_publication ORDER BY table_name")),
    singleton_profil = DBI::dbGetQuery(con, paste0(
      "SELECT singleton,content_version,profile_content_version,reference_content_version,",
      "group_row_count,territory_row_count FROM profile_comparison_publication ORDER BY singleton")),
    singleton_scalaire = DBI::dbGetQuery(con, paste0(
      "SELECT singleton,content_version,scalar_content_version,reference_content_version ",
      "FROM scalar_comparison_publication ORDER BY singleton")))
}

.gp_profil <- function(con, ids) {
  dans <- .gp_dans(ids)
  list(
    descriptor = DBI::dbGetQuery(con, paste0("SELECT * FROM profile_descriptor WHERE indicator_id IN ", dans, " ORDER BY indicator_id")),
    axis = DBI::dbGetQuery(con, paste0("SELECT * FROM profile_axis WHERE indicator_id IN ", dans, " ORDER BY indicator_id,axis_name,axis_key")),
    observation = DBI::dbGetQuery(con, paste0("SELECT * FROM profile_observation WHERE indicator_id IN ", dans, " ORDER BY indicator_id,territory_id,detail_key,sex_key")),
    observation_source = DBI::dbGetQuery(con, paste0("SELECT * FROM profile_observation_source WHERE indicator_id IN ", dans, " ORDER BY 1,2,3,4,5,6")),
    descriptor_source = DBI::dbGetQuery(con, paste0("SELECT * FROM profile_descriptor_source WHERE indicator_id IN ", dans, " ORDER BY indicator_id,source_id")),
    groupe = DBI::dbGetQuery(con, paste0("SELECT * FROM profile_comparison_group WHERE indicator_id IN ", dans, " ORDER BY 1,2,3,4,5,6")),
    territoire = DBI::dbGetQuery(con, paste0("SELECT * FROM profile_comparison_territory WHERE indicator_id IN ", dans, " ORDER BY 1,2,3,4,5,6,7")),
    lignage = DBI::dbGetQuery(con, paste0("SELECT * FROM comparison_source_lineage WHERE comparison_family='profile' AND facet_id IN ", dans, " ORDER BY 1,2,3,4,5,6,7")),
    marqueur = DBI::dbGetQuery(con, paste0("SELECT * FROM profile_resource_comparison_publication WHERE indicator_id IN ", dans, " ORDER BY indicator_id")))
}

.gp_scalaire_lignes <- function(con, ids) {
  dans <- .gp_dans(ids)
  list(
    observation = DBI::dbGetQuery(con, paste0("SELECT * FROM scalar_observation WHERE indicator_id IN ", dans, " ORDER BY indicator_id,territory_id")),
    descriptor = DBI::dbGetQuery(con, paste0("SELECT * FROM scalar_descriptor WHERE indicator_id IN ", dans, " ORDER BY indicator_id")),
    marqueur = DBI::dbGetQuery(con, paste0("SELECT * FROM scalar_resource_comparison_publication WHERE indicator_id IN ", dans, " ORDER BY indicator_id")))
}

.gp_registre <- function(con) {
  list(
    registre = DBI::dbGetQuery(con, paste0(
      "SELECT resource_id,shape,content_version,reference_content_version,retired ",
      "FROM resource_publication ORDER BY resource_id")),
    recus = DBI::dbGetQuery(con, paste0(
      "SELECT resource_id,shape,operation,old_content_version,new_content_version,",
      "confirmed_definition,lineage_digests FROM resource_publication_event ORDER BY event_id")))
}

.gp_tout <- function(con, ids_profil, ids_scalaire) {
  list(global = .gp_global(con), profil = .gp_profil(con, ids_profil),
       scalaire = .gp_scalaire_lignes(con, ids_scalaire), registre = .gp_registre(con))
}

test_that("guarded: apply part_passoires publishes both resources, spares every other resource", {
  con <- .gp_connect()
  on.exit(DBI::dbDisconnect(con), add = TRUE)
  schema <- .gp_schema(con)
  on.exit(DBI::dbExecute(con, paste0('DROP SCHEMA IF EXISTS "', schema, '" CASCADE')),
          add = TRUE, after = FALSE)
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE, after = FALSE)

  densite <- .gp_scalaire(root, "densite", "census_densite", rep(1L, 10))
  apply_publication("densite", root = root, registre = densite$lock, con = con)
  avant_densite <- .gp_scalaire_lignes(con, "densite")
  avant_global <- .gp_global(con)

  valeurs_part <- c(10, 10, 5, 3, NA, 100, 50, 8, 8, 30)
  scalaire <- .gp_scalaire(root, "part_passoires", "dpe_22", valeurs_part)
  faits_attendus <- .gp_faits("part_passoires", "dpe_22", valeurs_part)
  profil <- artefacts_fixture_profile_artefact(root = root,
    comparison_scalar = "part_passoires", required_scalar_version = faits_attendus)
  registre <- c(densite$lock, scalaire$lock, profil$lock)

  resultat <- apply_publication("part_passoires", root = root, registre = registre, con = con)
  expect_setequal(resultat$cascade, c("part_passoires", "distribution_dpe"))
  expect_setequal(resultat$applied, c("part_passoires", "distribution_dpe"))

  pub <- DBI::dbGetQuery(con, paste0(
    "SELECT resource_id,shape,content_version FROM resource_publication ",
    "WHERE retired=false ORDER BY resource_id"))
  expect_setequal(pub$resource_id, c("densite", "part_passoires", "distribution_dpe"))
  expect_equal(nrow(DBI::dbGetQuery(con,
    "SELECT * FROM scalar_observation WHERE indicator_id='part_passoires'")), 10L)
  expect_equal(DBI::dbGetQuery(con,
    "SELECT count(*) AS n FROM profile_descriptor WHERE indicator_id='distribution_dpe'")$n[[1L]], 1L)
  expect_equal(nrow(DBI::dbGetQuery(con,
    "SELECT * FROM profile_observation WHERE indicator_id='distribution_dpe'")), 4L)

  # required_scalar_version binds the SCALAR FACTS version (#1135): the token
  # recorded at build time and the per-resource comparison marker agree, while
  # the whole-artefact version in the registry is a different value.
  reel <- DBI::dbGetQuery(con, paste0(
    "SELECT required_scalar_version FROM profile_descriptor WHERE indicator_id='distribution_dpe'"))$required_scalar_version[[1L]]
  marqueur <- DBI::dbGetQuery(con, paste0(
    "SELECT scalar_content_version FROM scalar_resource_comparison_publication ",
    "WHERE indicator_id='part_passoires'"))$scalar_content_version[[1L]]
  expect_identical(reel, faits_attendus)
  expect_identical(reel, marqueur)
  expect_false(identical(reel, pub$content_version[pub$resource_id == "part_passoires"]))

  # Per-resource markers written; the global markers are untouched (expand phase).
  expect_equal(DBI::dbGetQuery(con, paste0(
    "SELECT count(*) AS n FROM profile_resource_comparison_publication ",
    "WHERE indicator_id='distribution_dpe'"))$n[[1L]], 1L)
  expect_equal(DBI::dbGetQuery(con, paste0(
    "SELECT count(*) AS n FROM scalar_resource_comparison_publication ",
    "WHERE indicator_id='part_passoires'"))$n[[1L]], 1L)
  expect_identical(.gp_global(con), avant_global)
  expect_identical(.gp_scalaire_lignes(con, "densite"), avant_densite)
  # One append-only receipt per applied resource (plus the earlier scalar).
  expect_equal(DBI::dbGetQuery(con, "SELECT count(*) AS n FROM resource_publication_event")$n[[1L]], 3L)
  expect_error(DBI::dbExecute(con,
    "UPDATE resource_publication_event SET new_content_version='x'"), "append-only")
})

test_that("guarded: a failure while publishing the profile rolls back the scalar too", {
  con <- .gp_connect()
  on.exit(DBI::dbDisconnect(con), add = TRUE)
  schema <- .gp_schema(con)
  on.exit(DBI::dbExecute(con, paste0('DROP SCHEMA IF EXISTS "', schema, '" CASCADE')),
          add = TRUE, after = FALSE)
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE, after = FALSE)

  valeurs_part <- c(10, 10, 5, 3, NA, 100, 50, 8, 8, 30)
  scalaire <- .gp_scalaire(root, "part_passoires", "dpe_22", valeurs_part)
  faits_attendus <- .gp_faits("part_passoires", "dpe_22", valeurs_part)
  profil <- artefacts_fixture_profile_artefact(root = root,
    comparison_scalar = "part_passoires", required_scalar_version = faits_attendus)
  registre <- c(scalaire$lock, profil$lock)
  avant <- .gp_tout(con, "distribution_dpe", "part_passoires")

  # The scalar is published first in the dependency-first closure; forcing a
  # failure on the profile's receipt must roll the scalar back with it.
  local_mocked_bindings(ecrire_recette_ressource = function(con, ressource, ...) {
    if (identical(ressource, "distribution_dpe")) stop("forced failure while publishing profile")
    invisible(TRUE)
  })
  err <- tryCatch(apply_publication("part_passoires", root = root,
    registre = registre, con = con), error = identity)
  expect_match(conditionMessage(err), "forced failure while publishing profile", fixed = TRUE)
  expect_identical(.gp_tout(con, "distribution_dpe", "part_passoires"), avant)
  expect_equal(DBI::dbGetQuery(con,
    "SELECT count(*) AS n FROM scalar_observation WHERE indicator_id='part_passoires'")$n[[1L]], 0L)
  expect_equal(DBI::dbGetQuery(con,
    "SELECT count(*) AS n FROM profile_descriptor WHERE indicator_id='distribution_dpe'")$n[[1L]], 0L)
})

test_that("guarded: a divergent recorded dependency facts version refuses with zero writes", {
  con <- .gp_connect()
  on.exit(DBI::dbDisconnect(con), add = TRUE)
  schema <- .gp_schema(con)
  on.exit(DBI::dbExecute(con, paste0('DROP SCHEMA IF EXISTS "', schema, '" CASCADE')),
          add = TRUE, after = FALSE)
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE, after = FALSE)

  scalaire <- .gp_scalaire(root, "part_passoires", "dpe_22",
    c(10, 10, 5, 3, NA, 100, 50, 8, 8, 30))
  # The profile was computed against another generation of the scalar's facts.
  profil <- artefacts_fixture_profile_artefact(root = root,
    comparison_scalar = "part_passoires",
    required_scalar_version = "facts-d-une-autre-generation")
  registre <- c(scalaire$lock, profil$lock)
  avant <- .gp_tout(con, "distribution_dpe", "part_passoires")

  err <- tryCatch(apply_publication("part_passoires", root = root,
    registre = registre, con = con), error = identity)
  expect_s3_class(err, "erreur_apply")
  expect_identical(err$refus, "dependance_divergente")
  expect_match(conditionMessage(err), "part_passoires built ", fixed = TRUE)
  expect_match(conditionMessage(err), "facts-d-une-autre-generation", fixed = TRUE)
  expect_identical(.gp_tout(con, "distribution_dpe", "part_passoires"), avant)
})

test_that("guarded: applying another scalar never touches the DPE profile", {
  con <- .gp_connect()
  on.exit(DBI::dbDisconnect(con), add = TRUE)
  schema <- .gp_schema(con)
  on.exit(DBI::dbExecute(con, paste0('DROP SCHEMA IF EXISTS "', schema, '" CASCADE')),
          add = TRUE, after = FALSE)
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE, after = FALSE)

  valeurs_part <- c(10, 10, 5, 3, NA, 100, 50, 8, 8, 30)
  scalaire <- .gp_scalaire(root, "part_passoires", "dpe_22", valeurs_part)
  faits_attendus <- .gp_faits("part_passoires", "dpe_22", valeurs_part)
  profil <- artefacts_fixture_profile_artefact(root = root,
    comparison_scalar = "part_passoires", required_scalar_version = faits_attendus)
  densite <- .gp_scalaire(root, "densite", "census_densite", rep(1L, 10))
  registre <- c(scalaire$lock, profil$lock, densite$lock)
  apply_publication("part_passoires", root = root, registre = registre, con = con)
  avant_profil <- .gp_profil(con, "distribution_dpe")
  avant_global <- .gp_global(con)

  apply_publication("densite", root = root, registre = registre, con = con)
  expect_identical(.gp_profil(con, "distribution_dpe"), avant_profil)
  expect_identical(.gp_global(con), avant_global)
  expect_equal(nrow(DBI::dbGetQuery(con,
    "SELECT * FROM scalar_observation WHERE indicator_id='densite'")), 10L)
  expect_equal(DBI::dbGetQuery(con,
    "SELECT count(*) AS n FROM resource_publication_event")$n[[1L]], 3L)
})

test_that("guarded: applying a profile with no scalar dependency touches only that profile", {
  con <- .gp_connect()
  on.exit(DBI::dbDisconnect(con), add = TRUE)
  schema <- .gp_schema(con)
  on.exit(DBI::dbExecute(con, paste0('DROP SCHEMA IF EXISTS "', schema, '" CASCADE')),
          add = TRUE, after = FALSE)
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE, after = FALSE)

  autre <- artefacts_fixture_profile_artefact(root = root, owner = "reseaux",
    comparison_scalar = NULL, required_scalar_version = NULL,
    source_id = "independent_profile_source")
  # Publish DPE using an already-live scalar FACTS version (the per-resource
  # comparison marker), then snapshot it.
  faits_dpe <- .gp_faits("part_passoires", "dpe_energy",
    c(20, 30, 40, 50, 60, 70, 80, 90, 100, 110))
  # Rebuild DPE against the real facts version of the live scalar.
  dpe <- artefacts_fixture_profile_artefact(root = root, comparison_scalar = "part_passoires",
    required_scalar_version = faits_dpe, source_id = "profile_source_dpe")
  registre <- c(dpe$lock, autre$lock)
  DBI::dbExecute(con, paste0(
    "INSERT INTO resource_publication(resource_id,shape,content_version,reference_content_version,published_at) ",
    "VALUES('part_passoires','scalar','part-passoires-artefact-live','reference-v1',now())"))
  DBI::dbExecute(con, paste0(
    "INSERT INTO scalar_resource_comparison_publication(indicator_id,content_version,",
    "scalar_content_version,reference_content_version,group_row_count,territory_row_count,lineage_row_count) ",
    "VALUES('part_passoires','cmp-live',$1,'reference-v1',0,0,0)"),
    params = list(faits_dpe))
  apply_publication("distribution_dpe", root = root, registre = registre, con = con)
  avant_dpe <- .gp_profil(con, "distribution_dpe")
  avant_global <- .gp_global(con)

  resultat <- apply_publication("reseaux", root = root, registre = registre, con = con)
  expect_identical(resultat$applied, "reseaux")
  expect_identical(.gp_profil(con, "distribution_dpe"), avant_dpe)
  expect_identical(.gp_global(con), avant_global)
  # The independent profile has no scalar binding and its own marker only.
  desc <- DBI::dbGetQuery(con, paste0(
    "SELECT indicator_id,comparison_scalar,required_scalar_version,comparison_detail ",
    "FROM profile_descriptor WHERE indicator_id='reseaux'"))
  expect_equal(nrow(desc), 1L)
  expect_true(is.na(desc$comparison_scalar[[1L]]))
  expect_true(is.na(desc$required_scalar_version[[1L]]))
  expect_equal(DBI::dbGetQuery(con, paste0(
    "SELECT count(*) AS n FROM profile_resource_comparison_publication ",
    "WHERE indicator_id='reseaux'"))$n[[1L]], 1L)
  expect_equal(DBI::dbGetQuery(con,
    "SELECT count(*) AS n FROM scalar_observation")$n[[1L]], 0L)
})
