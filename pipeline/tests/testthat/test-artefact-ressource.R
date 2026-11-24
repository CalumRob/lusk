test_that("un Artefact de ressource est immuable : réécrire la même version est un no-op vérifié", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  contenu <- list(
    faits = data.frame(indicator_id = "densite", territory_id = "c1", value = 1),
    descriptor = list(indicator_id = "densite", label = "Densité"),
    provenance = data.frame(source_id = "census_densite", vintage_id = "2020"),
    comparison = NULL
  )

  premier <- ecrire_artefact_ressource("densite", "scalar", contenu,
    digests_lignage = artefacts_fixture_digests("census_densite"), root = root)
  expect_identical(premier$statut, "new")
  expect_match(premier$version, "^[a-f0-9]{32}$")
  dossier <- file.path(root, "densite", premier$version)
  expect_true(dir.exists(dossier))
  avant <- file.info(file.path(dossier, "manifest.json"))$mtime

  second <- ecrire_artefact_ressource("densite", "scalar", contenu,
    digests_lignage = artefacts_fixture_digests("census_densite"), root = root)
  expect_identical(second$version, premier$version)
  expect_identical(second$statut, "unchanged")
  expect_identical(file.info(file.path(dossier, "manifest.json"))$mtime, avant)

  relu <- lire_artefact_ressource("densite", premier$version, root = root)
  expect_identical(relu$version, premier$version)
  expect_identical(relu$forme, "scalar")
  expect_equal(relu$contenu$faits, contenu$faits)
  expect_identical(relu$contenu$descriptor, contenu$descriptor)
  expect_identical(names(relu$digests_lignage), "census_densite")
})

test_that("un contenu différent donne une autre Version de ressource publiée sans écraser la précédente", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  base <- list(faits = data.frame(value = 1), descriptor = list(label = "Un"),
    provenance = data.frame(source_id = "s1", vintage_id = "v1"), comparison = NULL)
  modifie <- base
  modifie$faits$value <- 2

  v1 <- ecrire_artefact_ressource("une_ressource", "scalar", base, root = root)
  v2 <- ecrire_artefact_ressource("une_ressource", "scalar", modifie, root = root)
  expect_false(identical(v1$version, v2$version))
  expect_true(dir.exists(file.path(root, "une_ressource", v1$version)))
  expect_true(dir.exists(file.path(root, "une_ressource", v2$version)))
  versions <- lister_artefacts_ressource(root = root)
  expect_setequal(versions$version, c(v1$version, v2$version))
})

test_that("le sélecteur de rétention est pur : versions publiées et dernier build non publié", {
  builds <- data.frame(
    ressource = c("a", "a", "a", "a", "b", "b"),
    version = c("v1", "v2", "v3", "v4", "w1", "w2"),
    built_at = c(1, 2, 3, 4, 1, 2)
  )
  publiees <- data.frame(ressource = c("a", "a", "b"), version = c("v1", "v3", "w1"))
  avant <- builds

  selection <- selection_retention_artefacts(builds, publiees)

  expect_setequal(selection$conserver$version, c("v1", "v3", "v4", "w1", "w2"))
  expect_setequal(selection$retirer$version, "v2")
  expect_identical(selection$conserver$raison[selection$conserver$version %in% c("v4", "w2")],
    rep("dernier_build_non_publie", 2L))
  expect_identical(builds, avant)
})

test_that("les digests de lignage portent exactement les source_id de la provenance", {
  digests <- artefacts_fixture_digests(c("s1", "s2", "s3"))
  retenus <- digests_lignage_ressource(c("s1", "s3", "s1"), digests)
  expect_setequal(names(retenus), c("s1", "s3"))
  expect_identical(retenus$s1$sha256, "sha256-s1")

  sans_digest <- digests_lignage_ressource("s4", digests)
  expect_identical(names(sans_digest), "s4")
  expect_true(is.na(sans_digest$s4$sha256))
})
