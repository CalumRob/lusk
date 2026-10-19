# materialize_serving_artifacts (issue #802) ----------------------------------
#
# Offline materialization of the serving artifacts the unified publishers
# consume — scalar-serving, series-serving, profile-serving and the typed-reading
# grains — from the COMMITTED product payload (`public/data`). The entry point is
# scripts/materialize-serving-artifacts.R; this file owns the reusable
# orchestration so it can be exercised without a subprocess.
#
# Boundary (issue #802): the committed payload is the only producer input. No
# `data/raw` cache, no database, no network. Every write goes to a caller-owned
# private work directory; the committed snapshot is copied in first and asserted
# unchanged, so it can never be mutated in place (a junction into it is refused
# structurally before the first write).
#
# Owner derivation is always producer-derived, never a copied theme list:
#   - scalar        retained_scalar_artifact_owners()  (scalar_contracts minus
#                   the excluded serving_disposition, from each theme_*.json)
#   - series        the theme metadata's owned_series_routes map
#   - typed reading typed_reading_artifact_contracts()
#   - profile       profile_serving_owners() (declared pyramid/dense contracts)
#
# The materializers themselves are the canonical publisher-owned functions; this
# file adds no projection, schema or publication logic.

# Committed-payload readers ----------------------------------------------------
# Which serialization a theme uses is derived from theme_parquet_retire(): the
# Mobility fact Parquet is kept (#619) while the five other themes are served as
# their byte-stable JSON projections (#757). A missing input fails loudly.
lire_faits_commis <- function(source, theme, kind) {
  if (!is.character(theme) || length(theme) != 1L || is.na(theme) || !nzchar(theme))
    stop("Committed payload theme is required", call.=FALSE)
  extension <- if (theme_parquet_retire(theme)) ".json" else ".parquet"
  path <- file.path(source, paste0(kind, "_", theme, extension))
  if (!file.exists(path))
    stop("Committed payload input is missing: ", basename(path), call.=FALSE)
  if (identical(extension, ".json")) jsonlite::fromJSON(path, simplifyVector=TRUE)
  else nanoparquet::read_parquet(path)
}

serving_theme_metadata <- function(directory, theme) {
  path <- file.path(directory, paste0("theme_", theme, ".json"))
  if (!file.exists(path))
    stop("Committed theme metadata is missing: ", basename(path), call.=FALSE)
  jsonlite::fromJSON(path, simplifyVector=FALSE)
}

normalize_serving_dir <- function(path) as.character(fs::path_norm(fs::path_abs(path)))

# The private work directory must never be, contain, or live inside the
# committed snapshot: that structural guard precedes every write.
assert_serving_work_isolated <- function(source, work) {
  prefix <- function(path) sub("/+$", "", paste0(path, "/"))
  if (identical(source, work) ||
      startsWith(prefix(work), prefix(source)) ||
      startsWith(prefix(source), prefix(work)))
    stop("The private work directory must sit outside the committed payload snapshot", call.=FALSE)
  invisible(work)
}

# Planning ---------------------------------------------------------------------
# Derive the retained owner sets and the exact committed input inventory from the
# payload metadata. Never a hardcoded theme list.
plan_serving_artifacts <- function(source) {
  source <- normalize_serving_dir(source)
  if (!dir.exists(source))
    stop("Committed payload directory does not exist: ", source, call.=FALSE)
  metadata <- lapply(THEMES_METADATA, function(theme) serving_theme_metadata(source, theme))
  names(metadata) <- THEMES_METADATA
  scalar_owners <- retained_scalar_artifact_owners(source)
  series_themes <- THEMES_METADATA[vapply(metadata, function(m)
    length(m$owned_series_routes %||% list()) > 0L, logical(1))]
  typed_owners <- names(typed_reading_artifact_contracts())
  typed_themes <- typed_owners[typed_owners %in% THEMES_METADATA]
  if (!identical(sort(typed_themes), sort(typed_owners)))
    stop("A typed-reading contract owner is not a canonical theme", call.=FALSE)
  profile_themes <- THEMES_METADATA[vapply(metadata, function(m)
    length(profile_serving_owners(m)) > 0L, logical(1))]
  facts_themes <- sort(unique(c(scalar_owners, series_themes, typed_themes, profile_themes)))
  history_themes <- sort(unique(c(series_themes, typed_themes)))
  series_owners <- unique(unlist(lapply(series_themes, function(theme)
    names(metadata[[theme]]$owned_series_routes)), use.names=FALSE))
  profile_owners <- unique(unlist(lapply(profile_themes, function(theme)
    profile_serving_owners(metadata[[theme]])), use.names=FALSE))
  plan <- list(source=source, metadata=metadata,
    scalar_owners=scalar_owners, series_themes=series_themes, series_owners=series_owners,
    typed_themes=typed_themes, profile_themes=profile_themes, profile_owners=profile_owners,
    facts_themes=facts_themes, history_themes=history_themes)
  plan$inputs <- serving_artifact_input_files(plan)
  plan
}

# The committed payload files this plan copies into the work directory. The four
# families consume the per-theme fact projections; the Programme publisher reads
# its two shared dataset Parquets straight from the same directory, so the work
# directory is a complete LUSK_SORTIE for the rollout's publication step.
serving_artifact_input_files <- function(plan) {
  extension <- function(themes)
    ifelse(vapply(themes, theme_parquet_retire, logical(1)), ".json", ".parquet")
  facts <- paste0("indicateurs_", plan$facts_themes, extension(plan$facts_themes))
  histories <- paste0("histoires_", plan$history_themes, extension(plan$history_themes))
  unique(c("territoires.parquet", "vintages.parquet", "vintages.json",
    paste0("theme_", THEMES_METADATA, ".json"), facts, histories,
    "programmes_membres.parquet", "programmes_subventions.parquet"))
}

validate_serving_artifact_inputs <- function(plan) {
  paths <- file.path(plan$source, plan$inputs)
  missing <- plan$inputs[!file.exists(paths)]
  if (length(missing))
    stop("Committed payload inputs are missing: ", paste(missing, collapse=", "), call.=FALSE)
  unreadable <- plan$inputs[file.access(paths, 4L) != 0L]
  if (length(unreadable))
    stop("Committed payload inputs are not readable: ", paste(unreadable, collapse=", "), call.=FALSE)
  invisible(plan)
}

# Milieux state-role reconstruction --------------------------------------------
# The committed Milieux indicator projection is a presentation payload: it keeps
# the two per-territory state values and their reference strings but drops the
# producer-only typed `state_role` / `source_components` links the OCS-GE owned
# series (artif_par_habitant) validates. Rebuild exactly those two columns from
# the committed values plus the pinned theme metadata's declared OCS-GE vintages
# — the same producer-shaped reconstruction smoke-milieux-reading-postgres.R
# performs from the processed window, but without any data/raw access. A payload
# that already carries both columns is returned untouched.

# The applied OCS-GE vintages declared by the state indicator's source record.
# The declared product prefix is the source id with its `<dept>_<year>` tail
# removed, so the patch vintages sharing the record are excluded by construction.
milieux_artificialisation_vintages <- function(metadata) {
  page <- metadata$indicator_pages$artif_par_habitant
  if (!is.list(page) || !length(page$sources))
    stop("Milieux state metadata is missing its declared source", call.=FALSE)
  source_id <- as.character(unlist(page$sources, use.names=FALSE))[[1L]]
  record <- metadata$source_records[[source_id]]
  if (!is.list(record) || !length(record$vintages))
    stop("Milieux state source record is missing its vintages", call.=FALSE)
  ids <- vapply(record$vintages, function(v) as.character(v$id), character(1))
  prefix <- sub("_[0-9]+_[0-9]+$", "", source_id)
  applied <- startsWith(ids, paste0(prefix, "_"))
  if (!any(applied))
    stop("Milieux state source record declares no applied OCS-GE vintage", call.=FALSE)
  data.frame(id=ids[applied],
    reference_date=vapply(record$vintages[applied], function(v) as.character(v$dateReference), character(1)),
    stringsAsFactors=FALSE)
}

# A multi-window territory carries the producer's span string ("2021-2025 (22) ·
# 2021-2024 (29)") as its per-line reference; it enumerates the department ×
# window couples the producer assembled, so the typed membership is read back
# from it rather than re-derived from geography.
parse_milieux_state_span <- function(span) {
  if (!is.character(span) || length(span) != 1L || is.na(span) || !nzchar(span))
    stop("Committed Milieux multi-window state reference is invalid", call.=FALSE)
  windows <- regmatches(span, gregexpr("[0-9]{4}-[0-9]{4} \\([0-9]+\\)", span))[[1L]]
  if (!length(windows))
    stop("Committed Milieux multi-window state reference is not a declared span: ", span, call.=FALSE)
  list(departement=sub(".*\\(([0-9]+)\\).*", "\\1", windows),
    debut=sub("-.*", "", windows),
    fin=sub(".*-", "", sub(" \\(.*", "", windows)))
}

reconstruct_milieux_state_roles <- function(indicators, metadata) {
  if (!is.data.frame(indicators))
    stop("Committed Milieux indicators are not a table", call.=FALSE)
  indicator_id <- "artif_par_habitant"
  state <- !is.na(indicators$key) & indicators$key == indicator_id
  if (!any(state))
    stop("Committed Milieux payload carries no state observations", call.=FALSE)
  if (all(c("state_role", "source_components") %in% names(indicators)) &&
      !anyNA(indicators$state_role[state]) && !anyNA(indicators$source_components[state]))
    return(indicators)
  required <- c("territoire", "type", "detail", "source_reference")
  absent <- setdiff(required, names(indicators))
  if (length(absent))
    stop("Committed Milieux state rows lack: ", paste(absent, collapse=", "), call.=FALSE)
  declared <- milieux_artificialisation_vintages(metadata)
  rows <- which(state)
  sub <- indicators[rows, , drop=FALSE]
  keys <- paste(sub$territoire, sub$type)
  roles <- rep(NA_character_, nrow(sub))
  components <- rep(NA_character_, nrow(sub))
  for (key in unique(keys)) {
    at <- which(keys == key)
    if (length(at) != 2L)
      stop("Committed Milieux state territory does not carry exactly two states: ", key, call.=FALSE)
    details <- as.character(sub$detail[at])
    if (all(details %in% c("M2", "M3"))) {
      roles[at] <- details
      span <- parse_milieux_state_span(as.character(sub$source_reference[[at[[1L]]]]))
      m2 <- paste0("ocsge_artificialisation_", span$departement, "_", span$debut)
      m3 <- paste0("ocsge_artificialisation_", span$departement, "_", span$fin)
    } else {
      ids <- as.character(sub$source_reference[at])
      reference <- declared$reference_date[match(ids, declared$id)]
      if (anyNA(reference))
        stop("Committed Milieux state source is not a declared OCS-GE vintage: ",
          paste(ids, collapse=", "), call.=FALSE)
      ordered <- order(reference)
      roles[at[ordered[[1L]]]] <- "M2"
      roles[at[ordered[[2L]]]] <- "M3"
      m2 <- ids[ordered[[1L]]]
      m3 <- ids[ordered[[2L]]]
    }
    if (!all(c(m2, m3) %in% declared$id))
      stop("Reconstructed Milieux state sources are not declared OCS-GE vintages", call.=FALSE)
    components[at] <- as.character(jsonlite::toJSON(
      list(M2=as.character(m2), M3=as.character(m3)), auto_unbox=FALSE, null="null"))
  }
  indicators$state_role <- NA_character_
  indicators$source_components <- NA_character_
  indicators$state_role[rows] <- roles
  indicators$source_components[rows] <- components
  indicators
}

# Orchestration ----------------------------------------------------------------
serving_input_state <- function(source, inputs) {
  file.info(file.path(source, inputs))[, c("size", "mtime"), drop=FALSE]
}

copy_serving_inputs <- function(source, target, inputs) {
  if (!dir.exists(target)) dir.create(target, recursive=TRUE)
  copied <- file.copy(file.path(source, inputs), file.path(target, inputs), overwrite=TRUE)
  if (!all(copied))
    stop("Could not copy committed payload inputs into the work directory", call.=FALSE)
  invisible(inputs)
}

load_serving_payload <- function(directory, plan) {
  facts <- lapply(plan$facts_themes, function(theme) lire_faits_commis(directory, theme, "indicateurs"))
  names(facts) <- plan$facts_themes
  histories <- lapply(plan$history_themes, function(theme) lire_faits_commis(directory, theme, "histoires"))
  names(histories) <- plan$history_themes
  metadata <- lapply(THEMES_METADATA, function(theme) serving_theme_metadata(directory, theme))
  names(metadata) <- THEMES_METADATA
  if ("milieux" %in% names(facts))
    facts$milieux <- reconstruct_milieux_state_roles(facts$milieux, metadata$milieux)
  list(territories=nanoparquet::read_parquet(file.path(directory, "territoires.parquet")),
    vintages=nanoparquet::read_parquet(file.path(directory, "vintages.parquet")),
    facts=facts, histories=histories, metadata=metadata)
}

# The immutable pointer a materialized owner commits, and the family-local test
# that an owner actually produced its artifact. An attempt that fails (the
# committed payload predates the current producer contract for one owner, for
# instance) leaves that owner without a pointer: it is reported blocked with the
# captured reason while every other owner still materializes.
serving_artifact_pointer_path <- function(family, directory, owner) {
  if (identical(family, "scalar-serving"))
    return(file.path(directory, "scalar-serving", owner, "scalar-current.json"))
  if (identical(family, "typed-reading"))
    return(file.path(typed_reading_artifact_directory(directory, owner), "current.json"))
  file.path(directory, family, owner, "current.json")
}

materialize_serving_families <- function(plan, payload, directory) {
  outcomes <- list()
  record <- function(family, owner, error) {
    present <- file.exists(serving_artifact_pointer_path(family, directory, owner))
    outcomes[[length(outcomes) + 1L]] <<- data.frame(family=family, owner=owner,
      status=if (present) "materialized" else "blocked",
      detail=if (present) "" else (error %||% "the committed payload did not produce this artifact"),
      stringsAsFactors=FALSE)
  }
  attempt <- function(family, owners, expression) {
    error <- tryCatch({ force(expression); NULL }, error=function(e) conditionMessage(e))
    for (owner in owners) record(family, owner, error)
  }
  for (theme in plan$scalar_owners)
    attempt("scalar-serving", theme, materialize_theme_scalar_artifact(
      list(indicateurs=payload$facts[[theme]], territoires=payload$territories),
      payload$metadata[[theme]], payload$vintages, theme, directory))
  for (theme in plan$series_themes)
    attempt("series-serving", names(payload$metadata[[theme]]$owned_series_routes),
      materialize_theme_series_artifacts(
        list(indicateurs=payload$facts[[theme]], histoires=payload$histories[[theme]] %||% NULL,
          vintages=payload$vintages, territoires=payload$territories),
        payload$metadata[[theme]], payload$vintages, theme, directory))
  for (theme in plan$typed_themes)
    attempt("typed-reading", theme, materialize_theme_typed_reading_artifacts(
      list(indicateurs=payload$facts[[theme]], histoires=payload$histories[[theme]],
        territoires=payload$territories),
      payload$metadata[[theme]], payload$vintages, theme, directory))
  # The declared-profile DPE facet binds to the retained scalar snapshot, so the
  # profiles are materialized only after the scalar generations exist.
  binding_error <- NULL
  binding <- tryCatch({
    if (!profile_scalar_binding_inputs_available(directory))
      stop("The declared-profile DPE facet requires the retained scalar generations", call.=FALSE)
    value <- profile_scalar_binding(directory)
    cache_profile_scalar_binding(value, directory)
    value
  }, error=function(e) { binding_error <<- conditionMessage(e); NULL })
  for (theme in plan$profile_themes) {
    owners <- profile_serving_owners(payload$metadata[[theme]])
    if (!is.null(binding_error)) {
      for (owner in owners) record("profile-serving", owner, binding_error)
    } else {
      scalar_binding <- if (length(profile_serving_scalar_owners(payload$metadata[[theme]]))) binding else NULL
      attempt("profile-serving", owners, materialize_theme_profile_artifacts(
        list(indicateurs=payload$facts[[theme]], territoires=payload$territories),
        payload$metadata[[theme]], payload$vintages, theme, directory, scalar_binding))
    }
  }
  do.call(rbind, outcomes)
}

# Report the content version each materialized owner now serves, read straight
# from the immutable pointer the materializer just committed.
collect_serving_artifact_versions <- function(outcomes, directory) {
  kept <- outcomes[outcomes$status == "materialized", , drop=FALSE]
  if (!nrow(kept)) return(data.frame(family=character(), owner=character(),
    content_version=character(), stringsAsFactors=FALSE))
  versions <- lapply(seq_len(nrow(kept)), function(i) {
    family <- kept$family[[i]]
    pointer <- jsonlite::fromJSON(serving_artifact_pointer_path(family, directory, kept$owner[[i]]),
      simplifyVector=FALSE)
    version <- if (identical(family, "scalar-serving")) pointer$version else pointer$semantic_version
    data.frame(family=family, owner=kept$owner[[i]], content_version=as.character(version),
      stringsAsFactors=FALSE)
  })
  do.call(rbind, versions)
}

# Entry point ------------------------------------------------------------------
# Command-line parsing lives here rather than in the script so it is unit
# testable. `--source` defaults to the canonical committed snapshot; `--work` is
# required unless `--check`.
parse_materialize_serving_args <- function(args) {
  options <- list(source=file.path("..", "public", "data"), work=NULL, check=FALSE)
  index <- 1L
  while (index <= length(args)) {
    argument <- args[[index]]
    if (identical(argument, "--check")) {
      options$check <- TRUE
      index <- index + 1L
    } else if (argument %in% c("--source", "--work")) {
      if (index == length(args) || startsWith(args[[index + 1L]], "--"))
        stop(argument, " requires a value", call.=FALSE)
      value <- args[[index + 1L]]
      if (identical(argument, "--source")) options$source <- value else options$work <- value
      index <- index + 2L
    } else {
      stop("Unknown argument: ", argument, call.=FALSE)
    }
  }
  options
}

# mode "materialize" writes the four families into `work`; mode "check" validates
# the committed inputs and reports the same planned artifacts and content
# versions through a disposable temp directory (the committed snapshot is only
# ever read). Both modes copy the payload inputs first and assert the committed
# snapshot is unchanged afterwards. An owner the committed payload cannot feed is
# reported in `blocked` rather than dropping the whole run; the caller decides
# the exit status.
materialize_serving_artifacts <- function(source, work=NULL, mode=c("materialize", "check")) {
  mode <- match.arg(mode)
  plan <- plan_serving_artifacts(source)
  validate_serving_artifact_inputs(plan)
  if (identical(mode, "check")) {
    directory <- tempfile("lusk-serving-artifacts-check-")
    dir.create(directory, recursive=TRUE)
    on.exit(unlink(directory, recursive=TRUE), add=TRUE)
    assert_serving_work_isolated(plan$source, normalize_serving_dir(directory))
  } else {
    if (is.null(work) || !nzchar(work))
      stop("A private work directory is required to materialize serving artifacts", call.=FALSE)
    directory <- normalize_serving_dir(work)
    assert_serving_work_isolated(plan$source, directory)
    if (!dir.exists(directory) && !dir.create(directory, recursive=TRUE) && !dir.exists(directory))
      stop("Could not create the private work directory: ", directory, call.=FALSE)
  }
  before <- serving_input_state(plan$source, plan$inputs)
  copy_serving_inputs(plan$source, directory, plan$inputs)
  payload <- load_serving_payload(directory, plan)
  outcomes <- materialize_serving_families(plan, payload, directory)
  after <- serving_input_state(plan$source, plan$inputs)
  if (!identical(before, after))
    stop("The committed payload snapshot changed while materializing", call.=FALSE)
  blocked <- outcomes[outcomes$status == "blocked", , drop=FALSE]
  list(mode=mode, plan=plan, work=directory, outcomes=outcomes,
    versions=collect_serving_artifact_versions(outcomes, directory), blocked=blocked)
}

format_serving_artifact_report <- function(result) {
  outcomes <- result$outcomes
  lines <- sprintf("Serving artifacts (%s): committed payload %s",
    if (identical(result$mode, "check")) "check" else "materialize", result$plan$source)
  lines <- c(lines, "Planned owners:")
  for (family in unique(outcomes$family)) {
    at <- outcomes$family == family
    labels <- ifelse(outcomes$status[at] == "materialized", outcomes$owner[at],
      paste0(outcomes$owner[at], " [BLOCKED]"))
    lines <- c(lines, sprintf("  %s: %s", family, paste(labels, collapse=", ")))
  }
  versions <- result$versions
  lines <- c(lines, "Content versions:")
  if (!nrow(versions)) lines <- c(lines, "  (none)") else
    for (i in seq_len(nrow(versions)))
      lines <- c(lines, sprintf("  %s/%s %s", versions$family[[i]], versions$owner[[i]],
        versions$content_version[[i]]))
  blocked <- result$blocked
  if (nrow(blocked)) {
    lines <- c(lines, sprintf("Blocked owners (%d): the committed payload cannot feed them", nrow(blocked)))
    for (i in seq_len(nrow(blocked)))
      lines <- c(lines, sprintf("  %s/%s: %s", blocked$family[[i]], blocked$owner[[i]], blocked$detail[[i]]))
  }
  lines
}
