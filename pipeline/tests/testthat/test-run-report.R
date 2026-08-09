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

# le diagnostic de couverture (issue #233) -------------------------------------
# Le run report porte aussi le diagnostic par département (lignes + km du
# snapshot courant vs le précédent, plus le signal de régression) quand le
# thème le fournit — un fait de première classe du run, distinct des statuts
# par source (la porte de qualité reste un crash, le diagnostic un signal).

test_that("rapport_run porte le diagnostic de couverture quand il est fourni (issue #233)", {
  statuts <- tibble::tibble(
    id = "amenagements_cyclables", mode = "cron", status = "frais"
  )
  couverture <- tibble::tibble(
    departement = c("22", "29", "35", "56"),
    lignes_actuel = c(100, 200, 300, 400),
    km_actuel = c(10, 20, 30, 40),
    lignes_precedent = c(100, 200, 300, 400),
    km_precedent = c(10, 20, 30, 40),
    regression = c(FALSE, FALSE, FALSE, FALSE)
  )

  rapport <- rapport_run(statuts, "cron", timestamp = "2026-08-08T10:00:00Z",
                         couverture = couverture)

  expect_named(rapport, c("mode", "timestamp", "statuts", "couverture"))
  expect_identical(rapport$couverture, couverture)
})

test_that("ecrire_rapport_run écrit le diagnostic de couverture dans run-report.json (issue #233)", {
  statuts <- tibble::tibble(
    id = "amenagements_cyclables", mode = "cron", status = "frais"
  )
  couverture <- tibble::tibble(
    departement = c("22", "29", "35"),
    lignes_actuel = c(100, 200, 300),
    km_actuel = c(10, 20, 30),
    lignes_precedent = c(100, 50, 300),
    km_precedent = c(10, 5, 30),
    regression = c(FALSE, TRUE, FALSE)
  )
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))

  ecrire_rapport_run(statuts, mode = "cron", cible = cible,
                     timestamp = "2026-08-08T10:00:00Z", couverture = couverture)

  rapport <- jsonlite::fromJSON(file.path(cible, "run-report.json"))
  expect_named(rapport, c("mode", "timestamp", "statuts", "couverture"))
  expect_equal(nrow(rapport$couverture), 3)
  expect_equal(rapport$couverture$departement, c("22", "29", "35"))
  # le signal de régression voyage tel quel — 29 a perdu la moitié de ses km
  expect_true(rapport$couverture$regression[rapport$couverture$departement == "29"])
  expect_false(rapport$couverture$regression[rapport$couverture$departement == "22"])
})

test_that("le rapport SANS couverture garde la forme historique — jamais une clé vide (issue #233)", {
  statuts <- tibble::tibble(
    id = "serie_historique", mode = "cron", status = "frais"
  )

  rapport <- rapport_run(statuts, "cron", timestamp = "2026-08-08T10:00:00Z")

  # les thèmes sans diagnostic (Démographie, Habitat…) écrivent la forme
  # historique — la clé couverture n'apparaît pas
  expect_named(rapport, c("mode", "timestamp", "statuts"))
})
