# Validate the metadata-owned annual-series projection without filling gaps.
validate_series_projection <- function(points, descriptor) {
  required <- c("indicator_id", "territory_id", "territory_type", "axis_value",
                "observation_period", "value", "status", "source_id", "vintage_id")
  if (!is.data.frame(points) || !setequal(names(points), required) ||
      !is.list(descriptor) || !all(c("indicator_id", "axis_kind", "axis_values", "completeness",
        "comparison_point", "label", "unit", "direction", "source_id", "vintage_id") %in% names(descriptor)))
    stop("Series projection is missing contract fields", call.=FALSE)
  axis <- as.character(descriptor$axis_values)
  if (descriptor$axis_kind != "year" || !length(axis) || anyDuplicated(axis) ||
      any(!grepl("^\\d{4}$", axis)) || !identical(axis, axis[order(as.integer(axis))]) ||
      !descriptor$completeness %in% c("dense_complete", "may_be_missing") ||
      (!is.null(descriptor$comparison_point) && !descriptor$comparison_point %in% axis))
    stop("Invalid series descriptor axis/order/comparison", call.=FALSE)
  if (anyNA(points[c("indicator_id", "territory_id", "territory_type", "axis_value", "status", "source_id", "vintage_id")]) ||
      any(points$indicator_id != descriptor$indicator_id) || any(!points$axis_value %in% axis) ||
      anyDuplicated(points[c("indicator_id", "territory_id", "axis_value")]))
    stop("Undeclared or duplicate series point", call.=FALSE)
  if (any(points$source_id != descriptor$source_id) || any(points$vintage_id != descriptor$vintage_id))
    stop("Series provenance differs from descriptor", call.=FALSE)
  if (any(!points$status %in% c("measured", "missing")) ||
      any((points$status == "measured") != !is.na(points$value)) ||
      any(!is.na(points$value) & !is.finite(points$value)))
    stop("Series missing status/value mismatch", call.=FALSE)
  invisible(points[order(match(points$axis_value, axis)), , drop=FALSE])
}
