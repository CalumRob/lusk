# Fixtures for the guarded #1071 offre_tc serving bridge.
# These are synthetic, live-shaped scalar rows: they mimic the projection that
# is read back from the serving tables. No real territory, fact or publication
# token is copied here, and no database connection is needed.

bridge_fixture_metadata <- function() lire_theme_metadata("mobilite")

bridge_fixture_eligible <- function() {
  data.frame(
    territory_id = c("29001", "29002", "35001", "242900314"),
    territory_type = c("commune", "commune", "commune", "epci"),
    stringsAsFactors = FALSE)
}

bridge_fixture_vintage <- function(source_id = "korrigo") {
  data.frame(
    source_id = source_id,
    vintage_id = "2026-02/2026-02-28",
    version = "2026-02",
    reference_date = as.Date("2026-02-28"),
    publication_date = as.Date("2026-08-06"),
    stringsAsFactors = FALSE)
}

bridge_fixture_simple_descriptor <- function(id, label, facet = NA_character_) {
  data.frame(
    indicator_id = id, theme_id = "fixture",
    allowed_sources = I(list("fixture_source")),
    label = label, unit = "count", direction = "high",
    comparison_facet = facet, allowed_levels = I(list("commune")),
    denominator_semantics = "count", completeness = "sparse",
    descriptor_version = paste0("v1-", id), stringsAsFactors = FALSE)
}

# A live-shaped scalar snapshot with:
#   - two preserved indicators (one of them with a comparison facet);
#   - one of the 29 retired legacy ids;
#   - the old (building-based) offre_tc facts.
bridge_live_fixture <- function() {
  metadata <- bridge_fixture_metadata()
  eligible <- bridge_fixture_eligible()
  offre_tc_descriptor <- scalar_descriptor_row(metadata, "offre_tc")
  descriptors <- rbind(
    bridge_fixture_simple_descriptor("kept_scalar", "Kept", "kept_scalar"),
    bridge_fixture_simple_descriptor("other_kept", "Other kept"),
    bridge_fixture_simple_descriptor("tot_loss_t", "Retired legacy", "tot_loss_t"),
    offre_tc_descriptor)
  rownames(descriptors) <- NULL
  facts <- rbind(
    data.frame(indicator_id = "kept_scalar", territory_id = c("29001", "29002"),
               territory_type = "commune", value = c(1, 2), status = "measured",
               support_count = NA_integer_, denominator_count = NA_integer_,
               stringsAsFactors = FALSE),
    data.frame(indicator_id = "other_kept", territory_id = "29001",
               territory_type = "commune", value = 7, status = "measured",
               support_count = NA_integer_, denominator_count = NA_integer_,
               stringsAsFactors = FALSE),
    data.frame(indicator_id = "tot_loss_t", territory_id = "29001",
               territory_type = "commune", value = 0.4, status = "measured",
               support_count = NA_integer_, denominator_count = NA_integer_,
               stringsAsFactors = FALSE),
    data.frame(indicator_id = "offre_tc", territory_id = c("29001", "29002"),
               territory_type = "commune", value = c(0.10, 0.20), status = "measured",
               support_count = NA_integer_, denominator_count = NA_integer_,
               stringsAsFactors = FALSE))
  rownames(facts) <- NULL
  provenance <- data.frame(
    indicator_id = c(rep("kept_scalar", 2L), "other_kept", "tot_loss_t",
                     rep("offre_tc", 2L)),
    territory_id = c("29001", "29002", "29001", "29001", "29001", "29002"),
    source_id = c(rep("fixture_source", 4L), rep("korrigo", 2L)),
    vintage_id = c(rep("fixture/2025", 4L), rep("2026-02/2026-02-28", 2L)),
    stringsAsFactors = FALSE)
  fixture_vintage <- data.frame(
    source_id = "fixture_source", vintage_id = "fixture/2025", version = "fixture",
    reference_date = as.Date("2025-01-01"), publication_date = as.Date("2025-01-02"),
    stringsAsFactors = FALSE)
  projection <- list(
    facts = facts, descriptors = descriptors, provenance = provenance,
    datasets = data.frame(
      source_id = c("fixture_source", "korrigo"),
      name = c("Fixture source", "Bretagne Mobilité"), stringsAsFactors = FALSE),
    vintages = rbind(fixture_vintage, bridge_fixture_vintage()),
    eligible_territories = eligible)
  validate_scalar_artifact_projection(projection)
  projection
}

# Producer-shaped rows: the output of produire_offre_tc_mobilite(), supplied by
# the operator as a private file. New address-based values for two communes.
bridge_fresh_offre_tc_rows <- function(values = c(0.9968, 0.9261)) {
  data.frame(
    territory_id = c("29001", "29002"), territory_type = "commune",
    indicator_id = "offre_tc", value = values, unit = "%",
    source_name = "Bretagne Mobilité", source_version = "2026-02",
    reference_date = "2026-02-28", publication_date = "2026-08-06",
    stringsAsFactors = FALSE)
}

bridge_fixture_reference_rows <- function() {
  data.frame(
    territory_id = c("29001", "29002", "35001", "242900314"),
    territory_type = c("commune", "commune", "commune", "epci"),
    name = c("A", "B", "C", "D"),
    density_class_code = rep("A", 4L),
    littoral_code = c("C", "NC", "NC", NA_character_),
    littoral_classement_source = c("Mer", NA_character_, NA_character_, NA_character_),
    stringsAsFactors = FALSE)
}

bridge_fixture_expected_tokens <- function() {
  c(scalar = "scalar-live", comparison = "comparison-live",
    profile = "profile-live", habitat = "habitat-live",
    reference = "reference-live")
}

bridge_fixture_markers <- function(expected = bridge_fixture_expected_tokens()) {
  list(
    tables = data.frame(
      table_name = c("territory_reference", "scalar_observation",
                     "declared_profile", "selected_reading"),
      content_version = unname(expected[c("reference", "scalar", "profile", "habitat")]),
      reference_content_version = c(NA_character_, unname(expected[["reference"]]),
                                    unname(expected[["reference"]]),
                                    unname(expected[["reference"]])),
      stringsAsFactors = FALSE),
    comparison = data.frame(
      content_version = unname(expected[["comparison"]]),
      scalar_content_version = unname(expected[["scalar"]]),
      reference_content_version = unname(expected[["reference"]]),
      stringsAsFactors = FALSE),
    series = data.frame(dataset_id = character(), content_version = character(),
                        reference_content_version = character(), stringsAsFactors = FALSE),
    profile_comparison = data.frame(
      content_version = "profile-comparison-live", profile_content_version = unname(expected[["profile"]]),
      reference_content_version = unname(expected[["reference"]]),
      group_row_count = 1L, territory_row_count = 1L, stringsAsFactors = FALSE),
    selected_publication = data.frame(
      theme_id = "habitat", content_version = unname(expected[["habitat"]]),
      reference_content_version = unname(expected[["reference"]]), row_count = 2L,
      stringsAsFactors = FALSE),
    selected_descriptor = data.frame(
      theme_id = "habitat", descriptor_version = unname(expected[["habitat"]]),
      linked_content_version = paste("canonical", unname(expected[["profile"]]),
                                     unname(expected[["scalar"]]), unname(expected[["reference"]]), sep = "-"),
      stringsAsFactors = FALSE),
    profile_descriptor = data.frame(
      indicator_id = "distribution_dpe", descriptor_version = "dpe-live",
      required_scalar_version = unname(expected[["scalar"]]), stringsAsFactors = FALSE))
}
