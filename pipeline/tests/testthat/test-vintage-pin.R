# Vintage publié et contrat de pinning (issue #1099) ----------------------------
# Le vintage publié doit être celui du fichier réellement épinglé, jamais le
# littéral du manifeste. Les sources datées existantes (INSEE, static.data.gouv,
# OSM millésimé) gardent leur vintage déclaré.

cache_vintage_fixture <- function() {
  cache <- tempfile("cache-vintage-")
  dir.create(file.path(cache, "pins"), recursive = TRUE)
  cache
}

test_that("le vintage publié d'une source épinglée vient du pin, pas du manifeste", {
  cache <- cache_vintage_fixture()
  on.exit(unlink(cache, recursive = TRUE))
  manifest <- tibble::tibble(
    id = "bornes-recharges", source = "Bornes", url = "https://example.invalid/bornes",
    fichier = "bornes.csv", vintage = "2026-07", date_reference = "2026-07-28",
    date_publication = "2026-08-04", licence = "lov2", note = "contrat historique",
    vintage_basis = "contenu_date_maj"
  )
  pin <- list(
    source_id = "bornes-recharges", sha256 = "abc", bytes = 10,
    downloaded_at = "2026-11-18", vintage = "2026-11",
    vintage_basis = "contenu_date_maj", date_reference = "2026-11-16",
    etat = "materialise"
  )
  jsonlite::write_json(pin, chemin_pin("bornes-recharges", cache), auto_unbox = TRUE)

  v <- vintages_depuis_manifest(manifest, cache = cache)

  # Le manifeste garde son littéral de contrat (les tests de contrat le lisent),
  # mais la table publiée porte le vintage réel du fichier épinglé.
  expect_equal(manifest$vintage, "2026-07")
  expect_equal(v$version, "2026-11")
  expect_equal(v$date_reference, "2026-11-16")
  expect_equal(v$date_publication, "2026-11-18")
})

test_that("les sources datées existantes gardent leur vintage déclaré", {
  cache <- cache_vintage_fixture()
  on.exit(unlink(cache, recursive = TRUE))

  v <- vintages_depuis_manifest(MANIFEST_DEMOGRAPHIE, cache = cache)
  expect_equal(v$version, MANIFEST_DEMOGRAPHIE$vintage)
  expect_equal(v$date_reference, MANIFEST_DEMOGRAPHIE$date_reference)
  expect_equal(v$date_publication, MANIFEST_DEMOGRAPHIE$date_publication)
  expect_equal(v$version[v$id == "serie_historique"], "2023")

  # static.data.gouv (le snapshot Geovelo) reste millésimé. OSM N'EST PAS une
  # source datée : sa base est « contenu_timestamp » et son vintage publié vient
  # du pin — elle est donc vérifiée dans son propre test ci-dessous.
  v <- vintages_depuis_manifest(MANIFEST_MOBILITE, cache = cache)
  cyclable <- v[v$id == "amenagements_cyclables", ]
  expect_equal(cyclable$version, "2026-08")
  expect_equal(cyclable$date_reference, "2026-08-07")
  expect_false("osm_reseaux" %in%
                 MANIFEST_MOBILITE$id[MANIFEST_MOBILITE$vintage_basis %in% "fichier_date"])
})

test_that("OSM est une source dérivée : son vintage publié vient du pin", {
  cache <- cache_vintage_fixture()
  on.exit(unlink(cache, recursive = TRUE))
  manifest <- MANIFEST_MOBILITE_OSM_RESEAUX
  pin <- list(
    source_id = "osm_reseaux", sha256 = "abc", bytes = 1,
    downloaded_at = "2026-11-18", vintage = "2026-11",
    vintage_basis = "contenu_timestamp", date_reference = "2026-11-16",
    etat = "materialise"
  )
  jsonlite::write_json(pin, chemin_pin("osm_reseaux", cache), auto_unbox = TRUE)

  v <- vintages_depuis_manifest(manifest, cache = cache)
  expect_equal(v$version, "2026-11")
  expect_equal(v$date_reference, "2026-11-16")
  expect_equal(v$date_publication, "2026-11-18")
  # La base déclarée est bien dérivée, pas « fichier_date ».
  expect_false(manifest$vintage_basis %in% "fichier_date")
})

test_that("vintages_mobilite lit le pin du cache explicite, pas celui versionné", {
  cache <- cache_vintage_fixture()
  on.exit(unlink(cache, recursive = TRUE))
  pin <- list(
    source_id = "osm_reseaux", sha256 = "abc", bytes = 1,
    downloaded_at = "2027-01-06", vintage = "2027-01",
    vintage_basis = "contenu_timestamp", date_reference = "2027-01-05",
    etat = "materialise"
  )
  jsonlite::write_json(pin, chemin_pin("osm_reseaux", cache), auto_unbox = TRUE)

  v_cache <- vintages_mobilite(cache = cache)
  osm_cache <- v_cache[v_cache$id == "osm_reseaux", ]
  expect_equal(osm_cache$version, "2027-01")
  expect_equal(osm_cache$date_reference, "2027-01-05")
  expect_equal(osm_cache$date_publication, "2027-01-06")

  # Le pin par défaut (versionné) donne un autre vintage : le cache est bien
  # l'entrée de la dérivation, et non une variable d'environnement implicite.
  osm_defaut <- vintages_mobilite()[vintages_mobilite()$id == "osm_reseaux", ]
  expect_false(identical(osm_cache$version, osm_defaut$version))
})

test_that("les trois sources migrées déclarent une base de vintage dérivée", {
  expect_equal(MANIFEST_MOBILITE_OSM_RESEAUX$vintage_basis, "contenu_timestamp")
  expect_equal(MANIFEST_MOBILITE_KORRIGO$vintage_basis, "telechargement")
  expect_equal(MANIFEST_MOBILITE_BORNES$vintage_basis, "contenu_date_maj")
  expect_setequal(
    names(SOURCES_EPINGLEES),
    c("osm_reseaux", "korrigo", "bornes-recharges")
  )
})

test_that("toute source de manifeste déclare un vintage_basis valide", {
  manifestes <- tous_manifestes()
  expect_true(length(manifestes) >= 10L)
  for (manifeste in manifestes) {
    declare <- avec_vintage_basis(manifeste)
    expect_false(any(is.na(declare$vintage_basis)))
    expect_true(all(declare$vintage_basis %in% BASIS_VINTAGE))
  }
})
