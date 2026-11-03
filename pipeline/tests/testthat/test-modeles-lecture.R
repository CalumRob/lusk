# test-modeles-lecture -----------------------------------------------------------
# Issues #890 + #891 : toute la GÉNÉRATION des modèles de lecture est retirée du
# paquet — la voie planifiée (#890 : cibles modeles_lecture_<thème>,
# manifeste_modeles_lecture et modeles_territoire du graphe) comme la voie
# manuelle (#891 : scripts/publish-territory-models.R ->
# publier_modeles_territoire_depuis_json, ainsi que les builders/publieurs de
# modèles de territoire). Les artefacts déjà publiés (public/data/modeles-
# lecture/**, app/dist/data/**) et leurs validateurs (validate:territory-model,
# validateurs d'artefacts d'indicateurs et leurs tests de contrat) restent
# inchangés. Ce module ne garde que les helpers encore appelé hors génération :
# verifier_integrite_projections_acces_batiments (scripts/publish-building-
# comparisons.R) et construire_payload_territoire_programmes (cible
# projection_programmes du graphe).

test_that("la génération planifiée des modèles de lecture est retirée du paquet (#890)", {
  ns <- asNamespace("lusk")
  # les générateurs/publieurs d'indicateurs et de manifeste, devenus
  # injoignables depuis le graphe, ne font plus partie du paquet
  for (fonction in c("construire_modele_indicateur", "publier_modele_indicateur",
                     "publier_modeles_lecture", "construire_manifeste_modeles_lecture",
                     "publier_manifeste_modeles_lecture")) {
    expect_false(exists(fonction, envir = ns, inherits = FALSE), info = fonction)
  }
})

test_that("le rafraîchissement manuel depuis les JSON publiés est retiré (#891)", {
  ns <- asNamespace("lusk")
  # builders/publieurs de modèles de territoire : plus aucun appelant
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
  # plus aucun script CLI : rien ne peut plus relire territoires.json,
  # vintages.json, les theme_*.json ou les projections Mobilité pour
  # reconstruire un modèle de territoire
  racine <- pkgload::pkg_path()
  expect_false(file.exists(file.path(racine, "scripts", "publish-territory-models.R")))
  sources <- list.files(file.path(racine, "R"), pattern = "[.]R$", full.names = TRUE)
  texte <- vapply(sources, function(chemin) {
    paste(readLines(chemin, warn = FALSE), collapse = "\n")
  }, character(1))
  expect_false(any(grepl("publier_modeles_territoire_depuis_json", texte, fixed = TRUE)))
})

test_that("les helpers retenus hors génération restent dans le paquet", {
  ns <- asNamespace("lusk")
  # contrôle d'intégrité des projections bâtiment, encore appelé par
  # scripts/publish-building-comparisons.R (publieur manuel retenu)
  expect_true(exists("verifier_integrite_projections_acces_batiments",
                     envir = ns, inherits = FALSE))
  # adaptateur du payload Programmes, encore appelé par la cible
  # projection_programmes du graphe
  expect_true(exists("construire_payload_territoire_programmes",
                     envir = ns, inherits = FALSE))
})

reference_projections <- function() {
  tibble::tribble(
    ~territoire, ~type, ~nom, ~departement, ~epci,
    "22001", "commune", "Commune A", "22", "200000001",
    "22002", "commune", "Commune B", "22", "200000001",
    "200000001", "epci", "EPCI X", "22", NA_character_,
    "22", "departement", "Département 22", "22", NA_character_,
    "53", "region", "Bretagne", NA_character_, NA_character_
  )
}

distribution_projections <- function(territoire = "22001",
                                     modes = c("epci", "bretagne")) {
  tibble::tibble(
    territoire = territoire, type = "commune",
    comparison_mode = modes,
    scope_kind = c("communes-epci", "communes-bretagne")[seq_along(modes)],
    scope_label = c("communes de EPCI X", "communes bretonnes")[seq_along(modes)],
    breadth_bucket = "1-9", depth_bucket = "1-9",
    comparison_total_buildings = 10L * seq_along(modes),
    comparison_building_count = 10L * seq_along(modes),
    comparison_share = 1
  )
}

rampe_projections <- function(territoire = "22001",
                              modes = c("epci", "bretagne")) {
  tibble::tibble(
    territoire = territoire, type = "commune",
    comparison_mode = modes,
    scope_kind = c("communes-epci", "communes-bretagne")[seq_along(modes)],
    scope_label = c("communes de EPCI X", "communes bretonnes")[seq_along(modes)],
    mode = "t", quantile = 0.5,
    comparison_total_buildings = 10L * seq_along(modes),
    comparison_accessible_types = 3L + seq_along(modes)
  )
}

test_that("verifier_integrite_projections_acces_batiments accepte des projections cohérentes", {
  payload <- list(
    territoires = reference_projections(),
    distribution_acces_batiments_comparaisons = distribution_projections(),
    rampe_acces_batiments_comparaisons = rampe_projections()
  )
  expect_identical(verifier_integrite_projections_acces_batiments(payload), payload)
  # sans aucune projection, rien à contrôler
  vide <- list(territoires = reference_projections())
  expect_identical(verifier_integrite_projections_acces_batiments(vide), vide)
})

test_that("verifier_integrite_projections_acces_batiments rejette les projections incohérentes", {
  construit <- function(distribution = distribution_projections(),
                        rampe = rampe_projections(),
                        territoires = reference_projections()) {
    list(
      territoires = territoires,
      distribution_acces_batiments_comparaisons = distribution,
      rampe_acces_batiments_comparaisons = rampe
    )
  }

  expect_error(
    verifier_integrite_projections_acces_batiments(
      list(territoires = data.frame(x = 1))
    ),
    "référence territoriale invalide"
  )

  expect_error(
    verifier_integrite_projections_acces_batiments(
      construit(distribution = distribution_projections(territoire = "99999"))
    ),
    "territoire inconnu dans la projection bâtiment"
  )

  inconnu <- distribution_projections()
  inconnu$comparison_mode <- "contexte-inconnu"
  expect_error(
    verifier_integrite_projections_acces_batiments(construit(distribution = inconnu)),
    "mode de comparaison inconnu"
  )

  # sans classes de densité dans la référence, le mode `densite` n'est
  # résoluble pour aucune commune
  expect_error(
    verifier_integrite_projections_acces_batiments(
      construit(distribution = distribution_projections(modes = "densite"))
    ),
    "indisponible pour le territoire"
  )

  perimetre <- distribution_projections()
  perimetre$scope_label[[1L]] <- "communes bretonnes"
  expect_error(
    verifier_integrite_projections_acces_batiments(construit(distribution = perimetre)),
    "périmètre ou une identité incohérente"
  )

  double <- dplyr::bind_rows(distribution_projections(), distribution_projections())
  expect_error(
    verifier_integrite_projections_acces_batiments(construit(distribution = double)),
    "ligne en double"
  )
})
