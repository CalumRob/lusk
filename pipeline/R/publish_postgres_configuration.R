# Desktop/operator PostgreSQL connection configuration. Credentials stay in
# the private libpq passfile and are never persisted in the repository.
configuration_service_postgres <- function() {
  required <- c("LUSK_PUBLISH_HOST", "LUSK_PUBLISH_DATABASE", "LUSK_PUBLISH_USER")
  env <- Sys.getenv(required, unset="")
  passfile_env <- Sys.getenv("PGPASSFILE", unset="")
  if (!nzchar(passfile_env)) passfile_env <- file.path(Sys.getenv("APPDATA"),
    "PostgreSQL", "pgpass.conf")
  if (any(!nzchar(env)) || !file.exists(passfile_env))
    stop("Publication SQL : hôte, base, rôle et passfile libpq privé requis.", call.=FALSE)
  passfile <- normalizePath(passfile_env, winslash="/", mustWork=TRUE)
  repository <- normalizePath("..", winslash="/", mustWork=TRUE)
  if (startsWith(tolower(passfile), paste0(tolower(repository), "/")))
    stop("PGPASSFILE doit rester hors du dépôt.", call.=FALSE)
  port <- suppressWarnings(as.integer(Sys.getenv("LUSK_PUBLISH_PORT", unset="5432")))
  if (is.na(port) || port < 1L || port > 65535L)
    stop("LUSK_PUBLISH_PORT doit être un port TCP valide.", call.=FALSE)
  list(host=env[["LUSK_PUBLISH_HOST"]], port=port,
    dbname=env[["LUSK_PUBLISH_DATABASE"]], user=env[["LUSK_PUBLISH_USER"]],
    passfile=passfile)
}

publish_retained_backend_from_parquet <- function(sortie="../public/data",
                                                   conso_source_path=NULL,
                                                   baseline_sortie=Sys.getenv(
                                                     "LUSK_SCALAR_BASELINE_SORTIE",
                                                     unset=""),
                                                   scalar_scope=Sys.getenv(
                                                     "LUSK_SCALAR_SCOPE",
                                                     unset="")) {
  config <- configuration_service_postgres()
  con <- do.call(DBI::dbConnect, c(list(drv=RPostgres::Postgres()), config))
  locked <- FALSE
  tryCatch({
    # A scoped retained publication (the three #989 supply scalars) must prove
    # the serving baseline before any write. The guard reads the live markers
    # under the existing scalar advisory lock and refuses on any mismatch; the
    # rest of the publication stays the normal full-snapshot path.
    scope_ids <- retained_backend_scope_ids(scalar_scope)
    if (length(scope_ids)) {
      if (!nzchar(baseline_sortie))
        stop("A scoped retained publication requires LUSK_SCALAR_BASELINE_SORTIE ",
             "pointing to the canonical generation the serving database was ",
             "published from; refusing with zero writes.", call. = FALSE)
      DBI::dbGetQuery(con, "SELECT pg_advisory_lock(594, 1)")
      locked <- TRUE
      assert_retained_backend_baseline(con, sortie, baseline_sortie, scope_ids)
    }
    publish_retained_backend_snapshot(con, sortie,
      conso_source_path=conso_source_path)
  }, finally={
    if (locked) try(DBI::dbGetQuery(con, "SELECT pg_advisory_unlock(594, 1)"),
                    silent=TRUE)
    DBI::dbDisconnect(con)
  })
}
