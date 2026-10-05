#!/usr/bin/env Rscript
# Small guarded registered publisher -> disposable PostgreSQL -> HTTP tracer.
pkgload::load_all(".",quiet=TRUE)
required <- c("HOST","PORT","DATABASE","USER")
config <- setNames(lapply(required,function(k) Sys.getenv(paste0("LUSK_PROFILE_TEST_",k),unset="")),required)
stopifnot(all(vapply(config,nzchar,logical(1))), identical(config$DATABASE,Sys.getenv("LUSK_TEST_DATABASE_NAME")),
  grepl("^lusk_it_[A-Za-z0-9_]+$",config$DATABASE),!tolower(config$DATABASE)%in%c("lusk","postgres","template0","template1"),
  identical(config$HOST,"192.168.1.120"),as.integer(config$PORT)==5432L)
read_user <- Sys.getenv("LUSK_TEST_READ_USER",unset=""); read_dsn <- Sys.getenv("LUSK_TEST_READ_DSN",unset="")
stopifnot(nzchar(read_user),nzchar(read_dsn),read_user!=config$USER,
  identical(Sys.getenv("LUSK_TEST_DATABASE_PREFIX"),"lusk_it_"))
con <- DBI::dbConnect(RPostgres::Postgres(),host=config$HOST,port=as.integer(config$PORT),dbname=config$DATABASE,user=config$USER)
schema <- paste0("distribution_it_",Sys.getpid()); created <- FALSE
tryCatch({
  identity <- DBI::dbGetQuery(con,"SELECT current_database() database,current_user username")
  stopifnot(identity$database[[1L]]==config$DATABASE,identity$username[[1L]]==config$USER)
  DBI::dbExecute(con,paste0("CREATE SCHEMA ",DBI::dbQuoteIdentifier(con,schema))); created <- TRUE
  DBI::dbExecute(con,paste0("SET search_path TO ",DBI::dbQuoteIdentifier(con,schema)))
  for(statement in split_postgres_sql(paste(readLines("../api/schema.sql",warn=FALSE),collapse="\n"))) DBI::dbExecute(con,statement)
  # Rehearse migration 024 over preserved prior facts/markers.
  DBI::dbExecute(con,"DROP TABLE mobility_density_distribution_point,mobility_density_distribution_range,mobility_density_distribution_descriptor")
  DBI::dbExecute(con,"DROP FUNCTION assert_mobility_density_distribution_complete(),validate_mobility_density_distribution_territory()")
  DBI::dbExecute(con,"ALTER TABLE table_publication DROP CONSTRAINT table_publication_table_name_check")
  DBI::dbExecute(con,"ALTER TABLE table_publication ADD CONSTRAINT table_publication_table_name_check CHECK(table_name IN
    ('territory_reference','service_registry','essential_service_access','building_ramp','building_grid','scalar_observation','declared_profile','ordered_series','bpe_profile_evidence','demographic_typed_reading','selected_reading','economy_typed_reading','economy_activity_evidence','milieux_typed_reading','mobility_typed_reading'))")
  DBI::dbExecute(con,"ALTER TABLE table_publication DROP CONSTRAINT shared_fact_publication_requires_reference")
  DBI::dbExecute(con,"ALTER TABLE table_publication ADD CONSTRAINT shared_fact_publication_requires_reference CHECK
    (table_name NOT IN ('scalar_observation','declared_profile','ordered_series','bpe_profile_evidence','demographic_typed_reading','selected_reading','economy_typed_reading','economy_activity_evidence','milieux_typed_reading','mobility_typed_reading') OR reference_content_version IS NOT NULL)")
  DBI::dbWriteTable(con,"territory_reference",data.frame(territory_id=c("35238","200000001","35"),
    territory_type=c("commune","epci","departement"),name=c("Focal fixture","EPCI fixture","Department fixture"),
    department_id=c("35","35",NA),epci_id=c("200000001",NA,NA),density_class_code=c("D1",NA,NA),
    density_class_label=c("Fixture",NA,NA),stringsAsFactors=FALSE),append=TRUE,row.names=FALSE)
  reference_version <- "distribution-reference-v1"
  DBI::dbExecute(con,"INSERT INTO table_publication(table_name,content_version,row_count) VALUES('territory_reference',$1,3)",params=list(reference_version))
  metadata <- lire_theme_metadata("mobilite")
  source <- metadata$source_records$mobilite_snapshot
  vintage_id <- paste(source$vintages[[1L]]$version,source$vintages[[1L]]$dateReference,sep="/")
  DBI::dbExecute(con,"INSERT INTO source_dataset(source_id,name) VALUES('mobilite_snapshot',$1)",params=list(source$dataset))
  DBI::dbExecute(con,"INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date) VALUES('mobilite_snapshot',$1,$2,$3,$4)",
    params=list(vintage_id,source$vintages[[1L]]$version,source$vintages[[1L]]$dateReference,source$vintages[[1L]]$datePublication))
  DBI::dbExecute(con,"INSERT INTO mobility_reading_descriptor(singleton,descriptor_version,source_id,vintage_id,source_name,dataset_name,source_version,reference_date,publication_date,unit,direction,allowed_levels,missing_status,classification_values,field_keys,story_count,clock_count)
    VALUES(true,'binding-v1','mobilite_snapshot',$1,$2,$3,$4,$5,$6,'types de service perdu','none',ARRAY['commune','epci','departement','region'],'unavailable',ARRAY['fixture'],ARRAY['groupe','story_key','salience_reason','classification_saillance','div_loss_t','div_loss_b','status'],1,1)",
    params=list(vintage_id,source$dataset,source$dataset,source$vintages[[1L]]$version,source$vintages[[1L]]$dateReference,source$vintages[[1L]]$datePublication))
  DBI::dbExecute(con,"INSERT INTO mobility_reading_story(story_key,groupe,salience_reason,ordinal) VALUES('fixture-story','fixture','defaut',1)")
  DBI::dbExecute(con,"INSERT INTO mobility_reading_clock(ordinal,clock_name,frequency,reference,trigger) VALUES(1,'Fixture clock','fixture','fixture','fixture')")
  DBI::dbExecute(con,"INSERT INTO mobility_typed_reading(territory_id,territory_type,groupe,story_key,salience_reason,classification_saillance,div_loss_t,div_loss_b,status,source_id,vintage_id)
    VALUES('35238','commune','fixture','fixture-story','defaut',NULL,5,4,'measured','mobilite_snapshot',$1)",params=list(vintage_id))
  DBI::dbExecute(con,"INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version) VALUES('mobility_typed_reading','prior-mobility-v1',1,$1)",params=list(reference_version))
  migration <- paste(readLines("../api/migrations/024_mobility_density_distribution.sql",warn=FALSE),collapse="\n")
  for(statement in split_postgres_sql(migration)) DBI::dbExecute(con,statement)
  stopifnot(DBI::dbGetQuery(con,"SELECT content_version,row_count FROM table_publication WHERE table_name='mobility_typed_reading'")$content_version[[1L]]=="prior-mobility-v1",
    DBI::dbGetQuery(con,"SELECT count(*) n FROM mobility_typed_reading")$n[[1L]]==1L)

  ordinals <- 1:10
  fixture_row <- function(id,type,minimum,maximum,densities,deciles) {
    row <- data.frame(territoire=id,type=type,story_key="vingt-minutes-sans-voiture",dens_min=minimum,dens_max=maximum,
      vintage_source=source$dataset,vintage_version=source$vintages[[1L]]$version,
      vintage_date_reference=source$vintages[[1L]]$dateReference,vintage_date_publication=source$vintages[[1L]]$datePublication,
      stringsAsFactors=FALSE)
    for(i in ordinals) { row[[paste0("dens_",i)]]<-densities[[i]]; row[[paste0("dec_",i)]]<-deciles[[i]] }
    row
  }
  histories <- rbind(
    fixture_row("35238","commune",1,52,seq(.01,.10,.01),c(1,4,8,12,18,NA,NA,33,42,52)),
    fixture_row("200000001","epci",2,49,seq(.02,.11,.01),seq(5,49,length.out=10)),
    fixture_row("35","departement",0,53,seq(.03,.12,.01),seq(1,53,length.out=10)))
  vintages <- data.frame(id="mobilite_snapshot",source=source$dataset,version=source$vintages[[1L]]$version,
    date_reference=source$vintages[[1L]]$dateReference,date_publication=source$vintages[[1L]]$datePublication,stringsAsFactors=FALSE)
  input <- list(histories=histories,vintages=vintages,metadata=metadata)
  registry <- register_mobility_density_distribution_publisher(list())
  result <- publish_registered_mobility_density_distribution(registry,"mobility_density_distribution",input,con)
  marker_before <- DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name='mobility_density_distribution'")
  retry <- publish_registered_mobility_density_distribution(registry,"mobility_density_distribution",input,con)
  stopifnot(isTRUE(result$changed),!isTRUE(retry$changed),identical(marker_before,
    DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name='mobility_density_distribution'")))
  DBI::dbExecute(con,"CREATE FUNCTION reject_density_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture rollback'; END $$")
  DBI::dbExecute(con,"CREATE TRIGGER reject_density_fixture BEFORE INSERT ON mobility_density_distribution_point FOR EACH ROW EXECUTE FUNCTION reject_density_fixture()")
  changed_input <- input; changed_input$histories$dens_1[[1L]] <- .015
  failed <- try(publish_registered_mobility_density_distribution(registry,"mobility_density_distribution",changed_input,con),silent=TRUE)
  stopifnot(inherits(failed,"try-error"),identical(marker_before,
    DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name='mobility_density_distribution'")),
    DBI::dbGetQuery(con,"SELECT density FROM mobility_density_distribution_point WHERE territory_id='35238' AND ordinal=0")$density[[1L]]==.01)
  DBI::dbExecute(con,"DROP TRIGGER reject_density_fixture ON mobility_density_distribution_point")
  DBI::dbExecute(con,"DROP FUNCTION reject_density_fixture()")
  DBI::dbExecute(con,paste0("GRANT USAGE ON SCHEMA ",DBI::dbQuoteIdentifier(con,schema)," TO ",DBI::dbQuoteIdentifier(con,read_user)))
  DBI::dbExecute(con,paste0("GRANT SELECT ON ALL TABLES IN SCHEMA ",DBI::dbQuoteIdentifier(con,schema)," TO ",DBI::dbQuoteIdentifier(con,read_user)))
  stopifnot(isTRUE(DBI::dbGetQuery(con,"SELECT has_schema_privilege($1,$2,'USAGE') AS ok",params=list(read_user,schema))$ok[[1L]]))
  old <- Sys.getenv(c("LUSK_DENSITY_TEST_SCHEMA","PYTHONPATH"),unset=NA_character_)
  on.exit(for(i in seq_along(old)) if(is.na(old[[i]])) Sys.unsetenv(names(old)[[i]]) else do.call(Sys.setenv,setNames(list(old[[i]]),names(old)[[i]])),add=TRUE)
  Sys.setenv(LUSK_DENSITY_TEST_SCHEMA=schema,PYTHONPATH=normalizePath("..",winslash="/",mustWork=TRUE))
  test <- normalizePath("../api/tests/integration/test_mobility_density_distribution_http.py",winslash="/",mustWork=TRUE)
  status <- system2(Sys.which("python"),c("-m","pytest","-q",shQuote(test,type="cmd")),stdout="",stderr="")
  if(!identical(status,0L)) stop("Mobility density distribution registered-publisher HTTP check failed",call.=FALSE)
  cat("Mobility density distribution: 3 territories / 30 ordered coordinates; migration preservation, no-op, rollback and PostgreSQL → HTTP: PASS\n")
},finally={if(created) cleanup_serving_smoke_schema(con,schema,"distribution");DBI::dbDisconnect(con)})
