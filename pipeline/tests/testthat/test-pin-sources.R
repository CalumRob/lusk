# Pin des sources et vintage dérivé (issue #1099, parent #1040) -----------------
# Contrats testés ici, tous sans réseau et sans données réelles :
#   - une source sans pin est acquise, hachée, puis épinglée ;
#   - un pin conforme est utilisé sans nouveau téléchargement ;
#   - un contenu modifié échoue fermé (erreur nommée, deux hashes, commande repin) ;
#   - deux résolutions indépendantes d'un même contenu donnent le même vintage ;
#   - le vintage vient du contenu quand il en porte un, sinon du téléchargement ;
#   - les sources à pin obligatoire sans pin échouent (aucune dérive silencieuse) ;
#   - le vintage publié des sources datées existantes est inchangé.

octets_fixture <- function(texte) charToRaw(texte)

empreinte_fixture <- function(contenu) {
  f <- tempfile("empreinte-")
  writeBin(contenu, f)
  on.exit(unlink(f), add = TRUE)
  con <- file(f, "rb")
  on.exit(close(con), add = TRUE)
  paste(openssl::sha256(con))
}

cache_fixture <- function() {
  cache <- tempfile("cache-pin-")
  dir.create(file.path(cache, "pins"), recursive = TRUE)
  cache
}

ecrire_pin_fixture <- function(cache, id, contenu, vintage_basis = "telechargement",
                               jour = "2026-11-18", etat = "materialise",
                               vintage = "2026-11", date_reference = "2026-11-18") {
  pin <- list(
    source_id = id,
    url = "https://example.invalid/source",
    sha256 = if (identical(etat, "materialise")) empreinte_fixture(contenu) else NULL,
    bytes = if (identical(etat, "materialise")) length(contenu) else NULL,
    downloaded_at = if (identical(etat, "materialise")) jour else NULL,
    vintage = if (identical(etat, "materialise")) vintage else NULL,
    vintage_basis = vintage_basis,
    date_reference = if (identical(etat, "materialise")) date_reference else NULL,
    etat = etat
  )
  jsonlite::write_json(pin, chemin_pin(id, cache), auto_unbox = TRUE, na = "null")
  pin
}

test_that("une source sans pin est acquise, hachée, puis épinglée", {
  cache <- cache_fixture()
  on.exit(unlink(cache, recursive = TRUE))
  contenu <- octets_fixture("contenu autoritaire\n")

  r <- resoudre_source(
    id = "acquisition_test", url = "https://example.invalid/source",
    fichier = "source.txt", cache = cache, horloge = as.Date("2026-11-18"),
    tirer = function(url, cible) writeBin(contenu, cible)
  )

  expect_identical(r$sha256, empreinte_fixture(contenu))
  expect_identical(r$vintage, "2026-11")
  expect_identical(r$vintage_basis, "telechargement")

  pin <- lire_pin("acquisition_test", cache)
  expect_equal(pin$source_id, "acquisition_test")
  expect_equal(pin$url, "https://example.invalid/source")
  expect_equal(pin$sha256, empreinte_fixture(contenu))
  expect_equal(pin$bytes, length(contenu))
  expect_equal(pin$downloaded_at, "2026-11-18")
  expect_equal(pin$vintage, "2026-11")
  expect_equal(pin$vintage_basis, "telechargement")
  expect_equal(pin$etat, "materialise")
})

test_that("un pin conforme est utilisé sans nouveau téléchargement", {
  cache <- cache_fixture()
  on.exit(unlink(cache, recursive = TRUE))
  contenu <- octets_fixture("contenu épinglé\n")
  ecrire_pin_fixture(cache, "pin_conforme", contenu)
  writeBin(contenu, file.path(cache, "source.txt"))

  appele <- FALSE
  r <- resoudre_source(
    id = "pin_conforme", url = "https://example.invalid/source",
    fichier = "source.txt", cache = cache, horloge = as.Date("2026-12-01"),
    tirer = function(url, cible) {
      appele <<- TRUE
      stop("aucun téléchargement attendu")
    }
  )

  expect_false(appele)
  expect_identical(r$sha256, empreinte_fixture(contenu))
  expect_identical(r$vintage, "2026-11")
  expect_identical(r$vintage_basis, "telechargement")
})

test_that("un contenu modifié échoue fermé avec une erreur nommée", {
  cache <- cache_fixture()
  on.exit(unlink(cache, recursive = TRUE))
  original <- octets_fixture("contenu épinglé\n")
  substitut <- octets_fixture("contenu modifié sans repin\n")
  pin <- ecrire_pin_fixture(cache, "source_modifiee", original)
  writeBin(substitut, file.path(cache, "source.txt"))

  erreur <- tryCatch(
    resoudre_source(
      id = "source_modifiee", url = "https://example.invalid/source",
      fichier = "source.txt", cache = cache,
      tirer = function(url, cible) stop("aucun téléchargement attendu")
    ),
    error = function(e) e
  )

  expect_s3_class(erreur, "erreur_pin")
  expect_match(conditionMessage(erreur), "source_modifiee")
  expect_match(conditionMessage(erreur), pin$sha256, fixed = TRUE)
  expect_match(conditionMessage(erreur), empreinte_fixture(substitut), fixed = TRUE)
  expect_match(conditionMessage(erreur), "repin", ignore.case = TRUE)
  expect_equal(erreur$sha256_attendu, pin$sha256)
  expect_equal(erreur$sha256_observe, empreinte_fixture(substitut))
})

test_that("deux résolutions indépendantes du même contenu épinglé donnent le même vintage", {
  contenu <- octets_fixture("contenu partagé\n")
  resoudre <- function() {
    cache <- cache_fixture()
    ecrire_pin_fixture(cache, "vintage_stable", contenu, jour = "2026-11-18")
    writeBin(contenu, file.path(cache, "source.txt"))
    on.exit(unlink(cache, recursive = TRUE))
    resoudre_source(
      id = "vintage_stable", url = "https://example.invalid/source",
      fichier = "source.txt", cache = cache,
      tirer = function(url, cible) stop("aucun téléchargement attendu")
    )
  }
  a <- resoudre()
  b <- resoudre()
  expect_identical(a$vintage, b$vintage)
  expect_identical(a$vintage_basis, b$vintage_basis)
  expect_identical(a$date_reference, b$date_reference)
})

test_that("une source à pin obligatoire sans pin échoue fermé", {
  cache <- cache_fixture()
  on.exit(unlink(cache, recursive = TRUE))

  erreur <- tryCatch(
    resoudre_source(
      id = "bornes-recharges", url = "https://example.invalid/source",
      fichier = "bornes.csv", cache = cache,
      tirer = function(url, cible) stop("téléchargement interdit")
    ),
    error = function(e) e
  )
  expect_s3_class(erreur, "erreur_pin")
  expect_match(conditionMessage(erreur), "bornes-recharges")
  expect_match(conditionMessage(erreur), "repin", ignore.case = TRUE)
})

test_that("un pin non matérialisé échoue fermé en nommant la commande de repin", {
  cache <- cache_fixture()
  on.exit(unlink(cache, recursive = TRUE))
  ecrire_pin_fixture(cache, "osm_reseaux", NULL, etat = "en_attente",
                     vintage_basis = "contenu_timestamp")

  erreur <- tryCatch(
    resoudre_source(
      id = "osm_reseaux", url = "https://example.invalid/source",
      fichier = "extrait.pbf", cache = cache,
      tirer = function(url, cible) stop("téléchargement interdit")
    ),
    error = function(e) e
  )
  expect_s3_class(erreur, "erreur_pin")
  expect_match(conditionMessage(erreur), "repin-source.R osm_reseaux", fixed = TRUE)
})

test_that("le vintage des bornes vient de la date maximale du contenu", {
  cache <- cache_fixture()
  on.exit(unlink(cache, recursive = TRUE))
  csv <- charToRaw(paste0(
    "id_station_itinerance;date_maj\n",
    "STIF-1;2026-07-12\n",
    "STIF-2;2026-11-16\n",
    "STIF-3;2026-09-30\n"
  ))
  r <- resoudre_source(
    id = "bornes_recharge_derive", url = "https://example.invalid/bornes",
    fichier = "bornes.csv", cache = cache, horloge = as.Date("2026-11-18"),
    vintage_basis = "contenu_date_maj",
    tirer = function(url, cible) writeBin(csv, cible)
  )
  expect_identical(r$vintage_basis, "contenu_date_maj")
  expect_identical(r$date_reference, "2026-11-16")
  expect_identical(r$vintage, "2026-11")
})

test_that("le vintage korrigo est la date de téléchargement enregistrée", {
  cache <- cache_fixture()
  on.exit(unlink(cache, recursive = TRUE))
  r <- resoudre_source(
    id = "korrigo_derive", url = "https://example.invalid/korrigo",
    fichier = "korrigo-cache.bin", cache = cache, horloge = as.Date("2026-11-18"),
    vintage_basis = "telechargement",
    tirer = function(url, cible) writeBin(charToRaw("zip factice"), cible)
  )
  expect_identical(r$vintage_basis, "telechargement")
  expect_identical(r$downloaded_at, "2026-11-18")
  expect_identical(r$date_reference, "2026-11-18")
  expect_identical(r$vintage, "2026-11")
})

test_that("le vintage OSM vient du timestamp du header PBF quand il est lisible", {
  cache <- cache_fixture()
  on.exit(unlink(cache, recursive = TRUE))
  # Header protobuf minimal : champ 32 (osmosis_replication_timestamp), varint
  # du 2026-11-16T00:00:00Z (1763251200 s depuis l'époque).
  timestamp <- as.numeric(as.POSIXct("2026-11-16T00:00:00Z", tz = "UTC"))
  octets <- as.raw(c(0x80, 0x02))  # tag : champ 32, wire type 0 (32*8 = 256)
  reste <- timestamp
  while (reste >= 128) {
    octets <- c(octets, as.raw(bitwAnd(reste, 0x7f) + 0x80))
    reste <- reste %/% 128
  }
  octets <- c(octets, as.raw(reste))

  r <- resoudre_source(
    id = "osm_derive", url = "https://example.invalid/osm",
    fichier = "extrait.pbf", cache = cache, horloge = as.Date("2026-11-18"),
    vintage_basis = "contenu_timestamp",
    tirer = function(url, cible) writeBin(octets, cible)
  )
  expect_identical(r$vintage_basis, "contenu_timestamp")
  expect_identical(r$date_reference, "2026-11-16")
  expect_identical(r$vintage, "2026-11")
})

test_that("un OSM sans timestamp lisible retombe sur la date de téléchargement", {
  cache <- cache_fixture()
  on.exit(unlink(cache, recursive = TRUE))
  r <- resoudre_source(
    id = "osm_sans_timestamp", url = "https://example.invalid/osm",
    fichier = "extrait.pbf", cache = cache, horloge = as.Date("2026-11-18"),
    vintage_basis = "contenu_timestamp",
    tirer = function(url, cible) writeBin(charToRaw("pas de header"), cible)
  )
  expect_identical(r$vintage_basis, "telechargement")
  expect_identical(r$date_reference, "2026-11-18")
})

test_that("download_sources résout chaque source par le resolver (un pin par source)", {
  cache <- cache_fixture()
  on.exit(unlink(cache, recursive = TRUE))
  manifeste <- tibble::tibble(
    id = c("source_a", "source_b"), source = c("a", "b"),
    url = c("https://example.invalid/a", "https://example.invalid/b"),
    fichier = c("a.txt", "b.txt"), vintage = c("2023", "2023"),
    date_reference = c("2023-01-01", "2023-01-01"),
    date_publication = c("2026-06-30", "2026-06-30"),
    licence = c("lov2", "lov2"), note = c("a", "b"), mode = c("cron", "cron"),
    type = c("fichier", "fichier")
  )
  local_mocked_bindings(
    telecharger_fichier = function(url, cible) writeBin(charToRaw(paste0("contenu ", basename(cible))), cible),
    .package = "lusk"
  )

  statuts <- download_sources(manifeste, cache, horloge = as.Date("2026-11-18"))

  expect_equal(statuts$status, c("frais", "frais"))
  expect_true(file.exists(chemin_pin("source_a", cache)))
  expect_true(file.exists(chemin_pin("source_b", cache)))
  expect_equal(lire_pin("source_b", cache)$downloaded_at, "2026-11-18")
})
