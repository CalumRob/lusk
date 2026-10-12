# #728: matched build-mode comparison on the persisted five-origin 1 km network.
# From pipeline/: Rscript scripts/benchmark-csa-build-mode.R debug
#                 Rscript scripts/benchmark-csa-build-mode.R release
# Forces a rebuild in a fresh process. Does not change source or serving data.
args <- commandArgs(trailingOnly = TRUE)
stopifnot(length(args) == 1L, args %in% c("debug", "release"))
mode <- args[[1]]
pkgload::load_all(".", quiet = FALSE, recompile = TRUE, debug = mode == "debug")

root <- "data/processed/raccordement-experiments/2026-10-21-five-random-1km"
preparation <- readRDS(file.path(root, "preparation.rds"))
baseline <- read.csv(file.path(root, "journeys.csv"),
  colClasses = c(origin_id = "character", destination_id = "character"))
stopifnot(preparation$metadata$transfer_radius_m == 1000,
  identical(preparation$metadata$feed_sha256, c(
    "3132b04726d350f0cd6bede1994338328632a48653a14f4f84f39b71cb6b2156",
    "46f1653045981abcefe06000feb17416e37540e0d4a7345be6820311912ad6b5")))

fields <- c("travel_time_min", "departure_min", "arrival_min", "transfers",
             "walking_transfers")
diagnostics <- list()
out <- file.path(root, paste0("csa-build-", mode, "-", format(Sys.time(), "%Y%m%dT%H%M%S")))
dir.create(out, recursive = TRUE, showWarnings = FALSE)
for (pass in 1:2) {
  for (code in preparation$metadata$commune_codes) {
    elapsed <- system.time(route <- rechercher_trajets_gtfs_compiled(
      preparation$rides, preparation$transfers, preparation$stop_sets[[code]],
      preparation$stop_sets, "07:00", "20:00", preparation$rules_resolved,
      ids_stops = preparation$stops$stop_id))[["elapsed"]]
    expected <- baseline[baseline$origin_id == code, , drop = FALSE]
    stopifnot(identical(as.character(expected$destination_id), names(route$journeys)))
    for (field in fields) {
      actual <- vapply(route$journeys, function(j) as.numeric(j[[field]]), numeric(1))
      stopifnot(isTRUE(all.equal(unname(actual), as.numeric(expected[[field]]),
                                tolerance = 0, check.attributes = FALSE)))
    }
    diagnostics[[length(diagnostics) + 1L]] <- cbind(
      data.frame(build = mode, pass = pass, origin_id = code,
                 search_seconds = elapsed, matching_pairs = nrow(expected)),
      as.data.frame(route$metrics))
    cat("build=", mode, " pass=", pass, " origin=", code,
      " search_s=", elapsed, " matched=", nrow(expected), "\n", sep = "")
    write.csv(do.call(rbind, diagnostics), file.path(out, "diagnostics.csv"), row.names = FALSE)
  }
}
diagnostics <- do.call(rbind, diagnostics)
print(aggregate(search_seconds ~ pass, diagnostics, sum))
cat("mean_search_s=", mean(diagnostics$search_seconds),
  " total_matches=", sum(diagnostics$matching_pairs),
  " output=", normalizePath(out, winslash = "/"), "\n", sep = "")
