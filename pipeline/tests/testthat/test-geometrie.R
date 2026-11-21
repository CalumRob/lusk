# test-geometrie ----------------------------------------------------------------
# L'étape de géométrie du pipeline (issue #60, ADR-0008) : télécharger les
# trois couches Admin Express CARTO-PE (petite échelle — le produit IGN conçu
# pour l'affichage cartographique, topologiquement cohérent entre niveaux),
# filtrer à la Bretagne, mapper les propriétés au contrat de l'app
# (territoire / nom / type — app/src/geo/types.ts) et publier les trois
# fichiers sous public/data/.
#
# Seams testés (convention pipeline : le réseau n'entre JAMAIS dans la boucle
# de test — comme telecharger_fichier, le fetch WFS réel n'est pas testé ici ;
# il est vérifié une fois à la main et mocké dans les tests) :
#   1. filtrer_geometrie        — la garde Bretagne par niveau ;
#   2. mapper_vers_contrat      — le mapping des propriétés au contrat ;
#   3. publier_geometrie        — l'orchestrateur : valide la collection après
#      filtrage (#1100, jamais une couche vide écrite), puis écrit les trois
#      fichiers, lus en retour comme des FeatureCollections du contrat.

# filtrer_geometrie ------------------------------------------------------

test_that("filtrer_geometrie garde les communes des 4 départements bretons", {
  filtre <- filtrer_geometrie(fixture_communes_wfs(), "communes")
  codes <- vapply(filtre$features, function(f) f$properties$code_insee, character(1))
  expect_identical(codes, "22001")
})

test_that("filtrer_geometrie garde un EPCI dès qu'une commune membre est bretonne", {
  filtre <- filtrer_geometrie(fixture_epcis_wfs(), "epcis")
  sirens <- vapply(filtre$features, function(f) f$properties$code_siren, character(1))
  # le pur breton (56) ET le transfrontalier (44/56) sont gardés ;
  # le ligérien pur (44) tombe.
  expect_setequal(sirens, c("200000001", "200000002"))
})

test_that("filtrer_geometrie garde les départements bretons", {
  filtre <- filtrer_geometrie(fixture_departements_wfs(), "departements")
  codes <- vapply(filtre$features, function(f) f$properties$code_insee, character(1))
  expect_identical(codes, "35")
})

test_that("filtrer_geometrie ignore un niveau inconnu bruyamment", {
  expect_error(filtrer_geometrie(fixture_communes_wfs(), "regions"), "niveau")
})

# mapper_vers_contrat ---------------------------------------------------

test_that("mapper_vers_contrat traduit une commune au contrat de l'app", {
  mappe <- mapper_vers_contrat(fixture_communes_wfs(), "communes")
  expect_equal(length(mappe$features), 2)
  p <- mappe$features[[1]]$properties
  # le contrat ADR-0008 : territoire (code INSEE), nom, type — rien d'autre
  expect_identical(names(p), c("territoire", "nom", "type"))
  expect_identical(p$territoire, "22001")
  expect_identical(p$nom, "Commune bretonne")
  expect_identical(p$type, "commune")
  # la géométrie traverse intacte
  expect_identical(mappe$features[[1]]$geometry, fixture_communes_wfs()$features[[1]]$geometry)
})

test_that("mapper_vers_contrat traduit un EPCI (SIREN) et un département au contrat", {
  epcis <- mapper_vers_contrat(fixture_epcis_wfs(), "epcis")
  expect_equal(length(epcis$features), 3)
  p_epci <- epcis$features[[1]]$properties
  expect_identical(names(p_epci), c("territoire", "nom", "type"))
  expect_identical(p_epci$territoire, "200000001")
  expect_identical(p_epci$type, "epci")

  depts <- mapper_vers_contrat(fixture_departements_wfs(), "departements")
  expect_equal(length(depts$features), 2)
  p_dept <- depts$features[[1]]$properties
  expect_identical(p_dept$territoire, "35")
  expect_identical(p_dept$nom, "Ille-et-Vilaine")
  expect_identical(p_dept$type, "departement")
})

test_that("mapper_vers_contrat garde le type FeatureCollection", {
  mappe <- mapper_vers_contrat(fixture_communes_wfs(), "communes")
  expect_identical(mappe$type, "FeatureCollection")
})

# publier_geometrie -----------------------------------------------------

test_that("publier_geometrie écrit les trois fichiers GeoJSON du contrat", {
  cible <- tempfile("geom-")
  on.exit(unlink(cible, recursive = TRUE))

  # le seam de fetch injecté — le réseau n'entre pas dans la boucle de test
  fetch_injecte <- function(niveau) fixture_geometrie_wfs_saine()[[niveau]]
  publier_geometrie(cible, fetch = fetch_injecte)

  for (niveau in c("communes", "epcis", "departements")) {
    chemin <- file.path(cible, paste0(niveau, ".geojson"))
    expect_true(file.exists(chemin), info = niveau)
    relu <- jsonlite::fromJSON(chemin, simplifyVector = FALSE)
    expect_identical(relu$type, "FeatureCollection", info = niveau)
    # chaque feature porte le contrat : territoire string non vide + géométrie
    for (f in relu$features) {
      expect_type(f$properties$territoire, "character")
      expect_true(nzchar(f$properties$territoire))
      expect_true(f$geometry$type %in% c("Polygon", "MultiPolygon"))
    }
  }
})

test_that("publier_geometrie n'écrit que les territoires bretons", {
  cible <- tempfile("geom-")
  on.exit(unlink(cible, recursive = TRUE))

  fetch_injecte <- function(niveau) fixture_geometrie_wfs_saine()[[niveau]]
  publier_geometrie(cible, fetch = fetch_injecte)

  communes <- jsonlite::fromJSON(file.path(cible, "communes.geojson"), simplifyVector = FALSE)
  expect_equal(length(communes$features), 4)
  expect_setequal(
    vapply(communes$features, function(f) f$properties$territoire, character(1)),
    c("22001", "29001", "35001", "56001")
  )

  epcis <- jsonlite::fromJSON(file.path(cible, "epcis.geojson"), simplifyVector = FALSE)
  sirens <- vapply(epcis$features, function(f) f$properties$territoire, character(1))
  expect_setequal(sirens, c("200000001", "200000002"))
})

test_that("publier_geometrie est un upsert : relancer écrase sans dupliquer", {
  cible <- tempfile("geom-")
  on.exit(unlink(cible, recursive = TRUE))

  fetch_injecte <- function(niveau) fixture_geometrie_wfs_saine()[[niveau]]
  publier_geometrie(cible, fetch = fetch_injecte)
  publier_geometrie(cible, fetch = fetch_injecte)

  communes <- jsonlite::fromJSON(file.path(cible, "communes.geojson"), simplifyVector = FALSE)
  expect_equal(length(communes$features), 4)
})

test_that("publier_geometrie s'arrête bruyamment sur un fetch invalide", {
  cible <- tempfile("geom-")
  on.exit(unlink(cible, recursive = TRUE))

  fetch_ko <- function(niveau) stop("réseau en panne")
  expect_error(publier_geometrie(cible, fetch = fetch_ko), "réseau en panne")
})

# garde de plausibilité post-filtre (#1100) --------------------------------
# Le bug #1100 renvoyait une FeatureCollection VALIDE mais vide, écrite sans
# erreur. Ces tests injectent une collection vide / incomplète et exigent un
# abort NOMMÉ (niveau + URL + comptes) avant toute écriture de fichier.

test_that("une collection vide aborte en nommant le niveau, l'URL et les comptes", {
  cible <- tempfile("geom-vide-")
  on.exit(unlink(cible, recursive = TRUE))

  err <- tryCatch(
    publier_geometrie(cible, fetch = function(niveau) fixture_collection_vide()),
    error = identity
  )
  expect_s3_class(err, "error")
  msg <- conditionMessage(err)
  expect_true(grepl("communes", msg, fixed = TRUE))
  expect_true(grepl("data.geopf.fr/wfs/ows", msg, fixed = TRUE))
  expect_true(grepl("bbox=-5.5,47.0,-0.5,49.0,EPSG:4326", msg, fixed = TRUE))
  expect_true(grepl("0", msg, fixed = TRUE))
  # aucun masque n'est écrit quand la garde saute
  expect_false(file.exists(file.path(cible, "communes.geojson")))
})

test_that("une couverture communale partielle est refusée comme implausible", {
  cible <- tempfile("geom-implausible-")
  on.exit(unlink(cible, recursive = TRUE))

  # une seule commune bretonne (22) : 29/35/56, présents dans l'univers
  # canonique de référence, sont absents — ce n'est pas une Bretagne valide.
  sain <- fixture_geometrie_wfs_saine()
  fetch_partiel <- function(niveau) {
    if (niveau == "communes") fixture_communes_wfs() else sain[[niveau]]
  }
  err <- tryCatch(publier_geometrie(cible, fetch = fetch_partiel), error = identity)
  expect_s3_class(err, "error")
  msg <- conditionMessage(err)
  expect_true(grepl("communes", msg, fixed = TRUE))
  expect_true(grepl("29, 35, 56", msg, fixed = TRUE))
  expect_true(grepl("data.geopf.fr/wfs/ows", msg, fixed = TRUE))
  expect_false(file.exists(file.path(cible, "communes.geojson")))
})

test_that("une collection saine couvrant les 4 départements passe la garde", {
  cible <- tempfile("geom-saine-")
  on.exit(unlink(cible, recursive = TRUE))

  expect_silent(publier_geometrie(
    cible, fetch = function(niveau) fixture_geometrie_wfs_saine()[[niveau]]
  ))
  communes <- jsonlite::fromJSON(file.path(cible, "communes.geojson"), simplifyVector = FALSE)
  expect_setequal(
    vapply(communes$features, function(f) f$properties$territoire, character(1)),
    c("22001", "29001", "35001", "56001")
  )
  for (niveau in c("epcis", "departements")) {
    expect_true(file.exists(file.path(cible, paste0(niveau, ".geojson"))))
  }
})

test_that("verifier_collection_geometrie lie la couverture au contrat Bretagne", {
  url <- url_geometrie_wfs("communes")

  expect_true(verifier_collection_geometrie(
    filtrer_geometrie(fixture_communes_wfs_departements(), "communes"),
    "communes", url, brut_n = 5L
  ))
  err <- tryCatch(
    verifier_collection_geometrie(
      filtrer_geometrie(fixture_communes_wfs(), "communes"),
      "communes", url, brut_n = 2L
    ),
    error = identity
  )
  expect_s3_class(err, "error")
  expect_true(grepl("29, 35, 56", conditionMessage(err), fixed = TRUE))
})

# le contrat d'entrée : les niveaux attendus par publier_geometrie
test_that("les noms de couches CARTO-PE sont stables (le contrat du WFS)", {
  expect_identical(
    names(NIVEAUX_GEOMETRIE),
    c("communes", "epcis", "departements")
  )
  expect_match(NIVEAUX_GEOMETRIE[["communes"]], "CARTO-PE")
  expect_match(NIVEAUX_GEOMETRIE[["epcis"]], "CARTO-PE")
  expect_match(NIVEAUX_GEOMETRIE[["departements"]], "CARTO-PE")
})

# WFS bbox / CRS (#1100) ----------------------------------------------------
# data.geopf.fr interprète le bbox WFS 2.0.0 dans l'ordre des axes du CRS :
# pour EPSG:4326, lon,min / lat,min / lon,max / lat,max. L'ancien bbox lat,lon
# renvoyait une FeatureCollection valide mais VIDE (cartes blanches écrites
# sans erreur). Mesuré en direct le 2026-11-21 (count=3000) avec le bon ordre :
# communes 1969 → 1202 après le filtre Bretagne, epcis 107 → 61,
# départements 12 → 4. Le contrat de l'URL est testé sans réseau.

test_that("la bbox WFS porte l'ordre d'axes lon,lat vérifié (#1100)", {
  expect_identical(WFS_GEOMETRIE_BBOX, "-5.5,47.0,-0.5,49.0,EPSG:4326")

  url <- url_geometrie_wfs("communes")
  # pin exact : minLon, minLat, maxLon, maxLat — tout futur retour en lat,lon
  # casse ce test au lieu d'écrire une couche vide.
  expect_true(endsWith(url, "&bbox=-5.5,47.0,-0.5,49.0,EPSG:4326"))
  expect_false(grepl("urn:ogc:def:crs", url, fixed = TRUE))
  expect_match(url, "&bbox=-5\\.5,47\\.0,-0\\.5,49\\.0,EPSG:4326$")
})

test_that("le bbox WFS est un contrat unique partagé avec communes_limites (#1100)", {
  url_fond <- url_geometrie_wfs("communes")
  url_limites <- MANIFEST_MOBILITE_COMMUNES_LIMITES$url[[1]]

  expect_identical(WFS_GEOMETRIE_BBOX, "-5.5,47.0,-0.5,49.0,EPSG:4326")
  # les deux sites dérivent le même suffixe de la MÊME constante : si un
  # littéral de bbox réapparaît d'un côté, ce test casse immédiatement.
  expect_identical(sub("^.*&bbox=", "", url_fond), WFS_GEOMETRIE_BBOX)
  expect_identical(sub("^.*&bbox=", "", url_limites), WFS_GEOMETRIE_BBOX)
  expect_identical(
    sub("^.*&bbox=", "", url_fond),
    sub("^.*&bbox=", "", url_limites)
  )
})

test_that("url_geometrie_wfs construit une GetFeature complète (contrat WFS)", {
  url <- url_geometrie_wfs("epcis")
  expect_true(grepl("^https://data.geopf.fr/wfs/ows\\?", url))
  expect_true(grepl("service=WFS&version=2.0.0&request=GetFeature", url,
                    fixed = TRUE))
  expect_true(grepl("outputFormat=application/json", url, fixed = TRUE))
  expect_true(grepl("&count=3000", url, fixed = TRUE))
})
