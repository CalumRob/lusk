test_that("national GTFS matrix builder preserves every origin/destination result", {
  rides <- data.frame(
    from_stop_id = "O1", to_stop_id = "O2", trip_id = "r1",
    departure_min = 420, arrival_min = 435,
    pickup_allowed = TRUE, drop_off_allowed = TRUE,
    stringsAsFactors = FALSE
  )
  transfers <- data.frame(from_stop_id = character(), to_stop_id = character(),
                          duration_min = numeric())
  origins <- list("22001" = "O1", "22002" = "O2")
  destinations <- list("22001" = "O1", "22002" = "O2", "22003" = "D3")

  matrix <- construire_matrice_trajets_gtfs(
    rides, transfers, origins, destinations, "07:00", "20:00"
  )

  expect_equal(nrow(matrix), 6L)
  expect_named(matrix, c("origin_id", "destination_id", "reachable",
    "travel_time_min", "departure_min", "arrival_min", "transfers",
    "walking_transfers"))
  expect_type(matrix$origin_id, "character")
  expect_type(matrix$destination_id, "character")
  expect_type(matrix$reachable, "logical")
  expect_type(matrix$transfers, "integer")
  expect_equal(matrix$travel_time_min[matrix$origin_id == "22001" &
    matrix$destination_id == "22002"], 15)
  expect_true(is.na(matrix$travel_time_min[matrix$origin_id == "22001" &
    matrix$destination_id == "22003"]))
  expect_false(matrix$reachable[matrix$origin_id == "22001" &
    matrix$destination_id == "22003"])
  expect_equal(matrix$travel_time_min[matrix$origin_id == "22001" &
    matrix$destination_id == "22001"], 0)
})
