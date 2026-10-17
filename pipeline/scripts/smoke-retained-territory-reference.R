#!/usr/bin/env Rscript
# Guarded DBI proof for the retained territory-reference publisher.
pkgload::load_all(".", quiet=TRUE)
keys <- c("HOST", "PORT", "DATABASE", "USER", "SCHEMA")
config <- setNames(lapply(keys, function(key)
  Sys.getenv(paste0("LUSK_REFERENCE_TEST_", key), unset="")), keys)
if (!all(vapply(config, nzchar, logical(1))) ||
    !grepl("^lusk_it_[A-Za-z0-9_]+$", config$DATABASE) ||
    !grepl("^it_[A-Za-z0-9_]+$", config$SCHEMA) ||
    !grepl("^[A-Za-z0-9_.:-]+$", config$HOST) || !grepl("^[0-9]+$", config$PORT))
  stop("Explicit guarded lusk_it_* reference-test configuration is required", call.=FALSE)
passfile <- Sys.getenv("PGPASSFILE", unset="")
if (!nzchar(passfile) || !file.exists(passfile) ||
    startsWith(tolower(normalizePath(passfile, winslash="/")),
      tolower(normalizePath("..", winslash="/"))))
  stop("PGPASSFILE must be private and outside the checkout", call.=FALSE)

con <- DBI::dbConnect(RPostgres::Postgres(), host=config$HOST,
  port=as.integer(config$PORT), dbname=config$DATABASE, user=config$USER)
DBI::dbExecute(con, paste0("SET search_path TO ",
  as.character(DBI::dbQuoteIdentifier(con, config$SCHEMA))))
canonical_dir <- file.path("..", "public", "data")
territories <- nanoparquet::read_parquet(file.path(canonical_dir, "territoires.parquet"))
projection <- project_territory_reference(territories)
adapter <- territory_reference_postgres_adapter(con)
first <- publish_territory_reference_projection(projection, adapter)
second <- publish_territory_reference_projection(projection, adapter)
stopifnot(isTRUE(first$changed), !isTRUE(second$changed), !isTRUE(second$rebound))
artifact_dir <- tempfile("retained-scalar-artifacts-"); dir.create(artifact_dir)
vintages <- nanoparquet::read_parquet(file.path(canonical_dir, "vintages.parquet"))
for (owner in retained_scalar_artifact_owners()) {
  canonical <- list(indicateurs=lire_indicateurs_commis(owner, canonical_dir),
    territoires=nanoparquet::read_parquet(file.path(canonical_dir, "territoires.parquet")))
  owner_metadata <- jsonlite::fromJSON(file.path(canonical_dir,
    paste0("theme_", owner, ".json")), simplifyVector=FALSE)
  materialize_theme_scalar_artifact(canonical, owner_metadata, vintages, owner, artifact_dir)
}
snapshot <- project_retained_scalar_snapshot(canonical_dir, projection, artifact_dir)
published <- publish_retained_scalar_snapshot(con, snapshot, artifact_dir)
retried <- publish_retained_scalar_snapshot(con, snapshot, artifact_dir)
stopifnot(isTRUE(published$scalar$changed), isTRUE(published$comparison$changed),
  !isTRUE(retried$scalar$changed), !isTRUE(retried$comparison$changed))
marker <- DBI::dbGetQuery(con, "SELECT content_version,row_count,reference_content_version FROM table_publication WHERE table_name='territory_reference'")
actual <- DBI::dbGetQuery(con, "SELECT territory_id,territory_type,name FROM territory_reference ORDER BY territory_type,territory_id")
scalar_marker <- DBI::dbGetQuery(con, "SELECT content_version,row_count,reference_content_version FROM table_publication WHERE table_name='scalar_observation'")
scalar_descriptors <- DBI::dbGetQuery(con, "SELECT indicator_id FROM scalar_descriptor ORDER BY indicator_id")$indicator_id
comparison_marker <- DBI::dbGetQuery(con, "SELECT content_version,scalar_content_version,reference_content_version,group_row_count,territory_row_count FROM scalar_comparison_publication WHERE singleton")
stopifnot(nrow(marker)==1L, marker$row_count[[1L]]==nrow(territories),
  marker$content_version[[1L]]==projection$content_version,
  marker$reference_content_version[[1L]]==projection$content_version,
  nrow(scalar_marker)==1L, scalar_marker$row_count[[1L]]==nrow(snapshot$scalar$facts),
  scalar_marker$content_version[[1L]]==scalar_content_version(snapshot$scalar),
  scalar_marker$reference_content_version[[1L]]==projection$content_version,
  setequal(scalar_descriptors, snapshot$scalar$descriptors$indicator_id),
  !any(grepl("^(share_|iso_|nb_buildings|tot_loss|avg_div|avg_tot)", scalar_descriptors)),
  nrow(comparison_marker)==1L,
  comparison_marker$content_version[[1L]]==snapshot$comparison$content_version,
  comparison_marker$reference_content_version[[1L]]==projection$content_version,
  comparison_marker$scalar_content_version[[1L]]==scalar_content_version(snapshot$scalar),
  comparison_marker$group_row_count[[1L]]==nrow(snapshot$comparison$groups),
  comparison_marker$territory_row_count[[1L]]==nrow(snapshot$comparison$territories),
  nrow(actual)==nrow(territories),
  all(is.na(DBI::dbGetQuery(con, "SELECT to_regclass('service_registry') AS x")$x)))
unlink(artifact_dir, recursive=TRUE)
DBI::dbDisconnect(con)
cat("retained territory reference, exact scalar facts and comparison published/no-op retried against fresh schema\n")
