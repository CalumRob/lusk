test_that("publish écrit le payload en parquet, lisible en retour", {
  payload <- compute_payload(load_fixture())
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))

  publish(payload, cible)

  indicateurs <- nanoparquet::read_parquet(file.path(cible, "indicateurs.parquet"))
  histoires <- nanoparquet::read_parquet(file.path(cible, "histoires.parquet"))
  expect_equal(nrow(indicateurs), nrow(payload$indicateurs))
  expect_equal(nrow(histoires), nrow(payload$histoires))
  expect_equal(indicateurs$value, payload$indicateurs$value)
  expect_equal(histoires$classification, payload$histoires$classification)
})

test_that("publish est un upsert : relancer écrase sans dupliquer", {
  payload <- compute_payload(load_fixture())
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))

  publish(payload, cible)
  publish(payload, cible) # idempotent

  indicateurs <- nanoparquet::read_parquet(file.path(cible, "indicateurs.parquet"))
  expect_equal(nrow(indicateurs), nrow(payload$indicateurs))
})

test_that("le backend supabase est un seam documenté, pas câblé", {
  payload <- compute_payload(load_fixture())
  expect_error(publish(payload, backend = "supabase"), "supabase")
})
