#!/usr/bin/env Rscript
# Canonical Habitat typed reading -> registered DPE scalar/profile dependencies -> HTTP.
pkgload::load_all(".", quiet=TRUE)
required <- c("HOST","PORT","DATABASE","USER")
config <- setNames(lapply(required,function(k) Sys.getenv(paste0("LUSK_PROFILE_TEST_",k),unset="")),required)
stopifnot(all(vapply(config,nzchar,logical(1))),grepl("^lusk_it_[A-Za-z0-9_]+$",config$DATABASE),
  identical(Sys.getenv("LUSK_TEST_DATABASE_NAME"),config$DATABASE),
  identical(Sys.getenv("LUSK_TEST_DATABASE_PREFIX"),"lusk_it_"))
read_user <- Sys.getenv("LUSK_TEST_READ_USER",unset="")
stopifnot(nzchar(read_user),read_user!=config$USER)
canonical_dir <- Sys.getenv("LUSK_TEST_CANONICAL_DATA_DIR",unset="")
stopifnot(dir.exists(canonical_dir))
con <- DBI::dbConnect(RPostgres::Postgres(),host=config$HOST,port=as.integer(config$PORT),
  dbname=config$DATABASE,user=config$USER)
schema <- paste0("reading_it_",Sys.getpid(),"_habitat"); created <- FALSE
tryCatch({
  identity <- DBI::dbGetQuery(con,"SELECT current_database(),current_user")
  stopifnot(identity[[1L]][[1L]]==config$DATABASE,identity[[2L]][[1L]]==config$USER)
  DBI::dbExecute(con,paste0("CREATE SCHEMA ",DBI::dbQuoteIdentifier(con,schema))); created <- TRUE
  DBI::dbExecute(con,paste0("SET search_path TO ",DBI::dbQuoteIdentifier(con,schema)))
  ddl <- paste(readLines("../api/schema.sql",warn=FALSE),collapse="\n")
  for(statement in split_postgres_sql(ddl)) DBI::dbExecute(con,statement)

  inputs <- preparer_tables_service(canonical_dir)
  published <- publier_tables_postgres(con,inputs$tables,inputs$versions,inputs$access_scope,
    inputs$building_contract,inputs$building_sources)
  stopifnot(all(c("territory_reference","essential_service_access") %in% published))
  scalar <- project_service_scalar_snapshot(inputs,canonical_dir)
  publish_service_share_scalars(con,inputs$scalar_access,inputs$scalar_metadata,
    inputs$scalar_eligible_territories,additional_projections=scalar$additional_projections)

  read_canonical <- function(name) nanoparquet::read_parquet(file.path(canonical_dir,paste0(name,".parquet")))
  territories <- read_canonical("territoires"); vintages <- read_canonical("vintages")
  demography_metadata <- lire_theme_metadata("demographie")
  habitat_metadata <- lire_theme_metadata("habitat")
  mobility_metadata <- lire_theme_metadata("mobilite")
  demography <- list(indicateurs=read_canonical("indicateurs_demographie"),territoires=territories)
  habitat <- list(indicateurs=read_canonical("indicateurs_habitat"),territoires=territories,source_vintages=vintages)
  mobility <- list(indicateurs=read_canonical("indicateurs_mobilite"),territoires=territories,source_vintages=vintages)
  scalar_version <- DBI::dbGetQuery(con,"SELECT content_version FROM table_publication WHERE table_name='scalar_observation'")[["content_version"]][[1L]]
  profile <- publier_declared_profiles_postgres(demography,demography_metadata,habitat,habitat_metadata,
    scalar_version,con=con,mobilite=mobility,mobilite_metadata=mobility_metadata,mobilite_vintages=vintages)
  stopifnot(profile$changed,
    DBI::dbGetQuery(con,"SELECT count(*) FROM profile_observation_source WHERE indicator_id='distribution_dpe'")[[1L]][[1L]]>0L)

  histories <- read_canonical("histoires_habitat")
  history_path <- file.path(canonical_dir,"histoires_habitat.parquet")
  indicator_path <- file.path(canonical_dir,"indicateurs_habitat.parquet")
  dpe_source <- vintages[vintages[["id"]]==habitat_metadata$sources$part_passoires,,drop=FALSE]
  stopifnot(nrow(histories)>0L,nrow(dpe_source)==1L)
  content_version <- paste(unname(tools::md5sum(history_path)),dpe_source[["version"]][[1L]],
    dpe_source[["date_reference"]][[1L]],dpe_source[["date_publication"]][[1L]],
    unname(tools::md5sum(indicator_path)),sep="-")
  canonical <- list(histories=histories,vintages=vintages,metadata=habitat_metadata,
    content_version=content_version,linked_content_version=unname(tools::md5sum(indicator_path)))
  registry <- register_habitat_reading_publisher(list())
  result <- publish_registered_typed_reading(registry,"habitat",canonical,con)
  marker <- DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM selected_reading_publication WHERE theme_id='habitat'")
  generic_marker <- DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name='selected_reading'")
  stored_rows <- DBI::dbGetQuery(con,"SELECT * FROM habitat_typed_reading ORDER BY territory_type,territory_id,groupe")
  profile_binding <- DBI::dbGetQuery(con,"SELECT territory_id,source_id,vintage_id FROM profile_observation_source
    WHERE indicator_id='distribution_dpe' ORDER BY territory_id,detail_key,sex_key LIMIT 1")
  DBI::dbExecute(con,"INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date)
    SELECT source_id,vintage_id || '-review-probe','review-probe',reference_date,publication_date
    FROM source_vintage WHERE source_id=$1 AND vintage_id=$2",
    params=list(profile_binding$source_id[[1L]],profile_binding$vintage_id[[1L]]))
  DBI::dbExecute(con,"UPDATE profile_observation_source SET vintage_id=$1
    WHERE indicator_id='distribution_dpe' AND territory_id=$2 AND source_id=$3 AND vintage_id=$4",
    params=list(paste0(profile_binding$vintage_id[[1L]],"-review-probe"),profile_binding$territory_id[[1L]],
      profile_binding$source_id[[1L]],profile_binding$vintage_id[[1L]]))
  mismatch <- try(publish_registered_typed_reading(registry,"habitat",canonical,con),silent=TRUE)
  stopifnot(inherits(mismatch,"try-error"))
  DBI::dbExecute(con,"UPDATE profile_observation_source SET vintage_id=$1
    WHERE indicator_id='distribution_dpe' AND territory_id=$2 AND source_id=$3 AND vintage_id=$4",
    params=list(profile_binding$vintage_id[[1L]],profile_binding$territory_id[[1L]],profile_binding$source_id[[1L]],
      paste0(profile_binding$vintage_id[[1L]],"-review-probe")))
  DBI::dbExecute(con,"DELETE FROM source_vintage WHERE source_id=$1 AND vintage_id=$2",
    params=list(profile_binding$source_id[[1L]],paste0(profile_binding$vintage_id[[1L]],"-review-probe")))
  stopifnot(identical(marker,DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM selected_reading_publication WHERE theme_id='habitat'")),
    identical(generic_marker,DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name='selected_reading'")),
    identical(stored_rows,DBI::dbGetQuery(con,"SELECT * FROM habitat_typed_reading ORDER BY territory_type,territory_id,groupe")))
  DBI::dbExecute(con,"CREATE FUNCTION reject_habitat_reading_row() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.territory_id = current_setting('lusk.review_skip_territory',true) THEN RETURN NULL; END IF; RETURN NEW; END $$")
  DBI::dbExecute(con,"CREATE TRIGGER review_skip_habitat_row BEFORE INSERT ON habitat_typed_reading
    FOR EACH ROW EXECUTE FUNCTION reject_habitat_reading_row()")
  DBI::dbGetQuery(con,"SELECT set_config('lusk.review_skip_territory',$1,false)",params=list(histories$territoire[[1L]]))
  bad_count_input <- canonical
  bad_count_input$content_version <- paste0(canonical$content_version,"-count-probe")
  bad_count_publish <- try(publish_registered_typed_reading(registry,"habitat",bad_count_input,con),silent=TRUE)
  DBI::dbExecute(con,"DROP TRIGGER review_skip_habitat_row ON habitat_typed_reading")
  DBI::dbExecute(con,"DROP FUNCTION reject_habitat_reading_row()")
  stopifnot(inherits(bad_count_publish,"try-error"),identical(marker,
    DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM selected_reading_publication WHERE theme_id='habitat'")),
    identical(generic_marker,DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name='selected_reading'")),
    identical(stored_rows,DBI::dbGetQuery(con,"SELECT * FROM habitat_typed_reading ORDER BY territory_type,territory_id,groupe")))
  count_noop <- publish_registered_typed_reading(registry,"habitat",canonical,con)
  stopifnot(!count_noop$changed,identical(marker,
    DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM selected_reading_publication WHERE theme_id='habitat'")),
    identical(generic_marker,DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name='selected_reading'")))
  retry <- publish_registered_typed_reading(registry,"habitat",canonical,con)
  stopifnot(result$changed,!retry$changed,identical(marker,
    DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM selected_reading_publication WHERE theme_id='habitat'")))
  stopifnot(identical(generic_marker,DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name='selected_reading'")))
  failed_input <- canonical
  measured <- project_habitat_reading(failed_input$histories,vintages,habitat_metadata)
  measured_index <- which(measured$status=="measured")[[1L]]
  source_index <- match(paste(measured$territory_id[[measured_index]],measured$territory_type[[measured_index]]),
    paste(failed_input$histories[["territoire"]],failed_input$histories[["type"]]))
  failed_input$histories[["part_passoires"]][[source_index]] <- 2
  failed_input$content_version <- paste0(canonical$content_version,"-rollback-probe")
  failed_publish <- try(publish_registered_typed_reading(registry,"habitat",failed_input,con),silent=TRUE)
  stopifnot(inherits(failed_publish,"try-error"),identical(marker,
    DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM selected_reading_publication WHERE theme_id='habitat'")),
    DBI::dbGetQuery(con,"SELECT count(*) FROM habitat_typed_reading")[[1L]][[1L]]==nrow(histories))
  actual <- DBI::dbGetQuery(con,"SELECT territory_id,territory_type,groupe,story_key,salience_reason,classification,
    part_passoires,part_abc,n_dpe,status,source_id,vintage_id FROM habitat_typed_reading ORDER BY territory_type,territory_id,groupe")
  expected <- project_habitat_reading(histories,vintages,habitat_metadata)
  expected <- expected[order(expected$territory_type,expected$territory_id,expected$groupe),names(actual),drop=FALSE]
  rownames(actual)<-rownames(expected)<-NULL
  stopifnot(isTRUE(all.equal(actual,expected,check.attributes=FALSE)),nrow(actual)==nrow(histories))
  DBI::dbExecute(con,paste0("GRANT USAGE ON SCHEMA ",DBI::dbQuoteIdentifier(con,schema)," TO ",DBI::dbQuoteIdentifier(con,read_user)))
  DBI::dbExecute(con,paste0("GRANT SELECT ON ALL TABLES IN SCHEMA ",DBI::dbQuoteIdentifier(con,schema)," TO ",DBI::dbQuoteIdentifier(con,read_user)))
  keys<-c("LUSK_READING_HTTP_SCHEMA","PYTHONPATH","LUSK_HABITAT_EXPECT_UNAVAILABLE"); old<-Sys.getenv(keys,unset=NA_character_)
  on.exit(for(i in seq_along(keys)) if(is.na(old[[i]])) Sys.unsetenv(keys[[i]]) else do.call(Sys.setenv,setNames(list(old[[i]]),keys[[i]])),add=TRUE)
  Sys.setenv(LUSK_READING_HTTP_SCHEMA=schema,PYTHONPATH=normalizePath("..",winslash="/",mustWork=TRUE))
  test<-normalizePath("../api/tests/integration/test_reading_publisher_http.py",winslash="/",mustWork=TRUE)
  status<-system2(Sys.which("python"),c("-m","pytest","-q",shQuote(test,type="cmd"),"-k","habitat"),stdout="",stderr="")
  if(!identical(status,0L)) stop("Canonical Habitat publisher-to-HTTP parity failed",call.=FALSE)
  expect_unavailable <- function(table_name,mutation) {
    prior_marker <- DBI::dbGetQuery(con,"SELECT * FROM table_publication WHERE table_name=$1",params=list(table_name))
    stopifnot(nrow(prior_marker)==1L)
    DBI::dbExecute(con,mutation)
    Sys.setenv(LUSK_HABITAT_EXPECT_UNAVAILABLE="1")
    code <- tryCatch(system2(Sys.which("python"),c("-m","pytest","-q",shQuote(test,type="cmd"),"-k","habitat"),stdout="",stderr=""),finally={
      if(table_name=="declared_profile") DBI::dbWriteTable(con,"table_publication",prior_marker,append=TRUE,row.names=FALSE)
      else DBI::dbExecute(con,"UPDATE table_publication SET content_version=$1 WHERE table_name=$2",
        params=list(prior_marker$content_version[[1L]],table_name))
      Sys.unsetenv("LUSK_HABITAT_EXPECT_UNAVAILABLE")
    })
    if(!identical(code,0L)) stop("Habitat stale/missing dependency did not fail closed over HTTP",call.=FALSE)
  }
  expect_unavailable("declared_profile","DELETE FROM table_publication WHERE table_name='declared_profile'")
  expect_unavailable("scalar_observation","UPDATE table_publication SET content_version='deliberately-stale' WHERE table_name='scalar_observation'")
  count_marker <- DBI::dbGetQuery(con,"SELECT row_count FROM table_publication WHERE table_name='selected_reading'")$row_count[[1L]]
  DBI::dbExecute(con,"UPDATE table_publication SET row_count=row_count+1 WHERE table_name='selected_reading'")
  Sys.setenv(LUSK_HABITAT_EXPECT_UNAVAILABLE="1")
  count_status <- tryCatch(system2(Sys.which("python"),c("-m","pytest","-q",shQuote(test,type="cmd"),"-k","habitat"),stdout="",stderr=""),finally={
    DBI::dbExecute(con,"UPDATE table_publication SET row_count=$1 WHERE table_name='selected_reading'",params=list(count_marker))
    Sys.unsetenv("LUSK_HABITAT_EXPECT_UNAVAILABLE")
  })
  if(!identical(count_status,0L)) stop("Incorrect selected-reading marker count did not fail closed",call.=FALSE)
  cat("Canonical Habitat typed readings:",nrow(actual)," rows; registered scalar/profile dependencies, canonical Parquet → HTTP: PASS\n")
},finally={if(created) cleanup_serving_smoke_schema(con,schema,"reading");DBI::dbDisconnect(con)})
