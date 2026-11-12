# Matérialisation scalaire CIBLÉE par indicateur (#989) -------------------------
# La génération canonique complète matérialise l'artefact scalaire d'un thème
# depuis le payload EN MÉMOIRE du thème. Pour Mobilité ce payload vient d'un
# builder monolithique (OSM, OCS-GE, GTFS, bâtiments) : reconstruire trois
# scalaires d'approvisionnement légers ne justifie pas de rejouer tout le
# thème. Ce fichier ajoute un contrat de producteur ENREGISTRÉ, ciblé par
# indicateur : un périmètre nomme le thème, ses indicateurs enregistrés et les
# identifiants de sources qu'il lit ; le matérialiseur GÉNÉRIQUE ne recalcule
# QUE ces faits via les fonctions propriétaires, puis les fusionne dans
# l'artefact canonique courant en préservant chaque descripteur / fait /
# provenance non concerné et la référence territoriale partagée.
#
# Contrat fort : l'artefact produit reste COMPLET pour le thème (tous les
# contrats scalaires retenus). Il n'existe jamais de snapshot scalaire partiel :
# la publication en base reste le `--publish` plein snapshot existant, qui
# remplace la table entière. Ce chemin ne fait que préparer l'artefact.
#
# Gardes :
#   - la base doit être l'artefact canonique courant (pointeur `scalar-current`) ;
#   - chaque descripteur PRÉSERVÉ doit être identique à celui que la métadonnée
#     courante produit (sinon la base est périmée : régénération complète) ;
#   - chaque vintage de source PRÉSERVÉ doit être le vintage canonique courant ;
#   - l'univers éligible doit être exactement la référence territoriale courante
#     aux niveaux des contrats retenus ;
#   - aucune ligne de la base ne peut référencer un territoire hors univers.

scalar_scope_registry <- function() {
  list(
    mobilite = list(
      indicators = c("stations_service", "stations_service_1000",
                     "bornes_recharge_1000"),
      sources = c("mobilite_snapshot", "bpe_b316", "bornes-recharges",
                  "stationnement-velo"),
      produce = produire_ravitaillement_mobilite
    )
  )
}

# parse_scalar_scope ------------------------------------------------------------
# La sélection d'environnement : "<thème>:<id1>,<id2>,…" — le MÊME format pour
# la cible du graphe et le CLI. Toute sélection vide, inconnue ou dupliquée
# s'arrête bruyamment : jamais un périmètre deviné.
parse_scalar_scope <- function(selection) {
  if (!is.character(selection) || length(selection) != 1L || is.na(selection) ||
      !nzchar(trimws(selection)))
    stop("Scalar scope selection is empty", call. = FALSE)
  parts <- strsplit(trimws(selection), ":", fixed = TRUE)[[1L]]
  if (length(parts) != 2L || !nzchar(parts[[1L]]) || !nzchar(parts[[2L]]))
    stop("Scalar scope selection must be <theme>:<indicator>[,<indicator>…]",
         call. = FALSE)
  theme <- parts[[1L]]
  ids <- trimws(strsplit(parts[[2L]], ",", fixed = TRUE)[[1L]])
  scalar_scope_contract(theme, ids)
}

# scalar_scope_contract ---------------------------------------------------------
# Résout et VALIDE un périmètre enregistré. La sélection doit être un
# sous-ensemble non vide des indicateurs enregistrés du thème — jamais un
# indicateur arbitraire.
scalar_scope_contract <- function(theme, indicator_ids = NULL) {
  registry <- scalar_scope_registry()
  contract <- registry[[theme]]
  if (is.null(contract))
    stop("No registered scalar scope for theme: ", theme, call. = FALSE)
  if (is.null(indicator_ids)) indicator_ids <- contract$indicators
  if (!is.character(indicator_ids) || !length(indicator_ids) || anyNA(indicator_ids) ||
      any(!nzchar(indicator_ids)) || anyDuplicated(indicator_ids))
    stop("Scalar scope indicator selection is invalid", call. = FALSE)
  unknown <- setdiff(indicator_ids, contract$indicators)
  if (length(unknown))
    stop("Scalar scope names unregistered indicators for ", theme, ": ",
         paste(sort(unknown), collapse = ", "), call. = FALSE)
  list(theme = theme, indicators = indicator_ids, sources = contract$sources,
       produce = contract$produce)
}

# retained_scalar_indicator_ids -------------------------------------------------
# Les contrats scalaires RETENUS d'un thème : la métadonnée fait foi, la
# politique de retrait legacy est la même que le publisher retenu.
retained_scalar_indicator_ids <- function(metadata) {
  excluded <- scalar_indicators_with_serving_disposition(
    metadata, "excluded_legacy_accessibility")
  ids <- setdiff(names(metadata$scalar_contracts), excluded)
  if (!length(ids))
    stop("Producer scalar metadata has no retained indicator", call. = FALSE)
  ids
}

# scalar_scope_reference_universe -----------------------------------------------
# L'univers éligible EXACT de l'artefact : la référence territoriale courante
# filtrée aux niveaux déclarés par les contrats retenus — la même règle que
# project_theme_scalar_cohort applique au --check.
scalar_scope_reference_universe <- function(metadata, reference_rows) {
  ids <- retained_scalar_indicator_ids(metadata)
  levels <- unique(unlist(lapply(metadata$scalar_contracts[ids], function(contract)
    as.character(unlist(contract$allowed_levels, use.names = FALSE))),
    use.names = FALSE))
  if (!is.data.frame(reference_rows) ||
      !all(c("territory_id", "territory_type") %in% names(reference_rows)))
    stop("Scalar scope requires the canonical territory reference rows",
         call. = FALSE)
  universe <- reference_rows[reference_rows$territory_type %in% levels,
                             c("territory_id", "territory_type"), drop = FALSE]
  universe$territory_id <- as.character(universe$territory_id)
  universe$territory_type <- as.character(universe$territory_type)
  universe <- unique(universe)
  universe[order(universe$territory_type, universe$territory_id), , drop = FALSE]
}

# identical_scalar_descriptor ---------------------------------------------------
# Égalité SÉMANTIQUE d'un descripteur existant et de celui que la métadonnée
# courante produit. Un changement de libellé, d'unité, de niveau, de source,
# de direction, de complétude ou de calcul invalide la préservation. Le
# `descriptor_version` est EXCLU : c'est un jeton de contenu de la métadonnée,
# et une retouche documentaire d'une page (définition/caveat) sans changement
# sémantique ne doit pas forcer la régénération du thème. Le descripteur publié
# est alors préservé TEL QUEL — il n'est pas republié — et la dérive est
# rapportée par la matérialisation, jamais silencieuse.
identical_scalar_descriptor <- function(existing, expected) {
  fields <- c("indicator_id", "theme_id", "label", "unit", "direction",
              "comparison_facet", "denominator_semantics", "completeness")
  all(vapply(fields, function(field)
    identical(as.character(existing[[field]][[1L]]),
              as.character(expected[[field]][[1L]])), logical(1))) &&
    identical(as.character(unlist(existing$allowed_sources, use.names = FALSE)),
              as.character(unlist(expected$allowed_sources, use.names = FALSE))) &&
    identical(as.character(unlist(existing$allowed_levels, use.names = FALSE)),
              as.character(unlist(expected$allowed_levels, use.names = FALSE)))
}

# assert_scalar_scope_base ------------------------------------------------------
# Les gardes de la base préservée. Chaque écart est un refus de matérialisation :
# on ne préserve jamais silencieusement des lignes dont le contrat ou la
# fraîcheur a changé.
assert_scalar_scope_base <- function(base, preserved, metadata, vintages,
                                     eligible, indicator_ids) {
  if (!all(indicator_ids %in% retained_scalar_indicator_ids(metadata)))
    stop("Scalar scope indicator is not a retained contract", call. = FALSE)
  if (length(preserved)) {
    for (id in preserved) {
      existing <- base$descriptors[base$descriptors$indicator_id == id, , drop = FALSE]
      if (nrow(existing) != 1L)
        stop("Preserved scalar descriptor is missing or duplicated: ", id,
             call. = FALSE)
      expected <- scalar_descriptor_row(metadata, id)
      if (!identical_scalar_descriptor(existing, expected))
        stop("Preserved scalar descriptor is stale against current metadata: ",
             id, " — a full theme regeneration is required.", call. = FALSE)
    }
    provenance <- base$provenance[base$provenance$indicator_id %in% preserved, ,
                                  drop = FALSE]
    for (source_id in sort(unique(as.character(provenance$source_id)))) {
      vintage <- vintages[vintages$id == source_id, , drop = FALSE]
      if (nrow(vintage) != 1L)
        stop("Canonical vintage is missing or ambiguous for preserved source: ",
             source_id, call. = FALSE)
      expected_vintage <- paste(as.character(vintage$version[[1L]]),
                                as.character(vintage$date_reference[[1L]]), sep = "/")
      actual <- sort(unique(as.character(
        provenance$vintage_id[provenance$source_id == source_id])))
      if (!identical(actual, expected_vintage))
        stop("Preserved scalar base is stale for source ", source_id,
             " — a full theme regeneration is required.", call. = FALSE)
      dataset <- base$datasets[base$datasets$source_id == source_id, , drop = FALSE]
      if (nrow(dataset) != 1L ||
          !identical(as.character(dataset$name[[1L]]),
                     as.character(vintage$source[[1L]])))
        stop("Preserved scalar base dataset identity is stale for source: ",
             source_id, call. = FALSE)
    }
  }
  expected <- eligible
  actual <- base$eligible_territories[c("territory_id", "territory_type")]
  if (!setequal(paste(actual$territory_type, actual$territory_id),
                paste(expected$territory_type, expected$territory_id)))
    stop("Scalar base eligible universe differs from the current territory ",
         "reference — a full theme regeneration is required.", call. = FALSE)
  base_facts <- base$facts[base$facts$indicator_id %in% preserved, , drop = FALSE]
  if (nrow(base_facts) &&
      any(!paste(base_facts$territory_id, base_facts$territory_type) %in%
          paste(expected$territory_id, expected$territory_type)))
    stop("Preserved scalar fact references a territory outside the current ",
         "reference universe", call. = FALSE)
  invisible(TRUE)
}

# materialize_scoped_scalar_artifact --------------------------------------------
# Le matérialiseur GÉNÉRIQUE : produit le périmètre, fusionne dans la base,
# valide l'artefact complet, puis écrit une nouvelle génération immuable.
# `dry_run = TRUE` exécute exactement le même chemin sans écrire : le CLI
# compare alors la projection fraîche à l'artefact courant.
materialize_scoped_scalar_artifact <- function(theme, indicator_ids, cache,
                                               metadata, vintages,
                                               reference_rows, directory,
                                               contract = NULL,
                                               dry_run = FALSE) {
  if (is.null(contract)) contract <- scalar_scope_contract(theme, indicator_ids)
  if (!identical(contract$theme, theme) ||
      !setequal(contract$indicators, indicator_ids))
    stop("Scalar scope contract disagrees with the requested selection",
         call. = FALSE)
  base <- read_scalar_serving_artifact(file.path(directory, "scalar-serving", theme))
  retained <- retained_scalar_indicator_ids(metadata)
  preserved <- setdiff(intersect(retained, as.character(base$descriptors$indicator_id)),
                       indicator_ids)
  eligible <- scalar_scope_reference_universe(metadata, reference_rows)
  assert_scalar_scope_base(base, preserved, metadata, vintages, eligible,
                           indicator_ids)
  # Une retouche documentaire d'une page préservée (definition/caveat) change
  # le jeton descriptor_version sans changer le contrat sémantique : le
  # descripteur publié reste celui de la base, et la dérive est RAPPORTÉE.
  descriptor_version_drift <- preserved[vapply(preserved, function(id) {
    existing <- base$descriptors$descriptor_version[
      base$descriptors$indicator_id == id][[1L]]
    expected <- scalar_descriptor_row(metadata, id)$descriptor_version[[1L]]
    !identical(as.character(existing), as.character(expected))
  }, logical(1))]

  rows <- contract$produce(cache = cache, indicator_ids = indicator_ids,
                           metadata = metadata, vintages = vintages)
  scoped <- project_scalar_canonical_rows(rows, metadata, indicator_ids, eligible,
                                          source_vintages = vintages)

  facts <- rbind(
    base$facts[base$facts$indicator_id %in% preserved, , drop = FALSE],
    scoped$facts)
  descriptors <- rbind(
    base$descriptors[base$descriptors$indicator_id %in% preserved, , drop = FALSE],
    scoped$descriptors)
  provenance <- rbind(
    base$provenance[base$provenance$indicator_id %in% preserved, , drop = FALSE],
    scoped$provenance)
  used_sources <- unique(as.character(provenance$source_id))
  datasets <- unique(rbind(
    base$datasets[base$datasets$source_id %in% used_sources, , drop = FALSE],
    scoped$datasets))
  vintage_rows <- unique(rbind(
    base$vintages[base$vintages$source_id %in% used_sources, , drop = FALSE],
    scoped$vintages))
  if (anyDuplicated(datasets$source_id))
    stop("Merged scalar datasets conflict", call. = FALSE)
  if (anyDuplicated(vintage_rows[c("source_id", "vintage_id")]))
    stop("Merged scalar vintages conflict", call. = FALSE)
  # L'ORDRE des lignes préservées est celui de l'artefact de base (aucun
  # réordonnancement) : « non concerné » veut dire inchangé, ligne pour ligne.
  # L'univers éligible est celui de la base, déjà validé égal à la référence
  # courante — jamais reconstruit dans un autre ordre.
  eligible_territories <- base$eligible_territories
  rownames(facts) <- NULL
  rownames(descriptors) <- NULL
  rownames(provenance) <- NULL
  rownames(datasets) <- NULL
  rownames(vintage_rows) <- NULL
  merged <- list(facts = facts, descriptors = descriptors,
                 provenance = provenance, datasets = datasets,
                 vintages = vintage_rows,
                 eligible_territories = eligible_territories)
  validate_scalar_artifact_projection(merged)

  version <- NULL
  if (!dry_run) {
    version <- write_scalar_serving_artifact(
      merged, file.path(directory, "scalar-serving", theme))
  }
  list(version = version, projection = merged, scoped = scoped, base = base,
       descriptor_version_drift = descriptor_version_drift)
}

# verifier_snapshot_retention_scalaire ------------------------------------------
# Le rapport du --check retenu, partagé par --check et les commandes du
# périmètre ciblé : la même validation, la même sortie, jamais deux checks.
verifier_snapshot_retention_scalaire <- function(sortie, reference = NULL) {
  if (is.null(reference)) {
    reference <- project_territory_reference(nanoparquet::read_parquet(
      file.path(sortie, "territoires.parquet")))
  }
  snapshot <- project_retained_scalar_snapshot(sortie, reference)
  scalar_projection <- snapshot$scalar
  comparison_projection <- snapshot$comparison
  cat("Validated retained scalar snapshot:", nrow(scalar_projection$facts),
      "facts across", nrow(scalar_projection$descriptors),
      "registered indicators; version",
      scalar_content_version(scalar_projection), "\n")
  cat("Validated fixed-context scalar comparisons:",
      nrow(comparison_projection$groups), "group statistics and",
      nrow(comparison_projection$territories), "territory results; version",
      comparison_projection$content_version, "; scalar input",
      comparison_projection$scalar_content_version, "; territory reference",
      comparison_projection$reference_content_version, "\n")
  cat("Validated canonical territory reference:", nrow(reference$rows),
      "territories; version", reference$content_version, "\n")
  invisible(snapshot)
}

# produire_ravitaillement_mobilite ----------------------------------------------
# Le producteur ENREGISTRÉ du périmètre : les trois scalaires
# d'approvisionnement légers de Mobilité, à partir de LEURS sources et des
# fonctions propriétaires du thème (BPE B316, IRVE, population du hub vélo).
# Aucune lecture OSM / OCS-GE / GTFS : les agrégations passent par le seam
# partagé agreger_ravitaillement_territoires, et l'assemblage par le seam
# partagé assembler_indicateurs_mobilite — exactement le code du producteur
# complet, avec des entrées réduites à ce que ces trois faits exigent.
produire_ravitaillement_mobilite <- function(cache, indicator_ids, metadata,
                                             vintages) {
  fichier <- function(id) {
    f <- MANIFEST_MOBILITE$fichier[MANIFEST_MOBILITE$id == id]
    if (length(f) != 1L)
      stop("Mobility source is missing from the manifest: ", id, call. = FALSE)
    file.path(cache, f)
  }
  base_epci <- lire_epci(file.path(cache, "extracted",
                                   "EPCI_au_01-01-2025.xlsx"))
  snapshot <- normaliser_snapshot_mobilite(lire_snapshot_mobilite(
    fichier("mobilite_snapshot")))
  mobilite_communes <- snapshot[c("commune", "nb_buildings")]
  velo <- calculer_stationnement_velo_communes(
    normaliser_stationnement_velo(lire_stationnement_velo(
      fichier("stationnement-velo"))))
  bornes <- calculer_bornes_communes(
    normaliser_bornes_recharges(lire_bornes_recharges(
      fichier("bornes-recharges"))), base_epci)
  fuel <- calculer_fuel_communes(normaliser_bpe_b316(lire_bpe_b316(
    fichier("bpe_b316"))))
  ravitaillement <- agreger_ravitaillement_territoires(
    bornes, velo, fuel, base_epci[c("CODGEO", "EPCI", "DEP")])
  long <- dplyr::bind_rows(ravitaillement$bornes,
                           ravitaillement$bornes_1000,
                           ravitaillement$stations)
  territoires <- construire_territoires_mobilite(
    base_epci, list(mobilite_communes = mobilite_communes))
  units <- c(stations_service = "stations",
             stations_service_1000 = "stations / 1 000 hab",
             bornes_recharge_1000 = "bornes / 1 000 hab")
  missing <- setdiff(indicator_ids, names(units))
  if (length(missing))
    stop("Registered ravitaillement producer does not cover: ",
         paste(missing, collapse = ", "), call. = FALSE)
  tables <- lapply(indicator_ids, function(key)
    aligner_indicateur_mobilite(territoires,
                                long[long$key == key, c("code", "value"), drop = FALSE],
                                key, units[[key]]))
  names(tables) <- indicator_ids
  rangs <- compute_ranks(territoires, tables, scalaires = list(),
                         directions = DIRECTIONS_MOBILITE)
  rangs_combines <- dplyr::bind_rows(lapply(rangs, function(rang)
    rang %>% dplyr::mutate(detail = NA_character_)))
  lignes <- assembler_indicateurs_mobilite(dplyr::bind_rows(tables),
                                           rangs_combines, territoires, vintages)
  lignes <- lignes[is.na(lignes$detail) & lignes$key %in% indicator_ids, ,
                   drop = FALSE]
  data.frame(
    territory_id = as.character(lignes$territoire),
    territory_type = as.character(lignes$type),
    indicator_id = as.character(lignes$key),
    value = as.numeric(lignes$value),
    unit = as.character(lignes$unit),
    source_name = as.character(lignes$vintage_source),
    source_version = as.character(lignes$vintage_version),
    reference_date = as.character(lignes$vintage_date_reference),
    publication_date = as.character(lignes$vintage_date_publication),
    stringsAsFactors = FALSE
  )
}
