# rapport de run -------------------------------------------------------------
# Issue #10, ADR-0004 : le trace durable de chaque run, committé à côté du
# payload — par source, le statut (cron -> frais/échec, manuel -> « à traiter
# à la main ») + le mode du run + un horodatage. L'entrée du seam de
# notification : le workflow n'alerte que quand le run a besoin de l'humain
# (un échec cron aujourd'hui).

test_that("rapport_run porte le mode, un horodatage et les statuts par source", {
  statuts <- tibble::tibble(
    id = c("serie_historique", "menages", "age_detail", "epci"),
    mode = c("cron", "cron", "cron", "cron"),
    status = c("frais", "frais", "frais", "frais")
  )

  rapport <- rapport_run(statuts, "cron", timestamp = "2026-08-03T10:00:00Z")

  expect_named(rapport, c("mode", "timestamp", "statuts"))
  expect_equal(rapport$mode, "cron")
  expect_equal(rapport$timestamp, "2026-08-03T10:00:00Z")
  expect_identical(rapport$statuts, statuts)
})

test_that("ecrire_rapport_run écrit run-report.json à côté du payload, lisible en retour", {
  statuts <- tibble::tibble(
    id = c("serie_historique", "menages", "epci"),
    mode = c("cron", "cron", "cron"),
    status = c("frais", "frais", "frais")
  )
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))

  ecrire_rapport_run(statuts, mode = "cron", cible = cible,
                     timestamp = "2026-08-03T10:00:00Z")

  expect_true(file.exists(file.path(cible, "run-report.json")))
  rapport <- jsonlite::fromJSON(file.path(cible, "run-report.json"))
  expect_equal(rapport$mode, "cron")
  expect_equal(rapport$timestamp, "2026-08-03T10:00:00Z")
  # une ligne par source, avec son statut
  expect_equal(nrow(rapport$statuts), nrow(statuts))
  expect_equal(rapport$statuts$id, statuts$id)
  expect_equal(rapport$statuts$status, statuts$status)
})

test_that("le rapport distingue les statuts cron et manuel (mode = 'cron')", {
  # le cœur du rapport : cron -> frais, manuel -> « à traiter à la main »
  statuts <- tibble::tibble(
    id = c("serie_historique", "epci"),
    mode = c("cron", "manuel"),
    status = c("frais", "à traiter à la main")
  )
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))

  ecrire_rapport_run(statuts, mode = "cron", cible = cible,
                     timestamp = "2026-08-03T10:00:00Z")

  rapport <- jsonlite::fromJSON(file.path(cible, "run-report.json"))
  manuel <- rapport$statuts[rapport$statuts$id == "epci", , drop = FALSE]
  expect_equal(manuel$mode, "manuel")
  expect_equal(manuel$status, "à traiter à la main")
})
