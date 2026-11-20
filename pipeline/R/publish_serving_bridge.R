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
bridge_offre_tc_id <- function() {
  scalar_scope_contract("mobilite", "offre_tc")$indicators[[1L]]
}

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
