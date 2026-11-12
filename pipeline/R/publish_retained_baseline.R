# Pre-publication serving baseline guard for the retained backend (#989) --------
# `publish_retained_backend_snapshot()` republishes several owners: the
# territory reference, the whole scalar snapshot, four typed readings and the
# Milieux owned series. The local artifacts are not proof by themselves: they
# may be an older (or newer) canonical generation than the one the serving
# database currently holds. Before ANY serving write, this guard requires the
# live publication markers to match:
#
#   - the candidate generation for the UNCHANGED owners (reference, typed
#     readings, owned series);
#   - the explicitly supplied PRIOR baseline generation for the scalar owner and
#     its comparison, i.e. the generation the serving database was published
#     from;
#   - and it requires candidate vs baseline to differ EXACTLY by the declared
#     scoped indicators.
#
# A mismatch hard-refuses with a precise report and zero writes. The report
# tells the operator to retrieve the latest canonical generation that matches
# serving; it never forces, regenerates or overwrites. This closes the normal
# publisher's stale-seed gap without a second publisher or ad-hoc SQL seed.
#
# TOCTOU: the check runs while this session holds the existing scalar advisory
# lock `pg_advisory_lock(594, 1)` for the entire guard + publication; the
# normal scalar publisher's xact lock on the same key is reentrant in-session.
# Publication remains a maintenance-window operation: other owners retain their
# own locks, which the operator serializes as usual.

retained_backend_scope_ids <- function(scalar_scope = NULL) {
  if (is.null(scalar_scope)) scalar_scope <- Sys.getenv("LUSK_SCALAR_SCOPE", unset = "")
  if (!nzchar(scalar_scope)) return(character())
  parse_scalar_scope(scalar_scope)$indicators
}

# retained_baseline_scalar ------------------------------------------------------
# Rebuild the PRIOR full retained scalar snapshot from the candidate by removing
# exactly the declared scoped indicators. Provenance/datasets/vintages keep only
# the rows their remaining facts use; row names are normalised (the artifact
# serialisation identity ignores them, filters must too).
retained_baseline_scalar <- function(scalar, scope_ids) {
  if (!length(scope_ids)) return(scalar)
  keep <- !scalar$facts$indicator_id %in% scope_ids
  prior <- list(
    facts = scalar$facts[keep, , drop = FALSE],
    descriptors = scalar$descriptors[
      !scalar$descriptors$indicator_id %in% scope_ids, , drop = FALSE],
    provenance = scalar$provenance[
      !scalar$provenance$indicator_id %in% scope_ids, , drop = FALSE],
    datasets = scalar$datasets,
    vintages = scalar$vintages,
    eligible_territories = scalar$eligible_territories)
  used_sources <- unique(as.character(prior$provenance$source_id))
  used_vintages <- unique(paste(prior$provenance$source_id,
                                prior$provenance$vintage_id))
  prior$datasets <- prior$datasets[prior$datasets$source_id %in% used_sources, ,
                                   drop = FALSE]
  prior$vintages <- prior$vintages[
    paste(prior$vintages$source_id, prior$vintages$vintage_id) %in% used_vintages, ,
    drop = FALSE]
  for (field in names(prior)) rownames(prior[[field]]) <- NULL
  validate_scalar_artifact_projection(prior)
  prior
}

# retained_typed_versions / retained_series_expected ---------------------------
# Marker versions are the versions the REGISTERED PUBLISHERS write, not a
# generic artifact token. Demographic/Habitat/Economy publish the artifact's
# content version; Milieux publishes its own composition of facts + source
# bindings + absences. The owned series marker is keyed by the artifact's
# declared dataset id.
retained_typed_versions <- function(directory) {
  owners <- c("demographie", "habitat", "economie")
  versions <- stats::setNames(vapply(owners, function(owner)
    read_typed_reading_publication_from(directory, owner)$content_version,
    character(1)), owners)
  publication <- read_typed_reading_publication_from(directory, "milieux")
  facts <- publication$reading
  absences <- attr(facts, "source_absences")
  if (is.null(absences)) absences <- data.frame(
    territory_id = character(), territory_type = character(),
    reason = character(), source_id = character(), vintage_id = character(),
    source_snapshot_sha256 = character(), stringsAsFactors = FALSE)
  versions[["milieux"]] <- scalar_content_version(list(
    facts = facts, source_bindings = attr(facts, "source_bindings"),
    source_absences = absences))
  versions
}

retained_series_expected <- function(directory) {
  projection <- read_owned_series_artifact(
    file.path(directory, "series-serving", "artif_par_habitant"),
    "artif_par_habitant")
  list(dataset_id = as.character(projection$descriptor$dataset_id[[1L]]),
       content_version = scalar_content_version(projection))
}

# retained_profile_publication --------------------------------------------------
# The normal declared-profile publication version + comparison version, exactly
# as `publier_declared_profiles_postgres()` / `publish_registered_profile()`
# compute them for the same artifacts and scalar binding. Also returns the
# projections for the fact-equality check.
retained_profile_publication <- function(directory, binding, reference_version,
                                         reference_rows = NULL) {
  owners <- declared_profile_owners()
  profiles <- read_profile_serving_profiles(directory, owners,
                                            scalar_binding = binding)
  ordered <- c(list(profiles[["structure_age"]]),
               profiles[setdiff(names(profiles), "structure_age")])
  ids <- vapply(ordered, function(profile) profile$descriptor$indicator_id,
                character(1))
  projection <- if (length(ordered) > 1L) {
    list(profiles = ordered[order(ids)])
  } else {
    ordered[[1L]]
  }
  version <- profile_content_version(projection)
  if (is.null(reference_rows)) {
    reference_rows <- project_territory_reference(nanoparquet::read_parquet(
      file.path(directory, "territoires.parquet")))$rows
  }
  comparisons <- project_declared_profile_comparisons(ordered, reference_rows,
    version, reference_version)
  list(version = version,
       comparison_version = profile_content_version(comparisons),
       dpe_descriptor_version = as.character(
         profiles[["distribution_dpe"]]$descriptor$descriptor_version[[1L]]),
       profiles = profiles)
}

# retained_selected_linked_version ---------------------------------------------
# The exact linked version the selected-reading publisher derives for Habitat:
# canonical linked token (none today) + profile marker + scalar marker + reference.
retained_selected_linked_version <- function(habitat_publication, profile_version,
                                             scalar_version, reference_version) {
  linked <- habitat_publication$linked_content_version
  if (is.null(linked) || length(linked) == 0L) linked <- ""
  paste(c(linked, profile_version, scalar_version, reference_version),
        collapse = "-")
}

# retained_baseline_marker_expectations -----------------------------------------
# The complete expected marker set, derived from artifacts only:
#   - candidate generation for unchanged owners;
#   - baseline generation for scalar + comparison;
#   - and the machine-checked proof that candidate vs baseline differs only by
#     the declared scoped indicators.
retained_baseline_marker_expectations <- function(candidate_dir, baseline_dir,
                                                  scope_ids) {
  if (!is.character(scope_ids) || !length(scope_ids) || anyNA(scope_ids) ||
      any(!nzchar(scope_ids)) || anyDuplicated(scope_ids))
    stop("Scoped publication requires a non-empty, unique indicator scope",
         call. = FALSE)
  for (directory in c(candidate_dir, baseline_dir)) {
    if (!dir.exists(directory))
      stop("Publication artifact sortie is missing: ", directory, call. = FALSE)
  }
  reference <- project_territory_reference(
    nanoparquet::read_parquet(file.path(candidate_dir, "territoires.parquet")))
  baseline_reference <- project_territory_reference(
    nanoparquet::read_parquet(file.path(baseline_dir, "territoires.parquet")))
  if (!identical(reference$content_version, baseline_reference$content_version))
    stop("Candidate and baseline territory references differ; retrieve a ",
         "baseline generation whose reference matches the candidate.",
         call. = FALSE)

  baseline <- project_retained_scalar_snapshot(baseline_dir, baseline_reference)
  candidate <- project_retained_scalar_snapshot(candidate_dir, reference)
  if (any(scope_ids %in% baseline$scalar$descriptors$indicator_id))
    stop("Declared baseline already contains a scoped indicator (",
         paste(intersect(scope_ids, baseline$scalar$descriptors$indicator_id),
               collapse = ", "), "); the baseline is not the prior generation.",
         call. = FALSE)
  missing <- setdiff(scope_ids, candidate$scalar$descriptors$indicator_id)
  if (length(missing))
    stop("Candidate generation is missing scoped indicators: ",
         paste(missing, collapse = ", "), call. = FALSE)

  prior <- retained_baseline_scalar(candidate$scalar, scope_ids)
  if (!identical(prior, baseline$scalar))
    stop("Candidate and baseline differ outside the declared scoped indicators; ",
         "retrieve the exact prior canonical generation instead of forcing a ",
         "partial seed.", call. = FALSE)
  prior_version <- scalar_content_version(prior)
  prior_comparison <- project_scalar_comparisons(
    prior, reference$rows, input_scalar_content_version = prior_version,
    reference_content_version = reference$content_version)
  baseline_comparison <- baseline$comparison
  if (!identical(prior_comparison$groups, baseline_comparison$groups) ||
      !identical(prior_comparison$territories, baseline_comparison$territories) ||
      !identical(prior_comparison$lineage, baseline_comparison$lineage) ||
      !identical(prior_comparison$content_version,
                 baseline_comparison$content_version))
    stop("Candidate/baseline comparison projections differ outside the scoped ",
         "indicators; retrieve the exact prior canonical generation.",
         call. = FALSE)

  candidate_typed <- tryCatch(retained_typed_versions(candidate_dir),
    error = function(e) stop(
      "Candidate typed-reading artifacts are not valid under current producer ",
      "contracts: ", conditionMessage(e),
      ". This generation is not publication-ready; retrieve the latest ",
      "canonical generation that matches serving (do not regenerate or force).",
      call. = FALSE))
  baseline_typed <- tryCatch(retained_typed_versions(baseline_dir),
    error = function(e) stop(
      "Baseline typed-reading artifacts are not valid under current producer ",
      "contracts: ", conditionMessage(e),
      ". Retrieve the latest canonical generation that matches serving ",
      "(do not regenerate or force).", call. = FALSE))
  if (!identical(candidate_typed, baseline_typed))
    stop("Candidate and baseline typed-reading artifacts differ; a scoped ",
         "publication must not replace unrelated owners.", call. = FALSE)
  candidate_series <- tryCatch(retained_series_expected(candidate_dir),
    error = function(e) stop(
      "Candidate owned-series artifact is not valid under current producer ",
      "contracts: ", conditionMessage(e),
      ". This generation is not publication-ready; retrieve the latest ",
      "canonical generation that matches serving.", call. = FALSE))
  baseline_series <- tryCatch(retained_series_expected(baseline_dir),
    error = function(e) stop(
      "Baseline owned-series artifact is not valid under current producer ",
      "contracts: ", conditionMessage(e),
      ". Retrieve the latest canonical generation that matches serving.",
      call. = FALSE))
  if (!identical(candidate_series, baseline_series))
    stop("Candidate and baseline owned-series artifacts differ; a scoped ",
         "publication must not replace unrelated owners.", call. = FALSE)

  candidate_scalar_version <- scalar_content_version(candidate$scalar)
  candidate_profile <- tryCatch(
    retained_profile_publication(candidate_dir, candidate_scalar_version,
                                 reference$content_version),
    error = function(e) stop(
      "Candidate declared-profile companion is not bound to the candidate ",
      "scalar version: ", conditionMessage(e),
      ". Prepare it through the normal profile owner before publishing; ",
      "refusing with zero writes.", call. = FALSE))
  baseline_profile <- tryCatch(
    retained_profile_publication(baseline_dir, prior_version,
                                 reference$content_version),
    error = function(e) stop(
      "Baseline declared-profile companion cannot be read under the baseline ",
      "scalar version: ", conditionMessage(e),
      ". Retrieve the exact prior canonical generation.", call. = FALSE))
  strip_binding <- function(profile) {
    profile$descriptor$required_scalar_version <- NULL
    profile
  }
  if (!identical(lapply(candidate_profile$profiles, strip_binding),
                 lapply(baseline_profile$profiles, strip_binding)))
    stop("Candidate and baseline declared-profile facts/descriptors differ ",
         "outside the scalar binding; a scoped publication must not replace ",
         "unrelated owner facts.", call. = FALSE)
  habitat_publication <- read_typed_reading_publication_from(baseline_dir,
                                                             "habitat")
  selected_linked <- retained_selected_linked_version(
    habitat_publication, baseline_profile$version, prior_version,
    reference$content_version)

  list(reference = reference$content_version,
       scalar = prior_version,
       comparison = prior_comparison$content_version,
       comparison_scalar = prior_version,
       typed = candidate_typed,
       series = candidate_series,
       profile_version = baseline_profile$version,
       profile_comparison_version = baseline_profile$comparison_version,
       profile_descriptor_version = baseline_profile$dpe_descriptor_version,
       profile_required_scalar = prior_version,
       habitat_version = candidate_typed[["habitat"]],
       selected_linked = selected_linked,
       scope_ids = scope_ids)
}

# retained_backend_markers ------------------------------------------------------
# Read-only marker inventory of the retained backend. Exactly the owners the
# normal full-snapshot publication writes.
retained_backend_markers <- function(con) {
  names <- c("territory_reference", "scalar_observation",
             "declared_profile", "demographic_typed_reading",
             "selected_reading", "economy_typed_reading",
             "economy_activity_evidence", "milieux_typed_reading",
             "milieux_reading_absence")
  placeholders <- paste0("$", seq_along(names), collapse = ",")
  tables <- DBI::dbGetQuery(con, paste0(
    "SELECT table_name, content_version, reference_content_version ",
    "FROM table_publication WHERE table_name IN (", placeholders, ")"),
    params = as.list(names))
  comparison <- DBI::dbGetQuery(con, paste0(
    "SELECT content_version, scalar_content_version, reference_content_version ",
    "FROM scalar_comparison_publication WHERE singleton"))
  series <- DBI::dbGetQuery(con, paste0(
    "SELECT dataset_id, content_version, reference_content_version ",
    "FROM series_dataset_publication"))
  profile_comparison <- DBI::dbGetQuery(con, paste0(
    "SELECT content_version, profile_content_version, reference_content_version, ",
    "group_row_count, territory_row_count ",
    "FROM profile_comparison_publication WHERE singleton"))
  selected_publication <- DBI::dbGetQuery(con, paste0(
    "SELECT theme_id, content_version, reference_content_version, row_count ",
    "FROM selected_reading_publication WHERE theme_id='habitat'"))
  selected_descriptor <- DBI::dbGetQuery(con, paste0(
    "SELECT theme_id, descriptor_version, linked_content_version ",
    "FROM selected_reading_descriptor WHERE theme_id='habitat'"))
  profile_descriptor <- DBI::dbGetQuery(con, paste0(
    "SELECT indicator_id, descriptor_version, required_scalar_version ",
    "FROM profile_descriptor WHERE indicator_id='distribution_dpe'"))
  list(tables = tables, comparison = comparison, series = series,
       profile_comparison = profile_comparison,
       selected_publication = selected_publication,
       selected_descriptor = selected_descriptor,
       profile_descriptor = profile_descriptor)
}

# verifier_retained_backend_baseline --------------------------------------------
# Pure comparison of the live markers with the artifact-derived expectations.
# Returns a data frame of mismatches (empty when the baseline matches).
verifier_retained_backend_baseline <- function(markers, expected) {
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
    invisible(NULL)
  }
  expect_table("territory_reference", expected$reference, reference = FALSE)
  expect_table("scalar_observation", expected$scalar)
  expect_table("declared_profile", expected$profile_version)
  expect_table("demographic_typed_reading", expected$typed[["demographie"]])
  expect_table("selected_reading", expected$typed[["habitat"]])
  expect_table("economy_typed_reading", expected$typed[["economie"]])
  expect_table("economy_activity_evidence", expected$typed[["economie"]])
  expect_table("milieux_typed_reading", expected$typed[["milieux"]])
  expect_table("milieux_reading_absence", expected$typed[["milieux"]])

  comparison <- markers$comparison
  if (nrow(comparison) != 1L) {
    add("scalar_comparison_publication", "presence", NA_character_,
        "exactly one singleton")
  } else {
    if (!identical(as.character(comparison$content_version[[1L]]),
                   as.character(expected$comparison)))
      add("scalar_comparison_publication", "content_version",
          comparison$content_version[[1L]], expected$comparison)
    if (!identical(as.character(comparison$scalar_content_version[[1L]]),
                   as.character(expected$comparison_scalar)))
      add("scalar_comparison_publication", "scalar_content_version",
          comparison$scalar_content_version[[1L]], expected$comparison_scalar)
    if (!identical(as.character(comparison$reference_content_version[[1L]]),
                   as.character(expected$reference)))
      add("scalar_comparison_publication", "reference_content_version",
          comparison$reference_content_version[[1L]], expected$reference)
  }

  series <- markers$series
  series_rows <- if (nrow(series)) series[
    series$dataset_id == expected$series$dataset_id, , drop = FALSE] else series
  if (nrow(series_rows) != 1L) {
    add(paste0("series_dataset_publication[", expected$series$dataset_id, "]"),
        "presence", NA_character_, "exactly one marker")
  } else {
    if (!identical(as.character(series_rows$content_version[[1L]]),
                   as.character(expected$series$content_version)))
      add(paste0("series_dataset_publication[", expected$series$dataset_id, "]"),
          "content_version", series_rows$content_version[[1L]],
          expected$series$content_version)
    if (!identical(as.character(series_rows$reference_content_version[[1L]]),
                   as.character(expected$reference)))
      add(paste0("series_dataset_publication[", expected$series$dataset_id, "]"),
          "reference_content_version",
          series_rows$reference_content_version[[1L]], expected$reference)
  }

  profile_comparison <- markers$profile_comparison
  if (nrow(profile_comparison) != 1L) {
    add("profile_comparison_publication", "presence", NA_character_,
        "exactly one singleton")
  } else {
    if (!identical(as.character(profile_comparison$content_version[[1L]]),
                   as.character(expected$profile_comparison_version)))
      add("profile_comparison_publication", "content_version",
          profile_comparison$content_version[[1L]],
          expected$profile_comparison_version)
    if (!identical(as.character(profile_comparison$profile_content_version[[1L]]),
                   as.character(expected$profile_version)))
      add("profile_comparison_publication", "profile_content_version",
          profile_comparison$profile_content_version[[1L]],
          expected$profile_version)
    if (!identical(as.character(profile_comparison$reference_content_version[[1L]]),
                   as.character(expected$reference)))
      add("profile_comparison_publication", "reference_content_version",
          profile_comparison$reference_content_version[[1L]],
          expected$reference)
  }
  selected_publication <- markers$selected_publication
  if (nrow(selected_publication) != 1L) {
    add("selected_reading_publication[habitat]", "presence", NA_character_,
        "exactly one row")
  } else {
    if (!identical(as.character(selected_publication$content_version[[1L]]),
                   as.character(expected$habitat_version)))
      add("selected_reading_publication[habitat]", "content_version",
          selected_publication$content_version[[1L]], expected$habitat_version)
    if (!identical(as.character(selected_publication$reference_content_version[[1L]]),
                   as.character(expected$reference)))
      add("selected_reading_publication[habitat]", "reference_content_version",
          selected_publication$reference_content_version[[1L]],
          expected$reference)
  }
  selected_descriptor <- markers$selected_descriptor
  if (nrow(selected_descriptor) != 1L) {
    add("selected_reading_descriptor[habitat]", "presence", NA_character_,
        "exactly one row")
  } else {
    if (!identical(as.character(selected_descriptor$descriptor_version[[1L]]),
                   as.character(expected$habitat_version)))
      add("selected_reading_descriptor[habitat]", "descriptor_version",
          selected_descriptor$descriptor_version[[1L]], expected$habitat_version)
    if (!identical(as.character(selected_descriptor$linked_content_version[[1L]]),
                   as.character(expected$selected_linked)))
      add("selected_reading_descriptor[habitat]", "linked_content_version",
          selected_descriptor$linked_content_version[[1L]],
          expected$selected_linked)
  }
  profile_descriptor <- markers$profile_descriptor
  if (nrow(profile_descriptor) != 1L) {
    add("profile_descriptor[distribution_dpe]", "presence", NA_character_,
        "exactly one row")
  } else {
    if (!identical(as.character(profile_descriptor$descriptor_version[[1L]]),
                   as.character(expected$profile_descriptor_version)))
      add("profile_descriptor[distribution_dpe]", "descriptor_version",
          profile_descriptor$descriptor_version[[1L]],
          expected$profile_descriptor_version)
    if (!identical(as.character(profile_descriptor$required_scalar_version[[1L]]),
                   as.character(expected$profile_required_scalar)))
      add("profile_descriptor[distribution_dpe]", "required_scalar_version",
          profile_descriptor$required_scalar_version[[1L]],
          expected$profile_required_scalar)
  }
  if (!length(mismatches)) return(data.frame(
    marker = character(), field = character(), live = character(),
    expected = character(), stringsAsFactors = FALSE))
  do.call(rbind, mismatches)
}

# assert_retained_backend_baseline ----------------------------------------------
# Hard precondition. Called before the first serving write of the retained
# publication. Any mismatch aborts with zero writes and a precise report.
assert_retained_backend_baseline <- function(con, candidate_dir, baseline_dir,
                                             scope_ids) {
  expected <- retained_baseline_marker_expectations(
    candidate_dir, baseline_dir, scope_ids)
  markers <- DBI::dbWithTransaction(con, retained_backend_markers(con))
  mismatches <- verifier_retained_backend_baseline(markers, expected)
  if (nrow(mismatches)) {
    detail <- paste0("  - ", mismatches$marker, ".", mismatches$field,
                     ": live=", ifelse(is.na(mismatches$live), "<absent>",
                                       mismatches$live),
                     " expected=", mismatches$expected, collapse = "\n")
    stop("Serving baseline mismatch: the live publication markers do not match ",
         "the canonical generation being published. REFUSED with zero writes.\n",
         detail,
         "\nRetrieve the latest canonical generation that matches the serving ",
         "baseline (LUSK_SCALAR_BASELINE_SORTIE); do not force, regenerate or ",
         "overwrite the serving tables.", call. = FALSE)
  }
  invisible(list(expected = expected, markers = markers))
}
