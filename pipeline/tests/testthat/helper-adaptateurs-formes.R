# TEST ONLY — bounded synthetic projections for the three #1139 shape adapters.
# They follow the producers' own contracts (validate_*), never a second copy of
# production SQL. Nothing here is called by production code.

# Lignes de référence telles qu'`apply` les lit une fois et les transmet aux
# adaptateurs (lire_reference_live_apply).
adaptateur_reference_rows <- function() {
  reference <- artefacts_fixture_reference()$rows
  cbind(reference,
    littoral_code = rep(NA_character_, nrow(reference)),
    littoral_classement_source = rep(NA_character_, nrow(reference)),
    stringsAsFactors = FALSE)
}

adaptateur_aedar_reference_rows <- function(with_littoral = FALSE) {
  classe <- as.character(registre_classes_densite()[["classe_densite_code"]])[[1L]]
  reference <- data.frame(
    territory_id = c("22001", "200000001", "22", "53"),
    territory_type = c("commune", "epci", "departement", "region"),
    epci_id = c("200000001", NA_character_, NA_character_, NA_character_),
    density_class_code = c(classe, NA_character_, NA_character_, NA_character_),
    stringsAsFactors = FALSE)
  if (with_littoral) {
    reference$littoral_code <- c("C", NA_character_, NA_character_, NA_character_)
    reference$littoral_classement_source <- c("fixture", NA_character_, NA_character_, NA_character_)
  }
  reference
}

adaptateur_revision <- function(source_id = "ocsge", vintage_id = "v1") {
  fields <- list(source_id, vintage_id, "OCS GE", "ocsge_dataset", "v1",
                 "2020-01-01", "2021-01-01")
  hash <- series_revision_hash(fields[[1L]], fields[[2L]], fields[[3L]],
    fields[[4L]], fields[[5L]], fields[[6L]], fields[[7L]])
  data.frame(provenance_revision_id = paste0(source_id, "-", vintage_id, "-",
               substr(hash, 1L, 16L)),
    source_id = source_id, vintage_id = vintage_id, source_name = fields[[3L]],
    dataset_name = fields[[4L]], source_version = fields[[5L]],
    reference_date = as.Date(fields[[6L]]), publication_date = as.Date(fields[[7L]]),
    revision_hash = hash, stringsAsFactors = FALSE)
}

# A valid owned-series projection for the OCS-GE `artif_par_habitant` dataset.
# axis_kind = state_role keeps both M2/M3 roles without requiring the full
# declared-detail metadata bundle; the adapter contract is identical.
adaptateur_series_projection <- function(dataset_id = "artif_par_habitant",
                                         value = 10) {
  revision <- adaptateur_revision()
  territories <- artefacts_fixture_territories()
  territories <- territories[territories$territory_type == "commune", , drop = FALSE]
  axes <- c("M2", "M3")
  points <- do.call(rbind, lapply(axes, function(axis) data.frame(
    dataset_id = dataset_id, indicator_id = dataset_id,
    territory_id = territories$territory_id, territory_type = "commune",
    axis_value = axis, observation_period = "2019-2020",
    value = value + if (identical(axis, "M3")) 1 else 0,
    status = "measured", stringsAsFactors = FALSE)))
  projection <- list(dataset_id = dataset_id,
    descriptor = list(dataset_id = dataset_id, indicator_id = dataset_id,
      axis_kind = "state_role", axis_values = axes, completeness = "may_be_missing",
      comparison_point = NULL, label = "Artificialisation", unit = "m2/hab",
      direction = "none", allowed_levels = c("commune", "epci"),
      descriptor_version = "artif-par-habitant-v1", theme_id = "milieux"),
    points = points, provenance = revision,
    point_provenance = unique(data.frame(dataset_id = dataset_id,
      indicator_id = dataset_id, territory_id = points$territory_id,
      axis_value = points$axis_value,
      provenance_revision_id = revision$provenance_revision_id[[1L]],
      stringsAsFactors = FALSE)))
  validate_owned_series_projection(projection)
  projection
}

adaptateur_series_artefact <- function(root, dataset_id = "artif_par_habitant",
                                       value = 10, reference_version = "reference-v1") {
  projection <- adaptateur_series_projection(dataset_id, value)
  contenu <- contenu_artefact(
    faits_forme(REGISTRE_FORMES_RESSOURCE[["owned_series"]], projection),
    projection$descriptor, projection$provenance,
    list(reference_content_version = reference_version, kind = "owned_series"))
  ecrit <- ecrire_artefact_ressource(dataset_id, "owned_series", contenu,
    digests_lignage = digests_lignage_ressource("ocsge", artefacts_fixture_digests("ocsge")),
    root = root)
  lire_artefact_ressource(dataset_id, ecrit$version, root = root)
}

# A valid period_detail observed-collection projection (acv-like).
adaptateur_collection_projection <- function(indicator = "acv", value = 5) {
  territories <- artefacts_fixture_territories()
  territories <- territories[territories$territory_type == "commune", , drop = FALSE]
  descriptor <- list(indicator_id = indicator, theme_id = "programmes",
    kind = "period_detail", label = "ACV", unit = "count",
    allowed_levels = c("commune", "epci"), comparison_detail = "acv_2023",
    comparison_period = "2023", direction = "high",
    descriptor_version = paste0(indicator, "-v1"))
  categories <- data.frame(indicator_id = indicator, detail_key = c("acv_2022", "acv_2023"),
    label = c("2022", "2023"), ordinal = c(0L, 1L), source_id = "programme_source",
    stringsAsFactors = FALSE)
  facts <- data.frame(indicator_id = indicator, territory_id = territories$territory_id,
    territory_type = "commune", detail_key = "acv_2023", observation_period = "2023",
    value = value, source_id = "programme_source", vintage_id = "v1", stringsAsFactors = FALSE)
  datasets <- data.frame(source_id = "programme_source", name = "Programmes", stringsAsFactors = FALSE)
  vintages <- data.frame(source_id = "programme_source", vintage_id = "v1", version = "v1",
    reference_date = as.Date("2023-01-01"), publication_date = as.Date("2024-01-01"),
    stringsAsFactors = FALSE)
  structure(list(descriptor = descriptor, categories = categories, facts = facts,
    datasets = datasets, vintages = vintages,
    provenance = data.frame(source_id = character(), vintage_id = character(),
      stringsAsFactors = FALSE)), class = "collection-projection")
}

# --- AEDAR -------------------------------------------------------------------
adaptateur_aedar_typequ_fixture <- function() {
  readr::read_csv(testthat::test_path("fixtures", "aedar-region-2026v1-typequ.csv"),
    col_types = readr::cols(.default = readr::col_character()), trim_ws = FALSE,
    show_col_types = FALSE)
}

adaptateur_aedar_metadata <- function() {
  axis <- read_aedar_typequ_registry()
  i <- seq_len(nrow(axis))
  domain <- ((i - 1L) %% 27L) %% 7L + 1L
  data.frame(TYPEQU = axis$TYPEQU, LIB_TYPEQU = axis$LIB_TYPEQU,
    description = paste("Description", i), domain_code = paste0("D", domain),
    domain_label = paste("Domain", domain),
    subdomain_code = paste0("S", ((i - 1L) %% 27L) + 1L),
    subdomain_label = paste("Subdomain", ((i - 1L) %% 27L) + 1L),
    GAMME = c("Proximité", "Hors Gamme", rep(NA_character_, length(i) - 2L)),
    gamme_status = c("classified", "hors_gamme", rep("absent", length(i) - 2L)),
    source_order = i, stringsAsFactors = FALSE)
}

adaptateur_aedar_projection <- function() {
  axis <- adaptateur_aedar_typequ_fixture()
  inputs <- stats::setNames(lapply(AEDAR_AGGREGATE_LEVELS, function(level) {
    x <- as.data.frame(matrix(0, nrow = nrow(axis), ncol = length(AEDAR_AGGREGATE_MEASURES),
      dimnames = list(NULL, AEDAR_AGGREGATE_MEASURES)))
    x$code_insee <- "22001"; x$epci_code <- "200000001"
    x$code_departement <- "22"; x$code_region <- "53"
    x$nom_commune <- "Essai"; x$nom_epci <- "EPCI"
    x$nom_departement <- "Département"; x$nom_region <- "Bretagne"
    x$TYPEQU <- axis$TYPEQU; x$LIB_TYPEQU <- axis$LIB_TYPEQU
    x$n_addresses <- 2L; x$n_observed <- 1L; x$coverage_status <- "covered"
    x$count_5_walk_share <- NA_real_
    x[, c(AEDAR_AGGREGATE_LEVEL_COLUMNS[[level]], AEDAR_AGGREGATE_MEASURES), drop = FALSE]
  }), AEDAR_AGGREGATE_LEVELS)
  project_aedar_aggregates(inputs, adaptateur_aedar_metadata())
}

# Materialized density aggregate for a REAL canonical comparison manifest
# (including its tempfile generation paths), following the producer's contract.
adaptateur_aedar_density_source <- function() {
  axis <- read_aedar_typequ_registry()
  registry <- registre_classes_densite()
  codes <- as.character(registry[["classe_densite_code"]])
  ref <- list(crosswalk = data.frame(code_insee = c("22001", paste0("unused", 2:7)),
    density_class_code = codes,
    density_class_label = as.character(registry[["classe_densite_libelle_public"]]),
    stringsAsFactors = FALSE),
    identity = MANIFEST_CLASSES_DENSITE[["id"]][[1L]],
    sha256 = MANIFEST_CLASSES_DENSITE[["sha256"]][[1L]],
    vintage = MANIFEST_CLASSES_DENSITE[["vintage"]][[1L]])
  grid <- expand.grid(density_class_code = codes, TYPEQU = axis$TYPEQU, stringsAsFactors = FALSE)
  density <- data.frame(territory_type = "density_class",
    territory_id = grid$density_class_code, density_class_code = grid$density_class_code,
    density_class_label = ref$crosswalk$density_class_label[
      match(grid$density_class_code, codes)],
    TYPEQU = grid$TYPEQU, LIB_TYPEQU = axis$LIB_TYPEQU[match(grid$TYPEQU, axis$TYPEQU)],
    n_addresses = 1L, n_observed = 1L, coverage_status = "covered",
    source_snapshot_id = AEDAR_AGGREGATE_VINTAGE,
    density_reference_identity = ref$identity,
    density_reference_sha256 = ref$sha256,
    density_reference_vintage = ref$vintage,
    input_content_version = "", input_identity = "",
    content_version = paste(rep("b", 64), collapse = ""), stringsAsFactors = FALSE)
  for (measure in AEDAR_AGGREGATE_MEASURES) density[[measure]] <- 1
  hashes <- c(stats::setNames(rep(paste(rep("1", 64), collapse = ""),
    length(AEDAR_ADDRESS_SOURCE_MODES)), paste0("mode:", AEDAR_ADDRESS_SOURCE_MODES)),
    address_origins = paste(rep("2", 64), collapse = ""), density_reference = ref$sha256)
  density$input_identity <- as.character(jsonlite::toJSON(as.list(hashes), auto_unbox = TRUE))
  density$input_content_version <- paste(as.character(openssl::sha256(
    charToRaw(density$input_identity[[1L]]))), collapse = "")
  colonnes <- c("territory_type", "territory_id", "density_class_code",
    "density_class_label", "TYPEQU", "LIB_TYPEQU", "n_addresses", "n_observed",
    "coverage_status", AEDAR_AGGREGATE_MEASURES, "source_snapshot_id",
    "density_reference_identity", "density_reference_sha256",
    "density_reference_vintage", "input_content_version", "input_identity")
  density$content_version <- paste(as.character(openssl::sha256(
    serialize(density[colonnes], NULL))), collapse = "")
  list(facts = density, density_reference = ref, input_hashes = hashes,
    crosswalk = ref$crosswalk,
    input_content_version = density$input_content_version[[1L]],
    content_version = density$content_version[[1L]],
    artifact_sha256 = paste(rep("c", 64), collapse = ""),
    source_snapshot_id = AEDAR_AGGREGATE_VINTAGE)
}

# An artefact-bound comparison structure. Built in memory from the aggregate
# projection and a versioned territory reference — never from a live DB read.
adaptateur_aedar_comparaison <- function(projection, with_littoral = FALSE,
                                          reference_version = "reference-v1") {
  # La référence porte exactement les identités de la projection agrégate
  # (commune / epci / departement / region), comme le producteur l'exige.
  reference <- adaptateur_aedar_reference_rows(with_littoral)
  axes <- read_aedar_typequ_registry()$TYPEQU
  littoral_facts <- if (with_littoral) {
    grouped <- data.frame(territory_id = "C", TYPEQU = axes, n_addresses = 2,
      n_observed = 1, coverage_status = "covered", stringsAsFactors = FALSE)
    for (measure in AEDAR_AGGREGATE_MEASURES) grouped[[measure]] <- 1
    grouped
  } else NULL
  x <- project_aedar_fixed_comparisons(projection$facts, reference,
    aedar_aggregate_content_version(projection), reference_version,
    density_group_facts = NULL, input_hashes = c(artefact = "aedar-fixture"),
    littoral_group_facts = littoral_facts)
  # Le contrat DB ne porte que les colonnes de grain (les jetons de version
  # vivent dans les colonnes dédiées de la table de publication).
  x$groups <- as.data.frame(x$groups[, AEDAR_COMPARISON_GROUP_COLUMNS, drop = FALSE],
    stringsAsFactors = FALSE)
  names(x$groups)[names(x$groups) == "TYPEQU"] <- "typequ"
  rownames(x$groups) <- NULL
  mesures <- unique(x$groups$measure)
 groupes_du_contexte <- function(context)
    unique(x$groups$group_id[x$groups$comparison_context == context])
  classes <- groupes_du_contexte("density_class")
  summariser <- function(ids) {
    do.call(rbind, lapply(ids, function(id) data.frame(
      group_id = id, measure = mesures[[1L]], value = NA_real_,
      status = "unavailable", n_typequ = NA_integer_, n_addresses = NA_integer_,
      n_observed = NA_integer_, coverage_status = NA_character_,
      stringsAsFactors = FALSE)))
  }
  density <- summariser(classes)
  littoral <- if (with_littoral) summariser(groupes_du_contexte("littoral")) else NULL
  x$density_rows <- density
  x$littoral_rows <- littoral
  x$density_class_summaries <- list(class_count = length(classes),
    measure_count = 1L, typequ_count = length(read_aedar_typequ_registry()$TYPEQU),
    row_count = nrow(density))
  x$littoral_summaries <- list(status_count = if (with_littoral) length(groupes_du_contexte("littoral")) else 0L,
    measure_count = if (with_littoral) 1L else 0L,
    row_count = if (with_littoral) nrow(littoral) else 0L)
  x$publication_mode <- "reference_only"
  x$source_snapshot_id <- AEDAR_AGGREGATE_VINTAGE
  x$group_row_count <- nrow(x$groups)
  x$territory_row_count <- 0L
  x
}

adaptateur_aedar_artefact <- function(root, with_littoral = FALSE) {
  projection <- adaptateur_aedar_projection()
  comparaison <- adaptateur_aedar_comparaison(projection, with_littoral)
  faits <- faits_forme(REGISTRE_FORMES_RESSOURCE[["aedar"]], projection)
  contenu <- contenu_artefact(faits, list(indicator_id = "aedar", theme_id = "mobilite"),
    projection$source, comparaison)
  ecrit <- ecrire_artefact_ressource("aedar", "aedar", contenu,
    digests_lignage = digests_lignage_ressource("aedar_bretagne",
      artefacts_fixture_digests("aedar_bretagne")), root = root)
  lire_artefact_ressource("aedar", ecrit$version, root = root)
}

adaptateur_collection_artefact <- function(root, indicator = "acv", value = 5) {
  projection <- adaptateur_collection_projection(indicator, value)
  contenu <- contenu_artefact(
    faits_forme(REGISTRE_FORMES_RESSOURCE[["observed_collection"]], projection),
    projection$descriptor, projection$provenance,
    list(reference_content_version = "reference-v1", kind = "observed_collection"))
  ecrit <- ecrire_artefact_ressource(indicator, "observed_collection", contenu,
    digests_lignage = digests_lignage_ressource("programme_source",
      artefacts_fixture_digests("programme_source")), root = root)
  lire_artefact_ressource(indicator, ecrit$version, root = root)
}
