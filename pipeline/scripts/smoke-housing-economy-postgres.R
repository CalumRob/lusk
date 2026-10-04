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
  stopifnot(all(c("eco_activites", "prix_m2") %in% complete$projection$descriptors$indicator_id),
    nrow(complete$projection$descriptors) == 45L,
    nrow(complete$projection$facts[complete$projection$facts$indicator_id != "eco_activites", , drop=FALSE]) == 53253L + 1268L + 1268L,
    nrow(complete$projection$facts[complete$projection$facts$indicator_id == "eco_activites", , drop=FALSE]) > 0L)
  # Publish the actual canonical registered service/building producer first.
  # This owns the full territory reference and the two independent building
  # fact markers used by the following public HTTP assertions.
  published_service <- publier_tables_postgres(con, inputs$tables, inputs$versions,
    inputs$access_scope, inputs$building_contract, inputs$building_sources)
  stopifnot(all(c("territory_reference", "service_registry", "essential_service_access",
    "building_ramp", "building_grid") %in% published_service),
    DBI::dbGetQuery(con, "SELECT row_count FROM table_publication WHERE table_name='building_ramp'")$row_count[[1L]] == nrow(inputs$tables$building_ramp),
    DBI::dbGetQuery(con, "SELECT row_count FROM table_publication WHERE table_name='building_grid'")$row_count[[1L]] == nrow(inputs$tables$building_grid))
  publish_service_share_scalars(con, inputs$scalar_access, inputs$scalar_metadata,
    inputs$scalar_eligible_territories, additional_projections=complete$additional_projections)
  economy_histories <- nanoparquet::read_parquet(file.path(canonical_dir,"histoires_economie.parquet"))
  economy_vintages <- nanoparquet::read_parquet(file.path(canonical_dir,"vintages.parquet"))
  economy_metadata <- lire_theme_metadata("economie")
  economy_canonical <- list(histories=economy_histories,vintages=economy_vintages,metadata=economy_metadata,
    content_version=economy_reading_content_version(economy_histories,economy_vintages,economy_metadata))
  publish_registered_typed_reading(register_economy_reading_publisher(list()),"economie",economy_canonical,con)
  expected_reading <- project_economy_reading(economy_histories,economy_vintages,economy_metadata)
  reading_columns <- c("territory_id","territory_type","groupe","story_key","salience_reason","status","source_id","vintage_id")
  actual_reading <- DBI::dbGetQuery(con,paste0("SELECT ",paste(reading_columns,collapse=","),
    " FROM economy_typed_reading ORDER BY territory_type,territory_id,groupe"))
  expected_reading_ordered <- expected_reading[order(expected_reading$territory_type,expected_reading$territory_id,expected_reading$groupe),reading_columns,drop=FALSE]
  rownames(actual_reading) <- rownames(expected_reading_ordered) <- NULL
  expected_evidence <- do.call(rbind,lapply(seq_len(5L),function(rank) {
    code <- expected_reading[[paste0("top",rank,"_activity_code")]]; keep <- !is.na(code)
    data.frame(territory_id=expected_reading$territory_id[keep],territory_type=expected_reading$territory_type[keep],
      groupe=expected_reading$groupe[keep],rank=rank,activity_code=code[keep],
      activity_label=expected_reading[[paste0("top",rank,"_activity_label")]][keep],
      lq=expected_reading[[paste0("top",rank,"_lq")]][keep],establishment_count=expected_reading[[paste0("top",rank,"_n")]][keep],
      park_share=expected_reading[[paste0("top",rank,"_part_parc")]][keep],source_id=expected_reading$source_id[keep],
      vintage_id=expected_reading$vintage_id[keep],stringsAsFactors=FALSE)
  }))
  actual_evidence <- DBI::dbGetQuery(con,"SELECT territory_id,territory_type,groupe,rank,activity_code,activity_label,lq,
    establishment_count,park_share,source_id,vintage_id FROM economy_activity_evidence ORDER BY territory_type,territory_id,groupe,rank")
  expected_evidence <- expected_evidence[order(expected_evidence$territory_type,expected_evidence$territory_id,
    expected_evidence$groupe,expected_evidence$rank),]
  rownames(actual_evidence) <- rownames(expected_evidence) <- NULL
  stopifnot(isTRUE(all.equal(actual_reading,expected_reading_ordered,check.attributes=FALSE)),
    isTRUE(all.equal(actual_evidence,expected_evidence,check.attributes=FALSE)),
    DBI::dbGetQuery(con,"SELECT row_count FROM table_publication WHERE table_name='economy_typed_reading'")$row_count[[1L]]==nrow(expected_reading),
    DBI::dbGetQuery(con,"SELECT row_count FROM table_publication WHERE table_name='economy_activity_evidence'")$row_count[[1L]]==nrow(expected_evidence))
  marker_before_noop <- DBI::dbGetQuery(con,"SELECT table_name,content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name IN ('economy_typed_reading','economy_activity_evidence') ORDER BY table_name")
  publish_registered_typed_reading(register_economy_reading_publisher(list()),"economie",economy_canonical,con)
  stopifnot(isTRUE(all.equal(marker_before_noop,DBI::dbGetQuery(con,"SELECT table_name,content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name IN ('economy_typed_reading','economy_activity_evidence') ORDER BY table_name"),check.attributes=FALSE)))
  DBI::dbExecute(con,"CREATE FUNCTION reject_economy_evidence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected economy evidence failure'; END $$")
  DBI::dbExecute(con,"CREATE TRIGGER reject_economy_evidence BEFORE INSERT ON economy_activity_evidence FOR EACH ROW EXECUTE FUNCTION reject_economy_evidence()")
  failed_input <- economy_canonical
  failed_input$histories$salience_reason[[1L]] <- paste0(failed_input$histories$salience_reason[[1L]],"-rollback-test")
  failed_input$content_version <- economy_reading_content_version(failed_input$histories,failed_input$vintages,failed_input$metadata)
  failed_publication <- try(publish_registered_typed_reading(register_economy_reading_publisher(list()),"economie",failed_input,con),silent=TRUE)
  DBI::dbExecute(con,"DROP TRIGGER reject_economy_evidence ON economy_activity_evidence")
  DBI::dbExecute(con,"DROP FUNCTION reject_economy_evidence()")
  stopifnot(inherits(failed_publication,"try-error"),
    isTRUE(all.equal(marker_before_noop,DBI::dbGetQuery(con,"SELECT table_name,content_version,row_count,reference_content_version,published_at FROM table_publication WHERE table_name IN ('economy_typed_reading','economy_activity_evidence') ORDER BY table_name"),check.attributes=FALSE)),
    isTRUE(all.equal(actual_evidence,DBI::dbGetQuery(con,"SELECT territory_id,territory_type,groupe,rank,activity_code,activity_label,lq,establishment_count,park_share,source_id,vintage_id FROM economy_activity_evidence ORDER BY territory_type,territory_id,groupe,rank"),check.attributes=FALSE)))
  expected_eco <- complete$projection$facts[complete$projection$facts$indicator_id == "eco_activites", , drop=FALSE]
  actual_eco <- DBI::dbGetQuery(con, "SELECT indicator_id,territory_id,territory_type,value,status,support_count,denominator_count FROM scalar_observation WHERE indicator_id='eco_activites' ORDER BY territory_type,territory_id")
  expected_eco <- expected_eco[order(expected_eco$territory_type, expected_eco$territory_id),
    c("indicator_id","territory_id","territory_type","value","status","support_count","denominator_count"), drop=FALSE]
  rownames(actual_eco) <- rownames(expected_eco) <- NULL
  stopifnot(isTRUE(all.equal(actual_eco, expected_eco, check.attributes=FALSE)),
    DBI::dbGetQuery(con, "SELECT count(*) AS n FROM scalar_descriptor")$n[[1L]] == 45L,
    DBI::dbGetQuery(con, "SELECT row_count FROM table_publication WHERE table_name='scalar_observation'")$row_count[[1L]] ==
      53253L + 1268L + 1268L + nrow(expected_eco))
  expected_all <- complete$projection$facts[order(complete$projection$facts$indicator_id,
    complete$projection$facts$territory_type, complete$projection$facts$territory_id),
    c("indicator_id","territory_id","territory_type","value","status","support_count","denominator_count"),drop=FALSE]
  actual_all <- DBI::dbGetQuery(con, "SELECT indicator_id,territory_id,territory_type,value,status,support_count,denominator_count FROM scalar_observation ORDER BY indicator_id,territory_type,territory_id")
  rownames(actual_all) <- rownames(expected_all) <- NULL
  expected_sources <- complete$projection$provenance[order(complete$projection$provenance$indicator_id,
    complete$projection$provenance$territory_id, complete$projection$provenance$source_id,
    complete$projection$provenance$vintage_id),]
  actual_sources <- DBI::dbGetQuery(con, "SELECT indicator_id,territory_id,source_id,vintage_id FROM scalar_observation_source ORDER BY indicator_id,territory_id,source_id,vintage_id")
  rownames(actual_sources) <- rownames(expected_sources) <- NULL
  stopifnot(isTRUE(all.equal(actual_all, expected_all, check.attributes=FALSE)),
    isTRUE(all.equal(actual_sources, expected_sources, check.attributes=FALSE)),
    all(c("prix_m2", "part_passoires") %in% DBI::dbGetQuery(con,
      "SELECT indicator_id FROM scalar_descriptor WHERE theme_id='habitat'")$indicator_id))

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
  pooled_price <- habitat$indicateurs[habitat$indicateurs$key == "prix_m2" &
    is.na(habitat$indicateurs$detail), , drop=FALSE]
  canonical_price_source <- function(row) {
    version <- as.character(row$vintage_version)
    reference_date <- as.character(row$vintage_date_reference)
    list(source_id=as.character(habitat_metadata$sources$prix_m2),
      name=as.character(row$vintage_source),
      vintage_id=if (!is.na(version) && !is.na(reference_date)) paste(version, reference_date, sep="/") else NA_character_,
      version=version, reference_date=if (is.na(row$vintage_date_reference)) NULL else reference_date,
      publication_date=if (is.na(row$vintage_date_publication)) NULL else as.character(row$vintage_date_publication))
  }
  price_manifest <- lapply(c("commune", "epci", "departement", "region"), function(level) {
    row <- pooled_price[pooled_price$type == level, , drop=FALSE]
    # Stable representatives include Rennes for the commune headline.
    if (level == "commune") row <- row[row$territoire == "35238", , drop=FALSE]
    else row <- row[1L, , drop=FALSE]
    stopifnot(nrow(row) == 1L)
    list(territory_type=level, territory_id=as.character(row$territoire),
      value=as.numeric(row$value), status=if (is.na(row$value)) "suppressed" else "measured",
      support=as.integer(row$n), unit=as.character(row$unit),
      source=canonical_price_source(row))
  })
  suppressed_price <- pooled_price[pooled_price$type == "commune" & is.na(pooled_price$value) &
    !is.na(pooled_price$n) & pooled_price$n > 0L & pooled_price$n < 10L, , drop=FALSE]
  stopifnot(nrow(suppressed_price) > 0L)
  row <- suppressed_price[order(suppressed_price$territoire), , drop=FALSE][1L, , drop=FALSE]
  price_manifest[[5L]] <- list(territory_type="commune", territory_id=as.character(row$territoire),
    value=NULL, status="suppressed", support=as.integer(row$n), unit=as.character(row$unit),
    source=canonical_price_source(row))
  comparable_epcis <- unique(pooled_price$territoire[pooled_price$type == "epci" & !is.na(pooled_price$value)])
  comparison <- NULL
  for (epci in comparable_epcis) {
    members <- canonical_territories$territoire[canonical_territories$type == "commune" &
      !is.na(canonical_territories$epci) &
      canonical_territories$epci == epci]
    observations <- pooled_price[pooled_price$type == "commune" & pooled_price$territoire %in% members &
      !is.na(pooled_price$value), , drop=FALSE]
    if (nrow(observations) >= 2L) {
      comparison <- list(epci_id=as.character(epci), commune_id=as.character(members[[1L]]),
        median=stats::median(observations$value), selected_member_count=nrow(observations))
      break
    }
  }
  stopifnot(!is.null(comparison))
  price_manifest[[6L]] <- list(comparison=comparison)
  price_manifest_path <- tempfile("housing-price-http-", fileext=".json")
  jsonlite::write_json(price_manifest, price_manifest_path, auto_unbox=TRUE, null="null", digits=NA)
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
      identical(as.numeric(actual$value), as.numeric(expected_rows$value)),
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
  # Independently derive focal and density-class building expectations from
  # the canonical publisher inputs, not from SQL or the API implementation.
  building_territory <- "35238"
  ref_row <- inputs$tables$territory_reference[inputs$tables$territory_reference$territory_id == building_territory,,drop=FALSE]
  stopifnot(nrow(ref_row)==1L, nzchar(ref_row$density_class_code[[1L]]))
  peer_ids <- inputs$tables$territory_reference$territory_id[
    inputs$tables$territory_reference$territory_type=="commune" &
      inputs$tables$territory_reference$density_class_code==ref_row$density_class_code[[1L]]]
  ramp <- inputs$tables$building_ramp
  grid <- inputs$tables$building_grid
  focal_ramp <- ramp[ramp$territory_id==building_territory & ramp$territory_type=="commune" & ramp$availability=="complete",,drop=FALSE]
  focal_grid <- grid[grid$territory_id==building_territory & grid$territory_type=="commune" & grid$availability=="complete",,drop=FALSE]
  focal_ramp <- focal_ramp[order(focal_ramp$mode,focal_ramp$quantile),,drop=FALSE]
  focal_grid <- focal_grid[order(focal_grid$breadth_bucket,focal_grid$depth_bucket),,drop=FALSE]
  available_ramp <- ramp[ramp$territory_id %in% peer_ids & ramp$territory_type=="commune" & ramp$availability=="complete",,drop=FALSE]
  available_grid <- grid[grid$territory_id %in% peer_ids & grid$territory_type=="commune" & grid$availability=="complete",,drop=FALSE]
  ramp_member_counts <- unique(available_ramp[c("territory_id","total_buildings")])
  grid_member_counts <- unique(available_grid[c("territory_id","total_buildings")])
  ramp_ids <- intersect(ramp_member_counts$territory_id, grid_member_counts$territory_id)
  stopifnot(length(ramp_ids)>=2L)
  ramp_member_counts <- ramp_member_counts[match(ramp_ids,ramp_member_counts$territory_id),,drop=FALSE]
  total_ramp_buildings <- sum(ramp_member_counts$total_buildings)
  peer_ramp_points <- do.call(rbind,lapply(c("c","b","t"),function(mode) do.call(rbind,lapply(0:10,function(i) {
    rows <- available_ramp[available_ramp$territory_id %in% ramp_ids & available_ramp$mode==mode & available_ramp$quantile_index==i,,drop=FALSE]
    stopifnot(nrow(rows)==length(ramp_ids))
    data.frame(mode=mode,quantile=i/10,accessible_types=sum(rows$accessible_types*rows$total_buildings)/sum(rows$total_buildings))
  }))))
  peer_ramp <- list(statistic="mean",member_count=length(ramp_ids),total_buildings=total_ramp_buildings,
    points=lapply(seq_len(nrow(peer_ramp_points)),function(i) as.list(peer_ramp_points[i,,drop=FALSE])))
  available_grid <- available_grid[available_grid$territory_id %in% ramp_ids,,drop=FALSE]
  total_grid_buildings <- sum(unique(available_grid[c("territory_id","total_buildings")])$total_buildings)
  pooled_counts <- stats::aggregate(building_count ~ breadth_bucket + depth_bucket, available_grid, sum)
  pooled_counts <- pooled_counts[order(pooled_counts$breadth_bucket,pooled_counts$depth_bucket),,drop=FALSE]
  peer_grid <- list(statistic="mean",member_count=length(ramp_ids),total_buildings=total_grid_buildings,
    cells=lapply(seq_len(nrow(pooled_counts)),function(i) list(
      breadth_bucket=pooled_counts$breadth_bucket[[i]],depth_bucket=pooled_counts$depth_bucket[[i]],
      building_count=pooled_counts$building_count[[i]],share=pooled_counts$building_count[[i]]/total_grid_buildings)))
  region_ids <- inputs$tables$territory_reference$territory_id[
    inputs$tables$territory_reference$territory_type=="commune"]
  region_ramp_rows <- ramp[ramp$territory_id %in% region_ids & ramp$territory_type=="commune" & ramp$availability=="complete",,drop=FALSE]
  region_grid_rows <- grid[grid$territory_id %in% region_ids & grid$territory_type=="commune" & grid$availability=="complete",,drop=FALSE]
  region_ramp_counts <- unique(region_ramp_rows[c("territory_id","total_buildings")])
  region_grid_counts <- unique(region_grid_rows[c("territory_id","total_buildings")])
  region_members <- intersect(region_ramp_counts$territory_id,region_grid_counts$territory_id)
  stopifnot(length(region_members)>=2L)
  region_ramp_rows <- region_ramp_rows[region_ramp_rows$territory_id %in% region_members,,drop=FALSE]
  region_points <- do.call(rbind,lapply(c("c","b","t"),function(mode) do.call(rbind,lapply(0:10,function(i) {
    rows <- region_ramp_rows[region_ramp_rows$mode==mode & region_ramp_rows$quantile_index==i,,drop=FALSE]
    data.frame(mode=mode,quantile=i/10,accessible_types=sum(rows$accessible_types*rows$total_buildings)/sum(rows$total_buildings))
  }))))
  region_peer_ramp <- list(statistic="mean",member_count=length(region_members),
    total_buildings=sum(region_ramp_counts$total_buildings[match(region_members,region_ramp_counts$territory_id)]),
    points=lapply(seq_len(nrow(region_points)),function(i) as.list(region_points[i,,drop=FALSE])))
  region_grid_rows <- region_grid_rows[region_grid_rows$territory_id %in% region_members,,drop=FALSE]
  region_grid_total <- sum(region_grid_counts$total_buildings[match(region_members,region_grid_counts$territory_id)])
  region_counts <- stats::aggregate(building_count ~ breadth_bucket + depth_bucket,region_grid_rows,sum)
  region_counts <- region_counts[order(region_counts$breadth_bucket,region_counts$depth_bucket),,drop=FALSE]
  region_peer_grid <- list(statistic="mean",member_count=length(region_members),total_buildings=region_grid_total,
    cells=lapply(seq_len(nrow(region_counts)),function(i) list(
      breadth_bucket=region_counts$breadth_bucket[[i]],depth_bucket=region_counts$depth_bucket[[i]],
      building_count=region_counts$building_count[[i]],share=region_counts$building_count[[i]]/region_grid_total)))
  focal_ramp_json <- lapply(seq_len(nrow(focal_ramp)),function(i) list(
    mode=focal_ramp$mode[[i]],quantile_index=focal_ramp$quantile_index[[i]],
    quantile=focal_ramp$quantile[[i]],accessible_types=focal_ramp$accessible_types[[i]],
    total_buildings=focal_ramp$total_buildings[[i]],source_id=focal_ramp$source_id[[i]],
    source_version=focal_ramp$source_version[[i]]))
  focal_grid_json <- lapply(seq_len(nrow(focal_grid)),function(i) list(
    breadth_bucket=focal_grid$breadth_bucket[[i]],depth_bucket=focal_grid$depth_bucket[[i]],
    building_count=focal_grid$building_count[[i]],total_buildings=focal_grid$total_buildings[[i]],
    source_id=focal_grid$source_id[[i]],source_version=focal_grid$source_version[[i]]))
  building_manifest <- list(focal_ramp=focal_ramp_json,focal_grid=focal_grid_json,
    peer_ramp=peer_ramp,peer_grid=peer_grid,region_peer_ramp=region_peer_ramp,
    region_peer_grid=region_peer_grid,region_member_count=length(region_ids))
  building_manifest$canonical_row_counts <- list(
    ramp=nrow(inputs$tables$building_ramp),grid=nrow(inputs$tables$building_grid),
    reference=nrow(inputs$tables$territory_reference))
  nb_row <- read_canonical("indicateurs_mobilite")
  nb_row <- nb_row[nb_row$key=="nb_buildings" & nb_row$territoire==building_territory,,drop=FALSE]
  stopifnot(nrow(nb_row)==1L)
  regional_reference_rows <- read_canonical("territoires")
  regional_reference_rows <- regional_reference_rows[regional_reference_rows$type=="region",,drop=FALSE]
  stopifnot(nrow(regional_reference_rows)==1L)
  regional_nb <- read_canonical("indicateurs_mobilite")
  regional_nb <- regional_nb[regional_nb$key=="nb_buildings" &
    regional_nb$territoire==regional_reference_rows$territoire[[1L]] &
    regional_nb$type=="region",,drop=FALSE]
  stopifnot(nrow(regional_nb)==1L, !is.na(regional_nb$value[[1L]]))
  building_manifest$nb_buildings <- list(value=nb_row$value[[1L]],unit=nb_row$unit[[1L]],
    label=as.character(mobility_metadata$indicator_labels$nb_buildings),
    source_id=as.character(mobility_metadata$sources$nb_buildings),
    source_version=as.character(nb_row$vintage_version[[1L]]),
    reference_date=as.character(nb_row$vintage_date_reference[[1L]]),
    publication_date=as.character(nb_row$vintage_date_publication[[1L]]))
  building_manifest$service_reference <- list(
    territory_id=as.character(regional_reference_rows$territoire[[1L]]),
    territory_type=as.character(regional_reference_rows$type[[1L]]),
    name=as.character(regional_reference_rows$nom[[1L]]),
    indicator_id="nb_buildings",
    label=as.character(mobility_metadata$indicator_pages$nb_buildings$label),
    unit=as.character(regional_nb$unit[[1L]]),value=regional_nb$value[[1L]],status="measured",
    source_id=as.character(mobility_metadata$sources$nb_buildings),
    source_name=as.character(regional_nb$vintage_source[[1L]]),
    version=as.character(regional_nb$vintage_version[[1L]]),
    reference_date=as.character(regional_nb$vintage_date_reference[[1L]]),
    publication_date=as.character(regional_nb$vintage_date_publication[[1L]]))
  building_manifest$building_count_parity <- list(
    snapshot=as.integer(nb_row$value[[1L]]),
    ramp=as.integer(unique(ramp$total_buildings[ramp$territory_id==building_territory & ramp$territory_type=="commune"])),
    grid=as.integer(unique(grid$total_buildings[grid$territory_id==building_territory & grid$territory_type=="commune"])))
  building_manifest_path <- tempfile("building-fiche-http-",fileext=".json")
  jsonlite::write_json(building_manifest,building_manifest_path,auto_unbox=TRUE,null="null",digits=NA)
  focal <- DBI::dbGetQuery(con, "SELECT indicator_id,territory_id,value,status,support_count,denominator_count FROM scalar_observation WHERE indicator_id='eco_activites' AND territory_type='commune' AND territory_id='35238'")
  stopifnot(nrow(focal)==1L)
  DBI::dbExecute(con, paste0("GRANT USAGE ON SCHEMA ", DBI::dbQuoteIdentifier(con, schema),
    " TO ", DBI::dbQuoteIdentifier(con, read_user)))
  DBI::dbExecute(con, paste0("GRANT SELECT ON ALL TABLES IN SCHEMA ", DBI::dbQuoteIdentifier(con, schema),
    " TO ", DBI::dbQuoteIdentifier(con, read_user)))
  keys <- c("LUSK_HOUSING_HTTP_SCHEMA", "LUSK_HOUSING_HTTP_TERRITORY", "LUSK_HOUSING_HTTP_MANIFEST", "LUSK_HOUSING_PRICE_MANIFEST",
    "LUSK_BUILDING_FICHE_HTTP_SCHEMA", "LUSK_BUILDING_FICHE_HTTP_TERRITORY", "LUSK_BUILDING_FICHE_HTTP_MANIFEST", "PYTHONPATH")
  old <- Sys.getenv(keys, unset=NA_character_)
  on.exit(for (i in seq_along(keys)) if (is.na(old[[i]])) Sys.unsetenv(keys[[i]]) else
    do.call(Sys.setenv, setNames(list(old[[i]]), keys[[i]])), add=TRUE)
  Sys.setenv(LUSK_HOUSING_HTTP_SCHEMA=schema, LUSK_HOUSING_HTTP_TERRITORY="35238",
    LUSK_HOUSING_HTTP_MANIFEST=manifest_path, LUSK_HOUSING_PRICE_MANIFEST=price_manifest_path,
    LUSK_BUILDING_FICHE_HTTP_SCHEMA=schema,LUSK_BUILDING_FICHE_HTTP_TERRITORY=building_territory,
    LUSK_BUILDING_FICHE_HTTP_MANIFEST=building_manifest_path,
    PYTHONPATH=normalizePath("..", winslash="/", mustWork=TRUE))
  status <- system2(Sys.which("python"), c("-m", "pytest", "-q",
    shQuote(normalizePath("../api/tests/integration/test_housing_economy_publisher_http.py", winslash="/", mustWork=TRUE), type="cmd")),
    stdout="", stderr="")
  if (!identical(status, 0L)) stop("Canonical economy publisher-to-HTTP parity failed", call.=FALSE)
  building_http_test <- normalizePath("../api/tests/integration/test_building_fiche_publisher_http.py", winslash="/", mustWork=TRUE)
  building_http_status <- system2(Sys.which("python"), c("-m","pytest","-q",shQuote(building_http_test,type="cmd")),stdout="",stderr="")
  if (!identical(building_http_status,0L)) stop("Canonical building publisher-to-fiche HTTP parity failed",call.=FALSE)
  housing_test <- normalizePath("../api/tests/integration/test_canonical_housing_publisher_http.py", winslash="/", mustWork=TRUE)
  housing_status <- system2(Sys.which("python"), c("-m", "pytest", "-q",
    shQuote(housing_test, type="cmd")), stdout="", stderr="")
  if (!identical(housing_status, 0L)) stop("Canonical housing publisher-to-HTTP parity failed", call.=FALSE)
  housing_counts <- vapply(expected_profiles, function(p) nrow(p$facts), integer(1))
  housing_levels <- vapply(expected_profiles, function(p) length(unique(p$facts$territory_type)), integer(1))
  names(housing_counts) <- housing_ids
  names(housing_levels) <- housing_ids
  cat("Canonical economy selected readings:",nrow(expected_reading)," and sparse ordered activity facts:",nrow(expected_evidence),
    "; registered R publisher/SQL parity plus public theme-facts HTTP assertion: PASS\n",
    "Canonical housing SQL rows:", paste(names(housing_counts), housing_counts, sep="=", collapse=", "),
    "\nHTTP focal levels per profile:", paste(names(housing_levels), housing_levels, sep="=", collapse=", "),
    "\nCanonical building publisher rows: reference=", nrow(inputs$tables$territory_reference),
    " ramp=", nrow(inputs$tables$building_ramp), " grid=", nrow(inputs$tables$building_grid),
    "\nRennes 35238 building-count parity: nb_buildings=", building_manifest$building_count_parity$snapshot,
    " ramp denominator=", building_manifest$building_count_parity$ramp,
    " grid denominator=", building_manifest$building_count_parity$grid,
    "; density-class peer curves=", peer_ramp$member_count,
    " peers / ", peer_ramp$total_buildings, " ramp buildings; pooled grid=",
    peer_grid$total_buildings, " buildings, ", length(peer_grid$cells), " cells",
    "\nRegistered profile snapshot (10 profiles), all four housing profiles PostgreSQL/HTTP parity, all 45 scalar descriptors and every observation/status/source link preserved against the canonical snapshot, pooled prix_m2 Habitat facts at four levels including suppression, empty/singleton/overlap comparison HTTP parity, essential-service denominator parity, and canonical building publisher-to-theme HTTP parity: PASS\n", sep="")
}, finally={
  if (exists("manifest_path") && file.exists(manifest_path)) unlink(manifest_path)
  if (exists("price_manifest_path") && file.exists(price_manifest_path)) unlink(price_manifest_path)
  if (exists("building_manifest_path") && file.exists(building_manifest_path)) unlink(building_manifest_path)
  if (created) cleanup_serving_smoke_schema(con, schema, "profile")
  DBI::dbDisconnect(con)
})
