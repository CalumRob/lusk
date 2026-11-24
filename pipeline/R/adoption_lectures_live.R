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
      "SELECT * FROM comparison_source_lineage WHERE comparison_family='scalar' ",
      "AND facet_id=$1"), params))
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
  descriptor$allowed_levels <- .adoption_array(d$allowed_levels[[1L]])
  descriptor$levels <- descriptor$allowed_levels
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
      "SELECT * FROM comparison_source_lineage WHERE comparison_family='profile' ",
      "AND facet_id=$1"), params))
  list(descriptor = descriptor, axes = axes, facts = facts, provenance = provenance,
       datasets = data.frame(source_id = sources, name = sources, stringsAsFactors = FALSE),
       vintages = data.frame(), comparison = comparison)
}
