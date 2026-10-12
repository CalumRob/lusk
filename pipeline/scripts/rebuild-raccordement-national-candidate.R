# Rebuild the full #728 national candidate from the validated final-feed preparation.
# Run from pipeline/: Rscript scripts/rebuild-raccordement-national-candidate.R [output-dir]
# Provenance-only guard: Rscript scripts/rebuild-raccordement-national-candidate.R --preflight
# This is research-only. It never changes canonical pins, serving data, or public outputs.

if (!file.exists("DESCRIPTION") || !dir.exists("R")) {
  stop("Run this script from the pipeline/ directory.", call. = FALSE)
}
source(file.path("R", "provenance_raccordement.R"), local = TRUE)
args <- commandArgs(trailingOnly = TRUE)
preflight_only <- identical(args, "--preflight")
if (!preflight_only && length(args) > 1L) stop("Provide at most one output directory.", call. = FALSE)

run_stamp <- format(Sys.time(), tz = "UTC", format = "%Y%m%dT%H%M%SZ")
if (!preflight_only) {
  out_dir <- if (length(args)) args[[1]] else file.path(
    "data", "processed", "raccordement-experiments",
    paste0("national-matrix-rebuild-", run_stamp)
  )
  if (file.exists(out_dir)) {
    stop("Output directory already exists; refusing to reuse or overwrite it: ", out_dir,
         call. = FALSE)
  }
  if (!dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)) {
    stop("Could not create output directory: ", out_dir, call. = FALSE)
  }
}

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
  temporary <- tempfile(pattern = ".matrix-", tmpdir = dirname(path), fileext = ".tmp")
  saveRDS(value, temporary, version = 3, compress = "gzip")
  if (!file.rename(temporary, path)) stop("Atomic RDS rename failed: ", path)
}
atomic_csv <- function(value, path) {
  temporary <- tempfile(pattern = ".matrix-", tmpdir = dirname(path), fileext = ".tmp")
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
# The preparation tables were materialized with the historical router below.
# The current compiled router is used after preparation and enforces the saved
# pickup/drop-off flags before boarding or alighting.
expected_preparation_cpp_hash <- "9cc302a12103b9c8b5e1336ee6990268eabd9a3a9765cf0386d65eb4294ec310"
expected_cpp_hash <- "f36f09ebedb4d92898ecd2b6ca7b6c4dcdf207b497591e644e6434787732c876"
expected_cache_key <- "803ed24c76dd0bc20da5f2a314b32488b8b5c968fc49d3a5b830fcdb0bb19d6a"
expected_matrix_hash <- "ae3c7e37bc788010968855d949e875f45481c7e05f80a98718f980a8841a4df5"
reference_matrix_path <- file.path("inst", "extdata", "raccordement_national_matrix_20261021.rds")

if (!file.exists(preparation_path) || any(!file.exists(fresh_inputs)) ||
    !file.exists(reference_matrix_path)) {
  stop("A validated preparation, final input archive/geometry, or reference matrix is missing.",
       call. = FALSE)
}
inputs_before <- hash_paths(fresh_inputs)
if (!identical(unname(inputs_before), unname(expected_fresh_hashes))) {
  stop("Final-feed/geometry SHA-256 mismatch; no routing started.", call. = FALSE)
}
preparation_hash_before <- sha256(preparation_path)
if (!identical(preparation_hash_before, expected_preparation_hash) ||
    !identical(sha256(reference_matrix_path), expected_matrix_hash)) {
  stop("Preparation or checked-in candidate matrix SHA-256 mismatch.", call. = FALSE)
}
router_r_hash <- empreinte_source_raccordement(file.path("R", "services_gtfs.R"))
router_cpp_hash <- empreinte_source_raccordement(file.path("src", "gtfs_csa.cpp"))
builder_source_hash <- empreinte_source_raccordement(file.path("R", "matrice_trajets_gtfs.R"))
source_helper_hash <- empreinte_source_raccordement(file.path("R", "provenance_raccordement.R"))
expected_builder_hash <- "7454aede9e2fdda93a011fc475fe25b9020cc152a9a78e57476fa1a9a5e22bab"
if (!identical(router_r_hash, expected_r_hash) ||
    !identical(builder_source_hash, expected_builder_hash) ||
    !identical(router_cpp_hash, expected_cpp_hash)) {
  stop("Router sources differ from the validated final-feed preparation.", call. = FALSE)
}

preparation <- readRDS(preparation_path)
if (!identical(preparation$metadata$schema, "lusk-gtfs-csa-paired-pilot-v1") ||
    !identical(preparation$metadata$cache_key, expected_cache_key) ||
    !identical(preparation$metadata$method_schema_sha256, expected_method_hash) ||
    !identical(preparation$metadata$access_builder_r_sha256, expected_r_hash) ||
    !identical(preparation$metadata$router_cpp_sha256, expected_preparation_cpp_hash) ||
    !identical(unname(preparation$metadata$source$feed_sha256),
               unname(expected_fresh_hashes))) {
  stop("Preparation provenance does not match the final-feed candidate.", call. = FALSE)
}
if (nrow(preparation$rides) != 429816L || nrow(preparation$transfers) != 366468L ||
    nrow(preparation$rules_resolved) != 25234L || nrow(preparation$stops) != 38948L ||
    length(preparation$eligible_origin_ids) != 664L || length(preparation$stop_sets) != 1202L ||
    anyDuplicated(preparation$eligible_origin_ids) ||
    !all(preparation$eligible_origin_ids %in% names(preparation$stop_sets))) {
  stop("Validated national preparation shape differs from the reviewed contract.",
       call. = FALSE)
}
if (!is.logical(preparation$rides$pickup_allowed) ||
    !is.logical(preparation$rides$drop_off_allowed) ||
    anyNA(preparation$rides$pickup_allowed) || anyNA(preparation$rides$drop_off_allowed)) {
  stop("Prepared passenger-access flags are not logical, known values.", call. = FALSE)
}
if (preflight_only) {
  cat("preflight=ok\n",
      "preparation_sha256=", preparation_hash_before, "\n",
      "router_cpp_sha256=", router_cpp_hash, "\n",
      "pickup_restricted_ride_edges=", sum(!preparation$rides$pickup_allowed), "\n",
      "dropoff_restricted_ride_edges=", sum(!preparation$rides$drop_off_allowed), "\n",
      "any_restricted_ride_edges=", sum(!preparation$rides$pickup_allowed |
                                        !preparation$rides$drop_off_allowed), "\n", sep = "")
  quit(save = "no", status = 0L)
}

build_started <- proc.time()[["elapsed"]]
pkgload::load_all(".", quiet = TRUE, debug = FALSE, recompile = TRUE)
build_seconds <- unname(proc.time()[["elapsed"]] - build_started)
if (!exists("construire_matrice_trajets_gtfs", mode = "function")) {
  stop("Matrix builder was not loaded.", call. = FALSE)
}

origin_ids <- as.character(preparation$eligible_origin_ids)
destinations <- preparation$stop_sets
if (length(destinations) != 1202L || is.null(names(destinations)) ||
    anyNA(names(destinations)) || any(!nzchar(names(destinations))) ||
    anyDuplicated(names(destinations))) {
  stop("The national destination stop-set contract is invalid.", call. = FALSE)
}
origin_sets <- preparation$stop_sets[origin_ids]
if (length(origin_sets) != 664L || !identical(names(origin_sets), origin_ids)) {
  stop("Could not derive all eligible origins from the authoritative destination stop sets.",
       call. = FALSE)
}

fields <- c("origin_id", "destination_id", "reachable", "travel_time_min",
            "departure_min", "arrival_min", "transfers", "walking_transfers")
checkpoint_dir <- file.path(out_dir, "origins")
if (!dir.create(checkpoint_dir, recursive = FALSE)) {
  stop("Could not create per-origin checkpoint directory.", call. = FALSE)
}
started_utc <- format(Sys.time(), tz = "UTC", usetz = TRUE)
writeLines(paste(started_utc, "final-feed matrix rebuild started"),
           file.path(out_dir, "progress.log"))
matrix_chunks <- vector("list", length(origin_ids))
origin_seconds <- numeric(length(origin_ids))
for (index in seq_along(origin_ids)) {
  origin_id <- origin_ids[[index]]
  started <- proc.time()[["elapsed"]]
  one <- construire_matrice_trajets_gtfs(
    preparation$rides, preparation$transfers,
    stats::setNames(list(origin_sets[[origin_id]]), origin_id), destinations,
    "07:00", "20:00", preparation$rules_resolved,
    ids_stops = preparation$stops$stop_id
  )
  origin_seconds[[index]] <- unname(proc.time()[["elapsed"]] - started)
  if (nrow(one) != 1202L || anyDuplicated(one$destination_id) ||
      !identical(one$destination_id, names(destinations))) {
    stop("Origin checkpoint did not cover the ordered destination grid: ", origin_id,
         call. = FALSE)
  }
  matrix_chunks[[index]] <- one
  checkpoint_path <- file.path(checkpoint_dir, sprintf("origin-%05d.rds", index))
  atomic_rds(list(origin_id = origin_id, origin_index = index, journeys = one), checkpoint_path)
  progress <- sprintf("%s %d/%d origin=%s reachable=%d elapsed=%.2fs",
    format(Sys.time(), tz = "UTC", usetz = TRUE), index, length(origin_ids), origin_id,
    sum(one$reachable), origin_seconds[[index]])
  cat(progress, "\n", sep = "")
  cat(progress, "\n", file = file.path(out_dir, "progress.log"), append = TRUE)
  if (index %% 25L == 0L) flush.console()
}

matrix <- do.call(rbind, matrix_chunks)
rownames(matrix) <- NULL
if (!identical(names(matrix), fields) || nrow(matrix) != 798128L ||
    anyDuplicated(matrix[c("origin_id", "destination_id")]) ||
    !identical(unique(matrix$origin_id), origin_ids) ||
    !identical(unique(matrix$destination_id), names(destinations))) {
  stop("Final matrix failed the 664 x 1,202 exact-cover contract.", call. = FALSE)
}
reference <- readRDS(reference_matrix_path)
ordered_actual <- matrix[order(matrix$origin_id, matrix$destination_id), fields]
ordered_reference <- reference[order(reference$origin_id, reference$destination_id), fields]
parity <- isTRUE(all.equal(ordered_actual, ordered_reference, check.attributes = FALSE))
row_equal <- rep(TRUE, nrow(ordered_actual))
for (field in fields) {
  actual <- ordered_actual[[field]]
  prior <- ordered_reference[[field]]
  equal <- is.na(actual) & is.na(prior)
  both_present <- !is.na(actual) & !is.na(prior)
  equal[both_present] <- actual[both_present] == prior[both_present]
  row_equal <- row_equal & equal
}
changed_od_rows <- sum(!row_equal)
if (!parity) {
  atomic_rds(list(previous_matrix = reference, corrected_matrix = matrix),
             file.path(out_dir, "previous-candidate-comparison.rds"))
  cat("Corrected router differs from the previous candidate in ",
      changed_od_rows, " OD rows; retaining both for review.\n", sep = "")
}

matrix_rds_path <- file.path(out_dir, "national-full-journeys.rds")
matrix_csv_path <- file.path(out_dir, "national-full-journeys.csv")
atomic_rds(matrix, matrix_rds_path)
atomic_csv(matrix, matrix_csv_path)
inputs_after <- hash_paths(fresh_inputs)
preparation_hash_after <- sha256(preparation_path)
if (!identical(inputs_before, inputs_after) ||
    !identical(preparation_hash_before, preparation_hash_after) ||
    !identical(source_helper_hash, empreinte_source_raccordement(file.path("R", "provenance_raccordement.R"))) ||
    !identical(router_r_hash, empreinte_source_raccordement(file.path("R", "services_gtfs.R"))) ||
    !identical(router_cpp_hash, empreinte_source_raccordement(file.path("src", "gtfs_csa.cpp"))) ||
    !identical(builder_source_hash, empreinte_source_raccordement(file.path("R", "matrice_trajets_gtfs.R")))) {
  stop("An input, preparation, or source changed while routing.", call. = FALSE)
}

receipt <- list(
  schema = "lusk-raccordement-national-matrix-rebuild-receipt-v1",
  status = "complete-candidate-only-not-production",
  service_date = "2026-10-21",
  method = list(
    objective = "fastest elapsed scheduled journey",
    first_boarding_window = "[07:00,20:00)",
    calendar_policy = paste(
      "Resolve the selected date from GTFS calendar.txt/calendar_dates.txt;",
      "service labels and route names do not determine eligibility."
    ),
    transfer_radius_m = 1000L, walking_speed_kmh = 3,
    destinations = "all 1,202 commune stop sets", eligible_origins = length(origin_ids),
    self_diagonal = "retain only the public router result; fabricate no values"
  ),
  provenance = list(
    final_input_sha256 = as.list(inputs_before),
    feed_versions = as.list(preparation$metadata$source$feed_versions),
    preparation_path = preparation_path,
    preparation_sha256 = preparation_hash_before,
    cache_key = expected_cache_key,
    method_schema_sha256 = expected_method_hash,
    provenance_helper_sha256 = source_helper_hash,
    preparation_router_cpp_sha256 = expected_preparation_cpp_hash,
    router_r_sha256 = router_r_hash,
    router_cpp_sha256 = router_cpp_hash,
    matrix_builder_source_sha256 = builder_source_hash,
    runner_sha256 = empreinte_source_raccordement(
      sub("^--file=", "", grep("^--file=", commandArgs(), value = TRUE)[[1]])),
    passenger_access = list(
      pickup_restricted_ride_edges = sum(!preparation$rides$pickup_allowed),
      dropoff_restricted_ride_edges = sum(!preparation$rides$drop_off_allowed),
      any_restricted_ride_edges = sum(!preparation$rides$pickup_allowed |
                                       !preparation$rides$drop_off_allowed)
    ),
    reference_matrix_sha256 = sha256(reference_matrix_path)
  ),
  coverage = list(
    origins = length(origin_ids), destinations_per_origin = length(destinations),
    OD_rows = nrow(matrix), unique_OD_rows = nrow(unique(matrix[c("origin_id", "destination_id")])),
    reachable_rows = sum(matrix$reachable), unreachable_rows = sum(!matrix$reachable),
    maximum_travel_time_min = max(matrix$travel_time_min, na.rm = TRUE),
    self_zero_rows = sum(matrix$reachable & matrix$origin_id == matrix$destination_id &
                           matrix$travel_time_min == 0)
  ),
  parity = list(
    checked_in_candidate_matrix_sha256 = sha256(reference_matrix_path),
    all_public_journey_fields_equal_after_key_sort = parity,
    changed_OD_rows = changed_od_rows,
    fields = fields
  ),
  execution = list(
    started_utc = started_utc,
    completed_utc = format(Sys.time(), tz = "UTC", usetz = TRUE),
    release_build = TRUE, forced_recompile = TRUE,
    build_seconds = build_seconds,
    origin_search_seconds = list(total = sum(origin_seconds), mean = mean(origin_seconds),
      median = unname(stats::median(origin_seconds)),
      p95 = unname(stats::quantile(origin_seconds, .95))),
    R_version = R.version.string, platform = R.version$platform
  ),
  outputs = list(
    matrix_rds = basename(matrix_rds_path), matrix_rds_sha256 = sha256(matrix_rds_path),
    matrix_csv = basename(matrix_csv_path), matrix_csv_sha256 = sha256(matrix_csv_path),
    origin_checkpoint_count = length(list.files(checkpoint_dir, pattern = "^origin-[0-9]{5}\\.rds$"))
  ),
  limitation = "Candidate research evidence only; no publication, migration, deployment, or activation."
)
receipt_path <- file.path(out_dir, "receipt.json")
atomic_json(receipt, receipt_path)
cat("receipt=", normalizePath(receipt_path, winslash = "/"), "\n", sep = "")
