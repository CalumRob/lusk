# Le SEAM de test : la forme tabulaire du payload de la fiche
# (docs/architecture.md §Payload). Ce test EST le contrat : même fixture ->
# même payload, pour toujours. Les valeurs d'histoires (soldes + classification)
# arrivent au ticket 4 (issue #5).

test_that("le payload couvre chaque territoire du fixture", {
  payload <- compute_payload(load_fixture())

  territoires_attendus <- c(
    "22001", "22002", "29001", "29002", # communes
    "200000001", "200000002",           # EPCIs
    "22", "29",                         # départements
    "53"                                # région Bretagne
  )
  expect_setequal(unique(payload$indicateurs$territoire), territoires_attendus)
  expect_setequal(unique(payload$histoires$territoire), territoires_attendus)
})

test_that("chaque territoire porte 4 clés d'indicateur (structure = 5 lignes)", {
  payload <- compute_payload(load_fixture())

  attentes <- c(densite = 1, structure_age = 5, evolution_1968 = 1,
                taille_menages = 1)
  for (code in unique(payload$indicateurs$territoire)) {
    tab <- payload$indicateurs[payload$indicateurs$territoire == code, , drop = FALSE]
    for (cle in names(attentes)) {
      expect_equal(sum(tab$key == cle), attentes[[cle]], info = paste(code, cle))
    }
  }
})

test_that("la forme des deux tables est le contrat", {
  payload <- compute_payload(load_fixture())

  expect_named(payload$indicateurs, c(
    "territoire", "type", "theme", "key", "detail", "value", "unit",
    "rang_epci", "rang_dep", "rang_reg",
    "vintage_source", "vintage_version", "vintage_date"
  ))
  expect_named(payload$histoires, c(
    "territoire", "type", "theme", "story_key",
    "solde_naturel", "solde_migratoire", "classification"
  ))
  expect_true(all(payload$indicateurs$theme == "demographie"))
  expect_true(all(payload$histoires$theme == "demographie"))
})
