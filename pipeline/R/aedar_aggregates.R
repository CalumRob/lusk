# AEDAR official territorial aggregates (2026-v1). These are producer-computed
# dense aggregates; this module validates and projects them without recomputing.
AEDAR_AGGREGATE_LEVELS <- c("commune", "epci", "departement", "region")
AEDAR_AGGREGATE_SOURCE_ID <- "aedar_bretagne"
AEDAR_AGGREGATE_VINTAGE <- "2026-v1"

AEDAR_AGGREGATE_RESOURCES <- data.frame(
  level = AEDAR_AGGREGATE_LEVELS,
  url = c(
    "https://static.data.gouv.fr/resources/acces-aux-equipements-depuis-les-adresses-residentielles-bretagne/20260930-152133/aggregates-commune-53-2026v1.parquet",
    "https://static.data.gouv.fr/resources/acces-aux-equipements-depuis-les-adresses-residentielles-bretagne/20260930-152216/aggregates-epci-53-2026v1.parquet",
    "https://static.data.gouv.fr/resources/acces-aux-equipements-depuis-les-adresses-residentielles-bretagne/20260930-152158/aggregates-departement-53-2026v1.parquet",
    "https://static.data.gouv.fr/resources/acces-aux-equipements-depuis-les-adresses-residentielles-bretagne/20260930-152247/aggregates-region-53-2026v1.parquet"),
  filename = paste0("aggregates-", AEDAR_AGGREGATE_LEVELS, "-53-2026v1.parquet"),
  stringsAsFactors = FALSE)

# Input is a named list of the four source-shaped frames. `measure_columns`
# comes from the producer schema, not a renderer-side catalogue.
validate_aedar_aggregates <- function(inputs, measure_columns) {
  if (!is.list(inputs) || !setequal(names(inputs), AEDAR_AGGREGATE_LEVELS))
    stop("AEDAR requires exactly the four territorial aggregate inputs", call.=FALSE)
  required <- c("territory_id", "TYPEQU", "LIB_TYPEQU", "n_addresses",
                "n_observed", "coverage_status", measure_columns)
  out <- lapply(AEDAR_AGGREGATE_LEVELS, function(level) {
    x <- as.data.frame(inputs[[level]], stringsAsFactors=FALSE)
    if (!all(required %in% names(x))) stop(paste("AEDAR", level, "aggregate schema is incomplete"), call.=FALSE)
    if (!nrow(x) || anyNA(x[c("territory_id", "TYPEQU", "LIB_TYPEQU", "n_addresses", "n_observed", "coverage_status")]) ||
        anyDuplicated(x[c("territory_id", "TYPEQU")]) || any(!is.finite(x$n_addresses)) ||
        any(!is.finite(x$n_observed)) || any(x$n_addresses < 0 | x$n_observed < 0 | x$n_observed > x$n_addresses))
      stop(paste("Invalid AEDAR keys or denominators at", level), call.=FALSE)
    x$territory_type <- level
    x
  })
  names(out) <- AEDAR_AGGREGATE_LEVELS
  # Preserve source measure columns and NA values verbatim; no zero filling.
  out
}

project_aedar_aggregates <- function(inputs, measure_columns) {
  validated <- validate_aedar_aggregates(inputs, measure_columns)
  facts <- do.call(rbind, validated)
  rownames(facts) <- NULL
  list(facts=facts, measures=measure_columns, source=list(
    source_id=AEDAR_AGGREGATE_SOURCE_ID,
    name="Accès aux équipements depuis les adresses résidentielles — Bretagne",
    vintage=AEDAR_AGGREGATE_VINTAGE,
    url="https://www.data.gouv.fr/datasets/acces-aux-equipements-depuis-les-adresses-residentielles-bretagne",
    licence="ODbL", attribution="© OpenStreetMap contributors; données AEDAR — licence ODbL"))
}
