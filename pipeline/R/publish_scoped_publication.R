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
# live markers must currently show. Two explicit intents are supported:
#
#   missing_only (default, #995) : the scoped indicators are present in exactly
#     one generation. Direction follows presence:
#       forward  : target = candidate (with the scope), current = prior baseline;
#       recovery : target = frozen prior baseline (without the scope), current =
#                  the successfully published candidate.
#     Recovery publishes the baseline snapshot through the same registered
#     scalar publisher with the normal explicit retirement policy, so the scoped
#     indicators are removed by omission, not by ad-hoc SQL.
#
#   replacement (#1037) : at least one named scoped indicator is present in
#     both generations, and the ONLY permitted change is an additive level
#     expansion (forward) or its exact reverse (recovery).
#     `scoped_replacement_proof()` checks descriptor fields, allowed levels,
#     descriptor token, shared facts, added/removed facts and provenance before
#     anything else. Explicitly named one-sided indicators keep missing-only
#     semantics inside the same named scope, so a real mixed activation is
#     reviewable; a pure one-sided scope is refused as a missing-only plan, and
#     the missing-only intent never accepts a both-present scope. There is no
#     silent conversion in either direction.
#
# The replacement mode is not a second publisher: it feeds the same registered
# closure and the same guarded atomic transaction.

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

# scoped_publication_intent -----------------------------------------------------
# The operator states the intent explicitly. The default stays missing-only so
# every existing invocation keeps its exact semantics.
scoped_publication_intent <- function(intent = NULL) {
  if (is.null(intent) || !length(intent) || !nzchar(trimws(intent)))
    intent <- "missing_only"
  if (!is.character(intent) || length(intent) != 1L || is.na(intent))
    stop("Scalar publication intent is invalid", call. = FALSE)
  value <- gsub("-", "_", tolower(trimws(intent)))
  if (!value %in% c("missing_only", "replacement"))
    stop("Scalar publication intent must be `missing_only` or `replacement`; ",
         "got `", intent, "`.", call. = FALSE)
  value
}

scoped_assert_scope_ids <- function(scope_ids) {
  if (!is.character(scope_ids) || !length(scope_ids) || anyNA(scope_ids) ||
      any(!nzchar(scope_ids)) || anyDuplicated(scope_ids))
    stop("Scoped publication requires a non-empty, unique indicator scope",
         call. = FALSE)
  invisible(scope_ids)
}

# The scope is only ever the explicitly selected REGISTERED indicators. A
# replacement intent cannot run without an explicit named scope.
scoped_publication_scope <- function(scalar_scope, intent = NULL) {
  intent <- scoped_publication_intent(intent)
  scope_ids <- retained_backend_scope_ids(scalar_scope)
  if (identical(intent, "replacement") && !length(scope_ids))
    stop("Replacement publication requires an explicit registered scalar ",
         "scope (LUSK_SCALAR_SCOPE=<theme>:<registered indicator>,…); ",
         "refusing with zero writes.", call. = FALSE)
  selection <- if (nzchar(scalar_scope)) parse_scalar_scope(scalar_scope) else NULL
  list(intent = intent, selection = selection, scope_ids = scope_ids)
}

# scoped_fact_profile -----------------------------------------------------------
# Normalised fact and provenance rows used by the replacement proof. Typed
# numeric values are compared directly (never stringified), so exactly equal
# doubles pass and any representable change refuses; NA stays NA and NaN is not
# silently merged with NA.
scoped_fact_profile <- function(facts) {
  data.frame(
    key = paste(as.character(facts$indicator_id),
                as.character(facts$territory_id), sep = "\r"),
    indicator_id = as.character(facts$indicator_id),
    territory_id = as.character(facts$territory_id),
    territory_type = as.character(facts$territory_type),
    value = as.numeric(facts$value),
    status = as.character(facts$status),
    support_count = as.integer(facts$support_count),
    denominator_count = as.integer(facts$denominator_count),
    stringsAsFactors = FALSE)
}

scoped_provenance_profile <- function(provenance) {
  data.frame(
    key = paste(as.character(provenance$indicator_id),
                as.character(provenance$territory_id), sep = "\r"),
    indicator_id = as.character(provenance$indicator_id),
    territory_id = as.character(provenance$territory_id),
    source_id = as.character(provenance$source_id),
    vintage_id = as.character(provenance$vintage_id),
    stringsAsFactors = FALSE)
}

# Row order is not semantic for the scoped delta: the canonical artifacts may
# be serialized in a different row order while carrying identical rows. Normalize
# only for the equality proof; the published snapshot keeps its own order.
scoped_order_scalar_projection <- function(projection) {
  order_frame <- function(frame, keys) {
    if (!is.data.frame(frame) || !nrow(frame)) return(frame)
    frame <- frame[do.call(order, c(frame[keys], list(na.last = TRUE,
                                                      method = "radix"))), ,
                   drop = FALSE]
    rownames(frame) <- NULL
    frame
  }
  projection$facts <- order_frame(projection$facts,
                                  c("indicator_id", "territory_id"))
  projection$descriptors <- order_frame(projection$descriptors,
                                        "indicator_id")
  projection$provenance <- order_frame(projection$provenance,
    c("indicator_id", "territory_id", "source_id", "vintage_id"))
  projection$datasets <- order_frame(projection$datasets, "source_id")
  projection$vintages <- order_frame(projection$vintages,
                                     c("source_id", "vintage_id"))
  projection$eligible_territories <- order_frame(
    projection$eligible_territories, c("territory_type", "territory_id"))
  projection
}

scoped_descriptor_field_differences <- function(target, current) {
  fields <- setdiff(names(target), c("allowed_levels", "descriptor_version"))
  fields[!vapply(fields, function(field)
    identical(target[[field]], current[[field]]), logical(1))]
}

scoped_level_summary <- function(facts, scope_id) {
  scoped <- facts[as.character(facts$indicator_id) == scope_id, , drop = FALSE]
  if (!nrow(scoped)) return("")
  counts <- table(as.character(scoped$territory_type))
  paste(paste0(names(counts), "=", as.integer(counts)), collapse = ", ")
}

# scoped_replacement_proof ------------------------------------------------------
# Explicit, narrow replacement capability (#1037). Both generations must carry
# every named indicator; the only permitted change is an additive level
# expansion (forward) or its exact reverse (recovery):
#   - allowed_levels may gain (forward) or lose (recovery) levels, never both;
#   - descriptor_version must advance when levels change and stay identical
#     otherwise;
#   - every other descriptor field is exactly identical;
#   - shared facts are exactly identical on typed values (territory type,
#     value, status, support/denominator counts; row order is not semantic);
#   - added facts exist only at newly admitted levels, removed facts only at
#     levels that disappear;
#   - every scoped fact has at least one provenance association and the
#     association SET of shared facts is exactly identical.
# Anything else is a different capability and is refused.
scoped_replacement_proof <- function(target_scalar, current_scalar, scope_ids) {
  scoped_assert_scope_ids(scope_ids)
  descriptor_row <- function(scalar, id) {
    index <- match(id, as.character(scalar$descriptors$indicator_id))
    if (is.na(index))
      stop("Scoped replacement indicator is not declared in one generation: ",
           id, call. = FALSE)
    row <- scalar$descriptors[index, , drop = FALSE]
    rownames(row) <- NULL
    row
  }
  levels_of <- function(row) {
    values <- as.character(row$allowed_levels[[1L]])
    if (!length(values) || anyNA(values) || anyDuplicated(values))
      stop("Scoped replacement descriptor has invalid allowed levels: ",
           row$indicator_id[[1L]], call. = FALSE)
    values
  }
  target_facts <- scoped_fact_profile(target_scalar$facts)
  current_facts <- scoped_fact_profile(current_scalar$facts)
  target_provenance <- scoped_provenance_profile(target_scalar$provenance)
  current_provenance <- scoped_provenance_profile(current_scalar$provenance)
  rows <- list()
  added_all <- list()
  removed_all <- list()
  gained_all <- character()
  lost_all <- character()
  for (id in scope_ids) {
    target_descriptor <- descriptor_row(target_scalar, id)
    current_descriptor <- descriptor_row(current_scalar, id)
    target_levels <- levels_of(target_descriptor)
    current_levels <- levels_of(current_descriptor)
    changed_fields <- scoped_descriptor_field_differences(target_descriptor,
                                                          current_descriptor)
    if (length(changed_fields))
      stop("Scoped replacement changes descriptor fields outside ",
           "allowed_levels for ", id, ": ",
           paste(changed_fields, collapse = ", "), "; refusing.", call. = FALSE)
    gained <- setdiff(target_levels, current_levels)
    lost <- setdiff(current_levels, target_levels)
    gained_all <- union(gained_all, gained)
    lost_all <- union(lost_all, lost)
    if (length(gained) && length(lost))
      stop("Scoped replacement both adds and removes allowed levels for ", id,
           "; refusing.", call. = FALSE)
    direction <- if (length(gained)) "forward" else if (length(lost))
      "recovery" else "unchanged"
    same_version <- identical(as.character(target_descriptor$descriptor_version),
                              as.character(current_descriptor$descriptor_version))
    if (identical(direction, "unchanged") && !same_version)
      stop("Scoped replacement changed descriptor_version without changing ",
           "allowed_levels for ", id, "; refusing an unexplained descriptor ",
           "change.", call. = FALSE)
    if (!identical(direction, "unchanged") && same_version)
      stop("Scoped replacement added/removed allowed levels for ", id,
           " without advancing descriptor_version; refusing.", call. = FALSE)

    in_target <- target_facts$indicator_id == id
    in_current <- current_facts$indicator_id == id
    target_rows <- target_facts[in_target, , drop = FALSE]
    current_rows <- current_facts[in_current, , drop = FALSE]
    if (anyDuplicated(target_rows$key) || anyDuplicated(current_rows$key))
      stop("Scoped replacement fact keys are duplicated for ", id,
           "; refusing.", call. = FALSE)
    shared <- intersect(target_rows$key, current_rows$key)
    if (length(shared)) {
      target_shared <- target_rows[match(shared, target_rows$key), ,
                                   drop = FALSE]
      current_shared <- current_rows[match(shared, current_rows$key), ,
                                     drop = FALSE]
      rownames(target_shared) <- NULL
      rownames(current_shared) <- NULL
      if (!identical(target_shared, current_shared)) {
        fields <- c("territory_type", "value", "status", "support_count",
                    "denominator_count")
        differing <- fields[!vapply(fields, function(field)
          identical(target_shared[[field]], current_shared[[field]]),
          logical(1))]
        stop("Scoped replacement changes an existing fact for ", id,
             " at territory ", target_shared$territory_id[[1L]], " (",
             paste(differing, collapse = ", "),
             "); a replacement may only add facts at newly admitted levels.",
             call. = FALSE)
      }
    }
    target_added <- target_rows[!target_rows$key %in% current_rows$key, ,
                                drop = FALSE]
    current_removed <- current_rows[!current_rows$key %in% target_rows$key, ,
                                    drop = FALSE]
    if (identical(direction, "unchanged") &&
        (nrow(target_added) || nrow(current_removed)))
      stop("Scoped replacement changes facts for ", id, " without changing ",
           "its allowed levels; refusing.", call. = FALSE)
    if (identical(direction, "forward")) {
      if (nrow(current_removed))
        stop("Scoped replacement removes ", nrow(current_removed),
             " existing fact(s) for ", id,
             "; forward replacement may only add facts.", call. = FALSE)
      off_level <- target_added[!target_added$territory_type %in% gained, ,
                                drop = FALSE]
      if (nrow(off_level))
        stop("Scoped replacement adds a fact for ", id, " at level ",
             off_level$territory_type[[1L]],
             " which was already admitted; refusing.", call. = FALSE)
    }
    if (identical(direction, "recovery")) {
      if (nrow(target_added))
        stop("Scoped replacement recovery adds ", nrow(target_added),
             " fact(s) for ", id,
             "; recovery may only remove facts.", call. = FALSE)
      off_level <- current_removed[!current_removed$territory_type %in% lost, ,
                                   drop = FALSE]
      if (nrow(off_level))
        stop("Scoped replacement recovery removes a fact for ", id, " at ",
             "level ", off_level$territory_type[[1L]],
             " which remains admitted; refusing.", call. = FALSE)
    }

    target_provenance_rows <- target_provenance[
      target_provenance$indicator_id == id, , drop = FALSE]
    current_provenance_rows <- current_provenance[
      current_provenance$indicator_id == id, , drop = FALSE]
    provenance_key <- function(rows) paste(rows$key, rows$source_id,
                                           rows$vintage_id, sep = "\r")
    if (anyDuplicated(provenance_key(target_provenance_rows)) ||
        anyDuplicated(provenance_key(current_provenance_rows)))
      stop("Scoped replacement provenance is duplicated for ", id,
           "; refusing.", call. = FALSE)
    # A fact may legitimately carry several source associations. Compare the
    # complete association SET of every shared fact, never a single row.
    shared_provenance <- function(rows) {
      selected <- rows[rows$key %in% shared,
                       c("key", "source_id", "vintage_id"), drop = FALSE]
      selected <- unique(selected)
      if (nrow(selected))
        selected <- selected[do.call(order, selected), , drop = FALSE]
      rownames(selected) <- NULL
      selected
    }
    if (!identical(shared_provenance(target_provenance_rows),
                   shared_provenance(current_provenance_rows)))
      stop("Scoped replacement changes provenance for an existing fact of ",
           id, "; refusing.", call. = FALSE)
    missing_target_provenance <- setdiff(target_rows$key,
                                         target_provenance_rows$key)
    missing_current_provenance <- setdiff(current_rows$key,
                                          current_provenance_rows$key)
    if (length(missing_target_provenance) ||
        length(missing_current_provenance))
      stop("Scoped replacement fact has no provenance row for ", id,
           "; refusing.", call. = FALSE)

    rows[[length(rows) + 1L]] <- data.frame(
      indicator_id = id,
      direction = direction,
      allowed_levels_before = paste(current_levels, collapse = ","),
      allowed_levels_after = paste(target_levels, collapse = ","),
      added_levels = paste(gained, collapse = ","),
      removed_levels = paste(lost, collapse = ","),
      descriptor_version_before =
        as.character(current_descriptor$descriptor_version),
      descriptor_version_after =
        as.character(target_descriptor$descriptor_version),
      facts_before = nrow(current_rows),
      facts_after = nrow(target_rows),
      facts_shared = length(shared),
      facts_added = nrow(target_added),
      facts_removed = nrow(current_removed),
      facts_added_by_level = scoped_level_summary(target_added, id),
      facts_removed_by_level = scoped_level_summary(current_removed, id),
      stringsAsFactors = FALSE)
    if (nrow(target_added)) added_all[[length(added_all) + 1L]] <- target_added
    if (nrow(current_removed))
      removed_all[[length(removed_all) + 1L]] <- current_removed
  }
  indicators <- do.call(rbind, rows)
  rownames(indicators) <- NULL
  changed <- indicators$direction != "unchanged"
  empty_facts <- target_facts[0, , drop = FALSE]
  if (!any(changed))
    stop("Scoped replacement is a no-op: target and current already carry ",
         "identical scoped descriptors and facts; refusing to publish an ",
         "unchanged generation.", call. = FALSE)
  directions <- unique(indicators$direction[changed])
  if (length(directions) != 1L)
    stop("Scoped replacement indicators move in mixed directions (",
         paste(sort(unique(indicators$direction)), collapse = ", "),
         "); refusing.", call. = FALSE)
  list(
    direction = directions[[1L]],
    indicators = indicators,
    added_facts = if (length(added_all)) do.call(rbind, added_all) else
      empty_facts,
    removed_facts = if (length(removed_all)) do.call(rbind, removed_all) else
      empty_facts,
    gained_levels = gained_all,
    lost_levels = lost_all)
}

# scoped_shared_source_drift ----------------------------------------------------
# Candidate and baseline may not disagree on a shared source row: the live
# guard requires shared rows to match exactly, so a drift here would be a stale
# candidate clock or a newer live row. Refuse it before any connection.
scoped_shared_source_drift <- function(target_sources, current_sources) {
  drift <- character()
  dataset_index <- match(as.character(target_sources$datasets$source_id),
                         as.character(current_sources$datasets$source_id))
  dataset_hit <- !is.na(dataset_index)
  if (any(dataset_hit)) {
    target_names <- as.character(target_sources$datasets$name[dataset_hit])
    current_names <- as.character(
      current_sources$datasets$name[dataset_index[dataset_hit]])
    same_name <- (is.na(target_names) & is.na(current_names)) |
      (!is.na(target_names) & !is.na(current_names) &
         target_names == current_names)
    bad <- as.character(target_sources$datasets$source_id[dataset_hit])[
      !same_name]
    if (length(bad))
      drift <- c(drift, paste0("source_dataset[", bad, "].name"))
  }
  key_target <- scoped_source_vintage_key(target_sources$vintages$source_id,
                                          target_sources$vintages$vintage_id)
  key_current <- scoped_source_vintage_key(current_sources$vintages$source_id,
                                           current_sources$vintages$vintage_id)
  vintage_index <- match(key_target, key_current)
  vintage_hit <- !is.na(vintage_index)
  if (any(vintage_hit)) {
    target_rows <- target_sources$vintages[vintage_hit, , drop = FALSE]
    current_rows <- current_sources$vintages[vintage_index[vintage_hit], ,
                                             drop = FALSE]
    for (field in c("version", "reference_date", "publication_date")) {
      target_value <- as.character(target_rows[[field]])
      current_value <- as.character(current_rows[[field]])
      same <- (is.na(target_value) & is.na(current_value)) |
        (!is.na(target_value) & !is.na(current_value) &
           target_value == current_value)
      if (any(!same))
        drift <- c(drift, paste0("source_vintage[",
          target_rows$source_id[!same], "|", target_rows$vintage_id[!same],
          "].", field))
    }
  }
  unique(drift)
}

scoped_source_clocks_valid <- function(sources) {
  vintages <- sources$vintages
  if (!nrow(vintages)) return(invisible(TRUE))
  if (anyNA(vintages$source_id) || anyNA(vintages$vintage_id) ||
      any(!nzchar(as.character(vintages$source_id))) ||
      any(!nzchar(as.character(vintages$vintage_id))) ||
      anyNA(vintages$version) || any(!nzchar(as.character(vintages$version))))
    stop("Scoped publication source rows have an invalid identity or version",
         call. = FALSE)
  reference <- as.Date(vintages$reference_date)
  publication <- as.Date(vintages$publication_date)
  if (any(!is.na(reference) & !is.na(publication) & publication < reference))
    stop("Scoped publication source clock has a publication date before its ",
         "reference date; refusing.", call. = FALSE)
  invisible(TRUE)
}

# scoped_snapshot_delta ---------------------------------------------------------
# Pure proof of the scoped delta: the two full snapshots must be identical once
# the scoped indicators are removed. The intent decides the remaining rule:
# missing_only -> exactly one side carries them; replacement -> EVERY named
# indicator is present in both generations and changes only by additive level
# expansion (or its exact reverse). Mixed presence is a different capability
# and is refused; it is never folded into this mode.
scoped_snapshot_delta <- function(target_snapshot, current_snapshot, scope_ids,
                                  intent = "missing_only") {
  intent <- scoped_publication_intent(intent)
  scoped_assert_scope_ids(scope_ids)
  target_without <- scoped_order_scalar_projection(
    retained_baseline_scalar(target_snapshot$scalar, scope_ids))
  current_without <- scoped_order_scalar_projection(
    retained_baseline_scalar(current_snapshot$scalar, scope_ids))
  if (identical(intent, "replacement")) {
    # A legitimate level expansion changes the eligible universe by the newly
    # admitted levels only; that is proven by the replacement proof below.
    without_universe <- function(prior) {
      prior$eligible_territories <- NULL
      prior
    }
    if (!identical(without_universe(target_without),
                   without_universe(current_without)))
      stop("Target and current scalar generations differ outside the scoped ",
           "indicators; retrieve the exact counterpart generation instead of ",
           "forcing a partial snapshot.", call. = FALSE)
  } else if (!identical(target_without, current_without)) {
    stop("Target and current scalar generations differ outside the scoped ",
         "indicators; retrieve the exact counterpart generation instead of ",
         "forcing a partial snapshot.", call. = FALSE)
  }
  target_has <- scope_ids %in% target_snapshot$scalar$descriptors$indicator_id
  current_has <- scope_ids %in% current_snapshot$scalar$descriptors$indicator_id
  if (identical(intent, "replacement")) {
    if (!all(target_has) || !all(current_has))
      stop("Replacement publication requires EVERY named scoped indicator in ",
           "both generations (missing from target: ",
           paste(scope_ids[!target_has], collapse = ", "),
           "; missing from current: ",
           paste(scope_ids[!current_has], collapse = ", "),
           "). Mixed presence is a different capability and is refused; use ",
           "the missing-only intent for a one-sided publication.",
           call. = FALSE)
    proof <- scoped_replacement_proof(target_snapshot$scalar,
                                      current_snapshot$scalar, scope_ids)
    gained <- proof$gained_levels
    lost <- proof$lost_levels
    universe_key <- function(scalar) paste(
      as.character(scalar$eligible_territories$territory_type),
      as.character(scalar$eligible_territories$territory_id), sep = "\r")
    universe_added <- setdiff(universe_key(target_snapshot$scalar),
                              universe_key(current_snapshot$scalar))
    universe_removed <- setdiff(universe_key(current_snapshot$scalar),
                                universe_key(target_snapshot$scalar))
    universe_type <- function(key) sub("\r.*$", "", key)
    if (any(!universe_type(universe_added) %in% gained))
      stop("Scoped replacement adds eligible territories outside the newly ",
           "admitted levels; refusing.", call. = FALSE)
    if (any(!universe_type(universe_removed) %in% lost))
      stop("Scoped replacement removes eligible territories outside the ",
           "levels it stops admitting; refusing.", call. = FALSE)
    return(list(direction = proof$direction, without_scope = target_without,
                intent = intent, indicators = proof$indicators,
                added_facts = proof$added_facts,
                removed_facts = proof$removed_facts))
  }
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
  empty_facts <- scoped_fact_profile(target_snapshot$scalar$facts)[0, ,
                                                                   drop = FALSE]
  list(direction = direction, without_scope = target_without, intent = intent,
       indicators = NULL, added_facts = empty_facts,
       removed_facts = empty_facts)
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
scoped_publication_plan <- function(target_dir, current_dir, scope_ids,
                                    intent = "missing_only") {
  intent <- scoped_publication_intent(intent)
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
                                    scope_ids, intent = intent)

  reference <- target_reference
  target_scalar_version <- scalar_content_version(target_snapshot$scalar)
  current_scalar_version <- scalar_content_version(current_snapshot$scalar)
  if (identical(intent, "replacement")) {
    # The candidate and baseline comparison projections must be self-coherent,
    # and every comparison evidence row outside the scoped indicators must be
    # identical. Version tokens legitimately advance (whole-snapshot clock).
    version_fields <- c("scalar_content_version", "reference_content_version",
                        "content_version")
    comparison_outside <- function(comparison) {
      groups <- comparison$groups[
        !comparison$groups$indicator_id %in% scope_ids,
        setdiff(names(comparison$groups), version_fields), drop = FALSE]
      territories <- comparison$territories[
        !comparison$territories$indicator_id %in% scope_ids,
        setdiff(names(comparison$territories), version_fields), drop = FALSE]
      lineage <- comparison$lineage[
        !comparison$lineage$facet_id %in% scope_ids,
        setdiff(names(comparison$lineage),
                "comparison_content_version"), drop = FALSE]
      rownames(groups) <- NULL
      rownames(territories) <- NULL
      rownames(lineage) <- NULL
      list(groups = groups, territories = territories, lineage = lineage)
    }
    projected_target <- project_scalar_comparisons(
      target_snapshot$scalar, reference$rows, target_scalar_version,
      reference$content_version)
    projected_current <- project_scalar_comparisons(
      current_snapshot$scalar, reference$rows, current_scalar_version,
      reference$content_version)
    if (!identical(projected_target, target_snapshot$comparison) ||
        !identical(projected_current, current_snapshot$comparison))
      stop("A scoped replacement generation is not self-coherent with its ",
           "scalar comparison projection; refusing.", call. = FALSE)
    if (!identical(comparison_outside(projected_target),
                   comparison_outside(projected_current)))
      stop("Scalar comparison evidence outside the scoped indicators differs ",
           "between target and current; a replacement must not replace ",
           "unrelated comparisons.", call. = FALSE)
  } else {
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
  }

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
  scoped_source_clocks_valid(target_sources)
  scoped_source_clocks_valid(current_sources)
  if (identical(intent, "replacement")) {
    drift <- scoped_shared_source_drift(target_sources, current_sources)
    if (length(drift))
      stop("Scoped replacement changes shared source rows between candidate ",
           "and baseline: ", paste(drift, collapse = ", "),
           "; retrieve the exact counterpart generation instead of replacing ",
           "newer source clocks.", call. = FALSE)
  }
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
    intent = intent,
    direction = relation$direction,
    replacement_indicators = relation$indicators,
    replacement_added_facts = relation$added_facts,
    replacement_removed_facts = relation$removed_facts,
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
    target_profiles = target_profile$profiles,
    current_profiles = current_profile$profiles,
    target_profile_comparisons = target_profile$comparisons,
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
    target_reading_publication = target_reading,
    current_reading_publication = current_reading,
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

# Target markers: what the validated write installs. Used by the guarded proof
# to verify the committed closure, not as a guard expectation.
scoped_target_markers <- function(plan) {
  list(
    reference = plan$reference,
    scalar = plan$target_scalar_version,
    scalar_comparison = plan$target_comparison_version,
    profile = plan$target_profile_version,
    profile_comparison = plan$target_profile_comparison_version,
    profile_descriptors = plan$target_profile_descriptors,
    reading_owner = if (length(plan$reading_owners))
      plan$reading_owners[[1L]] else character(),
    reading = plan$target_reading_version,
    linked = plan$target_linked_version
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
    # Missing-only recovery restores a generation that no longer declares the
    # scoped indicators; the normal explicit retirement policy then omits them.
    # A replacement recovery keeps them declared, so it must not claim them as
    # retired.
    if (identical(plan$direction, "recovery") &&
        !all(plan$scope_ids %in% snapshot$scalar$descriptors$indicator_id))
      snapshot$retired_indicator_ids <- unique(c(
        snapshot$retired_indicator_ids, plan$scope_ids))
    publish_retained_scalar_snapshot(con, snapshot, plan$target_dir)
    # Publish the EXACT validated plan projections. Re-reading mutable profile
    # or reading artifacts here would reopen a plan-to-write race.
    if (!is.list(plan$target_profiles) || !length(plan$target_profiles))
      stop("Scoped publication plan has no frozen declared-profile projections",
           call. = FALSE)
    publish_declared_profiles_projection(plan$target_profiles, con,
      artifact_directory = plan$target_dir,
      expected_version = plan$target_profile_version,
      comparisons = plan$target_profile_comparisons)
    for (owner in plan$reading_owners) {
      publisher <- scoped_reading_publishers()[[owner]]
      if (!is.function(publisher))
        stop("No registered scoped reading publisher for ", owner,
             call. = FALSE)
      publication <- plan$target_reading_publication
      if (!is.list(publication) ||
          !identical(as.character(publication$content_version),
                     as.character(plan$target_reading_version)))
        stop("Scoped publication plan has no matching frozen selected-reading ",
             "projection; refusing to re-read mutable artifacts.", call. = FALSE)
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


# scoped publication preview (#1037) --------------------------------------------
# A pure, honest preflight over the already-built plan. It opens no connection,
# writes no artifact and evaluates no live marker; it reports exactly what the
# guarded wrapper will check and what the registered closure will replace.
scoped_scope_sources <- function(scalar, scope_ids) {
  provenance <- scalar$provenance[
    as.character(scalar$provenance$indicator_id) %in% scope_ids, , drop = FALSE]
  ids <- sort(unique(as.character(provenance$source_id)))
  datasets <- scalar$datasets[
    as.character(scalar$datasets$source_id) %in% ids, , drop = FALSE]
  vintage_keys <- unique(scoped_source_vintage_key(provenance$source_id,
                                                   provenance$vintage_id))
  vintages <- scalar$vintages[
    scoped_source_vintage_key(scalar$vintages$source_id,
                              scalar$vintages$vintage_id) %in% vintage_keys, ,
    drop = FALSE]
  rownames(datasets) <- NULL
  rownames(vintages) <- NULL
  list(datasets = datasets, vintages = vintages)
}

scoped_status_counts <- function(facts, scope_ids) {
  scoped <- facts[as.character(facts$indicator_id) %in% scope_ids, ,
                  drop = FALSE]
  levels <- c("measured", "suppressed", "unsupported", "not_available")
  counts <- table(factor(as.character(scoped$status), levels = levels))
  stats::setNames(as.integer(counts), levels)
}

scoped_snapshot_summary <- function(snapshot, scope_ids) {
  scalar <- snapshot$scalar
  list(
    facts = nrow(scalar$facts),
    descriptors = nrow(scalar$descriptors),
    scope_facts = sum(as.character(scalar$facts$indicator_id) %in% scope_ids),
    scope_descriptors = sum(
      as.character(scalar$descriptors$indicator_id) %in% scope_ids),
    status_counts = scoped_status_counts(scalar$facts, scope_ids),
    sources = scoped_scope_sources(scalar, scope_ids))
}

scoped_publication_preview <- function(plan, theme = NULL) {
  if (!is.list(plan) || is.null(plan$direction))
    stop("Scoped publication preview requires a complete plan", call. = FALSE)
  intent <- scoped_publication_intent(plan$intent %||% "missing_only")
  list(
    writes = FALSE,
    database = FALSE,
    theme = theme,
    intent = intent,
    direction = plan$direction,
    scope_ids = plan$scope_ids,
    reference = plan$reference,
    target = list(
      directory = plan$target_dir,
      scalar_version = plan$target_scalar_version,
      comparison_version = plan$target_comparison_version,
      profile_version = plan$target_profile_version,
      profile_comparison_version = plan$target_profile_comparison_version,
      profile_descriptors = plan$target_profile_descriptors,
      reading_version = plan$target_reading_version,
      linked_version = plan$target_linked_version),
    current = list(
      directory = plan$current_dir,
      scalar_version = plan$current_scalar_version,
      comparison_version = plan$current_comparison_version,
      profile_version = plan$current_profile_version,
      profile_comparison_version = plan$current_profile_comparison_version,
      profile_descriptors = plan$current_profile_descriptors,
      reading_version = plan$current_reading_version,
      linked_version = plan$current_linked_version),
    snapshot = list(
      before = scoped_snapshot_summary(plan$current_snapshot, plan$scope_ids),
      after = scoped_snapshot_summary(plan$target_snapshot, plan$scope_ids)),
    indicators = plan$replacement_indicators,
    added_facts = plan$replacement_added_facts,
    removed_facts = plan$replacement_removed_facts,
    sources = list(
      before = scoped_scope_sources(plan$current_snapshot$scalar,
                                    plan$scope_ids),
      after = scoped_scope_sources(plan$target_snapshot$scalar,
                                   plan$scope_ids),
      target_rows = list(
        datasets = nrow(plan$target_sources$datasets),
        vintages = nrow(plan$target_sources$vintages)),
      retirement_candidates = list(
        datasets = nrow(plan$retire_sources$datasets),
        vintages = nrow(plan$retire_sources$vintages))),
    guard = list(expected = scoped_expected_markers(plan), evaluated = FALSE),
    writes_declared = list(
      scalar_snapshot = TRUE,
      scalar_comparison = TRUE,
      declared_profiles = plan$profile_owners,
      selected_readings = plan$reading_owners),
    rollback = list(
      tested_by_this_preview = FALSE,
      path = "the same normal wrapper/plan with the frozen counterpart ",
      note = "recovery authority exists only when the guarded run exercises it"))
}

scoped_scale_label <- function(value) {
  if (is.null(value) || !length(value)) return("<none>")
  as.character(value[[1L]])
}

scoped_publication_preview_lines <- function(preview) {
  if (!is.list(preview) || !identical(preview$writes, FALSE))
    stop("Scoped publication preview lines require a preview object",
         call. = FALSE)
  lines <- c(
    "Scoped publication preview",
    paste0("  intent: ", preview$intent),
    paste0("  direction: ", preview$direction),
    paste0("  scope: ", paste(preview$scope_ids, collapse = ", ")),
    paste0("  reference: ", preview$reference,
           " (must match; never rewritten)"),
    "  writes: none -- no database connection, no artifact modification",
    "",
    "Scalar snapshot")
  before <- preview$snapshot$before
  after <- preview$snapshot$after
  lines <- c(lines,
    paste0("  before: ", before$facts, " facts / ", before$descriptors,
           " descriptors; scope ", before$scope_facts, " / ",
           before$scope_descriptors),
    paste0("  after : ", after$facts, " facts / ", after$descriptors,
           " descriptors; scope ", after$scope_facts, " / ",
           after$scope_descriptors),
    paste0("  scalar version: ", preview$current$scalar_version, " -> ",
           preview$target$scalar_version),
    paste0("  comparison version: ", preview$current$comparison_version,
           " -> ", preview$target$comparison_version))
  if (!is.null(preview$indicators)) {
    lines <- c(lines, "", "Scoped indicator diffs")
    for (i in seq_len(nrow(preview$indicators))) {
      row <- preview$indicators[i, , drop = FALSE]
      lines <- c(lines,
        paste0("  ", row$indicator_id[[1L]], ": ", row$direction[[1L]]),
        paste0("    allowed_levels: [", row$allowed_levels_before[[1L]],
               "] -> [", row$allowed_levels_after[[1L]], "]",
               if (nzchar(row$added_levels[[1L]]))
                 paste0(" (+", row$added_levels[[1L]], ")") else "",
               if (nzchar(row$removed_levels[[1L]]))
                 paste0(" (-", row$removed_levels[[1L]], ")") else ""),
        paste0("    descriptor_version: ",
               row$descriptor_version_before[[1L]], " -> ",
               row$descriptor_version_after[[1L]]),
        paste0("    facts: ", row$facts_before[[1L]], " -> ",
               row$facts_after[[1L]], " (shared ", row$facts_shared[[1L]],
               ", added ", row$facts_added[[1L]], " [",
               row$facts_added_by_level[[1L]], "], removed ",
               row$facts_removed[[1L]], " [",
               row$facts_removed_by_level[[1L]], "])"))
    }
  }
  lines <- c(lines,
    paste0("  scope status before: ",
           paste(names(before$status_counts), before$status_counts,
                 sep = "=", collapse = ", ")),
    paste0("  scope status after : ",
           paste(names(after$status_counts), after$status_counts,
                 sep = "=", collapse = ", ")),
    "",
    "Shared closure (registered owners, one atomic transaction)",
    paste0("  declared profile: ", preview$current$profile_version, " -> ",
           preview$target$profile_version,
           " (comparison ", preview$current$profile_comparison_version,
           " -> ", preview$target$profile_comparison_version, ")"),
    paste0("  bound profile descriptors: ",
           paste(paste0(preview$target$profile_descriptors$indicator_id, "=",
             preview$target$profile_descriptors$required_scalar_version),
             collapse = ", ")),
    paste0("  selected reading: ",
           if (length(preview$current$reading_version) &&
               nzchar(preview$current$reading_version[[1L]]))
             paste(preview$current$reading_version, "->",
                   preview$target$reading_version) else "<none>"),
    paste0("  linked version: ",
           if (length(preview$current$linked_version) &&
               nzchar(preview$current$linked_version[[1L]]))
             paste(preview$current$linked_version, "->",
                   preview$target$linked_version) else "<none>"),
    "",
    "Scoped source clocks")
  clock_rows <- function(sources, side) {
    vintages <- sources$vintages
    if (!nrow(vintages)) return(character())
    paste0("  ", side, ": ", vintages$source_id, "|", vintages$vintage_id,
           " version=", vintages$version,
           " reference=", as.character(vintages$reference_date),
           " publication=", as.character(vintages$publication_date))
  }
  lines <- c(lines, clock_rows(preview$sources$before, "before"))
  lines <- c(lines, clock_rows(preview$sources$after, "after"))
  lines <- c(lines,
    paste0("  source rows to upsert: ", preview$sources$target_rows$datasets,
           " datasets / ", preview$sources$target_rows$vintages, " vintages"),
    paste0("  recovery retirement candidates: ",
           preview$sources$retirement_candidates$datasets, " datasets / ",
           preview$sources$retirement_candidates$vintages,
           " vintages (retired only when unreferenced)"),
    "",
    "Live guard predicates (evaluated only by the wrapper, under advisory lock 594)")
  expected <- preview$guard$expected
  lines <- c(lines,
    paste0("  territory_reference = ", expected$reference),
    paste0("  scalar_observation = ", expected$scalar),
    paste0("  scalar_comparison_publication = ", expected$scalar_comparison),
    paste0("  declared_profile = ", expected$profile),
    paste0("  profile_comparison_publication = ",
           expected$profile_comparison))
  for (i in seq_len(nrow(expected$profile_descriptors))) {
    row <- expected$profile_descriptors[i, , drop = FALSE]
    lines <- c(lines, paste0("  profile_descriptor[", row$indicator_id[[1L]],
      "] = ", row$descriptor_version[[1L]], " / required ",
      row$required_scalar_version[[1L]]))
  }
  if (length(expected$reading_owner) && nzchar(expected$reading_owner))
    lines <- c(lines,
      paste0("  selected_reading[", expected$reading_owner, "] = ",
             expected$reading),
      paste0("  selected_reading linked_content_version = ", expected$linked))
  lines <- c(lines,
    "",
    "Rollback / recovery",
    paste0("  restore path: ", preview$rollback$path, "generation and rerun ",
           "the same wrapper; only a guarded run can prove restoration."),
    "  Not exercised by this preview. Production activation still requires:",
    "  - a reviewed backup copy of the affected closure;",
    "  - a verified live marker/source inspection under a maintenance window;",
    "  - separate operator approval for the concrete publication plan.",
    "  This preview neither authorizes nor performs a production publication.")
  lines
}
