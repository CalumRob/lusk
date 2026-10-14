# Re-derive the versioned outbound curves and aggregates from a rebuilt,
# passenger-access-aware national GTFS matrix. Research only: writes to a new
# output directory and never changes the pinned artifacts or serving database.
# Run from pipeline/:
#   Rscript scripts/derive-raccordement-national-curves.R <matrix.rds> <matrix-receipt.json> <output-dir>

if (!file.exists("DESCRIPTION") || !dir.exists("R")) {
  stop("Run this script from the pipeline/ directory.", call. = FALSE)
}
source(file.path("R", "provenance_raccordement.R"), local = TRUE)
args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 3L) {
  stop("Provide a full candidate matrix, its rebuild receipt, and a new output directory.",
       call. = FALSE)
}
matrix_path <- args[[1L]]
matrix_receipt_path <- args[[2L]]
out_dir <- args[[3L]]
if (!file.exists(matrix_path) || !file.exists(matrix_receipt_path)) {
  stop("The full candidate matrix and its receipt must both exist.", call. = FALSE)
}
if (file.exists(out_dir) || !dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)) {
  stop("Output directory must be new and creatable: ", out_dir, call. = FALSE)
}

sha256 <- function(path) {
  connection <- file(path, "rb")
  on.exit(close(connection))
  paste0(openssl::sha256(connection))
}
atomic_rds <- function(value, path) {
  temporary <- tempfile(pattern = ".candidate-", tmpdir = dirname(path), fileext = ".tmp")
  saveRDS(value, temporary, version = 3, compress = "gzip")
  if (!file.rename(temporary, path)) stop("Atomic RDS rename failed: ", path)
}
atomic_json <- function(value, path) {
  temporary <- tempfile(pattern = ".receipt-", tmpdir = dirname(path), fileext = ".tmp")
  jsonlite::write_json(value, temporary, auto_unbox = TRUE, pretty = TRUE,
                       null = "null", na = "null")
  if (!file.rename(temporary, path)) stop("Atomic JSON rename failed: ", path)
}

matrix_hash <- sha256(matrix_path)
matrix_receipt_hash <- sha256(matrix_receipt_path)
matrix_receipt <- jsonlite::read_json(matrix_receipt_path, simplifyVector = FALSE)
matrix_csv_path <- file.path(dirname(matrix_path), matrix_receipt$outputs$matrix_csv)
router_cpp_hash <- empreinte_source_raccordement(file.path("src", "gtfs_csa.cpp"))
if (!identical(matrix_receipt$schema,
      "lusk-raccordement-national-matrix-rebuild-receipt-v1") ||
    !identical(matrix_receipt$status, "complete-candidate-only-not-production") ||
    !identical(matrix_receipt$outputs$matrix_rds_sha256, matrix_hash) ||
    !file.exists(matrix_csv_path) ||
    !identical(matrix_receipt$outputs$matrix_csv_sha256, sha256(matrix_csv_path)) ||
    !identical(matrix_receipt$provenance$router_cpp_sha256, router_cpp_hash) ||
    !identical(matrix_receipt$method$transfer_radius_m, 1000L)) {
  stop("Matrix receipt does not bind this 1,000 m matrix to the current passenger-access router.",
       call. = FALSE)
}

pkgload::load_all(".", quiet = TRUE, debug = FALSE, recompile = TRUE)
matrix <- readRDS(matrix_path)
required_matrix <- c("origin_id", "destination_id", "reachable", "travel_time_min",
  "departure_min", "arrival_min", "transfers", "walking_transfers")
if (!is.data.frame(matrix) || !identical(names(matrix), required_matrix) ||
    nrow(matrix) != 798128L || anyDuplicated(matrix[c("origin_id", "destination_id")])) {
  stop("The input is not a complete 664 x 1,202 national OD matrix.", call. = FALSE)
}
envelope_path <- file.path("inst", "extdata", RACCORDEMENT_NATIONAL_ENVELOPPE_FICHIER)
if (!file.exists(envelope_path)) stop("The pinned candidate envelope is missing.", call. = FALSE)
envelope <- readRDS(envelope_path)
population <- lire_population_raccordement()
verifier_contrat_population_raccordement(population)
membership <- envelope$outputs$commune_membership
calculation <- calculer_raccordement_national(matrix, population, membership)

if (nrow(calculation$commune_curves) != 1202L * 73L ||
    nrow(calculation$aggregate_curves) != 73L * (61L + 4L + 1L + 7L) ||
    any(!calculation$aggregate_curves$assessment_complete) ||
    any(calculation$aggregate_curves$members_expected !=
          calculation$aggregate_curves$members_assessed) ||
    any(calculation$aggregate_curves$failed_members != 0L)) {
  stop("Curve or aggregate derivation failed its completeness contract.", call. = FALSE)
}

max_elapsed <- max(matrix$travel_time_min[matrix$reachable], na.rm = TRUE)
eligible <- membership$code[membership$eligible_first_boarding_origin]
if (length(eligible) != 664L || !setequal(eligible, unique(matrix$origin_id)) ||
    sum(matrix$origin_id == matrix$destination_id & matrix$reachable &
          matrix$travel_time_min == 0) != length(eligible)) {
  stop("Eligible origins or genuine saved self-results do not reconcile.", call. = FALSE)
}

population_by_code <- stats::setNames(population$population, population$code_commune)
combourg_curve <- calculation$commune_curves[
  calculation$commune_curves$code == "35085" &
    calculation$commune_curves$minute == 90L, , drop = FALSE]
combourg_outbound <- matrix[matrix$origin_id == "35085", , drop = FALSE]
combourg_numerator <- sum(population_by_code[
  combourg_outbound$destination_id[combourg_outbound$reachable &
    combourg_outbound$travel_time_min <= 90]])
journey_value <- function(origin, destination, field) {
  row <- matrix$origin_id == origin & matrix$destination_id == destination
  if (sum(row) != 1L) stop("Expected one saved OD pair: ", origin, " -> ", destination,
                            call. = FALSE)
  matrix[[field]][which(row)]
}
inbound_reference <- list(
  Rennes_to_Combourg = list(
    elapsed_min = journey_value("35238", "35085", "travel_time_min"),
    departure_min = journey_value("35238", "35085", "departure_min"),
    arrival_min = journey_value("35238", "35085", "arrival_min")),
  Saint_Malo_to_Combourg = list(
    elapsed_min = journey_value("35288", "35085", "travel_time_min"),
    departure_min = journey_value("35288", "35085", "departure_min"),
    arrival_min = journey_value("35288", "35085", "arrival_min")))

# `calculer_raccordement_national()` returns calculated series, not the
# assessment roster. Preserve that source-owned membership table from the
# pinned envelope, and keep calculation-only helper values out of the artifact.
envelope$outputs <- list(
  commune_curves = calculation$commune_curves,
  commune_scalars = calculation$commune_scalars,
  commune_membership = membership,
  aggregate_curves = calculation$aggregate_curves,
  aggregate_scalars = calculation$aggregate_scalars,
  aggregate_membership = calculation$aggregate_membership,
  regional_mean_reference = calculation$regional_mean_reference
)
envelope$method$observed_maximum_elapsed_minute <- max_elapsed
envelope$membership_counts$matrix_rows <- nrow(matrix)
envelope$membership_counts$matrix_reachable_rows <- sum(matrix$reachable)
envelope$membership_counts$matrix_unreachable_rows <- sum(!matrix$reachable)
envelope$membership_counts$raw_saved_self_zero_pairs <- sum(
  matrix$origin_id == matrix$destination_id & matrix$reachable & matrix$travel_time_min == 0)
envelope$membership_counts$matrix_maximum_elapsed_min <- max_elapsed
envelope$membership_counts$all_groups_complete <- all(
  calculation$aggregate_curves$assessment_complete)
envelope$combourg_saved_matrix_evidence$candidate_share_90 <- combourg_curve$share[[1L]]
envelope$combourg_saved_matrix_evidence$numerator_destination_population_within_90 <-
  combourg_numerator
envelope$combourg_saved_matrix_evidence$all_Breton_RP2023_denominator <-
  sum(population$population)
envelope$combourg_saved_matrix_evidence$commune_population_2023_reference_value <-
  unname(population_by_code[["35085"]])
envelope$combourg_saved_matrix_evidence$saved_OD_elapsed_min <- list(
  Combourg_35085_to_Rennes_35238 = journey_value("35085", "35238", "travel_time_min"),
  Combourg_35085_to_Saint_Malo_35288 = journey_value("35085", "35288", "travel_time_min"))
envelope$combourg_saved_matrix_evidence$inbound_reference_journeys <- inbound_reference
envelope$source_provenance$matrix_rds <- list(path = matrix_path,
                                               sha256 = matrix_hash)
envelope$source_provenance$matrix_csv <- list(path = matrix_csv_path,
                                               sha256 = sha256(matrix_csv_path))
envelope$source_provenance$matrix_validation_receipt <- list(
  path = matrix_receipt_path, sha256 = matrix_receipt_hash)
envelope$source_provenance$matrix_rebuild_runner_sha256 <-
  matrix_receipt$provenance$runner_sha256
envelope$source_provenance$router_r_sha256 <- matrix_receipt$provenance$router_r_sha256
envelope$source_provenance$router_cpp_sha256 <- router_cpp_hash
envelope$source_provenance$matrix_builder_source_sha256 <-
  matrix_receipt$provenance$matrix_builder_source_sha256
envelope$source_provenance$preparation_sha256 <-
  matrix_receipt$provenance$preparation_sha256
envelope$source_provenance$curve_calculation_source_sha256 <-
  empreinte_source_raccordement(file.path("R", "calcul_raccordement.R"))
envelope$source_provenance$curve_refresh_runner_sha256 <-
  empreinte_source_raccordement(sub("^--file=", "",
    grep("^--file=", commandArgs(), value = TRUE)[[1L]]))

curve_path <- file.path(out_dir, RACCORDEMENT_NATIONAL_ENVELOPPE_FICHIER)
atomic_rds(envelope, curve_path)
receipt <- list(
  schema = "lusk-raccordement-national-curves-refresh-receipt-v1",
  status = "complete-candidate-only-not-production",
  matrix_sha256 = matrix_hash,
  matrix_receipt_sha256 = matrix_receipt_hash,
  router_cpp_sha256 = router_cpp_hash,
  curve_calculation_source_sha256 =
    empreinte_source_raccordement(file.path("R", "calcul_raccordement.R")),
  membership_source = "pinned candidate membership facts; no missing member dropped",
  coverage = list(communes = nrow(population), commune_curve_rows = nrow(calculation$commune_curves),
    eligible_origins = length(eligible), matrix_rows = nrow(matrix),
    reachable_rows = sum(matrix$reachable), unreachable_rows = sum(!matrix$reachable),
    aggregate_curve_rows = nrow(calculation$aggregate_curves),
    denominator_population = sum(population$population),
    maximum_elapsed_min = max_elapsed),
  combourg = list(outbound_share_90 = combourg_curve$share[[1L]],
    Rennes_to_Combourg_elapsed_min = inbound_reference$Rennes_to_Combourg$elapsed_min,
    Saint_Malo_to_Combourg_elapsed_min = inbound_reference$Saint_Malo_to_Combourg$elapsed_min),
  output = list(envelope = basename(curve_path), envelope_sha256 = sha256(curve_path)),
  limitation = "Candidate derivation only; no canonical pin, serving table, migration, or production action."
)
atomic_json(receipt, file.path(out_dir, "receipt.json"))
cat("receipt=", normalizePath(file.path(out_dir, "receipt.json"), winslash = "/"), "\n", sep = "")
