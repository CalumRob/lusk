test_that("the checked-in final-feed matrix receipt binds the full candidate to its inputs", {
  path <- test_path("..", "..", "inst", "extdata",
                    "raccordement_national_matrix_rebuild_receipt_20261021.json")
  receipt <- jsonlite::read_json(path, simplifyVector = FALSE)

  expect_identical(receipt$schema,
    "lusk-raccordement-national-matrix-rebuild-receipt-v1")
  expect_identical(receipt$status, "complete-candidate-only-not-production")
  expect_equal(receipt$coverage$origins, 664)
  expect_equal(receipt$coverage$destinations_per_origin, 1202)
  expect_equal(receipt$coverage$OD_rows, 798128)
  expect_equal(receipt$coverage$reachable_rows, 431327)
  expect_equal(receipt$coverage$unreachable_rows, 366801)
  expect_true(receipt$parity$all_public_journey_fields_equal_after_key_sort)
  expect_identical(receipt$provenance$reference_matrix_sha256,
    "ae3c7e37bc788010968855d949e875f45481c7e05f80a98718f980a8841a4df5")
  expect_identical(receipt$outputs$matrix_rds_sha256,
    "ae3c7e37bc788010968855d949e875f45481c7e05f80a98718f980a8841a4df5")
  expect_identical(receipt$provenance$runner_sha256,
    "ed48996162fdb00b54d2244a7f433a035c017ef61c98381189e6a2f177b26ca6")
  expect_identical(receipt$provenance$runner_sha256,
    empreinte_source_raccordement(test_path("..", "..", "scripts",
      "rebuild-raccordement-national-candidate.R")))
  expect_identical(receipt$provenance$provenance_helper_sha256,
    empreinte_source_raccordement(test_path("..", "..", "R",
      "provenance_raccordement.R")))
  expect_identical(receipt$provenance$preparation_router_cpp_sha256,
    "9cc302a12103b9c8b5e1336ee6990268eabd9a3a9765cf0386d65eb4294ec310")
  expect_identical(receipt$provenance$router_cpp_sha256,
    "f36f09ebedb4d92898ecd2b6ca7b6c4dcdf207b497591e644e6434787732c876")
  expect_equal(receipt$provenance$passenger_access$pickup_restricted_ride_edges, 7543)
  expect_equal(receipt$provenance$passenger_access$dropoff_restricted_ride_edges, 7660)
  expect_equal(receipt$provenance$passenger_access$any_restricted_ride_edges, 9780)
  expect_true(receipt$parity$all_public_journey_fields_equal_after_key_sort)
  expect_equal(receipt$parity$changed_OD_rows, 0)
})

test_that("the checked-in transfer sensitivity receipt documents its sampled scope and parity", {
  path <- test_path("..", "..", "inst", "extdata",
                    "raccordement_national_transfer_sensitivity_20261021.json")
  receipt <- jsonlite::read_json(path, simplifyVector = FALSE)

  expect_identical(receipt$schema,
    "lusk-raccordement-final-feed-transfer-sensitivity-v1")
  expect_identical(receipt$status, "complete-candidate-only-not-production")
  expect_equal(receipt$design$origin_count, 7)
  expect_equal(receipt$design$destinations_per_origin, 1202)
  expect_equal(as.numeric(unlist(receipt$design$radii_m)), c(500, 1000, 2000))
  expect_true(receipt$baseline_parity$all_public_journey_fields_equal)
  expect_equal(receipt$baseline_parity$OD_rows, 8414)
  expect_identical(receipt$provenance$final_input_sha256$korrigo,
    "4d9ac5a1a7c3f662b6b684c7838f76eae2aa32a2272dd69438e1c2cb4a6aa669")
  expect_identical(receipt$provenance$preparation_sha256,
    "d454f5c15734096f170ff2fd5dec1df4e01eadafd8f3d954adba0f5ea046f1b0")
  expect_identical(receipt$provenance$matrix_builder_source_sha256,
    "7454aede9e2fdda93a011fc475fe25b9020cc152a9a78e57476fa1a9a5e22bab")
  expect_identical(receipt$provenance$runner_sha256,
    "8458da342dddd0b29d21d28257b73424b8eee28a8b410d295d1a5d1dd898952f")
  expect_identical(receipt$provenance$runner_sha256,
    empreinte_source_raccordement(test_path("..", "..", "scripts",
      "benchmark-raccordement-final-feed-sensitivity.R")))
  expect_identical(receipt$provenance$provenance_helper_sha256,
    empreinte_source_raccordement(test_path("..", "..", "R",
      "provenance_raccordement.R")))
  expect_identical(receipt$provenance$router_cpp_sha256,
    "f36f09ebedb4d92898ecd2b6ca7b6c4dcdf207b497591e644e6434787732c876")
  expect_equal(receipt$provenance$passenger_access$any_restricted_ride_edges, 9780)
  expect_identical(receipt$provenance$reference_matrix_sha256,
    "ae3c7e37bc788010968855d949e875f45481c7e05f80a98718f980a8841a4df5")
  expect_identical(receipt$design$comparison_reference,
    "full current-router candidate matrix, same seven origins, all public journey fields")
})

test_that("the refreshed candidate curves retain the assessment roster and bind the access-aware rebuild", {
  envelope_path <- test_path("..", "..", "inst", "extdata",
    "raccordement_national_outbound_v1.rds")
  receipt_path <- test_path("..", "..", "inst", "extdata",
    "raccordement_national_curves_refresh_receipt_20261021.json")
  envelope <- readRDS(envelope_path)
  receipt <- jsonlite::read_json(receipt_path, simplifyVector = FALSE)

  expect_equal(nrow(envelope$outputs$commune_membership), 1202L)
  expect_equal(sum(envelope$outputs$commune_membership$eligible_first_boarding_origin), 664L)
  expect_identical(receipt$schema,
    "lusk-raccordement-national-curves-refresh-receipt-v1")
  expect_identical(receipt$status, "complete-candidate-only-not-production")
  expect_identical(receipt$matrix_sha256,
    "ae3c7e37bc788010968855d949e875f45481c7e05f80a98718f980a8841a4df5")
  expect_identical(receipt$router_cpp_sha256,
    "f36f09ebedb4d92898ecd2b6ca7b6c4dcdf207b497591e644e6434787732c876")
  expect_identical(receipt$output$envelope_sha256,
    empreinte_fichier_raccordement(envelope_path))
})

test_that("source fingerprints are stable across Windows and Unix line endings", {
  lf <- tempfile(fileext = ".R")
  crlf <- tempfile(fileext = ".R")
  on.exit(unlink(c(lf, crlf)))
  source <- charToRaw("x <- 1\ny <- 2\n")
  writeBin(source, lf)
  writeBin(charToRaw("x <- 1\r\ny <- 2\r\n"), crlf)

  expect_identical(empreinte_source_raccordement(lf),
                   empreinte_source_raccordement(crlf))
})
