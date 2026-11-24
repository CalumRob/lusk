# Adaptateur de forme DECLARED_PROFILE (ADR-0049 step 2, #1138) ----------------
# `projeter(artefact) -> rows` et `remplacer(con, ressource, rows, version)`
# sont des CHAMPS de REGISTRE_FORMES_RESSOURCE$declared_profile (voir
# splitter_ressources.R). Cet adaptateur remplace le descripteur, les axes, les
# faits, la provenance et la comparaison D'UN SEUL profil déclaré. Toutes les
# écritures de tables de service passent par les writers partagés de
# publish_profile.R (.ecrire_sources_serveur / .ecrire_profil_descriptor /
# .ecrire_profil_axes_observations / .ecrire_comparaison_profil) : aucune SQL
# dupliquée, aucun guillemetage maison, aucun params nommé.
#
# Le marqueur GLOBAL (`table_publication['declared_profile']` et le singleton
# `profile_comparison_publication`) n'est JAMAIS écrit ici : la phase expand les
# laisse pour l'API actuelle jusqu'à l'étape 4 (#1140). Le marqueur par ressource
# (migration 047) et la ligne de registre sont écrits dans LA MÊME transaction
# que les lignes du profil — celle ouverte par `apply`.

.profile_rows_vides <- function() {
  list(axes = data.frame(axis_name = character(), axis_key = character(),
         label = character(), ordinal = integer(), unit = character(),
         stringsAsFactors = FALSE),
       facts = NULL,
       provenance = data.frame(indicator_id = character(), territory_id = character(),
         detail_key = character(), sex_key = character(), source_id = character(),
         vintage_id = character(), stringsAsFactors = FALSE),
       datasets = data.frame(source_id = character(), name = character(),
         stringsAsFactors = FALSE),
       vintages = data.frame(source_id = character(), vintage_id = character(),
         version = character(), reference_date = character(),
         publication_date = character(), stringsAsFactors = FALSE))
}

# Project an Artefact de ressource into the rows the shared writers consume.
# Pure: no connection, no write. The descriptor keeps ALL producer fields —
# including the declared `comparison_scalar` dependency and the build-time
# `required_scalar_version`, which `remplacer` rebinds at apply time.
projeter_artefact_profil_declare <- function(artefact) {
  if (!is.list(artefact) || !identical(as.character(artefact$forme), "declared_profile") ||
      !is.list(artefact$contenu))
    stop("Declared-profile adapter requires a declared_profile Artefact de ressource",
         call. = FALSE)
  id <- artefact$ressource
  valider_identite_ressource(id)
  contenu <- artefact$contenu
  descriptor <- .profil_liste(contenu$descriptor, id)
  grain <- contenu$faits
  if (is.null(grain)) grain <- list()
  extraire <- function(nom) {
    if (is.list(grain) && !is.null(grain[[nom]])) grain[[nom]] else contenu[[nom]]
  }
  vides <- .profile_rows_vides()
  axes <- extraire("axes") %||% vides$axes
  facts <- extraire("facts")
  if (is.null(facts) && is.data.frame(grain)) facts <- grain
  if (is.null(facts)) facts <- vides$facts
  if (!is.data.frame(facts))
    stop("Declared-profile artefact is missing its observation grain", call. = FALSE)
  datasets <- extraire("datasets") %||% vides$datasets
  vintages <- extraire("vintages") %||% vides$vintages
  provenance <- contenu$provenance %||% vides$provenance
  if (!is.data.frame(provenance))
    stop("Declared-profile artefact provenance is invalid", call. = FALSE)
  if (!"indicator_id" %in% names(provenance)) provenance$indicator_id <- rep(id, nrow(provenance))
  provenance$indicator_id <- rep(id, nrow(provenance))
  for (col in c("detail_key", "sex_key", "source_id", "vintage_id"))
    if (!col %in% names(provenance)) provenance[[col]] <- rep(NA_character_, nrow(provenance))

  list(ressource = id, forme = "declared_profile", version = artefact$version,
       descriptor = descriptor, axes = axes, facts = facts, provenance = provenance,
       datasets = datasets, vintages = vintages, comparison = contenu$comparison,
       digests_lignage = artefact$digests_lignage)
}

# Version de ressource publiée of the declared scalar dependency. When `apply`
# publishes the closure it passes every artefact's version explicitly — that is
# the authoritative binding (the dependency is in the same transaction). When
# the profile is applied on its own we read the live registry inside the same
# transaction. A missing dependency fails closed with a NAMED reason.
.version_ressource_dependance_profil <- function(con, dependance, artefacts = NULL) {
  dependance <- as.character(dependance)[[1L]]
  version <- NULL
  if (is.list(artefacts) && !is.null(artefacts[[dependance]]))
    version <- artefacts[[dependance]]$version
  if (!is.null(version)) version <- as.character(version)[[1L]]
  if (is.null(version) || is.na(version) || !nzchar(version)) {
    ligne <- DBI::dbGetQuery(con, paste0(
      "SELECT content_version FROM resource_publication ",
      "WHERE resource_id=$1 AND retired=false"), params = list(dependance))
    if (!is.data.frame(ligne) || !nrow(ligne) || is.na(ligne$content_version[[1L]]) ||
        !nzchar(as.character(ligne$content_version[[1L]])))
      stop("Declared-profile scalar dependency has no published resource version: ",
           dependance, call. = FALSE)
    version <- as.character(ligne$content_version[[1L]])[[1L]]
  }
  version
}

# Replace this ONE profile's rows inside the caller's publication transaction.
# `retire = TRUE` removes them (and marks the registry row retired) without
# inserting anything — this is `apply --retire`, not a special path.
remplacer_profil_declare <- function(con, ressource, rows = NULL, version = NULL,
                                     retire = FALSE, artefacts = NULL, ...) {
  valider_identite_ressource(ressource)
  if (!isTRUE(retire) && (is.null(rows) || !identical(as.character(rows$ressource), ressource)))
    stop("Declared-profile adapter rows do not match the requested resource", call. = FALSE)
  publication_transaction(con, {
    # Resolve the declared dependency BEFORE the first write. A missing scalar
    # resource version fails closed with a named reason; the transaction has
    # issued no statement at that point.
    descriptor <- NULL
    if (!isTRUE(retire)) {
      descriptor <- rows$descriptor
      dependance <- descriptor[["comparison_scalar"]]
      if (!is.null(dependance) && length(dependance) && !is.na(dependance) &&
          nzchar(as.character(dependance)[[1L]])) {
        descriptor$required_scalar_version <-
          .version_ressource_dependance_profil(con, dependance, artefacts = artefacts)
      }
    }

    # FK-safe, indicator-scoped deletes. EVERY statement carries an unnamed
    # positional param — never a hand-built SQL literal.
    DBI::dbExecute(con,
      "DELETE FROM profile_resource_comparison_publication WHERE indicator_id=$1",
      params = list(ressource))
    DBI::dbExecute(con,
      "DELETE FROM comparison_source_lineage WHERE comparison_family='profile' AND facet_id=$1",
      params = list(ressource))
    DBI::dbExecute(con, "DELETE FROM profile_comparison_territory WHERE indicator_id=$1",
      params = list(ressource))
    DBI::dbExecute(con, "DELETE FROM profile_comparison_group WHERE indicator_id=$1",
      params = list(ressource))
    DBI::dbExecute(con, "DELETE FROM profile_observation_source WHERE indicator_id=$1",
      params = list(ressource))
    DBI::dbExecute(con, "DELETE FROM profile_observation WHERE indicator_id=$1",
      params = list(ressource))
    DBI::dbExecute(con, "DELETE FROM profile_descriptor_source WHERE indicator_id=$1",
      params = list(ressource))
    DBI::dbExecute(con, "DELETE FROM profile_axis WHERE indicator_id=$1",
      params = list(ressource))
    DBI::dbExecute(con, "DELETE FROM profile_descriptor WHERE indicator_id=$1",
      params = list(ressource))

    if (isTRUE(retire)) {
      ecrire_registre_ressource(con, ressource, "declared_profile", version, retired = TRUE)
      return(invisible(list(ressource = ressource, operation = "retire")))
    }
    # `descriptor` now carries the apply-time RESOURCE version of the declared
    # scalar dependency; the build-time global token is never written.
    .ecrire_sources_serveur(con, rows$datasets, rows$vintages, conflict = "update")
    .ecrire_profil_descriptor(con, descriptor)
    .ecrire_profil_axes_observations(con, list(
      indicator_id = ressource, axes = rows$axes, facts = rows$facts,
      provenance = rows$provenance), descriptor)

    comparaison <- rows$comparison
    reference <- NULL
    if (!is.null(comparaison)) {
      .ecrire_comparaison_profil(con, comparaison)
      reference <- if (!is.null(comparaison$reference_content_version))
        as.character(comparaison$reference_content_version)[[1L]] else NULL
      version_comparaison <- if (!is.null(comparaison$content_version))
        as.character(comparaison$content_version)[[1L]] else as.character(version)
      version_faits <- if (!is.null(comparaison$profile_content_version))
        as.character(comparaison$profile_content_version)[[1L]] else as.character(version)
      # Per-resource marker (expand-phase counterpart of the untouched global
      # profile_comparison_publication singleton).
      DBI::dbExecute(con, paste0(
        "INSERT INTO profile_resource_comparison_publication(indicator_id,content_version,",
        "profile_content_version,reference_content_version,group_row_count,",
        "territory_row_count,lineage_row_count) VALUES($1,$2,$3,$4,$5,$6,$7)"),
        params = list(ressource, version_comparaison, version_faits, reference,
          if (is.null(comparaison$groups)) 0L else nrow(comparaison$groups),
          if (is.null(comparaison$territories)) 0L else nrow(comparaison$territories),
          if (is.null(comparaison$lineage)) 0L else nrow(comparaison$lineage)))
    }

    ecrire_registre_ressource(con, ressource, "declared_profile", rows$version,
      reference_content_version = reference, retired = FALSE)
    invisible(list(ressource = ressource, operation = "apply", version = rows$version))
  })
}
