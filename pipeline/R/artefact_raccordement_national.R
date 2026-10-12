# Versioned national GTFS raccordement artifact (#728). The former mairie
# artifact remains a separate, historical product and is never re-labelled.
RACCORDEMENT_NATIONAL_ENVELOPPE_FICHIER <- "raccordement_national_outbound_v1.rds"
RACCORDEMENT_NATIONAL_MATRICE_FICHIER <- "raccordement_national_matrix_20261021.rds"
RACCORDEMENT_NATIONAL_ENVELOPPE_SHA256 <- "260d7e096c5fcad534edc863fe7d3ec9cb6b2b51d868f4363aed1e98981079b6"
MATRICE_RACCORDEMENT_NATIONAL_SHA256 <- "ae3c7e37bc788010968855d949e875f45481c7e05f80a98718f980a8841a4df5"
RECETTE_RACCORDEMENT_NATIONAL <- list(
  id = "national-gtfs-outbound-v1",
  date_mesure = "2026-10-21",
  fenetre_depart = "07:00",
  fenetre_fin_exclusive = "20:00",
  calendrier = "holiday-Wednesday",
  objectif = "fastest-elapsed-scheduled-journey",
  premiere_montee = "pickup_allowed",
  arrivee = "drop_off_allowed",
  transfert_approximation = "1 km at 3 km/h",
  type_2_minimum = "max(walk, GTFS minimum)",
  duree_maximale_journee_min = NULL,
  cap_duree_trajet_min = NULL,
  grille_publication_min = seq.int(0L, 360L, by = 5L),
  seuil_scalar_min = 90L,
  population_vintage = "RP 2023",
  regional_reference_id = "bretagne_all_assessed_communes_mean",
  regional_reference_name = "Bretagne",
  denominator_population = 3449370L,
  matrix_rows = 798128L,
  matrix_reachable_rows = 431327L,
  eligible_origin_count = 664L,
  assessed_commune_count = 1202L,
  matrix_max_elapsed_min = 693L
)
grille_raccordement_national <- function() {
  paste0("t", sprintf("%04d", RECETTE_RACCORDEMENT_NATIONAL$grille_publication_min))
}

chemin_artefact_raccordement_national <- function() {
  path <- system.file("extdata", RACCORDEMENT_NATIONAL_ENVELOPPE_FICHIER,
                      package = "lusk")
  if (!nzchar(path)) stop("National raccordement envelope pin is missing from package extdata.", call. = FALSE)
  path
}
chemin_matrice_raccordement_national <- function() {
  path <- system.file("extdata", RACCORDEMENT_NATIONAL_MATRICE_FICHIER,
                      package = "lusk")
  if (!nzchar(path)) stop("National raccordement matrix pin is missing from package extdata.", call. = FALSE)
  path
}

verifier_contrat_artefact_raccordement_national <- function(
    artefact, chemin_enveloppe = NULL, chemin_matrice = NULL,
    verifier_octets = TRUE) {
  fail <- function(rule, detail) stop(sprintf(
    "National raccordement artifact contract failed — %s: %s.", rule, detail),
    call. = FALSE)
  if (!is.list(artefact) || !identical(artefact$schema,
      "lusk-national-outbound-zero-inclusive-raccordement-candidate-v1") ||
      !identical(artefact$status, "research-candidate-only-not-canonical")) {
    fail("schema", "unrecognized versioned outbound candidate envelope")
  }
  if (is.null(chemin_enveloppe)) chemin_enveloppe <- chemin_artefact_raccordement_national()
  if (is.null(chemin_matrice)) chemin_matrice <- chemin_matrice_raccordement_national()
  if (!file.exists(chemin_enveloppe) || !file.exists(chemin_matrice)) {
    fail("pinned files", "envelope and full directed national matrix must both exist")
  }
  if (isTRUE(verifier_octets)) {
    envelope_hash <- empreinte_fichier_raccordement(chemin_enveloppe)
    matrix_hash <- empreinte_fichier_raccordement(chemin_matrice)
    if (!identical(envelope_hash, RACCORDEMENT_NATIONAL_ENVELOPPE_SHA256))
      fail("envelope sha256", "on-disk bytes differ from the canonical v1 pin")
    if (!identical(matrix_hash, MATRICE_RACCORDEMENT_NATIONAL_SHA256))
      fail("matrix sha256", "on-disk bytes differ from the canonical dated national matrix pin")
  }
  matrix <- artefact$matrix
  membership <- artefact$membership
  if (!is.data.frame(matrix) || !identical(names(matrix), c(
      "origin_id", "destination_id", "reachable", "travel_time_min",
      "departure_min", "arrival_min", "transfers", "walking_transfers")))
    fail("matrix schema", "the directed OD result columns/types are required")
  if (!is.character(matrix$origin_id) || !is.character(matrix$destination_id) ||
      !is.logical(matrix$reachable) || !is.numeric(matrix$travel_time_min) ||
      !is.numeric(matrix$departure_min) || !is.numeric(matrix$arrival_min) ||
      !is.integer(matrix$transfers) || !is.integer(matrix$walking_transfers))
    fail("matrix types", "codes, reachability, elapsed/scheduled values, and transfer counts have incorrect types")
  if (nrow(matrix) != RECETTE_RACCORDEMENT_NATIONAL$matrix_rows ||
      anyNA(matrix$origin_id) || anyNA(matrix$destination_id) || anyNA(matrix$reachable) ||
      anyDuplicated(matrix[c("origin_id", "destination_id")]))
    fail("matrix coverage", "row count, identities, reachability flags, or OD uniqueness are invalid")
  if (any(!is.finite(matrix$travel_time_min[matrix$reachable])) ||
      any(matrix$travel_time_min[matrix$reachable] < 0) ||
      any(!is.na(matrix$travel_time_min[!matrix$reachable])))
    fail("matrix journey values", "reachable elapsed times must be finite; unreachable times must remain NA")
  if (any(is.finite(matrix$departure_min[matrix$reachable]) &
          (matrix$departure_min[matrix$reachable] < 0 | matrix$departure_min[matrix$reachable] >= 1440)) ||
      any(is.finite(matrix$arrival_min[matrix$reachable]) &
          (matrix$arrival_min[matrix$reachable] < 0 | matrix$arrival_min[matrix$reachable] >= 1440)) ||
      any(!is.na(matrix$transfers[matrix$reachable]) & matrix$transfers[matrix$reachable] < 0) ||
      any(!is.na(matrix$walking_transfers[matrix$reachable]) & matrix$walking_transfers[matrix$reachable] < 0))
    fail("matrix schedule fields", "saved schedule/transfer fields contain out-of-domain values")
  if (!is.data.frame(membership) || !all(c("code", "population_2023", "endpoint_stop_count",
      "eligible_first_boarding_origin", "structural_zero_reason", "epci_code",
      "department_code", "region_code", "density_class_code", "assessed",
      "calculation_status") %in% names(membership)))
    fail("assessment facts", "the canonical assessed-membership and structural-zero facts are incomplete")
  codes <- as.character(membership$code)
  eligible <- codes[membership$eligible_first_boarding_origin]
  zeros <- !membership$eligible_first_boarding_origin
  if (nrow(membership) != RECETTE_RACCORDEMENT_NATIONAL$assessed_commune_count ||
      anyNA(codes) || anyDuplicated(codes) || !all(grepl("^[0-9]{5}$", codes)) ||
      any(!membership$assessed) || any(membership$calculation_status != "complete") ||
      anyNA(membership$population_2023) || any(!is.finite(membership$population_2023)) ||
      any(membership$population_2023 < 0) ||
      sum(membership$population_2023) != RECETTE_RACCORDEMENT_NATIONAL$denominator_population)
    fail("assessed commune universe", "codes, required facts, or full RP 2023 population denominator are incomplete")
  if (length(eligible) != RECETTE_RACCORDEMENT_NATIONAL$eligible_origin_count ||
      anyNA(membership$eligible_first_boarding_origin) ||
      any(!membership$structural_zero_reason[zeros] %in% c(
        "no_modeled_endpoint_stops", "endpoint_stops_but_no_permitted_first_boarding")) ||
      any(!is.na(membership$structural_zero_reason[!zeros])) ||
      any(membership$endpoint_stop_count[zeros & membership$structural_zero_reason == "no_modeled_endpoint_stops"] != 0L) ||
      any(membership$endpoint_stop_count[zeros & membership$structural_zero_reason == "endpoint_stops_but_no_permitted_first_boarding"] <= 0L))
    fail("structural zero classification", "eligible and source-proven zero reasons do not reconcile")
  matrix_origins <- sort(unique(matrix$origin_id))
  matrix_destinations <- sort(unique(matrix$destination_id))
  if (!setequal(matrix_origins, eligible) || !setequal(matrix_destinations, codes))
    fail("matrix eligibility", "matrix origins must exactly equal completed eligible searches and destinations the assessed universe")
  counts <- table(matrix$origin_id)
  if (length(counts) != length(eligible) || any(counts != length(codes)))
    fail("complete origin searches", "every eligible search must contain one result per assessed destination")
  if (sum(matrix$reachable) != RECETTE_RACCORDEMENT_NATIONAL$matrix_reachable_rows ||
      max(matrix$travel_time_min[matrix$reachable]) != RECETTE_RACCORDEMENT_NATIONAL$matrix_max_elapsed_min)
    fail("uncapped matrix", "saved reachable count or actual maximum elapsed journey changed")
  zero_origin <- matrix$origin_id == matrix$destination_id
  self_rows <- matrix[zero_origin, , drop = FALSE]
  if (nrow(self_rows) != length(eligible) || any(!self_rows$reachable) ||
      any(self_rows$travel_time_min != 0))
    fail("saved self-result evidence", "eligible-origin self-zero results must be genuine rows in the byte-pinned router matrix")
  if (!identical(artefact$method$direction,
      "outbound: from eligible commune origin stops to reachable destination commune stop sets") ||
      !identical(as.integer(unlist(artefact$method$grid_minutes)), RECETTE_RACCORDEMENT_NATIONAL$grille_publication_min) ||
      !identical(as.integer(artefact$method$scalar_minute), 90L) ||
      !is.null(artefact$method$journey_duration_ceiling) ||
      !identical(as.numeric(artefact$method$observed_maximum_elapsed_minute), 693))
    fail("recipe", "versioned direction, 73-point publication grid, scalar, or uncapped journey semantics differ")
  invisible(TRUE)
}

lire_artefact_raccordement_national <- function(
    chemin_enveloppe = NULL, chemin_matrice = NULL) {
  if (is.null(chemin_enveloppe)) chemin_enveloppe <- chemin_artefact_raccordement_national()
  if (is.null(chemin_matrice)) chemin_matrice <- chemin_matrice_raccordement_national()
  if (!file.exists(chemin_enveloppe) || !file.exists(chemin_matrice))
    stop("National raccordement envelope or pinned matrix is missing.", call. = FALSE)
  envelope <- readRDS(chemin_enveloppe)
  matrix <- readRDS(chemin_matrice)
  artifact <- list(schema = envelope$schema, status = envelope$status,
    metadata = envelope, method = envelope$method,
    matrix = matrix, matrix_sha256 = empreinte_fichier_raccordement(chemin_matrice),
    envelope_sha256 = empreinte_fichier_raccordement(chemin_enveloppe),
    membership = envelope$outputs$commune_membership,
    candidate_outputs = envelope$outputs)
  verifier_contrat_artefact_raccordement_national(artifact, chemin_enveloppe,
    chemin_matrice, verifier_octets = TRUE)
  population <- lire_population_raccordement()
  verifier_contrat_population_raccordement(population)
  calculated <- calculer_raccordement_national(matrix, population, artifact$membership)
  compare <- c("commune_curves", "commune_scalars", "aggregate_curves",
    "aggregate_scalars", "aggregate_membership", "regional_mean_reference")
  for (name in compare) {
    expected <- envelope$outputs[[name]]
    actual <- calculated[[name]]
    if (!is.data.frame(expected) || !is.data.frame(actual) ||
        !isTRUE(all.equal(expected, actual, tolerance = 1e-12,
                          check.attributes = FALSE)))
      stop("National raccordement candidate parity failed for ", name,
           "; pinned matrix, population, and assessed-member calculations disagree.",
           call. = FALSE)
  }
  artifact$population <- population
  artifact$calculation <- calculated
  artifact
}
