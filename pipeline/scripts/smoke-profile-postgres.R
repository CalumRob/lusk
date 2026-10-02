#!/usr/bin/env Rscript
# Explicitly disposable PostgreSQL integration check for the profile publisher.
pkgload::load_all(".", quiet=TRUE)
required <- c("HOST", "PORT", "DATABASE", "USER")
config <- setNames(lapply(required, function(key) Sys.getenv(paste0("LUSK_PROFILE_TEST_", key), unset="")), required)
stopifnot(all(vapply(config, nzchar, logical(1))), grepl("^lusk_it_[A-Za-z0-9_]+$", config$DATABASE),
  grepl("^[A-Za-z0-9_.:-]+$", config$HOST), grepl("^[0-9]+$", config$PORT))
if (!requireNamespace("DBI", quietly=TRUE) || !requireNamespace("RPostgres", quietly=TRUE))
  stop("DBI and RPostgres are required")
con <- DBI::dbConnect(RPostgres::Postgres(), host=config$HOST, port=as.integer(config$PORT),
  dbname=config$DATABASE, user=config$USER)
schema <- paste0("profile_it_", Sys.getpid())
created <- FALSE
tryCatch({
  DBI::dbExecute(con,paste0("CREATE SCHEMA ",DBI::dbQuoteIdentifier(con,schema)))
  created <- TRUE
  cat("Profile smoke schema created:", schema, "\n")
  DBI::dbExecute(con,paste0("SET search_path TO ",DBI::dbQuoteIdentifier(con,schema)))
  ddl <- paste(readLines("../api/schema.sql",warn=FALSE),collapse="\n")
  for (statement in split_postgres_sql(ddl)) DBI::dbExecute(con,statement)
  payload <- compute_payload(load_fixture())
  metadata <- jsonlite::fromJSON("inst/extdata/theme-metadata/theme_demographie.json",simplifyVector=FALSE)
  projection <- project_structure_age_profile(payload,metadata)
  territories <- projection$eligible_territories
  is_commune <- territories$territory_type == "commune"
  reference <- data.frame(territory_id=territories$territory_id,territory_type=territories$territory_type,
    name=territories$territory_id,department_id=NA_character_,
    epci_id=ifelse(is_commune,"E_TEST",NA_character_),
    density_class_code=ifelse(is_commune,"D_TEST",NA_character_),
    density_class_label=ifelse(is_commune,"Test density class",NA_character_))
  # Give all fixture communes a real, published default cohort and whole-EPCI
  # membership so the serving API exercises its ordinary scope contracts.
  DBI::dbWriteTable(con,"territory_reference",reference,append=TRUE,row.names=FALSE)
  reference_version <- "profile-reference-fixture-v1"
  DBI::dbExecute(con,"INSERT INTO table_publication(table_name,content_version,row_count) VALUES('territory_reference',$1,$2)",
    params=list(reference_version,nrow(reference)))
  registry <- register_structure_age_profile_publisher(list(),metadata)
  adapter <- profile_postgres_adapter(con)
  first <- publish_registered_profile(registry,"structure_age",payload,adapter)
  facts_before <- DBI::dbGetQuery(con,"SELECT territory_id,territory_type,detail_key,sex_key,value,status FROM profile_observation ORDER BY territory_type,territory_id,detail_key,sex_key")
  marker_before <- DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version FROM table_publication WHERE table_name='declared_profile'")
  stopifnot(first$changed, marker_before$row_count[[1L]]==nrow(projection$facts),
    marker_before$reference_content_version[[1L]]==reference_version,
    DBI::dbGetQuery(con,"SELECT count(*) AS n FROM profile_observation_source")$n[[1L]]==nrow(projection$facts))
  DBI::dbExecute(con,"CREATE FUNCTION reject_profile_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'profile fixture failure'; END $$")
  DBI::dbExecute(con,"CREATE TRIGGER reject_profile BEFORE INSERT ON profile_observation FOR EACH ROW EXECUTE FUNCTION reject_profile_insert()")
  changed <- payload
  changed$indicateurs$value[which(changed$indicateurs$key=="structure_age")[[1L]]] <-
    changed$indicateurs$value[which(changed$indicateurs$key=="structure_age")[[1L]]] + 0.001
  failed <- try(publish_registered_profile(registry,"structure_age",changed,adapter),silent=TRUE)
  stopifnot(inherits(failed,"try-error"),
    identical(marker_before,DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version FROM table_publication WHERE table_name='declared_profile'")),
    identical(facts_before,DBI::dbGetQuery(con,"SELECT territory_id,territory_type,detail_key,sex_key,value,status FROM profile_observation ORDER BY territory_type,territory_id,detail_key,sex_key")))
  cat("Profile PostgreSQL publication, lineage, independent marker, and rollback: PASS\n")
  DBI::dbExecute(con, "DROP TRIGGER reject_profile ON profile_observation")
  habitat_metadata <- lire_theme_metadata("habitat")
  input <- data.frame(code=territories$territory_id, dpe_n=100,
    dpe_share_A=.1, dpe_share_B=.1, dpe_share_C=.1, dpe_share_D=.1,
    dpe_share_E=.1, dpe_share_F=.1, dpe_share_G=.4)
  dpe_rows <- as.data.frame(indicator_distribution_dpe(input))
  names(dpe_rows)[names(dpe_rows)=="code"] <- "territoire"
  dpe_rows$type <- territories$territory_type[match(dpe_rows$territoire, territories$territory_id)]
  dpe_rows$sex <- NA_character_
  dpe_rows$vintage_source <- "DPE fixture"
  dpe_rows$vintage_version <- "2024"
  dpe_rows$vintage_date_reference <- "2024-01-01"
  dpe_rows$vintage_date_publication <- "2026-08-06"
  habitat <- list(indicateurs=dpe_rows, territoires=payload$territoires)
  scalar_version <- "dpe-scalar-fixture-v1"
  DBI::dbWithTransaction(con, {
    DBI::dbExecute(con, "INSERT INTO source_dataset VALUES ('dpe_22','DPE fixture')")
    DBI::dbExecute(con, "INSERT INTO source_vintage VALUES ('dpe_22','2024/2024-01-01','2024','2024-01-01','2026-08-06')")
    DBI::dbExecute(con, "INSERT INTO scalar_descriptor(indicator_id,theme_id,label,unit,direction,comparison_facet,allowed_levels,denominator_semantics,completeness,descriptor_version) VALUES ('part_passoires','habitat','Passoires','%','low','part_passoires',ARRAY['commune','epci','departement'],'diagnostics','sparse','dpe-scalar-d1')")
    DBI::dbExecute(con, "INSERT INTO scalar_descriptor_source VALUES ('part_passoires','dpe_22')")
    for (i in seq_len(nrow(territories))) {
      DBI::dbExecute(con, "INSERT INTO scalar_observation(indicator_id,territory_id,territory_type,value,status) VALUES ('part_passoires',$1,$2,.5,'measured')", params=unname(as.list(territories[i,])))
      DBI::dbExecute(con, "INSERT INTO scalar_observation_source VALUES ('part_passoires',$1,'dpe_22','2024/2024-01-01')", params=list(territories$territory_id[[i]]))
    }
    DBI::dbExecute(con, "INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version) VALUES ('scalar_observation',$1,$2,$3)", params=list(scalar_version,nrow(territories),reference_version))
  })
  mobility_metadata <- lire_theme_metadata("mobilite")
  mobility_territories <- data.frame(territoire=territories$territory_id, type=territories$territory_type)
  mobility_rows <- do.call(rbind, lapply(c("voitures_menage","reseaux","reseaux_par_habitant","offre_cyclable"), function(id) {
    page <- mobility_metadata$indicator_pages[[id]]
    details <- unlist(page$comparison$details, use.names=FALSE)
    units <- unlist(mobility_metadata$profile_contracts[[id]]$detail_units, use.names=TRUE)
    do.call(rbind, lapply(seq_len(nrow(mobility_territories)), function(i) data.frame(
      territoire=mobility_territories$territoire[[i]], type=mobility_territories$type[[i]], key=id,
      detail=details, sex=NA_character_, value=seq_along(details)/10,
      unit=unname(units[details]), vintage_source=mobility_metadata$source_records[[page$sources[[1L]]]]$dataset,
      vintage_version=mobility_metadata$source_records[[page$sources[[1L]]]]$vintages[[1L]]$version,
      vintage_date_reference=mobility_metadata$source_records[[page$sources[[1L]]]]$vintages[[1L]]$dateReference,
      vintage_date_publication=mobility_metadata$source_records[[page$sources[[1L]]]]$vintages[[1L]]$datePublication,
      stringsAsFactors=FALSE)))
  }))
  mobility_payload <- list(indicateurs=mobility_rows, territoires=mobility_territories)
  mobility_vintages <- do.call(rbind, lapply(unique(unlist(lapply(c("voitures_menage","reseaux","reseaux_par_habitant","offre_cyclable"), function(id)
    unlist(mobility_metadata$indicator_pages[[id]]$sources, use.names=FALSE)))), function(source) {
      v <- mobility_metadata$source_records[[source]]$vintages[[1L]]
      data.frame(id=source, source=mobility_metadata$source_records[[source]]$dataset, version=v$version,
        date_reference=v$dateReference, date_publication=v$datePublication, stringsAsFactors=FALSE)
    }))
  combined <- publier_declared_profiles_postgres(payload, metadata, habitat, habitat_metadata, scalar_version,
    con=con, mobilite=mobility_payload, mobilite_metadata=mobility_metadata, mobilite_vintages=mobility_vintages)
  read_user <- Sys.getenv("LUSK_TEST_READ_USER", unset="")
  read_dsn <- Sys.getenv("LUSK_TEST_READ_DSN", unset="")
  if (nzchar(read_user) || nzchar(read_dsn)) {
    stopifnot(nzchar(read_user), nzchar(read_dsn), identical(Sys.getenv("LUSK_TEST_DATABASE_PREFIX"), "lusk_it_"),
      identical(Sys.getenv("LUSK_TEST_DATABASE_NAME"), config$DATABASE), read_user != config$USER)
    DBI::dbExecute(con, paste0("GRANT USAGE ON SCHEMA ", DBI::dbQuoteIdentifier(con, schema), " TO ", DBI::dbQuoteIdentifier(con, read_user)))
    DBI::dbExecute(con, paste0("GRANT SELECT ON ALL TABLES IN SCHEMA ", DBI::dbQuoteIdentifier(con, schema), " TO ", DBI::dbQuoteIdentifier(con, read_user)))
    run_http_parity <- function(schema, territory) {
      python <- Sys.which("python")
      if (!nzchar(python)) stop("Python executable is unavailable", call.=FALSE)
      keys <- c("PYTHONPATH", "LUSK_PROFILE_HTTP_SCHEMA", "LUSK_PROFILE_HTTP_TERRITORY")
      previous <- Sys.getenv(keys, unset=NA_character_)
      on.exit({
        for (i in seq_along(keys)) {
          if (is.na(previous[[i]])) Sys.unsetenv(keys[[i]])
          else do.call(Sys.setenv, setNames(list(previous[[i]]), keys[[i]]))
        }
      }, add=TRUE)
      root <- normalizePath("..", winslash="/", mustWork=TRUE)
      test_file <- normalizePath("../api/tests/integration/test_mobility_publisher_http.py", winslash="/", mustWork=TRUE)
      Sys.setenv(PYTHONPATH=root, LUSK_PROFILE_HTTP_SCHEMA=schema, LUSK_PROFILE_HTTP_TERRITORY=territory)
      system2(python, c("-m", "pytest", "-q", shQuote(paste0("--rootdir=", root), type="cmd"),
        shQuote(test_file, type="cmd")), stdout="", stderr="")
    }
    assert_http_parity <- function() {
      # Briefly extend the private reference only while serving the HTTP
      # contract. Restore its exact publisher universe before any subsequent
      # no-op/retry publication assertion.
      http_reference_version <- paste0(reference_version,"-http")
      DBI::dbWithTransaction(con, {
        DBI::dbExecute(con,"INSERT INTO territory_reference(territory_id,territory_type,name) VALUES('E_TEST','epci','Fixture EPCI')")
        DBI::dbExecute(con,"UPDATE table_publication SET content_version=$1,row_count=row_count+1 WHERE table_name='territory_reference'",
          params=list(http_reference_version))
        DBI::dbExecute(con,"UPDATE table_publication SET reference_content_version=$1 WHERE table_name IN ('scalar_observation','declared_profile')",
          params=list(http_reference_version))
      })
      status <- tryCatch(run_http_parity(schema, mobility_territories$territoire[[1L]]), finally={
        DBI::dbWithTransaction(con, {
          DBI::dbExecute(con,"DELETE FROM territory_reference WHERE territory_id='E_TEST' AND territory_type='epci'")
          DBI::dbExecute(con,"UPDATE table_publication SET content_version=$1,row_count=row_count-1 WHERE table_name='territory_reference'",
            params=list(reference_version))
          DBI::dbExecute(con,"UPDATE table_publication SET reference_content_version=$1 WHERE table_name IN ('scalar_observation','declared_profile')",
            params=list(reference_version))
        })
      })
      if (!identical(status, 0L)) stop("Publisher-to-HTTP parity test failed", call.=FALSE)
      cat("Guarded publisher-to-HTTP TestClient parity: PASS\n")
    }
    assert_http_parity()
  } else cat("Publisher-to-HTTP TestClient parity: SKIPPED (explicit read-only test DSN/role not configured)\n")
  age_after <- DBI::dbGetQuery(con, "SELECT territory_id,territory_type,detail_key,sex_key,value,status FROM profile_observation WHERE indicator_id='structure_age' ORDER BY territory_type,territory_id,detail_key,sex_key")
  no_op <- publier_declared_profiles_postgres(payload, metadata, habitat, habitat_metadata, scalar_version,
    con=con, mobilite=mobility_payload, mobilite_metadata=mobility_metadata, mobilite_vintages=mobility_vintages)
  stopifnot(combined$changed, identical(age_after,facts_before),
    DBI::dbGetQuery(con, "SELECT count(*) AS n FROM profile_axis WHERE indicator_id='distribution_dpe' AND axis_name='sex'")$n[[1L]]==0,
    DBI::dbGetQuery(con, "SELECT count(*) AS n FROM profile_observation WHERE indicator_id='distribution_dpe'")$n[[1L]]==nrow(dpe_rows),
    DBI::dbGetQuery(con, "SELECT count(*) AS n FROM profile_axis a JOIN profile_descriptor d USING(indicator_id) WHERE a.indicator_id IN ('structure_age','distribution_dpe') AND a.axis_name='detail' AND (a.unit IS NULL OR a.unit<>d.unit)")$n[[1L]]==0,
    all(vapply(c("voitures_menage","reseaux","reseaux_par_habitant","offre_cyclable"), function(id)
      DBI::dbGetQuery(con,"SELECT count(*) AS n FROM profile_observation WHERE indicator_id=$1",params=list(id))$n[[1L]]==
        nrow(mobility_rows[mobility_rows$key==id,,drop=FALSE]), logical(1))),
    DBI::dbGetQuery(con,"SELECT count(*) AS n FROM profile_axis WHERE indicator_id='offre_cyclable' AND axis_name='detail'")$n[[1L]]==5,
    !no_op$changed)
  combined_marker <- DBI::dbGetQuery(con, "SELECT * FROM table_publication WHERE table_name='declared_profile'")
  if (exists("assert_http_parity")) assert_http_parity()
  combined_facts <- DBI::dbGetQuery(con, "SELECT indicator_id,territory_id,territory_type,detail_key,sex_key,value,status FROM profile_observation ORDER BY indicator_id,territory_type,territory_id,detail_key,sex_key")
  DBI::dbExecute(con, "CREATE FUNCTION reject_combined_profile_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'combined profile fixture failure'; END $$")
  DBI::dbExecute(con, "CREATE TRIGGER reject_combined_profile BEFORE INSERT ON profile_observation FOR EACH ROW EXECUTE FUNCTION reject_combined_profile_insert()")
  changed_mobility <- mobility_payload
  changed_mobility$indicateurs$value[[1L]] <- changed_mobility$indicateurs$value[[1L]] + 1
  failed_combined <- try(publier_declared_profiles_postgres(payload, metadata, habitat, habitat_metadata, scalar_version,
    con=con, mobilite=changed_mobility, mobilite_metadata=mobility_metadata, mobilite_vintages=mobility_vintages), silent=TRUE)
  DBI::dbExecute(con, "DROP TRIGGER reject_combined_profile ON profile_observation")
  DBI::dbExecute(con, "DROP FUNCTION reject_combined_profile_insert()")
  stopifnot(inherits(failed_combined, "try-error"),
    identical(combined_marker, DBI::dbGetQuery(con, "SELECT * FROM table_publication WHERE table_name='declared_profile'")),
    identical(combined_facts, DBI::dbGetQuery(con, "SELECT indicator_id,territory_id,territory_type,detail_key,sex_key,value,status FROM profile_observation ORDER BY indicator_id,territory_type,territory_id,detail_key,sex_key")))
  if (exists("assert_http_parity")) assert_http_parity()
  age_only <- try(publish_registered_profile(registry,"structure_age",payload,adapter),silent=TRUE)
  stopifnot(inherits(age_only,"try-error"),
    identical(combined_marker,DBI::dbGetQuery(con,"SELECT * FROM table_publication WHERE table_name='declared_profile'")))
  DBI::dbExecute(con, "UPDATE table_publication SET content_version='stale-scalar' WHERE table_name='scalar_observation'")
  stale <- try(publier_declared_profiles_postgres(payload, metadata, habitat, habitat_metadata, scalar_version,
    con=con, mobilite=mobility_payload, mobilite_metadata=mobility_metadata, mobilite_vintages=mobility_vintages),silent=TRUE)
  stopifnot(inherits(stale,"try-error"),
    identical(combined_marker,DBI::dbGetQuery(con,"SELECT * FROM table_publication WHERE table_name='declared_profile'")))
  cat("DPE complete-snapshot entrypoint, structure-age preservation, no fake axis, retry and scalar pin: PASS\n")
},finally={
  if (created) {
    tryCatch({
      cleanup_serving_smoke_schema(con, schema, "profile")
      cat("Profile smoke schema cleaned with dependency-ordered RESTRICT:", schema, "\n")
    }, error=function(e) {
      stop("Could not clean profile smoke schema ", schema,
        " (inspect and remove manually): ", conditionMessage(e), call.=FALSE)
    })
  }
  tryCatch(DBI::dbDisconnect(con), error=function(e)
    warning("Could not disconnect profile smoke DB connection: ", conditionMessage(e), call.=FALSE))
})
