# helper-milieux ---------------------------------------------------------------
# Les fixtures partagées du thème Milieux (issue #171) : la base des EPCI du
# fixture (la forme de lire_epci — les communes de la fixture CONSOENAF), la
# SÉRIE HISTORIQUE du recensement (la source partagée de la population — la
# règle de source d'ADR-0014 ; la fixture est déposée dans le dossier extrait
# du cache, sous le nom exact que le builder lit) et le builder des communes
# via le VRAI reshape (la fixture CSV dans un cache temporaire, la base des
# EPCI mockée — jamais de réseau dans la boucle de test). Les tests de reshape
# (test-theme-milieux-reshape.R), de payload (test-contract-payload-milieux.R)
# et d'Histoire (test-theme-milieux-histoire.R) consomment ces communes.

base_epci_milieux <- tibble::tribble(
  ~CODGEO, ~LIBGEO, ~EPCI, ~LIBEPCI, ~DEP, ~REG,
  "22001", "Commune A1", "200000001", "EPCI X", "22", "53",
  "22002", "Commune D", "200000001", "EPCI X", "22", "53",
  "29001", "Commune B", "200000002", "EPCI Y", "29", "53",
  "29002", "Commune C", "200000002", "EPCI Y", "29", "53",
  "29003", "Commune NA", "200000002", "EPCI Y", "29", "53"
)

# copier_fixture_serie_historique : dépose la fixture CSV de la série
# historique du recensement dans le dossier extrait d'un cache, sous le nom
# exact que construire_donnees_milieux lit (l'extraction du zip du cache est
# idempotente — le fichier extrait fait foi, comme pour la base des EPCI).
copier_fixture_serie_historique <- function(cache) {
  extrait <- file.path(cache, "extracted")
  if (!dir.exists(extrait)) dir.create(extrait, recursive = TRUE)
  file.copy(
    testthat::test_path("fixtures", "serie-historique-fixture.csv"),
    file.path(extrait, NOM_FICHIER_SERIE_HISTORIQUE),
    overwrite = TRUE
  )
}

communes_fixture_milieux <- function(cache = NULL) {
  if (is.null(cache)) {
    cache <- tempfile("cache-milieux-")
    dir.create(cache)
  }
  file.copy(
    testthat::test_path("fixtures", "consoenaf-fixture.csv"),
    file.path(cache, "conso-com.csv"),
    overwrite = TRUE
  )
  copier_fixture_serie_historique(cache)
  local_mocked_bindings(lire_epci = function(chemin) base_epci_milieux,
                        .package = "lusk")
  construire_donnees_milieux(cache = cache,
                             sortie = tempfile(fileext = ".rds"))
}

# Les fixtures du câblage territorial OCS-GE (issue #237) ----------------------
# La base des EPCI du fixture OCS-GE territorial : SEPT communes — 22001/22002
# dans l'EPCI X du 22, 29001/29002/29003 dans l'EPCI Y du 29 (29003 SANS donnée
# OCS-GE — le cas NA), 35001/56001 dans l'EPCI Z TRANSFRONTALIER 35+56 (le cas
# du span de fenêtres). La même forme que base_epci_milieux (lire_epci). La
# géométrie du fixture (grille_communes_ocsge) est sur la même grille que les
# polygones de flux et le référentiel communes_limites.geojson — les tests de
# câblage (test-territoire-ocsge.R) vérifient les valeurs par commune à la main.

base_epci_milieux_ocsge <- tibble::tribble(
  ~CODGEO, ~LIBGEO, ~EPCI, ~LIBEPCI, ~DEP, ~REG,
  "22001", "Commune A1", "200000001", "EPCI X", "22", "53",
  "22002", "Commune D", "200000001", "EPCI X", "22", "53",
  "29001", "Commune B", "200000002", "EPCI Y", "29", "53",
  "29002", "Commune C", "200000002", "EPCI Y", "29", "53",
  "29003", "Commune NA", "200000002", "EPCI Y", "29", "53",
  "35001", "Commune E", "200000003", "EPCI Z", "35", "53",
  "56001", "Commune F", "200000003", "EPCI Z", "56", "53"
)

# grille_communes_ocsge : la grille communale du fixture OCS-GE territorial —
# sept carrés de 100 m de côté (10 000 m² chacun) en EPSG:2154, dans l'ordre
# des codes de la base. Les communes du MÊME département sont ADJACENTES
# (22001|22002 à x = 100, 29001|29002 à x = 300) pour que le polygone de flux
# qui TRAVERSE la frontière ait un vrai sens.
grille_communes_ocsge <- list(
  "22001" = c(0, 0, 100, 100),
  "22002" = c(100, 0, 200, 100),
  "29001" = c(200, 0, 300, 100),
  "29002" = c(300, 0, 400, 100),
  "29003" = c(0, 100, 100, 200),
  "35001" = c(100, 100, 200, 200),
  "56001" = c(200, 100, 300, 200)
)

# polygones_flux_ocsge_territoire : pour CHAQUE département, les polygones de
# flux du fixture avec SA fenêtre (m2, m3) et SES coordonnées de base — UN
# polygone entièrement dans la première commune + UN polygone qui TRAVERSE la
# frontière de ses deux communes (la preuve de la pondération par la surface,
# #234). Le polygone du 56 est une DÉSARTIFICIALISATION (sens -1) : la table
# des territoires doit porter le flux net signé (jamais un abs() silencieux).
polygones_flux_ocsge_territoire <- list(
  "22" = list(
    fenetre = c(2021, 2025),
    polygones = tibble::tribble(
      ~x0, ~y0, ~x1, ~y1, ~sens, ~surface,
      20, 20, 40, 40, 1L, 400,   # entier dans 22001
      80, 20, 120, 60, 1L, 1600  # traverse 22001|22002 (frontière x = 100)
    )
  ),
  "29" = list(
    fenetre = c(2021, 2024),
    polygones = tibble::tribble(
      ~x0, ~y0, ~x1, ~y1, ~sens, ~surface,
      220, 20, 240, 40, 1L, 400, # entier dans 29001
      280, 20, 320, 60, 1L, 1600 # traverse 29001|29002 (frontière x = 300)
    )
  ),
  "35" = list(
    fenetre = c(2020, 2023),
    polygones = tibble::tribble(
      ~x0, ~y0, ~x1, ~y1, ~sens, ~surface,
      120, 120, 140, 140, 1L, 400  # entier dans 35001
    )
  ),
  "56" = list(
    fenetre = c(2022, 2024),
    polygones = tibble::tribble(
      ~x0, ~y0, ~x1, ~y1, ~sens, ~surface,
      220, 120, 240, 140, -1L, 400  # entier dans 56001 — DÉSARTIFICIALISATION
    )
  )
)

# fixture_gpkg_ocsge_territoire : écrit le VRAI GeoPackage du fixture OCS-GE
# d'un département (la couche DIFF_ARTIF, EPSG:2154, les colonnes officielles
# du différentiel IGN — Artif_{m2}/Artif_{m3}, Artificialisation +1/-1, Surface)
# avec SES polygones et SA fenêtre. Le même motif que fixture_gpkg_ocsge
# (helper-ocsge.R), positionné sur la grille du fixture territorial.
fixture_gpkg_ocsge_territoire <- function(chemin, departement) {
  spec <- polygones_flux_ocsge_territoire[[departement]]
  fenetre <- spec$fenetre
  m2 <- fenetre[1]
  m3 <- fenetre[2]
  lignes <- spec$polygones
  geometries <- lapply(seq_len(nrow(lignes)), function(i) {
    l <- lignes[i, ]
    sf::st_polygon(list(polygone_rectangle(l$x0, l$y0, l$x1, l$y1)))
  })
  tbl <- tibble::tibble(
    !!paste0("Id_", m2) := paste0("S", seq_len(nrow(lignes)), "_", m2),
    !!paste0("Cs_", m2) := "CS1.1.1.1",
    !!paste0("Us_", m2) := "US5",
    !!paste0("Artif_", m2) := ifelse(lignes$sens == 1L, "Non Artif", "Artif"),
    !!paste0("Id_", m3) := paste0("S", seq_len(nrow(lignes)), "_", m3),
    !!paste0("Cs_", m3) := "CS1.1.1.1",
    !!paste0("Us_", m3) := "US5",
    !!paste0("Artif_", m3) := ifelse(lignes$sens == 1L, "Artif", "Non Artif"),
    Artificialisation = lignes$sens,
    Surface = as.double(lignes$surface)
  )
  couche <- sf::st_sf(tbl, geometry = sf::st_sfc(geometries, crs = 2154))
  if (file.exists(chemin)) unlink(chemin)
  sf::st_write(couche, chemin, layer = COUCHE_OCSGE_ARTIFICIALISATION,
               quiet = TRUE)
  invisible(chemin)
}

# fixture_limites_ocsge : la couche des limites communales du fixture OCS-GE
# territorial — la MÊME grille que les polygones de flux, dans la forme du WFS
# Admin Express que lire_communes_limites consomme (code_insee,
# code_insee_du_departement), EPSG:2154. C'est le contenu du
# communes_limites.geojson du cache du fixture.
fixture_limites_ocsge <- function(codes = names(grille_communes_ocsge)) {
  geom <- lapply(codes, function(code) {
    q <- grille_communes_ocsge[[code]]
    sf::st_polygon(list(polygone_rectangle(q[1], q[2], q[3], q[4])))
  })
  sf::st_sf(
    code_insee = codes,
    code_insee_du_departement = substr(codes, 1, 2),
    geometry = sf::st_sfc(geom, crs = 2154)
  )
}

# cache_ocsge_milieux : le cache COMPLET du fixture OCS-GE territorial (issue
# #237) — la fixture CONSOENAF à SEPT communes, la série historique à sept
# communes (déposée extraite, la forme que le builder lit), les QUATRE archives
# OCS-GE (le .7z de signature valide au nom exact du manifeste + le GPKG déjà
# extrait par l'étape manuelle documentée — le motif du test du builder #234)
# et le référentiel géométrique partagé communes_limites.geojson sur la même
# grille. Zéro réseau : tout est généré ou copié depuis les fixtures.
cache_ocsge_milieux <- function() {
  cache <- tempfile("cache-milieux-ocsge-")
  dir.create(cache)
  file.copy(
    testthat::test_path("fixtures", "consoenaf-ocsge-fixture.csv"),
    file.path(cache, "conso-com.csv"),
    overwrite = TRUE
  )
  extrait <- file.path(cache, "extracted")
  if (!dir.exists(extrait)) dir.create(extrait, recursive = TRUE)
  file.copy(
    testthat::test_path("fixtures", "serie-historique-ocsge-fixture.csv"),
    file.path(extrait, NOM_FICHIER_SERIE_HISTORIQUE),
    overwrite = TRUE
  )
  extrait_ocsge <- file.path(extrait, "ocsge")
  if (!dir.exists(extrait_ocsge)) dir.create(extrait_ocsge, recursive = TRUE)
  for (dep in names(polygones_flux_ocsge_territoire)) {
    ligne <- MANIFEST_MILIEUX[
      MANIFEST_MILIEUX$id == paste0("ocsge_artificialisation_", dep), ]
    writeBin(mini_7z(), file.path(cache, ligne$fichier))
    fixture_gpkg_ocsge_territoire(
      file.path(extrait_ocsge, sub("[.]7z$", ".gpkg", ligne$fichier)),
      dep
    )
  }
  sf::st_write(fixture_limites_ocsge(),
               file.path(cache, "communes_limites.geojson"), quiet = TRUE)
  cache
}

# communes_fixture_milieux_ocsge : les communes du thème sur le fixture OCS-GE
# territorial — le VRAI builder (construire_donnees_milieux) sur le cache du
# fixture (les archives OCS-GE présentes -> la table porte les états), la base
# des EPCI mockée (jamais de réseau).
communes_fixture_milieux_ocsge <- function(cache = NULL) {
  if (is.null(cache)) cache <- cache_ocsge_milieux()
  local_mocked_bindings(lire_epci = function(chemin) base_epci_milieux_ocsge,
                        .package = "lusk")
  construire_donnees_milieux(cache = cache,
                             sortie = tempfile(fileext = ".rds"))
}
