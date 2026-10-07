#!/usr/bin/env Rscript
# Desktop-only publication of canonical Parquet to the existing serving schema.
# The operator's libpq password file is private. No Parquet is copied to the Pi.
if (!requireNamespace("pkgload", quietly = TRUE)) {
  stop("pkgload is required to load the pipeline.", call. = FALSE)
}
pkgload::load_all(".", quiet = TRUE)

args <- commandArgs(trailingOnly = TRUE)
selector_count <- sum(args=="--indicator-id")
all_count <- sum(args=="--all")
if (selector_count>1L || all_count>1L) stop("Duplicate selector flags",call.=FALSE)
indicator_id <- NULL; publish_all <- all_count==1L
if (selector_count==1L) {
  index <- match("--indicator-id",args)
  if (index==length(args) || startsWith(args[[index+1L]],"--")) stop("--indicator-id requires a value",call.=FALSE)
  indicator_id <- args[[index+1L]]
  args <- args[-c(index,index+1L)]
}
args <- args[args!="--all"]
if (length(args) != 1L || !args[[1L]] %in% c("--check", "--publish", "--targets",
                                                "--scalar-fixture-check", "--scalar-fixture-publish",
                                                "--series-fixture-check", "--series-fixture-publish",
                                                "--series-check", "--series-publish",
                                                "--owned-series-check", "--owned-series-publish",
                                                "--programme-series-check", "--programme-series-publish",
                                                "--programme-check", "--programme-publish")) {
    stop("Usage: Rscript scripts/publish-serving-tables.R <command> [--indicator-id ID | --all]; --indicator-id applies to owned-series check/publish, --all only to --owned-series-publish (from pipeline/)",
       call. = FALSE)
 }
command <- args[[1L]]
owned_command <- command %in% c("--owned-series-check","--owned-series-publish")
if ((selector_count || all_count) && !owned_command && !command %in% c("--programme-series-check","--programme-series-publish"))
  stop("--indicator-id/--all apply only to owned-series commands",call.=FALSE)
if (all_count && command!="--owned-series-publish") stop("--all applies only to --owned-series-publish",call.=FALSE)
if (command=="--owned-series-check" && publish_all) stop("--all is publish-only",call.=FALSE)
if (args[[1L]] %in% c("--programme-check","--programme-publish")) {
  inputs <- read_programme_serving_inputs(Sys.getenv("LUSK_SORTIE",file.path("..","public","data")))
  annual_registry <- register_programme_series_publishers(list(),inputs$metadata)
  annual <- annual_registry$subventions_annuelles_owned$project(inputs$canonical)
  collection_registry <- register_programme_observed_collections(inputs$metadata)
  collections <- lapply(collection_registry,function(publisher) publisher$project(inputs$canonical))
  projections <- c(list(subventions_annuelles=annual),collections)
  for (name in names(projections)) {
    projection <- projections[[name]]
    cat(name,nrow(projection$points %||% projection$facts),"canonical observations; version",scalar_content_version(projection),"\n")
  }
  if (args[[1L]]=="--programme-publish") {
    if (!identical(Sys.getenv("LUSK_PUBLISH_PROGRAMMES"),"1") || identical(Sys.getenv("LUSK_MODE"),"cron"))
      stop("Programme publication requires explicit LUSK_PUBLISH_PROGRAMMES=1 and is disabled for cron",call.=FALSE)
    con <- do.call(DBI::dbConnect,c(list(drv=RPostgres::Postgres()),configuration_service_postgres()))
    tryCatch({
      publish_owned_series_projection(annual,owned_series_postgres_adapter(con))
      lapply(collections,function(projection) publish_observed_collection(projection,con))
    },finally=DBI::dbDisconnect(con))
  }
  quit(status=0L)
}
if (args[[1L]] %in% c("--programme-series-check","--programme-series-publish")) {
  mode <- if (args[[1L]]=="--programme-series-check") "check" else "publish"
  projections <- read_programme_series_projections(Sys.getenv("LUSK_SORTIE",file.path("..","public","data")))
  connect <- function() do.call(DBI::dbConnect,
    c(list(drv=RPostgres::Postgres()),configuration_service_postgres()))
   result <- dispatch_owned_series_cli(mode,projections,connect,require_scope=FALSE)
  for (name in names(projections)) {
    projection <- projections[[name]]
    cat(name, nrow(projection$points), "canonical observations; version", result$versions[[name]], "\n")
  }
  quit(status=0L)
}
if (args[[1L]] %in% c("--owned-series-check","--owned-series-publish")) {
  mode <- if (args[[1L]]=="--owned-series-check") "check" else "publish"
   projections <- read_owned_series_projections(Sys.getenv("LUSK_SORTIE",file.path("..","public","data")),indicator_id=indicator_id)
  connect <- function() {
    do.call(DBI::dbConnect,c(list(drv=RPostgres::Postgres()),configuration_service_postgres()))
  }
   result <- dispatch_owned_series_cli(mode,projections,connect,indicator_id=indicator_id,all=publish_all)
  for (name in names(projections)) {
    p <- projections[[name]]; d <- p$descriptor
    excluded <- attr(projections,"excluded")[[name]]
    if (is.null(excluded)) excluded <- p$excluded
    excluded_rows <- if (is.null(excluded)) "not reported" else excluded$region$row_count
    cat("Owned series",d$dataset_id,":",nrow(p$points),"rows;",nrow(p$point_provenance),
        "associations;",nrow(p$provenance),"revisions; version",result$versions[[name]],
        "; comparison",d$comparison_point,"; excluded Région rows",excluded_rows)
    if (mode=="publish") {
      r <- result$results[[name]]
      cat(";",if(r$changed || r$rebound) "updated" else "no-op")
    }
    cat("\n")
  }
  if (mode=="publish") cat("Each dataset commits independently; if one fails, retry the command to safely reconcile both.\n")
} else if (args[[1L]] %in% c("--series-check", "--series-publish")) {
  if (args[[1L]] == "--series-publish") require_series_publish_opt_in()
  projection <- read_conso_enaf_series_projection(file.path("..", "public", "data"))
  version <- scalar_content_version(projection)
  cat("Validated canonical conso_enaf_annuel:", nrow(projection$points), "rows; version", version,
      "; comparison", projection$descriptor$comparison_point,
      "; source", projection$descriptor$source_id, "; vintage", projection$descriptor$vintage_id,
      "; excluded Région fiche rows", projection$excluded$region$row_count, "\n")
  if (args[[1L]] == "--series-publish") {
    config <- configuration_service_postgres()
    connection <- do.call(DBI::dbConnect, c(list(drv=RPostgres::Postgres()), config))
    result <- tryCatch(publish_series_projection(projection, series_postgres_adapter(connection),
      function(validated, db, content_version) db$replace(validated, content_version)),
      finally=DBI::dbDisconnect(connection))
    cat("Publication:", if (result$changed || result$rebound) "updated" else "no-op",
        "; content version", result$content_version, "\n")
  }
} else if (args[[1L]] %in% c("--series-fixture-check", "--series-fixture-publish")) {
  canonical <- compute_payload(communes_fixture_milieux_ocsge(), theme=theme_milieux())
  metadata <- jsonlite::read_json("inst/extdata/theme-metadata/theme_milieux.json", simplifyVector=FALSE)
  registry <- register_conso_enaf_series_publisher(list(), metadata)
  projection <- registry$conso_enaf_annuel$project(canonical)
  cat("Validated conso_enaf_annuel:", nrow(projection$points), "observations; comparison",
      projection$descriptor$comparison_point, "; version", scalar_content_version(projection), "\n")
  if (args[[1L]] == "--series-fixture-publish") {
    database <- Sys.getenv("LUSK_TEST_DATABASE_NAME", unset="")
    dsn <- Sys.getenv("LUSK_TEST_PUBLISH_DSN", unset="")
    uri <- regmatches(dsn, regexec("^postgres(?:ql)?://([^/:@]+)(?::([^@]*))?@([^:/]+):([0-9]+)/([^?]+)", dsn, perl=TRUE))[[1L]]
    if (!startsWith(database, "lusk_it_") || !nzchar(dsn) || length(uri) != 6L ||
        !identical(utils::URLdecode(uri[[6L]]), database) || !uri[[4L]] %in% c("localhost", "127.0.0.1", "::1"))
      stop("Series fixture publication requires a matching lusk_it_* disposable DSN", call.=FALSE)
    connection_args <- list(drv=RPostgres::Postgres(), host=uri[[4L]], port=as.integer(uri[[5L]]),
      dbname=utils::URLdecode(uri[[6L]]), user=utils::URLdecode(uri[[2L]]))
    if (nzchar(uri[[3L]])) connection_args$password <- utils::URLdecode(uri[[3L]])
    connection <- do.call(DBI::dbConnect, connection_args)
    result <- tryCatch(publish_registered_series(registry, "conso_enaf_annuel", canonical,
      series_postgres_adapter(connection)), finally=DBI::dbDisconnect(connection))
    print(result)
  }
} else if (args[[1L]] %in% c("--scalar-fixture-check", "--scalar-fixture-publish")) {
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
  scalar_projection <- project_service_scalar_snapshot(tables, file.path("..", "public", "data"))$projection
  cat("Validated complete scalar snapshot:", nrow(scalar_projection$facts), "facts across",
      nrow(scalar_projection$descriptors), "registered indicators; version",
      scalar_content_version(scalar_projection), "\n")
  print(data.frame(table_name = names(tables$tables),
                   rows = vapply(tables$tables, nrow, integer(1)),
                   content_version = unname(tables$versions)))
} else {
  # Recovery only: use already-published Parquet, without building upstream.
  changed <- publier_tables_service_depuis_parquet(file.path("..", "public", "data"))
  cat(if (length(changed)) paste("Published:", paste(changed, collapse = ", ")) else
        "No table changes", "\n")
}
