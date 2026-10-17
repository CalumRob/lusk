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
canonical_source <- Sys.getenv("LUSK_TEST_CANONICAL_DATA_DIR",unset="")
stopifnot(dir.exists(canonical_source))
# Publisher materializers write generations and current pointers. Keep that
# mutable output away from the operator-owned canonical snapshot, copying only
# the producer inputs this retained proof consumes (no raw/download cache).
fixture_dir <- tempfile("habitat-reading-canonical-")
dir.create(fixture_dir)
canonical_inputs <- c("territoires.parquet","vintages.parquet","vintages.json",
  "indicateurs_demographie.json","indicateurs_economie.json",
  "indicateurs_habitat.json","indicateurs_mobilite.parquet",
  "histoires_habitat.json","theme_demographie.json","theme_economie.json",
  "theme_habitat.json","theme_milieux.json","theme_mobilite.json")
missing_inputs <- canonical_inputs[!file.exists(file.path(canonical_source,canonical_inputs))]
if(length(missing_inputs)) stop("Canonical Habitat proof inputs are missing: ",
  paste(missing_inputs,collapse=", "),call.=FALSE)
copied <- file.copy(file.path(canonical_source,canonical_inputs),fixture_dir,overwrite=TRUE)
stopifnot(all(copied))
canonical_dir <- normalizePath(fixture_dir,winslash="/",mustWork=TRUE)
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

  territories <- nanoparquet::read_parquet(file.path(canonical_dir,"territoires.parquet"))
  vintages <- nanoparquet::read_parquet(file.path(canonical_dir,"vintages.parquet"))
  for (owner in retained_scalar_artifact_owners()) {
    payload <- list(indicateurs=lire_indicateurs_commis(owner,canonical_dir),territoires=territories)
    owner_metadata <- jsonlite::fromJSON(file.path(canonical_dir,paste0("theme_",owner,".json")),
      simplifyVector=FALSE)
    materialize_theme_scalar_artifact(payload,owner_metadata,vintages,owner,canonical_dir)
  }
  reference <- publish_canonical_territory_reference(con,canonical_dir)$projection
  scalar <- project_retained_scalar_snapshot(canonical_dir,reference)
  scalar_publication <- publish_retained_scalar_snapshot(con,scalar,canonical_dir)$scalar

  read_canonical <- function(name) {
    # #757 : les parquets de faits par-thème des cinq thèmes non-mobilité ne
    # sont plus écrits. La projection JSON du run dir reste servie et devient
  # l'oracle (les fichiers partagés territoires/vintages et la Mobilité
  # gardent leur parquet). Le parquet est préféré quand il existe encore.
    parquet <- file.path(canonical_dir, paste0(name, ".parquet"))
    if (file.exists(parquet)) return(nanoparquet::read_parquet(parquet))
    jsonlite::fromJSON(file.path(canonical_dir, paste0(name, ".json")))
  }
  territories <- read_canonical("territoires"); vintages <- read_canonical("vintages")
  demography_metadata <- lire_theme_metadata("demographie")
  habitat_metadata <- lire_theme_metadata("habitat")
  mobility_metadata <- lire_theme_metadata("mobilite")
  demography <- list(indicateurs=read_canonical("indicateurs_demographie"),territoires=territories)
  habitat <- list(indicateurs=read_canonical("indicateurs_habitat"),territoires=territories,source_vintages=vintages)
  mobility <- list(indicateurs=read_canonical("indicateurs_mobilite"),territoires=territories,source_vintages=vintages)
  scalar_version <- DBI::dbGetQuery(con,"SELECT content_version FROM table_publication WHERE table_name='scalar_observation'")[["content_version"]][[1L]]
  stopifnot(identical(scalar_publication$content_version, scalar_version))
  # The declared-profile publisher consumes the run's owner-scoped serving
  # generations: the canonical payloads this script already reads are
  # materialized into the same run directory the pipeline writes them to, and
  # the DPE facet is bound to the scalar version recomputed from that
  # directory — the same value the shared scalar publication just committed.
  if (!profile_scalar_binding_inputs_available(canonical_dir))
    stop("The declared-profile publisher recomputes the DPE scalar binding from the run's canonical ",
      "scalar inputs; the canonical data directory is missing a canonical Parquet or ",
      "scalar-serving/<theme>/scalar-current.json", call.=FALSE)
  profile_binding <- profile_scalar_binding(canonical_dir)
  stopifnot(identical(profile_binding, scalar_version))
  materialize_theme_profile_artifacts(demography,demography_metadata,NULL,"demographie",canonical_dir)
  materialize_theme_profile_artifacts(habitat,habitat_metadata,NULL,"habitat",canonical_dir,profile_binding)
  materialize_theme_profile_artifacts(mobility,mobility_metadata,vintages,"mobilite",canonical_dir)
  owners <- unique(c(profile_serving_owners(demography_metadata),
    profile_serving_owners(habitat_metadata),profile_serving_owners(mobility_metadata)))
  profile <- publier_declared_profiles_postgres(canonical_dir,owners,con=con)
  stopifnot(profile$changed,
    DBI::dbGetQuery(con,"SELECT count(*) FROM profile_observation_source WHERE indicator_id='distribution_dpe'")[[1L]][[1L]]>0L)

  # La projection JSON du thème (#757 : plus de parquet par-thème) reste
  # l'oracle indépendant des lignes stockées.
  histories <- read_canonical("histoires_habitat")
  dpe_source <- vintages[vintages[["id"]]==habitat_metadata$sources$part_passoires,,drop=FALSE]
  stopifnot(nrow(histories)>0L,nrow(dpe_source)==1L)
  # Exercise the production registered artifact projector against the copied
  # producer records, then publish that artifact through the registered DB
  # publisher. The canonical snapshot remains an independent HTTP oracle.
  materialize_theme_typed_reading_artifacts(
    list(histoires=histories,territoires=territories,
      indicateurs=read_canonical("indicateurs_habitat"),source_vintages=vintages),
    habitat_metadata,vintages,"habitat",canonical_dir)
  publication <- read_typed_reading_publication_from(canonical_dir,"habitat")
  canonical <- list(reading=publication$reading,content_version=publication$content_version)
  registry <- register_typed_reading_artifact_publisher(list(),"habitat",publish_habitat_reading)
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
  # Inject an out-of-range share into one measured row: the publisher must fail
  # against the registered DPE scalar and roll back rather than store it.
  measured_index <- which(failed_input$reading$status=="measured")[[1L]]
  failed_input$reading$part_passoires[[measured_index]] <- 2
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
  expect_unavailable("selected_reading","UPDATE table_publication SET content_version='deliberately-stale' WHERE table_name='selected_reading'")
  count_marker <- DBI::dbGetQuery(con,"SELECT row_count FROM table_publication WHERE table_name='selected_reading'")$row_count[[1L]]
  DBI::dbExecute(con,"UPDATE table_publication SET row_count=row_count+1 WHERE table_name='selected_reading'")
  Sys.setenv(LUSK_HABITAT_EXPECT_UNAVAILABLE="1")
  count_status <- tryCatch(system2(Sys.which("python"),c("-m","pytest","-q",shQuote(test,type="cmd"),"-k","habitat"),stdout="",stderr=""),finally={
    DBI::dbExecute(con,"UPDATE table_publication SET row_count=$1 WHERE table_name='selected_reading'",params=list(count_marker))
    Sys.unsetenv("LUSK_HABITAT_EXPECT_UNAVAILABLE")
  })
  if(!identical(count_status,0L)) stop("Incorrect selected-reading marker count did not fail closed",call.=FALSE)
  cat("Canonical Habitat typed readings:",nrow(actual)," rows; registered R artifact/publisher, producer-record semantic HTTP parity, stale publication/count fail-closed: PASS\n")
},finally={if(created) cleanup_serving_smoke_schema(con,schema,"reading");DBI::dbDisconnect(con);unlink(fixture_dir,recursive=TRUE)})
