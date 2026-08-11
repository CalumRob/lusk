# test-targets-rapport -----------------------------------------------------------
# Seam 3 (#340, épique #329) : le rapport de run en target INDÉPENDANT — écrit
# à chaque run même quand la chaîne saute (tar_cue(mode = "always")), et
# survivant à l'échec d'une étape aval (tar_option_set(error = "continue")) —
# la sémantique #8/#10 du cron préservée par le port. Prior art : le spike
# 40-v4-error-report.R. Le mini-graphe (helper-targets-fixtures) porte le
# rapport en target toujours-cue, comme le graphe réel ; ces tests n'entrent
# pas dans le graphe du pipeline (US 15).

test_that("le rapport de run est réestampillé à chaque run, même quand la chaîne saute", {
  projet <- installer_mini_projet()
  withr::local_dir(projet)

  targets::tar_make(callr_function = NULL)
  premier <- lire_rapport(projet)
  expect_false(is.null(premier))

  # rien n'a changé : la chaîne n'a RIEN à rejouer — seul le rapport
  # (tar_cue always, par conception toujours « à jour ») figure au périmé
  expect_length(
    setdiff(targets::tar_outdated(callr_function = NULL), "rapport_toy"),
    0
  )

  # …mais le rapport (tar_cue always, sans dépendance amont) est re-écrit
  targets::tar_make(callr_function = NULL)
  second <- lire_rapport(projet)

  expect_false(identical(premier, second))
})

test_that("le rapport de run survit à l'échec d'une étape aval (error = continue)", {
  projet <- installer_mini_projet()
  withr::local_dir(projet)

  targets::tar_make(callr_function = NULL)
  avant <- lire_rapport(projet)
  expect_false(is.null(avant))

  # compute_fake se met à échouer — une étape AVAL du rapport : le rapport
  # n'a aucune dépendance sur payload/publie, il doit quand même être écrit
  # (le tar_make ne lève pas : error = "continue").
  editer_fonction_toypkg(projet, "brut$base * 2", "stop('compute exploded')")

  expect_error(
    targets::tar_make(callr_function = NULL),
    NA
  )

  apres <- lire_rapport(projet)
  expect_false(is.null(apres))              # le rapport existe toujours
  expect_false(identical(avant, apres))     # et porte le run échoué
})
