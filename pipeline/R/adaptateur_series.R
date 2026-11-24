# Adaptateur de forme OWNED SERIES (ADR-0049 step 2, #1139) -------------------
# `projeter(artefact)` et `remplacer(con, ressource, rows, version)` sont des
# CHAMPS de REGISTRE_FORMES_RESSOURCE$owned_series (voir splitter_ressources.R).
# Une ressource = un dataset (dataset_id). L'adaptateur garde les marqueurs
# `series_dataset_publication` et `ordered_series_comparison_publication` pour
# l'intégrité de stockage et écrit EN PLUS la ligne `resource_publication`, dans
# la MÊME transaction. Le OCS-GE `artif_par_habitant` (état) passe ici — aucun
# code de lecture typée n'est impliqué.
#
# UN SEUL écrivain par table : `owned_series_postgres_adapter(con)$replace_dataset`
# (publish_series.R) contient tout le SQL de ce dataset. L'adaptateur ne le
# recopie pas, il lui transmet la référence lue UNE fois par `apply` sous le
# verrou du producteur (lire_reference_live_apply) — aucune seconde lecture.

# Projeter un Artefact de ressource owned-series vers la projection attendue par
# l'écrivain (les champs de table de l'artefact + descripteur + provenance). Pur :
# aucune connexion, aucune écriture ; chaque ligne porte le dataset de la
# ressource, jamais un autre dataset.
projeter_artefact_series <- function(artefact) {
  if (!is.list(artefact) || !identical(as.character(artefact$forme), "owned_series") ||
      !is.list(artefact$contenu))
    stop("Owned-series adapter requires an owned_series Artefact de ressource", call. = FALSE)
  id <- artefact$ressource
  valider_identite_ressource(id)
  contenu <- artefact$contenu
  projection <- contenu$faits
  if (!is.list(projection)) stop("Owned-series artefact is missing its fact grain", call. = FALSE)
  projection$descriptor <- contenu$descriptor
  projection$provenance <- contenu$provenance
  dataset <- if (is.list(contenu$descriptor)) contenu$descriptor$dataset_id else NULL
  if (is.null(dataset)) dataset <- projection$descriptor$dataset_id[[1L]]
  if (is.null(dataset) || length(dataset) != 1L || !nzchar(as.character(dataset)) ||
      !identical(as.character(dataset), as.character(id)))
    stop("Owned-series artefact dataset does not match its resource id", call. = FALSE)
  # Ne jamais laisser un autre dataset se glisser dans une écriture de cette
  # ressource : la totalité des grains est réétiquetée avec son identité.
  for (champ in names(projection)) {
    value <- projection[[champ]]
    if (is.data.frame(value) && "dataset_id" %in% names(value))
      value$dataset_id <- rep(id, nrow(value))
    projection[[champ]] <- value
  }
  if (is.list(projection$descriptor)) projection$descriptor$dataset_id <- id
  comparison <- contenu$comparison
  reference <- if (is.list(comparison) && !is.null(comparison$reference_content_version))
    as.character(comparison$reference_content_version)[[1L]] else NULL
  list(ressource = id, forme = "owned_series", version = artefact$version,
       dataset_id = id, projection = projection,
       reference_content_version = reference,
       digests_lignage = artefact$digests_lignage)
}

# Remplacer UN dataset dans la transaction de l'appelant. `retire = TRUE`
# supprime ses lignes (les révisions de provenance immuables restent) et marque
# la ligne de registre retirée — c'est `apply --retire`, pas un chemin spécial.
remplacer_series <- function(con, ressource, rows = NULL, version = NULL,
                             retire = FALSE, reference_content_version = NULL,
                             reference_rows = NULL, ...) {
  valider_identite_ressource(ressource)
  publication_transaction(con, {
    if (isTRUE(retire)) {
      DBI::dbExecute(con, "DELETE FROM ordered_series_comparison_publication WHERE dataset_id=$1",
                     params = list(ressource))
      DBI::dbExecute(con, "DELETE FROM ordered_series_comparison_zero_reason WHERE dataset_id=$1",
                     params = list(ressource))
      DBI::dbExecute(con, "DELETE FROM ordered_series_comparison_group WHERE dataset_id=$1",
                     params = list(ressource))
      DBI::dbExecute(con, "DELETE FROM series_dataset_publication WHERE dataset_id=$1",
                     params = list(ressource))
      ecrire_registre_ressource(con, ressource, "owned_series", version,
        reference_content_version = reference_content_version, retired = TRUE)
      return(invisible(list(ressource = ressource, operation = "retire")))
    }
    if (is.null(rows) || !identical(as.character(rows$ressource), as.character(ressource)))
      stop("Owned-series adapter rows do not match the requested resource", call. = FALSE)
    reference <- if (!is.null(reference_content_version)) reference_content_version else
      rows$reference_content_version
    if (is.null(reference) || length(reference) != 1L || is.na(reference) ||
        !nzchar(as.character(reference)) || !is.data.frame(reference_rows))
      stop("Owned-series adapter requires the live reference read by apply", call. = FALSE)
    reference <- as.character(reference)[[1L]]
    # L'écrivain de l'owner fait TOUTE l'écriture de ce dataset ; l'adaptateur
    # ne fait que lui transmettre la référence lue une fois par apply.
    owned_series_postgres_adapter(con)$replace_dataset(
      rows$projection, rows$version,
      reference_version = reference, reference_rows = reference_rows)
    ecrire_registre_ressource(con, ressource, "owned_series", rows$version,
      reference_content_version = reference, retired = FALSE)
    invisible(list(ressource = ressource, operation = "apply", version = rows$version))
  })
}
