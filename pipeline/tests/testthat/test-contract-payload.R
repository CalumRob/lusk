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

test_that("la forme des quatre tables est le contrat", {
  payload <- compute_payload(load_fixture())

  expect_named(payload, c("indicateurs", "histoires", "territoires", "apercu"))
  expect_named(payload$indicateurs, c(
    "territoire", "type", "theme", "key", "detail", "value", "unit",
    "rang_epci", "rang_dep", "rang_reg",
    "rang_epci_n", "rang_dep_n", "rang_reg_n",
    "vintage_source", "vintage_version",
    "vintage_date_reference", "vintage_date_publication"
  ))
  expect_named(payload$histoires, c(
    "territoire", "type", "theme", "groupe", "story_key", "salience_reason",
    "periode", "solde_naturel", "solde_migratoire",
    "taux_solde_naturel", "taux_solde_migratoire",
    "classification"
  ))
  expect_named(payload$territoires, c(
    "territoire", "type", "nom", "departement", "epci"
  ))
  expect_named(payload$apercu, c("territoire", "type", "key", "value", "unit"))
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
  # départements et région — le vrai nom INSEE, jamais « Département XX »
  # (issue #115)
  expect_setequal(tr$nom[tr$type == "departement"], c("Côtes-d'Armor", "Finistère"))
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

test_that("la table de référence porte l'EPCI (SIREN) des communes, NA pour les agrégats", {
  # issue #32 : la colonne epci — chaque commune porte l'EPCI dont elle est
  # membre (le SIREN, jamais le nom — le nom vit dans la colonne nom), les
  # EPCIs / départements / région portent NA (miroir de `departement`).
  payload <- compute_payload(load_fixture())
  tr <- payload$territoires

  # une commune : son EPCI (SIREN)
  expect_equal(tr$epci[tr$territoire == "22001"], "200000001")
  expect_equal(tr$epci[tr$territoire == "29002"], "200000002")
  # l'EPCI lui-même, le département et la région n'appartiennent à aucun EPCI
  expect_true(all(is.na(tr$epci[tr$type != "commune"])))
  # chaque EPCI de commune existe comme territoire EPCI de la référence
  # (l'échelle du contexte switcher : commune -> EPCI -> département -> région)
  expect_true(all(tr$epci[tr$type == "commune"] %in%
                    tr$territoire[tr$type == "epci"]))
})

test_that("la table apercu porte les clés de l'Aperçu pour chaque territoire", {
  # issue #32, ADR-0007 : la table des stats de base de l'onglet Aperçu —
  # une ligne par (territoire × clé), l'app la rend, elle ne la dérive pas.
  payload <- compute_payload(load_fixture())
  ap <- payload$apercu

  expect_named(ap, c("territoire", "type", "key", "value", "unit"))
  # 9 territoires × 3 clés (population, densité, part 65+)
  expect_equal(nrow(ap), 9 * 3)
  expect_setequal(unique(ap$territoire), payload$territoires$territoire)
  expect_setequal(unique(ap$key), c("population", "densite", "part_65_plus"))
  # pas de doublon (territoire × clé)
  expect_false(any(duplicated(ap[c("territoire", "key")])))
  # la colonne type est cohérente avec la référence
  for (code in unique(ap$territoire)) {
    expect_equal(
      ap$type[ap$territoire == code][1],
      payload$territoires$type[payload$territoires$territoire == code],
      info = code
    )
  }
})

test_that("la table apercu : les valeurs de base (population, densité, part 65+)", {
  payload <- compute_payload(load_fixture())
  ap <- payload$apercu

  valeur <- function(code, cle) ap$value[ap$territoire == code & ap$key == cle]
  # population : la population par territoire (somme par niveau d'agrégat)
  expect_equal(valeur("22001", "population"), 2000)
  expect_equal(valeur("200000001", "population"), 2400)
  expect_equal(valeur("53", "population"), 8400)
  # densité : population / superficie
  expect_equal(valeur("22001", "densite"), 200)
  # part 65+ : (65-79 + 80+) / population — dérivée des tranches de la
  # structure par âge, jamais une seconde source de chiffres
  expect_equal(valeur("22001", "part_65_plus"), (200 + 100) / 2000)
  # les unités du contrat
  expect_equal(ap$unit[ap$key == "population"], rep("hab.", 9))
  expect_equal(ap$unit[ap$key == "densite"], rep("hab/km²", 9))
  expect_equal(ap$unit[ap$key == "part_65_plus"], rep("%", 9))
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
