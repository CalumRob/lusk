# test-patch-correctif -----------------------------------------------------------
# Le PATCH CORRECTIF M2 (issue #243, amendement ADR-0017 — la décision
# « appliquer où disponible, mesurer d'abord ») : la matrice officielle
# transcrite (statut_artif_matrice), le lecteur du GPKG patch (lire_patch_correctif)
# et l'application de la correction (appliquer_patch_correctif — la bascule « au
# niveau matrice sur les polygones qui inversent le statut artif », approximation
# documentée). La transcription de la matrice est validée contre la mesure
# documentée (2026-08-09) : 22 : 2001/10187 = 19,6 % de polygones inversés · 29 :
# 1674/8797 = 19,0 % · 56 : 2002/8029 = 24,9 % — les chiffres de l'amendement,
# reproduits à l'identique sur les patchs réels. Zéro réseau : tout est généré
# depuis les fixtures (fixture_gpkg_patch — la forme réelle du GPKG, vérifiée
# 2026-08-10).

# La matrice de croisement couverture × usage ------------------------------------

test_that("statut_artif_matrice : les couvertures anthropisées (CS1.*) sont artificialisées, sauf les carrières (CS1.1.2.1 sous US1.3)", {
  expect_equal(statut_artif_matrice("CS1.1.1.1", "US5"), "artif")
  expect_equal(statut_artif_matrice("CS1.1.1.2", "US2"), "artif")
  expect_equal(statut_artif_matrice("CS1.1.2.1", "US5"), "artif")
  expect_equal(statut_artif_matrice("CS1.2.1", "US4.2"), "artif")
  # l'exception réelle : les « zones à matériaux minéraux » à usage
  # « activités d'extraction » (les carrières) — non artificialisées
  expect_equal(statut_artif_matrice("CS1.1.2.1", "US1.3"), "non artif")
})

test_that("statut_artif_matrice : la végétation non ligneuse (CS2.2.x) est artificialisée sous un usage du bâti/transport/transition (les verts urbains)", {
  expect_equal(statut_artif_matrice("CS2.2.1", "US5"), "artif")
  expect_equal(statut_artif_matrice("CS2.2.1", "US2"), "artif")
  expect_equal(statut_artif_matrice("CS2.2.1", "US3"), "artif")
  expect_equal(statut_artif_matrice("CS2.2.2", "US4.1.1"), "artif")
  expect_equal(statut_artif_matrice("CS2.2.1", "US6.1"), "artif")
  expect_equal(statut_artif_matrice("CS2.2.2", "US6.2"), "artif")
  # un usage agricole/naturel n'artificialise pas (une prairie n'est pas du bâti)
  expect_equal(statut_artif_matrice("CS2.2.1", "US1.1"), "non artif")
  expect_equal(statut_artif_matrice("CS2.2.2", "US6.3"), "non artif")
  expect_equal(statut_artif_matrice("CS2.1.1.1", "US5"), "non artif")
  expect_equal(statut_artif_matrice("CS3.1.1.1", "US5"), "non artif")
})

# Le lecteur ---------------------------------------------------------------------

test_that("lire_patch_correctif : le GPKG du fixture se lit sous la couche PATCH_CORR_, colonnes officielles", {
  gpkg <- tempfile(fileext = ".gpkg")
  on.exit(unlink(gpkg))
  fixture_gpkg_patch(gpkg, "22", 2021)

  patch <- lire_patch_correctif(gpkg)
  expect_s3_class(patch, "sf")
  expect_equal(nrow(patch), 3L)
  expect_true(all(c("id_ocs", "code_cs", "code_us", "millesime", "source",
                    "ossature", "id_origine", "code_or", "cs_corr", "us_corr",
                    "os_corr", "decoup_geo") %in% names(patch)))
  expect_equal(sf::st_crs(patch)$epsg, 2154)
  expect_equal(unique(patch$millesime), "2021")
  # la couche découverte par le motif — une couche absente échoue en nommant
  # les couches disponibles
  expect_error(lire_patch_correctif(gpkg, couche = "OCCUPATION_SOL"),
               "OCCUPATION_SOL")
  expect_error(lire_patch_correctif(gpkg, couche = "OCCUPATION_SOL"),
               "PATCH_CORR_")
})

# L'application de la correction --------------------------------------------------

test_that("appliquer_patch_correctif : la bascule au niveau matrice sur les polygones qui inversent le statut — le delta par polygone", {
  # un état à deux polygones : A artif (aire 400, géométrie 400 m²), B non-artif
  # (aire 400, géométrie 400 m²)
  etat <- sf::st_sf(
    id = c("P1", "P2"),
    artif = c("artif", "non artif"),
    aire = c(400, 400),
    geometry = sf::st_sfc(
      sf::st_polygon(list(polygone_rectangle(0, 0, 20, 20))),
      sf::st_polygon(list(polygone_rectangle(100, 0, 120, 20))),
      crs = 2154
    )
  )
  # le patch : une SUBDIVISION de P1 (10 x 10 = 100 m²) corrigée en non-artif
  # (l'inversion artif -> non-artif) et une SUBDIVISION de P2 (100 m²) corrigée
  # en artif (l'inversion non-artif -> artif)
  patch <- sf::st_sf(
    id_ocs = c("P1", "P2"),
    code_cs = c("CS1.1.1.1", "CS1.1.1.1"),
    code_us = c("US5", "US5"),
    cs_corr = c("CS2.2.2", "CS1.1.1.1"),
    us_corr = c("US1.1", "US5"),
    geometry = sf::st_sfc(
      sf::st_polygon(list(polygone_rectangle(0, 0, 10, 10))),
      sf::st_polygon(list(polygone_rectangle(100, 0, 110, 10))),
      crs = 2154
    )
  )

  delta <- appliquer_patch_correctif(etat, patch)
  # P1 : la part de l'archive sur la subdivision = 400 x (100/400) = 100 ; la
  # valeur corrigée (non-artif) = 0 -> delta -100
  # P2 : la part de l'archive = 0 (non-artif) ; la valeur corrigée (artif) =
  # 100 -> delta +100
  expect_equal(delta, c(-100, 100))
})

test_that("appliquer_patch_correctif : sans inversion, la valeur de l'archive fait foi — RAS et couple inchangé", {
  etat <- sf::st_sf(
    id = c("P1", "P2"),
    artif = c("artif", "non artif"),
    aire = c(400, 400),
    geometry = sf::st_sfc(
      sf::st_polygon(list(polygone_rectangle(0, 0, 20, 20))),
      sf::st_polygon(list(polygone_rectangle(100, 0, 120, 20))),
      crs = 2154
    )
  )
  # RAS = la valeur d'origine (aucune correction) ; le couple inchangé n'inverse
  # rien — les deux patchs ne changent AUCUNE valeur. Le polygone non-artif
  # porte un couple ORIGINAL réaliste (une forêt CS2.1.1.1 sous un usage
  # agricole US1.1 — jamais un CS1.1.1.1, qui serait artif).
  patch <- sf::st_sf(
    id_ocs = c("P1", "P2"),
    code_cs = c("CS1.1.1.1", "CS2.1.1.1"),
    code_us = c("US5", "US1.1"),
    cs_corr = c("RAS", "RAS"),
    us_corr = c("RAS", "RAS"),
    geometry = sf::st_sfc(
      sf::st_polygon(list(polygone_rectangle(0, 0, 20, 20))),
      sf::st_polygon(list(polygone_rectangle(100, 0, 120, 20))),
      crs = 2154
    )
  )
  expect_equal(appliquer_patch_correctif(etat, patch), c(0, 0))

  # le couple INCHANGÉ (cs_corr/us_corr = la valeur d'origine, sans RAS)
  # n'inverse rien non plus
  patch2 <- patch
  patch2$cs_corr <- patch2$code_cs
  patch2$us_corr <- patch2$code_us
  expect_equal(appliquer_patch_correctif(etat, patch2), c(0, 0))
})

test_that("appliquer_patch_correctif : un polygone du patch qui ne référence aucun polygone de l'état échoue fort", {
  etat <- sf::st_sf(
    id = "P1", artif = "artif", aire = 400,
    geometry = sf::st_sfc(sf::st_polygon(list(polygone_rectangle(0, 0, 20, 20))),
                          crs = 2154)
  )
  patch <- sf::st_sf(
    id_ocs = "INCONNU", code_cs = "CS1.1.1.1", code_us = "US5",
    cs_corr = "CS2.2.2", us_corr = "US1.1",
    geometry = sf::st_sfc(sf::st_polygon(list(polygone_rectangle(0, 0, 10, 10))),
                          crs = 2154)
  )
  expect_error(appliquer_patch_correctif(etat, patch), "introuvable")
})

# Le câblage de bout en bout sur le fixture ---------------------------------------

test_that("construire_donnees_milieux : le patch correctif M2 corrige les états du millésime initial (22/29/56), jamais le M3", {
  cache <- cache_ocsge_milieux_patche()
  on.exit(unlink(cache, recursive = TRUE))
  communes <- communes_fixture_milieux_ocsge(cache = cache)

  # 22 : la subdivision inversée de 22002 (100 m² de l'artif 400) ->
  # 22002 M2 400 -> 300 ; 22001 inchangé (ses patchs n'inversent pas)
  expect_equal(communes$artif_m2[communes$code == "22002"], 300)
  expect_equal(communes$artif_m2[communes$code == "22001"], 400)
  # le M3 (2025) n'est PAS patché — la correction ne s'applique qu'au millésime
  # que le patch corrige (le vintage épinglé au manifeste)
  expect_equal(communes$artif_m3[communes$code == "22002"], 800)
  expect_equal(communes$artif_m3[communes$code == "22001"], 1200)
  # 29 : les patchs du fixture n'inversent rien — les états restent TELS QUELS
  expect_equal(communes$artif_m2[communes$code == "29001"], 800)
  expect_equal(communes$artif_m2[communes$code == "29002"], 800)
  expect_equal(communes$artif_m2[communes$code == "29003"], 500)
  # 56 : la subdivision inversée de 56001 (400 m² de l'artif 800) ->
  # 56001 M2 800 -> 600 ; le M3 (2024) non patché reste 600
  expect_equal(communes$artif_m2[communes$code == "56001"], 600)
  expect_equal(communes$artif_m3[communes$code == "56001"], 600)
  # 35 : PAS de patch (le département n'a pas de patch correctif) — inchangé
  expect_equal(communes$artif_m2[communes$code == "35001"], 400)
})

test_that("construire_donnees_milieux : sans patch dans le cache, les états restent TELS QUE publiés par l'IGN", {
  # le cache SANS patchs (le chemin du run avant #243 final) : les valeurs du
  # fixture territorial d'origine — jamais une correction inventée
  communes <- communes_fixture_milieux_ocsge()
  expect_equal(communes$artif_m2[communes$code == "22002"], 400)
  expect_equal(communes$artif_m2[communes$code == "56001"], 800)
})
