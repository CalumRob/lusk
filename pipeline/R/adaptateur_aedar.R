# Adaptateur de forme AEDAR (ADR-0049 step 2, #1139) --------------------------
# `projeter`/`remplacer` sont des CHAMPS de REGISTRE_FORMES_RESSOURCE$aedar.
# Une SEULE ressource `aedar` : agrégat territorial + métadonnées TYPEQU +
# comparaison + résumés densité/littoral, dans UNE transaction, plus la ligne
# `resource_publication`.
#
# La comparaison vient de l'Artefact de ressource (liée à sa version de
# référence territoriale). `apply` lit UNE fois les lignes de
# territory_reference sous le verrou du producteur et les transmet à tous les
# adaptateurs : l'adaptateur ne rouvre jamais cette lecture, mais il valide
# bien la couverture dense territory × TYPEQU avec ces lignes. Tout le SQL
# d'écriture est partagé avec les producteurs (`publish_aedar_aggregates`,
# `ecrire_aedar_comparaison_rows`).

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
  declarations <- extraire_declaration_ressource(contenu$descriptor)
  comparison <- contenu$comparison
  if (!is.list(comparison) || !is.data.frame(comparison$groups) ||
      is.null(comparison$reference_content_version))
    stop("AEDAR artefact must carry its artefact-bound comparison", call. = FALSE)
  list(ressource = id, forme = "aedar", version = artefact$version,
       projection = projection, comparison = comparison,
       declarations = declarations, digests_lignage = artefact$digests_lignage)
}

remplacer_aedar <- function(con, ressource, rows = NULL, version = NULL,
                            retire = FALSE, reference_content_version = NULL,
                            reference_rows = NULL, ...) {
  valider_identite_ressource(ressource)
  if (!identical(as.character(ressource), "aedar"))
    stop("AEDAR is a single resource named aedar", call. = FALSE)
  publication_transaction(con, {
    if (isTRUE(retire)) {
      # AEDAR est une ressource unique : retirer = vider ses tables de service.
      DBI::dbExecute(con, "DELETE FROM aedar_comparison_territory")
      DBI::dbExecute(con, "DELETE FROM aedar_density_class_summary")
      DBI::dbExecute(con, "DELETE FROM aedar_littoral_summary")
      DBI::dbExecute(con, "DELETE FROM aedar_comparison_group")
      DBI::dbExecute(con, "DELETE FROM aedar_comparison_publication")
      DBI::dbExecute(con, "DELETE FROM aedar_territorial_aggregate")
      DBI::dbExecute(con, "DELETE FROM aedar_territory_summary")
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
    if (!is.data.frame(reference_rows) ||
        !all(c("territory_id", "territory_type") %in% names(reference_rows)))
      stop("AEDAR adapter requires the live reference rows read by apply", call. = FALSE)
    # Les deux écrivains existants écrivent TOUTES les tables de service AEDAR.
    # La version live a été épinglée au préflight ; les lignes lues une fois par
    # apply sont passées au validateur de couverture dense.
    publish_aedar_aggregates(rows$projection, con, reference_version = reference,
                             reference_pairs = reference_rows,
                             version = comparison$aedar_content_version)
    ecrire_aedar_comparaison_rows(con, comparison, comparison$groups,
                                  comparison$density_rows, comparison$littoral_rows)
    ecrire_registre_ressource(con, ressource, "aedar", rows$version,
      reference_content_version = reference, retired = FALSE)
    ecrire_descripteurs_ressource(con, ressource, rows$version, rows$declarations)
    invisible(list(ressource = ressource, operation = "apply", version = rows$version))
  })
}
