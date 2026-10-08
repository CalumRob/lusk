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
