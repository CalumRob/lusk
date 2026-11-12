# Transaction composition for the retained backend. The normal publishers each
# own a transaction and call dbWithTransaction directly. A wrapper that must
# cover several owners atomically sets an outer publication transaction bound to
# ONE connection; the inner owner transactions then execute inside it
# (PostgreSQL xact locks remain held until the outer commit). The active
# connection identity is tracked, not a boolean: a different connection inside
# the outer context fails before SQL instead of silently skipping its own
# transaction. Ordinary direct calls keep their own transaction.
.publication_transaction_state <- new.env(parent = emptyenv())
.publication_transaction_state$connection <- NULL

publication_transaction <- function(con, expr) {
  active <- .publication_transaction_state$connection
  if (!is.null(active)) {
    if (!identical(active, con))
      stop("Outer publication transaction is active on a different ",
           "connection; the single-connection outer contract is violated.",
           call. = FALSE)
    return(force(expr))
  }
  DBI::dbWithTransaction(con, expr)
}

with_publication_transaction <- function(con, expr) {
  state <- .publication_transaction_state
  if (!is.null(state$connection))
    stop("Nested outer publication transaction is not supported", call. = FALSE)
  state$connection <- con
  on.exit({ state$connection <- NULL }, add = TRUE)
  DBI::dbWithTransaction(con, force(expr))
}

# Shared owner-scoped publication transaction protocol.
# Adapters retain their typed descriptor, source, grain and completeness checks;
# this function owns only the common token/no-op/dependency-rebind decision.
publish_owner_snapshot <- function(db, owner, content_version, dependency_name,
                                   read_dependency, validate_dependency,
                                   publish_content, rebind_dependency,
                                   requires_republish = function(marker, dependency) FALSE) {
  required <- c("transaction", "marker")
  if (!is.list(db) || !all(vapply(required, function(name) is.function(db[[name]]), logical(1))) ||
      !is.function(read_dependency) || !is.function(validate_dependency) ||
      !is.function(publish_content) || !is.function(rebind_dependency) ||
      !is.function(requires_republish) ||
      length(owner) != 1L || is.na(owner) || !nzchar(owner) ||
      length(dependency_name) != 1L || is.na(dependency_name) || !nzchar(dependency_name) ||
      length(content_version) != 1L || is.na(content_version) || !nzchar(content_version))
    stop("Invalid owner publication protocol configuration", call. = FALSE)

  db$transaction({
    if (is.function(db$lock)) db$lock(owner)
    dependency <- read_dependency()
    validate_dependency(dependency)
    current <- db$marker(owner)
    has_current <- is.data.frame(current) && nrow(current) > 0L &&
      !is.na(current$content_version[[1L]]) && nzchar(as.character(current$content_version[[1L]]))
    changed <- !has_current || !identical(as.character(current$content_version[[1L]]),
                                          as.character(content_version))
    dependency_version <- as.character(dependency$content_version[[1L]])
    rebound <- has_current && !identical(as.character(current$reference_content_version[[1L]]),
                                         dependency_version)
    dependency_stale <- isTRUE(requires_republish(current, dependency))
    republish <- has_current && dependency_stale
    if (changed || republish) {
      publish_content(content_version, dependency)
    } else if (rebound) {
      rebind_dependency(dependency_version)
    }
    invisible(list(owner = owner, dependency = dependency_name,
                   changed = changed, rebound = rebound,
                   republished_for_dependency = republish,
                   content_version = content_version,
                   dependency_version = dependency_version))
  })
}
