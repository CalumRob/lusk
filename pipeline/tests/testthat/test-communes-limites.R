# test-communes-limites ---------------------------------------------------------
# Le référentiel géométrique des réseaux (issue #139) — le MÊME WFS GeoPF que le
# fond de carte, donc le MÊME contrat de bbox (#1100). Deux invariants :
#   1. l'URL du manifeste est DÉRIVÉE du contrat géométrie, jamais recopiée ;
#   2. le refus bruyant d'une collection vide au seam de lecture — avant OU
#      après le filtre Bretagne. Le WFS renvoie une FeatureCollection valide
#      mais sans feature, et un téléchargement HTTP 200 réussi ne doit jamais
#      produire un référentiel silencieusement vide.

test_that("l'URL communes_limites dérive du bbox géométrie partagé (#1100)", {
  url <- MANIFEST_MOBILITE_COMMUNES_LIMITES$url[[1]]

  expect_true(startsWith(url, "https://data.geopf.fr/wfs/ows?"))
  expect_true(grepl("ADMINEXPRESS-COG.LATEST%3Acommune", url, fixed = TRUE))
  # le MÊME bbox que le fond de carte, issu de la même constante
  expect_true(endsWith(url, paste0("&bbox=", WFS_GEOMETRIE_BBOX)))
  expect_identical(WFS_GEOMETRIE_BBOX, "-5.5,47.0,-0.5,49.0,EPSG:4326")
  expect_false(grepl("bbox=47.0,-5.5", url, fixed = TRUE))
})

test_that("lire_communes_limites refuse une collection vide en nommant la source et l'URL", {
  chemin <- tempfile(fileext = ".geojson")
  on.exit(unlink(chemin), add = TRUE)
  # la FeatureCollection VALIDE mais SANS feature que GeoPF renvoie avec le
  # bbox lat,lon — exactement le cas silencieux de #1100.
  jsonlite::write_json(
    list(type = "FeatureCollection", features = list()),
    chemin, auto_unbox = TRUE
  )

  err <- tryCatch(lire_communes_limites(chemin), error = identity)
  expect_s3_class(err, "error")
  msg <- conditionMessage(err)
  expect_true(grepl("communes_limites", msg, fixed = TRUE))
  expect_true(grepl("data.geopf.fr/wfs/ows", msg, fixed = TRUE))
  expect_true(grepl("0", msg, fixed = TRUE))
})

test_that("lire_communes_limites refuse une collection vide APRÈS le filtre Bretagne", {
  chemin <- tempfile(fileext = ".geojson")
  on.exit(unlink(chemin), add = TRUE)
  # Une commune ligérienne (44) : le fichier n'est pas vide, mais le filtre
  # Bretagne ne retient rien — c'est le même écran de carte blanche, refusé.
  limites <- fixture_limites_ocsge(codes = "22001")
  limites$code_insee_du_departement <- "44"
  sf::st_write(limites, chemin, quiet = TRUE)

  err <- tryCatch(lire_communes_limites(chemin), error = identity)
  expect_s3_class(err, "error")
  msg <- conditionMessage(err)
  expect_true(grepl("communes_limites", msg, fixed = TRUE))
  expect_true(grepl("0 commune retenue après filtrage sur 1 reçue", msg, fixed = TRUE))
  expect_true(grepl("data.geopf.fr/wfs/ows", msg, fixed = TRUE))
})

test_that("lire_communes_limites accepte la grille canonique des 4 départements", {
  chemin <- tempfile(fileext = ".geojson")
  on.exit(unlink(chemin), add = TRUE)
  sf::st_write(fixture_limites_ocsge(), chemin, quiet = TRUE)

  limites <- lire_communes_limites(chemin)
  expect_equal(nrow(limites), 7L)
  expect_setequal(
    unique(as.character(limites$code_insee_du_departement)),
    c("22", "29", "35", "56")
  )
})
