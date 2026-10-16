#!/usr/bin/env Rscript
# Guarded canonical demographic reading → PostgreSQL → HTTP acceptance tracer.
pkgload::load_all(".", quiet=TRUE)
required <- c("HOST","PORT","DATABASE","USER")
config <- setNames(lapply(required,function(k) Sys.getenv(paste0("LUSK_PROFILE_TEST_",k),unset="")),required)
stopifnot(all(vapply(config,nzchar,logical(1))),grepl("^lusk_it_[A-Za-z0-9_]+$",config$DATABASE),
  !tolower(config$DATABASE)%in%c("lusk","postgres","template0","template1"))
read_user <- Sys.getenv("LUSK_TEST_READ_USER",unset=""); read_dsn <- Sys.getenv("LUSK_TEST_READ_DSN",unset="")
canonical_dir <- Sys.getenv("LUSK_TEST_CANONICAL_DATA_DIR",unset="")
stopifnot(nzchar(read_user),nzchar(read_dsn),read_user!=config$USER,
  identical(Sys.getenv("LUSK_TEST_DATABASE_PREFIX"),"lusk_it_"),
  identical(Sys.getenv("LUSK_TEST_DATABASE_NAME"),config$DATABASE),dir.exists(canonical_dir))
con <- DBI::dbConnect(RPostgres::Postgres(),host=config$HOST,port=as.integer(config$PORT),
  dbname=config$DATABASE,user=config$USER)
schema <- paste0("reading_it_",Sys.getpid()); created <- FALSE
tryCatch({
  identity <- DBI::dbGetQuery(con,"SELECT current_database() database,current_user username")
  stopifnot(identity$database[[1L]]==config$DATABASE,identity$username[[1L]]==config$USER)
  DBI::dbExecute(con,paste0("CREATE SCHEMA ",DBI::dbQuoteIdentifier(con,schema))); created <- TRUE
  DBI::dbExecute(con,paste0("SET search_path TO ",DBI::dbQuoteIdentifier(con,schema)))
  ddl <- paste(readLines("../api/schema.sql",warn=FALSE),collapse="\n")
  for (statement in split_postgres_sql(ddl)) DBI::dbExecute(con,statement)
  read_canonical <- function(name) nanoparquet::read_parquet(file.path(canonical_dir,paste0(name,".parquet")))
  territories <- read_canonical("territoires"); vintages <- read_canonical("vintages")
  # The theme Parquet history stays the independent oracle of the stored rows.
  histories <- read_canonical("histoires_demographie")
  stopifnot(nrow(histories)==1268L)
  publish_canonical_territory_reference(con, canonical_dir)
  source <- vintages[vintages$id=="serie_historique",,drop=FALSE]
  stopifnot(nrow(source)==1L)
  DBI::dbExecute(con,"INSERT INTO source_dataset(source_id,name) VALUES($1,$2)",params=list(source$id[[1L]],source$source[[1L]]))
  DBI::dbExecute(con,"INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date) VALUES($1,$1,$2,$3,$4)",
    params=list(source$id[[1L]],source$version[[1L]],source$date_reference[[1L]],source$date_publication[[1L]]))
  demographic_metadata <- lire_theme_metadata("demographie")
  # The published reading is the owner-scoped serving artifact: the theme Parquet
  # history above is only the independent oracle, never re-projected here.
  publication <- read_typed_reading_publication_from(canonical_dir,"demographie")
  canonical <- list(reading=publication$reading,content_version=publication$content_version)
  registry <- register_typed_reading_artifact_publisher(list(),"demographie",publish_demographic_reading)
  result <- publish_registered_typed_reading(registry,"demographie",canonical,con)
  marker_before_retry <- DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name='demographic_typed_reading'")
  retry <- publish_registered_typed_reading(registry,"demographie",canonical,con)
  stopifnot(isTRUE(result$changed),!isTRUE(retry$changed),identical(marker_before_retry,
    DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name='demographic_typed_reading'")))
  actual <- DBI::dbGetQuery(con,"SELECT territory_id,territory_type,groupe,story_key,salience_reason,periode,
    solde_naturel,solde_migratoire,taux_solde_naturel,taux_solde_migratoire,classification,status
    FROM demographic_typed_reading ORDER BY territory_type,territory_id,groupe")
  expected <- project_demographic_reading(histories,territories,vintages,demographic_metadata)
  expected <- expected[order(expected$territory_type,expected$territory_id,expected$groupe),
    names(actual),drop=FALSE]; rownames(actual)<-rownames(expected)<-NULL
  stopifnot(isTRUE(all.equal(actual,expected,check.attributes=FALSE)),result$row_count==1268L)
  DBI::dbExecute(con,paste0("GRANT USAGE ON SCHEMA ",DBI::dbQuoteIdentifier(con,schema)," TO ",DBI::dbQuoteIdentifier(con,read_user)))
  DBI::dbExecute(con,paste0("GRANT SELECT ON ALL TABLES IN SCHEMA ",DBI::dbQuoteIdentifier(con,schema)," TO ",DBI::dbQuoteIdentifier(con,read_user)))
  keys<-c("LUSK_READING_HTTP_SCHEMA","PYTHONPATH"); old<-Sys.getenv(keys,unset=NA_character_)
  on.exit(for(i in seq_along(keys)) if(is.na(old[[i]])) Sys.unsetenv(keys[[i]]) else do.call(Sys.setenv,setNames(list(old[[i]]),keys[[i]])),add=TRUE)
  Sys.setenv(LUSK_READING_HTTP_SCHEMA=schema,PYTHONPATH=normalizePath("..",winslash="/",mustWork=TRUE))
  test<-normalizePath("../api/tests/integration/test_reading_publisher_http.py",winslash="/",mustWork=TRUE)
  status<-system2(Sys.which("python"),c("-m","pytest","-q",shQuote(test,type="cmd"),"-k","demographic"),stdout="",stderr="")
  if(!identical(status,0L)) stop("Canonical demographic publisher-to-HTTP parity failed",call.=FALSE)
  cat("Canonical demographic typed readings: ",nrow(actual)," rows; canonical JSON → registered R publisher → guarded PostgreSQL → HTTP: PASS\n",sep="")
},finally={if(created) cleanup_serving_smoke_schema(con,schema,"reading");DBI::dbDisconnect(con)})
