#!/usr/bin/env Rscript
# Synthetic scalar/profile comparison lineage publisher proof. The caller owns
# and schema-scopes the disposable lusk_it_* test schema and its read grant.
pkgload::load_all(".", quiet=TRUE)

required <- c("HOST", "PORT", "DATABASE", "USER", "SCHEMA", "MANIFEST")
config <- setNames(lapply(required, function(key)
  Sys.getenv(paste0("LUSK_LINEAGE_TEST_", key), unset="")), required)
if (!all(vapply(config, nzchar, logical(1))) ||
    !grepl("^lusk_it_[A-Za-z0-9_]+$", config$DATABASE) ||
    !grepl("^it_[A-Za-z0-9_]+$", config$SCHEMA) ||
    !grepl("^[A-Za-z0-9_.:-]+$", config$HOST) || !grepl("^[0-9]+$", config$PORT))
  stop("Explicit guarded lusk_it_* lineage test configuration is required", call.=FALSE)
passfile <- Sys.getenv("PGPASSFILE", unset="")
if (!nzchar(passfile) || !file.exists(passfile) ||
    startsWith(tolower(normalizePath(passfile, winslash="/")),
      tolower(normalizePath("..", winslash="/"))))
  stop("PGPASSFILE must point to the private operator passfile outside the checkout", call.=FALSE)

con <- DBI::dbConnect(RPostgres::Postgres(), host=config$HOST,
  port=as.integer(config$PORT), dbname=config$DATABASE, user=config$USER)
DBI::dbExecute(con, paste0("SET search_path TO ", as.character(DBI::dbQuoteIdentifier(con, config$SCHEMA))))
stopifnot(DBI::dbGetQuery(con, "SELECT current_database() AS db")$db[[1L]] == config$DATABASE)

fixture <- readr::read_csv("tests/testthat/fixtures/demographie-fixture.csv",
  col_types=readr::cols(code=readr::col_character(), epci=readr::col_character()),
  show_col_types=FALSE)
payload <- compute_payload(fixture)
metadata <- jsonlite::fromJSON("inst/extdata/theme-metadata/theme_demographie.json",
  simplifyVector=FALSE)
scalar_projection <- project_fixture_scalar(payload, metadata, "dense_complete")
# This test fixture's scalar projector intentionally defaults to a non-comparable
# descriptor. Declare the test comparison facet explicitly at its owner seam.
scalar_projection$descriptors$direction[[1L]] <- "high"
scalar_projection$descriptors$comparison_facet[[1L]] <- scalar_projection$descriptors$indicator_id[[1L]]
sparse_descriptor <- scalar_projection$descriptors[1L, , drop=FALSE]
sparse_descriptor$indicator_id <- "lineage_sparse"
sparse_descriptor$label <- "Sparse comparison fixture"
sparse_descriptor$descriptor_version <- "lineage-sparse-v1"
sparse_descriptor$completeness <- "sparse"
sparse_descriptor$comparison_facet <- "lineage_sparse"
scalar_projection$descriptors <- rbind(scalar_projection$descriptors, sparse_descriptor)
scalar_projection$facts <- scalar_projection$facts[scalar_projection$facts$indicator_id !=
  "lineage_sparse", , drop=FALSE]
profile_projection <- project_structure_age_profile(payload, metadata)
stopifnot(setequal(paste(scalar_projection$eligible_territories$territory_type,
    scalar_projection$eligible_territories$territory_id),
  paste(profile_projection$eligible_territories$territory_type,
    profile_projection$eligible_territories$territory_id)))

reference <- scalar_projection$eligible_territories
is_commune <- reference$territory_type == "commune"
reference$name <- reference$territory_id
reference$department_id <- NA_character_
reference$epci_id <- ifelse(is_commune, "E_TEST", NA_character_)
reference$density_class_code <- ifelse(is_commune, "D_TEST", NA_character_)
reference$density_class_label <- ifelse(is_commune, "Test density class", NA_character_)
region <- payload$territoires[payload$territoires$type == "region", , drop=FALSE]
stopifnot(nrow(region) == 1L)
reference <- rbind(reference, data.frame(territory_id=as.character(region$territoire[[1L]]),
  territory_type="region", name=as.character(region$nom[[1L]]), department_id=NA_character_,
  epci_id=NA_character_, density_class_code=NA_character_, density_class_label=NA_character_))
DBI::dbWriteTable(con, "territory_reference", reference, append=TRUE, row.names=FALSE)
reference_version <- "lineage-reference-v1"
DBI::dbExecute(con, "INSERT INTO table_publication(table_name,content_version,row_count) VALUES('territory_reference',$1,$2)",
  params=list(reference_version, nrow(reference)))

scalar_registry <- register_scalar_publisher(list(), "lineage_fixture",
  function(canonical) scalar_projection,
  function(projection, db, version) db$replace(projection, version))
scalar_adapter <- scalar_postgres_adapter(con)
scalar_publish <- publish_registered_scalar(scalar_registry, "lineage_fixture", payload, scalar_adapter)
stopifnot(scalar_publish$changed)
scalar_marker <- DBI::dbGetQuery(con,
  "SELECT content_version FROM table_publication WHERE table_name='scalar_observation'")$content_version[[1L]]
scalar_comparisons <- project_scalar_comparisons(scalar_projection, reference,
  scalar_marker, reference_version)
scalar_comparison_adapter <- scalar_comparison_postgres_adapter(con)
scalar_comparison_publish <- publish_registered_scalar_comparison(
  scalar_comparisons, scalar_comparison_adapter)
stopifnot(scalar_comparison_publish$changed)

scalar_lineage_query <- "SELECT comparison_context,group_id,territory_type,facet_id,source_id,vintage_id,comparison_content_version FROM comparison_source_lineage WHERE comparison_family='scalar' ORDER BY comparison_context,group_id,territory_type,facet_id,source_id,vintage_id"
scalar_lineage_before <- DBI::dbGetQuery(con, scalar_lineage_query)
expected_scalar <- scalar_comparisons$lineage
expected_scalar$comparison_content_version <- scalar_comparisons$content_version
expected_scalar <- expected_scalar[order(expected_scalar$comparison_context, expected_scalar$group_id,
  expected_scalar$territory_type, expected_scalar$facet_id, expected_scalar$source_id,
  expected_scalar$vintage_id), names(scalar_lineage_before), drop=FALSE]
rownames(scalar_lineage_before) <- rownames(expected_scalar) <- NULL
stopifnot(identical(scalar_lineage_before, expected_scalar))
scalar_counts <- DBI::dbGetQuery(con, "SELECT p.group_row_count,p.territory_row_count,p.lineage_row_count,(SELECT count(*) FROM scalar_comparison_group) AS actual_groups,(SELECT count(*) FROM scalar_comparison_territory) AS actual_territories,(SELECT count(*) FROM comparison_source_lineage WHERE comparison_family='scalar') AS actual_lineage FROM scalar_comparison_publication p WHERE singleton")
stopifnot(identical(as.integer(unlist(scalar_counts[1L, 1:3])),
  as.integer(c(nrow(scalar_comparisons$groups), nrow(scalar_comparisons$territories),
    nrow(scalar_comparisons$lineage)))))
bad_scalar_counts <- DBI::dbGetQuery(con, "SELECT count(*) AS n FROM scalar_comparison_group g WHERE g.lineage_source_count<>(SELECT count(*) FROM comparison_source_lineage l WHERE l.comparison_family='scalar' AND (l.comparison_context,l.group_id,l.territory_type,l.facet_id)=(g.comparison_context,g.group_id,g.territory_type,g.indicator_id))")$n[[1L]]
stopifnot(bad_scalar_counts == 0L)
scalar_noop <- publish_registered_scalar_comparison(scalar_comparisons, scalar_comparison_adapter)
stopifnot(!scalar_noop$changed)

profile_registry <- register_structure_age_profile_publisher(list(), metadata)
profile_adapter <- profile_postgres_adapter(con)
profile_publish <- publish_registered_profile(profile_registry, "structure_age", payload, profile_adapter)
stopifnot(profile_publish$changed)
profile_marker <- DBI::dbGetQuery(con, "SELECT content_version FROM profile_comparison_publication WHERE singleton")$content_version[[1L]]
profile_lineage_query <- "SELECT comparison_context,group_id,territory_type,facet_id,source_id,vintage_id,comparison_content_version FROM comparison_source_lineage WHERE comparison_family='profile' ORDER BY comparison_context,group_id,territory_type,facet_id,source_id,vintage_id"
profile_lineage_before <- DBI::dbGetQuery(con, profile_lineage_query)
profile_comparisons <- profile_adapter$prepare_comparisons(list(profile_projection),
  profile_publish$content_version, reference_version)$projection
expected_profile <- profile_comparisons$lineage
expected_profile$comparison_content_version <- profile_marker
expected_profile$comparison_family <- "profile"
expected_profile <- expected_profile[c("comparison_context","group_id","territory_type",
  "facet_id","source_id","vintage_id","comparison_content_version")]
expected_profile <- expected_profile[order(expected_profile$comparison_context, expected_profile$group_id,
  expected_profile$territory_type, expected_profile$facet_id, expected_profile$source_id,
  expected_profile$vintage_id), names(profile_lineage_before), drop=FALSE]
rownames(profile_lineage_before) <- rownames(expected_profile) <- NULL
stopifnot(identical(profile_lineage_before, expected_profile))
profile_counts <- DBI::dbGetQuery(con, "SELECT p.group_row_count,p.territory_row_count,(SELECT count(*) FROM profile_comparison_group) AS actual_groups,(SELECT count(*) FROM profile_comparison_territory) AS actual_territories FROM profile_comparison_publication p WHERE singleton")
stopifnot(identical(as.integer(unlist(profile_counts[1L, 1:2])),
  as.integer(c(nrow(profile_comparisons$groups), nrow(profile_comparisons$territories)))))
bad_profile_counts <- DBI::dbGetQuery(con, "SELECT count(*) AS n FROM profile_comparison_group g WHERE g.lineage_source_count<>(SELECT count(*) FROM comparison_source_lineage l WHERE l.comparison_family='profile' AND (l.comparison_context,l.group_id,l.territory_type,l.facet_id)=(g.comparison_context,g.group_id,g.territory_type,g.indicator_id))")$n[[1L]]
stopifnot(bad_profile_counts == 0L)
profile_noop <- publish_registered_profile(profile_registry, "structure_age", payload, profile_adapter)
stopifnot(!profile_noop$changed)

# Rebind the reference dependency to force a scalar-comparison refresh without
# replacing descriptors still referenced by the last complete comparison.
DBI::dbExecute(con, "UPDATE table_publication SET content_version='lineage-reference-v2' WHERE table_name='territory_reference'")
DBI::dbExecute(con, "UPDATE table_publication SET reference_content_version='lineage-reference-v2' WHERE table_name='scalar_observation'")
new_scalar_marker <- scalar_marker
new_scalar_comparisons <- project_scalar_comparisons(scalar_projection, reference,
  new_scalar_marker, "lineage-reference-v2")
old_scalar_groups <- DBI::dbGetQuery(con, "SELECT * FROM scalar_comparison_group ORDER BY comparison_context,group_id,territory_type,indicator_id")
old_scalar_territories <- DBI::dbGetQuery(con, "SELECT * FROM scalar_comparison_territory ORDER BY comparison_context,group_id,territory_type,indicator_id,territory_id")
old_scalar_marker <- DBI::dbGetQuery(con, "SELECT * FROM scalar_comparison_publication WHERE singleton")
DBI::dbExecute(con, "CREATE FUNCTION reject_lineage_refresh() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.comparison_family='scalar' THEN RAISE EXCEPTION 'injected lineage refresh failure'; END IF; RETURN NEW; END $$")
DBI::dbExecute(con, "CREATE TRIGGER reject_lineage_refresh BEFORE INSERT ON comparison_source_lineage FOR EACH ROW EXECUTE FUNCTION reject_lineage_refresh()")
failed_scalar <- try(publish_registered_scalar_comparison(new_scalar_comparisons, scalar_comparison_adapter), silent=TRUE)
stopifnot(inherits(failed_scalar, "try-error"),
  identical(DBI::dbGetQuery(con, "SELECT * FROM scalar_comparison_group ORDER BY comparison_context,group_id,territory_type,indicator_id"), old_scalar_groups),
  identical(DBI::dbGetQuery(con, "SELECT * FROM scalar_comparison_territory ORDER BY comparison_context,group_id,territory_type,indicator_id,territory_id"), old_scalar_territories),
  identical(DBI::dbGetQuery(con, scalar_lineage_query), scalar_lineage_before),
  identical(DBI::dbGetQuery(con, "SELECT * FROM scalar_comparison_publication WHERE singleton"), old_scalar_marker))
DBI::dbExecute(con, "DROP TRIGGER reject_lineage_refresh ON comparison_source_lineage")
DBI::dbExecute(con, "DROP FUNCTION reject_lineage_refresh()")
scalar_retry <- publish_registered_scalar_comparison(new_scalar_comparisons, scalar_comparison_adapter)
stopifnot(scalar_retry$changed)

# An injected profile lineage failure during the same reference rebind must
# lineage failure must roll back profile facts, both comparison grains, lineage
# and marker together; an unchanged retry then commits the complete snapshot.
old_profile_facts <- DBI::dbGetQuery(con, "SELECT * FROM profile_observation ORDER BY indicator_id,territory_type,territory_id,detail_key,sex_key")
old_profile_groups <- DBI::dbGetQuery(con, "SELECT * FROM profile_comparison_group ORDER BY comparison_context,group_id,territory_type,indicator_id,detail_key,sex_key")
old_profile_territories <- DBI::dbGetQuery(con, "SELECT * FROM profile_comparison_territory ORDER BY comparison_context,group_id,territory_type,indicator_id,detail_key,sex_key,territory_id")
old_profile_marker <- DBI::dbGetQuery(con, "SELECT * FROM profile_comparison_publication WHERE singleton")
DBI::dbExecute(con, "CREATE FUNCTION reject_profile_lineage_refresh() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.comparison_family='profile' THEN RAISE EXCEPTION 'injected profile lineage refresh failure'; END IF; RETURN NEW; END $$")
DBI::dbExecute(con, "CREATE TRIGGER reject_profile_lineage_refresh BEFORE INSERT ON comparison_source_lineage FOR EACH ROW EXECUTE FUNCTION reject_profile_lineage_refresh()")
failed_profile <- try(publish_registered_profile(profile_registry, "structure_age", payload, profile_adapter), silent=TRUE)
stopifnot(inherits(failed_profile, "try-error"),
  identical(DBI::dbGetQuery(con, "SELECT * FROM profile_observation ORDER BY indicator_id,territory_type,territory_id,detail_key,sex_key"), old_profile_facts),
  identical(DBI::dbGetQuery(con, "SELECT * FROM profile_comparison_group ORDER BY comparison_context,group_id,territory_type,indicator_id,detail_key,sex_key"), old_profile_groups),
  identical(DBI::dbGetQuery(con, "SELECT * FROM profile_comparison_territory ORDER BY comparison_context,group_id,territory_type,indicator_id,detail_key,sex_key,territory_id"), old_profile_territories),
  identical(DBI::dbGetQuery(con, profile_lineage_query), profile_lineage_before),
  identical(DBI::dbGetQuery(con, "SELECT * FROM profile_comparison_publication WHERE singleton"), old_profile_marker))
DBI::dbExecute(con, "DROP TRIGGER reject_profile_lineage_refresh ON comparison_source_lineage")
DBI::dbExecute(con, "DROP FUNCTION reject_profile_lineage_refresh()")
profile_retry <- publish_registered_profile(profile_registry, "structure_age", payload, profile_adapter)
stopifnot(profile_retry$changed)

# A tiny real owned-series publisher proves per-axis lineage (including mixed
# vintages) through the same R adapter and transaction used in production.
series_reference <- DBI::dbGetQuery(con,"SELECT territory_id,territory_type FROM territory_reference
  WHERE territory_type IN ('commune','epci','departement','region') ORDER BY
  CASE territory_type WHEN 'commune' THEN 1 WHEN 'epci' THEN 2 WHEN 'departement' THEN 3 ELSE 4 END,
  territory_id")
if (!nrow(series_reference)) stop("Synthetic series fixture needs a registered territory",call.=FALSE)
series_level <- as.character(series_reference$territory_type[[1L]])
series_members <- head(as.character(series_reference$territory_id[series_reference$territory_type==series_level]),3L)
series_dataset <- "lineage_series"
series_indicator <- "lineage_series"
series_axes <- c("2024","2025")
series_rows <- expand.grid(territory_id=series_members,axis_value=series_axes,
  stringsAsFactors=FALSE)
series_rows$dataset_id <- series_dataset; series_rows$indicator_id <- series_indicator
series_rows$territory_type <- series_level; series_rows$observation_period <- series_rows$axis_value
series_rows$value <- seq_len(nrow(series_rows))/10; series_rows$status <- "measured"
series_rows <- series_rows[c("dataset_id","indicator_id","territory_id","territory_type",
  "axis_value","observation_period","value","status")]
series_rows <- series_rows[order(series_rows$territory_id,series_rows$axis_value),]
revision_specs <- unique(data.frame(source_id=ifelse(series_rows$axis_value=="2024","fixture_a","fixture_b"),
  vintage_id=ifelse(series_rows$territory_id==series_members[[1L]],"v1","v2"),stringsAsFactors=FALSE))
revision_specs$source_name <- paste("Fixture",revision_specs$source_id)
revision_specs$dataset_name <- "Synthetic ordered-series fixture"
revision_specs$source_version <- revision_specs$vintage_id
revision_specs$reference_date <- as.Date("2026-01-01")
revision_specs$publication_date <- as.Date("2026-01-02")
revision_specs$revision_hash <- vapply(seq_len(nrow(revision_specs)),function(i) series_revision_hash(
  revision_specs$source_id[[i]],revision_specs$vintage_id[[i]],revision_specs$source_name[[i]],
  revision_specs$dataset_name[[i]],revision_specs$source_version[[i]],
  as.character(revision_specs$reference_date[[i]]),as.character(revision_specs$publication_date[[i]])),character(1))
revision_specs$provenance_revision_id <- paste0(revision_specs$source_id,"-",revision_specs$vintage_id,"-",
  substr(revision_specs$revision_hash,1L,16L))
series_links <- data.frame(dataset_id=series_dataset,indicator_id=series_indicator,
  territory_id=series_rows$territory_id,axis_value=series_rows$axis_value,
  provenance_revision_id=revision_specs$provenance_revision_id[match(
    paste(ifelse(series_rows$axis_value=="2024","fixture_a","fixture_b"),
      ifelse(series_rows$territory_id==series_members[[1L]],"v1","v2")),
    paste(revision_specs$source_id,revision_specs$vintage_id))],stringsAsFactors=FALSE)
series_projection <- list(points=series_rows,provenance=revision_specs,point_provenance=series_links,
  descriptor=list(dataset_id=series_dataset,indicator_id=series_indicator,theme_id="demographie",
    axis_kind="year",axis_values=series_axes,comparison_axis_values=series_axes,
    completeness="dense_complete",comparison_point="2025",label="Fixture series",unit="u",
    direction="high",allowed_levels=series_level,comparison_levels=series_level,
    comparison_statistic="median",comparison_scope="default_group",descriptor_version="fixture-v1",
    active_read_route=TRUE))
validate_owned_series_projection(series_projection)
series_adapter <- owned_series_postgres_adapter(con)
series_registry <- list(lineage_series=list(owned=TRUE,project=function(canonical) canonical))
series_first <- publish_registered_series(series_registry,"lineage_series",series_projection,series_adapter)
series_noop <- publish_registered_series(series_registry,"lineage_series",series_projection,series_adapter)
stopifnot(series_first$changed,!series_noop$changed)
series_comparison <- project_ordered_series_comparisons(series_projection,reference,
  series_first$content_version,reference_version)
old_series_marker <- DBI::dbGetQuery(con,"SELECT content_version,ordered_series_content_version,
  reference_content_version,group_row_count,territory_row_count,comparison_axes
  FROM ordered_series_comparison_publication WHERE dataset_id=$1",params=list(series_dataset))
old_series_groups <- DBI::dbGetQuery(con,"SELECT * FROM ordered_series_comparison_group WHERE dataset_id=$1 ORDER BY comparison_context,group_id,territory_type,axis_value",params=list(series_dataset))
DBI::dbExecute(con,"CREATE FUNCTION reject_series_lineage_refresh() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected ordered-series lineage failure'; END $$")
DBI::dbExecute(con,"CREATE TRIGGER reject_series_lineage_refresh BEFORE INSERT ON ordered_series_comparison_lineage FOR EACH ROW EXECUTE FUNCTION reject_series_lineage_refresh()")
changed_series <- series_projection; changed_series$points$value <- changed_series$points$value+0.25
changed_registry <- list(lineage_series=list(owned=TRUE,project=function(canonical) changed_series))
series_failed <- try(publish_registered_series(changed_registry,"lineage_series",NULL,series_adapter),silent=TRUE)
stopifnot(inherits(series_failed,"try-error"),
  identical(DBI::dbGetQuery(con,"SELECT content_version,ordered_series_content_version,
    reference_content_version,group_row_count,territory_row_count,comparison_axes
    FROM ordered_series_comparison_publication WHERE dataset_id=$1",params=list(series_dataset)),old_series_marker),
  identical(DBI::dbGetQuery(con,"SELECT * FROM ordered_series_comparison_group WHERE dataset_id=$1 ORDER BY comparison_context,group_id,territory_type,axis_value",params=list(series_dataset)),old_series_groups))
DBI::dbExecute(con,"DROP TRIGGER reject_series_lineage_refresh ON ordered_series_comparison_lineage")
DBI::dbExecute(con,"DROP FUNCTION reject_series_lineage_refresh()")
series_retry <- publish_registered_series(changed_registry,"lineage_series",NULL,series_adapter)
stopifnot(series_retry$changed)
series_lineage <- DBI::dbGetQuery(con,"SELECT comparison_context,group_id,territory_type,axis_value,provenance_revision_id FROM ordered_series_comparison_lineage WHERE dataset_id=$1 ORDER BY comparison_context,group_id,territory_type,axis_value,provenance_revision_id",params=list(series_dataset))
series_sources <- DBI::dbGetQuery(con,"SELECT DISTINCT l.axis_value,p.source_id,p.vintage_id FROM ordered_series_comparison_lineage l JOIN series_provenance_revision p USING(provenance_revision_id) WHERE l.dataset_id=$1 ORDER BY l.axis_value,p.source_id,p.vintage_id",params=list(series_dataset))

manifest <- list(
  schema=config$SCHEMA,
  scalar=list(content_version=DBI::dbGetQuery(con,
      "SELECT content_version FROM scalar_comparison_publication WHERE singleton")$content_version[[1L]],
    source_pairs=unique(scalar_comparisons$lineage[c("facet_id","source_id","vintage_id")])),
  profile=list(content_version=DBI::dbGetQuery(con,
      "SELECT content_version FROM profile_comparison_publication WHERE singleton")$content_version[[1L]],
    source_pairs=unique(profile_comparisons$lineage[c("facet_id","source_id","vintage_id")])),
  ordered_series=list(dataset_id=series_dataset,indicator_id=series_indicator,
    content_version=series_retry$content_version,axes=series_axes,
    level=series_level,territory_id=series_members[[1L]],source_pairs=series_sources,
    comparison_context=as.character(series_lineage$comparison_context[[1L]]),
    group_id=as.character(series_lineage$group_id[[1L]]))
)
jsonlite::write_json(manifest, config$MANIFEST, auto_unbox=TRUE, pretty=TRUE, dataframe="rows")
cat("synthetic R scalar/profile comparison publishers passed; schema:", config$SCHEMA, "\n")
