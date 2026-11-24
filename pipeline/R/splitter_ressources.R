# Splitter par thème (ADR-0049 step 2, #1135) -------------------------------
# Temporaire jusqu'à l'étape 3 (build par ressource) : il transforme les sorties
# du producteur (scalar-serving/<theme>/, profile-serving/, series-serving/,
# collections de programmes, répertoire canonique AEDAR) en Artefacts de
# ressource. Il réutilise LE CODE DES PRODUCTEURS — project_theme_scalar_cohort,
# project_scalar_comparisons, read_profile_serving_artifact,
# read_owned_series_artifact, register_programme_observed_collections,
# read_aedar_canonical — jamais un fork de projection. Les lectures typées ne
# sont PAS divisées (retirement ultérieur). Aucune connexion à la base de service.

lire_reference_sortie <- function(sortie) {
  chemin <- file.path(sortie, "territoires.parquet")
  if (!file.exists(chemin))
    stop("Sortie has no canonical territory reference (territoires.parquet)", call. = FALSE)
  project_territory_reference(nanoparquet::read_parquet(chemin))
}

# Chaque thème garde son artefact scalaire de producteur ; on lui applique la
# projection DEJA déclarée (exclusions de disposition, contrôle d'éligibilité)
# avant de découper par indicateur — un indicateur = une ressource scalaire.
lire_projections_scalaires_sortie <- function(sortie, metadata_directory = NULL, reference = NULL) {
  themes <- retained_scalar_artifact_owners(metadata_directory)
  if (is.null(reference)) reference <- lire_reference_sortie(sortie)
  # Même univers éligible que le chemin de publication courant
  # (project_retained_scalar_snapshot) : on ne compare PAS l'artefact à lui-même.
  eligible <- reference$rows[c("territory_id", "territory_type")]
  projections <- list()
  for (theme in themes) {
    dossier <- file.path(sortie, "scalar-serving", theme)
    if (!dir.exists(dossier)) next
    projection <- project_theme_scalar_cohort(sortie, eligible, theme,
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

# Les propriétaires de profils liés au scalaire sont déduits des CONTRATS
# producteur épinglés (tous les theme_*.json), jamais d'une liste de thèmes.
profil_owners_scalaires_depuis_metadata <- function(metadata_directory = NULL) {
  repertoire <- if (is.null(metadata_directory))
    system.file("extdata", "theme-metadata", package = "lusk") else metadata_directory
  fichiers <- sort(list.files(repertoire, pattern = "^theme_.*\\.json$", full.names = TRUE))
  if (!length(fichiers))
    stop("No producer theme metadata found for profile publication", call. = FALSE)
  unlist(lapply(fichiers, function(path)
    profile_serving_scalar_owners(jsonlite::fromJSON(path, simplifyVector = FALSE))),
    use.names = FALSE)
}

lire_projections_profils_sortie <- function(sortie, metadata_directory = NULL) {
  dossier <- file.path(sortie, "profile-serving")
  if (!dir.exists(dossier)) return(list())
  binding <- if (file.exists(file.path(sortie, "scalar-serving", "binding.json")))
    read_profile_scalar_binding(sortie) else NULL
  scalar_owners <- profil_owners_scalaires_depuis_metadata(metadata_directory)
  projections <- list()
  # declared_profile_owners() est l'inventaire des profils déclarés : la liste
  # fermée des Ressources sémantiques de service de cette forme.
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

lire_projection_aedar_sortie <- function(sortie, reference = NULL) {
  candidats <- c(file.path(sortie, "aedar"),
                 file.path(sortie, "aedar", "canonical"),
                 file.path(sortie, "data", "processed", "aedar"),
                 Sys.getenv("LUSK_AEDAR_CANONICAL_DIR", unset = file.path("data", "processed", "aedar")))
  for (candidat in candidats) {
    if (all(file.exists(file.path(candidat, AEDAR_CANONICAL_FILES)))) {
      projection <- read_aedar_canonical(candidat)
      # L'Artefact de ressource aedar porte sa comparaison (immuable, liée à la
      # référence de la sortie) : `apply` n'a jamais besoin de relire le
      # territory_reference vivant pour la publier (#1139).
      if (file.exists(file.path(candidat, "aedar_comparison_manifest.json"))) {
        if (is.null(reference)) reference <- lire_reference_sortie(sortie)
        projection$comparison <- comparaison_aedar_pour_artefact(candidat, reference)
      }
      return(projection)
    }
  }
  NULL
}

# La comparaison d'une ressource scalaire est calculée par le producteur sur
# UN seul indicateur : les groupes, territoires et lignage ne contiennent que
# facet_id == ressource, et sont liés à la référence territoriale de la sortie.
comparaison_scalaire_ressource <- function(projection, ressource, reference) {
  descriptions <- projection$descriptors
  facet <- as.character(descriptions$comparison_facet[[1L]])
  direction <- as.character(descriptions$direction[[1L]])
  if (is.na(facet) || !identical(facet, ressource) || !direction %in% c("high", "low")) return(NULL)
  version_faits <- version_faits_ressource(REGISTRE_FORMES_RESSOURCE[["scalar"]], projection)
  # Jeton explicite (ADR-0049) : `scalar_content_version` est la version des
  # FAITS DE CETTE RESSOURCE (descripteur + faits + provenance, comparaison
  # exclue) — PAS le jeton scalaire global d'aujourd'hui, calculé par le
  # producteur sur le snapshot de TOUS les indicateurs. `reference_content_version`
  # est la version de la référence territoriale de la sortie. Un changement de
  # référence déplace donc la comparaison de chaque ressource, pas un token global.
  project_scalar_comparisons(projection, reference$rows,
    input_scalar_content_version = version_faits,
    reference_content_version = reference$content_version)
}

# Toute comparaison qui porte ces jetons — scalaire OU autre forme — doit être
# liée aux faits de CETTE ressource et à la référence de la sortie. Les
# comparaisons sans jetons (familles sans publication de comparaison) sont
# simplement laissées telles quelles.
verifier_jetons_comparaison <- function(handler, projection, ressource, reference, comparaison) {
  if (!is.list(comparaison) ||
      !all(c("scalar_content_version", "reference_content_version") %in% names(comparaison)))
    return(invisible(NULL))
  attendu <- version_faits_ressource(handler, projection)
  if (!identical(as.character(comparaison$scalar_content_version), as.character(attendu)) ||
      !identical(as.character(comparaison$reference_content_version),
                 as.character(reference$content_version)))
    stop("Comparison tokens are not bound to this resource's facts and the sortie territory reference: ",
      ressource, call. = FALSE)
  invisible(TRUE)
}

# Les producteurs écrivent aujourd'hui les comparaisons après leur artefact de
# forme. Le splitter doit donc les matérialiser dans l'Artefact de ressource avec
# les MÊMES projecteurs, jamais les laisser absentes (#1142).
comparaison_profil_ressource <- function(projection, ressource, reference) {
  if (!is.null(projection$comparison)) return(projection$comparison)
  dependance <- champ_descripteur(projection$descriptor, "comparison_scalar")
  if (!is.null(dependance) && length(dependance) && !is.na(dependance) &&
      nzchar(as.character(dependance)[[1L]]))
    # La comparaison DPE EST celle du scalaire déclaré : elle est prouvée une
    # seule fois sous cette ressource, pas recopiée dans les tables du profil.
    return(list(reference_content_version = reference$content_version,
                kind = "declared_profile", comparison_scalar = dependance[[1L]]))
  version <- version_faits_ressource(REGISTRE_FORMES_RESSOURCE[["declared_profile"]],
                                     projection)
  project_declared_profile_comparisons(list(projection), reference$rows,
    profile_content_version = version, reference_content_version = reference$content_version)
}

comparaison_series_ressource <- function(projection, ressource, reference) {
  if (!is.null(projection$comparison)) return(projection$comparison)
  levels <- champ_descripteur(projection$descriptor, "comparison_levels")
  if (is.null(levels) || !length(levels))
    return(list(reference_content_version = reference$content_version,
                kind = "owned_series"))
  version <- version_faits_ressource(REGISTRE_FORMES_RESSOURCE[["owned_series"]], projection)
  project_ordered_series_comparisons(projection, reference$rows, version,
    reference$content_version)
}

comparaison_collection_ressource <- function(projection, ressource, reference) {
  if (!is.null(projection$comparison)) return(projection$comparison)
  kind <- champ_descripteur(projection$descriptor, "kind")
  version <- version_faits_ressource(REGISTRE_FORMES_RESSOURCE[["observed_collection"]],
                                     projection)
  if (identical(as.character(kind), "period_detail"))
    return(project_observed_collection_comparisons(projection, reference$rows,
      version, reference$content_version))
  list(reference_content_version = reference$content_version, kind = "observed_collection")
}

# Comparaison déjà portée par la projection AEDAR — aucune forme ne la recalcule
# localement lorsque le producteur l'a immuablement matérialisée.
comparaison_persistee <- function(champ) {
  force(champ)
  function(projection, ressource, reference) projection[[champ]] %||% NULL
}

# Version des FAITS de CETTE ressource : descripteur + faits + provenance,
# comparaison exclue. Seul l'artefact de la resource est haché — jamais le
# snapshot scalaire global d'aujourd'hui (ADR-0049).
version_faits_ressource <- function(handler, projection) {
  version_faits_artefact(list(contenu = contenu_artefact(
    faits_forme(handler, projection),
    projection[[handler$champ_descripteur]], projection[[handler$champ_provenance]], NULL)))
}

# Enregistre À LA CONSTRUCTION la version des FAITS de la ressource déclarée
# comme dépendance, calculée depuis LA MÊME sortie. `apply` ne fait que VÉRIFIER
# ce jeton (#1138) : jamais de rebind silencieux. Si la dépendance n'est pas
# construite dans cette sortie, le jeton du producteur est conservé tel quel —
# la vérification d'apply le confrontera au vivant. Aucun identifiant en dur.
lier_dependance_faits_profil <- function(descripteur, projections) {
  dependance <- champ_descripteur(descripteur, "comparison_scalar")
  if (is.null(dependance) || !length(dependance) || is.na(dependance) ||
      !nzchar(as.character(dependance)[[1L]]))
    return(descripteur)
  scalaire <- if (is.list(projections)) projections$scalar[[as.character(dependance)[[1L]]]] else NULL
  if (is.null(scalaire)) return(descripteur)
  descripteur$required_scalar_version <- version_faits_ressource(
    REGISTRE_FORMES_RESSOURCE[["scalar"]], scalaire)
  descripteur
}

lier_dependance_aucune <- function(descripteur, projections) descripteur

faits_forme <- function(handler, projection) {
  if (!is.null(handler$champs_faits)) return(projection[handler$champs_faits])
  exclus <- unique(c(handler$champ_descripteur, handler$champ_provenance, "comparison"))
  projection[setdiff(names(projection), exclus)]
}

# Registre des formes de Ressource sémantique de service (ADR-0049 décision 8).
# UNE entrée par forme ; le contrat du handler est petit et nommé :
#   lire(sortie, reference, metadata_directory) -> liste nommée de projections ;
#   champs_faits / champ_descripteur / champ_provenance / champ_comparaison
#   désignent les grains de l'Artefact de ressource ;
#   comparaison(projection, ressource, reference) -> comparaison de la ressource ;
#   comparer_definition(live, built) -> garde canonique composé pour cette forme ;
#   champ_faits_drift -> chemin vers le tableau territory_id/value de l'artefact.
# Ajouter une forme = ajouter UNE entrée ici ; ni le splitter ni le plan n'ont
# de branche conditionnelle par forme.
# Definition semantique d'un descripteur — UNE seule source : les constantes et
# identical_scalar_descriptor() de publish_scalar_scope.R (deja partagees avec
# publish_serving_bridge.R). Aucun champ n'est repertorie ici : on projette le
# descripteur de la forme sur LE jeu canonique, puis on delegue au garde
# canonique. Son ordre de listes est conserve (un reordonnancement est un
# changement de definition, conservateur).
projeter_description_canonique <- function(descripteur) {
  champs <- SCALAR_DESCRIPTOR_SEMANTICS
  ligne <- lapply(champs, function(champ) {
    valeur <- if ((is.list(descripteur) || is.data.frame(descripteur)) &&
                  champ %in% names(descripteur)) descripteur[[champ]] else NULL
    if (champ %in% SCALAR_DESCRIPTOR_SEMANTIC_LIST_FIELDS) {
      I(list(if (is.null(valeur)) NA_character_ else
        as.character(unlist(valeur, use.names = FALSE))))
    } else {
      if (is.null(valeur)) NA_character_ else as.character(valeur)[[1L]]
    }
  })
  names(ligne) <- champs
  as.data.frame(ligne, stringsAsFactors = FALSE, optional = TRUE)
}

noms_definition_modifiee <- function(canonical_live, canonical_built) {
  SCALAR_DESCRIPTOR_SEMANTICS[vapply(SCALAR_DESCRIPTOR_SEMANTICS, function(champ) {
    avant <- canonical_live[[champ]]
    apres <- canonical_built[[champ]]
    if (champ %in% SCALAR_DESCRIPTOR_SEMANTIC_LIST_FIELDS) {
      !identical(as.character(unlist(avant, use.names = FALSE)),
                 as.character(unlist(apres, use.names = FALSE)))
    } else {
      !identical(as.character(avant[[1L]]), as.character(apres[[1L]]))
    }
  }, logical(1))]
}

comparer_definition_canonique <- function(projeter = projeter_description_canonique) {
  function(live, built) {
    avant <- projeter(live)
    apres <- projeter(built)
    champs <- noms_definition_modifiee(avant, apres)
    list(change = !identical_scalar_descriptor(avant, apres), champs = champs)
  }
}

REGISTRE_FORMES_RESSOURCE <- list(
  scalar = list(
    lire = function(sortie, reference, metadata_directory)
      lire_projections_scalaires_sortie(sortie, metadata_directory, reference),
    champs_faits = c("facts", "eligible_territories"),
    champ_descripteur = "descriptors",
    champ_provenance = "provenance",
    champ_comparaison = NULL,
    comparaison = comparaison_scalaire_ressource,
    comparer_definition = comparer_definition_canonique(),
    champ_faits_drift = "facts",
    # Shape adapter (ADR-0049 seam): the ONLY writer of this shape's serving
    # tables. projeter(artefact) -> scoped rows; remplacer(con, ...) applies
    # them inside the publication transaction. Defined in adaptateur_scalaire.R
    # (loaded before this file) and attached here as registry fields.
    lier_dependance = lier_dependance_aucune,
    projeter = projeter_artefact_scalaire,
    remplacer = remplacer_scalaire,
    # Adoption reads the SAME projection the adapter writes. Storage-only
    # columns are declared here, never special-cased in the adopt command.
    lire_live = lire_live_scalaire,
    champs_live = c("descriptor", "eligible_territories", "observations", "provenance",
                    "comparison"),
    colonnes_stockage = list(observations = "published_at"),
    champs_comparaison = c("groups", "territories", "lineage"),
    # Today's normal publisher stamps the WHOLE scalar snapshot token. The
    # per-resource artefact deliberately rebinds those two storage tokens to
    # this resource; comparison facts and the reference clock remain exact.
    colonnes_comparaison = list(
      groups = c("scalar_content_version", "content_version"),
      territories = c("scalar_content_version", "content_version"),
      lineage = "comparison_content_version")),
  declared_profile = list(
    lire = function(sortie, reference, metadata_directory)
      lire_projections_profils_sortie(sortie, metadata_directory),
    champs_faits = NULL,
    champ_descripteur = "descriptor",
    champ_provenance = "provenance",
    champ_comparaison = "comparison",
    comparaison = comparaison_profil_ressource,
    comparer_definition = comparer_definition_canonique(),
    champ_faits_drift = NULL,
    # Shape adapter (ADR-0049 seam, #1138): the ONLY writer of this shape's
    # serving tables. Defined in adaptateur_profil_declare.R (loaded before
    # this file) and attached here as registry fields.
    lier_dependance = lier_dependance_faits_profil,
    projeter = projeter_artefact_profil_declare,
    remplacer = remplacer_profil_declare,
    lire_live = lire_live_profil_declare,
    normaliser_live = normaliser_live_profil,
    champs_live = c("descriptor", "axes", "facts", "provenance", "comparison"),
    colonnes_stockage = list(),
    champs_comparaison = c("groups", "territories", "lineage"),
    colonnes_comparaison = list(
      groups = "profile_content_version", territories = "profile_content_version")),
  owned_series = list(
    lire = function(sortie, reference, metadata_directory)
      lire_projections_series_sortie(sortie),
    champs_faits = NULL,
    champ_descripteur = "descriptor",
    champ_provenance = "provenance",
    champ_comparaison = "comparison",
    comparaison = comparaison_series_ressource,
    comparer_definition = comparer_definition_canonique(),
    champ_faits_drift = NULL, lier_dependance = lier_dependance_aucune,
    # Shape adapter (ADR-0049 seam, #1139): one resource per dataset. The OCS-GE
    # state series (artif_par_habitant) publishes through this adapter, so no
    # typed-reading code is needed to keep it live.
    projeter = projeter_artefact_series,
    remplacer = remplacer_series,
    lire_live = lire_live_series,
    champs_live = c("projection", "comparison"),
    colonnes_stockage = list(),
    champs_comparaison = c("groups", "territories", "lineage", "zero_reasons",
                           "content_version", "ordered_series_content_version",
                           "reference_content_version", "axis_values")),
  observed_collection = list(
    lire = function(sortie, reference, metadata_directory)
      lire_projections_collections_sortie(sortie),
    champs_faits = NULL,
    champ_descripteur = "descriptor",
    champ_provenance = "provenance",
    champ_comparaison = "comparison",
    comparaison = comparaison_collection_ressource,
    comparer_definition = comparer_definition_canonique(),
    champ_faits_drift = NULL, lier_dependance = lier_dependance_aucune,
    # Shape adapter (ADR-0049 seam, #1139): one resource per collection.
    projeter = projeter_artefact_collection,
    remplacer = remplacer_collection,
    lire_live = lire_live_collection,
    champs_live = c("projection", "comparison"),
    colonnes_stockage = list(),
    champs_comparaison = c("groups", "territories", "lineage",
                           "collection_content_version", "reference_content_version")),
  aedar = list(
    lire = function(sortie, reference, metadata_directory) {
      projection <- lire_projection_aedar_sortie(sortie, reference)
      if (is.null(projection)) list() else list(aedar = projection)
    },
    champs_faits = NULL,
    champ_descripteur = "descriptor",
    champ_provenance = "source",
    champ_comparaison = "comparison",
    comparaison = comparaison_persistee("comparison"),
    comparer_definition = comparer_definition_canonique(),
    champ_faits_drift = NULL, lier_dependance = lier_dependance_aucune,
    # Shape adapter (ADR-0049 seam, #1139): the single aedar resource writes its
    # aggregate, TYPEQU metadata, comparison, density and littoral summaries in
    # one transaction, plus the registry row.
    projeter = projeter_artefact_aedar,
    remplacer = remplacer_aedar,
    lire_live = lire_live_aedar,
    champs_live = c("descriptor", "projection", "summary", "comparison"),
    colonnes_stockage = list(),
    champs_comparaison = c("groups", "territories", "density_rows", "littoral_rows",
      "content_version", "aedar_content_version", "reference_content_version",
      "input_content_version", "input_identity", "source_snapshot_id", "publication_mode"))
)

lire_projections_sortie <- function(sortie, metadata_directory = NULL, reference = NULL) {
  lapply(REGISTRE_FORMES_RESSOURCE, function(handler)
    handler$lire(sortie, reference, metadata_directory))
}

sources_provenance_ressource <- function(provenance) {
  if (is.null(provenance) || !is.data.frame(provenance) || !"source_id" %in% names(provenance))
    return(character())
  unique(as.character(provenance$source_id[!is.na(provenance$source_id)]))
}

splitter_sortie <- function(sortie, root = NULL, projections = NULL, reference = NULL,
                            digests = NULL, metadata_directory = NULL) {
  if (is.null(reference)) reference <- lire_reference_sortie(sortie)
  if (!is.list(reference) || !is.data.frame(reference$rows) ||
      !is.character(reference$content_version) || length(reference$content_version) != 1L ||
      is.na(reference$content_version) || !nzchar(reference$content_version))
    stop("Splitter requires a canonical territory reference and its version", call. = FALSE)
  if (is.null(projections)) projections <- lire_projections_sortie(sortie, metadata_directory, reference)
  if (is.null(digests)) digests <- lire_digests_source(file.path(sortie, NOM_DIGESTS))
  if (!is.list(projections)) stop("Sortie projections must be a named list by shape", call. = FALSE)

  lignes <- list()
  for (forme in names(REGISTRE_FORMES_RESSOURCE)) {
    handler <- REGISTRE_FORMES_RESSOURCE[[forme]]
    famille <- projections[[forme]]
    if (is.null(famille)) next
    for (id in names(famille)) {
      valider_identite_ressource(id)
      projection <- famille[[id]]
      descripteur <- projection[[handler$champ_descripteur]]
      # Le handler de forme enregistre à la construction le jeton de dépendance
      # déclarée (profil déclaré) depuis LA MÊME sortie ; les autres formes sont
      # une identité. Aucune branche par forme, aucun identifiant en dur ici.
      descripteur <- handler$lier_dependance(descripteur, projections)
      # La déclaration de découverte fait partie du descripteur de l'artefact :
      # elle est donc hachée avec cette Version de ressource publiée et publiée
      # par l'adaptateur dans la même transaction que le registre (#1140).
      descripteur <- attacher_declaration_ressource(descripteur, id, metadata_directory)
      provenance <- projection[[handler$champ_provenance]]
      if (is.null(provenance))
        provenance <- data.frame(source_id = character(), vintage_id = character(),
                                 stringsAsFactors = FALSE)
      faits <- faits_forme(handler, projection)
      comparaison <- handler$comparaison(projection, id, reference)
      verifier_jetons_comparaison(handler, projection, id, reference, comparaison)
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
