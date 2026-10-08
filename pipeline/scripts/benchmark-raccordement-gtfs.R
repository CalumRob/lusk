# Benchmark reproductible du routage candidat #728.
# Exécuter depuis pipeline/ : Rscript scripts/benchmark-raccordement-gtfs.R
# Les archives sont des candidats non publiés; ce script ne touche aucun pin.
pkgload::load_all(".", quiet = TRUE)
library(sf)

korrigo_path <- "data/raw/korrigo-gtfs-80622-candidate.zip"
sncf_path <- "data/raw/sncf-national.zip"
communes_path <- "../public/data/communes.geojson"
empreintes <- c(
  "3132b04726d350f0cd6bede1994338328632a48653a14f4f84f39b71cb6b2156",
  "46f1653045981abcefe06000feb17416e37540e0d4a7345be6820311912ad6b5"
)
hash <- function(path) {
  con <- file(path, "rb")
  on.exit(close(con))
  paste0(openssl::sha256(con))
}
stopifnot(identical(hash(korrigo_path), empreintes[[1]]),
          identical(hash(sncf_path), empreintes[[2]]))
read_gtfs <- function(path, member) {
  utils::read.csv(unz(path, member), colClasses = "character",
                  stringsAsFactors = FALSE, check.names = FALSE)
}
date <- "2026-10-21"
construire_rides <- function(path) {
  trips <- read_gtfs(path, "trips.txt")
  stop_times <- read_gtfs(path, "stop_times.txt")
  active <- services_gtfs_a_la_date(
    read_gtfs(path, "calendar.txt"), read_gtfs(path, "calendar_dates.txt"), date
  )
  aretes_trajet_gtfs(trips, stop_times, active)
}

temps <- system.time(rides <- rbind(construire_rides(korrigo_path),
                                    construire_rides(sncf_path)))
cat("ride_edges=", nrow(rides), " ride_build_seconds=", temps[["elapsed"]], "\n",
    sep = "")

k_stops <- read_gtfs(korrigo_path, "stops.txt")
s_stops <- read_gtfs(sncf_path, "stops.txt")
colonnes <- union(names(k_stops), names(s_stops))
for (nom in setdiff(colonnes, names(k_stops))) k_stops[[nom]] <- NA_character_
for (nom in setdiff(colonnes, names(s_stops))) s_stops[[nom]] <- NA_character_
stops <- rbind(k_stops[colonnes], s_stops[colonnes])
rules <- read_gtfs(korrigo_path, "transfers.txt")
rules_resolved <- etendre_regles_transfert_gtfs(rules, stops)
communes <- sf::st_read(communes_path, quiet = TRUE)
feuilles <- stops[stops$location_type == "0" &
                    !is.na(stops$stop_lat) & !is.na(stops$stop_lon), , drop = FALSE]
points <- sf::st_as_sf(feuilles, coords = c("stop_lon", "stop_lat"),
                        crs = 4326, remove = FALSE)
jointure <- sf::st_join(points, communes["territoire"], join = sf::st_within)
codes <- as.character(communes$territoire)
stop_sets <- setNames(lapply(codes, function(code) {
  jointure$stop_id[!is.na(jointure$territoire) & jointure$territoire == code]
}), codes)

# Rennes -> 22004 is a candidate route which actually uses a walk-link at 300 m;
# Rennes/Saint-Malo -> Combourg are also reported for continuity.
targets <- list("22004" = stop_sets[["22004"]],
                "35085" = stop_sets[["35085"]],
                "35238" = stop_sets[["35238"]],
                "35288" = stop_sets[["35288"]])
origins <- c("35238", "35288")
for (radius in c(200, 300, 500)) {
  temps_walk <- system.time(walks <- aretes_transfert_gtfs(
    stops, rules, rayon_m = radius, vitesse_marche_kmh = 4
  ))
  cat("radius_m=", radius, " transfer_edges=", nrow(walks),
      " transfer_build_seconds=", temps_walk[["elapsed"]], "\n", sep = "")
  for (origin_code in origins) {
    temps_route <- system.time(result <- rechercher_trajets_gtfs_compiled(
      rides, walks, stop_sets[[origin_code]], targets, "07:00", "20:00",
      rules_resolved, stops$stop_id
    ))
    cat("origin=", origin_code, " seconds=", temps_route[["elapsed"]],
        " connections=", result$metrics$connections_scanned,
        " labels_inserted=", result$metrics$labels_inserted,
        " labels_retained=", result$metrics$labels_retained,
        " label_checks=", result$metrics$label_checks, "\n", sep = "")
    for (destination_code in names(targets)) {
      journey <- result$journeys[[destination_code]]
      cat("  destination=", destination_code,
          " elapsed_min=", journey$travel_time_min,
          " depart_min=", journey$departure_min,
          " arrive_min=", journey$arrival_min,
          " vehicle_changes=", journey$transfers,
          " walk_links=", journey$walking_transfers, "\n", sep = "")
    }
  }
}
