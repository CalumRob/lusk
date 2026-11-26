# Adaptateur de forme OBSERVED COLLECTION (ADR-0049 step 2, #1139) ------------
# `projeter`/`remplacer` sont des CHAMPS de
# REGISTRE_FORMES_RESSOURCE$observed_collection. Une ressource = une collection
# (indicator_id). L'adaptateur garde `observed_collection_publication` pour
# l'intégrité de stockage et écrit EN PLUS la ligne `resource_publication` dans
# la même transaction.
#
# UN SEUL écrivain par table : le module partagé `.ecrire_sources_serveur`
# (ecriture_sources_serveur.R) pour source_dataset/source_vintage, et les helpers
# `.ecrire_collection_base` / `.ecrire_collection_comparaison` de
# publish_observed_collections.R. Le producteur historique et cet adaptateur les
# appellent ; aucun SQL de table de service n'est dupliqué ici. La référence est
# lue UNE fois par `apply` (lire_reference_live_apply) et transmise ici.

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
  declarations <- extraire_declaration_ressource(contenu$descriptor)
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
       projection = projection, comparison = contenu$comparison,
       reference_content_version = reference, declarations = declarations,
       digests_lignage = artefact$digests_lignage)
}

remplacer_collection <- function(con, ressource, rows = NULL, version = NULL,
                                  retire = FALSE, reference_content_version = NULL,
                                  reference_rows = NULL, ...) {
  valider_identite_ressource(ressource)
  publication_transaction(con, {
    if (isTRUE(retire)) {
      # Littéraux (pas de table fabriquée) : l'audit structurel voit chaque
      # écriture et l'adaptateur reste le seul écrivain de ces tables.
      DBI::dbExecute(con, "DELETE FROM observed_collection_comparison_lineage WHERE indicator_id=$1",
                     params = list(ressource))
      DBI::dbExecute(con, "DELETE FROM observed_collection_comparison_territory WHERE indicator_id=$1",
                     params = list(ressource))
      DBI::dbExecute(con, "DELETE FROM observed_collection_comparison_group WHERE indicator_id=$1",
                     params = list(ressource))
      DBI::dbExecute(con, "DELETE FROM observed_collection_comparison_publication WHERE indicator_id=$1",
                     params = list(ressource))
      DBI::dbExecute(con, "DELETE FROM observed_collection_category WHERE indicator_id=$1",
                     params = list(ressource))
      DBI::dbExecute(con, "DELETE FROM period_detail_observation WHERE indicator_id=$1",
                     params = list(ressource))
      DBI::dbExecute(con, "DELETE FROM anchored_membership WHERE indicator_id=$1",
                     params = list(ressource))
      DBI::dbExecute(con, "DELETE FROM observed_collection_descriptor WHERE indicator_id=$1",
                     params = list(ressource))
      DBI::dbExecute(con, "DELETE FROM observed_collection_publication WHERE indicator_id=$1",
                     params = list(ressource))
      ecrire_registre_ressource(con, ressource, "observed_collection", version,
        reference_content_version = reference_content_version, retired = TRUE)
      return(invisible(list(ressource = ressource, operation = "retire")))
    }
    if (is.null(rows) || !identical(as.character(rows$ressource), as.character(ressource)))
      stop("Observed-collection adapter rows do not match the requested resource", call. = FALSE)
    reference <- if (!is.null(reference_content_version)) reference_content_version else
      rows$reference_content_version
    if (is.null(reference) || length(reference) != 1L || is.na(reference) ||
        !nzchar(as.character(reference)) || !is.data.frame(reference_rows))
      stop("Observed-collection adapter requires the live reference read by apply", call. = FALSE)
    reference <- as.character(reference)[[1L]]
    projection <- rows$projection
    d <- projection$descriptor
    .ecrire_sources_serveur(con, projection$datasets, projection$vintages,
                           conflict = "nothing")
    # ONE source of truth for the storage token: the artefact's comparison
    # binds every persisted comparison row to collection_content_version, and
    # validate_observed_collection_comparison_publication() (api/schema.sql)
    # requires the base and comparison markers to carry that SAME token. Never
    # substitute the whole-artefact version here: it also hashes the comparison
    # and cannot equal the token the comparison rows themselves carry.
    collection_version <- if (is.list(rows$comparison) &&
      length(rows$comparison$collection_content_version) == 1L &&
      !is.na(rows$comparison$collection_content_version))
      as.character(rows$comparison$collection_content_version)[[1L]] else
      as.character(rows$version)[[1L]]
    .ecrire_collection_base(con, projection, collection_version, reference)
    if (identical(as.character(d$kind), "period_detail")) {
      if (is.null(rows$comparison) || !nrow(rows$comparison$groups))
        stop("Period/detail artefact must carry its persisted comparison", call. = FALSE)
      comparison_version <- scalar_content_version(rows$comparison)
      .ecrire_collection_comparaison(con, ressource, rows$comparison, comparison_version,
                                      collection_version, reference)
    }
    ecrire_registre_ressource(con, ressource, "observed_collection", rows$version,
      reference_content_version = reference, retired = FALSE)
    ecrire_descripteurs_ressource(con, ressource, rows$version, rows$declarations)
    invisible(list(ressource = ressource, operation = "apply", version = rows$version))
  })
}
