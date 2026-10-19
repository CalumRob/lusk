# materialize_serving_artifacts (issue #802) ----------------------------------
#
# Offline materialization of the serving artifacts the unified publishers
# consume — scalar-serving, series-serving, profile-serving and the typed-reading
# grains — from the COMMITTED product payload (`public/data`). The entry point is
# scripts/materialize-serving-artifacts.R; this file owns the reusable
# orchestration so it can be exercised without a subprocess.
#
# Boundary (issue #802): the committed payload and the package's byte-pinned
# producer artifacts are the only producer inputs. No `data/raw` cache, no
# database, no network. Every write goes to a caller-owned private work
# directory; the committed snapshot is copied in first and asserted unchanged, so
# it can never be mutated in place. Before the first write the work root, every
# planned owner directory and every copied input destination are resolved through
# the filesystem — symlinks, junctions and reparse points included — and refused
# if any of them reaches the snapshot (see assert_serving_work_isolated()). A hard
# link is not visible to that resolution (both names resolve to themselves), so the
# copy never opens a pre-existing destination object: each input is staged beside
# it and installed by rename, never written through (see copy_serving_inputs()).
#
# One owner is NOT read from the committed payload: the Mobilite owned series
# `raccordement_courbe` — with the `raccordement_tc` headline and the
# `raccordement_reference` trajectory it is projected from — is a producer-owned
# built result the committed payload predates (#728). It is taken from the
# byte-pinned package artifact through the producer's own functions instead (see
# "Producer-owned pinned inputs" below), so no owner is left blocked by a stale
# theme Parquet and no retired fact is relabelled. The run stays fail-closed: a
# pin mismatch or a producer contract violation blocks before any generation is
# presented as current.
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

# Path isolation ---------------------------------------------------------------
# A work directory can be lexically outside the committed snapshot and still
# reach it through a symlink, a Windows junction or any other reparse point — at
# the root, at one of its ancestors, or at a pre-existing output descendant. The
# guard therefore decides from the filesystem and never from the string form:
# every path is resolved through its existing ancestors (a tail that does not
# exist yet cannot alias anything), and the resolved identities are compared.
# Comparison is case-insensitive on Windows, where the filesystem is.
#
# Guarantee: at the moment of the check no path the materializer writes through —
# the work root, every planned owner directory, every copied input destination
# (the files themselves, not only the directory that holds them) and the
# family-level binding/reading locations — resolves into the committed snapshot,
# and the snapshot does not resolve into the work root. A link whose target is
# disjoint from the snapshot is accepted: the containment rule still proves the
# write lands in the caller's own tree.
#
# Limitation: this is a point-in-time assertion made before the first write, and it
# decides from names. A HARD link is invisible to it — both names resolve to
# themselves, so no resolution ever reaches the other name — and that case is
# closed on the write side instead (copy_serving_inputs() installs a fresh staged
# file by rename and never opens a pre-existing destination object), never by
# claiming the path comparison covers it. A link created concurrently after the
# check, or a write performed by another process, is out of scope.
serving_resolve_path <- function(path) {
  path <- fs::path_abs(path)
  missing <- character()
  current <- path
  repeat {
    if (fs::file_exists(current) || fs::dir_exists(current)) {
      resolved <- normalizePath(current, winslash="/", mustWork=TRUE)
      if (!length(missing)) return(resolved)
      return(as.character(do.call(fs::path, c(list(resolved), as.list(missing)))))
    }
    parent <- fs::path_dir(current)
    if (identical(as.character(parent), as.character(current))) return(as.character(path))
    missing <- c(basename(current), missing)
    current <- parent
  }
}

serving_path_key <- function(path) {
  key <- gsub("\\\\", "/", as.character(path))
  key <- sub("^//\\?/", "", key)
  key <- sub("/+$", "", key)
  if (.Platform$OS.type == "windows") key <- tolower(key)
  key
}

serving_path_within <- function(parent, child) {
  parent <- serving_path_key(parent)
  child <- serving_path_key(child)
  identical(parent, child) || startsWith(child, paste0(parent, "/"))
}

# The private work directory must never be, contain, or live inside the committed
# snapshot, and no destination may leave it: that structural guard precedes every
# write.
assert_serving_work_isolated <- function(source, work, destinations=character()) {
  snapshot <- serving_resolve_path(source)
  root <- serving_resolve_path(work)
  if (serving_path_within(snapshot, root) || serving_path_within(root, snapshot))
    stop("The private work directory must sit outside the committed payload snapshot", call.=FALSE)
  for (destination in unique(as.character(destinations))) {
    resolved <- serving_resolve_path(destination)
    if (serving_path_within(snapshot, resolved))
      stop("A materialized destination resolves into the committed payload snapshot: ",
        destination, call.=FALSE)
    if (!serving_path_within(root, resolved))
      stop("A materialized destination resolves outside the private work directory: ",
        destination, call.=FALSE)
  }
  invisible(work)
}

# Every path the materialization writes through. The work root, every copied input
# destination FILE (not only the directory that holds it, so a resolvable alias
# planted at an input name is refused as well) and each planned owner's artifact
# directory are the materializer's own destinations; the declared-profile scalar
# binding and the Milieux annual series reading are written beside them by their
# publishers (see cache_profile_scalar_binding() and
# write_conso_enaf_reading_artifact()).
serving_write_destinations <- function(plan, directory) {
  families <- rep(c("scalar-serving", "series-serving", "typed-reading", "profile-serving"),
    c(length(plan$scalar_owners), length(plan$series_owners), length(plan$typed_themes),
      length(plan$profile_owners)))
  owners <- c(plan$scalar_owners, plan$series_owners, plan$typed_themes, plan$profile_owners)
  directories <- vapply(seq_along(owners), function(index)
    dirname(serving_artifact_pointer_path(families[[index]], directory, owners[[index]])),
    character(1))
  unique(c(directory, dirname(file.path(directory, plan$inputs)),
    file.path(directory, plan$inputs), directories,
    file.path(directory, "scalar-serving"),
    file.path(directory, "series-reading", "conso_enaf_annuel")))
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
#
# Producer source of truth: the applied vintages declared by the state indicator's
# own source record — indicator_pages$artif_par_habitant$sources -> the matching
# source_records entry -> its declared `vintages` — read through the contract
# helper milieux_artificialisation_vintages(). The declared product prefix is the
# source id with its `<dept>_<year>` tail removed, so the patch vintages sharing
# the record are excluded by construction.
#
# The payload's own strings are read as the producer assembled them and are never
# re-derived from geography: `detail` pairs identify the M2/M3 roles, and a
# multi-window territory carries the producer's span string, which enumerates the
# department x window couples. Anything that does not match the declared contract
# — a territory without exactly two states, or a source that is not a declared
# applied vintage — fails loudly rather than being approximated. Limitation: this
# is an adapter for the committed presentation projection; its true producer is
# the pipeline's processed OCS-GE window, and it should be retired once the
# committed projection carries the typed columns again.

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

# The payload inputs are copied in, never written through. A work directory can
# already hold a name that is a hard link to a canonical payload file, and a hard
# link is invisible to the filesystem guard: both names resolve to themselves, so
# no path comparison can tell them apart. An overwriting copy opens the
# pre-existing destination object — and truncates it on this platform — so the
# shared canonical bytes would change through the work name; a destination linked
# to the canonical file itself is emptied outright (the copy reads the file it has
# just truncated). Every input is therefore staged as a fresh file in the
# destination directory and installed by rename, the same copy-on-write the
# publication protocol uses (remplacer_fichier_si_modifie(), the scalar, typed and
# profile pointer installs): the directory entry is replaced, never the file
# object, so a pre-existing alias of any kind is left untouched and the work copy
# is a plain file this run owns. A rerun installs the same bytes again, so the work
# directory stays byte-identical.
copy_serving_inputs <- function(source, target, inputs) {
  if (!dir.exists(target)) dir.create(target, recursive=TRUE)
  for (input in inputs) {
    from <- file.path(source, input)
    to <- file.path(target, input)
    staging <- tempfile(".serving-input-", tmpdir=dirname(to))
    on.exit(unlink(staging), add=TRUE)
    if (!file.copy(from, staging, overwrite=TRUE))
      stop("Could not copy the committed payload input ", input,
        " into the work directory", call.=FALSE)
    if (!install_serving_input(staging, to))
      stop("Could not install the committed payload input ", input,
        " into the work directory", call.=FALSE)
  }
  invisible(inputs)
}

# Install a staged copy at `to` without ever opening whatever object `to` may
# already name: the existing entry is moved aside, the staged file renamed in, and
# the aside unlinked only then — so a pre-existing alias (a hard link to a
# canonical file above all) is never truncated, and an install that fails puts the
# previous entry back.
install_serving_input <- function(staging, to) {
  previous <- NULL
  if (file.exists(to)) {
    previous <- tempfile(".previous-", tmpdir=dirname(to))
    if (!file.rename(to, previous)) return(FALSE)
  }
  if (!file.rename(staging, to)) {
    if (!is.null(previous)) file.rename(previous, to)
    return(FALSE)
  }
  if (!is.null(previous)) unlink(previous)
  TRUE
}

# Producer-owned pinned inputs --------------------------------------------------
# One retained owner is not a committed-payload projection but a producer-owned
# BUILT result the committed payload predates: the #728 national GTFS raccordement
# run. Its facts (the owned curve, the regional mean reference and the headline
# scalar projected from them), its metadata declarations and its vintage therefore
# come from the pins through the producer's own functions — never from the retired
# theme-wide Parquet rows, and never from a literal restamped to look current.
#
# The committed payload is not asked to carry this owner: it keeps only what it
# still legitimately owns (its other Mobility facts and their declarations), and its
# retired raccordement rows are dropped rather than relabelled with the national
# vintage. A pin whose bytes differ from the canonical sha256, whose saved envelope
# disagrees with the recalculated one, or whose recipe contract changed stops the
# run before any generation is written.

# The producer's canonical rows for that owner, read from the byte-pinned artifact.
# lire_artefact_raccordement_national() validates the pins, the recipe contract, the
# population pin and the saved/calculated parity without any raw cache, routing or
# network, and lignes_indicateurs_raccordement_national() is the very projection
# publier_mobilite() runs — the serving rows are the producer's rows.
producer_owned_raccordement_inputs <- function(chemin_enveloppe=NULL, chemin_matrice=NULL) {
  artifact <- lire_artefact_raccordement_national(chemin_enveloppe, chemin_matrice)
  rows <- lignes_indicateurs_raccordement_national(artifact$calculation, VINTAGES_RACCORDEMENT)
  theme <- unique(as.character(rows$theme))
  keys <- unique(as.character(rows$key))
  if (length(theme) != 1L || is.na(theme) || !nzchar(theme) || !length(keys) || anyNA(keys))
    stop("The pinned national raccordement artifact declares no single theme owner", call.=FALSE)
  list(theme=theme, keys=keys, rows=rows, vintages=VINTAGES_RACCORDEMENT,
    metadata=lire_theme_metadata(theme))
}

# The producer-owned artifacts this materialization reads beside the committed
# payload, keyed by file name and valued by the byte pin the producer's own reader
# enforces. Reported as evidence: a rollout run names every non-committed input it
# consumed, and a pin mismatch fails before any generation is written.
serving_pinned_producer_inputs <- function() {
  paths <- c(chemin_artefact_raccordement_national(), chemin_matrice_raccordement_national())
  stats::setNames(c(RACCORDEMENT_NATIONAL_ENVELOPPE_SHA256, MATRICE_RACCORDEMENT_NATIONAL_SHA256),
    vapply(paths, basename, character(1)))
}

# The producer's CURRENT declaration for the indicators the pins supply, overlaid on
# the committed metadata: those entries describe the facts this materialization now
# takes from the pins, so they are the producer's. Every other declaration keeps its
# committed form — the committed payload still owns those facts — and the source
# record each supplied indicator resolves to travels with it.
producer_owned_theme_metadata <- function(committed, inputs) {
  if (!is.list(committed)) stop("Committed theme metadata is not a declaration", call.=FALSE)
  merged <- committed
  for (section in c("sources", "detail_labels", "indicator_labels", "indicator_caveats",
                    "indicator_pages", "owned_series_routes")) {
    declared <- inputs$metadata[[section]]
    if (is.null(declared)) next
    for (key in intersect(inputs$keys, names(declared))) merged[[section]][[key]] <- declared[[key]]
  }
  for (key in inputs$keys) {
    source_id <- as.character(inputs$metadata$sources[[key]])
    if (length(source_id) != 1L || is.na(source_id) || !nzchar(source_id))
      stop("The producer metadata declares no source for the indicator ", key, call.=FALSE)
    record <- inputs$metadata$source_records[[source_id]]
    if (is.null(record))
      stop("The producer metadata declares no source record for ", source_id, call.=FALSE)
    merged$source_records[[source_id]] <- record
  }
  merged
}

# The committed rows of the indicators the pins supply are dropped whole and the
# pinned rows take their place, in the committed projection's own columns: the theme
# keeps the shape it publishes and no retired row survives under a new stamp.
producer_owned_facts <- function(indicators, inputs) {
  if (!is.data.frame(indicators) || !"key" %in% names(indicators))
    stop("Committed theme indicators are not a producer projection", call.=FALSE)
  keep <- indicators[!(as.character(indicators$key) %in% inputs$keys), , drop=FALSE]
  rows <- inputs$rows[, intersect(names(indicators), names(inputs$rows)), drop=FALSE]
  for (column in setdiff(names(indicators), names(rows))) rows[[column]] <- NA
  merged <- rbind(keep, rows[names(indicators)])
  rownames(merged) <- NULL
  merged
}

# Apply the producer-owned inputs to the loaded committed payload AND make the
# private work directory describe them: the work directory is the publication input,
# so it must carry the declarations the serving generations were built from. The
# vintage table is merged with the pipeline's own upsert (the producer's declared
# rows win on their id) and the theme metadata is written through the producer's
# publication seam, which validates it against that table before writing. Both
# writers are content-addressed no-ops when the file already says this, so a rerun
# leaves the work directory byte-identical.
apply_producer_owned_inputs <- function(payload, directory) {
  inputs <- producer_owned_raccordement_inputs()
  theme <- inputs$theme
  if (is.null(payload$facts[[theme]]) || is.null(payload$metadata[[theme]]))
    stop("The producer-owned inputs declare a theme the payload does not carry", call.=FALSE)
  payload$facts[[theme]] <- producer_owned_facts(payload$facts[[theme]], inputs)
  payload$metadata[[theme]] <- producer_owned_theme_metadata(payload$metadata[[theme]], inputs)
  payload$vintages <- fusionner_vintages(inputs$vintages, directory)
  ecrire_parquet_si_modifie(payload$vintages, file.path(directory, "vintages.parquet"))
  ecrire_json_si_modifie(payload$vintages, file.path(directory, "vintages.json"),
    dataframe="rows", na="null", digits=17, pretty=TRUE)
  publier_theme_metadata(payload$metadata[[theme]], directory,
    vintages=payload$vintages, theme_attendu=theme)
  payload
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
  payload <- list(territories=nanoparquet::read_parquet(file.path(directory, "territoires.parquet")),
    vintages=nanoparquet::read_parquet(file.path(directory, "vintages.parquet")),
    facts=facts, histories=histories, metadata=metadata)
  apply_producer_owned_inputs(payload, directory)
}

# The immutable pointer a materialized owner commits: the family-local declaration
# that every reader — and the materializer's own outcome evidence — resolves the
# owner's current generation through.
serving_artifact_pointer_path <- function(family, directory, owner) {
  if (identical(family, "scalar-serving"))
    return(file.path(directory, "scalar-serving", owner, "scalar-current.json"))
  if (identical(family, "typed-reading"))
    return(file.path(typed_reading_artifact_directory(directory, owner), "current.json"))
  file.path(directory, family, owner, "current.json")
}

# Outcome evidence -------------------------------------------------------------
# Every family writer returns the content version it computed for the attempt
# that just ran — including when the artifact already existed, in which case it
# revalidated the retained generation and left the pointer untouched. That return
# is therefore the only evidence that the CURRENT attempt covered the owner; a
# pointer a previous run left behind never is.
serving_pointer_version <- function(family, directory, owner) {
  path <- serving_artifact_pointer_path(family, directory, owner)
  if (!file.exists(path)) return(NA_character_)
  pointer <- tryCatch(jsonlite::fromJSON(path, simplifyVector=FALSE), error=function(e) NULL)
  if (!is.list(pointer)) return(NA_character_)
  version <- pointer[[if (identical(family, "scalar-serving")) "version" else "semantic_version"]]
  if (!is.character(version) || length(version) != 1L || is.na(version)) return(NA_character_)
  version
}

# Normalize a family materializer's return value into owner -> version. The
# scalar and typed-reading families carry one owner per theme and return a bare
# version; the series and profile families return a named per-owner map. Anything
# else is no evidence at all, so a return that does not name an owner can never
# mark it materialized.
serving_attempt_provenance <- function(owners, produced) {
  absent <- stats::setNames(rep(NA_character_, length(owners)), owners)
  if (is.null(produced) || !length(produced)) return(absent)
  entries <- if (is.list(produced)) produced else if (!is.null(names(produced))) as.list(produced) else NULL
  if (!is.null(entries)) {
    if (is.null(names(entries))) return(absent)
    versions <- vapply(entries, function(entry)
      if (is.character(entry) && length(entry) == 1L && !is.na(entry)) entry else NA_character_,
      character(1))
    return(stats::setNames(vapply(owners, function(owner)
      if (owner %in% names(versions)) versions[[owner]] else NA_character_, character(1)), owners))
  }
  if (length(owners) != 1L || !is.character(produced) || length(produced) != 1L || is.na(produced))
    return(absent)
  stats::setNames(produced, owners)
}

# The outcome rows one family attempt produces. Only an attempt that ran without
# error AND whose own return names the owner with the version that owner's
# immutable pointer now declares counts as materialized — a deterministic no-op
# rerun included, since the writer then recomputes the same version and leaves the
# pointer in place. A family that failed is reported conservatively: every owner
# it covers, written before or after the failure, is blocked, so an unvisited or
# retained generation is never presented as the current attempt's success. The
# retained artifacts stay on disk for atomic safety; the caller turns a non-empty
# `blocked` set into a non-zero exit status.
serving_attempt_outcomes <- function(family, owners, produced, error, directory) {
  if (!length(owners)) return(data.frame(family=character(), owner=character(),
    status=character(), detail=character(), stringsAsFactors=FALSE))
  versions <- serving_attempt_provenance(owners, produced)
  materialized <- is.null(error) & vapply(owners, function(owner) {
    version <- versions[[owner]]
    !is.na(version) && identical(serving_pointer_version(family, directory, owner), version)
  }, logical(1))
  data.frame(family=family, owner=owners,
    status=ifelse(materialized, "materialized", "blocked"),
    detail=ifelse(materialized, "", if (is.null(error))
      "the committed payload did not produce this artifact" else error),
    stringsAsFactors=FALSE)
}

materialize_serving_families <- function(plan, payload, directory) {
  outcomes <- list()
  attempt <- function(family, owners, expression) {
    produced <- NULL
    error <- tryCatch({ produced <- force(expression); NULL }, error=function(e) conditionMessage(e))
    outcomes[[length(outcomes) + 1L]] <<- serving_attempt_outcomes(family, owners, produced, error,
      directory)
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
  # profiles are materialized only after the scalar generations exist. An
  # unavailable binding blocks every profile owner: a retained generation is not
  # evidence for the attempt that could not bind.
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
      outcomes[[length(outcomes) + 1L]] <- serving_attempt_outcomes("profile-serving", owners,
        NULL, binding_error, directory)
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
    directory <- normalize_serving_dir(tempfile("lusk-serving-artifacts-check-"))
    assert_serving_work_isolated(plan$source, directory,
      serving_write_destinations(plan, directory))
    dir.create(directory, recursive=TRUE)
    on.exit(unlink(directory, recursive=TRUE), add=TRUE)
  } else {
    if (is.null(work) || !nzchar(work))
      stop("A private work directory is required to materialize serving artifacts", call.=FALSE)
    directory <- normalize_serving_dir(work)
    assert_serving_work_isolated(plan$source, directory,
      serving_write_destinations(plan, directory))
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
  pins <- serving_pinned_producer_inputs()
  lines <- c(lines, "Producer-owned pinned inputs:")
  for (i in seq_along(pins))
    lines <- c(lines, sprintf("  %s %s", names(pins)[[i]], pins[[i]]))
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
    lines <- c(lines, sprintf("Blocked owners (%d): the committed payload and the pinned producer inputs cannot feed them", nrow(blocked)))
    for (i in seq_len(nrow(blocked)))
      lines <- c(lines, sprintf("  %s/%s: %s", blocked$family[[i]], blocked$owner[[i]], blocked$detail[[i]]))
  }
  lines
}
