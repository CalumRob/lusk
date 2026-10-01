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
if (!requireNamespace("RPostgres", quietly=TRUE) || !requireNamespace("DBI", quietly=TRUE))
  stop("DBI and RPostgres are required")
passfile <- Sys.getenv("PGPASSFILE", unset="")
if (!nzchar(passfile) || !file.exists(passfile) ||
    startsWith(tolower(normalizePath(passfile, winslash="/")),
      tolower(normalizePath("..", winslash="/"))))
  stop("PGPASSFILE must point to the existing private libpq file outside the repository", call.=FALSE)

connection <- DBI::dbConnect(RPostgres::Postgres(), host=config$HOST,
  port=as.integer(config$PORT), dbname=config$DATABASE, user=config$USER)
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
  actual <- DBI::dbGetQuery(connection, "SELECT o.territory_id,o.value,o.status,d.label,d.descriptor_version,p.content_version,(SELECT count(*) FROM scalar_observation_source s WHERE s.indicator_id=o.indicator_id AND s.territory_id=o.territory_id) AS source_count FROM scalar_observation o JOIN scalar_descriptor d USING(indicator_id) CROSS JOIN table_publication p WHERE p.table_name='scalar_observation' AND o.indicator_id='densite' ORDER BY o.territory_id LIMIT 1")
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

  # Exercise the real table-level Services + economy + demography + mobility + housing assembly against canonical
  # producer Parquet, then the existing publisher wrapper and PostgreSQL adapter.
  DBI::dbExecute(connection, "DROP TRIGGER reject_smoke_value ON scalar_observation")
  DBI::dbExecute(connection, "DROP FUNCTION reject_smoke_value()")
  DBI::dbExecute(connection, "DELETE FROM scalar_observation_source")
  DBI::dbExecute(connection, "DELETE FROM scalar_observation")
  DBI::dbExecute(connection, "DELETE FROM scalar_descriptor_source")
  DBI::dbExecute(connection, "DELETE FROM scalar_descriptor")
  DBI::dbExecute(connection, "DELETE FROM table_publication WHERE table_name='scalar_observation'")
  DBI::dbExecute(connection, "DELETE FROM territory_reference")
  service_data <- preparer_tables_service(file.path("..", "public", "data"))
  snapshot <- project_service_scalar_snapshot(service_data, file.path("..", "public", "data"))
  DBI::dbWriteTable(connection, "service_registry", service_data$tables$service_registry,
    append=TRUE, row.names=FALSE)
  refs <- service_data$tables$territory_reference
  DBI::dbWriteTable(connection, "territory_reference", refs, append=TRUE, row.names=FALSE)
  reference_version <- service_data$versions[["territory_reference"]]
  DBI::dbExecute(connection, "INSERT INTO table_publication(table_name,content_version,row_count) VALUES('territory_reference',$1,$2) ON CONFLICT(table_name) DO UPDATE SET content_version=EXCLUDED.content_version,row_count=EXCLUDED.row_count,published_at=now()",
    params=list(reference_version, nrow(refs)))
  published <- publish_service_share_scalars(connection, service_data$scalar_access,
    service_data$scalar_metadata, service_data$scalar_eligible_territories,
    additional_projections=snapshot$additional_projections)
  stopifnot(published$changed,
    setequal(DBI::dbGetQuery(connection, "SELECT indicator_id FROM scalar_descriptor")$indicator_id,
      snapshot$projection$descriptors$indicator_id),
    DBI::dbGetQuery(connection, "SELECT count(*) AS n FROM scalar_observation")$n[[1L]] ==
      nrow(snapshot$projection$facts))
  stopifnot(all(c("surface_reseaux_routiers", "offre_tc", "bornes_recharge",
    "densite", "taille_menages", "effectifs_salaries", "chomage", "part_passoires") %in%
    snapshot$projection$descriptors$indicator_id))
  housing_rows <- DBI::dbGetQuery(connection,
    "SELECT o.territory_id,o.value,o.status,o.support_count,o.denominator_count FROM scalar_observation o WHERE o.indicator_id='part_passoires' ORDER BY o.territory_id")
  expected_housing <- snapshot$projection$facts[snapshot$projection$facts$indicator_id == "part_passoires", , drop=FALSE]
  expected_housing <- expected_housing[order(expected_housing$territory_id), , drop=FALSE]
  stopifnot(identical(as.character(housing_rows$territory_id), expected_housing$territory_id),
    isTRUE(all.equal(housing_rows$value, expected_housing$value)),
    identical(as.character(housing_rows$status), expected_housing$status),
    identical(as.integer(housing_rows$support_count), expected_housing$support_count),
    identical(as.integer(housing_rows$denominator_count), expected_housing$denominator_count))

  snapshot_sql <- function() list(
    facts=DBI::dbGetQuery(connection, "SELECT * FROM scalar_observation ORDER BY indicator_id,territory_id"),
    descriptors=DBI::dbGetQuery(connection, "SELECT * FROM scalar_descriptor ORDER BY indicator_id"),
    sources=DBI::dbGetQuery(connection, "SELECT * FROM scalar_observation_source ORDER BY indicator_id,territory_id,source_id,vintage_id"),
    marker=DBI::dbGetQuery(connection, "SELECT content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name='scalar_observation'"))
  committed <- snapshot_sql()
  # The old service-only projection must fail closed and leave both cohorts and
  # their marker untouched; the complete unchanged retry is a no-op.
  partial <- try(publish_service_share_scalars(connection, service_data$scalar_access,
    service_data$scalar_metadata, service_data$scalar_eligible_territories), silent=TRUE)
  stopifnot(inherits(partial, "try-error"), identical(snapshot_sql(), committed))
  no_op <- publish_service_share_scalars(connection, service_data$scalar_access,
    service_data$scalar_metadata, service_data$scalar_eligible_territories,
    additional_projections=snapshot$additional_projections)
  stopifnot(!no_op$changed, identical(snapshot_sql(), committed))

  # Inject failure after DELETE/reinsert begins; PostgreSQL transaction rollback
  # must preserve facts, descriptors, provenance, content version, and timestamp.
  DBI::dbExecute(connection, "CREATE FUNCTION reject_combined_smoke_value() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.value=-999999 THEN RAISE EXCEPTION 'injected combined scalar smoke failure'; END IF; RETURN NEW; END $$")
  DBI::dbExecute(connection, "CREATE TRIGGER reject_combined_smoke_value BEFORE INSERT ON scalar_observation FOR EACH ROW EXECUTE FUNCTION reject_combined_smoke_value()")
  changed <- service_data$scalar_access
  changed$value[[1L]] <- -999999
  failed_combined <- try(publish_service_share_scalars(connection, changed,
    service_data$scalar_metadata, service_data$scalar_eligible_territories,
    additional_projections=snapshot$additional_projections), silent=TRUE)
  stopifnot(inherits(failed_combined, "try-error"), identical(snapshot_sql(), committed))
  DBI::dbExecute(connection, "DROP TRIGGER reject_combined_smoke_value ON scalar_observation")
  DBI::dbExecute(connection, "DROP FUNCTION reject_combined_smoke_value()")

  # Execute the same registered-service ID membership shape used by the API;
  # economy keys coexist in the table but cannot leak into service decoding.
  service_ids <- DBI::dbGetQuery(connection,
    "SELECT DISTINCT 'share_' || service || '_' || mode AS indicator_id FROM service_registry CROSS JOIN unnest(ARRAY['t','b','c']::text[]) AS mode")$indicator_id
  service_fact_ids <- DBI::dbGetQuery(connection,
    "SELECT DISTINCT o.indicator_id FROM scalar_observation o WHERE o.indicator_id=ANY(SELECT 'share_' || service || '_' || mode FROM service_registry CROSS JOIN unnest(ARRAY['t','b','c']::text[]) AS mode)")$indicator_id
  stopifnot(setequal(service_ids, service_data$scalar_metadata$indicator_keys[
    service_data$scalar_metadata$indicator_keys %in% service_ids]),
    setequal(service_fact_ids, service_ids),
    !any(c("effectifs_salaries", "chomage") %in% service_fact_ids))

  # Run the actual FastAPI scalar route against this same owned schema using the
  # separate read-only rehearsal role, rather than merely checking SQL text.
  DBI::dbExecute(connection, paste0("GRANT USAGE ON SCHEMA ",
    as.character(DBI::dbQuoteIdentifier(connection, schema)), " TO lusk_it_contract_read"))
  DBI::dbExecute(connection, paste0("GRANT SELECT ON ALL TABLES IN SCHEMA ",
    as.character(DBI::dbQuoteIdentifier(connection, schema)), " TO lusk_it_contract_read"))
  economy_fact <- snapshot$projection$facts[
    snapshot$projection$facts$indicator_id == "effectifs_salaries" &
      snapshot$projection$facts$territory_type == "commune" &
      snapshot$projection$facts$status == "measured", , drop=FALSE][1L, , drop=FALSE]
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
    "os.environ['PGOPTIONS']='-c search_path='+schema",
    "with TestClient(app) as client:",
    " r=client.get('/api/territories/commune/'+os.environ['LUSK_SCALAR_API_TEST_TERRITORY']+'/indicators/'+os.environ['LUSK_SCALAR_API_TEST_INDICATOR'])",
    " assert r.status_code==200, r.text",
    " d=r.json(); assert d['indicator_id']==os.environ['LUSK_SCALAR_API_TEST_INDICATOR']",
    " assert d['value']==float(os.environ['LUSK_SCALAR_API_TEST_VALUE'])",
    " assert d['sources'] and d['content_version']"
  ), collapse="\n")
  api_status <- system2("python", c("-c", shQuote(api_code, type="cmd")))
  stopifnot(identical(api_status, 0L))
  cat("Scalar PostgreSQL and combined snapshot smoke passed; schema:", schema, "\n")
}, error=function(e) {
  smoke_failure <<- conditionMessage(e)
  stop(e)
}, finally={
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
