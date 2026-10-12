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

test_that("the holiday date excludes term-only school service before journeys are searched", {
  date <- "2026-10-21" # mercredi des vacances de la Toussaint (zone B)
  last_school_wednesday <- "2026-10-14"
  trips <- data.frame(
    trip_id = c("school-only", "holiday-added", "weekday-removed"),
    service_id = c("school-term", "holiday-extra", "ordinary-wednesday"),
    stringsAsFactors = FALSE
  )
  calendar <- data.frame(
    service_id = c("school-term", "ordinary-wednesday"),
    monday = c(0, 0), tuesday = c(0, 0), wednesday = c(1, 1),
    thursday = c(0, 0), friday = c(0, 0), saturday = c(0, 0), sunday = c(0, 0),
    start_date = c("20260901", "20260901"),
    end_date = c("20261231", "20261231"),
    stringsAsFactors = FALSE
  )
  calendar_dates <- data.frame(
    service_id = c("holiday-extra", "school-term", "ordinary-wednesday"),
    date = c(date, date, date),
    exception_type = c(1L, 2L, 2L),
    stringsAsFactors = FALSE
  )
  stop_times <- data.frame(
    trip_id = rep(trips$trip_id, each = 2),
    stop_id = rep(c("O", "D"), times = 3),
    stop_sequence = rep(1:2, times = 3),
    arrival_time = c("08:00:00", "08:10:00", "09:00:00", "09:20:00", "10:00:00", "10:10:00"),
    departure_time = c("08:00:00", "08:10:00", "09:00:00", "09:20:00", "10:00:00", "10:10:00"),
    stringsAsFactors = FALSE
  )

  school_day_services <- services_gtfs_a_la_date(
    calendar, calendar_dates, last_school_wednesday
  )
  school_day_rides <- aretes_trajet_gtfs(trips, stop_times, school_day_services)
  expect_true("school-term" %in% school_day_services)
  expect_true("school-only" %in% unique(school_day_rides$trip_id))

  active <- services_gtfs_a_la_date(calendar, calendar_dates, date)
  rides <- aretes_trajet_gtfs(trips, stop_times, active)
  expect_identical(active, "holiday-extra")
  expect_identical(unique(rides$trip_id), "holiday-added")

  no_walks <- data.frame(from_stop_id = character(), to_stop_id = character(),
                         duration_min = numeric())
  result <- rechercher_trajets_gtfs_compiled(
    rides, no_walks, "O", list(destination = "D"), "07:00", "20:00"
  )
  expect_equal(result$journeys$destination$travel_time_min, 20)
  expect_equal(result$journeys$destination$departure_min, 540)
  expect_equal(result$journeys$destination$arrival_min, 560)
})

test_that("the pinned final Korrigo calendar excludes term-only service from holiday feed edges", {
  zip <- test_path("..", "..", "data", "raw",
                   "korrigo-gtfs-pan-81559-20261010T121811.zip")
  skip_if_not(file.exists(zip), "pinned final Korrigo feed absent")
  feed_hash <- function(path) {
    connection <- file(path, "rb")
    on.exit(close(connection))
    paste0(openssl::sha256(connection))
  }
  expect_identical(feed_hash(zip),
    "4d9ac5a1a7c3f662b6b684c7838f76eae2aa32a2272dd69438e1c2cb4a6aa669")

  calendar_dates <- utils::read.csv(
    unz(zip, "calendar_dates.txt"), colClasses = "character",
    stringsAsFactors = FALSE, check.names = FALSE
  )
  term_day <- services_gtfs_a_la_date(NULL, calendar_dates, "2026-10-16")
  holiday <- services_gtfs_a_la_date(NULL, calendar_dates, "2026-10-21")
  term_only_service <- setdiff(term_day, holiday)
  ordinary_service <- intersect(term_day, holiday)
  expect_gt(length(term_only_service), 0L)
  expect_gt(length(ordinary_service), 0L)

  read_gtfs <- function(member) utils::read.csv(
    unz(zip, member), colClasses = "character", stringsAsFactors = FALSE,
    check.names = FALSE
  )
  feed_trips <- read_gtfs("trips.txt")
  feed_stop_times <- read_gtfs("stop_times.txt")
  find_dated_trip <- function(service_ids, active_services) {
    for (service_id in service_ids) {
      trip_rows <- feed_trips[feed_trips$service_id == service_id, , drop = FALSE]
      if (!nrow(trip_rows)) next
      times <- feed_stop_times[feed_stop_times$trip_id %in% trip_rows$trip_id,
                               , drop = FALSE]
      rides <- aretes_trajet_gtfs(trip_rows, times, active_services)
      eligible <- which(rides$departure_min >= 420 & rides$departure_min < 1200 &
                          rides$arrival_min > rides$departure_min)
      if (length(eligible)) {
        return(list(trips = trip_rows, stop_times = times, rides = rides,
                    edge = rides[eligible[[1]], , drop = FALSE]))
      }
    }
    stop("No pinned-feed trip with a permitted first boarding was found.",
         call. = FALSE)
  }

  # Service membership is taken only from the pinned date table, not a route
  # name or ID heuristic. Use actual feed trips to prove the term-only service
  # disappears on the holiday while an ordinary shared-date service still routes.
  term_trip <- find_dated_trip(term_only_service, term_day)
  term_trip_holiday <- aretes_trajet_gtfs(
    term_trip$trips, term_trip$stop_times, holiday
  )
  expect_gt(nrow(term_trip$rides), 0L)
  expect_equal(nrow(term_trip_holiday), 0L)

  ordinary_trip <- find_dated_trip(ordinary_service, holiday)
  expect_gt(nrow(ordinary_trip$rides), 0L)
  expect_true(all(term_trip$rides$trip_id %in% term_trip$trips$trip_id))
  expect_false(any(term_trip_holiday$trip_id %in% term_trip$trips$trip_id))
  expect_true(all(ordinary_trip$rides$trip_id %in% ordinary_trip$trips$trip_id))
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

test_that("compiled event scan matches exhaustive R search on the fixed fixture", {
  rides <- data.frame(
    from_stop_id = c("O", "X", "O", "Y"),
    to_stop_id = c("X", "A", "Y", "B"),
    trip_id = c("a", "a2", "b", "b2"),
    departure_min = c(600, 620, 605, 611),
    arrival_min = c(610, 630, 610, 631)
  )
  transfers <- data.frame(from_stop_id = character(), to_stop_id = character(),
                          duration_min = numeric())
  destinations <- list(A = "A", B = "B")
  expected <- meilleurs_trajets_gtfs_multi_destination(
    rides, transfers, "O", destinations, "10:00", "11:00"
  )
  actual <- rechercher_trajets_gtfs_compiled(
    rides, transfers, "O", destinations, "10:00", "11:00"
  )
  actual_journeys <- lapply(actual$journeys, function(x) {
    x[!names(x) %in% c("transfers", "walking_transfers")]
  })
  expect_equal(actual_journeys, expected)
  expect_equal(actual$metrics$connections_scanned, nrow(rides))
})

test_that("compiled event scan preserves same-stop prohibition and minimums", {
  rides <- data.frame(
    from_stop_id = c("O", "X", "X"), to_stop_id = c("X", "D1", "D2"),
    trip_id = c("in", "too-soon", "after-minimum"),
    departure_min = c(600, 615, 620), arrival_min = c(610, 625, 630)
  )
  transfers <- data.frame(from_stop_id = character(), to_stop_id = character(),
                          duration_min = numeric())
  destinations <- list(D = c("D1", "D2"))
  rules <- data.frame(from_stop_id = "X", to_stop_id = "X",
                      transfer_type = "3", stringsAsFactors = FALSE)
  no_connection <- rechercher_trajets_gtfs_compiled(
    rides, transfers, "O", destinations, "10:00", "11:00", rules
  )
  expect_true(is.na(no_connection$journeys$D$travel_time_min))
  rules$transfer_type <- "2"; rules$min_transfer_time <- 600
  min_connection <- rechercher_trajets_gtfs_compiled(
    rides, transfers, "O", destinations, "10:00", "11:00", rules
  )
  expect_equal(min_connection$journeys$D$travel_time_min, 30)
})

test_that("compiled event scan includes walking duration and cross-stop rules", {
  rides <- data.frame(
    from_stop_id = c("O", "T", "T"), to_stop_id = c("A", "D1", "D2"),
    trip_id = c("in", "soon", "later"),
    departure_min = c(600, 615, 620), arrival_min = c(610, 625, 630)
  )
  walks <- data.frame(from_stop_id = "A", to_stop_id = "T", duration_min = 5)
  destinations <- list(D = c("D1", "D2"))
  ordinary <- rechercher_trajets_gtfs_compiled(
    rides, walks, "O", destinations, "10:00", "11:00"
  )
  expect_equal(ordinary$journeys$D$travel_time_min, 25)

  rules <- data.frame(from_stop_id = "A", to_stop_id = "T",
                      transfer_type = "3", stringsAsFactors = FALSE)
  prohibited <- rechercher_trajets_gtfs_compiled(
    rides, walks, "O", destinations, "10:00", "11:00", rules
  )
  expect_true(is.na(prohibited$journeys$D$travel_time_min))
  rules$transfer_type <- "2"; rules$min_transfer_time <- 600
  min_connection <- rechercher_trajets_gtfs_compiled(
    rides, walks, "O", destinations, "10:00", "11:00", rules
  )
  expect_equal(min_connection$journeys$D$travel_time_min, 30)
})

test_that("GTFS experiment runner evaluates an origin against every destination", {
  rides <- data.frame(
    from_stop_id = c("O", "T", "T", "O"),
    to_stop_id = c("A", "D", "D", "E"),
    trip_id = c("in", "early-out", "late-out", "direct"),
    departure_min = c(600, 622, 626, 600),
    arrival_min = c(610, 632, 636, 620),
    stringsAsFactors = FALSE
  )
  stops <- data.frame(
    stop_id = c("O", "A", "T", "D", "E"),
    stop_lat = c(48, 48, 48, 48, 48),
    stop_lon = c(-1, -0.99, -0.98, -0.97, -0.96),
    location_type = rep(0, 5),
    stringsAsFactors = FALSE
  )

  run <- function(radius) executer_experience_raccordement_gtfs(
    rides = rides,
    stops = stops,
    origines = list(origin = "O"),
    destinations = list(connected = "D", direct = "E", unreachable = "T"),
    rayon_m = radius,
    vitesse_marche_kmh = 3,
    debut_fenetre = "10:00",
    fin_fenetre = "11:00"
  )

  too_short <- run(500)
  usable <- run(1000)
  wider <- run(2000)
  expect_setequal(usable$journeys$destination_id,
                  c("connected", "direct", "unreachable"))
  connected <- usable$journeys[usable$journeys$destination_id == "connected", ]
  expect_equal(connected$travel_time_min, 36)
  expect_equal(connected$walking_transfers, 1L)
  expect_true(is.na(too_short$journeys$travel_time_min[
    too_short$journeys$destination_id == "connected"
  ]))
  expect_equal(wider$journeys$travel_time_min[
    wider$journeys$destination_id == "connected"
  ], 36)
  expect_equal(usable$diagnostics$origin_id, "origin")
  expect_true(is.finite(usable$diagnostics$search_seconds))
  expect_gt(usable$diagnostics$transfer_edges, 0)
})

test_that("compiled scan retains a later faster label for a shared stop set", {
  rides <- data.frame(
    from_stop_id = c("O", "O", "X", "X"),
    to_stop_id = c("X", "X", "Dslow", "Dfast"),
    trip_id = c("early", "late", "early2", "late2"),
    departure_min = c(600, 700, 800, 710),
    arrival_min = c(650, 705, 850, 720)
  )
  transfers <- data.frame(from_stop_id = character(), to_stop_id = character(),
                          duration_min = numeric())
  got <- rechercher_trajets_gtfs_compiled(
    rides, transfers, "O", list(D = c("Dslow", "Dfast")), "10:00", "13:00"
  )$journeys$D
  expect_equal(got$departure_min, 700)
  expect_equal(got$arrival_min, 720)
  expect_equal(got$travel_time_min, 20)
})

test_that("compiled event scan matches R search with transfer and same-trip alternatives", {
  rides <- data.frame(
    from_stop_id = c("O", "A", "A", "B", "C", "C", "B"),
    to_stop_id = c("A", "B", "C", "D1", "D2", "D3", "D4"),
    trip_id = c("t0", "t1", "t2", "t1", "t3", "t4", "t5"),
    departure_min = c(420, 430, 430, 440, 441, 450, 450),
    arrival_min = c(430, 440, 435, 450, 451, 460, 455),
    stringsAsFactors = FALSE
  )
  walks <- data.frame(from_stop_id = "B", to_stop_id = "C", duration_min = 3)
  rules <- data.frame(
    from_stop_id = c("B", "B"), to_stop_id = c("D1", "D4"),
    transfer_type = c("3", "2"), min_transfer_time = c(NA, 600),
    stringsAsFactors = FALSE
  )
  destinations <- list(first = c("D1", "D2"), second = c("D3", "D4"))
  expected <- meilleurs_trajets_gtfs_multi_destination(
    rides, walks, "O", destinations, "07:00", "08:00", rules
  )
  actual <- rechercher_trajets_gtfs_compiled(
    rides, walks, "O", destinations, "07:00", "08:00", rules
  )
  actual_journeys <- lapply(actual$journeys, function(x) {
    x[!names(x) %in% c("transfers", "walking_transfers")]
  })
  expect_equal(actual_journeys, expected)
})

test_that("compiled event scan safely reaches same-time zero-dwell fixed points", {
  rides <- data.frame(
    from_stop_id = c("O", "A", "B"), to_stop_id = c("A", "B", "D"),
    trip_id = c("first", "second", "third"),
    departure_min = c(420, 430, 430), arrival_min = c(430, 430, 435)
  )
  transfers <- data.frame(from_stop_id = character(), to_stop_id = character(),
                          duration_min = numeric())
  result <- rechercher_trajets_gtfs_compiled(
    rides, transfers, "O", list(D = "D"), "07:00", "08:00"
  )
  got <- result$journeys$D
  expect_equal(got$travel_time_min, 15)
  expect_equal(got$departure_min, 420)
  expect_equal(got$arrival_min, 435)
  expect_equal(result$metrics$stale_labels_examined, 0)
})

test_that("compiled stop index compacts dominated labels without losing routes", {
  rides <- data.frame(
    from_stop_id = c("O", "O", "X", "X"),
    to_stop_id = c("X", "X", "D1", "D2"),
    trip_id = c("feeder", "feeder", "out1", "out2"),
    departure_min = c(420, 421, 440, 445),
    arrival_min = c(430, 431, 450, 455),
    stringsAsFactors = FALSE
  )
  transfers <- data.frame(from_stop_id = character(), to_stop_id = character(),
                          duration_min = numeric())
  destinations <- list(first = "D1", second = "D2")
  expected <- meilleurs_trajets_gtfs_multi_destination(
    rides, transfers, "O", destinations, "07:00", "08:00"
  )
  actual <- rechercher_trajets_gtfs_compiled(
    rides, transfers, "O", destinations, "07:00", "08:00"
  )
  actual_journeys <- lapply(actual$journeys, function(x) {
    x[!names(x) %in% c("transfers", "walking_transfers")]
  })
  expect_equal(actual_journeys, expected)
  expect_equal(actual$metrics$stale_labels_examined, 0)
  expect_equal(actual$metrics$labels_retained, 3)
})

test_that("arrival-frontier search matches R oracle across transfer edge cases", {
  fixtures <- list(
    multiple_labels_and_noninteger_walk = list(
      rides = data.frame(
        from_stop_id = c("O", "O", "X", "X"),
        to_stop_id = c("X", "X", "D1", "D2"),
        trip_id = c("early", "later", "out1", "out2"),
        departure_min = c(420, 425, 432, 433),
        arrival_min = c(430, 431, 440, 441)
      ),
      walks = data.frame(from_stop_id = "X", to_stop_id = "Y", duration_min = 2.5),
      rules = NULL,
      destinations = list(d1 = "D1", d2 = "D2")
    ),
    noninteger_walk_cutoff = list(
      rides = data.frame(
        from_stop_id = c("O", "B", "B"), to_stop_id = c("A", "D1", "D2"),
        trip_id = c("in", "too_early", "exact_ready"),
        departure_min = c(420, 432.4, 432.5), arrival_min = c(430, 442.4, 442.5)
      ),
      walks = data.frame(from_stop_id = "A", to_stop_id = "B", duration_min = 2.5),
      rules = NULL,
      destinations = list(d = c("D1", "D2"))
    ),
    type2_threshold = list(
      rides = data.frame(
        from_stop_id = c("O", "X", "X"), to_stop_id = c("X", "D1", "D2"),
        trip_id = c("in", "too_early", "ready"),
        departure_min = c(420, 432.4, 432.5), arrival_min = c(430, 442, 442.5)
      ),
      walks = data.frame(from_stop_id = character(), to_stop_id = character(),
                         duration_min = numeric()),
      rules = data.frame(from_stop_id = "X", to_stop_id = "X",
                         transfer_type = "2", min_transfer_time = 150),
      destinations = list(d = c("D1", "D2"))
    ),
    type3_but_same_trip_continues = list(
      rides = data.frame(
        from_stop_id = c("O", "X", "X"), to_stop_id = c("X", "D1", "D2"),
        trip_id = c("through", "through", "other"),
        departure_min = c(420, 430, 430), arrival_min = c(430, 440, 441)
      ),
      walks = data.frame(from_stop_id = character(), to_stop_id = character(),
                         duration_min = numeric()),
      rules = data.frame(from_stop_id = "X", to_stop_id = "X",
                         transfer_type = "3"),
      destinations = list(d = c("D1", "D2"))
    ),
    later_start_later_arrival = list(
      rides = data.frame(
        from_stop_id = c("O", "O", "X", "X"),
        to_stop_id = c("X", "X", "D1", "D2"),
        trip_id = c("fast_arrival", "late_start", "depart1", "depart2"),
        departure_min = c(420, 425, 440, 445),
        arrival_min = c(430, 435, 450, 455)
      ),
      walks = data.frame(from_stop_id = character(), to_stop_id = character(),
                         duration_min = numeric()),
      rules = NULL,
      destinations = list(d = c("D1", "D2"))
    ),
    equal_elapsed_prefers_fewer_transfers = list(
      rides = data.frame(
        from_stop_id = c("O", "A", "O", "X"),
        to_stop_id = c("A", "X", "X", "D"),
        trip_id = c("first", "second", "direct", "last"),
        departure_min = c(420, 425, 420, 430),
        arrival_min = c(425, 430, 430, 440)
      ),
      walks = data.frame(from_stop_id = character(), to_stop_id = character(),
                         duration_min = numeric()),
      rules = NULL,
      destinations = list(d = "D")
    ),
    control_character_stop_ids = list(
      rides = data.frame(
        from_stop_id = c("O", "O", "X", "O", "A\u001eB", "A"),
        to_stop_id = c("X", "A", "A\u001eB", "A\u001eB", "D", "E"),
        trip_id = c("T", "B\u001eC", "C", "T", "C", "B\u001eC"),
        departure_min = c(420, 420, 425, 420, 430, 429),
        arrival_min = c(425, 429, 430, 430, 440, 439)
      ),
      walks = data.frame(from_stop_id = character(), to_stop_id = character(),
                         duration_min = numeric()),
      rules = NULL,
      destinations = list(d = "D", e = "E")
    )
  )

  for (fixture in fixtures) {
    expected <- meilleurs_trajets_gtfs_multi_destination(
      fixture$rides, fixture$walks, "O", fixture$destinations,
      "07:00", "08:00", fixture$rules
    )
    result <- rechercher_trajets_gtfs_compiled(
      fixture$rides, fixture$walks, "O", fixture$destinations,
      "07:00", "08:00", fixture$rules
    )
    expect_gt(result$metrics$arrival_frontier_queries, 0)
    actual <- result$journeys
    actual <- lapply(actual, function(x) {
      x[!names(x) %in% c("transfers", "walking_transfers")]
    })
    expect_equal(actual, expected)
  }
  tied <- fixtures$equal_elapsed_prefers_fewer_transfers
  tied_result <- rechercher_trajets_gtfs_compiled(
    tied$rides, tied$walks, "O", tied$destinations, "07:00", "08:00"
  )$journeys$d
  expect_equal(tied_result$travel_time_min, 20)
  expect_equal(tied_result$transfers, 1L)
  separator_ids <- fixtures$control_character_stop_ids
  separator_result <- rechercher_trajets_gtfs_compiled(
    separator_ids$rides, separator_ids$walks, "O",
    separator_ids$destinations, "07:00", "08:00"
  )$journeys
  expect_equal(separator_result$d$transfers, 1L)
  expect_equal(separator_result$e$transfers, 0L)
})

test_that("passenger access restrictions block boarding/alighting, not through travel", {
  trips <- data.frame(trip_id = "t", service_id = "s")
  times <- data.frame(
    trip_id = rep("t", 4), stop_id = c("O", "X", "Y", "D"),
    stop_sequence = 1:4,
    arrival_time = c("09:00:00", "09:10:00", "09:20:00", "09:30:00"),
    departure_time = c("09:00:00", "09:10:00", "09:20:00", "09:30:00"),
    pickup_type = c(0, 1, 2, 0), drop_off_type = c(0, 1, 2, 0)
  )
  rides <- aretes_trajet_gtfs(trips, times, "s")
  transfers <- data.frame(from_stop_id = character(), to_stop_id = character(),
                          duration_min = numeric())
  run <- function(origin, dest) {
    expected <- meilleur_trajet_gtfs(rides, transfers, origin, dest,
                                     "09:00", "10:00")
    actual <- rechercher_trajets_gtfs_compiled(
      rides, transfers, origin, setNames(list(dest), "d"), "09:00", "10:00")
    expect_equal(actual$journeys$d$travel_time_min, expected$travel_time_min)
    expected$travel_time_min
  }
  expect_equal(run("O", "D"), 30) # both blocked intermediate stops remain traversable
  expect_true(is.na(run("X", "D"))) # prohibited origin boarding
  expect_true(is.na(run("Y", "D"))) # phone-arranged origin boarding
  expect_true(is.na(run("O", "X"))) # prohibited destination alighting
  expect_true(is.na(run("O", "Y"))) # phone-arranged destination alighting

  transfer_rides <- data.frame(
    from_stop_id = c("A", "Y", "Y"), to_stop_id = c("X", "B", "B"),
    trip_id = c("in", "out1", "out2"), departure_min = c(540, 560, 560),
    arrival_min = c(550, 570, 570), pickup_allowed = c(TRUE, TRUE, TRUE),
    drop_off_allowed = c(FALSE, TRUE, TRUE)
  )
  links <- data.frame(from_stop_id = "X", to_stop_id = "Y", duration_min = 0)
  expect_true(is.na(meilleur_trajet_gtfs(transfer_rides, links, "A", "B",
                                        "09:00", "10:00")$travel_time_min))
  blocked_walk_compiled <- rechercher_trajets_gtfs_compiled(
    transfer_rides, links, "A", list(B = "B"), "09:00", "10:00")
  expect_true(is.na(blocked_walk_compiled$journeys$B$travel_time_min))
  transfer_rides$drop_off_allowed[1] <- TRUE
  transfer_rides$pickup_allowed[2] <- FALSE
  transfer_rides$pickup_allowed[3] <- FALSE
  expect_true(is.na(meilleur_trajet_gtfs(transfer_rides, links, "A", "B",
                                        "09:00", "10:00")$travel_time_min))
  blocked_board_compiled <- rechercher_trajets_gtfs_compiled(
    transfer_rides, links, "A", list(B = "B"), "09:00", "10:00")
  expect_true(is.na(blocked_board_compiled$journeys$B$travel_time_min))
  transfer_rides$pickup_allowed[3] <- TRUE
  expect_equal(meilleur_trajet_gtfs(transfer_rides, links, "A", "B",
                                    "09:00", "10:00")$travel_time_min, 30)
  compiled_transfer <- rechercher_trajets_gtfs_compiled(
    transfer_rides, links, "A", list(B = "B"), "09:00", "10:00")
  expect_equal(compiled_transfer$journeys$B$travel_time_min, 30)

  mixed <- data.frame(
    from_stop_id = c("O", "O", "X"), to_stop_id = c("X", "X", "D"),
    trip_id = c("fast-no-exit", "slower-usable", "out"),
    departure_min = c(540, 545, 560), arrival_min = c(550, 555, 570),
    pickup_allowed = TRUE, drop_off_allowed = c(FALSE, TRUE, TRUE)
  )
  mixed_walk <- data.frame(from_stop_id = character(), to_stop_id = character(), duration_min = numeric())
  expect_equal(meilleur_trajet_gtfs(mixed, mixed_walk, "O", "D", "09:00", "10:00")$travel_time_min, 25)
  mixed_compiled <- rechercher_trajets_gtfs_compiled(mixed, mixed_walk, "O", list(D = "D"), "09:00", "10:00")
  expect_equal(mixed_compiled$journeys$D$travel_time_min, 25)

  default_times <- times[c("trip_id", "stop_id", "stop_sequence", "arrival_time", "departure_time")]
  defaults <- aretes_trajet_gtfs(trips, default_times, "s")
  expect_equal(meilleur_trajet_gtfs(defaults, transfers, "O", "D", "09:00", "10:00")$travel_time_min, 30)
  expect_equal(nrow(defaults), 3L)
  unknown_access <- times
  unknown_access$pickup_type[2] <- 3
  expect_error(aretes_trajet_gtfs(trips, unknown_access, "s"), "non pris en charge")
  unknown_access <- times
  unknown_access$drop_off_type[2] <- 3
  expect_error(aretes_trajet_gtfs(trips, unknown_access, "s"), "non pris en charge")
})

test_that("zero-duration restricted stop-time continues onboard through same-time closure", {
  rides <- data.frame(
    # Downstream row comes first: the event scan must revisit it after seeding.
    from_stop_id = c("X", "O"), to_stop_id = c("D", "X"),
    trip_id = c("through", "through"), departure_min = c(540, 540),
    arrival_min = c(540, 540), pickup_allowed = c(FALSE, TRUE),
    drop_off_allowed = c(TRUE, FALSE)
  )
  walks <- data.frame(from_stop_id = character(), to_stop_id = character(), duration_min = numeric())
  reference <- meilleurs_trajets_gtfs_multi_destination(
    rides, walks, "O", list(restricted = "X", beyond = "D"), "09:00", "10:00")
  compiled <- rechercher_trajets_gtfs_compiled(
    rides, walks, "O", list(restricted = "X", beyond = "D"), "09:00", "10:00")
  expect_true(is.na(reference$restricted$travel_time_min))
  expect_true(is.na(compiled$journeys$restricted$travel_time_min))
  expect_equal(reference$beyond$travel_time_min, 0)
  expect_equal(compiled$journeys$beyond$travel_time_min, 0)
  expect_equal(compiled$journeys$beyond$departure_min, 540)
  expect_equal(compiled$journeys$beyond$arrival_min, 540)
  expect_equal(compiled$journeys$beyond$transfers, 0L)
})

test_that("same-trip stop revisits retain the alightable label for a transfer", {
  rides <- data.frame(
    from_stop_id = c("O", "O", "Y", "X"),
    to_stop_id = c("X", "Y", "X", "D"),
    trip_id = c("loop", "loop", "loop", "out"),
    departure_min = c(540, 545, 550, 560),
    arrival_min = c(550, 550, 555, 570),
    pickup_allowed = c(TRUE, TRUE, TRUE, TRUE),
    drop_off_allowed = c(FALSE, TRUE, TRUE, TRUE)
  )
  walks <- data.frame(from_stop_id = character(), to_stop_id = character(), duration_min = numeric())
  expected <- meilleur_trajet_gtfs(rides, walks, "O", "D", "09:00", "10:00")
  actual <- rechercher_trajets_gtfs_compiled(rides, walks, "O", list(D = "D"), "09:00", "10:00")
  expect_equal(expected$travel_time_min, 25)
  expect_equal(actual$journeys$D$travel_time_min, 25)
  expect_equal(actual$journeys$D$departure_min, 545)
  expect_equal(actual$journeys$D$arrival_min, 570)
  expect_equal(actual$journeys$D$transfers, 1L)
})

test_that("same-stop transfers require both alighting and outgoing boarding", {
  rides <- data.frame(
    from_stop_id = c("O", "X"), to_stop_id = c("X", "D"),
    trip_id = c("in", "out"), departure_min = c(540, 555),
    arrival_min = c(550, 565), pickup_allowed = c(TRUE, TRUE),
    drop_off_allowed = c(FALSE, TRUE)
  )
  walks <- data.frame(from_stop_id = character(), to_stop_id = character(), duration_min = numeric())
  get_pair <- function() list(
    r = meilleur_trajet_gtfs(rides, walks, "O", "D", "09:00", "10:00"),
    c = rechercher_trajets_gtfs_compiled(rides, walks, "O", list(D = "D"), "09:00", "10:00")$journeys$D
  )
  blocked_alighting <- get_pair()
  expect_true(is.na(blocked_alighting$r$travel_time_min))
  expect_true(is.na(blocked_alighting$c$travel_time_min))
  rides$drop_off_allowed[1] <- TRUE
  rides$pickup_allowed[2] <- FALSE
  blocked_boarding <- get_pair()
  expect_true(is.na(blocked_boarding$r$travel_time_min))
  expect_true(is.na(blocked_boarding$c$travel_time_min))
  rides$pickup_allowed[2] <- TRUE
  accessible <- get_pair()
  expect_equal(accessible$r$travel_time_min, 25)
  expect_equal(accessible$c$travel_time_min, 25)
})

test_that("raw empty and NA passenger access fields default regular in both routers", {
  trips <- data.frame(trip_id = "t", service_id = "s")
  times <- data.frame(
    trip_id = rep("t", 3), stop_id = c("O", "X", "D"), stop_sequence = 1:3,
    arrival_time = c("09:00:00", "09:15:00", "09:30:00"),
    departure_time = c("09:00:00", "09:15:00", "09:30:00"),
    pickup_type = c(NA_character_, "", ""),
    drop_off_type = c("", "", NA_character_)
  )
  rides <- aretes_trajet_gtfs(trips, times, "s")
  transfers <- data.frame(from_stop_id = character(), to_stop_id = character(), duration_min = numeric())
  expect_true(all(rides$pickup_allowed))
  expect_true(all(rides$drop_off_allowed))
  expected <- meilleur_trajet_gtfs(rides, transfers, "O", "D", "09:00", "10:00")
  actual <- rechercher_trajets_gtfs_compiled(rides, transfers, "O", list(D = "D"), "09:00", "10:00")
  expect_equal(expected$travel_time_min, 30)
  expect_equal(actual$journeys$D$travel_time_min, 30)
})

test_that("public router seams reject unknown derived passenger eligibility", {
  rides <- data.frame(from_stop_id = "O", to_stop_id = "D", trip_id = "t",
                      departure_min = 540, arrival_min = 550,
                      pickup_allowed = NA, drop_off_allowed = TRUE)
  walks <- data.frame(from_stop_id = character(), to_stop_id = character(), duration_min = numeric())
  expect_error(meilleur_trajet_gtfs(rides, walks, "O", "D", "09:00", "10:00"),
               "pickup_allowed.*absente")
  expect_error(rechercher_trajets_gtfs_compiled(rides, walks, "O", list(D = "D"),
                                               "09:00", "10:00"),
               "pickup_allowed.*absente")
  rides$pickup_allowed <- TRUE
  rides$drop_off_allowed <- NA
  expect_error(meilleur_trajet_gtfs(rides, walks, "O", "D", "09:00", "10:00"),
               "drop_off_allowed.*absente")
  expect_error(rechercher_trajets_gtfs_compiled(rides, walks, "O", list(D = "D"),
                                               "09:00", "10:00"),
               "drop_off_allowed.*absente")
})

test_that("empty GTFS ride builders preserve the populated edge schema", {
  trips <- data.frame(trip_id = "t", service_id = "s", route_id = "r")
  times <- data.frame(trip_id = "t", stop_id = "A", stop_sequence = 1,
                      arrival_time = "09:00:00", departure_time = "09:00:00")
  empty <- aretes_trajet_gtfs(trips, times, "inactive")
  expect_named(empty, c("from_stop_id", "to_stop_id", "trip_id", "route_id",
                        "departure_min", "arrival_min", "pickup_allowed",
                        "drop_off_allowed"))
  expect_type(empty$pickup_allowed, "logical")
  expect_type(empty$drop_off_allowed, "logical")
  one_stop <- aretes_trajet_gtfs(trips, times, "s")
  expect_named(one_stop, names(empty))
  expect_type(one_stop$pickup_allowed, "logical")
  expect_type(one_stop$drop_off_allowed, "logical")
})

test_that("compiled search skips prefix scans for stops with no active labels", {
  rides <- data.frame(
    from_stop_id = c("U", "X"),
    to_stop_id = c("X", "D"),
    trip_id = c("unreachable", "outgoing"),
    departure_min = c(420, 430),
    arrival_min = c(425, 435),
    stringsAsFactors = FALSE
  )
  transfers <- data.frame(from_stop_id = character(), to_stop_id = character(),
                          duration_min = numeric())
  destinations <- list(d = "D")
  expected <- meilleurs_trajets_gtfs_multi_destination(
    rides, transfers, "O", destinations, "07:00", "08:00"
  )
  result <- rechercher_trajets_gtfs_compiled(
    rides, transfers, "O", destinations, "07:00", "08:00"
  )

  expect_equal(result$journeys$d$travel_time_min, expected$d$travel_time_min)
  expect_true(is.na(result$journeys$d$travel_time_min))
  expect_gt(result$metrics$arrival_frontier_empty_skips, 0)
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
