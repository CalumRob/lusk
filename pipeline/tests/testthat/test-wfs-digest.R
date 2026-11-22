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
