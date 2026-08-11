# test-targets-skip-semantique ---------------------------------------------------
# Seam 2 (#340, épique #329) : la sémantique de skip du graphe targets, encodée
# en test FIXTURE — le verdict du spike (Q1-Q3) verrouillé. Un mini-graphe
# autonome (helper-targets-fixtures) construit avec les MÊMES options que le
# graphe réel (imports = "lusk"-analogue, trust_timestamps = FALSE, error =
# "continue") répond par tar_outdated() — CE QUI SERAIT REJOUÉ, jamais la
# mécanique interne de targets. Prior art : les scripts du spike
# 20-v2-compute-change.R et 30-v3-builder-change.R.
#
# US 15 : ces tests n'entrent PAS dans le graphe du pipeline — tout vit dans
# tempdir(), la suite fixtures reste rapide et complète en CI.

test_that("rien changé : rien à rejouer", {
  projet <- installer_mini_projet(avec_rapport = FALSE)
  withr::local_dir(projet)

  targets::tar_make(callr_function = NULL)

  expect_length(targets::tar_outdated(callr_function = NULL), 0)
})

test_that("changement de compute seul : construire reste frais (Q1)", {
  projet <- installer_mini_projet(avec_rapport = FALSE)
  withr::local_dir(projet)

  targets::tar_make(callr_function = NULL)

  # compute_fake : brut$double <- brut$base * 2  ->  * 3 — la couche construire
  # n'est pas dans la fermeture transitive du compute : elle doit SAUTER.
  editer_fonction_toypkg(projet, "brut$base * 2", "brut$base * 3")

  perimes <- targets::tar_outdated(callr_function = NULL)
  expect_false("brut_toy" %in% perimes)      # construire SAUTÉ
  expect_true("payload_toy" %in% perimes)    # compute relancé
  expect_true("publie_toy" %in% perimes)     # et son aval
})

test_that("changement de corps du builder : tout l'aval invalidé, entrées inchangées (Q2)", {
  projet <- installer_mini_projet(avec_rapport = FALSE)
  withr::local_dir(projet)

  targets::tar_make(callr_function = NULL)

  # construire_fake : base = base$base  ->  base = base$base + 100L — AUCUN
  # fichier d'entrée touché : le piège de la fraîcheur (#325) est géré par le
  # hash du corps de la fonction importée (deparse + transitif).
  editer_fonction_toypkg(projet, "base = base$base,", "base = base$base + 100L,")

  perimes <- targets::tar_outdated(callr_function = NULL)
  expect_true(all(c("brut_toy", "payload_toy", "publie_toy") %in% perimes))
})

test_that("entrée touchée : invalidation (fichier)", {
  projet <- installer_mini_projet(avec_rapport = FALSE)
  withr::local_dir(projet)

  targets::tar_make(callr_function = NULL)

  # le fichier d'entrée du mini-graphe change de contenu — le target de
  # fichiers (format = "file", trust_timestamps = FALSE) le voit et invalide
  # construire + tout l'aval ; le download (statuts) n'est pas touché.
  writeLines(c("code,base", "a,9", "b,2", "c,3"),
             file.path(projet, "data", "raw", "entree.txt"))

  perimes <- targets::tar_outdated(callr_function = NULL)
  expect_true("fichiers_toy" %in% perimes)   # la fraîcheur par contenu
  expect_true("brut_toy" %in% perimes)       # construire invalidé
  expect_true("payload_toy" %in% perimes)    # et tout l'aval
  expect_false("sources_toy" %in% perimes)   # les statuts, eux, n'ont pas changé
})
