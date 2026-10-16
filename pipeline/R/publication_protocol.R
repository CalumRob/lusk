# Shared owner-scoped publication transaction protocol.
# Adapters retain their typed descriptor, source, grain and completeness checks;
# this function owns only the common token/no-op/dependency-rebind decision.
publish_owner_snapshot <- function(db, owner, content_version, dependency_name,
                                   read_dependency, validate_dependency,
                                   publish_content, rebind_dependency) {
  required <- c("transaction", "marker")
  if (!is.list(db) || !all(vapply(required, function(name) is.function(db[[name]]), logical(1))) ||
      !is.function(read_dependency) || !is.function(validate_dependency) ||
      !is.function(publish_content) || !is.function(rebind_dependency) ||
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
    if (changed) {
      publish_content(content_version, dependency)
    } else if (rebound) {
      rebind_dependency(dependency_version)
    }
    invisible(list(owner = owner, dependency = dependency_name,
                   changed = changed, rebound = rebound,
                   content_version = content_version,
                   dependency_version = dependency_version))
  })
}
