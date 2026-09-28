# Dense declared-detail profile projection. Descriptor axes are sourced only
# from indicator_pages metadata; canonical rows may not extend or reorder them.
validate_declared_profile <- function(facts, descriptor, axes) {
  required <- c("territory_id", "territory_type", "detail", "sex", "value", "status")
  if (!is.data.frame(facts) || !setequal(names(facts), required) ||
      !is.data.frame(axes) || !setequal(names(axes), c("axis_name", "axis_key", "label", "ordinal")))
    stop("Profile projection has invalid contract columns", call. = FALSE)
  if (anyNA(facts[c("territory_id", "territory_type", "detail", "sex", "status")]) ||
      any(!facts$territory_type %in% descriptor$levels) || any(!facts$status %in% c("measured", "not_available", "suppressed", "unsupported")) ||
      any((facts$status == "measured") != !is.na(facts$value)) || any(!is.na(facts$value) & !is.finite(facts$value)))
    stop("Invalid profile identity, level, value or status", call. = FALSE)
  details <- axes[axes$axis_name == "detail", , drop = FALSE]
  sexes <- axes[axes$axis_name == "sex", , drop = FALSE]
  if (!identical(as.character(details$axis_key), as.character(descriptor$details)) ||
      !identical(as.character(sexes$axis_key), as.character(descriptor$sexes)) ||
      anyDuplicated(axes[c("axis_name", "axis_key")]) || anyDuplicated(axes[c("axis_name", "ordinal")]))
    stop("Profile axes differ from declared metadata", call. = FALSE)
  key <- paste(facts$territory_type, facts$territory_id, facts$detail, facts$sex, sep = "\r")
  if (anyDuplicated(key)) stop("Duplicate profile coordinate", call. = FALSE)
  if (any(!facts$detail %in% descriptor$details) || any(!facts$sex %in% descriptor$sexes))
    stop("Undeclared profile coordinate", call. = FALSE)
  for (territory in unique(paste(facts$territory_type, facts$territory_id, sep = "\r"))) {
    rows <- facts[paste(facts$territory_type, facts$territory_id, sep = "\r") == territory, , drop = FALSE]
    expected <- expand.grid(detail = descriptor$details, sex = descriptor$sexes, stringsAsFactors = FALSE)
    if (!setequal(paste(rows$detail, rows$sex), paste(expected$detail, expected$sex)))
      stop("Dense profile has missing coordinates", call. = FALSE)
  }
  invisible(facts)
}

project_structure_age_profile <- function(indicateurs, metadata) {
  page <- metadata$indicator_pages$structure_age
  if (is.null(page) || !identical(unlist(page$pyramid$dimensions), c("detail", "sex")))
    stop("structure_age profile descriptor is not declared", call. = FALSE)
  details <- unlist(page$comparison$details, use.names = FALSE)
  sexes <- unlist(page$comparison$sexes, use.names = FALSE)
  labels <- unlist(metadata$detail_labels$structure_age, use.names = TRUE)
  if (!setequal(names(labels), details)) stop("structure_age detail labels mismatch", call. = FALSE)
  axes <- rbind(
    data.frame(axis_name = "detail", axis_key = details, label = unname(labels[details]), ordinal = seq_along(details) - 1L),
    data.frame(axis_name = "sex", axis_key = sexes, label = sexes, ordinal = seq_along(sexes) - 1L)
  )
  facts <- indicateurs[indicateurs$key == "structure_age" & indicateurs$type %in% unlist(page$levels), , drop = FALSE]
  projected <- data.frame(territory_id = facts$territoire, territory_type = facts$type,
    detail = facts$detail, sex = facts$sex, value = facts$value,
    status = ifelse(is.na(facts$value), "not_available", "measured"), stringsAsFactors = FALSE)
  descriptor <- list(levels = unlist(page$levels), details = details, sexes = sexes,
    label = page$label, unit = page$unit, source = unlist(page$sources))
  validate_declared_profile(projected, descriptor, axes)
  list(facts = projected, axes = axes, descriptor = descriptor)
}

profile_content_version <- function(projection) {
  path <- tempfile("profile-version-")
  on.exit(unlink(path), add = TRUE)
  saveRDS(projection, path, version = 3)
  unname(tools::md5sum(path))
}

# Registered projections publish atomically under their own table marker. The
# narrow adapter keeps connection/transaction policy out of the R projection.
publish_structure_age_profile <- function(indicateurs, metadata, db) {
  if (!is.list(db) || !is.function(db$transaction) || !is.function(db$marker) ||
      !is.function(db$replace)) stop("Invalid profile publisher adapter", call. = FALSE)
  projection <- project_structure_age_profile(indicateurs, metadata)
  version <- profile_content_version(projection)
  db$transaction({
    marker <- db$marker("declared_profile")
    if (!nrow(marker) || !identical(as.character(marker$content_version[[1L]]), version))
      db$replace(projection, version)
  })
  invisible(version)
}
