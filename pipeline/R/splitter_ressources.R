# Per-theme splitter (ADR-0049 step 2, #1135) ---------------------------------
# Pont temporaire entre les sorties du producteur (scalar-serving/<theme>/,
# profile-serving/, series-serving/, collections de programmes, répertoire
# canonique AEDAR) et les Artefacts de ressource. Il réutilise LE CODE DES
# PRODUCTEURS — project_theme_scalar_cohort, project_scalar_comparisons,
# read_profile_serving_artifact, read_owned_series_artifact,
# register_programme_observed_collections, read_aedar_canonical — jamais un
# fork de projection. Les lectures typées ne sont PAS divisées (retirement
# ultérieur). Aucune connexion à la base de service.

NOMS_FICHIERS_AEDAR <- c("aedar_territorial_aggregate.parquet",
                         "aedar_territorial_aggregate_source.parquet",
                         "aedar_typequ_metadata.parquet")

lire_reference_sortie <- function(sortie) {
  chemin <- file.path(sortie, "territoires.parquet")
  if (!file.exists(chemin))
    stop("Sortie has no canonical territory reference (territoires.parquet)", call. = FALSE)
  project_territory_reference(nanoparquet::read_parquet(chemin))
}

# Chaque thème garde son artefact scalaire de producteur ; on lui applique la
# projection DEJA déclarée (exclusions de disposition, contrôle d'éligibilité)
# avant de découper par indicateur — un indicateur = une ressource scalaire.
lire_projections_scalaires_sortie <- function(sortie, metadata_directory = NULL) {
  themes <- retained_scalar_artifact_owners(metadata_directory)
  projections <- list()
  for (theme in themes) {
    dossier <- file.path(sortie, "scalar-serving", theme)
    if (!dir.exists(dossier)) next
    lu <- read_scalar_serving_artifact(dossier)
    projection <- project_theme_scalar_cohort(sortie, lu$eligible_territories, theme,
      artifact_directory = sortie)
    for (id in as.character(projection$descriptors$indicator_id)) {
      subset_field <- function(field)
        projection[[field]][projection[[field]]$indicator_id == id, , drop = FALSE]
      projections[[id]] <- list(
        facts = subset_field("facts"),
        descriptors = subset_field("descriptors"),
        provenance = subset_field("provenance"),
        eligible_territories = projection$eligible_territories)
    }
  }
  projections
}

lire_projections_profils_sortie <- function(sortie, metadata_directory = NULL) {
  dossier <- file.path(sortie, "profile-serving")
  if (!dir.exists(dossier)) return(list())
  binding <- if (file.exists(file.path(sortie, "scalar-serving", "binding.json")))
    read_profile_scalar_binding(sortie) else NULL
  themes <- c("demographie", "habitat", "mobilite")
  scalar_owners <- unlist(lapply(themes, function(theme) {
    metadata <- if (is.null(metadata_directory)) lire_theme_metadata(theme) else
      jsonlite::read_json(file.path(metadata_directory, paste0("theme_", theme, ".json")),
                          simplifyVector = FALSE)
    profile_serving_scalar_owners(metadata)
  }), use.names = FALSE)
  projections <- list()
  for (owner in declared_profile_owners()) {
    chemin <- file.path(dossier, owner)
    if (!dir.exists(chemin)) next
    projections[[owner]] <- read_profile_serving_artifact(chemin, owner,
      scalar_binding = if (owner %in% scalar_owners) binding else NULL)
  }
  projections
}

lire_projections_series_sortie <- function(sortie) {
  dossier <- file.path(sortie, "series-serving")
  if (!dir.exists(dossier)) return(list())
  projections <- list()
  for (owner in sort(list.files(dossier, full.names = FALSE))) {
    chemin <- file.path(dossier, owner)
    if (!dir.exists(chemin)) next
    # Le contrat d'artefact owned-series est la liste fermée des datasets : un
    # répertoire inconnu (lecture typée, par exemple) n'est PAS une ressource.
    connu <- tryCatch({ owned_series_artifact_fields(owner); TRUE },
                      error = function(e) FALSE)
    if (!connu) next
    projections[[owner]] <- read_owned_series_artifact(chemin, owner)
  }
  projections
}

lire_projections_collections_sortie <- function(sortie) {
  requis <- file.path(sortie, c("programmes_membres.parquet", "programmes_subventions.parquet"))
  if (!all(file.exists(requis))) return(list())
  entrees <- read_programme_serving_inputs(sortie)
  registre <- register_programme_observed_collections(entrees$metadata)
  lapply(registre, function(producteur) producteur$project(entrees$canonical))
}

lire_projection_aedar_sortie <- function(sortie) {
  candidats <- c(file.path(sortie, "aedar"),
                 file.path(sortie, "aedar", "canonical"),
                 file.path(sortie, "data", "processed", "aedar"),
                 Sys.getenv("LUSK_AEDAR_CANONICAL_DIR", unset = file.path("data", "processed", "aedar")))
  for (candidat in candidats) {
    if (all(file.exists(file.path(candidat, NOMS_FICHIERS_AEDAR))))
      return(read_aedar_canonical(candidat))
  }
  NULL
}

lire_projections_sortie <- function(sortie, metadata_directory = NULL) {
  aedar <- lire_projection_aedar_sortie(sortie)
  list(
    scalar = lire_projections_scalaires_sortie(sortie, metadata_directory),
    declared_profile = lire_projections_profils_sortie(sortie, metadata_directory),
    owned_series = lire_projections_series_sortie(sortie),
    observed_collection = lire_projections_collections_sortie(sortie),
    aedar = if (is.null(aedar)) list() else list(aedar = aedar)
  )
}

# La comparaison d'une ressource scalaire est calculée par le producteur sur
# UN seul indicateur : les groupes, territoires et lignage ne contiennent que
# facet_id == indicateur, et sont liés à la référence territoriale de la sortie.
comparaison_ressource <- function(forme, id, projection, reference) {
  if (!identical(forme, "scalar")) return(projection$comparison %||% NULL)
  descriptions <- projection$descriptors
  facet <- as.character(descriptions$comparison_facet[[1L]])
  direction <- as.character(descriptions$direction[[1L]])
  if (is.na(facet) || !identical(facet, id) || !direction %in% c("high", "low")) return(NULL)
  grains_faits <- projection[setdiff(names(projection), c("descriptors", "provenance"))]
  version_faits <- version_artefact(contenu_artefact(grains_faits, descriptions,
    projection$provenance, NULL))
  project_scalar_comparisons(projection, reference$rows,
    input_scalar_content_version = version_faits,
    reference_content_version = reference$content_version)
}

sources_provenance_ressource <- function(provenance) {
  if (is.null(provenance) || !is.data.frame(provenance) || !"source_id" %in% names(provenance))
    return(character())
  unique(as.character(provenance$source_id[!is.na(provenance$source_id)]))
}

splitter_sortie <- function(sortie, root = NULL, projections = NULL, reference = NULL,
                            digests = NULL, metadata_directory = NULL) {
  if (is.null(projections)) projections <- lire_projections_sortie(sortie, metadata_directory)
  if (is.null(reference)) reference <- lire_reference_sortie(sortie)
  if (!is.list(reference) || !is.data.frame(reference$rows) ||
      !is.character(reference$content_version) || length(reference$content_version) != 1L ||
      is.na(reference$content_version) || !nzchar(reference$content_version))
    stop("Splitter requires a canonical territory reference and its version", call. = FALSE)
  if (is.null(digests)) digests <- lire_digests_source(file.path(sortie, NOM_DIGESTS))
  if (!is.list(projections)) stop("Sortie projections must be a named list by shape", call. = FALSE)

  lignes <- list()
  for (forme in FORMES_RESSOURCE) {
    famille <- projections[[forme]]
    if (is.null(famille)) next
    for (id in names(famille)) {
      valider_identite_ressource(id)
      projection <- famille[[id]]
      descripteur <- projection$descriptor %||% projection$descriptors
      provenance <- projection$provenance %||% projection$source
      if (is.null(provenance))
        provenance <- data.frame(source_id = character(), vintage_id = character(),
                                 stringsAsFactors = FALSE)
      faits <- projection[setdiff(names(projection),
        c("descriptor", "descriptors", "provenance", "source", "comparison"))]
      comparaison <- comparaison_ressource(forme, id, projection, reference)
      contenu <- contenu_artefact(faits, descripteur, provenance, comparaison)
      digests_lignage <- digests_lignage_ressource(sources_provenance_ressource(provenance), digests)
      ecrit <- ecrire_artefact_ressource(id, forme, contenu,
        digests_lignage = digests_lignage, root = root)
      lignes[[length(lignes) + 1L]] <- data.frame(ressource = id, forme = forme,
        version = ecrit$version, statut = ecrit$statut, stringsAsFactors = FALSE)
    }
  }
  if (!length(lignes)) return(data.frame(ressource = character(), forme = character(),
    version = character(), statut = character(), stringsAsFactors = FALSE))
  resultat <- do.call(rbind, lignes)
  rownames(resultat) <- NULL
  resultat
}
