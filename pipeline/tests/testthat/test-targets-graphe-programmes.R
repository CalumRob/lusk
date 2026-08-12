# test-targets-graphe-programmes --------------------------------------------------
# Issue #343 : la publication du payload PARTAGÉ programmes dans le graphe
# targets — le cron (le run COMPLET, LUSK_THEMES vide) invoque le graphe au
# lieu de run_pipeline() et publie AUSSI programmes.json + les parquets par
# table (ADR-0013), sans quoi le câblage régresse silencieusement la
# publication. La chaîne programmes est construite depuis le DESCRIPTEUR
# (theme_programmes()) et le seam de publication (publier_programmes) est
# appelé PAR SYMBOLE avec la MÊME forme d'appel que publie_theme (brut, cache,
# vintages, sortie — l'identité byte-identique avec le SIXIÈME appel
# run_pipeline(theme = theme_programmes()) de l'oracle, test-targets-byte-
# identical).
#
# Deux portes, aucune donnée réelle (CI-safe — US 15), le même motif que
# test-targets-graphe-cinq-themes :
#   - STRUCTURE : le VRAI graphe (tar_manifest / tar_network sur le _targets.R
#     du pipeline) — la famille programmes câblée sur le run complet (et
#     ABSENTE d'un run restreint), le seam appelé par symbole, la fusion
#     partagée des vintages qui porte le module (issue #178), et la LEAF-ness :
#     rien des CINQ thèmes n'a la chaîne programmes en aval ;
#   - la preuve d'EXÉCUTION (programmes.json produit, byte-identique au cron)
#     vit dans test-targets-byte-identical.R — la porte sur données réelles,
#     qui saute quand le cache est absent (ici le cas).
#
# NB (flakes en parallèle) : ces lectures de structure passent par le callr
# DÉFAUT de targets (PAS callr_function = NULL) — l'évaluation de _targets.R
# DANS le process du worker (qui fait pkgload::load_all de lusk) recharge le
# namespace et laisse l'environnement de test du worker (the$testing_env de
# testthat) PÉRIMÉ : les local_mocked_bindings des fichiers « données » qui
# partagent le même worker ne s'appliquent plus (régression #343, territoire-
# ocsge). Un process CHILD isole cette pollution : le worker reste intact pour
# les fichiers qui suivent. test-targets-graphe-cinq-themes a reçu le même
# correctif.

test_that("le run complet câble la publication du payload partagé programmes", {
  racine <- pkgload::pkg_path()
  withr::local_dir(racine)
  # le graphe complet (LUSK_THEMES vide = les cinq thèmes + Programmes, le
  # cron). tar_manifest ne lit JAMAIS le store réel (la structure vient du
  # script _targets.R) — pas de unlink, le store d'un worker concurrent reste
  # intact (la règle #341).
  withr::local_envvar(LUSK_THEMES = "")

  manifeste <- targets::tar_manifest()
  noms <- manifeste$name

  # la famille programmes : le téléchargement du bloc des verrous
  # (sources_programmes), les fichiers à fraîcheur par contenu
  # (fichiers_programmes), le brut (brut_programmes), la table des vintages
  # (vintages_table_programmes), la publication (publie_programmes) et le
  # rapport de run chaîné DERNIER (rapport_programmes)
  expect_true(all(
    c("sources_programmes", "fichiers_programmes", "brut_programmes",
      "vintages_table_programmes", "publie_programmes",
      "rapport_programmes") %in% noms
  ))

  # la fusion PARTAGÉE des vintages upsert aussi le module (issue #178) — le
  # même rang que six run_pipeline séquentiels
  commande_fusion <- manifeste$command[manifeste$name == "fusion_vintages"]
  expect_true(grepl("vintages_table_programmes", commande_fusion, fixed = TRUE))

  # le rapport de run du thème Programmes est chaîné APRÈS le dernier des cinq
  # (rapport_milieux) : le rapport final porte ses statuts, comme le dernier
  # appel du cron
  commande_rapport <- manifeste$command[manifeste$name == "rapport_programmes"]
  expect_true(grepl("rapport_milieux", commande_rapport, fixed = TRUE))
  expect_true(grepl("sources_programmes", commande_rapport, fixed = TRUE))
})

test_that("le seam publier_programmes est appelé PAR SYMBOLE, la forme d'appel de publie_theme", {
  racine <- pkgload::pkg_path()
  withr::local_dir(racine)
  withr::local_envvar(LUSK_THEMES = "")

  manifeste <- targets::tar_manifest()
  commande <- function(nom) manifeste$command[manifeste$name == nom]

  # le seam appelé par son SYMBOLE avec la MÊME forme que publie_theme (et que
  # run_pipeline) : publier_programmes(brut_programmes, cache = ..., vintages =
  # vintages_table_programmes, sortie = ...) — le suivi d'imports hashe le
  # corps du seam ; la forme est l'identité byte-identique avec l'oracle
  expect_true(grepl("publier_programmes(brut_programmes, cache =",
                    commande("publie_programmes"), fixed = TRUE))
  expect_true(grepl("vintages = vintages_table_programmes",
                    commande("publie_programmes"), fixed = TRUE))
  expect_true(grepl("sortie =", commande("publie_programmes"), fixed = TRUE))

  # la dépendance sur l'extraction du référentiel partagé : le seam lit le
  # fichier PAR CHEMIN (cache/extracted/EPCI_au_01-01-2025.xlsx) — la cible
  # ordonne l'extraction avant la publication
  expect_true(grepl("fichier_epci_extrait", commande("publie_programmes"),
                    fixed = TRUE))

  # le brut construit par le builder du thème, PAR SYMBOLE (construire_donnees_
  # programmes — jamais le descripteur entier comme hub), la fraîcheur par
  # contenu des six fichiers du manifeste complet (fichiers_programmes)
  expect_true(grepl("construire_donnees_programmes(cache =",
                    commande("brut_programmes"), fixed = TRUE))
  expect_true(grepl("fichiers_programmes", commande("brut_programmes"),
                    fixed = TRUE))
  expect_true(grepl("vintages_programmes()",
                    commande("vintages_table_programmes"), fixed = TRUE))
})

test_that("un run restreint ne câble RIEN du thème Programmes", {
  racine <- pkgload::pkg_path()
  withr::local_dir(racine)
  withr::local_envvar(LUSK_THEMES = "demographie")

  manifeste <- targets::tar_manifest()
  noms <- manifeste$name

  # ni la publication, ni le brut, ni les vintages, ni le rapport, ni même le
  # téléchargement des six sources (le même trait que les verrous
  # VERIFICATIONS_PROGRAMMES) — un run restreint ne force rien du module
  expect_false(any(c("publie_programmes", "brut_programmes",
                     "vintages_table_programmes", "rapport_programmes",
                     "sources_programmes") %in% noms))
  # la fusion restreinte ne porte pas les vintages du module
  commande_fusion <- manifeste$command[manifeste$name == "fusion_vintages"]
  expect_false(grepl("vintages_table_programmes", commande_fusion, fixed = TRUE))
})

test_that("la chaîne programmes est LEAF : rien des CINQ thèmes n'en dépend", {
  racine <- pkgload::pkg_path()
  withr::local_dir(racine)
  withr::local_envvar(LUSK_THEMES = "")
  # Issue #341 (course en parallèle) : la vérification de structure lit un
  # store ISOLÉ (jamais le store réel, jamais de unlink)
  store_structure <- tempfile("graphe-programmes-")

  reseau <- targets::tar_network(store = store_structure)
  aretes <- reseau$edges

  # l'aval direct des targets programmes : la fusion partagée (les vintages du
  # module y sont upsertés), le rapport chaîné et la publication elle-même —
  # JAMAIS un target du payload des cinq thèmes (publie_<thème>, payload_<thème>,
  # rapport_<thème>, metadata_<thème>) : un changement programmes ne peut pas
  # invalider leur payload (l'isolation du skip par thème)
  cibles_programmes <- c("sources_programmes", "fichiers_programmes",
                         "brut_programmes", "vintages_table_programmes",
                         "publie_programmes", "rapport_programmes")
  aval <- unique(aretes$to[aretes$from %in% cibles_programmes])
  cinq_themes <- c("demographie", "habitat", "economie", "mobilite", "milieux")
  cibles_payload_cinq <- c(
    paste0("publie_", cinq_themes),
    paste0("payload_", cinq_themes),
    paste0("rapport_", cinq_themes),
    paste0("metadata_", cinq_themes)
  )
  expect_false(any(aval %in% cibles_payload_cinq))
})
