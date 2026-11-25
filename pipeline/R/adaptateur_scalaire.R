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

# All serving-table writes go through the SHARED writers in publish_scalar.R
# (.ecrire_sources_serveur / .ecrire_descripteurs_scalaires /
# .ecrire_observations_scalaires / .ecrire_comparaison_scalaire). This adapter
# only owns the indicator scope and the per-resource marker/registry row.

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
  declarations <- extraire_declaration_ressource(ligne)

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
  # The source clocks are persisted facts: take them from the artefact's own
  # grain (faits$vintages, carried by the splitter from the producer's vintages),
  # never rebuild them. A pair the artefact carries no clock for stays NA, so
  # adoption compares it with the live row and refuses instead of assuming.
  portees <- contenu$faits[["vintages"]]
  portees_cle <- if (is.data.frame(portees))
    paste(as.character(portees$source_id), as.character(portees$vintage_id)) else character()
  paires_cle <- paste(as.character(paires$source_id), as.character(paires$vintage_id))
  position <- match(paires_cle, portees_cle)
  clock <- function(champ, defaut = NA_character_) {
    if (!is.data.frame(portees) || !champ %in% names(portees)) return(rep(defaut, nrow(paires)))
    valeurs <- portees[[champ]][position]
    if (inherits(portees[[champ]], "Date")) valeurs else as.character(valeurs)
  }
  vintages <- data.frame(source_id = as.character(paires$source_id),
    vintage_id = as.character(paires$vintage_id),
    version = ifelse(is.na(position), as.character(paires$vintage_id), clock("version")),
    reference_date = clock("reference_date"),
    publication_date = clock("publication_date"), stringsAsFactors = FALSE)

  list(
    ressource = id, forme = "scalar", version = artefact$version,
    descriptor = cbind(descriptor,
      data.frame(allowed_levels = I(list(allowed_levels)),
                 allowed_sources = I(list(sources_declares)),
                 stringsAsFactors = FALSE)),
    sources = sources, vintages = vintages,
    observations = observations, provenance = provenance,
    eligible_territories = contenu$faits[["eligible_territories"]],
    comparison = comparison, declarations = declarations,
    digests_lignage = artefact$digests_lignage
  )
}

# Replace this ONE indicator's rows inside the caller's publication transaction.
# `retire = TRUE` removes them (and marks the registry row retired) without
# inserting anything — this is `apply --retire`, not a special path.
remplacer_scalaire <- function(con, ressource, rows = NULL, version = NULL,
                               retire = FALSE, reference_content_version = NULL, ...) {
  valider_identite_ressource(ressource)

  publication_transaction(con, {
    # FK-safe order. EVERY statement is scoped to this indicator with an
    # unnamed positional param — never a hand-built SQL literal or named list.
    DBI::dbExecute(con, "DELETE FROM scalar_resource_comparison_publication WHERE indicator_id=$1",
                   params = list(ressource))
    DBI::dbExecute(con, "DELETE FROM comparison_source_lineage WHERE comparison_family='scalar' AND facet_id=$1",
                   params = list(ressource))
    DBI::dbExecute(con, "DELETE FROM scalar_comparison_territory WHERE indicator_id=$1",
                   params = list(ressource))
    DBI::dbExecute(con, "DELETE FROM scalar_comparison_group WHERE indicator_id=$1",
                   params = list(ressource))
    DBI::dbExecute(con, "DELETE FROM scalar_observation_source WHERE indicator_id=$1",
                   params = list(ressource))
    DBI::dbExecute(con, "DELETE FROM scalar_observation WHERE indicator_id=$1",
                   params = list(ressource))
    DBI::dbExecute(con, "DELETE FROM scalar_descriptor_source WHERE indicator_id=$1",
                   params = list(ressource))
    DBI::dbExecute(con, "DELETE FROM scalar_descriptor WHERE indicator_id=$1",
                   params = list(ressource))

    if (isTRUE(retire)) {
      ecrire_registre_ressource(con, ressource, "scalar", version,
        reference_content_version = reference_content_version, retired = TRUE)
      return(invisible(list(ressource = ressource, operation = "retire")))
    }
    if (is.null(rows) || !identical(as.character(rows$ressource), ressource))
      stop("Scalar adapter rows do not match the requested resource", call. = FALSE)

    .ecrire_sources_serveur(con, rows$sources, rows$vintages, conflict = "nothing")
    .ecrire_descripteurs_scalaires(con, rows$descriptor)
    .ecrire_observations_scalaires(con, rows$observations, rows$provenance)

    comparaison <- rows$comparison
    if (!is.null(comparaison)) {
      .ecrire_comparaison_scalaire(con, comparaison)
      reference <- if (is.null(reference_content_version))
        as.character(comparaison$reference_content_version[[1L]]) else
        as.character(reference_content_version)
      # Per-resource marker (the expand-phase counterpart of the untouched
      # global scalar_comparison_publication singleton).
      DBI::dbExecute(con, paste0(
        "INSERT INTO scalar_resource_comparison_publication(indicator_id,content_version,",
        "scalar_content_version,reference_content_version,group_row_count,",
        "territory_row_count,lineage_row_count) VALUES($1,$2,$3,$4,$5,$6,$7)"),
        params = list(ressource, as.character(comparaison$content_version),
          as.character(comparaison$scalar_content_version), reference,
          if (is.null(comparaison$groups)) 0L else nrow(comparaison$groups),
          if (is.null(comparaison$territories)) 0L else nrow(comparaison$territories),
          if (is.null(comparaison$lineage)) 0L else nrow(comparaison$lineage)))
      reference_content_version <- reference
    }

    ecrire_registre_ressource(con, ressource, "scalar", rows$version,
      reference_content_version = reference_content_version, retired = FALSE)
    ecrire_descripteurs_ressource(con, ressource, rows$version, rows$declarations)
    invisible(list(ressource = ressource, operation = "apply", version = rows$version))
  })
}
