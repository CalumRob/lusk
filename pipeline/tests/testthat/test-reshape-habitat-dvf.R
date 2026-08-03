# Le reshape DVF (issue #15) --------------------------------------------------
# La source Habitat « DVF géolocalisées » (Etalab) : des fichiers par
# département par année, ~40 colonnes, où UNE vente peut s'étaler sur plusieurs
# lignes (n locaux × p natures de culture sur une parcelle, le prix répété sur
# chaque ligne — docs/research/dvf.md §6.3). Le reshape :
#   1. filtre nature_mutation = "Vente" (les VEFA, adjudications, expropriations
#      tombent — match exact, docs/research/dvf.md §6.6) ;
#   2. ne garde que les locaux maison/appartement (code_type_local 1/2) ;
#   3. jette les lignes sans prix ou sans surface bâtie (les valeurs manquantes
#      sont réelles, §6.5) ;
#   4. déduplique par id_mutation : UNE ligne par mutation, le prix pris UNE
#      fois (jamais compté deux fois), la surface bâtie sommée sur les locaux
#      distincts de la mutation (distincts par parcelle × type × surface — le
#      même local répété pour 2 natures de culture ne compte qu'une fois, mais
#      deux locaux identiques sur deux parcelles comptent deux fois) ;
#   5. garde le code commune 5 chiffres et dérive l'année + le département.
# Le fixture reproduit le VRAI en-tête (40 colonnes, docs/research/dvf.md §3.2)
# et couvre tous les cas ci-dessus. Le réseau n'entre jamais dans la boucle de
# test.

charger_fixture_dvf <- function() {
  readr::read_csv(
    testthat::test_path("fixtures", "dvf-transactions-fixture.csv"),
    col_types = readr::cols(.default = readr::col_character()),
    show_col_types = FALSE
  )
}

test_that("le fixture reproduit le vrai en-tête DVF géolocalisées (40 colonnes)", {
  f <- charger_fixture_dvf()
  expect_equal(ncol(f), 40)
  expect_equal(
    names(f),
    c(
      "id_mutation", "date_mutation", "numero_disposition", "nature_mutation",
      "valeur_fonciere", "adresse_numero", "adresse_suffixe", "adresse_nom_voie",
      "adresse_code_voie", "code_postal", "code_commune", "nom_commune",
      "code_departement", "ancien_code_commune", "ancien_nom_commune",
      "id_parcelle", "ancien_id_parcelle", "numero_volume",
      "lot1_numero", "lot1_surface_carrez", "lot2_numero", "lot2_surface_carrez",
      "lot3_numero", "lot3_surface_carrez", "lot4_numero", "lot4_surface_carrez",
      "lot5_numero", "lot5_surface_carrez", "nombre_lots",
      "code_type_local", "type_local", "surface_reelle_bati",
      "nombre_pieces_principales",
      "code_nature_culture", "nature_culture",
      "code_nature_culture_speciale", "nature_culture_speciale",
      "surface_terrain", "longitude", "latitude"
    )
  )
  # le fixture contient bien des mutations multi-lignes (le cas à dédupliquer)
  expect_true(any(duplicated(charger_fixture_dvf()$id_mutation)))
})

test_that("lire_transactions_dvf lit le fichier, y compris compressé .csv.gz", {
  f <- lire_transactions_dvf(
    testthat::test_path("fixtures", "dvf-transactions-fixture.csv")
  )
  expect_equal(ncol(f), 40)
  expect_equal(nrow(f), 18)

  # readr décompresse le .gz transparentement : une copie compressée du fixture
  # se lit à l'identique
  copie <- tempfile(fileext = ".csv.gz")
  on.exit(unlink(copie))
  con <- gzfile(copie, "w")
  writeLines(readLines(
    testthat::test_path("fixtures", "dvf-transactions-fixture.csv")
  ), con)
  close(con)

  gz <- lire_transactions_dvf(copie)
  expect_equal(gz, f)
})

test_that("le reshape garde les Vente et écarte les autres natures de mutation", {
  p <- nettoyer_transactions_dvf(charger_fixture_dvf())
  # m-1004 (expropriation) et m-1009 (VEFA) tombent au match exact "Vente"
  expect_false("2025-1004" %in% p$id_mutation)
  expect_false("2025-1009" %in% p$id_mutation)
  expect_true(all(p$id_mutation %in% c(
    "2025-1001", "2025-1002", "2025-1003", "2025-1010", "2025-1011", "2025-1012"
  )))
})

test_that("le reshape ne garde que maison/appartement (codes 1/2)", {
  p <- nettoyer_transactions_dvf(charger_fixture_dvf())
  # m-1007 (dépendance, type 3) et m-1008 (local commercial, type 4) tombent
  expect_false("2025-1007" %in% p$id_mutation)
  expect_false("2025-1008" %in% p$id_mutation)
  expect_setequal(unique(p$type_local), c("maison", "appartement"))
})

test_that("le reshape jette les lignes sans prix ou sans surface", {
  p <- nettoyer_transactions_dvf(charger_fixture_dvf())
  # m-1005 (prix vide), m-1006 (surface vide), m-1013 (prix nul), m-1014
  # (surface nulle) tombent
  expect_false(any(c("2025-1005", "2025-1006", "2025-1013", "2025-1014") %in%
                     p$id_mutation))
  expect_true(all(p$valeur_fonciere > 0))
  expect_true(all(p$surface_reelle_bati > 0))
})

test_that("une mutation multi-lignes est dédupliquée à UNE ligne, prix pris une fois", {
  p <- nettoyer_transactions_dvf(charger_fixture_dvf())
  # m-1001 : 2 lignes sources (2 natures de culture, prix 300000 répété) -> 1
  # ligne, prix compté UNE fois, surface du local comptée UNE fois
  m <- p[p$id_mutation == "2025-1001", ]
  expect_equal(nrow(m), 1)
  expect_equal(m$valeur_fonciere, 300000)
  expect_equal(m$surface_reelle_bati, 121)
  expect_equal(m$n_locaux, 1)
})

test_that("le prix n'est jamais compté deux fois sur le fixture entier", {
  p <- nettoyer_transactions_dvf(charger_fixture_dvf())
  # la somme des prix traités = la somme des prix UNIQUES des mutations gardées
  # (m-1001 portait 300000 sur ses 2 lignes sources : il ne compte qu'une fois)
  attendu <- 300000 + 250000 + 180000 + 280000 + 310000 + 120000
  expect_equal(sum(p$valeur_fonciere), attendu)
  expect_false(any(duplicated(p$id_mutation)))
})

test_that("deux locaux identiques sur deux parcelles : surfaces sommées", {
  p <- nettoyer_transactions_dvf(charger_fixture_dvf())
  # m-1010 : deux maisons de 80 m² sur DEUX parcelles — n_locaux = 2, la
  # surface n'est pas écrasée par la dédupe
  m <- p[p$id_mutation == "2025-1010", ]
  expect_equal(nrow(m), 1)
  expect_equal(m$surface_reelle_bati, 160)
  expect_equal(m$n_locaux, 2)
  expect_equal(m$type_local, "maison")
})

test_that("une mutation mixte porte le type dominant (plus grande surface bâtie)", {
  p <- nettoyer_transactions_dvf(charger_fixture_dvf())
  # m-1011 : maison 60 m² + appartement 78 m² — le type dominant est
  # l'appartement, la surface est la somme des deux
  m <- p[p$id_mutation == "2025-1011", ]
  expect_equal(nrow(m), 1)
  expect_equal(m$type_local, "appartement")
  expect_equal(m$surface_reelle_bati, 138)
  expect_equal(m$n_locaux, 2)
})

test_that("la table traitée est codée commune 5 chiffres, datée et typée", {
  p <- nettoyer_transactions_dvf(charger_fixture_dvf())
  # une ligne par mutation, 6 mutations gardées (dont la non-bretonne 44001)
  expect_equal(nrow(p), 6)
  expect_true(all(nchar(p$code_commune) == 5))
  # l'année est dérivée de la date de mutation ISO-8601
  expect_equal(p$date_mutation[p$id_mutation == "2025-1003"], "2025-03-01")
  expect_equal(p$annee, rep("2025", 6))
  # la colonne departement sert la garde Bretagne de l'assemblage
  expect_equal(p$departement[p$id_mutation == "2025-1012"], "44")
  expect_named(
    p,
    c("id_mutation", "code_commune", "date_mutation", "annee", "departement",
      "type_local", "valeur_fonciere", "surface_reelle_bati", "n_locaux")
  )
})

test_that("construire_transactions_dvf assemble depuis le cache et garde la Bretagne", {
  # un mini-manifeste pointant sur une copie compressée du fixture, posée dans
  # un cache temporaire — jamais de réseau
  cache <- tempfile("cache-dvf-")
  dir.create(cache)
  sortie <- tempfile(fileext = ".rds")
  on.exit(unlink(c(cache, sortie), recursive = TRUE))

  copie <- file.path(cache, "dvf_2025_dep22.csv.gz")
  con <- gzfile(copie, "w")
  writeLines(readLines(
    testthat::test_path("fixtures", "dvf-transactions-fixture.csv")
  ), con)
  close(con)

  mini <- tibble::tibble(
    id = "dvf_2025_dep22", source = "Etalab — DVF géolocalisées",
    url = "https://example.invalid/dvf_2025_dep22.csv.gz",
    fichier = "dvf_2025_dep22.csv.gz", vintage = "2025",
    date_reference = "2025-12-31", date_publication = "2026-05-18",
    licence = "lov2", note = "test", mode = "manuel", type = "fichier"
  )

  t <- construire_transactions_dvf(cache = cache, sortie = sortie,
                                   manifest = mini)

  # la garde Bretagne (filter_bretagne) élimine la mutation non-bretonne 44001
  expect_false("2025-1012" %in% t$id_mutation)
  expect_equal(nrow(t), 5)
  expect_true(all(t$departement %in% DEPT_BRETAGNE))
  # le résultat est persisté au format du cache des données traitées
  expect_true(file.exists(sortie))
  expect_identical(readr::read_rds(sortie), t)
  # tri déterministe : commune puis date puis id
  expect_equal(t$code_commune, sort(t$code_commune))
})
