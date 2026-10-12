# THROWAWAY #728 prototype runner. Uses only the persisted 1 km network prepared
# for the five-origin CSA sample; it does not build or substitute another feed.
pkgload::load_all(".", quiet = TRUE)
Rcpp::sourceCpp("scripts/prototype-raptor-same-network.cpp", rebuild = TRUE)

root <- "data/processed/raccordement-experiments/2026-10-21-five-random-1km"
preparation <- readRDS(file.path(root, "preparation.rds"))
stopifnot(identical(preparation$metadata$schema,
                    "lusk-raccordement-preparation-v1"),
          identical(preparation$metadata$transfer_radius_m, 1000),
          identical(preparation$metadata$feed_sha256, c(
            "3132b04726d350f0cd6bede1994338328632a48653a14f4f84f39b71cb6b2156",
            "46f1653045981abcefe06000feb17416e37540e0d4a7345be6820311912ad6b5")))

baseline <- read.csv(file.path(root, "journeys.csv"), stringsAsFactors = FALSE)
origin_codes <- preparation$metadata$commune_codes
destinations <- preparation$stop_sets

prepare_seconds <- system.time(network <- raptor_proto_prepare(
  preparation$rides, preparation$transfers, preparation$rules_resolved
))[["elapsed"]]
cat("raptor_network_prepare_seconds=", prepare_seconds,
    " trips=", length(unique(preparation$rides$trip_id)),
    " rides=", nrow(preparation$rides),
    " transfers=", nrow(preparation$transfers), "\n", sep = "")

raptor_results <- vector("list", length(origin_codes))
diagnostics <- vector("list", length(origin_codes))
for (i in seq_along(origin_codes)) {
  code <- origin_codes[[i]]
  elapsed <- system.time(result <- raptor_proto_route(
    network, preparation$stop_sets[[code]], destinations,
    window_start = 7 * 60, window_end = 20 * 60, max_rounds = 8L
  ))[["elapsed"]]
  journeys <- result$journeys
  raptor_results[[i]] <- do.call(rbind, lapply(names(destinations), function(id) {
    j <- journeys[[id]]
    data.frame(origin_id = code, destination_id = id,
               travel_time_min = j$travel_time_min,
               departure_min = j$departure_min, arrival_min = j$arrival_min,
               transfers = j$transfers, walking_transfers = j$walking_transfers,
               stringsAsFactors = FALSE)
  }))
  diagnostics[[i]] <- data.frame(origin_id = code, search_seconds = elapsed,
    rounds_used = result$metrics$rounds_used,
    labels_inserted = result$metrics$labels_inserted,
    boarding_tests = result$metrics$boarding_tests,
    reachable_destinations = sum(!is.na(vapply(journeys,
      function(x) x$travel_time_min, numeric(1)))), stringsAsFactors = FALSE)
  cat("origin=", code, " raptor_search_s=", elapsed,
      " rounds=", result$metrics$rounds_used,
      " reachable=", diagnostics[[i]]$reachable_destinations, "\n", sep = "")
}

raptor <- do.call(rbind, raptor_results)
diagnostics <- do.call(rbind, diagnostics)
comparison <- merge(baseline, raptor, by = c("origin_id", "destination_id"),
                    suffixes = c("_csa", "_raptor"), all = TRUE)
fields <- c("travel_time_min", "departure_min", "arrival_min", "transfers",
            "walking_transfers")
for (field in fields) {
  a <- comparison[[paste0(field, "_csa")]]
  b <- comparison[[paste0(field, "_raptor")]]
  same_na <- is.na(a) & is.na(b)
  same_value <- !is.na(a) & !is.na(b) & a == b
  comparison[[paste0(field, "_matches")]] <- same_na | same_value
}
comparison$all_fields_match <- Reduce(`&`, comparison[paste0(fields, "_matches")])
mismatches <- comparison[!comparison$all_fields_match, , drop = FALSE]

out <- file.path(root, "raptor-prototype")
dir.create(out, recursive = TRUE, showWarnings = FALSE)
write.csv(raptor, file.path(out, "journeys.csv"), row.names = FALSE)
write.csv(diagnostics, file.path(out, "diagnostics.csv"), row.names = FALSE)
write.csv(mismatches, file.path(out, "csa-mismatches.csv"), row.names = FALSE)
saveRDS(list(network = preparation$metadata, diagnostics = diagnostics,
             matching_pairs = sum(comparison$all_fields_match),
             total_pairs = nrow(comparison), mismatches = mismatches),
        file.path(out, "comparison.rds"), version = 3)
cat("matching_pairs=", sum(comparison$all_fields_match), "/", nrow(comparison),
    " mismatches=", nrow(mismatches),
    " mean_search_s=", mean(diagnostics$search_seconds),
    " total_search_s=", sum(diagnostics$search_seconds),
    " output=", normalizePath(out, winslash = "/"), "\n", sep = "")
