#!/usr/bin/env Rscript
# Disposable-only end-to-end rehearsal for the real conso_enaf_annuel publisher.
# Never reads LUSK_PUBLISH_* production settings; libpq resolves passwords.
# Pinned, owner-approved rehearsal contract: 192.168.1.120:5432/lusk_it_contract,
# publisher lusk_it_contract_pub, reader lusk_it_contract_read. This is not a
# general runner; the exact values are guards against accidental DB drift.
pkgload::load_all(".", quiet=TRUE)
canonical_indicators <- nanoparquet::read_parquet(file.path("..","public","data","indicateurs_milieux.parquet"))
if (!all(c("state_role","source_components","rang_epci","rang_dep","rang_reg") %in% names(canonical_indicators)))
  stop("Canonical Parquet predates the typed M2/M3 role/source-component producer seam; regenerate the pipeline artifacts before opening a disposable database schema",call.=FALSE)
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
fresh_schema <- paste0("series_it_fresh_", Sys.getpid(), "_", sprintf("%08x", sample.int(.Machine$integer.max, 1L)))
fresh_created <- FALSE
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
  parts <- strsplit(ddl,"-- Additive dataset-owned contract",fixed=TRUE)[[1L]]
  if(length(parts)!=2L) stop("Fresh schema is missing the owned-series expansion boundary",call.=FALSE)
  for (statement in split_postgres_sql(parts[[1L]])) DBI::dbExecute(connection, statement)
  migration <- paste(readLines(file.path("..","api","migrations","011_owned_series_publications.sql"),warn=FALSE),collapse="\n")
  for (statement in split_postgres_sql(migration)) DBI::dbExecute(connection,statement)
  DBI::dbExecute(connection,paste0("CREATE SCHEMA ",DBI::dbQuoteIdentifier(connection,fresh_schema)))
  fresh_created <- TRUE
  DBI::dbExecute(connection,paste0("SET search_path TO ",DBI::dbQuoteIdentifier(connection,fresh_schema)))
  for (statement in split_postgres_sql(ddl)) DBI::dbExecute(connection,statement)
  owned_tables <- c("series_provenance_revision","series_dataset_publication","series_dataset_descriptor",
    "series_dataset_observation","series_observation_provenance")
  owned_tables_array <- paste0("{",paste(owned_tables,collapse=","),"}")
  columns_sql <- "SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema=$1 AND table_name=ANY($2::text[]) ORDER BY table_name,ordinal_position"
  migrated_columns <- DBI::dbGetQuery(connection,columns_sql,params=list(schema,owned_tables_array))
  fresh_columns <- DBI::dbGetQuery(connection,columns_sql,params=list(fresh_schema,owned_tables_array))
  constraints_sql <- "SELECT c.relname AS table_name,k.conname,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=ANY($2::text[]) ORDER BY c.relname,k.conname"
  migrated_constraints <- DBI::dbGetQuery(connection,constraints_sql,params=list(schema,owned_tables_array))
  fresh_constraints <- DBI::dbGetQuery(connection,constraints_sql,params=list(fresh_schema,owned_tables_array))
  triggers_sql <- "SELECT c.relname AS table_name,t.tgname,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT t.tgisinternal AND c.relname=ANY($2::text[]) ORDER BY c.relname,t.tgname"
  migrated_triggers <- DBI::dbGetQuery(connection,triggers_sql,params=list(schema,owned_tables_array))
  fresh_triggers <- DBI::dbGetQuery(connection,triggers_sql,params=list(fresh_schema,owned_tables_array))
  normalize_catalog_definition <- function(x,owned_schema) {
    x$definition <- gsub(paste0(owned_schema,"."),"",x$definition,fixed=TRUE)
    x
  }
  migrated_constraints <- normalize_catalog_definition(migrated_constraints,schema)
  fresh_constraints <- normalize_catalog_definition(fresh_constraints,fresh_schema)
  migrated_triggers <- normalize_catalog_definition(migrated_triggers,schema)
  fresh_triggers <- normalize_catalog_definition(fresh_triggers,fresh_schema)
  if(!identical(migrated_columns,fresh_columns) || !identical(migrated_constraints,fresh_constraints) ||
     !identical(migrated_triggers,fresh_triggers)) {
    if(!identical(migrated_columns,fresh_columns)) { cat("OWNED SCHEMA COLUMN PARITY DIFF\n"); print(migrated_columns); print(fresh_columns) }
    if(!identical(migrated_constraints,fresh_constraints)) { cat("OWNED SCHEMA CONSTRAINT PARITY DIFF\n"); print(migrated_constraints); print(fresh_constraints) }
    if(!identical(migrated_triggers,fresh_triggers)) { cat("OWNED SCHEMA TRIGGER PARITY DIFF\n"); print(migrated_triggers); print(fresh_triggers) }
    stop("Migration 011 differs from fresh-install owned-series schema",call.=FALSE)
  }
  DBI::dbExecute(connection,paste0("SET search_path TO ",DBI::dbQuoteIdentifier(connection,schema)))
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
  DBI::dbExecute(connection,paste0("GRANT SELECT ON territory_reference TO ",
    DBI::dbQuoteIdentifier(connection,config$READER)))
  DBI::dbExecute(connection, paste0("GRANT SELECT ON series_descriptor,ordered_series TO ",
    DBI::dbQuoteIdentifier(connection, config$READER)))
  DBI::dbExecute(connection,paste0("GRANT SELECT ON series_provenance_revision,series_dataset_publication,series_dataset_descriptor,series_dataset_observation,series_observation_provenance TO ",
    DBI::dbQuoteIdentifier(connection,config$READER)))

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

  # Deliberately put a second indicator snapshot in this owned schema after the
  # ENAF-only rehearsal. The production adapter must refuse to replace the
  # whole-table marker and leave both indicators' facts/descriptor/provenance
  # intact. This is a contract regression only, not #598 multi-indicator support.
  DBI::dbExecute(connection, "DROP TRIGGER reject_series_smoke ON ordered_series")
  DBI::dbExecute(connection, "DROP FUNCTION reject_series_smoke_insert()")
  DBI::dbExecute(connection, "INSERT INTO source_dataset(source_id,name) VALUES('smoke_other_source','Smoke-only second indicator')")
  DBI::dbExecute(connection, "INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date) VALUES('smoke_other_source','smoke-v1','smoke-v1',NULL,NULL)")
  DBI::dbExecute(connection, "INSERT INTO series_descriptor(indicator_id,axis_kind,axis_values,completeness,comparison_point,allowed_levels,label,unit,direction,source_id,vintage_id,descriptor_version) VALUES('other_indicator','year',ARRAY['2020'],'may_be_missing',NULL,ARRAY['commune'],'Smoke-only other indicator','count','none','smoke_other_source','smoke-v1','test-v1')")
  commune_id <- projection$points$territory_id[which(projection$points$territory_type == "commune")[[1L]]]
  DBI::dbExecute(connection, "INSERT INTO ordered_series(indicator_id,territory_id,territory_type,axis_value,observation_period,value,status,source_id,vintage_id) VALUES('other_indicator',$1,'commune','2020','2020',7,'measured','smoke_other_source','smoke-v1')", params=list(commune_id))
  before_guard_facts <- DBI::dbGetQuery(connection, "SELECT * FROM ordered_series ORDER BY indicator_id,territory_id,territory_type,axis_value")
  before_guard_descriptors <- DBI::dbGetQuery(connection, "SELECT * FROM series_descriptor ORDER BY indicator_id")
  before_guard_datasets <- DBI::dbGetQuery(connection, "SELECT * FROM source_dataset ORDER BY source_id")
  before_guard_vintages <- DBI::dbGetQuery(connection, "SELECT * FROM source_vintage ORDER BY source_id,vintage_id")
  before_guard_marker <- DBI::dbGetQuery(connection, marker_sql)
  refused <- try(DBI::dbWithTransaction(connection,
    adapter$replace(projection, "should-not-replace-mixed-snapshot")), silent=TRUE)
  stopifnot(inherits(refused, "try-error"),
    identical(before_guard_facts, DBI::dbGetQuery(connection, "SELECT * FROM ordered_series ORDER BY indicator_id,territory_id,territory_type,axis_value")),
    identical(before_guard_descriptors, DBI::dbGetQuery(connection, "SELECT * FROM series_descriptor ORDER BY indicator_id")),
    identical(before_guard_datasets, DBI::dbGetQuery(connection, "SELECT * FROM source_dataset ORDER BY source_id")),
    identical(before_guard_vintages, DBI::dbGetQuery(connection, "SELECT * FROM source_vintage ORDER BY source_id,vintage_id")),
     identical(before_guard_marker, DBI::dbGetQuery(connection, marker_sql)))
  other_reader <- DBI::dbConnect(RPostgres::Postgres(), host=config$HOST,
    port=as.integer(config$PORT), dbname=config$DATABASE, user=config$READER)
  DBI::dbExecute(other_reader, paste0("SET search_path TO ", DBI::dbQuoteIdentifier(other_reader, schema)))
  other_fact <- DBI::dbGetQuery(other_reader,
    "SELECT indicator_id,territory_id,axis_value,value FROM ordered_series WHERE indicator_id='other_indicator'")
  stopifnot(nrow(other_fact)==1L, other_fact$territory_id[[1L]]==commune_id,
    other_fact$axis_value[[1L]]=="2020", other_fact$value[[1L]]==7)
  DBI::dbDisconnect(other_reader)

  # Exercise the additive dataset-owned contract alongside the untouched ENAF
  # legacy reader/storage. Both real canonical units publish independently.
  metadata <- jsonlite::read_json(file.path("inst","extdata","theme-metadata","theme_milieux.json"),simplifyVector=FALSE)
  indicators <- canonical_indicators
  vintages <- nanoparquet::read_parquet(file.path("..","public","data","vintages.parquet"))
  histories <- nanoparquet::read_parquet(file.path("..","public","data","histoires_milieux.parquet"))
  owned_canonical <- list(indicateurs=indicators,histoires=histories,vintages=vintages)
  owned_enaf <- owned_conso_enaf_projection(owned_canonical,metadata)
  owned_ocsge <- project_artif_m2m3_projection(indicators,histories,vintages,metadata)
  owned_registry <- register_owned_series_publishers(list(),metadata)
  owned_db <- owned_series_postgres_adapter(connection)
  publish_owned <- function(p) publish_owned_series_projection(p,owned_db)
  enaf_owned_first <- publish_registered_series(owned_registry,"conso_enaf_annuel_owned",owned_canonical,owned_db)
  ocsge_owned_first <- publish_registered_series(owned_registry,"artif_par_habitant_owned",owned_canonical,owned_db)
  markers_before_noop <- DBI::dbGetQuery(connection,"SELECT * FROM series_dataset_publication ORDER BY dataset_id")
  stopifnot(enaf_owned_first$changed,ocsge_owned_first$changed,
    !publish_registered_series(owned_registry,"conso_enaf_annuel_owned",owned_canonical,owned_db)$changed,
    !publish_registered_series(owned_registry,"artif_par_habitant_owned",owned_canonical,owned_db)$changed,
    identical(markers_before_noop,DBI::dbGetQuery(connection,"SELECT * FROM series_dataset_publication ORDER BY dataset_id")))
  owned_table_snapshot <- function(dataset) list(
    marker=DBI::dbGetQuery(connection,"SELECT * FROM series_dataset_publication WHERE dataset_id=$1",params=list(dataset)),
    descriptors=DBI::dbGetQuery(connection,"SELECT * FROM series_dataset_descriptor WHERE dataset_id=$1 ORDER BY indicator_id",params=list(dataset)),
    facts=DBI::dbGetQuery(connection,"SELECT * FROM series_dataset_observation WHERE dataset_id=$1 ORDER BY indicator_id,territory_id,axis_value",params=list(dataset)),
    links=DBI::dbGetQuery(connection,"SELECT * FROM series_observation_provenance WHERE dataset_id=$1 ORDER BY indicator_id,territory_id,axis_value,provenance_revision_id",params=list(dataset)))
  reference_before_rebind <- DBI::dbGetQuery(connection,"SELECT content_version FROM table_publication WHERE table_name='territory_reference'")$content_version[[1L]]
  ocsge_before_enaf_rebind <- owned_table_snapshot("ocsge_artif_etats")
  DBI::dbExecute(connection,"UPDATE table_publication SET content_version='owned-series-reference-rebind-v2' WHERE table_name='territory_reference'")
  enaf_rebound <- publish_owned(owned_enaf)
  stopifnot(!enaf_rebound$changed,enaf_rebound$rebound,
    identical(ocsge_before_enaf_rebind,owned_table_snapshot("ocsge_artif_etats")))
  enaf_rebound_marker <- owned_table_snapshot("conso_enaf_annuel")$marker
  stopifnot(enaf_rebound_marker$reference_content_version[[1L]]=="owned-series-reference-rebind-v2",
    enaf_rebound_marker$content_version[[1L]]==scalar_content_version(owned_enaf))
  ocsge_rebound <- publish_owned(owned_ocsge)
  stopifnot(!ocsge_rebound$changed,ocsge_rebound$rebound,
    owned_table_snapshot("ocsge_artif_etats")$marker$reference_content_version[[1L]]=="owned-series-reference-rebind-v2")
  DBI::dbExecute(connection,"UPDATE table_publication SET content_version=$1 WHERE table_name='territory_reference'",params=list(reference_before_rebind))
  stopifnot(publish_owned(owned_enaf)$rebound,publish_owned(owned_ocsge)$rebound,
    DBI::dbGetQuery(connection,"SELECT reference_content_version FROM table_publication WHERE table_name='ordered_series'")$reference_content_version[[1L]]==reference_before_rebind)
  before_ocsge <- owned_table_snapshot("ocsge_artif_etats")
  before_enaf <- owned_table_snapshot("conso_enaf_annuel")
  before_provenance <- DBI::dbGetQuery(connection,"SELECT * FROM series_provenance_revision ORDER BY provenance_revision_id")
  before_legacy <- DBI::dbGetQuery(connection,marker_sql)
  owned_reader <- DBI::dbConnect(RPostgres::Postgres(),host=config$HOST,port=as.integer(config$PORT),
    dbname=config$DATABASE,user=config$READER)
  DBI::dbExecute(owned_reader,paste0("SET search_path TO ",DBI::dbQuoteIdentifier(owned_reader,schema)))
  reader_owned_marker <- DBI::dbGetQuery(owned_reader,"SELECT dataset_id,content_version,reference_content_version FROM series_dataset_publication ORDER BY dataset_id")
  reader_owned_facts <- DBI::dbGetQuery(owned_reader,"SELECT count(*) AS n FROM series_dataset_observation")$n[[1L]]
  DBI::dbBegin(owned_reader)
  reader_write <- try(DBI::dbExecute(owned_reader,"UPDATE series_provenance_revision SET source_name='forbidden'"),silent=TRUE)
  if(!inherits(reader_write,"try-error")) reader_write <- try(DBI::dbCommit(owned_reader),silent=TRUE)
  if(inherits(reader_write,"try-error")) suppressWarnings(try(DBI::dbRollback(owned_reader),silent=TRUE))
  stopifnot(nrow(reader_owned_marker)==2L,reader_owned_facts==nrow(owned_enaf$points)+nrow(owned_ocsge$points),
    inherits(reader_write,"try-error"))
  DBI::dbDisconnect(owned_reader)
  updated_enaf <- owned_enaf
  updated_enaf$points$value[[1L]] <- updated_enaf$points$value[[1L]]+1
  stopifnot(publish_owned(updated_enaf)$changed,
    identical(before_ocsge,owned_table_snapshot("ocsge_artif_etats")),
    identical(before_legacy,DBI::dbGetQuery(connection,marker_sql)))
  enaf_changed_snapshot <- owned_table_snapshot("conso_enaf_annuel")
  # Simulate a corrected immutable source revision adopted only by ENAF.
  corrected <- updated_enaf
  corrected$provenance$source_name <- paste0(corrected$provenance$source_name," corrected")
  corrected$provenance$revision_hash <- series_revision_hash(corrected$provenance$source_id,
    corrected$provenance$vintage_id,corrected$provenance$source_name,corrected$provenance$dataset_name,
    corrected$provenance$source_version,as.character(corrected$provenance$reference_date),
    as.character(corrected$provenance$publication_date))
  corrected$provenance$provenance_revision_id <- paste0(corrected$provenance$source_id,"-",
    corrected$provenance$vintage_id,"-",substr(corrected$provenance$revision_hash,1L,16L))
  corrected$point_provenance$provenance_revision_id <- corrected$provenance$provenance_revision_id[[1L]]
  stopifnot(publish_owned(corrected)$changed,
    identical(before_ocsge,owned_table_snapshot("ocsge_artif_etats")),
    nrow(DBI::dbGetQuery(connection,"SELECT * FROM series_provenance_revision"))>nrow(before_provenance))
  before_failed_enaf <- owned_table_snapshot("conso_enaf_annuel")
  before_failed_ocsge <- owned_table_snapshot("ocsge_artif_etats")
  before_failed_provenance <- DBI::dbGetQuery(connection,"SELECT * FROM series_provenance_revision ORDER BY provenance_revision_id")
  DBI::dbExecute(connection,"CREATE FUNCTION reject_owned_series_smoke() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected owned publication failure'; END $$")
  DBI::dbExecute(connection,"CREATE TRIGGER reject_owned_series_smoke BEFORE INSERT ON series_dataset_observation FOR EACH ROW EXECUTE FUNCTION reject_owned_series_smoke()")
  failure <- try(publish_owned(updated_enaf),silent=TRUE)
  stopifnot(inherits(failure,"try-error"),
    identical(before_failed_enaf,owned_table_snapshot("conso_enaf_annuel")),
    identical(before_failed_ocsge,owned_table_snapshot("ocsge_artif_etats")),
    identical(before_failed_provenance,DBI::dbGetQuery(connection,"SELECT * FROM series_provenance_revision ORDER BY provenance_revision_id")))
  DBI::dbExecute(connection,"DROP TRIGGER reject_owned_series_smoke ON series_dataset_observation")
  DBI::dbExecute(connection,"DROP FUNCTION reject_owned_series_smoke()")
  immutable <- try(DBI::dbExecute(connection,"UPDATE series_provenance_revision SET source_name='mutated' WHERE provenance_revision_id=$1",params=list(corrected$provenance$provenance_revision_id[[1L]])),silent=TRUE)
  stopifnot(inherits(immutable,"try-error"),grepl("series provenance revisions are immutable",as.character(immutable),fixed=TRUE))
  DBI::dbBegin(connection)
  DBI::dbExecute(connection,"UPDATE series_dataset_publication SET published_at=transaction_timestamp() WHERE dataset_id='ocsge_artif_etats'")
  bad_association <- try(DBI::dbExecute(connection,"DELETE FROM series_observation_provenance WHERE dataset_id='ocsge_artif_etats' AND indicator_id='artif_par_habitant' AND territory_id=$1 AND axis_value=$2",params=list(owned_ocsge$points$territory_id[[1L]],owned_ocsge$points$axis_value[[1L]])),silent=TRUE)
  if(!inherits(bad_association,"try-error")) bad_association <- try(DBI::dbCommit(connection),silent=TRUE)
  if(inherits(bad_association,"try-error")) suppressWarnings(try(DBI::dbRollback(connection),silent=TRUE))
  if(!grepl("missing provenance association",as.character(bad_association),fixed=TRUE)) cat("ASSOCIATION REJECTION REASON:",as.character(bad_association),"\n")
  stopifnot(inherits(bad_association,"try-error"),grepl("missing provenance association",as.character(bad_association),fixed=TRUE))
  invalid_axis <- try(DBI::dbWithTransaction(connection,{
    DBI::dbExecute(connection,"UPDATE series_dataset_publication SET published_at=transaction_timestamp() WHERE dataset_id='ocsge_artif_etats'")
    DBI::dbExecute(connection,"UPDATE series_dataset_descriptor SET axis_values=ARRAY['M2','M3'] WHERE dataset_id='ocsge_artif_etats'")
  }),silent=TRUE)
  invalid_level <- try(DBI::dbWithTransaction(connection,{
    DBI::dbExecute(connection,"UPDATE series_dataset_publication SET published_at=transaction_timestamp() WHERE dataset_id='ocsge_artif_etats'")
    DBI::dbExecute(connection,"UPDATE series_dataset_observation SET territory_type='epci' WHERE dataset_id='ocsge_artif_etats' AND indicator_id='artif_par_habitant' AND territory_type='commune' AND territory_id=(SELECT territory_id FROM series_dataset_observation WHERE dataset_id='ocsge_artif_etats' AND indicator_id='artif_par_habitant' AND territory_type='commune' LIMIT 1)")
  }),silent=TRUE)
  stopifnot(inherits(invalid_axis,"try-error"),grepl("series dataset descriptor excludes published observations",as.character(invalid_axis),fixed=TRUE),
    inherits(invalid_level,"try-error"),grepl("series observation outside owned descriptor/reference contract",as.character(invalid_level),fixed=TRUE),
    identical(before_ocsge,owned_table_snapshot("ocsge_artif_etats")))
  http_target <- DBI::dbGetQuery(connection,
    "SELECT territory_id,epci_id FROM series_dataset_observation o JOIN territory_reference t USING(territory_id) WHERE o.dataset_id='ocsge_artif_etats' AND o.indicator_id='artif_par_habitant' AND o.territory_type='commune' AND o.axis_value='2025' AND t.epci_id IS NOT NULL ORDER BY territory_id LIMIT 1")
  if(nrow(http_target)!=1L) stop("Canonical owned projection has no selected 2025 commune facet for HTTP parity",call.=FALSE)
  http_dsn <- sprintf("postgresql://%s@%s:%s/%s?options=-csearch_path%%3D%s",
    config$READER,config$HOST,config$PORT,config$DATABASE,schema)
  old_env <- Sys.getenv(c("DATABASE_URL","LUSK_SERIES_HTTP_DATABASE_URL","LUSK_SERIES_HTTP_DATASET",
    "LUSK_SERIES_HTTP_INDICATOR","LUSK_SERIES_HTTP_TERRITORY","LUSK_SERIES_HTTP_DETAIL",
    "LUSK_SERIES_HTTP_SCOPE","LUSK_SERIES_HTTP_EPCI","PYTHONPATH"),unset=NA_character_)
  Sys.setenv(DATABASE_URL=http_dsn,LUSK_SERIES_HTTP_DATABASE_URL=http_dsn,
    LUSK_SERIES_HTTP_DATASET="ocsge_artif_etats",LUSK_SERIES_HTTP_INDICATOR="artif_par_habitant",
    LUSK_SERIES_HTTP_TERRITORY=http_target$territory_id[[1L]],LUSK_SERIES_HTTP_DETAIL="2025",
    LUSK_SERIES_HTTP_SCOPE="commune",LUSK_SERIES_HTTP_EPCI=http_target$epci_id[[1L]],
    PYTHONPATH="..")
  http_output <- system2("python",c("-m","pytest","../api/tests/test_owned_series_postgres_http.py","-q"),
    stdout=TRUE,stderr=TRUE)
  http_status <- attr(http_output,"status") %||% 0L
  cat(paste(http_output,collapse="\n"),"\n")
  if(http_status!=0L) stop("Actual owned-series API HTTP parity test failed: ",paste(http_output,collapse="\n"),call.=FALSE)
  for(n in names(old_env)) if(is.na(old_env[[n]])) Sys.unsetenv(n) else do.call(Sys.setenv,setNames(list(old_env[[n]]),n))

  sizes <- DBI::dbGetQuery(connection, "SELECT pg_total_relation_size('ordered_series')::text AS facts_bytes,pg_total_relation_size('series_descriptor')::text AS descriptor_bytes")
  cat("SERIES POSTGRES REHEARSAL ONLY | database:", config$DATABASE,
    "| schema:", schema, "| points:", nrow(actual), "| excluded region:",
    projection$excluded$region$row_count, "| content version:", marker$content_version[[1L]],
    "| publication seconds:", format(publication_seconds, digits=5),
    "| facts+indexes bytes:", sizes$facts_bytes[[1L]],
    "| descriptor bytes:", sizes$descriptor_bytes[[1L]],
    "| no-op/rebind/rollback/reader/legacy guard/owned ENAF+M2M3 isolation/immutable lineage: PASS\n")
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
  if(fresh_created) {
    tryCatch(cleanup_serving_smoke_schema(connection,fresh_schema,"series"),
      error=function(e) stop("Could not clean owned fresh-schema rehearsal; inspect manually: ",conditionMessage(e),call.=FALSE))
  }
  try(DBI::dbDisconnect(connection), silent=TRUE)
})
