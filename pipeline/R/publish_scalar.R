# Contract validator for registered scalar projections. DBI adapters may
# register a named projection; arbitrary SQL and inferred descriptors are not
# part of this interface.
validate_scalar_projection <- function(facts, descriptors, eligible_territories = NULL) {
  required_facts <- c("indicator_id", "territory_id", "territory_type", "value",
                      "status", "support_count", "denominator_count", "source_id", "vintage_id")
  required_descriptors <- c("indicator_id", "source_id", "label", "unit", "direction",
                            "comparison_facet", "allowed_levels", "denominator_semantics",
                            "completeness", "descriptor_version")
  if (!is.data.frame(facts) || !all(required_facts %in% names(facts)) ||
      !is.data.frame(descriptors) || !all(required_descriptors %in% names(descriptors)))
    stop("Scalar projection is missing contract fields", call. = FALSE)
  if (!setequal(names(facts), required_facts) ||
      !setequal(names(descriptors), required_descriptors))
    stop("Scalar projection contains undeclared fields", call. = FALSE)
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
  if (any(!is.na(facts$value) & !is.finite(facts$value)) ||
      any(!is.na(facts$support_count) & (facts$support_count < 0 | facts$support_count %% 1 != 0)) ||
      any(!is.na(facts$denominator_count) & (facts$denominator_count < 0 | facts$denominator_count %% 1 != 0)))
    stop("Invalid scalar value or support/denominator count", call. = FALSE)
  if (any(!is.na(facts$denominator_count) & !is.na(facts$support_count) &
          facts$denominator_count < facts$support_count))
    stop("Scalar denominator is smaller than support", call. = FALSE)
  dense <- descriptors$indicator_id[descriptors$completeness == "dense_complete"]
  if (length(dense)) {
    if (!is.data.frame(eligible_territories) ||
        !all(c("territory_id", "territory_type") %in% names(eligible_territories)))
      stop("Dense scalar projection requires its eligible territory universe", call. = FALSE)
    for (id in dense) {
      desc <- descriptors[match(id, descriptors$indicator_id), , drop=FALSE]
      eligible <- eligible_territories[eligible_territories$territory_type %in% desc$allowed_levels[[1L]], , drop=FALSE]
      actual <- facts[facts$indicator_id == id, c("territory_id", "territory_type"), drop=FALSE]
      if (!setequal(paste(eligible$territory_id, eligible$territory_type),
                    paste(actual$territory_id, actual$territory_type)))
        stop("Dense scalar observations do not cover eligible territories", call. = FALSE)
    }
  }
  invisible(facts)
}

register_scalar_publisher <- function(registry, name, project, publish) {
  if (!is.list(registry) || !is.function(project) || !is.function(publish) ||
      length(name) != 1L || !nzchar(name) || name %in% names(registry))
    stop("Invalid or duplicate scalar publisher registration", call. = FALSE)
  registry[[name]] <- list(project = project, publish = publish)
  registry
}

scalar_content_version <- function(projection) {
  path <- tempfile("scalar-version-")
  on.exit(unlink(path), add = TRUE)
  saveRDS(projection, path, version = 3)
  unname(tools::md5sum(path))
}

# db is a narrow transaction adapter (transaction, marker, replace). Keeping
# it injectable makes retry/rollback behavior testable without a live service.
publish_registered_scalar <- function(registry, name, canonical, db) {
  publisher <- registry[[name]]
  if (is.null(publisher)) stop("Unregistered scalar publisher", call. = FALSE)
  if (!is.function(db$transaction) || !is.function(db$marker) || !is.function(db$replace))
    stop("Invalid scalar database adapter", call. = FALSE)
  projection <- publisher$project(canonical)
  if (!is.list(projection) || !all(c("facts", "descriptors", "provenance", "datasets", "vintages", "eligible_territories") %in% names(projection)))
    stop("Scalar projection must contain facts, descriptors, provenance, datasets, vintages, and eligible territories", call. = FALSE)
  validate_scalar_projection(projection$facts, projection$descriptors, projection$eligible_territories)
  provenance <- projection$provenance
  provenance_columns <- c("indicator_id", "territory_id", "source_id", "vintage_id")
  if (!is.data.frame(provenance) || !all(provenance_columns %in% names(provenance)) ||
      anyDuplicated(provenance[provenance_columns]) ||
      any(!paste(projection$facts$indicator_id, projection$facts$territory_id) %in%
          paste(provenance$indicator_id, provenance$territory_id)) ||
      any(!paste(projection$facts$indicator_id, projection$facts$territory_id,
                 projection$facts$source_id, projection$facts$vintage_id) %in%
          paste(provenance$indicator_id, provenance$territory_id,
                provenance$source_id, provenance$vintage_id)))
    stop("Invalid or incomplete scalar provenance associations", call. = FALSE)
  datasets <- projection$datasets
  vintages <- projection$vintages
  if (!is.data.frame(datasets) || !all(c("source_id", "name") %in% names(datasets)) ||
      anyDuplicated(datasets$source_id) ||
      !is.data.frame(vintages) ||
      !all(c("source_id", "vintage_id", "version", "reference_date", "publication_date") %in% names(vintages)) ||
      anyDuplicated(vintages[c("source_id", "vintage_id")]) ||
      any(!provenance$source_id %in% datasets$source_id) ||
      any(!paste(provenance$source_id, provenance$vintage_id) %in%
          paste(vintages$source_id, vintages$vintage_id)))
    stop("Scalar provenance refers to an undeclared dataset or vintage", call. = FALSE)
  version <- scalar_content_version(projection)
  db$transaction({
    if (is.function(db$lock)) db$lock()
    marker <- db$marker("scalar_observation")
    changed <- !(nrow(marker) && identical(as.character(marker$content_version[[1L]]), version))
    if (changed) publisher$publish(projection, db, version)
    invisible(list(changed = changed, content_version = version))
  })
}

scalar_postgres_adapter <- function(con) {
  if (!requireNamespace("DBI", quietly = TRUE)) stop("DBI is required")
  list(
    transaction = function(expr) DBI::dbWithTransaction(con, expr),
    lock = function() DBI::dbGetQuery(con, "SELECT pg_advisory_xact_lock(594, 1)"),
    marker = function(name) DBI::dbGetQuery(con,
      "SELECT content_version FROM table_publication WHERE table_name = $1", params = list(name)),
    replace = function(projection, version) {
      facts <- projection$facts
      descriptors <- projection$descriptors
      provenance <- projection$provenance
      quote_value <- function(x) {
        if (length(x) == 1L && is.na(x)) return("NULL")
        as.character(DBI::dbQuoteString(con, as.character(x)))
      }
      for (row in seq_len(nrow(projection$datasets))) {
        d <- projection$datasets[row, , drop = FALSE]
        DBI::dbExecute(con, "INSERT INTO source_dataset(source_id,name) VALUES($1,$2) ON CONFLICT(source_id) DO UPDATE SET name=EXCLUDED.name",
                       params = unname(as.list(d[c("source_id", "name")])))
      }
      for (row in seq_len(nrow(projection$vintages))) {
        v <- projection$vintages[row, , drop = FALSE]
        DBI::dbExecute(con, "INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date) VALUES($1,$2,$3,$4,$5) ON CONFLICT(source_id,vintage_id) DO UPDATE SET version=EXCLUDED.version,reference_date=EXCLUDED.reference_date,publication_date=EXCLUDED.publication_date",
                       params = unname(as.list(v[c("source_id", "vintage_id", "version", "reference_date", "publication_date")])))
      }
      DBI::dbExecute(con, "DELETE FROM scalar_observation")
      DBI::dbExecute(con, "DELETE FROM scalar_descriptor")
      for (i in seq_len(nrow(descriptors))) {
        d <- descriptors[i, , drop = FALSE]
        levels <- as.character(d$allowed_levels[[1L]])
        array_sql <- paste0("ARRAY[", paste(vapply(levels, quote_value, character(1)), collapse=","), "]::text[]")
        fields <- c("indicator_id", "source_id", "label", "unit", "direction",
                    "comparison_facet", "denominator_semantics", "completeness", "descriptor_version")
        values <- vapply(fields, function(field) quote_value(d[[field]][[1L]]), character(1))
        sql <- paste0("INSERT INTO scalar_descriptor(", paste(fields, collapse=","), ",allowed_levels) VALUES (",
          paste(c(values, array_sql), collapse=","), ")")
        DBI::dbExecute(con, sql)
      }
      DBI::dbWriteTable(con, "scalar_observation", facts, append = TRUE, row.names = FALSE)
      DBI::dbWriteTable(con, "scalar_observation_source", provenance, append = TRUE, row.names = FALSE)
      DBI::dbExecute(con, "INSERT INTO table_publication(table_name,content_version,row_count,published_at) VALUES ('scalar_observation',$1,$2,now()) ON CONFLICT(table_name) DO UPDATE SET content_version=EXCLUDED.content_version,row_count=EXCLUDED.row_count,published_at=EXCLUDED.published_at",
                     params = list(version, nrow(facts)))
    }
  )
}
