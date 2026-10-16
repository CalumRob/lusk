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
                                                   conso_source_path=NULL) {
  config <- configuration_service_postgres()
  con <- do.call(DBI::dbConnect, c(list(drv=RPostgres::Postgres()), config))
  tryCatch(publish_retained_backend_snapshot(con, sortie,
    conso_source_path=conso_source_path), finally=DBI::dbDisconnect(con))
}
