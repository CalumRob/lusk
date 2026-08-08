# test-ocsge -------------------------------------------------------------------
# L'ingestion OCS-GE (issue #234, spec #225) : les trois fonctions pures dans
# la forme établie — lecteur (GPKG -> polygones longs), normalisation (m² via
# EPSG:2154, la fenêtre dérivée de LA DONNÉE), agrégation (intersection
# pondérée par la surface avec les limites communales -> artif_m2 / artif_m3 /
# flux_net par commune) — prouvées sur un PETIT GPKG de fixture (écrit avec
# sf::st_write, jamais téléchargé : zéro réseau dans la boucle de test). Le
# fixture porte les colonnes officielles du différentiel IGN (Doc_artif.pdf :
# Artif_{M2}/Artif_{M3} « Artif »/« Non Artif », Artificialisation +1/-1,
# Surface en m²) et quelques polygones qui TRAVERSENT les frontières
# communales : un polygone entièrement dans une commune lui donne sa pleine
# mesure, un polygone qui coupe la frontière donne à A et B leurs tranches
# pondérées. Le seam .7z (aucun extracteur en R — la décision documentée) est
# testé : le zip que R sait écrire prouve le chemin cache -> lecteur complet,
# le .7z prouve l'étape manuelle documentée et l'idempotence.

# Le lecteur et la normalisation ------------------------------------------------

test_that("lire_ocsge_artificialisation : le GPKG du fixture se lit sous la couche du contrat, colonnes officielles", {
  gpkg <- tempfile(fileext = ".gpkg")
  on.exit(unlink(gpkg))
  fixture_gpkg_ocsge(gpkg, 2021, 2025)

  flux <- lire_ocsge_artificialisation(gpkg)
  expect_s3_class(flux, "sf")
  expect_equal(nrow(flux), 4L)
  # les colonnes officielles du différentiel IGN (Doc_artif.pdf) traversent
  # telles quelles — on ne re-dérive rien à la lecture
  expect_true(all(c("Artif_2021", "Artif_2025", "Artificialisation",
                    "Surface") %in% names(flux)))
  expect_equal(sf::st_crs(flux)$epsg, 2154)
  expect_setequal(flux$Artificialisation, c(1L, -1L))
})

test_that("lire_ocsge_artificialisation : une couche absente échoue en nommant les couches disponibles", {
  gpkg <- tempfile(fileext = ".gpkg")
  on.exit(unlink(gpkg))
  fixture_gpkg_ocsge(gpkg, 2021, 2025)

  expect_error(lire_ocsge_artificialisation(gpkg, couche = "OCCUPATION_SOL"),
               "OCCUPATION_SOL")
  expect_error(lire_ocsge_artificialisation(gpkg, couche = "OCCUPATION_SOL"),
               "DIFF_ARTIF")  # la couche disponible est nommée
  expect_error(lire_ocsge_artificialisation(tempfile(fileext = ".gpkg")),
               "absent")
})

test_that("normaliser_ocsge_artificialisation : la fenêtre dérive de LA DONNÉE (les colonnes Artif_*), jamais codée en dur", {
  gpkg <- tempfile(fileext = ".gpkg")
  on.exit(unlink(gpkg))
  fixture_gpkg_ocsge(gpkg, 2021, 2025)
  norm <- normaliser_ocsge_artificialisation(lire_ocsge_artificialisation(gpkg))
  expect_equal(unique(norm$millesime_debut), 2021)
  expect_equal(unique(norm$millesime_fin), 2025)

  # la MÊME fonction lit une autre paire sans rien changer (35 : 2020->2023)
  gpkg2 <- tempfile(fileext = ".gpkg")
  on.exit(unlink(gpkg2))
  fixture_gpkg_ocsge(gpkg2, 2020, 2023)
  norm2 <- normaliser_ocsge_artificialisation(lire_ocsge_artificialisation(gpkg2))
  expect_equal(unique(norm2$millesime_debut), 2020)
  expect_equal(unique(norm2$millesime_fin), 2023)
  # les MESURES sont identiques — seule la fenêtre change
  expect_equal(norm2$artif_m3, norm$artif_m3)
})

test_that("normaliser_ocsge_artificialisation : artif_m2, artif_m3 et flux_net par polygone (la mesure officielle lue, jamais re-dérivée)", {
  gpkg <- tempfile(fileext = ".gpkg")
  on.exit(unlink(gpkg))
  fixture_gpkg_ocsge(gpkg, 2021, 2025)
  norm <- normaliser_ocsge_artificialisation(lire_ocsge_artificialisation(gpkg))

  # P1 : Non Artif -> Artif, Surface 400 -> artif_m2 = 0, artif_m3 = 400,
  #     flux = +1 x 400 = +400
  # P2 : Artif -> Non Artif, Surface 1600 -> artif_m2 = 1600, artif_m3 = 0,
  #     flux = -1 x 1600 = -1600
  # P3 : Non Artif -> Artif, Surface 400 -> 0 / 400 / +400
  # P4 : Non Artif -> Artif, Surface 600 (géométrie 400) -> 0 / 600 / +600
  expect_equal(norm$artif_m2, c(0, 1600, 0, 0))
  expect_equal(norm$artif_m3, c(400, 0, 400, 600))
  expect_equal(norm$flux_net, c(400, -1600, 400, 600))
  # l'invariant : flux_net == artif_m3 - artif_m2 par polygone
  expect_equal(norm$flux_net, norm$artif_m3 - norm$artif_m2)
  # la surface de la géométrie en m² (EPSG:2154) : P4 diffère de SA Surface
  # officielle (600 vs 400) — la mesure de l'État n'est pas la géométrie
  expect_equal(norm$aire_m2, c(400, 1600, 400, 400))
  expect_equal(sf::st_crs(norm)$epsg, 2154)
})

test_that("normaliser_ocsge_artificialisation : la projection EPSG:2154 est une garantie, pas une hypothèse", {
  # une couche livrée en WGS84 (4326) est projetée avant le calcul de surface
  # (le rectangle est placé près de Rennes pour que le transform ne dégénère pas)
  geom <- sf::st_sfc(
    sf::st_polygon(list(rbind(
      c(-1.7, 48.0), c(-1.69, 48.0), c(-1.69, 48.01), c(-1.7, 48.01), c(-1.7, 48.0)
    ))),
    crs = 4326
  )
  flux <- sf::st_sf(
    Artif_2021 = "Non Artif", Artif_2025 = "Artif",
    Artificialisation = 1L, Surface = 900000,
    geometry = geom
  )
  norm <- normaliser_ocsge_artificialisation(flux)
  expect_equal(sf::st_crs(norm)$epsg, 2154)
  expect_true(all(norm$aire_m2 > 0))
  # la mesure officielle traverse telle quelle (jamais re-dérivée de la géométrie)
  expect_equal(norm$artif_m3, 900000)
})

test_that("normaliser_ocsge_artificialisation : une couche qui dérive échoue fort (le fichier a changé de forme)", {
  gpkg <- tempfile(fileext = ".gpkg")
  on.exit(unlink(gpkg))
  fixture_gpkg_ocsge(gpkg, 2021, 2025)
  base <- lire_ocsge_artificialisation(gpkg)

  # un sens hors contrat (Artificialisation != +1/-1)
  derive <- base
  derive$Artificialisation <- 0L
  expect_error(normaliser_ocsge_artificialisation(derive), "\\+1")

  # un Artificialisation incohérent avec les statuts (le fichier a dérivé)
  derive <- base
  derive$Artificialisation[1] <- -1L  # P1 est Non Artif -> Artif, donc +1 attendu
  expect_error(normaliser_ocsge_artificialisation(derive), "incohérent")

  # les colonnes Artif_* absentes (une couche différente est passée)
  sans <- base[setdiff(names(base), "Artif_2025")]
  expect_error(normaliser_ocsge_artificialisation(sans), "Artif_\\{millesime\\}")

  # une surface négative (un fichier corrompu) est rejetée par le contrat ±1
  derive <- base
  derive$Surface <- -50
  expect_error(normaliser_ocsge_artificialisation(derive))
})

# L'agrégation pondérée ---------------------------------------------------------

test_that("agreger_artificialisation_communes : le polygone entier dans A donne SA pleine mesure à A, le polygone qui coupe la frontière donne à A/B leurs tranches pondérées", {
  gpkg <- tempfile(fileext = ".gpkg")
  on.exit(unlink(gpkg))
  fixture_gpkg_ocsge(gpkg, 2021, 2025)
  norm <- normaliser_ocsge_artificialisation(lire_ocsge_artificialisation(gpkg))
  # deux communes adjacentes du MÊME département, la frontière à x = 100
  communes <- fixture_communes_ocsge(codes = c("22001", "22002"))
  agg <- agreger_artificialisation_communes(norm, communes)

  # 22001 : P1 entier (artif_m3 400) + P4 entier (artif_m3 600) + la moitié de
  # P2 (artif_m2 800, flux -800) = artif_m2 800, artif_m3 1000, flux 200
  a <- agg[agg$code == "22001", ]
  expect_equal(a$artif_m2, 800)
  expect_equal(a$artif_m3, 1000)
  expect_equal(a$flux_net, 200)
  # 22002 : la moitié de P2 (artif_m2 800, flux -800) + P3 entier (artif_m3 400)
  b <- agg[agg$code == "22002", ]
  expect_equal(b$artif_m2, 800)
  expect_equal(b$artif_m3, 400)
  expect_equal(b$flux_net, -400)
  # l'invariant de la spec : flux_net == artif_m3 - artif_m2 par commune
  expect_equal(agg$flux_net, agg$artif_m3 - agg$artif_m2)
  # la fenêtre dérivée est portée par commune
  expect_equal(unique(agg$millesime_debut), 2021)
  expect_equal(unique(agg$millesime_fin), 2025)
  # aucune ligne pour les communes qui ne reçoivent rien
  expect_setequal(agg$code, c("22001", "22002"))
})

test_that("agreger_artificialisation_communes : les tranches pondérées répartissent la MESURE OFFICIELLE, pas la géométrie", {
  # P2 (Surface 1600 = géométrie 1600) coupé en deux à x=100 : chaque commune
  # reçoit exactement la moitié de chaque mesure — prouvé par la table seule
  gpkg <- tempfile(fileext = ".gpkg")
  on.exit(unlink(gpkg))
  fixture_gpkg_ocsge(gpkg, 2021, 2025)
  norm <- normaliser_ocsge_artificialisation(lire_ocsge_artificialisation(gpkg))
  communes <- fixture_communes_ocsge(codes = c("22001", "22002"))
  agg <- agreger_artificialisation_communes(norm, communes)

  # le flux de P2 (-1600) est réparti : -800 dans 22001, -800 dans 22002
  # (P1 et P3 contribuent +400 chacun, P4 +600 dans 22001)
  expect_equal(agg$flux_net[agg$code == "22001"],
               -800 + 400 + 600)
  expect_equal(agg$flux_net[agg$code == "22002"],
               -800 + 400)
  # le total des flux par commune vaut le total des flux des polygones :
  # la somme des mesures distribuées n'invente rien (400 - 1600 + 400 + 600 = -800)
  expect_equal(sum(agg$flux_net), sum(norm$flux_net))
})

# Le seam d'extraction (.7z) et le chemin cache -> lecteur ----------------------

test_that("verifier_fichier : un .7z valide (signature 7-Zip) passe, un texte déguisé non", {
  cache <- tempfile("cache-7z-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  bon <- file.path(cache, "bon.7z")
  writeBin(mini_7z(), bon)
  expect_true(verifier_fichier(bon))

  # un texte déguisé en .7z (téléchargement partiel/corrompu) -> faux
  corrompu <- file.path(cache, "corrompu.7z")
  writeLines("pas un 7z", corrompu)
  expect_false(verifier_fichier(corrompu))

  # un fichier vide -> faux ; absent -> faux
  vide <- file.path(cache, "vide.7z")
  file.create(vide)
  expect_false(verifier_fichier(vide))
  expect_false(verifier_fichier(file.path(cache, "absent.7z")))
})

test_that("extraire_gpkg_ocsge : le chemin complet cache -> lecteur avec une archive zip générée (le format que R sait écrire)", {
  cache <- tempfile("cache-ocsge-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))
  extrait <- file.path(cache, "extracted", "ocsge")

  # on fabrique un VRAI GPKG de fixture puis on l'archive en zip (utils::zip —
  # le format que R sait produire sans dépendance ; le vrai manifeste est en
  # .7z, testé ci-dessous par son étape manuelle documentée)
  gpkg_source <- file.path(cache, "fixture-diff.gpkg")
  fixture_gpkg_ocsge(gpkg_source, 2021, 2025)
  archive <- file.path(cache, "fixture-diff.zip")
  utils::zip(archive, files = gpkg_source, flags = "-q")
  expect_true(file.exists(archive))

  # l'extraction -> le lecteur -> la normalisation : la chaîne complète
  gpkg <- extraire_gpkg_ocsge(archive, extrait)
  expect_true(file.exists(gpkg))
  expect_equal(basename(gpkg), "fixture-diff.gpkg")
  norm <- normaliser_ocsge_artificialisation(
    lire_ocsge_artificialisation(gpkg)
  )
  expect_equal(nrow(norm), 4L)
  expect_equal(unique(norm$millesime_debut), 2021)
  expect_equal(unique(norm$millesime_fin), 2025)

  # idempotent : la deuxième extraction réutilise le GPKG déjà extrait
  expect_identical(extraire_gpkg_ocsge(archive, extrait), gpkg)
})

test_that("extraire_gpkg_ocsge : le .7z — l'étape MANUELLE documentée, idempotente une fois faite", {
  cache <- tempfile("cache-ocsge-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))
  extrait <- file.path(cache, "extracted", "ocsge")
  dir.create(extrait, recursive = TRUE)

  # un .7z (faux mais de signature valide — le contrat de forme du cache) au
  # nom EXACT du manifeste, sans GPKG déjà extrait : l'étape manuelle
  # documentée est exigée, jamais un échec silencieux
  archive <- file.path(cache, MANIFEST_MILIEUX$fichier[
    MANIFEST_MILIEUX$id == "ocsge_artificialisation_22"])
  writeBin(mini_7z(), archive)
  expect_error(extraire_gpkg_ocsge(archive, extrait), "MANUELLE")
  expect_error(extraire_gpkg_ocsge(archive, extrait), "7-Zip")

  # une fois le GPKG déposé par l'étape manuelle (le même stem que l'archive) :
  # réutilisé tel quel, idempotent
  gpkg <- file.path(extrait,
                    sub("[.]7z$", ".gpkg", basename(archive)))
  fixture_gpkg_ocsge(gpkg, 2021, 2025)
  expect_identical(extraire_gpkg_ocsge(archive, extrait), gpkg)
})

# Le builder (construire_donnees_ocsge) ----------------------------------------

test_that("construire_donnees_ocsge : les quatre départements du manifeste, chacun SA fenêtre, agrégés par commune et persistés", {
  cache <- tempfile("cache-ocsge-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))
  sortie <- tempfile(fileext = ".rds")
  on.exit(unlink(sortie))

  # pour chaque département : le .7z (signature valide) DANS le cache au nom
  # exact du manifeste + le GPKG déjà extrait par l'étape manuelle documentée
  # (chaque département dans SON quartier de la grille communale, SA fenêtre)
  fenetres <- c("22" = "2021-2025", "29" = "2021-2024",
                "35" = "2020-2023", "56" = "2022-2024")
  decalages <- c("22" = "0;0", "29" = "100;0", "35" = "0;100", "56" = "100;100")
  for (dep in names(fenetres)) {
    ligne <- MANIFEST_MILIEUX[MANIFEST_MILIEUX$id == paste0("ocsge_artificialisation_", dep), ]
    writeBin(mini_7z(), file.path(cache, ligne$fichier))
    m2m3 <- as.integer(strsplit(fenetres[[dep]], "-")[[1]])
    dxdy <- as.integer(strsplit(decalages[[dep]], ";")[[1]])
    extrait <- file.path(cache, "extracted", "ocsge")
    if (!dir.exists(extrait)) dir.create(extrait, recursive = TRUE)
    fixture_gpkg_ocsge(
      file.path(extrait, sub("[.]7z$", ".gpkg", ligne$fichier)),
      m2m3[1], m2m3[2], dx = dxdy[1], dy = dxdy[2], complet = FALSE
    )
  }

  communes <- fixture_communes_ocsge()  # une commune par département
  agg <- construire_donnees_ocsge(cache = cache, communes = communes,
                                  sortie = sortie)

  # une ligne par commune, chacune la mesure de SON département (P1 simple :
  # artif_m2 = 0, artif_m3 = 400, flux = +400) sur SA fenêtre dérivée
  expect_setequal(agg$code, c("22001", "29001", "35001", "56001"))
  expect_equal(agg$artif_m2, c(0, 0, 0, 0))
  expect_equal(agg$artif_m3, c(400, 400, 400, 400))
  expect_equal(agg$flux_net, c(400, 400, 400, 400))
  expect_equal(agg$millesime_debut[agg$code == "22001"], 2021)
  expect_equal(agg$millesime_fin[agg$code == "22001"], 2025)
  expect_equal(agg$millesime_debut[agg$code == "29001"], 2021)
  expect_equal(agg$millesime_fin[agg$code == "29001"], 2024)
  expect_equal(agg$millesime_debut[agg$code == "35001"], 2020)
  expect_equal(agg$millesime_fin[agg$code == "35001"], 2023)
  expect_equal(agg$millesime_debut[agg$code == "56001"], 2022)
  expect_equal(agg$millesime_fin[agg$code == "56001"], 2024)

  # la table est persistée sous data/processed/milieux/ (idempotent)
  expect_true(file.exists(sortie))
  relue <- readr::read_rds(sortie)
  expect_identical(relue, agg)
})

test_that("construire_donnees_ocsge : une archive absente du cache échoue bruyamment (jamais un silence)", {
  cache <- tempfile("cache-ocsge-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))
  communes <- fixture_communes_ocsge(codes = c("22001"))
  expect_error(
    construire_donnees_ocsge(cache = cache, communes = communes,
                             sortie = tempfile(fileext = ".rds")),
    "absente du cache"
  )
})
