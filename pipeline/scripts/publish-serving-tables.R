#!/usr/bin/env Rscript
# Desktop-only publication of canonical Parquet to the existing serving schema.
# The operator's libpq password file is private. No Parquet is copied to the Pi.
if (!requireNamespace("pkgload", quietly = TRUE)) {
  stop("pkgload is required to load the pipeline.", call. = FALSE)
}
pkgload::load_all(".", quiet = TRUE)

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 1L || !args[[1L]] %in% c("--check", "--publish", "--targets",
                                               "--scalar-fixture-check", "--scalar-fixture-publish")) {
  stop("Usage: Rscript scripts/publish-serving-tables.R --check|--publish|--targets|--scalar-fixture-check|--scalar-fixture-publish (from pipeline/)",
       call. = FALSE)
}
if (args[[1L]] %in% c("--scalar-fixture-check", "--scalar-fixture-publish")) {
  fixture <- readr::read_csv("tests/testthat/fixtures/demographie-fixture.csv",
    col_types=readr::cols(code=readr::col_character(), epci=readr::col_character()),
    show_col_types=FALSE)
  payload <- compute_payload(fixture)
  descriptor <- jsonlite::fromJSON("inst/extdata/theme-metadata/theme_demographie.json",
                                   simplifyVector=FALSE)
  # This tiny fixture has one densite fact for every canonical territory at
  # the descriptor's declared levels; the completeness policy is explicit for
  # this fixture only, not inferred as a product-catalogue default.
  completeness <- "dense_complete"
  projection <- project_fixture_scalar(payload, descriptor, completeness)
  validate_scalar_projection(projection$facts, projection$descriptors,
                             projection$eligible_territories)
  if (args[[1L]] == "--scalar-fixture-check") {
    cat("Validated canonical densite fixture:", nrow(projection$facts), "facts; version",
        scalar_content_version(projection), "\n")
  } else {
    # This route can only target an explicitly named disposable DB. It never
    # accepts the production publisher configuration or schedules a target.
    database <- Sys.getenv("LUSK_TEST_DATABASE_NAME", unset="")
    dsn <- Sys.getenv("LUSK_TEST_PUBLISH_DSN", unset="")
    uri <- regmatches(dsn, regexec("^postgres(?:ql)?://([^/:@]+)(?::([^@]*))?@([^:/]+):([0-9]+)/([^?]+)", dsn, perl=TRUE))[[1L]]
    if (!startsWith(database, "lusk_it_") || !nzchar(dsn) || length(uri) != 6L ||
        !identical(utils::URLdecode(uri[[6L]]), database) ||
        !uri[[4L]] %in% c("localhost", "127.0.0.1", "::1"))
      stop("Scalar fixture publication requires a matching lusk_it_* disposable DSN", call.=FALSE)
    registry <- register_fixture_scalar_publisher(list(), descriptor, completeness)
    connection_args <- list(drv=RPostgres::Postgres(), host=uri[[4L]], port=as.integer(uri[[5L]]),
      dbname=utils::URLdecode(uri[[6L]]), user=utils::URLdecode(uri[[2L]]))
    if (nzchar(uri[[3L]])) connection_args$password <- utils::URLdecode(uri[[3L]])
    connection <- do.call(DBI::dbConnect, connection_args)
    result <- tryCatch(publish_registered_scalar(registry, "canonical_fixture_densite", payload,
      scalar_postgres_adapter(connection)), finally=DBI::dbDisconnect(connection))
    print(result)
  }
} else if (args[[1L]] == "--targets") {
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
