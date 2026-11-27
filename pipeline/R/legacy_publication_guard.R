# Legacy whole-snapshot publishers predate migration 049 and consume the global
# scalar/profile clocks. Keep them usable during the expand rollout, but refuse
# before any dropped-table access once the contract migration has been applied.
verifier_schema_publication_globale <- function(con, refusal = NULL) {
  etat <- DBI::dbGetQuery(con, paste0(
    "SELECT to_regclass(current_schema() || '.scalar_comparison_publication') IS NOT NULL AS scalaire, ",
    "to_regclass(current_schema() || '.profile_comparison_publication') IS NOT NULL AS profil"))
  if (!is.data.frame(etat) || nrow(etat) != 1L ||
      !isTRUE(etat$scalaire[[1L]]) || !isTRUE(etat$profil[[1L]])) {
    if (!is.null(refusal)) stop(refusal)
    stop(paste0(
      "Legacy global publication is retired after migration 049; ",
      "use scripts/publication.R apply for per-resource publication."),
      call. = FALSE)
  }
  invisible(TRUE)
}
