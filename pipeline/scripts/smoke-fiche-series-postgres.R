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
  # The owned series and the Milieux reading come from their serving artifacts,
  # through the same readers the pipeline publishes from: no theme Parquet is
  # re-projected here. The shared vintages stay the canonical clock authority.
  adapter <- owned_series_postgres_adapter(con)
  publish_owned_series <- function(id) {
    projection <- read_owned_series_artifact(file.path(sortie,"series-serving",id),id)
    first <- publish_owned_series_projection(projection,adapter)
    retry <- publish_owned_series_projection(projection,adapter)
    stopifnot(first$changed,!retry$changed)
  }
  publish_owned_series("prix_m2")
  for (id in c("conso_enaf_annuel","artif_par_habitant")) publish_owned_series(id)
  vintages <- nanoparquet::read_parquet(file.path(sortie,"vintages.parquet"))
  # #757 : le parquet par-thème Milieux n'est plus écrit — la projection JSON
  # du run dir reste l'oracle (même repli que le smoke Habitat).
  histoires_path <- file.path(sortie,"histoires_milieux.parquet")
  histories <- if (file.exists(histoires_path)) nanoparquet::read_parquet(histoires_path) else
    jsonlite::fromJSON(file.path(sortie,"histoires_milieux.json"))
  milieux <- lire_theme_metadata("milieux")
  population <- vintages[vintages$id=="serie_historique",,drop=FALSE]
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
  reading_result <- milieux_publication$reading
  # The published generation is the artifact itself; a revised canonical clock
  # is projected through the producer's own population-revision rule, and the
  # reading is assembled exactly as the serving writer assembles it.
  published <- read_typed_reading_publication_from(sortie,"milieux")
  projection <- published$projection
  reading <- assemble_typed_reading(projection,"milieux")
  stopifnot(identical(reading,published$reading))
  registry <- register_typed_reading_artifact_publisher(list(),"milieux",publish_milieux_reading)
  reading_version <- typed_reading_content_version(projection,"milieux")
  publish_reading <- function(value) publish_registered_typed_reading(registry,"milieux",
    list(reading=assemble_typed_reading(value,"milieux"),
      content_version=typed_reading_content_version(value,"milieux")),con)
  with_population_clock <- function(value,clock) {
    revision <- project_milieux_population_revision(clock,milieux)
    revised <- value
    revised$population_revisions <- revision
    population_rows <- revised$source_bindings$field_key=="population"
    revised$facts$vintage_id <- revision$vintage_id[[1L]]
    revised$facts$population_source_reference_date <- revision$reference_date[[1L]]
    revised$facts$population_source_publication_date <- revision$publication_date[[1L]]
    revised$source_bindings$vintage_id[population_rows] <- revision$vintage_id[[1L]]
    revised$source_bindings$source_name[population_rows] <- revision$source_name[[1L]]
    revised$source_bindings$reference_date[population_rows] <- revision$reference_date[[1L]]
    revised$source_bindings$publication_date[population_rows] <- revision$publication_date[[1L]]
    revised$source_bindings$population_revision_id[population_rows] <- revision$population_revision_id[[1L]]
    revised
  }
  immutable_marker_before <- DBI::dbGetQuery(con,"SELECT table_name,content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name<>'milieux_typed_reading' ORDER BY table_name")
  first_revision_id <- DBI::dbGetQuery(con,"SELECT population_revision_id FROM milieux_reading_source WHERE field_key='population' ORDER BY territory_id LIMIT 1")$population_revision_id[[1L]]
  changed_clock <- population
  changed_clock$date_reference <- "2023-01-02"
  changed_clock$source <- paste0(changed_clock$source," — revised")
  changed_projection <- with_population_clock(projection,changed_clock)
  changed_publication <- publish_reading(changed_projection)
  stopifnot(changed_publication$changed)
  changed_revision <- DBI::dbGetQuery(con,"SELECT population_revision_id,source_name,source_version,reference_date,publication_date FROM milieux_population_provenance_revision WHERE population_revision_id=(SELECT population_revision_id FROM milieux_reading_source WHERE field_key='population' ORDER BY territory_id LIMIT 1)")
  stopifnot(nrow(changed_revision)==1L,changed_revision$population_revision_id[[1L]]!=first_revision_id,
    changed_revision$source_name[[1L]]==changed_clock$source[[1L]],
    as.character(changed_revision$reference_date[[1L]])=="2023-01-02",
    isTRUE(all.equal(immutable_marker_before,DBI::dbGetQuery(con,"SELECT table_name,content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name<>'milieux_typed_reading' ORDER BY table_name"),check.attributes=FALSE)),
    isTRUE(all.equal(legacy_source_before,DBI::dbGetQuery(con,"SELECT source_id,name FROM source_dataset WHERE source_id='serie_historique'"),check.attributes=FALSE)),
    isTRUE(all.equal(legacy_vintage_before,DBI::dbGetQuery(con,"SELECT source_id,vintage_id,version,reference_date,publication_date FROM source_vintage WHERE source_id='serie_historique' AND vintage_id=$1",params=list(population_vintage_id)),check.attributes=FALSE)))
  changed_marker <- DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name='milieux_typed_reading'")
  changed_retry <- publish_reading(changed_projection)
  stopifnot(!changed_retry$changed,isTRUE(all.equal(changed_marker,DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name='milieux_typed_reading'"),check.attributes=FALSE)))
  # Reusing an already-published revision identity with different immutable
  # fields is refused; the selected facts and the association stay in sync.
  collision <- changed_projection
  collision$population_revisions$source_name <- paste0(collision$population_revisions$source_name," collision")
  collision_bindings <- collision$source_bindings
  collision_bindings$source_name[collision_bindings$field_key=="population"] <- collision$population_revisions$source_name[[1L]]
  collision$source_bindings <- collision_bindings
  collision_result <- try(publish_reading(collision),silent=TRUE)
  stopifnot(inherits(collision_result,"try-error"),
    isTRUE(all.equal(changed_marker,DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name='milieux_typed_reading'"),check.attributes=FALSE)))
  immutable_update <- try(DBI::dbExecute(con,"UPDATE milieux_population_provenance_revision SET source_name='forbidden' WHERE population_revision_id=$1",params=list(changed_revision$population_revision_id[[1L]])),silent=TRUE)
  stopifnot(inherits(immutable_update,"try-error"))
  restored_publication <- publish_reading(projection)
  stopifnot(restored_publication$changed,any(DBI::dbGetQuery(con,"SELECT population_revision_id FROM milieux_population_provenance_revision")$population_revision_id==first_revision_id))
  null_clock <- population
  null_clock$date_reference <- NA_character_
  null_clock$date_publication <- NA_character_
  null_clock_projection <- with_population_clock(projection,null_clock)
  null_clock_publication <- publish_reading(null_clock_projection)
  null_revision_id <- DBI::dbGetQuery(con,"SELECT population_revision_id FROM milieux_reading_source WHERE field_key='population' ORDER BY territory_id LIMIT 1")$population_revision_id[[1L]]
  null_revision <- DBI::dbGetQuery(con,"SELECT reference_date,publication_date FROM milieux_population_provenance_revision WHERE population_revision_id=$1",params=list(null_revision_id))
  stopifnot(null_clock_publication$changed,nrow(null_revision)==1L,is.na(null_revision$reference_date[[1L]]),is.na(null_revision$publication_date[[1L]]))
  canonical_clock_restored <- publish_reading(projection)
  stopifnot(canonical_clock_restored$changed)
  marker_before_retry <- DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name='milieux_typed_reading'")
  sources_before_retry <- DBI::dbGetQuery(con,"SELECT count(*) n FROM milieux_reading_source")$n[[1L]]
  retry <- publish_reading(projection)
  marker_after_retry <- DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name='milieux_typed_reading'")
  sources_after_retry <- DBI::dbGetQuery(con,"SELECT count(*) n FROM milieux_reading_source")$n[[1L]]
  stopifnot(reading_result$changed,!retry$changed,reading_result$row_count==nrow(histories),reading_result$source_row_count>reading_result$row_count,
    isTRUE(all.equal(marker_before_retry,marker_after_retry,check.attributes=FALSE)),sources_before_retry==sources_after_retry)
  invalid <- rbind(reading,reading[1,,drop=FALSE])
  attr(invalid,"source_bindings") <- attr(reading,"source_bindings")
  attr(invalid,"population_revisions") <- attr(reading,"population_revisions")
  rolled_back <- try(publish_milieux_reading(con,invalid,list(content_version=reading_version)),silent=TRUE)
  stopifnot(inherits(rolled_back,"try-error"))
  marker_after_failure <- DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name='milieux_typed_reading'")
  stopifnot(isTRUE(all.equal(marker_before_retry,marker_after_failure,check.attributes=FALSE)),
    DBI::dbGetQuery(con,"SELECT count(*) n FROM milieux_typed_reading")$n[[1L]]==reading_result$row_count,
    DBI::dbGetQuery(con,"SELECT count(*) n FROM milieux_reading_source")$n[[1L]]==reading_result$source_row_count)
},finally=DBI::dbDisconnect(con))
