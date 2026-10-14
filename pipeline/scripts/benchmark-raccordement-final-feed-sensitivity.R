# Compare transfer radii using the validated final-feed national preparation.
# Run from pipeline/: Rscript scripts/benchmark-raccordement-final-feed-sensitivity.R [output-dir]
# Every radius routes the seven saved pilot origins to all 1,202 commune destinations.
# The 1,000 m pass must reproduce the corresponding full-candidate rows exactly.

if (!file.exists("DESCRIPTION") || !dir.exists("R")) {
  stop("Run this script from the pipeline/ directory.", call. = FALSE)
}
source(file.path("R", "provenance_raccordement.R"), local = TRUE)
args <- commandArgs(trailingOnly = TRUE)
if (length(args) > 2L) stop("Provide an output directory and optional full-candidate matrix.", call. = FALSE)
run_stamp <- format(Sys.time(), tz = "UTC", format = "%Y%m%dT%H%M%SZ")
out_dir <- if (length(args)) args[[1]] else file.path(
  "data", "processed", "raccordement-experiments",
  paste0("final-feed-transfer-sensitivity-", run_stamp)
)
if (file.exists(out_dir)) {
  stop("Output directory already exists; refusing to reuse or overwrite it: ", out_dir,
       call. = FALSE)
}
if (!dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)) {
  stop("Could not create output directory: ", out_dir, call. = FALSE)
}
started_utc <- format(Sys.time(), tz = "UTC", usetz = TRUE)

sha256 <- function(path) {
  connection <- file(path, "rb")
  on.exit(close(connection))
  paste0(openssl::sha256(connection))
}
hash_paths <- function(paths) {
  stats::setNames(vapply(paths, sha256, character(1)), names(paths))
}
atomic_json <- function(value, path) {
  temporary <- tempfile(pattern = ".receipt-", tmpdir = dirname(path), fileext = ".tmp")
  jsonlite::write_json(value, temporary, auto_unbox = TRUE, pretty = TRUE,
                       null = "null", na = "null")
  if (!file.rename(temporary, path)) stop("Atomic JSON rename failed: ", path)
}
atomic_rds <- function(value, path) {
  temporary <- tempfile(pattern = ".sensitivity-", tmpdir = dirname(path), fileext = ".tmp")
  saveRDS(value, temporary, version = 3, compress = "gzip")
  if (!file.rename(temporary, path)) stop("Atomic RDS rename failed: ", path)
}
atomic_csv <- function(value, path) {
  temporary <- tempfile(pattern = ".sensitivity-", tmpdir = dirname(path), fileext = ".tmp")
  utils::write.csv(value, temporary, row.names = FALSE, na = "")
  if (!file.rename(temporary, path)) stop("Atomic CSV rename failed: ", path)
}

preparation_path <- file.path(
  "data", "processed", "raccordement-experiments",
  "paired-sncf-bretagne-20261021-20261010T141259Z", "attempt-20261010T150000Z",
  "national", "cache-803ed24c76dd0bc20da5f2a314b32488b8b5c968fc49d3a5b830fcdb0bb19d6a",
  "preparation.rds"
)
fresh_inputs <- c(
  korrigo = "data/raw/korrigo-gtfs-pan-81559-20261010T121811.zip",
  sncf = "data/raw/sncf-national-candidate-20261010T132853Z.zip",
  geometry = "../public/data/communes.geojson"
)
expected_fresh_hashes <- c(
  korrigo = "4d9ac5a1a7c3f662b6b684c7838f76eae2aa32a2272dd69438e1c2cb4a6aa669",
  sncf = "d3dd8e5d0f39306e589119e95cf3f0d8615aa2cbda826d6de7f2a881db6aecb0",
  geometry = "ab92ea56410a6fde88de1004f79aafa6e2c0d1ab2185de588d8e1f60b267a609"
)
expected_preparation_hash <- "d454f5c15734096f170ff2fd5dec1df4e01eadafd8f3d954adba0f5ea046f1b0"
expected_method_hash <- "7da0dfd926f0f49b38808723194d89d7c28d2781e71b422fdfd2331e1d6f3f75"
expected_r_hash <- "6e798870776f8718edba5686cb67825a4150917f9e31583e3637bc47090841f2"
expected_preparation_cpp_hash <- "9cc302a12103b9c8b5e1336ee6990268eabd9a3a9765cf0386d65eb4294ec310"
expected_cpp_hash <- "f36f09ebedb4d92898ecd2b6ca7b6c4dcdf207b497591e644e6434787732c876"
expected_cache_key <- "803ed24c76dd0bc20da5f2a314b32488b8b5c968fc49d3a5b830fcdb0bb19d6a"
reference_matrix_path <- if (length(args) >= 2L) args[[2L]] else
  file.path("inst", "extdata", "raccordement_national_matrix_20261021.rds")
reference_receipt_path <- if (length(args) >= 2L) file.path(dirname(reference_matrix_path), "receipt.json") else
  file.path("inst", "extdata", "raccordement_national_matrix_rebuild_receipt_20261021.json")

if (!file.exists(preparation_path) || any(!file.exists(fresh_inputs)) ||
    !file.exists(reference_matrix_path) || !file.exists(reference_receipt_path)) {
  stop("A validated preparation, final input archive/geometry, or reference matrix is missing.",
       call. = FALSE)
}
inputs_before <- hash_paths(fresh_inputs)
preparation_hash_before <- sha256(preparation_path)
if (!identical(unname(inputs_before), unname(expected_fresh_hashes)) ||
    !identical(preparation_hash_before, expected_preparation_hash)) {
  stop("Final-feed/preparation/reference matrix SHA-256 mismatch.", call. = FALSE)
}
source_helper_hash <- empreinte_source_raccordement(file.path("R", "provenance_raccordement.R"))
router_r_hash <- empreinte_source_raccordement(file.path("R", "services_gtfs.R"))
router_cpp_hash <- empreinte_source_raccordement(file.path("src", "gtfs_csa.cpp"))
matrix_builder_source_hash <- empreinte_source_raccordement(file.path("R", "matrice_trajets_gtfs.R"))
if (!identical(router_r_hash, expected_r_hash) ||
    !identical(router_cpp_hash, expected_cpp_hash)) {
  stop("Router sources differ from the passenger-access-aware candidate recipe.", call. = FALSE)
}
reference_receipt <- jsonlite::read_json(reference_receipt_path, simplifyVector = FALSE)
reference_matrix_hash <- sha256(reference_matrix_path)
if (!identical(reference_receipt$schema,
      "lusk-raccordement-national-matrix-rebuild-receipt-v1") ||
    !identical(reference_receipt$status, "complete-candidate-only-not-production") ||
    !identical(reference_receipt$outputs$matrix_rds_sha256, reference_matrix_hash) ||
    !identical(reference_receipt$provenance$router_cpp_sha256, router_cpp_hash)) {
  stop("Reference matrix receipt does not prove a full candidate built with the current router.",
       call. = FALSE)
}
preparation <- readRDS(preparation_path)
if (!identical(preparation$metadata$cache_key, expected_cache_key) ||
    !identical(preparation$metadata$method_schema_sha256, expected_method_hash) ||
    !identical(preparation$metadata$access_builder_r_sha256, expected_r_hash) ||
    !identical(preparation$metadata$router_cpp_sha256, expected_preparation_cpp_hash) ||
    !identical(unname(preparation$metadata$source$feed_sha256),
               unname(expected_fresh_hashes)) ||
    !identical(as.integer(preparation$metadata$transfers$radius_m), 1000L) ||
    !identical(as.numeric(preparation$metadata$transfers$walking_speed_kmh), 3)) {
  stop("Preparation metadata does not establish the final-feed 1,000 m baseline.",
       call. = FALSE)
}
if (length(preparation$origin_stop_sets) != 7L ||
    length(preparation$stop_sets) != 1202L ||
    any(!names(preparation$origin_stop_sets) %in% preparation$eligible_origin_ids)) {
  stop("Saved seven-origin pilot or national destination coverage is invalid.",
       call. = FALSE)
}

build_started <- proc.time()[["elapsed"]]
pkgload::load_all(".", quiet = TRUE, debug = FALSE, recompile = TRUE)
build_seconds <- unname(proc.time()[["elapsed"]] - build_started)
if (!exists("construire_matrice_trajets_gtfs", mode = "function")) {
  stop("Matrix builder was not loaded.", call. = FALSE)
}

origin_ids <- names(preparation$origin_stop_sets)
origins <- preparation$origin_stop_sets[origin_ids]
destinations <- preparation$stop_sets
pilot_reference <- readRDS(reference_matrix_path)
pilot_reference <- pilot_reference[pilot_reference$origin_id %in% origin_ids, , drop = FALSE]
fields <- c("origin_id", "destination_id", "reachable", "travel_time_min",
            "departure_min", "arrival_min", "transfers", "walking_transfers")
if (nrow(pilot_reference) != 7L * 1202L) {
  stop("Checked-in national matrix does not contain all seven sensitivity origins.",
       call. = FALSE)
}

radii <- c(500L, 1000L, 2000L)
journey_runs <- vector("list", length(radii))
graph_counts <- integer(length(radii))
elapsed_seconds <- numeric(length(radii))
for (i in seq_along(radii)) {
  radius <- radii[[i]]
  started <- proc.time()[["elapsed"]]
  transfers <- if (radius == 1000L) preparation$transfers else {
    aretes_transfert_gtfs(preparation$stops, preparation$rules_resolved,
                          rayon_m = radius, vitesse_marche_kmh = 3)
  }
  graph_counts[[i]] <- nrow(transfers)
  if (radius == 1000L && graph_counts[[i]] != 366468L) {
    stop("Prepared 1,000 m final-feed transfer graph has an unexpected edge count.",
         call. = FALSE)
  }
  cat("Running final-feed sensitivity radius ", radius, " m for ", length(origins),
      " origins × ", length(destinations), " destinations\n", sep = "")
  journey_runs[[i]] <- construire_matrice_trajets_gtfs(
    preparation$rides, transfers, origins, destinations,
    "07:00", "20:00", preparation$rules_resolved,
    ids_stops = preparation$stops$stop_id
  )
  journey_runs[[i]]$transfer_radius_m <- radius
  elapsed_seconds[[i]] <- unname(proc.time()[["elapsed"]] - started)
  if (nrow(journey_runs[[i]]) != length(origins) * length(destinations)) {
    stop("Sensitivity matrix has incomplete OD coverage at radius ", radius, ".",
         call. = FALSE)
  }
}

baseline <- journey_runs[[which(radii == 1000L)]]
ordered_baseline <- baseline[order(baseline$origin_id, baseline$destination_id), fields]
ordered_reference <- pilot_reference[order(pilot_reference$origin_id,
                                            pilot_reference$destination_id), fields]
baseline_parity <- isTRUE(all.equal(ordered_baseline, ordered_reference,
                                    check.attributes = FALSE))
if (!baseline_parity) {
  atomic_rds(journey_runs, file.path(out_dir, "baseline-parity-failure.rds"))
  stop("The final-feed 1,000 m sensitivity pass differs from the national candidate.",
       call. = FALSE)
}

baseline_keys <- paste(baseline$origin_id, baseline$destination_id, sep = "\r")
baseline <- baseline[match(baseline_keys, paste(baseline$origin_id,
                                                baseline$destination_id, sep = "\r")), ]
summary_rows <- lapply(seq_along(radii), function(i) {
  current <- journey_runs[[i]]
  current <- current[match(baseline_keys, paste(current$origin_id,
                                                 current$destination_id, sep = "\r")), ]
  if (anyNA(match(baseline_keys, paste(current$origin_id, current$destination_id, sep = "\r")))) {
    stop("Sensitivity OD keys do not align to the 1,000 m baseline.", call. = FALSE)
  }
  reachability_changed <- current$reachable != baseline$reachable
  same_reachable <- current$reachable & baseline$reachable
  time_changed <- same_reachable &
    abs(current$travel_time_min - baseline$travel_time_min) > 1e-8
  data.frame(
    transfer_radius_m = radii[[i]], transfer_edges = graph_counts[[i]],
    OD_rows = nrow(current), reachable_rows = sum(current$reachable),
    unreachable_rows = sum(!current$reachable),
    changed_reachability_vs_1000m = sum(reachability_changed),
    changed_elapsed_time_vs_1000m = sum(time_changed),
    mean_reachable_elapsed_min = mean(current$travel_time_min[current$reachable]),
    median_reachable_elapsed_min = stats::median(current$travel_time_min[current$reachable]),
    search_and_graph_seconds = elapsed_seconds[[i]],
    stringsAsFactors = FALSE
  )
})
summary <- do.call(rbind, summary_rows)
all_journeys <- do.call(rbind, journey_runs)
rownames(all_journeys) <- NULL
journeys_rds_path <- file.path(out_dir, "journeys.rds")
journeys_csv_path <- file.path(out_dir, "journeys.csv")
summary_csv_path <- file.path(out_dir, "summary.csv")
atomic_rds(all_journeys, journeys_rds_path)
atomic_csv(all_journeys, journeys_csv_path)
atomic_csv(summary, summary_csv_path)

inputs_after <- hash_paths(fresh_inputs)
if (!identical(inputs_before, inputs_after) ||
    !identical(preparation_hash_before, sha256(preparation_path)) ||
    !identical(reference_matrix_hash, sha256(reference_matrix_path)) ||
    !identical(source_helper_hash, empreinte_source_raccordement(file.path("R", "provenance_raccordement.R"))) ||
    !identical(router_r_hash, empreinte_source_raccordement(file.path("R", "services_gtfs.R"))) ||
    !identical(router_cpp_hash, empreinte_source_raccordement(file.path("src", "gtfs_csa.cpp"))) ||
    !identical(matrix_builder_source_hash,
               empreinte_source_raccordement(file.path("R", "matrice_trajets_gtfs.R")))) {
  stop("An input, preparation, or router source changed during sensitivity routing.",
       call. = FALSE)
}
runner_path <- sub("^--file=", "", grep("^--file=", commandArgs(), value = TRUE)[[1]])
completed_utc <- format(Sys.time(), tz = "UTC", usetz = TRUE)
receipt <- list(
  schema = "lusk-raccordement-final-feed-transfer-sensitivity-v1",
  status = "complete-candidate-only-not-production",
  service_date = "2026-10-21",
  design = list(
    fresh_final_feed_preparation = preparation_path,
    origins = origin_ids, origin_count = length(origin_ids),
    destinations_per_origin = length(destinations),
    total_OD_rows_per_radius = length(origin_ids) * length(destinations),
    radii_m = as.list(radii), walking_speed_kmh = 3,
    explicit_gtfs_transfer_rules = "retained at each radius, including explicit edges beyond radius",
    comparison_reference = "full current-router candidate matrix, same seven origins, all public journey fields"
  ),
  provenance = list(
    final_input_sha256 = as.list(inputs_before),
    feed_versions = as.list(preparation$metadata$source$feed_versions),
    preparation_sha256 = preparation_hash_before,
    cache_key = expected_cache_key,
    method_schema_sha256 = expected_method_hash,
    provenance_helper_sha256 = source_helper_hash,
    preparation_router_cpp_sha256 = expected_preparation_cpp_hash,
    router_r_sha256 = router_r_hash,
    router_cpp_sha256 = router_cpp_hash,
    matrix_builder_source_sha256 = matrix_builder_source_hash,
    runner_sha256 = empreinte_source_raccordement(runner_path),
    passenger_access = list(
      pickup_restricted_ride_edges = sum(!preparation$rides$pickup_allowed),
      dropoff_restricted_ride_edges = sum(!preparation$rides$drop_off_allowed),
      any_restricted_ride_edges = sum(!preparation$rides$pickup_allowed |
                                       !preparation$rides$drop_off_allowed)
    ),
    reference_matrix_sha256 = reference_matrix_hash
  ),
  radius_results = lapply(seq_len(nrow(summary)), function(i) as.list(summary[i, ])),
  baseline_parity = list(
    radius_m = 1000L, OD_rows = nrow(ordered_baseline),
    all_public_journey_fields_equal = baseline_parity, fields = fields
  ),
  execution = list(
    started_utc = started_utc,
    completed_utc = completed_utc,
    release_build = TRUE, forced_recompile = TRUE, build_seconds = build_seconds,
    R_version = R.version.string, platform = R.version$platform
  ),
  outputs = list(
    journeys_rds = basename(journeys_rds_path),
    journeys_rds_sha256 = sha256(journeys_rds_path),
    journeys_csv = basename(journeys_csv_path),
    journeys_csv_sha256 = sha256(journeys_csv_path),
    summary_csv = basename(summary_csv_path),
    summary_csv_sha256 = sha256(summary_csv_path)
  ),
  limitation = paste(
    "Sensitivity is a seven-origin national pilot across all destinations, not a",
    "full 664-origin comparison; 1,000 m is the reviewed candidate setting,",
    "not independent production-policy approval."
  )
)
atomic_json(receipt, file.path(out_dir, "receipt.json"))
cat("receipt=", normalizePath(file.path(out_dir, "receipt.json"), winslash = "/"),
    "\n", sep = "")
