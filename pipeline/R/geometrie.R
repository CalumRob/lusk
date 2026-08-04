# geometrie --------------------------------------------------------------------
# L'étape de géométrie du pipeline (issue #60, ADR-0008) : publier les trois
# masques territoriaux — communes.geojson, epcis.geojson, departements.geojson —
# sous le home public du payload (public/data/ à la racine du dépôt), là où
# l'app les lit (/data/, app/src/geo/chargerMasques.ts).
#
# Source : Admin Express CARTO-PE (« petite échelle ») sur le WFS de
# data.geopf.fr — le produit IGN conçu pour l'affichage cartographique :
# pré-simplifié, topologiquement cohérent entre niveaux (les frontières
# partagées communales/EPCI/départementales coïncident — le bug des anciens
# fichiers démo, simplifiés à la main par niveau indépendamment, voir issue
# #69). Licence Ouverte (Licence Ouverte 2.0) — pas de friction ODbL, cohérent
# avec l'identité open-data du produit (ADR-0008).
#
# Le seam du fetch : `fetch` est injectable (les tests fournissent un faux —
# le réseau n'entre jamais dans la boucle de test, convention du pipeline) ;
# le vrai fetch (telecharger_geometrie_wfs) n'est pas testé, il est vérifié
# une fois à la main. La publication est un upsert : relancer écrase, ne
# duplique jamais (sémantique d'ADR-0004).

# NIVEAUX_GEOMETRIE ------------------------------------------------------------
# Le contrat des niveaux : le nom de la couche WFS CARTO-PE par fichier cible
# (les noms de fichiers de l'ADR-0008, la clé est le nom du fichier sans
# extension). Testé stable — c'est l'interface avec le WFS d'IGN.
NIVEAUX_GEOMETRIE <- c(
  communes = "ADMINEXPRESS-COG-CARTO-PE.LATEST:commune",
  epcis = "ADMINEXPRESS-COG-CARTO-PE.LATEST:epci",
  departements = "ADMINEXPRESS-COG-CARTO-PE.LATEST:departement"
)

# WFS_GEOMETRIE_BBOX -----------------------------------------------------------
# La boîte englobante de la Bretagne (départements 22·29·35·56) en WGS84 —
# le filtre bbox de la requête GetFeature. Large : elle déborde un peu sur les
# régions voisines (44, 50, 61…), le filtre départemental précis se fait côté
# pipeline (filtrer_geometrie) — la bbox ne sert qu'à éviter de télécharger la
# France entière.
WFS_GEOMETRIE_BBOX <- "47.0,-5.5,49.0,-0.5,urn:ogc:def:crs:EPSG::4326"

# WFS_GEOMETRIE_BASE -----------------------------------------------------------
# L'endpoint WFS de data.geopf.fr (IGN) — l'accès aux données Admin Express
# sans clé (vérifié en direct le 2026-08-04).
WFS_GEOMETRIE_BASE <- "https://data.geopf.fr/wfs/ows"

# telecharger_geometrie_wfs ----------------------------------------------------
# Le VRAI fetch : une requête GetFeature par niveau (bbox Bretagne, GeoJSON).
# Non testé dans la boucle (convention pipeline — comme telecharger_fichier) :
# il parle au réseau ; les tests injectent un faux. L'échec réseau remonte
# bruyamment — publier_geometrie s'arrête, la publication ne part jamais à
# moitié.
telecharger_geometrie_wfs <- function(niveau, base = WFS_GEOMETRIE_BASE,
                                      bbox = WFS_GEOMETRIE_BBOX) {
  url <- paste0(
    base,
    "?service=WFS&version=2.0.0&request=GetFeature",
    "&typeNames=", utils::URLencode(NIVEAUX_GEOMETRIE[[niveau]], reserved = TRUE),
    "&count=3000&outputFormat=application/json",
    "&bbox=", bbox
  )
  reponse <- httr2::request(url) |>
    httr2::req_user_agent("lusk-pipeline (https://github.com/CalumRob/lusk)") |>
    httr2::req_perform()
  httr2::resp_body_json(reponse, simplifyVector = FALSE)
}

# filtrer_geometrie ------------------------------------------------------------
# La garde Bretagne par niveau. La règle par niveau (le champ qui porte le
# rattachement départemental diffère) :
#   - communes      : code_insee_du_departement ∈ {22,29,35,56}
#   - epcis         : codes_insee_des_departements_membres contient AU MOINS un
#                     département breton (un EPCI transfrontalier 44/56 est
#                     breton — il a des communes bretonnes ; un EPCI 44 pur
#                     tombe)
#   - departements  : code_insee ∈ {22,29,35,56}
# Un niveau inconnu est une erreur forte — un niveau mal déclaré doit être
# visible, pas silencieux.
filtrer_geometrie <- function(collection, niveau) {
  if (!niveau %in% names(NIVEAUX_GEOMETRIE)) {
    stop("niveau de géométrie inconnu : ", niveau, call. = FALSE)
  }
  garde <- switch(
    niveau,
    communes = function(p) as.character(p$code_insee_du_departement) %in% DEPT_BRETAGNE,
    epcis = function(p) {
      deps <- strsplit(p$codes_insee_des_departements_membres, "/")[[1]]
      any(deps %in% DEPT_BRETAGNE)
    },
    departements = function(p) as.character(p$code_insee) %in% DEPT_BRETAGNE
  )
  collection$features <- collection$features[
    vapply(collection$features, function(f) garde(f$properties), logical(1))
  ]
  collection
}

# TYPE_PAR_NIVEAU --------------------------------------------------------------
# L'étiquette de type du contrat de l'app par niveau — le singulier : la table
# `territoires` du payload porte `type` = "commune" / "epci" / "departement"
# (le nom du fichier est au pluriel : communes.geojson, epcis.geojson,
# departements.geojson — ADR-0008). La carte joint les deux sur `territoire`.
TYPE_PAR_NIVEAU <- c(
  communes = "commune",
  epcis = "epci",
  departements = "departement"
)

# mapper_vers_contrat ----------------------------------------------------------
# La traduction au contrat de l'app (ADR-0008, app/src/geo/types.ts) : chaque
# feature ne porte QUE les trois propriétés du contrat — `territoire` (le code
# jointable au payload : INSEE pour commune/département, SIREN pour l'EPCI),
# `nom` (le vrai nom Admin Express) et `type` (commune/epci/departement). La
# géométrie traverse intacte. Tout le reste des propriétés WFS (population,
# superficie, statut…) tombe — le payload de la carte ne transporte que le
# contrat, rien de plus.
mapper_vers_contrat <- function(collection, niveau) {
  if (!niveau %in% names(NIVEAUX_GEOMETRIE)) {
    stop("niveau de géométrie inconnu : ", niveau, call. = FALSE)
  }
  code_territoire <- switch(
    niveau,
    communes = function(p) p$code_insee,
    epcis = function(p) p$code_siren,
    departements = function(p) p$code_insee
  )
  collection$features <- lapply(collection$features, function(f) {
    p <- f$properties
    f$properties <- list(
      territoire = code_territoire(p),
      nom = p$nom_officiel,
      type = TYPE_PAR_NIVEAU[[niveau]]
    )
    f
  })
  collection
}

# publier_geometrie ------------------------------------------------------------
# L'orchestrateur : télécharge les trois couches (ou utilise le fetch injecté),
# filtre à la Bretagne, mappe au contrat et écrit les trois fichiers sous la
# cible. Upsert : écrire écrase (ADR-0004) — relancer ne duplique jamais.
# Le fichier cible porte le nom du niveau (communes.geojson, epcis.geojson,
# departements.geojson — ADR-0008) ; l'app le lit sous /data/<niveau>.geojson.
publier_geometrie <- function(cible = "public/data",
                              fetch = telecharger_geometrie_wfs) {
  if (!dir.exists(cible)) dir.create(cible, recursive = TRUE)

  for (niveau in names(NIVEAUX_GEOMETRIE)) {
    brut <- fetch(niveau)
    filtre <- filtrer_geometrie(brut, niveau)
    mappe <- mapper_vers_contrat(filtre, niveau)
    jsonlite::write_json(
      mappe,
      file.path(cible, paste0(niveau, ".geojson")),
      auto_unbox = TRUE,
      digits = NA,
      pretty = FALSE
    )
  }

  invisible(niveau)
}
