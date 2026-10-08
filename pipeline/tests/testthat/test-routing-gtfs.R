test_that("GTFS ride edges use active trips and ordered stop times", {
  trips <- data.frame(trip_id = c("weekday", "holiday"),
                      service_id = c("term", "holiday"),
                      stringsAsFactors = FALSE)
  times <- data.frame(
    trip_id = c("weekday", "weekday", "weekday", "holiday", "holiday"),
    stop_id = c("A", "B", "C", "A", "C"),
    stop_sequence = c(1, 2, 3, 1, 2),
    arrival_time = c("09:00:00", "09:10:00", "09:20:00", "10:00:00", "10:25:00"),
    departure_time = c("09:00:00", "09:12:00", "09:20:00", "10:00:00", "10:25:00"),
    stringsAsFactors = FALSE
  )

  edges <- aretes_trajet_gtfs(trips, times, "holiday")
  expect_equal(nrow(edges), 1L)
  expect_identical(edges$from_stop_id, "A")
  expect_identical(edges$to_stop_id, "C")
  expect_equal(edges$departure_min, 600)
  expect_equal(edges$arrival_min, 625)
})

test_that("GTFS transfer graph uses distance, minimum times, and prohibitions", {
  stops <- data.frame(
    stop_id = c("A", "B", "C"),
    stop_lat = c(48, 48, 48),
    stop_lon = c(-1, -0.999, -0.99),
    location_type = c(0, 0, 0), stringsAsFactors = FALSE
  )
  rules <- data.frame(
    from_stop_id = c("A", "B"), to_stop_id = c("B", "A"),
    transfer_type = c(2, 3), min_transfer_time = c(600, NA),
    stringsAsFactors = FALSE
  )

  edges <- aretes_transfert_gtfs(stops, rules, rayon_m = 200,
                                 vitesse_marche_kmh = 4)
  ab <- edges[edges$from_stop_id == "A" & edges$to_stop_id == "B", ]
  expect_equal(nrow(ab), 1L)
  expect_equal(ab$duration_min, 10)
  expect_false(any(edges$from_stop_id == "B" & edges$to_stop_id == "A"))
  expect_false(any(edges$from_stop_id == "A" & edges$to_stop_id == "C"))
})

test_that("fastest GTFS journey uses stop-set endpoints without access penalties", {
  rides <- data.frame(
    from_stop_id = c("O1", "X", "O2"),
    to_stop_id = c("X", "D1", "D2"),
    trip_id = c("one", "two", "direct"),
    departure_min = c(600, 615, 630),
    arrival_min = c(610, 625, 635)
  )
  transfers <- data.frame(from_stop_id = character(), to_stop_id = character(),
                          duration_min = numeric())

  result <- meilleur_trajet_gtfs(
    rides, transfers, origine = c("O1", "O2"), destination = c("D1", "D2"),
    debut_fenetre = "10:00", fin_fenetre = "11:00"
  )
  expect_equal(result$travel_time_min, 5)
  expect_equal(result$departure_min, 630)
  expect_equal(result$arrival_min, 635)

  at_window_end <- meilleur_trajet_gtfs(
    rides, transfers, origine = "O1", destination = "X",
    debut_fenetre = "09:00", fin_fenetre = "10:00"
  )
  expect_true(is.na(at_window_end$travel_time_min))
})

test_that("fastest GTFS journey can transfer, but only between scheduled rides", {
  rides <- data.frame(
    from_stop_id = c("O", "T"), to_stop_id = c("A", "D"),
    trip_id = c("first", "second"), departure_min = c(600, 615),
    arrival_min = c(610, 625)
  )
  transfers <- data.frame(from_stop_id = "A", to_stop_id = "T",
                          duration_min = 5)
  result <- meilleur_trajet_gtfs(
    rides, transfers, origine = "O", destination = "D",
    debut_fenetre = "10:00", fin_fenetre = "11:00"
  )
  expect_equal(result$travel_time_min, 25)

  too_late <- transform(rides, departure_min = c(600, 614))
  result_late <- meilleur_trajet_gtfs(
    too_late, transfers, origine = "O", destination = "D",
    debut_fenetre = "10:00", fin_fenetre = "11:00"
  )
  expect_true(is.na(result_late$travel_time_min))
})

test_that("same-stop GTFS prohibition and minimum connection time are enforced", {
  rides <- data.frame(
    from_stop_id = c("O", "X", "X"), to_stop_id = c("X", "D1", "D2"),
    trip_id = c("in", "too-soon", "after-minimum"),
    departure_min = c(600, 615, 620), arrival_min = c(610, 625, 630)
  )
  transfers <- data.frame(from_stop_id = character(), to_stop_id = character(),
                          duration_min = numeric())
  rules <- data.frame(from_stop_id = "X", to_stop_id = "X",
                      transfer_type = "3", stringsAsFactors = FALSE)

  prohibited <- meilleur_trajet_gtfs(
    rides, transfers, "O", c("D1", "D2"), "10:00", "11:00",
    regles_transfert = rules
  )
  expect_true(is.na(prohibited$travel_time_min))
  stop_geometry <- data.frame(
    stop_id = c("O", "X", "D"), stop_lat = c(48, 48, 48),
    stop_lon = c(-1, -0.999, -0.998), location_type = c(0, 0, 0),
    stringsAsFactors = FALSE
  )
  graph_with_same_stop_rule <- aretes_transfert_gtfs(
    stop_geometry, rules, rayon_m = 0
  )
  prohibited_from_graph <- meilleur_trajet_gtfs(
    rides, graph_with_same_stop_rule, "O", c("D1", "D2"), "10:00", "11:00"
  )
  expect_true(is.na(prohibited_from_graph$travel_time_min))

  rules$transfer_type <- "2"
  rules$min_transfer_time <- 600
  minimum <- meilleur_trajet_gtfs(
    rides, transfers, "O", c("D1", "D2"), "10:00", "11:00",
    regles_transfert = rules
  )
  expect_equal(minimum$travel_time_min, 30)
  expect_equal(minimum$arrival_min, 630)
})

test_that("GTFS transfer semantics fail explicitly when unsupported", {
  stops <- data.frame(
    stop_id = c("station-a", "a1", "a2", "station-b", "b1", "b2"),
    location_type = c(1, 0, 0, 1, 0, 0),
    parent_station = c(NA, "station-a", "station-a", NA, "station-b", "station-b"),
    stop_lat = c(48, 48, 48.0001, 48, 48, 48.0001),
    stop_lon = c(-1, -1, -1, -0.999, -0.999, -0.999),
    stringsAsFactors = FALSE
  )
  parent_rule <- data.frame(from_stop_id = "station-a", to_stop_id = "station-b",
                            transfer_type = "0", stringsAsFactors = FALSE)
  expanded <- etendre_regles_transfert_gtfs(parent_rule, stops)
  expect_equal(nrow(expanded), 4L)
  expect_true(all(expanded$from_stop_id %in% c("a1", "a2")))
  expect_true(all(expanded$to_stop_id %in% c("b1", "b2")))
  pedestrian_edges <- aretes_transfert_gtfs(stops, parent_rule, rayon_m = 10)
  expect_true(any(pedestrian_edges$from_stop_id == "a1" &
                    pedestrian_edges$to_stop_id == "b1"))

  timed <- transform(parent_rule, transfer_type = "1")
  expect_error(verifier_regles_connection_gtfs(timed), "type 1")
  by_route <- transform(parent_rule, from_route_id = "route-1")
  expect_error(verifier_regles_connection_gtfs(by_route), "route/trip")
})

test_that("multi-destination search propagates once and preserves each best journey", {
  rides <- data.frame(
    from_stop_id = c("O", "X", "O", "Y"),
    to_stop_id = c("X", "A", "Y", "B"),
    trip_id = c("a", "a2", "b", "b2"),
    departure_min = c(600, 620, 605, 611),
    arrival_min = c(610, 630, 610, 631)
  )
  transfers <- data.frame(from_stop_id = character(), to_stop_id = character(),
                          duration_min = numeric())
  result <- meilleurs_trajets_gtfs_multi_destination(
    rides, transfers, "O", list(A = "A", B = "B"), "10:00", "11:00"
  )
  expect_equal(result$A$travel_time_min, 30)
  expect_equal(result$A$departure_min, 600)
  expect_equal(result$B$travel_time_min, 26)
  expect_equal(result$B$departure_min, 605)
})

test_that("candidate feeds reproduce holiday services and the Combourg sample", {
  korrigo_zip <- test_path("..", "..", "data", "raw",
                           "korrigo-gtfs-80622-candidate.zip")
  sncf_zip <- test_path("..", "..", "data", "raw", "sncf-national.zip")
  communes_path <- test_path("..", "..", "..", "public", "data",
                             "communes.geojson")
  skip_if(!file.exists(korrigo_zip) || !file.exists(sncf_zip) ||
            !file.exists(communes_path), "candidate GTFS or commune geometry absent")
  empreinte <- function(path) {
    con <- file(path, "rb")
    on.exit(close(con))
    paste0(openssl::sha256(con))
  }
  expect_identical(empreinte(korrigo_zip),
                   "3132b04726d350f0cd6bede1994338328632a48653a14f4f84f39b71cb6b2156")
  expect_identical(empreinte(sncf_zip),
                   "46f1653045981abcefe06000feb17416e37540e0d4a7345be6820311912ad6b5")
  expect_identical(empreinte(communes_path),
                   "ab92ea56410a6fde88de1004f79aafa6e2c0d1ab2185de588d8e1f60b267a609")

  read_gtfs <- function(path, member) {
    utils::read.csv(unz(path, member), colClasses = "character",
                    stringsAsFactors = FALSE, check.names = FALSE)
  }
  date <- "2026-10-21"
  k_cd <- read_gtfs(korrigo_zip, "calendar_dates.txt")
  k_active <- services_gtfs_a_la_date(NULL, k_cd, date)
  k_trips <- read_gtfs(korrigo_zip, "trips.txt")
  k_routes <- read_gtfs(korrigo_zip, "routes.txt")
  trips_actifs <- k_trips[k_trips$service_id %in% k_active, , drop = FALSE]
  routes_actives <- k_routes[k_routes$route_id %in% trips_actifs$route_id, , drop = FALSE]
  expect_equal(nrow(trips_actifs), 17259L)
  expect_equal(length(unique(routes_actives$agency_id)), 31L)
  k_stops <- read_gtfs(korrigo_zip, "stops.txt")
  k_rules <- read_gtfs(korrigo_zip, "transfers.txt")
  expect_equal(nrow(k_rules), 25272L)
  expect_equal(as.integer(table(factor(k_rules$transfer_type,
                                       levels = c("0", "1", "2", "3")))),
               c(23294L, 0L, 390L, 1588L))
  expect_equal(nrow(etendre_regles_transfert_gtfs(k_rules, k_stops)), nrow(k_rules))
  expect_silent(verifier_regles_connection_gtfs(k_rules))

  active <- services_gtfs_a_la_date(NULL,
                                     read_gtfs(sncf_zip, "calendar_dates.txt"), date)
  rides <- aretes_trajet_gtfs(read_gtfs(sncf_zip, "trips.txt"),
                              read_gtfs(sncf_zip, "stop_times.txt"), active)
  stops <- read_gtfs(sncf_zip, "stops.txt")
  communes <- sf::st_read(communes_path, quiet = TRUE)
  feuilles <- stops[stops$location_type == "0" &
                      !is.na(stops$stop_lat) & !is.na(stops$stop_lon), , drop = FALSE]
  points <- sf::st_as_sf(feuilles, coords = c("stop_lon", "stop_lat"),
                          crs = 4326, remove = FALSE)
  jointure <- sf::st_join(points, communes["territoire"], join = sf::st_within)
  ids_commune <- split(jointure$stop_id, jointure$territoire)
  sans_marche <- data.frame(from_stop_id = character(), to_stop_id = character(),
                            duration_min = numeric())
  rennes <- meilleur_trajet_gtfs(rides, sans_marche, ids_commune[["35238"]],
                                 ids_commune[["35085"]], "07:00", "20:00")
  malouin <- meilleur_trajet_gtfs(rides, sans_marche, ids_commune[["35288"]],
                                  ids_commune[["35085"]], "07:00", "20:00")
  rennes_midi <- meilleur_trajet_gtfs(rides, sans_marche, ids_commune[["35238"]],
                                      ids_commune[["35085"]], "10:00", "11:00")
  malouin_midi <- meilleur_trajet_gtfs(rides, sans_marche, ids_commune[["35288"]],
                                       ids_commune[["35085"]], "10:00", "11:00")
  expect_equal(rennes$travel_time_min, 20)
  expect_equal(rennes$departure_min, 970)
  expect_equal(rennes$arrival_min, 990)
  expect_equal(malouin$travel_time_min, 22)
  expect_equal(malouin$departure_min, 518)
  expect_equal(malouin$arrival_min, 540)
  expect_equal(rennes_midi$travel_time_min, 75)
  expect_equal(rennes_midi$departure_min, 648)
  expect_equal(rennes_midi$arrival_min, 723)
  expect_equal(malouin_midi$travel_time_min, 26)
  expect_equal(malouin_midi$departure_min, 629)
  expect_equal(malouin_midi$arrival_min, 655)
})
