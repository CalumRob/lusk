# Validation structurelle des téléchargements textuels (issue #1108) ------------
# Un CSV/JSON tronqué ressemble à une dérive amont : il passe le garde-fou
# « existe et non vide » puis est réutilisé comme frais à chaque run. Ces tests
# verrouillent le SEAM unique verifier_fichier()/verifier_source(), appelé par
# resoudre_source() tant sur un téléchargement neuf que sur la réutilisation
# d'un fichier déjà en cache. Aucun réseau, aucune donnée réelle.

# Un export ODS réaliste : séparateur ';', géométries entre guillemets contenant
# ',' et ';' — la forme exacte qui a trompé la vérification « colonne par colonne »
# (liste-ti-communes.csv, 103 Mo, coupé à 9 Mo en milieu de géométrie).
csv_ods_lignes <- function(n = 3L) {
  entete <- "id_ti;lib_ti;geom;centroid;lib_com"
  lignes <- vapply(seq_len(n), function(i) {
    paste0(
      "ti-", i, ";Territoire ", i, ";",
      '"{type:Point,coordinates:[1;2,3;4]}"',
      ';"1,2;3,4";Commune ', i
    )
  }, character(1))
  c(entete, lignes)
}

ecrire_csv <- function(chemin, lignes, saut = "\n") {
  writeBin(charToRaw(paste0(paste(lignes, collapse = saut), saut)), chemin)
}

# coupe au milieu du dernier enregistrement : pas de newline final, comme le
# fichier réel du 2026-11-18 (9 001 555 octets, 1 546 lignes, géométrie ouverte).
csv_tronque_milieu <- function(lignes) {
  texte <- paste(lignes, collapse = "\n")
  substr(texte, 1L, nchar(texte) - 12L)
}

test_that("verifier_fichier : un CSV ODS complet passe, tronqué en milieu d'enregistrement il est rejeté", {
  cache <- tempfile("cache-csv-valide-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  complet <- file.path(cache, "liste-ti-communes.csv")
  ecrire_csv(complet, csv_ods_lignes(3L))
  expect_true(verifier_fichier(complet))

  tronque <- file.path(cache, "liste-ti-tronque.csv")
  writeBin(charToRaw(csv_tronque_milieu(csv_ods_lignes(3L))), tronque)
  expect_false(verifier_fichier(tronque))
})

test_that("verifier_fichier : un CSV CRLF à séparateur ';' passe (forme réelle des exports ODS)", {
  cache <- tempfile("cache-csv-crlf-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  cible <- file.path(cache, "liste-ti-communes.csv")
  ecrire_csv(cible, csv_ods_lignes(4L), saut = "\r\n")
  expect_true(verifier_fichier(cible))
})

test_that("verifier_fichier : un dernier enregistrement incomplet mais terminé par un saut de ligne est rejeté", {
  cache <- tempfile("cache-csv-record-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  # Une coupure juste après un saut de ligne INCLUIS dans un champ cité laisse
  # un fichier dont le dernier octet est bien '\n' : seul le contrôle du nombre
  # de champs (quote-aware) détecte la troncature.
  cible <- file.path(cache, "liste-ti-communes.csv")
  ecrire_csv(
    cible,
    c(csv_ods_lignes(2L), 'ti-3;Territoire 3;"geom')
  )
  expect_false(verifier_fichier(cible))
})

test_that("verifier_fichier : le séparateur ',' est détecté et les champs cités sont comptés une seule fois", {
  cache <- tempfile("cache-csv-virgule-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  lignes <- c(
    "siret;libelle;geometry",
    '0001;"Culture de céréales, et légumineuses";"POINT (1 2)"'
  )
  # ';' est le séparateur majoritaire de l'en-tête malgré les virgules citées.
  cible <- file.path(cache, "export.csv")
  ecrire_csv(cible, lignes)
  expect_true(verifier_fichier(cible))

  # un champ non cité contenant le séparateur change le nombre de champs -> rejet
  cible2 <- file.path(cache, "export-raggrade.csv")
  ecrire_csv(cible2, c(lignes[1], '0001;Culture;avec;champs;en;plus;"POINT (1 2)"'))
  expect_false(verifier_fichier(cible2))
})

test_that("verifier_fichier : les fixtures CSV du dépôt (',' et ';', CRLF) passent", {
  for (nom in c("programmes-ti-fixture.csv", "sirene-snapshot-fixture.csv",
                "demographie-fixture.csv")) {
    expect_true(
      verifier_fichier(testthat::test_path("fixtures", nom)),
      info = nom
    )
  }
})

test_that("verifier_fichier : un geojson complet sans newline final passe, un tronqué est rejeté", {
  cache <- tempfile("cache-geojson-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  # communes_limites.geojson se termine par '...}}}' SANS newline final.
  complet <- file.path(cache, "communes_limites.geojson")
  writeBin(charToRaw(
    '{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{}}]}'
  ), complet)
  expect_true(verifier_fichier(complet))

  # forme littérale relevée sur le cache réel : '...}}}' et aucun newline final
  forme_reelle <- file.path(cache, "communes_limites-reelle.geojson")
  writeBin(charToRaw('{"a":{"b":{"c":{}}}}'), forme_reelle)
  expect_true(verifier_fichier(forme_reelle))

  tronque <- file.path(cache, "communes_limites-tronque.geojson")
  writeBin(charToRaw(
    '{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{'
  ), tronque)
  expect_false(verifier_fichier(tronque))
})

test_that("verifier_fichier : un JSON accepte les blancs finaux et les tableaux, pas un texte tronqué", {
  cache <- tempfile("cache-json-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  blancs <- file.path(cache, "avec-blancs.json")
  writeBin(charToRaw('{"a":1}\n  \t\n'), blancs)
  expect_true(verifier_fichier(blancs))

  tableau <- file.path(cache, "tableau.json")
  writeBin(charToRaw('[1, 2, 3]'), tableau)
  expect_true(verifier_fichier(tableau))

  tronque <- file.path(cache, "tronque.json")
  writeBin(charToRaw('{"a":1, "b":[1, 2'), tronque)
  expect_false(verifier_fichier(tronque))
})

test_that("verifier_fichier : les formats non textuels gardent leurs contrôles (rien n'est touché)", {
  cache <- tempfile("cache-binaire-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  # .csv.gz a pour extension 'gz' : jamais soumis aux règles CSV, même sans '\n'.
  gz <- file.path(cache, "export.csv.gz")
  writeBin(as.raw(c(0x1f, 0x8b, 0x08, 0x00)), gz)
  expect_true(verifier_fichier(gz))

  # un .rds valide est toujours relu (le contrôle historique reste intact).
  rds <- file.path(cache, "source.rds")
  readr::write_rds(tibble::tibble(x = 1), rds)
  expect_true(verifier_fichier(rds))
})

test_that("resoudre_source re-télécharge un CSV tronqué en cache au lieu de le réutiliser", {
  cache <- tempfile("cache-resolveur-csv-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))
  cible <- file.path(cache, "liste-ti-communes.csv")
  writeBin(charToRaw(csv_tronque_milieu(csv_ods_lignes(3L))), cible)

  appels <- 0L
  r <- resoudre_source(
    id = "territoires_industrie",
    url = "https://example.invalid/exports/csv/liste-ti-communes.csv",
    fichier = "liste-ti-communes.csv", cache = cache,
    lock = tempfile("lock-resolveur-csv-"),
    horloge = as.Date("2026-11-22"), vintage_basis = "declaree",
    tirer = function(url, cible) {
      appels <<- appels + 1L
      ecrire_csv(cible, csv_ods_lignes(5L))
    }
  )

  expect_equal(appels, 1L)             # le fichier tronqué n'a PAS été réutilisé
  expect_identical(r$statut, "frais")
  expect_true(verifier_fichier(cible))
  expect_equal(length(strsplit(rawToChar(readBin(cible, "raw", n = file.size(cible))), "\n")[[1]]) - 1L, 5L)
})

test_that("resoudre_source re-télécharge un geojson tronqué en cache au lieu de le réutiliser", {
  cache <- tempfile("cache-resolveur-geojson-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))
  cible <- file.path(cache, "communes_limites.geojson")
  writeBin(charToRaw('{"type":"FeatureCollection","features":[{"type":"Featur'), cible)

  appels <- 0L
  r <- resoudre_source(
    id = "communes_limites", url = "https://example.invalid/communes.geojson",
    fichier = "communes_limites.geojson", cache = cache,
    lock = tempfile("lock-resolveur-geojson-"),
    horloge = as.Date("2026-11-22"), vintage_basis = "declaree",
    tirer = function(url, cible) {
      appels <<- appels + 1L
      # Une vraie réponse WFS porte un membre d'enveloppe après `features` : le
      # digest communes_limites hache cette plage d'octets (#1119).
      writeBin(charToRaw(
        '{"type":"FeatureCollection","features":[],"timeStamp":"2026-11-22T17:51:09.979Z"}'
      ), cible)
    }
  )

  expect_equal(appels, 1L)
  expect_identical(r$statut, "frais")
  expect_true(verifier_fichier(cible))
})

test_that("resoudre_source épuise ses 2 essais quand le CSV reste tronqué après re-téléchargement", {
  cache <- tempfile("cache-resolveur-echec-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))
  cible <- file.path(cache, "liste-ti-communes.csv")
  tronque <- csv_tronque_milieu(csv_ods_lignes(3L))
  writeBin(charToRaw(tronque), cible)

  appels <- 0L
  err <- tryCatch(
    resoudre_source(
      id = "territoires_industrie",
      url = "https://example.invalid/exports/csv/liste-ti-communes.csv",
      fichier = "liste-ti-communes.csv", cache = cache,
      lock = tempfile("lock-resolveur-echec-"),
      horloge = as.Date("2026-11-22"), vintage_basis = "declaree",
      tirer = function(url, cible) {
        appels <<- appels + 1L
        writeBin(charToRaw(tronque), cible)   # le serveur renvoie toujours 9 Mo
      }
    ),
    error = function(e) e
  )

  expect_s3_class(err, "erreur_telechargement")
  expect_match(conditionMessage(err), "Téléchargement invalide après 2 essais")
  expect_equal(appels, 2L)
  expect_false(file.exists(cible))
})

test_that("download_sources remplace un CSV tronqué du cache par un téléchargement valide", {
  cache <- tempfile("cache-download-csv-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))
  cible <- file.path(cache, "liste-ti-communes.csv")
  writeBin(charToRaw(csv_tronque_milieu(csv_ods_lignes(3L))), cible)

  manifeste <- tibble::tibble(
    id = "test_csv_tronque", source = "test",
    url = "https://example.invalid/exports/csv/liste-ti-communes.csv",
    fichier = "liste-ti-communes.csv", mode = "cron", type = "fichier",
    vintage = "2025", date_reference = "2025-01-01", vintage_basis = "declaree"
  )
  appels <- 0L
  local_mocked_bindings(
    telecharger_fichier = function(url, cible) {
      appels <<- appels + 1L
      ecrire_csv(cible, csv_ods_lignes(4L))
    },
    .package = "lusk"
  )

  statuts <- download_sources(manifeste, cache, mode = "cron")

  expect_equal(appels, 1L)
  expect_equal(statuts$status, "frais")
  expect_true(verifier_fichier(cible))
})
