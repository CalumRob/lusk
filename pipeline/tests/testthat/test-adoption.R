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
