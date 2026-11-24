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

test_that("chemin_enveloppe_raccordement résout l'épingle pour un répertoire de sortie (#1070)", {
  sortie <- tempfile("sortie-raccordement-")
  dir.create(sortie)
  on.exit(unlink(sortie, recursive = TRUE), add = TRUE)

  attendu <- file.path(sortie, RACCORDEMENT_NATIONAL_ENVELOPPE_FICHIER)
  expect_identical(chemin_enveloppe_raccordement(sortie), attendu)

  # la cible format = "file" rend le CHEMIN DU FICHIER : il est rendu tel quel,
  # jamais réutilisé comme base de répertoire (la cause du bug #1070)
  expect_identical(chemin_enveloppe_raccordement(attendu), attendu)
  expect_false(grepl(paste0(RACCORDEMENT_NATIONAL_ENVELOPPE_FICHIER, "/"),
                     chemin_enveloppe_raccordement(attendu), fixed = TRUE))
  expect_false(grepl("raccordement_mobilite.rds",
                     chemin_enveloppe_raccordement(attendu), fixed = TRUE))

  # sans argument : l'épingle du package
  expect_identical(chemin_enveloppe_raccordement(NULL),
                   chemin_artefact_raccordement_national())
})
