# test-verification-donnees-reelles ---------------------------------------------
# Seam 3 (#342, épique #329) : la vérification « données réelles » PILOTÉE PAR
# SES ENTRÉES, encodée en test FIXTURE — l'US 13 du port (les blocs réels des
# tests convertis en targets du graphe, LUSK_RUN_REAL supprimé) verrouillée
# SANS les données réelles. Le mini-graphe (helper-targets-fixtures) porte un
# verrou verif_toy qui lit un fichier brut (entree.txt) via SON lecteur du
# mini-paquet (lire_entree_toy) appelé PAR SYMBOLE — le MÊME motif que les
# verifier_*_reel du graphe réel (le target de fichiers à hash de contenu +
# le suivi d'imports transitif) :
#   (a) le verrou TOURNE au premier make ;
#   (b) rien ne change -> il SAUTE ;
#   (c) le fichier brut change -> il REJOUE (la fraîcheur par contenu) ;
#   (d) le corps du LECTEUR change -> il REJOUE (le suivi d'imports) ;
#   (e) un verrou cassé fait ÉCHOUER le target (stop() — un run rouge reste
#       bruyant, jamais un silence) — et le rapport de run survit.
# US 15 : tout vit dans tempdir(), la suite fixtures reste rapide et complète
# en CI — aucun tar_make sur le graphe du pipeline. Les scénarios (a)-(d)
# n'ont pas besoin du rapport de run (avec_rapport = FALSE — le rapport est
# réestampillé à CHAQUE run par cue "always", il fausserait le « rien à
# rejouer ») ; le scénario (e) le porte pour prouver la survie du rapport.
#
# NB — le NOM du fichier : test-verification-… (tri APRÈS les test-theme-*).
# Le mini-graphe charge le mini-paquet dans le worker testthat parallèle
# (pkgload::load_all) ; sur Windows, ce chargement dans un worker corrompt
# les local_mocked_bindings(.package = "lusk") des FICHIERS SUIVANTS du même
# worker (l'état du namespace cloné de testthat) — les blocs « données
# réelles » existants des test-theme-* y sont sensibles (la même classe de
# flake que les autres fichiers de machinerie targets, #330). En triant ce
# fichier APRÈS eux, le graphe réel des tests n'est pas perturbé (les
# fichiers qui suivent, test-vintage-*, ne mockent pas).

test_that("le verrou tourne au premier make, puis saute tant que rien ne change", {
  projet <- installer_mini_projet(avec_rapport = FALSE)
  withr::local_dir(projet)

  # (a) premier make : le verrou tourne
  targets::tar_make()
  expect_equal(targets::tar_progress(verif_toy)$progress, "completed")

  # (b) rien ne change : le verrou SAUTE — et le graphe entier aussi
  targets::tar_make()
  expect_equal(targets::tar_progress(verif_toy)$progress, "skipped")
  expect_length(targets::tar_outdated(), 0)
})

test_that("le fichier brut change -> le verrou rejoue (fraîcheur par contenu)", {
  projet <- installer_mini_projet(avec_rapport = FALSE)
  withr::local_dir(projet)

  targets::tar_make()

  # (c) le fichier d'entrée change de CONTENU (mêmes bases, autre répartition
  # — le verrou somme toujours 6 : il doit REJOUER et passer, pas sauter)
  writeLines(c("code,base", "a,3", "b,1", "c,2"),
             file.path(projet, "data", "raw", "entree.txt"))

  perimes <- targets::tar_outdated()
  expect_true("verif_toy" %in% perimes)
  expect_true("fichiers_toy" %in% perimes)   # la fraîcheur par contenu

  targets::tar_make()
  expect_equal(targets::tar_progress(verif_toy)$progress, "completed")
})

test_that("le corps du lecteur change -> le verrou rejoue (suivi d'imports)", {
  projet <- installer_mini_projet(avec_rapport = FALSE)
  withr::local_dir(projet)

  targets::tar_make()

  # (d) lire_entree_toy (LE lecteur du verrou) change de corps — AUCUN fichier
  # touché : le piège de la fraîcheur (#325) est géré par le hash du corps de
  # la fonction importée, transitif jusqu'au vérificateur
  editer_fonction_toypkg(projet, "brute <- read.csv", "brute <- utils::read.csv")

  perimes <- targets::tar_outdated()
  expect_true("verif_toy" %in% perimes)
  expect_false("brut_toy" %in% perimes)  # le lecteur n'est pas dans le builder

  targets::tar_make()
  expect_equal(targets::tar_progress(verif_toy)$progress, "completed")
})

test_that("un verrou cassé fait ÉCHOUER le target — un run rouge reste bruyant", {
  projet <- installer_mini_projet()
  withr::local_dir(projet)

  targets::tar_make()

  # (e) la donnée brute change de contenu (somme 13 != 6) : le vérificateur
  # s'arrête bruyamment (stop()), le target passe en erreur — error =
  # "continue" laisse le run s'écrire, jamais un silence
  writeLines(c("code,base", "a,10", "b,2", "c,1"),
             file.path(projet, "data", "raw", "entree.txt"))

  suppressWarnings(targets::tar_make())
  expect_equal(targets::tar_progress(verif_toy)$progress, "errored")
  # le rapport de run (le target indépendant réestampillé à chaque run) est
  # écrit quand même — la sémantique « le rapport survit à l'échec d'une
  # étape » (#8/#10) que le cron exploite
  expect_equal(targets::tar_progress(rapport_toy)$progress, "completed")
})
