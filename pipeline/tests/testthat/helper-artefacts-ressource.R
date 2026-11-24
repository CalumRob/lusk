# TEST ONLY — fixtures for the ADR-0049 « Artefact de ressource » slice (#1135).
# Nothing here is called by production code: the reference, scalar, profile,
# series, collection and AEDAR payloads are bounded synthetic projections whose
# shape follows the producers' own contracts.

artefacts_fixture_root <- function() tempfile("artefacts-ressource-")

artefacts_fixture_reference <- function(version = "reference-v1") {
  territories <- data.frame(
    territory_id = c("c1", "c2", "c3", "c4", "c5", "e1", "e2", "d1", "d2", "r1"),
    territory_type = c(rep("commune", 5), "epci", "epci", "departement", "departement", "region"),
    epci_id = c("e1", "e1", "e2", NA, "e2", NA, NA, NA, NA, NA),
    density_class_code = c("A", "A", "B", "A", "B", NA, NA, NA, NA, NA),
    stringsAsFactors = FALSE
  )
  list(rows = territories, content_version = version)
}

artefacts_fixture_territories <- function(reference = artefacts_fixture_reference()) {
  ids <- reference$rows$territory_id
  types <- reference$rows$territory_type
  data.frame(territory_id = ids, territory_type = types, stringsAsFactors = FALSE)
}

artefacts_fixture_scalar_indicator <- function(indicator_id, source_id, values) {
  eligible <- artefacts_fixture_territories()
  facts <- data.frame(
    indicator_id = rep(indicator_id, nrow(eligible)),
    territory_id = eligible$territory_id,
    territory_type = eligible$territory_type,
    value = values,
    status = ifelse(is.na(values), "not_available", "measured"),
    support_count = NA_integer_,
    denominator_count = NA_integer_,
    stringsAsFactors = FALSE
  )
  descriptors <- data.frame(
    indicator_id = indicator_id, theme_id = "demographie",
    allowed_sources = I(list(source_id)), label = indicator_id, unit = "count",
    direction = "high", comparison_facet = indicator_id,
    allowed_levels = I(list(c("commune", "epci", "departement", "region"))),
    denominator_semantics = "count", completeness = "sparse",
    descriptor_version = paste0(indicator_id, "-descriptor-v1"),
    stringsAsFactors = FALSE
  )
  provenance <- data.frame(
    indicator_id = rep(indicator_id, nrow(eligible)),
    territory_id = eligible$territory_id,
    source_id = source_id,
    vintage_id = "2020",
    stringsAsFactors = FALSE
  )
  list(facts = facts, descriptors = descriptors, provenance = provenance,
       eligible_territories = eligible)
}

artefacts_fixture_scalar_projections <- function() {
  a <- artefacts_fixture_scalar_indicator("densite", "census_densite",
    c(10, 10, 5, 3, NA, 100, 50, 8, 8, 30))
  b <- artefacts_fixture_scalar_indicator("offre_tc", "bpe_offer",
    c(2, 4, 6, 8, 10, 20, 40, 1, 2, 3))
  stats::setNames(list(a, b), c("densite", "offre_tc"))
}

artefacts_fixture_profile_projections <- function(reference_version = "reference-v1") {
  projection <- list(
    # Modélisé sur le profil déclaré réel : la comparaison scalaire dont il
    # dépend est une déclaration du producteur, pas un littéral du splitter.
    descriptor = list(indicator_id = "distribution_dpe", theme_id = "habitat",
      comparison_scalar = "part_passoires", required_scalar_version = "part-passoires-v1"),
    facts = data.frame(indicator_id = "distribution_dpe", territory_id = "c1",
      value = 1, stringsAsFactors = FALSE),
    provenance = data.frame(source_id = "profile_source", vintage_id = "v1",
      stringsAsFactors = FALSE),
    comparison = NULL)
  # Un profil déclaré peut porter une comparaison : ses jetons suivent la même
  # règle que le scalaire (faits de CETTE ressource + référence de la sortie).
  faits <- projection[setdiff(names(projection), c("descriptor", "provenance", "comparison"))]
  version <- version_artefact(contenu_artefact(faits, projection$descriptor,
    projection$provenance, NULL))
  projection$comparison <- list(scalar_content_version = version,
    reference_content_version = reference_version, kind = "declared_profile")
  list(distribution_dpe = projection)
}

artefacts_fixture_series_projections <- function() {
  list(prix_m2 = list(
    dataset_id = "prix_m2",
    descriptor = list(dataset_id = "prix_m2", indicator_id = "prix_m2"),
    facts = data.frame(dataset_id = "prix_m2", axis_value = "2020", value = 10,
      stringsAsFactors = FALSE),
    provenance = data.frame(source_id = "series_source", vintage_id = "v1",
      stringsAsFactors = FALSE)))
}

artefacts_fixture_collection_projections <- function() {
  list(acv = list(
    descriptor = list(indicator_id = "acv", theme_id = "programmes", kind = "anchored_membership"),
    facts = data.frame(indicator_id = "acv", territory_id = "c1", detail_key = "ACV",
      stringsAsFactors = FALSE),
    provenance = data.frame(source_id = "collection_source", vintage_id = "v1",
      stringsAsFactors = FALSE)))
}

artefacts_fixture_aedar_projection <- function() {
  list(aedar = list(
    descriptor = list(indicator_id = "aedar", theme_id = "mobilite"),
    facts = data.frame(territory_id = "c1", territory_type = "commune",
      n_addresses = 5, stringsAsFactors = FALSE),
    source = data.frame(source_id = "aedar_source", vintage = "2026-v1",
      stringsAsFactors = FALSE),
    comparison = NULL))
}

artefacts_fixture_all_projections <- function(reference_version = "reference-v1") {
  list(
    scalar = artefacts_fixture_scalar_projections(),
    declared_profile = artefacts_fixture_profile_projections(reference_version),
    owned_series = artefacts_fixture_series_projections(),
    observed_collection = artefacts_fixture_collection_projections(),
    aedar = artefacts_fixture_aedar_projection()
  )
}

artefacts_fixture_digests <- function(ids) {
  records <- lapply(as.character(ids), function(id)
    list(source_id = id, sha256 = paste0("sha256-", id), bytes = 10L))
  stats::setNames(records, as.character(ids))
}

artefacts_fixture_all_digests <- function() {
  artefacts_fixture_digests(c("census_densite", "bpe_offer", "profile_source",
    "series_source", "collection_source", "aedar_source", "unrelated_source"))
}

# Une sortie minimale RÉELLE (artefact scalaire de producteur + référence
# territoriale + digests de run) pour le test de bout en bout de la commande.
artefacts_fixture_sortie_scalaire <- function() {
  sortie <- tempfile("sortie-scalaire-")
  dir.create(sortie, recursive = TRUE)
  payload <- compute_payload_test(load_fixture())
  metadata <- jsonlite::fromJSON(testthat::test_path("..", "..", "inst", "extdata",
    "theme-metadata", "theme_demographie.json"), simplifyVector = FALSE)
  projection <- project_fixture_scalar(payload, metadata, completeness = "dense_complete",
    indicator_id = "densite")
  write_scalar_serving_artifact(projection,
    file.path(sortie, "scalar-serving", "demographie"))
  nanoparquet::write_parquet(as.data.frame(payload$territoires),
    file.path(sortie, "territoires.parquet"))
  source_id <- metadata$indicator_pages$densite$sources[[1L]]
  jsonlite::write_json(list(list(source_id = source_id, sha256 = "sha256-fixture",
    bytes = 10L)), file.path(sortie, "source-digests.json"), auto_unbox = TRUE)
  sortie
}
