#!/usr/bin/env Rscript
# Bounded registered Mobility-reading publication using read-only canonical
# artifacts. Publishes only the territory reference and selected reading family.
pkgload::load_all(".",quiet=TRUE)
args <- commandArgs(TRUE)
stopifnot(length(args)==2L,grepl("^it_[a-f0-9]{20}$",args[[1L]]),
  identical(normalizePath(args[[2L]],winslash="/",mustWork=TRUE),
    normalizePath("E:/Lusk/public/data",winslash="/",mustWork=TRUE)),
  identical(Sys.getenv("LUSK_TEST_DATABASE_PREFIX"),"lusk_it_"),
  startsWith(Sys.getenv("LUSK_TEST_DATABASE_NAME"),"lusk_it_"))
schema <- args[[1L]]
data_dir <- args[[2L]]
con <- DBI::dbConnect(RPostgres::Postgres(),host=Sys.getenv("LUSK_PROFILE_TEST_HOST"),
  port=as.integer(Sys.getenv("LUSK_PROFILE_TEST_PORT")),dbname=Sys.getenv("LUSK_PROFILE_TEST_DATABASE"),
  user=Sys.getenv("LUSK_PROFILE_TEST_USER"))
tryCatch({
  identity <- DBI::dbGetQuery(con,"SELECT current_database() database,current_user username")
  stopifnot(identical(identity$database[[1L]],Sys.getenv("LUSK_TEST_DATABASE_NAME")),
    identical(identity$username[[1L]],Sys.getenv("LUSK_PROFILE_TEST_USER")))
  DBI::dbExecute(con,paste("SET search_path TO",DBI::dbQuoteIdentifier(con,schema)))

  histories_path <- file.path(data_dir,"histoires_mobilite.parquet")
  vintages_path <- file.path(data_dir,"vintages.parquet")
  reference_path <- file.path(data_dir,"territoires.parquet")
  stopifnot(all(file.exists(c(histories_path,vintages_path,reference_path))))
  histories <- nanoparquet::read_parquet(histories_path)
  vintages <- nanoparquet::read_parquet(vintages_path)
  territories <- nanoparquet::read_parquet(reference_path)
  metadata <- lire_theme_metadata("mobilite")

  reference <- data.frame(
    territory_id=as.character(territories$territoire),
    territory_type=as.character(territories$type),
    name=as.character(territories$nom),
    department_id=as.character(territories$departement),
    epci_id=as.character(territories$epci),
    density_class_code=as.character(territories$classe_densite_code),
    density_class_label=as.character(territories$classe_densite_libelle_public),
    stringsAsFactors=FALSE)
  stopifnot(nrow(reference)==1268L,!anyNA(reference[c("territory_id","territory_type","name")]),
    !anyDuplicated(reference[c("territory_id","territory_type")]))
  DBI::dbWriteTable(con,"territory_reference",reference,append=TRUE,row.names=FALSE)
  reference_version <- paste0("territoires-",unname(tools::md5sum(reference_path)))
  DBI::dbExecute(con,"INSERT INTO table_publication(table_name,content_version,row_count,published_at)
    VALUES('territory_reference',$1,$2,now())",params=list(reference_version,nrow(reference)))

  source_id <- metadata$sources$tot_loss_t
  vintage <- vintages[vintages$id==source_id,,drop=FALSE]
  stopifnot(nrow(vintage)==1L)
  vintage_id <- paste(as.character(vintage$version[[1L]]),
    as.character(vintage$date_reference[[1L]]),sep="/")
  # This is a fresh disposable schema: register the actual immutable legacy
  # identity once, without an upsert or mutation of any pre-existing source.
  DBI::dbExecute(con,"INSERT INTO source_dataset(source_id,name) VALUES($1,$2)",
    params=list(source_id,as.character(vintage$source[[1L]])))
  DBI::dbExecute(con,"INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date)
    VALUES($1,$2,$3,$4::date,$5::date)",params=list(source_id,vintage_id,
      as.character(vintage$version[[1L]]),as.character(vintage$date_reference[[1L]]),
      as.character(vintage$date_publication[[1L]])))

  expected <- histories[histories$theme=="mobilite",
    c("territoire","type","groupe","story_key","salience_reason","classification_saillance",
      "div_loss_t","div_loss_b"),drop=FALSE]
  names(expected)[1:2] <- c("territory_id","territory_type")
  expected$status <- ifelse(!is.na(expected$div_loss_t)&!is.na(expected$div_loss_b),"measured","unavailable")
  expected$source_id <- source_id
  expected$vintage_id <- vintage_id
  expected <- expected[order(expected$territory_id,expected$territory_type,expected$groupe),,drop=FALSE]

  canonical <- list(histories=histories,vintages=vintages,metadata=metadata)
  canonical$content_version <- mobility_reading_content_version(histories,vintages,metadata)
  publisher <- register_mobility_reading_publisher(list())
  published <- publish_registered_typed_reading(publisher,"mobilite",canonical,con)
  marker_before <- DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at
    FROM table_publication WHERE table_name='mobility_typed_reading'")
  retry <- publish_registered_typed_reading(publisher,"mobilite",canonical,con)
  marker_after <- DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at
    FROM table_publication WHERE table_name='mobility_typed_reading'")
  stored <- DBI::dbGetQuery(con,"SELECT territory_id,territory_type,groupe,story_key,salience_reason,
    classification_saillance,div_loss_t,div_loss_b,status,source_id,vintage_id
    FROM mobility_typed_reading ORDER BY territory_id,territory_type,groupe")
  stopifnot(published$changed,!retry$changed,nrow(expected)==1266L,nrow(stored)==1266L,
    isTRUE(all.equal(stored,expected,check.attributes=FALSE)),
    isTRUE(all.equal(marker_before,marker_after,check.attributes=FALSE)),
    marker_before$row_count[[1L]]==1266L,
    marker_before$reference_content_version[[1L]]==reference_version)

  descriptor <- DBI::dbGetQuery(con,"SELECT source_id,vintage_id,source_name,dataset_name,source_version,
    reference_date,publication_date,unit,direction,allowed_levels,missing_status,classification_values,
    field_keys,story_count,clock_count FROM mobility_reading_descriptor WHERE singleton")
  record <- metadata$source_records[[source_id]]
  pg_array <- function(value) {
    if(is.list(value)) return(as.character(unlist(value,use.names=FALSE)))
    text <- as.character(value)
    if(length(text)==1L && startsWith(text,"{") && endsWith(text,"}")) {
      contents <- substring(text,2L,nchar(text)-1L)
      return(if(nzchar(contents)) strsplit(contents,",",fixed=TRUE)[[1L]] else character())
    }
    text
  }
  stopifnot(nrow(descriptor)==1L,descriptor$source_id[[1L]]==source_id,
    descriptor$vintage_id[[1L]]==vintage_id,descriptor$source_name[[1L]]==vintage$source[[1L]],
    descriptor$dataset_name[[1L]]==record$dataset,descriptor$source_version[[1L]]==vintage$version[[1L]],
    identical(format(descriptor$reference_date[[1L]],"%Y-%m-%d"),as.character(vintage$date_reference[[1L]])),
    identical(format(descriptor$publication_date[[1L]],"%Y-%m-%d"),as.character(vintage$date_publication[[1L]])),
    descriptor$unit[[1L]]==metadata$selected_reading_contract$unit,
    descriptor$direction[[1L]]==metadata$selected_reading_contract$direction,
    setequal(pg_array(descriptor$allowed_levels[[1L]]),unlist(metadata$selected_reading_contract$allowed_levels)),
    descriptor$missing_status[[1L]]==metadata$selected_reading_contract$missing_status,
    setequal(pg_array(descriptor$classification_values[[1L]]),unlist(metadata$selected_reading_contract$classification_values)),
    setequal(pg_array(descriptor$field_keys[[1L]]),unlist(metadata$selected_reading_contract$field_keys)),
    descriptor$story_count[[1L]]==nrow(STORIES_RESOLUES_PAR_THEME$mobilite),
    descriptor$clock_count[[1L]]==length(record$clocks))
  expected_stories <- data.frame(story_key=as.character(STORIES_RESOLUES_PAR_THEME$mobilite$story_key),
    groupe=as.character(STORIES_RESOLUES_PAR_THEME$mobilite$groupe),
    salience_reason=ifelse(is.na(STORIES_RESOLUES_PAR_THEME$mobilite$salience_reason),SALIENCE_DEFAUT,
      as.character(STORIES_RESOLUES_PAR_THEME$mobilite$salience_reason)),
    ordinal=as.integer(STORIES_RESOLUES_PAR_THEME$mobilite$ordre),stringsAsFactors=FALSE)
  expected_stories <- expected_stories[order(expected_stories$ordinal),,drop=FALSE]
  stored_stories <- DBI::dbGetQuery(con,"SELECT story_key,groupe,salience_reason,ordinal
    FROM mobility_reading_story ORDER BY ordinal")
  stopifnot(isTRUE(all.equal(stored_stories,expected_stories,check.attributes=FALSE)))
  expected_clocks <- do.call(rbind,lapply(seq_along(record$clocks),function(i) data.frame(ordinal=i,
    clock_name=record$clocks[[i]]$name,frequency=record$clocks[[i]]$frequency,
    reference=record$clocks[[i]]$reference,trigger=record$clocks[[i]]$trigger,stringsAsFactors=FALSE)))
  stored_clocks <- DBI::dbGetQuery(con,"SELECT ordinal,clock_name,frequency,reference,trigger
    FROM mobility_reading_clock ORDER BY ordinal")
  stopifnot(isTRUE(all.equal(stored_clocks,expected_clocks,check.attributes=FALSE)))

  focal_ids <- c("35238","243500139","35","53")
  focal <- expected[expected$territory_id %in% focal_ids,,drop=FALSE]
  stopifnot(nrow(focal)==4L,setequal(focal$territory_id,focal_ids))
  focal_reference <- reference[match(focal$territory_id,reference$territory_id),,drop=FALSE]
  names(focal)[names(focal)=="territory_id"] <- "territory_id"
  focal_json <- lapply(seq_len(nrow(focal)),function(i) {
    row <- focal[i,,drop=FALSE]
    list(territory_id=row$territory_id[[1L]],territory_type=row$territory_type[[1L]],
      territory_name=focal_reference$name[[i]],
      groupe=row$groupe[[1L]],story_key=row$story_key[[1L]],salience_reason=row$salience_reason[[1L]],
      classification_saillance=if(is.na(row$classification_saillance[[1L]])) NULL else row$classification_saillance[[1L]],
      div_loss_t=if(is.na(row$div_loss_t[[1L]])) NULL else row$div_loss_t[[1L]],
      div_loss_b=if(is.na(row$div_loss_b[[1L]])) NULL else row$div_loss_b[[1L]],
      status=row$status[[1L]],source_id=row$source_id[[1L]],vintage_id=row$vintage_id[[1L]],
      unit=metadata$selected_reading_contract$unit,direction=metadata$selected_reading_contract$direction,
      provenance=list(source_id=source_id,source_name=as.character(vintage$source[[1L]]),
        dataset_name=record$dataset,vintage_id=vintage_id,source_version=as.character(vintage$version[[1L]]),
        source_reference_date=as.character(vintage$date_reference[[1L]]),
        source_publication_date=as.character(vintage$date_publication[[1L]]),
        windows=lapply(record$clocks,function(clock) list(name=clock$name,frequency=clock$frequency,
          reference=clock$reference,trigger=clock$trigger))))
  })
  cat("CANONICAL_SQL_PARITY=1266 REFERENCE_ROWS=1268 NOOP_RETRY=TRUE\n")
  cat("CANONICAL_HTTP_EXPECTED=",as.character(jsonlite::toJSON(focal_json,auto_unbox=TRUE,null="null",digits=NA)),"\n",sep="")
},finally=DBI::dbDisconnect(con))
