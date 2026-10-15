#!/usr/bin/env Rscript
pkgload::load_all(".",quiet=TRUE)
args <- commandArgs(trailingOnly=TRUE)
if (length(args)!=1L || !args[[1]] %in% c("--check","--publish","--full-vintage"))
  stop("Usage: Rscript scripts/publish-aedar-aggregates.R --check|--publish|--full-vintage (from pipeline/)",call.=FALSE)
canonical_dir <- Sys.getenv("LUSK_AEDAR_CANONICAL_DIR",file.path("data","processed","aedar"))
raw_dir <- Sys.getenv("LUSK_AEDAR_RAW_DIR",file.path("data","raw"))
density_path <- Sys.getenv("LUSK_AEDAR_DENSITY_AGGREGATE",file.path(raw_dir,"aedar_density_aggregate.parquet"))
# Operator sequence: --check acquires, validates, and atomically materializes the
# canonical facts, source Parquets, and TYPEQU metadata. --publish reads only
# those artifacts, so a
# database outage can be retried without re-acquiring or silently changing input.
# This explicit command is intentionally not called by the cron/static pipeline.
canonical_facts <- file.exists(file.path(canonical_dir,"aedar_territorial_aggregate.parquet")) &&
  file.exists(file.path(canonical_dir,"aedar_territorial_aggregate_source.parquet")) &&
  file.exists(file.path(canonical_dir,"aedar_typequ_metadata.parquet"))
if (args[[1]]=="--publish") {
  if (!canonical_facts)
    stop("Canonical AEDAR Parquets are missing; run --check first. This keeps a DB retry independent of source acquisition.",call.=FALSE)
  projection <- read_aedar_canonical(canonical_dir)
  comparison_projection <- read_aedar_comparison_canonical(canonical_dir,verify_parts=FALSE)
} else {
  projection <- read_aedar_aggregate_projection(raw_dir)
  write_aedar_canonical(projection,canonical_dir)
  # Publish always consumes the materialized/validated Parquet representation.
  projection <- read_aedar_canonical(canonical_dir)
  density_reference <- read_aedar_density_reference(file.path(raw_dir,MANIFEST_CLASSES_DENSITE[["fichier"]][[1L]]))
  density_source <- read_aedar_density_aggregate(density_path,density_reference)
  reference_connection <- do.call(DBI::dbConnect,c(list(drv=RPostgres::Postgres()),configuration_service_postgres()))
  reference <- tryCatch(DBI::dbWithTransaction(reference_connection, {
    DBI::dbExecute(reference_connection,"SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
    version <- DBI::dbGetQuery(reference_connection,"SELECT content_version FROM table_publication WHERE table_name='territory_reference'")
    facts <- DBI::dbGetQuery(reference_connection,"SELECT territory_type,territory_id,epci_id,density_class_code FROM territory_reference")
    if(nrow(version)!=1L) stop("AEDAR comparison requires one published territory-reference version",call.=FALSE)
    list(version=version$content_version[[1L]],facts=facts)
  }),finally=DBI::dbDisconnect(reference_connection))
  comparison_projection <- project_aedar_comparison_publication(projection,density_source,
    reference$facts,reference_content_version=reference$version,directory=canonical_dir)
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
  result <- tryCatch({
    facts_result <- publish_aedar_aggregates(projection,con)
    comparison_result <- publish_aedar_comparisons(comparison_projection,con)
    list(facts=facts_result,comparisons=comparison_result)
  },finally=DBI::dbDisconnect(con))
  cat("Published AEDAR facts",result$facts$row_count,"rows and comparisons",
    result$comparisons$group_row_count,"groups /",result$comparisons$territory_row_count,
    "territory results; comparison version",result$comparisons$content_version,"\n")
}
