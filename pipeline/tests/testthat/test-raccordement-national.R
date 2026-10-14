test_that("national outbound calculation uses destination population and all assessed communes", {
  minutes <- seq.int(0L, 360L, 5L)
  population <- tibble::tibble(code_commune = c("11111", "22222", "33333"),
                               population = c(100, 200, 700))
  membership <- tibble::tibble(
    code = c("11111", "22222", "33333"),
    population_2023 = c(100, 200, 700),
    epci_code = c("E1", "E1", "E2"),
    epci_reference_name = c("EPCI 1", "EPCI 1", "EPCI 2"),
    department_code = c("22", "22", "29"), region_code = "53",
    density_class_code = c("1", "1", "2"),
    density_class_registered_label = c("classe une", "classe une", "classe deux"),
    endpoint_stop_count = c(1L, 1L, 0L),
    eligible_first_boarding_origin = c(TRUE, TRUE, FALSE),
    structural_zero_reason = c(NA_character_, NA_character_, "no_modeled_endpoint_stops"),
    assessed = TRUE, calculation_status = "complete")
  matrix <- tibble::tibble(
    origin_id = c("11111", "11111", "11111", "22222", "22222", "22222"),
    destination_id = c("11111", "22222", "33333", "11111", "22222", "33333"),
    reachable = c(TRUE, TRUE, TRUE, TRUE, TRUE, FALSE),
    travel_time_min = c(0, 20, 90, 60, 0, NA),
    departure_min = c(420, 420, 480, 420, 420, NA),
    arrival_min = c(420, 440, 570, 480, 420, NA),
    transfers = c(NA_integer_, 0L, 1L, 0L, 0L, NA_integer_),
    walking_transfers = c(NA_integer_, 0L, 0L, 0L, 0L, NA_integer_))

  result <- calculer_raccordement_national(matrix, population, membership)

  a <- result$commune_curves |> dplyr::filter(code == "11111")
  expect_equal(a$share[a$minute == 0], 0.1)
  expect_equal(a$share[a$minute == 20], 0.3)
  expect_equal(a$share[a$minute == 90], 1)
  expect_equal(result$commune_scalars$share_90[result$commune_scalars$code == "11111"], 1)
  expect_equal(nrow(result$commune_curves), 3L * 73L)
  expect_true(all(result$commune_curves$share[result$commune_curves$code == "33333"] == 0))

  e1 <- result$aggregate_curves |> dplyr::filter(level == "epci", group_code == "E1", minute == 90)
  expect_equal(e1$share_mean, mean(c(1, 0.3)))
  expect_equal(e1$members_expected, 2L)
  expect_equal(e1$structural_zero_members, 0L)
  region <- result$aggregate_curves |> dplyr::filter(level == "region", minute == 90)
  expect_equal(region$share_mean, mean(c(1, 0.3, 0)))
  expect_equal(region$members_expected, 3L)
  expect_equal(region$structural_zero_members, 1L)
  expect_equal(result$aggregate_scalars$share_mean_90[result$aggregate_scalars$level == "region"],
               region$share_mean)
  expect_identical(unique(result$regional_mean_reference$reference_name),
    "Bretagne — moyenne des 3 courbes communales évaluées")
  expect_identical(unique(result$regional_mean_reference$reference_statistic),
    "equal arithmetic mean over all 3 assessed commune curves, including 1 complete structural model-zero curves")
})

test_that("national outbound calculation rejects partial curves and malformed directed OD inputs", {
  population <- tibble::tibble(code_commune = c("11111", "22222"), population = c(400, 600))
  membership <- tibble::tibble(
    code = c("11111", "22222"), epci_code = c("E1", "E1"),
    population_2023 = c(400, 600),
    epci_reference_name = c("EPCI 1", "EPCI 1"), department_code = "22",
    region_code = "53", density_class_code = "1",
    density_class_registered_label = "classe une", endpoint_stop_count = c(1L, 0L),
    eligible_first_boarding_origin = c(TRUE, FALSE),
    structural_zero_reason = c(NA_character_, "no_modeled_endpoint_stops"),
    assessed = TRUE, calculation_status = "complete")
  matrix <- tibble::tibble(origin_id = "11111", destination_id = c("11111", "22222"),
    reachable = TRUE, travel_time_min = c(0, 693), departure_min = c(420, 420),
    arrival_min = c(420, 1113), transfers = 0L, walking_transfers = 0L)
  expect_no_error(calculer_raccordement_national(matrix, population, membership))
  expect_error(calculer_raccordement_national(matrix[-1, ], population, membership),
               "completed origin|origin|coverage")
  bad <- matrix
  bad$travel_time_min[2] <- NA_real_
  expect_error(calculer_raccordement_national(bad, population, membership),
               "reachable|finite|journey")
  bad_membership <- membership
  bad_membership$eligible_first_boarding_origin[2] <- TRUE
  bad_membership$structural_zero_reason[2] <- NA_character_
  expect_error(calculer_raccordement_national(matrix, population, bad_membership),
               "origin|eligible|matrix")
})

test_that("national outbound calculation reports an eligible commune without a valid zero-minute self-route", {
  population <- tibble::tibble(code_commune = c("11111", "22222"), population = c(400, 600))
  membership <- tibble::tibble(
    code = c("11111", "22222"), epci_code = c("E1", "E1"),
    population_2023 = c(400, 600), epci_reference_name = c("EPCI 1", "EPCI 1"),
    department_code = "22", region_code = "53", density_class_code = "1",
    density_class_registered_label = "classe une", endpoint_stop_count = c(1L, 0L),
    eligible_first_boarding_origin = c(TRUE, FALSE),
    structural_zero_reason = c(NA_character_, "no_modeled_endpoint_stops"),
    assessed = TRUE, calculation_status = "complete")
  matrix <- tibble::tibble(
    origin_id = c("11111", "11111"), destination_id = c("11111", "22222"),
    reachable = c(FALSE, TRUE), travel_time_min = c(NA_real_, 20),
    departure_min = c(NA_real_, 420), arrival_min = c(NA_real_, 440),
    transfers = c(NA_integer_, 0L), walking_transfers = c(NA_integer_, 0L))

  expect_error(calculer_raccordement_national(matrix, population, membership),
               "self route.*11111")
})

test_that("national outbound calculation names both communes for a missing directed journey", {
  population <- tibble::tibble(code_commune = c("11111", "22222"), population = c(400, 600))
  membership <- tibble::tibble(
    code = c("11111", "22222"), epci_code = c("E1", "E1"),
    population_2023 = c(400, 600), epci_reference_name = c("EPCI 1", "EPCI 1"),
    department_code = "22", region_code = "53", density_class_code = "1",
    density_class_registered_label = "classe une", endpoint_stop_count = c(1L, 0L),
    eligible_first_boarding_origin = c(TRUE, FALSE),
    structural_zero_reason = c(NA_character_, "no_modeled_endpoint_stops"),
    assessed = TRUE, calculation_status = "complete")
  matrix <- tibble::tibble(
    origin_id = c("11111", "11111"), destination_id = c("11111", "22222"),
    reachable = c(TRUE, TRUE), travel_time_min = c(0, 20),
    departure_min = c(420, 420), arrival_min = c(420, 440),
    transfers = c(0L, 0L), walking_transfers = c(0L, 0L))

  expect_no_error(calculer_raccordement_national(matrix, population, membership))
  expect_error(calculer_raccordement_national(matrix[-2, ], population, membership),
               "11111.*22222")
})

test_that("pinned national artifact is byte-verified and contains the uncapped matrix contract", {
  artifact <- lire_artefact_raccordement_national()
  expect_identical(artifact$metadata$schema,
                   "lusk-national-outbound-zero-inclusive-raccordement-candidate-v1")
  expect_identical(artifact$matrix_sha256, MATRICE_RACCORDEMENT_NATIONAL_SHA256)
  expect_equal(nrow(artifact$matrix), 798128L)
  expect_equal(sum(artifact$matrix$reachable), 431327L)
  expect_equal(max(artifact$matrix$travel_time_min[artifact$matrix$reachable]), 693)
  expect_equal(nrow(artifact$membership), 1202L)
  expect_equal(sum(artifact$membership$eligible_first_boarding_origin), 664L)
  expect_equal(sum(!artifact$membership$eligible_first_boarding_origin), 538L)
  expect_identical(artifact$metadata$source_provenance$router_cpp_sha256,
    "f36f09ebedb4d92898ecd2b6ca7b6c4dcdf207b497591e644e6434787732c876")
  expect_identical(artifact$metadata$source_provenance$matrix_rds$sha256,
    MATRICE_RACCORDEMENT_NATIONAL_SHA256)
  rows <- lignes_indicateurs_raccordement_national(artifact$calculation,
                                                    vintages_mobilite())
  expect_equal(sum(rows$key == "raccordement_courbe"), 1268L * 73L)
  expect_equal(sum(rows$key == "raccordement_reference"), 73L)
  model_zero <- rows[rows$key == "raccordement_courbe" & rows$code == "22001", ]
  expect_true(all(model_zero$value == 0))
  expect_true(all(model_zero$rider == "no_modeled_endpoint_stops"))
  expect_true(all(model_zero$observation_period == "2026-10-21"))
})

test_that("the pinned artifact calculates the independently reviewed Combourg journey and curve", {
  artifact <- lire_artefact_raccordement_national()
  combourg_curve <- artifact$calculation$commune_curves[
    artifact$calculation$commune_curves$code == "35085" &
      artifact$calculation$commune_curves$minute == 90, , drop = FALSE
  ]
  saved_journeys <- artifact$matrix[
    artifact$matrix$origin_id == "35085" &
      artifact$matrix$destination_id %in% c("35238", "35288"), , drop = FALSE
  ]
  inbound_to_combourg <- artifact$matrix[
    artifact$matrix$origin_id %in% c("35238", "35288") &
      artifact$matrix$destination_id == "35085", , drop = FALSE
  ]

  expect_equal(combourg_curve$share, 0.315322508168, tolerance = 1e-12)
  expect_equal(saved_journeys$travel_time_min[match("35238", saved_journeys$destination_id)], 19)
  expect_equal(saved_journeys$travel_time_min[match("35288", saved_journeys$destination_id)], 26)
  expect_equal(inbound_to_combourg$travel_time_min[
    match("35238", inbound_to_combourg$origin_id)], 20)
  expect_equal(inbound_to_combourg$travel_time_min[
    match("35288", inbound_to_combourg$origin_id)], 22)
  expect_equal(inbound_to_combourg$departure_min[
    match("35238", inbound_to_combourg$origin_id)], 970)
  expect_equal(inbound_to_combourg$departure_min[
    match("35288", inbound_to_combourg$origin_id)], 518)
  expect_identical(artifact$metadata$method$direction,
    "outbound: from eligible commune origin stops to reachable destination commune stop sets")
})

test_that("national artifact verifier rejects altered bytes and incomplete OD matrix", {
  artifact <- lire_artefact_raccordement_national()
  expect_error(verifier_contrat_artefact_raccordement_national(
    artifact, chemin_matrice = tempfile("missing-matrix-")), "matrix|file|missing")
  bad <- artifact
  bad$matrix <- bad$matrix[-1, ]
  expect_error(verifier_contrat_artefact_raccordement_national(bad, verifier_octets = FALSE),
               "row|coverage|complete")
})
