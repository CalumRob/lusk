test_that("adoption compares the real projected artefact rows and names each differing part", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  projection <- artefacts_fixture_scalar_indicator("a", "src_a", c(10, 10, 5, 3, NA))
  reference <- artefacts_fixture_reference()
  comparison <- comparaison_scalaire_ressource(projection, "a", reference)
  contenu <- contenu_artefact(
    faits_forme(REGISTRE_FORMES_RESSOURCE[["scalar"]], projection),
    projection$descriptors, projection$provenance, comparison)
  ecrit <- ecrire_artefact_ressource("a", "scalar", contenu,
    digests_lignage = digests_lignage_ressource("src_a", artefacts_fixture_digests("src_a")),
    root = root)
  artefact <- lire_artefact_ressource("a", ecrit$version, root = root)
  handler <- REGISTRE_FORMES_RESSOURCE[["scalar"]]
  attendu <- handler$projeter(artefact)

  equal <- comparer_ressource_adoptation(attendu, attendu, handler)
  expect_true(equal$identique)
  expect_length(equal$parties, 0L)

  # PostgreSQL storage clocks are not Artefact de ressource content.
  live <- attendu
  live$observations$published_at <- as.POSIXct("2026-01-01", tz = "UTC")
  expect_true(comparer_ressource_adoptation(attendu, live, handler)$identique)

  live <- attendu
  live$observations$value[1L] <- live$observations$value[1L] + 1
  live$descriptor$label[1L] <- "Changed"
  live$comparison$territories$rank[1L] <- 999L
  different <- comparer_ressource_adoptation(attendu, live, handler)
  expect_false(different$identique)
  expect_setequal(different$parties, c("observations", "descriptor",
                                      "comparison.territories"))
})

test_that("every shape's adoption reader contract compares its real adapter projection", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  artefacts <- list(
    declared_profile = artefacts_fixture_profile_artefact(root = root)$artefact,
    owned_series = adaptateur_series_artefact(root),
    observed_collection = adaptateur_collection_artefact(root),
    aedar = adaptateur_aedar_artefact(root))
  for (forme in names(artefacts)) {
    handler <- REGISTRE_FORMES_RESSOURCE[[forme]]
    attendu <- handler$projeter(artefacts[[forme]])
    expect_true(comparer_ressource_adoptation(attendu, attendu, handler)$identique,
                info = forme)
    live <- attendu
    if (!is.null(live$comparison$groups) && nrow(live$comparison$groups))
      live$comparison$groups[1L, 1L] <- "changed"
    else if (!is.null(live$projection$points) && nrow(live$projection$points))
      live$projection$points$value[1L] <- live$projection$points$value[1L] + 1
    else if (!is.null(live$projection$facts) && nrow(live$projection$facts))
      live$projection$facts$value[1L] <- live$projection$facts$value[1L] + 1
    else live$descriptor$label[1L] <- "changed"
    expect_false(comparer_ressource_adoptation(attendu, live, handler)$identique,
                 info = forme)
  }
})
