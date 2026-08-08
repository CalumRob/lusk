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

# passage COG — la table de passage millésime-à-millésime -----------------------
# Le composant partagé « passage COG » (issue #222, ticket #227) : projeter des
# codes communaux d'un millésime COG vers un autre — la discipline que l'issue
# supposait existante mais qui n'existait pas (le pipeline n'avait que des
# gardes de FORMAT COG, jamais de table millésime-à-millésime). Usage : le jeu
# Geovelo « Aménagements cyclables » joint ses segments sur des codes COG 2022,
# le squelette de l'app est au COG 2025 — la table de passage projette l'un
# vers l'autre.
# Source (fragment `cog_passage` du manifeste) : INSEE « Table de passage
# annuelle 2025 » — la feuille COM : UNE ligne par commune de la géographie
# 2025, avec CODGEO_<année> = le code que la commune portait dans chaque
# millésime depuis 2003. Une commune issue d'une fusion y figure en PLUSIEURS
# lignes (une par ancienne commune) ; une commune inchangée en une seule ligne
# (l'identité). Vérifié sur le fichier réel (2026-08-08) : 36 760 lignes × 47
# colonnes ; les fusions bretonnes 2022→2025 sont Le Cambout (22027) +
# Coëtlogon (22043) → Plumieux (22241), Pléven (22200) → Val-d'Arguenon
# (22237), Saint-Launeuc (22309) → Merdrignac (22147), Fleurigné (35112) → La
# Chapelle-Fleurigné (35062) ; 1 270 communes bretonnes 2025, aucune créée
# après 2022 ; aucun code 2022 breton ne mappe vers PLUSIEURS codes 2025 (0
# scission postérieure — les scissions du fichier sont toutes antérieures à
# 2022, ex. Hédé 35130 en 2008).

# lire_table_passage ------------------------------------------------------------
# Le lecteur de la table de passage annuelle INSEE : la feuille COM du zip
# (les 4 premières lignes sont titre + métadonnées, la 5e l'en-tête réel —
# NIVGEO, CODGEO_2003, LIBGEO_2003, …, CODGEO_2025, LIBGEO_2025). Non testé
# dans la boucle (la convention du pipeline — comme lire_epci) ; la forme
# réelle est vérifiée par construire_passage_cog sur les fixtures.
lire_table_passage <- function(chemin) {
  readxl::read_excel(chemin, sheet = "COM", col_types = "text", skip = 5)
}

# construire_passage_cog ---------------------------------------------------------
# La table WIDE (CODGEO_2022 → CODGEO_2025) vers la table LONG de passage :
# {code_2022, code_2025}, une ligne par code 2022, les lignes identité
# (Plumieux → Plumieux) dédupliquées, triée par code_2022 — déterministe.
# Gardes : les deux colonnes requises (une colonne manquante nomme le champ
# fautif), et un code 2022 qui mappe vers PLUSIEURS codes 2025 (une scission —
# le code se diviserait en deux communes) est une corruption : jamais un choix
# silencieux.
construire_passage_cog <- function(table_wide) {
  requises <- c("CODGEO_2022", "CODGEO_2025")
  manquantes <- setdiff(requises, names(table_wide))
  if (length(manquantes) > 0) {
    stop("Table de passage COG corrompue — colonne(s) requise(s) manquante(s) : ",
         paste(manquantes, collapse = ", "), ".", call. = FALSE)
  }
  table_wide %>%
    dplyr::transmute(code_2022 = CODGEO_2022, code_2025 = CODGEO_2025) %>%
    dplyr::distinct() %>%
    dplyr::group_by(code_2022) %>%
    dplyr::filter(dplyr::n() > 1) %>%
    dplyr::ungroup() %>%
    {
      multi <- .
      if (nrow(multi) > 0) {
        stop("Table de passage COG corrompue — le code 2022 '",
             multi$code_2022[1], "' mappe vers plusieurs codes 2025 (une ",
             "scission) — jamais un choix silencieux.", call. = FALSE)
      }
      NULL
    }
  table_wide %>%
    dplyr::transmute(code_2022 = CODGEO_2022, code_2025 = CODGEO_2025) %>%
    dplyr::distinct() %>%
    dplyr::arrange(code_2022)
}

# passage_cog -------------------------------------------------------------------
# Applique la table de passage à un vecteur de codes : chaque code 2022 est
# remplacé par son code 2025 ; un code présent dans la table des 2025 (l'identité
# — la commune inchangée) passe tel quel ; un code NON mappé (absent des deux
# côtés de la table) s'arrête bruyamment en nommant le code fautif — jamais une
# NA silencieuse (un segment Geovelo dont la commune a disparu des deux
# millésimes est une corruption de la donnée, pas un drop). Déterministe : le
# vecteur d'entrée est conservé dans l'ordre.
passage_cog <- function(codes, mappe) {
  codes <- as.character(codes)
  if (length(codes) == 0) return(character(0))
  ref <- stats::setNames(mappe$code_2025, mappe$code_2022)
  manquants <- setdiff(codes, names(ref))
  if (length(manquants) > 0) {
    stop("Passage COG — code(s) non mappé(s) vers le COG 2025 : ",
         paste(manquants, collapse = ", "), ".", call. = FALSE)
  }
  unname(ref[codes])
}

# passage_cog_lenient ----------------------------------------------------------
# La variante LÉNIENTE de passage_cog : les codes présents dans la table de
# passage sont mappés vers le COG 2025 ; les codes ABSENTS traversent tels
# quels (jamais une erreur). Réservée au côté NON-breton d'un segment de
# frontière (ex. 44006 — un segment 22/44, vérifié : 1 ligne sur le fichier
# réel) : ce côté n'est jamais une clé de territoire, il ne sert qu'à la règle
# d'attribution par le côté porteur (ADR-0016). Le côté breton, lui, reste
# STRICT (passage_cog) — un code breton non mappé est une corruption, jamais
# une NA silencieuse. Déterministe : l'ordre du vecteur d'entrée est conservé.
passage_cog_lenient <- function(codes, mappe) {
  codes <- as.character(codes)
  if (length(codes) == 0) return(character(0))
  ref <- stats::setNames(mappe$code_2025, mappe$code_2022)
  a_mapper <- codes %in% names(ref)
  codes[a_mapper] <- unname(ref[codes[a_mapper]])
  codes
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
