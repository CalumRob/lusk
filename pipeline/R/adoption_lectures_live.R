# Lectures live d'adoption (#1142). Chaque forme declare ici SA lecture dans
# REGISTRE_FORMES_RESSOURCE. Les requetes réutilisent les projections et les
# décodeurs existants; adopt ne contient ni SQL ni switch par forme.

.adoption_query <- function(con, sql, params = NULL) {
  rows <- if (is.null(params)) DBI::dbGetQuery(con, sql) else
    DBI::dbGetQuery(con, sql, params = params)
  if (!is.data.frame(rows))
    stop("Adoption live reader did not return rows", call. = FALSE)
  as.data.frame(rows, stringsAsFactors = FALSE, optional = TRUE)
}

.adoption_count <- function(x) {
  if (inherits(x, "integer64")) as.integer(as.character(x)) else as.integer(x)
}

.adoption_array <- function(x) {
  if (is.list(x)) return(as.character(unlist(x, use.names = FALSE)))
  bridge_parse_text_array(x)
}

lire_live_scalaire <- function(con, ressource, reference) {
  id <- as.character(ressource)
  params <- list(id)
  descriptor <- .adoption_query(con, paste0(
    "SELECT indicator_id,theme_id,label,unit,direction,comparison_facet,",
    "allowed_levels,denominator_semantics,completeness,descriptor_version ",
    "FROM scalar_descriptor WHERE indicator_id=$1"), params)
  if (nrow(descriptor) != 1L)
    stop(paste0("adoption : descripteur scalaire absent ou multiple pour ", id), call. = FALSE)
  sources <- .adoption_query(con,
    "SELECT source_id FROM scalar_descriptor_source WHERE indicator_id=$1 ORDER BY source_id",
    params)$source_id
  descriptor$allowed_levels <- lapply(descriptor$allowed_levels, .adoption_array)
  descriptor$allowed_sources <- I(list(as.character(sources)))
  descriptor <- descriptor[c("indicator_id", "theme_id", "label", "unit", "direction",
    "comparison_facet", "denominator_semantics", "completeness", "descriptor_version",
    "allowed_levels", "allowed_sources")]
  levels <- as.character(descriptor$allowed_levels[[1L]])
  eligible <- unique(reference$rows[reference$rows$territory_type %in% levels,
                                   c("territory_id", "territory_type"), drop = FALSE])
  observations <- .adoption_query(con, paste0(
    "SELECT indicator_id,territory_id,territory_type,value,status,support_count,",
    "denominator_count,published_at FROM scalar_observation WHERE indicator_id=$1"), params)
  observations$support_count <- .adoption_count(observations$support_count)
  observations$denominator_count <- .adoption_count(observations$denominator_count)
  provenance <- .adoption_query(con, paste0(
    "SELECT indicator_id,territory_id,source_id,vintage_id FROM scalar_observation_source ",
    "WHERE indicator_id=$1"), params)
  comparison <- list(
    groups = .adoption_query(con,
      "SELECT * FROM scalar_comparison_group WHERE indicator_id=$1", params),
    territories = .adoption_query(con,
      "SELECT * FROM scalar_comparison_territory WHERE indicator_id=$1", params),
    lineage = .adoption_query(con, paste0(
      "SELECT comparison_context,group_id,territory_type,facet_id,source_id,vintage_id ",
      "FROM comparison_source_lineage WHERE comparison_family='scalar' AND facet_id=$1"), params))
  list(descriptor = descriptor, eligible_territories = eligible,
       observations = observations, provenance = provenance, comparison = comparison)
}

lire_live_profil_declare <- function(con, ressource, reference) {
  id <- as.character(ressource)
  params <- list(id)
  d <- .adoption_query(con, "SELECT * FROM profile_descriptor WHERE indicator_id=$1", params)
  if (nrow(d) != 1L)
    stop(paste0("adoption : descripteur de profil absent ou multiple pour ", id), call. = FALSE)
  axes <- .adoption_query(con, "SELECT * FROM profile_axis WHERE indicator_id=$1", params)
  sources <- .adoption_query(con,
    "SELECT source_id FROM profile_descriptor_source WHERE indicator_id=$1 ORDER BY source_id",
    params)$source_id
  descriptor <- as.list(d[1L, , drop = FALSE])
  descriptor$levels <- .adoption_array(d$allowed_levels[[1L]])
  descriptor$allowed_levels <- NULL
  descriptor$source <- as.character(sources)
  descriptor$sexes <- if (any(axes$axis_name == "sex")) "sex" else character()
  facts <- .adoption_query(con, paste0(
    "SELECT indicator_id,territory_id,territory_type,detail_key,sex_key,",
    "detail_axis_name,sex_axis_name,value,status FROM profile_observation ",
    "WHERE indicator_id=$1"), params)
  provenance <- .adoption_query(con, paste0(
    "SELECT indicator_id,territory_id,detail_key,sex_key,source_id,vintage_id ",
    "FROM profile_observation_source WHERE indicator_id=$1"), params)
  comparison <- list(
    groups = .adoption_query(con,
      "SELECT * FROM profile_comparison_group WHERE indicator_id=$1", params),
    territories = .adoption_query(con,
      "SELECT * FROM profile_comparison_territory WHERE indicator_id=$1", params),
    lineage = .adoption_query(con, paste0(
      "SELECT comparison_context,group_id,territory_type,facet_id,source_id,vintage_id ",
      "FROM comparison_source_lineage WHERE comparison_family='profile' AND facet_id=$1"), params))
  scalar_marker <- .adoption_query(con, paste0(
    "SELECT content_version FROM table_publication WHERE table_name='scalar_observation'"))
  global_scalar_token <- if (nrow(scalar_marker)) as.character(scalar_marker$content_version[[1L]]) else NA_character_
  list(descriptor = descriptor, axes = axes, facts = facts, provenance = provenance,
       datasets = data.frame(source_id = sources, name = sources, stringsAsFactors = FALSE),
       vintages = data.frame(), comparison = comparison,
       global_scalar_token = global_scalar_token)
}

# Today's full profile publisher binds required_scalar_version to the GLOBAL
# scalar snapshot; the Artefact de ressource binds the same proven dependency to
# its FACTS version. Accept only that exact live chain, never an arbitrary token.
normaliser_live_profil <- function(rows, artefacts, lectures) {
  dependance <- rows$descriptor$comparison_scalar
  if (is.null(dependance) || !length(dependance) || is.na(dependance)) return(rows)
  dependance <- as.character(dependance)[[1L]]
  if (is.null(artefacts[[dependance]])) return(rows)
  attendu <- version_faits_artefact(artefacts[[dependance]])
  live <- as.character(rows$descriptor$required_scalar_version[[1L]])
  global <- as.character(rows$global_scalar_token[[1L]])
  if (!is.na(live) && !is.na(global) && identical(live, global))
    rows$descriptor$required_scalar_version <- attendu
  rows$global_scalar_token <- NULL
  rows
}

lire_live_series <- function(con, ressource, reference) {
  id <- as.character(ressource)
  params <- list(id)
  d <- .adoption_query(con,
    "SELECT * FROM series_dataset_descriptor WHERE dataset_id=$1", params)
  if (nrow(d) != 1L)
    stop(paste0("adoption : descripteur de série absent ou multiple pour ", id), call. = FALSE)
  descriptor <- as.list(d[1L, , drop = FALSE])
  for (champ in c("axis_values", "allowed_levels", "comparison_levels"))
    if (!is.null(descriptor[[champ]]))
      descriptor[[champ]] <- .adoption_array(descriptor[[champ]])
  if (!is.null(descriptor$axis_numeric_values))
    descriptor$axis_numeric_values <- as.numeric(.adoption_array(descriptor$axis_numeric_values))

  points <- .adoption_query(con,
    "SELECT * FROM series_dataset_observation WHERE dataset_id=$1", params)
  for (champ in c("state_role", "missing_reason"))
    if (champ %in% names(points) && all(is.na(points[[champ]]))) points[[champ]] <- NULL
  point_provenance <- .adoption_query(con,
    "SELECT * FROM series_observation_provenance WHERE dataset_id=$1", params)
  provenance <- .adoption_query(con, paste0(
    "SELECT DISTINCT r.* FROM series_provenance_revision r ",
    "JOIN series_observation_provenance p USING(provenance_revision_id) ",
    "WHERE p.dataset_id=$1"), params)
  named_reference <- .adoption_query(con,
    "SELECT * FROM series_named_reference WHERE dataset_id=$1", params)
  named_reference_descriptors <- .adoption_query(con,
    "SELECT * FROM series_named_reference_descriptor WHERE dataset_id=$1", params)
  named_reference_provenance <- .adoption_query(con,
    "SELECT * FROM series_named_reference_provenance WHERE dataset_id=$1", params)
  policy <- .adoption_query(con,
    "SELECT * FROM series_context_parent_policy WHERE dataset_id=$1", params)
  projection <- list(dataset_id = id, descriptor = descriptor, points = points,
    provenance = provenance, point_provenance = point_provenance)
  if (nrow(named_reference) || nrow(named_reference_descriptors) ||
      nrow(named_reference_provenance)) {
    projection$named_reference <- named_reference
    projection$named_reference_descriptors <- named_reference_descriptors
    projection$named_reference_provenance <- named_reference_provenance
  }
  if (nrow(policy)) projection$context_parent_policy <- policy
  comparison <- list(
    groups = .adoption_query(con,
      "SELECT * FROM ordered_series_comparison_group WHERE dataset_id=$1", params),
    territories = .adoption_query(con,
      "SELECT * FROM ordered_series_comparison_territory WHERE dataset_id=$1", params),
    lineage = .adoption_query(con,
      "SELECT * FROM ordered_series_comparison_lineage WHERE dataset_id=$1", params),
    zero_reasons = .adoption_query(con,
      "SELECT * FROM ordered_series_comparison_zero_reason WHERE dataset_id=$1", params))
  # dataset_id is the storage scope; indicator_id/axis_value on zero reasons
  # are writer-added storage coordinates, not Artefact de ressource fields.
  comparison$groups$dataset_id <- NULL
  comparison$territories$dataset_id <- NULL
  comparison$lineage$dataset_id <- NULL
  comparison$zero_reasons$dataset_id <- NULL
  comparison$zero_reasons$indicator_id <- NULL
  comparison$zero_reasons$axis_value <- NULL
  marker <- .adoption_query(con,
    "SELECT * FROM ordered_series_comparison_publication WHERE dataset_id=$1", params)
  if (nrow(marker) == 1L) {
    for (champ in c("content_version", "ordered_series_content_version",
                    "reference_content_version"))
      comparison[[champ]] <- as.character(marker[[champ]][[1L]])
    comparison$axis_values <- .adoption_array(marker$comparison_axes[[1L]])
  }
  list(projection = projection, comparison = comparison)
}

lire_live_collection <- function(con, ressource, reference) {
  id <- as.character(ressource)
  params <- list(id)
  d <- .adoption_query(con,
    "SELECT * FROM observed_collection_descriptor WHERE indicator_id=$1", params)
  if (nrow(d) != 1L)
    stop(paste0("adoption : descripteur de collection absent ou multiple pour ", id),
         call. = FALSE)
  descriptor <- as.list(d[1L, , drop = FALSE])
  descriptor$allowed_levels <- .adoption_array(d$allowed_levels[[1L]])
  categories <- .adoption_query(con,
    "SELECT * FROM observed_collection_category WHERE indicator_id=$1", params)
  table <- switch(as.character(descriptor$kind), period_detail = "period_detail_observation",
                  anchored_membership = "anchored_membership",
                  stop("Unknown observed collection kind", call. = FALSE))
  facts <- .adoption_query(con, paste0("SELECT * FROM ", table, " WHERE indicator_id=$1"),
                           params)
  comparison <- list(
    groups = .adoption_query(con,
      "SELECT * FROM observed_collection_comparison_group WHERE indicator_id=$1", params),
    territories = .adoption_query(con,
      "SELECT * FROM observed_collection_comparison_territory WHERE indicator_id=$1", params),
    lineage = .adoption_query(con,
      "SELECT * FROM observed_collection_comparison_lineage WHERE indicator_id=$1", params))
  marker <- .adoption_query(con,
    "SELECT * FROM observed_collection_comparison_publication WHERE indicator_id=$1", params)
  if (nrow(marker) == 1L) {
    for (champ in c("content_version", "collection_content_version",
                    "reference_content_version"))
      comparison[[champ]] <- as.character(marker[[champ]][[1L]])
  }
  list(projection = list(descriptor = descriptor, categories = categories, facts = facts),
       comparison = comparison)
}

.adoption_json_frame <- function(x) {
  if (length(x) != 1L || is.na(x) || !nzchar(x))
    stop("Adoption requires one JSON row payload", call. = FALSE)
  as.data.frame(jsonlite::fromJSON(x, simplifyDataFrame = TRUE), stringsAsFactors = FALSE)
}

lire_live_aedar <- function(con, ressource, reference) {
  raw <- .adoption_query(con, "SELECT * FROM aedar_territorial_aggregate")
  if (!nrow(raw)) stop("adoption : agrégat AEDAR absent", call. = FALSE)
  facts <- list()
  metadata <- NULL
  for (level in AEDAR_AGGREGATE_LEVELS) {
    rows <- raw[raw$territory_type == level, , drop = FALSE]
    identity <- do.call(rbind, lapply(rows$identity, .adoption_json_frame))
    measures <- do.call(rbind, lapply(rows$measures, .adoption_json_frame))
    facts[[level]] <- cbind(data.frame(
      territory_type = rows$territory_type, territory_id = rows$territory_id,
      TYPEQU = rows$typequ, LIB_TYPEQU = rows$typequ_label,
      stringsAsFactors = FALSE), identity,
      n_addresses = .adoption_count(rows$n_addresses),
      n_observed = .adoption_count(rows$n_observed), coverage_status = rows$coverage_status,
      measures, stringsAsFactors = FALSE)
    if (is.null(metadata)) metadata <- unique(data.frame(
      TYPEQU = rows$typequ, LIB_TYPEQU = rows$typequ_label,
      description = rows$typequ_description, domain_code = rows$typequ_domain_code,
      domain_label = rows$typequ_domain_label, subdomain_code = rows$typequ_subdomain_code,
      subdomain_label = rows$typequ_subdomain_label, GAMME = rows$typequ_gamme,
      gamme_status = rows$typequ_gamme_status, source_order = rows$typequ_source_order,
      stringsAsFactors = FALSE))
  }
  # The producer's level columns are a closed contract; JSON identity decoding
  # supplies them in that same order rather than inventing a second projection.
  for (level in AEDAR_AGGREGATE_LEVELS)
    facts[[level]] <- facts[[level]][, unique(c("territory_type", "territory_id",
      AEDAR_AGGREGATE_LEVEL_COLUMNS[[level]], AEDAR_AGGREGATE_MEASURES)), drop = FALSE]
  source_row <- raw[1L, , drop = FALSE]
  dataset <- .adoption_query(con,
    "SELECT name FROM source_dataset WHERE source_id=$1", list(source_row$source_id))
  if (nrow(dataset) != 1L) stop("adoption : source AEDAR absent", call. = FALSE)
  source <- list(source_id = source_row$source_id, name = dataset$name[[1L]],
    vintage = source_row$vintage_id, url = source_row$source_url,
    licence = source_row$licence, attribution = source_row$attribution,
    reference_date = as.character(source_row$reference_date),
    publication_date = as.character(source_row$publication_date))
  projection <- list(facts = do.call(rbind, facts), typequ_metadata = metadata,
                     measures = AEDAR_AGGREGATE_MEASURES, source = source)
  summary <- .adoption_query(con, "SELECT * FROM aedar_territory_summary")
  names(summary)[names(summary) == "vintage_id"] <- "vintage"
  marker <- .adoption_query(con, "SELECT * FROM aedar_comparison_publication")
  if (nrow(marker) != 1L) stop("adoption : marqueur de comparaison AEDAR absent", call. = FALSE)
  tokens <- c("content_version", "aedar_content_version", "reference_content_version",
              "input_content_version", "source_snapshot_id", "publication_mode")
  comparison <- c(as.list(marker[1L, tokens, drop = FALSE]), list(
    groups = .adoption_query(con, "SELECT * FROM aedar_comparison_group"),
    territories = .adoption_query(con, "SELECT * FROM aedar_comparison_territory"),
    density_rows = .adoption_query(con, paste0(
      "SELECT group_id,measure,value,status,n_typequ,n_addresses,n_observed,",
      "coverage_status FROM aedar_density_class_summary")),
    littoral_rows = .adoption_query(con, paste0(
      "SELECT group_id,measure,value,status,n_typequ,n_addresses,n_observed,",
      "coverage_status FROM aedar_littoral_summary"))))
  comparison$input_identity <- as.character(marker$input_identity[[1L]])
  descriptor <- list(indicator_id = as.character(ressource),
                     theme_id = lire_theme_metadata("mobilite")$theme)
  list(descriptor = descriptor, projection = projection, summary = summary,
       comparison = comparison)
}
