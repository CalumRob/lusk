# test-ocsge -------------------------------------------------------------------
# L'ingestion OCS-GE (issue #234, amendée par #243 — ADR-0017) : les trois
# fonctions pures dans la forme établie — lecteur (GPKG -> polygones longs),
# normalisation (l'état en m² via l'attribut `aire` EPSG:2154, le millésime
# dérivé de LA DONNÉE), agrégation (intersection pondérée par la surface avec
# les limites communales -> artif par commune × millésime) — prouvées sur un
# PETIT GPKG de fixture (écrit avec sf::st_write, jamais téléchargé : zéro
# réseau dans la boucle de test). Le fixture porte les colonnes officielles du
# produit millésimé « surfaces artificialisées » (vérifiées à la première
# livraison 2026-08-09 : artif « artif »/« non artif », aire en m²,
# EPSG:2154, la couche `artif_{millesime}_{dep}`) et quelques polygones qui
# TRAVERSENT les frontières communales : un polygone entièrement dans une
# commune lui donne sa pleine mesure, un polygone qui coupe la frontière donne
# à A et B leurs tranches pondérées. Le seam .7z (aucun extracteur en R — la
# décision documentée) est testé : le zip que R sait écrire prouve le chemin
# cache -> lecteur complet, le .7z prouve l'étape manuelle documentée et
# l'idempotence.

# Le lecteur et la normalisation ------------------------------------------------

test_that("lire_ocsge_artificialisation : le GPKG du fixture se lit sous la couche du contrat (artif_), colonnes officielles", {
  gpkg <- tempfile(fileext = ".gpkg")
  on.exit(unlink(gpkg))
  fixture_gpkg_ocsge(gpkg, 2021, 22)

  etat <- lire_ocsge_artificialisation(gpkg)
  expect_s3_class(etat, "sf")
  expect_equal(nrow(etat), 4L)
  # les colonnes officielles du produit millésimé dans SA FORME RÉELLE (les
  # minuscules artif / aire / millesime, vérifiées 2026-08-09) traversent
  # telles quelles — on ne re-dérive rien à la lecture
  expect_true(all(c("id", "code_cs", "code_us", "millesime", "source",
                    "ossature", "id_origine", "code_or", "aire", "artif",
                    "crit_seuil") %in% names(etat)))
  expect_equal(sf::st_crs(etat)$epsg, 2154)
  expect_setequal(etat$artif, c("artif", "non artif"))
  expect_equal(unique(etat$millesime), "2021")
})

test_that("lire_ocsge_artificialisation : une couche absente échoue en nommant les couches disponibles", {
  gpkg <- tempfile(fileext = ".gpkg")
  on.exit(unlink(gpkg))
  fixture_gpkg_ocsge(gpkg, 2021, 22)

  expect_error(lire_ocsge_artificialisation(gpkg, couche = "OCCUPATION_SOL"),
               "OCCUPATION_SOL")
  expect_error(lire_ocsge_artificialisation(gpkg, couche = "OCCUPATION_SOL"),
               "artif_")  # la couche disponible est nommée
  expect_error(lire_ocsge_artificialisation(tempfile(fileext = ".gpkg")),
               "absent")
})

test_that("normaliser_ocsge_artificialisation : le millésime dérive de LA DONNÉE (la colonne millesime), jamais codé en dur", {
  gpkg <- tempfile(fileext = ".gpkg")
  on.exit(unlink(gpkg))
  fixture_gpkg_ocsge(gpkg, 2021, 22)
  norm <- normaliser_ocsge_artificialisation(lire_ocsge_artificialisation(gpkg))
  expect_equal(unique(norm$millesime), 2021L)

  # la MÊME fonction lit une autre paire sans rien changer (35 : 2020)
  gpkg2 <- tempfile(fileext = ".gpkg")
  on.exit(unlink(gpkg2))
  fixture_gpkg_ocsge(gpkg2, 2020, 35)
  norm2 <- normaliser_ocsge_artificialisation(lire_ocsge_artificialisation(gpkg2))
  expect_equal(unique(norm2$millesime), 2020L)
  # les MESURES sont identiques — seul le millésime change
  expect_equal(norm2$artif, norm$artif)
})

test_that("normaliser_ocsge_artificialisation : artif par polygone = aire si le statut officiel vaut « artif », 0 sinon (la mesure de l'État lue, jamais re-dérivée)", {
  gpkg <- tempfile(fileext = ".gpkg")
  on.exit(unlink(gpkg))
  fixture_gpkg_ocsge(gpkg, 2021, 22)
  norm <- normaliser_ocsge_artificialisation(lire_ocsge_artificialisation(gpkg))

  # P1 : artif, aire 400 -> artif = 400
  # P2 : artif, aire 1600 -> artif = 1600
  # P3 : NON artif, aire 400 -> artif = 0 (le statut officiel fait foi)
  # P4 : artif, aire 600 (géométrie 400) -> artif = 600
  expect_equal(norm$artif, c(400, 1600, 0, 600))
  # la surface de la géométrie en m² (EPSG:2154) : P4 diffère de SA surface
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
  etat <- sf::st_sf(
    id = "OCSGE1", code_cs = "CS1.1.1.1", code_us = "US5",
    millesime = "2021", source = "calcul", ossature = 0,
    id_origine = "NC", code_or = "NC",
    aire = 900000, artif = "artif", crit_seuil = FALSE,
    geometry = geom
  )
  norm <- normaliser_ocsge_artificialisation(etat)
  expect_equal(sf::st_crs(norm)$epsg, 2154)
  expect_true(all(norm$aire_m2 > 0))
  # la mesure officielle traverse telle quelle (jamais re-dérivée de la géométrie)
  expect_equal(norm$artif, 900000)
})

test_that("normaliser_ocsge_artificialisation : une couche qui dérive échoue fort (le fichier a changé de forme)", {
  gpkg <- tempfile(fileext = ".gpkg")
  on.exit(unlink(gpkg))
  fixture_gpkg_ocsge(gpkg, 2021, 22)
  base <- lire_ocsge_artificialisation(gpkg)

  # le statut artif absent (une couche différente est passée)
  sans <- base[setdiff(names(base), "artif")]
  expect_error(normaliser_ocsge_artificialisation(sans), "artif")

  # la surface aire absente
  sans_aire <- base[setdiff(names(base), "aire")]
  expect_error(normaliser_ocsge_artificialisation(sans_aire), "aire")

  # un statut hors contrat (ni artif ni non artif)
  derive <- base
  derive$artif[1] <- "peut-être"
  expect_error(normaliser_ocsge_artificialisation(derive), "artif")

  # une aire négative (un fichier corrompu) est rejetée
  derive <- base
  derive$aire <- -50
  expect_error(normaliser_ocsge_artificialisation(derive))

  # le millésime absent (la colonne ne dérive plus de la donnée)
  sans_millesime <- base[setdiff(names(base), "millesime")]
  expect_error(normaliser_ocsge_artificialisation(sans_millesime), "millesime")

  # des millésimes multiples dans UNE archive (une dérive du fichier)
  derive <- base
  derive$millesime[1] <- "2025"
  expect_error(normaliser_ocsge_artificialisation(derive), "millesime")
})

# L'agrégation pondérée ---------------------------------------------------------

test_that("agreger_artificialisation_communes : le polygone entier dans A donne SA pleine mesure à A, le polygone qui coupe la frontière donne à A/B leurs tranches pondérées", {
  gpkg <- tempfile(fileext = ".gpkg")
  on.exit(unlink(gpkg))
  fixture_gpkg_ocsge(gpkg, 2021, 22)
  norm <- normaliser_ocsge_artificialisation(lire_ocsge_artificialisation(gpkg))
  # deux communes adjacentes du MÊME département, la frontière à x = 100
  communes <- fixture_communes_ocsge(codes = c("22001", "22002"))
  agg <- agreger_artificialisation_communes(norm, communes)

  # 22001 : P1 entier (400) + la moitié de P2 (800) + P4 entier (600)
  #        = 1800 ; 22002 : la moitié de P2 (800) + P3 (non artif -> 0) = 800
  a <- agg[agg$code == "22001", ]
  expect_equal(a$artif, 1800)
  b <- agg[agg$code == "22002", ]
  expect_equal(b$artif, 800)
  # le millésime dérivé est porté par commune
  expect_equal(unique(agg$millesime), 2021L)
  # aucune ligne pour les communes qui ne reçoivent rien
  expect_setequal(agg$code, c("22001", "22002"))
})

test_that("agreger_artificialisation_communes : les tranches pondérées répartissent la MESURE OFFICIELLE, pas la géométrie", {
  # P4 (aire 600, géométrie 400) entièrement dans A : la commune A porte 600,
  # jamais 400 — la mesure de l'État est distribuée telle quelle
  gpkg <- tempfile(fileext = ".gpkg")
  on.exit(unlink(gpkg))
  fixture_gpkg_ocsge(gpkg, 2021, 22)
  norm <- normaliser_ocsge_artificialisation(lire_ocsge_artificialisation(gpkg))
  communes <- fixture_communes_ocsge(codes = c("22001", "22002"))
  agg <- agreger_artificialisation_communes(norm, communes)

  expect_equal(agg$artif[agg$code == "22001"], 400 + 800 + 600)
  expect_equal(agg$artif[agg$code == "22002"], 800 + 0)
  # la somme des mesures distribuées n'invente rien : 400 + 1600 + 0 + 600
  expect_equal(sum(agg$artif), sum(norm$artif))
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
  gpkg_source <- file.path(cache, "fixture-etat.gpkg")
  fixture_gpkg_ocsge(gpkg_source, 2021, 22)
  archive <- file.path(cache, "fixture-etat.zip")
  utils::zip(archive, files = gpkg_source, flags = "-q")
  expect_true(file.exists(archive))

  # l'extraction -> le lecteur -> la normalisation : la chaîne complète
  gpkg <- extraire_gpkg_ocsge(archive, extrait)
  expect_true(file.exists(gpkg))
  expect_equal(basename(gpkg), "fixture-etat.gpkg")
  norm <- normaliser_ocsge_artificialisation(
    lire_ocsge_artificialisation(gpkg)
  )
  expect_equal(nrow(norm), 4L)
  expect_equal(unique(norm$millesime), 2021L)

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
    MANIFEST_MILIEUX$id == "ocsge_artificialisation_22_2021"])
  writeBin(mini_7z(), archive)
  expect_error(extraire_gpkg_ocsge(archive, extrait), "MANUELLE")
  expect_error(extraire_gpkg_ocsge(archive, extrait), "7-Zip")

  # une fois le GPKG déposé par l'étape manuelle (le même stem que l'archive) :
  # réutilisé tel quel, idempotent
  gpkg <- file.path(extrait,
                    sub("[.]7z$", ".gpkg", basename(archive)))
  fixture_gpkg_ocsge(gpkg, 2021, 22)
  expect_identical(extraire_gpkg_ocsge(archive, extrait), gpkg)
})

# Le builder (construire_donnees_ocsge) ----------------------------------------

test_that("construire_donnees_ocsge : les huit archives du manifeste, chaque département SES deux millésimes, agrégés par commune et persistés", {
  cache <- tempfile("cache-ocsge-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))
  sortie <- tempfile(fileext = ".rds")
  on.exit(unlink(sortie))

  # pour chaque département × millésime : le .7z (signature valide) DANS le
  # cache au nom exact du manifeste + le GPKG déjà extrait par l'étape
  # manuelle documentée (chaque département dans SON quartier de la grille
  # communale, SES deux millésimes — l'ÉTAT à chaque borne)
  fenetres <- c("22" = "2021-2025", "29" = "2021-2024",
                "35" = "2020-2023", "56" = "2022-2024")
  decalages <- c("22" = "0;0", "29" = "100;0", "35" = "0;100", "56" = "100;100")
  extrait <- file.path(cache, "extracted", "ocsge")
  if (!dir.exists(extrait)) dir.create(extrait, recursive = TRUE)
  for (dep in names(fenetres)) {
    for (millesime in as.integer(strsplit(fenetres[[dep]], "-")[[1]])) {
      id <- paste0("ocsge_artificialisation_", dep, "_", millesime)
      ligne <- MANIFEST_MILIEUX[MANIFEST_MILIEUX$id == id, ]
      writeBin(mini_7z(), file.path(cache, ligne$fichier))
      dxdy <- as.integer(strsplit(decalages[[dep]], ";")[[1]])
      fixture_gpkg_ocsge(
        file.path(extrait, sub("[.]7z$", ".gpkg", ligne$fichier)),
        millesime, dep, dx = dxdy[1], dy = dxdy[2],
        polygones = tibble::tribble(
          ~x0, ~y0, ~x1, ~y1, ~artif, ~aire,
          20, 20, 40, 40, "artif", 400
        )
      )
    }
  }

  communes <- fixture_communes_ocsge()  # une commune par département
  agg <- construire_donnees_ocsge(cache = cache, communes = communes,
                                  sortie = sortie)

  # une ligne par commune, chacune la mesure de SON département (P1 simple :
  # artif = 400 à CHAQUE millésime — un état, jamais un flux) sur SES deux
  # millésimes dérivés de la donnée
  expect_setequal(agg$code, c("22001", "29001", "35001", "56001"))
  expect_equal(agg$artif_m2, c(400, 400, 400, 400))
  expect_equal(agg$artif_m3, c(400, 400, 400, 400))
  # flux_net a QUITTÉ la table (le DIFF est sorti — amendement #243)
  expect_false("flux_net" %in% names(agg))
  expect_equal(agg$millesime_ocsge_debut[agg$code == "22001"], 2021)
  expect_equal(agg$millesime_ocsge_fin[agg$code == "22001"], 2025)
  expect_equal(agg$millesime_ocsge_debut[agg$code == "29001"], 2021)
  expect_equal(agg$millesime_ocsge_fin[agg$code == "29001"], 2024)
  expect_equal(agg$millesime_ocsge_debut[agg$code == "35001"], 2020)
  expect_equal(agg$millesime_ocsge_fin[agg$code == "35001"], 2023)
  expect_equal(agg$millesime_ocsge_debut[agg$code == "56001"], 2022)
  expect_equal(agg$millesime_ocsge_fin[agg$code == "56001"], 2024)

  # la table est persistée sous data/processed/milieux/ (idempotent)
  expect_true(file.exists(sortie))
  relue <- readr::read_rds(sortie)
  # le tampon du point de contrôle (issue #325) vit dans le fichier, pas dans
  # la donnée : retiré avant la comparaison — la persistance est byte-identique
  attr(relue, "empreinte") <- NULL
  expect_identical(relue, agg)
})

test_that("construire_donnees_ocsge : une commune LIMITROPHE garde SA fenêtre — le sliver du département voisin ne crée pas de deuxième ligne (bug réel #243)", {
  cache <- tempfile("cache-ocsge-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))
  sortie <- tempfile(fileext = ".rds")
  on.exit(unlink(sortie))

  # Deux départements actifs : 22 (2021/2025) et 35 (2020/2023). La commune
  # 22001 (quartier 0..100 × 0..100) est dans le 22 ; 35001 (100..200 × 0..100)
  # dans le 35. Le fichier 35 contient AUSSI des polygones qui tombent dans le
  # quartier de 22001 (la frontière communale n'est pas la frontière de découpe
  # du fichier — le sliver de livraison, découvert sur le réel par #243).
  # Sans le découpage par département, 22001 recevrait les états du 35 (des
  # polygones d'état de son quartier) ET ceux du 22 — un mélange de fenêtres.
  # Les archives 29/56 existent (le builder itère les HUIT ids) avec leur
  # polygone loin de la grille (aucune commune ne le reçoit).
  extrait <- file.path(cache, "extracted", "ocsge")
  if (!dir.exists(extrait)) dir.create(extrait, recursive = TRUE)
  for (dep in c("22", "35")) {
    for (millesime in if (dep == "22") c(2021, 2025) else c(2020, 2023)) {
      id <- paste0("ocsge_artificialisation_", dep, "_", millesime)
      ligne <- MANIFEST_MILIEUX[MANIFEST_MILIEUX$id == id, ]
      writeBin(mini_7z(), file.path(cache, ligne$fichier))
    }
  }
  # le fichier 22 : P1 seul (entier dans 22001), les deux millésimes
  for (millesime in c(2021, 2025)) {
    fixture_gpkg_ocsge(
      file.path(extrait, sub("[.]7z$", ".gpkg", MANIFEST_MILIEUX$fichier[
        MANIFEST_MILIEUX$id == paste0("ocsge_artificialisation_22_", millesime)])),
      millesime, 22, dx = 0, dy = 0,
      polygones = tibble::tribble(
        ~x0, ~y0, ~x1, ~y1, ~artif, ~aire,
        20, 20, 40, 40, "artif", 400
      )
    )
  }
  # le fichier 35 : COMPLET — P1 (20,20) et P4 (30,70) tombent dans le quartier
  # de 22001 (le sliver), P2 (80,20)-(120,60) chevauche la frontière x=100, P3
  # (150,50) est entier dans 35001. Fenêtre 2020-2023.
  for (millesime in c(2020, 2023)) {
    fixture_gpkg_ocsge(
      file.path(extrait, sub("[.]7z$", ".gpkg", MANIFEST_MILIEUX$fichier[
        MANIFEST_MILIEUX$id == paste0("ocsge_artificialisation_35_", millesime)])),
      millesime, 35, dx = 0, dy = 0
    )
  }
  # les archives 29/56 : présentes, polygones loin de la grille (500, 500)
  for (dep in c("29", "56")) {
    for (millesime in if (dep == "29") c(2021, 2024) else c(2022, 2024)) {
      id <- paste0("ocsge_artificialisation_", dep, "_", millesime)
      ligne <- MANIFEST_MILIEUX[MANIFEST_MILIEUX$id == id, ]
      writeBin(mini_7z(), file.path(cache, ligne$fichier))
      fixture_gpkg_ocsge(
        file.path(extrait, sub("[.]7z$", ".gpkg", ligne$fichier)),
        millesime, dep, dx = 500, dy = 500,
        polygones = tibble::tribble(
          ~x0, ~y0, ~x1, ~y1, ~artif, ~aire,
          20, 20, 40, 40, "artif", 400
        )
      )
    }
  }

  communes <- fixture_communes_ocsge(codes = c("22001", "35001"))
  agg <- construire_donnees_ocsge(cache = cache, communes = communes,
                                  sortie = sortie)

  # UNE ligne pour 22001, avec SES millésimes (22 : 2021-2025) — les slivers du
  # fichier 35 tombés dans son quartier sont ÉCARTÉS (la fenêtre par
  # département de la spec) : la mesure est celle du fichier 22, P1 seul
  expect_equal(nrow(agg[agg$code == "22001", ]), 1L)
  a <- agg[agg$code == "22001", ]
  expect_equal(a$millesime_ocsge_debut, 2021)
  expect_equal(a$millesime_ocsge_fin, 2025)
  expect_equal(a$artif_m2, 400)
  expect_equal(a$artif_m3, 400)  # P1 du 22 — jamais P1/P4 du 35 (600 + 400)
  # 35001 : UNE ligne, SES millésimes (35 : 2020-2023) — la moitié de P2 (800)
  # + P3 (non artif, 0), jamais de ligne du 22
  expect_equal(nrow(agg[agg$code == "35001", ]), 1L)
  b <- agg[agg$code == "35001", ]
  expect_equal(b$millesime_ocsge_debut, 2020)
  expect_equal(b$millesime_ocsge_fin, 2023)
  expect_equal(b$artif_m2, 800)
  expect_equal(b$artif_m3, 800)
})

test_that("construire_donnees_ocsge : le millésime de l'archive qui dérive de l'id du manifeste échoue bruyamment (le fichier a changé)", {
  cache <- tempfile("cache-ocsge-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))
  extrait <- file.path(cache, "extracted", "ocsge")
  if (!dir.exists(extrait)) dir.create(extrait, recursive = TRUE)

  id <- "ocsge_artificialisation_22_2021"
  ligne <- MANIFEST_MILIEUX[MANIFEST_MILIEUX$id == id, ]
  writeBin(mini_7z(), file.path(cache, ligne$fichier))
  # le GPKG déposé porte un millésime DIFFÉRENT de celui épinglé au manifeste
  fixture_gpkg_ocsge(
    file.path(extrait, sub("[.]7z$", ".gpkg", ligne$fichier)),
    2020, 22  # 2020, pas 2021 — le fichier a dérivé
  )

  expect_error(
    construire_donnees_ocsge(cache = cache,
                             communes = fixture_communes_ocsge(codes = "22001"),
                             sortie = tempfile(fileext = ".rds")),
    "2021"
  )
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
