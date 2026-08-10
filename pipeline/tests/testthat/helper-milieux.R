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

# Les fixtures du câblage territorial OCS-GE (issue #237, amendés par #243) ---
# La base des EPCI du fixture OCS-GE territorial : SEPT communes — 22001/22002
# dans l'EPCI X du 22, 29001/29002/29003 dans l'EPCI Y du 29, 35001/56001 dans
# l'EPCI Z TRANSFRONTALIER 35+56 (le cas du span de fenêtres). Depuis
# l'amendement #243, CHAQUE commune porte SES états (le produit millésimé
# couvre tout le département — la « commune sans donnée » serait une
# corruption, la garde « toute commune a un état > 0 » l'attrape). La même
# forme que base_epci_milieux (lire_epci). La géométrie du fixture
# (grille_communes_ocsge) est sur la même grille que les polygones d'état et
# le référentiel communes_limites.geojson — les tests de câblage
# (test-territoire-ocsge.R) vérifient les valeurs par commune à la main.

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
# (22001|22002 à x = 100, 29001|29002 à x = 300) pour que le polygone d'état
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

# polygones_etat_ocsge_territoire : pour CHAQUE département, les polygones
# d'ÉTAT du fixture à SES deux millésimes (le produit millésimé « surfaces
# artificialisées » — artif « artif »/« non artif », aire en m², la forme
# réelle vérifiée 2026-08-09). Chaque archive porte les ÉTATS (des stocks,
# jamais des flux) : un polygone entièrement dans une commune + un polygone
# qui TRAVERSE la frontière de ses deux communes (la preuve de la pondération
# par la surface, #234) + des « non artif » (le statut officiel fait foi —
# jamais une superposition brute). Les états par commune (en m²) :
#   22001 : 400 -> 1200 (22, 2021/2025)   35001 : 400 -> 400  (35, 2020/2023)
#   22002 : 400 -> 800  (22, 2021/2025)   56001 : 800 -> 600  (56, 2022/2024 —
#   29001 : 800 -> 1200 (29, 2021/2024)          la renaturation MESURÉE :
#   29002 : 800 -> 800  (29, 2021/2024)          M3 < M2, les deux > 0)
#   29003 : 500 -> 700  (29, 2021/2024)
polygones_etat_ocsge_territoire <- list(
  "22" = list(
    fenetre = c(2021, 2025),
    etats = list(
      "2021" = tibble::tribble(
        ~x0, ~y0, ~x1, ~y1, ~artif, ~aire,
        # 22001 : 400 m² d'état initial
        20, 20, 40, 40, "artif", 400,
        # 22002 : 400 m² d'état initial
        120, 20, 140, 40, "artif", 400,
        # un « non artif » dans 22001 : le statut officiel, jamais re-dérivé
        60, 60, 80, 80, "non artif", 400
      ),
      "2025" = tibble::tribble(
        ~x0, ~y0, ~x1, ~y1, ~artif, ~aire,
        # 22001 : 400 (entier) + la moitié du polygone qui traverse (800)
        20, 20, 40, 40, "artif", 400,
        80, 20, 120, 60, "artif", 1600
      )
    )
  ),
  "29" = list(
    fenetre = c(2021, 2024),
    etats = list(
      "2021" = tibble::tribble(
        ~x0, ~y0, ~x1, ~y1, ~artif, ~aire,
        # 29001 : 800 m² d'état initial
        220, 20, 260, 40, "artif", 800,
        # 29002 : 800 m² d'état initial
        320, 20, 360, 40, "artif", 800,
        # 29003 : 500 m² d'état initial
        20, 120, 40, 145, "artif", 500
      ),
      "2024" = tibble::tribble(
        ~x0, ~y0, ~x1, ~y1, ~artif, ~aire,
        # 29001 : 400 (entier) + la moitié du polygone qui traverse (800)
        220, 20, 240, 40, "artif", 400,
        280, 20, 320, 60, "artif", 1600,
        # 29003 : 400 + 300 = 700 m² d'état final
        20, 120, 40, 140, "artif", 400,
        50, 150, 80, 160, "artif", 300
      )
    )
  ),
  "35" = list(
    fenetre = c(2020, 2023),
    etats = list(
      "2020" = tibble::tribble(
        ~x0, ~y0, ~x1, ~y1, ~artif, ~aire,
        120, 120, 140, 140, "artif", 400
      ),
      "2023" = tibble::tribble(
        ~x0, ~y0, ~x1, ~y1, ~artif, ~aire,
        160, 120, 180, 140, "artif", 400
      )
    )
  ),
  "56" = list(
    fenetre = c(2022, 2024),
    etats = list(
      "2022" = tibble::tribble(
        ~x0, ~y0, ~x1, ~y1, ~artif, ~aire,
        220, 120, 260, 140, "artif", 800
      ),
      "2024" = tibble::tribble(
        ~x0, ~y0, ~x1, ~y1, ~artif, ~aire,
        # 56001 : 400 + 200 = 600 m² d'état final — la renaturation MESURÉE
        # (M3 < M2, les deux > 0 : un STOCK qui diminue, jamais un 0)
        220, 120, 240, 140, "artif", 400,
        260, 120, 280, 130, "artif", 200
      )
    )
  )
)

# fixture_gpkg_ocsge_territoire : écrit le VRAI GeoPackage du fixture OCS-GE
# d'un département à UN millésime (la couche artif_{millesime}_{dep},
# EPSG:2154, les colonnes officielles du produit millésimé « surfaces
# artificialisées » dans SA FORME RÉELLE — id / code_cs / code_us / millesime /
# source / ossature / id_origine / code_or / aire / artif / crit_seuil) avec
# SES polygones d'état. Le même motif que fixture_gpkg_ocsge (helper-ocsge.R),
# positionné sur la grille du fixture territorial.
fixture_gpkg_ocsge_territoire <- function(chemin, departement, millesime) {
  spec <- polygones_etat_ocsge_territoire[[departement]]
  lignes <- spec$etats[[as.character(millesime)]]
  geometries <- lapply(seq_len(nrow(lignes)), function(i) {
    l <- lignes[i, ]
    sf::st_polygon(list(polygone_rectangle(l$x0, l$y0, l$x1, l$y1)))
  })
  tbl <- tibble::tibble(
    id = paste0("OCSGE", sprintf("%07d", seq_len(nrow(lignes)))),
    code_cs = "CS1.1.1.1",
    code_us = "US5",
    millesime = as.character(millesime),
    source = "calcul",
    ossature = 0,
    id_origine = "NC",
    code_or = "NC",
    aire = as.double(lignes$aire),
    artif = lignes$artif,
    crit_seuil = FALSE
  )
  couche <- sf::st_sf(tbl, geometry = sf::st_sfc(geometries, crs = 2154))
  if (file.exists(chemin)) unlink(chemin)
  sf::st_write(couche, chemin,
               layer = paste0("artif_", millesime, "_", departement),
               quiet = TRUE)
  invisible(chemin)
}

# fixture_limites_ocsge : la couche des limites communales du fixture OCS-GE
# territorial — la MÊME grille que les polygones d'état, dans la forme du WFS
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
# #237, amendé par #243) — la fixture CONSOENAF à SEPT communes, la série
# historique à sept communes (déposée extraite, la forme que le builder lit),
# les HUIT archives d'état OCS-GE (le .7z de signature valide au nom exact du
# manifeste + le GPKG déjà extrait par l'étape manuelle documentée — le motif
# du test du builder #234) et le référentiel géométrique partagé
# communes_limites.geojson sur la même grille. Zéro réseau : tout est généré
# ou copié depuis les fixtures.
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
  for (dep in names(polygones_etat_ocsge_territoire)) {
    for (millesime in polygones_etat_ocsge_territoire[[dep]]$fenetre) {
      id <- paste0("ocsge_artificialisation_", dep, "_", millesime)
      ligne <- MANIFEST_MILIEUX[MANIFEST_MILIEUX$id == id, ]
      writeBin(mini_7z(), file.path(cache, ligne$fichier))
      fixture_gpkg_ocsge_territoire(
        file.path(extrait_ocsge, sub("[.]7z$", ".gpkg", ligne$fichier)),
        dep, millesime
      )
    }
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

# Le fixture du PATCH CORRECTIF M2 (issue #243) --------------------------------
# Le patch correctif recense les anomalies du millésime initial (la couche
# `PATCH_CORR_{DXX}_{YYYY}`, les colonnes officielles id_ocs / code_cs /
# code_us / millesime / source / ossature / id_origine / code_or / cs_corr /
# us_corr / os_corr / decoup_geo — vérifiées à la livraison réelle 2026-08-10).
# Le fixture couvre les TROIS départements patchés (22/29/56) sur le millésime
# INITIAL, en référencant les polygones d'état du fixture territorial par
# id_ocs (l'ordre de fixture_gpkg_ocsge_territoire — OCSGE0000001, ...) :
#   - 22 2021 : le polygone artif de 22002 (id OCSGE0000002) reçoit une
#     SUBDIVISION qui inverse le statut (CS2.2.2/US1.1 -> non artif, la
#     bascule au niveau matrice) — 22002 M2 400 -> 300 ; les polygones de
#     22001 (artif et non-artif) reçoivent des patchs SANS inversion (la
#     valeur de l'archive fait foi) ;
#   - 29 2021 : trois patchs SANS inversion (le chemin sans effet) ;
#   - 56 2022 : la subdivision de 56001 (id OCSGE0000001) inverse le statut —
#     56001 M2 800 -> 600.
# Les valeurs par commune APRÈS correction (vérifiées à la main) :
#   22001 : 400 (inchangé) · 22002 : 300 (corrigé) · 29001/29002/29003 :
#   800/800/500 (inchangés) · 35001 : 400 (pas de patch) · 56001 : 600 (corrigé).
polygones_patch_ocsge_territoire <- list(
  "22" = list(
    millesime = 2021,
    patchs = tibble::tribble(
      ~x0, ~y0, ~x1, ~y1, ~id_ocs, ~code_cs, ~code_us, ~cs_corr, ~us_corr,
      # la subdivision inversée de 22002 (100 m² de l'artif 400)
      120, 20, 130, 30, "OCSGE0000002", "CS1.1.1.1", "US5", "CS2.2.2", "US1.1",
      # le polygone artif de 22001, sans inversion
      20, 20, 40, 40, "OCSGE0000001", "CS1.1.1.1", "US5", "CS1.1.1.1", "US5",
      # le polygone non-artif de 22001, sans inversion
      60, 60, 80, 80, "OCSGE0000003", "CS1.1.1.1", "US5", "CS2.2.2", "US1.1"
    )
  ),
  "29" = list(
    millesime = 2021,
    patchs = tibble::tribble(
      ~x0, ~y0, ~x1, ~y1, ~id_ocs, ~code_cs, ~code_us, ~cs_corr, ~us_corr,
      220, 20, 260, 40, "OCSGE0000001", "CS1.1.1.1", "US5", "CS1.1.1.1", "US5",
      320, 20, 360, 40, "OCSGE0000002", "CS1.1.1.1", "US5", "CS1.1.1.1", "US5",
      20, 120, 40, 145, "OCSGE0000003", "CS1.1.1.1", "US5", "CS1.1.1.1", "US5"
    )
  ),
  "56" = list(
    millesime = 2022,
    patchs = tibble::tribble(
      ~x0, ~y0, ~x1, ~y1, ~id_ocs, ~code_cs, ~code_us, ~cs_corr, ~us_corr,
      # la subdivision inversée de 56001 (200 m² de l'artif 800)
      220, 120, 230, 140, "OCSGE0000001", "CS1.1.1.1", "US5", "CS2.2.2", "US1.1"
    )
  )
)

# fixture_gpkg_patch : écrit le VRAI GeoPackage PATCH CORRECTIF du fixture (la
# couche PATCH_CORR_D0{dep}_{millesime}, EPSG:2154, les colonnes officielles du
# patch dans SA FORME RÉELLE — id_ocs / code_cs / code_us / millesime / source /
# ossature / id_origine / code_or / cs_corr / us_corr / os_corr / decoup_geo)
# avec SES polygones. Retourne le chemin écrit.
fixture_gpkg_patch <- function(chemin, departement, millesime) {
  spec <- polygones_patch_ocsge_territoire[[departement]]
  lignes <- spec$patchs
  geometries <- lapply(seq_len(nrow(lignes)), function(i) {
    l <- lignes[i, ]
    sf::st_polygon(list(polygone_rectangle(l$x0, l$y0, l$x1, l$y1)))
  })
  tbl <- tibble::tibble(
    id_ocs = lignes$id_ocs,
    code_cs = lignes$code_cs,
    code_us = lignes$code_us,
    millesime = as.character(millesime),
    source = "calcul",
    ossature = 0,
    id_origine = "NC",
    code_or = "NC",
    cs_corr = lignes$cs_corr,
    us_corr = lignes$us_corr,
    os_corr = "RAS",
    decoup_geo = 0
  )
  couche <- sf::st_sf(tbl, geometry = sf::st_sfc(geometries, crs = 2154))
  if (file.exists(chemin)) unlink(chemin)
  sf::st_write(couche, chemin,
               layer = paste0("PATCH_CORR_D0", departement, "_", millesime),
               quiet = TRUE)
  invisible(chemin)
}

# ajouter_patchs_fixture : dépose dans un cache les TROIS archives patchs (le
# .7z de signature valide au nom exact du manifeste + le GPKG déjà extrait par
# l'étape manuelle documentée) — le même motif que les archives d'état.
ajouter_patchs_fixture <- function(cache) {
  extrait_ocsge <- file.path(cache, "extracted", "ocsge")
  if (!dir.exists(extrait_ocsge)) dir.create(extrait_ocsge, recursive = TRUE)
  for (dep in names(polygones_patch_ocsge_territoire)) {
    spec <- polygones_patch_ocsge_territoire[[dep]]
    id <- paste0("ocsge_patch_correctif_", dep)
    ligne <- MANIFEST_MILIEUX[MANIFEST_MILIEUX$id == id, ]
    writeBin(mini_7z(), file.path(cache, ligne$fichier))
    fixture_gpkg_patch(
      file.path(extrait_ocsge, sub("[.]7z$", ".gpkg", ligne$fichier)),
      dep, spec$millesime
    )
  }
  invisible(cache)
}

# cache_ocsge_milieux_patche : le cache du fixture territorial AVEC les trois
# patchs correctifs M2 (22/29/56) — le chemin complet du run réel (les états +
# leur correction), pour les tests du patch (issue #243).
cache_ocsge_milieux_patche <- function() {
  cache <- cache_ocsge_milieux()
  ajouter_patchs_fixture(cache)
  cache
}

# communes_fixture_milieux_ocsge_patchee : les communes du thème sur le cache
# patché — les états d'artificialisation CORRIGÉS par le patch M2.
communes_fixture_milieux_ocsge_patchee <- function() {
  cache <- cache_ocsge_milieux_patche()
  local_mocked_bindings(lire_epci = function(chemin) base_epci_milieux_ocsge,
                        .package = "lusk")
  construire_donnees_milieux(cache = cache,
                             sortie = tempfile(fileext = ".rds"))
}
