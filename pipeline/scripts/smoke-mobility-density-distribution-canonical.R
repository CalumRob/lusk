#!/usr/bin/env Rscript
# Guarded canonical-only distribution publication and all-row parity tracer.
pkgload::load_all(".",quiet=TRUE)
required <- c("HOST","PORT","DATABASE","USER")
config <- setNames(lapply(required,function(k) Sys.getenv(paste0("LUSK_PROFILE_TEST_",k),unset="")),required)
read_user <- Sys.getenv("LUSK_TEST_READ_USER",unset=""); read_dsn <- Sys.getenv("LUSK_TEST_READ_DSN",unset="")
canonical_dir <- normalizePath("E:/Lusk/public/data",winslash="/",mustWork=TRUE)
stopifnot(all(vapply(config,nzchar,logical(1))),identical(config$DATABASE,Sys.getenv("LUSK_TEST_DATABASE_NAME")),
  grepl("^lusk_it_[A-Za-z0-9_]+$",config$DATABASE),!tolower(config$DATABASE)%in%c("lusk","postgres","template0","template1"),
  identical(config$HOST,"192.168.1.120"),as.integer(config$PORT)==5432L,nzchar(read_user),nzchar(read_dsn),
  read_user!=config$USER,identical(Sys.getenv("LUSK_TEST_DATABASE_PREFIX"),"lusk_it_"))
paths <- file.path(canonical_dir,c("territoires.parquet","histoires_mobilite.parquet","histoires_mobilite.json","vintages.parquet"))
stopifnot(all(file.exists(paths)))
territories <- nanoparquet::read_parquet(paths[[1L]])
histories <- nanoparquet::read_parquet(paths[[2L]])
legacy <- jsonlite::fromJSON(paths[[3L]],simplifyDataFrame=TRUE)
vintages <- nanoparquet::read_parquet(paths[[4L]])
metadata <- lire_theme_metadata("mobilite")
source_vintage <- vintages[vintages$id=="mobilite_snapshot",,drop=FALSE]
stopifnot(nrow(territories)==1268L,nrow(histories)==1266L,nrow(legacy)==1266L,nrow(source_vintage)==1L)

source_key <- function(x) paste(x$type,x$territoire,x$groupe,x$story_key,sep="\r")
fields <- c("territoire","type","theme","groupe","story_key","salience_reason","dens_min","dens_max",
  paste0("dens_",1:10),paste0("dec_",1:10),"vintage_source","vintage_version",
  "vintage_date_reference","vintage_date_publication")
stopifnot(all(fields%in%names(histories)),all(fields%in%names(legacy)),
  !anyDuplicated(source_key(histories)),!anyDuplicated(source_key(legacy)),setequal(source_key(histories),source_key(legacy)))
legacy <- legacy[match(source_key(histories),source_key(legacy)),,drop=FALSE]
for(field in fields) stopifnot(isTRUE(all.equal(histories[[field]],legacy[[field]],check.attributes=FALSE)))
for(field in c("dens_min","dens_max",paste0("dens_",1:10))) stopifnot(!anyNA(histories[[field]]))
projection <- project_mobility_density_distribution(histories,vintages,metadata)
stopifnot(nrow(projection$ranges)==1266L,nrow(projection$points)==12660L,
  length(unique(paste(projection$ranges$territory_type,projection$ranges$territory_id)))==1266L,
  identical(projection$allowed_levels,c("commune","epci","departement","region")))
expected_range_status <- ifelse(is.na(histories$dens_min)|is.na(histories$dens_max),"not_available","measured")
range_idx <- match(paste(projection$ranges$territory_type,projection$ranges$territory_id),
  paste(histories$type,histories$territoire))
stopifnot(!anyNA(range_idx),isTRUE(all.equal(projection$ranges$range_min,as.numeric(histories$dens_min[range_idx]),check.attributes=FALSE)),
  isTRUE(all.equal(projection$ranges$range_max,as.numeric(histories$dens_max[range_idx]),check.attributes=FALSE)),
  identical(projection$ranges$status,expected_range_status[range_idx]))
for(i in 1:10) {
  rows <- projection$points[projection$points$ordinal==i-1L,,drop=FALSE]
  idx <- match(paste(rows$territory_type,rows$territory_id),paste(histories$type,histories$territoire))
  stopifnot(!anyNA(idx),isTRUE(all.equal(rows$density,as.numeric(histories[[paste0("dens_",i)]][idx]),check.attributes=FALSE)),
    isTRUE(all.equal(rows$decile,as.numeric(histories[[paste0("dec_",i)]][idx]),check.attributes=FALSE)),
    identical(rows$density_status,ifelse(is.na(histories[[paste0("dens_",i)]][idx]),"not_available","measured")),
    identical(rows$decile_status,ifelse(is.na(histories[[paste0("dec_",i)]][idx]),"not_available","measured")))
}
cat("Canonical read-only preflight: JSON/Parquet exact; 1266 histories; 1268 reference territories; producer projection matches all source coordinates.\n")

con <- DBI::dbConnect(RPostgres::Postgres(),host=config$HOST,port=as.integer(config$PORT),dbname=config$DATABASE,user=config$USER)
schema <- paste0("distribution_canonical_",paste(sprintf("%02x",as.integer(openssl::rand_bytes(12))),collapse="")); created <- FALSE
tryCatch({
  identity <- DBI::dbGetQuery(con,"SELECT current_database() database,current_user username")
  stopifnot(identity$database[[1L]]==config$DATABASE,identity$username[[1L]]==config$USER)
  DBI::dbExecute(con,paste0("CREATE SCHEMA ",DBI::dbQuoteIdentifier(con,schema))); created <- TRUE
  DBI::dbExecute(con,paste0("SET search_path TO ",DBI::dbQuoteIdentifier(con,schema)))
  ddl <- paste(readLines("../api/schema.sql",warn=FALSE),collapse="\n")
  for(statement in split_postgres_sql(ddl)) DBI::dbExecute(con,statement)
  cat("Canonical test schema: fresh serving DDL PASS.\n"); flush.console()

  reference <- data.frame(territory_id=as.character(territories$territoire),territory_type=as.character(territories$type),
    name=as.character(territories$nom),department_id=as.character(territories$departement),
    epci_id=as.character(territories$epci),density_class_code=as.character(territories$classe_densite_code),
    density_class_label=as.character(territories$classe_densite_libelle_public),stringsAsFactors=FALSE)
  reference[is.na(reference)] <- NA_character_
  stopifnot(!anyDuplicated(reference$territory_id),nrow(reference)==1268L)
  DBI::dbWriteTable(con,"territory_reference",reference,append=TRUE,row.names=FALSE)
  reference_version <- unname(tools::md5sum(paths[[1L]]))
  DBI::dbExecute(con,"INSERT INTO table_publication(table_name,content_version,row_count) VALUES('territory_reference',$1,$2)",
    params=list(reference_version,nrow(reference)))
  cat("Canonical reference fixture: 1268 rows PASS.\n"); flush.console()

  vintage <- source_vintage[1L,,drop=FALSE]
  stopifnot(vintage$id[[1L]]=="mobilite_snapshot",vintage$source[[1L]]==MOBILITE_SNAPSHOT_SOURCE)
  DBI::dbExecute(con,"INSERT INTO source_dataset(source_id,name) VALUES($1,$2)",params=list(vintage$id[[1L]],vintage$source[[1L]]))
  source_vintage_id <- paste(vintage$version[[1L]],vintage$date_reference[[1L]],sep="/")
  DBI::dbExecute(con,"INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date)
    VALUES($1,$2,$3,$4,$5)",params=list(vintage$id[[1L]],source_vintage_id,vintage$version[[1L]],
      vintage$date_reference[[1L]],vintage$date_publication[[1L]]))

  # The focal HTTP route is coupled to the already registered #673 snapshot
  # binding; publish only that required selected-reading family, not other facts.
  reading_result <- publish_canonical_mobility_reading(con,canonical_dir)
  stopifnot(reading_result$row_count==1266L)
  cat("Required #673 Mobility snapshot binding: selected reading 1266 rows PASS.\n"); flush.console()
  registry <- register_mobility_density_distribution_publisher(list())
  input <- list(histories=histories,vintages=vintages,metadata=metadata)
  result <- publish_registered_mobility_density_distribution(registry,"mobility_density_distribution",input,con)
  stopifnot(isTRUE(result$changed),result$row_count==1266L)
  cat("Registered density publisher completed canonical batch.\n"); flush.console()

  db_ranges <- DBI::dbGetQuery(con,"SELECT territory_id,territory_type,minimum,maximum,status,source_id,vintage_id
    FROM mobility_density_distribution_range ORDER BY territory_type,territory_id")
  exp_ranges <- projection$ranges
  ri <- match(paste(db_ranges$territory_type,db_ranges$territory_id),paste(exp_ranges$territory_type,exp_ranges$territory_id))
  stopifnot(nrow(db_ranges)==1266L,!anyNA(ri),identical(db_ranges$source_id,rep("mobilite_snapshot",1266L)),
    identical(db_ranges$vintage_id,rep(projection$vintage_id,1266L)),
    isTRUE(all.equal(db_ranges$minimum,exp_ranges$range_min[ri],check.attributes=FALSE)),
    isTRUE(all.equal(db_ranges$maximum,exp_ranges$range_max[ri],check.attributes=FALSE)),
    identical(db_ranges$status,exp_ranges$status[ri]))
  db_points <- DBI::dbGetQuery(con,"SELECT territory_id,territory_type,ordinal,density,density_status,decile,decile_status,source_id,vintage_id
    FROM mobility_density_distribution_point ORDER BY territory_type,territory_id,ordinal")
  exp_points <- projection$points
  pi <- match(paste(db_points$territory_type,db_points$territory_id,db_points$ordinal,sep="\r"),
    paste(exp_points$territory_type,exp_points$territory_id,exp_points$ordinal,sep="\r"))
  stopifnot(nrow(db_points)==12660L,!anyNA(pi),identical(db_points$source_id,rep("mobilite_snapshot",12660L)),
    identical(db_points$vintage_id,rep(projection$vintage_id,12660L)),
    isTRUE(all.equal(db_points$density,exp_points$density[pi],check.attributes=FALSE)),
    identical(db_points$density_status,exp_points$density_status[pi]),
    isTRUE(all.equal(db_points$decile,exp_points$decile[pi],check.attributes=FALSE)),
    identical(db_points$decile_status,exp_points$decile_status[pi]))
  missing_decile <- histories[!complete.cases(histories[paste0("dec_",1:10)]),c("territoire","type"),drop=FALSE]
  stopifnot(nrow(missing_decile)==1L,sum(is.na(db_points$decile))==10L)
  descriptor <- DBI::dbGetQuery(con,"SELECT descriptor_version,source_id,vintage_id,axis_count,array_to_json(allowed_levels)::text levels,
    density_unit,decile_unit FROM mobility_density_distribution_descriptor WHERE singleton")
  stopifnot(nrow(descriptor)==1L,descriptor$descriptor_version[[1L]]==projection$version,
    descriptor$source_id[[1L]]==projection$source_id,descriptor$vintage_id[[1L]]==projection$vintage_id,
    descriptor$axis_count[[1L]]==10L,identical(as.character(jsonlite::fromJSON(descriptor$levels[[1L]])),projection$allowed_levels),
    descriptor$density_unit[[1L]]==projection$density_unit,descriptor$decile_unit[[1L]]==projection$decile_unit)
  marker <- DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version FROM table_publication WHERE table_name='mobility_density_distribution'")
  stopifnot(nrow(marker)==1L,marker$row_count[[1L]]==1266L,marker$reference_content_version[[1L]]==reference_version,
    marker$content_version[[1L]]==projection$version)
  retry <- publish_registered_mobility_density_distribution(registry,"mobility_density_distribution",input,con)
  stopifnot(!isTRUE(retry$changed),identical(marker,DBI::dbGetQuery(con,
    "SELECT content_version,row_count,reference_content_version FROM table_publication WHERE table_name='mobility_density_distribution'")))
  cat("Canonical PostgreSQL parity: 1268 reference rows; 1266 ranges; 12660 paired points; 10 raw missing deciles preserved; snapshot lineage and no-op retry PASS.\n")

  focus_ids <- c("commune:35238","epci:243500139","departement:35","region:53","epci:242900314")
  focus <- legacy[match(focus_ids,paste(legacy$type,legacy$territoire,sep=":")),,drop=FALSE]
  stopifnot(nrow(focus)==length(focus_ids),!anyNA(focus$territoire))
  expected <- setNames(lapply(seq_len(nrow(focus)),function(i) {
    density <- as.list(as.numeric(focus[i,paste0("dens_",1:10),drop=TRUE]))
    decile <- as.list(as.numeric(focus[i,paste0("dec_",1:10),drop=TRUE]))
    list(range=list(minimum=as.numeric(focus$dens_min[[i]]),maximum=as.numeric(focus$dens_max[[i]]),status="measured"),
      density=density,decile=decile,
      density_status=rep(list("measured"),10L),decile_status=as.list(ifelse(is.na(unlist(decile)),"not_available","measured")),
      units=list(density=projection$density_unit,decile=projection$decile_unit),
      provenance=list(source_id=projection$source_id,source_name=projection$source_name,vintage_id=projection$vintage_id,
        source_version=projection$source_version,source_reference_date=as.character(projection$reference_date),
        source_publication_date=as.character(projection$publication_date)))
  }),focus_ids)
  expected_path <- file.path(tempdir(),paste0(schema,"-http-expected.json"))
  jsonlite::write_json(expected,expected_path,auto_unbox=TRUE,null="null",na="null",digits=NA)
  DBI::dbExecute(con,paste0("GRANT USAGE ON SCHEMA ",DBI::dbQuoteIdentifier(con,schema)," TO ",DBI::dbQuoteIdentifier(con,read_user)))
  DBI::dbExecute(con,paste0("GRANT SELECT ON ALL TABLES IN SCHEMA ",DBI::dbQuoteIdentifier(con,schema)," TO ",DBI::dbQuoteIdentifier(con,read_user)))
  prior_env <- Sys.getenv(c("LUSK_DENSITY_CANONICAL_SCHEMA","LUSK_DENSITY_CANONICAL_EXPECTED","PYTHONPATH"),unset=NA_character_)
  on.exit(for(i in seq_along(prior_env)) if(is.na(prior_env[[i]])) Sys.unsetenv(names(prior_env)[[i]]) else
    do.call(Sys.setenv,setNames(list(prior_env[[i]]),names(prior_env)[[i]])),add=TRUE)
  Sys.setenv(LUSK_DENSITY_CANONICAL_SCHEMA=schema,LUSK_DENSITY_CANONICAL_EXPECTED=expected_path,
    PYTHONPATH=normalizePath("..",winslash="/",mustWork=TRUE))
  test <- normalizePath("../api/tests/integration/test_mobility_density_distribution_canonical_http.py",winslash="/",mustWork=TRUE)
  status <- system2(Sys.which("python"),c("-m","pytest","-q",shQuote(test,type="cmd")),stdout="",stderr="")
  if(!identical(status,0L)) stop("Canonical Mobility density focal HTTP parity failed",call.=FALSE)
  cat("Canonical HTTP parity: commune 35238, EPCI 243500139, department 35, region 53 and raw missing-decile EPCI 242900314 PASS.\n")
},finally={if(created) cleanup_serving_smoke_schema(con,schema,"distribution_canonical");DBI::dbDisconnect(con)})
