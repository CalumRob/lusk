# THROWAWAY #728 model/performance experiment, not a serving policy.
# From pipeline/: Rscript scripts/prototype-csa-fewest-rides.R
# Both variants compile from the current CSA source and consume preparation.rds.
# Only the objective and its required dominance rules differ. Production source
# and the saved preparation are never overwritten by this runner.
pkgload::load_all(".", quiet = TRUE, debug = FALSE)

replace_once <- function(code, from, to) {
  matches <- gregexpr(from, code, fixed = TRUE)[[1]]
  stopifnot(length(matches) == 1L, matches[[1]] > 0)
  sub(from, to, code, fixed = TRUE)
}

compile_variant <- function(fewest_rides = FALSE) {
  code <- paste(readLines("src/gtfs_csa.cpp", warn = FALSE), collapse = "\n")
  if (fewest_rides) {
    code <- replace_once(code,
      "if (x.departure != y.departure) return x.departure > y.departure;\n  if (x.transfers != y.transfers) return x.transfers < y.transfers;",
      "if (x.transfers != y.transfers) return x.transfers < y.transfers;\n  if (x.departure != y.departure) return x.departure > y.departure;")
    code <- replace_once(code,
      "if (old.arrival <= value.arrival && old.duration <= value.duration &&\n        (old.arrival < value.arrival || old.duration < value.duration ||\n         old.transfers < value.transfers ||\n         (old.transfers == value.transfers &&\n          old.walking_transfers <= value.walking_transfers))) return false;",
      paste0("if (old.arrival <= value.arrival &&\n",
        "        (old.transfers < value.transfers ||\n",
        "         (old.transfers == value.transfers &&\n",
        "          old.departure >= value.departure &&\n",
        "          (old.departure > value.departure ||\n",
        "           old.walking_transfers <= value.walking_transfers)))) return false;"))
    code <- replace_once(code,
      "if (value.arrival <= old.arrival && value.duration <= old.duration &&\n        (value.arrival < old.arrival || value.duration < old.duration ||\n         value.transfers < old.transfers ||\n         (value.transfers == old.transfers &&\n          value.walking_transfers < old.walking_transfers))) {",
      paste0("if (value.arrival <= old.arrival &&\n",
        "        (value.transfers < old.transfers ||\n",
        "         (value.transfers == old.transfers &&\n",
        "          value.departure >= old.departure &&\n",
        "          (value.departure > old.departure ||\n",
        "           value.walking_transfers < old.walking_transfers)))) {"))
    code <- replace_once(code,
      "if (!b.found || label.duration < b.duration ||\n          (label.duration == b.duration && label.transfers < b.transfers)) {",
      "if (!b.found || label.transfers < b.transfers ||\n          (label.transfers == b.transfers && label.duration < b.duration)) {")
  }

  # Coarse timers/counters only: no per-query clocks to distort the hot loop.
  code <- replace_once(code, "#include <Rcpp.h>",
    "#include <Rcpp.h>\n#include <chrono>")
  code <- replace_once(code,
    "CharacterVector from = rides[\"from_stop_id\"];",
    paste0("const auto prototype_start = std::chrono::steady_clock::now();\n",
      "  CharacterVector from = rides[\"from_stop_id\"];"))
  code <- replace_once(code, "auto record = [&](int stop, const Label& label) {",
    paste0("const auto prototype_scan_start = std::chrono::steady_clock::now();\n",
      "  std::size_t prototype_connection_visits = 0, prototype_passes = 0;\n",
      "  auto record = [&](int stop, const Label& label) {"))
  code <- replace_once(code, "while (first_pass || (changed && can_zero_chain)) {",
    "while (first_pass || (changed && can_zero_chain)) {\n      ++prototype_passes;")
  code <- replace_once(code, "const Connection& c = connections[order[p]];",
    "++prototype_connection_visits;\n        const Connection& c = connections[order[p]];")
  code <- replace_once(code, "List journeys(best.size());",
    paste0("const auto prototype_scan_end = std::chrono::steady_clock::now();\n",
      "  List journeys(best.size());"))
  code <- replace_once(code, "_[\"connections_scanned\"] =",
    paste0("_[\"preprocessing_seconds\"] = std::chrono::duration<double>(prototype_scan_start - prototype_start).count(),\n",
      "      _[\"scan_seconds\"] = std::chrono::duration<double>(prototype_scan_end - prototype_scan_start).count(),\n",
      "      _[\"connection_visits\"] = static_cast<double>(prototype_connection_visits),\n",
      "      _[\"event_passes\"] = static_cast<double>(prototype_passes),\n",
      "      _[\"connections_scanned\"] ="))

  exports <- new.env(parent = globalenv())
  Rcpp::sourceCpp(code = code, env = exports, rebuild = TRUE,
                  cacheDir = "data/processed/raccordement-experiments/prototype-rcpp-cache")
  wrapper <- rechercher_trajets_gtfs_compiled
  bindings <- new.env(parent = environment(wrapper))
  bindings$csa_multi_target <- exports$csa_multi_target
  environment(wrapper) <- bindings
  wrapper
}

fastest <- compile_variant()
fewest <- compile_variant(TRUE)

# Worked examples verify that this is not merely the incumbent time-first model.
empty_walks <- data.frame(from_stop_id = character(), to_stop_id = character(),
                          duration_min = numeric())
example <- data.frame(from_stop_id = c("O", "O", "X", "O"),
  to_stop_id = c("D", "X", "D", "D"),
  trip_id = c("slow-direct", "fast-1", "fast-2", "later-direct"),
  departure_min = c(420, 420, 430, 490), arrival_min = c(540, 430, 460, 550))
x <- fewest(example, empty_walks, "O", list(d = "D"), "07:00", "10:00")$journeys$d
y <- fastest(example, empty_walks, "O", list(d = "D"), "07:00", "10:00")$journeys$d
stopifnot(x$transfers == 0L, x$travel_time_min == 60, x$departure_min == 490,
          y$transfers == 1L, y$travel_time_min == 40)

# The fewer-ride path arriving later must not delete an earlier arrival needed
# for the onward departure: preserve readiness-vs-boarding Pareto alternatives.
example <- data.frame(from_stop_id = c("O", "A", "O", "X"),
  to_stop_id = c("A", "X", "X", "D"),
  trip_id = c("early-1", "early-2", "late-direct", "connection"),
  departure_min = c(420, 425, 420, 440), arrival_min = c(425, 430, 450, 460))
x <- fewest(example, empty_walks, "O", list(d = "D"), "07:00", "10:00")$journeys$d
stopifnot(x$transfers == 2L, x$travel_time_min == 40)
cat("Worked minimum-ride examples passed; no boarding limit.\n")

root <- "data/processed/raccordement-experiments/2026-10-21-five-random-1km"
preparation <- readRDS(file.path(root, "preparation.rds"))
stopifnot(identical(preparation$metadata$feed_sha256, c(
  "3132b04726d350f0cd6bede1994338328632a48653a14f4f84f39b71cb6b2156",
  "46f1653045981abcefe06000feb17416e37540e0d4a7345be6820311912ad6b5")),
  preparation$metadata$transfer_radius_m == 1000,
  preparation$metadata$service_date == "2026-10-21")

out <- file.path(root, paste0("csa-fewest-rides-", format(Sys.time(), "%Y%m%dT%H%M%S")))
dir.create(out, recursive = TRUE, showWarnings = FALSE)
rows <- list(); diagnostics <- list(); n <- 0L
# Two passes, alternating order to limit warm-up/system-load confounding.
for (pass in 1:2) {
for (i in seq_along(preparation$metadata$commune_codes)) {
  code <- preparation$metadata$commune_codes[[i]]
  variants <- if ((i + pass) %% 2L) c("fastest", "fewest") else c("fewest", "fastest")
  for (variant in variants) {
    n <- n + 1L
    router <- if (variant == "fewest") fewest else fastest
    seconds <- system.time(route <- router(
      preparation$rides, preparation$transfers,
      preparation$stop_sets[[code]], preparation$stop_sets,
      "07:00", "20:00", preparation$rules_resolved,
      ids_stops = preparation$stops$stop_id))[["elapsed"]]
    rows[[n]] <- do.call(rbind, lapply(names(route$journeys), function(id) {
      j <- route$journeys[[id]]
      data.frame(model = variant, pass = pass, origin_id = code, destination_id = id,
        travel_time_min = j$travel_time_min, departure_min = j$departure_min,
        arrival_min = j$arrival_min, transfers = j$transfers,
        walking_transfers = j$walking_transfers, stringsAsFactors = FALSE)
    }))
    diagnostics[[n]] <- cbind(data.frame(model = variant, pass = pass, origin_id = code,
      elapsed_seconds = seconds), as.data.frame(route$metrics))
    cat("pass=", pass, " origin=", code, " model=", variant, " elapsed_s=", seconds,
      " preprocessing_s=", route$metrics$preprocessing_seconds,
      " scan_s=", route$metrics$scan_seconds,
      " visits=", route$metrics$connection_visits,
      " queries=", route$metrics$arrival_frontier_queries,
      " labels=", route$metrics$labels_inserted, "\n", sep = "")
    write.csv(do.call(rbind, diagnostics), file.path(out, "diagnostics.csv"), row.names = FALSE)
    write.csv(do.call(rbind, rows), file.path(out, "journeys.csv"), row.names = FALSE)
  }
}
}

journeys <- do.call(rbind, rows)
comparison <- merge(subset(journeys, model == "fastest"),
  subset(journeys, model == "fewest"), by = c("pass", "origin_id", "destination_id"),
  suffixes = c("_fastest", "_fewest"), all = TRUE)
write.csv(comparison, file.path(out, "comparison.csv"), row.names = FALSE)
print(aggregate(elapsed_seconds ~ model, do.call(rbind, diagnostics), sum))
cat("Changed ride counts=", sum(comparison$transfers_fastest != comparison$transfers_fewest, na.rm = TRUE),
    " changed travel times=", sum(comparison$travel_time_min_fastest != comparison$travel_time_min_fewest, na.rm = TRUE),
    " output=", normalizePath(out, winslash = "/"), "\n", sep = "")
