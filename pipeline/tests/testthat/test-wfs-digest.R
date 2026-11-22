# Empreinte canonique des lectures WFS (issue #1119) ------------------------------
# Une réponse GetFeature de data.geopf.fr porte une enveloppe VOLATILE :
# `timeStamp` (mesuré le 2026-11-22 : deux fetches à 2 s ne différaient que par
# lui) et, selon la charge, `numberMatched` / `numberReturned`. Le digest doit
# porter sur les FEATURES (la donnée), jamais sur l'enveloppe de transport —
# sinon le gel de release (ADR-0048) refuse toute publication.
#
# Seams testés, sans réseau ni données réelles :
#   1. publier_geometrie (fetch injecté) — digests des trois couches WFS ;
#   2. resoudre_source (tirer injecté) — digest du fichier cache communes_limites ;
#   3. audit structurel — aucun site ne hache une enveloppe WFS brute.

# --- 1. Le fond de carte : features, pas l'enveloppe -----------------------------

digest_geometrie <- function(collection_communes, sain = fixture_geometrie_wfs_saine()) {
  sortie <- tempfile("geom-wfs-digest-")
  dir.create(sortie)
  on.exit(unlink(sortie, recursive = TRUE), add = TRUE)
  publier_geometrie(
    sortie,
    fetch = function(niveau) {
      if (identical(niveau, "communes")) collection_communes else sain[[niveau]]
    },
    horloge = as.Date("2026-11-22")
  )
  lire_digests_source(file.path(sortie, NOM_DIGESTS))$geometrie_communes
}

test_that("deux réponses WFS identiques sauf l'enveloppe ont le même digest (#1119)", {
  sain <- fixture_geometrie_wfs_saine()
  a <- fixture_wfs_parse(
    sain$communes,
    timeStamp = "2026-11-22T17:51:09.979Z",
    numberMatched = 5L, numberReturned = 5L
  )
  b <- fixture_wfs_parse(
    sain$communes,
    # largeur différente : prouve que l'enveloppe ne pèse PAS dans `bytes`
    timeStamp = "2026-11-22T17:51:12.123456Z",
    numberMatched = 999L, numberReturned = 999L
  )

  da <- digest_geometrie(a, sain)
  db <- digest_geometrie(b, sain)

  expect_identical(da$sha256, db$sha256)
  expect_identical(da$bytes, db$bytes)
  expect_identical(da$hachage, "features_wfs_canoniques")
  # Le digest N'EST PAS celui de la réponse brute (l'ancien calcul, qui
  # entraînait le gel) — preuve négative indépendante du helper.
  sha_brut <- paste(openssl::sha256(charToRaw(
    jsonlite::toJSON(a, auto_unbox = TRUE, digits = NA)
  )))
  expect_false(identical(da$sha256, sha_brut))
})

test_that("des features différentes donnent des digests géométrie différents (#1119)", {
  sain <- fixture_geometrie_wfs_saine()
  modifiees <- sain$communes
  modifiees$features[[1]]$properties$nom_officiel <- "Commune renommée"

  d1 <- digest_geometrie(fixture_wfs_parse(sain$communes, timeStamp = "t1"), sain)
  d2 <- digest_geometrie(fixture_wfs_parse(modifiees, timeStamp = "t2"), sain)

  expect_false(identical(d1$sha256, d2$sha256))
  expect_false(identical(d1$bytes, d2$bytes))
})

# --- 2. Le cache communes_limites : mêmes règles, octets laissés intacts --------
# communes_limites.geojson est téléchargé par le même WFS et CACHÉ tel quel. Son
# empreinte doit suivre la même règle que le fond de carte, sinon chaque
# re-téléchargement change son sha256 par le seul timeStamp et le gel refuse le
# run. Les octets du fichier restent ceux du téléchargement : c'est le DIGEST
# qui est canonique, pas le fichier.

resoudre_limites <- function(brut, cache) {
  resoudre_source(
    id = "communes_limites",
    url = MANIFEST_MOBILITE_COMMUNES_LIMITES$url[[1]],
    fichier = "communes_limites.geojson", cache = cache,
    lock = tempfile("lock-vide-limites-"),
    horloge = as.Date("2026-11-22"), vintage_basis = "telechargement",
    tirer = function(url, cible) writeLines(brut, cible)
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
  expect_identical(r1$digest$hachage, "features_wfs_canoniques")
  # Les octets du fichier restent BIEN ceux du téléchargement (enveloppe incluse).
  expect_true(grepl("17:51:09\\.979Z",
                    paste(readLines(file.path(c1, "communes_limites.geojson")),
                          collapse = "\n")))
  expect_true(grepl("17:51:12\\.123456Z",
                    paste(readLines(file.path(c2, "communes_limites.geojson")),
                          collapse = "\n")))

  # Après un re-téléchargement (mtime changé), le sidecar est réécrit depuis les
  # octets réels et reste valide — sa fraîcheur ne dépend PAS des `bytes`
  # canoniques du digest.
  writeLines(b, file.path(c1, "communes_limites.geojson"))
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

# --- 3. Audit structurel : un seul propriétaire du hachage WFS ------------------

test_that("aucun site ne hache une enveloppe WFS brute (#1119)", {
  racine <- normalizePath(testthat::test_path("..", ".."))
  expect_silent(verifier_structure_hachages_wfs(racine))

  code_geom <- paste(readLines(file.path(racine, "R", "geometrie.R"), warn = FALSE),
                     collapse = "\n")
  expect_true(grepl("empreinte_wfs_features\\(", code_geom))
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
