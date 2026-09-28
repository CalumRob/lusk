# Contract validator for registered scalar projections. DBI adapters may
# register a named projection; arbitrary SQL and inferred descriptors are not
# part of this interface.
validate_scalar_projection <- function(facts, descriptors) {
  required_facts <- c("indicator_id", "territory_id", "territory_type", "value",
                      "status", "support_count", "denominator_count", "source_id", "vintage_id")
  required_descriptors <- c("indicator_id", "allowed_levels", "direction", "descriptor_version", "source_id")
  if (!is.data.frame(facts) || !all(required_facts %in% names(facts)) ||
      !is.data.frame(descriptors) || !all(required_descriptors %in% names(descriptors)))
    stop("Scalar projection is missing contract fields", call. = FALSE)
  if (anyDuplicated(facts[c("indicator_id", "territory_id")]))
    stop("Duplicate scalar observation key", call. = FALSE)
  if (anyDuplicated(descriptors$indicator_id)) stop("Duplicate scalar descriptor", call. = FALSE)
  if (any(!facts$indicator_id %in% descriptors$indicator_id)) stop("Undeclared scalar indicator", call. = FALSE)
  descriptor <- descriptors[match(facts$indicator_id, descriptors$indicator_id), , drop = FALSE]
  if (any(facts$source_id != descriptor$source_id))
    stop("Scalar descriptor/source disagreement", call. = FALSE)
  levels_ok <- mapply(function(level, allowed) level %in% allowed,
                      facts$territory_type, descriptor$allowed_levels)
  if (any(!levels_ok)) stop("Scalar territory level is not eligible", call. = FALSE)
  if (any(!facts$status %in% c("measured", "suppressed", "unsupported", "not_available")) ||
      any((facts$status == "measured") != !is.na(facts$value)))
    stop("Scalar null/status mismatch", call. = FALSE)
  if (any(!is.na(facts$denominator_count) & !is.na(facts$support_count) &
          facts$denominator_count < facts$support_count))
    stop("Scalar denominator is smaller than support", call. = FALSE)
  invisible(facts)
}

register_scalar_publisher <- function(registry, name, project, publish) {
  if (!is.list(registry) || !is.function(project) || !is.function(publish) ||
      length(name) != 1L || !nzchar(name) || name %in% names(registry))
    stop("Invalid or duplicate scalar publisher registration", call. = FALSE)
  registry[[name]] <- list(project = project, publish = publish)
  registry
}
