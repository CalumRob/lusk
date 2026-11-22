# Empreinte des lectures WFS (issue #1119, revue 1) -------------------------------
# Une réponse GetFeature de data.geopf.fr porte une enveloppe VOLATILE :
# `timeStamp` (mesuré le 2026-11-22 : deux fetches à 2 s ne différaient que par
# lui) et, selon la charge, `numberMatched` / `numberReturned`. Le digest porte
# sur les OCTETS BRUTS de la plage du tableau `features`, tels qu'envoyés par le
# serveur : ni parse JSON, ni re-sérialisation (574 s sur le vrai fichier de
# 97 Mo avec jsonlite). Un seul helper sert toutes les lectures WFS.
#
# Seams testés, sans réseau ni données réelles :
#   1. empreinte_wfs_features — fichier cache (streamé) et corps brut (raw) ;
#   2. publier_geometrie (fetch injecté) — digest des trois couches WFS ;
#   3. resoudre_source (tirer injecté) — digest du cache communes_limites ;
#   4. audit structurel — aucun site ne hache une enveloppe WFS brute.

# --- 1. La plage d'octets `features` ---------------------------------------------

test_that("le digest hache exactement les octets de la plage features (#1119)", {
  communes <- fixture_communes_wfs_departements()
  brut <- fixture_wfs_brut(
    communes, timeStamp = "2026-11-22T17:51:09.979Z",
    numberMatched = 5L, numberReturned = 5L
  )
  chemin <- tempfile("wfs-span-")
  on.exit(unlink(chemin), add = TRUE)
  writeBin(charToRaw(brut), chemin)

  d <- empreinte_wfs_features(chemin)
  expect_identical(d$hachage, "octets_features_wfs")
  expect_identical(d$sha256, empreinte_wfs_features(charToRaw(brut))$sha256)

  # La borne de fin est le `]` de fermeture de features, pas la fin du fichier.
  attendu <- substr(brut, regexpr('"features":\\[', brut)[1] + 11L, nchar(brut))
  attendu <- substr(attendu, 1L, regexpr('\\],"numberMatched"', attendu)[1])
  expect_identical(d$bytes, as.numeric(nchar(attendu, type = "bytes")))
  # Preuve négative : ce n'est pas le sha256 de l'enveloppe entière.
  expect_false(identical(d$sha256, paste(openssl::sha256(charToRaw(brut)))))
})

test_that("deux enveloppes différentes aux mêmes features ont le même digest (#1119)", {
  sain <- fixture_geometrie_wfs_saine()
  a <- fixture_wfs_octets(
    sain$communes, timeStamp = "2026-11-22T17:51:09.979Z",
    numberMatched = 5L, numberReturned = 5L
  )
  b <- fixture_wfs_octets(
    sain$communes, timeStamp = "2026-11-22T17:51:12.123456Z",
    numberMatched = 999L, numberReturned = 999L,
    crs = list(type = "name", properties = list(name = "urn:ogc:def:crs:EPSG::4326"))
  )
  expect_identical(empreinte_wfs_features(a)$sha256, empreinte_wfs_features(b)$sha256)
  expect_identical(empreinte_wfs_features(a)$bytes, empreinte_wfs_features(b)$bytes)
})

test_that("des features différentes changent le digest (#1119)", {
  sain <- fixture_geometrie_wfs_saine()
  modifiees <- sain$communes
  modifiees$features[[1]]$properties$nom_officiel <- "Commune renommée"
  a <- empreinte_wfs_features(fixture_wfs_octets(sain$communes, timeStamp = "t1"))
  b <- empreinte_wfs_features(fixture_wfs_octets(modifiees, timeStamp = "t2"))
  expect_false(identical(a$sha256, b$sha256))
  expect_false(identical(a$bytes, b$bytes))
})

test_that("une enveloppe non reconnue échoue bruyamment, sans repli (#1119)", {
  sans_features <- charToRaw('{"type":"FeatureCollection","timeStamp":"t"}')
  expect_error(
    empreinte_wfs_features(sans_features), "features",
    class = "erreur_enveloppe_wfs"
  )
  sans_queue <- charToRaw('{"type":"FeatureCollection","features":[]}')
  expect_error(
    empreinte_wfs_features(sans_queue), "fin",
    class = "erreur_enveloppe_wfs"
  )
})

test_that("un énorme GeoJSON est haché en moins de 10 s, sans parse (#1119)", {
  chemin <- tempfile("wfs-gros-")
  on.exit(unlink(chemin), add = TRUE)
  # ~50 Mo : un feature répété, avec une vraie enveloppe GeoServer en tête/queue.
  un <- jsonlite::toJSON(
    fixture_communes_wfs_departements()$features[[1]],
    auto_unbox = TRUE, digits = NA, null = "null", na = "null"
  )
  bloc <- charToRaw(paste(rep(as.character(un), 1000L), collapse = ","))
  con <- file(chemin, "wb")
  on.exit(try(close(con), silent = TRUE), add = TRUE)
  writeBin(charToRaw('{"type":"FeatureCollection","features":['), con)
  for (i in seq_len(160L)) {
    writeBin(bloc, con)
    if (i < 160L) writeBin(as.raw(0x2C), con)
  }
  writeBin(charToRaw('],"numberMatched":160000,"numberReturned":160000,"timeStamp":"2026-11-22T17:51:09.979Z"}'), con)
  close(con)

  temps <- system.time(d <- empreinte_wfs_features(chemin))
  message(sprintf(
    "revue #1119 — digest features-span sur %.1f Mo : %.3f s",
    file.size(chemin) / 1e6, temps[["elapsed"]]
  ))
  expect_lt(temps[["elapsed"]], 10)
  expect_identical(d$hachage, "octets_features_wfs")
  expect_true(grepl("^[0-9a-f]{64}$", d$sha256))
})

# --- 2. Le fond de carte : le corps BRUT du fetch --------------------------------

digest_geometrie <- function(octets_communes, octets = fixture_geometrie_octets()) {
  sortie <- tempfile("geom-wfs-digest-")
  dir.create(sortie)
  on.exit(unlink(sortie, recursive = TRUE), add = TRUE)
  publier_geometrie(
    sortie,
    fetch = function(niveau) {
      if (identical(niveau, "communes")) octets_communes else octets[[niveau]]
    },
    horloge = as.Date("2026-11-22")
  )
  lire_digests_source(file.path(sortie, NOM_DIGESTS))$geometrie_communes
}

test_that("le digest geometry vient du corps brut, pas d'une re-sérialisation (#1119)", {
  sain <- fixture_geometrie_octets()
  a <- digest_geometrie(fixture_wfs_octets(
    fixture_communes_wfs_departements(), timeStamp = "2026-11-22T17:51:09.979Z",
    numberMatched = 5L, numberReturned = 5L
  ), sain)
  b <- digest_geometrie(fixture_wfs_octets(
    fixture_communes_wfs_departements(), timeStamp = "2026-11-22T17:51:12.123456Z",
    numberMatched = 999L, numberReturned = 999L
  ), sain)

  expect_identical(a$sha256, b$sha256)
  expect_identical(a$bytes, b$bytes)
  expect_identical(a$hachage, "octets_features_wfs")
  # Le même digest que le helper appliqué au même corps brut, quel que soit le
  # chemin (fichier de cache ou réponse réseau) qui l'a produit.
  brut <- fixture_wfs_brut(fixture_communes_wfs_departements(), timeStamp = "t1")
  tmp <- tempfile("wfs-croise-")
  on.exit(unlink(tmp), add = TRUE)
  writeBin(charToRaw(brut), tmp)
  expect_identical(
    digest_geometrie(charToRaw(brut), sain)$sha256,
    empreinte_wfs_features(tmp)$sha256
  )
})

test_that("des features différentes donnent des digests géométrie différents (#1119)", {
  sain <- fixture_geometrie_wfs_saine()
  modifiees <- sain$communes
  modifiees$features[[1]]$properties$nom_officiel <- "Commune renommée"
  octets <- fixture_geometrie_octets()

  d1 <- digest_geometrie(fixture_wfs_octets(sain$communes, timeStamp = "t1"), octets)
  d2 <- digest_geometrie(fixture_wfs_octets(modifiees, timeStamp = "t2"), octets)
  expect_false(identical(d1$sha256, d2$sha256))
})

# --- 3. Le cache communes_limites : mêmes octets, même helper --------------------
# communes_limites.geojson est téléchargé par le même WFS et CACHÉ tel quel. Les
# octets du fichier restent ceux du téléchargement : seul le DIGEST est porté sur
# la plage features, exactement comme pour le fond de carte.

resoudre_limites <- function(brut, cache) {
  resoudre_source(
    id = "communes_limites",
    url = MANIFEST_MOBILITE_COMMUNES_LIMITES$url[[1]],
    fichier = "communes_limites.geojson", cache = cache,
    lock = tempfile("lock-vide-limites-"),
    horloge = as.Date("2026-11-22"), vintage_basis = "telechargement",
    tirer = function(url, cible) writeBin(charToRaw(brut), cible)
  )
}

cache_neuf <- function() {
  cache <- tempfile("cache-limites-")
  dir.create(cache)
  cache
}

test_that("communes_limites : un timeStamp différent ne change pas le digest (#1119)", {
  c1 <- cache_neuf(); c2 <- cache_neuf()
  on.exit(unlink(c(c1, c2), recursive = TRUE), add = TRUE)
  communes <- fixture_communes_wfs_departements()

  a <- fixture_wfs_brut(communes, timeStamp = "2026-11-22T17:51:09.979Z",
                        numberMatched = 5L, numberReturned = 5L)
  b <- fixture_wfs_brut(communes, timeStamp = "2026-11-22T17:51:12.123456Z",
                        numberMatched = 999L, numberReturned = 999L)

  r1 <- resoudre_limites(a, c1)
  r2 <- resoudre_limites(b, c2)  # deux téléchargements, un seul changement : l'enveloppe

  expect_identical(r1$sha256, r2$sha256)
  expect_identical(r1$digest$bytes, r2$digest$bytes)
  expect_identical(r1$digest$hachage, "octets_features_wfs")
  # Cross-chemin : le même corps brut donne le même digest par les deux seams.
  expect_identical(r1$sha256, empreinte_wfs_features(charToRaw(a))$sha256)
  # Les octets du fichier restent BIEN ceux du téléchargement (enveloppe incluse).
  lire_brut <- function(p) rawToChar(readBin(p, "raw", n = file.info(p)$size))
  expect_true(grepl("17:51:09\\.979Z", lire_brut(file.path(c1, "communes_limites.geojson"))))
  expect_true(grepl("17:51:12\\.123456Z", lire_brut(file.path(c2, "communes_limites.geojson"))))

  # Après un re-téléchargement (mtime changé), le sidecar est réécrit depuis les
  # octets réels et reste valide — sa fraîcheur ne dépend PAS des `bytes`
  # de la plage features hachée.
  writeBin(charToRaw(b), file.path(c1, "communes_limites.geojson"))
  Sys.setFileTime(file.path(c1, "communes_limites.geojson"),
                  as.POSIXct("2026-11-23T09:00:00", tz = "UTC"))
  r3 <- resoudre_limites(b, c1)
  expect_identical(r3$sha256, r1$sha256)
  sidecar <- lire_digest_cache("communes_limites", c1, "communes_limites.geojson")
  expect_identical(sidecar$sha256, r3$sha256)
})

test_that("communes_limites : des features différentes changent le digest (#1119)", {
  c1 <- cache_neuf(); c2 <- cache_neuf()
  on.exit(unlink(c(c1, c2), recursive = TRUE), add = TRUE)
  communes <- fixture_communes_wfs_departements()
  modifiees <- communes
  modifiees$features[[1]]$properties$nom_officiel <- "Commune renommée"

  r1 <- resoudre_limites(
    fixture_wfs_brut(communes, timeStamp = "2026-11-22T17:51:09.979Z"), c1
  )
  r2 <- resoudre_limites(
    fixture_wfs_brut(modifiees, timeStamp = "2026-11-22T17:51:09.979Z"), c2
  )
  expect_false(identical(r1$sha256, r2$sha256))
})

test_that("les sources non-WFS gardent leur empreinte sur les octets bruts (#1119)", {
  cache <- tempfile("cache-brut-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE), add = TRUE)
  r <- resoudre_source(
    id = "flux_Ordinaire", url = "https://example.invalid/flux",
    fichier = "flux.bin", cache = cache, lock = tempfile("lock-vide-brut-"),
    horloge = as.Date("2026-11-22"), vintage_basis = "telechargement",
    tirer = function(url, cible) writeLines("octets ordinaires", cible)
  )
  expect_identical(r$digest$hachage, "octets_bruts")
  expect_identical(r$sha256, empreinte_fichier(file.path(cache, "flux.bin")))
})

# --- 4. Audit structurel : un seul propriétaire du hachage WFS ------------------

test_that("aucun site ne hache une enveloppe WFS brute (#1119)", {
  racine <- normalizePath(testthat::test_path("..", ".."))
  expect_silent(verifier_structure_hachages_wfs(racine))

  code_geom <- paste(readLines(file.path(racine, "R", "geometrie.R"), warn = FALSE),
                     collapse = "\n")
  expect_true(grepl("empreinte_wfs_features\\(", code_geom))
  expect_true(grepl("resp_body_raw", code_geom))
  expect_false(grepl("toJSON\\s*\\(\\s*brut", code_geom))
  expect_false(grepl("sha256\\s*\\(", code_geom))

  code_lock <- paste(readLines(file.path(racine, "R", "source_lock.R"), warn = FALSE),
                     collapse = "\n")
  expect_true(grepl("empreinte_source\\(id\\)", code_lock))
  expect_false(grepl("h <- empreinte_fichier\\(cible\\)", code_lock))

  # Le registre des lectures WFS est explicite : aucune source ne bascule par défaut.
  expect_true("communes_limites" %in% names(HACHAGE_WFS_PAR_ID))
  expect_identical(empreinte_source("flux_Ordinaire"), empreinte_fichier_brut)
})

test_that("l'audit structurel WFS échoue sur un hachage d'enveloppe ajouté (#1119)", {
  d <- tempfile("audit-wfs-")
  dir.create(file.path(d, "R"), recursive = TRUE)
  writeLines(c(
    "hache <- function(reponse) {",
    "  paste(openssl::sha256(charToRaw(jsonlite::toJSON(reponse))))",
    "}"
  ), file.path(d, "R", "new-wfs-read.R"))
  sites <- auditer_hachages_wfs(d)
  expect_true(any(grepl("new-wfs-read\\.R", sites$fichier) & sites$enveloppe))
  expect_error(verifier_structure_hachages_wfs(d), "raw GetFeature envelope")
})
