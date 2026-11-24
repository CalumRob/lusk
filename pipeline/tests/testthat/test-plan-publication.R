# Plan de publication (ADR-0049 step 2, #1136) -------------------------------
# Pure, read-only plan over the #1135 artefact store and an injected live
# listing. No serving-database reader and no registry reader in this slice.

plan_preparer <- function() {
  root <- plan_fixture_root()
  verrou <- plan_fixture_lock()
  list(root = root, verrou = verrou,
       nettoyer = function() unlink(c(root, verrou$lock), recursive = TRUE))
}

# -- Built vs live, adoption ---------------------------------------------------

test_that("sans listing live, chaque ressource est not adopted et le plan est pur", {
  p <- plan_preparer()
  on.exit(p$nettoyer(), add = TRUE)
  res <- plan_fixture_build(p$root)
  avant <- sort(list.files(p$root, recursive = TRUE, all.files = TRUE))

  plan <- plan_publication(root = p$root, builds = plan_fixture_builds(res),
                           live = NULL, registre = p$verrou$registre)

  expect_setequal(plan$ressources$ressource, res$ressource)
  expect_true(all(plan$ressources$statut_adoption == "not adopted"))
  expect_true(all(plan$ressources$change))
  expect_setequal(plan$changees, res$ressource)
  expect_setequal(plan$cascade, res$ressource)
  expect_identical(sort(list.files(p$root, recursive = TRUE, all.files = TRUE)), avant)
})

test_that("un listing live identique au build ne marque aucun changement", {
  p <- plan_preparer()
  on.exit(p$nettoyer(), add = TRUE)
  res <- plan_fixture_build(p$root)

  plan <- plan_publication(root = p$root, builds = plan_fixture_builds(res),
                           live = plan_fixture_listing(res),
                           registre = p$verrou$registre)

  expect_true(all(plan$ressources$statut_adoption == "adopted"))
  expect_false(any(plan$ressources$change))
  expect_identical(plan$changees, character())
  expect_identical(plan$cascade, character())
})

# -- Cascade -------------------------------------------------------------------

test_that("changer offre_tc seul ne liste que offre_tc", {
  p <- plan_preparer()
  on.exit(p$nettoyer(), add = TRUE)
  initial <- plan_fixture_build(p$root)
  live <- plan_fixture_listing(initial)
  valeurs <- plan_fixture_projections()$scalar$offre_tc$facts$value
  valeurs[[1L]] <- 999
  apres <- plan_fixture_build(p$root,
    projections = plan_fixture_projections(valeurs_offre = valeurs))

  plan <- plan_publication(root = p$root, builds = plan_fixture_builds(apres),
                           live = live, registre = p$verrou$registre)

  expect_identical(plan$changees, "offre_tc")
  expect_identical(plan$cascade, "offre_tc")
  expect_identical(plan$ressources$cascade[plan$ressources$ressource == "distribution_dpe"], FALSE)
})

test_that("changer part_passoires ajoute le profil DPE par cascadance déclarée", {
  p <- plan_preparer()
  on.exit(p$nettoyer(), add = TRUE)
  initial <- plan_fixture_build(p$root)
  live <- plan_fixture_listing(initial)
  valeurs <- plan_fixture_projections()$scalar$part_passoires$facts$value
  valeurs[[1L]] <- 999
  apres <- plan_fixture_build(p$root,
    projections = plan_fixture_projections(valeurs_part = valeurs))

  plan <- plan_publication(root = p$root, builds = plan_fixture_builds(apres),
                           live = live, registre = p$verrou$registre)

  expect_identical(plan$changees, "part_passoires")
  expect_setequal(plan$cascade, c("part_passoires", "distribution_dpe"))
  # Le profil n'a PAS changé de version : il est ajouté par la déclaration.
  ligne <- plan$ressources[plan$ressources$ressource == "distribution_dpe", ]
  expect_identical(ligne$change, FALSE)
  expect_identical(ligne$cascade, TRUE)
})

test_that("un changement de référence territoriale marque toutes les ressources", {
  p <- plan_preparer()
  on.exit(p$nettoyer(), add = TRUE)
  initial <- plan_fixture_build(p$root)
  live <- plan_fixture_listing(initial)
  apres <- plan_fixture_build(p$root, reference_version = "reference-v2")

  plan <- plan_publication(root = p$root, builds = plan_fixture_builds(apres),
                           live = live, registre = p$verrou$registre)

  expect_setequal(plan$changees, initial$ressource)
  expect_setequal(plan$cascade, initial$ressource)
})

test_that("la cascadance vient de comparison_scalar, jamais d'un littéral ni de required_scalar_version", {
  racine <- testthat::test_path("..", "..")
  code <- paste(readLines(file.path(racine, "R", "plan_publication.R"), warn = FALSE),
                collapse = "\n")
  expect_true(grepl("comparison_scalar", code, fixed = TRUE))
  expect_false(grepl("part_passoires", code, fixed = TRUE))
  expect_false(grepl("required_scalar_version", code, fixed = TRUE))
})

# -- Drift summary (from the two artefacts) -----------------------------------

test_that("la dérive nomme les territoires dont la valeur a changé", {
  p <- plan_preparer()
  on.exit(p$nettoyer(), add = TRUE)
  initial <- plan_fixture_build(p$root)
  live <- plan_fixture_listing(initial)
  valeurs <- plan_fixture_projections()$scalar$offre_tc$facts$value
  valeurs[[3L]] <- 999
  apres <- plan_fixture_build(p$root,
    projections = plan_fixture_projections(valeurs_offre = valeurs))

  plan <- plan_publication(root = p$root, builds = plan_fixture_builds(apres),
                           live = live, registre = p$verrou$registre)
  ligne <- plan$ressources[plan$ressources$ressource == "offre_tc", ]
  expect_identical(ligne$drift_disponible, TRUE)
  expect_identical(ligne$drift_nb, 1L)
  expect_identical(ligne$drift_territoires, "c3")
})

test_that("sans artefact live, la dérive est inconnue", {
  p <- plan_preparer()
  on.exit(p$nettoyer(), add = TRUE)
  res <- plan_fixture_build(p$root)
  plan <- plan_publication(root = p$root, builds = plan_fixture_builds(res),
                           live = NULL, registre = p$verrou$registre)
  expect_true(all(is.na(plan$ressources$drift_nb)))
  expect_true(all(!plan$ressources$drift_disponible))
})

# -- Definition change ---------------------------------------------------------

test_that("la définition n'a qu'une source : le garde canonique du scalaire", {
  expect_false(exists("CHAMPS_DEFINITION_RESSOURCE", inherits = TRUE))
  expect_false(exists("valeur_champ_definition", inherits = TRUE))
  code_plan <- paste(readLines(testthat::test_path("..", "..", "R", "plan_publication.R"),
                               warn = FALSE), collapse = "\n")
  code_registre <- paste(readLines(testthat::test_path("..", "..", "R",
                                                       "splitter_ressources.R"),
                                   warn = FALSE), collapse = "\n")
  expect_true(grepl("identical_scalar_descriptor", code_registre, fixed = TRUE))
  expect_true(grepl("SCALAR_DESCRIPTOR_SEMANTICS", code_registre, fixed = TRUE))
  expect_true(grepl("comparer_definition", code_plan, fixed = TRUE))
  expect_true(all(vapply(REGISTRE_FORMES_RESSOURCE,
    function(h) is.function(h$comparer_definition), logical(1))))
})

plan_descriptor_definition <- function() {
  list(indicator_id = "offre_tc", theme_id = "mobilite",
       label = "Ancien libellé", unit = "count", direction = "high",
       comparison_facet = "offre_tc", allowed_levels = c("commune", "epci"),
       allowed_sources = "bpe_offer", completeness = "sparse",
       denominator_semantics = "count", descriptor_version = "v1")
}

test_that("un changement de descriptor_version seul n'est pas un changement de définition", {
  v1 <- plan_descriptor_definition()
  v2 <- v1
  v2$descriptor_version <- "v2"
  expect_identical(changement_definition_ressource(v1, v2)$change, FALSE)
})

test_that("unité et dénominateur sont des changements de définition", {
  v1 <- plan_descriptor_definition()
  unite <- v1
  unite$unit <- "percent"
  r <- changement_definition_ressource(v1, unite)
  expect_identical(r$change, TRUE)
  expect_true("unit" %in% r$champs)

  denominateur <- v1
  denominateur$denominator_semantics <- "population"
  r <- changement_definition_ressource(v1, denominateur)
  expect_identical(r$change, TRUE)
  expect_true("denominator_semantics" %in% r$champs)
})

test_that("l'ordre des niveaux et sources est un changement de définition (règle canonique)", {
  v1 <- plan_descriptor_definition()
  v2 <- v1
  v2$allowed_levels <- rev(v2$allowed_levels)
  r <- changement_definition_ressource(v1, v2)
  expect_identical(r$change, TRUE)
  expect_true("allowed_levels" %in% r$champs)
  v2 <- v1
  v2$allowed_sources <- c("bpe_offer", "autre")
  expect_identical(changement_definition_ressource(v1, v2)$change, TRUE)
})

test_that("le descripteur data.frame d'un scalaire est comparé comme une liste", {
  v1 <- data.frame(label = "A", unit = "count", direction = "high",
                   comparison_facet = "offre_tc", completeness = "sparse",
                   denominator_semantics = "count", descriptor_version = "v1",
                   stringsAsFactors = FALSE)
  v1$allowed_levels <- I(list(c("commune", "epci")))
  v1$allowed_sources <- I(list("bpe_offer"))
  v2 <- v1
  v2$descriptor_version <- "v2"
  expect_identical(changement_definition_ressource(v1, v2)$change, FALSE)
  v2$unit <- "percent"
  expect_identical(changement_definition_ressource(v1, v2)$change, TRUE)
})

plan_ecrire_definition_artefact <- function(root, descripteur, source = "s1") {
  contenu <- contenu_artefact(
    data.frame(territory_id = "c1", value = 1, stringsAsFactors = FALSE),
    descripteur,
    data.frame(source_id = source, vintage_id = "v1", stringsAsFactors = FALSE),
    NULL)
  ecrire_artefact_ressource("densite", "scalar", contenu, root = root,
    digests_lignage = digests_lignage_ressource(source, artefacts_fixture_digests(source)))
}

test_that("le plan signale le changement de définition entre deux versions live/built", {
  p <- plan_preparer()
  on.exit(p$nettoyer(), add = TRUE)
  v1 <- plan_descriptor_definition()
  v2 <- v1
  v2$unit <- "percent"
  a <- plan_ecrire_definition_artefact(p$root, v1)
  b <- plan_ecrire_definition_artefact(p$root, v2)

  plan <- plan_publication(root = p$root,
    builds = data.frame(ressource = "densite", forme = "scalar", version = b$version,
                        stringsAsFactors = FALSE),
    live = data.frame(ressource = "densite", version = a$version, stringsAsFactors = FALSE),
    registre = plan_fixture_lock("s1")$registre)

  expect_identical(plan$ressources$definition, TRUE)
  expect_true("unit" %in% plan$ressources$definition_champs[[1L]])
  # Une définition non confirmée bloque sa fermeture (aucun apply ne l'a acceptée).
  expect_true(plan$ressources$bloque)
  expect_match(plan$ressources$bloque_par, "definition: unit", fixed = TRUE)
})

# -- Lineage freeze ------------------------------------------------------------

test_that("le gel est une seule implémentation partagée avec verifier_gel_release", {
  racine <- testthat::test_path("..", "..")
  gel <- paste(readLines(file.path(racine, "R", "release_freeze.R"), warn = FALSE),
               collapse = "\n")
  plan <- paste(readLines(file.path(racine, "R", "plan_publication.R"), warn = FALSE),
                collapse = "\n")
  expect_true(grepl("evaluer_gel_empreintes", gel, fixed = TRUE))
  expect_true(grepl("evaluer_gel_empreintes", plan, fixed = TRUE))
  expect_true(exists("evaluer_gel_empreintes", inherits = TRUE))
})

test_that("une dérive hors lignage ne refuse pas offre_tc", {
  p <- plan_preparer()
  on.exit(p$nettoyer(), add = TRUE)
  initial <- plan_fixture_build(p$root)
  registre <- p$verrou$registre
  registre$unrelated_source$sha256 <- "sha256-derive-hors-lignage"

  plan <- plan_publication(root = p$root, builds = plan_fixture_builds(initial),
                           live = NULL, registre = registre)
  ligne <- plan$ressources[plan$ressources$ressource == "offre_tc", ]
  expect_identical(ligne$gel, "ok")
})

test_that("une dérive DANS le lignage refuse et nomme la source", {
  p <- plan_preparer()
  on.exit(p$nettoyer(), add = TRUE)
  initial <- plan_fixture_build(p$root)
  registre <- p$verrou$registre
  registre$bpe_offer$sha256 <- "sha256-derive-dans-lignage"

  plan <- plan_publication(root = p$root, builds = plan_fixture_builds(initial),
                           live = NULL, registre = registre)
  ligne <- plan$ressources[plan$ressources$ressource == "offre_tc", ]
  expect_identical(ligne$gel, "refused")
  expect_identical(ligne$gel_raison, "derive")
  expect_true(grepl("bpe_offer", ligne$gel_detail, fixed = TRUE))
  # La ressource voisine, dont le lignage est conforme, n'est pas refusée.
  expect_identical(plan$ressources$gel[plan$ressources$ressource == "densite"], "ok")
})

test_that("le noyau partagé produit seul la raison empreinte_absente", {
  digests <- list(list(source_id = "s1", sha256 = NA_character_, absent = TRUE))
  erreur <- tryCatch(evaluer_gel_empreintes(digests, list(), exiger_couverture = FALSE),
                     error = function(e) e)
  expect_s3_class(erreur, "erreur_gel_release")
  expect_identical(erreur$raison, "empreinte_absente")
  expect_match(conditionMessage(erreur), "empreinte absente pour s1", fixed = TRUE)
  expect_match(conditionMessage(erreur), "publication refusée, zéro écriture", fixed = TRUE)
  code <- paste(readLines(testthat::test_path("..", "..", "R", "plan_publication.R"),
                          warn = FALSE), collapse = "\n")
  expect_false(grepl("stop\\(erreur_gel_release", code))
})

test_that("une empreinte absente du lignage refuse avec la raison empreinte_absente", {
  p <- plan_preparer()
  on.exit(p$nettoyer(), add = TRUE)
  ecrit <- suppressMessages({
    ecrire_artefact_ressource("offre_tc", "scalar", contenu_artefact(
      data.frame(territory_id = "c1", value = 1, stringsAsFactors = FALSE),
      list(label = "Offre"), data.frame(source_id = "source_sans_digest",
                                       vintage_id = "v1", stringsAsFactors = FALSE),
      NULL),
      digests_lignage = digests_lignage_ressource("source_sans_digest"), root = p$root)
  })
  plan <- plan_publication(root = p$root,
    builds = data.frame(ressource = "offre_tc", forme = "scalar", version = ecrit$version,
                        stringsAsFactors = FALSE),
    live = NULL, registre = p$verrou$registre)
  ligne <- plan$ressources[plan$ressources$ressource == "offre_tc", ]
  expect_identical(ligne$gel, "refused")
  expect_identical(ligne$gel_raison, "empreinte_absente")
})

test_that("un refus dans une fermeture bloque tous ses membres et nomme le bloquant", {
  p <- plan_preparer()
  on.exit(p$nettoyer(), add = TRUE)
  initial <- plan_fixture_build(p$root)
  registre <- p$verrou$registre
  registre$dpe_energy$sha256 <- "sha256-derive-dans-lignage"

  plan <- plan_publication(root = p$root, builds = plan_fixture_builds(initial),
                           live = NULL, registre = registre)
  part <- plan$ressources[plan$ressources$ressource == "part_passoires", ]
  dpe <- plan$ressources[plan$ressources$ressource == "distribution_dpe", ]
  offre <- plan$ressources[plan$ressources$ressource == "offre_tc", ]
  expect_identical(part$gel, "refused")
  expect_identical(part$gel_raison, "derive")
  # Le profil a un lignage conforme, mais il est dans la même fermeture.
  expect_identical(dpe$gel, "ok")
  expect_true(part$bloque)
  expect_true(dpe$bloque)
  expect_match(dpe$bloque_par, "part_passoires \\(derive: dpe_energy\\)")
  expect_true(plan$blocage$bloque)
  # Une fermeture indépendante n'est pas bloquée par ce refus.
  expect_false(offre$bloque)
})

# -- Real-data check status ----------------------------------------------------

test_that("le statut de vérification est attribué par lignage", {
  p <- plan_preparer()
  on.exit(p$nettoyer(), add = TRUE)
  initial <- plan_fixture_build(p$root)
  plan <- plan_publication(root = p$root, builds = plan_fixture_builds(initial),
                           live = plan_fixture_listing(initial),
                           registre = p$verrou$registre,
                           attributions = plan_fixture_attributions())
  # Le lignage de `part_passoires` porte `dpe_energy` (sa provenance), pas
  # celui du profil : l'attribution suit la ressource qui lit la source.
  part <- plan$ressources[plan$ressources$ressource == "part_passoires", ]
  densite <- plan$ressources[plan$ressources$ressource == "densite", ]
  expect_identical(part$check, "drift")
  expect_true(grepl("dpe_energy", part$check_detail, fixed = TRUE))
  expect_identical(densite$check, "regression")
  expect_identical(plan$ressources$check[plan$ressources$ressource == "distribution_dpe"], "none")
})

# -- CLI -----------------------------------------------------------------------

plan_cli_environnement <- function(noms) {
  for (nom in noms) {
    valeur <- Sys.getenv(nom, unset = NA_character_)
    assign(paste0("plan_cli_", nom), valeur, envir = .GlobalEnv)
    if (!is.na(valeur)) Sys.unsetenv(nom)
  }
  function() {
    for (nom in noms) {
      valeur <- get(paste0("plan_cli_", nom), envir = .GlobalEnv)
      if (is.na(valeur)) Sys.unsetenv(nom) else Sys.setenv(nom = valeur)
    }
  }
}

test_that("la commande plan imprime live, built, cascadance, gel et vérifications sans écrire", {
  p <- plan_preparer()
  on.exit(p$nettoyer(), add = TRUE)
  initial <- plan_fixture_build(p$root)
  listing <- plan_fixture_listing_json(plan_fixture_listing(initial))
  attributions <- plan_fixture_attributions_json(plan_fixture_attributions())
  on.exit(unlink(c(listing, attributions)), add = TRUE)
  restaurer <- plan_cli_environnement(c("LUSK_ARTEFACTS", "LUSK_SOURCES_LOCK",
    "LUSK_LIVE_LISTING", "LUSK_ATTRIBUTIONS"))
  on.exit(restaurer(), add = TRUE)
  Sys.setenv(LUSK_ARTEFACTS = p$root, LUSK_SOURCES_LOCK = p$verrou$lock,
             LUSK_LIVE_LISTING = listing, LUSK_ATTRIBUTIONS = attributions)
  avant <- sort(list.files(p$root, recursive = TRUE, all.files = TRUE))
  script <- testthat::test_path("..", "..", "scripts", "publication.R")

  sortie <- suppressWarnings(system2("Rscript", c(shQuote(script), "plan"),
                                     stdout = TRUE, stderr = TRUE))

  expect_true(any(grepl("^ressource=offre_tc .*live=", sortie, fixed = FALSE)))
  expect_true(any(grepl("adoption=adopted", sortie, fixed = TRUE)))
  expect_true(any(grepl("status=unchanged", sortie, fixed = TRUE)))
  expect_true(any(grepl("^changed=", sortie)))
  expect_true(any(grepl("^cascade=", sortie)))
  expect_true(any(grepl("^freeze=ok", sortie)))
  expect_true(any(grepl("^blocked=no$", sortie)))
  expect_true(any(grepl("blocked=no", sortie, fixed = TRUE)))
  expect_identical(sort(list.files(p$root, recursive = TRUE, all.files = TRUE)), avant)
})

test_that("la commande plan sans listing live affiche not adopted", {
  p <- plan_preparer()
  on.exit(p$nettoyer(), add = TRUE)
  plan_fixture_build(p$root)
  restaurer <- plan_cli_environnement(c("LUSK_ARTEFACTS", "LUSK_SOURCES_LOCK",
    "LUSK_LIVE_LISTING", "LUSK_ATTRIBUTIONS"))
  on.exit(restaurer(), add = TRUE)
  Sys.setenv(LUSK_ARTEFACTS = p$root, LUSK_SOURCES_LOCK = p$verrou$lock)
  Sys.unsetenv("LUSK_LIVE_LISTING")
  Sys.unsetenv("LUSK_ATTRIBUTIONS")
  script <- testthat::test_path("..", "..", "scripts", "publication.R")

  sortie <- suppressWarnings(system2("Rscript", c(shQuote(script), "plan"),
                                     stdout = TRUE, stderr = TRUE))
  expect_true(any(grepl("adoption=not adopted", sortie, fixed = TRUE)))
  expect_true(any(grepl("live=not adopted", sortie, fixed = TRUE)))
})

test_that("le plan n'ouvre aucune connexion de service et n'écrit aucun fichier", {
  racine <- testthat::test_path("..", "..")
  fichiers <- c(file.path(racine, "R", "plan_publication.R"),
                file.path(racine, "scripts", "publication.R"))
  for (fichier in fichiers) {
    code <- paste(readLines(fichier, warn = FALSE), collapse = "\n")
    expect_false(grepl("dbConnect|DBI::|RPostgres", code), info = basename(fichier))
    expect_false(grepl("write_json|saveRDS|writeLines|dir.create|unlink|ecrire_", code),
                 info = basename(fichier))
  }
})
