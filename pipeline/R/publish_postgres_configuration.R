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
  profile_backup <- NULL
  success <- FALSE
  restore_profile <- function() {
    if (is.null(profile_backup) || !dir.exists(profile_backup)) return(invisible(NULL))
    if (dir.exists(file.path(profile_backup, "profile-serving"))) {
      unlink(file.path(sortie, "profile-serving"), recursive = TRUE)
      file.copy(file.path(profile_backup, "profile-serving"), sortie,
                recursive = TRUE)
    }
    binding <- file.path(profile_backup, "binding.json")
    if (file.exists(binding)) {
      dir.create(file.path(sortie, "scalar-serving"), recursive = TRUE,
                 showWarnings = FALSE)
      file.copy(binding, file.path(sortie, "scalar-serving", "binding.json"),
                overwrite = TRUE)
    }
  }
  backup_profile <- function() {
    backup <- tempfile("profile-companion-")
    dir.create(backup)
    if (dir.exists(file.path(sortie, "profile-serving")))
      file.copy(file.path(sortie, "profile-serving"), backup, recursive = TRUE)
    binding <- file.path(sortie, "scalar-serving", "binding.json")
    if (file.exists(binding)) file.copy(binding, backup)
    backup
  }
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
      # Prepare the normal metadata-only profile companion BEFORE the guard:
      # the candidate profile artifact must be bound to the candidate scalar
      # version before any write. The prior artifacts are restored on failure.
      profile_backup <- backup_profile()
      candidate_reference <- project_territory_reference(
        nanoparquet::read_parquet(file.path(sortie, "territoires.parquet")))
      candidate_scalar <- project_retained_scalar_snapshot(sortie,
        candidate_reference)
      refresh_declared_profile_scalar_binding(sortie,
        declared_profile_owners(),
        scalar_content_version(candidate_scalar$scalar))
      assert_retained_backend_baseline(con, sortie, baseline_sortie, scope_ids)
    }
    publish_retained_backend_snapshot(con, sortie,
      conso_source_path=conso_source_path,
      atomic = length(scope_ids) > 0L,
      companion_profiles = length(scope_ids) > 0L)
    success <- TRUE
  }, finally={
    if (locked) try(DBI::dbGetQuery(con, "SELECT pg_advisory_unlock(594, 1)"),
                    silent=TRUE)
    if (!success) restore_profile()
    if (!is.null(profile_backup)) unlink(profile_backup, recursive=TRUE)
    DBI::dbDisconnect(con)
  })
}
