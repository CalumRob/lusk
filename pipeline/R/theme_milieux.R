# theme_milieux ---------------------------------------------------------------
# Le module du thème Milieux (issue #171, ADR-0014) : le cinquième bloc de la
# fiche, l'axe terre. Le TRACEUR (#171) a prouvé la machinerie partagée
# (download/compute/publish) pour Milieux : l'ingestion CONSOENAF (le
# manifeste, le reshape m² -> ha, le filtre Bretagne), la table des territoires
# via le squelette partagé, et un payload squelettique publiable. L'indicateur
# « Consommation d'ENAF » (#172) livre SES DEUX clés — la fenêtre 2021-2025
# (conso_enaf_fenetre, en hectares) et la série annuelle 2011-2024
# (conso_enaf_annuel, une ligne par année), classées sur la PART de la surface
# du territoire consommée (jamais les hectares bruts, ADR-0014). La trajectoire
# ZAN (#173) ajoute SA clé — le rapport des rythmes annualisés 2021-2025 contre
# 2011-2021, échelle libre. L'Histoire « Se densifier, s'étaler, ou s'en
# aller » (#174) vit ici : la lecture du territoire contre sa terre, sur la
# règle des DEUX HORLOGES (la fenêtre dérive des millésimes RP de la série
# historique, la terre se re-somme sur la même fenêtre — jamais codée en dur).
#
# Ce qui vit ici, ce qui ne vit pas ici :
#   - le manifeste CONCATÉNÉ du thème (manifest_milieux.R) : la source
#     CONSOENAF + la base des EPCI partagée + la série historique du
#     recensement (la source partagée de la population de l'Histoire, #174) ;
#   - la construction des données : le lecteur du CSV (lire_consoenaf), le
#     reshape (normaliser_consoenaf — l'anomalie d'unité m²/ha, le filtre
#     Bretagne), le lecteur de la population (lire_serie_historique_pop — la
#     fenêtre dérivée des deux millésimes RP les plus récents) et l'assembleur
#     (construire_donnees_milieux — la jointure d'identité sur la base des
#     EPCI partagée, la surface communale surfcom2025 portée telle quelle,
#     jamais convertie, la jointure de population sur la série historique, la
#     consommation de la fenêtre re-sommée sur les annuels) ;
#   - la table des territoires du thème : le squelette PARTAGÉ (squelette_
#     territoires, compute.R) avec le poids du thème — la consommation totale
#     d'ENAF (comme Démographie pèse par la population et Habitat par les
#     logements, Milieux pèse par les hectares consommés) ; la surface
#     s'agrège avec les consommations (le scalaire classé se lit sur les
#     totaux du niveau) ;
#   - la table déclarative INDICATEURS_MILIEUX (les trois clés de l'indicateur :
#     les deux de la « Consommation d'ENAF » #172 + la trajectoire ZAN #173) et
#     l'APERCU_<theme> vide (le gating par thème, ADR-0007) ;
#   - l'Histoire du thème : compute_histoires_milieux — les quatre lectures
#     « Se densifier, s'étaler, ou s'en aller » (issue #174, pivotées par
#     #238 sur les états OCS-GE — ADR-0017 : la terre se lit en STOCK à
#     chaque millésime, jamais en flux ; les deux horloges sont nommées
#     séparément, periode_pop pour la population, periode_artif pour les
#     états).
# Ce qui N'y vit PAS : aucune modification de la machinerie partagée.

# NOM_FICHIER_SERIE_HISTORIQUE -------------------------------------------------
# Le nom du CSV long de la série historique du recensement DANS le dossier
# extrait du cache (le nom que le zip INSEE fixe). Le builder du thème le lit
# après l'extraction idempotente du zip (la même règle que la base des EPCI) ;
# les tests déposent leur fixture sous ce nom.
NOM_FICHIER_SERIE_HISTORIQUE <- "DS_RP_SERIE_HISTORIQUE_2023_data.csv"

# lire_consoenaf ---------------------------------------------------------------
# Le lecteur du CSV CONSOENAF (conso_com.csv) : tout est lu en chaînes — les
# codes (idcom, iddep, epci25) ne sont jamais des nombres (le 0 de tête des
# codes < 10000), les champs texte du fichier (scot, libdens_aav, littoral,
# abc...) portent des valeurs non numériques (« NC », « out »). La conversion
# des champs de consommation en double se fait au reshape, pas à la lecture.
lire_consoenaf <- function(chemin) {
  readr::read_csv(
    chemin,
    col_types = readr::cols(.default = readr::col_character()),
    show_col_types = FALSE, progress = FALSE
  )
}

# conso_en_m2 -----------------------------------------------------------------
# Le motif des colonnes de consommation diffusées en m² (l'anomalie d'unité,
# ADR-0014) : les annuels naf{AA}art{AA+1} / art{AA}{dest}{AA+1} et les totaux
# de période naf{AA}art{BB} / art{AA}{dest}{BB} (AA, BB = les deux chiffres de
# l'année — 11..25). Les DÉCORS du fichier sont exclus, jamais convertis :
#   - artpop{AA}{BB} / mepart{AA}{BB} / menhab{AA}{BB} : des ratios déjà en
#     ha/hab ou en ha-1 — leur nom commence par « art »/« me » mais ce ne sont
#     pas des consommations en m² ;
#   - artcom1125 : la part de surface communale consommée (un %) ;
#   - surfcom2025 : la surface de la commune (en m² — une mesure du référentiel,
#     jamais divisée) ;
#   - pop*/men*/emp* : les populations/ménages/emplois RP embarqués (jamais
#     convertis — la règle de source de population d'ADR-0014).
conso_en_m2 <- function(noms) {
  noms[grepl("^(naf|art)[0-9]{2}(art|hab|act|mix|rou|fer|inc)[0-9]{2}$", noms)]
}

# lire_serie_historique_pop ----------------------------------------------------
# Le lecteur de la population de l'Histoire (#174) : lit le CSV long de la
# SÉRIE HISTORIQUE du recensement (la source partagée — la même que le thème
# Démographie ; la règle de source d'ADR-0014 : la population vient TOUJOURS
# de là, jamais des champs embarqués de CONSOENAF), ne garde que les lignes
# communes (GEO_OBJECT == "COM") de la mesure résidente (RP_MEASURE == "POP")
# au statut valide (OBS_STATUS == "A" — les doublons K/W tombent), puis
# dérive la FENÊTRE de l'Histoire : les DEUX millésimes RP les plus récents
# présents dans la donnée (aujourd'hui 2017 et 2023). La règle des deux
# horloges (ADR-0014) : la fenêtre n'est JAMAIS codée en dur — elle glisse
# automatiquement quand l'INSEE publie un nouveau recensement dans la série.
# Retourne une ligne par commune : code, pop_debut, pop_fin, millesime_debut,
# millesime_fin (la population de la borne de départ et de la borne de fin).
lire_serie_historique_pop <- function(chemin) {
  if (!file.exists(chemin)) {
    stop("La série historique du recensement est absente du cache extrait (",
         chemin, ") — la source partagée de la population de l'Histoire ",
         "Milieux.", call. = FALSE)
  }
  pop <- lire_csv_long(chemin) %>%
    dplyr::filter(GEO_OBJECT == "COM", RP_MEASURE == "POP",
                  OBS_STATUS == "A") %>%
    dplyr::select(GEO, TIME_PERIOD, OBS_VALUE)

  millesimes <- sort(unique(pop$TIME_PERIOD))
  if (length(millesimes) < 2) {
    stop("La série historique du recensement ne porte pas deux millésimes de ",
         "population — l'Histoire Milieux ne peut pas dériver sa fenêtre.",
         call. = FALSE)
  }
  fenetre <- tail(millesimes, 2)  # les DEUX plus récents, jamais codés en dur

  pop %>%
    dplyr::filter(TIME_PERIOD %in% fenetre) %>%
    dplyr::mutate(
      borne = dplyr::if_else(TIME_PERIOD == fenetre[2], "fin", "debut")
    ) %>%
    tidyr::pivot_wider(id_cols = GEO, names_from = borne,
                       values_from = OBS_VALUE) %>%
    dplyr::rename(code = GEO, pop_debut = debut, pop_fin = fin) %>%
    dplyr::mutate(millesime_debut = fenetre[1], millesime_fin = fenetre[2])
}

# conso_annuelles_fenetre ------------------------------------------------------
# La part du thème côté terre (la règle des deux horloges, #174) : les
# colonnes ANNUELES CONSOENAF dont l'année tombe dans la fenêtre
# [millesime_debut, millesime_fin). Chaque annuel naf{AA}art{AA+1} couvre
# l'ANNÉE {AA} — du 1er janvier {AA} au 1er janvier {AA+1} — et les millésimes
# RP étant des dates au 1er janvier, la fenêtre de terre re-somme la MÊME
# période que la fenêtre de population. Seuls les TOTAUX naf{AA}art{AA+1} sont
# sommés — JAMAIS les colonnes de décomposition art{AA}{dest}{AA+1} (hab, act,
# inc, mix, fer, rou) que le fichier Cerema distribue à côté de chaque total :
# elles somment EXACTEMENT au total, les sommer en plus DOUBLERAIT la
# consommation (le bug #221). Les TOTAUX de période (naf11art25, naf11art21,
# naf21art25...) ne sont JAMAIS sommés : seul est annuel un champ dont la
# deuxième paire d'années suit la première (AA+1 == AA + 1). La fenêtre arrive
# du lecteur de la série historique — jamais une liste d'années codée en dur.
conso_annuelles_fenetre <- function(noms, millesime_debut, millesime_fin) {
  m <- regmatches(noms, regexec(
    "^naf([0-9]{2})art([0-9]{2})$", noms
  ))
  annees <- vapply(m, function(mm) if (length(mm) > 0) mm[[2]] else NA_character_,
                   character(1))
  fins <- vapply(m, function(mm) if (length(mm) > 0) mm[[3]] else NA_character_,
                 character(1))
  annee <- as.integer(annees) + 2000
  fin <- as.integer(fins) + 2000
  noms[!is.na(annee) & fin == annee + 1 &
         annee >= millesime_debut & annee < millesime_fin]
}

# normaliser_consoenaf ----------------------------------------------------------
# LE reshape CONSOENAF : renomme l'identité (idcom -> code, idcomtxt -> nom,
# iddep -> departement, epci25 -> epci, epci25txt -> nom_epci), convertit les
# champs de consommation de m² en hectares (÷ 10 000 — le fichier distribue des
# m², le dictionnaire dit hectares ; la conversion est testée, jamais
# silencieusement trustée) et filtre la Bretagne (22/29/35/56). Une valeur de
# consommation vide reste NA — jamais un 0 inventé. Les décors (ratios, parts,
# surfaces, populations embarquées) passent intacts.
normaliser_consoenaf <- function(table_conso) {
  m2 <- conso_en_m2(names(table_conso))
  table_conso %>%
    dplyr::rename(
      code = idcom, nom = idcomtxt, departement = iddep,
      epci = epci25, nom_epci = epci25txt
    ) %>%
    dplyr::mutate(dplyr::across(dplyr::all_of(m2), ~ as.double(.x) / 10000)) %>%
    filter_bretagne()
}

# construire_donnees_milieux ---------------------------------------------------
# L'acte « trouver la donnée » du thème : lit le CSV CONSOENAF dans le cache,
# le reshape (m² -> ha + Bretagne), JOINT l'identité sur la base des EPCI
# partagée (lire_epci — le référentiel commun des noms réels LIBGEO/LIBEPCI et
# de l'appartenance EPCI/département ; la même règle que Démographie/Habitat :
# l'identité vient du référentiel partagé, jamais des champs embarqués du
# fichier), puis JOINT la population de l'Histoire (#174) sur la SÉRIE
# HISTORIQUE du recensement (la source partagée — la règle de source
# d'ADR-0014, jamais les populations embarquées de CONSOENAF) et calcule la
# consommation de la FENÊTRE (les annuels re-sommés sur les deux millésimes
# dérivés de la série — la règle des deux horloges, jamais codée en dur).
# Depuis l'issue #237 (spec #225), quand les QUATRE archives OCS-GE du
# manifeste sont présentes dans le cache, la table porte EN PLUS les états
# d'artificialisation par commune (artif_m2 / artif_m3 / flux_net + les
# millésimes OCS-GE) — le raccord construire_ocsge_milieux (le référentiel
# géométrique partagé communes_limites.geojson, la même source que Mobilité).
# Archives absentes -> la table de base inchangée (le chemin rétro-compatible).
# Persiste la table des communes sous data/processed/milieux/ (idempotent,
# comme les builders des sources) et la retourne — la forme que
# construire_territoires_milieux consomme.
construire_donnees_milieux <- function(cache = "data/raw",
                                       sortie = "data/processed/milieux/consoenaf_communes.rds") {
  extrait <- file.path(cache, "extracted")
  if (!dir.exists(extrait)) dir.create(extrait, recursive = TRUE)

  # la base des EPCI est partagée entre les thèmes : le manifeste du thème la
  # télécharge, on l'extrait ici (idempotent) pour lire l'identité des communes
  zip_epci <- MANIFEST_MILIEUX$fichier[MANIFEST_MILIEUX$id == "epci"]
  suppressWarnings(
    utils::unzip(file.path(cache, zip_epci), exdir = extrait, overwrite = FALSE)
  )

  # la série historique du recensement est partagée entre les thèmes (le même
  # id/URL que Démographie) : le manifeste du thème la télécharge, on l'extrait
  # ici (idempotent) pour lire la population de l'Histoire — la fenêtre dérive
  # des deux millésimes RP les plus récents de la donnée (la règle des deux
  # horloges, ADR-0014)
  zip_serie <- MANIFEST_MILIEUX$fichier[MANIFEST_MILIEUX$id == "serie_historique"]
  suppressWarnings(
    utils::unzip(file.path(cache, zip_serie), exdir = extrait, overwrite = FALSE)
  )
  serie <- lire_serie_historique_pop(file.path(extrait, NOM_FICHIER_SERIE_HISTORIQUE))

  conso <- normaliser_consoenaf(
    lire_consoenaf(file.path(cache, "conso-com.csv"))
  )
  base_epci <- lire_epci(file.path(extrait, "EPCI_au_01-01-2025.xlsx"))

  # la consommation de la fenêtre : les annuels CONSOENAF dont l'année tombe
  # dans [millesime_debut, millesime_fin) — sommés par commune (une valeur NA
  # rend le total NA : un total incomplet n'est jamais publié comme complet ;
  # une fenêtre sans annuel mesure zéro consommation — jamais un 0 inventé)
  annuelles <- conso_annuelles_fenetre(
    conso_en_m2(names(conso)),
    millesime_debut = serie$millesime_debut[1],
    millesime_fin = serie$millesime_fin[1]
  )
  if (length(annuelles) > 0) {
    conso$conso_fenetre <- rowSums(conso[annuelles], na.rm = FALSE)
  } else {
    conso$conso_fenetre <- 0
  }

  communes <- conso %>%
    dplyr::inner_join(base_epci, by = c("code" = "CODGEO")) %>%
    dplyr::left_join(serie, by = "code") %>%
    dplyr::transmute(
      code = code,
      nom = LIBGEO,
      departement = DEP,
      epci = EPCI,
      nom_epci = LIBEPCI,
      # la surface communale : le champ surfcom2025 du fichier, une MESURE du
      # référentiel en m² — portée telle quelle, jamais convertie (le décor,
      # ADR-0014) ; elle s'agrège avec les consommations pour que le scalaire
      # classé — la part de surface consommée — se lise sur les totaux du
      # niveau de territoire (#172).
      surfcom2025 = as.double(surfcom2025),
      dplyr::across(dplyr::all_of(conso_en_m2(names(conso))), ~ .x),
      # les colonnes de l'Histoire (#174) : la consommation de la fenêtre
      # (re-sommée sur les annuels) et les populations aux deux bornes de la
      # série historique
      conso_fenetre = conso_fenetre,
      pop_debut = pop_debut,
      pop_fin = pop_fin,
      millesime_debut = millesime_debut,
      millesime_fin = millesime_fin
    )

  # les états OCS-GE (issue #237, spec #225) : quand les QUATRE archives du
  # manifeste sont présentes dans le cache, la table des communes porte les
  # états d'artificialisation par commune (artif_m2 / artif_m3 / flux_net en
  # m² — l'unité native de l'ingestion, la conversion en hectares se fait au
  # payload #238 — et les millésimes OCS-GE renommés millesime_ocsge_debut/fin,
  # la collision de noms avec la population résolue dans
  # rattacher_ocsge_communes). Archives absentes -> la table de base inchangée
  # (le chemin rétro-compatible).
  if (archives_ocsge_presentes(cache)) {
    communes <- construire_ocsge_milieux(cache, communes, sortie)
  }

  if (!dir.exists(dirname(sortie))) dir.create(dirname(sortie), recursive = TRUE)
  readr::write_rds(communes, sortie)
  communes
}

# L'ingestion OCS-GE (issue #234, spec #225) -----------------------------------
# Les états d'artificialisation OCS-GE entrent dans le pipeline sur la MÊME
# forme que CONSOENAF — manifeste -> lecteur -> normalisation -> agrégation —
# avec TROIS fonctions pures (lecteur / normalisation / agrégation), testées
# sur un petit GPKG de fixture (jamais de réseau dans la boucle de test). La
# source : les QUATRE couches différentielles officielles « OCS GE
# Artificialisation » v2.0 de la Géoplateforme (une par département breton,
# MANIFEST_MILIEUX_OCSGE) — le référentiel ZAN de l'État. Chaque couche porte
# les CHANGEMENTS de statut d'artificialisation entre les millésimes M2 et M3
# du département, dans UN SEUL fichier :
#   - Artif_{M2} / Artif_{M3}  : le statut d'artificialisation à chaque
#     millésime (caractères « Artif » / « Non Artif ») ;
#   - Artificialisation         : le sens du changement (entier +1 =
#     artificialisation, -1 = désartificialisation) ;
#   - Surface                   : la superficie en m² du changement mesuré
#     (les seuils réglementaires du décret 2023-1096, 50 m² bâti / 2500 m²
#     autres, déjà appliqués par l'IGN).
# (Descriptif de contenu IGN Doc_artif.pdf — la source primaire.) On lit la
# MESURE de l'État, jamais re-dérivée : les couches brutes OCCUPATION_SOL ne
# sont jamais superposées nous-mêmes. La fenêtre dérive de la DONNÉE — les
# millésimes sont lus dans les noms des colonnes Artif_* (les DEUX horloges,
# jamais codées en dur) : la même couche lue avec d'autres millésimes glisse
# toute seule. La livraison Géoplateforme est un .7z (aucun extracteur .7z en
# R — ni le paquet `archive`, ni un binaire 7-Zip) : le seam d'extraction
# (extraire_gpkg_ocsge) est l'étape DOCUMENTÉE avant le lecteur, testée sur le
# format zip que R sait écrire.

# COUCHE_OCSGE_ARTIFICIALISATION ----------------------------------------------
# Le nom de la couche dans le GPKG Géoplateforme de l'artificialisation. Le
# nom EXACT du produit réel sera confirmé à la première livraison (le lecteur
# échoue bruyamment en listant les couches disponibles si le nom dérive —
# c'est un changement d'une constante, pas un silence).
COUCHE_OCSGE_ARTIFICIALISATION <- "DIFF_ARTIF"

# IDS_OCSGE_ARTIFICIALISATION --------------------------------------------------
# Les ids des quatre couches OCS-GE dans le manifeste du thème — l'ordre de
# construction (le builder les lit dans cet ordre, l'ordre du manifeste).
IDS_OCSGE_ARTIFICIALISATION <- c(
  "ocsge_artificialisation_22", "ocsge_artificialisation_29",
  "ocsge_artificialisation_35", "ocsge_artificialisation_56"
)

# lire_ocsge_artificialisation --------------------------------------------------
# Le LECTEUR (pur) : le GPKG Géoplateforme -> les polygones longs de la couche
# différentielle, TELS QUELS (les colonnes officielles — on ne re-dérive rien).
# La couche est lue sous COUCHE_OCSGE_ARTIFICIALISATION ; une couche absente
# échoue bruyamment en nommant les couches disponibles (une dérive du produit
# doit être visible, pas silencieuse).
lire_ocsge_artificialisation <- function(chemin,
                                         couche = COUCHE_OCSGE_ARTIFICIALISATION) {
  if (!file.exists(chemin)) {
    stop("Le GPKG OCS-GE est absent : ", chemin, call. = FALSE)
  }
  disponibles <- sf::st_layers(chemin)$name
  if (!couche %in% disponibles) {
    stop("La couche ", couche, " est absente du GPKG ", basename(chemin),
         " — couches disponibles : ", paste(disponibles, collapse = ", "),
         ".", call. = FALSE)
  }
  sf::st_read(chemin, layer = couche, quiet = TRUE)
}

# normaliser_ocsge_artificialisation -------------------------------------------
# La NORMALISATION (pure) : la couche différentielle officielle -> les mesures
# en m² (EPSG:2154). La fenêtre dérive de la DONNÉE : les deux millésimes sont
# lus dans les noms des colonnes Artif_{AAAA} de la couche (jamais codés en
# dur — la même fonction lit n'importe quelle paire). Par polygone :
#   - artif_m2 : la surface (m²) du changement artificialisée au millésime M2
#     (Surface si le statut Artif_{M2} vaut « Artif », 0 sinon) ;
#   - artif_m3 : idem au millésime M3 ;
#   - flux_net : le flux net signé en m² (Artificialisation × Surface — le
#     +1/-1 de l'État appliqué à la surface du changement qu'il mesure) ;
#   - aire_m2  : la surface du polygone en m², calculée par sf::st_area APRÈS
#     projection EPSG:2154 (les différentiels sont livrés en LAMB93 ; la
#     projection est une garantie, pas une hypothèse).
# L'intégrité de la couche est vérifiée (un fichier qui dérive échoue fort) :
# Artificialisation ne vaut que +1/-1, et il doit concorder avec les statuts —
# flux_net == artif_m3 - artif_m2 par construction (dans une couche de
# CHANGEMENTS, exactement un des deux statuts vaut « Artif »). La géométrie
# est rendue valide (le motif des autres lecteurs géométriques du pipeline).
normaliser_ocsge_artificialisation <- function(flux) {
  if (!inherits(flux, "sf")) {
    stop("La couche OCS-GE doit être un objet sf (lire_ocsge_artificialisation).",
         call. = FALSE)
  }
  noms_artif <- grep("^Artif_[0-9]{4}$", names(flux), value = TRUE)
  if (length(noms_artif) != 2L) {
    stop("La couche différentielle OCS-GE doit porter les deux statuts ",
         "Artif_{millesime} (Artif / Non Artif) — trouvés : ",
         paste(noms_artif, collapse = ", "), ".", call. = FALSE)
  }
  if (!all(c("Artificialisation", "Surface") %in% names(flux))) {
    stop("La couche différentielle OCS-GE doit porter Artificialisation et ",
         "Surface.", call. = FALSE)
  }
  millesimes <- sort(as.integer(sub("^Artif_", "", noms_artif)))
  m2 <- as.character(millesimes[1])
  m3 <- as.character(millesimes[2])
  sens <- as.integer(flux$Artificialisation)
  if (any(!sens %in% c(1L, -1L))) {
    stop("Artificialisation doit valoir +1 (artificialisation) ou -1 ",
         "(désartificialisation) — la couche a dérivé.", call. = FALSE)
  }
  derive <- as.integer(flux[[paste0("Artif_", m3)]] == "Artif") -
    as.integer(flux[[paste0("Artif_", m2)]] == "Artif")
  if (any(!(sens == derive), na.rm = TRUE) || any(is.na(derive))) {
    stop("Artificialisation incohérent avec les statuts Artif_* — la couche ",
         "a dérivé.", call. = FALSE)
  }
  surf <- as.numeric(flux$Surface)
  if (any(surf < 0, na.rm = TRUE) || any(is.na(surf))) {
    stop("Surface doit être positive et présente (la superficie en m² du ",
         "changement mesuré) — la couche a dérivé.", call. = FALSE)
  }
  geometrie <- sf::st_transform(sf::st_geometry(flux), 2154)
  geometrie <- sf::st_make_valid(geometrie)
  sf::st_sf(
    artif_m2 = ifelse(flux[[paste0("Artif_", m2)]] == "Artif", surf, 0),
    artif_m3 = ifelse(flux[[paste0("Artif_", m3)]] == "Artif", surf, 0),
    flux_net = sens * surf,
    aire_m2 = as.numeric(sf::st_area(geometrie)),
    millesime_debut = millesimes[1],
    millesime_fin = millesimes[2],
    geometry = geometrie
  )
}

# agreger_artificialisation_communes -------------------------------------------
# L'AGRÉGATION (pure) : l'intersection PONDÉRÉE PAR LA SURFACE des polygones
# de flux avec les limites communales -> une ligne par commune :
#   code · artif_m2 · artif_m3 · flux_net · millesime_debut · millesime_fin
# Un polygone entièrement DANS une commune lui donne sa pleine mesure ; un
# polygone qui TRAVERSE la frontière donne à A et B leurs tranches pondérées
# par la surface — la mesure OFFICIELLE du polygone (artif_m2/artif_m3/
# flux_net, en m²) est répartie au prorata de la partie de SA géométrie
# (aire_m2) tombant dans chaque commune. Un polygone hors de toutes les
# communes tombe (aucune commune ne le porte). Les millésimes sont portés par
# commune (les polygones d'une commune viennent du différentiel de SON
# département — une commune a un seul couple de millésimes ; la table reste
# honnête si jamais deux couples se croisaient : deux lignes). La géométrie
# n'est pas publiée : la sortie est une table plate (le contrat de la table
# des territoires).
agreger_artificialisation_communes <- function(flux, communes) {
  if (!inherits(flux, "sf") || !inherits(communes, "sf")) {
    stop("flux et communes doivent être des objets sf.", call. = FALSE)
  }
  if (!"code" %in% names(communes)) {
    stop("La couche des communes doit porter la colonne `code` (INSEE).",
         call. = FALSE)
  }
  flux <- flux[flux$aire_m2 > 0, ]  # un polygone de surface nulle ne porte rien
  flux <- sf::st_make_valid(flux)
  communes <- sf::st_make_valid(communes)
  if (sf::st_crs(flux) != sf::st_crs(communes)) {
    communes <- sf::st_transform(communes, sf::st_crs(flux))
  }
  # l'avertissement « attribute variables are assumed to be spatially constant »
  # est le comportement ATTENDU ici : les mesures du polygone sont constantes
  # sur toutes ses tranches (c'est ce que la pondération répartit)
  pieces <- suppressWarnings(
    sf::st_intersection(flux, communes["code"])
  )
  pieces$part <- as.numeric(sf::st_area(pieces)) / pieces$aire_m2
  pieces$artif_m2 <- pieces$artif_m2 * pieces$part
  pieces$artif_m3 <- pieces$artif_m3 * pieces$part
  pieces$flux_net <- pieces$flux_net * pieces$part
  pieces <- sf::st_drop_geometry(pieces)
  pieces %>%
    dplyr::group_by(code, millesime_debut, millesime_fin) %>%
    dplyr::summarise(
      artif_m2 = sum(artif_m2), artif_m3 = sum(artif_m3),
      flux_net = sum(flux_net),
      .groups = "drop"
    )
}

# chemin_gpkg_extrait -----------------------------------------------------------
# Le GPKG extrait attendu d'une archive dans le dossier d'extraction : le
# même « stem » que l'archive (le nom de la sous-ressource Géoplateforme),
# l'extension .gpkg, cherché en récursif (l'archive peut contenir un dossier).
# Retourne le chemin, ou NA si aucun GPKG ne correspond.
chemin_gpkg_extrait <- function(extrait, archive) {
  stem <- tools::file_path_sans_ext(basename(archive))
  candidats <- list.files(extrait, pattern = "[.]gpkg$",
                          recursive = TRUE, full.names = TRUE)
  correspond <- candidats[grepl(stem, basename(candidats), fixed = TRUE)]
  if (length(correspond) > 0) correspond[1] else NA_character_
}

# extraire_gpkg_ocsge -----------------------------------------------------------
# Le SEAM d'extraction des livraisons OCS-GE (le format Géoplateforme est le
# .7z ; le paquet `archive` n'est pas dans renv.lock et aucun binaire 7-Zip
# n'est sur le chemin — l'extraction .7z ne peut pas être faite en R sans
# nouvelle dépendance). DÉCISION issue #234 : le seam le plus petit, documenté
# et testé.
#   - le GPKG déjà extrait dans le dossier (peu importe le format d'archive) :
#     réutilisé tel quel — idempotent, y compris pour le .7z dont l'extraction
#     manuelle documentée a déjà été faite (un .7z ré-extrait à chaque run ne
#     le serait pas de toute façon) ;
#   - un .zip : extrait avec utils::unzip (ce que R sait faire sans dépendance
#     — le format du FIXTURE de test) ;
#   - un .7z SANS GPKG déjà extrait : échoue bruyamment avec l'étape manuelle
#     documentée (7-Zip vers le dossier d'extraction), jamais silencieusement.
# Le GPKG extrait est cherché par stem (chemin_gpkg_extrait) : le nom de la
# sous-ressource Géoplateforme est le contrat, pas la disposition dans
# l'archive (qui peut contenir un dossier).
extraire_gpkg_ocsge <- function(archive, extrait) {
  if (!file.exists(archive)) {
    stop("L'archive OCS-GE est absente du cache : ", archive, call. = FALSE)
  }
  if (!dir.exists(extrait)) dir.create(extrait, recursive = TRUE)
  deja <- chemin_gpkg_extrait(extrait, archive)
  if (!is.na(deja)) return(deja)  # déjà extraite (zip OU .7z manuel) — idempotent
  ext <- tools::file_ext(archive)
  if (ext == "zip") {
    suppressWarnings(utils::unzip(archive, exdir = extrait, overwrite = FALSE))
    deja <- chemin_gpkg_extrait(extrait, archive)
    if (is.na(deja)) {
      stop("L'archive ", basename(archive), " ne contient aucun GPKG après ",
           "extraction.", call. = FALSE)
    }
    return(deja)
  }
  if (ext == "7z") {
    stop(paste0(
      "L'extraction du .7z ", basename(archive), " nécessite l'étape MANUELLE ",
      "documentée : aucun extracteur .7z n'est disponible en R (le paquet ",
      "`archive` n'est pas dans renv.lock, aucun binaire 7-Zip sur le ",
      "chemin). Extraire le GPKG (7-Zip ou équivalent) vers : ", extrait,
      " — le GPKG doit porter le même nom de base que l'archive. Le seam est ",
      "testé sur le format zip que R sait écrire (issue #234)."
    ), call. = FALSE)
  }
  stop("Format d'archive OCS-GE inconnu : .", ext, call. = FALSE)
}

# construire_donnees_ocsge ------------------------------------------------------
# L'acte « trouver la donnée » OCS-GE du thème (le pendant de
# construire_donnees_milieux pour les états d'artificialisation, #234) : pour
# CHAQUE couche du manifeste (les quatre départements), extrait l'archive du
# cache (data/raw — la convention du pipeline, jamais un nouveau dossier),
# lit le GPKG extrait, normalise, puis agrège l'ensemble contre les LIMITES
# COMMUNALES fournies (la couche des communes — le code INSEE dans la colonne
# `code`). Persiste la table par commune sous data/processed/milieux/
# (idempotent) et la retourne. Le RACCORD des états OCS-GE dans la table des
# communes du thème (la jointure au payload, les deux horloges de population)
# est la suite de la spec (#225 — ticket payload).
construire_donnees_ocsge <- function(cache = "data/raw",
                                     communes,
                                     sortie = "data/processed/milieux/ocsge_communes.rds") {
  extrait <- file.path(cache, "extracted", "ocsge")
  if (!dir.exists(extrait)) dir.create(extrait, recursive = TRUE)

  flux_list <- lapply(IDS_OCSGE_ARTIFICIALISATION, function(id) {
    ligne <- MANIFEST_MILIEUX[MANIFEST_MILIEUX$id == id, ]
    archive <- file.path(cache, ligne$fichier)
    gpkg <- extraire_gpkg_ocsge(archive, extrait)
    normaliser_ocsge_artificialisation(lire_ocsge_artificialisation(gpkg))
  })
  flux <- dplyr::bind_rows(flux_list)

  communes_artif <- agreger_artificialisation_communes(flux, communes)
  if (!dir.exists(dirname(sortie))) dir.create(dirname(sortie), recursive = TRUE)
  readr::write_rds(communes_artif, sortie)
  communes_artif
}

# archives_ocsge_presentes ------------------------------------------------------
# La GARDE du raccord OCS-GE dans le builder du thème (issue #237, spec #225) :
# les QUATRE archives du manifeste (les .7z Géoplateforme) sont présentes dans
# le cache. C'est le test qui décide si la table des communes porte les états
# d'artificialisation : un cache sans les archives (le chemin rétro-compatible)
# laisse la table de base inchangée — jamais un échec, jamais des colonnes
# vides inventées.
archives_ocsge_presentes <- function(cache) {
  all(file.exists(file.path(cache, MANIFEST_MILIEUX_OCSGE$fichier)))
}

# rattacher_ocsge_communes ------------------------------------------------------
# Le RACCORD des états OCS-GE dans la table des communes du thème (issue #237,
# spec #225 — la jointure au payload) : joint les valeurs par commune de
# l'ingestion (#234, construire_donnees_ocsge) sur la table des communes, par
# code INSEE. PIÈGE DU TICKET : la table OCS-GE porte les colonnes
# millesime_debut/millesime_fin qui COLLIDENT avec les millésimes de population
# de la table des communes (les deux RP de la série historique, 2017/2023 — le
# dénominateur de l'Histoire) — elles sont renommées millesime_ocsge_debut /
# millesime_ocsge_fin AVANT la jointure (renommer après aurait écrasé la
# population). Une commune absente de la table OCS-GE (aucun polygone de flux
# sur son territoire) garde NA — jamais un 0 inventé.
rattacher_ocsge_communes <- function(communes, ocsge) {
  ocsge <- ocsge %>%
    dplyr::rename(millesime_ocsge_debut = millesime_debut,
                  millesime_ocsge_fin = millesime_fin)
  dplyr::left_join(communes, ocsge, by = "code")
}

# construire_ocsge_milieux ------------------------------------------------------
# Le raccord OCS-GE du thème (issue #237, spec #225) : quand les archives sont
# dans le cache, le référentiel géométrique PARTAGÉ communes_limites.geojson
# (le même WFS Admin Express que le thème Mobilité lit — lire_communes_limites,
# la source partagée) est lu, aligné sur les codes INSEE de la table des
# communes (code_insee -> code, semi_join : une commune du référentiel hors
# base tombe, une commune de la base hors référentiel reste sans donnée -> NA),
# puis construire_donnees_ocsge agrège les états par commune sur cette
# géométrie et rattacher_ocsge_communes les porte dans la table. Une archive
# présente SANS le référentiel échoue bruyamment (jamais un silence) :
# l'intersection pondérée a besoin de LA géométrie.
construire_ocsge_milieux <- function(cache, communes, sortie) {
  chemin_limites <- file.path(cache, "communes_limites.geojson")
  if (!file.exists(chemin_limites)) {
    stop("Le référentiel géométrique communes_limites.geojson est absent du ",
         "cache (", chemin_limites, ") — nécessaire au raccord OCS-GE (le ",
         "même WFS Admin Express que le thème Mobilité, la source partagée).",
         call. = FALSE)
  }
  limites <- lire_communes_limites(chemin_limites) %>%
    dplyr::rename(code = code_insee) %>%
    dplyr::semi_join(communes, by = "code")
  ocsge <- construire_donnees_ocsge(
    cache = cache, communes = limites,
    sortie = file.path(dirname(sortie), "ocsge_communes.rds")
  )
  rattacher_ocsge_communes(communes, ocsge)
}

# La construction de la table des territoires du thème -------------------------
# Le squelette partagé (squelette_territoires, compute.R) fournit les codes,
# les vrais noms, la hiérarchie et la règle de pluralité départementale ; le
# thème ajoute SES colonnes d'agrégation : les consommations d'ENAF (toutes les
# colonnes du reshape, déjà en hectares), sommées par niveau de territoire.

# construire_periode_artif ------------------------------------------------------
# La fenêtre OCS-GE d'un territoire depuis les couples (département ->
# millésimes) DISTINCTS de ses membres — la règle « la fenêtre dérive de la
# donnée » (spec #225, jamais codée en dur) :
#   - aucun couple (aucun membre porteur de donnée OCS-GE) -> NA ;
#   - un couple unique -> « 2021-2025 » : un territoire mono-département
#     homogène dit sa paire simplement, sans parenthèses ;
#   - plusieurs couples -> le SPAN avec les dates par département, trié par
#     code de département : « 2020-2023 (35) · 2022-2024 (56) ». Le mélange
#     est DIT, jamais aplati : un EPCI transfrontalier est honnête sur ses
#     deux horloges (les départements de ses communes), la région sur ses
#     quatre (story #8 et #9 de la spec).
construire_periode_artif <- function(departements, millesime_debut,
                                     millesime_fin) {
  combos <- unique(data.frame(
    departement = as.character(departements),
    millesime_debut = as.integer(millesime_debut),
    millesime_fin = as.integer(millesime_fin),
    stringsAsFactors = FALSE
  ))
  combos <- combos[!is.na(combos$millesime_debut) & !is.na(combos$millesime_fin),
                   , drop = FALSE]
  if (nrow(combos) == 0) return(NA_character_)
  combos <- combos[order(combos$departement), , drop = FALSE]
  paires <- paste0(combos$millesime_debut, "-", combos$millesime_fin)
  if (nrow(combos) == 1) return(paires)
  paste0(paires, " (", combos$departement, ")", collapse = " · ")
}

# agreger_territoires_milieux : la part du thème — les colonnes de consommation
# (le motif conso_en_m2 — la même source de vérité que le reshape) et la
# surface communale (surfcom2025, en m² — une mesure du référentiel, jamais
# convertie), agrégées par niveau de territoire (une ligne par commune = ses
# propres valeurs ; EPCI / département / région = la somme des lignes de leurs
# communes), PLUS les colonnes de l'Histoire (#174) : la consommation de la
# fenêtre et les populations aux deux bornes (pop_debut / pop_fin), agrégées
# de la même façon, rejointes sur le squelette partagé par code. La somme est
# naïve (comme Démographie/Habitat) : une commune à consommation NA rend le
# total de son niveau NA — un total incomplet n'est JAMAIS publié comme s'il
# était complet (le fichier Cerema remplit 0,0 — le NA est l'exception honnête,
# jamais un 0 inventé). La surface d'un niveau, elle, est la somme des
# surfaces de ses communes (le dénominateur du scalaire classé, #172). Les
# deux MILLÉSIMES de la fenêtre sont des constantes du run : la table des
# territoires les porte (pour l'Histoire), sans les sommer.
# Depuis l'issue #237 (spec #225), quand la table des communes porte les états
# OCS-GE, les TROIS mesures d'artificialisation (artif_m2 / artif_m3 /
# flux_net, en m² — l'unité native de l'ingestion ; la conversion en hectares
# se fait au payload, #238) s'agrègent de la même façon : la somme naïve des
# membres, NA propagé (une commune sans donnée rend son niveau NA, jamais un 0
# inventé). Et la fenêtre OCS-GE du territoire (periode_artif) dérive des
# couples (département -> millésimes) distincts de ses membres (le couple du
# département pour un territoire mono-département, le SPAN pour un EPCI
# transfrontalier, les quatre fenêtres pour la région — construire_periode_artif).
# Les millésimes de population (millesime_debut/fin, RP 2017/2023) restent
# INTACTS — ce sont les deux horloges de la spec, jamais confondues.
agreger_territoires_milieux <- function(communes, squelette) {
  base <- communes %>%
    dplyr::mutate(dplyr::across(c(departement, epci), as.character))
  colonnes_conso <- conso_en_m2(names(base))
  # les mesures agrégées du thème : les consommations + la surface (le
  # scalaire classé, #172) + la consommation de fenêtre et les populations de
  # l'Histoire (#174) + les états OCS-GE quand la table les porte (#237)
  colonnes_mesure <- c(colonnes_conso, "surfcom2025",
                       "conso_fenetre", "pop_debut", "pop_fin")
  colonnes_artif <- intersect(c("artif_m2", "artif_m3", "flux_net"),
                              names(base))
  toutes <- c(colonnes_mesure, colonnes_artif)

  mesures <- dplyr::bind_rows(
    base[c("code", toutes)],
    base %>%
      dplyr::group_by(epci) %>%
      dplyr::summarise(
        dplyr::across(dplyr::all_of(toutes), sum),
        .groups = "drop"
      ) %>%
      dplyr::rename(code = epci),
    base %>%
      dplyr::group_by(departement) %>%
      dplyr::summarise(
        dplyr::across(dplyr::all_of(toutes), sum),
        .groups = "drop"
      ) %>%
      dplyr::rename(code = departement),
    base %>%
      dplyr::summarise(
        dplyr::across(dplyr::all_of(toutes), sum),
        .groups = "drop"
      ) %>%
      dplyr::mutate(code = "53")
  )

  territoires <- dplyr::left_join(squelette, mesures, by = "code")
  # les millésimes de la fenêtre : des constantes du run — la première valeur
  # non manquante des communes (la même paire partout), portées pour l'Histoire
  # (la fenêtre de POPULATION — jamais les millésimes OCS-GE, les deux horloges
  # de la spec #225 ne sont jamais confondues)
  territoires$millesime_debut <-
    stats::na.omit(unique(communes$millesime_debut))[1]
  territoires$millesime_fin <-
    stats::na.omit(unique(communes$millesime_fin))[1]

  # la fenêtre OCS-GE par territoire (issue #237) : dérivée des couples
  # (département -> millésimes) distincts des membres — calculée SEULEMENT si
  # la table des communes porte les millésimes OCS-GE (le chemin
  # rétro-compatible ne crée pas la colonne)
  if ("millesime_ocsge_debut" %in% names(base)) {
    combos <- base %>%
      dplyr::select(code, departement, epci,
                    m2 = millesime_ocsge_debut, m3 = millesime_ocsge_fin) %>%
      dplyr::filter(!is.na(m2) & !is.na(m3))
    periode_communes <- combos %>%
      dplyr::group_by(code) %>%
      dplyr::summarise(
        periode_artif = construire_periode_artif(departement, m2, m3),
        .groups = "drop"
      )
    periode_epci <- combos %>%
      dplyr::filter(!is.na(epci)) %>%
      dplyr::group_by(code = epci) %>%
      dplyr::summarise(
        periode_artif = construire_periode_artif(departement, m2, m3),
        .groups = "drop"
      )
    periode_dep <- combos %>%
      dplyr::group_by(code = departement) %>%
      dplyr::summarise(
        periode_artif = construire_periode_artif(departement, m2, m3),
        .groups = "drop"
      )
    periode_region <- combos %>%
      dplyr::summarise(
        periode_artif = construire_periode_artif(departement, m2, m3),
        .groups = "drop"
      ) %>%
      dplyr::mutate(code = "53")
    territoires <- dplyr::left_join(
      territoires,
      dplyr::bind_rows(periode_communes, periode_epci, periode_dep,
                       periode_region),
      by = "code"
    )
  }
  territoires
}

# construire_territoires_milieux -----------------------------------------------
# Une ligne par territoire (communes + agrégats EPCI / département / région),
# mêmes colonnes partout : le squelette partagé + les colonnes d'agrégation du
# thème. Le POIDS de la pluralité départementale est la consommation totale
# d'ENAF 2011-2025 (comme Démographie pèse par la population et Habitat par
# les logements, Milieux pèse par les hectares consommés) — coalescée à 0 pour
# la seule règle mécanique d'attribution (une commune à consommation inconnue
# ne pèse pas ; sa consommation publiée, elle, garde son NA).
construire_territoires_milieux <- function(donnees) {
  communes <- donnees %>%
    dplyr::mutate(conso_poids = dplyr::coalesce(naf11art25, 0))
  squelette <- squelette_territoires(communes, poids = "conso_poids")
  agreger_territoires_milieux(communes, squelette)
}

# INDICATEURS_MILIEUX -----------------------------------------------------------
# La table déclarative des indicateurs du thème (issue #9) : chaque clé du
# payload y est déclarée avec sa source de référence (l'id du manifeste qui
# l'estampille — les vintages) et sa multiplicité. Les TROIS clés du thème,
# toutes de la source CONSOENAF :
#   - conso_enaf_fenetre : la fenêtre 2021-2025, en hectares (le champ natif
#     naf21art25, converti m² -> ha au reshape) — une ligne PAR TERRITOIRE
#     (#172) ;
#   - conso_enaf_annuel : la série annuelle 2011-2024, en hectares (les champs
#     natifs naf{AA}art{AA+1}) — 14 lignes par territoire, detail = l'année
#     (la multiplicité, comme structure_age pour Démographie) (#172) ;
#   - trajectoire_zan : le rapport des rythmes de consommation d'ENAF (la
#     fenêtre 2021-2025 contre la décennie de référence 2011-2021,
#     annualisés), un ratio sans échelle (unité « × ») publié tel quel, une
#     ligne PAR TERRITOIRE (#173).
# La clé squelettique du traceur (conso_enaf, le total 2011-2025) n'est PAS
# dans la spec v1 de l'indicateur — elle est remplacée par les deux clés #172.
INDICATEURS_MILIEUX <- tibble::tibble(
  key = c("conso_enaf_fenetre", "conso_enaf_annuel", "trajectoire_zan"),
  libelle = c(
    "Consommation d'espaces naturels, agricoles et forestiers (ENAF) 2021-2025 — en hectares",
    "Consommation d'espaces naturels, agricoles et forestiers (ENAF) — consommation annuelle, en hectares",
    "Trajectoire ZAN — rapport des rythmes de consommation d'ENAF (2021-2025 contre 2011-2021, annualisés), en ×"
  ),
  sources = list("consoenaf", "consoenaf", "consoenaf"),
  source_reference = c("consoenaf", "consoenaf", "consoenaf"),
  multiplicite = c(1L, 14L, 1L)
)

# APERCU_MILIEUX ----------------------------------------------------------------
# La table déclarative des clés de l'Aperçu du thème (issue #32, ADR-0007) :
# VIDE — le gating par thème. Milieux ne déclare aucune clé aujourd'hui (la
# spec #165 exclut l'Aperçu du v1), la table `apercu` du payload d'un run
# Milieux est présente mais vide (jamais un « under construction »).
APERCU_MILIEUX <- tibble::tibble(
  key = character(),
  libelle = character(),
  multiplicite = integer()
)

# Les constructeurs d'indicateurs ----------------------------------------------
# Mêmes entrées (la table des territoires), mêmes sorties : une table longue
# code, key, detail, value, unit. Chaque clé de l'indicateur (#172) est un
# petit module pur — la trajectoire ZAN (#173) a ajouté la sienne par une
# fonction propre, sans toucher aux autres.
# Une valeur de consommation vide reste NA — jamais un 0 inventé.

# indicator_conso_enaf_fenetre : la fenêtre 2021-2025, en hectares (le champ
# natif naf21art25, déjà converti m² -> ha dans la table des territoires), NA
# pour un territoire au total de fenêtre incomplet.
indicator_conso_enaf_fenetre <- function(territoires) {
  tibble::tibble(
    code = territoires$code,
    key = "conso_enaf_fenetre",
    detail = NA_character_,
    value = territoires$naf21art25,
    unit = "ha"
  )
}

# indicator_conso_enaf_annuel : la série annuelle 2011-2024 — les 14 champs
# natifs naf{AA}art{AA+1} (chaque colonne = UNE année : naf11art12 = 2011, ...
# naf24art25 = 2024), pivotés en 14 lignes par territoire, detail = l'année
# (la multiplicité de la clé). La liste des colonnes se construit depuis la
# plage d'années — jamais un sous-ensemble implicite : une colonne manquante
# (une dérive de forme du fichier) échoue fort au lieu de publier une série
# amputée.
indicator_conso_enaf_annuel <- function(territoires) {
  annees <- 2011:2024
  colonnes <- paste0("naf", substr(annees, 3, 4), "art", substr(annees + 1, 3, 4))
  territoires %>%
    dplyr::select(code, dplyr::all_of(colonnes)) %>%
    tidyr::pivot_longer(
      cols = dplyr::all_of(colonnes),
      names_to = "champ",
      values_to = "value"
    ) %>%
    dplyr::mutate(
      key = "conso_enaf_annuel",
      detail = paste0("20", substr(champ, 4, 5)),
      unit = "ha"
    ) %>%
    dplyr::select(code, key, detail, value, unit)
}

# trajectoire_zan_territoires ---------------------------------------------------
# L'indicateur « Trajectoire ZAN » (issue #173) : le rapport des rythmes de
# consommation d'ENAF — la fenêtre post-loi 2021-2025 contre la décennie de
# référence 2011-2021 — la réponse à « est-ce que le territoire ralentit vers
# l'objectif −50 % ? ». La FORMULE (décision #173, docs/research/zan-rennes.md) :
# les deux fenêtres natives sont ANNUALISÉES avant le rapport — des fenêtres de
# longueurs différentes (10 ans contre 4 ans) ne sont pas comparables brutes :
#   rythme_reference = naf11art21 / 10   (1er janv. 2011 -> 1er janv. 2021,
#                                         la décennie de référence de la loi)
#   rythme_post_loi  = naf21art25 / 4    (1er janv. 2021 -> 1er janv. 2025,
#                                         QUATRE tranches annuelles Cerema —
#                                         naf{AA}art{BB} couvre BB−AA ans ; la
#                                         recherche docs/research/zan-rennes.md
#                                         annualise ainsi : 401,7 ha / 4 =
#                                         100,4 ha/an pour Rennes Métropole)
#   trajectoire_zan  = rythme_post_loi / rythme_reference
# Un rapport < 1 = le territoire ralentit vers l'objectif ZAN (0,5 = le −50 % de
# la loi) ; > 1 = il accélère. Échelle libre : le scalaire classé est la valeur
# elle-même (compute_ranks — aucun scalaire déclaré dans scalaires_milieux).
# Les BORNES (documentées, jamais une valeur inventée) :
#   - une fenêtre NA (commune sans donnée, agrégat incomplet) -> rapport NA,
#     pas de rang ;
#   - une décennie de référence à ZÉRO (un 0,0 réel — le fichier Cerema remplit
#     les zéros) : aucun rythme de référence à diviser par deux — ZAN est un
#     objectif zéro — le rapport n'existe pas -> NA, pas de rang ;
#   - une fenêtre post-loi à zéro, elle, est un 0 RÉEL publié : le territoire a
#     cessé de consommer (le point d'arrivée ZAN).
trajectoire_zan_territoires <- function(territoires) {
  tibble::tibble(
    code = territoires$code,
    key = "trajectoire_zan",
    detail = NA_character_,
    value = ifelse(
      is.na(territoires$naf11art21) | is.na(territoires$naf21art25) |
        territoires$naf11art21 == 0,
      NA_real_,
      (territoires$naf21art25 / 4) / (territoires$naf11art21 / 10)
    ),
    unit = "×"
  )
}

# construire_indicateurs_milieux : le thème déclare SES constructeurs — la
# liste nommée des tables longues que compute_payload() assemble. Les trois
# clés : les deux de la « Consommation d'ENAF » (#172) + la trajectoire ZAN
# (#173).
construire_indicateurs_milieux <- function(territoires) {
  list(
    conso_enaf_fenetre = indicator_conso_enaf_fenetre(territoires),
    conso_enaf_annuel = indicator_conso_enaf_annuel(territoires),
    trajectoire_zan = trajectoire_zan_territoires(territoires)
  )
}

# Les scalaires de classement du thème -----------------------------------------
# Le scalaire classé par indicateur : la valeur elle-même pour les clés
# scalaires, le scalaire déclaré pour les multi-valeurs (issue #13 — ex.
# structure_age classée par la part des moins de 20 ans). Pour Milieux
# (#172), le scalaire des DEUX clés de l'indicateur est la PART de la surface
# du territoire consommée sur la fenêtre 2021-2025 — jamais les hectares
# bruts (une grande commune a plus de terre ; ADR-0014). La série annuelle
# porte le même scalaire que la fenêtre : ses 14 lignes partagent le rang du
# territoire (le rang de la part, comme structure_age réplique le rang de la
# part des moins de 20 ans sur ses 7 tranches). La trajectoire ZAN (#173),
# échelle libre, n'a AUCUN scalaire déclaré : la valeur publiée (le rapport
# des rythmes) EST le scalaire classé (l'héritage du compute_ranks).

# part_surface_consoenaf : la part de la surface du territoire consommée sur
# la fenêtre 2021-2025. La consommation publiée est en hectares (naf21art25,
# convertie au reshape) ; la surface est la mesure du référentiel en m²
# (surfcom2025, jamais convertie — le décor) : on repasse la consommation en
# m² (x 10 000) avant de diviser. Un territoire à fenêtre incomplète (NA)
# porte une part NA — jamais un 0 inventé, jamais un rang fabriqué.
part_surface_consoenaf <- function(territoires) {
  territoires$naf21art25 * 10000 / territoires$surfcom2025
}

scalaires_milieux <- list(
  conso_enaf_fenetre = part_surface_consoenaf,
  conso_enaf_annuel = part_surface_consoenaf
)

# compute_histoires_milieux -----------------------------------------------------
# L'Histoire « Se densifier, s'étaler, ou s'en aller » (issue #174, pivotée
# par #238 — ADR-0017) : la lecture du territoire contre sa terre, re-keyée
# des flux CONSOENAF vers les ÉTATS OCS-GE. Deux forces, chacune lue par le
# SIGNE seul (seuil 0, la règle des quadrants d'ADR-0011) :
#   - le Δpopulation  = pop_fin - pop_debut — les populations de la SÉRIE
#     HISTORIQUE du recensement aux DEUX millésimes de la fenêtre (la règle
#     de source d'ADR-0014 : jamais les populations embarquées de CONSOENAF) ;
#   - la trajectoire par habitant = le ratio M3/M2 des états OCS-GE par
#     habitant (trajectoire_artif_par_habitant = artif_m3_par_habitant /
#     artif_m2_par_habitant). L'intensité d'état (m²/habitant) à CHAQUE état
#     se lit sur la population du millésime qui BORNE l'état — RP 2017 pour
#     l'état initial (pop_debut), RP 2023 pour l'état final (pop_fin) — le
#     bracket, jamais interpolé (ADR-0017).
# Les quatre lectures, une par territoire, exactement une (déterministe :
# même territoire + mêmes données -> même lecture, toujours), les quatre
# quadrants du plan (Δpopulation × trajectoire), zéro compte négatif (la
# convention des quadrants d'ADR-0011, la même que Démographie) :
#   grandir-en-se-densifiant               Δpop > 0, trajectoire < 1
#       (la population grandit plus vite que la terre artificialisée)
#   grandir-en-setalant                    Δpop > 0, trajectoire > 1
#   sen-aller-et-consommer-quand-meme      Δpop <= 0, trajectoire > 1
#   les-departs-laissent-la-place-a-la-renaturation  Δpop <= 0,
#       trajectoire < 1 — la renaturation doit être MESURÉE (artif_m3 <
#       artif_m2) : avec population en baisse, une trajectoire < 1 REQUIERT
#       artif_m3 < artif_m2 (la propriété est prouvée par le fixture). Sans
#       la propriété — le point dégénéré Δpop == 0 ET trajectoire == 1 (la
#       terre n'a pas bougé) — PAS de lecture, jamais une lecture inventée.
# Une force NA (état incomplet, population absente de la série) rend la
# lecture NA — jamais une lecture inventée. L'INVARIANT (ADR-0017) :
# sign(ratio − 1) = sign(delta) où delta = artif_m3_par_habitant −
# artif_m2_par_habitant — le dénominateur du ratio (le M2 par habitant) est
# toujours positif : la classification et le futur graphe (x = Δpopulation,
# y = delta) ne peuvent jamais se contredire.
# Les DEUX fenêtres, nommées séparément (les deux horloges, jamais
# confondues) : periode_pop, la paire RP de la série historique (« 2017-2023 »,
# jamais codée en dur) ; periode_artif, la fenêtre des états OCS-GE du
# territoire (le couple du département, le SPAN pour un EPCI transfrontalier,
# les quatre fenêtres pour la région — construite par #237). Les états sont
# publiés en HECTARES (la conversion ÷ 10 000 de la table des territoires en
# m² — l'unité native de l'ingestion — la même discipline documentée que
# CONSOENAF). Chemin rétro-compatible (cache sans archives OCS-GE, #237) : la
# table ne porte pas les états — le schéma du pivot reste publié, tout NA,
# jamais une lecture inventée.
compute_histoires_milieux <- function(territoires) {
  base <- territoires %>%
    dplyr::mutate(
      delta_population = pop_fin - pop_debut,
      # la fenêtre de population : la paire de millésimes RP de la série
      # historique — jamais codée en dur (les deux horloges, ADR-0017)
      periode_pop = paste0(millesime_debut, "-", millesime_fin)
    )

  if (!"artif_m2" %in% names(base)) {
    return(base %>%
      dplyr::transmute(
        territoire = code,
        type = type,
        theme = "milieux",
        story_key = "se-densifier-setaler-ou-sen-aller",
        periode_pop = periode_pop,
        periode_artif = NA_character_,
        delta_population = delta_population,
        artif_m2 = NA_real_,
        artif_m3 = NA_real_,
        artif_m2_par_habitant = NA_real_,
        artif_m3_par_habitant = NA_real_,
        trajectoire_artif_par_habitant = NA_real_,
        classification = NA_character_
      ))
  }

  base %>%
    dplyr::mutate(
      # les états en hectares (m² -> ha, ÷ 10 000 — la conversion documentée,
      # testée ; jamais silencieusement trustée)
      artif_m2 = artif_m2 / 10000,
      artif_m3 = artif_m3 / 10000,
      # l'intensité d'état : m² par habitant — le ha × 10 000 pour des m²,
      # divisé par la population du millésime qui BORNE l'état (le bracket,
      # ADR-0017 : RP 2017 pour l'état initial, RP 2023 pour l'état final —
      # jamais interpolé). Un état NA rend l'intensité NA.
      artif_m2_par_habitant = artif_m2 * 10000 / pop_debut,
      artif_m3_par_habitant = artif_m3 * 10000 / pop_fin,
      # la trajectoire : le ratio M3/M2 par habitant — la seconde force de la
      # lecture. Algébriquement = croissance de la terre ÷ croissance de la
      # population. Le dénominateur (le M2 par habitant) est positif, donc
      # sign(ratio − 1) = sign(delta) par construction (l'invariant ADR-0017).
      trajectoire_artif_par_habitant =
        artif_m3_par_habitant / artif_m2_par_habitant,
      classification = dplyr::case_when(
        # une force NA (état incomplet, population absente) ou un ratio
        # indéfini (les deux états nuls : 0/0) -> lecture NA, jamais inventée
        is.na(delta_population) |
          is.na(trajectoire_artif_par_habitant) ~ NA_character_,
        delta_population > 0 &
          trajectoire_artif_par_habitant > 1 ~ "grandir-en-setalant",
        delta_population > 0 ~ "grandir-en-se-densifiant",
        trajectoire_artif_par_habitant > 1 ~
          "sen-aller-et-consommer-quand-meme",
        # Δpop <= 0 et trajectoire <= 1 : la lecture « renaturation » exige
        # la renaturation MESURÉE (artif_m3 < artif_m2) — sans la propriété
        # (le point dégénéré terre immobile), PAS de lecture
        artif_m3 < artif_m2 ~
          "les-departs-laissent-la-place-a-la-renaturation",
        TRUE ~ NA_character_
      )
    ) %>%
    dplyr::transmute(
      territoire = code,
      type = type,
      theme = "milieux",
      story_key = "se-densifier-setaler-ou-sen-aller",
      # les deux fenêtres, nommées séparément : la paire RP de la série (la
      # date du titre du Story, jamais codée en dur) et la fenêtre des états
      # OCS-GE du territoire (construite par #237 — le couple du département,
      # le SPAN pour le transfrontalier, les quatre fenêtres pour la région)
      periode_pop = periode_pop,
      periode_artif = periode_artif,
      delta_population = delta_population,
      artif_m2 = artif_m2,
      artif_m3 = artif_m3,
      artif_m2_par_habitant = artif_m2_par_habitant,
      artif_m3_par_habitant = artif_m3_par_habitant,
      trajectoire_artif_par_habitant = trajectoire_artif_par_habitant,
      classification = classification
    )
}

# construire_apercu_milieux -----------------------------------------------------
# Les stats de base de l'onglet Aperçu (ADR-0007) : AUCUNE aujourd'hui — le
# gating par thème (APERCU_MILIEUX vide). Retourne la liste vide ; la table
# `apercu` du payload reste présente et vide (la forme du contrat).
construire_apercu_milieux <- function(territoires) {
  list()
}

# validations_milieux -----------------------------------------------------------
# Les vérifications de valeur propres au thème (point 7) : déclarées ici,
# exécutées par validate_payload() après ses vérifications génériques. Les
# deux clés de l'indicateur (#172) sont vérifiées.
validations_milieux <- list(
  # la consommation d'ENAF est un total non négatif (une valeur NA — commune
  # sans donnée, total de niveau incomplet — est un cas légitime, jamais une
  # corruption ; une valeur négative est un fichier qui dérive)
  function(payload) {
    conso <- payload$indicateurs$value[
      payload$indicateurs$key %in% c("conso_enaf_fenetre", "conso_enaf_annuel")]
    if (any(!is.na(conso) & conso < 0)) {
      stop("Payload invalide : une consommation d'ENAF négative.",
           call. = FALSE)
    }
    invisible(payload)
  }
)

# vintages_milieux --------------------------------------------------------------
# Le builder de vintages du thème : la projection générique depuis le manifeste
# (vintages_depuis_manifest, vintage.R) — chaque source garde SA référence et
# SA publication, aucun alignement.
vintages_milieux <- function() {
  vintages_depuis_manifest(MANIFEST_MILIEUX)
}

# MEMBRES_DESCRIPTEUR_MILIEUX ---------------------------------------------------
# Les membres requis du descripteur — le contrat de FORME du thème (ce que la
# machinerie partagée consomme : theme, manifest, indicateurs, apercu,
# vintages, construire_donnees, construire_territoires, construire_indicateurs,
# construire_apercu, scalaires, compute_histoires, validations). La même idée
# que verifier_contrat_milieux : un descripteur incomplet échoue FORT, en
# nommant le membre fautif.
MEMBRES_DESCRIPTEUR_MILIEUX <- c(
  "theme", "manifest", "indicateurs", "apercu", "vintages",
  "construire_donnees", "construire_territoires", "construire_indicateurs",
  "construire_apercu", "scalaires", "compute_histoires", "validations"
)

# verifier_descripteur_milieux --------------------------------------------------
# La validation de FORME du descripteur : tout membre requis manquant fait
# échouer la validation bruyamment, en nommant le membre fautif. Exécutée par
# theme_milieux() sur son propre résultat (la construction échoue si le
# descripteur est cassé) et par les tests sur des fixtures négatives.
verifier_descripteur_milieux <- function(descripteur) {
  manquants <- setdiff(MEMBRES_DESCRIPTEUR_MILIEUX, names(descripteur))
  if (length(manquants) > 0) {
    stop("Descripteur Milieux invalide — membre(s) requis manquant(s) : ",
         paste(manquants, collapse = ", "), ".", call. = FALSE)
  }
  invisible(TRUE)
}

# theme_milieux ---------------------------------------------------------------
# Le descripteur du thème Milieux : la même forme de contrat que
# theme_demographie() / theme_habitat(), avec les pièces du thème. Le
# descripteur est validé à la construction (verifier_descripteur_milieux) :
# un membre manquant échoue là où il est construit, jamais plus tard dans la
# machinerie.
theme_milieux <- function() {
  descripteur <- list(
    theme = "milieux",
    manifest = MANIFEST_MILIEUX,
    indicateurs = INDICATEURS_MILIEUX,
    apercu = APERCU_MILIEUX,
    vintages = vintages_milieux,
    construire_donnees = construire_donnees_milieux,
    construire_territoires = construire_territoires_milieux,
    construire_indicateurs = construire_indicateurs_milieux,
    construire_apercu = construire_apercu_milieux,
    scalaires = scalaires_milieux,
    compute_histoires = compute_histoires_milieux,
    validations = validations_milieux
  )
  verifier_descripteur_milieux(descripteur)
  descripteur
}
