# Scoped retained publication plan (#995) ---------------------------------------
# A scoped scalar publication does not republish the whole retained backend. It
# derives the registered dependency closure from the producer metadata:
#   - the scalar snapshot + its comparison (whole-snapshot writer);
#   - every declared profile that carries a `required_scalar_version` binding
#     (the scalar snapshot token is global, so all bound profiles are affected);
#   - every typed-reading resource whose declared `source_keys` intersect those
#     profile `comparison_scalar` facets (the linked Habitat selected reading).
# The territory reference must match the target generation but is never
# rewritten by this path.
#
# Demographic, economy, Milieux and owned-series owners are OUTSIDE the plan:
# their rows and publication markers are neither read as expectations nor
# published, so a newer live version of an unrelated owner is not a baseline
# mismatch for a scoped publication.
#
# The same plan object drives the baseline guard, the write and the recovery:
# `target` is the generation being published, `current` is the generation the
# live markers must currently show. The direction is derived from which side
# carries the scoped indicators, so the operator uses one normal wrapper call:
#   forward  : target = candidate (with the scope), current = prior baseline;
#   recovery : target = frozen prior baseline (without the scope), current =
#              the successfully published candidate.
# Recovery publishes the baseline snapshot through the same registered scalar
# publisher with the normal explicit retirement policy, so the scoped
# indicators are removed by omission, not by ad-hoc SQL.

scoped_reading_publishers <- function() {
  list(demographie = publish_demographic_reading,
       habitat = publish_habitat_reading,
       economie = publish_economy_reading_family,
       milieux = publish_milieux_reading)
}

# scoped_affected_readings ------------------------------------------------------
# The selected-reading owners whose declared resource reads a comparison scalar
# facet produced by a scalar-bound profile. Derived from the producer metadata,
# never from a hardcoded owner list.
scoped_affected_readings <- function(metadata_list, bound_profiles) {
  facets <- unique(unlist(lapply(bound_profiles, function(profile) {
    descriptor <- profile$descriptor
    if (is.null(descriptor$comparison_scalar)) return(NULL)
    value <- as.character(descriptor$comparison_scalar)
    value[nzchar(value)]
  }), use.names = FALSE))
  if (!length(facets)) return(character())
  owners <- character()
  for (metadata in metadata_list) {
    for (resource in metadata$semantic_resources %||% list()) {
      if (!identical(resource$kind, "typed_reading")) next
      keys <- as.character(unlist(resource$source_keys, use.names = FALSE))
      if (length(intersect(keys, facets)))
        owners <- c(owners, metadata$theme)
    }
  }
  unique(owners)
}

# scoped_snapshot_delta ---------------------------------------------------------
# Pure proof of the scoped delta: the two full snapshots must be identical once
# the scoped indicators are removed, and exactly one side must carry them.
scoped_snapshot_delta <- function(target_snapshot, current_snapshot, scope_ids) {
  if (!is.character(scope_ids) || !length(scope_ids) || anyNA(scope_ids) ||
      any(!nzchar(scope_ids)) || anyDuplicated(scope_ids))
    stop("Scoped publication requires a non-empty, unique indicator scope",
         call. = FALSE)
  target_without <- retained_baseline_scalar(target_snapshot$scalar, scope_ids)
  current_without <- retained_baseline_scalar(current_snapshot$scalar, scope_ids)
  if (!identical(target_without, current_without))
    stop("Target and current scalar generations differ outside the scoped ",
         "indicators; retrieve the exact counterpart generation instead of ",
         "forcing a partial snapshot.", call. = FALSE)
  target_has <- scope_ids %in% target_snapshot$scalar$descriptors$indicator_id
  current_has <- scope_ids %in% current_snapshot$scalar$descriptors$indicator_id
  if (all(target_has) && !any(current_has)) {
    direction <- "forward"
  } else if (!any(target_has) && all(current_has)) {
    direction <- "recovery"
  } else {
    stop("Scoped indicators must be present in exactly one generation ",
         "(target present: ", paste(scope_ids[target_has], collapse = ", "),
         "; current present: ", paste(scope_ids[current_has], collapse = ", "),
         "); refusing.", call. = FALSE)
  }
  list(direction = direction, without_scope = target_without)
}

# scoped_projection_sources -----------------------------------------------------
# The exact source_dataset/source_vintage rows the registered scalar and
# declared-profile publishers will upsert for a generation. Derived from the
# projections, not from a hardcoded owner list.
scoped_projection_sources <- function(snapshot, profiles) {
  datasets <- snapshot$scalar$datasets
  vintages <- snapshot$scalar$vintages
  for (profile in profiles) {
    datasets <- rbind(datasets, profile$datasets)
    vintages <- rbind(vintages, profile$vintages)
  }
  datasets <- unique(datasets)
  vintages <- unique(vintages)
  rownames(datasets) <- NULL
  rownames(vintages) <- NULL
  list(datasets = datasets, vintages = vintages)
}

scoped_source_vintage_key <- function(source_id, vintage_id)
  paste(source_id, vintage_id, sep = "\r")

scoped_source_keys <- function(sources) {
  list(datasets = as.character(sources$datasets$source_id),
       vintages = scoped_source_vintage_key(sources$vintages$source_id,
                                            sources$vintages$vintage_id))
}

# scoped_source_difference ------------------------------------------------------
# Rows present in the current generation but not in the target generation. In a
# recovery these are the forward-introduced scope rows that may be retired when
# no owner table references them.
scoped_source_difference <- function(current, target) {
  current_keys <- scoped_source_keys(current)
  target_keys <- scoped_source_keys(target)
  datasets <- current$datasets[
    !current_keys$datasets %in% target_keys$datasets, , drop = FALSE]
  vintages <- current$vintages[
    !current_keys$vintages %in% target_keys$vintages, , drop = FALSE]
  rownames(datasets) <- NULL
  rownames(vintages) <- NULL
  list(datasets = datasets, vintages = vintages)
}

# scoped_publication_plan -------------------------------------------------------
scoped_publication_plan <- function(target_dir, current_dir, scope_ids) {
  for (directory in c(target_dir, current_dir)) {
    if (!dir.exists(directory))
      stop("Publication artifact sortie is missing: ", directory,
           call. = FALSE)
  }
  territories_path <- function(directory)
    file.path(directory, "territoires.parquet")
  target_reference <- project_territory_reference(
    nanoparquet::read_parquet(territories_path(target_dir)))
  current_reference <- project_territory_reference(
    nanoparquet::read_parquet(territories_path(current_dir)))
  if (!identical(target_reference$content_version,
                 current_reference$content_version))
    stop("Target and current territory references differ; the scoped ",
         "publication never rewrites a different reference.", call. = FALSE)
  target_snapshot <- project_retained_scalar_snapshot(target_dir,
                                                      target_reference)
  current_snapshot <- project_retained_scalar_snapshot(current_dir,
                                                       current_reference)
  relation <- scoped_snapshot_delta(target_snapshot, current_snapshot,
                                    scope_ids)

  reference <- target_reference
  no_scope <- if (identical(relation$direction, "forward"))
    current_snapshot else target_snapshot
  expected_comparison <- project_scalar_comparisons(
    relation$without_scope, reference$rows,
    input_scalar_content_version = scalar_content_version(
      relation$without_scope),
    reference_content_version = reference$content_version)
  if (!identical(expected_comparison$content_version,
                 no_scope$comparison$content_version))
    stop("The scoped comparison projection does not match the generation ",
         "without the scoped indicators; refusing.", call. = FALSE)
  target_scalar_version <- scalar_content_version(target_snapshot$scalar)
  current_scalar_version <- scalar_content_version(current_snapshot$scalar)

  target_profile <- retained_profile_publication(target_dir,
    target_scalar_version, reference$content_version)
  current_profile <- retained_profile_publication(current_dir,
    current_scalar_version, reference$content_version)
  strip_binding <- function(profile) {
    profile$descriptor$required_scalar_version <- NULL
    profile
  }
  if (!identical(lapply(target_profile$profiles, strip_binding),
                 lapply(current_profile$profiles, strip_binding)))
    stop("Target and current declared-profile facts/descriptors differ outside ",
         "the scalar binding; a scoped publication must not replace unrelated ",
         "owner facts.", call. = FALSE)
  bound <- function(profile) names(profile$profiles)[vapply(
    profile$profiles,
    function(item) !is.null(item$descriptor$required_scalar_version),
    logical(1))]
  if (!setequal(bound(target_profile), bound(current_profile)))
    stop("Target and current declared-profile binding sets differ; refusing.",
         call. = FALSE)
  bound_profiles <- target_profile$profiles[bound(target_profile)]

  target_sources <- scoped_projection_sources(target_snapshot,
                                              target_profile$profiles)
  current_sources <- scoped_projection_sources(current_snapshot,
                                               current_profile$profiles)
  retire_sources <- scoped_source_difference(current_sources, target_sources)

  metadata_list <- lapply(THEMES_METADATA, lire_theme_metadata)
  reading_owners <- scoped_affected_readings(metadata_list, bound_profiles)
  if (length(reading_owners) > 1L)
    stop("Scoped plan supports one selected-reading owner; found: ",
         paste(reading_owners, collapse = ", "), call. = FALSE)
  read_owner <- function(directory, owner)
    read_typed_reading_publication_from(directory, owner)
  target_reading <- if (length(reading_owners))
    read_owner(target_dir, reading_owners[[1L]]) else NULL
  current_reading <- if (length(reading_owners))
    read_owner(current_dir, reading_owners[[1L]]) else NULL
  if (length(reading_owners) &&
      !identical(target_reading$content_version, current_reading$content_version))
    stop("The affected selected-reading artifact differs between target and ",
         "current; a scoped publication must not replace it.", call. = FALSE)

  linked_version <- function(publication, profile_version, scalar_version) {
    if (is.null(publication)) return(character())
    retained_selected_linked_version(publication, profile_version,
                                     scalar_version,
                                     reference$content_version)
  }
  profile_descriptor_expectations <- function(profile, owners) {
    data.frame(
      indicator_id = owners,
      descriptor_version = vapply(owners, function(owner)
        as.character(profile$profiles[[owner]]$descriptor$descriptor_version[[1L]]),
        character(1)),
      required_scalar_version = vapply(owners, function(owner)
        as.character(
          profile$profiles[[owner]]$descriptor$required_scalar_version[[1L]]),
        character(1)),
      stringsAsFactors = FALSE)
  }
  list(
    direction = relation$direction,
    target_dir = target_dir,
    current_dir = current_dir,
    reference = reference$content_version,
    scope_ids = scope_ids,
    target_snapshot = target_snapshot,
    current_snapshot = current_snapshot,
    target_scalar_version = target_scalar_version,
    current_scalar_version = current_scalar_version,
    target_comparison_version = target_snapshot$comparison$content_version,
    current_comparison_version = current_snapshot$comparison$content_version,
    profile_owners = declared_profile_owners(),
    bound_profiles = bound(target_profile),
    target_sources = target_sources,
    current_sources = current_sources,
    retire_sources = retire_sources,
    target_profile_descriptors = profile_descriptor_expectations(
      target_profile, bound(target_profile)),
    current_profile_descriptors = profile_descriptor_expectations(
      current_profile, bound(current_profile)),
    target_profile_version = target_profile$version,
    current_profile_version = current_profile$version,
    target_profile_comparison_version = target_profile$comparison_version,
    current_profile_comparison_version = current_profile$comparison_version,
    reading_owners = reading_owners,
    target_reading_version = if (length(reading_owners))
      target_reading$content_version else character(),
    current_reading_version = if (length(reading_owners))
      current_reading$content_version else character(),
    target_linked_version = linked_version(target_reading,
      target_profile$version, target_scalar_version),
    current_linked_version = linked_version(current_reading,
      current_profile$version, current_scalar_version)
  )
}

scoped_publication_markers <- function(con, plan) {
  names <- c("territory_reference", "scalar_observation", "declared_profile")
  if (length(plan$reading_owners)) names <- c(names, "selected_reading")
  placeholders <- paste0("$", seq_along(names), collapse = ",")
  tables <- DBI::dbGetQuery(con, paste0(
    "SELECT table_name, content_version, reference_content_version ",
    "FROM table_publication WHERE table_name IN (", placeholders, ")"),
    params = as.list(names))
  owners <- as.character(plan$bound_profiles)
  profile_placeholders <- paste0("$", seq_along(owners), collapse = ",")
  profile_descriptors <- DBI::dbGetQuery(con, paste0(
    "SELECT indicator_id, descriptor_version, required_scalar_version ",
    "FROM profile_descriptor WHERE indicator_id IN (", profile_placeholders,
    ")"), params = as.list(owners))
  reading_owner <- if (length(plan$reading_owners))
    plan$reading_owners[[1L]] else character()
  selected_publication <- if (length(reading_owner)) DBI::dbGetQuery(con,
    paste0("SELECT content_version, reference_content_version ",
      "FROM selected_reading_publication WHERE theme_id=$1"),
    params = list(reading_owner)) else data.frame(
      content_version = character(), reference_content_version = character(),
      stringsAsFactors = FALSE)
  selected_descriptor <- if (length(reading_owner)) DBI::dbGetQuery(con,
    paste0("SELECT descriptor_version, linked_content_version ",
      "FROM selected_reading_descriptor WHERE theme_id=$1"),
    params = list(reading_owner)) else data.frame(
      descriptor_version = character(), linked_content_version = character(),
      stringsAsFactors = FALSE)
  list(
    tables = tables,
    scalar_comparison = DBI::dbGetQuery(con, paste0(
      "SELECT content_version, scalar_content_version, reference_content_version ",
      "FROM scalar_comparison_publication WHERE singleton")),
    profile_comparison = DBI::dbGetQuery(con, paste0(
      "SELECT content_version, profile_content_version, reference_content_version ",
      "FROM profile_comparison_publication WHERE singleton")),
    profile_descriptors = profile_descriptors,
    selected_publication = selected_publication,
    selected_descriptor = selected_descriptor
  )
}

# The live markers must be exactly the `current` generation; the plan's target
# generation is what the write will install (and the recovery guard is the same
# check, just with the candidate as current).
scoped_expected_markers <- function(plan) {
  list(
    reference = plan$reference,
    scalar = plan$current_scalar_version,
    scalar_comparison = plan$current_comparison_version,
    profile = plan$current_profile_version,
    profile_comparison = plan$current_profile_comparison_version,
    profile_descriptors = plan$current_profile_descriptors,
    reading_owner = if (length(plan$reading_owners))
      plan$reading_owners[[1L]] else character(),
    reading = plan$current_reading_version,
    linked = plan$current_linked_version
  )
}

verifier_scoped_publication <- function(markers, expected,
                                        reading_owner = character()) {
  mismatches <- list()
  add <- function(marker, field, live, want) {
    mismatches[[length(mismatches) + 1L]] <<- data.frame(
      marker = marker, field = field,
      live = if (length(live)) as.character(live[[1L]]) else NA_character_,
      expected = as.character(want), stringsAsFactors = FALSE)
  }
  table_marker <- function(name) {
    rows <- markers$tables[markers$tables$table_name == name, , drop = FALSE]
    if (nrow(rows) != 1L) {
      add(name, "presence", NA_character_, "exactly one marker")
      return(NULL)
    }
    rows[1L, , drop = FALSE]
  }
  expect_table <- function(name, version, reference = TRUE) {
    marker <- table_marker(name)
    if (is.null(marker)) return(invisible(NULL))
    if (!identical(as.character(marker$content_version[[1L]]),
                   as.character(version)))
      add(name, "content_version", marker$content_version[[1L]], version)
    if (isTRUE(reference) &&
        !identical(as.character(marker$reference_content_version[[1L]]),
                   as.character(expected$reference)))
      add(name, "reference_content_version",
          marker$reference_content_version[[1L]], expected$reference)
  }
  expect_table("territory_reference", expected$reference, reference = FALSE)
  expect_table("scalar_observation", expected$scalar)
  expect_table("declared_profile", expected$profile)
  comparison <- markers$scalar_comparison
  if (nrow(comparison) != 1L) {
    add("scalar_comparison_publication", "presence", NA_character_,
        "exactly one singleton")
  } else {
    if (!identical(as.character(comparison$content_version[[1L]]),
                   as.character(expected$scalar_comparison)))
      add("scalar_comparison_publication", "content_version",
          comparison$content_version[[1L]], expected$scalar_comparison)
    if (!identical(as.character(comparison$scalar_content_version[[1L]]),
                   as.character(expected$scalar)))
      add("scalar_comparison_publication", "scalar_content_version",
          comparison$scalar_content_version[[1L]], expected$scalar)
    if (!identical(as.character(comparison$reference_content_version[[1L]]),
                   as.character(expected$reference)))
      add("scalar_comparison_publication", "reference_content_version",
          comparison$reference_content_version[[1L]], expected$reference)
  }
  pc <- markers$profile_comparison
  if (nrow(pc) != 1L) {
    add("profile_comparison_publication", "presence", NA_character_,
        "exactly one singleton")
  } else {
    if (!identical(as.character(pc$content_version[[1L]]),
                   as.character(expected$profile_comparison)))
      add("profile_comparison_publication", "content_version",
          pc$content_version[[1L]], expected$profile_comparison)
    if (!identical(as.character(pc$profile_content_version[[1L]]),
                   as.character(expected$profile)))
      add("profile_comparison_publication", "profile_content_version",
          pc$profile_content_version[[1L]], expected$profile)
    if (!identical(as.character(pc$reference_content_version[[1L]]),
                   as.character(expected$reference)))
      add("profile_comparison_publication", "reference_content_version",
          pc$reference_content_version[[1L]], expected$reference)
  }
  pd_live <- markers$profile_descriptors
  expected_pd <- expected$profile_descriptors
  for (i in seq_len(nrow(expected_pd))) {
    want <- expected_pd[i, , drop = FALSE]
    live <- pd_live[pd_live$indicator_id == want$indicator_id, , drop = FALSE]
    label <- paste0("profile_descriptor[", want$indicator_id[[1L]], "]")
    if (nrow(live) != 1L) {
      add(label, "presence", NA_character_, "exactly one row")
      next
    }
    if (!identical(as.character(live$descriptor_version[[1L]]),
                   as.character(want$descriptor_version[[1L]])))
      add(label, "descriptor_version", live$descriptor_version[[1L]],
          want$descriptor_version[[1L]])
    if (!identical(as.character(live$required_scalar_version[[1L]]),
                   as.character(want$required_scalar_version[[1L]])))
      add(label, "required_scalar_version",
          live$required_scalar_version[[1L]],
          want$required_scalar_version[[1L]])
  }
  owner <- if (length(reading_owner)) as.character(reading_owner[[1L]]) else
    as.character(expected$reading_owner)
  if (length(owner) && nzchar(owner)) {
    expect_table("selected_reading", expected$reading)
    sp <- markers$selected_publication
    if (nrow(sp) != 1L) {
      add(paste0("selected_reading_publication[", owner, "]"), "presence",
          NA_character_, "exactly one row")
    } else {
      if (!identical(as.character(sp$content_version[[1L]]),
                     as.character(expected$reading)))
        add(paste0("selected_reading_publication[", owner, "]"),
            "content_version", sp$content_version[[1L]], expected$reading)
      if (!identical(as.character(sp$reference_content_version[[1L]]),
                     as.character(expected$reference)))
        add(paste0("selected_reading_publication[", owner, "]"),
            "reference_content_version", sp$reference_content_version[[1L]],
            expected$reference)
    }
    sd <- markers$selected_descriptor
    if (nrow(sd) != 1L) {
      add(paste0("selected_reading_descriptor[", owner, "]"), "presence",
          NA_character_, "exactly one row")
    } else {
      if (!identical(as.character(sd$descriptor_version[[1L]]),
                     as.character(expected$reading)))
        add(paste0("selected_reading_descriptor[", owner, "]"),
            "descriptor_version", sd$descriptor_version[[1L]], expected$reading)
      if (!identical(as.character(sd$linked_content_version[[1L]]),
                     as.character(expected$linked)))
        add(paste0("selected_reading_descriptor[", owner, "]"),
            "linked_content_version", sd$linked_content_version[[1L]],
            expected$linked)
    }
  }
  if (!length(mismatches)) return(data.frame(
    marker = character(), field = character(), live = character(),
    expected = character(), stringsAsFactors = FALSE))
  do.call(rbind, mismatches)
}

scoped_live_sources <- function(con) {
  list(
    datasets = DBI::dbGetQuery(con,
      "SELECT source_id, name FROM source_dataset ORDER BY source_id"),
    vintages = DBI::dbGetQuery(con, paste(
      "SELECT source_id, vintage_id, version, reference_date, publication_date",
      "FROM source_vintage ORDER BY source_id, vintage_id")))
}

# scoped_source_guard -----------------------------------------------------------
# The source_dataset/source_vintage rows the closure publishers will upsert are
# part of the affected state. Every target row that already exists live must
# match exactly; a newer shared row hard-refuses with zero writes. Target rows
# absent live are recorded so a recovery can retire them after the closure
# writes if no owner table references them.
scoped_source_guard <- function(plan, live) {
  target <- plan$target_sources
  mismatches <- list()
  absent <- list(datasets = character(), vintages = character())
  add <- function(marker, field, live_value, expected) {
    mismatches[[length(mismatches) + 1L]] <<- data.frame(
      marker = marker, field = field,
      live = if (length(live_value)) as.character(live_value[[1L]]) else NA_character_,
      expected = as.character(expected), stringsAsFactors = FALSE)
  }
  for (i in seq_len(nrow(target$datasets))) {
    row <- target$datasets[i, , drop = FALSE]
    id <- row$source_id[[1L]]
    hit <- live$datasets[live$datasets$source_id == id, , drop = FALSE]
    if (!nrow(hit)) {
      absent$datasets <- c(absent$datasets, id)
      next
    }
    if (!identical(as.character(hit$name[[1L]]), as.character(row$name[[1L]])))
      add(paste0("source_dataset[", id, "]"), "name", hit$name[[1L]],
          row$name[[1L]])
  }
  live_keys <- scoped_source_vintage_key(live$vintages$source_id,
                                         live$vintages$vintage_id)
  for (i in seq_len(nrow(target$vintages))) {
    row <- target$vintages[i, , drop = FALSE]
    key <- scoped_source_vintage_key(row$source_id[[1L]],
                                     row$vintage_id[[1L]])
    hit <- live$vintages[live_keys == key, , drop = FALSE]
    if (!nrow(hit)) {
      absent$vintages <- c(absent$vintages, key)
      next
    }
    marker <- paste0("source_vintage[", row$source_id[[1L]], "|",
                     row$vintage_id[[1L]], "]")
    for (field in c("version", "reference_date", "publication_date")) {
      if (!identical(as.character(hit[[field]][[1L]]),
                     as.character(row[[field]][[1L]])))
        add(marker, field, hit[[field]][[1L]], row[[field]][[1L]])
    }
  }
  if (!length(mismatches)) mismatches <- data.frame(
    marker = character(), field = character(), live = character(),
    expected = character(), stringsAsFactors = FALSE)
  else mismatches <- do.call(rbind, mismatches)
  list(mismatches = mismatches, absent = absent)
}

scoped_source_retirement <- function(plan, absent_sources) {
  absent_sources <- absent_sources %||%
    list(datasets = character(), vintages = character())
  datasets <- plan$retire_sources$datasets
  vintages <- plan$retire_sources$vintages
  if (length(absent_sources$datasets)) {
    add <- plan$target_sources$datasets[
      plan$target_sources$datasets$source_id %in% absent_sources$datasets, ,
      drop = FALSE]
    datasets <- rbind(datasets, add)
  }
  if (length(absent_sources$vintages)) {
    keys <- scoped_source_vintage_key(plan$target_sources$vintages$source_id,
                                      plan$target_sources$vintages$vintage_id)
    add <- plan$target_sources$vintages[
      keys %in% absent_sources$vintages, , drop = FALSE]
    vintages <- rbind(vintages, add)
  }
  datasets <- unique(datasets)
  vintages <- unique(vintages)
  rownames(datasets) <- NULL
  rownames(vintages) <- NULL
  list(datasets = datasets, vintages = vintages)
}

# scoped_source_reference_tables ------------------------------------------------
# Every base table in the active serving schema that carries a source_id (and,
# for vintages, a vintage_id) column. This covers both FK-backed references and
# text-only owner references such as the Milieux/series provenance tables.
scoped_source_reference_tables <- function(con) {
  columns <- DBI::dbGetQuery(con, paste(
    "SELECT c.table_name, c.column_name FROM information_schema.columns c",
    "JOIN information_schema.tables t",
    "ON t.table_schema=c.table_schema AND t.table_name=c.table_name",
    "WHERE c.table_schema=current_schema() AND t.table_type='BASE TABLE'",
    "AND c.column_name IN ('source_id','vintage_id')",
    "ORDER BY c.table_name, c.column_name"))
  tables <- unique(columns$table_name)
  has <- function(table, column)
    any(columns$table_name == table & columns$column_name == column)
  list(
    datasets = tables[tables != "source_dataset" &
      vapply(tables, function(table) has(table, "source_id"), logical(1))],
    vintages = tables[tables != "source_vintage" &
      vapply(tables, function(table)
        has(table, "source_id") && has(table, "vintage_id"), logical(1))])
}

scoped_source_is_referenced <- function(con, refs, source_id,
                                        vintage_id = NULL) {
  quote_id <- function(name) as.character(DBI::dbQuoteIdentifier(con, name))
  if (is.null(vintage_id)) {
    for (table in refs$datasets) {
      hit <- DBI::dbGetQuery(con, paste0("SELECT 1 AS hit FROM ",
        quote_id(table), " WHERE source_id=$1 LIMIT 1"),
        params = list(source_id))
      if (nrow(hit)) return(TRUE)
    }
    return(FALSE)
  }
  for (table in refs$vintages) {
    hit <- DBI::dbGetQuery(con, paste0("SELECT 1 AS hit FROM ",
      quote_id(table), " WHERE source_id=$1 AND vintage_id=$2 LIMIT 1"),
      params = list(source_id, vintage_id))
    if (nrow(hit)) return(TRUE)
  }
  FALSE
}

scoped_source_delete <- function(con, sql, params, savepoint) {
  DBI::dbExecute(con, paste0("SAVEPOINT ", savepoint))
  deleted <- tryCatch({
    DBI::dbExecute(con, sql, params = params)
    TRUE
  }, error = function(e) {
    if (!grepl("foreign key", conditionMessage(e), ignore.case = TRUE))
      stop(e)
    FALSE
  })
  if (deleted) {
    DBI::dbExecute(con, paste0("RELEASE SAVEPOINT ", savepoint))
  } else {
    DBI::dbExecute(con, paste0("ROLLBACK TO SAVEPOINT ", savepoint))
    DBI::dbExecute(con, paste0("RELEASE SAVEPOINT ", savepoint))
  }
  deleted
}

# retire_unreferenced_source_rows -----------------------------------------------
# The normal recovery retirement policy for source_dataset/source_vintage rows.
# A row is removed only when no base table in the serving schema references it.
# Shared or referenced rows are preserved, so unrelated Milieux/series owners
# are never cascaded or left dangling.
retire_unreferenced_source_rows <- function(con, datasets, vintages) {
  refs <- scoped_source_reference_tables(con)
  retired_datasets <- character()
  retired_vintages <- character()
  preserved_datasets <- character()
  preserved_vintages <- character()
  for (i in seq_len(nrow(vintages))) {
    row <- vintages[i, , drop = FALSE]
    id <- row$source_id[[1L]]
    vintage <- row$vintage_id[[1L]]
    key <- scoped_source_vintage_key(id, vintage)
    if (scoped_source_is_referenced(con, refs, id, vintage) ||
        !scoped_source_delete(con,
          "DELETE FROM source_vintage WHERE source_id=$1 AND vintage_id=$2",
          list(id, vintage), paste0("source_retire_v_", i))) {
      preserved_vintages <- c(preserved_vintages, key)
    } else {
      retired_vintages <- c(retired_vintages, key)
    }
  }
  for (i in seq_len(nrow(datasets))) {
    id <- datasets$source_id[[i]]
    if (scoped_source_is_referenced(con, refs, id) ||
        !scoped_source_delete(con,
          "DELETE FROM source_dataset WHERE source_id=$1", list(id),
          paste0("source_retire_d_", i))) {
      preserved_datasets <- c(preserved_datasets, id)
    } else {
      retired_datasets <- c(retired_datasets, id)
    }
  }
  list(
    retired = list(datasets = retired_datasets, vintages = retired_vintages),
    preserved = list(datasets = preserved_datasets,
                     vintages = preserved_vintages))
}

assert_scoped_publication_baseline <- function(con, plan) {
  expected <- scoped_expected_markers(plan)
  state <- DBI::dbWithTransaction(con, list(
    markers = scoped_publication_markers(con, plan),
    sources = scoped_live_sources(con)))
  mismatches <- verifier_scoped_publication(state$markers, expected,
    plan$reading_owners)
  source_guard <- scoped_source_guard(plan, state$sources)
  mismatches <- rbind(mismatches, source_guard$mismatches)
  if (nrow(mismatches)) {
    detail <- paste0("  - ", mismatches$marker, ".", mismatches$field,
      ": live=", ifelse(is.na(mismatches$live), "<absent>", mismatches$live),
      " expected=", mismatches$expected, collapse = "\n")
    stop("Scoped publication ",
      if (identical(plan$direction, "recovery")) "recovery " else "baseline ",
      "mismatch on the affected dependency closure; REFUSED with zero writes.\n",
      detail, call. = FALSE)
  }
  invisible(list(expected = expected, markers = state$markers,
                 absent_sources = source_guard$absent))
}

# publish_scoped_retained_backend ----------------------------------------------
# Normal registered publishers, one outer atomic transaction, and only the
# affected closure. Forward installs the target snapshot; recovery also applies
# the scalar publisher's explicit retirement policy for the scoped indicators
# (the three are omitted from the restored generation, not deleted by SQL).
publish_scoped_retained_backend <- function(con, plan, absent_sources = NULL) {
  receipt <- new.env(parent = emptyenv())
  receipt$retirement <- NULL
  with_publication_transaction(con, {
    snapshot <- plan$target_snapshot
    if (identical(plan$direction, "recovery"))
      snapshot$retired_indicator_ids <- unique(c(
        snapshot$retired_indicator_ids, plan$scope_ids))
    publish_retained_scalar_snapshot(con, snapshot, plan$target_dir)
    publier_declared_profiles_postgres(plan$target_dir,
                                       plan$profile_owners, con = con)
    for (owner in plan$reading_owners) {
      publisher <- scoped_reading_publishers()[[owner]]
      if (!is.function(publisher))
        stop("No registered scoped reading publisher for ", owner,
             call. = FALSE)
      publication <- read_typed_reading_publication_from(plan$target_dir, owner)
      publish_typed_reading_publication(
        register_typed_reading_artifact_publisher(list(), owner, publisher),
        owner, publication, con)
    }
    if (identical(plan$direction, "recovery")) {
      candidates <- scoped_source_retirement(plan, absent_sources)
    } else {
      candidates <- scoped_source_retirement(
        list(target_sources = plan$target_sources,
             retire_sources = list(
               datasets = plan$target_sources$datasets[0, , drop = FALSE],
               vintages = plan$target_sources$vintages[0, , drop = FALSE])),
        absent_sources)
    }
    receipt$retirement <- retire_unreferenced_source_rows(
      con, candidates$datasets, candidates$vintages)
    invisible(NULL)
  })
  receipt$retirement
}
