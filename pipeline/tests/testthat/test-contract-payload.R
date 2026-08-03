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

test_that("chaque territoire porte 4 clés d'indicateur (structure = 7 tranches)", {
  payload <- compute_payload(load_fixture())

  attentes <- c(densite = 1, structure_age = 7, evolution_1968 = 1,
                taille_menages = 1)
  for (code in unique(payload$indicateurs$territoire)) {
    tab <- payload$indicateurs[payload$indicateurs$territoire == code, , drop = FALSE]
    for (cle in names(attentes)) {
      expect_equal(sum(tab$key == cle), attentes[[cle]], info = paste(code, cle))
    }
  }
})

test_that("la forme des trois tables est le contrat", {
  payload <- compute_payload(load_fixture())

  expect_named(payload, c("indicateurs", "histoires", "territoires"))
  expect_named(payload$indicateurs, c(
    "territoire", "type", "theme", "key", "detail", "value", "unit",
    "rang_epci", "rang_dep", "rang_reg",
    "vintage_source", "vintage_version",
    "vintage_date_reference", "vintage_date_publication"
  ))
  expect_named(payload$histoires, c(
    "territoire", "type", "theme", "story_key",
    "solde_naturel", "solde_migratoire", "classification"
  ))
  expect_named(payload$territoires, c(
    "territoire", "type", "nom", "departement"
  ))
  expect_true(all(payload$indicateurs$theme == "demographie"))
  expect_true(all(payload$histoires$theme == "demographie"))
})

test_that("la table de référence couvre les mêmes territoires, une fois chacun", {
  payload <- compute_payload(load_fixture())

  territoires_attendus <- c(
    "22001", "22002", "29001", "29002", # communes
    "200000001", "200000002",           # EPCIs
    "22", "29",                         # départements
    "53"                                # région Bretagne
  )
  expect_setequal(payload$territoires$territoire, territoires_attendus)
  expect_equal(nrow(payload$territoires), length(territoires_attendus))
  # chaque territoire de la référence existe dans les deux tables de faits
  expect_setequal(unique(payload$indicateurs$territoire), territoires_attendus)
  expect_setequal(unique(payload$histoires$territoire), territoires_attendus)
})

test_that("la table de référence porte les noms réels (LIBGEO/LIBEPCI)", {
  payload <- compute_payload(load_fixture())
  tr <- payload$territoires

  # communes : LIBGEO
  expect_equal(tr$nom[tr$territoire == "22001"], "Commune A1")
  expect_equal(tr$nom[tr$territoire == "29002"], "Commune C")
  # EPCIs : LIBEPCI, jamais le SIREN
  expect_equal(tr$nom[tr$territoire == "200000001"], "EPCI X")
  expect_equal(tr$nom[tr$territoire == "200000002"], "EPCI Y")
  expect_false(any(grepl("^EPCI 200", tr$nom[tr$type == "epci"])))
  # départements et région
  expect_setequal(tr$nom[tr$type == "departement"], c("Département 22", "Département 29"))
  expect_equal(tr$nom[tr$type == "region"], "Bretagne")
})

test_that("la table de référence porte le département d'appartenance", {
  payload <- compute_payload(load_fixture())
  tr <- payload$territoires

  # une commune : son département
  expect_equal(tr$departement[tr$territoire == "22001"], "22")
  # un département : lui-même
  expect_equal(tr$departement[tr$territoire == "22"], "22")
  # la région n'appartient à aucun département
  expect_true(is.na(tr$departement[tr$territoire == "53"]))
})

test_that("chaque indicateur est estampillé depuis sa source de référence", {
  payload <- compute_payload(load_fixture())
  # plus de tampon de thème (issue #9) : l'estampille nomme la source de
  # référence de chaque indicateur — jamais un tampon commun.
  references <- c(
    densite = "INSEE — Série historique du recensement",
    structure_age = "INSEE — Population par sexe et âge (PRINC)",
    evolution_1968 = "INSEE — Série historique du recensement",
    taille_menages = "INSEE — Ménages (dossier complet)"
  )
  for (cle in names(references)) {
    srcs <- unique(payload$indicateurs$vintage_source[
      payload$indicateurs$key == cle
    ])
    expect_equal(srcs, references[[cle]], info = cle)
  }
  # trois sources de référence distinctes dans le payload
  expect_length(unique(payload$indicateurs$vintage_source), 3)
  # chaque estampille porte les deux dates : référence ET publication (point 5)
  expect_true(all(payload$indicateurs$vintage_date_reference == "2023-01-01"))
  expect_true(all(payload$indicateurs$vintage_date_publication == "2026-06-30"))
})
