# Comparison R5 scoped to candidate commune stop sets for issue #728.
# Run from pipeline/: Rscript scripts/benchmark-raccordement-r5r.R
# r5r is deliberately loaded from the maintainer-provided read-only library;
# neither package installation nor canonical source pins are changed.
# Its max_walk_time is one per-leg cap covering endpoint and transfer walking;
# r5r has no separate zero-endpoint-penalty / configurable-transfer-walk control.
# travel_time_matrix returns percentiles (minimum accepted is p01), not the
# exact minimum journey duration. Detailed itineraries below inspect the chosen
# stop pair and decompose its endpoint access/wait/egress separately.
options(java.parameters = "-Xmx8G")
r5r_library <- paste0(
  "C:/Users/calum/AppData/Local/R/cache/R/renv/library/",
  "code-1e199dc7/windows/R-4.4/x86_64-w64-mingw32"
)
.libPaths(c(r5r_library, .libPaths()))
stopifnot(requireNamespace("r5r", quietly = TRUE))
library(sf)

source_files <- c(
  pbf = "data/raw/bretagne-latest.osm.pbf",
  korrigo = "data/raw/korrigo-gtfs-80622-candidate.zip",
  sncf = "data/raw/sncf-national.zip"
)
expected_hashes <- c(
  pbf = "dd9187d48ad5f91e7285afc52c853f5e0afe1cd2100fd45f4e8a322099041ada",
  korrigo = "3132b04726d350f0cd6bede1994338328632a48653a14f4f84f39b71cb6b2156",
  sncf = "46f1653045981abcefe06000feb17416e37540e0d4a7345be6820311912ad6b5"
)
hash_file <- function(path) {
  con <- file(path, "rb")
  on.exit(close(con))
  paste0(openssl::sha256(con))
}
stopifnot(all(file.exists(source_files)),
          identical(unname(vapply(source_files, hash_file, character(1))),
                    unname(expected_hashes)))

# R5's build_network scans every .zip/.pbf in its directory. Use an isolated,
# worktree-owned copy containing only these candidate archives and OSM extract.
network_dir <- "data/raw/r5r-benchmark-2026-10-21"
dir.create(network_dir, recursive = TRUE, showWarnings = FALSE)
network_files <- file.path(network_dir, basename(source_files))
for (i in seq_along(source_files)) {
  if (!file.exists(network_files[i]) ||
      !identical(hash_file(network_files[i]), unname(expected_hashes[i]))) {
    copied <- file.copy(source_files[i], network_files[i], overwrite = TRUE)
    stopifnot(copied, identical(hash_file(network_files[i]),
                                unname(expected_hashes[i])))
  }
}

read_gtfs <- function(path, member) {
  utils::read.csv(unz(path, member), colClasses = "character",
                  stringsAsFactors = FALSE, check.names = FALSE)
}
make_stop_sets <- function() {
  k <- read_gtfs(source_files[["korrigo"]], "stops.txt")
  s <- read_gtfs(source_files[["sncf"]], "stops.txt")
  columns <- union(names(k), names(s))
  for (nm in setdiff(columns, names(k))) k[[nm]] <- NA_character_
  for (nm in setdiff(columns, names(s))) s[[nm]] <- NA_character_
  stops <- rbind(k[columns], s[columns])
  stops <- stops[stops$location_type == "0" & !is.na(stops$stop_lat) &
                   !is.na(stops$stop_lon), , drop = FALSE]
  points <- sf::st_as_sf(stops, coords = c("stop_lon", "stop_lat"),
                         crs = 4326, remove = FALSE)
  communes <- sf::st_read("../public/data/communes.geojson", quiet = TRUE)
  joined <- sf::st_join(points, communes["territoire"], join = sf::st_within)
  make_points <- function(code) {
    x <- joined[!is.na(joined$territoire) & joined$territoire == code, ]
    data.frame(id = as.character(x$stop_id), lat = as.numeric(x$stop_lat),
               lon = as.numeric(x$stop_lon))
  }
  list(
    rennes = make_points("35238"),
    saint_malo = make_points("35288"),
    combourg = make_points("35085"),
    all_stops = data.frame(
      id = as.character(joined$stop_id[!is.na(joined$territoire)]),
      lat = as.numeric(joined$stop_lat[!is.na(joined$territoire)]),
      lon = as.numeric(joined$stop_lon[!is.na(joined$territoire)])
    )
  )
}

benchmark <- function() {
  cat("r5r_version=", as.character(utils::packageVersion("r5r")), "\n", sep = "")
  t0 <- proc.time()[["elapsed"]]
  network <- r5r::build_network(network_dir, verbose = FALSE,
                                elevation = "NONE", overwrite = FALSE)
  cat("network_build_or_load_seconds=", proc.time()[["elapsed"]] - t0, "\n",
      sep = "")
  on.exit(r5r::stop_r5(), add = TRUE)
  sets <- make_stop_sets()
  cat("stop_sets=Rennes:", nrow(sets$rennes),
      ",Saint-Malo:", nrow(sets$saint_malo),
      ",Combourg:", nrow(sets$combourg),
      ",all_mapped_leaf_stops:", nrow(sets$all_stops), "\n", sep = "")

  cases <- list(
    `Rennes->Combourg` = list(sets$rennes, sets$combourg),
    `Combourg->Rennes` = list(sets$combourg, sets$rennes),
    `Saint-Malo->Combourg` = list(sets$saint_malo, sets$combourg)
  )
  for (case in names(cases)) {
    origins <- cases[[case]][[1]]
    destinations <- cases[[case]][[2]]
    t0 <- proc.time()[["elapsed"]]
    result <- r5r::travel_time_matrix(
      network,
      origins = origins,
      destinations = destinations,
      mode = "TRANSIT",
      departure_datetime = as.POSIXct("2026-10-21 07:00:00",
                                      tz = "Europe/Paris"),
      time_window = 780L,
      percentiles = c(1L, 50L, 99L),
      draws_per_minute = 1L,
      max_walk_time = 1,
      max_trip_duration = 360L,
      n_threads = 4L,
      progress = FALSE
    )
    elapsed <- proc.time()[["elapsed"]] - t0
    finite <- is.finite(result$travel_time_p01)
    best <- if (any(finite)) which.min(result$travel_time_p01) else NA_integer_
    cat("case=", case, " query_seconds=", elapsed,
        " input_pairs=", nrow(origins) * nrow(destinations),
        " returned_rows=", nrow(result),
        " finite_p01=", sum(finite), sep = "")
    if (!is.na(best)) {
      cat(" best_p01_min=", result$travel_time_p01[best],
          " p50_same_pair=", result$travel_time_p50[best],
          " p99_same_pair=", result$travel_time_p99[best],
          " from=", result$from_id[best], " to=", result$to_id[best], sep = "")

      # Inspect the actual best-p01 stop pair. R5 exposes endpoint walks and
      # initial wait as segments; report the elapsed portion after first
      # boarding separately from those non-contract endpoint costs.
      from <- sets$all_stops[match(result$from_id[best], sets$all_stops$id), ]
      to <- sets$all_stops[match(result$to_id[best], sets$all_stops$id), ]
      if (nrow(from) == 1L && nrow(to) == 1L &&
          !is.na(from$id[[1]]) && !is.na(to$id[[1]])) {
        cat("\n")
        detail_start <- proc.time()[["elapsed"]]
        detail <- r5r::detailed_itineraries(
          network,
          origins = from,
          destinations = to,
          mode = "TRANSIT",
          departure_datetime = as.POSIXct("2026-10-21 07:00:00",
                                          tz = "Europe/Paris"),
          time_window = 780L,
          max_walk_time = 1,
          max_trip_duration = 360L,
          shortest_path = TRUE,
          drop_geometry = TRUE,
          n_threads = 1L,
          progress = FALSE
        )
        vehicle <- which(detail$mode != "WALK")
        if (length(vehicle)) {
          first_vehicle <- vehicle[[1]]
          last_vehicle <- vehicle[[length(vehicle)]]
          access <- sum(detail$segment_duration[
            detail$segment < detail$segment[first_vehicle] &
              detail$mode == "WALK"], na.rm = TRUE)
          initial_wait <- detail$wait[first_vehicle]
          egress <- sum(detail$segment_duration[
            detail$segment > detail$segment[last_vehicle] &
              detail$mode == "WALK"], na.rm = TRUE)
          start <- strsplit(detail$departure_time[first_vehicle], ":",
                            fixed = TRUE)[[1]]
          request_min <- as.numeric(start[[1]]) * 60 +
            as.numeric(start[[2]]) + as.numeric(start[[3]]) / 60
          cat(" detail_seconds=", proc.time()[["elapsed"]] - detail_start,
              " request_min=", request_min,
              " first_board_min=", request_min + access + initial_wait,
              " access_min=", access, " initial_wait_min=", initial_wait,
              " egress_min=", egress,
              " after_boarding_min=", detail$total_duration[first_vehicle] -
                access - initial_wait - egress, sep = "")
          cat("\n")
        }
      }
    }
    cat("\n")
  }
  invisible(NULL)
}

benchmark()
