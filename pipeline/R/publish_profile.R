# Dense declared-detail profile projection. Descriptor axes are sourced only
# from indicator_pages metadata; canonical rows may not extend or reorder them.
validate_declared_profile <- function(facts, descriptor, axes, eligible_territories = NULL) {
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
  if (!setequal(unique(axes$axis_name), c("detail", "sex")) ||
      !identical(as.character(details$axis_key), as.character(descriptor$details)) ||
      !identical(as.character(sexes$axis_key), as.character(descriptor$sexes)) ||
      !identical(as.integer(details$ordinal), seq_along(descriptor$details) - 1L) ||
      !identical(as.integer(sexes$ordinal), seq_along(descriptor$sexes) - 1L) ||
      anyDuplicated(axes[c("axis_name", "axis_key")]) || anyDuplicated(axes[c("axis_name", "ordinal")]))
    stop("Profile axes differ from declared metadata", call. = FALSE)
  key <- paste(facts$territory_type, facts$territory_id, facts$detail, facts$sex, sep = "\r")
  if (anyDuplicated(key)) stop("Duplicate profile coordinate", call. = FALSE)
  if (any(!facts$detail %in% descriptor$details) || any(!facts$sex %in% descriptor$sexes))
    stop("Undeclared profile coordinate", call. = FALSE)
  universe <- unique(paste(facts$territory_type, facts$territory_id, sep = "\r"))
  if (!is.null(eligible_territories)) {
    if (!is.data.frame(eligible_territories) ||
        !all(c("territory_id", "territory_type") %in% names(eligible_territories)) ||
        anyDuplicated(eligible_territories[c("territory_id", "territory_type")]) ||
        any(!eligible_territories$territory_type %in% descriptor$levels))
      stop("Invalid profile eligible territory universe", call. = FALSE)
    required <- paste(eligible_territories$territory_type, eligible_territories$territory_id, sep = "\r")
    if (!setequal(required, universe)) stop("Dense profile does not cover eligible territories", call. = FALSE)
  }
  for (territory in universe) {
    rows <- facts[paste(facts$territory_type, facts$territory_id, sep = "\r") == territory, , drop = FALSE]
    expected <- expand.grid(detail = descriptor$details, sex = descriptor$sexes, stringsAsFactors = FALSE)
    if (!setequal(paste(rows$detail, rows$sex), paste(expected$detail, expected$sex)))
      stop("Dense profile has missing coordinates", call. = FALSE)
  }
  invisible(facts)
}

project_structure_age_profile <- function(indicateurs, metadata, territoires = NULL) {
  if (is.list(indicateurs) && !is.data.frame(indicateurs)) {
    territoires <- indicateurs$territoires
    indicateurs <- indicateurs$indicateurs
  }
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
    label = page$label, unit = page$unit, source = unlist(page$sources),
    comparison_detail = page$comparison$detail,
    comparison_sex = page$comparison$sex,
    comparison_direction = page$direction)
  eligible <- NULL
  if (!is.null(territoires)) eligible <- unique(data.frame(
    territory_id = territoires$territoire[territoires$type %in% descriptor$levels],
    territory_type = territoires$type[territoires$type %in% descriptor$levels],
    stringsAsFactors = FALSE))
  validate_declared_profile(projected, descriptor, axes, eligible)
  if (!all(c("vintage_source", "vintage_version", "vintage_date_reference", "vintage_date_publication") %in% names(facts)))
    stop("Canonical structure_age facts have no source vintage fields", call. = FALSE)
  source_id <- descriptor$source[[1L]]
  version <- as.character(facts$vintage_version)
  vintage_id <- paste(version, facts$vintage_date_reference, sep = "/")
  provenance <- unique(data.frame(indicator_id = "structure_age", territory_id = projected$territory_id,
    detail_key = projected$detail, sex_key = projected$sex, source_id = source_id,
    vintage_id = paste(as.character(facts$vintage_version), facts$vintage_date_reference, sep = "/"),
    stringsAsFactors = FALSE))
  vintages <- unique(data.frame(source_id = source_id, vintage_id = vintage_id, version = version,
    reference_date = as.Date(facts$vintage_date_reference),
    publication_date = as.Date(facts$vintage_date_publication), stringsAsFactors = FALSE))
  datasets <- data.frame(source_id = source_id,
    name = unique(as.character(facts$vintage_source))[[1L]], stringsAsFactors = FALSE)
  if (length(unique(as.character(facts$vintage_source))) != 1L)
    stop("structure_age source identity maps to conflicting source names", call. = FALSE)
  descriptor$descriptor_version <- profile_content_version(list(descriptor, axes))
  list(facts = projected, axes = axes, descriptor = descriptor, provenance = provenance,
    vintages = vintages, datasets = datasets, eligible_territories = eligible)
}

profile_content_version <- function(projection) {
  path <- tempfile("profile-version-")
  on.exit(unlink(path), add = TRUE)
  saveRDS(projection, path, version = 3)
  unname(tools::md5sum(path))
}

register_profile_publisher <- function(registry, name, project, publish) {
  if (!is.list(registry) || !is.function(project) || !is.function(publish) ||
      length(name) != 1L || !nzchar(name) || name %in% names(registry))
    stop("Invalid or duplicate profile publisher registration", call.=FALSE)
  registry[[name]] <- list(project=project, publish=publish)
  registry
}

publish_registered_profile <- function(registry, name, canonical, db) {
  publisher <- registry[[name]]
  if (is.null(publisher)) stop("Unregistered profile publisher", call.=FALSE)
  projection <- publisher$project(canonical)
  validate_declared_profile(projection$facts, projection$descriptor,
    projection$axes, projection$eligible_territories)
  provenance <- projection$provenance
  provenance_fields <- c("indicator_id", "territory_id", "detail_key", "sex_key", "source_id", "vintage_id")
  fact_keys <- paste("structure_age", projection$facts$territory_id, projection$facts$detail,
    projection$facts$sex, sep="\r")
  provenance_keys <- if (is.data.frame(provenance) && all(provenance_fields %in% names(provenance)))
    paste(provenance$indicator_id, provenance$territory_id, provenance$detail_key, provenance$sex_key, sep="\r") else character()
  if (!is.data.frame(provenance) || !setequal(names(provenance), provenance_fields) ||
      anyNA(provenance[provenance_fields]) || anyDuplicated(provenance[provenance_fields]) ||
      any(provenance$source_id != projection$descriptor$source[[1L]]) ||
      !setequal(fact_keys, provenance_keys) ||
      any(!paste(provenance$source_id, provenance$vintage_id) %in%
          paste(projection$vintages$source_id, projection$vintages$vintage_id)) ||
      any(!provenance$source_id %in% projection$datasets$source_id))
    stop("Invalid or incomplete profile provenance associations", call.=FALSE)
  version <- profile_content_version(projection)
  db$transaction({
    if (is.function(db$lock)) db$lock()
    reference <- db$reference_marker()
    if (!nrow(reference) || is.na(reference$content_version[[1L]]) ||
        !nzchar(reference$content_version[[1L]]) ||
        (all(c("row_count", "actual_rows") %in% names(reference)) &&
         reference$row_count[[1L]] != reference$actual_rows[[1L]]))
      stop("Territory reference has no committed publication marker", call.=FALSE)
    db$validate_territories(projection$eligible_territories, projection$descriptor)
    marker <- db$marker("declared_profile")
    changed <- !(nrow(marker) && identical(as.character(marker$content_version[[1L]]), version))
    reference_changed <- !changed && "reference_content_version" %in% names(marker) &&
      !identical(as.character(marker$reference_content_version[[1L]]), as.character(reference$content_version[[1L]]))
    if (changed) publisher$publish(projection, db, version)
    else if (reference_changed && is.function(db$set_reference_version)) db$set_reference_version(reference$content_version[[1L]])
    invisible(list(changed=changed, compatibility_updated=reference_changed, content_version=version))
  })
}

register_structure_age_profile_publisher <- function(registry, metadata) {
  register_profile_publisher(registry, "structure_age", function(canonical) {
    project_structure_age_profile(canonical, metadata)
  }, function(projection, db, version) db$replace(projection, version))
}

profile_postgres_adapter <- function(con) {
  if (!requireNamespace("DBI", quietly = TRUE)) stop("DBI is required")
  list(
    transaction = function(expr) DBI::dbWithTransaction(con, expr),
    lock = function() DBI::dbGetQuery(con, "SELECT pg_advisory_xact_lock(596, 1)"),
    marker = function(name) DBI::dbGetQuery(con,
      "SELECT content_version,reference_content_version FROM table_publication WHERE table_name=$1", params=list(name)),
    reference_marker = function() DBI::dbGetQuery(con,
      "SELECT p.content_version,p.row_count,(SELECT count(*) FROM territory_reference) AS actual_rows FROM table_publication p WHERE p.table_name='territory_reference'"),
    set_reference_version = function(version) DBI::dbExecute(con,
      "UPDATE table_publication SET reference_content_version=$1 WHERE table_name='declared_profile'", params=list(version)),
    validate_territories = function(territories, descriptor) {
      actual <- DBI::dbGetQuery(con, "SELECT territory_id,territory_type FROM territory_reference")
      actual <- actual[actual$territory_type %in% unlist(descriptor$levels, use.names=FALSE), , drop=FALSE]
      expected <- unique(territories[c("territory_id","territory_type")])
      if (!setequal(paste(actual$territory_type,actual$territory_id),paste(expected$territory_type,expected$territory_id)))
        stop("Profile eligible territory universe differs from committed reference", call.=FALSE)
    },
    replace = function(projection, version) {
      for (i in seq_len(nrow(projection$datasets))) DBI::dbExecute(con,
        "INSERT INTO source_dataset(source_id,name) VALUES($1,$2) ON CONFLICT(source_id) DO UPDATE SET name=EXCLUDED.name",
        params=unname(as.list(projection$datasets[i,])))
      for (i in seq_len(nrow(projection$vintages))) DBI::dbExecute(con,
        "INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date) VALUES($1,$2,$3,$4,$5) ON CONFLICT(source_id,vintage_id) DO UPDATE SET version=EXCLUDED.version,reference_date=EXCLUDED.reference_date,publication_date=EXCLUDED.publication_date",
        params=unname(as.list(projection$vintages[i,])))
      DBI::dbExecute(con, "DELETE FROM profile_observation")
      DBI::dbExecute(con, "DELETE FROM profile_descriptor_source")
      DBI::dbExecute(con, "DELETE FROM profile_descriptor")
      d <- projection$descriptor
      levels_sql <- paste(as.character(DBI::dbQuoteString(con, as.character(d$levels))), collapse=",")
      DBI::dbExecute(con, paste0("INSERT INTO profile_descriptor(indicator_id,label,unit,allowed_levels,completeness,descriptor_version,comparison_detail,comparison_sex,comparison_direction) VALUES($1,$2,$3,ARRAY[",
        levels_sql,
        "]::text[],'dense_complete',$4,$5,$6,$7)"),
        params=list("structure_age", d$label, d$unit, d$descriptor_version,
          d$comparison_detail, d$comparison_sex, d$comparison_direction))
      DBI::dbExecute(con, "INSERT INTO profile_descriptor_source(indicator_id,source_id) VALUES('structure_age',$1)", params=list(d$source[[1L]]))
      DBI::dbWriteTable(con,"profile_axis",transform(projection$axes,indicator_id="structure_age"),append=TRUE,row.names=FALSE)
      obs <- projection$facts
      names(obs)[names(obs)=="detail"] <- "detail_key"
      names(obs)[names(obs)=="sex"] <- "sex_key"
      DBI::dbWriteTable(con,"profile_observation",transform(obs,indicator_id="structure_age"),append=TRUE,row.names=FALSE)
      DBI::dbWriteTable(con,"profile_observation_source",projection$provenance,append=TRUE,row.names=FALSE)
      actual_rows <- DBI::dbGetQuery(con,
        "SELECT count(*) AS n FROM profile_observation WHERE indicator_id='structure_age'")$n[[1L]]
      if (actual_rows != nrow(projection$facts))
        stop("Published profile row count differs from validated projection", call.=FALSE)
      reference <- DBI::dbGetQuery(con,"SELECT content_version FROM table_publication WHERE table_name='territory_reference'")
      if (!nrow(reference)) stop("Territory reference publication is unavailable", call.=FALSE)
      DBI::dbExecute(con,"INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version,published_at) VALUES('declared_profile',$1,$2,$3,now()) ON CONFLICT(table_name) DO UPDATE SET content_version=EXCLUDED.content_version,row_count=EXCLUDED.row_count,reference_content_version=EXCLUDED.reference_content_version,published_at=EXCLUDED.published_at",
        params=list(version,nrow(projection$facts),reference$content_version[[1L]]))
    })
}

publier_structure_age_profile_postgres <- function(payload, metadata) {
  config <- configuration_service_postgres()
  con <- do.call(DBI::dbConnect, c(list(drv=RPostgres::Postgres()), config))
  tryCatch({
    registry <- register_structure_age_profile_publisher(list(), metadata)
    publish_registered_profile(registry, "structure_age", payload, profile_postgres_adapter(con))
  }, finally = DBI::dbDisconnect(con))
}
