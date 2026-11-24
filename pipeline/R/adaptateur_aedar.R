# Adaptateur de forme AEDAR (ADR-0049 step 2, #1139) --------------------------
# `projeter`/`remplacer` sont des CHAMPS de REGISTRE_FORMES_RESSOURCE$aedar.
# Une SEULE ressource `aedar` : agrégat territorial + métadonnées TYPEQU +
# comparaison + résumés densité/littoral, dans UNE transaction, plus la ligne
# `resource_publication`.
#
# La comparaison vient de l'Artefact de ressource (liée à sa version de
# référence territoriale, déjà vérifiée par le préflight de `apply`). L'adaptateur
# ne lit JAMAIS `territory_reference` vivant — contrairement au `--check` de
# publish-aedar-aggregates.R. Tout le SQL d'écriture est partagé avec les
# producteurs (`publish_aedar_aggregates`, `ecrire_aedar_comparaison_rows`).

projeter_artefact_aedar <- function(artefact) {
  if (!is.list(artefact) || !identical(as.character(artefact$forme), "aedar") ||
      !is.list(artefact$contenu))
    stop("AEDAR adapter requires an aedar Artefact de ressource", call. = FALSE)
  id <- artefact$ressource
  valider_identite_ressource(id)
  if (!identical(as.character(id), "aedar"))
    stop("AEDAR is a single resource named aedar", call. = FALSE)
  contenu <- artefact$contenu
  projection <- contenu$faits
  if (!is.list(projection) || !is.data.frame(projection$facts))
    stop("AEDAR artefact is missing its territorial fact grain", call. = FALSE)
  projection$source <- contenu$provenance
  projection$descriptor <- contenu$descriptor
  comparison <- contenu$comparison
  if (!is.list(comparison) || !is.data.frame(comparison$groups) ||
      is.null(comparison$reference_content_version))
    stop("AEDAR artefact must carry its artefact-bound comparison", call. = FALSE)
  list(ressource = id, forme = "aedar", version = artefact$version,
       projection = projection, comparison = comparison,
       digests_lignage = artefact$digests_lignage)
}

remplacer_aedar <- function(con, ressource, rows = NULL, version = NULL,
                            retire = FALSE, reference_content_version = NULL, ...) {
  valider_identite_ressource(ressource)
  if (!identical(as.character(ressource), "aedar"))
    stop("AEDAR is a single resource named aedar", call. = FALSE)
  publication_transaction(con, {
    if (isTRUE(retire)) {
      # AEDAR est une ressource unique : retirer = vider ses tables de service.
      for (table in c("aedar_comparison_territory", "aedar_density_class_summary",
                      "aedar_littoral_summary", "aedar_comparison_group",
                      "aedar_comparison_publication", "aedar_territorial_aggregate",
                      "aedar_territory_summary"))
        DBI::dbExecute(con, paste0("DELETE FROM ", table))
      for (table in c("aedar_territorial_aggregate", "aedar_territory_summary"))
        DBI::dbExecute(con, paste0("DELETE FROM table_publication WHERE table_name='", table, "'"))
      ecrire_registre_ressource(con, ressource, "aedar", version,
        reference_content_version = reference_content_version, retired = TRUE)
      return(invisible(list(ressource = ressource, operation = "retire")))
    }
    if (is.null(rows) || !identical(as.character(rows$ressource), as.character(ressource)))
      stop("AEDAR adapter rows do not match the requested resource", call. = FALSE)
    comparison <- rows$comparison
    reference <- as.character(comparison$reference_content_version)[[1L]]
    if (!is.null(reference_content_version) &&
        !identical(reference, as.character(reference_content_version)[[1L]]))
      stop("AEDAR artefact comparison reference differs from the applied reference",
           call. = FALSE)
    # Les deux écrivains existants écrivent TOUTES les tables de service AEDAR ;
    # la référence injectée vient de l'artefact, aucune lecture de
    # territory_reference vivant ici (le préflight de apply l'a déjà vérifiée).
    publish_aedar_aggregates(rows$projection, con, reference_version = reference)
    ecrire_aedar_comparaison_rows(con, comparison, comparison$groups,
                                  comparison$density_rows, comparison$littoral_rows)
    ecrire_registre_ressource(con, ressource, "aedar", rows$version,
      reference_content_version = reference, retired = FALSE)
    invisible(list(ressource = ressource, operation = "apply", version = rows$version))
  })
}
