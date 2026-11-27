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
canonical_dir <- Sys.getenv("LUSK_REFERENCE_TEST_CANONICAL_DIR", unset="")
if (!nzchar(canonical_dir)) canonical_dir <- file.path("..", "public", "data")
territories <- nanoparquet::read_parquet(file.path(canonical_dir, "territoires.parquet"))
projection <- project_territory_reference(territories)
adapter <- territory_reference_postgres_adapter(con)
first <- publish_territory_reference_projection(projection, adapter)
second <- publish_territory_reference_projection(projection, adapter)
stopifnot(isTRUE(first$changed), !isTRUE(second$changed), !isTRUE(second$rebound))
marker <- DBI::dbGetQuery(con, "SELECT content_version,row_count,reference_content_version FROM table_publication WHERE table_name='territory_reference'")
actual <- DBI::dbGetQuery(con, "SELECT territory_id,territory_type,name FROM territory_reference ORDER BY territory_type,territory_id")
stopifnot(nrow(marker)==1L, marker$row_count[[1L]]==nrow(territories),
  marker$content_version[[1L]]==projection$content_version,
  marker$reference_content_version[[1L]]==projection$content_version,
  nrow(actual)==nrow(territories),
  all(is.na(DBI::dbGetQuery(con, "SELECT to_regclass('service_registry') AS x")$x)))
DBI::dbDisconnect(con)
cat("retained territory reference published/no-op retried against fresh schema\n")
