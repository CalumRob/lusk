# TEST ONLY — bounded synthetic projections for the three #1139 shape adapters.
# They follow the producers' own contracts (validate_*), never a second copy of
# production SQL. Nothing here is called by production code.

adaptateur_revision <- function(source_id = "ocsge", vintage_id = "v1") {
  fields <- list(source_id, vintage_id, "OCS GE", "ocsge_dataset", "v1",
                 "2020-01-01", "2021-01-01")
  hash <- series_revision_hash(fields[[1L]], fields[[2L]], fields[[3L]],
    fields[[4L]], fields[[5L]], fields[[6L]], fields[[7L]])
  data.frame(provenance_revision_id = paste0(source_id, "-", vintage_id, "-",
               substr(hash, 1L, 16L)),
    source_id = source_id, vintage_id = vintage_id, source_name = fields[[3L]],
    dataset_name = fields[[4L]], source_version = fields[[5L]],
    reference_date = as.Date(fields[[6L]]), publication_date = as.Date(fields[[7L]]),
    revision_hash = hash, stringsAsFactors = FALSE)
}

# A valid owned-series projection for the OCS-GE `artif_par_habitant` dataset.
# axis_kind = state_role keeps both M2/M3 roles without requiring the full
# declared-detail metadata bundle; the adapter contract is identical.
adaptateur_series_projection <- function(dataset_id = "artif_par_habitant",
                                         value = 10) {
  revision <- adaptateur_revision()
  territories <- artefacts_fixture_territories()
  territories <- territories[territories$territory_type == "commune", , drop = FALSE]
  axes <- c("M2", "M3")
  points <- do.call(rbind, lapply(axes, function(axis) data.frame(
    dataset_id = dataset_id, indicator_id = "artif_par_habitant",
    territory_id = territories$territory_id, territory_type = "commune",
    axis_value = axis, observation_period = "2019-2020",
    value = value + if (identical(axis, "M3")) 1 else 0,
    status = "measured", stringsAsFactors = FALSE)))
  projection <- list(dataset_id = dataset_id,
    descriptor = list(dataset_id = dataset_id, indicator_id = "artif_par_habitant",
      axis_kind = "state_role", axis_values = axes, completeness = "may_be_missing",
      comparison_point = NULL, label = "Artificialisation", unit = "m2/hab",
      direction = "none", allowed_levels = c("commune", "epci"),
      descriptor_version = "artif-par-habitant-v1", theme_id = "milieux"),
    points = points, provenance = revision,
    point_provenance = unique(data.frame(dataset_id = dataset_id,
      indicator_id = "artif_par_habitant", territory_id = points$territory_id,
      axis_value = points$axis_value,
      provenance_revision_id = revision$provenance_revision_id[[1L]],
      stringsAsFactors = FALSE)))
  validate_owned_series_projection(projection)
  projection
}

adaptateur_series_artefact <- function(root, dataset_id = "artif_par_habitant",
                                       value = 10, reference_version = "reference-v1") {
  projection <- adaptateur_series_projection(dataset_id, value)
  contenu <- contenu_artefact(
    faits_forme(REGISTRE_FORMES_RESSOURCE[["owned_series"]], projection),
    projection$descriptor, projection$provenance,
    list(reference_content_version = reference_version, kind = "owned_series"))
  ecrit <- ecrire_artefact_ressource(dataset_id, "owned_series", contenu,
    digests_lignage = digests_lignage_ressource("ocsge", artefacts_fixture_digests("ocsge")),
    root = root)
  lire_artefact_ressource(dataset_id, ecrit$version, root = root)
}

# A valid period_detail observed-collection projection (acv-like).
adaptateur_collection_projection <- function(indicator = "acv", value = 5) {
  territories <- artefacts_fixture_territories()
  territories <- territories[territories$territory_type == "commune", , drop = FALSE]
  descriptor <- list(indicator_id = indicator, theme_id = "programmes",
    kind = "period_detail", label = "ACV", unit = "count",
    allowed_levels = c("commune", "epci"), comparison_detail = "acv_2023",
    comparison_period = "2023", direction = "high",
    descriptor_version = paste0(indicator, "-v1"))
  categories <- data.frame(indicator_id = indicator, detail_key = c("acv_2022", "acv_2023"),
    label = c("2022", "2023"), ordinal = c(0L, 1L), source_id = "programme_source",
    stringsAsFactors = FALSE)
  facts <- data.frame(indicator_id = indicator, territory_id = territories$territory_id,
    territory_type = "commune", detail_key = "acv_2023", observation_period = "2023",
    value = value, source_id = "programme_source", vintage_id = "v1", stringsAsFactors = FALSE)
  datasets <- data.frame(source_id = "programme_source", name = "Programmes", stringsAsFactors = FALSE)
  vintages <- data.frame(source_id = "programme_source", vintage_id = "v1", version = "v1",
    reference_date = as.Date("2023-01-01"), publication_date = as.Date("2024-01-01"),
    stringsAsFactors = FALSE)
  structure(list(descriptor = descriptor, categories = categories, facts = facts,
    datasets = datasets, vintages = vintages,
    provenance = data.frame(source_id = character(), vintage_id = character(),
      stringsAsFactors = FALSE)), class = "collection-projection")
}

adaptateur_collection_artefact <- function(root, indicator = "acv", value = 5) {
  projection <- adaptateur_collection_projection(indicator, value)
  contenu <- contenu_artefact(
    faits_forme(REGISTRE_FORMES_RESSOURCE[["observed_collection"]], projection),
    projection$descriptor, projection$provenance,
    list(reference_content_version = "reference-v1", kind = "observed_collection"))
  ecrit <- ecrire_artefact_ressource(indicator, "observed_collection", contenu,
    digests_lignage = digests_lignage_ressource("programme_source",
      artefacts_fixture_digests("programme_source")), root = root)
  lire_artefact_ressource(indicator, ecrit$version, root = root)
}
