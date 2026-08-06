# demande_reseaux_mobilite -----------------------------------------------------
# L'étage demande/réseaux du thème Mobilité (issue #139) : les builders PURS de
# la demande (voitures par ménage — RP exploitation principale, le code de
# table épinglé LOG T12 « Équipement automobile des ménages » du dossier
# complet) et des réseaux (longueur / densité par mode t/b/c — OSM via
# Geofabrik + osmextract). Le seam construire_analytiques_mobilite
# (theme_mobilite.R) les enchaîne et persiste les artefacts sous
# data/processed/mobilite/.
#
# Le vocabulaire (CONTEXT.md, mobilite.md §Demand/network tier) : « Voitures
# par ménage » (la demande — ce qu'on possède, le pendant du « ce qu'on peut
# atteindre à pied ou en transports » du flagship), « Réseaux t/b/c » (les
# longueurs et densités des réseaux routier / cyclable / piéton). Les trois
# modes du système de design : t = à pied (réseau piéton), b = vélo (réseau
# cyclable), c = voiture (réseau routier).

# La demande : voitures par ménage --------------------------------------------
# Le code de table RP épinglé en recherche (2026-08-06, l'item 🔶 du contrat) :
# la table LOG T12 « Équipement automobile des ménages » du dossier complet
# INSEE, alimentée par le jeu MELODI DS_RP_LOGEMENT_PRINC (les exploitations
# principales du recensement) — la dimension CARS du cube :
#   C0    = ménage ne disposant d'aucune voiture ;
#   C1    = ménage disposant d'une seule voiture ;
#   C_GE1 = ménage disposant d'au moins une voiture ;
#   C_GE2 = ménage disposant de deux voitures ou plus ;
#   _T    = total (le nombre de ménages, RP_MEASURE = DWELLINGS).
# Les fichiers longs MELODI du dossier complet (DS_RP_MENAGES_COMP,
# DS_RP_POPULATION_PRINC) ne portent PAS les voitures — vérifié par un scan
# complet des deux fichiers le 2026-08-06 (RP_MEASURE ∈ {DWELLINGS,
# DWELLINGS_POPSIZE} pour le premier, {POP} pour le second). Les parts
# « sans voiture » et « 2+ » sont le miroir de la demande : le pendant
# quantitatif de l'offre d'accès du flagship.
CLES_VOITURES_MOBILITE <- c(sans_voiture = "part_sans_voiture",
                            deux_plus = "part_deux_plus")

# calculer_voitures_communes ---------------------------------------------------
# Les parts voitures/ménage COMMUNALES : part_sans_voiture = sans ÷ total et
# part_deux_plus = deux-plus ÷ total, en fractions dans [0, 1] — jamais un
# taux pour 100 (le contrat des parts). Le nombre de ménages (le total) est
# porté comme POIDS : l'agrégation des niveaux est l'affaire
# d'agreger_voitures_territoires. La garde de forme s'arrête sur un input
# corrompu (une colonne manquante nomme le champ fautif) — jamais un succès
# partiel silencieux. Déterministe : trié par commune.
calculer_voitures_communes <- function(voitures) {
  requises <- c("commune", "menages_total", "menages_sans_voiture",
                "menages_deux_plus")
  manquantes <- setdiff(requises, names(voitures))
  if (length(manquantes) > 0) {
    stop("Voitures/ménage corrompu — colonne(s) requise(s) manquante(s) : ",
         paste(manquantes, collapse = ", "), ".", call. = FALSE)
  }
  if (nrow(voitures) == 0) {
    stop("Voitures/ménage corrompu — aucune commune.", call. = FALSE)
  }
  voitures %>%
    dplyr::transmute(
      commune = commune,
      menages = menages_total,
      part_sans_voiture = menages_sans_voiture / menages_total,
      part_deux_plus = menages_deux_plus / menages_total
    ) %>%
    dplyr::arrange(commune)
}

# agreger_voitures_territoires -------------------------------------------------
# Les parts voitures/ménage aux QUATRE niveaux de territoire (commune / EPCI /
# département / région) en appliquant LA RÈGLE D'AGRÉGATION décidée
# (ADR-0012, CONTEXT.md « Taille ») : un agrégat est RECALCULÉ depuis les
# parties — Σ (part × ménages) ÷ Σ ménages, la moyenne pondérée par les
# ménages, JAMAIS la moyenne des parts communales. Les communes SANS EPCI (les
# îles — fix « Sans objet » #131) n'agrègent à AUCUN niveau EPCI. Une commune
# absente de la demande n'a pas de ligne ici. Sortie longue (code × key ×
# detail × value), triée par code puis détail — déterministe.
agreger_voitures_territoires <- function(voitures_communes, base_epci) {
  ctx <- voitures_communes %>%
    dplyr::left_join(base_epci[c("CODGEO", "EPCI", "DEP")],
                     by = c("commune" = "CODGEO"))

  agreger_part <- function(part) {
    dplyr::bind_rows(
      # commune : la part communale telle quelle
      ctx %>%
        dplyr::transmute(code = commune, value = .data[[part]]),
      # EPCI : la moyenne pondérée des communes membres — jamais les sans-EPCI
      ctx %>%
        dplyr::filter(!is.na(EPCI)) %>%
        dplyr::group_by(code = EPCI) %>%
        dplyr::summarise(value = sum(.data[[part]] * menages) / sum(menages),
                         .groups = "drop"),
      # département : la moyenne pondérée des communes du département
      ctx %>%
        dplyr::group_by(code = DEP) %>%
        dplyr::summarise(value = sum(.data[[part]] * menages) / sum(menages),
                         .groups = "drop"),
      # région : la moyenne pondérée de toutes les communes
      ctx %>%
        dplyr::summarise(code = "53",
                         value = sum(.data[[part]] * menages) / sum(menages),
                         .groups = "drop")
    ) %>%
      dplyr::select(code, value)
  }

  dplyr::bind_rows(lapply(names(CLES_VOITURES_MOBILITE), function(detail) {
    agreger_part(CLES_VOITURES_MOBILITE[[detail]]) %>%
      dplyr::mutate(key = "voitures_menage", detail = detail)
  })) %>%
    dplyr::select(code, key, detail, value) %>%
    dplyr::arrange(code, detail)
}

# Les réseaux t/b/c -----------------------------------------------------------
# Les trois modes du système de design, leur lecture highway=* (OSM) — le
# mapping VERROUILLÉ du contrat (mobilite.md §Demand/network tier, la recherche
# openstreetmap.md §5.2) :
#   c (voiture — le réseau routier) : les classes circulables motorisées —
#     motorway/trunk/primary/secondary/tertiary (et leurs bretelles *_link),
#     unclassified, residential, service, living_street ;
#   b (vélo — le réseau cyclable) : highway=cycleway (les pistes cyclables
#     dédiées — jamais les bandes/lanes qui vivent dans other_tags) ;
#   t (à pied — le réseau piéton) : footway, pedestrian, steps.
# `track` (chemins agricoles/forestiers) et `path` (sentiers partagés) sont
# EXCLUS : ce ne sont ni des infrastructures routières, ni cyclables dédiées,
# ni piétonnes urbaines — documenté Méthodes. Le mode est un fait de TAG, la
# mesure est une longueur : EPSG:2154 projeté AVANT st_length/st_area (la
# consigne du contrat — ne jamais mesurer en WGS84).
MODES_RESEAUX_MOBILITE <- list(
  c = c("motorway", "motorway_link", "trunk", "trunk_link", "primary",
        "primary_link", "secondary", "secondary_link", "tertiary",
        "tertiary_link", "unclassified", "residential", "service",
        "living_street"),
  b = c("cycleway"),
  t = c("footway", "pedestrian", "steps")
)

# calculer_reseaux_communes ----------------------------------------------------
# Les longueurs et densités réseau t/b/c COMMUNALES, depuis les lignes OSM et
# les limites communales :
#   1. les deux entrées sont PROJETÉES en EPSG:2154 (Lambert-93) AVANT toute
#      mesure — la consigne du contrat (st_length/st_area ne mesurent jamais
#      en degrés) ;
#   2. chaque ligne est attribuée à LA commune qui contient son CENTROÏDE (le
#      point représentatif — une ligne de frontière tombe dans l'une des deux
#      communes, jamais comptée deux fois ; la longueur totale de la région est
#      conservée, seule la répartition communale est approximée — documenté
#      Méthodes) ;
#   3. par commune × mode : la SOMME des longueurs (km) et la DENSITÉ =
#      longueur ÷ surface (km/km², la surface du polygone communal projeté,
#      portée en m² dans la table).
# Retour : une table par commune (commune, aire_m2, longueur_t/b/c en km,
# densite_t/b/c en km/km²), triée par commune — déterministe. Une commune sans
# ligne attribuée porte 0 (zéro réseau — un fait), jamais une ligne manquante.
calculer_reseaux_communes <- function(lignes, limites) {
  if (!inherits(lignes, "sf") || !inherits(limites, "sf")) {
    stop("Réseaux corrompu — les lignes OSM et les limites communales doivent ",
         "être des objets sf.", call. = FALSE)
  }
  if (!"highway" %in% names(lignes)) {
    stop("Réseaux corrompu — la couche des lignes OSM ne porte pas highway.",
         call. = FALSE)
  }
  if (!"code_insee" %in% names(limites)) {
    stop("Réseaux corrompu — les limites communales ne portent pas code_insee.",
         call. = FALSE)
  }

  limites <- limites %>%
    sf::st_transform(2154) %>%
    sf::st_make_valid()
  if (anyDuplicated(limites$code_insee)) {
    stop("Réseaux corrompu — des limites communales en double (code_insee).",
         call. = FALSE)
  }
  limites$aire_m2 <- as.numeric(sf::st_area(sf::st_geometry(limites)))

  lignes <- sf::st_transform(lignes, 2154)
  points <- sf::st_sf(
    osm_id = lignes$osm_id,
    highway = lignes$highway,
    geometry = sf::st_centroid(sf::st_geometry(lignes)),
    crs = 2154
  )
  attribue <- sf::st_join(points, limites[c("code_insee", "aire_m2")],
                          join = sf::st_intersects, left = TRUE)

  longueurs <- lapply(names(MODES_RESEAUX_MOBILITE), function(mode) {
    lignes_mode <- lignes[lignes$highway %in% MODES_RESEAUX_MOBILITE[[mode]], ]
    if (nrow(lignes_mode) == 0) {
      tibble::tibble(osm_id = character(),
                     !!paste0("longueur_m_", mode) := numeric())
    } else {
      tibble::tibble(
        osm_id = lignes_mode$osm_id,
        !!paste0("longueur_m_", mode) :=
          as.numeric(sf::st_length(sf::st_geometry(lignes_mode)))
      )
    }
  })
  names(longueurs) <- names(MODES_RESEAUX_MOBILITE)

  d <- sf::st_drop_geometry(attribue)
  for (mode in names(MODES_RESEAUX_MOBILITE)) {
    d <- dplyr::left_join(d, longueurs[[mode]], by = "osm_id")
  }

  d %>%
    dplyr::filter(!is.na(code_insee)) %>%
    dplyr::group_by(commune = code_insee, aire_m2) %>%
    dplyr::summarise(
      longueur_t = sum(longueur_m_t, na.rm = TRUE) / 1000,
      longueur_b = sum(longueur_m_b, na.rm = TRUE) / 1000,
      longueur_c = sum(longueur_m_c, na.rm = TRUE) / 1000,
      .groups = "drop"
    ) %>%
    dplyr::mutate(
      densite_t = longueur_t / (aire_m2 / 1e6),
      densite_b = longueur_b / (aire_m2 / 1e6),
      densite_c = longueur_c / (aire_m2 / 1e6)
    ) %>%
    dplyr::arrange(commune)
}

# agreger_reseaux_territoires --------------------------------------------------
# Les longueurs et densités réseau aux QUATRE niveaux de territoire, RECALCULÉS
# depuis les parties communales (la règle d'agrégation partagée) :
#   - longueur : la SOMME des longueurs communales (une longueur est un total) ;
#   - densité  : Σ longueur ÷ Σ surface — la moyenne pondérée des densités
#     communales par la surface (les deux lectures du même fait, jamais deux
#     moyennes).
# Les communes sans EPCI (les îles) n'agrègent à aucun niveau EPCI. Une commune
# absente n'a pas de ligne ici. Sortie longue (code × key × detail × value),
# triée par code puis détail — déterministe.
agreger_reseaux_territoires <- function(reseaux_communes, base_epci) {
  ctx <- reseaux_communes %>%
    dplyr::left_join(base_epci[c("CODGEO", "EPCI", "DEP")],
                     by = c("commune" = "CODGEO"))

  agreger_longueur <- function(mode) {
    colonne <- paste0("longueur_", mode)
    dplyr::bind_rows(
      ctx %>%
        dplyr::transmute(code = commune, valeur = .data[[colonne]]),
      ctx %>%
        dplyr::filter(!is.na(EPCI)) %>%
        dplyr::group_by(code = EPCI) %>%
        dplyr::summarise(valeur = sum(.data[[colonne]]), .groups = "drop"),
      ctx %>%
        dplyr::group_by(code = DEP) %>%
        dplyr::summarise(valeur = sum(.data[[colonne]]), .groups = "drop"),
      ctx %>%
        dplyr::summarise(code = "53", valeur = sum(.data[[colonne]]),
                         .groups = "drop")
    ) %>%
      dplyr::select(code, longueur = valeur)
  }

  agreger_densite <- function(mode) {
    colonne_longueur <- paste0("longueur_", mode)
    dplyr::bind_rows(
      ctx %>%
        dplyr::select(commune, densite = dplyr::all_of(paste0("densite_", mode))) %>%
        dplyr::rename(code = commune),
      ctx %>%
        dplyr::filter(!is.na(EPCI)) %>%
        dplyr::group_by(code = EPCI) %>%
        dplyr::summarise(densite = sum(.data[[colonne_longueur]]) / (sum(aire_m2) / 1e6),
                         .groups = "drop"),
      ctx %>%
        dplyr::group_by(code = DEP) %>%
        dplyr::summarise(densite = sum(.data[[colonne_longueur]]) / (sum(aire_m2) / 1e6),
                         .groups = "drop"),
      ctx %>%
        dplyr::summarise(code = "53",
                         densite = sum(.data[[colonne_longueur]]) / (sum(aire_m2) / 1e6),
                         .groups = "drop")
    ) %>%
      dplyr::select(code, densite)
  }

  dplyr::bind_rows(lapply(names(MODES_RESEAUX_MOBILITE), function(mode) {
    l <- agreger_longueur(mode)
    dens <- agreger_densite(mode)
    dplyr::bind_rows(
      l %>%
        dplyr::transmute(code, key = "reseaux",
                         detail = paste0(mode, "_longueur"), value = longueur),
      dens %>%
        dplyr::transmute(code, key = "reseaux",
                         detail = paste0(mode, "_densite"), value = densite)
    )
  })) %>%
    dplyr::arrange(code, detail)
}
