#!/usr/bin/env Rscript
# Opt-in integration smoke against a dedicated lusk_it_* database. Never reads
# production configuration; requires explicit LUSK_SCALAR_TEST_* variables.
pkgload::load_all(".", quiet=TRUE)
required <- c("HOST", "PORT", "DATABASE", "USER")
config <- setNames(lapply(required, function(suffix)
  Sys.getenv(paste0("LUSK_SCALAR_TEST_", suffix), unset="")), required)
stopifnot(all(vapply(config, nzchar, logical(1))),
          grepl("^lusk_it_[A-Za-z0-9_]+$", config$DATABASE),
          !tolower(config$DATABASE) %in% c("lusk", "postgres", "template0", "template1"),
          grepl("^[A-Za-z0-9_.:-]+$", config$HOST),
          grepl("^[0-9]+$", config$PORT))
expected_config <- c(HOST="192.168.1.120", PORT="5432",
  DATABASE="lusk_it_contract", USER="lusk_it_contract_pub")
if (!identical(unlist(config), expected_config))
  stop("Refusing scalar smoke: only the documented lusk_it_contract publisher target is allowed", call.=FALSE)
if (!requireNamespace("RPostgres", quietly=TRUE) || !requireNamespace("DBI", quietly=TRUE))
  stop("DBI and RPostgres are required")
passfile <- Sys.getenv("PGPASSFILE", unset="")
if (!nzchar(passfile) || !file.exists(passfile) ||
    startsWith(tolower(normalizePath(passfile, winslash="/")),
      tolower(normalizePath("..", winslash="/"))))
  stop("PGPASSFILE must point to the existing private libpq file outside the repository", call.=FALSE)

Sys.setenv(PGCONNECT_TIMEOUT="5",
  PGOPTIONS="-c statement_timeout=120000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=180000")
connection <- DBI::dbConnect(RPostgres::Postgres(), host=config$HOST,
  port=as.integer(config$PORT), dbname=config$DATABASE, user=config$USER)
identity <- DBI::dbGetQuery(connection, paste(
  "SELECT current_database() AS database, current_user AS role,",
  "inet_server_addr()::text AS server_address"))
if (nrow(identity) != 1L || identity$database[[1L]] != "lusk_it_contract" ||
    identity$role[[1L]] != "lusk_it_contract_pub" ||
    identity$server_address[[1L]] != "192.168.16.3/32") {
  DBI::dbDisconnect(connection)
  stop("Refusing scalar smoke: publisher connection identity does not match the guarded test server", call.=FALSE)
}
reader_connection <- DBI::dbConnect(RPostgres::Postgres(), host=config$HOST,
  port=as.integer(config$PORT), dbname=config$DATABASE, user="lusk_it_contract_read")
reader_identity <- DBI::dbGetQuery(reader_connection, paste(
  "SELECT current_database() AS database, current_user AS role,",
  "inet_server_addr()::text AS server_address"))
DBI::dbDisconnect(reader_connection)
if (nrow(reader_identity) != 1L || reader_identity$database[[1L]] != "lusk_it_contract" ||
    reader_identity$role[[1L]] != "lusk_it_contract_read" ||
    reader_identity$server_address[[1L]] != "192.168.16.3/32") {
  DBI::dbDisconnect(connection)
  stop("Refusing scalar smoke: reader connection identity does not match the guarded test server", call.=FALSE)
}
schema <- paste0("scalar_it_", Sys.getpid(), "_", sprintf("%08x", sample.int(.Machine$integer.max, 1L)))
created <- FALSE
smoke_failure <- NULL
tryCatch({
  DBI::dbExecute(connection, paste0("CREATE SCHEMA ", as.character(DBI::dbQuoteIdentifier(connection, schema))))
  created <- TRUE
  cat("Scalar smoke schema created:", schema, "\n")
  DBI::dbExecute(connection, paste0("SET search_path TO ", as.character(DBI::dbQuoteIdentifier(connection, schema))))
  schema_sql <- paste(readLines(file.path("..", "api", "schema.sql"), warn=FALSE), collapse="\n")
  for (statement in split_postgres_sql(schema_sql)) DBI::dbExecute(connection, statement)

  fixture <- readr::read_csv("tests/testthat/fixtures/demographie-fixture.csv",
    col_types=readr::cols(code=readr::col_character(), epci=readr::col_character()),
    show_col_types=FALSE)
  payload <- compute_payload(fixture)
  descriptor <- jsonlite::fromJSON("inst/extdata/theme-metadata/theme_demographie.json", simplifyVector=FALSE)
  projection <- project_fixture_scalar(payload, descriptor, "dense_complete")
  # Add explicit test-only lineage to exercise the multi-source normalized
  # association contract. No fabricated source is used by production projection.
  extra <- "integration_secondary"
  projection$descriptors$allowed_sources[[1L]] <- c(projection$descriptors$allowed_sources[[1L]], extra)
  projection$datasets <- rbind(projection$datasets, data.frame(source_id=extra, name="Integration secondary"))
  secondary_vintage <- paste0("synthetic/", projection$vintages$vintage_id[[1L]])
  v <- projection$vintages[1L, , drop=FALSE]
  v$source_id <- extra; v$vintage_id <- secondary_vintage
  v$version <- paste0("synthetic-", v$version)
  projection$vintages <- rbind(projection$vintages, v)
  secondary <- projection$provenance
  secondary$source_id <- extra; secondary$vintage_id <- secondary_vintage
  projection$provenance <- rbind(projection$provenance, secondary)

  territory_rows <- projection$eligible_territories
  territory_rows$name <- territory_rows$territory_id
  territory_rows$department_id <- NA_character_
  territory_rows$epci_id <- NA_character_
  territory_rows$density_class_code <- NA_character_
  territory_rows$density_class_label <- NA_character_
  DBI::dbWriteTable(connection, "territory_reference", territory_rows,
    append=TRUE, row.names=FALSE)
  DBI::dbExecute(connection, "INSERT INTO table_publication(table_name,content_version,row_count) VALUES('territory_reference','reference-smoke-v1',$1)",
    params=list(nrow(territory_rows)))

  registry <- register_scalar_publisher(list(), "smoke", function(x) projection,
    function(p, db, version) db$replace(p, version))
  adapter <- scalar_postgres_adapter(connection)
  first <- publish_registered_scalar(registry, "smoke", NULL, adapter)
  marker <- DBI::dbGetQuery(connection, "SELECT content_version, row_count, reference_content_version FROM table_publication WHERE table_name='scalar_observation'")
  stopifnot(first$changed, marker$row_count[[1L]] == nrow(projection$facts))
  actual <- DBI::dbGetQuery(connection, "SELECT o.territory_id,o.value,o.status,d.theme_id,d.label,d.descriptor_version,p.content_version,(SELECT count(*) FROM scalar_observation_source s WHERE s.indicator_id=o.indicator_id AND s.territory_id=o.territory_id) AS source_count FROM scalar_observation o JOIN scalar_descriptor d USING(indicator_id) CROSS JOIN table_publication p WHERE p.table_name='scalar_observation' AND o.indicator_id='densite' ORDER BY o.territory_id LIMIT 1")
  actual_sources <- DBI::dbGetQuery(connection, "SELECT os.source_id,os.vintage_id,sv.version FROM scalar_observation_source os JOIN source_vintage sv USING(source_id,vintage_id) WHERE os.indicator_id='densite' AND os.territory_id=$1 ORDER BY os.source_id", params=list(actual$territory_id[[1L]]))
  expected <- projection$facts[order(projection$facts$territory_id), , drop=FALSE][1L, , drop=FALSE]
  expected_sources <- projection$provenance[projection$provenance$territory_id == expected$territory_id[[1L]], , drop=FALSE]
  expected_vintages <- projection$vintages[match(paste(expected_sources$source_id, expected_sources$vintage_id),
    paste(projection$vintages$source_id, projection$vintages$vintage_id)), , drop=FALSE]
  stopifnot(nrow(actual)==1L, actual$source_count[[1L]]==2L,
    identical(actual$content_version[[1L]], marker$content_version[[1L]]),
    identical(actual$territory_id[[1L]], expected$territory_id[[1L]]),
    identical(actual$value[[1L]], expected$value[[1L]]),
    identical(actual$status[[1L]], expected$status[[1L]]),
    identical(actual$theme_id[[1L]], projection$descriptors$theme_id[match("densite", projection$descriptors$indicator_id)]),
    identical(actual$label[[1L]], projection$descriptors$label[[1L]]),
    identical(actual$descriptor_version[[1L]], projection$descriptors$descriptor_version[[1L]]),
    setequal(actual_sources$source_id, projection$descriptors$allowed_sources[[1L]]),
    setequal(paste(actual_sources$source_id, actual_sources$vintage_id),
      paste(expected_sources$source_id, expected_sources$vintage_id)),
    setequal(actual_sources$version, expected_vintages$version),
    nrow(actual_sources)==2L)
  no_op <- publish_registered_scalar(registry, "smoke", NULL, adapter)
  stopifnot(!no_op$changed)

  # Rebinding the territory dependency must not change scalar content identity.
  DBI::dbExecute(connection, "UPDATE table_publication SET content_version='reference-smoke-v2' WHERE table_name='territory_reference'")
  rebound <- publish_registered_scalar(registry, "smoke", NULL, adapter)
  after_rebind <- DBI::dbGetQuery(connection, "SELECT content_version,reference_content_version FROM table_publication WHERE table_name='scalar_observation'")
  stopifnot(!rebound$changed, rebound$compatibility_updated,
    identical(after_rebind$content_version[[1L]], marker$content_version[[1L]]),
    identical(after_rebind$reference_content_version[[1L]], "reference-smoke-v2"))

  # Simulate a local commit newer than the DB marker and verify idempotent retry.
  DBI::dbExecute(connection, "UPDATE table_publication SET content_version='db-behind' WHERE table_name='scalar_observation'")
  retry <- publish_registered_scalar(registry, "smoke", NULL, adapter)
  stopifnot(retry$changed, identical(DBI::dbGetQuery(connection,
    "SELECT content_version FROM table_publication WHERE table_name='scalar_observation'")$content_version[[1L]], marker$content_version[[1L]]))

  # Inject a transaction-local failure after replacement begins; old rows and
  # marker must both survive rollback.
  DBI::dbExecute(connection, "CREATE FUNCTION reject_smoke_value() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.value=-999999 THEN RAISE EXCEPTION 'injected scalar smoke failure'; END IF; RETURN NEW; END $$")
  DBI::dbExecute(connection, "CREATE TRIGGER reject_smoke_value BEFORE INSERT ON scalar_observation FOR EACH ROW EXECUTE FUNCTION reject_smoke_value()")
  failing <- register_scalar_publisher(list(), "fail", function(x) {
    p <- projection; p$facts$value[[1L]] <- -999999; p
  }, function(p, db, version) db$replace(p, version))
  previous_rows <- DBI::dbGetQuery(connection, "SELECT count(*) AS n FROM scalar_observation")$n[[1L]]
  previous_marker <- DBI::dbGetQuery(connection, "SELECT content_version FROM table_publication WHERE table_name='scalar_observation'")$content_version[[1L]]
  previous_fact <- DBI::dbGetQuery(connection, "SELECT value,status FROM scalar_observation WHERE indicator_id='densite' ORDER BY territory_id LIMIT 1")
  failed <- try(publish_registered_scalar(failing, "fail", NULL, adapter), silent=TRUE)
  stopifnot(inherits(failed, "try-error"),
    DBI::dbGetQuery(connection, "SELECT count(*) AS n FROM scalar_observation")$n[[1L]] == previous_rows,
    identical(DBI::dbGetQuery(connection, "SELECT value,status FROM scalar_observation WHERE indicator_id='densite' ORDER BY territory_id LIMIT 1"), previous_fact),
    identical(DBI::dbGetQuery(connection, "SELECT content_version FROM table_publication WHERE table_name='scalar_observation'")$content_version[[1L]], previous_marker))

  # Exercise the retained producer-owned scalar artifacts against the current
  # schema, starting from a valid populated scalar publication (no migration replay).
  DBI::dbExecute(connection, "DROP TRIGGER reject_smoke_value ON scalar_observation")
  DBI::dbExecute(connection, "DROP FUNCTION reject_smoke_value()")
  DBI::dbExecute(connection, "DELETE FROM scalar_observation_source")
  DBI::dbExecute(connection, "DELETE FROM scalar_observation")
  DBI::dbExecute(connection, "DELETE FROM scalar_descriptor_source")
  DBI::dbExecute(connection, "DELETE FROM scalar_descriptor")
  DBI::dbExecute(connection, "DELETE FROM table_publication WHERE table_name='scalar_observation'")
  DBI::dbExecute(connection, "DELETE FROM territory_reference")
  public <- file.path("..", "public", "data")
  artifacts <- tempfile("retained-scalar-artifacts-"); dir.create(artifacts)
  territories <- nanoparquet::read_parquet(file.path(public, "territoires.parquet"))
  vintages <- nanoparquet::read_parquet(file.path(public, "vintages.parquet"))
  themes <- retained_scalar_artifact_owners()
  for (theme in themes) {
    payload <- list(indicateurs=lire_indicateurs_commis(theme, public), territoires=territories)
    # The committed public Parquets are paired with their own producer metadata
    # vintage; current in-package metadata may have moved source vintages on.
    metadata <- jsonlite::fromJSON(file.path(public, paste0("theme_", theme, ".json")),
      simplifyVector=FALSE)
    materialize_theme_scalar_artifact(payload, metadata, vintages, theme, artifacts)
  }
  reference <- project_territory_reference(territories)
  publish_territory_reference_projection(reference,
    territory_reference_postgres_adapter(connection))

  # Start from a valid populated scalar publication assembled from the actual
  # producer artifacts, including metadata-declared legacy descriptors.
  legacy_cohorts <- lapply(themes, function(theme)
    read_scalar_serving_artifact(file.path(artifacts, "scalar-serving", theme)))
  legacy_scalar <- assemble_scalar_snapshot(legacy_cohorts[[1L]], legacy_cohorts[-1L])
  legacy_registry <- register_scalar_publisher(list(), "legacy_populated",
    project=function(x) legacy_scalar,
    publish=function(p, db, version) db$replace(p, version))
  legacy_publication <- publish_registered_scalar(legacy_registry, "legacy_populated",
    NULL, scalar_postgres_adapter(connection))
  legacy_comparison <- project_scalar_comparisons(legacy_scalar, reference$rows,
    scalar_content_version(legacy_scalar), reference$content_version)
  publish_registered_scalar_comparison(legacy_comparison,
    scalar_comparison_postgres_adapter(connection))
  snapshot <- project_retained_scalar_snapshot(public, reference, artifacts)
  retired_ids <- snapshot$retired_indicator_ids
  legacy_retired_ids <- intersect(retired_ids, legacy_scalar$descriptors$indicator_id)
  legacy_comparison_ids <- intersect(legacy_retired_ids, legacy_comparison$groups$indicator_id)
  stopifnot(legacy_publication$changed, length(legacy_retired_ids) > 0L,
    length(legacy_comparison_ids) > 0L)
  legacy_indicator <- legacy_comparison_ids[[1L]]
  stopifnot(DBI::dbGetQuery(connection,
    "SELECT count(*) AS n FROM scalar_descriptor WHERE indicator_id=$1",
    params=list(legacy_indicator))$n[[1L]] == 1L,
    DBI::dbGetQuery(connection,
      "SELECT count(*) AS n FROM scalar_observation_source WHERE indicator_id=$1",
      params=list(legacy_indicator))$n[[1L]] > 0L,
    DBI::dbGetQuery(connection,
      "SELECT count(*) AS n FROM scalar_comparison_group WHERE indicator_id=$1",
      params=list(legacy_indicator))$n[[1L]] > 0L,
    DBI::dbGetQuery(connection,
      "SELECT count(*) AS n FROM scalar_comparison_territory WHERE indicator_id=$1",
      params=list(legacy_indicator))$n[[1L]] > 0L)

  snapshot_sql <- function() list(
    facts=DBI::dbGetQuery(connection, "SELECT * FROM scalar_observation ORDER BY indicator_id,territory_id"),
    descriptors=DBI::dbGetQuery(connection, "SELECT * FROM scalar_descriptor ORDER BY indicator_id"),
    descriptor_sources=DBI::dbGetQuery(connection, "SELECT * FROM scalar_descriptor_source ORDER BY indicator_id,source_id"),
    sources=DBI::dbGetQuery(connection, "SELECT * FROM scalar_observation_source ORDER BY indicator_id,territory_id,source_id,vintage_id"),
    datasets=DBI::dbGetQuery(connection, "SELECT * FROM source_dataset ORDER BY source_id"),
    vintages=DBI::dbGetQuery(connection, "SELECT * FROM source_vintage ORDER BY source_id,vintage_id"),
    marker=DBI::dbGetQuery(connection, "SELECT content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name='scalar_observation'"),
    clocks=DBI::dbGetQuery(connection, "SELECT * FROM table_publication ORDER BY table_name"),
    comparison_groups=DBI::dbGetQuery(connection, "SELECT * FROM scalar_comparison_group ORDER BY comparison_context,group_id,territory_type,indicator_id"),
    comparison_territories=DBI::dbGetQuery(connection, "SELECT * FROM scalar_comparison_territory ORDER BY comparison_context,group_id,territory_type,indicator_id,territory_id"),
    comparison_lineage=DBI::dbGetQuery(connection, "SELECT * FROM comparison_source_lineage ORDER BY comparison_family,comparison_context,group_id,territory_type,facet_id,source_id,vintage_id"),
    comparison_marker=DBI::dbGetQuery(connection, "SELECT * FROM scalar_comparison_publication WHERE singleton"))
  legacy_state <- snapshot_sql()
  stopifnot(legacy_state$comparison_marker$scalar_content_version[[1L]] ==
      scalar_content_version(legacy_scalar),
    nrow(legacy_state$comparison_groups) > 0L,
    nrow(legacy_state$comparison_territories) > 0L)
  setTimeLimit(elapsed=180, transient=TRUE)
  published <- tryCatch(publish_retained_scalar_snapshot(connection, snapshot, tempdir())$scalar,
    finally=setTimeLimit(cpu=Inf, elapsed=Inf, transient=FALSE))
  actual_descriptor_ids <- DBI::dbGetQuery(connection,
    "SELECT indicator_id FROM scalar_descriptor")$indicator_id
  stopifnot(published$changed,
    setequal(actual_descriptor_ids, snapshot$scalar$descriptors$indicator_id),
    !any(actual_descriptor_ids %in% retired_ids),
    DBI::dbGetQuery(connection, "SELECT count(*) AS n FROM scalar_observation")$n[[1L]] ==
      nrow(snapshot$scalar$facts))

  retained_facts <- snapshot$scalar$facts[
    order(snapshot$scalar$facts$indicator_id, snapshot$scalar$facts$territory_id), , drop=FALSE]
  actual_facts <- DBI::dbGetQuery(connection, paste(
    "SELECT indicator_id,territory_id,territory_type,value,status,support_count,denominator_count",
    "FROM scalar_observation ORDER BY indicator_id,territory_id"))
  stopifnot(identical(as.character(actual_facts$indicator_id), retained_facts$indicator_id),
    identical(as.character(actual_facts$territory_id), retained_facts$territory_id),
    identical(as.character(actual_facts$territory_type), retained_facts$territory_type),
    isTRUE(all.equal(as.numeric(actual_facts$value), retained_facts$value)),
    identical(as.character(actual_facts$status), retained_facts$status),
    identical(as.integer(actual_facts$support_count), retained_facts$support_count),
    identical(as.integer(actual_facts$denominator_count), retained_facts$denominator_count))
  retained_sources <- snapshot$scalar$provenance[
    do.call(order, snapshot$scalar$provenance[
      c("indicator_id", "territory_id", "source_id", "vintage_id")]), , drop=FALSE]
  rownames(retained_sources) <- NULL
  actual_sources <- DBI::dbGetQuery(connection, paste(
    "SELECT indicator_id,territory_id,source_id,vintage_id FROM scalar_observation_source",
    "ORDER BY indicator_id,territory_id,source_id,vintage_id"))
  stopifnot(identical(actual_sources, retained_sources))
  scalar_clock <- DBI::dbGetQuery(connection, paste(
    "SELECT content_version,row_count,reference_content_version FROM table_publication",
    "WHERE table_name='scalar_observation'"))
  comparison_marker <- DBI::dbGetQuery(connection,
    "SELECT * FROM scalar_comparison_publication WHERE singleton")
  stopifnot(identical(scalar_clock$content_version[[1L]], published$content_version),
    scalar_clock$row_count[[1L]] == nrow(snapshot$scalar$facts),
    identical(scalar_clock$reference_content_version[[1L]], reference$content_version),
    identical(comparison_marker$scalar_content_version[[1L]], published$content_version),
    identical(comparison_marker$reference_content_version[[1L]], reference$content_version),
    comparison_marker$group_row_count[[1L]] == nrow(snapshot$comparison$groups),
    comparison_marker$territory_row_count[[1L]] == nrow(snapshot$comparison$territories),
    comparison_marker$lineage_row_count[[1L]] == nrow(snapshot$comparison$lineage),
    !any(DBI::dbGetQuery(connection,
      "SELECT indicator_id FROM scalar_comparison_group")$indicator_id %in% retired_ids),
    !any(DBI::dbGetQuery(connection,
      "SELECT facet_id FROM comparison_source_lineage WHERE comparison_family='scalar'")$facet_id %in% retired_ids))
  stopifnot("part_passoires" %in% snapshot$scalar$descriptors$indicator_id)
  housing_rows <- DBI::dbGetQuery(connection,
    "SELECT o.territory_id,o.value,o.status,o.support_count,o.denominator_count FROM scalar_observation o WHERE o.indicator_id='part_passoires' ORDER BY o.territory_id")
  expected_housing <- snapshot$scalar$facts[snapshot$scalar$facts$indicator_id == "part_passoires", , drop=FALSE]
  expected_housing <- expected_housing[order(expected_housing$territory_id), , drop=FALSE]
  stopifnot(identical(as.character(housing_rows$territory_id), expected_housing$territory_id),
    isTRUE(all.equal(housing_rows$value, expected_housing$value)),
    identical(as.character(housing_rows$status), expected_housing$status),
    identical(as.integer(housing_rows$support_count), expected_housing$support_count),
    identical(as.integer(housing_rows$denominator_count), expected_housing$denominator_count))

  committed <- snapshot_sql()
  no_op <- publish_retained_scalar_snapshot(connection, snapshot, tempdir())$scalar
  stopifnot(!no_op$changed, !no_op$retirement_repaired,
    identical(snapshot_sql(), committed))

  # Inject failure after DELETE/reinsert begins; PostgreSQL transaction rollback
  # must preserve facts, descriptors, provenance, content version, and timestamp.
  DBI::dbExecute(connection, "CREATE FUNCTION reject_combined_smoke_value() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.value=-999999 THEN RAISE EXCEPTION 'injected combined scalar smoke failure'; END IF; RETURN NEW; END $$")
  DBI::dbExecute(connection, "CREATE TRIGGER reject_combined_smoke_value BEFORE INSERT ON scalar_observation FOR EACH ROW EXECUTE FUNCTION reject_combined_smoke_value()")
  changed <- snapshot$scalar
  changed$facts$value[[1L]] <- -999999
  failing_registry <- register_scalar_publisher(list(), "retained_failure",
    function(x) changed, function(p, db, version) db$replace(p, version))
  failed_combined <- try(publish_registered_scalar(failing_registry, "retained_failure",
    NULL, scalar_postgres_adapter(connection)), silent=TRUE)
  stopifnot(inherits(failed_combined, "try-error"), identical(snapshot_sql(), committed))
  DBI::dbExecute(connection, "DROP TRIGGER reject_combined_smoke_value ON scalar_observation")
  DBI::dbExecute(connection, "DROP FUNCTION reject_combined_smoke_value()")

  # Publish one valid but undeclared scalar through the generic publisher, then
  # prove both the generic strict path and retained policy reject dropping it
  # without changing facts, provenance, comparison rows, markers, or clocks.
  source_indicator <- snapshot$scalar$descriptors$indicator_id[[1L]]
  unapproved_id <- "unapproved_test_scalar"
  unapproved <- snapshot$scalar
  new_descriptor <- unapproved$descriptors[1L, , drop=FALSE]
  new_descriptor$indicator_id <- unapproved_id
  new_descriptor$descriptor_version <- "issue-812-test"
  if (!is.na(new_descriptor$comparison_facet[[1L]]))
    new_descriptor$comparison_facet <- unapproved_id
  new_facts <- unapproved$facts[unapproved$facts$indicator_id == source_indicator, , drop=FALSE]
  new_facts$indicator_id <- unapproved_id
  new_provenance <- unapproved$provenance[
    unapproved$provenance$indicator_id == source_indicator, , drop=FALSE]
  new_provenance$indicator_id <- unapproved_id
  unapproved$descriptors <- rbind(unapproved$descriptors, new_descriptor)
  unapproved$facts <- rbind(unapproved$facts, new_facts)
  unapproved$provenance <- rbind(unapproved$provenance, new_provenance)
  validate_scalar_projection(unapproved$facts, unapproved$descriptors,
    unapproved$eligible_territories)
  unapproved_registry <- register_scalar_publisher(list(), "unapproved_extension",
    project=function(x) unapproved,
    publish=function(p, db, version) db$replace(p, version))
  unapproved_publication <- publish_registered_scalar(unapproved_registry,
    "unapproved_extension", NULL, scalar_postgres_adapter(connection))
  stopifnot(unapproved_publication$changed)
  unapproved_state <- snapshot_sql()
  generic_guard <- try(scalar_postgres_adapter(connection)$validate_snapshot(
    snapshot$scalar, character()), silent=TRUE)
  retained_guard <- try(scalar_postgres_adapter(connection)$validate_snapshot(
    snapshot$scalar, retired_ids), silent=TRUE)
  guard_message <- function(value) conditionMessage(attr(value, "condition"))
  stopifnot(unapproved_id %in% unapproved_state$descriptors$indicator_id,
    inherits(generic_guard, "try-error"),
    grepl("Refusing partial scalar snapshot", guard_message(generic_guard), fixed=TRUE),
    inherits(retained_guard, "try-error"),
    grepl("Refusing partial scalar snapshot", guard_message(retained_guard), fixed=TRUE),
    identical(snapshot_sql(), unapproved_state))
  generic_rejection <- try(publish_registered_scalar(
    register_scalar_publisher(list(), "strict_retained", identity,
      function(p, db, version) db$replace(p, version)),
    "strict_retained", snapshot$scalar, scalar_postgres_adapter(connection)), silent=TRUE)
  stopifnot(inherits(generic_rejection, "try-error"),
    identical(snapshot_sql(), unapproved_state))
  retained_rejection <- try(publish_retained_scalar_snapshot(
    connection, snapshot, tempdir()), silent=TRUE)
  stopifnot(inherits(retained_rejection, "try-error"),
    identical(snapshot_sql(), unapproved_state))

  stopifnot(is.na(DBI::dbGetQuery(connection,
    "SELECT to_regclass('service_registry') AS name")$name[[1L]]),
    is.na(DBI::dbGetQuery(connection,
    "SELECT to_regclass('building_ramp') AS name")$name[[1L]]))

  # Run the actual FastAPI scalar route against this same owned schema using the
  # separate read-only rehearsal role, rather than merely checking SQL text.
  DBI::dbExecute(connection, paste0("GRANT USAGE ON SCHEMA ",
    as.character(DBI::dbQuoteIdentifier(connection, schema)), " TO lusk_it_contract_read"))
  DBI::dbExecute(connection, paste0("GRANT SELECT ON ALL TABLES IN SCHEMA ",
    as.character(DBI::dbQuoteIdentifier(connection, schema)), " TO lusk_it_contract_read"))
  economy_fact <- snapshot$scalar$facts[
    snapshot$scalar$facts$territory_type == "commune" &
      snapshot$scalar$facts$status == "measured", , drop=FALSE][1L, , drop=FALSE]
  Sys.setenv(LUSK_SCALAR_API_TEST_TERRITORY=economy_fact$territory_id[[1L]],
    LUSK_SCALAR_API_TEST_INDICATOR=economy_fact$indicator_id[[1L]],
    LUSK_SCALAR_API_TEST_VALUE=as.character(economy_fact$value[[1L]]),
    LUSK_SCALAR_API_TEST_SCHEMA=schema,
    PGPASSFILE=passfile,
    DATABASE_URL="postgresql://lusk_it_contract_read@192.168.1.120:5432/lusk_it_contract")
  api_code <- paste(c(
    "import os, sys; sys.path.insert(0, '..')",
    "from fastapi.testclient import TestClient",
    "from api.main import app",
    "schema=os.environ['LUSK_SCALAR_API_TEST_SCHEMA']",
    "os.environ['PGOPTIONS']='-c search_path='+schema+' -c statement_timeout=120000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=180000'",
    "with TestClient(app) as client:",
    " r=client.get('/api/territories/commune/'+os.environ['LUSK_SCALAR_API_TEST_TERRITORY']+'/indicators/'+os.environ['LUSK_SCALAR_API_TEST_INDICATOR'])",
    " r=client.post('/api/resources/read', json={'resource':os.environ['LUSK_SCALAR_API_TEST_INDICATOR'],'target':{'kind':'territory','type':'commune','id':os.environ['LUSK_SCALAR_API_TEST_TERRITORY']},'intent':{'kind':'facts'}})",
    " assert r.status_code==200, r.text",
    " d=r.json(); assert d['indicator_id']==os.environ['LUSK_SCALAR_API_TEST_INDICATOR']",
    " assert d['value']==float(os.environ['LUSK_SCALAR_API_TEST_VALUE'])",
    " assert d['sources'] and d['content_version']"
  ), collapse="\n")
  api_status <- system2("python", c("-c", shQuote(api_code, type="cmd")), timeout=120)
  stopifnot(identical(api_status, 0L))
  cat("Scalar PostgreSQL and combined snapshot smoke passed; schema:", schema, "\n")
}, error=function(e) {
  smoke_failure <<- conditionMessage(e)
  stop(e)
}, finally={
  if (exists("artifacts", inherits=FALSE)) unlink(artifacts, recursive=TRUE)
  if (created && identical(Sys.getenv("LUSK_SCALAR_TEST_CLEANUP", "0"), "1")) {
    tryCatch({
      cleanup_serving_smoke_schema(connection, schema, "scalar")
      cat("Scalar smoke schema cleaned with RESTRICT:", schema, "\n")
    }, error=function(e) stop("Could not clean scalar smoke schema ", schema,
      " (inspect and remove manually): ", conditionMessage(e),
      if (!is.null(smoke_failure)) paste0("; original smoke error: ", smoke_failure) else "", call.=FALSE))
  }
  DBI::dbDisconnect(connection)
})
