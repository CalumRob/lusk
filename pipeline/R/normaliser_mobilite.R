# normaliser_mobilite -----------------------------------------------------------
# Les lecteurs et normaliseurs PURS de l'étage demande/réseaux du thème Mobilité
# (issue #139) : le cube RP voitures/ménage, les limites communales Admin Express,
# les lignes OSM Geofabrik et les aménagements cyclables Geovelo. Le snapshot
# porté et ses lecteurs ont été retirés (issue #1048) : Offre TC consomme désormais
# le spine d'adresses résidentielles AEDAR (sources_offre_mobilite.R).

# L'étage demande/réseaux : les lecteurs des sources (issue #139) -------------
# Le snapshot porté (ci-dessus) reste la source du flagship ; les trois sources
# de l'étage demande/réseaux ont leurs propres lecteurs, dans la même
# discipline : les gardes de forme s'ARRÊTENT bruyamment (une vague qui change
# de structure est une corruption, jamais une ligne silencieusement perdue) et
# les lecteurs ne sont pas testés dans la boucle (ils lisent les vrais
# fichiers) — les PIVOTS purs, eux, sont testés sur la forme réelle.

# extraire_voitures -------------------------------------------------------------
# Le pivot PUR de la demande : depuis la table longue du cube
# DS_RP_LOGEMENT_PRINC (lire_csv_long), les comptes voitures/ménage par
# commune — le code de table épinglé LOG T12 (manifest_mobilite.R). Le filtre
# sélectionne les lignes « nombre de ménages » (RP_MEASURE = DWELLINGS) des
# résidences principales (OCS = DW_MAIN) au recensement 2023, avec les
# dimensions résiduelles au total (_T), croisées par la dimension CARS :
#   _T    -> menages_total (le nombre de ménages) ;
#   C0    -> menages_sans_voiture ;
#   C1    -> menages_une_voiture ;
#   C_GE2 -> menages_deux_plus.
# Depuis l'issue #368, la catégorie du MILIEU (C1 — un ménage avec une seule
# voiture) est publiée : les trois parts (0 / 1 / 2+) somment à 1 — la
# catégorie 1 était dans la source RP et manquait au payload (les seules
# parties sans_voiture / deux_plus ne sommaient pas à 1).
# Une colonne requise manquante (une vague qui change de structure) s'arrête
# ici, en nommant le champ fautif. Déterministe : trié par commune.
extraire_voitures <- function(long) {
  requises <- c("GEO", "GEO_OBJECT", "OCS", "L_STAY", "TDW", "CARS",
                "RP_MEASURE", "CARPARK", "NOR", "TSH", "BUILD_END",
                "NRG_SRC", "OBS_STATUS", "TIME_PERIOD", "OBS_VALUE")
  manquantes <- setdiff(requises, names(long))
  if (length(manquantes) > 0) {
    stop("Voitures/ménage corrompu — colonne(s) requise(s) du cube RP ",
         "manquante(s) : ", paste(manquantes, collapse = ", "), ".",
         call. = FALSE)
  }

  voitures <- long %>%
    dplyr::filter(
      GEO_OBJECT == "COM",
      TIME_PERIOD == 2023,
      OBS_STATUS == "A",
      RP_MEASURE == "DWELLINGS",
      OCS == "DW_MAIN",
      L_STAY == "_T", TDW == "_T", CARPARK == "_T", NOR == "_T",
      TSH == "_T", BUILD_END == "_T", NRG_SRC == "_T",
      CARS %in% c("_T", "C0", "C1", "C_GE2"),
      # la Bretagne : le préfixe départemental du code commune (le même filtre
      # que le snapshot porté — jamais une commune hors 22/29/35/56)
      substr(GEO, 1, 2) %in% DEPT_BRETAGNE
    ) %>%
    dplyr::select(GEO, CARS, OBS_VALUE) %>%
    tidyr::pivot_wider(id_cols = GEO, names_from = CARS,
                       values_from = OBS_VALUE) %>%
    dplyr::rename(commune = GEO, menages_total = `_T`,
                  menages_sans_voiture = C0, menages_une_voiture = C1,
                  menages_deux_plus = C_GE2)

  absentes <- setdiff(c("commune", "menages_total", "menages_sans_voiture",
                        "menages_une_voiture", "menages_deux_plus"),
                      names(voitures))
  if (length(absentes) > 0) {
    stop("Voitures/ménage corrompu — la dimension CARS du cube ne porte pas ",
         "les comptes attendus (C0 / C1 / C_GE2 / _T) : ",
         paste(absentes, collapse = ", "), ".", call. = FALSE)
  }
  voitures %>%
    dplyr::arrange(commune)
}

# lire_voitures_communes --------------------------------------------------------
# Le lecteur de la demande : décompresse le zip du cache (idempotent — les
# fichiers déjà extraits sont laissés intacts) et pivote la table longue du
# cube DS_RP_LOGEMENT_PRINC. Non testé dans la boucle (il lit le vrai fichier) ;
# le pivot (extraire_voitures) est testé sur la forme réelle.
lire_voitures_communes <- function(chemin_zip) {
  extrait <- file.path(dirname(chemin_zip), "extracted")
  if (!dir.exists(extrait)) dir.create(extrait, recursive = TRUE)
  suppressWarnings(
    utils::unzip(chemin_zip, exdir = extrait, overwrite = FALSE)
  )
  long <- lire_csv_long(
    file.path(extrait, "DS_RP_LOGEMENT_PRINC_2023_data.csv")
  )
  extraire_voitures(long)
}

# lire_communes_limites ----------------------------------------------------------
# Le lecteur du référentiel géométrique : les limites communales Admin Express
# COG (WFS data.geopf.fr, le GeoJSON du cache) filtrées à la Bretagne — les
# communes voisines qui débordent de la bbox tombent. La géométrie est
# réparée (st_make_valid) pour l'intersection. Retourne les polygones en
# WGS84 (le crs du GeoJSON) — la projection EPSG:2154 est l'affaire du
# builder de réseaux (la consigne : projeter AVANT toute mesure).
lire_communes_limites <- function(chemin) {
  limites <- sf::st_read(chemin, quiet = TRUE)
  requises <- c("code_insee", "code_insee_du_departement")
  manquantes <- setdiff(requises, names(limites))
  if (length(manquantes) > 0) {
    stop("Limites communales corrompues — colonne(s) requise(s) manquante(s) : ",
         paste(manquantes, collapse = ", "), ".", call. = FALSE)
  }
  limites %>%
    dplyr::filter(as.character(code_insee_du_departement) %in% DEPT_BRETAGNE) %>%
    dplyr::select(code_insee, code_insee_du_departement) %>%
    sf::st_make_valid()
}

# lire_lignes_osm ----------------------------------------------------------------
# Le lecteur des réseaux : la couche `lines` de l'extrait Geofabrik Bretagne
# (le pbf du cache) via osmextract — le driver OSM de GDAL, qui expose les
# colonnes fixes (osm_id, name, highway, ...). Les modes t/b/c se lisent sur
# highway (MODES_RESEAUX_MOBILITE, demande_reseaux_mobilite.R). La garde de
# forme s'arrête si la couche ne porte pas highway (une vague qui change de
# structure). Retourne les lignes en WGS84 — la projection est l'affaire du
# builder.
lire_lignes_osm <- function(chemin_pbf) {
  lignes <- osmextract::oe_read(chemin_pbf, layer = "lines", quiet = TRUE)
  normaliser_lignes_osm(lignes)
}

# Parking fermé (ways + relations) shares the Geofabrik extract with networks.
# Nodes and non-parking features are deliberately not admitted to the contract.
extraire_tag_osm <- function(tags, key) {
  pattern <- paste0('"', key, '"=>"', '([^"]*)', '"')
  values <- ifelse(is.na(tags), "", as.character(tags))
  matches <- regexec(pattern, values, perl = TRUE)
  vapply(regmatches(values, matches), function(match) {
    if (length(match) > 1) match[[2]] else NA_character_
  }, character(1))
}

normaliser_lignes_osm <- function(x) {
  if (!"highway" %in% names(x)) {
    stop("Extrait OSM corrompu — la couche des lignes ne porte pas highway.",
         call. = FALSE)
  }
  cles_stationnement <- c(
    "parking:lane:left", "parking:lane:right", "parking:lane:both",
    "parking:left", "parking:right", "parking:both",
    "parking_lane_left", "parking_lane_right", "parking_lane_both"
  )
  other_tags <- if ("other_tags" %in% names(x)) x$other_tags else rep(NA_character_, nrow(x))
  for (cle in cles_stationnement) {
    extrait <- extraire_tag_osm(other_tags, cle)
    existant <- if (cle %in% names(x)) as.character(x[[cle]]) else rep(NA_character_, nrow(x))
    x[[cle]] <- ifelse(!is.na(existant) & nzchar(existant), existant, extrait)
  }
  # Network-scope tags are also stored in GDAL's other_tags column. Promote
  # every tag consumed by the t/c contracts so downstream mode filters never
  # parse provider-specific serialization.
  for (cle in c("foot", "access", "vehicle", "motor_vehicle", "motorcar",
                "busway", "service", "maxspeed", "sidewalk",
                "sidewalk:left", "sidewalk:right", "tracktype")) {
    extrait <- extraire_tag_osm(other_tags, cle)
    existant <- if (cle %in% names(x)) as.character(x[[cle]]) else rep(NA_character_, nrow(x))
    x[[cle]] <- ifelse(!is.na(existant) & nzchar(existant), existant, extrait)
  }
  x
}

normaliser_parkings_osm <- function(x) {
  if (!"amenity" %in% names(x)) stop("OSM parkings : colonne amenity absente.", call. = FALSE)
  # Do not let NA in the GDAL attribute vector select an NA feature row.
  # The OSM multipolygon driver can append one such geometry-collection row;
  # it is not a parking feature and has no polygonal area to attribute.
  amenity <- as.character(x$amenity)
  x <- x[!is.na(amenity) & amenity == "parking", , drop = FALSE]
  other_tags <- if ("other_tags" %in% names(x)) x$other_tags else rep(NA_character_, nrow(x))
  parking_tag <- extraire_tag_osm(other_tags, "parking")
  if ("parking" %in% names(x)) {
    existing_parking_tag <- as.character(x$parking)
    x$parking <- ifelse(
      !is.na(existing_parking_tag) & nzchar(existing_parking_tag),
      existing_parking_tag,
      parking_tag
    )
  } else {
    x$parking <- parking_tag
  }
  for (cle in c("capacity", "capacity:cars")) {
    extrait <- extraire_tag_osm(other_tags, cle)
    existant <- if (cle %in% names(x)) as.character(x[[cle]]) else rep(NA_character_, nrow(x))
    x[[cle]] <- ifelse(!is.na(existant) & nzchar(existant), existant, extrait)
  }
  if (!any(c("osm_id", "osm_way_id") %in% names(x))) {
    stop("OSM parkings : osm_id ou osm_way_id absent.", call. = FALSE)
  }
  # GDAL's OSM multipolygon driver puts relation identifiers in `osm_id` and
  # closed-way identifiers in `osm_way_id`.  Using osm_id alone collapses every
  # way with a missing relation id into one row (the real Bretagne extract has
  # 36,164 such parking ways).
  osm_id <- if ("osm_id" %in% names(x)) as.character(x$osm_id) else rep(NA_character_, nrow(x))
  way_id <- if ("osm_way_id" %in% names(x)) as.character(x$osm_way_id) else rep(NA_character_, nrow(x))
  identity <- ifelse(!is.na(osm_id) & nzchar(osm_id), osm_id, way_id)
  if (any(is.na(identity) | !nzchar(identity))) {
    stop("OSM parkings : un objet ne porte ni osm_id ni osm_way_id.", call. = FALSE)
  }
  x$osm_id <- identity
  x <- x[!duplicated(identity), , drop = FALSE]
  # The OSM multipolygon layer contains a small number of invalid relations
  # (usually duplicate edges between member ways).  Repair at ingestion, before
  # any area or commune attribution operation.  st_make_valid preserves the
  # polygonal area and can legitimately return POLYGON for a MULTIPOLYGON.
  x <- sf::st_make_valid(x)
  if (any(!sf::st_is_valid(x)))
    stop("OSM parkings : géométrie invalide après réparation.", call. = FALSE)
  # A malformed empty relation can be returned as a valid, empty
  # GEOMETRYCOLLECTION. It has no area to turn into places; remove it before
  # the calculator's polygon-only contract rather than failing the whole run.
  area_geometry <- sf::st_geometry_type(x) %in% c("POLYGON", "MULTIPOLYGON")
  x <- x[area_geometry, , drop = FALSE]
  x
}

lire_parkings_osm <- function(chemin_pbf) {
  x <- osmextract::oe_read(chemin_pbf, layer = "multipolygons", quiet = TRUE)
  normaliser_parkings_osm(x)
}

lire_bpe_b316 <- function(chemin) {
  if (basename(chemin) != "BPE25.parquet")
    stop("BPE 2025 : l'entrée doit être le fichier BPE25.parquet officiel.", call. = FALSE)
  brut <- nanoparquet::read_parquet(chemin)
  selectionner_bpe_b316_2025(brut)
}

# BPE25 is an equipment-row file: one retained B316 row is one station.  The
# file has no GEO_OBJECT column, so DEPCOM is the authoritative commune-grain
# key for the downloaded detail extract.  Coverage must be established before
# filtering B316: a commune represented by another equipment type is observed
# with zero stations-service, not unavailable.
selectionner_bpe_b316_2025 <- function(x) {
  requis <- c("DEPCOM", "TYPEQU")
  manquantes <- setdiff(requis, names(x))
  if (length(manquantes)) stop("BPE25 : colonne(s) manquante(s) : ",
                               paste(manquantes, collapse = ", "), ".", call. = FALSE)
  depcom <- as.character(x$DEPCOM)
  breton <- substr(depcom, 1, 2) %in% DEPT_BRETAGNE
  if (any(breton & !grepl("^[0-9]{5}$", depcom)))
    stop("BPE25 : code commune breton invalide.", call. = FALSE)
  type <- toupper(trimws(as.character(x$TYPEQU)))
  if (any(breton & (is.na(type) | !nzchar(type))))
    stop("BPE25 : TYPEQU ne doit pas être manquant pour une commune bretonne.", call. = FALSE)

  # In fixture/commune-grain inputs GEO_OBJECT is explicit.  The official
  # geolocalized BPE25 detail has no such column; there, every valid Breton
  # DEPCOM row is a commune-grain observation.
  commune <- breton
  if ("GEO_OBJECT" %in% names(x))
    commune <- commune & toupper(trimws(as.character(x$GEO_OBJECT))) == "COM"
  couverture <- unique(depcom[commune])
  y <- x[commune & type == "B316", , drop = FALSE]
  if (!nrow(y)) stop("BPE25 : aucune observation communale B316 pour 2025.", call. = FALSE)
  # Keep one row per equipment (the BPE detail grain), and add one explicit
  # zero row only for covered communes with no B316 equipment.  The next seam
  # aggregates these rows into the canonical commune count.
  b316_communes <- unique(as.character(y$DEPCOM))
  zeros <- setdiff(couverture, b316_communes)
  y <- dplyr::bind_rows(
    tibble::tibble(GEO = zeros, FACILITIES = "B316", NB_EQUIP = 0),
    tibble::tibble(GEO = as.character(y$DEPCOM), FACILITIES = "B316", NB_EQUIP = 1)
  )
  verifier_contenu_bpe_b316(y)
  y
}

verifier_contenu_bpe_b316 <- function(x) {
  attendues <- c("GEO", "FACILITIES", "NB_EQUIP")
  if (!is.data.frame(x) || !all(attendues %in% names(x)) || nrow(x) == 0L)
    stop("BPE B316 : la table doit contenir des lignes GEO/FACILITIES/NB_EQUIP.", call. = FALSE)
  geo <- as.character(x$GEO)
  type <- toupper(trimws(as.character(x$FACILITIES)))
  valeur <- suppressWarnings(as.numeric(x$NB_EQUIP))
  # COG commune codes include Corsica's 2A/2B form; they are valid source
  # identities even though they are outside the Breton extraction.
  valide_code <- grepl("^[0-9]{5}$|^2[AB][0-9]{3}$", geo)
  valide_geo <- valide_code & substr(geo, 1, 2) %in% DEPT_BRETAGNE
  b316 <- type %in% c("B316", "316", "STATION-SERVICE", "STATION SERVICE")
  if (any(is.na(type) | !nzchar(type)))
    stop("BPE B316 : FACILITIES ne doit pas être manquant.", call. = FALSE)
  if (any(b316 & !valide_code))
    stop("BPE B316 : code commune invalide pour B316.", call. = FALSE)
  if (!any(b316 & valide_geo))
    stop("BPE B316 : aucune ligne B316 utilisable.", call. = FALSE)
  if (any(b316 & (is.na(valeur) | valeur < 0)))
    stop("BPE B316 : GEO breton et NB_EQUIP numérique non négatif requis pour B316.", call. = FALSE)
  invisible(TRUE)
}

# BPE B316 is a FACILITIES count.  The only accepted normalized shape is the
# canonical GEO/FACILITIES/NB_EQUIP contract; legacy MELODI aliases are not
# interchangeable with the geolocalized BPE25 detail file.
normaliser_bpe_b316 <- function(x) {
  if (all(c("DEPCOM", "TYPEQU") %in% names(x)))
    x <- selectionner_bpe_b316_2025(x)
  requis <- c("GEO", "FACILITIES", "NB_EQUIP")
  if (!all(requis %in% names(x)))
    stop("BPE B316 : GEO/FACILITIES/NB_EQUIP requis.", call. = FALSE)
  verifier_contenu_bpe_b316(x)
  # A canonical table can contain several equipment types.  BPE B316 is a
  # filtered view, so other types must not inflate the station-service count.
  type <- toupper(trimws(as.character(x$FACILITIES)))
  x <- x[type %in% c("B316", "316", "STATION-SERVICE", "STATION SERVICE"), , drop = FALSE]
  tibble::as_tibble(x) %>%
    dplyr::transmute(commune = as.character(GEO), fuel = as.numeric(NB_EQUIP)) %>%
    dplyr::group_by(commune) %>%
    dplyr::summarise(fuel = sum(fuel), .groups = "drop") %>%
    dplyr::arrange(commune)
}

# lire_amenagements_cyclables ----------------------------------------------------
# Le lecteur du jeu Geovelo « Aménagements cyclables » (issue #222, ticket
# #229) : le snapshot parquet mensuel du cache, via nanoparquet — les 28
# colonnes du fichier (la forme vérifiée : id_local, id_osm, code_com_d/g,
# ame_d/g, sens_d/g, …, geometry). La colonne geometry est un blob WKB (la
# lecture nanoparquet — vérifiée sur le fichier réel : 412 681 lignes, blob de
# 361 octets pour la première ligne) : elle est décodée en sfc et le CRS
# EPSG:4326 est estampillé depuis les MÉTADONNÉES du fichier (le WKB ne porte
# pas le CRS — vérifié sur le fichier réel, research note §2b). Non testé dans
# la boucle (la convention du pipeline — comme lire_lignes_osm).
lire_amenagements_cyclables <- function(chemin) {
  brut <- nanoparquet::read_parquet(chemin)
  geoms <- sf::st_as_sfc(brut$geometry)
  sf::st_crs(geoms) <- 4326
  brut$geometry <- NULL
  sf::st_sf(brut, geometry = geoms)
}

# normaliser_amenagements_cyclables -----------------------------------------------
# La normalisation PURE du snapshot Geovelo : le sf brut vers la table de
# calcul du mode `b` de `reseaux` (issue #222, ticket #229) :
#   1. les colonnes REQUISES (ame_d, ame_g, code_com_d, code_com_g, geometry)
#      — une colonne manquante nomme le champ fautif ; un fichier vide est une
#      corruption (le snapshot cassé du 01/08/2026 était un FeatureCollection
#      vide) ;
#   2. le filtre Bretagne : code_com_d ∈ 22/29/35/56, UN côté (ADR-0016) — les
#      segments dont un côté est breton appartiennent au réseau breton ;
#   3. le mapping COG 2022 → 2025 via passage_cog (le jeu joint sur des codes
#      COG 2022, le squelette de l'app est au COG 2025) — un code non mappé
#      (absent des deux côtés de la table de passage) est une erreur dure,
#      jamais une NA silencieuse. `mappe` est la table de passage (la sortie
#      de construire_passage_cog, #227) — fournie par l'orchestrateur qui la
#      lit depuis le fichier INSEE du cache.
# Sortie : la table de calcul sf, bretonne, aux clés COG 2025, triée par
# id_local — déterministe.
normaliser_amenagements_cyclables <- function(brut, mappe) {
  requises <- c("ame_d", "ame_g", "code_com_d", "code_com_g", "geometry")
  manquantes <- setdiff(requises, names(brut))
  if (length(manquantes) > 0) {
    stop("Aménagements cyclables corrompus — colonne(s) requise(s) manquante(s) : ",
         paste(manquantes, collapse = ", "), ".", call. = FALSE)
  }
  if (nrow(brut) == 0) {
    stop("Aménagements cyclables corrompus — le snapshot ne porte aucune ligne.",
         call. = FALSE)
  }

  bretagne <- brut[grepl("^(22|29|35|56)", as.character(brut$code_com_d)), ]

  # le mapping COG 2022 → 2025 (passage_cog, #227) — STRICT pour les codes
  # bretons (un code breton non mappé = une corruption de la donnée, jamais une
  # NA silencieuse), LENIENT pour l'autre côté : le côté non-breton (ex. 44006 —
  # un segment de frontière 22/44, vérifié : 1 ligne sur le fichier réel) n'est
  # jamais une clé de territoire, il ne sert qu'à la règle d'attribution par le
  # côté porteur (ADR-0016) — il traverse tel quel. Le côté breton est toujours
  # présent (le filtre), c'est lui qui porte la clé.
  bretagne$code_com_d <- passage_cog(bretagne$code_com_d, mappe)
  bretagne$code_com_g <- passage_cog_lenient(bretagne$code_com_g, mappe)

  # dplyr::arrange sur un sf dégrade la classe (retourne un tbl_df) — le sf
  # est restauré après le tri, CRS conservé (le WKB est estampillé 4326 par le
  # lecteur)
  trie <- bretagne %>%
    dplyr::arrange(id_local)
  sf::st_sf(trie)
}
