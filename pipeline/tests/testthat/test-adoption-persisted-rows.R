# Golden persisted-row contracts captured from origin/main's pre-refactor
# writers (b7f468b4 parent line, before adoption row builders). Storage/default
# columns are represented as PostgreSQL would persist them; published_at remains
# excluded because it is declared storage-only.

.attendre_lignes_identiques <- function(actuel, attendu) {
  expect_setequal(names(actuel), names(attendu))
  for (table in names(actuel))
    expect_identical(normaliser_adoption(actuel[[table]]),
                     normaliser_adoption(attendu[[table]]), info = table)
}

.array_main <- function(x) {
  if (is.null(x) || !length(x) || anyNA(x)) return(NA_character_)
  if (length(x) == 1L && is.character(x) && startsWith(x, "{") && endsWith(x, "}")) return(x)
  paste0("{", paste(as.character(unlist(x, use.names = FALSE)), collapse = ","), "}")
}

.descripteur_scalaire_main <- function(rows) {
  champs <- c("indicator_id", "theme_id", "label", "unit", "direction",
    "comparison_facet", "denominator_semantics", "completeness", "descriptor_version")
  descriptor <- rows$descriptor[, champs, drop = FALSE]
  descriptor$allowed_levels <- vapply(rows$descriptor$allowed_levels, .array_main, character(1))
  list(scalar_descriptor = descriptor, scalar_descriptor_source = data.frame(
    indicator_id = rep(rows$descriptor$indicator_id, lengths(rows$descriptor$allowed_sources)),
    source_id = as.character(unlist(rows$descriptor$allowed_sources, use.names = FALSE)),
    stringsAsFactors = FALSE))
}

.descripteur_profil_main <- function(rows) {
  d <- .profil_liste(rows$descriptor)
  id <- as.character(d$indicator_id)[[1L]]
  levels <- as.character(unlist(.profil_champ(d, "levels", "commune"), use.names = FALSE))
  if (!length(levels)) levels <- "commune"
  sources <- as.character(unlist(.profil_champ(d, "source", character()), use.names = FALSE))
  list(profile_descriptor = data.frame(indicator_id = id,
    label = as.character(.profil_champ(d, "label", id))[[1L]],
    unit = as.character(.profil_champ(d, "unit", ""))[[1L]], allowed_levels = .array_main(levels),
    completeness = as.character(.profil_champ(d, "completeness", "dense_complete"))[[1L]],
    descriptor_version = as.character(.profil_champ(d, "descriptor_version", "v1"))[[1L]],
    comparison_detail = .profil_champ(d, "comparison_detail", NA_character_),
    comparison_sex = .profil_champ(d, "comparison_sex", NA_character_),
    comparison_direction = as.character(.profil_champ(d, "comparison_direction", "none"))[[1L]],
    theme_id = .profil_champ(d, "theme_id", NA_character_),
    comparison_scalar = .profil_champ(d, "comparison_scalar", NA_character_),
    required_scalar_version = .profil_champ(d, "required_scalar_version", NA_character_),
    denominator_semantics = .profil_champ(d, "denominator_semantics", NA_character_),
    detail_units_required = isTRUE(.profil_champ(d, "detail_units_required", FALSE)),
    stringsAsFactors = FALSE), profile_descriptor_source = data.frame(
      indicator_id = rep(id, length(sources)), source_id = sources, stringsAsFactors = FALSE))
}

.descripteur_series_main <- function(rows) {
  d <- rows$projection$descriptor
  data.frame(dataset_id = d$dataset_id, indicator_id = d$indicator_id,
    axis_kind = d$axis_kind, axis_values = .array_main(d$axis_values),
    completeness = d$completeness, comparison_point = d$comparison_point %||% NA_character_,
    label = d$label, unit = d$unit, direction = d$direction,
    allowed_levels = .array_main(d$allowed_levels), descriptor_version = d$descriptor_version,
    active_read_route = isTRUE(d$active_read_route),
    axis_numeric_values = .array_main(d$axis_numeric_values), theme_id = d$theme_id %||% NA_character_,
    comparison_statistic = d$comparison_statistic %||% NA_character_,
    comparison_scope = d$comparison_scope %||% NA_character_,
    observation_period_kind = d$observation_period_kind %||% NA_character_,
    absence_semantics = d$absence_semantics %||% "unavailable",
    comparison_levels = .array_main(d$comparison_levels), stringsAsFactors = FALSE)
}

.categories_collection_main <- function(projection) {
  categories <- projection$categories
  if (!"anchor_levels" %in% names(categories)) categories$anchor_levels <- NA_character_
  else categories$anchor_levels <- vapply(categories$anchor_levels, .array_main, character(1))
  if (!"rider_label" %in% names(categories)) categories$rider_label <- NA_character_
  if (!"clock_policy" %in% names(categories)) categories$clock_policy <- "dataset"
  categories
}

.descripteur_collection_main <- function(projection) {
  d <- projection$descriptor
  data.frame(indicator_id = d$indicator_id, theme_id = d$theme_id, kind = d$kind,
    label = d$label, unit = d$unit, descriptor_version = d$descriptor_version,
    allowed_levels = .array_main(d$allowed_levels),
    comparison_detail = d$comparison_detail %||% NA_character_,
    comparison_period = d$comparison_period %||% NA_character_, direction = d$direction,
    stringsAsFactors = FALSE)
}

test_that("refactor preserves persisted rows for scalar, profile, series and collection", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  reference <- artefacts_fixture_reference()
  projection <- artefacts_fixture_scalar_indicator("a", "src_a",
    c(10, 10, 5, 3, NA, 100, 50, 8, 8, 30))
  comparison <- comparaison_scalaire_ressource(projection, "a", reference)
  contenu <- contenu_artefact(faits_forme(REGISTRE_FORMES_RESSOURCE[["scalar"]], projection),
    projection$descriptors, projection$provenance, comparison)
  ecrit <- ecrire_artefact_ressource("a", "scalar", contenu, root = root)
  artefacts <- list(
    scalar = lire_artefact_ressource("a", ecrit$version, root = root),
    declared_profile = artefacts_fixture_profile_artefact(root = root)$artefact,
    owned_series = adaptateur_series_artefact(root),
    observed_collection = adaptateur_collection_artefact(root))

  actual <- REGISTRE_FORMES_RESSOURCE$scalar$lignes_persistees(artefacts$scalar)
  rows <- projeter_artefact_scalaire(artefacts$scalar)
  expected <- c(.descripteur_scalaire_main(rows), list(
    scalar_observation = rows$observations, scalar_observation_source = rows$provenance,
    source_dataset = rows$sources, source_vintage = rows$vintages,
    scalar_comparison_group = as.data.frame(rows$comparison$groups[c("comparison_context",
      "group_id", "territory_type", "indicator_id", "statistic", "median", "member_count",
      "eligible_count", "missing_count", "lineage_source_count")], stringsAsFactors = FALSE),
    scalar_comparison_territory = as.data.frame(rows$comparison$territories[c(
      "comparison_context", "group_id", "territory_type", "indicator_id", "territory_id",
      "value", "status", "rank", "tie_count", "rank_size")], stringsAsFactors = FALSE)))
  lineage <- rows$comparison$lineage
  lineage$comparison_family <- "scalar"
  lineage$comparison_content_version <- rows$comparison$content_version
  expected$comparison_source_lineage <- lineage[c("comparison_family", "comparison_context",
    "group_id", "territory_type", "facet_id", "source_id", "vintage_id",
    "comparison_content_version")]
  actual$scalar_observation$published_at <- NULL
  .attendre_lignes_identiques(actual, expected)

  actual <- REGISTRE_FORMES_RESSOURCE$declared_profile$lignes_persistees(artefacts$declared_profile)
  rows <- projeter_artefact_profil_declare(artefacts$declared_profile)
  axes <- rows$axes[c("indicator_id", "axis_name", "axis_key", "label", "ordinal", "unit")]
  facts <- rows$facts
  if (!"detail_axis_name" %in% names(facts)) facts$detail_axis_name <- "detail"
  facts <- facts[c("indicator_id", "territory_id", "territory_type", "detail_key", "sex_key",
    "detail_axis_name", "sex_axis_name", "value", "status")]
  expected <- c(.descripteur_profil_main(rows), list(profile_axis = axes,
    profile_observation = facts, profile_observation_source = rows$provenance,
    source_dataset = rows$datasets, source_vintage = rows$vintages,
    profile_comparison_group = rows$comparison$groups,
    profile_comparison_territory = rows$comparison$territories))
  lineage <- rows$comparison$lineage
  lineage$comparison_family <- "profile"
  lineage$comparison_content_version <- rows$comparison$content_version
  expected$comparison_source_lineage <- lineage[c("comparison_family", "comparison_context",
    "group_id", "territory_type", "facet_id", "source_id", "vintage_id",
    "comparison_content_version")]
  .attendre_lignes_identiques(actual, expected)

  actual <- REGISTRE_FORMES_RESSOURCE$owned_series$lignes_persistees(artefacts$owned_series)
  rows <- projeter_artefact_series(artefacts$owned_series)
  expected <- list(series_dataset_descriptor = .descripteur_series_main(rows))
  points <- rows$projection$points
  for (champ in c("state_role", "missing_reason"))
    if (!champ %in% names(points)) points[[champ]] <- NA_character_
  expected$series_dataset_observation <- points[c("dataset_id", "indicator_id", "territory_id",
    "territory_type", "axis_value", "state_role", "observation_period", "value",
    "missing_reason", "status")]
  expected$series_observation_provenance <- rows$projection$point_provenance
  expected$series_provenance_revision <- rows$projection$provenance
  expected$ordered_series_comparison_group <- rows$comparison$groups
  expected$ordered_series_comparison_group$dataset_id <- rows$dataset_id
  expected$ordered_series_comparison_group$indicator_id <- rows$projection$descriptor$indicator_id
  expected$ordered_series_comparison_territory <- rows$comparison$territories
  expected$ordered_series_comparison_territory$dataset_id <- rows$dataset_id
  expected$ordered_series_comparison_territory$indicator_id <- rows$projection$descriptor$indicator_id
  expected$ordered_series_comparison_lineage <- rows$comparison$lineage
  expected$ordered_series_comparison_lineage$dataset_id <- rows$dataset_id
  expected$ordered_series_comparison_lineage$indicator_id <- rows$projection$descriptor$indicator_id
  expected$ordered_series_comparison_zero_reason <- rows$comparison$zero_reasons
  expected$ordered_series_comparison_zero_reason$dataset_id <- rep(rows$dataset_id,
    nrow(expected$ordered_series_comparison_zero_reason))
  expected$ordered_series_comparison_zero_reason$indicator_id <- rep(
    rows$projection$descriptor$indicator_id, nrow(expected$ordered_series_comparison_zero_reason))
  expected$ordered_series_comparison_zero_reason$axis_value <- rep(
    rows$comparison$axis_values[[1L]], nrow(expected$ordered_series_comparison_zero_reason))
  pairs <- unique(rows$projection$provenance[c("source_id", "vintage_id")])
  expected$source_dataset <- data.frame(source_id = pairs$source_id,
    name = rows$projection$provenance$source_name, stringsAsFactors = FALSE)
  expected$source_vintage <- data.frame(source_id = pairs$source_id,
    vintage_id = pairs$vintage_id, version = rows$projection$provenance$source_version,
    reference_date = rows$projection$provenance$reference_date,
    publication_date = rows$projection$provenance$publication_date, stringsAsFactors = FALSE)
  for (table in c("series_named_reference_descriptor", "series_named_reference",
                  "series_named_reference_provenance", "series_context_parent_policy"))
    expected[[table]] <- actual[[table]][0L, , drop = FALSE]
  expected$ordered_series_comparison_group <- expected$ordered_series_comparison_group[c(
    "dataset_id", "indicator_id", "comparison_context", "group_id", "territory_type",
    "axis_value", "statistic", "group_value", "member_count", "eligible_count",
    "missing_count", "lineage_source_count")]
  expected$ordered_series_comparison_territory <- expected$ordered_series_comparison_territory[c(
    "dataset_id", "indicator_id", "comparison_context", "group_id", "territory_type",
    "axis_value", "territory_id", "value", "status", "rank", "tie_count", "rank_size")]
  expected$ordered_series_comparison_lineage <- expected$ordered_series_comparison_lineage[c(
    "dataset_id", "indicator_id", "comparison_context", "group_id", "territory_type",
    "axis_value", "provenance_revision_id")]
  expected$ordered_series_comparison_zero_reason <- expected$ordered_series_comparison_zero_reason[c(
    "dataset_id", "indicator_id", "comparison_context", "group_id", "territory_type",
    "axis_value", "reason", "member_count")]
  .attendre_lignes_identiques(actual, expected)

  actual <- REGISTRE_FORMES_RESSOURCE$observed_collection$lignes_persistees(
    artefacts$observed_collection)
  rows <- projeter_artefact_collection(artefacts$observed_collection)
  expected <- list(observed_collection_descriptor = .descripteur_collection_main(rows$projection),
    observed_collection_category = .categories_collection_main(rows$projection),
    period_detail_observation = rows$projection$facts,
    source_dataset = rows$projection$datasets, source_vintage = rows$projection$vintages,
    observed_collection_comparison_group = rows$comparison$groups,
    observed_collection_comparison_territory = rows$comparison$territories)
  expected$observed_collection_comparison_group$indicator_id <- rows$ressource
  expected$observed_collection_comparison_territory$indicator_id <- rows$ressource
  lineage <- rows$comparison$lineage
  lineage$indicator_id <- rows$ressource
  lineage$comparison_content_version <- scalar_content_version(rows$comparison)
  expected$observed_collection_comparison_lineage <- lineage
  .attendre_lignes_identiques(actual, expected)
})

test_that("refactor preserves persisted AEDAR aggregate and comparison rows", {
  projection <- adaptateur_aedar_projection()
  projection$facts <- projection$facts[seq_len(nrow(read_aedar_typequ_registry())), , drop = FALSE]
  rownames(projection$facts) <- NULL
  groups <- data.frame(comparison_context = "same_level", group_id = "g",
    territory_type = "epci", typequ = "T1", measure = "m", statistic = "median",
    value = 1, n_addresses = 1L, n_observed = 1L, coverage_status = "covered",
    stringsAsFactors = FALSE)
  density <- data.frame(group_id = "A", measure = "m", value = NA_real_,
    status = "unavailable", n_typequ = NA_integer_, n_addresses = NA_integer_,
    n_observed = NA_integer_, coverage_status = "unavailable", stringsAsFactors = FALSE)
  comparison <- list(content_version = "cmp", aedar_content_version = "aedar",
    reference_content_version = "ref", input_content_version = "input",
    groups = groups, density_rows = density, littoral_rows = NULL)
  artefact <- list(ressource = "aedar", version = "v", forme = "aedar", digests_lignage = list(),
    contenu = list(faits = projection, descriptor = list(indicator_id = "aedar"),
      provenance = projection$source, comparison = comparison))
  actual <- lignes_aedar_persistees(artefact)

  # Pre-refactor publish_aedar_aggregates built this payload inline from the
  # canonical level columns and TYPEQU metadata; keep that independent formula.
  x <- projection$facts
  level <- unique(as.character(x$territory_type))
  metadata <- projection$typequ_metadata[match(x$TYPEQU, projection$typequ_metadata$TYPEQU),
                                         , drop = FALSE]
  identity_columns <- setdiff(AEDAR_AGGREGATE_LEVEL_COLUMNS[[level]],
    c("TYPEQU", "LIB_TYPEQU", "n_addresses", "n_observed", "coverage_status"))
  aggregate <- data.frame(territory_type = x$territory_type, territory_id = x$territory_id,
    typequ = x$TYPEQU, typequ_label = x$LIB_TYPEQU,
    typequ_hierarchy_label = metadata$LIB_TYPEQU, typequ_description = metadata$description,
    typequ_domain_code = metadata$domain_code, typequ_domain_label = metadata$domain_label,
    typequ_subdomain_code = metadata$subdomain_code,
    typequ_subdomain_label = metadata$subdomain_label, typequ_gamme = metadata$GAMME,
    typequ_gamme_status = metadata$gamme_status,
    typequ_source_order = as.integer(metadata$source_order),
    identity = serialize_aedar_json_rows(as.data.frame(x[identity_columns], stringsAsFactors = FALSE)),
    n_addresses = as.numeric(x$n_addresses), n_observed = as.numeric(x$n_observed),
    coverage_status = x$coverage_status,
    measures = serialize_aedar_json_rows(as.data.frame(x[AEDAR_AGGREGATE_MEASURES],
      stringsAsFactors = FALSE)), source_id = projection$source$source_id,
    vintage_id = projection$source$vintage, source_url = projection$source$url,
    licence = projection$source$licence, attribution = projection$source$attribution,
    reference_date = as.Date(projection$source$reference_date),
    publication_date = as.Date(projection$source$publication_date), stringsAsFactors = FALSE)
  summary <- project_aedar_territory_summary(projection$facts, projection$source)
  names(summary)[names(summary) == "vintage"] <- "vintage_id"
  .attendre_lignes_identiques(actual$aedar_territorial_aggregate, aggregate)
  .attendre_lignes_identiques(actual$aedar_territory_summary, summary)
  .attendre_lignes_identiques(actual$aedar_comparison_group, groups)
  expected_density <- density
  expected_density$comparison_content_version <- "cmp"
  expected_density$aedar_content_version <- "aedar"
  expected_density$reference_content_version <- "ref"
  expected_density$input_content_version <- "input"
  .attendre_lignes_identiques(actual$aedar_density_class_summary, expected_density)
  expect_equal(nrow(actual$aedar_littoral_summary), 0L)
  expect_equal(nrow(actual$aedar_comparison_territory), 0L)
})
