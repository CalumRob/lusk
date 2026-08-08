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
#     « Se densifier, s'étaler, ou s'en aller » (issue #174).
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

  if (!dir.exists(dirname(sortie))) dir.create(dirname(sortie), recursive = TRUE)
  readr::write_rds(communes, sortie)
  communes
}

# La construction de la table des territoires du thème -------------------------
# Le squelette partagé (squelette_territoires, compute.R) fournit les codes,
# les vrais noms, la hiérarchie et la règle de pluralité départementale ; le
# thème ajoute SES colonnes d'agrégation : les consommations d'ENAF (toutes les
# colonnes du reshape, déjà en hectares), sommées par niveau de territoire.

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
agreger_territoires_milieux <- function(communes, squelette) {
  base <- communes %>%
    dplyr::mutate(dplyr::across(c(departement, epci), as.character))
  colonnes_conso <- conso_en_m2(names(base))
  # les mesures agrégées du thème : les consommations + la surface (le
  # scalaire classé, #172) + la consommation de fenêtre et les populations de
  # l'Histoire (#174)
  colonnes_mesure <- c(colonnes_conso, "surfcom2025",
                       "conso_fenetre", "pop_debut", "pop_fin")

  mesures <- dplyr::bind_rows(
    base[c("code", colonnes_mesure)],
    base %>%
      dplyr::group_by(epci) %>%
      dplyr::summarise(
        dplyr::across(dplyr::all_of(colonnes_mesure), sum),
        .groups = "drop"
      ) %>%
      dplyr::rename(code = epci),
    base %>%
      dplyr::group_by(departement) %>%
      dplyr::summarise(
        dplyr::across(dplyr::all_of(colonnes_mesure), sum),
        .groups = "drop"
      ) %>%
      dplyr::rename(code = departement),
    base %>%
      dplyr::summarise(
        dplyr::across(dplyr::all_of(colonnes_mesure), sum),
        .groups = "drop"
      ) %>%
      dplyr::mutate(code = "53")
  )

  territoires <- dplyr::left_join(squelette, mesures, by = "code")
  # les millésimes de la fenêtre : des constantes du run — la première valeur
  # non manquante des communes (la même paire partout), portées pour l'Histoire
  territoires$millesime_debut <-
    stats::na.omit(unique(communes$millesime_debut))[1]
  territoires$millesime_fin <-
    stats::na.omit(unique(communes$millesime_fin))[1]
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

# SEUIL_INTENSITE_MILIEUX ------------------------------------------------------
# Le seuil « près de zéro » de l'intensité (m² d'ENAF par habitant ajouté,
# #174). Le recensement est un DÉNOMBREMENT exact (un entier), jamais un
# échantillon : « significativement positif » veut dire au moins UN habitant
# ajouté sur la fenêtre. L'intensité est publiée seulement quand le
# Δpopulation ≥ ce seuil (elle n'a pas de sens pour un territoire qui ne gagne
# pas d'habitants — 0 ou négatif, elle serait infinie ou négative) ; la
# classification, elle, ne s'appuie que sur les signes (seuil 0 — ZAN est un
# objectif zéro, un 0 est un vrai 0, jamais du bruit d'échantillon).
SEUIL_INTENSITE_MILIEUX <- 1

# compute_histoires_milieux -----------------------------------------------------
# L'Histoire « Se densifier, s'étaler, ou s'en aller » (issue #174, ADR-0014) :
# la lecture du territoire contre sa terre. Deux forces, chacune lue par le
# SIGNE seul (seuil 0, la règle des quadrants d'ADR-0011) :
#   - le Δpopulation  = pop_fin - pop_debut — les populations de la SÉRIE
#     HISTORIQUE du recensement aux DEUX millésimes de la fenêtre (la règle de
#     source d'ADR-0014 : jamais les populations embarquées de CONSOENAF) ;
#   - la consommation = conso_fenetre — les ANNUELS CONSOENAF re-sommés sur la
#     MÊME fenêtre (la règle des DEUX HORLOGES : la fenêtre dérive des
#     millésimes de la série, jamais codée en dur ; les totaux de période ne
#     sont jamais sommés).
# Les quatre lectures, une par territoire, exactement une (déterministe :
# même territoire + mêmes données -> même lecture, toujours) :
#   grandir-en-se-densifiant               Δpop > 0, consommation == 0
#   grandir-en-setalant                    Δpop > 0, consommation > 0
#   sen-aller-et-consommer-quand-meme      Δpop <= 0, consommation > 0
#   les-departs-laissent-la-place-a-la-renaturation  Δpop <= 0, consommation == 0
# (zéro compte négatif, comme Démographie : un Δpopulation nul ou une
# consommation nulle ne sont jamais du bruit — la donnée est un dénombrement).
# Une force NA (total de niveau incomplet, population absente de la série)
# rend la lecture NA — jamais une lecture inventée. L'intensité (m² d'ENAF par
# habitant ajouté) est publiée seulement quand le Δpopulation est
# significativement positif (SEUIL_INTENSITE_MILIEUX) ; sous le seuil, NA. La
# fenêtre dérivée est portée par la colonne `periode` (« 2017-2023 ») — la
# date du titre du Story, jamais inventée.
compute_histoires_milieux <- function(territoires) {
  territoires %>%
    dplyr::mutate(
      delta_population = pop_fin - pop_debut,
      # l'intensité : la consommation de la fenêtre (ha) × 10 000 pour des m²,
      # divisée par les habitants ajoutés — NA quand le Δpopulation n'est pas
      # significativement positif (le dénombrement est exact : sous 1 habitant
      # ajouté, pas d'« habitants ajoutés » à rapporter à la consommation)
      intensite_m2_par_habitant = dplyr::if_else(
        delta_population >= SEUIL_INTENSITE_MILIEUX,
        conso_fenetre * 10000 / delta_population,
        NA_real_
      ),
      classification = dplyr::case_when(
        delta_population > 0 & conso_fenetre == 0 ~ "grandir-en-se-densifiant",
        delta_population > 0 & conso_fenetre > 0 ~ "grandir-en-setalant",
        delta_population <= 0 & conso_fenetre > 0 ~
          "sen-aller-et-consommer-quand-meme",
        delta_population <= 0 & conso_fenetre == 0 ~
          "les-departs-laissent-la-place-a-la-renaturation"
      )
    ) %>%
    dplyr::transmute(
      territoire = code,
      type = type,
      theme = "milieux",
      story_key = "se-densifier-setaler-ou-sen-aller",
      # la fenêtre dérivée de la série historique — la date du titre du Story,
      # jamais codée en dur (les deux horloges, ADR-0014)
      periode = paste0(millesime_debut, "-", millesime_fin),
      delta_population,
      conso_fenetre,
      intensite_m2_par_habitant,
      classification
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
