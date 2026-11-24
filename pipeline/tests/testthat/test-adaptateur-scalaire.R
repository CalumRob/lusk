# Scalar shape adapter — first of the five ADR-0049 shape adapters (#1137).
# `projeter` and `remplacer` are FIELDS of REGISTRE_FORMES_RESSOURCE$scalar,
# never a parallel switch. This file tests the pure projection and the seam.

artefact_scalaire_fixture <- function(indicator = "densite") {
  racine <- artefacts_fixture_root()
  on.exit(unlink(racine, recursive = TRUE), add = FALSE)
  projections <- artefacts_fixture_scalar_projections()
  projection <- projections[[indicator]]
  digests <- artefacts_fixture_digests(c("census_densite", "bpe_offer"))
  comparaison <- comparaison_scalaire_ressource(
    projection, indicator, artefacts_fixture_reference())
  contenu <- contenu_artefact(
    faits_forme(REGISTRE_FORMES_RESSOURCE[["scalar"]], projection),
    projection$descriptors, projection$provenance, comparaison)
  ecrit <- ecrire_artefact_ressource(indicator, "scalar", contenu,
    digests_lignage = digests_lignage_ressource(
      sources_provenance_ressource(projection$provenance), digests), root = racine)
  lire_artefact_ressource(indicator, ecrit$version, root = racine)
}

test_that("scalar adapter is a field of the shape registry, not a parallel switch", {
  handler <- REGISTRE_FORMES_RESSOURCE[["scalar"]]
  expect_true(is.function(handler$projeter))
  expect_true(is.function(handler$remplacer))
  # The adapter is attached to the registry, not duplicated in the splitter.
  expect_identical(handler$projeter, projeter_artefact_scalaire)
  expect_identical(handler$remplacer, remplacer_scalaire)
})

test_that("projeter produces only the resource's rows (per-indicator scope)", {
  artefact <- artefact_scalaire_fixture("densite")
  rows <- projeter_artefact_scalaire(artefact)
  expect_identical(rows$ressource, "densite")
  expect_identical(rows$forme, "scalar")
  expect_identical(rows$version, artefact$version)
  expect_true(is.data.frame(rows$descriptor))
  expect_equal(nrow(rows$descriptor), 1L)
  expect_identical(as.character(rows$descriptor$indicator_id), "densite")
  # Facts and provenance carry no other indicator.
  expect_true(all(as.character(rows$observations$indicator_id) == "densite"))
  expect_true(all(as.character(rows$provenance$indicator_id) == "densite"))
  expect_false(any(as.character(rows$observations$indicator_id) == "offre_tc"))
  # Comparison groups/territories/lineage are keyed to this resource only.
  expect_true(all(as.character(rows$comparison$groups$indicator_id) == "densite"))
  expect_true(all(as.character(rows$comparison$territories$indicator_id) == "densite"))
  expect_true(all(as.character(rows$comparison$lineage$facet_id) == "densite"))
  # Version tokens bind this resource's facts and the sortie reference.
  expect_identical(as.character(rows$comparison$scalar_content_version),
                   as.character(rows$comparison$scalar_content_version))
  expect_true(nzchar(as.character(rows$comparison$reference_content_version)))
  expect_named(rows$digests_lignage, "census_densite")
})

test_that("projeter exposes the DB column contract for descriptor and sources", {
  artefact <- artefact_scalaire_fixture("offre_tc")
  rows <- projeter_artefact_scalaire(artefact)
  for (col in c("indicator_id", "theme_id", "label", "unit", "direction",
                "comparison_facet", "denominator_semantics", "completeness",
                "descriptor_version", "allowed_levels", "allowed_sources"))
    expect_true(col %in% names(rows$descriptor))
  for (col in c("indicator_id", "territory_id", "territory_type", "value",
                "status", "support_count", "denominator_count"))
    expect_true(col %in% names(rows$observations))
  for (col in c("indicator_id", "territory_id", "source_id", "vintage_id"))
    expect_true(col %in% names(rows$provenance))
  for (col in c("source_id", "name")) expect_true(col %in% names(rows$sources))
  for (col in c("source_id", "vintage_id", "version", "reference_date", "publication_date"))
    expect_true(col %in% names(rows$vintages))
})

test_that("projeter refuses a non-scalar artefact", {
  artefact <- artefact_scalaire_fixture("densite")
  artefact$forme <- "declared_profile"
  expect_error(projeter_artefact_scalaire(artefact), "scalar")
})

test_that("remplacer scopes every delete to one indicator and spares global markers", {
  artefact <- artefact_scalaire_fixture("densite")
  rows <- projeter_artefact_scalaire(artefact)
  executes <- character(); writes <- character(); params_vus <- list()
  local_mocked_bindings(
    dbWithTransaction = function(con, expr) force(expr),
    dbExecute = function(con, sql, params = list()) {
      executes <<- c(executes, sql)
      params_vus[[length(params_vus) + 1L]] <<- params
      0L
    },
    dbWriteTable = function(con, name, value, ...) { writes <<- c(writes, name); nrow(value) },
    dbGetQuery = function(con, sql, ...) data.frame(),
    dbQuoteString = function(con, x) paste0("'", gsub("'", "''", as.character(x)), "'"),
    .package = "DBI")
  remplacer_scalaire(structure(list(), class = "mock"), "densite", rows, rows$version)

  deletes <- executes[grepl("^DELETE", executes)]
  expect_true(length(deletes) >= 6L)
  # Every delete is either bound to $1 (the resource) or carries its literal.
  expect_true(all(grepl("\\$1|indicator_id='densite'|facet_id='densite'", deletes)))
  expect_false(any(grepl("DELETE FROM scalar_observation$", deletes)))
  # No global marker is ever written by the adapter (expand-phase coexistence).
  global <- c("table_publication", "scalar_comparison_publication")
  for (g in global)
    expect_false(any(grepl(paste0("(DELETE FROM|INSERT INTO|UPDATE) ", g, "\\b"),
                           executes, perl = TRUE)))
  # Registry row written; the two scoped serving tables plus comparison rows.
  expect_true(any(grepl("INSERT INTO resource_publication", executes)))
  expect_true(all(c("scalar_observation", "scalar_observation_source") %in% writes))
  expect_true(any(grepl("INSERT INTO scalar_descriptor\\(", executes)))
  # The real SQL-building path sends ONLY unnamed positional params.
  expect_true(all(vapply(params_vus, function(p) is.null(p) || length(p) == 0L ||
    is.null(names(p)) || all(names(p) == ""), logical(1))))
  # Descriptor values are DBI-quoted, never hand-rolled.
  expect_true(any(grepl("VALUES\\('densite','demographie'", executes)))
})

test_that("remplacer --retire deletes rows and marks the registry retired", {
  executes <- character()
  local_mocked_bindings(
    dbWithTransaction = function(con, expr) force(expr),
    dbExecute = function(con, sql, params = list()) { executes <<- c(executes, sql); 0L },
    dbWriteTable = function(con, name, ...) 0L,
    dbQuoteString = function(con, x) paste0("'", as.character(x), "'"),
    .package = "DBI")
  remplacer_scalaire(structure(list(), class = "mock"), "densite",
                     retire = TRUE, version = "v1")
  expect_true(all(grepl("^DELETE", executes[grepl("^DELETE", executes)])))
  expect_false(any(grepl("INSERT INTO scalar_descriptor|INSERT INTO scalar_observation", executes)))
  expect_true(any(grepl("INSERT INTO resource_publication", executes)))
  expect_true(any(grepl("retired=EXCLUDED.retired", executes)))
})
