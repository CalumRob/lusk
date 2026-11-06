# Les générations de modèles (#890/#891) et leurs artefacts (#900) sont retirés.
# Le contrôle des anciennes projections bâtiment est retiré avec la rampe
# (#912) ; l'adaptateur Programmes reste utilisé par projection_programmes.

test_that("la génération planifiée des modèles de lecture est retirée du paquet (#890)", {
  ns <- asNamespace("lusk")
  for (fonction in c("construire_modele_indicateur", "publier_modele_indicateur",
                     "publier_modeles_lecture", "construire_manifeste_modeles_lecture",
                     "publier_manifeste_modeles_lecture")) {
    expect_false(exists(fonction, envir = ns, inherits = FALSE), info = fonction)
  }
})

test_that("le rafraîchissement manuel depuis les JSON publiés est retiré (#891)", {
  ns <- asNamespace("lusk")
  for (fonction in c("publier_modeles_territoire_depuis_json",
                     "publier_modeles_territoire_complet",
                     "publier_modeles_territoire",
                     "construire_modeles_territoire",
                     "construire_modele_territoire",
                     "publier_modele_territoire",
                     "identifiant_snapshot",
                     "identifiant_snapshot_territoires")) {
    expect_false(exists(fonction, envir = ns, inherits = FALSE), info = fonction)
  }
  racine <- pkgload::pkg_path()
  expect_false(file.exists(file.path(racine, "scripts", "publish-territory-models.R")))
  sources <- list.files(file.path(racine, "R"), pattern = "[.]R$", full.names = TRUE)
  texte <- vapply(sources, function(chemin) {
    paste(readLines(chemin, warn = FALSE), collapse = "\n")
  }, character(1))
  expect_false(any(grepl("publier_modeles_territoire_depuis_json", texte, fixed = TRUE)))
})

test_that("l'adaptateur Programmes reste dans son module propriétaire", {
  expect_true(exists("construire_payload_territoire_programmes",
                     envir = asNamespace("lusk"), inherits = FALSE))
})

test_that("le module modeles_lecture.R et les artefacts commités sont retirés (#900)", {
  racine <- pkgload::pkg_path()
  expect_false(file.exists(file.path(racine, "R", "modeles_lecture.R")))
  expect_false(file.exists(file.path(racine, "..", "public", "data", "modeles-lecture")))
  expect_false(file.exists(file.path(racine, "..", "app", "dist", "data", "modeles-lecture")))
})
