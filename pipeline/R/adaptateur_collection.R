# Adaptateur de forme OBSERVED COLLECTION (ADR-0049 step 2, #1139) ------------
# `projeter`/`remplacer` sont des CHAMPS de
# REGISTRE_FORMES_RESSOURCE$observed_collection. Une ressource = une collection
# (indicator_id). L'adaptateur garde `observed_collection_publication` pour
# l'intégrité de stockage et écrit EN PLUS la ligne `resource_publication` dans
# la même transaction.
#
# UN SEUL écrivain par table : les helpers `.ecrire_collection_sources`,
# `.ecrire_collection_base` et `.ecrire_collection_comparaison` de
# publish_observed_collections.R. Le producteur historique et cet adaptateur les
# appellent ; aucun SQL de table de service n'est dupliqué ici.

.reference_collection_live <- function(con) {
  version <- DBI::dbGetQuery(con,
    "SELECT content_version FROM table_publication WHERE table_name='territory_reference'")
  if (nrow(version) != 1L || is.na(version$content_version[[1L]]) ||
      !nzchar(as.character(version$content_version[[1L]])))
    stop("Observed-collection adapter requires one published territory reference", call. = FALSE)
  rows <- DBI::dbGetQuery(con, paste0(
    "SELECT territory_id,territory_type,epci_id,density_class_code,",
    "littoral_code,littoral_classement_source FROM territory_reference"))
  list(version = as.character(version$content_version[[1L]]), rows = rows)
}

projeter_artefact_collection <- function(artefact) {
  if (!is.list(artefact) || !identical(as.character(artefact$forme), "observed_collection") ||
      !is.list(artefact$contenu))
    stop("Observed-collection adapter requires an observed_collection Artefact de ressource", call. = FALSE)
  id <- artefact$ressource
  valider_identite_ressource(id)
  contenu <- artefact$contenu
  projection <- contenu$faits
  if (!is.list(projection)) stop("Observed-collection artefact is missing its fact grain", call. = FALSE)
  projection$descriptor <- contenu$descriptor
  projection$provenance <- contenu$provenance
  if (is.list(projection$descriptor)) projection$descriptor$indicator_id <- id
  for (champ in names(projection)) {
    value <- projection[[champ]]
    if (is.data.frame(value) && "indicator_id" %in% names(value))
      value$indicator_id <- rep(id, nrow(value))
    projection[[champ]] <- value
  }
  comparison <- contenu$comparison
  reference <- if (is.list(comparison) && !is.null(comparison$reference_content_version))
    as.character(comparison$reference_content_version)[[1L]] else NULL
  list(ressource = id, forme = "observed_collection", version = artefact$version,
       projection = projection, reference_content_version = reference,
       digests_lignage = artefact$digests_lignage)
}

remplacer_collection <- function(con, ressource, rows = NULL, version = NULL,
                                  retire = FALSE, reference_content_version = NULL, ...) {
  valider_identite_ressource(ressource)
  publication_transaction(con, {
    if (isTRUE(retire)) {
      for (table in c("observed_collection_comparison_lineage",
                      "observed_collection_comparison_territory",
                      "observed_collection_comparison_group",
                      "observed_collection_comparison_publication",
                      "observed_collection_category", "period_detail_observation",
                      "anchored_membership", "observed_collection_descriptor",
                      "observed_collection_publication"))
        DBI::dbExecute(con, paste0("DELETE FROM ", table, " WHERE indicator_id=$1"),
                       params = list(ressource))
      ecrire_registre_ressource(con, ressource, "observed_collection", version,
        reference_content_version = reference_content_version, retired = TRUE)
      return(invisible(list(ressource = ressource, operation = "retire")))
    }
    if (is.null(rows) || !identical(as.character(rows$ressource), as.character(ressource)))
      stop("Observed-collection adapter rows do not match the requested resource", call. = FALSE)
    reference <- if (is.null(rows$reference_content_version)) NULL else
      rows$reference_content_version
    if (is.null(reference)) reference <- reference_content_version
    ref <- if (is.null(reference)) .reference_collection_live(con) else {
      rows_ref <- rows$projection$reference_rows
      if (is.null(rows_ref)) rows_ref <- DBI::dbGetQuery(con, paste0(
        "SELECT territory_id,territory_type,epci_id,density_class_code,",
        "littoral_code,littoral_classement_source FROM territory_reference"))
      list(version = as.character(reference)[[1L]], rows = rows_ref)
    }
    projection <- rows$projection
    d <- projection$descriptor
    .ecrire_collection_sources(con, projection$datasets, projection$vintages,
                               conflict = "nothing")
    .ecrire_collection_base(con, projection, rows$version, ref$version)
    if (identical(as.character(d$kind), "period_detail")) {
      comparisons <- project_observed_collection_comparisons(
        projection, ref$rows, rows$version, ref$version)
      comparison_version <- scalar_content_version(comparisons)
      .ecrire_collection_comparaison(con, ressource, comparisons, comparison_version,
                                     rows$version, ref$version)
    }
    ecrire_registre_ressource(con, ressource, "observed_collection", rows$version,
      reference_content_version = ref$version, retired = FALSE)
    invisible(list(ressource = ressource, operation = "apply", version = rows$version))
  })
}
