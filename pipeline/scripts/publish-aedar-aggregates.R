#!/usr/bin/env Rscript
pkgload::load_all(".",quiet=TRUE)
args <- commandArgs(trailingOnly=TRUE)
if (length(args)!=1L || !args[[1]] %in% c("--check","--publish","--full-vintage"))
  stop("Usage: Rscript scripts/publish-aedar-aggregates.R --check|--publish|--full-vintage (from pipeline/)",call.=FALSE)
canonical_dir <- Sys.getenv("LUSK_AEDAR_CANONICAL_DIR",file.path("data","processed","aedar"))
# Operator sequence: --check acquires, validates, and atomically materializes the
# canonical facts + source Parquets. --publish reads only those artifacts, so a
# database outage can be retried without re-acquiring or silently changing input.
# This explicit command is intentionally not called by the cron/static pipeline.
canonical_facts <- file.exists(file.path(canonical_dir,"aedar_territorial_aggregate.parquet")) &&
  file.exists(file.path(canonical_dir,"aedar_territorial_aggregate_source.parquet"))
if (args[[1]]=="--publish") {
  if (!canonical_facts)
    stop("Canonical AEDAR Parquets are missing; run --check first. This keeps a DB retry independent of source acquisition.",call.=FALSE)
  projection <- read_aedar_canonical(canonical_dir)
} else {
  projection <- read_aedar_aggregate_projection()
  write_aedar_canonical(projection,canonical_dir)
  # Publish always consumes the materialized/validated Parquet representation.
  projection <- read_aedar_canonical(canonical_dir)
}
if (args[[1]]=="--full-vintage") {
  for (level in AEDAR_AGGREGATE_LEVELS) {
    x <- projection$facts[projection$facts$territory_type==level,,drop=FALSE]
    groups <- split(x$TYPEQU,x$territory_id)
    if (length(unique(vapply(groups,function(g) paste(sort(g),collapse="|"),character(1))))!=1L)
      stop(paste("Non-dense territory × TYPEQU coverage:",level),call.=FALSE)
    cat(level,nrow(x),"facts",length(groups),"territories",length(unique(x$TYPEQU)),"TYPEQU\n")
  }
} else cat("Validated AEDAR source aggregates:",nrow(projection$facts),"facts, 312 measures\n")
if (args[[1]]=="--publish") {
  if (!identical(Sys.getenv("LUSK_PUBLISH_AEDAR"),"1") || identical(Sys.getenv("LUSK_MODE"),"cron"))
    stop("AEDAR Postgres publication requires explicit LUSK_PUBLISH_AEDAR=1 and is disabled for cron",call.=FALSE)
  con <- do.call(DBI::dbConnect,c(list(drv=RPostgres::Postgres()),configuration_service_postgres()))
  result <- tryCatch(publish_aedar_aggregates(projection,con),finally=DBI::dbDisconnect(con))
  cat(if (result$changed) "Published" else "No change; publication already current",result$row_count,"rows; version",result$content_version,"\n")
}
