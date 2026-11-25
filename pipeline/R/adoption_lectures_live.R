# Lectures live d'adoption (#1142). Chaque forme declare ici SA lecture dans
# REGISTRE_FORMES_RESSOURCE. Les requetes réutilisent les projections et les
# décodeurs existants; adopt ne contient ni SQL ni switch par forme.
#
# Adoption is a proof of EQUALITY, so every reader returns the live tables as the
# database holds them: EVERY persisted column and EVERY row selected by the
# RESOURCE's own keys (indicator_id / dataset_id / comparison facet), never subset
# to the artefact's columns or keys. A live-only column or a live-only row thus
# reaches comparer_valeur_adoption() and is reported as a mismatch.

.adoption_query <- function(con, sql, params = NULL) {
  rows <- if (is.null(params)) DBI::dbGetQuery(con, sql) else
    DBI::dbGetQuery(con, sql, params = params)
  if (!is.data.frame(rows))
    stop("Adoption live reader did not return rows", call. = FALSE)
  as.data.frame(rows, stringsAsFactors = FALSE, optional = TRUE)
}

# `colonnes` (the artefact's columns) only names what the live table MUST carry;
# `stockage` (a shape's `colonnes_stockage`, the ONE declaration of genuinely
# write-time columns such as scalar_observation.published_at) exempts a column the
# artefact cannot carry. comparer_lignes_persistees() ignores the same
# declaration, so there is no reader-side ad-hoc strip.
.adoption_lire_table <- function(con, table, colonnes = NULL, where = "", params = NULL,
                                stockage = character()) {
  rows <- .adoption_query(con, paste0("SELECT * FROM ", table, where), params)
  requis <- setdiff(as.character(colonnes %||% character()), as.character(stockage))
  missing <- setdiff(requis, names(rows))
  if (length(missing))
    stop(paste0("adoption : colonnes persistées absentes de ", table, ": ",
                paste(missing, collapse = ",")), call. = FALSE)
  rows
}

# Positional IN ($1,...) comes from the ONE shared helper (sql_positionnels.R).
.adoption_in <- function(valeurs, colonne = "source_id")
  clause_in_positionnelle(valeurs, colonne)

.adoption_normaliser_tableau <- function(rows, attendu, colonnes = character()) {
  for (colonne in intersect(colonnes, names(rows))) {
    normaliser <- function(x) {
      if (length(x) == 1L && is.character(x) && !is.na(x) &&
          startsWith(x, "{") && endsWith(x, "}")) return(x)
      litteral_tableau_postgres(x)
    }
    rows[[colonne]] <- vapply(rows[[colonne]], normaliser, character(1))
  }
  rows
}

.adoption_count <- function(x) {
  if (inherits(x, "integer64")) as.integer(as.character(x)) else as.integer(x)
}

.adoption_array <- function(x) {
  if (is.list(x)) return(as.character(unlist(x, use.names = FALSE)))
  bridge_parse_text_array(x)
}

# `source_dataset` / `source_vintage` are shared tables, so "the resource's rows"
# are the (source, vintage) pairs the RESOURCE references in its LIVE provenance and
# lineage tables (any live table already read that carries source_id AND
# vintage_id), united with the artefact's own pairs. A live reference the artefact
# lacks brings its live vintage row into the comparison (and is reported there as
# well as in the provenance table); an unrelated historical vintage of the same
# source, kept by other resources, is not this resource's row.
.adoption_paires_live <- function(tables) {
  paires <- lapply(tables, function(x) {
    if (!is.data.frame(x) || !all(c("source_id", "vintage_id") %in% names(x))) return(NULL)
    data.frame(source_id = as.character(x$source_id),
               vintage_id = as.character(x$vintage_id), stringsAsFactors = FALSE)
  })
  paires <- do.call(rbind, c(paires[!vapply(paires, is.null, logical(1))],
    list(data.frame(source_id = character(), vintage_id = character(),
                    stringsAsFactors = FALSE))))
  paires <- unique(paires[!is.na(paires$source_id) & nzchar(paires$source_id) &
    !is.na(paires$vintage_id) & nzchar(paires$vintage_id), , drop = FALSE])
  paires[order(paires$source_id, paires$vintage_id), , drop = FALSE]
}

.adoption_vintages <- function(con, paires) {
  if (!nrow(paires))
    return(.adoption_query(con, "SELECT * FROM source_vintage WHERE false"))
  clause <- clause_paires_positionnelle(paires, c("source_id", "vintage_id"))
  .adoption_query(con, paste0("SELECT * FROM source_vintage WHERE ", clause$where,
    " ORDER BY source_id,vintage_id"), clause$params)
}

# The ONE reader of the two shared source tables, used by every shape: `out` is the
# shape's already-read live tables, `lignes_attendues` the artefact's rows.
.adoption_ajouter_sources <- function(con, out, lignes_attendues, stockage = list()) {
  paires <- .adoption_paires_live(c(out, list(
    lignes_attendues$source_vintage[c("source_id", "vintage_id")])))
  sources <- unique(c(paires$source_id,
    as.character(lignes_attendues$source_dataset$source_id)))
  sources <- sources[!is.na(sources) & nzchar(sources)]
  ids <- clause_in_positionnelle(sources, "source_id")
  out$source_dataset <- if (!is.null(ids))
    .adoption_lire_table(con, "source_dataset", names(lignes_attendues$source_dataset),
      paste0(ids$where, " ORDER BY source_id"), ids$params, stockage$source_dataset) else
    .adoption_query(con, "SELECT * FROM source_dataset WHERE false")
  out$source_vintage <- .adoption_vintages(con, paires)
  out
}

# One reader closure over a resource key: every table is read with SELECT * and
# its tableau columns normalised to the PostgreSQL literal the writer persists.
.adoption_lecteur <- function(con, cle, valeur, lignes_attendues, colonnes_tableau,
                              colonnes_stockage) {
  force(valeur)
  function(table, where = paste0(" WHERE ", cle, "=$1"), params = list(valeur))
    .adoption_normaliser_tableau(.adoption_lire_table(con, table,
      names(lignes_attendues[[table]]), where, params, colonnes_stockage[[table]]),
      lignes_attendues[[table]], colonnes_tableau[[table]])
}

lire_live_scalaire <- function(con, ressource, reference, lignes_attendues, colonnes_tableau = list(),
                              colonnes_stockage = list()) {
  id <- as.character(ressource)
  lire <- .adoption_lecteur(con, "indicator_id", id, lignes_attendues, colonnes_tableau,
                            colonnes_stockage)
  out <- list(
    scalar_descriptor = lire("scalar_descriptor"),
    scalar_descriptor_source = lire("scalar_descriptor_source"),
    scalar_observation = lire("scalar_observation"),
    scalar_observation_source = lire("scalar_observation_source"),
    scalar_comparison_group = lire("scalar_comparison_group"),
    scalar_comparison_territory = lire("scalar_comparison_territory"),
    comparison_source_lineage = lire("comparison_source_lineage",
      " WHERE comparison_family='scalar' AND facet_id=$1"))
  if (nrow(out$scalar_descriptor) != 1L)
    stop(paste0("adoption : descripteur scalaire absent ou multiple pour ", id), call. = FALSE)
  out <- .adoption_ajouter_sources(con, out, lignes_attendues, colonnes_stockage)
  # The live GLOBAL comparison marker, read only to VERIFY the global-token chain
  # (adoption_liaisons_globales.R); it is never written back into compared rows.
  marqueur <- .adoption_query(con,
    "SELECT content_version,scalar_content_version FROM scalar_comparison_publication WHERE singleton")
  scalaire <- .adoption_query(con,
    "SELECT content_version FROM table_publication WHERE table_name='scalar_observation'")
  premier <- function(x, champ) if (nrow(x)) as.character(x[[champ]][[1L]]) else NA_character_
  attr(out, "marqueurs_globaux") <- list(
    comparison_content_version = premier(marqueur, "content_version"),
    comparison_scalar_input = premier(marqueur, "scalar_content_version"),
    scalar_content_version = premier(scalaire, "content_version"))
  out
}

lire_live_profil_declare <- function(con, ressource, reference, lignes_attendues, colonnes_tableau = list(),
                                     colonnes_stockage = list()) {
  id <- as.character(ressource)
  lire <- .adoption_lecteur(con, "indicator_id", id, lignes_attendues, colonnes_tableau,
                            colonnes_stockage)
  out <- list(
    profile_descriptor = lire("profile_descriptor"),
    profile_descriptor_source = lire("profile_descriptor_source"),
    profile_axis = lire("profile_axis"),
    profile_observation = lire("profile_observation"),
    profile_observation_source = lire("profile_observation_source"),
    profile_comparison_group = lire("profile_comparison_group"),
    profile_comparison_territory = lire("profile_comparison_territory"),
    comparison_source_lineage = lire("comparison_source_lineage",
      " WHERE comparison_family='profile' AND facet_id=$1"))
  if (nrow(out$profile_descriptor) != 1L)
    stop(paste0("adoption : descripteur de profil absent ou multiple pour ", id), call. = FALSE)
  out <- .adoption_ajouter_sources(con, out, lignes_attendues, colonnes_stockage)
  # The live GLOBAL markers, read only to VERIFY the global-token chain
  # (adoption_liaisons_globales.R); they are never written into compared rows.
  scalaire <- .adoption_query(con,
    "SELECT content_version FROM table_publication WHERE table_name='scalar_observation'")
  comparaison <- .adoption_query(con, paste0("SELECT content_version,profile_content_version ",
    "FROM profile_comparison_publication WHERE singleton=true"))
  premier <- function(x, champ) if (nrow(x)) as.character(x[[champ]][[1L]]) else NA_character_
  attr(out, "marqueurs_globaux") <- list(
    scalar_content_version = premier(scalaire, "content_version"),
    comparison_content_version = premier(comparaison, "content_version"),
    profile_content_version = premier(comparaison, "profile_content_version"))
  out
}

lire_live_series <- function(con, ressource, reference, lignes_attendues, colonnes_tableau = list(),
                             colonnes_stockage = list()) {
  id <- as.character(ressource)
  lire <- .adoption_lecteur(con, "dataset_id", id, lignes_attendues, colonnes_tableau,
                            colonnes_stockage)
  out <- list(
    series_dataset_descriptor = lire("series_dataset_descriptor"),
    series_dataset_observation = lire("series_dataset_observation"),
    series_observation_provenance = lire("series_observation_provenance"),
    series_named_reference_descriptor = lire("series_named_reference_descriptor"),
    series_named_reference = lire("series_named_reference"),
    series_named_reference_provenance = lire("series_named_reference_provenance"),
    series_context_parent_policy = lire("series_context_parent_policy"),
    ordered_series_comparison_group = lire("ordered_series_comparison_group"),
    ordered_series_comparison_territory = lire("ordered_series_comparison_territory"),
    ordered_series_comparison_lineage = lire("ordered_series_comparison_lineage"),
    ordered_series_comparison_zero_reason = lire("ordered_series_comparison_zero_reason"))
  if (nrow(out$series_dataset_descriptor) != 1L)
    stop(paste0("adoption : descripteur de serie absent ou multiple pour ", id), call. = FALSE)
  # Provenance revisions are keyed by the revisions this dataset's LIVE rows
  # reference (plus the artefact's), so a revision referenced only live is read.
  references <- unique(c(
    as.character(lignes_attendues$series_provenance_revision$provenance_revision_id),
    unlist(lapply(out[c("series_observation_provenance",
        "series_named_reference_provenance", "ordered_series_comparison_lineage")],
      function(x) as.character(x$provenance_revision_id)), use.names = FALSE)))
  revisions <- clause_in_positionnelle(references, "provenance_revision_id")
  out$series_provenance_revision <- if (!is.null(revisions))
    .adoption_lire_table(con, "series_provenance_revision",
      names(lignes_attendues$series_provenance_revision),
      paste0(revisions$where, " ORDER BY provenance_revision_id"), revisions$params,
      colonnes_stockage$series_provenance_revision) else
    .adoption_query(con, "SELECT * FROM series_provenance_revision WHERE false")
  .adoption_ajouter_sources(con, out, lignes_attendues, colonnes_stockage)
}

lire_live_collection <- function(con, ressource, reference, lignes_attendues, colonnes_tableau = list(),
                                 colonnes_stockage = list()) {
  id <- as.character(ressource)
  lire <- .adoption_lecteur(con, "indicator_id", id, lignes_attendues, colonnes_tableau,
                            colonnes_stockage)
  descriptor <- lire("observed_collection_descriptor")
  if (nrow(descriptor) != 1L)
    stop(paste0("adoption : descripteur de collection absent ou multiple pour ", id),
         call. = FALSE)
  table <- switch(as.character(descriptor$kind[[1L]]),
    period_detail = "period_detail_observation", anchored_membership = "anchored_membership",
    stop("Unknown observed collection kind", call. = FALSE))
  out <- list(observed_collection_descriptor = descriptor,
    observed_collection_category = lire("observed_collection_category"),
    facts = lire(table),
    observed_collection_comparison_group = lire("observed_collection_comparison_group"),
    observed_collection_comparison_territory = lire("observed_collection_comparison_territory"),
    observed_collection_comparison_lineage = lire("observed_collection_comparison_lineage"))
  names(out)[names(out) == "facts"] <- table
  .adoption_ajouter_sources(con, out, lignes_attendues, colonnes_stockage)
}

.adoption_json_frame <- function(x) {
  if (length(x) != 1L || is.na(x) || !nzchar(x))
    stop("Adoption requires one JSON row payload", call. = FALSE)
  as.data.frame(jsonlite::fromJSON(x, simplifyDataFrame = TRUE), stringsAsFactors = FALSE)
}

lire_live_aedar <- function(con, ressource, reference, lignes_attendues, colonnes_tableau = list(),
                           colonnes_stockage = list()) {
  # AEDAR is one singleton resource: its tables hold nothing else, so each is read
  # whole (no key can narrow it, and a stray row must show).
  lire <- function(table) .adoption_lire_table(con, table,
    names(lignes_attendues[[table]]), stockage = colonnes_stockage[[table]])
  out <- list(aedar_territorial_aggregate = lire("aedar_territorial_aggregate"),
    aedar_territory_summary = lire("aedar_territory_summary"),
    aedar_comparison_group = lire("aedar_comparison_group"),
    aedar_comparison_territory = lire("aedar_comparison_territory"),
    aedar_density_class_summary = lire("aedar_density_class_summary"),
    aedar_littoral_summary = lire("aedar_littoral_summary"))
  if (!nrow(out$aedar_territorial_aggregate))
    stop("adoption : agregat AEDAR absent", call. = FALSE)
  .adoption_ajouter_sources(con, out, lignes_attendues, colonnes_stockage)
}
