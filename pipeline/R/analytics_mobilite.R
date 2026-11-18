# analytics_mobilite -----------------------------------------------------------
# Les builders PURS du sous-bloc « L'offre de mobilité alternative » et de la
# figure « L'offre cyclable » du thème Mobilité : l'offre TC (la vraie part des
# ADRESSES résidentielles à 500 m d'un arrêt GTFS — le spine AEDAR, décision
# 2026-11-18), les bornes de recharge, le stationnement vélo/voiture, les
# densités de ravitaillement et la figure cyclable, agrégés aux quatre niveaux.
# La chaîne analytique du snapshot porté (accessibilité vingt minutes) a été
# retirée (issue #1048) avec ses vocabulaires `share_*` / `iso_*` : aucune
# constante de la grille d'accès ne vit plus ici. Les directions de rang
# encore présentes dans DIRECTIONS_MOBILITE ne le sont que pour la parité du
# catalogue épinglé, jusqu'au slice 2 (#1048).

# DISTANCE_ARRET_M / CRS_OFFRE_MOBILITE ----------------------------------------
# La DÉCISION DE BUILD verrouillée de l'offre TC (l'item 🔶 du contrat,
# docs/themes/mobilite.md §Open items, documentée dans le manifeste et la
# Méthodes) : la distance « près d'un arrêt » = 500 m à vol d'oiseau
# (straight-line) — le rayon classique « 10 minutes à pied » de l'offre TC (la
# famille du PTAL britannique, du « stop coverage »). La part est la VRAIE
# fraction des adresses résidentielles de la commune à moins de cette distance
# d'un arrêt GTFS (le proxy de superficie communale a été rejeté). Le rayon est
# UNE constante verrouillée, testée. La projection du calcul spatial :
# EPSG:2154 (Lambert-93) — la projection nationale française, adaptée à la
# Bretagne entière, les distances en mètres (le buffer de 500 m y est un vrai
# 500 m). Les arrêts sont en WGS84 (EPSG:4326) et reprojetés au calcul ; le
# spine d'adresses est reprojeté de WGS84 vers 2154 par le normaliseur.
DISTANCE_ARRET_M <- 500
CRS_OFFRE_MOBILITE <- 2154

# calculer_part_proches_arret_communes -----------------------------------------
# L'offre TC COMMUNALE — la VRAIE part des adresses résidentielles près d'un
# arrêt (décision 2026-11-18, issue #1048) : pour chaque commune, la fraction
# de SES adresses (le spine AEDAR : un point par adresse, reprojeté EPSG:2154,
# portant code_commune_insee) à moins de `distance` mètres à vol d'oiseau d'un
# arrêt GTFS (stops.txt Korrigo, WGS84). La mécanique spatiale (sf) : les arrêts
# sont reprojetés en Lambert-93 (CRS_OFFRE_MOBILITE, les distances en mètres),
# tamponnés à `distance`, et les adresses sont intersectées avec les tampons —
# l'INDEX SPATIAL de GEOS (st_intersects), jamais une matrice de distances
# complète (le principe du manifeste). Chaque adresse est « proche » si son
# point tombe dans au moins un tampon ; la part communale est
# n_proches ÷ n_adresses. La géométrie sphérique (s2) est désactivée pour le
# calcul planaire et restaurée après (on.exit) — le calcul ne laisse aucune
# trace d'état global. Sortie : {commune, n_adresses, n_proches, part_proche},
# triée par commune — déterministe (GEOS, même entrée → même sortie).
# Seules les communes à adresses figurent (une commune sans adresse du spine
# n'a pas de part, un fait de la source).
calculer_part_proches_arret_communes <- function(stops, adresses,
                                                 distance = DISTANCE_ARRET_M) {
  if (!all(c("stop_lat", "stop_lon") %in% names(stops))) {
    stop("calculer_part_proches_arret_communes : le tableau des arrêts doit ",
         "porter stop_lat et stop_lon.", call. = FALSE)
  }
  if (!inherits(adresses, "sf") || !"code_commune_insee" %in% names(adresses)) {
    stop("calculer_part_proches_arret_communes : la couche d'adresses doit être ",
         "un sf portant code_commune_insee.", call. = FALSE)
  }

  ancien_s2 <- sf::sf_use_s2(FALSE)
  on.exit(sf::sf_use_s2(ancien_s2), add = TRUE)

  points_arrets <- sf::st_sfc(
    lapply(seq_len(nrow(stops)), function(i) {
      sf::st_point(c(stops$stop_lon[i], stops$stop_lat[i]))
    }),
    crs = 4326
  )
  arrets_proj <- sf::st_transform(points_arrets, CRS_OFFRE_MOBILITE)
  tampons <- sf::st_buffer(arrets_proj, distance)

  proches <- lengths(sf::st_intersects(adresses, tampons)) > 0
  adresses$proche <- proches

  sf::st_drop_geometry(adresses) %>%
    dplyr::group_by(commune = code_commune_insee) %>%
    dplyr::summarise(
      n_adresses = dplyr::n(),
      n_proches = sum(proche),
      .groups = "drop"
    ) %>%
    dplyr::mutate(part_proche = n_proches / n_adresses) %>%
    dplyr::arrange(commune)
}

# Capacity is calibration data, not a production count. Production estimates
# use polygon area divided by a factor derived from parent polygons carrying a
# plausible positive capacity; these defaults cover types without enough
# calibration observations.
FACTEUR_PLACE_VOITURE_M2 <- c(surface = 25, street_side = 11.5, lane = 25)
CAPACITE_CALIBRATION_MIN_OBSERVATIONS <- 5L
CAPACITE_RATIO_PLAUSIBLE_M2_MIN <- 8
CAPACITE_RATIO_PLAUSIBLE_M2_MAX <- 60

valeur_tag_stationnement <- function(x, cle) {
  direct <- if (cle %in% names(x)) as.character(x[[cle]]) else rep(NA_character_, nrow(x))
  other_tags <- if ("other_tags" %in% names(x)) x$other_tags else rep(NA_character_, nrow(x))
  extrait <- extraire_tag_osm(other_tags, cle)
  ifelse(!is.na(direct) & nzchar(direct), direct, extrait)
}

type_stationnement_voiture <- function(parkings) {
  type <- tolower(trimws(valeur_tag_stationnement(parkings, "parking")))
  type[is.na(type) | !nzchar(type)] <- "surface"
  type
}

calibrer_facteurs_stationnement <- function(parkings, aire_m2, type) {
  facteurs <- FACTEUR_PLACE_VOITURE_M2
  capacite <- suppressWarnings(as.numeric(valeur_tag_stationnement(parkings, "capacity")))
  capacite_cars <- suppressWarnings(as.numeric(valeur_tag_stationnement(parkings, "capacity:cars")))
  capacite <- ifelse(!is.na(capacite) & capacite > 0, capacite, capacite_cars)
  ratio <- aire_m2 / capacite
  utilisables <- is.finite(aire_m2) & aire_m2 > 0 & is.finite(capacite) & capacite > 0 &
    is.finite(ratio) & ratio >= CAPACITE_RATIO_PLAUSIBLE_M2_MIN &
    ratio <= CAPACITE_RATIO_PLAUSIBLE_M2_MAX
  for (kind in unique(type[utilisables])) {
    lignes <- utilisables & type == kind
    if (sum(lignes) >= CAPACITE_CALIBRATION_MIN_OBSERVATIONS)
      facteurs[[kind]] <- sum(aire_m2[lignes]) / sum(capacite[lignes])
  }
  facteurs
}

compter_cotes_stationnement <- function(ligne, colonnes) {
  valeurs <- tolower(trimws(as.character(ligne)))
  actifs <- !is.na(valeurs) & nzchar(valeurs) &
    !valeurs %in% c("no", "no_parking", "no_stopping", "separate", "none", "0")
  if (any(actifs & (grepl("both$", colonnes) | valeurs == "both"))) return(2)
  gauche <- any(actifs & grepl("(left|_left)$", colonnes))
  droite <- any(actifs & grepl("(right|_right)$", colonnes))
  as.numeric(gauche) + as.numeric(droite)
}

compter_cotes_stationnement_vecteur <- function(lignes, colonnes) {
  n <- nrow(lignes)
  if (length(colonnes) == 0) return(rep(0, n))

  gauche <- droite <- both <- rep(FALSE, n)
  for (colonne in colonnes) {
    valeurs <- tolower(trimws(as.character(lignes[[colonne]])))
    actifs <- !is.na(valeurs) & nzchar(valeurs) &
      !valeurs %in% c("no", "no_parking", "no_stopping", "separate", "none", "0")
    both <- both | (actifs & (grepl("both$", colonne) | valeurs == "both"))
    gauche <- gauche | (actifs & grepl("(left|_left)$", colonne))
    droite <- droite | (actifs & grepl("(right|_right)$", colonne))
  }

  ifelse(both, 2, as.numeric(gauche) + as.numeric(droite))
}

# Empirical decision recorded by the contract: publish the count ratio
# (places vélo / places voiture), not the discarded area proxy.
RATIO_STATIONNEMENT_VELO_DECISION <- "places_velo_par_places_voiture"
# calculer_stationnement_voiture_communes ---------------------------------------
# Les surfaces OSM sont converties en places estimées avec des facteurs calibrés
# sur les capacités déclarées, sans ajouter ces capacités directement. Les objets
# fermés sont dédupliqués par osm_id (ways/relations compris). Les lignes
# contribuent par leurs côtés parking explicitement tagués, mais leur portion
# couverte par un parking parent est retirée pour éviter le double-compte.
calculer_stationnement_voiture_communes <- function(parkings, lignes, limites) {
  if (!inherits(parkings, "sf") || !inherits(lignes, "sf") || !inherits(limites, "sf"))
    stop("Stationnement voiture : parkings, lignes et limites doivent être sf.", call. = FALSE)
  if (any(!sf::st_geometry_type(parkings) %in% c("POLYGON", "MULTIPOLYGON")))
    stop("Stationnement voiture : seuls les ways fermés et relations sont acceptés.", call. = FALSE)
  if (!"code_insee" %in% names(limites)) stop("Stationnement voiture : limites sans code_insee.", call. = FALSE)
  limites <- sf::st_transform(limites, CRS_OFFRE_MOBILITE) %>% sf::st_make_valid()
  if (!"osm_id" %in% names(parkings)) parkings$osm_id <- seq_len(nrow(parkings))
  parkings <- parkings[!duplicated(parkings$osm_id), ]
  parkings <- sf::st_transform(parkings, sf::st_crs(limites))
  parkings$type_stationnement <- type_stationnement_voiture(parkings)
  parkings$aire_m2 <- as.numeric(sf::st_area(parkings))
  facteurs <- calibrer_facteurs_stationnement(
    parkings, parkings$aire_m2, parkings$type_stationnement
  )
  # Attribute once, at the representative point: a large polygon crossing a
  # commune boundary must not be counted once per intersected commune.
  points <- sf::st_point_on_surface(parkings)
  pol <- sf::st_join(points, limites["code_insee"], left = FALSE)
  places_factor <- facteurs[pol$type_stationnement]
  places_factor[is.na(places_factor)] <- facteurs[["surface"]]
  areas <- tibble::tibble(commune = pol$code_insee,
                          places = pol$aire_m2 / as.numeric(places_factor))
  lignes <- lignes[!is.na(lignes$highway) & nzchar(as.character(lignes$highway)), ]
  lane_cols <- grep("^(parking:lane:(left|right|both)|parking:(left|right|both)|parking_lane_(left|right|both))$",
                    names(lignes), value = TRUE)
  linear <- tibble::tibble(commune = character(), places = numeric())
  if (length(lane_cols) > 0) {
    lane_counts <- compter_cotes_stationnement_vecteur(lignes, lane_cols)
    tagged <- which(lane_counts > 0)
    if (length(tagged) > 0) {
      ln <- sf::st_transform(lignes[tagged, , drop = FALSE], sf::st_crs(limites))
      ln$lane_count <- lane_counts[tagged]
      ln$line_length_m <- as.numeric(sf::st_length(ln))
      if (nrow(parkings) > 0) {
        # Restrict the union to polygons that can actually intersect a tagged
        # line. Unioning the whole Bretagne parking layer is needlessly costly
        # and can make a read-only metric calculation look like a failed run.
        candidates <- unique(unlist(sf::st_intersects(ln, parkings)))
        if (length(candidates) > 0) {
          parking_union <- sf::st_union(
            sf::st_make_valid(sf::st_geometry(parkings)[candidates])
          )
          ln$line_id <- seq_len(nrow(ln))
          # line_id is constant for each source line by construction; sf's
          # generic attribute warning is therefore expected for this split.
          overlaps <- suppressWarnings(
            sf::st_intersection(ln["line_id"], parking_union)
          )
          overlap_lengths <- sf::st_drop_geometry(overlaps) %>%
            dplyr::mutate(overlap_m = as.numeric(sf::st_length(overlaps))) %>%
            dplyr::group_by(line_id) %>%
            dplyr::summarise(overlap_m = sum(overlap_m), .groups = "drop")
          ln <- ln %>%
            dplyr::left_join(overlap_lengths, by = "line_id") %>%
            dplyr::mutate(
              line_length_m = pmax(line_length_m - dplyr::coalesce(overlap_m, 0), 0)
            )
        }
      }
      ln <- ln[ln$line_length_m > 0, , drop = FALSE]
      if (nrow(ln) > 0) {
        line_points <- sf::st_sf(
          lane_count = ln$lane_count,
          line_length_m = ln$line_length_m,
          geometry = sf::st_centroid(sf::st_geometry(ln)),
          crs = sf::st_crs(limites)
        )
        line_points <- sf::st_join(line_points, limites["code_insee"], left = FALSE)
        linear <- tibble::tibble(
          commune = line_points$code_insee,
          places = line_points$line_length_m * (line_points$lane_count * 2.3) / 11.5
        )
      }
    }
  }
  dplyr::bind_rows(areas, linear) %>% dplyr::group_by(commune) %>%
    dplyr::summarise(places_voiture = sum(places), .groups = "drop") %>%
    dplyr::arrange(commune)
}

agreger_stationnement_voiture_territoires <- function(voiture_communes,
                                                       velo_communes, base_epci) {
  ref <- base_epci[c("CODGEO", "EPCI", "DEP")]
  ctx <- tibble::tibble(commune = sort(unique(as.character(ref$CODGEO)))) %>%
    dplyr::left_join(voiture_communes, by = "commune") %>%
    dplyr::mutate(places_voiture = dplyr::coalesce(places_voiture, 0)) %>%
    dplyr::left_join(velo_communes[c("commune", "population")], by = "commune") %>%
    dplyr::left_join(ref, by = c("commune" = "CODGEO"))
  calc <- function(g) {
    x <- ctx
    dplyr::bind_rows(
      x %>% dplyr::transmute(code = commune, places = places_voiture,
                              population = population),
      x %>% dplyr::filter(!is.na(EPCI)) %>% dplyr::group_by(code = EPCI) %>%
        dplyr::summarise(places = sum(places_voiture), population = sum(population), .groups = "drop"),
      x %>% dplyr::group_by(code = DEP) %>% dplyr::summarise(places = sum(places_voiture), population = sum(population), .groups = "drop"),
      x %>% dplyr::summarise(code = "53", places = sum(places_voiture), population = sum(population))
    )
  }
  # Decision recorded in the contract: compare counts, not area proxies.  The
  # ratio below is the only candidate published (the rejected area candidate
  # must not survive as an unowned computation).
  out <- calc("EPCI") %>% dplyr::mutate(value = places / population * 1000,
                                        key = "places_stationnement_voiture_1000") %>%
    dplyr::select(code, key, value)
  # The readable ratio is places vélo / places voiture.  Aggregate its two
  # counts before dividing; never average commune ratios.
  ratio_ctx <- tibble::tibble(commune = sort(unique(as.character(ref$CODGEO)))) %>%
    dplyr::left_join(velo_communes %>% dplyr::select(commune, places_velo = places), by = "commune") %>%
    dplyr::left_join(voiture_communes %>% dplyr::select(commune, places_voiture), by = "commune") %>%
    dplyr::mutate(places_voiture = dplyr::coalesce(places_voiture, 0)) %>%
    dplyr::left_join(ref, by = c("commune" = "CODGEO"))
  ratio_agg <- function(group = NULL) {
    x <- ratio_ctx
    if (!is.null(group)) x <- x %>% dplyr::filter(!is.na(.data[[group]]))
    if (is.null(group)) {
      x %>% dplyr::summarise(code = "53", pv = sum(places_velo), pc = sum(places_voiture))
    } else {
      x %>% dplyr::group_by(code = .data[[group]]) %>%
        dplyr::summarise(pv = sum(places_velo), pc = sum(places_voiture), .groups = "drop")
    }
  }
  ratio <- dplyr::bind_rows(
    ratio_ctx %>% dplyr::transmute(code = commune, pv = places_velo, pc = places_voiture),
    ratio_agg("EPCI"), ratio_agg("DEP"), ratio_agg()
  ) %>% dplyr::transmute(code, key = "stationnement_velo_par_voiture",
                         detail = NA_character_, value = dplyr::if_else(pc > 0, pv / pc, NA_real_))
  dplyr::bind_rows(out, ratio)
}

calculer_ratios_mobilite <- function(bornes, fuel, velo, voiture) {
  # fuel is a count table; callers must not pass a table already joined to it.
  x <- bornes %>% dplyr::full_join(fuel, by = "code") %>%
    dplyr::full_join(velo, by = "code") %>% dplyr::full_join(voiture, by = "code") %>%
    dplyr::mutate(
      bornes_ev_par_station_service = dplyr::if_else(!is.na(fuel) & fuel > 0, bornes / fuel, NA_real_),
      rider = dplyr::case_when(is.na(fuel) ~ "Donnée stations-service indisponible",
        fuel > 0 ~ NA_character_, bornes > 0 ~
        "Aucune station-service sur le territoire", TRUE ~ "Aucune borne ni station-service")
      )
    x
}

calculer_fuel_communes <- function(fuel) {
  if (!all(c("commune", "fuel") %in% names(fuel)))
    stop("BPE B316 normalisée : commune et fuel requis.", call. = FALSE)
  fuel %>% dplyr::transmute(code = commune, fuel = fuel)
}

# calculer_bornes_communes ------------------------------------------------------
# Les bornes de recharge COMMUNALES : le nombre de STATIONS IRVE distinctes
# (id_station_itinerance) par commune — « bornes » = stations, jamais les
# points de charge (une station porte plusieurs prises). Deux caveats SOURCE
# (documentés dans le manifeste et la Méthodes) appliqués ici : les stations
# sans code commune (les lignes mal géolocalisées du fichier) n'entrent dans
# aucun comptage, et le champ code_insee_commune du fichier consolidé porte
# des valeurs HORS référentiel (des codes postaux comme 22100, des codes
# départementaux comme 22000, « 99999 », des communes hors Bretagne) — seules
# les communes du RÉFÉRENTIEL partagé (base_epci : CODGEO) sont comptées, le
# reste tombe. Une commune sans station n'a pas de ligne ici (le zéro est
# porté par l'agrégation). Trié par commune — déterministe.
calculer_bornes_communes <- function(bornes, base_epci) {
  communes_valides <- sort(unique(as.character(base_epci$CODGEO)))
  bornes %>%
    dplyr::filter(!is.na(code_insee_commune),
                  code_insee_commune %in% communes_valides) %>%
    dplyr::distinct(code_insee_commune, id_station_itinerance) %>%
    dplyr::count(code_insee_commune, name = "nb_bornes") %>%
    dplyr::rename(commune = code_insee_commune) %>%
    dplyr::arrange(commune)
}

# calculer_stationnement_velo_communes ------------------------------------------
# Le stationnement vélo COMMUNAL : les places / 1 000 hab du hub Ecolab, PRIS
# TEL QUEL (décision 2026-08-04) — la valeur du millésime le PLUS RÉCENT par
# commune (le hub est annuel, 2022-2025 ; la table normalisée porte une ligne
# par commune × millésime avec les places, la population et le taux). La
# table porte places + population en plus du taux : l'agrégation des niveaux
# recompose Σ places ÷ Σ population × 1 000 (jamais la moyenne des taux).
# Trié par commune — déterministe.
calculer_stationnement_velo_communes <- function(velo) {
  velo %>%
    dplyr::group_by(geocode_commune) %>%
    dplyr::slice_max(annee, with_ties = FALSE) %>%
    dplyr::ungroup() %>%
    dplyr::rename(commune = geocode_commune) %>%
    dplyr::select(commune, annee, places, population, places_1000) %>%
    dplyr::arrange(commune)
}

# agreger_ravitaillement_territoires --------------------------------------------
# Le bloc de ravitaillement (issue #953) ISOLÉ de l'agrégation d'offre : le
# compte des bornes IRVE et son taux / 1 000 hab, le compte B316 des
# stations-service et son taux, et leur ratio bornes / station. C'est le seam
# PARTAGÉ entre la génération
# complète du thème Mobilité (agreger_offre_territoires) et la matérialisation
# scalaire ciblée (#989) : les deux chemins exécutent CE code — une seule
# arithmétique, jamais une seconde implémentation à maintenir en parallèle.
#
# Les règles sont celles du bloc historique, inchangées :
#   - `bornes` : la SOMME des stations distinctes par commune, avec le ZÉRO
#     porté par toute commune du référentiel partagé (base_epci) ;
#   - les taux : Σ compte ÷ Σ population × 1 000, RECOMPOSÉS depuis les
#     parties à chaque niveau (jamais une moyenne de taux communaux). La
#     population du dénominateur est celle du hub stationnement vélo ;
#   - BPE absente : NA propagé (jamais un zéro inventé) ; le zéro OBSERVÉ
#     d'une commune sans station reste un fait ;
#   - les communes sans EPCI (les îles) n'agrègent à aucun niveau EPCI.
#
# Une entrée `fuel_communes` NULL (aucune source BPE déclarée) ne produit
# aucune ligne stations-service : `$stations` vaut NULL, jamais un NA inventé.
agreger_ravitaillement_territoires <- function(bornes_communes, velo_communes,
                                                fuel_communes, ref) {
  communes_univers <- sort(unique(as.character(ref$CODGEO)))
  ctx_b <- tibble::tibble(
    commune = communes_univers,
    nb_bornes = 0L
  ) %>%
    dplyr::rows_update(
      bornes_communes %>% dplyr::mutate(nb_bornes = as.integer(nb_bornes)),
      by = "commune"
    ) %>%
    dplyr::rename(value = nb_bornes) %>%
    dplyr::left_join(ref, by = c("commune" = "CODGEO")) %>%
    # la population du dénominateur des taux / 1 000 hab est celle du hub
    # stationnement vélo — le même dénominateur que les densités de parking
    dplyr::left_join(velo_communes[c("commune", "population")],
                     by = "commune")
  bornes <- dplyr::bind_rows(
    ctx_b %>% dplyr::transmute(code = commune, value),
    ctx_b %>% dplyr::filter(!is.na(EPCI)) %>%
      dplyr::group_by(code = EPCI) %>%
      dplyr::summarise(value = sum(value), .groups = "drop"),
    ctx_b %>% dplyr::group_by(code = DEP) %>%
      dplyr::summarise(value = sum(value), .groups = "drop"),
    ctx_b %>% dplyr::summarise(code = "53", value = sum(value),
                               .groups = "drop")
  ) %>%
    dplyr::mutate(key = "bornes_recharge", detail = NA_character_)
  bornes_1000 <- dplyr::bind_rows(
    ctx_b %>% dplyr::transmute(code = commune,
                               value = value / population * 1000),
    ctx_b %>% dplyr::filter(!is.na(EPCI)) %>%
      dplyr::group_by(code = EPCI) %>%
      dplyr::summarise(value = sum(value) / sum(population) * 1000,
                       .groups = "drop"),
    ctx_b %>% dplyr::group_by(code = DEP) %>%
      dplyr::summarise(value = sum(value) / sum(population) * 1000,
                       .groups = "drop"),
    ctx_b %>% dplyr::summarise(
      code = "53",
      value = sum(value) / sum(population) * 1000,
      .groups = "drop")
  ) %>%
    dplyr::mutate(key = "bornes_recharge_1000", detail = NA_character_)

  stations <- NULL
  ratio <- NULL
  if (!is.null(fuel_communes)) {
    ctx_r <- ctx_b %>%
      dplyr::left_join(
        fuel_communes %>% dplyr::rename(fuel_value = fuel),
        by = c("commune" = "code")
      )
    agreger_compte <- function(g) {
      ctx_r %>% dplyr::filter(!is.na(.data[[g]])) %>%
        dplyr::group_by(code = .data[[g]]) %>% dplyr::summarise(
          population = sum(population),
          # A missing BPE observation means unavailable, not zero. A group is
          # unavailable when any of its members is unavailable.
          fuel = if (anyNA(fuel_value)) NA_real_ else sum(fuel_value),
          .groups = "drop")
    }
    stations_ctx <- dplyr::bind_rows(
      ctx_r %>% dplyr::transmute(code = commune, stations = fuel_value,
                                 population = population),
      agreger_compte("EPCI") %>% dplyr::transmute(code, stations = fuel,
                                                  population = population),
      agreger_compte("DEP") %>% dplyr::transmute(code, stations = fuel,
                                                 population = population),
      ctx_r %>% dplyr::summarise(
        code = "53",
        stations = if (anyNA(fuel_value)) NA_real_ else sum(fuel_value),
        population = sum(population))
    )
    stations <- dplyr::bind_rows(
      stations_ctx %>%
        dplyr::transmute(code, key = "stations_service",
                         detail = NA_character_, value = stations),
      stations_ctx %>%
        dplyr::transmute(code, key = "stations_service_1000",
                         detail = NA_character_,
                          value = stations / population * 1000)
    )
    # Same owner rule as the complete offer: divide aggregated counts, never
    # average commune ratios; absent BPE and a zero denominator stay unavailable.
    ratio <- calculer_ratios_mobilite(
      bornes %>% dplyr::transmute(code, bornes = value),
      stations_ctx %>% dplyr::transmute(code, fuel = stations),
      tibble::tibble(code = bornes$code, places_velo = NA_real_),
      tibble::tibble(code = bornes$code, places_voiture = NA_real_)) %>%
      dplyr::transmute(code, key = "bornes_ev_par_station_service",
                       detail = NA_character_,
                       value = bornes_ev_par_station_service, rider)
  }
  list(bornes = bornes, bornes_1000 = bornes_1000, stations = stations,
       ratio = ratio)
}

# agreger_offre_territoires -----------------------------------------------------
# Le sous-bloc aux QUATRE niveaux de territoire (commune / EPCI / département /
# région), chaque indicateur agrégé par SA règle (CONTEXT.md « Taille » — un
# agrégat est RECALCULÉ depuis les parties, jamais une moyenne de valeurs) :
#   - offre_tc (une part) : la moyenne pondérée par les ADRESSES du spine
#     — Σ (part × n_adresses) ÷ Σ n_adresses, le dénominateur même de la
#     part (le poids EST le nombre d'adresses qui fonde la part, jamais un
#     poids étranger). Les communes sans adresse n'ont pas de part — elles
#     n'entrent dans aucun agrégat ;
#   - bornes_recharge (un compte) : la SOMME des stations communales, avec le
#     ZÉRO porté par toute commune du référentiel sans station (une commune
#     sans borne a 0 borne — un fait, jamais un NA) ;
#   - places_stationnement_velo_1000 (un taux) : Σ places ÷ Σ population
#     × 1 000 — recomposé depuis les parties, jamais la moyenne des taux ;
#   - les densités de ravitaillement (#953) : stations_service (un compte)
#     SOMMÉ, stations_service_1000 et bornes_recharge_1000 (des taux)
#     RECOMPOSÉS depuis les comptes et la population du hub — le zéro observé
#     reste un fait, une observation BPE absente propage NA ;
#   - offre_cyclable (issue #231, la figure « L'offre cyclable ») : une clé
#     MULTI-MESURE (5 détails) — les longueurs protégé/partagé/total SOMMÉES,
#     les km/1 000 hab RECOMPOSÉS depuis les parties (Σ km ÷ Σ population
#     × 1 000, jamais la moyenne des taux communaux), le ZÉRO porté par toute
#     commune sans aménagement (un fait, jamais un NA — la même règle que les
#     bornes).
# Sortie longue (code × key × detail × value), une ligne par (territoire ×
# clé × détail), triée par code puis clé puis détail — déterministe. Depuis
# l'issue #231, la sortie porte une colonne `detail` : NA pour les clés
# scalaires du sous-bloc (offre_tc / bornes_recharge /
# places_stationnement_velo_1000), le nom de la mesure pour offre_cyclable —
# la forme longue du contrat, la même que les autres clés multi-mesures du
# payload. Les communes sans EPCI (les îles) n'agrègent à AUCUN niveau EPCI
# (la règle du fix « Sans objet » #131).
agreger_offre_territoires <- function(offre_tc_communes, bornes_communes,
                                       velo_communes, base_epci,
                                       offre_cyclable_communes = NULL,
                                       stationnement_voiture_communes = NULL,
                                       fuel_communes = NULL) {
  ref <- base_epci[c("CODGEO", "EPCI", "DEP")]

  # offre_tc : la moyenne pondérée par les adresses du spine (le
  # dénominateur de la part) — jamais la moyenne des parts communales
  ctx_tc <- offre_tc_communes %>%
    dplyr::left_join(ref, by = c("commune" = "CODGEO"))
  offre_tc <- dplyr::bind_rows(
    ctx_tc %>% dplyr::transmute(code = commune, value = part_proche),
    ctx_tc %>% dplyr::filter(!is.na(EPCI)) %>%
      dplyr::group_by(code = EPCI) %>%
      dplyr::summarise(value = sum(part_proche * n_adresses) / sum(n_adresses),
                       .groups = "drop"),
    ctx_tc %>% dplyr::group_by(code = DEP) %>%
      dplyr::summarise(value = sum(part_proche * n_adresses) / sum(n_adresses),
                       .groups = "drop"),
    ctx_tc %>% dplyr::summarise(
      code = "53",
      value = sum(part_proche * n_adresses) / sum(n_adresses),
      .groups = "drop")
  ) %>%
    dplyr::mutate(key = "offre_tc", detail = NA_character_)

  # le bloc ravitaillement (issue #953) : le compte de bornes IRVE et son taux,
  # le compte B316 des stations-service et son taux. Il vit dans SA fonction
  # partagée avec la matérialisation scalaire ciblée (#989) — les deux chemins
  # exécutent le MÊME code, jamais deux arithmétiques qui pourraient diverger.
  ravitaillement <- agreger_ravitaillement_territoires(
    bornes_communes, velo_communes, fuel_communes, ref)
  bornes <- ravitaillement$bornes
  bornes_1000 <- ravitaillement$bornes_1000

  # velo : Σ places ÷ Σ population × 1 000 — recomposé depuis les parties
  # (jamais la moyenne des taux) ; les communes sans EPCI n'agrègent à aucun
  # niveau EPCI
  ctx_v <- velo_communes %>%
    dplyr::left_join(ref, by = c("commune" = "CODGEO"))
  velo <- dplyr::bind_rows(
    ctx_v %>% dplyr::transmute(code = commune, value = places_1000),
    ctx_v %>% dplyr::filter(!is.na(EPCI)) %>%
      dplyr::group_by(code = EPCI) %>%
      dplyr::summarise(value = sum(places) / sum(population) * 1000,
                       .groups = "drop"),
    ctx_v %>% dplyr::group_by(code = DEP) %>%
      dplyr::summarise(value = sum(places) / sum(population) * 1000,
                       .groups = "drop"),
    ctx_v %>% dplyr::summarise(
      code = "53",
      value = sum(places) / sum(population) * 1000,
      .groups = "drop")
  ) %>%
    dplyr::mutate(key = "places_stationnement_velo_1000",
                  detail = NA_character_)

  # offre_cyclable (issue #231) : les cinq mesures de la figure, chacune
  # agrégée par SA règle — les longueurs (protégé/partagé/total) SOMMÉES, les
  # km/1 000 hab RECOMPOSÉS depuis les parties (Σ km ÷ Σ population × 1 000).
  # La commune sans aménagement porte 0 (la forme de calculer_offre_cyclable_
  # communes : TOUTES les communes de l'univers y figurent) ; les communes
  # sans EPCI n'agrègent à aucun niveau EPCI.
  cyclable <- NULL
  if (!is.null(offre_cyclable_communes)) {
    # les km/1 000 hab sont RECOMPOSÉS depuis les LONGUEURS (la colonne sœur)
    # — Σ km ÷ Σ population × 1 000, jamais une somme de taux
    longueur_des_taux <- c(protege_km_1000 = "protege_longueur",
                           partage_km_1000 = "partage_longueur")
    mesures_longueur <- c("protege_longueur", "partage_longueur",
                          "total_longueur")
    mesures_taux <- c("protege_km_1000", "partage_km_1000")
    ctx_c <- offre_cyclable_communes %>%
      dplyr::left_join(ref, by = c("commune" = "CODGEO"))
    agreger_longueur_c <- function(colonne) {
      dplyr::bind_rows(
        ctx_c %>% dplyr::transmute(code = commune, valeur = .data[[colonne]]),
        ctx_c %>% dplyr::filter(!is.na(EPCI)) %>%
          dplyr::group_by(code = EPCI) %>%
          dplyr::summarise(valeur = sum(.data[[colonne]]), .groups = "drop"),
        ctx_c %>% dplyr::group_by(code = DEP) %>%
          dplyr::summarise(valeur = sum(.data[[colonne]]), .groups = "drop"),
        ctx_c %>% dplyr::summarise(code = "53",
                                   valeur = sum(.data[[colonne]]),
                                   .groups = "drop")
      ) %>%
        dplyr::transmute(code, key = "offre_cyclable",
                         detail = colonne, value = valeur)
    }
    agreger_taux_c <- function(colonne) {
      colonne_longueur <- longueur_des_taux[[colonne]]
      dplyr::bind_rows(
        ctx_c %>% dplyr::transmute(code = commune, valeur = .data[[colonne]]),
        ctx_c %>% dplyr::filter(!is.na(EPCI)) %>%
          dplyr::group_by(code = EPCI) %>%
          dplyr::summarise(
            valeur = sum(.data[[colonne_longueur]]) / sum(population) * 1000,
            .groups = "drop"),
        ctx_c %>% dplyr::group_by(code = DEP) %>%
          dplyr::summarise(
            valeur = sum(.data[[colonne_longueur]]) / sum(population) * 1000,
            .groups = "drop"),
        ctx_c %>% dplyr::summarise(
          code = "53",
          valeur = sum(.data[[colonne_longueur]]) / sum(population) * 1000,
          .groups = "drop")
      ) %>%
        dplyr::transmute(code, key = "offre_cyclable",
                         detail = colonne, value = valeur)
    }
    cyclable <- dplyr::bind_rows(
      lapply(c(mesures_longueur, mesures_taux), function(colonne) {
        if (colonne %in% mesures_longueur) {
          agreger_longueur_c(colonne)
        } else {
          agreger_taux_c(colonne)
        }
      })
    )
  }

  voiture <- NULL
  if (!is.null(stationnement_voiture_communes)) {
    voiture <- agreger_stationnement_voiture_territoires(
      stationnement_voiture_communes, velo_communes, base_epci)
  }
  ratios <- NULL
  if (!is.null(fuel_communes)) {
    # Le compte de stations-service B316 et son taux / 1 000 hab sont produits
    # par le bloc ravitaillement partagé (#953/#989) — jamais recomposés ici.
    ratios <- dplyr::bind_rows(ravitaillement$ratio, ravitaillement$stations)
  }
  dplyr::bind_rows(offre_tc, bornes, bornes_1000, velo, cyclable, voiture, ratios) %>%
    dplyr::select(code, key, detail, value, dplyr::any_of("rider")) %>%
    dplyr::arrange(code, key, detail)
}
