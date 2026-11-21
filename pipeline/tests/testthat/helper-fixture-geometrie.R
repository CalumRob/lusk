# helper-fixture-geometrie ------------------------------------------------------
# Le jeu de données synthétique de la géométrie (issue #60) — le contrat
# d'entrée de l'étape publier_geometrie : les FeatureCollections WFS d'Admin
# Express CARTO-PE, telles que renvoyées par le WFS de data.geopf.fr
# (properties Admin Express, géométrie Polygon/MultiPolygon). Couvre :
#   - une commune bretonne (22) et une commune hors Bretagne (44) — le filtre ;
#   - un EPCI breton pur (tous membres 56), un EPCI transfrontalier (membres
#     44/56 — gardé : il a des communes bretonnes), un EPCI hors Bretagne
#     (membres 44 seulement — écarté) ;
#   - un département breton (35) et un hors Bretagne (50).

# feature ---------------------------------------------------------------
feature_geometrie <- function(proprietes, coordinates = list(
    list(list(c(-3, 48), c(-2.9, 48), c(-2.9, 48.1), c(-3, 48.1), c(-3, 48)))
  )) {
  list(
    type = "Feature",
    properties = proprietes,
    geometry = list(
      type = "Polygon",
      coordinates = coordinates
    )
  )
}

# collection ------------------------------------------------------------
collection_wfs <- function(features) {
  list(type = "FeatureCollection", features = features)
}

# communes : 22001 (22, bretonne) et 44001 (44, hors Bretagne)
fixture_communes_wfs <- function() {
  collection_wfs(list(
    feature_geometrie(list(
      cleabs = "COMMUNE_0000000000022001",
      nom_officiel = "Commune bretonne",
      code_insee = "22001",
      code_insee_du_departement = "22",
      code_insee_de_la_region = "53",
      codes_siren_des_epci = "200000001"
    )),
    feature_geometrie(list(
      cleabs = "COMMUNE_0000000000044001",
      nom_officiel = "Commune ligérienne",
      code_insee = "44001",
      code_insee_du_departement = "44",
      code_insee_de_la_region = "52",
      codes_siren_des_epci = "244400000"
    ))
  ))
}

# epcis : pur breton (56), transfrontalier (44/56), hors Bretagne (44)
fixture_epcis_wfs <- function() {
  collection_wfs(list(
    feature_geometrie(list(
      cleabs = "EPCI____0000000200000001",
      nom_officiel = "CC Bretonne",
      code_siren = "200000001",
      codes_insee_des_departements_membres = "56"
    )),
    feature_geometrie(list(
      cleabs = "EPCI____0000000200000002",
      nom_officiel = "CC Transfrontalière",
      code_siren = "200000002",
      codes_insee_des_departements_membres = "44/56"
    )),
    feature_geometrie(list(
      cleabs = "EPCI____0000000200000003",
      nom_officiel = "CC Ligérienne",
      code_siren = "244400000",
      codes_insee_des_departements_membres = "44"
    ))
  ))
}

# departements : 35 (breton) et 50 (hors Bretagne)
fixture_departements_wfs <- function() {
  collection_wfs(list(
    feature_geometrie(list(
      cleabs = "DEPARTEM0000000000000035",
      nom_officiel = "Ille-et-Vilaine",
      code_insee = "35",
      code_insee_de_la_region = "53"
    )),
    feature_geometrie(list(
      cleabs = "DEPARTEM0000000000000050",
      nom_officiel = "Manche",
      code_insee = "50",
      code_insee_de_la_region = "28"
    ))
  ))
}

# Une commune par département de la Bretagne canonique (22·29·35·56) plus une
# commune ligérienne écartée par le filtre. Le jeu SAIN de la garde de
# plausibilité (#1100) : l'univers de référence couvre les 4 départements, pas
# une seule commune. `departements` permet de fabriquer un jeu volontairement
# incomplet pour prouver que la garde refuse une couverture partielle.
fixture_communes_wfs_departements <- function(departements = c("22", "29", "35", "56")) {
  collection_wfs(c(
    lapply(departements, function(d) {
      feature_geometrie(list(
        cleabs = paste0("COMMUNE_00000000000", d, "001"),
        nom_officiel = paste0("Commune ", d),
        code_insee = paste0(d, "001"),
        code_insee_du_departement = d,
        code_insee_de_la_region = "53",
        codes_siren_des_epci = "200000001"
      ))
    }),
    list(feature_geometrie(list(
      cleabs = "COMMUNE_0000000000044001",
      nom_officiel = "Commune ligérienne",
      code_insee = "44001",
      code_insee_du_departement = "44",
      code_insee_de_la_region = "52",
      codes_siren_des_epci = "244400000"
    )))
  ))
}

# Collection vide au sens WFS : une FeatureCollection parfaitement valide,
# syntaxiquement correcte, mais SANS feature — exactement ce que GeoPF renvoie
# avec le bbox lat,lon (le cas silencieux de #1100).
fixture_collection_vide <- function() collection_wfs(list())

# Le contrat d'entrée de publier_geometrie : les trois niveaux, indexés comme
# le WFS les renvoie (le nom des fichiers cibles de l'ADR-0008).
fixture_geometrie_wfs <- function() {
  list(
    communes = fixture_communes_wfs(),
    epcis = fixture_epcis_wfs(),
    departements = fixture_departements_wfs()
  )
}

# Le jeu SAIN : les communes couvrent les 4 départements bretons, donc la
# garde de plausibilité (#1100) passe et les trois masques sont écrits.
fixture_geometrie_wfs_saine <- function() {
  list(
    communes = fixture_communes_wfs_departements(),
    epcis = fixture_epcis_wfs(),
    departements = fixture_departements_wfs()
  )
}
