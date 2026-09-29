#!/usr/bin/env Rscript
# Disposable-only end-to-end rehearsal for the real conso_enaf_annuel publisher.
# Never reads LUSK_PUBLISH_* production settings; libpq resolves passwords.
pkgload::load_all(".", quiet=TRUE)
required <- c("HOST", "PORT", "DATABASE", "USER", "READER")
config <- setNames(lapply(required, function(key)
  Sys.getenv(paste0("LUSK_SERIES_TEST_", key), unset="")), required)
stopifnot(identical(config$HOST, "192.168.1.120"), identical(config$PORT, "5432"),
  identical(config$DATABASE, "lusk_it_contract"),
  identical(config$USER, "lusk_it_contract_pub"),
  identical(config$READER, "lusk_it_contract_read"),
  grepl("^lusk_it_[A-Za-z0-9_]+$", config$DATABASE))
if (!requireNamespace("DBI", quietly=TRUE) || !requireNamespace("RPostgres", quietly=TRUE))
  stop("DBI and RPostgres are required", call.=FALSE)
passfile <- Sys.getenv("PGPASSFILE", unset="")
if (!nzchar(passfile) || !file.exists(passfile) ||
    startsWith(tolower(normalizePath(passfile, winslash="/")),
      tolower(normalizePath("..", winslash="/"))))
  stop("PGPASSFILE must point to the existing private libpq file outside the repository", call.=FALSE)

connection <- DBI::dbConnect(RPostgres::Postgres(), host=config$HOST,
  port=as.integer(config$PORT), dbname=config$DATABASE, user=config$USER)
schema <- paste0("series_it_", Sys.getpid(), "_", sprintf("%08x", sample.int(.Machine$integer.max, 1L)))
created <- FALSE
smoke_failure <- NULL
reader <- NULL
tryCatch({
  identity <- DBI::dbGetQuery(connection, "SELECT current_database() AS db,current_user AS usr")
  stopifnot(identical(identity$db[[1L]], config$DATABASE), identical(identity$usr[[1L]], config$USER))
  role <- DBI::dbGetQuery(connection, "SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$1) AS ok",
    params=list(config$READER))$ok[[1L]]
  if (!isTRUE(role)) stop("The explicitly configured disposable reader role does not exist", call.=FALSE)

  DBI::dbExecute(connection, paste0("CREATE SCHEMA ", DBI::dbQuoteIdentifier(connection, schema)))
  created <- TRUE
  DBI::dbExecute(connection, paste0("SET search_path TO ", DBI::dbQuoteIdentifier(connection, schema)))
  search <- DBI::dbGetQuery(connection, "SELECT current_schema() AS schema,current_setting('search_path') AS setting,'public'=ANY(current_schemas(true)) AS has_public")
  if (!identical(search$schema[[1L]], schema) || !identical(search$setting[[1L]], schema) ||
      isTRUE(search$has_public[[1L]]))
    stop("Publisher search_path is not restricted to the owned smoke schema", call.=FALSE)

  ddl <- paste(readLines(file.path("..", "api", "schema.sql"), warn=FALSE), collapse="\n")
  for (statement in split_postgres_sql(ddl)) DBI::dbExecute(connection, statement)
  projection <- read_conso_enaf_series_projection(file.path("..", "public", "data"))
  stopifnot(nrow(projection$points) == 17710L,
    projection$excluded$region$row_count == 14L)

  canonical_territories <- nanoparquet::read_parquet(file.path("..", "public", "data", "territoires.parquet"))
  needed <- unique(projection$points[c("territory_id", "territory_type")])
  refs <- canonical_territories[match(needed$territory_id, as.character(canonical_territories$territoire)), , drop=FALSE]
  if (anyNA(refs$territoire) || any(as.character(refs$type) != needed$territory_type))
    stop("Canonical territory reference does not cover the real annual series projection", call.=FALSE)
  reference <- data.frame(territory_id=as.character(refs$territoire),
    territory_type=as.character(refs$type), name=as.character(refs$nom),
    department_id=as.character(refs$departement), epci_id=as.character(refs$epci),
    density_class_code=as.character(refs$classe_densite_code),
    density_class_label=as.character(refs$classe_densite_libelle_public), stringsAsFactors=FALSE)
  reference$department_id[is.na(refs$departement)] <- NA_character_
  DBI::dbWriteTable(connection, "territory_reference", reference, append=TRUE, row.names=FALSE)
  ref_version <- "conso-enaf-series-smoke-reference-v1"
  DBI::dbExecute(connection,
    "INSERT INTO table_publication(table_name,content_version,row_count) VALUES('territory_reference',$1,$2)",
    params=list(ref_version, nrow(reference)))
  DBI::dbExecute(connection, paste0("GRANT USAGE ON SCHEMA ",
    DBI::dbQuoteIdentifier(connection, schema), " TO ", DBI::dbQuoteIdentifier(connection, config$READER)))
  DBI::dbExecute(connection, paste0("GRANT SELECT ON table_publication TO ",
    DBI::dbQuoteIdentifier(connection, config$READER)))
  DBI::dbExecute(connection, paste0("GRANT SELECT ON series_descriptor,ordered_series TO ",
    DBI::dbQuoteIdentifier(connection, config$READER)))

  adapter <- series_postgres_adapter(connection)
  publish <- function(p, db, version) db$replace(p, version)
  start <- proc.time()[["elapsed"]]
  first <- publish_series_projection(projection, adapter, publish)
  publication_seconds <- proc.time()[["elapsed"]] - start
  marker_sql <- "SELECT table_name,content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name='ordered_series'"
  marker <- DBI::dbGetQuery(connection, marker_sql)
  descriptor <- DBI::dbGetQuery(connection, "SELECT indicator_id,axis_kind,array_to_json(axis_values)::text AS axis_values_json,completeness,comparison_point,array_to_json(allowed_levels)::text AS allowed_levels_json,label,unit,direction,source_id,vintage_id,descriptor_version FROM series_descriptor")
  actual <- DBI::dbGetQuery(connection, "SELECT indicator_id,territory_id,territory_type,axis_value,observation_period,value,status,source_id,vintage_id FROM ordered_series ORDER BY territory_id,territory_type,axis_value")
  expected <- projection$points[order(projection$points$territory_id,
    projection$points$territory_type, projection$points$axis_value), , drop=FALSE]
  actual_sources <- DBI::dbGetQuery(connection, "SELECT source_id,vintage_id,version,reference_date,publication_date FROM source_vintage ORDER BY source_id,vintage_id")
  expected_sources <- projection$vintage[order(projection$vintage$source_id, projection$vintage$vintage_id), , drop=FALSE]
  stopifnot(first$changed, nrow(marker)==1L, marker$row_count[[1L]]==17710L,
    identical(marker$content_version[[1L]], scalar_content_version(projection)),
    identical(marker$reference_content_version[[1L]], ref_version),
    nrow(actual)==nrow(expected),
    identical(as.character(actual$indicator_id), as.character(expected$indicator_id)),
    identical(as.character(actual$territory_id), as.character(expected$territory_id)),
    identical(as.character(actual$territory_type), as.character(expected$territory_type)),
    identical(as.character(actual$axis_value), as.character(expected$axis_value)),
    identical(as.character(actual$observation_period), as.character(expected$observation_period)),
    isTRUE(all.equal(as.numeric(actual$value), as.numeric(expected$value), tolerance=0)),
    identical(as.character(actual$status), as.character(expected$status)),
    identical(as.character(actual$source_id), as.character(expected$source_id)),
    identical(as.character(actual$vintage_id), as.character(expected$vintage_id)),
    nrow(descriptor)==1L, descriptor$comparison_point[[1L]]==projection$descriptor$comparison_point,
    identical(as.character(jsonlite::fromJSON(descriptor$axis_values_json[[1L]])),
      as.character(projection$descriptor$axis_values)),
    identical(as.character(jsonlite::fromJSON(descriptor$allowed_levels_json[[1L]])),
      as.character(projection$descriptor$allowed_levels)),
    identical(as.character(actual_sources$source_id), as.character(expected_sources$source_id)),
    identical(as.character(actual_sources$vintage_id), as.character(expected_sources$vintage_id)),
    identical(as.character(actual_sources$version), as.character(expected_sources$version)),
    identical(as.Date(actual_sources$reference_date), as.Date(expected_sources$reference_date)),
    identical(as.Date(actual_sources$publication_date), as.Date(expected_sources$publication_date)))

  marker_before_retry <- DBI::dbGetQuery(connection, marker_sql)
  no_op <- publish_series_projection(projection, adapter, publish)
  marker_after_retry <- DBI::dbGetQuery(connection, marker_sql)
  stopifnot(!no_op$changed, identical(marker_before_retry, marker_after_retry))

  DBI::dbExecute(connection, "UPDATE table_publication SET content_version='conso-enaf-series-smoke-reference-v2' WHERE table_name='territory_reference'")
  rebound <- publish_series_projection(projection, adapter, publish)
  rebound_marker <- DBI::dbGetQuery(connection, marker_sql)
  stopifnot(!rebound$changed, rebound$rebound,
    identical(rebound_marker$content_version[[1L]], marker$content_version[[1L]]),
    identical(rebound_marker$reference_content_version[[1L]], "conso-enaf-series-smoke-reference-v2"))

  previous_facts <- DBI::dbGetQuery(connection, "SELECT * FROM ordered_series ORDER BY territory_id,territory_type,axis_value")
  previous_descriptor <- DBI::dbGetQuery(connection, "SELECT * FROM series_descriptor")
  previous_datasets <- DBI::dbGetQuery(connection, "SELECT * FROM source_dataset ORDER BY source_id")
  previous_sources <- DBI::dbGetQuery(connection, "SELECT * FROM source_vintage ORDER BY source_id,vintage_id")
  previous_marker <- DBI::dbGetQuery(connection, marker_sql)
  DBI::dbExecute(connection, "CREATE FUNCTION reject_series_smoke_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected series rehearsal failure'; END $$")
  DBI::dbExecute(connection, "CREATE TRIGGER reject_series_smoke BEFORE INSERT ON ordered_series FOR EACH ROW EXECUTE FUNCTION reject_series_smoke_insert()")
  changed <- projection
  changed$points$value[[1L]] <- changed$points$value[[1L]] + 1
  failed <- try(publish_series_projection(changed, adapter, publish), silent=TRUE)
  stopifnot(inherits(failed, "try-error"),
    identical(previous_facts, DBI::dbGetQuery(connection, "SELECT * FROM ordered_series ORDER BY territory_id,territory_type,axis_value")),
    identical(previous_descriptor, DBI::dbGetQuery(connection, "SELECT * FROM series_descriptor")),
    identical(previous_datasets, DBI::dbGetQuery(connection, "SELECT * FROM source_dataset ORDER BY source_id")),
    identical(previous_sources, DBI::dbGetQuery(connection, "SELECT * FROM source_vintage ORDER BY source_id,vintage_id")),
    identical(previous_marker, DBI::dbGetQuery(connection, marker_sql)))

  invalid <- projection
  invalid$points$axis_value[[1L]] <- "2099"
  invalid_result <- try(publish_series_projection(invalid, adapter, publish), silent=TRUE)
  stopifnot(inherits(invalid_result, "try-error"),
    identical(previous_marker, DBI::dbGetQuery(connection, marker_sql)))

  reader <- DBI::dbConnect(RPostgres::Postgres(), host=config$HOST, port=as.integer(config$PORT),
    dbname=config$DATABASE, user=config$READER)
  DBI::dbExecute(reader, paste0("SET search_path TO ", DBI::dbQuoteIdentifier(reader, schema)))
  reader_identity <- DBI::dbGetQuery(reader, "SELECT current_database() AS db,current_user AS usr,current_schema() AS schema")
  reader_count <- DBI::dbGetQuery(reader, "SELECT count(*) AS n FROM ordered_series")$n[[1L]]
  reader_marker <- DBI::dbGetQuery(reader, "SELECT content_version,row_count,reference_content_version FROM table_publication WHERE table_name='ordered_series'")
  DBI::dbBegin(reader)
  denied <- try(DBI::dbExecute(reader, "INSERT INTO ordered_series(indicator_id,territory_id,territory_type,axis_value,observation_period,value,status,source_id,vintage_id) SELECT indicator_id,territory_id,territory_type,axis_value,observation_period,value,status,source_id,vintage_id FROM ordered_series LIMIT 1"), silent=TRUE)
  DBI::dbRollback(reader)
  stopifnot(identical(reader_identity$db[[1L]], config$DATABASE),
    identical(reader_identity$usr[[1L]], config$READER), identical(reader_identity$schema[[1L]], schema),
    reader_count==17710L, reader_marker$content_version[[1L]]==marker$content_version[[1L]],
    reader_marker$row_count[[1L]]==17710L, inherits(denied, "try-error"))
  DBI::dbDisconnect(reader); reader <- NULL

  sizes <- DBI::dbGetQuery(connection, "SELECT pg_total_relation_size('ordered_series')::text AS facts_bytes,pg_total_relation_size('series_descriptor')::text AS descriptor_bytes")
  cat("SERIES POSTGRES REHEARSAL ONLY | database:", config$DATABASE,
    "| schema:", schema, "| points:", nrow(actual), "| excluded region:",
    projection$excluded$region$row_count, "| content version:", marker$content_version[[1L]],
    "| publication seconds:", format(publication_seconds, digits=5),
    "| facts+indexes bytes:", sizes$facts_bytes[[1L]],
    "| descriptor bytes:", sizes$descriptor_bytes[[1L]],
    "| no-op/rebind/rollback/reader grants: PASS\n")
}, error=function(e) {
  smoke_failure <<- conditionMessage(e)
  stop(e)
}, finally={
  if (!is.null(reader)) try(DBI::dbDisconnect(reader), silent=TRUE)
  if (created) {
    tryCatch({
      cleanup_serving_smoke_schema(connection, schema, "series")
      cat("Series rehearsal schema cleaned using dependency-ordered RESTRICT drops\n")
    }, error=function(e) stop("Could not clean owned series smoke schema; inspect manually: ",
      conditionMessage(e), if (!is.null(smoke_failure)) paste0("; rehearsal error: ", smoke_failure) else "", call.=FALSE))
  }
  try(DBI::dbDisconnect(connection), silent=TRUE)
})
