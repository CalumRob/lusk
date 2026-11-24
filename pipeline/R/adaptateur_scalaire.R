# Adaptateur de forme SCALAIRE (ADR-0049 step 2, #1137) ------------------------
# Premier des cinq adaptateurs de forme. `projeter(artefact) -> rows` et
# `remplacer(con, ressource, rows, version)` sont des CHAMPS de
# REGISTRE_FORMES_RESSOURCE$scalar (voir splitter_ressources.R) : aucune
# répartition parallèle par forme, aucun client de publication n'écrit ces
# tables ailleurs. Le remplacement est PÉRIMÈTRE À UN INDICATEUR : toutes les
# lignes supprimées/insérées portent indicator_id (ou facet_id) == ressource ;
# tout autre indicateur reste octet pour octet identique.
#
# Les marqueurs GLOBAUX (`table_publication['scalar_observation']` et le
# singleton `scalar_comparison_publication`) ne sont JAMAIS écrits ici : la
# phase expand les laisse pour l'API actuelle jusqu'à l'étape 4 (#1140).

.sql_lit_scalaire <- function(x) {
  if (is.na(x)) return("NULL")
  paste0("'", gsub("'", "''", as.character(x)), "'")
}

.array_sql_scalaire <- function(valeurs) {
  valeurs <- as.character(unlist(valeurs, use.names = FALSE))
  if (!length(valeurs)) return("ARRAY[]::text[]")
  paste0("ARRAY[", paste(vapply(valeurs, .sql_lit_scalaire, character(1)),
                         collapse = ","), "]::text[]")
}

# Project an artefact de ressource into the rows the adapter will write. Pure:
# no connection, no write. The descriptor keeps the semantic fields plus the
# two list fields (allowed_levels, allowed_sources) the DB contract needs.
projeter_artefact_scalaire <- function(artefact) {
  if (!is.list(artefact) || !identical(as.character(artefact$forme), "scalar") ||
      !is.list(artefact$contenu))
    stop("Scalar adapter requires a scalar Artefact de ressource", call. = FALSE)
  id <- artefact$ressource
  valider_identite_ressource(id)
  contenu <- artefact$contenu
  descript <- contenu$descriptor
  if (is.data.frame(descript)) {
    if (nrow(descript) != 1L)
      stop("Scalar artefact descriptor must carry exactly one indicator", call. = FALSE)
    ligne <- as.list(descript[1L, , drop = FALSE])
  } else if (is.list(descript)) {
    ligne <- descript
  } else {
    stop("Scalar artefact descriptor is invalid", call. = FALSE)
  }

  champs <- c("indicator_id", "theme_id", "label", "unit", "direction",
              "comparison_facet", "denominator_semantics", "completeness",
              "descriptor_version")
  descriptor <- as.data.frame(stats::setNames(lapply(champs, function(champ) {
    valeur <- ligne[[champ]]
    as.character(if (is.null(valeur)) NA_character_ else valeur[[1L]])
  }), champs), stringsAsFactors = FALSE, optional = TRUE)
  descriptor$indicator_id <- id

  provenance_brute <- contenu$provenance
  if (is.null(provenance_brute)) provenance_brute <- data.frame(
    indicator_id = character(), territory_id = character(),
    source_id = character(), vintage_id = character(), stringsAsFactors = FALSE)
  provenance <- provenance_brute[
    , c("indicator_id", "territory_id", "source_id", "vintage_id"), drop = FALSE]
  provenance$indicator_id <- rep(id, nrow(provenance))

  # allowed_sources comes from the descriptor declaration; when absent it is
  # derived from the artefact's own provenance (never a hardcoded source id).
  sources_declares <- ligne[["allowed_sources"]]
  if (is.null(sources_declares)) sources_declares <- unique(provenance$source_id)
  sources_declares <- as.character(unlist(sources_declares, use.names = FALSE))
  sources_declares <- sources_declares[!is.na(sources_declares) & nzchar(sources_declares)]
  allowed_levels <- as.character(unlist(ligne[["allowed_levels"]], use.names = FALSE))

  observations <- contenu$faits[["facts"]]
  if (is.null(observations)) observations <- contenu$faits
  if (!is.data.frame(observations))
    stop("Scalar artefact is missing its observation grain", call. = FALSE)
  obs_cols <- c("indicator_id", "territory_id", "territory_type", "value",
                "status", "support_count", "denominator_count")
  for (col in setdiff(obs_cols, names(observations))) observations[[col]] <- NA
  observations <- observations[, obs_cols, drop = FALSE]
  observations$indicator_id <- rep(id, nrow(observations))

  comparison <- contenu$comparison
  if (!is.null(comparison)) {
    for (part in c("groups", "territories", "lineage"))
      if (!is.null(comparison[[part]]) && is.data.frame(comparison[[part]]))
        comparison[[part]] <- comparison[[part]]
  }

  # Shared immutable source rows needed by the FK contracts; ON CONFLICT DO
  # NOTHING on write means an existing row (and every other indicator) is
  # never mutated. Vintages are extended with the comparison lineage so all
  # inserted rows satisfy source_vintage FKs.
  paires <- unique(rbind(
    provenance[c("source_id", "vintage_id")],
    if (!is.null(comparison) && is.data.frame(comparison$lineage) &&
        all(c("source_id", "vintage_id") %in% names(comparison$lineage)))
      comparison$lineage[c("source_id", "vintage_id")]
    else data.frame(source_id = character(), vintage_id = character())
  ))
  paires <- paires[!is.na(paires$source_id) & nzchar(as.character(paires$source_id)) &
                     !is.na(paires$vintage_id) & nzchar(as.character(paires$vintage_id)), ,
                   drop = FALSE]
  source_ids <- sort(unique(as.character(paires$source_id)))
  sources <- data.frame(source_id = source_ids, name = source_ids, stringsAsFactors = FALSE)
  vintages <- data.frame(source_id = as.character(paires$source_id),
    vintage_id = as.character(paires$vintage_id),
    version = as.character(paires$vintage_id),
    reference_date = rep(NA_character_, nrow(paires)),
    publication_date = rep(NA_character_, nrow(paires)), stringsAsFactors = FALSE)

  list(
    ressource = id, forme = "scalar", version = artefact$version,
    descriptor = cbind(descriptor,
      data.frame(allowed_levels = I(list(allowed_levels)),
                 allowed_sources = I(list(sources_declares)),
                 stringsAsFactors = FALSE)),
    sources = sources, vintages = vintages,
    observations = observations, provenance = provenance,
    comparison = comparison, digests_lignage = artefact$digests_lignage
  )
}

# Replace this ONE indicator's rows inside the caller's publication transaction.
# `retire = TRUE` removes them (and marks the registry row retired) without
# inserting anything — this is `apply --retire`, not a special path.
remplacer_scalaire <- function(con, ressource, rows = NULL, version = NULL,
                               retire = FALSE, reference_content_version = NULL, ...) {
  valider_identite_ressource(ressource)
  id_lit <- .sql_lit_scalaire(ressource)

  publication_transaction(con, {
    # FK-safe order, every statement scoped to this indicator.
    DBI::dbExecute(con, "DELETE FROM scalar_resource_comparison_publication WHERE indicator_id=$1",
                   params = list(ressource))
    DBI::dbExecute(con, paste0("DELETE FROM comparison_source_lineage WHERE comparison_family='scalar' AND facet_id=", id_lit))
    DBI::dbExecute(con, paste0("DELETE FROM scalar_comparison_territory WHERE indicator_id=", id_lit))
    DBI::dbExecute(con, paste0("DELETE FROM scalar_comparison_group WHERE indicator_id=", id_lit))
    DBI::dbExecute(con, paste0("DELETE FROM scalar_observation_source WHERE indicator_id=", id_lit))
    DBI::dbExecute(con, paste0("DELETE FROM scalar_observation WHERE indicator_id=", id_lit))
    DBI::dbExecute(con, paste0("DELETE FROM scalar_descriptor_source WHERE indicator_id=", id_lit))
    DBI::dbExecute(con, paste0("DELETE FROM scalar_descriptor WHERE indicator_id=", id_lit))

    if (isTRUE(retire)) {
      ecrire_registre_ressource(con, ressource, "scalar", version,
        reference_content_version = reference_content_version, retired = TRUE)
      return(invisible(list(ressource = ressource, operation = "retire")))
    }
    if (is.null(rows) || !identical(as.character(rows$ressource), ressource))
      stop("Scalar adapter rows do not match the requested resource", call. = FALSE)

    for (i in seq_len(nrow(rows$sources))) {
      DBI::dbExecute(con,
        "INSERT INTO source_dataset(source_id,name) VALUES($1,$2) ON CONFLICT(source_id) DO NOTHING",
        params = as.list(rows$sources[i, c("source_id", "name")]))
    }
    for (i in seq_len(nrow(rows$vintages))) {
      DBI::dbExecute(con, paste0("INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date) ",
        "VALUES($1,$2,$3,$4,$5) ON CONFLICT(source_id,vintage_id) DO NOTHING"),
        params = as.list(rows$vintages[i, c("source_id", "vintage_id", "version",
                                             "reference_date", "publication_date")]))
    }

    d <- rows$descriptor[1L, , drop = FALSE]
    champs <- c("indicator_id", "theme_id", "label", "unit", "direction",
                "comparison_facet", "denominator_semantics", "completeness",
                "descriptor_version")
    valeurs <- vapply(champs, function(champ) .sql_lit_scalaire(d[[champ]][[1L]]), character(1))
    colonnes <- paste(c(champs, "allowed_levels"), collapse = ",")
    valeur_sql <- paste(c(valeurs, .array_sql_scalaire(d$allowed_levels[[1L]])), collapse = ",")
    DBI::dbExecute(con, paste0("INSERT INTO scalar_descriptor(", colonnes, ") VALUES(",
      valeur_sql, ")"))
    for (source_id in as.character(unlist(d$allowed_sources, use.names = FALSE))) {
      DBI::dbExecute(con,
        "INSERT INTO scalar_descriptor_source(indicator_id,source_id) VALUES($1,$2)",
        params = list(ressource, source_id))
    }

    DBI::dbWriteTable(con, "scalar_observation", rows$observations,
                      append = TRUE, row.names = FALSE)
    DBI::dbWriteTable(con, "scalar_observation_source", rows$provenance,
                      append = TRUE, row.names = FALSE)

    comparaison <- rows$comparison
    if (!is.null(comparaison)) {
      groupes <- comparaison$groups
      if (!is.null(groupes) && nrow(groupes)) {
        DBI::dbWriteTable(con, "scalar_comparison_group", groupes[
          c("comparison_context", "group_id", "territory_type", "indicator_id",
            "statistic", "median", "member_count", "eligible_count", "missing_count",
            "lineage_source_count")], append = TRUE, row.names = FALSE)
      }
      territoires <- comparaison$territories
      if (!is.null(territoires) && nrow(territoires)) {
        DBI::dbWriteTable(con, "scalar_comparison_territory", territoires[
          c("comparison_context", "group_id", "territory_type", "indicator_id",
            "territory_id", "value", "status", "rank", "tie_count", "rank_size")],
          append = TRUE, row.names = FALSE)
      }
      lignage <- comparaison$lineage
      if (!is.null(lignage) && nrow(lignage)) {
        lignage <- lignage
        lignage$comparison_family <- "scalar"
        lignage$comparison_content_version <- as.character(comparaison$content_version)
        DBI::dbWriteTable(con, "comparison_source_lineage", lignage[
          c("comparison_family", "comparison_context", "group_id", "territory_type",
            "facet_id", "source_id", "vintage_id", "comparison_content_version")],
          append = TRUE, row.names = FALSE)
      }
      reference <- if (is.null(reference_content_version))
        as.character(comparaison$reference_content_version[[1L]]) else
        as.character(reference_content_version)
      DBI::dbExecute(con, paste0(
        "INSERT INTO scalar_resource_comparison_publication(indicator_id,content_version,",
        "scalar_content_version,reference_content_version,group_row_count,",
        "territory_row_count,lineage_row_count) VALUES($1,$2,$3,$4,$5,$6,$7)"),
        params = list(ressource, as.character(comparaison$content_version),
          as.character(comparaison$scalar_content_version), reference,
          if (is.null(groupes)) 0L else nrow(groupes),
          if (is.null(territoires)) 0L else nrow(territoires),
          if (is.null(lignage)) 0L else nrow(lignage)))
      reference_content_version <- reference
    }

    ecrire_registre_ressource(con, ressource, "scalar", rows$version,
      reference_content_version = reference_content_version, retired = FALSE)
    invisible(list(ressource = ressource, operation = "apply", version = rows$version))
  })
}
