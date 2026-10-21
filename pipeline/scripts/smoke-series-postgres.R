#!/usr/bin/env Rscript
# Disposable-only end-to-end rehearsal for the real conso_enaf_annuel publisher.
# Never reads LUSK_PUBLISH_* production settings; libpq resolves passwords.
# Pinned, owner-approved rehearsal contract: 192.168.1.120:5432/lusk_it_contract,
# publisher lusk_it_contract_pub, reader lusk_it_contract_read. This is not a
# general runner; the exact values are guards against accidental DB drift.
pkgload::load_all(".", quiet=TRUE)

# Narrow retained-schema regression for the stable owned-series parent. This is
# an opt-in path through the existing guarded publisher proof, not a second
# database harness. It uses a producer-shaped OCS-GE fixture, the current full
# schema (including migration-038 deferred completeness), and the actual
# Milieux reading publisher to create the referencing consumer rows.
stable_parent_refresh_fixture <- function(metadata) {
  required_vintages <- c("ocsge_artificialisation_22_2021", "ocsge_artificialisation_22_2025",
    "ocsge_artificialisation_35_2020", "ocsge_artificialisation_35_2023",
    "ocsge_artificialisation_56_2022", "ocsge_artificialisation_56_2024", "serie_historique")
  vintage_rows <- vector("list",length(required_vintages))
  for (vintage_index in seq_along(required_vintages)) {
    id <- required_vintages[[vintage_index]]
    record <- if (identical(id,"serie_historique")) metadata$source_records[["serie_historique"]] else
      metadata$source_records[["ocsge_artificialisation_22_2025"]]
    matches <- which(vapply(record$vintages,function(vintage) identical(as.character(vintage$id),id),logical(1)))
    if (length(matches)!=1L) stop("Fixture source vintage is not declared by Milieux metadata: ",id,call.=FALSE)
    vintage <- record$vintages[[matches[[1L]]]]
    vintage_rows[[vintage_index]] <- data.frame(id=id,source=as.character(record$publisher),version=as.character(vintage$version),
      date_reference=as.Date(as.character(vintage$dateReference)),
      date_publication=as.Date(as.character(vintage$datePublication)),stringsAsFactors=FALSE)
  }
  vintages <- do.call(rbind,vintage_rows)
  rownames(vintages) <- NULL
  rows <- list(
    list(territory="22001",level="commune",role="M2",axis="2021",period="2021-2025",sources="ocsge_artificialisation_22_2021",value=.18),
    list(territory="22001",level="commune",role="M3",axis="2025",period="2021-2025",sources="ocsge_artificialisation_22_2025",value=.42),
    list(territory="22002",level="commune",role="M2",axis="2021",period="2021-2025",sources="ocsge_artificialisation_22_2021",value=.28),
    list(territory="22002",level="commune",role="M3",axis="2025",period="2021-2025",sources="ocsge_artificialisation_22_2025",value=.50),
    list(territory="200000003",level="epci",role="M2",axis="M2",period="2020-2023 (35) · 2022-2024 (56)",sources=c("ocsge_artificialisation_35_2020","ocsge_artificialisation_56_2022"),value=.31),
    list(territory="200000003",level="epci",role="M3",axis="M3",period="2020-2023 (35) · 2022-2024 (56)",sources=c("ocsge_artificialisation_35_2023","ocsge_artificialisation_56_2024"),value=.29))
  indicators <- do.call(rbind,lapply(rows,function(row) {
    vintage <- vintages[vintages$id==row$sources[[1L]],,drop=FALSE]
    components <- list(M2=if(row$role=="M2") row$sources else character(),
      M3=if(row$role=="M3") row$sources else character())
    data.frame(territoire=row$territory,type=row$level,theme="milieux",key="artif_par_habitant",
      detail=row$axis,state_role=row$role,value=row$value,unit="m²/hab",
      source_reference=if(length(row$sources)==1L) row$sources[[1L]] else row$period,
      source_components=as.character(jsonlite::toJSON(components,auto_unbox=FALSE)),
      vintage_source=vintage$source[[1L]],vintage_version=vintage$version[[1L]],
      vintage_date_reference=vintage$date_reference[[1L]],vintage_date_publication=vintage$date_publication[[1L]],
      stringsAsFactors=FALSE)
  }))
  subgroup <- metadata$subgroups[[1L]]
  histories <- data.frame(territoire=c("22001","22002","200000003"),
    type=c("commune","commune","epci"),theme="milieux",groupe=subgroup$key,
    story_key=subgroup$reading$story_key,salience_reason="fixture-owned-series-parent-refresh",
    periode_pop="2017-2023",periode_artif=c("2021-2025","2021-2025",rows[[5L]]$period),
    delta_population=c(100,80,160),taux_variation_population=c(1.0,.8,.9),
    artif_m2_par_habitant=c(.18,.28,.31),artif_m3_par_habitant=c(.42,.50,.29),
    trajectoire_artif_par_habitant=c(.42/.18,.50/.28,.29/.31),
    classification=names(metadata$classification_labels)[[1L]],stringsAsFactors=FALSE)
  projection <- project_artif_m2m3_projection(indicators,histories,vintages,metadata)
  canonical <- list(indicateurs=indicators,histoires=histories)
  reading <- project_milieux_reading(histories,vintages,metadata,canonical)
  list(projection=projection,reading=reading,reference=data.frame(
    territory_id=c("22001","22002","200000003","53"),
    territory_type=c("commune","commune","epci","region"),
    name=c("fixture commune one","fixture commune two","fixture EPCI","fixture region"),
    department_id=c("22","22",NA_character_,NA_character_),
    epci_id=c("200000003","200000003",NA_character_,NA_character_),
    density_class_code=c("d1","d1",NA_character_,NA_character_),
    density_class_label=c("fixture density","fixture density",NA_character_,NA_character_),
    stringsAsFactors=FALSE))
}

run_stable_parent_refresh_smoke <- function() {
  actual_library <- Sys.getenv("R_LIBS_USER",unset="")
  if (!nzchar(actual_library) || !dir.exists(actual_library))
    stop("Stable-parent proof requires an explicit existing R_LIBS_USER",call.=FALSE)
  library_path <- normalizePath(actual_library,winslash="/",mustWork=TRUE)
  available_libraries <- normalizePath(.libPaths(),winslash="/",mustWork=TRUE)
  required_packages <- c("DBI","RPostgres","jsonlite","pkgload")
  unavailable_packages <- required_packages[!vapply(required_packages,requireNamespace,logical(1),quietly=TRUE)]
  if (!library_path %in% available_libraries || length(unavailable_packages))
    stop("Stable-parent proof requires packages in the explicitly provisioned R_LIBS_USER; unavailable: ",
      paste(unavailable_packages,collapse=","),call.=FALSE)
  required <- c("HOST","PORT","DATABASE","USER","READER")
  config <- setNames(lapply(required,function(key) Sys.getenv(paste0("LUSK_SERIES_TEST_",key),unset="")),required)
  if (!identical(config$HOST,"192.168.1.120") || !identical(config$PORT,"5432") ||
      !identical(config$DATABASE,"lusk_it_contract") || !identical(config$USER,"lusk_it_contract_pub") ||
      !identical(config$READER,"lusk_it_contract_read") ||
      !identical(Sys.getenv("LUSK_TEST_DATABASE_NAME",unset=""),"lusk_it_contract") ||
      !identical(Sys.getenv("LUSK_TEST_DATABASE_PREFIX",unset=""),"lusk_it_") ||
      !identical(Sys.getenv("PGCONNECT_TIMEOUT",unset=""),"5") ||
      !all(vapply(c("statement_timeout=120000","lock_timeout=5000","idle_in_transaction_session_timeout=180000"),
        grepl,logical(1),x=Sys.getenv("PGOPTIONS",unset=""),fixed=TRUE)))
    stop("Stable-parent proof refused: explicit test-only host/database/roles/timeouts do not match",call.=FALSE)
  passfile <- Sys.getenv("PGPASSFILE",unset="")
  if (!nzchar(passfile) || !file.exists(passfile) ||
      startsWith(tolower(normalizePath(passfile,winslash="/")),
        tolower(normalizePath("..",winslash="/"))))
    stop("PGPASSFILE must name the existing private libpq passfile outside this checkout",call.=FALSE)
  proof_started <- proc.time()[["elapsed"]]
  cat("PHASE=connect-only-after-explicit-test-config; private passfile presence verified (contents not read)\n"); flush.console()
  connection <- DBI::dbConnect(RPostgres::Postgres(),host=config$HOST,port=as.integer(config$PORT),
    dbname=config$DATABASE,user=config$USER)
  on.exit(DBI::dbDisconnect(connection),add=TRUE)
  identity <- DBI::dbGetQuery(connection,"SELECT current_database() AS db,current_user AS usr,
    inet_server_addr()::text AS server_identity,current_setting('server_version_num')::integer AS server_version_num")
  if (!identical(identity$db[[1L]],"lusk_it_contract") || !identical(identity$usr[[1L]],"lusk_it_contract_pub") ||
      !identical(identity$server_identity[[1L]],"192.168.16.3/32")) {
    cat("IDENTITY_GUARD_MISMATCH actual_database=",identity$db[[1L]]," actual_user=",identity$usr[[1L]],
      " actual_server=",identity$server_identity[[1L]]," expected_database=lusk_it_contract",
      " expected_user=lusk_it_contract_pub expected_server=192.168.16.3/32\n",sep=""); flush.console()
    stop("Stable-parent proof refused before DDL: actual database, role or server identity mismatch",call.=FALSE)
  }
  reader_exists <- DBI::dbGetQuery(connection,"SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$1) AS ok",
    params=list(config$READER))$ok[[1L]]
  if (!isTRUE(reader_exists)) stop("The explicitly configured test-only reader role does not exist",call.=FALSE)
  if (identity$server_version_num[[1L]]>=170000L)
    DBI::dbExecute(connection,"SET transaction_timeout='180s'")

  cat("PHASE=offline-producer-fixture-validation-before-DDL\n"); flush.console()
  fixture <- stable_parent_refresh_fixture(lire_theme_metadata("milieux"))
  fixture_bindings <- attr(fixture$reading,"source_bindings")
  fixture_population_revision <- attr(fixture$reading,"population_revisions")
  population_bindings <- fixture_bindings[fixture_bindings$field_key=="population",,drop=FALSE]
  ocs_bindings <- fixture_bindings[fixture_bindings$field_key!="population",,drop=FALSE]
  if (nrow(fixture$projection$points)!=6L || nrow(fixture$projection$provenance)!=6L ||
      length(unique(fixture$projection$provenance$source_id))!=6L ||
      nrow(fixture_bindings)!=11L || nrow(ocs_bindings)!=8L || nrow(population_bindings)!=3L ||
      nrow(fixture_population_revision)!=1L ||
      !identical(as.character(fixture_population_revision$source_id[[1L]]),"serie_historique") ||
      any(population_bindings$population_revision_id!=fixture_population_revision$population_revision_id[[1L]]) ||
      any(population_bindings$source_id!=fixture_population_revision$source_id[[1L]]) ||
      any(population_bindings$vintage_id!=fixture_population_revision$vintage_id[[1L]]) ||
      any(!is.na(population_bindings$dataset_id)) || any(!is.na(population_bindings$provenance_revision_id)))
    stop("Producer-shaped OCS/population bindings or immutable population clock are incomplete before DDL",call.=FALSE)
  cat("FIXTURE_VALIDATED_BEFORE_DDL=points:6/revisions:6/source-vintages:6/consumer-bindings:11/OCS-FK:8/population-clock:3\n"); flush.console()

  schema <- paste0("series_parent_it_",Sys.getpid(),"_",sprintf("%08x",sample.int(.Machine$integer.max,1L)))
  cat("INTENDED_RETAINED_SCHEMA=",schema," (recorded before CREATE SCHEMA; no schema cleanup)\n",sep=""); flush.console()
  cat("PHASE=create-private-schema-and-current-schema-038-contract\n"); flush.console()
  DBI::dbExecute(connection,paste0("CREATE SCHEMA ",DBI::dbQuoteIdentifier(connection,schema)))
  DBI::dbExecute(connection,paste0("SET search_path TO ",DBI::dbQuoteIdentifier(connection,schema)))
  search <- DBI::dbGetQuery(connection,"SELECT current_schema() AS schema,'public'=ANY(current_schemas(true)) AS has_public")
  if (!identical(search$schema[[1L]],schema) || isTRUE(search$has_public[[1L]]))
    stop("Stable-parent proof search_path escaped its retained private schema",call.=FALSE)
  ddl <- paste(readLines("../api/schema.sql",warn=FALSE),collapse="\n")
  for (statement in split_postgres_sql(ddl)) DBI::dbExecute(connection,statement)

  fk <- DBI::dbGetQuery(connection,"SELECT c.confdeltype,pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c WHERE c.contype='f' AND c.conrelid='milieux_reading_source'::regclass
      AND c.confrelid='series_dataset_publication'::regclass")
  deferred <- DBI::dbGetQuery(connection,"SELECT t.tgdeferrable,t.tginitdeferred,
      pg_get_functiondef(t.tgfoid) AS definition FROM pg_trigger t
    WHERE t.tgrelid='series_dataset_publication'::regclass AND t.tgname='series_dataset_publication_complete'")
  zero_reason_fk <- DBI::dbGetQuery(connection,"SELECT c.confdeltype FROM pg_constraint c
    WHERE c.contype='f' AND c.conrelid='ordered_series_comparison_zero_reason'::regclass
      AND c.confrelid='ordered_series_comparison_group'::regclass")
  if (nrow(fk)!=1L || fk$confdeltype[[1L]]!="a" ||
      !grepl("FOREIGN KEY (dataset_id) REFERENCES series_dataset_publication(dataset_id)",fk$definition[[1L]],fixed=TRUE) ||
      nrow(deferred)!=1L || !isTRUE(deferred$tgdeferrable[[1L]]) || !isTRUE(deferred$tginitdeferred[[1L]]) ||
      !grepl("owned series marker does not match complete descriptor/observation snapshot",deferred$definition[[1L]],fixed=TRUE) ||
      !grepl("owned series observation is missing provenance association",deferred$definition[[1L]],fixed=TRUE) ||
      nrow(zero_reason_fk)!=1L || zero_reason_fk$confdeltype[[1L]]!="a")
    stop("Current public schema does not match the expected stable-parent/deferred-038 FK contracts",call.=FALSE)
  cat("SCHEMA_CONTRACT=milieux FK NO ACTION; comparison zero-reason FK NO ACTION; migration-038 deferred completeness verified\n"); flush.console()

  DBI::dbWriteTable(connection,"territory_reference",fixture$reference,append=TRUE,row.names=FALSE)
  reference_version <- "stable-parent-reference-v1"
  DBI::dbExecute(connection,"INSERT INTO table_publication(table_name,content_version,row_count)
    VALUES('territory_reference',$1,$2)",params=list(reference_version,nrow(fixture$reference)))
  adapter <- owned_series_postgres_adapter(connection)
  publish_timed <- function(label,expr) {
    cat("PHASE=",label,"\n",sep=""); flush.console()
    elapsed <- system.time(value <- force(expr))[["elapsed"]]
    if (elapsed>180) stop("Stable-parent publication transaction exceeded 180 seconds: ",label,call.=FALSE)
    list(value=value,elapsed=elapsed)
  }
  initial <- publish_timed("initial-valid-owned-series-publication",publish_owned_series_projection(fixture$projection,adapter))
  if (!isTRUE(initial$value$changed)) stop("Initial owned series fixture did not publish",call.=FALSE)
  # The public Milieux publisher validates every source/vintage/revision/role/value/window binding
  # and writes a real existing consumer FK row (plus the population source binding).
  seed_reading <- publish_milieux_reading(connection,fixture$reading,list())
  if (!isTRUE(seed_reading$changed)) stop("Initial producer-shaped Milieux consumer did not publish",call.=FALSE)

  owner_snapshot <- function() list(
    publication=DBI::dbGetQuery(connection,"SELECT * FROM series_dataset_publication ORDER BY dataset_id"),
    descriptors=DBI::dbGetQuery(connection,"SELECT * FROM series_dataset_descriptor ORDER BY dataset_id,indicator_id"),
    observations=DBI::dbGetQuery(connection,"SELECT * FROM series_dataset_observation ORDER BY dataset_id,indicator_id,territory_id,axis_value"),
    observation_provenance=DBI::dbGetQuery(connection,"SELECT * FROM series_observation_provenance ORDER BY dataset_id,indicator_id,territory_id,axis_value,provenance_revision_id"),
    named_descriptors=DBI::dbGetQuery(connection,"SELECT * FROM series_named_reference_descriptor ORDER BY dataset_id,indicator_id,reference_id"),
    named_references=DBI::dbGetQuery(connection,"SELECT * FROM series_named_reference ORDER BY dataset_id,indicator_id,reference_id,axis_value"),
    named_provenance=DBI::dbGetQuery(connection,"SELECT * FROM series_named_reference_provenance ORDER BY dataset_id,indicator_id,reference_id,axis_value,provenance_revision_id"),
    context_policy=DBI::dbGetQuery(connection,"SELECT * FROM series_context_parent_policy ORDER BY dataset_id,indicator_id,focal_level"),
    comparison_publication=DBI::dbGetQuery(connection,"SELECT * FROM ordered_series_comparison_publication ORDER BY dataset_id,indicator_id"),
    comparison_groups=DBI::dbGetQuery(connection,"SELECT * FROM ordered_series_comparison_group ORDER BY dataset_id,indicator_id,comparison_context,group_id,territory_type,axis_value"),
    comparison_territories=DBI::dbGetQuery(connection,"SELECT * FROM ordered_series_comparison_territory ORDER BY dataset_id,indicator_id,comparison_context,group_id,territory_type,axis_value,territory_id"),
    comparison_lineage=DBI::dbGetQuery(connection,"SELECT * FROM ordered_series_comparison_lineage ORDER BY dataset_id,indicator_id,comparison_context,group_id,territory_type,axis_value,provenance_revision_id"),
    comparison_zero_reason=DBI::dbGetQuery(connection,"SELECT * FROM ordered_series_comparison_zero_reason ORDER BY dataset_id,indicator_id,comparison_context,group_id,territory_type,axis_value,reason"),
    source_datasets=DBI::dbGetQuery(connection,"SELECT * FROM source_dataset ORDER BY source_id"),
    source_vintages=DBI::dbGetQuery(connection,"SELECT * FROM source_vintage ORDER BY source_id,vintage_id"),
    provenance_revisions=DBI::dbGetQuery(connection,"SELECT * FROM series_provenance_revision ORDER BY provenance_revision_id"),
    reference_clock=DBI::dbGetQuery(connection,"SELECT * FROM table_publication WHERE table_name='territory_reference'"),
    milieux_facts=DBI::dbGetQuery(connection,"SELECT * FROM milieux_typed_reading ORDER BY territory_type,territory_id,groupe"),
    milieux_sources=DBI::dbGetQuery(connection,"SELECT * FROM milieux_reading_source ORDER BY territory_type,territory_id,groupe,field_key,source_id,vintage_id"),
    milieux_clock=DBI::dbGetQuery(connection,"SELECT * FROM table_publication WHERE table_name IN ('milieux_typed_reading','milieux_reading_absence') ORDER BY table_name"))
  verify_publication <- function(projection,expected_reference,expected_m3_medians) {
    dataset <- projection$descriptor$dataset_id; indicator <- projection$descriptor$indicator_id
    marker <- DBI::dbGetQuery(connection,"SELECT dataset_id,content_version,reference_content_version,row_count,published_at
      FROM series_dataset_publication WHERE dataset_id=$1",params=list(dataset))
    points <- DBI::dbGetQuery(connection,"SELECT dataset_id,indicator_id,territory_id,territory_type,axis_value,state_role,
      observation_period,value,status,missing_reason FROM series_dataset_observation WHERE dataset_id=$1 ORDER BY territory_id,axis_value",params=list(dataset))
    expected_points <- projection$points[c("dataset_id","indicator_id","territory_id","territory_type","axis_value","state_role","observation_period","value","status")]
    expected_points$missing_reason <- NA_character_
    expected_points <- expected_points[order(expected_points$territory_id,expected_points$axis_value),,drop=FALSE]
    descriptors <- DBI::dbGetQuery(connection,"SELECT dataset_id,indicator_id,axis_kind,
      array_to_json(axis_values)::text AS axis_values_json,completeness,
      comparison_point,label,unit,direction,array_to_json(allowed_levels)::text AS allowed_levels_json,
      descriptor_version,active_read_route,theme_id,comparison_statistic,comparison_scope,
      observation_period_kind,absence_semantics,
      array_to_json(comparison_levels)::text AS comparison_levels_json
      FROM series_dataset_descriptor WHERE dataset_id=$1",params=list(dataset))
    comparison <- DBI::dbGetQuery(connection,"SELECT * FROM ordered_series_comparison_publication WHERE dataset_id=$1 AND indicator_id=$2",params=list(dataset,indicator))
    groups <- DBI::dbGetQuery(connection,"SELECT comparison_context,group_id,territory_type,axis_value,group_value,
      member_count,eligible_count,missing_count,lineage_source_count FROM ordered_series_comparison_group
      WHERE dataset_id=$1 AND indicator_id=$2 ORDER BY comparison_context,group_id,territory_type,axis_value",params=list(dataset,indicator))
    lineage_check <- DBI::dbGetQuery(connection,"SELECT g.comparison_context,g.group_id,g.territory_type,g.axis_value,
      g.lineage_source_count,count(DISTINCT l.provenance_revision_id)::integer AS actual_lineage_count
      FROM ordered_series_comparison_group g LEFT JOIN ordered_series_comparison_lineage l
        USING(dataset_id,indicator_id,comparison_context,group_id,territory_type,axis_value)
      WHERE g.dataset_id=$1 AND g.indicator_id=$2
      GROUP BY g.comparison_context,g.group_id,g.territory_type,g.axis_value,g.lineage_source_count
      ORDER BY g.comparison_context,g.group_id,g.territory_type,g.axis_value",params=list(dataset,indicator))
    medians <- DBI::dbGetQuery(connection,"SELECT axis_value,group_value FROM ordered_series_comparison_group
      WHERE dataset_id=$1 AND indicator_id=$2 AND comparison_context='density_class' AND group_id='d1'
        AND territory_type='commune' ORDER BY axis_value",params=list(dataset,indicator))
    epci_comparisons <- DBI::dbGetQuery(connection,"SELECT axis_value,group_value FROM ordered_series_comparison_group
      WHERE dataset_id=$1 AND indicator_id=$2 AND comparison_context='same_level' AND group_id='53'
        AND territory_type='epci' ORDER BY axis_value",params=list(dataset,indicator))
    links <- DBI::dbGetQuery(connection,"SELECT dataset_id,indicator_id,territory_id,axis_value,provenance_revision_id
      FROM series_observation_provenance WHERE dataset_id=$1 ORDER BY indicator_id,territory_id,axis_value,provenance_revision_id",params=list(dataset))
    expected_links <- projection$point_provenance[order(projection$point_provenance$indicator_id,
      projection$point_provenance$territory_id,projection$point_provenance$axis_value,
      projection$point_provenance$provenance_revision_id),,drop=FALSE]
    revisions <- DBI::dbGetQuery(connection,"SELECT provenance_revision_id,source_id,vintage_id,source_name,dataset_name,
      source_version,reference_date,publication_date,revision_hash FROM series_provenance_revision ORDER BY provenance_revision_id")
    revisions <- revisions[revisions$provenance_revision_id %in% projection$provenance$provenance_revision_id,,drop=FALSE]
    expected_revisions <- projection$provenance[order(projection$provenance$provenance_revision_id),,drop=FALSE]
    expected_vintages <- unique(projection$provenance[c("source_id","vintage_id","source_version","reference_date","publication_date")])
    names(expected_vintages)[names(expected_vintages)=="source_version"] <- "version"
    expected_vintages <- expected_vintages[order(expected_vintages$source_id,expected_vintages$vintage_id),,drop=FALSE]
    source_vintages <- DBI::dbGetQuery(connection,"SELECT source_id,vintage_id,version,reference_date,publication_date
      FROM source_vintage ORDER BY source_id,vintage_id")
    source_vintages <- source_vintages[source_vintages$source_id %in% expected_vintages$source_id,,drop=FALSE]
    expected_datasets <- unique(projection$provenance[c("source_id","source_name")])
    names(expected_datasets)[names(expected_datasets)=="source_id"] <- "source_id"
    expected_datasets <- expected_datasets[order(expected_datasets$source_id),,drop=FALSE]
    source_datasets <- DBI::dbGetQuery(connection,"SELECT source_id,name AS source_name FROM source_dataset ORDER BY source_id")
    source_datasets <- source_datasets[source_datasets$source_id %in% expected_datasets$source_id,,drop=FALSE]
    stopifnot(nrow(marker)==1L,marker$dataset_id[[1L]]==dataset,
      marker$content_version[[1L]]==scalar_content_version(projection),
      marker$reference_content_version[[1L]]==expected_reference,
      marker$row_count[[1L]]==nrow(projection$points),
      isTRUE(all.equal(points,expected_points,check.attributes=FALSE,tolerance=0)),
      isTRUE(all.equal(links,expected_links,check.attributes=FALSE)),
      isTRUE(all.equal(revisions,expected_revisions,check.attributes=FALSE)),
      isTRUE(all.equal(source_vintages,expected_vintages,check.attributes=FALSE)),
      isTRUE(all.equal(source_datasets,expected_datasets,check.attributes=FALSE)),
      nrow(descriptors)==1L,descriptors$dataset_id[[1L]]==dataset,
      descriptors$indicator_id[[1L]]==indicator,
      identical(jsonlite::fromJSON(descriptors$axis_values_json[[1L]]),as.character(projection$descriptor$axis_values)),
      identical(jsonlite::fromJSON(descriptors$allowed_levels_json[[1L]]),as.character(projection$descriptor$allowed_levels)),
      descriptors$axis_kind[[1L]]==projection$descriptor$axis_kind,
      descriptors$completeness[[1L]]==projection$descriptor$completeness,
      descriptors$comparison_point[[1L]]==projection$descriptor$comparison_point,
      descriptors$label[[1L]]==projection$descriptor$label,
      descriptors$unit[[1L]]==projection$descriptor$unit,
      descriptors$direction[[1L]]==projection$descriptor$direction,
      descriptors$descriptor_version[[1L]]==projection$descriptor$descriptor_version,
      isTRUE(descriptors$active_read_route[[1L]]),
      descriptors$theme_id[[1L]]==projection$descriptor$theme_id,
      descriptors$comparison_statistic[[1L]]==projection$descriptor$comparison_statistic,
      is.na(descriptors$comparison_scope[[1L]])==is.null(projection$descriptor$comparison_scope),
      identical(jsonlite::fromJSON(descriptors$comparison_levels_json[[1L]]),as.character(projection$descriptor$comparison_levels)),
      nrow(comparison)==1L,comparison$ordered_series_content_version[[1L]]==marker$content_version[[1L]],
      comparison$reference_content_version[[1L]]==expected_reference,
      comparison$group_row_count[[1L]]==8L,nrow(groups)==8L,
      comparison$territory_row_count[[1L]]==14L,
      DBI::dbGetQuery(connection,"SELECT count(*) n FROM ordered_series_comparison_territory WHERE dataset_id=$1 AND indicator_id=$2",params=list(dataset,indicator))$n[[1L]]==14L,
      comparison$lineage_row_count[[1L]]==10L,
      DBI::dbGetQuery(connection,"SELECT count(*) n FROM ordered_series_comparison_lineage WHERE dataset_id=$1 AND indicator_id=$2",params=list(dataset,indicator))$n[[1L]]==10L,
      nrow(lineage_check)==8L,all(lineage_check$lineage_source_count==lineage_check$actual_lineage_count),
      identical(as.character(medians$axis_value),c("M2","M3")),
      # PostgreSQL float8 statistic results can differ from the independent R
      # expected medians by one rounding step after the database/R round trip.
      isTRUE(all.equal(as.numeric(medians$group_value),as.numeric(expected_m3_medians),tolerance=1e-12)),
      identical(as.character(epci_comparisons$axis_value),c("M2","M3")),
      isTRUE(all.equal(as.numeric(epci_comparisons$group_value),c(.31,.29),tolerance=1e-12)),
      nrow(DBI::dbGetQuery(connection,"SELECT * FROM series_named_reference_descriptor WHERE dataset_id=$1",params=list(dataset)))==0L,
      nrow(DBI::dbGetQuery(connection,"SELECT * FROM series_named_reference WHERE dataset_id=$1",params=list(dataset)))==0L,
      nrow(DBI::dbGetQuery(connection,"SELECT * FROM series_named_reference_provenance WHERE dataset_id=$1",params=list(dataset)))==0L,
      nrow(DBI::dbGetQuery(connection,"SELECT * FROM series_context_parent_policy WHERE dataset_id=$1",params=list(dataset)))==0L)
    marker
  }

  original <- fixture$projection
  original_version <- scalar_content_version(original)
  first_marker <- verify_publication(original,reference_version,c(.23,.46))
  before_change <- owner_snapshot()
  consumer_fk_rows <- DBI::dbGetQuery(connection,"SELECT count(*) AS n FROM milieux_reading_source
    WHERE dataset_id=$1",params=list(original$descriptor$dataset_id))$n[[1L]]
  if (consumer_fk_rows!=8L) stop("Fixture did not seed the complete eight-row OCS consumer binding set",call.=FALSE)
  changed <- original
  changed_point <- which(changed$points$territory_id=="22001" & changed$points$state_role=="M3")
  changed$points$value[[changed_point]] <- .48
  changed_result <- publish_timed("changed-projection-refresh-with-live-milieux-fk",publish_owned_series_projection(changed,adapter))
  changed_marker <- verify_publication(changed,reference_version,c(.23,.49))
  after_change <- owner_snapshot()
  if (!isTRUE(changed_result$value$changed) ||
      !identical(before_change$publication$dataset_id,after_change$publication$dataset_id) ||
      identical(first_marker$published_at[[1L]],changed_marker$published_at[[1L]]) ||
      !identical(before_change$milieux_sources,after_change$milieux_sources) ||
      !identical(before_change$milieux_facts,after_change$milieux_facts) ||
      !identical(before_change$source_vintages,after_change$source_vintages) ||
      !identical(before_change$source_datasets,after_change$source_datasets) ||
      !identical(before_change$provenance_revisions,after_change$provenance_revisions) ||
      !identical(before_change$milieux_clock,after_change$milieux_clock) ||
      identical(first_marker$content_version[[1L]],changed_marker$content_version[[1L]]) ||
      !all(after_change$milieux_sources$dataset_content_version[!is.na(after_change$milieux_sources$dataset_id)]==original_version) ||
      !all(after_change$milieux_sources$dataset_content_version[!is.na(after_change$milieux_sources$dataset_id)]!=changed_marker$content_version[[1L]]))
    stop("Changed refresh rebound or deleted the existing Milieux consumer, source clock, or immutable history",call.=FALSE)
  cat("ASSERTION=changed refresh kept parent key and all existing consumer rows unchanged; old Milieux token remains honestly stale\n"); flush.console()

  DBI::dbExecute(connection,"UPDATE table_publication SET content_version='stable-parent-reference-v2'
    WHERE table_name='territory_reference'")
  rebound_result <- publish_timed("same-content-reference-only-rebind-with-live-milieux-fk",
    publish_owned_series_projection(changed,adapter))
  rebound_marker <- verify_publication(changed,"stable-parent-reference-v2",c(.23,.49))
  after_rebind <- owner_snapshot()
  if (isTRUE(rebound_result$value$changed) || !isTRUE(rebound_result$value$rebound) ||
      changed_marker$content_version[[1L]]!=rebound_marker$content_version[[1L]] ||
      identical(changed_marker$published_at[[1L]],rebound_marker$published_at[[1L]]) ||
      !identical(after_change$milieux_sources,after_rebind$milieux_sources) ||
      !identical(after_change$milieux_facts,after_rebind$milieux_facts) ||
      !identical(after_change$comparison_groups,after_rebind$comparison_groups) ||
      !identical(after_change$comparison_territories,after_rebind$comparison_territories) ||
      !identical(after_change$comparison_lineage,after_rebind$comparison_lineage) ||
      !identical(after_change$provenance_revisions,after_rebind$provenance_revisions) ||
      !identical(after_change$source_vintages,after_rebind$source_vintages) ||
      !identical(after_change$milieux_clock,after_rebind$milieux_clock) ||
      after_rebind$reference_clock$content_version[[1L]]!="stable-parent-reference-v2")
    stop("Same-content reference-only rebind changed consumer rows, source history, or content identity",call.=FALSE)
  cat("ASSERTION=same-content/reference-only rebind succeeded through the existing owner protocol; Milieux bindings were not rewritten\n"); flush.console()

  before_noop <- owner_snapshot()
  noop <- publish_timed("unchanged-repeat-true-noop",publish_owned_series_projection(changed,adapter))
  if (isTRUE(noop$value$changed) || isTRUE(noop$value$rebound) || !identical(before_noop,owner_snapshot()))
    stop("Unchanged owned-series repeat mutated markers, timestamps, or consumer rows",call.=FALSE)

  # The retained trigger injects failure only for this fixture dataset after the
  # adapter has updated the stable parent marker and begun replacing children.
  DBI::dbExecute(connection,"CREATE FUNCTION fail_stable_parent_refresh() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.dataset_id='ocsge_artif_etats' THEN RAISE EXCEPTION 'injected stable-parent child replacement failure'; END IF; RETURN NEW; END $$")
  DBI::dbExecute(connection,"CREATE TRIGGER fail_stable_parent_refresh BEFORE INSERT ON series_dataset_observation
    FOR EACH ROW EXECUTE FUNCTION fail_stable_parent_refresh()")
  before_failure <- owner_snapshot()
  failing <- changed
  failing$points$value[[changed_point]] <- .54
  failed <- try(publish_timed("injected-failure-after-child-delete-and-parent-upsert",
    publish_owned_series_projection(failing,adapter)),silent=TRUE)
  if (!inherits(failed,"try-error") ||
      !grepl("injected stable-parent child replacement failure",as.character(failed),fixed=TRUE) ||
      grepl("foreign key constraint",as.character(failed),ignore.case=TRUE,fixed=TRUE) ||
      !identical(before_failure,owner_snapshot()))
    stop("Injected failure did not report at child replacement or did not restore the complete prior owner/consumer snapshot",call.=FALSE)
  cat("ASSERTION=post-delete/post-parent-upsert failure returned the injected error and rolled back parent timestamp, facts, comparisons, source clocks/labels, Milieux clocks and all consumer rows\n"); flush.console()

  elapsed <- proc.time()[["elapsed"]]-proof_started
  if (elapsed>300) stop("Stable-parent guarded proof exceeded 300 seconds",call.=FALSE)
  cat("STABLE_SERIES_PARENT_GUARDED_PROOF=PASS | schema=",schema,
    " | fk-consumer-rows=",consumer_fk_rows," | points=",nrow(changed$points),
    " | comparison-groups=8/territories=14/lineage=10 | changed=",format(changed_result$elapsed,digits=4),"s",
    " | reference-rebind=",format(rebound_result$elapsed,digits=4),"s | noop=",format(noop$elapsed,digits=4),"s",
    " | total=",format(elapsed,digits=5),"s | retained-schema-and-failure-trigger=yes\n",sep="")
  invisible(schema)
}

if (identical(Sys.getenv("LUSK_SERIES_TEST_CASE",unset=""),"stable-parent-refresh")) {
  run_stable_parent_refresh_smoke()
  quit(save="no",status=0L)
}

# Serving artifacts replace the theme Parquet inputs of this rehearsal. The
# owned OCS-GE projection only exists once the canonical indicator Parquet
# carries the typed M2/M3 roles and their source components, so a missing
# artifact aborts before any disposable schema is opened.
owned_series_directory <- file.path("..","public","data","series-serving")
owned_enaf_path <- file.path(owned_series_directory,"conso_enaf_annuel")
owned_ocsge_path <- file.path(owned_series_directory,"artif_par_habitant")
if (!all(dir.exists(c(owned_enaf_path,owned_ocsge_path))))
  stop("Owned-series serving artifacts are missing; the pipeline artifacts predate the typed M2/M3 role/source-component producer seam or were not regenerated",call.=FALSE)
owned_enaf <- read_owned_series_artifact(owned_enaf_path,"conso_enaf_annuel")
owned_ocsge <- read_owned_series_artifact(owned_ocsge_path,"artif_par_habitant")
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
  # legacy reader/storage. Both real canonical artifacts publish independently,
  # through the same owned-series artifact reader the pipeline publishes from.
  owned_db <- owned_series_postgres_adapter(connection)
  publish_owned <- function(p) publish_owned_series_projection(p,owned_db)
  enaf_owned_first <- publish_owned(owned_enaf)
  ocsge_owned_first <- publish_owned(owned_ocsge)
  markers_before_noop <- DBI::dbGetQuery(connection,"SELECT * FROM series_dataset_publication ORDER BY dataset_id")
  stopifnot(enaf_owned_first$changed,ocsge_owned_first$changed,
    !publish_owned(owned_enaf)$changed,
    !publish_owned(owned_ocsge)$changed,
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
  writer_dsn <- sprintf("postgresql://%s@%s:%s/%s?options=-csearch_path%%3D%s",
    config$USER,config$HOST,config$PORT,config$DATABASE,schema)
  old_env <- Sys.getenv(c("DATABASE_URL","LUSK_SERIES_HTTP_DATABASE_URL","LUSK_SERIES_HTTP_WRITER_DATABASE_URL","LUSK_SERIES_HTTP_DATASET",
    "LUSK_SERIES_HTTP_INDICATOR","LUSK_SERIES_HTTP_TERRITORY","LUSK_SERIES_HTTP_DETAIL",
    "LUSK_SERIES_HTTP_SCOPE","LUSK_SERIES_HTTP_EPCI","PYTHONPATH"),unset=NA_character_)
  Sys.setenv(DATABASE_URL=http_dsn,LUSK_SERIES_HTTP_DATABASE_URL=http_dsn,
    LUSK_SERIES_HTTP_WRITER_DATABASE_URL=writer_dsn,
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
