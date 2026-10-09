# Benchmark reproductible du routage candidat #728.
# Exécuter depuis pipeline/ avec une liste d'origines :
#   Rscript scripts/benchmark-raccordement-gtfs.R 35238 35288
#   Rscript scripts/benchmark-raccordement-gtfs.R ALL
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
  members <- utils::unzip(path, list = TRUE)$Name
  calendar <- if ("calendar.txt" %in% members) read_gtfs(path, "calendar.txt") else NULL
  calendar_dates <- if ("calendar_dates.txt" %in% members) {
    read_gtfs(path, "calendar_dates.txt")
  } else NULL
  active <- services_gtfs_a_la_date(calendar, calendar_dates, date)
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

args <- commandArgs(trailingOnly = TRUE)
if (!length(args)) {
  stop("Provide origin commune codes, or ALL to run every origin.", call. = FALSE)
}
origin_codes <- if (identical(args, "ALL")) codes else args
unknown <- setdiff(origin_codes, names(stop_sets))
if (length(unknown)) {
  stop("Unknown origin commune code(s): ", paste(unknown, collapse = ", "),
       call. = FALSE)
}
origins <- setNames(lapply(origin_codes, function(code) stop_sets[[code]]), origin_codes)

# Each run returns every destination, not a hand-picked OD subset. Only the
# origins are narrowed for a pilot; pass ALL after the sensitivity policy is
# selected and the router meets its runtime budget.
radii <- c(500, 1000, 2000)
destinations <- stop_sets
experiment <- lapply(radii, function(radius) {
  cat("Running transfer radius ", radius, " m for ", length(origins),
      " origin(s) against ", length(destinations), " destinations\n", sep = "")
  executer_experience_raccordement_gtfs(
    rides = rides, stops = stops, origines = origins,
    destinations = destinations, rayon_m = radius,
    vitesse_marche_kmh = 3, regles_transfert = rules_resolved,
    debut_fenetre = "07:00", fin_fenetre = "20:00"
  )
})
journeys <- do.call(rbind, lapply(experiment, `[[`, "journeys"))
diagnostics <- do.call(rbind, lapply(experiment, `[[`, "diagnostics"))
groups <- split(journeys, interaction(journeys$origin_id,
                                      journeys$destination_id, drop = TRUE))
changed_pairs <- sum(vapply(groups, function(x) {
  length(unique(x$travel_time_min)) > 1L
}, logical(1)))

run_id <- paste0(date, "-", format(Sys.time(), "%Y%m%dT%H%M%S"))
output_dir <- file.path("data", "processed", "raccordement-experiments", run_id)
dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)
utils::write.csv(journeys, file.path(output_dir, "journeys.csv"), row.names = FALSE)
utils::write.csv(diagnostics, file.path(output_dir, "diagnostics.csv"), row.names = FALSE)
cat("journeys=", nrow(journeys), " changed_origin_destination_pairs=",
    changed_pairs, " output=", output_dir, "\n", sep = "")
