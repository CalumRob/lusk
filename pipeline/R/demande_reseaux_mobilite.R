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
# Les trois modes du système de design et leur source :
#   - c (voiture — le réseau routier) et t (à pied — le réseau piéton) : lus sur
#     highway=* de l'extrait OSM (le pbf Geofabrik, voir normaliser_mobilite.R) ;
#   - b (vélo — le réseau cyclable) : alimenté par le jeu Geovelo « Aménagements
#     cyclables » (ADR-0016, issues #222/#230) — le pbf ne porte plus l'extraction
#     maison du mode b (highway=cycleway), remplacée par le comptage par
#     direction de calculer_reseaux_velo_communes.
# MODES_RESEAUX_MOBILITE reste le CONTRAT des trois modes (les 6 détails du
# payload t/b/c × longueur/densité — agreger_reseaux_territoires l'itère) ;
# MODES_RESEAUX_OSM déclare les modes que le raw OSM alimente (t/c), le b venant
# du jeu Geovelo.
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

# MODES_RESEAUX_OSM -----------------------------------------------------------
# Les modes LUS par le raw OSM : t/c — le mode `b` (vélo) est alimenté par le
# jeu Geovelo depuis l'issue #230 (ADR-0016), plus d'extraction maison du b sur
# le pbf (le fragment osm_reseaux ne sert plus qu'aux modes t/c et au
# dénominateur routier de la figure « L'offre cyclable »).
MODES_RESEAUX_OSM <- c("t", "c")

# calculer_reseaux_communes ----------------------------------------------------
# Les longueurs et densités réseau t/c COMMUNALES, depuis les lignes OSM et les
# limites communales :
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
# Le mode `b` (vélo) ne s'y trouve PLUS depuis l'issue #230 (ADR-0016) : il est
# alimenté par le jeu Geovelo « Aménagements cyclables » (calculer_reseaux_
# velo_communes) — le pbf reste la source des modes t/c seulement. MODES_
# RESEAUX_OSM déclare les modes lus sur highway (t/c) ; MODES_RESEAUX_MOBILITE
# garde les trois modes (le contrat des 6 détails du payload, agreger_).
# Retour : une table par commune (commune, aire_m2, longueur_t/c en km,
# densite_t/c en km/km²), triée par commune — déterministe. Une commune sans
# ligne attribuée porte 0 (zéro réseau — un fait), jamais une ligne manquante.
# Le seam fusionne ensuite la table b (Geovelo) via fusionner_reseaux_velo_
# communes — la forme complète du contrat est reconstituée AVANT
# agreger_reseaux_territoires.
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

  longueurs <- lapply(MODES_RESEAUX_OSM, function(mode) {
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
  names(longueurs) <- MODES_RESEAUX_OSM

  d <- sf::st_drop_geometry(attribue)
  for (mode in MODES_RESEAUX_OSM) {
    d <- dplyr::left_join(d, longueurs[[mode]], by = "osm_id")
  }

  d %>%
    dplyr::filter(!is.na(code_insee)) %>%
    dplyr::group_by(commune = code_insee, aire_m2) %>%
    dplyr::summarise(
      longueur_t = sum(longueur_m_t, na.rm = TRUE) / 1000,
      longueur_c = sum(longueur_m_c, na.rm = TRUE) / 1000,
      .groups = "drop"
    ) %>%
    dplyr::mutate(
      densite_t = longueur_t / (aire_m2 / 1e6),
      densite_c = longueur_c / (aire_m2 / 1e6)
    ) %>%
    dplyr::arrange(commune)
}

# calculer_reseaux_velo_communes ------------------------------------------------
# Les longueurs et densités réseau `b` (vélo) COMMUNALES depuis la table Geovelo
# NORMALISÉE (la forme de normaliser_amenagements_cyclables — issue #230,
# ADR-0016) et les limites communales. DEUX règles d'ADR-0016 :
#   1. le comptage PAR DIRECTION : un segment contribue sa longueur une fois par
#      direction qu'il sert — une piste bidirectionnelle (sens BIDIRECTIONNEL
#      sur l'un des deux côtés) compte 2×, une unidirectionnelle (ou sens non
#      renseigné — la quasi-totalité du fichier) 1×. Vérifié sur le fichier
#      réel : 155 lignes bretonnes BIDIRECTIONNEL sur 27 797 = +0,5 % ;
#   2. l'attribution par le CÔTÉ PORTEUR : pour un segment de frontière (les
#      deux codes communaux diffèrent), la longueur va à la commune dont le
#      côté porte l'aménagement (ame ≠ AUCUN) ; les DEUX côtés porteurs → le
#      côté `d` départage (le tiebreak déterministe). Chaque segment aboutit
#      dans EXACTEMENT une commune — les totaux région/EPCI/département restent
#      la somme des parties communales, zéro double-compte.
# La projection EPSG:2154 précède toute mesure (la consigne du contrat). Retour :
# une table par commune (commune, aire_m2, longueur_b en km, densite_b en
# km/km²), triée par commune — déterministe. Une commune sans aménagement
# attribué ne figure pas ici (le zéro est porté par la fusion t/c dans le seam).
calculer_reseaux_velo_communes <- function(amenagements, limites) {
  if (!inherits(amenagements, "sf") || !inherits(limites, "sf")) {
    stop("Réseaux vélo corrompu — les aménagements Geovelo et les limites ",
         "communales doivent être des objets sf.", call. = FALSE)
  }
  requises <- c("ame_d", "ame_g", "code_com_d", "code_com_g",
                "sens_d", "sens_g")
  manquantes <- setdiff(requises, names(amenagements))
  if (length(manquantes) > 0) {
    stop("Réseaux vélo corrompu — colonne(s) requise(s) manquante(s) : ",
         paste(manquantes, collapse = ", "), ".", call. = FALSE)
  }
  if (nrow(amenagements) == 0) {
    stop("Réseaux vélo corrompu — aucune ligne d'aménagement.", call. = FALSE)
  }
  if (!"code_insee" %in% names(limites)) {
    stop("Réseaux vélo corrompu — les limites communales ne portent pas ",
         "code_insee.", call. = FALSE)
  }
  if (anyDuplicated(limites$code_insee)) {
    stop("Réseaux vélo corrompu — des limites communales en double (code_insee).",
         call. = FALSE)
  }
  # un segment sans aménagement des DEUX côtés (AUCUN/AUCUN) est une corruption
  # — vérifié sur le fichier réel : le jeu ne porte aucune ligne « route nue »
  # (research note §7.10bis), jamais une ligne silencieusement perdue
  if (any(amenagements$ame_d == "AUCUN" & amenagements$ame_g == "AUCUN")) {
    stop("Réseaux vélo corrompu — un segment sans aménagement des deux côtés ",
         "(ame AUCUN/AUCUN) — hors contrat du jeu Geovelo.", call. = FALSE)
  }

  limites <- limites %>%
    sf::st_transform(2154) %>%
    sf::st_make_valid()
  limites$aire_m2 <- as.numeric(sf::st_area(sf::st_geometry(limites)))

  seg <- sf::st_transform(amenagements, 2154)
  seg$longueur_m <- as.numeric(sf::st_length(sf::st_geometry(seg)))

  # le comptage par direction (ADR-0016) : 2× si l'un des deux côtés est
  # BIDIRECTIONNEL, 1× sinon (un sens non renseigné n'est jamais bidirectionnel)
  bidir <- (seg$sens_d == "BIDIRECTIONNEL") | (seg$sens_g == "BIDIRECTIONNEL")
  bidir[is.na(bidir)] <- FALSE
  seg$multiplicateur <- ifelse(bidir, 2, 1)

  # l'attribution par le côté porteur (ADR-0016) : le côté qui porte
  # l'aménagement gagne ; les deux côtés porteurs → le `d` départage
  seg$commune <- ifelse(
    seg$ame_g != "AUCUN" & seg$ame_d == "AUCUN",
    seg$code_com_g,
    seg$code_com_d
  )

  par_commune <- sf::st_drop_geometry(seg) %>%
    dplyr::group_by(commune) %>%
    dplyr::summarise(longueur_m = sum(longueur_m * multiplicateur),
                     .groups = "drop") %>%
    dplyr::left_join(limites[c("code_insee", "aire_m2")],
                     by = c("commune" = "code_insee"))

  if (any(is.na(par_commune$aire_m2))) {
    stop("Réseaux vélo corrompu — un segment attribué à une commune hors ",
         "référentiel.", call. = FALSE)
  }

  par_commune %>%
    dplyr::transmute(
      commune = commune,
      aire_m2 = aire_m2,
      longueur_b = longueur_m / 1000,
      densite_b = (longueur_m / 1000) / (aire_m2 / 1e6)
    ) %>%
    dplyr::arrange(commune)
}

# fusionner_reseaux_velo_communes ------------------------------------------------
# Le seam du mode `b` (issue #230) : la table t/c (OSM) et la table b (Geovelo)
# sont FUSIONNÉES par commune en LA table communale du contrat — les huit
# colonnes que agreger_reseaux_territoires consomme (la forme reste, la source
# du b change, ADR-0016). Les deux entrées dérivent la surface du MÊME
# référentiel (limites) — la surface est coalescée. Une commune présente dans
# une seule des deux tables porte 0 sur l'autre famille (zéro réseau — un fait,
# jamais une ligne manquante). Retour : commune × aire_m2 × les six mesures,
# triée par commune — déterministe.
fusionner_reseaux_velo_communes <- function(reseaux_communes, velo_communes) {
  requises <- c("commune", "aire_m2", "longueur_t", "longueur_c",
                "densite_t", "densite_c")
  manquantes <- setdiff(requises, names(reseaux_communes))
  if (length(manquantes) > 0) {
    stop("Réseaux corrompu — la table t/c ne porte pas les colonnes requises : ",
         paste(manquantes, collapse = ", "), ".", call. = FALSE)
  }
  manquantes_b <- setdiff(c("commune", "longueur_b", "densite_b"),
                          names(velo_communes))
  if (length(manquantes_b) > 0) {
    stop("Réseaux vélo corrompu — la table b ne porte pas les colonnes ",
         "requises : ", paste(manquantes_b, collapse = ", "), ".", call. = FALSE)
  }

  dplyr::full_join(reseaux_communes, velo_communes, by = "commune") %>%
    dplyr::mutate(
      aire_m2 = dplyr::coalesce(.data$aire_m2.x, .data$aire_m2.y),
      longueur_b = dplyr::coalesce(.data$longueur_b, 0),
      densite_b = dplyr::coalesce(.data$densite_b, 0),
      longueur_t = dplyr::coalesce(.data$longueur_t, 0),
      longueur_c = dplyr::coalesce(.data$longueur_c, 0),
      densite_t = dplyr::coalesce(.data$densite_t, 0),
      densite_c = dplyr::coalesce(.data$densite_c, 0)
    ) %>%
    dplyr::select(commune, aire_m2, longueur_t, longueur_b, longueur_c,
                  densite_t, densite_b, densite_c) %>%
    dplyr::arrange(commune)
}

# OFFRE_CYCLABLE_PROTEGE / OFFRE_CYCLABLE_PARTAGE ---------------------------------
# La binaison PROVISOIRE de la figure « L'offre cyclable » (ADR-0016, issue
# #231) : chaque valeur RÉELLE de l'enum ame_d/ame_g du jeu Geovelo (schéma
# national v0.3.5 — vérifiée sur le fichier réel du 2026-08-08, 27 797 lignes
# bretonnes) tombe dans une des deux familles :
#   - protégé : l'espace SÉPARÉ du trafic motorisé — pistes (PISTE CYCLABLE,
#     DOUBLE SENS CYCLABLE PISTE), voies vertes (VOIE VERTE), CVCB (CHAUSSEE A
#     VOIE CENTRALE BANALISEE), mixte piéton-vélo (AMENAGEMENT MIXTE PIETON
#     VELO HORS VOIE VERTE) ;
#   - partagé : l'espace PARTAGÉ / non séparé — bandes (BANDE CYCLABLE, DOUBLE
#     SENS CYCLABLE BANDE), doubles sens (DOUBLE SENS CYCLABLE NON
#     MATERIALISE), vélos rues (VELO RUE), couloirs bus+vélo (COULOIR
#     BUS+VELO), AUTRE, accotements (ACCOTEMENT REVETU HORS CVCB) et les
#     auxiliaires GOULOTTE / RAMPE (décision provisoire : des équipements non
#     séparés du trafic, la famille la plus proche de AUTRE — 57 lignes
#     GOULOTTE, 0 RAMPE sur le fichier réel breton ; jamais une ligne
#     silencieusement perdue).
# La binaison est FIGÉE par un test sur la forme réelle (une ligne par valeur
# de l'enum — test-theme-mobilite.R, fixture_offre_cyclable_binning).
OFFRE_CYCLABLE_PROTEGE <- c(
  "PISTE CYCLABLE", "DOUBLE SENS CYCLABLE PISTE",
  "VOIE VERTE",
  "CHAUSSEE A VOIE CENTRALE BANALISEE",
  "AMENAGEMENT MIXTE PIETON VELO HORS VOIE VERTE"
)
OFFRE_CYCLABLE_PARTAGE <- c(
  "BANDE CYCLABLE", "DOUBLE SENS CYCLABLE BANDE",
  "DOUBLE SENS CYCLABLE NON MATERIALISE",
  "VELO RUE", "COULOIR BUS+VELO", "AUTRE",
  "ACCOTEMENT REVETU HORS CVCB",
  "GOULOTTE", "RAMPE"
)

# calculer_offre_cyclable_communes ------------------------------------------------
# La table COMMUNALE de la figure « L'offre cyclable » (issue #231) : les km
# protégé / partagé, les km / 1 000 hab (la population communale) et le
# numérateur du ratio « X % de l'infrastructure routière » — le total cyclable
# en GÉOMÉTRIE UNIQUE. Le même jeu Geovelo que calculer_reseaux_velo_communes
# (le mode `b`), avec DEUX décisions d'ADR-0016 et UNE exception de convention :
#   1. l'attribution par le CÔTÉ PORTEUR (la règle d'ADR-0016, identique au
#      mode `b`) : pour un segment de frontière, la longueur va à la commune
#      dont le côté porte l'aménagement (ame ≠ AUCUN) ; les DEUX côtés porteurs
#      → le `d` départage. Chaque segment aboutit dans EXACTEMENT une commune —
#      les totaux région/EPCI/département restent la somme des parties
#      communales, zéro double-compte ;
#   2. la LONGUEUR en GÉOMÉTRIE UNIQUE (chaque segment compté UNE fois, quel
#      que soit le sens — jamais le multiplicateur par direction du mode `b`) :
#      le contre-pied ASSUMÉ d'ADR-0016. La figure compare le vélo au réseau
#      `c` (le pbf OSM mesure chaque way une fois — géométrie unique) : le
#      « X % » n'est honnête que si les deux conventions coïncident (décision
#      2026-08-08, conséquences d'ADR-0016). Le numérateur = protégé + partagé,
#      exactement — une somme, jamais une seconde mesure.
# La binaison provisoire (OFFRE_CYCLABLE_PROTEGE/PARTAGE) répartit chaque
# segment : une valeur d'enum hors binaison est une corruption (le contrat du
# jeu a changé — jamais une ligne silencieusement perdue). La famille du
# segment est celle du côté GAGNANT de l'attribution (le côté porteur — jamais
# l'autre côté). `population` (commune × population — la population communale,
# le dénominateur des km / 1 000 hab, portée par le hub stationnement vélo
# dans le seam) définit l'univers : une commune SANS aménagement porte 0 (un
# fait, jamais une ligne manquante, jamais supprimée), un segment attribué à
# une commune hors référentiel est une corruption. Retour : commune ×
# population × protege_longueur / partage_longueur / total_longueur (km) ×
# protege_km_1000 / partage_km_1000, trié par commune — déterministe.
calculer_offre_cyclable_communes <- function(amenagements, population) {
  if (!inherits(amenagements, "sf")) {
    stop("Offre cyclable corrompue — les aménagements Geovelo doivent être ",
         "un objet sf.", call. = FALSE)
  }
  requises <- c("ame_d", "ame_g", "code_com_d", "code_com_g")
  manquantes <- setdiff(requises, names(amenagements))
  if (length(manquantes) > 0) {
    stop("Offre cyclable corrompue — colonne(s) requise(s) manquante(s) : ",
         paste(manquantes, collapse = ", "), ".", call. = FALSE)
  }
  if (nrow(amenagements) == 0) {
    stop("Offre cyclable corrompue — aucune ligne d'aménagement.", call. = FALSE)
  }
  if (!all(c("commune", "population") %in% names(population))) {
    stop("Offre cyclable corrompue — la table de population doit porter ",
         "commune et population.", call. = FALSE)
  }
  if (anyDuplicated(population$commune)) {
    stop("Offre cyclable corrompue — des communes en double dans la table de ",
         "population.", call. = FALSE)
  }
  if (any(is.na(population$population) | population$population <= 0)) {
    stop("Offre cyclable corrompue — une population communale non positive.",
         call. = FALSE)
  }
  # un segment sans aménagement des DEUX côtés (AUCUN/AUCUN) est une corruption
  # — la même garde que le mode `b` : le jeu ne porte aucune ligne « route
  # nue » (vérifié §7.10bis), jamais une ligne silencieusement perdue
  if (any(amenagements$ame_d == "AUCUN" & amenagements$ame_g == "AUCUN")) {
    stop("Offre cyclable corrompue — un segment sans aménagement des deux ",
         "côtés (ame AUCUN/AUCUN) — hors contrat du jeu Geovelo.", call. = FALSE)
  }

  # la projection EPSG:2154 précède toute mesure (la consigne du contrat)
  seg <- sf::st_transform(amenagements, 2154)
  seg$longueur_m <- as.numeric(sf::st_length(sf::st_geometry(seg)))

  # l'attribution par le côté porteur (ADR-0016) : le côté qui porte
  # l'aménagement gagne ; les deux côtés porteurs → le `d` départage
  seg$commune <- ifelse(
    seg$ame_g != "AUCUN" & seg$ame_d == "AUCUN",
    seg$code_com_g,
    seg$code_com_d
  )

  # la famille du côté GAGNANT (le côté porteur) — jamais l'autre côté ; une
  # valeur hors binaison est une corruption (le contrat du jeu a changé)
  porter <- ifelse(seg$ame_g != "AUCUN" & seg$ame_d == "AUCUN",
                   seg$ame_g, seg$ame_d)
  inconnus <- setdiff(unique(porter),
                      c(OFFRE_CYCLABLE_PROTEGE, OFFRE_CYCLABLE_PARTAGE))
  if (length(inconnus) > 0) {
    stop("Offre cyclable corrompue — une valeur d'enum hors binaison : ",
         paste(inconnus, collapse = ", "), ".", call. = FALSE)
  }
  seg$famille <- ifelse(porter %in% OFFRE_CYCLABLE_PROTEGE,
                        "protege", "partage")

  par_commune <- sf::st_drop_geometry(seg) %>%
    dplyr::group_by(commune) %>%
    dplyr::summarise(
      protege_m = sum(longueur_m[famille == "protege"]),
      partage_m = sum(longueur_m[famille == "partage"]),
      .groups = "drop"
    )

  # la garde du référentiel : un segment attribué à une commune hors de la
  # table de population (la population absente) est une corruption
  hors_referentiel <- setdiff(par_commune$commune, population$commune)
  if (length(hors_referentiel) > 0) {
    stop("Offre cyclable corrompue — un segment attribué à une commune hors ",
         "référentiel (population absente) : ",
         paste(hors_referentiel, collapse = ", "), ".", call. = FALSE)
  }

  # la commune SANS aménagement porte 0 (un fait) — l'univers est la table de
  # population, jamais une ligne manquante, jamais supprimée
  univers <- population %>%
    dplyr::left_join(par_commune, by = "commune") %>%
    dplyr::mutate(
      protege_m = dplyr::coalesce(protege_m, 0),
      partage_m = dplyr::coalesce(partage_m, 0)
    )

  univers %>%
    dplyr::transmute(
      commune = commune,
      population = population,
      protege_longueur = protege_m / 1000,
      partage_longueur = partage_m / 1000,
      total_longueur = (protege_m + partage_m) / 1000,
      protege_km_1000 = (protege_m / 1000) / population * 1000,
      partage_km_1000 = (partage_m / 1000) / population * 1000
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
