#!/usr/bin/env Rscript
# Desktop-only publication of canonical Parquet to the existing serving schema.
# The operator's libpq password file is private. No Parquet is copied to the Pi.
if (!requireNamespace("pkgload", quietly = TRUE)) {
  stop("pkgload is required to load the pipeline.", call. = FALSE)
}
pkgload::load_all(".", quiet = TRUE)

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 1L || !args[[1L]] %in% c("--check", "--publish", "--targets")) {
  stop("Usage: Rscript scripts/publish-serving-tables.R --check|--publish|--targets (from pipeline/)",
       call. = FALSE)
}
if (args[[1L]] == "--targets") {
  # The graph handles expensive upstream work incrementally. Explicitly opt in
  # only for this process: ordinary tar_make() / cron have no DB target.
  if (identical(Sys.getenv("LUSK_MODE", unset = "full"), "cron")) {
    stop("SQL publication is not enabled for the cron graph.", call. = FALSE)
  }
  configuration_service_postgres() # fail before any upstream compute
  Sys.setenv(LUSK_PUBLISH_DB = "1")
  targets::tar_make(names = "publie_tables_service", callr_function = NULL)
  failed <- targets::tar_errored()
  if (length(failed)) {
    stop("Targets publication failed: ", paste(failed, collapse = ", "),
         call. = FALSE)
  }
} else if (args[[1L]] == "--check") {
  tables <- preparer_tables_service(file.path("..", "public", "data"))
  print(data.frame(table_name = names(tables$tables),
                   rows = vapply(tables$tables, nrow, integer(1)),
                   content_version = unname(tables$versions)))
} else {
  # Recovery only: use already-published Parquet, without building upstream.
  changed <- publier_tables_service_depuis_parquet(file.path("..", "public", "data"))
  cat(if (length(changed)) paste("Published:", paste(changed, collapse = ", ")) else
        "No table changes", "\n")
}
