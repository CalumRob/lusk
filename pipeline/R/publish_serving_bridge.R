# Guarded one-off bridge: publish the address-based offre_tc and the 29
# retirements to the serving database WITHOUT the lost baseline artifacts (#1071,
# epic #1048). This is NOT a new publication path and does NOT change the #1068
# scoped guard: the normal `publish_scoped_retained_backend()` still requires
# LUSK_SCALAR_BASELINE_SORTIE. Here the new generation is built in R from the
# LIVE serving rows + freshly built offre_tc facts, then written in ONE
# transaction through the existing registered publishers/adapters.
#
# Safety invariants (each has a test, and each refuses with zero writes):
#   1. round-trip proof: every indicator except offre_tc and the explicit
#      retirements is identical as data (facts, descriptors, provenance);
#   2. the five live markers must equal the tokens supplied by the operator;
#   3. --dry-run prints the new tokens + per-indicator diff and writes nothing;
#   4. an explicit operator acknowledgement (LUSK_BRIDGE_DUMP_CONFIRMED) proves
#      a verified dump before any write;
#   5. host/database/role come from LUSK_PUBLISH_* and the password only from a
#      private libpq passfile (configuration_service_postgres()).
#
# No serving connection is opened by loading this file. The worker never runs
# the real publication: the operator does, after a verified dump.

# The indicator rebuilt by this bridge is a registered scope, never a literal
# scattered through the write path (#1071 follow-up of the general contract rule).
# Resolve the whole registered contract ONCE and share it across the reader,
# metadata and builder; no second theme/indicator lookup at the write site.
bridge_scope <- function() {
  registry <- scalar_scope_registry()
  themes <- names(registry)
  matches <- themes[vapply(registry, function(entries)
    any(vapply(entries, function(entry) "offre_tc" %in% entry$indicators, logical(1))),
    logical(1))]
  if (length(matches) != 1L)
    stop("No unique registered scalar scope owns offre_tc", call. = FALSE)
  scalar_scope_contract(matches[[1L]], "offre_tc")
}

bridge_offre_tc_id <- function() bridge_scope()$indicators[[1L]]

# Producer-shaped offre_tc rows (the output of produire_offre_tc_mobilite()).
validate_bridge_offre_tc_rows <- function(rows, indicator_id = bridge_offre_tc_id()) {
  required <- c("territory_id", "territory_type", "indicator_id", "value", "unit",
                "source_name", "source_version", "reference_date", "publication_date")
  if (!is.data.frame(rows) || !all(required %in% names(rows)) ||
      !nrow(rows) || anyNA(rows[c("territory_id", "territory_type", "indicator_id",
                                  "unit", "source_name", "source_version")]) ||
      any(!as.character(rows$indicator_id) %in% indicator_id) ||
      anyDuplicated(rows[c("territory_id", "territory_type")]))
    stop("Bridge offre_tc facts are missing contract fields or contain duplicates",
         call. = FALSE)
  invisible(rows)
}

assert_bridge_retirement_policy <- function(retired_ids, indicator_id = bridge_offre_tc_id()) {
  if (!is.character(retired_ids) || !length(retired_ids) || anyNA(retired_ids) ||
      any(!nzchar(retired_ids)) || anyDuplicated(retired_ids) ||
      indicator_id %in% retired_ids)
    stop("Bridge requires a non-empty, explicit retirement policy that excludes ",
         indicator_id, call. = FALSE)
  invisible(retired_ids)
}

assert_bridge_live_projection <- function(live) {
  fields <- c("facts", "descriptors", "provenance", "datasets", "vintages",
              "eligible_territories")
  if (!is.list(live) || !all(fields %in% names(live)) ||
      !all(vapply(live[fields], is.data.frame, logical(1))))
    stop("Bridge requires a complete, live-shaped scalar projection", call. = FALSE)
  validate_scalar_artifact_projection(live)
  invisible(live)
}

# Slice 1 — pure builder -------------------------------------------------------
# `live` is the projection read back from the serving rows; `offre_tc_rows` are
# the fresh address-based producer facts; `retired_ids` is the explicit policy
# (the 29 retired indicator ids derived from producer metadata). The result is
# a complete scalar snapshot: unrelated rows are preserved line for line and
# only offre_tc + the retirements are replaced/removed.
build_bridge_scalar_projection <- function(live, offre_tc_rows, metadata,
                                           retired_ids,
                                           offre_tc_id = bridge_offre_tc_id(),
                                           source_vintages = NULL) {
  assert_bridge_live_projection(live)
  assert_bridge_retirement_policy(retired_ids, offre_tc_id)
  validate_bridge_offre_tc_rows(offre_tc_rows, offre_tc_id)
  affected <- union(retired_ids, offre_tc_id)

  scoped <- project_scalar_canonical_rows(
    offre_tc_rows, metadata, offre_tc_id, live$eligible_territories,
    source_vintages = source_vintages)

  # The published descriptor is preserved: only the mesure (facts) changes.
  # A semantic difference against current metadata is a hard refusal — the
  # bridge must never silently relabel an old fact (ADR-0044 decision 4).
  live_descriptor <- live$descriptors[
    live$descriptors$indicator_id == offre_tc_id, , drop = FALSE]
  if (nrow(live_descriptor) != 1L ||
      !identical_scalar_descriptor(live_descriptor, scoped$descriptors))
    stop("The live offre_tc descriptor is missing, duplicated or semantically ",
         "different from current metadata; a full theme regeneration is ",
         "required, refusing with zero writes", call. = FALSE)
  scoped$descriptors <- live_descriptor

  keep_rows <- function(frame) frame[!frame$indicator_id %in% affected, , drop = FALSE]
  kept <- list(
    facts = keep_rows(live$facts),
    descriptors = keep_rows(live$descriptors),
    provenance = keep_rows(live$provenance))
  used_sources <- unique(as.character(kept$provenance$source_id))
  used_vintages <- unique(paste(kept$provenance$source_id,
                                kept$provenance$vintage_id))
  kept$datasets <- live$datasets[live$datasets$source_id %in% used_sources, ,
                                 drop = FALSE]
  kept$vintages <- live$vintages[
    paste(live$vintages$source_id, live$vintages$vintage_id) %in% used_vintages, ,
    drop = FALSE]
  kept$eligible_territories <- live$eligible_territories

  projection <- combine_scalar_projections(kept, scoped)
  if (any(retired_ids %in% projection$descriptors$indicator_id) ||
      !offre_tc_id %in% projection$descriptors$indicator_id)
    stop("Bridge projection does not reflect the retirement policy", call. = FALSE)

  list(projection = projection, scoped = scoped, kept = kept,
       affected = affected, base = live, indicator_id = offre_tc_id)
}

# Row-normalised per-indicator data comparison. Order is not data; column types
# and values are. Both sides come from the same producer contract so preserved
# rows only need a stable sort and rowname reset to be compared with identical().
bridge_indicator_rows <- function(projection, indicator_id, field) {
  keys <- switch(field,
    facts = c("indicator_id", "territory_id"),
    descriptors = "indicator_id",
    provenance = c("indicator_id", "territory_id", "source_id", "vintage_id"),
    stop("Unsupported bridge comparison field: ", field, call. = FALSE))
  frame <- projection[[field]]
  frame <- frame[frame$indicator_id == indicator_id, , drop = FALSE]
  if (nrow(frame))
    frame <- frame[do.call(order, c(frame[keys], list(na.last = TRUE,
                                                     method = "radix"))), , drop = FALSE]
  rownames(frame) <- NULL
  frame
}

bridge_indicator_diff <- function(live, projection, affected) {
  ids <- sort(union(unique(as.character(live$facts$indicator_id)),
                    unique(as.character(projection$facts$indicator_id))))
  do.call(rbind, lapply(ids, function(id) {
    live_has <- id %in% live$descriptors$indicator_id
    status <- if (!live_has) "unexpected" else if (id %in% affected) "affected" else "preserved"
    same <- vapply(c("facts", "descriptors", "provenance"), function(field)
      identical(bridge_indicator_rows(live, id, field),
                bridge_indicator_rows(projection, id, field)), logical(1))
    data.frame(indicator_id = id, status = status,
               facts_identical = unname(same[["facts"]]),
               descriptors_identical = unname(same[["descriptors"]]),
               provenance_identical = unname(same[["provenance"]]),
               stringsAsFactors = FALSE)
  }))
}

assert_bridge_round_trip <- function(live, projection, affected) {
  assert_bridge_live_projection(live)
  needed <- c("facts", "descriptors", "provenance")
  if (!is.list(projection) || !all(needed %in% names(projection)) ||
      !all(vapply(projection[needed], is.data.frame, logical(1))))
    stop("Bridge round-trip proof requires the projected scalar rows", call. = FALSE)
  diff <- bridge_indicator_diff(live, projection, affected)
  unexpected <- diff$indicator_id[diff$status == "unexpected"]
  if (length(unexpected))
    stop("Bridge round-trip proof failed: unexpected indicator(s) introduced: ",
         paste(unexpected, collapse = ", "), call. = FALSE)
  changed <- diff[diff$status == "preserved" &
                    !(diff$facts_identical & diff$descriptors_identical &
                        diff$provenance_identical), , drop = FALSE]
  if (nrow(changed))
    stop("Bridge round-trip proof failed: unrelated indicator(s) changed: ",
         paste(changed$indicator_id, collapse = ", "),
         ". REFUSED with zero writes.", call. = FALSE)
  invisible(diff)
}

# Slice 2 â€” read-only live loader and marker guard -----------------------------
# RPostgres returns text[] either as an already-split character vector or as a
# Postgres array literal. Both are decoded here; nothing else parses levels.
bridge_parse_text_array <- function(x) {
  if (is.null(x) || length(x) == 0L) return(character())
  if (is.list(x)) return(as.character(unlist(x, use.names = FALSE)))
  values <- as.character(x)
  if (length(values) == 1L && startsWith(values, "{") && endsWith(values, "}")) {
    inner <- substr(values, 2L, nchar(values) - 1L)
    if (!nzchar(inner)) return(character())
    return(strsplit(inner, ",", fixed = TRUE)[[1L]])
  }
  values
}

bridge_live_reader <- function() list(
  facts = function(con) DBI::dbGetQuery(con, paste(
    "SELECT indicator_id, territory_id, territory_type, value, status,",
    "support_count, denominator_count FROM scalar_observation")),
  descriptors = function(con) DBI::dbGetQuery(con, paste(
    "SELECT indicator_id, theme_id, label, unit, direction, comparison_facet,",
    "allowed_levels, denominator_semantics, completeness, descriptor_version",
    "FROM scalar_descriptor")),
  descriptor_sources = function(con) DBI::dbGetQuery(con,
    "SELECT indicator_id, source_id FROM scalar_descriptor_source"),
  provenance = function(con) DBI::dbGetQuery(con, paste(
    "SELECT indicator_id, territory_id, source_id, vintage_id",
    "FROM scalar_observation_source")),
  datasets = function(con) DBI::dbGetQuery(con,
    "SELECT source_id, name FROM source_dataset"),
  vintages = function(con) DBI::dbGetQuery(con, paste(
    "SELECT source_id, vintage_id, version, reference_date, publication_date",
    "FROM source_vintage")),
  territories = function(con) DBI::dbGetQuery(con,
    "SELECT territory_id, territory_type FROM territory_reference"),
  reference_rows = function(con) DBI::dbGetQuery(con, "SELECT * FROM territory_reference"),
  profile_descriptors = function(con) DBI::dbGetQuery(con,
    "SELECT * FROM profile_descriptor"),
  profile_sources = function(con) DBI::dbGetQuery(con,
    "SELECT indicator_id, source_id FROM profile_descriptor_source"),
  profile_axes = function(con) DBI::dbGetQuery(con, "SELECT * FROM profile_axis"),
  profile_facts = function(con) DBI::dbGetQuery(con, paste(
    "SELECT indicator_id, territory_id, territory_type, detail_key, sex_key,",
    "value, status FROM profile_observation")),
  profile_provenance = function(con) DBI::dbGetQuery(con, paste(
    "SELECT indicator_id, territory_id, detail_key, sex_key, source_id, vintage_id",
    "FROM profile_observation_source")))

read_live_scalar_projection <- function(con, reader = bridge_live_reader()) {
  facts <- reader$facts(con)
  descriptor_rows <- reader$descriptors(con)
  descriptor_sources <- reader$descriptor_sources(con)
  sources_by_indicator <- lapply(descriptor_rows$indicator_id, function(id)
    as.character(descriptor_sources$source_id[
      descriptor_sources$indicator_id == id]))
  levels_by_indicator <- lapply(seq_len(nrow(descriptor_rows)), function(i)
    bridge_parse_text_array(descriptor_rows$allowed_levels[[i]]))
  descriptors <- data.frame(
    indicator_id = as.character(descriptor_rows$indicator_id),
    theme_id = as.character(descriptor_rows$theme_id),
    allowed_sources = I(sources_by_indicator),
    label = as.character(descriptor_rows$label),
    unit = as.character(descriptor_rows$unit),
    direction = as.character(descriptor_rows$direction),
    comparison_facet = as.character(descriptor_rows$comparison_facet),
    allowed_levels = I(levels_by_indicator),
    denominator_semantics = as.character(descriptor_rows$denominator_semantics),
    completeness = as.character(descriptor_rows$completeness),
    descriptor_version = as.character(descriptor_rows$descriptor_version),
    stringsAsFactors = FALSE)
  rownames(descriptors) <- NULL
  facts$indicator_id <- as.character(facts$indicator_id)
  facts$territory_id <- as.character(facts$territory_id)
  facts$territory_type <- as.character(facts$territory_type)
  facts$status <- as.character(facts$status)
  facts$value <- as.numeric(facts$value)
  facts$support_count <- if (all(is.na(facts$support_count))) NA_integer_ else as.integer(facts$support_count)
  facts$denominator_count <- if (all(is.na(facts$denominator_count))) NA_integer_ else as.integer(facts$denominator_count)
  vintages <- reader$vintages(con)
  vintages$reference_date <- as.Date(vintages$reference_date)
  vintages$publication_date <- as.Date(vintages$publication_date)
  territories <- reader$territories(con)
  levels <- unique(unlist(descriptors$allowed_levels, use.names = FALSE))
  eligible <- unique(territories[territories$territory_type %in% levels,
                                 c("territory_id", "territory_type"), drop = FALSE])
  eligible$territory_id <- as.character(eligible$territory_id)
  eligible$territory_type <- as.character(eligible$territory_type)
  rownames(eligible) <- NULL
  projection <- list(
    facts = facts, descriptors = descriptors,
    provenance = reader$provenance(con), datasets = reader$datasets(con),
    vintages = vintages, eligible_territories = eligible)
  validate_scalar_artifact_projection(projection)
  projection
}

BRIDGE_DUMP_ACK_ENV <- "LUSK_BRIDGE_DUMP_CONFIRMED"
BRIDGE_EXPECTED_ENV <- c(
  scalar = "LUSK_BRIDGE_EXPECT_SCALAR",
  comparison = "LUSK_BRIDGE_EXPECT_COMPARISON",
  profile = "LUSK_BRIDGE_EXPECT_PROFILE",
  habitat = "LUSK_BRIDGE_EXPECT_HABITAT",
  reference = "LUSK_BRIDGE_EXPECT_REFERENCE")
BRIDGE_FACTS_ENV <- "LUSK_BRIDGE_OFFRE_TC_FACTS"
BRIDGE_PUBLISH_OPT_IN_ENV <- "LUSK_PUBLISH_OFFRE_TC_BRIDGE"

# The real write needs the same explicit opt-in as --programme-publish /
# --series-publish. A dry-run never calls this.
assert_bridge_publish_opt_in <- function(env = Sys.getenv) {
  value <- env(BRIDGE_PUBLISH_OPT_IN_ENV, unset = "")
  if (!identical(trimws(value), "1"))
    stop("Real offre_tc bridge publication requires explicit ",
         BRIDGE_PUBLISH_OPT_IN_ENV, "=1", call. = FALSE)
  invisible(TRUE)
}

bridge_expected_tokens_from_env <- function(env = Sys.getenv) {
  tokens <- vapply(BRIDGE_EXPECTED_ENV, function(name) env(name, unset = ""), character(1))
  missing <- names(tokens)[!nzchar(trimws(tokens))]
  if (length(missing))
    stop("Bridge missing publication token(s): ",
         paste(missing, collapse = ", "), call. = FALSE)
  tokens
}

assert_bridge_dump_confirmed <- function(env = Sys.getenv) {
  ack <- env(BRIDGE_DUMP_ACK_ENV, unset = "")
  if (!nzchar(trimws(ack)))
    stop("Bridge refuses to write without ", BRIDGE_DUMP_ACK_ENV,
         " confirming a verified dump of the affected serving tables",
         call. = FALSE)
  invisible(ack)
}

# Compare ONLY the five operator-supplied tokens (and the chained input fields
# that must agree with them). An unrelated owner's newer marker is deliberately
# not an expectation here â€” the guard stays scoped to the affected closure, as
# in #995, and never reads a lost baseline artifact.
assert_bridge_markers <- function(markers, expected) {
  needed <- names(BRIDGE_EXPECTED_ENV)
  if (!is.character(expected) || !all(needed %in% names(expected)) ||
      anyNA(expected[needed]) || any(!nzchar(trimws(expected[needed]))))
    stop("Bridge marker check requires all five expected tokens", call. = FALSE)
  mismatches <- list()
  add <- function(marker, live, want) {
    mismatches[[length(mismatches) + 1L]] <<- data.frame(
      marker = marker,
      live = if (length(live)) as.character(live[[1L]]) else NA_character_,
      expected = as.character(want), stringsAsFactors = FALSE)
  }
  token_for_table <- c(territory_reference = "reference",
                       scalar_observation = "scalar",
                       declared_profile = "profile",
                       selected_reading = "habitat")
  table_marker <- function(name, field = "content_version") {
    rows <- markers$tables[markers$tables$table_name == name, , drop = FALSE]
    want <- if (identical(field, "reference_content_version"))
      expected[["reference"]] else expected[[token_for_table[[name]]]]
    if (nrow(rows) != 1L) add(paste0(name, ".", field), NA_character_, "exactly one marker")
    else add(paste0(name, ".", field), rows[[field]][[1L]], want)
  }
  table_marker("territory_reference", "content_version")
  table_marker("scalar_observation", "content_version")
  table_marker("scalar_observation", "reference_content_version")
  table_marker("declared_profile", "content_version")
  table_marker("selected_reading", "content_version")

  comparison <- markers$comparison
  if (nrow(comparison) != 1L) {
    add("scalar_comparison_publication", NA_character_, "exactly one singleton")
  } else {
    add("scalar_comparison_publication.content_version",
        comparison$content_version[[1L]], expected[["comparison"]])
    add("scalar_comparison_publication.scalar_content_version",
        comparison$scalar_content_version[[1L]], expected[["scalar"]])
    add("scalar_comparison_publication.reference_content_version",
        comparison$reference_content_version[[1L]], expected[["reference"]])
  }
  selected <- markers$selected_publication
  if (nrow(selected) != 1L) {
    add("selected_reading_publication[habitat]", NA_character_, "exactly one row")
  } else {
    add("selected_reading_publication[habitat].content_version",
        selected$content_version[[1L]], expected[["habitat"]])
    add("selected_reading_publication[habitat].reference_content_version",
        selected$reference_content_version[[1L]], expected[["reference"]])
  }
  # Fail closed: an absent or duplicated descriptor row is NOT a neutral state.
  descriptor <- markers$selected_descriptor
  if (nrow(descriptor) != 1L) {
    add("selected_reading_descriptor[habitat]", NA_character_, "exactly one marker")
  } else {
    add("selected_reading_descriptor[habitat].descriptor_version",
        descriptor$descriptor_version[[1L]], expected[["habitat"]])
  }
  profile <- markers$profile_descriptor
  if (nrow(profile) != 1L) {
    add("profile_descriptor[distribution_dpe]", NA_character_, "exactly one marker")
  } else {
    add("profile_descriptor[distribution_dpe].required_scalar_version",
        profile$required_scalar_version[[1L]], expected[["scalar"]])
  }

  result <- if (length(mismatches)) do.call(rbind, mismatches) else data.frame(
    marker = character(), live = character(), expected = character(),
    stringsAsFactors = FALSE)
  bad <- result[!mapply(identical, as.character(result$live),
                        as.character(result$expected)), , drop = FALSE]
  if (nrow(bad)) {
    detail <- paste0("  - ", bad$marker, ": live=", ifelse(is.na(bad$live), "<absent>", bad$live),
                     " expected=", bad$expected, collapse = "\n")
    stop("Serving marker mismatch: nothing may have moved since inspection. ",
         "REFUSED with zero writes.\n", detail,
         "\nVerify the live markers and supply the current operator tokens.",
         call. = FALSE)
  }
  invisible(bad)
}


# Slice 3 â€” token chaining, one-transaction write, dry-run ---------------------
read_bridge_offre_tc_rows <- function(path) {
  if (!is.character(path) || length(path) != 1L || !nzchar(trimws(path)) || !file.exists(path))
    stop("Bridge requires ", BRIDGE_FACTS_ENV, " pointing to the freshly built ",
         "offre_tc facts (a private .rds or .csv file)", call. = FALSE)
  rows <- if (grepl("\\.rds$", tolower(path))) readRDS(path) else
    readr::read_csv(path, show_col_types = FALSE)
  validate_bridge_offre_tc_rows(rows)
  rows
}

# The Habitat descriptor's linked token is "<canonical>-<profile>-<scalar>-<ref>".
# Rebuild it from the live tokens rather than hardcoding a composition: a live
# string that is not chained to the verified tokens is a hard refusal.
bridge_rebind_linked_version <- function(live_linked, live_tokens, new_tokens) {
  fields <- c("profile", "scalar", "reference")
  if (!is.character(live_linked) || length(live_linked) != 1L || is.na(live_linked) ||
      !all(fields %in% names(live_tokens)) || !all(fields %in% names(new_tokens)))
    stop("Bridge cannot re-chain an invalid Habitat linked token", call. = FALSE)
  suffix <- paste0("-", paste(unname(live_tokens[fields]), collapse = "-"))
  if (!endsWith(live_linked, suffix))
    stop("The live Habitat linked token is not chained to the live publication ",
         "tokens; refusing with zero writes", call. = FALSE)
  prefix <- substr(live_linked, 1L, nchar(live_linked) - nchar(suffix))
  paste0(prefix, "-", paste(unname(new_tokens[fields]), collapse = "-"))
}

bridge_compute_new_tokens <- function(projection, reference_rows, reference_version,
                                      markers, expected) {
  scalar_version <- scalar_content_version(projection)
  comparison <- project_scalar_comparisons(
    projection, reference_rows,
    input_scalar_content_version = scalar_version,
    reference_content_version = reference_version)
  live_linked <- markers$selected_descriptor$linked_content_version[[1L]]
  live_tokens <- expected[c("profile", "scalar", "reference")]
  new_tokens <- c(profile = expected[["profile"]], scalar = scalar_version,
                  reference = reference_version)
  list(scalar = scalar_version, comparison = comparison$content_version,
       profile = expected[["profile"]], habitat = expected[["habitat"]],
       reference = reference_version,
       linked = bridge_rebind_linked_version(live_linked, live_tokens, new_tokens),
       comparison_projection = comparison)
}

# Marker-only rebind of the Habitat linked token. The declared-profile binding
# is written by the NORMAL registered profile publisher together with its
# recomputed hash lineage. The WHERE clause uses the verified live linked token,
# so a concurrent move breaks the UPDATE and the whole transaction rolls back.
bridge_marker_writer <- function(con, old_linked, execute = NULL) {
  exec <- if (is.null(execute)) function(sql, params) DBI::dbExecute(con, sql, params = params) else execute
  list(
    set_habitat_linked = function(new_linked) {
      changed <- exec(paste(
        "UPDATE selected_reading_descriptor SET linked_content_version=$1",
        "WHERE linked_content_version=$2"),
        list(new_linked, old_linked))
      if (!identical(as.integer(changed), 1L))
        stop("Habitat linked-token rebind affected ", changed,
             " rows; expected exactly one. REFUSED, rolling back.", call. = FALSE)
      invisible(TRUE)
    })
}

publish_bridge_snapshot <- function(con, plan, retired_ids, expected,
                                    transaction = with_publication_transaction,
                                    scalar_adapter = NULL,
                                    comparison_adapter = NULL,
                                    profile_adapter = NULL,
                                    writer = NULL, read_markers = NULL, read_live = NULL) {
  if (is.null(scalar_adapter)) scalar_adapter <- scalar_postgres_adapter(con)
  if (is.null(comparison_adapter)) comparison_adapter <- scalar_comparison_postgres_adapter(con)
  if (is.null(profile_adapter)) profile_adapter <- profile_postgres_adapter(con)
  if (is.null(read_markers)) read_markers <- function() plan$markers
  registry <- register_scalar_publisher(list(), "bridge_scalar_snapshot",
    project = function(canonical) canonical,
    publish = function(projection, db, version) db$replace(projection, version))

  transaction(con, {
    # The scalar publisher's own advisory lock helper (pg_advisory_xact_lock
    # 594,1) serialises this whole write, is re-entrant in-session and is held
    # until commit. Re-read the markers under that lock: a token that moved
    # since the dry-run aborts before the first write.
    scalar_adapter$lock("scalar_observation")
    fresh_markers <- read_markers()
    assert_bridge_markers(fresh_markers, expected)
    if (!is.null(read_live))
      assert_bridge_round_trip(read_live(), plan$projection, plan$affected)
    if (is.null(writer))
      writer <- bridge_marker_writer(
        con, fresh_markers$selected_descriptor$linked_content_version[[1L]])
    # The normal scalar publisher owns the whole-table replace and the explicit
    # retirement policy (including the retired indicators' comparison lineage).
    scalar <- publish_registered_scalar(
      registry, "bridge_scalar_snapshot", plan$projection, scalar_adapter,
      retired_indicator_ids = retired_ids)
    if (!identical(as.character(scalar$content_version), as.character(plan$tokens$scalar)))
      stop("The written scalar token differs from the prepared bridge token",
           call. = FALSE)
    comparison <- publish_registered_scalar_comparison(
      plan$tokens$comparison_projection, comparison_adapter)
    # The scalar-binding change cascades into the declared-profile descriptor
    # hash, the declared_profile marker and the profile comparison marker. The
    # NORMAL registered profile publisher recomputes all three (and rewrites the
    # comparison rows with the new version) from the live-read, rebound profile
    # projections — the same producer functions the #1068 artifact path uses.
    profile <- NULL
    if (!is.null(plan$profiles) && length(plan$profiles)) {
      base <- names(plan$profiles)[[1L]]
      registry <- register_profile_publisher(list(), "bridge_declared_profiles",
        project = function(canonical) canonical,
        publish = function(projection, db, version) db$replace(projection, version))
      profile <- publish_registered_profile(
        registry, "bridge_declared_profiles", plan$profiles[[base]], profile_adapter,
        additional_projections = plan$profiles[setdiff(names(plan$profiles), base)])
      if (!identical(as.character(profile$content_version),
                     as.character(plan$profile_lineage$version)))
        stop("The written profile token differs from the recomputed lineage",
             call. = FALSE)
    }
    writer$set_habitat_linked(plan$tokens$linked)
    invisible(list(scalar = scalar, comparison = comparison, profile = profile,
                   linked = plan$tokens$linked))
  })
}

bridge_print_report <- function(plan, mode) {
  cat("offre_tc serving bridge (", mode, ")\n", sep = "")
  cat("new scalar token:", plan$tokens$scalar, "\n")
  cat("new comparison token:", plan$tokens$comparison, "\n")
  cat("new Habitat linked token:", plan$tokens$linked, "\n")
  cat("retired indicators in this bridge:", length(plan$retired_ids), "\n")
  cat("per-indicator diff:\n")
  print(plan$diff, row.names = FALSE)
  if (identical(mode, "dry-run")) cat("dry-run: no database writes performed\n")
  invisible(plan)
}

# The single entry point used by the two CLI commands. Every guard runs before
# the write callback; collaborators are injectable so the pure tests never open
# a connection and the guarded DB proof can target lusk_it_* only.
run_offre_tc_bridge <- function(mode = c("dry-run", "publish"), env = Sys.getenv,
                                con = NULL, config = NULL, connect = NULL,
                                live_reader = bridge_live_reader(),
                                read_markers = NULL,
                                fresh_rows = NULL, metadata = NULL,
                                retired_ids = retained_scalar_retirement_ids(),
                                publish = publish_bridge_snapshot, lock = NULL) {
  mode <- match.arg(mode)
  expected <- bridge_expected_tokens_from_env(env)
  if (is.null(con)) {
    if (is.null(config)) config <- configuration_service_postgres()
    if (is.null(connect)) connect <- function(cfg) do.call(DBI::dbConnect,
      c(list(drv = RPostgres::Postgres()), cfg))
    con <- connect(config)
    on.exit(DBI::dbDisconnect(con), add = TRUE)
  }
  # Hold the scalar advisory lock (same key as the registered scalar publisher)
  # from BEFORE the guard reads until after the write, so no token can move
  # between inspection and commit. Injected fake connections in pure tests do
  # not execute SQL.
  if (is.null(lock)) lock <- function(con) {
    if (inherits(con, "fake-con")) invisible(NULL)
    else DBI::dbGetQuery(con, "SELECT pg_advisory_lock(594, 1)")
  }
  lock(con)
  on.exit({
    if (!inherits(con, "fake-con"))
      try(DBI::dbGetQuery(con, "SELECT pg_advisory_unlock(594, 1)"), silent = TRUE)
  }, add = TRUE)
  scope <- bridge_scope()
  if (is.null(read_markers)) read_markers <- function() retained_backend_markers(con)

  live <- read_live_scalar_projection(con, reader = live_reader)
  markers <- read_markers()
  assert_bridge_markers(markers, expected)
  if (is.null(fresh_rows))
    fresh_rows <- read_bridge_offre_tc_rows(env(BRIDGE_FACTS_ENV, unset = ""))
  if (is.null(metadata)) metadata <- lire_theme_metadata(scope$theme)
  built <- build_bridge_scalar_projection(
    live, fresh_rows, metadata, retired_ids,
    offre_tc_id = scope$indicators[[1L]])
  diff <- assert_bridge_round_trip(live, built$projection, built$affected)
  tokens <- bridge_compute_new_tokens(
    built$projection, live_reader$reference_rows(con), expected[["reference"]],
    markers, expected)
  # The scalar token change also rebinds every scalar-backed declared profile.
  # Reconstruct those owners from the live rows and recompute their hash lineage
  # through the SAME producer functions the #1068 artifact path uses.
  profiles <- bridge_read_live_profile_projections(
    con, reader = live_reader, metadata = bridge_profile_contracts(),
    new_scalar = tokens$scalar)
  lineage <- bridge_profile_lineage_tokens(
    profiles, live_reader$reference_rows(con), expected[["reference"]])
  plan <- list(mode = mode, projection = built$projection, live = live,
               diff = diff, tokens = tokens, markers = markers,
               expected = expected, retired_ids = retired_ids,
               profiles = profiles, profile_lineage = lineage)
  bridge_print_report(plan, mode)

  if (identical(mode, "dry-run")) return(invisible(plan))
  assert_bridge_publish_opt_in(env)
  assert_bridge_dump_confirmed(env)
  publish(con, plan, retired_ids, expected,
          read_markers = read_markers,
          read_live = function() read_live_scalar_projection(con, reader = live_reader))
}


# --- Review fix 4: profile hash lineage from live-read projections ------------
# The DPE descriptor hash, the declared_profile marker and the profile comparison
# marker all chain from required_scalar_version. The #1068 path refreshes the
# profile ARTIFACT metadata-only and re-runs the registered profile publisher.
# Here the artifacts are lost, so the same producer functions run over profile
# projections read back from the LIVE serving rows. No hash is hand-built.
bridge_recompute_profile_descriptor_version <- function(owner, descriptor, axes,
                                                        metadata) {
  binding <- descriptor$required_scalar_version
  if (is.null(binding) || length(binding) == 0L || is.na(binding))
    return(descriptor$descriptor_version)
  contracts <- if (!is.null(metadata$profile_contracts)) metadata$profile_contracts else metadata
  contract <- contracts[[owner]]
  if (!is.list(contract))
    stop("Recomputing profile lineage requires the producer contract for ", owner,
         call. = FALSE)
  without_version <- descriptor
  without_version$descriptor_version <- NULL
  # Exactly the hash input of project_dpe_profile() / the producer owners.
  profile_content_version(list(without_version, axes, contract))
}

bridge_read_live_profile_projections <- function(con, reader = bridge_live_reader(),
                                                 metadata, new_scalar) {
  rows <- reader$profile_descriptors(con)
  if (!is.data.frame(rows) || !nrow(rows))
    stop("Bridge cannot rebind profile lineage: no live declared-profile rows",
         call. = FALSE)
  sources <- reader$profile_sources(con)
  axes_rows <- reader$profile_axes(con)
  facts <- reader$profile_facts(con)
  provenance <- reader$profile_provenance(con)
  vintages <- reader$vintages(con)
  datasets <- reader$datasets(con)
  territories <- reader$territories(con)
  profiles <- lapply(seq_len(nrow(rows)), function(i) {
    row <- rows[i, , drop = FALSE]
    owner <- as.character(row$indicator_id[[1L]])
    owner_axes <- axes_rows[axes_rows$indicator_id == owner,
                            c("axis_name", "axis_key", "label", "ordinal", "unit"),
                            drop = FALSE]
    owner_axes$axis_name <- as.character(owner_axes$axis_name)
    owner_axes$axis_key <- as.character(owner_axes$axis_key)
    owner_axes$ordinal <- as.integer(owner_axes$ordinal)
    rownames(owner_axes) <- NULL
    details <- owner_axes$axis_key[owner_axes$axis_name == "detail"]
    sexes <- owner_axes$axis_key[owner_axes$axis_name == "sex"]
    scalar_bound <- !is.na(row$required_scalar_version[[1L]])
    descriptor <- list(
      indicator_id = owner, theme_id = as.character(row$theme_id[[1L]]),
      levels = as.character(row$allowed_levels[[1L]]),
      details = details, sexes = sexes,
      label = as.character(row$label[[1L]]), unit = as.character(row$unit[[1L]]),
      source = as.character(sources$source_id[sources$indicator_id == owner]),
      comparison_detail = if (is.na(row$comparison_detail[[1L]])) NA_character_ else as.character(row$comparison_detail[[1L]]),
      comparison_sex = if (is.na(row$comparison_sex[[1L]])) NA_character_ else as.character(row$comparison_sex[[1L]]),
      comparison_direction = as.character(row$comparison_direction[[1L]]),
      completeness = as.character(row$completeness[[1L]]))
    if (scalar_bound) {
      descriptor$comparison_scalar <- as.character(row$comparison_scalar[[1L]])
      descriptor$required_scalar_version <- as.character(new_scalar)
      descriptor$descriptor_version <- bridge_recompute_profile_descriptor_version(
        owner, descriptor, owner_axes, metadata)
    } else {
      descriptor$denominator_semantics <- if (is.na(row$denominator_semantics[[1L]])) NULL else as.character(row$denominator_semantics[[1L]])
      descriptor$detail_units_required <- isTRUE(row$detail_units_required[[1L]])
      descriptor$descriptor_version <- as.character(row$descriptor_version[[1L]])
    }
    owner_facts <- facts[facts$indicator_id == owner, , drop = FALSE]
    owner_facts <- data.frame(
      territory_id = as.character(owner_facts$territory_id),
      territory_type = as.character(owner_facts$territory_type),
      detail = as.character(owner_facts$detail_key),
      sex = as.character(owner_facts$sex_key),
      value = as.numeric(owner_facts$value),
      status = as.character(owner_facts$status), stringsAsFactors = FALSE)
    rownames(owner_facts) <- NULL
    used_sources <- unique(as.character(provenance$source_id[
      provenance$indicator_id == owner]))
    eligible <- unique(territories[territories$territory_type %in% descriptor$levels,
                                   c("territory_id", "territory_type"), drop = FALSE])
    rownames(eligible) <- NULL
    profile_provenance <- provenance[provenance$indicator_id == owner, , drop = FALSE]
    profile_datasets <- datasets[datasets$source_id %in% used_sources, , drop = FALSE]
    profile_vintages <- vintages[vintages$source_id %in% used_sources, , drop = FALSE]
    rownames(profile_provenance) <- rownames(profile_datasets) <- rownames(profile_vintages) <- NULL
    list(facts = owner_facts, axes = owner_axes, descriptor = descriptor,
         provenance = profile_provenance, datasets = profile_datasets,
         vintages = profile_vintages, eligible_territories = eligible)
  })
  names(profiles) <- as.character(rows$indicator_id)
  profiles
}

bridge_rebind_profile_lineage <- function(profiles, metadata, new_scalar) {
  rebound <- profiles
  for (owner in names(profiles)) {
    descriptor <- profiles[[owner]]$descriptor
    if (!is.null(descriptor$required_scalar_version)) {
      descriptor$required_scalar_version <- as.character(new_scalar)
      descriptor$descriptor_version <- bridge_recompute_profile_descriptor_version(
        owner, descriptor, profiles[[owner]]$axes, metadata)
      rebound[[owner]]$descriptor <- descriptor
    }
  }
  rebound
}

bridge_profile_lineage_tokens <- function(profiles, reference_rows,
                                          reference_version) {
  # Mirror publish_registered_profile()'s assembly EXACTLY: the base projection
  # comes first (unnamed in the c() call), additional owners keep their names,
  # then the list is ordered by declared indicator id. Reordering or renaming
  # changes the RDS hash, so the token must be built the same way.
  base <- names(profiles)[[1L]]
  assembled <- c(list(profiles[[base]]), profiles[setdiff(names(profiles), base)])
  ids <- vapply(assembled, function(p) p$descriptor$indicator_id, character(1))
  assembled <- assembled[order(ids)]
  projection <- if (length(assembled) == 1L) assembled[[1L]] else list(profiles = assembled)
  version <- profile_content_version(projection)
  comparisons <- project_declared_profile_comparisons(
    assembled, reference_rows, version, reference_version)
  list(version = version, comparison_version = profile_content_version(comparisons),
       comparison = comparisons, projection = projection)
}


# Profile owners span themes; gather their producer contracts from the canonical
# metadata files instead of assuming a single theme owns every declared profile.
bridge_profile_contracts <- function() {
  directory <- system.file("extdata", "theme-metadata", package = "lusk")
  files <- list.files(directory, pattern = "^theme_.*\\.json$", full.names = TRUE)
  if (!length(files)) stop("No canonical theme metadata for profile lineage", call. = FALSE)
  contracts <- list()
  for (path in files) {
    metadata <- jsonlite::fromJSON(path, simplifyVector = FALSE)
    for (name in names(metadata$profile_contracts %||% list()))
      contracts[[name]] <- metadata$profile_contracts[[name]]
  }
  contracts
}

