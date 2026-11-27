# Create a guarded test schema and run its initializer/build under failure-safe
# cleanup. On success the caller owns the later drop; on ANY initialization/build
# error this helper drops the schema before rethrowing the original condition.
.guarded_schema_build <- function(con, prefix, build) {
  if (!is.character(prefix) || length(prefix) != 1L || !nzchar(prefix) ||
      !grepl("^it_[A-Za-z0-9_]+_$", prefix) || !is.function(build))
    stop("Guarded schema cleanup requires an it_* prefix and build function", call. = FALSE)
  schema <- paste0(prefix, paste(sample(c(letters, 0:9), 12, TRUE), collapse = ""))
  created <- FALSE
  completed <- FALSE
  on.exit(if (created && !completed) try(DBI::dbExecute(con,
    paste0('DROP SCHEMA IF EXISTS "', schema, '" CASCADE')), silent = TRUE), add = TRUE)
  DBI::dbExecute(con, paste0('CREATE SCHEMA "', schema, '"'))
  created <- TRUE
  DBI::dbExecute(con, paste0('SET search_path TO "', schema, '"'))
  value <- build(schema)
  completed <- TRUE
  list(schema = schema, value = value)
}
