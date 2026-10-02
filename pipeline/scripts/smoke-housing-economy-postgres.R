#!/usr/bin/env Rscript
# Guarded canonical scalar publication + HTTP check for #627's eco_activites.
pkgload::load_all(".", quiet=TRUE)
required <- c("HOST", "PORT", "DATABASE", "USER")
config <- setNames(lapply(required, function(k) Sys.getenv(paste0("LUSK_PROFILE_TEST_", k), unset="")), required)
stopifnot(all(vapply(config, nzchar, logical(1))),
  grepl("^lusk_it_[A-Za-z0-9_]+$", config$DATABASE),
  !tolower(config$DATABASE) %in% c("lusk", "postgres", "template0", "template1"),
  grepl("^[A-Za-z0-9_.:-]+$", config$HOST), grepl("^[0-9]+$", config$PORT))
read_user <- Sys.getenv("LUSK_TEST_READ_USER", unset="")
read_dsn <- Sys.getenv("LUSK_TEST_READ_DSN", unset="")
stopifnot(nzchar(read_user), nzchar(read_dsn), read_user != config$USER,
  identical(Sys.getenv("LUSK_TEST_DATABASE_PREFIX"), "lusk_it_"),
  identical(Sys.getenv("LUSK_TEST_DATABASE_NAME"), config$DATABASE))
canonical_dir <- Sys.getenv("LUSK_TEST_CANONICAL_DATA_DIR", unset="")
stopifnot(nzchar(canonical_dir), dir.exists(canonical_dir))
con <- DBI::dbConnect(RPostgres::Postgres(), host=config$HOST, port=as.integer(config$PORT),
  dbname=config$DATABASE, user=config$USER)
schema <- paste0("profile_it_", Sys.getpid(), "_economy")
created <- FALSE
tryCatch({
  identity <- DBI::dbGetQuery(con, "SELECT current_database() AS database,current_user AS username")
  stopifnot(identical(identity$database[[1L]], config$DATABASE),
    identical(identity$username[[1L]], config$USER))
  DBI::dbExecute(con, paste0("CREATE SCHEMA ", DBI::dbQuoteIdentifier(con, schema)))
  created <- TRUE
  DBI::dbExecute(con, paste0("SET search_path TO ", DBI::dbQuoteIdentifier(con, schema)))
  ddl <- paste(readLines("../api/schema.sql", warn=FALSE), collapse="\n")
  for (statement in split_postgres_sql(ddl)) DBI::dbExecute(con, statement)

  inputs <- preparer_tables_service(canonical_dir)
  complete <- project_service_scalar_snapshot(inputs, canonical_dir)
  stopifnot("eco_activites" %in% complete$projection$descriptors$indicator_id,
    nrow(complete$projection$descriptors) == 43L,
    nrow(complete$projection$facts[complete$projection$facts$indicator_id != "eco_activites", , drop=FALSE]) == 53253L,
    nrow(complete$projection$facts[complete$projection$facts$indicator_id == "eco_activites", , drop=FALSE]) > 0L)
  DBI::dbWriteTable(con, "territory_reference", inputs$tables$territory_reference,
    append=TRUE, row.names=FALSE)
  reference_version <- "canonical-housing-economy-reference"
  DBI::dbExecute(con, "INSERT INTO table_publication(table_name,content_version,row_count) VALUES ('territory_reference',$1,$2)",
    params=list(reference_version,nrow(inputs$tables$territory_reference)))
  publish_service_share_scalars(con, inputs$scalar_access, inputs$scalar_metadata,
    inputs$scalar_eligible_territories, additional_projections=complete$additional_projections)
  expected_eco <- complete$projection$facts[complete$projection$facts$indicator_id == "eco_activites", , drop=FALSE]
  actual_eco <- DBI::dbGetQuery(con, "SELECT indicator_id,territory_id,territory_type,value,status,support_count,denominator_count FROM scalar_observation WHERE indicator_id='eco_activites' ORDER BY territory_type,territory_id")
  expected_eco <- expected_eco[order(expected_eco$territory_type, expected_eco$territory_id),
    c("indicator_id","territory_id","territory_type","value","status","support_count","denominator_count"), drop=FALSE]
  rownames(actual_eco) <- rownames(expected_eco) <- NULL
  stopifnot(isTRUE(all.equal(actual_eco, expected_eco, check.attributes=FALSE)),
    DBI::dbGetQuery(con, "SELECT count(*) AS n FROM scalar_descriptor")$n[[1L]] == 43L,
    DBI::dbGetQuery(con, "SELECT row_count FROM table_publication WHERE table_name='scalar_observation'")$row_count[[1L]] ==
      53253L + nrow(expected_eco))

  # Full canonical registered-profile batch: keep structure_age, DPE, and all
  # four mobility profiles in the replacement snapshot while adding the four
  # Habitat detail families. No synthetic housing observations enter SQL.
  read_canonical <- function(name) nanoparquet::read_parquet(file.path(canonical_dir, paste0(name, ".parquet")))
  canonical_territories <- read_canonical("territoires")
  canonical_vintages <- read_canonical("vintages")
  demography_metadata <- lire_theme_metadata("demographie")
  habitat_metadata <- lire_theme_metadata("habitat")
  mobility_metadata <- lire_theme_metadata("mobilite")
  demography <- list(indicateurs=read_canonical("indicateurs_demographie"), territoires=canonical_territories)
  habitat <- list(indicateurs=read_canonical("indicateurs_habitat"), territoires=canonical_territories,
    source_vintages=canonical_vintages)
  mobility <- list(indicateurs=read_canonical("indicateurs_mobilite"), territoires=canonical_territories,
    source_vintages=canonical_vintages)
  scalar_version <- DBI::dbGetQuery(con,
    "SELECT content_version FROM table_publication WHERE table_name='scalar_observation'")$content_version[[1L]]
  profile_result <- publier_declared_profiles_postgres(demography, demography_metadata,
    habitat, habitat_metadata, scalar_version, con=con, mobilite=mobility,
    mobilite_metadata=mobility_metadata, mobilite_vintages=canonical_vintages)
  housing_ids <- c("mix_logements", "statut", "type", "age_du_bati")
  expected_profiles <- lapply(housing_ids, function(id)
    project_declared_detail_profile(habitat, habitat_metadata, id, canonical_vintages))
  names(expected_profiles) <- housing_ids
  for (id in housing_ids) {
    expected <- expected_profiles[[id]]
    actual <- DBI::dbGetQuery(con, "SELECT o.territory_id,o.territory_type,o.detail_key,o.sex_key,o.value,o.status,
      a.unit,d.denominator_semantics,sd.source_id,sd.name AS source_name,sv.version,sv.reference_date,sv.publication_date
      FROM profile_observation o JOIN profile_axis a ON a.indicator_id=o.indicator_id
        AND a.axis_name='detail' AND a.axis_key=o.detail_key
      JOIN profile_descriptor d ON d.indicator_id=o.indicator_id
      JOIN profile_observation_source os ON os.indicator_id=o.indicator_id AND os.territory_id=o.territory_id
        AND os.detail_key=o.detail_key AND os.sex_key=o.sex_key
      JOIN source_dataset sd USING(source_id) JOIN source_vintage sv USING(source_id,vintage_id)
      WHERE o.indicator_id=$1 ORDER BY o.territory_type,o.territory_id,o.detail_key", params=list(id))
    expected_rows <- data.frame(territory_id=expected$facts$territory_id,
      territory_type=expected$facts$territory_type,detail_key=expected$facts$detail,sex_key="",
      value=expected$facts$value,status=expected$facts$status,
      unit=expected$axes$unit[match(expected$facts$detail,expected$axes$axis_key)],
      denominator_semantics=expected$descriptor$denominator_semantics,
      source_id=unlist(expected$descriptor$source)[[1L]],
      source_name=NA_character_,
      version=NA_character_, reference_date=NA_character_, publication_date=NA_character_,
      stringsAsFactors=FALSE)
    canonical_rows <- habitat$indicateurs[habitat$indicateurs$key == id, , drop=FALSE]
    canonical_index <- match(paste(expected$facts$territory_id,expected$facts$detail),
      paste(canonical_rows$territoire,canonical_rows$detail))
    expected_rows$version <- as.character(canonical_rows$vintage_version[canonical_index])
    expected_rows$source_name <- as.character(canonical_rows$vintage_source[canonical_index])
    expected_rows$reference_date <- as.character(canonical_rows$vintage_date_reference[canonical_index])
    expected_rows$publication_date <- as.character(canonical_rows$vintage_date_publication[canonical_index])
    order_expected <- order(expected_rows$territory_type, expected_rows$territory_id, expected_rows$detail_key)
    expected_rows <- expected_rows[order_expected, , drop=FALSE]
    # Source dates are canonical row-level stamps; verify facts and axes here,
    # and verify source/vintage identity directly against each canonical row.
    actual_core <- actual[c("territory_id","territory_type","detail_key","sex_key","value","status","unit","denominator_semantics")]
    expected_core <- expected_rows[names(actual_core)]
    rownames(actual_core) <- rownames(expected_core) <- NULL
    stopifnot(isTRUE(all.equal(actual_core, expected_core, check.attributes=FALSE)),
      nrow(actual)==nrow(expected$facts),
      all(actual$source_id == expected$descriptor$source[[1L]]),
      identical(as.character(actual$source_name), expected_rows$source_name),
      identical(as.character(actual$version), expected_rows$version),
      identical(as.character(actual$reference_date), expected_rows$reference_date),
      identical(as.character(actual$publication_date), expected_rows$publication_date))
  }
  profile_marker_before_noop <- DBI::dbGetQuery(con,
    "SELECT content_version,row_count,reference_content_version FROM table_publication WHERE table_name='declared_profile'")
  profile_noop <- publier_declared_profiles_postgres(demography, demography_metadata,
    habitat, habitat_metadata, scalar_version, con=con, mobilite=mobility,
    mobilite_metadata=mobility_metadata, mobilite_vintages=canonical_vintages)
  stopifnot(!profile_noop$changed, identical(profile_marker_before_noop,
    DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version FROM table_publication WHERE table_name='declared_profile'")))
  manifest <- lapply(housing_ids, function(id) {
    projection <- expected_profiles[[id]]
    levels <- unique(projection$facts$territory_type)
    by_level <- lapply(levels, function(level) {
      candidates <- sort(unique(projection$facts$territory_id[projection$facts$territory_type == level]))
      territory <- candidates[[1L]]
      fact <- projection$facts[projection$facts$territory_type == level & projection$facts$territory_id == territory,,drop=FALSE]
      canonical_row <- habitat$indicateurs[habitat$indicateurs$key == id &
        habitat$indicateurs$territoire == territory,,drop=FALSE]
      list(territory_type=level, territory_id=territory,
        cells=lapply(seq_len(nrow(fact)), function(i) list(detail=fact$detail[[i]], value=fact$value[[i]],
          status=fact$status[[i]], unit=projection$axes$unit[match(fact$detail[[i]],projection$axes$axis_key)])),
        source=list(source_id=projection$descriptor$source[[1L]], name=canonical_row$vintage_source[[1L]],
          version=canonical_row$vintage_version[[1L]], reference_date=canonical_row$vintage_date_reference[[1L]],
          publication_date=canonical_row$vintage_date_publication[[1L]],
          vintage_id=paste(canonical_row$vintage_version[[1L]],canonical_row$vintage_date_reference[[1L]],sep="/")))
    })
    list(indicator_id=id, label=projection$descriptor$label, unit=projection$descriptor$unit,
      denominator_semantics=projection$descriptor$denominator_semantics,
      comparison_detail=projection$descriptor$comparison_detail, levels=by_level)
  })
  manifest_path <- tempfile("housing-profile-http-", fileext=".json")
  jsonlite::write_json(manifest, manifest_path, auto_unbox=TRUE, null="null", digits=NA)
  focal <- DBI::dbGetQuery(con, "SELECT indicator_id,territory_id,value,status,support_count,denominator_count FROM scalar_observation WHERE indicator_id='eco_activites' AND territory_type='commune' AND territory_id='35238'")
  stopifnot(nrow(focal)==1L)
  DBI::dbExecute(con, paste0("GRANT USAGE ON SCHEMA ", DBI::dbQuoteIdentifier(con, schema),
    " TO ", DBI::dbQuoteIdentifier(con, read_user)))
  DBI::dbExecute(con, paste0("GRANT SELECT ON ALL TABLES IN SCHEMA ", DBI::dbQuoteIdentifier(con, schema),
    " TO ", DBI::dbQuoteIdentifier(con, read_user)))
  keys <- c("LUSK_HOUSING_HTTP_SCHEMA", "LUSK_HOUSING_HTTP_TERRITORY", "LUSK_HOUSING_HTTP_MANIFEST", "PYTHONPATH")
  old <- Sys.getenv(keys, unset=NA_character_)
  on.exit(for (i in seq_along(keys)) if (is.na(old[[i]])) Sys.unsetenv(keys[[i]]) else
    do.call(Sys.setenv, setNames(list(old[[i]]), keys[[i]])), add=TRUE)
  Sys.setenv(LUSK_HOUSING_HTTP_SCHEMA=schema, LUSK_HOUSING_HTTP_TERRITORY="35238",
    LUSK_HOUSING_HTTP_MANIFEST=manifest_path,
    PYTHONPATH=normalizePath("..", winslash="/", mustWork=TRUE))
  status <- system2(Sys.which("python"), c("-m", "pytest", "-q",
    shQuote(normalizePath("../api/tests/integration/test_housing_economy_publisher_http.py", winslash="/", mustWork=TRUE), type="cmd")),
    stdout="", stderr="")
  if (!identical(status, 0L)) stop("Canonical economy publisher-to-HTTP parity failed", call.=FALSE)
  housing_test <- normalizePath("../api/tests/integration/test_canonical_housing_publisher_http.py", winslash="/", mustWork=TRUE)
  housing_status <- system2(Sys.which("python"), c("-m", "pytest", "-q",
    shQuote(housing_test, type="cmd")), stdout="", stderr="")
  if (!identical(housing_status, 0L)) stop("Canonical housing publisher-to-HTTP parity failed", call.=FALSE)
  housing_counts <- vapply(expected_profiles, function(p) nrow(p$facts), integer(1))
  housing_levels <- vapply(expected_profiles, function(p) length(unique(p$facts$territory_type)), integer(1))
  names(housing_counts) <- housing_ids
  names(housing_levels) <- housing_ids
  cat("Canonical housing SQL rows:", paste(names(housing_counts), housing_counts, sep="=", collapse=", "),
    "\nHTTP focal levels per profile:", paste(names(housing_levels), housing_levels, sep="=", collapse=", "),
    "\nRegistered full canonical profile snapshot (10 profiles), all four housing profiles PostgreSQL/HTTP parity, full scalar snapshot (43 descriptors), and eco_activites parity: PASS\n")
}, finally={
  if (exists("manifest_path") && file.exists(manifest_path)) unlink(manifest_path)
  if (created) cleanup_serving_smoke_schema(con, schema, "profile")
  DBI::dbDisconnect(con)
})
