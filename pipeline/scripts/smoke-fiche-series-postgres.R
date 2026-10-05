#!/usr/bin/env Rscript
# Invoked by guarded canonical HTTP acceptance, only inside its disposable schema.
pkgload::load_all(".",quiet=TRUE)
args <- commandArgs(TRUE)
stopifnot(length(args)==1L,grepl("^it_[a-f0-9]{20}$",args[[1L]]),
  identical(Sys.getenv("LUSK_TEST_DATABASE_PREFIX"),"lusk_it_"),
  startsWith(Sys.getenv("LUSK_TEST_DATABASE_NAME"),"lusk_it_"),
  identical(Sys.getenv("LUSK_PROFILE_TEST_DATABASE"),Sys.getenv("LUSK_TEST_DATABASE_NAME")))
con <- DBI::dbConnect(RPostgres::Postgres(),host=Sys.getenv("LUSK_PROFILE_TEST_HOST"),
  port=as.integer(Sys.getenv("LUSK_PROFILE_TEST_PORT")),dbname=Sys.getenv("LUSK_PROFILE_TEST_DATABASE"),
  user=Sys.getenv("LUSK_PROFILE_TEST_USER"))
tryCatch({
  identity <- DBI::dbGetQuery(con,"SELECT current_database() AS database,current_user AS username")
  stopifnot(identical(identity$database[[1L]],Sys.getenv("LUSK_TEST_DATABASE_NAME")),
    identical(identity$username[[1L]],Sys.getenv("LUSK_PROFILE_TEST_USER")))
  DBI::dbExecute(con,paste("SET search_path TO",DBI::dbQuoteIdentifier(con,args[[1L]])))
  sortie <- Sys.getenv("LUSK_TEST_CANONICAL_DATA_DIR")
  reference <- preparer_tables_service(sortie)$tables$territory_reference
  DBI::dbWriteTable(con,"territory_reference",reference,append=TRUE,row.names=FALSE)
  DBI::dbExecute(con,"INSERT INTO table_publication(table_name,content_version,row_count) VALUES('territory_reference',$1,$2)",
    params=list(scalar_content_version(reference),nrow(reference)))
  metadata <- lire_theme_metadata("habitat")
  canonical <- list(habitat=list(indicateurs=nanoparquet::read_parquet(file.path(sortie,"indicateurs_habitat.parquet"))),
    vintages=nanoparquet::read_parquet(file.path(sortie,"vintages.parquet")))
  registry <- register_prix_m2_owned_publisher(list(),metadata)
  adapter <- owned_series_postgres_adapter(con)
  first <- publish_registered_series(registry,"prix_m2_owned",canonical,adapter)
  retry <- publish_registered_series(registry,"prix_m2_owned",canonical,adapter)
  stopifnot(first$changed,!retry$changed)
  canonical$indicateurs <- nanoparquet::read_parquet(file.path(sortie,"indicateurs_milieux.parquet"))
  canonical$histoires <- nanoparquet::read_parquet(file.path(sortie,"histoires_milieux.parquet"))
  milieux <- lire_theme_metadata("milieux")
  registry <- register_owned_series_publishers(list(),milieux)
  for (name in names(registry)) {
    first <- publish_registered_series(registry,name,canonical,adapter)
    retry <- publish_registered_series(registry,name,canonical,adapter)
    stopifnot(first$changed,!retry$changed)
  }
  population <- canonical$vintages[canonical$vintages$id=="serie_historique",,drop=FALSE]
  population_vintage_id <- paste(as.character(population$version[[1L]]),
    as.character(population$date_reference[[1L]]),sep="/")
  DBI::dbExecute(con,"INSERT INTO source_dataset(source_id,name) VALUES('serie_historique','pre-existing source name') ON CONFLICT(source_id) DO UPDATE SET name=EXCLUDED.name")
  DBI::dbExecute(con,"INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date) VALUES('serie_historique',$1,'pre-existing version',NULL,NULL) ON CONFLICT(source_id,vintage_id) DO UPDATE SET version=EXCLUDED.version,reference_date=NULL,publication_date=NULL",
    params=list(population_vintage_id))
  legacy_source_before <- DBI::dbGetQuery(con,"SELECT source_id,name FROM source_dataset WHERE source_id='serie_historique'")
  legacy_vintage_before <- DBI::dbGetQuery(con,"SELECT source_id,vintage_id,version,reference_date,publication_date FROM source_vintage WHERE source_id='serie_historique' AND vintage_id=$1",params=list(population_vintage_id))
  milieux_publication <- publish_canonical_milieux_reading(con,sortie)
  stopifnot(isTRUE(all.equal(legacy_source_before,DBI::dbGetQuery(con,"SELECT source_id,name FROM source_dataset WHERE source_id='serie_historique'"),check.attributes=FALSE)),
    isTRUE(all.equal(legacy_vintage_before,DBI::dbGetQuery(con,"SELECT source_id,vintage_id,version,reference_date,publication_date FROM source_vintage WHERE source_id='serie_historique' AND vintage_id=$1",params=list(population_vintage_id)),check.attributes=FALSE)))
  reading <- milieux_publication$reading
  reading_input <- list(histories=canonical$histoires,vintages=canonical$vintages,
    indicateurs=canonical$indicateurs,metadata=milieux)
  registry <- register_milieux_reading_publisher(list())
  immutable_marker_before <- DBI::dbGetQuery(con,"SELECT table_name,content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name<>'milieux_typed_reading' ORDER BY table_name")
  first_revision_id <- DBI::dbGetQuery(con,"SELECT population_revision_id FROM milieux_reading_source WHERE field_key='population' ORDER BY territory_id LIMIT 1")$population_revision_id[[1L]]
  changed_input <- reading_input
  changed_input$vintages$date_reference[changed_input$vintages$id=="serie_historique"] <- "2023-01-02"
  changed_input$vintages$source[changed_input$vintages$id=="serie_historique"] <- paste0(changed_input$vintages$source[changed_input$vintages$id=="serie_historique"]," — revised")
  changed_publication <- publish_registered_typed_reading(registry,"milieux",changed_input,con)
  stopifnot(changed_publication$changed)
  changed_revision <- DBI::dbGetQuery(con,"SELECT population_revision_id,source_name,source_version,reference_date,publication_date FROM milieux_population_provenance_revision WHERE population_revision_id=(SELECT population_revision_id FROM milieux_reading_source WHERE field_key='population' ORDER BY territory_id LIMIT 1)")
  stopifnot(nrow(changed_revision)==1L,changed_revision$population_revision_id[[1L]]!=first_revision_id,
    changed_revision$source_name[[1L]]==changed_input$vintages$source[changed_input$vintages$id=="serie_historique"],
    as.character(changed_revision$reference_date[[1L]])=="2023-01-02",
    isTRUE(all.equal(immutable_marker_before,DBI::dbGetQuery(con,"SELECT table_name,content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name<>'milieux_typed_reading' ORDER BY table_name"),check.attributes=FALSE)),
    isTRUE(all.equal(legacy_source_before,DBI::dbGetQuery(con,"SELECT source_id,name FROM source_dataset WHERE source_id='serie_historique'"),check.attributes=FALSE)),
    isTRUE(all.equal(legacy_vintage_before,DBI::dbGetQuery(con,"SELECT source_id,vintage_id,version,reference_date,publication_date FROM source_vintage WHERE source_id='serie_historique' AND vintage_id=$1",params=list(population_vintage_id)),check.attributes=FALSE)))
  changed_marker <- DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name='milieux_typed_reading'")
  changed_retry <- publish_registered_typed_reading(registry,"milieux",changed_input,con)
  stopifnot(!changed_retry$changed,isTRUE(all.equal(changed_marker,DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name='milieux_typed_reading'"),check.attributes=FALSE)))
  collision <- registry$milieux$project(changed_input)
  collision_revision <- attr(collision,"population_revisions")
  collision_revision$source_name <- paste0(collision_revision$source_name," collision")
  attr(collision,"population_revisions") <- collision_revision
  collision_bindings <- attr(collision,"source_bindings")
  collision_bindings$source_name[collision_bindings$field_key=="population"] <- collision_revision$source_name[[1L]]
  attr(collision,"source_bindings") <- collision_bindings
  collision_result <- try(publish_milieux_reading(con,collision,changed_input),silent=TRUE)
  stopifnot(inherits(collision_result,"try-error"),
    isTRUE(all.equal(changed_marker,DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name='milieux_typed_reading'"),check.attributes=FALSE)))
  immutable_update <- try(DBI::dbExecute(con,"UPDATE milieux_population_provenance_revision SET source_name='forbidden' WHERE population_revision_id=$1",params=list(changed_revision$population_revision_id[[1L]])),silent=TRUE)
  stopifnot(inherits(immutable_update,"try-error"))
  restored_publication <- publish_registered_typed_reading(registry,"milieux",reading_input,con)
  stopifnot(restored_publication$changed,any(DBI::dbGetQuery(con,"SELECT population_revision_id FROM milieux_population_provenance_revision")$population_revision_id==first_revision_id))
  null_clock_input <- reading_input
  null_clock_input$vintages$date_reference[null_clock_input$vintages$id=="serie_historique"] <- NA_character_
  null_clock_input$vintages$date_publication[null_clock_input$vintages$id=="serie_historique"] <- NA_character_
  null_clock_publication <- publish_registered_typed_reading(registry,"milieux",null_clock_input,con)
  null_revision_id <- DBI::dbGetQuery(con,"SELECT population_revision_id FROM milieux_reading_source WHERE field_key='population' ORDER BY territory_id LIMIT 1")$population_revision_id[[1L]]
  null_revision <- DBI::dbGetQuery(con,"SELECT reference_date,publication_date FROM milieux_population_provenance_revision WHERE population_revision_id=$1",params=list(null_revision_id))
  stopifnot(null_clock_publication$changed,nrow(null_revision)==1L,is.na(null_revision$reference_date[[1L]]),is.na(null_revision$publication_date[[1L]]))
  canonical_clock_restored <- publish_registered_typed_reading(registry,"milieux",reading_input,con)
  stopifnot(canonical_clock_restored$changed)
  marker_before_retry <- DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name='milieux_typed_reading'")
  sources_before_retry <- DBI::dbGetQuery(con,"SELECT count(*) n FROM milieux_reading_source")$n[[1L]]
  retry <- publish_registered_typed_reading(registry,"milieux",reading_input,con)
  marker_after_retry <- DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name='milieux_typed_reading'")
  sources_after_retry <- DBI::dbGetQuery(con,"SELECT count(*) n FROM milieux_reading_source")$n[[1L]]
  stopifnot(reading$changed,!retry$changed,reading$row_count==nrow(canonical$histoires),reading$source_row_count>reading$row_count,
    isTRUE(all.equal(marker_before_retry,marker_after_retry,check.attributes=FALSE)),sources_before_retry==sources_after_retry)
  projection <- registry$milieux$project(reading_input)
  bindings <- attr(projection,"source_bindings")
  invalid <- rbind(projection,projection[1,,drop=FALSE])
  attr(invalid,"source_bindings") <- bindings
  rolled_back <- try(publish_milieux_reading(con,invalid,reading_input),silent=TRUE)
  stopifnot(inherits(rolled_back,"try-error"))
  marker_after_failure <- DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name='milieux_typed_reading'")
  stopifnot(isTRUE(all.equal(marker_before_retry,marker_after_failure,check.attributes=FALSE)),
    DBI::dbGetQuery(con,"SELECT count(*) n FROM milieux_typed_reading")$n[[1L]]==reading$row_count,
    DBI::dbGetQuery(con,"SELECT count(*) n FROM milieux_reading_source")$n[[1L]]==reading$source_row_count)
},finally=DBI::dbDisconnect(con))
