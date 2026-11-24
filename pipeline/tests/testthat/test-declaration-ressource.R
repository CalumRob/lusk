test_that("une déclaration de découverte ne contient que la ressource et ses contrats producteur", {
  metadata <- testthat::test_path("..", "..", "inst", "extdata", "theme-metadata")
  payload <- declaration_ressource_metadata("densite", metadata)

  expect_identical(payload$theme, "demographie")
  expect_identical(unlist(payload$indicator_keys), "densite")
  expect_identical(names(payload$sources), "densite")
  expect_identical(names(payload$scalar_contracts), "densite")
  expect_identical(names(payload$indicator_pages), "densite")
  expect_false("offre_tc" %in% names(payload$source_records))
  expect_setequal(names(payload$source_records), unlist(payload$indicator_pages$densite$sources))
})

test_that("la déclaration voyage dans le descripteur d'artefact et survit à la projection", {
  metadata <- testthat::test_path("..", "..", "inst", "extdata", "theme-metadata")
  descriptor <- data.frame(indicator_id = "densite", label = "Densité",
    stringsAsFactors = FALSE)
  attache <- attacher_declaration_ressource(descriptor, "densite", metadata)
  expect_true("discovery" %in% names(attache))

  declaration <- extraire_declaration_ressource(attache)$densite
  expect_identical(declaration$kind, "indicator")
  expect_identical(unlist(declaration$metadata$indicator_keys), "densite")
})

test_that("l'écrivain partagé lie chaque déclaration à la ressource et à sa version", {
  executes <- character(); params_vus <- list()
  local_mocked_bindings(
    dbExecute = function(con, sql, params = list()) {
      executes <<- c(executes, sql)
      params_vus[[length(params_vus) + 1L]] <<- params
      1L
    }, .package = "DBI")
  declarations <- list(
    resource_a = list(kind = "indicator", metadata = list(theme = "demo")),
    resource_b = list(kind = "indicator", metadata = list(theme = "demo")))
  ecrire_descripteurs_ressource(structure(list(), class = "mock"),
    "resource_a", "a-v1", declarations)

  expect_true(any(grepl("DELETE FROM resource_publication_descriptor", executes)))
  expect_equal(sum(grepl("INSERT INTO resource_publication_descriptor", executes)), 2L)
  expect_identical(params_vus[[2L]], list("resource_a", "resource_a", "a-v1",
    as.character(jsonlite::toJSON(declarations$resource_a, auto_unbox = TRUE,
                                  null = "null", digits = 17))))
  expect_identical(params_vus[[3L]][[1L]], "resource_b")
})

test_that("un dataset publie aussi son alias de référence nommée vers le même registre", {
  metadata <- testthat::test_path("..", "..", "inst", "extdata", "theme-metadata")
  declarations <- declarations_decouverte_ressource("raccordement_courbe", metadata)
  expect_true(all(c("raccordement_courbe", "raccordement_reference") %in%
                    names(declarations)))
  expect_identical(declarations$raccordement_reference$metadata$owned_series_routes$
                     raccordement_courbe$reference_indicator,
                   "raccordement_reference")
})

test_that("les identités sémantiques AEDAR sont dérivées du grammaire, pas d'une liste API", {
  metadata <- testthat::test_path("..", "..", "inst", "extdata", "theme-metadata")
  declarations <- declarations_semantiques_publication("aedar", metadata)
  expect_setequal(names(declarations), c("aedar_territorial_aggregate",
    "aedar_territory_summary"))
  expect_identical(names(declarations),
    unname(vapply(declarations, function(declaration) declaration$declaration$resource_id,
                  character(1))))
})
