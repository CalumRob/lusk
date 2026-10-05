#!/usr/bin/env Rscript
# Tiny registered Mobility-reading publication exercise in a guarded disposable schema.
pkgload::load_all(".",quiet=TRUE)
args <- commandArgs(TRUE)
stopifnot(length(args)==1L,grepl("^it_[a-f0-9]{20}$",args[[1L]]),
  identical(Sys.getenv("LUSK_TEST_DATABASE_PREFIX"),"lusk_it_"),
  startsWith(Sys.getenv("LUSK_TEST_DATABASE_NAME"),"lusk_it_"))
con <- DBI::dbConnect(RPostgres::Postgres(),host=Sys.getenv("LUSK_PROFILE_TEST_HOST"),
  port=as.integer(Sys.getenv("LUSK_PROFILE_TEST_PORT")),dbname=Sys.getenv("LUSK_PROFILE_TEST_DATABASE"),
  user=Sys.getenv("LUSK_PROFILE_TEST_USER"))
tryCatch({
  identity <- DBI::dbGetQuery(con,"SELECT current_database() database,current_user username")
  stopifnot(identical(identity$database[[1L]],Sys.getenv("LUSK_TEST_DATABASE_NAME")),
    identical(identity$username[[1L]],Sys.getenv("LUSK_PROFILE_TEST_USER")))
  DBI::dbExecute(con,paste("SET search_path TO",DBI::dbQuoteIdentifier(con,args[[1L]])))
  histories <- data.frame(territoire=c("35238","35239"),type="commune",theme="mobilite",
    groupe="acces-aux-services",story_key="vingt-minutes-sans-voiture",salience_reason="defaut",
    div_loss_t=c(8,NA_real_),div_loss_b=c(5,NA_real_),classification_saillance=c("non-saillant",NA_character_))
  vintages <- data.frame(id="mobilite_snapshot",source="Snapshot fixture",version="v1",
    date_reference=NA_character_,date_publication="2026-08-06",stringsAsFactors=FALSE)
  metadata <- list(sources=list(tot_loss_t="mobilite_snapshot",tot_loss_b="mobilite_snapshot"),
    story_keys=c("vingt-minutes-sans-voiture","ce-que-le-velo-preserve"),
    selected_reading_contract=list(unit="types de services",direction="low",
      allowed_levels=c("commune","epci","departement","region"),missing_status="unavailable",
      classification_values=c("saillant","notable","non-saillant"),
      field_keys=c("groupe","story_key","salience_reason","classification_saillance","div_loss_t","div_loss_b","status")),
    source_records=list(mobilite_snapshot=list(dataset="Mobility snapshot dataset",publisher="Snapshot fixture",
      vintages=list(list(id="mobilite_snapshot",version="v1",dateReference=NULL,datePublication="2026-08-06")),
      clocks=list(list(name="BPE",frequency="annual",reference="2024",trigger="new release"),
        list(name="Buildings",frequency="campaign",reference="2025-07",trigger="new campaign")))))
  input <- list(histories=histories,vintages=vintages,metadata=metadata)
  input$content_version <- mobility_reading_content_version(histories,vintages,metadata)
  registry <- register_mobility_reading_publisher(list())
  first <- publish_registered_typed_reading(registry,"mobilite",input,con)
  marker <- DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name='mobility_typed_reading'")
  retry <- publish_registered_typed_reading(registry,"mobilite",input,con)
  stopifnot(first$changed,!retry$changed,first$row_count==2L,
    isTRUE(all.equal(marker,DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name='mobility_typed_reading'"),check.attributes=FALSE)))
  wrong_source <- input
  wrong_source$vintages$source <- "Different registered source name"
  source_rejected <- try(publish_registered_typed_reading(registry,"mobilite",wrong_source,con),silent=TRUE)
  stopifnot(inherits(source_rejected,"try-error"),
    isTRUE(all.equal(marker,DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name='mobility_typed_reading'"),check.attributes=FALSE)))
  invalid <- input
  invalid$histories$territoire <- paste0("missing-reference-",seq_len(nrow(invalid$histories)))
  invalid$content_version <- mobility_reading_content_version(invalid$histories,vintages,metadata)
  rejected <- try(publish_registered_typed_reading(registry,"mobilite",invalid,con),silent=TRUE)
  stopifnot(inherits(rejected,"try-error"),
    isTRUE(all.equal(marker,DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name='mobility_typed_reading'"),check.attributes=FALSE)),
    DBI::dbGetQuery(con,"SELECT count(*) n FROM mobility_typed_reading")$n[[1L]]==2L)
},finally=DBI::dbDisconnect(con))
