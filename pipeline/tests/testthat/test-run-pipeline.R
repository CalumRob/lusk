test_that("run_pipeline est l'entrée unique, sur les dossiers du dépôt", {
  expect_type(run_pipeline, "closure")
  # les chemins par défaut vivent dans le dépôt (jamais sur C:)
  expect_equal(formals(run_pipeline)$cache, "data/raw")
  expect_equal(formals(run_pipeline)$sortie, "data/processed")
})
