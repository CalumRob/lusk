#!/usr/bin/env Rscript
# Guarded canonical Milieux owned-series + selected-reading publisher -> semantic HTTP.
pkgload::load_all(".",quiet=TRUE)
required <- c("HOST","PORT","DATABASE","USER")
config <- setNames(lapply(required,function(k) Sys.getenv(paste0("LUSK_PROFILE_TEST_",k),unset="")),required)
stopifnot(all(vapply(config,nzchar,logical(1))),grepl("^lusk_it_[A-Za-z0-9_]+$",config$DATABASE),
  identical(Sys.getenv("LUSK_TEST_DATABASE_NAME"),config$DATABASE),
  identical(Sys.getenv("LUSK_TEST_DATABASE_PREFIX"),"lusk_it_"))
read_user <- Sys.getenv("LUSK_TEST_READ_USER",unset="")
source_path <- Sys.getenv("LUSK_MILIEUX_CONSO_SOURCE",file.path("data","raw","conso-com.csv"))
window_path <- Sys.getenv("LUSK_MILIEUX_PROCESSED_WINDOW",unset="")
canonical_source <- Sys.getenv("LUSK_TEST_CANONICAL_DATA_DIR",unset="")
stopifnot(nzchar(read_user),read_user!=config$USER,dir.exists(canonical_source),
  file.exists(source_path),file.exists(window_path))

# Copy only the canonical producer inputs needed to regenerate the artifact
# directory. The CONSOENAF source file remains a read-only input at source_path.
fixture_dir <- tempfile("milieux-reading-canonical-")
dir.create(fixture_dir)
canonical_inputs <- c("territoires.parquet","vintages.parquet","vintages.json",
  "indicateurs_milieux.json","histoires_milieux.json","theme_milieux.json")
missing_inputs <- canonical_inputs[!file.exists(file.path(canonical_source,canonical_inputs))]
if(length(missing_inputs)) stop("Canonical Milieux proof inputs are missing: ",
  paste(missing_inputs,collapse=", "),call.=FALSE)
stopifnot(all(file.copy(file.path(canonical_source,canonical_inputs),fixture_dir,overwrite=TRUE)))
canonical_dir <- normalizePath(fixture_dir,winslash="/",mustWork=TRUE)

con <- DBI::dbConnect(RPostgres::Postgres(),host=config$HOST,port=as.integer(config$PORT),
  dbname=config$DATABASE,user=config$USER)
schema <- paste0("reading_it_",Sys.getpid(),"_milieux"); created <- FALSE
tryCatch({
  identity <- DBI::dbGetQuery(con,"SELECT current_database(),current_user")
  stopifnot(identity[[1L]][[1L]]==config$DATABASE,identity[[2L]][[1L]]==config$USER)
  DBI::dbExecute(con,paste0("CREATE SCHEMA ",DBI::dbQuoteIdentifier(con,schema))); created <- TRUE
  DBI::dbExecute(con,paste0("SET search_path TO ",DBI::dbQuoteIdentifier(con,schema)))
  ddl <- paste(readLines("../api/schema.sql",warn=FALSE),collapse="\n")
  for(statement in split_postgres_sql(ddl)) DBI::dbExecute(con,statement)

  territories <- nanoparquet::read_parquet(file.path(canonical_dir,"territoires.parquet"))
  vintages <- nanoparquet::read_parquet(file.path(canonical_dir,"vintages.parquet"))
  histories_all <- jsonlite::fromJSON(file.path(canonical_dir,"histoires_milieux.json"))
  indicators_all <- jsonlite::fromJSON(file.path(canonical_dir,"indicateurs_milieux.json"))
  # Public JSON is a presentation projection and intentionally omits typed OCS
  # role/component links. Reconstruct one producer-shaped commune from the
  # retained canonical values, its explicit source vintages, and the existing
  # processed OCS window record; no serving-table facts are inserted here.
  focal_id <- "22001"
  histories <- histories_all[histories_all$type=="commune" & histories_all$territoire==focal_id,,drop=FALSE]
  indicators <- indicators_all[indicators_all$type=="commune" & indicators_all$territoire==focal_id &
    indicators_all$key=="artif_par_habitant",,drop=FALSE]
  state_window <- readRDS(window_path)
  state_window <- state_window[state_window$code==focal_id,,drop=FALSE]
  if(nrow(histories)!=1L || nrow(state_window)!=1L || nrow(indicators)!=2L)
    stop("Canonical OCS fixture requires one actual reading/window and its two producer state records",call.=FALSE)
  roles <- ifelse(indicators$vintage_version==state_window$millesime_ocsge_debut[[1L]],"M2",
    ifelse(indicators$vintage_version==state_window$millesime_ocsge_fin[[1L]],"M3",NA_character_))
  if(anyNA(roles) || anyDuplicated(roles) || !setequal(roles,c("M2","M3")))
    stop("Canonical OCS source vintages do not match the processed producer window",call.=FALSE)
  indicators$state_role <- roles
  indicators$source_components <- vapply(seq_len(nrow(indicators)),function(i) {
    components <- list(M2=character(),M3=character())
    components[[roles[[i]]]] <- as.character(indicators$source_reference[[i]])
    as.character(jsonlite::toJSON(components,auto_unbox=FALSE))
  },character(1))
  jsonlite::write_json(indicators,file.path(canonical_dir,"indicateurs_milieux.json"),
    dataframe="rows",auto_unbox=TRUE,null="null",digits=NA)
  metadata <- lire_theme_metadata("milieux")
  publish_canonical_territory_reference(con,canonical_dir)
  # Keep the declared CONSOENAF source vintage in the database through its own
  # registered owned-series publisher; the reading absence publisher's FK is
  # bound to that exact producer source/version.
  series_canonical <- list(indicateurs=indicators_all,histoires=histories_all,vintages=vintages)
  write_owned_series_artifact(owned_conso_enaf_projection(series_canonical,metadata),
    file.path(canonical_dir,"series-serving","conso_enaf_annuel"),"conso_enaf_annuel")
  conso_registry <- register_conso_enaf_owned_publisher(list(),metadata)
  publish_registered_series(conso_registry,"conso_enaf_annuel_owned",series_canonical,
    owned_series_postgres_adapter(con))
  write_owned_series_artifact(project_artif_m2m3_projection(indicators,histories,vintages,metadata),
    file.path(canonical_dir,"series-serving","artif_par_habitant"),"artif_par_habitant")
  materialize_theme_typed_reading_artifacts(list(histoires=histories,territoires=territories,
    indicateurs=indicators,source_vintages=vintages),metadata,vintages,"milieux",canonical_dir)

  source_absences <- milieux_source_absence_declarations(source_path,territories,vintages,metadata)
  expected <- project_milieux_reading(histories,vintages,metadata,
    canonical=list(indicateurs=indicators,histoires=histories,territoires=territories))
  fact_row <- which(expected$territory_type=="commune")[[1L]]
  absence_row <- 1L
  bindings <- attr(expected,"source_bindings")
  expected_bindings <- bindings[bindings$territory_id==expected$territory_id[[fact_row]] &
    bindings$territory_type==expected$territory_type[[fact_row]] & bindings$groupe==expected$groupe[[fact_row]],,drop=FALSE]
  absences <- source_absences
  manifest <- list(reading=as.list(expected[fact_row,,drop=FALSE]),
    bindings=lapply(seq_len(nrow(expected_bindings)),function(i)
      lapply(expected_bindings[i,,drop=FALSE],function(value) if(is.na(value[[1L]])) NULL else as.character(value[[1L]]))),
    absence=as.list(absences[absence_row,,drop=FALSE]))
  jsonlite::write_json(manifest,file.path(canonical_dir,"milieux_http_expected.json"),
    auto_unbox=TRUE,null="null",digits=NA)

  published <- publish_canonical_milieux_reading(con,canonical_dir,source_path)
  stopifnot(published$reading$row_count==nrow(expected),
    published$reading$changed,
    DBI::dbGetQuery(con,"SELECT count(*) FROM milieux_reading_absence")[[1L]][[1L]]==nrow(absences))
  DBI::dbExecute(con,paste0("GRANT USAGE ON SCHEMA ",DBI::dbQuoteIdentifier(con,schema),
    " TO ",DBI::dbQuoteIdentifier(con,read_user)))
  DBI::dbExecute(con,paste0("GRANT SELECT ON ALL TABLES IN SCHEMA ",DBI::dbQuoteIdentifier(con,schema),
    " TO ",DBI::dbQuoteIdentifier(con,read_user)))
  keys <- c("LUSK_MILIEUX_HTTP_SCHEMA","LUSK_TEST_CANONICAL_DATA_DIR","PYTHONPATH")
  old <- Sys.getenv(keys,unset=NA_character_)
  on.exit(for(i in seq_along(keys)) if(is.na(old[[i]])) Sys.unsetenv(keys[[i]]) else
    do.call(Sys.setenv,setNames(list(old[[i]]),keys[[i]])),add=TRUE)
  Sys.setenv(LUSK_MILIEUX_HTTP_SCHEMA=schema,LUSK_TEST_CANONICAL_DATA_DIR=canonical_dir,
    PYTHONPATH=normalizePath("..",winslash="/",mustWork=TRUE))
  test <- normalizePath("../api/tests/integration/test_milieux_cloud_http.py",winslash="/",mustWork=TRUE)
  status <- system2(Sys.which("python"),c("-m","pytest","-q",shQuote(test,type="cmd")),stdout="",stderr="")
  if(!identical(status,0L)) stop("Registered Milieux publisher-to-semantic-HTTP proof failed",call.=FALSE)
  cat("Canonical Milieux reading:",nrow(expected)," facts; owned-series/R reading publishers, canonical CONSOENAF absences, source-binding and fail-closed semantic HTTP: PASS\n")
},finally={
  if(created && identical(Sys.getenv("LUSK_TEST_ALLOW_SCHEMA_CLEANUP"),"1"))
    cleanup_serving_smoke_schema(con,schema,"reading")
  DBI::dbDisconnect(con)
  unlink(fixture_dir,recursive=TRUE)
})
