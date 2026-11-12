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
    # A scoped retained publication (the three #989 supply scalars) publishes
    # only the registered dependency closure: scalar snapshot/comparisons, the
    # scalar-bound declared-profile companion, and the linked selected reading.
    # The scoped plan proves the delta against the explicitly supplied
    # current/baseline generation and guards the live markers of that closure;
    # unrelated owner markers are neither expectations nor writes. Without a
    # scope, the normal full-backend publication is unchanged.
    scope_ids <- retained_backend_scope_ids(scalar_scope)
    if (length(scope_ids)) {
      if (!nzchar(baseline_sortie))
        stop("A scoped retained publication requires LUSK_SCALAR_BASELINE_SORTIE ",
             "pointing to the counterpart generation (prior baseline when ",
             "forward, published candidate when recovering); refusing with ",
             "zero writes.", call. = FALSE)
      DBI::dbGetQuery(con, "SELECT pg_advisory_lock(594, 1)")
      locked <- TRUE
      # Forward only: the candidate declared-profile artifact must be bound to
      # the candidate scalar version before the plan reads it. The prior
      # artifacts are restored on failure. Recovery consumes the frozen
      # baseline artifacts unchanged (its binding is already the baseline
      # scalar version).
      target_reference <- project_territory_reference(
        nanoparquet::read_parquet(file.path(sortie, "territoires.parquet")))
      target_snapshot <- project_retained_scalar_snapshot(sortie,
                                                          target_reference)
      forward <- all(scope_ids %in%
        target_snapshot$scalar$descriptors$indicator_id)
      if (forward) {
        profile_backup <- backup_profile()
        refresh_declared_profile_scalar_binding(sortie,
          declared_profile_owners(),
          scalar_content_version(target_snapshot$scalar))
      }
      plan <- scoped_publication_plan(sortie, baseline_sortie, scope_ids)
      if (!identical(plan$direction, if (forward) "forward" else "recovery"))
        stop("Scoped publication direction could not be derived from the ",
             "supplied generations; refusing with zero writes.", call. = FALSE)
      assert_scoped_publication_baseline(con, plan)
      publish_scoped_retained_backend(con, plan)
    } else {
      publish_retained_backend_snapshot(con, sortie,
        conso_source_path=conso_source_path)
    }
    success <- TRUE
  }, finally={
    if (locked) try(DBI::dbGetQuery(con, "SELECT pg_advisory_unlock(594, 1)"),
                    silent=TRUE)
    if (!success) restore_profile()
    if (!is.null(profile_backup)) unlink(profile_backup, recursive=TRUE)
    DBI::dbDisconnect(con)
  })
}
