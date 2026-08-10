# theme_milieux ---------------------------------------------------------------
# Le module du thème Milieux (issue #171, ADR-0014) : le cinquième bloc de la
# fiche, l'axe terre. Le TRACEUR (#171) a prouvé la machinerie partagée
# (download/compute/publish) pour Milieux : l'ingestion CONSOENAF (le
# manifeste, le reshape m² -> ha, le filtre Bretagne), la table des territoires
# via le squelette partagé, et un payload squelettique publiable. Depuis le
# pivot (#239, ADR-0017), l'indicateur livre SES DEUX clés — l'état
# artificialisé par habitant aux deux millésimes OCS-GE (artif_par_habitant,
# m²/hab, DEUX lignes par territoire, échelle libre — la figure « Intensité
# état ») et la série annuelle 2011-2024 (conso_enaf_annuel, une ligne par
# année, classée sur la PART de la surface du territoire consommée — jamais
# les hectares bruts, ADR-0014). La fenêtre (conso_enaf_fenetre, #172) et la
# trajectoire ZAN (trajectoire_zan, #173) sont mortes avec les flux
# CONSOENAF : leurs figures quittent la fiche, la story porte la trajectoire
# (#63). L'Histoire « Se densifier, s'étaler, ou s'en aller » (#174, pivotée
# par #238) vit ici : la lecture du territoire contre sa terre en STOCK à
# chaque millésime (jamais en flux), sur la règle des TROIS HORLOGES (la
# population, les états OCS-GE, la série annuelle — nommées séparément,
# jamais confondues).
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
#   - la table déclarative INDICATEURS_MILIEUX (les DEUX clés de l'indicateur,
#     pivotées par #239 : l'état M2/M3 + la série annuelle KEPT) et
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

# L'ingestion OCS-GE (issue #234, amendée par #243) -----------------------------
# Les états d'artificialisation OCS-GE entrent dans le pipeline sur la MÊME
# forme que CONSOENAF — manifeste -> lecteur -> normalisation -> agrégation —
# avec TROIS fonctions pures (lecteur / normalisation / agrégation), testées
# sur un petit GPKG de fixture (jamais de réseau dans la boucle de test). La
# source : les HUIT archives millésimées « surfaces artificialisées » du
# produit OCS GE Artificialisation v2.0 de la Géoplateforme (DEUX millésimes
# par département breton, MANIFEST_MILIEUX_OCSGE) — le référentiel ZAN de
# l'État. Depuis l'amendement #243 (ADR-0017), le DIFF est sorti : les couches
# différentielles `zan_evol_*` ne portent QUE les changements — le bug
# flux-et-état documenté dans docs/research/ocs-ge-etat-vs-flux.md — et
# l'ÉTAT est lu dans le produit millésimé, dont chaque polygone porte le
# statut d'artificialisation complet :
#   - Artif             : le statut d'artificialisation du polygone
#     (caractères « artif » / « non artif » — le résultat COMPLET de la
#     méthode officielle en trois étapes : matrice de croisement couverture
#     × usage × seuils du décret 2023-1096 × forçage des surfaces adjacentes
#     au bâti, jamais re-dérivé d'une superposition brute OCCUPATION_SOL) ;
#   - Aire               : la superficie du polygone en m² (EPSG:2154 — le CRS
#     natif du produit) ;
#   - Millesime          : l'année de l'état, DANS la donnée (la fenêtre
#     dérive de la donnée — jamais codée en dur).
# (Descriptif de contenu IGN Doc_artif.pdf + la forme réelle vérifiée à la
# première livraison 2026-08-09 — la source primaire.) La livraison
# Géoplateforme est un .7z (aucun extracteur .7z en R — ni le paquet
# `archive`, ni un binaire 7-Zip) : le seam d'extraction
# (extraire_gpkg_ocsge) est l'étape DOCUMENTÉE avant le lecteur, testée sur le
# format zip que R sait écrire.
#
# PATCH CORRECTIF M2 (22/29/56 — amendement #243) : mesuré le 2026-08-09 sur
# les trois patchs Géoplateforme « PATCHCORRECTIF » du millésime M2 (D022
# 2021, D029 2021, D056 2022 — la couche PATCH_CORR_*, les colonnes cs_corr /
# us_corr « RAS » = pas de correction) : ~20 % des polygones du patch
# inversent le statut artif (22 : 2 001/10 187 = 19,6 %, 29 : 1 674/8 797 =
# 19,0 %, 56 : 2 002/8 029 = 24,9 % — 97 % confirmés par la matrice majoritaire
# de la couche d'état elle-même ; ~16 % / 29 % / 49 % de la surface du patch).
# C'est MATÉRIEL (l'hypothèse « ~0 » de l'amendement ne tient pas) — la bascule
# « au niveau matrice sur ces polygones » (le correctif cs/us -> artif, en
# approximation documentée) est un SUIVI déclaré, pas un blocage du pivot :
# l'impact au niveau communal est borné (~1-2 % de la surface artificialisée M2
# des trois départements — la plupart des anomalies sont bien intra-classe ;
# le 35 n'a pas de patch). Le présent run lit les états TELS QUE publiés par
# l'IGN (jamais re-dérivés).

# COUCHE_OCSGE_ARTIFICIALISATION ----------------------------------------------
# Le MOTIF du nom de la couche dans le GPKG Géoplateforme du produit
# millésimé « surfaces artificialisées » — « artif_{YYYY}_{DD} » (l'année de
# l'état et le département). Confirmé à la première livraison réelle
# (2026-08-09) : la couche du GPKG d'état porte le millésime et le département
# dans son nom. Le nom dérive de LA DONNÉE : le lecteur DISCOUVRE la couche
# par ce motif parmi les couches disponibles, et échoue bruyamment en les
# listant si le motif ne correspond à rien (une dérive du produit doit être
# visible, pas silencieuse).
COUCHE_OCSGE_ARTIFICIALISATION <- "^artif_"

# IDS_OCSGE_ARTIFICIALISATION --------------------------------------------------
# Les ids des huit archives d'état OCS-GE dans le manifeste du thème — l'ordre
# de construction (le builder les lit dans cet ordre, l'ordre du manifeste :
# département puis millésime).
IDS_OCSGE_ARTIFICIALISATION <- c(
  "ocsge_artificialisation_22_2021", "ocsge_artificialisation_22_2025",
  "ocsge_artificialisation_29_2021", "ocsge_artificialisation_29_2024",
  "ocsge_artificialisation_35_2020", "ocsge_artificialisation_35_2023",
  "ocsge_artificialisation_56_2022", "ocsge_artificialisation_56_2024"
)

# lire_ocsge_artificialisation --------------------------------------------------
# Le LECTEUR (pur) : le GPKG Géoplateforme -> les polygones longs de la couche
# d'état, TELS QUELS (les colonnes officielles — on ne re-dérive rien).
# La couche est lue sous COUCHE_OCSGE_ARTIFICIALISATION ; une couche absente
# échoue bruyamment en nommant les couches disponibles (une dérive du produit
# doit être visible, pas silencieuse).
lire_ocsge_artificialisation <- function(chemin,
                                         couche = COUCHE_OCSGE_ARTIFICIALISATION) {
  if (!file.exists(chemin)) {
    stop("Le GPKG OCS-GE est absent : ", chemin, call. = FALSE)
  }
  disponibles <- sf::st_layers(chemin)$name
  # La couche est DISCOUVERTE par le motif (« artif_{YYYY}_{DD} » — le nom
  # dérive de la donnée, jamais codé en dur) : exactement une couche doit
  # correspondre, sinon échec bruyant listant les couches disponibles.
  candidates <- disponibles[grepl(couche, disponibles)]
  if (length(candidates) != 1L) {
    stop("Le GPKG ", basename(chemin), " doit porter EXACTEMENT une couche du ",
         "motif « ", couche, " » (l'état artificialisé Géoplateforme — ",
         "trouvées : ", length(candidates), ") — couches disponibles : ",
         paste(disponibles, collapse = ", "), ".", call. = FALSE)
  }
  sf::st_read(chemin, layer = candidates, quiet = TRUE)
}

# normaliser_ocsge_artificialisation -------------------------------------------
# La NORMALISATION (pure) : la couche d'état officielle -> les mesures en m²
# (EPSG:2154). Le millésime dérive de LA DONNÉE : la colonne `millesime` de la
# couche (jamais codé en dur — la même fonction lit n'importe quel millésime).
# Par polygone :
#   - artif    : la surface (m²) artificialisée du polygone — l'attribut
#     officiel `aire` si le statut `artif` vaut « artif », 0 sinon (la MESURE
#     de l'État est lue, jamais re-dérivée de la géométrie — un polygone
#     « non artif » ne compte pas, c'est le résultat officiel) ;
#   - aire_m2  : la surface du polygone en m², calculée par sf::st_area APRÈS
#     projection EPSG:2154 (le produit est livré en LAMB93 ; la projection est
#     une garantie, pas une hypothèse) — le dénominateur de la pondération ;
#   - millesime : l'année de l'état, lue dans la colonne `millesime`.
# Le produit réel (vérifié à la première livraison, 2026-08-09) porte les
# colonnes en MINUSCULES — artif, aire, millesime — et les statuts « artif » /
# « non artif » : c'est LA forme lue, jamais l'hypothèse capitalisée du
# Doc_artif.pdf. L'intégrité de la couche est vérifiée (un fichier qui dérive
# échoue fort) : les statuts ne valent que « artif » / « non artif », la
# surface `aire` est positive, le millésime est unique. La géométrie est
# rendue valide (le motif des autres lecteurs géométriques du pipeline).
normaliser_ocsge_artificialisation <- function(etat) {
  if (!inherits(etat, "sf")) {
    stop("La couche OCS-GE doit être un objet sf (lire_ocsge_artificialisation).",
         call. = FALSE)
  }
  if (!"artif" %in% names(etat)) {
    stop("La couche d'état OCS-GE doit porter la colonne `artif` (artif / ",
         "non artif).", call. = FALSE)
  }
  if (!"aire" %in% names(etat)) {
    stop("La couche d'état OCS-GE doit porter la colonne `aire` (la surface ",
         "du polygone en m², EPSG:2154).", call. = FALSE)
  }
  if (!"millesime" %in% names(etat)) {
    stop("La couche d'état OCS-GE doit porter la colonne `millesime` (l'année ",
         "de l'état, dans la donnée).", call. = FALSE)
  }
  statuts <- unique(as.character(etat$artif))
  if (!all(statuts %in% c("artif", "non artif"))) {
    stop("artif doit valoir « artif » ou « non artif » — la couche a dérivé.",
         call. = FALSE)
  }
  surf <- as.numeric(etat$aire)
  if (any(surf < 0, na.rm = TRUE) || any(is.na(surf))) {
    stop("aire doit être positive et présente (la superficie du polygone en ",
         "m²) — la couche a dérivé.", call. = FALSE)
  }
  millesimes <- unique(etat$millesime)
  if (length(millesimes) != 1L) {
    stop("La couche d'état OCS-GE doit porter UN SEUL millésime (la colonne ",
         "`millesime` — trouvés : ", paste(millesimes, collapse = ", "),
         ") — la couche a dérivé.", call. = FALSE)
  }
  geometrie <- sf::st_transform(sf::st_geometry(etat), 2154)
  geometrie <- sf::st_make_valid(geometrie)
  sf::st_sf(
    artif = ifelse(as.character(etat$artif) == "artif", surf, 0),
    aire_m2 = as.numeric(sf::st_area(geometrie)),
    millesime = as.integer(millesimes[1]),
    geometry = geometrie
  )
}

# agreger_artificialisation_communes -------------------------------------------
# L'AGRÉGATION (pure) : l'intersection PONDÉRÉE PAR LA SURFACE des polygones
# d'état avec les limites communales -> une ligne par (commune × millésime) :
#   code · artif · millesime
# Un polygone entièrement DANS une commune lui donne sa pleine mesure ; un
# polygone qui TRAVERSE la frontière donne à A et B leurs tranches pondérées
# par la surface — la mesure OFFICIELLE du polygone (artif, en m² — la surface
# artificialisée du polygone, 0 pour un « non artif ») est répartie au prorata
# de la partie de SA géométrie (aire_m2) tombant dans chaque commune. Un
# polygone hors de toutes les communes tombe (aucune commune ne le porte). Le
# millésime est porté par commune (les polygones d'une commune viennent de
# l'archive de SON département × SON millésime — la table reste honnête si
# jamais deux millésimes se croisaient : deux lignes). La géométrie n'est pas
# publiée : la sortie est une table plate (le contrat de la table des
# territoires).
agreger_artificialisation_communes <- function(etat, communes) {
  if (!inherits(etat, "sf") || !inherits(communes, "sf")) {
    stop("etat et communes doivent être des objets sf.", call. = FALSE)
  }
  if (!"code" %in% names(communes)) {
    stop("La couche des communes doit porter la colonne `code` (INSEE).",
         call. = FALSE)
  }
  etat <- etat[etat$aire_m2 > 0, ]  # un polygone de surface nulle ne porte rien
  etat <- sf::st_make_valid(etat)
  communes <- sf::st_make_valid(communes)
  if (sf::st_crs(etat) != sf::st_crs(communes)) {
    communes <- sf::st_transform(communes, sf::st_crs(etat))
  }
  # l'avertissement « attribute variables are assumed to be spatially constant »
  # est le comportement ATTENDU ici : les mesures du polygone sont constantes
  # sur toutes ses tranches (c'est ce que la pondération répartit)
  pieces <- suppressWarnings(
    sf::st_intersection(etat, communes["code"])
  )
  pieces$part <- as.numeric(sf::st_area(pieces)) / pieces$aire_m2
  pieces$artif <- pieces$artif * pieces$part
  pieces <- sf::st_drop_geometry(pieces)
  pieces %>%
    dplyr::group_by(code, millesime) %>%
    dplyr::summarise(
      artif = sum(artif),
      .groups = "drop"
    )
}

# chemin_gpkg_extrait -----------------------------------------------------------
# Le GPKG extrait attendu d'une archive dans le dossier d'extraction : le
# même « stem » que l'archive (le nom de la sous-ressource Géoplateforme),
# cherché en récursif sur le CHEMIN COMPLET — la livraison réelle dépose le
# GPKG dans un DOSSIER nommé d'après le stem (le dossier porte le contrat, pas
# le nom du fichier : « OCS-GE-ARTIFICIALISATION_2-0_DIFF-.../zan_evol_*.gpkg »,
# vérifié à la première livraison 2026-08-08). Retourne le chemin, ou NA si
# aucun GPKG ne correspond.
chemin_gpkg_extrait <- function(extrait, archive) {
  stem <- tools::file_path_sans_ext(basename(archive))
  candidats <- list.files(extrait, pattern = "[.]gpkg$",
                          recursive = TRUE, full.names = TRUE)
  correspond <- candidats[grepl(stem, candidats, fixed = TRUE)]
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
# construire_donnees_milieux pour les états d'artificialisation, #234, amendé
# par #243) : pour CHAQUE archive d'état du manifeste (les huit — deux
# millésimes × quatre départements), extrait l'archive du cache (data/raw — la
# convention du pipeline, jamais un nouveau dossier), lit le GPKG extrait,
# normalise (le millésime dérive de LA DONNÉE — la colonne `millesime` de la
# couche — et doit concorder avec le millésime épinglé à l'id du manifeste :
# un fichier qui dérive échoue fort), puis agrège contre les LIMITES COMMUNALES
# fournies (la couche des communes — le code INSEE dans la colonne `code`).
# L'agrégation par archive produit une ligne par (commune × millésime) ; le
# builder PIVOTE les deux millésimes de chaque département en artif_m2 /
# artif_m3 (la borne M2 = le millésime le plus ancien du département, M3 = le
# plus récent — dérivé des ids du manifeste, jamais codé en dur) et porte les
# millésimes sous LEUR PROPRE NOM (millesime_ocsge_debut/fin — la collision de
# noms avec les millésimes RP de la population est résolue ici, avant la
# jointure). flux_net a QUITTÉ la table (le DIFF est sorti — amendement #243).
# Persiste la table par commune sous data/processed/milieux/ (idempotent) et
# la retourne. Le RACCORD des états OCS-GE dans la table des communes du thème
# (la jointure au payload, les deux horloges de population) est la suite de la
# spec (#225 — ticket payload).
#
# L'AGRÉGATION est découpée PAR DÉPARTEMENT (vérifié à la première livraison
# réelle, 2026-08-08) : chaque archive est découpée par département — mais les
# communes LIMITROPHES reçoivent des polygones résiduels de l'archive du
# département VOISIN (des slivers de livraison, ~0,1–0,3 m² — la frontière
# communale n'est pas la frontière de découpe du fichier). La règle de la spec
# est la fenêtre PAR DÉPARTEMENT : les états d'une commune viennent des
# archives de SON département (le couple M2→M3 épinglé au manifeste). Agrégée
# sans filtre, une commune limitorphe porterait les états du département voisin
# (des polygones d'état tombés dans son quartier) — deux fenêtres qui cassent
# le contrat une-ligne-par-commune (le bug réel découvert par #243). Le filtre
# est l'alignement archive → communes de SON département
# (code_insee_du_departement, la colonne du référentiel Admin Express).
construire_donnees_ocsge <- function(cache = "data/raw",
                                     communes,
                                     sortie = "data/processed/milieux/ocsge_communes.rds") {
  extrait <- file.path(cache, "extracted", "ocsge")
  if (!dir.exists(extrait)) dir.create(extrait, recursive = TRUE)
  if (!"code_insee_du_departement" %in% names(communes)) {
    stop("La couche des communes doit porter code_insee_du_departement (le ",
         "référentiel Admin Express) — le découpage par département de ",
         "l'agrégation OCS-GE en a besoin.", call. = FALSE)
  }

  par_archive <- lapply(IDS_OCSGE_ARTIFICIALISATION, function(id) {
    ligne <- MANIFEST_MILIEUX[MANIFEST_MILIEUX$id == id, ]
    archive <- file.path(cache, ligne$fichier)
    gpkg <- extraire_gpkg_ocsge(archive, extrait)
    etat <- normaliser_ocsge_artificialisation(
      lire_ocsge_artificialisation(gpkg)
    )
    # le millésime dérive de la DONNÉE (la colonne millesime de la couche) et
    # doit CONCORDER avec le millésime épinglé à l'id du manifeste : un fichier
    # déplacé (une archive d'un autre millésime au mauvais nom) est une dérive
    # visible, jamais une NA silencieuse
    millesime_attendu <- as.integer(sub("^ocsge_artificialisation_[0-9]{2}_",
                                        "", id))
    if (!all(unique(etat$millesime) == millesime_attendu)) {
      stop("L'archive ", basename(archive), " porte le millésime ",
           paste(unique(etat$millesime), collapse = ", "),
           " mais le manifeste épingle ", millesime_attendu,
           " — la couche a dérivé.", call. = FALSE)
    }
    dep <- sub("^ocsge_artificialisation_([0-9]{2})_.*", "\\1", id)
    communes_dep <- communes[
      as.character(communes$code_insee_du_departement) == dep, ]
    agreger_artificialisation_communes(etat, communes_dep)
  })
  long <- dplyr::bind_rows(par_archive)

  # les bornes M2/M3 par département, dérivées des ids du manifeste (jamais
  # codées en dur) : M2 = le millésime le plus ancien du département, M3 = le
  # plus récent. La même table sert au pivot (artif_m2/artif_m3) et aux
  # millésimes portés par commune (millesime_ocsge_debut/fin).
  bornes <- MANIFEST_MILIEUX[MANIFEST_MILIEUX$id %in% IDS_OCSGE_ARTIFICIALISATION, ] %>%
    dplyr::mutate(
      departement = sub("^ocsge_artificialisation_([0-9]{2})_.*$", "\\1", id),
      millesime = as.integer(sub("^ocsge_artificialisation_[0-9]{2}_([0-9]{4})$",
                                 "\\1", id))
    ) %>%
    dplyr::group_by(departement) %>%
    dplyr::mutate(borne = dplyr::if_else(
      millesime == min(millesime), "m2", "m3")) %>%
    dplyr::ungroup()

  communes_artif <- long %>%
    dplyr::mutate(departement = substr(code, 1, 2)) %>%
    dplyr::left_join(
      dplyr::select(bornes, departement, millesime, borne),
      by = c("departement", "millesime")
    ) %>%
    tidyr::pivot_wider(id_cols = c(code, departement),
                       names_from = borne, values_from = artif) %>%
    dplyr::rename(artif_m2 = m2, artif_m3 = m3) %>%
    dplyr::left_join(
      bornes %>%
        tidyr::pivot_wider(id_cols = departement,
                           names_from = borne, values_from = millesime) %>%
        dplyr::rename(millesime_ocsge_debut = m2, millesime_ocsge_fin = m3),
      by = "departement"
    ) %>%
    dplyr::select(-departement)

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
# code INSEE. Depuis l'amendement #243, le builder porte les millésimes OCS-GE
# sous LEUR PROPRE NOM (millesime_ocsge_debut / millesime_ocsge_fin — la
# collision de noms avec les millésimes RP de la population est résolue à la
# construction, plus ici) : la jointure est une simple left_join. Une commune
# absente de la table OCS-GE (aucun polygone d'état sur son territoire — un
# désalignement COG, jamais un 0 inventé) garde NA.
rattacher_ocsge_communes <- function(communes, ocsge) {
  dplyr::left_join(communes, ocsge, by = "code")
}

# construire_ocsge_milieux ------------------------------------------------------
# Le raccord OCS-GE du thème (issue #237, spec #225, amendé par #243) : quand
# les archives sont dans le cache, le référentiel géométrique PARTAGÉ
# communes_limites.geojson (le même WFS Admin Express que le thème Mobilité
# lit — lire_communes_limites, la source partagée) est lu, aligné sur les codes
# INSEE de la table des communes (code_insee -> code), puis
# construire_donnees_ocsge agrège les états par commune sur cette géométrie et
# rattacher_ocsge_communes les porte dans la table.
#
# L'ALIGNEMENT COG 2025 (amendement #243) : la géométrie d'intersection doit
# être à l'édition 01/01/2025 du squelette (la base EPCI — COG 2025). Si
# l'édition du cache diffère (des codes du référentiel absents de la base —
# une commune fusionnée portée sous son ancien code, ou une édition plus
# récente), les codes sont TRADUITS via passage_cog (#227 — la table de
# passage INSEE table_passage_annuelle_2025.zip du cache) et RE-SOMMÉS avant
# la jointure : deux anciennes communes traduites vers le même code 2025
# s'agrègent dans la frontière courante (le groupement par code de
# l'agrégation les fusionne). Jamais une NA silencieuse : une édition différente
# SANS la table de passage échoue bruyamment (le strict pour les codes bretons
# est celui de passage_cog — un code non mappé s'arrête en nommant le code).
# Le semi_join final garde les communes de la base — une commune du référentiel
# hors base tombe, une commune de la base hors référentiel reste sans donnée
# -> NA (attrapé par la garde « toute commune a un état > 0 »).
# Une archive présente SANS le référentiel échoue bruyamment (jamais un
# silence) : l'intersection pondérée a besoin de LA géométrie.
construire_ocsge_milieux <- function(cache, communes, sortie) {
  chemin_limites <- file.path(cache, "communes_limites.geojson")
  if (!file.exists(chemin_limites)) {
    stop("Le référentiel géométrique communes_limites.geojson est absent du ",
         "cache (", chemin_limites, ") — nécessaire au raccord OCS-GE (le ",
         "même WFS Admin Express que le thème Mobilité, la source partagée).",
         call. = FALSE)
  }
  limites <- lire_communes_limites(chemin_limites) %>%
    dplyr::rename(code = code_insee)

  # l'édition du cache : tout code du référentiel doit appartenir à la base
  # (COG 2025). Hors base -> l'édition diffère -> traduire via passage_cog.
  base_codes <- unique(as.character(communes$code))
  hors_base <- setdiff(as.character(limites$code), base_codes)
  if (length(hors_base) > 0) {
    zip_cog <- file.path(cache, "table_passage_annuelle_2025.zip")
    if (!file.exists(zip_cog)) {
      stop("L'édition du référentiel communes_limites.geojson du cache diffère ",
           "du COG 2025 de la base (", length(hors_base), " code(s) hors base, ",
           "ex. ", paste(utils::head(hors_base, 3), collapse = ", "), ") et la ",
           "table de passage table_passage_annuelle_2025.zip (le fragment ",
           "partagé cog_passage, #227) est absente du cache — jamais une NA ",
           "silencieuse : fournir la table de passage ou une géométrie COG ",
           "2025.", call. = FALSE)
    }
    mappe <- construire_mappe_cog_bretagne(zip_cog)
    limites$code <- passage_cog(limites$code, mappe)
  }

  limites <- limites %>%
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

# construire_couples_ocsge ------------------------------------------------------
# Les couples (département -> millésimes) DISTINCTS d'un territoire en chaîne
# MACHINE (le pendant de construire_periode_artif pour la table des
# territoires, #243) : « 22:2021:2025|56:2022:2024 », triée par code de
# département. C'est le format que la table des territoires porte (jamais une
# chaîne d'affichage re-parsée) pour que les constructeurs d'indicateurs
# puissent reconstruire les couples d'un territoire — l'ESTAMPILLE des
# territoires multi-fenêtres (l'EPCI transfrontalier, la région) se construit
# depuis SES couples, jamais un couple unique inventé.
construire_couples_ocsge <- function(departements, millesime_debut,
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
  paste0(combos$departement, ":", combos$millesime_debut, ":",
         combos$millesime_fin, collapse = "|")
}

# couples_ocsge_vers_table ------------------------------------------------------
# La table des couples (département, m2, m3) depuis la chaîne machine portée
# par la table des territoires (le format construit par construire_couples_ocsge
# — « 22:2021:2025|56:2022:2024 », jamais une chaîne d'affichage). Une chaîne
# NA -> la table vide (le territoire sans donnée OCS-GE).
couples_ocsge_vers_table <- function(chaine) {
  if (is.na(chaine)) {
    return(tibble::tibble(departement = character(),
                          m2 = integer(), m3 = integer()))
  }
  morceaux <- strsplit(chaine, "|", fixed = TRUE)[[1]]
  do.call(rbind, lapply(morceaux, function(m) {
    parts <- strsplit(m, ":", fixed = TRUE)[[1]]
    tibble::tibble(departement = parts[1],
                   m2 = as.integer(parts[2]),
                   m3 = as.integer(parts[3]))
  }))
}

# estampille_span ---------------------------------------------------------------
# L'estampille CONSTRUITE par le thème pour un territoire multi-fenêtres (l'EPCI
# transfrontalier, la région — #243) : ses faits de vintage sont le SPAN de ses
# couples, jamais une archive unique (le span dit le mélange, il ne l'aplatit
# pas). Les quatre faits sont construits depuis le manifeste — rien d'inventé :
#   - vintage_source  : le produit OCS-GE « surfaces artificialisées » (le
#     préfixe commun des huit archives, extrait de la source du manifeste) ;
#   - vintage_version : la fenêtre span du territoire (la MÊME convention que
#     periode_artif : « 2020-2023 (35) · 2022-2024 (56) ») ;
#   - vintage_date_reference : la plus ANCIENNE référence d'état du span (le
#     premier état de la fenêtre) ;
#   - vintage_date_publication : la plus RÉCENTE publication du span.
estampille_span <- function(couples, manifest = MANIFEST_MILIEUX) {
  ids <- c(paste0("ocsge_artificialisation_", couples$departement, "_",
                  couples$m2),
           paste0("ocsge_artificialisation_", couples$departement, "_",
                  couples$m3))
  lignes <- manifest[manifest$id %in% ids, ]
  span <- construire_periode_artif(couples$departement, couples$m2, couples$m3)
  # le PRODUIT : le préfixe commun des huit archives, extrait de la source du
  # manifeste (« IGN — OCS GE « surfaces artificialisées » v2.0 (Nouvelle
  # Génération) » — la partie avant la précision départementale « — {Nom}
  # ({dep}), millésime {mill} »)
  produit <- sub(" — [^—]*\\([0-9]{2}\\), millésime [0-9]{4}$", "",
                 lignes$source[1])
  tibble::tibble(
    vintage_source = produit,
    vintage_version = span,
    vintage_date_reference = min(lignes$date_reference),
    vintage_date_publication = max(lignes$date_publication)
  )
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
  # OCS-GE, les DEUX mesures d'état (artif_m2 / artif_m3, en m² — l'unité
  # native de l'ingestion ; la conversion en hectares se fait au payload,
  # #238) s'agrègent de la même façon : la somme naïve des membres, NA propagé
  # (une commune sans donnée rend son niveau NA, jamais un 0 inventé). flux_net
  # a QUITTÉ la table (le DIFF est sorti — amendement #243). Et la fenêtre
  # OCS-GE du territoire (periode_artif) dérive des couples (département ->
  # millésimes) distincts de ses membres (le couple du département pour un
  # territoire mono-département, le SPAN pour un EPCI transfrontalier, les
  # quatre fenêtres pour la région — construire_periode_artif).
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
  colonnes_artif <- intersect(c("artif_m2", "artif_m3"), names(base))
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
  # rétro-compatible ne crée pas la colonne). Depuis l'issue #239, le bloc
  # porte AUSSI le couple UNIQUE de chaque territoire (millesime_ocsge_debut /
  # millesime_ocsge_fin) — le détail des deux lignes de l'indicateur
  # artif_par_habitant : un territoire MONO-fenêtre porte son couple (l'année
  # de ses états), un territoire multi-fenêtres (le span de l'EPCI
  # transfrontalier, les quatre fenêtres de la région) ou sans donnée porte
  # NA — jamais un couple inventé.
  if ("millesime_ocsge_debut" %in% names(base)) {
    combos <- base %>%
      dplyr::select(code, departement, epci,
                    m2 = millesime_ocsge_debut, m3 = millesime_ocsge_fin) %>%
      dplyr::filter(!is.na(m2) & !is.na(m3))
    periode_communes <- combos %>%
      dplyr::group_by(code) %>%
      dplyr::summarise(
        periode_artif = construire_periode_artif(departement, m2, m3),
        couples_ocsge = construire_couples_ocsge(departement, m2, m3),
        millesime_ocsge_debut = dplyr::if_else(
          dplyr::n_distinct(m2, m3) == 1L, dplyr::first(m2), NA_integer_),
        millesime_ocsge_fin = dplyr::if_else(
          dplyr::n_distinct(m2, m3) == 1L, dplyr::first(m3), NA_integer_),
        .groups = "drop"
      )
    periode_epci <- combos %>%
      dplyr::filter(!is.na(epci)) %>%
      dplyr::group_by(code = epci) %>%
      dplyr::summarise(
        periode_artif = construire_periode_artif(departement, m2, m3),
        couples_ocsge = construire_couples_ocsge(departement, m2, m3),
        millesime_ocsge_debut = dplyr::if_else(
          dplyr::n_distinct(m2, m3) == 1L, dplyr::first(m2), NA_integer_),
        millesime_ocsge_fin = dplyr::if_else(
          dplyr::n_distinct(m2, m3) == 1L, dplyr::first(m3), NA_integer_),
        .groups = "drop"
      )
    periode_dep <- combos %>%
      dplyr::group_by(code = departement) %>%
      dplyr::summarise(
        periode_artif = construire_periode_artif(departement, m2, m3),
        couples_ocsge = construire_couples_ocsge(departement, m2, m3),
        millesime_ocsge_debut = dplyr::if_else(
          dplyr::n_distinct(m2, m3) == 1L, dplyr::first(m2), NA_integer_),
        millesime_ocsge_fin = dplyr::if_else(
          dplyr::n_distinct(m2, m3) == 1L, dplyr::first(m3), NA_integer_),
        .groups = "drop"
      )
    periode_region <- combos %>%
      dplyr::summarise(
        periode_artif = construire_periode_artif(departement, m2, m3),
        couples_ocsge = construire_couples_ocsge(departement, m2, m3),
        millesime_ocsge_debut = dplyr::if_else(
          dplyr::n_distinct(m2, m3) == 1L, dplyr::first(m2), NA_integer_),
        millesime_ocsge_fin = dplyr::if_else(
          dplyr::n_distinct(m2, m3) == 1L, dplyr::first(m3), NA_integer_),
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
# payload y est déclarée avec ses sources (ids du manifeste), sa source de
# référence (l'id qui l'estampille — les vintages) et sa multiplicité. Les
# DEUX clés du thème, pivotées par #239 sur les états OCS-GE (ADR-0017) :
#   - artif_par_habitant : l'état artificialisé par habitant aux deux
#     millésimes OCS-GE (M2/M3), en m²/hab — DEUX lignes par territoire,
#     detail = le millésime de l'état (le nom « M2 »/« M3 » pour un span
#     multi-dépt). Sa source de référence est le composant SIGNATURE de
#     l'indicateur — l'état artificialisé (les archives d'état OCS-GE), jamais
#     le dénominateur partagé de population (la règle ADR-0009) :
#     ocsge_artificialisation_22_2025, l'archive de l'état FINAL du 22 (la
#     première des HUIT archives du manifeste — une clé ne porte qu'UNE source
#     de référence ; les huit archives partagent le même produit, la source de
#     référence est déclarée, jamais inférée).
#   - conso_enaf_annuel : la série annuelle 2011-2024, en hectares (les champs
#     natifs naf{AA}art{AA+1}) — 14 lignes par territoire, detail = l'année
#     (la multiplicité, comme structure_age pour Démographie) (#172, KEPT par
#     #239 — la seule horloge annuelle).
# La fenêtre (conso_enaf_fenetre) et la trajectoire ZAN (trajectoire_zan)
# sont mortes avec les flux CONSOENAF : leurs clés quittent le payload (#63 —
# la story porte la trajectoire). La clé squelettique du traceur (conso_enaf,
# le total 2011-2025) n'est PAS dans la spec v1 de l'indicateur.
INDICATEURS_MILIEUX <- tibble::tibble(
  key = c("artif_par_habitant", "conso_enaf_annuel"),
  libelle = c(
    "Intensité état — surface artificialisée par habitant aux états OCS-GE (M2/M3), en m²/habitant",
    "Consommation d'espaces naturels, agricoles et forestiers (ENAF) — consommation annuelle, en hectares"
  ),
  sources = list(
    c("ocsge_artificialisation_22_2021", "ocsge_artificialisation_22_2025",
      "ocsge_artificialisation_29_2021", "ocsge_artificialisation_29_2024",
      "ocsge_artificialisation_35_2020", "ocsge_artificialisation_35_2023",
      "ocsge_artificialisation_56_2022", "ocsge_artificialisation_56_2024",
      "serie_historique"),
    "consoenaf"
  ),
  source_reference = c("ocsge_artificialisation_22_2025", "consoenaf"),
  multiplicite = c(2L, 14L)
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
# code, key, detail, value, unit. Chaque clé de l'indicateur (#239) est un
# petit module pur. Une valeur vide reste NA — jamais un 0 inventé.

# intensite_artif_par_habitant --------------------------------------------------
# L'intensité d'état (m²/habitant) aux DEUX millésimes OCS-GE — la SEULE
# source de vérité du calcul par habitant, partagée par l'indicateur
# artif_par_habitant et l'Histoire (compute_histoires_milieux) : jamais une
# seconde formule. Le bracket de population (ADR-0017) : la population du
# millésime qui BORNE l'état — RP 2017 (pop_debut) pour l'état initial M2,
# RP 2023 (pop_fin) pour l'état final M3 — jamais interpolée. Les états
# arrivent en m² (l'unité native de la table des territoires) : la valeur
# par habitant est m² / population. Un état NA (fenêtre incomplète) ou une
# population absente rend l'intensité NA — jamais un 0 inventé.
intensite_artif_par_habitant <- function(artif_m2, pop_debut, artif_m3, pop_fin) {
  list(
    artif_m2_par_habitant = artif_m2 / pop_debut,
    artif_m3_par_habitant = artif_m3 / pop_fin
  )
}

# detail_etats_artif ------------------------------------------------------------
# Le détail des DEUX lignes de l'état par habitant : le MILLÉSIME de l'état
# (l'année M2 / l'année M3) quand le territoire porte un couple OCS-GE
# UNIQUE, le NOM de l'état (« M2 » / « M3 ») sinon — un territoire
# multi-fenêtres (l'EPCI transfrontalier, la région dont la fenêtre est un
# span) n'a pas de paire unique, un territoire sans donnée n'a pas de
# millésime : jamais une année inventée (spec #225). Le couple unique est
# porté par la table des territoires (millesime_ocsge_debut / _fin,
# agreger_territoires_milieux — NA pour le span), jamais re-parsé d'une
# chaîne d'affichage.
detail_etats_artif <- function(territoires) {
  list(
    m2 = ifelse(is.na(territoires$millesime_ocsge_debut), "M2",
                as.character(territoires$millesime_ocsge_debut)),
    m3 = ifelse(is.na(territoires$millesime_ocsge_fin), "M3",
                as.character(territoires$millesime_ocsge_fin))
  )
}

# indicator_artif_par_habitant : l'état artificialisé par habitant (m²/hab)
# aux DEUX millésimes OCS-GE — la figure « Intensité état » (issue #239, spec
# #225, ADR-0017), DEUX lignes par territoire (la multiplicité de la clé) :
# la ligne M2 puis la ligne M3, detail = le millésime de l'état (l'année pour
# une fenêtre unique, « M2 »/« M3 » pour le span — detail_etats_artif), value
# = l'intensité d'état calculée par la source de vérité partagée
# (intensite_artif_par_habitant — le MÊME calcul que l'Histoire, jamais une
# seconde formule). DEPUIS #243, chaque ligne porte SA source de référence :
#   - un territoire mono-couple : l'archive du département × le millésime de
#     LA LIGNE (Rennes 2020 -> ocsge_artificialisation_35_2020, 2023 ->
#     35_2023) — jamais l'archive uniforme du passé qui faisait dire à Rennes
#     « Côtes-d'Armor (22), millésime 2025 » ;
#   - un territoire multi-fenêtres (l'EPCI transfrontalier, la région) : le
#     SPAN de ses fenêtres (la MÊME convention que periode_artif : « 2020-2023
#     (35) · 2022-2024 (56) ») — jamais un couple unique inventé — et son
#     estampille CONSTRUITE par le thème depuis ses couples (estampille_span —
#     le produit, la fenêtre span, la référence la plus ancienne, la
#     publication la plus récente ; les lignes mono-couple portent NA et sont
#     estampillées par la machinerie partagée depuis la table des vintages).
# La colonne source_reference reste dans le payload pour les lignes qui en
# portent une (la garde d'estampille lit les refs par ligne du payload).
# Chemin rétro-compatible (cache sans archives OCS-GE, #237) : la table ne
# porte pas les états — les DEUX lignes restent publiées, toutes NA (le
# contrat de multiplicité tient, jamais une valeur inventée).
indicator_artif_par_habitant <- function(territoires) {
  if (!"artif_m2" %in% names(territoires)) {
    return(tibble::tibble(
      code = rep(territoires$code, each = 2L),
      key = "artif_par_habitant",
      detail = rep(c("M2", "M3"), nrow(territoires)),
      value = NA_real_,
      unit = "m²/hab"
    ))
  }
  intensite <- intensite_artif_par_habitant(
    territoires$artif_m2, territoires$pop_debut,
    territoires$artif_m3, territoires$pop_fin
  )
  details <- detail_etats_artif(territoires)

  # la source de référence PAR LIGNE (issue #243) : l'archive du département
  # × le millésime de la ligne pour une fenêtre unique (millesime_ocsge_debut
  # / _fin non NA), le SPAN pour un territoire multi-fenêtres (periode_artif —
  # la ref par ligne d'un span est le span lui-même, jamais une archive).
  mono <- !is.na(territoires$millesime_ocsge_debut)
  ref_debut <- ifelse(mono,
                      paste0("ocsge_artificialisation_", territoires$departement,
                             "_", territoires$millesime_ocsge_debut),
                      territoires$periode_artif)
  ref_fin <- ifelse(mono,
                    paste0("ocsge_artificialisation_", territoires$departement,
                           "_", territoires$millesime_ocsge_fin),
                    territoires$periode_artif)

  # l'estampille des lignes-span : construite par le thème depuis les couples
  # du territoire (estampille_span — le produit, la fenêtre span, les dates du
  # manifeste) ; les lignes mono-couple portent NA (la machinerie partagée
  # estampille depuis la table des vintages — jamais une seconde formule).
  span <- !is.na(territoires$periode_artif) & !mono
  v_source <- rep(NA_character_, nrow(territoires))
  v_version <- rep(NA_character_, nrow(territoires))
  v_reference <- rep(NA_character_, nrow(territoires))
  v_publication <- rep(NA_character_, nrow(territoires))
  if (any(span)) {
    for (i in which(span)) {
      est <- estampille_span(couples_ocsge_vers_table(territoires$couples_ocsge[i]))
      v_source[i] <- est$vintage_source
      v_version[i] <- est$vintage_version
      v_reference[i] <- est$vintage_date_reference
      v_publication[i] <- est$vintage_date_publication
    }
  }

  tibble::tibble(
    code = rep(territoires$code, each = 2L),
    key = "artif_par_habitant",
    detail = as.vector(rbind(details$m2, details$m3)),
    value = as.vector(rbind(intensite$artif_m2_par_habitant,
                            intensite$artif_m3_par_habitant)),
    unit = "m²/hab",
    source_reference = as.vector(rbind(ref_debut, ref_fin)),
    vintage_source = rep(v_source, each = 2L),
    vintage_version = rep(v_version, each = 2L),
    vintage_date_reference = rep(v_reference, each = 2L),
    vintage_date_publication = rep(v_publication, each = 2L)
  )
}

# indicator_conso_enaf_annuel : la série annuelle 2011-2024 — les 14 champs
# natifs naf{AA}art{AA+1} (chaque colonne = UNE année : naf11art12 = 2011, ...
# naf24art25 = 2024), pivotés en 14 lignes par territoire, detail = l'année
# (la multiplicité de la clé). La liste des colonnes se construit depuis la
# plage d'années — jamais un sous-ensemble implicite : une colonne manquante
# (une dérive de forme du fichier) échoue fort au lieu de publier une série
# amputée. KEPT par #239 : la seule horloge annuelle de la fiche.
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

# construire_indicateurs_milieux : le thème déclare SES constructeurs — la
# liste nommée des tables longues que compute_payload() assemble. Les DEUX
# clés du pivot (issue #239) : l'état par habitant (artif_par_habitant) et la
# série annuelle (conso_enaf_annuel). La fenêtre (conso_enaf_fenetre) et la
# trajectoire ZAN (trajectoire_zan) sont mortes avec les flux CONSOENAF :
# leurs constructeurs sont supprimés (#63).
construire_indicateurs_milieux <- function(territoires) {
  list(
    artif_par_habitant = indicator_artif_par_habitant(territoires),
    conso_enaf_annuel = indicator_conso_enaf_annuel(territoires)
  )
}

# Les scalaires de classement du thème -----------------------------------------
# Le scalaire classé par indicateur : la valeur elle-même pour les clés
# scalaires, le scalaire déclaré pour les multi-valeurs (issue #13 — ex.
# structure_age classée par la part des moins de 20 ans). Pour Milieux
# (#239) :
#   - conso_enaf_annuel garde SON scalaire d'origine (KEPT) : la PART de la
#     surface du territoire consommée sur la fenêtre 2021-2025 — jamais les
#     hectares bruts (une grande commune a plus de terre ; ADR-0014) ; ses
#     14 lignes partagent le rang du territoire (comme structure_age réplique
#     le rang de la part des moins de 20 ans sur ses 7 tranches) ;
#   - artif_par_habitant est ÉCHELLE LIBRE par construction (le m²/habitant
#     est déjà par habitant — aucune normalisation de surface) : le scalaire
#     classé est l'état à M3 lui-même, et les DEUX lignes du territoire
#     partagent le rang de cet état final (le même motif multi-détails que la
#     série annuelle).

# part_surface_consoenaf : la part de la surface du territoire consommée sur
# la fenêtre 2021-2025. La consommation publiée est en hectares (naf21art25,
# convertie au reshape) ; la surface est la mesure du référentiel en m²
# (surfcom2025, jamais convertie — le décor) : on repasse la consommation en
# m² (x 10 000) avant de diviser. Un territoire à fenêtre incomplète (NA)
# porte une part NA — jamais un 0 inventé, jamais un rang fabriqué.
part_surface_consoenaf <- function(territoires) {
  territoires$naf21art25 * 10000 / territoires$surfcom2025
}

# intensite_etat_m3 : le scalaire classé de l'indicateur artif_par_habitant —
# l'intensité d'état à M3 (m²/hab), la valeur de l'état final publiée TEL QUE
# (échelle libre par construction : déjà par habitant, aucune normalisation de
# surface). Les DEUX lignes du territoire partagent le rang de cet état final.
# Chemin rétro-compatible (sans états OCS-GE) : tout NA — aucun rang fabriqué.
intensite_etat_m3 <- function(territoires) {
  if (!"artif_m2" %in% names(territoires)) {
    return(rep(NA_real_, nrow(territoires)))
  }
  intensite_artif_par_habitant(
    territoires$artif_m2, territoires$pop_debut,
    territoires$artif_m3, territoires$pop_fin
  )$artif_m3_par_habitant
}

scalaires_milieux <- list(
  artif_par_habitant = intensite_etat_m3,
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

  # l'intensité d'état (m²/habitant) aux deux millésimes — la SEULE source de
  # vérité du calcul par habitant (intensite_artif_par_habitant), la MÊME que
  # l'indicateur artif_par_habitant (jamais une seconde formule) : la
  # population du millésime qui BORNE l'état (le bracket, ADR-0017 : RP 2017
  # pour l'état initial, RP 2023 pour l'état final — jamais interpolé). Un
  # état NA rend l'intensité NA.
  intensite <- intensite_artif_par_habitant(
    base$artif_m2, base$pop_debut, base$artif_m3, base$pop_fin
  )
  base$artif_m2_par_habitant <- intensite$artif_m2_par_habitant
  base$artif_m3_par_habitant <- intensite$artif_m3_par_habitant

  base %>%
    dplyr::mutate(
      # les états en hectares (m² -> ha, ÷ 10 000 — la conversion documentée,
      # testée ; jamais silencieusement trustée)
      artif_m2 = artif_m2 / 10000,
      artif_m3 = artif_m3 / 10000,
      # la trajectoire : le ratio M3/M2 par habitant — la seconde force de la
      # lecture. Algébriquement = croissance de la terre ÷ croissance de la
      # population. Le ratio est INDÉFINI quand le dénominateur (le M2 par
      # habitant) est nul — un territoire sans AUCUNE terre artificialisée à
      # l'état initial (le cas réel découvert par #243 : 102 communes
      # bretonnes sur 1 266, ~8 %) : M3/0 n'a pas de sens, la seconde force ne
      # se lit pas, la lecture est NA (jamais un « s'étale » inventé sur un
      # rapport infini). Quand le dénominateur est strictement positif,
      # sign(ratio − 1) = sign(delta) par construction (l'invariant ADR-0017).
      trajectoire_artif_par_habitant =
        dplyr::if_else(
          artif_m2_par_habitant == 0, NA_real_,
          artif_m3_par_habitant / artif_m2_par_habitant
        ),
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
# exécutées par validate_payload() après ses vérifications génériques. Depuis
# le pivot (#239, ADR-0017) : la série annuelle KEPT (#172), l'état par
# habitant (artif_par_habitant), l'invariant ratio/delta de l'Histoire et —
# depuis l'amendement #243 — la garde « toute commune a un état > 0 ».
validations_milieux <- list(
  # la consommation d'ENAF annuelle est un total non négatif (une valeur NA —
  # commune sans donnée, total de niveau incomplet — est un cas légitime,
  # jamais une corruption ; une valeur négative est un fichier qui dérive)
  function(payload) {
    conso <- payload$indicateurs$value[
      payload$indicateurs$key == "conso_enaf_annuel"]
    if (any(!is.na(conso) & conso < 0)) {
      stop("Payload invalide : une consommation d'ENAF négative.",
           call. = FALSE)
    }
    invisible(payload)
  },
  # l'intensité d'état (m²/hab) est non négative — une surface artificialisée
  # par habitant négative est un fichier qui dérive (le NA — état incomplet —
  # est un cas légitime)
  function(payload) {
    intensite <- payload$indicateurs$value[
      payload$indicateurs$key == "artif_par_habitant"]
    if (any(!is.na(intensite) & intensite < 0)) {
      stop("Payload invalide : une intensité d'état (m²/hab) négative.",
           call. = FALSE)
    }
    invisible(payload)
  },
  # l'invariant ratio/delta (ADR-0017) : sign(ratio − 1) = sign(delta) où
  # delta = artif_m3_par_habitant − artif_m2_par_habitant — le dénominateur du
  # ratio (le M2 par habitant) est positif quand le ratio est défini : la
  # classification et le graphe quadrant ne peuvent jamais se contredire. Où
  # le ratio n'est pas défini (état initial nul, fenêtre incomplète), rien
  # n'est prouvé — jamais une contradiction.
  function(payload) {
    h <- payload$histoires
    defini <- !is.na(h$artif_m2_par_habitant) &
      h$artif_m2_par_habitant > 0 & is.finite(h$artif_m2_par_habitant) &
      !is.na(h$artif_m3_par_habitant) &
      !is.na(h$trajectoire_artif_par_habitant)
    if (any(defini)) {
      ratio <- h$trajectoire_artif_par_habitant[defini]
      delta <- h$artif_m3_par_habitant[defini] -
        h$artif_m2_par_habitant[defini]
      if (any(sign(ratio - 1) != sign(delta))) {
        stop("Payload invalide : l'invariant ratio/delta est violé ",
             "(sign(ratio − 1) = sign(delta)).", call. = FALSE)
      }
    }
    invisible(payload)
  },
  # la garde « toute commune a un état > 0 » (amendement #243, ADR-0017) :
  # l'état est un STOCK — une commune bâtie n'a jamais 0, et le produit
  # millésimé couvre tout le département (une commune sans état est une
  # corruption). La garde attrape à la fois le bug flux-et-état (un état nul
  # publié — les 102 communes à M2 = 0 du payload différentiel) et un
  # désalignement COG qui produirait des NA (une commune absente de
  # l'intersection). Chemin rétro-compatible (cache sans archives OCS-GE) :
  # AUCUN état publié -> rien à vérifier (le schéma du pivot reste présent,
  # tout NA). Dès qu'au moins une commune porte un état, TOUTES les communes
  # doivent porter les DEUX états, strictement positifs.
  function(payload) {
    communes <- payload$histoires[
      payload$histoires$type == "commune", ]
    if (all(is.na(communes$artif_m2))) {
      return(invisible(payload))
    }
    etat <- communes$artif_m2 / communes$artif_m3  # NA si l'un manque
    defectueuses <- is.na(etat) | communes$artif_m2 <= 0 |
      communes$artif_m3 <= 0
    if (any(defectueuses)) {
      stop("Payload invalide : des communes sans état artificialisé ",
           "strictement positif (le stock n'est jamais 0, une commune bâtie ",
           "a toujours de la terre artificialisée) — le bug flux-et-état ou ",
           "un désalignement COG : ",
           paste(utils::head(communes$territoire[defectueuses], 5),
                 collapse = ", "), ".", call. = FALSE)
    }
    invisible(payload)
  },
  # les sources de référence PAR LIGNE de l'état (issue #243) : chaque ligne
  # d'état porte SA source de référence, et elle est soit un id du manifeste
  # (le couple département × millésime de la ligne — vérifié contre la table
  # des vintages par la garde générique), soit un SPAN de fenêtres (l'EPCI
  # transfrontalier, la région — pas d'id, des faits de vintage CONSTRUITS par
  # le thème). La construction du span est vérifiée ICI, jamais par la garde
  # générique : le span EST le version de l'estampille (la même chaîne que la
  # ref), le produit est le produit OCS-GE, la référence et la publication
  # sont des dates présentes — une dérive de la construction échoue fort.
  function(payload) {
    etat <- payload$indicateurs[
      payload$indicateurs$key == "artif_par_habitant", ]
    if (!"source_reference" %in% names(etat)) {
      return(invisible(payload))  # chemin rétro-compatible (sans refs par ligne)
    }
    if (any(is.na(etat$source_reference))) {
      stop("Payload invalide : une ligne d'état sans source de référence ",
           "par ligne.", call. = FALSE)
    }
    v <- vintages_milieux()
    span <- !etat$source_reference %in% v$id
    if (any(span)) {
      if (any(etat$vintage_version[span] != etat$source_reference[span])) {
        stop("Payload invalide : une estampille span ne porte pas sa fenêtre ",
             "(le version d'un territoire multi-dépt est SON span — jamais un ",
             "couple unique).", call. = FALSE)
      }
      if (any(!grepl("^IGN — OCS GE « surfaces artificialisées »",
                     etat$vintage_source[span]))) {
        stop("Payload invalide : une estampille span ne cite pas le produit ",
             "OCS-GE.", call. = FALSE)
      }
      if (any(is.na(etat$vintage_date_reference[span]) |
              is.na(etat$vintage_date_publication[span]) |
              !grepl("^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
                     etat$vintage_date_reference[span]) |
              !grepl("^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
                     etat$vintage_date_publication[span]))) {
        stop("Payload invalide : une estampille span sans ses deux dates ",
             "(la référence la plus ancienne, la publication la plus récente).",
             call. = FALSE)
      }
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
# construire_apercu, scalaires, compute_histoires, validations, et — depuis
# l'amendement #243 — retire_vintages, les ids retirés du manifeste du thème
# que le run retire de la table partagée des vintages). La même idée que
# verifier_contrat_milieux : un descripteur incomplet échoue FORT, en nommant
# le membre fautif.
MEMBRES_DESCRIPTEUR_MILIEUX <- c(
  "theme", "manifest", "indicateurs", "apercu", "vintages",
  "construire_donnees", "construire_territoires", "construire_indicateurs",
  "construire_apercu", "scalaires", "compute_histoires", "validations",
  "retire_vintages"
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
    validations = validations_milieux,
    # les ids RETIRÉS du manifeste par l'amendement #243 : les quatre
    # différentielles OCS-GE (ocsge_artificialisation_22/29/35/56) sorties au
    # profit des huit archives d'état millésimées — le run les retire de la
    # table partagée des vintages au merge (fusionner_vintages, jamais laissées
    # estampiller « fraîche » à côté de leur remplaçante)
    retire_vintages = c(
      "ocsge_artificialisation_22", "ocsge_artificialisation_29",
      "ocsge_artificialisation_35", "ocsge_artificialisation_56"
    )
  )
  verifier_descripteur_milieux(descripteur)
  descripteur
}
