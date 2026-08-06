# theme_mobilite ---------------------------------------------------------------
# Le module du thème Mobilité (issues #137 tracer bullet + #138 la chaîne
# analytique flagship + #140 le sous-bloc « L'offre de mobilité alternative ») :
# le descripteur theme_mobilite() que la machinerie partagée
# (download/compute/publish) consomme sans jamais nommer le thème — la même
# forme de contrat que theme_economie() (issue #96) et
# theme_demographie()/theme_habitat().
#
# Ce qui vit ici, ce qui ne vit pas ici :
#   - le manifeste des sources : le snapshot PORTÉ de l'analyse
#     d'accessibilité « Vingt minutes sans voiture » + les cinq sources du
#     sous-bloc (korrigo GTFS, mobibreizh-stops, communes-france,
#     bornes-recharges, stationnement-velo) — manifest_mobilite.R, SIX lignes
#     concaténées, chaque source garde SA référence et SA publication ;
#   - la construction des données : la normalisation du snapshot porté (le
#     lecteur du CSV + le normaliseur : identité vérifiée, métriques
#     numérisées, la table complète des 2 061 colonnes conservée) + les
#     lecteurs/normaliseurs des sources du sous-bloc (sources_offre_mobilite.R) ;
#   - le builder de vintages (la projection générique depuis le manifeste,
#     vintages_depuis_manifest, vintage.R) ;
#   - le SEAM de calcul : construire_analytiques_mobilite enchaîne la table
#     communale (la « Taille » du thème : nb_buildings), l'agrégation aux
#     quatre niveaux (recalculée depuis les parties — jamais une moyenne) et
#     le chaînon analytique FLAGSHIP (issue #138) — les 5 parts d'isolation,
#     div_loss_t/b (la neutralité modale sur la base d'abord), la signature de
#     densité + le nuage même-échelle, la saillance et les rangs-en-contexte —
#     puis le sous-bloc (issue #140) : l'offre TC (la jointure SPATIALE arrêts
#     Korrigo × communes à 500 m, le proxy documenté), les bornes IRVE et le
#     stationnement vélo du hub Ecolab (les builders vivent dans
#     analytics_mobilite.R, persistés sous data/processed/mobilite/ — la
#     matière que le ticket payload #141 assemble) ;
#   - le SEAM de publication : publier_mobilite — le payload contractuel
#     (territoires / indicateurs / histoires / apercu) publié par la
#     machinerie partagée publish. Les quatre indicateurs publiés : la
#     « Taille » (nb_buildings) et les trois clés du sous-bloc.
# Ce qui N'y vit PAS : aucun calcul d'indicateur de la grille (la matière
# analytique est au ticket #138, l'assemblage des clés au #141), aucun étage
# demande/réseaux (ticket #139), aucune modification de theme_demographie /
# theme_economie / theme_habitat ni du cœur partagé (compute.R, publish.R).

# construire_donnees_mobilite --------------------------------------------------
# L'acte « trouver la donnée » du thème : le lecteur lit le snapshot porté
# (le CSV du cache, une ligne par commune), le normaliseur le valide et le
# nettoie (identité vérifiée, métriques numérisées), et la table complète est
# persistée sous data/processed/mobilite/ (idempotent, comme les builders des
# sources). Issue #140 : le seam assemble aussi les CINQ sources du sous-bloc
# « L'offre de mobilité alternative » (construire_sources_offre_mobilite —
# korrigo GTFS, mobibreizh-stops, communes-france, bornes-recharges,
# stationnement-velo), chacune lue dans le cache et normalisée par SON
# normaliseur (sources_offre_mobilite.R), jamais re-persistée ici (la matière
# des indicateurs est l'affaire du chaînon analytique). Les paramètres
# `snapshot` et `sources` permettent aux tests de passer les fixtures
# directement : le chemin de code de normalisation est le même que pour les
# fichiers réels.
construire_donnees_mobilite <- function(cache = "data/raw",
                                        sortie = "data/processed/mobilite/mobilite_snapshot.rds",
                                        snapshot = NULL,
                                        sources = NULL) {
  if (is.null(snapshot)) {
    snapshot <- lire_snapshot_mobilite(
      file.path(cache, MANIFEST_MOBILITE_SNAPSHOT$fichier)
    )
  }
  if (is.null(sources)) {
    sources <- construire_sources_offre_mobilite(cache)
  }

  table <- normaliser_snapshot_mobilite(snapshot)

  if (!dir.exists(dirname(sortie))) dir.create(dirname(sortie), recursive = TRUE)
  readr::write_rds(table, sortie)

  c(list(mobilite_snapshot = table), sources)
}

# vintages_mobilite ------------------------------------------------------------
# Le builder de vintages du thème : la projection générique depuis le
# manifeste — une source, SA référence (l'instantané de l'analyse) et SA
# publication (le portage), jamais alignées.
vintages_mobilite <- function() {
  vintages_depuis_manifest(MANIFEST_MOBILITE)
}

# agreger_nb_buildings_territoires ---------------------------------------------
# La « Taille » du thème par niveau : le nombre de bâtiments résidentiels
# analysés (nb_buildings du snapshot porté). La table communale est déclinée
# aux QUATRE niveaux (commune / EPCI / département / région) en appliquant la
# règle d'agrégation décidée — la SOMME des parties, jamais une moyenne :
#   - commune : la valeur communale telle quelle ;
#   - EPCI : la somme des communes membres — les communes sans EPCI (les
#     îles, fix « Sans objet » #131) n'y entrent jamais ;
#   - département : la somme des communes du département ;
#   - région : la somme de toutes les communes.
# Une commune absente du snapshot (les deux non couvertes par l'analyse) n'a
# pas de ligne ici — l'alignement sur la référence du squelette se fait à
# l'assemblage du payload (la ligne existe avec NA, jamais une ligne manquante).
# Déterministe : trié par code.
agreger_nb_buildings_territoires <- function(communes, base_epci) {
  ctx <- communes %>%
    dplyr::left_join(base_epci[c("CODGEO", "EPCI", "DEP")],
                     by = c("commune" = "CODGEO"))

  dplyr::bind_rows(
    ctx %>%
      dplyr::select(commune, nb_buildings) %>%
      dplyr::rename(code = commune),
    ctx %>%
      dplyr::filter(!is.na(EPCI)) %>%
      dplyr::group_by(code = EPCI) %>%
      dplyr::summarise(nb_buildings = sum(nb_buildings), .groups = "drop"),
    ctx %>%
      dplyr::group_by(code = DEP) %>%
      dplyr::summarise(nb_buildings = sum(nb_buildings), .groups = "drop"),
    ctx %>%
      dplyr::summarise(code = "53",
                       nb_buildings = sum(nb_buildings), .groups = "drop")
  ) %>%
    dplyr::rename(value = nb_buildings) %>%
    dplyr::arrange(code)
}

# COLONNES_ANALYTIQUES_MOBILITE ------------------------------------------------
# Les colonnes REQUISES du chaînon analytique flagship (issue #138) : l'identité
# + les familles que les builders consomment (les parts d'accès share_*_t, les
# médianes div_loss, pct_iso_full_t, les signatures de densité dens_div_t_* /
# div_loss_t_dec_* — et leurs niveaux _epci/_dep/_reg). Toute colonne requise
# manquante (une vague qui change de structure) arrête le run ICI, avant la
# moindre écriture — jamais un succès partiel silencieux.
COLONNES_ANALYTIQUES_MOBILITE <- c(
  "commune", "nb_buildings",
  unname(CLES_ISOLATION_MOBILITE),
  "med_div_loss_t", "med_div_loss_b", "pct_iso_full_t",
  "med_div_loss_t_epci", "med_div_loss_b_epci", "pct_iso_full_t_epci",
  "med_div_loss_t_dep", "med_div_loss_b_dep", "pct_iso_full_t_dep",
  "med_div_loss_t_reg", "med_div_loss_b_reg", "pct_iso_full_t_reg",
  "dens_div_t_min", "dens_div_t_max",
  paste0("dens_div_t_", 1:10), paste0("div_loss_t_dec_", 1:10),
  paste0("dens_div_t_min_", c("epci", "dep", "reg")),
  paste0("dens_div_t_max_", c("epci", "dep", "reg")),
  paste0("dens_div_t_", 1:10, "_epci"), paste0("div_loss_t_dec_", 1:10, "_epci"),
  paste0("dens_div_t_", 1:10, "_dep"), paste0("div_loss_t_dec_", 1:10, "_dep"),
  paste0("dens_div_t_", 1:10, "_reg"), paste0("div_loss_t_dec_", 1:10, "_reg")
)

# construire_analytiques_mobilite ----------------------------------------------
# LE seam de calcul : la table communale (la matière du poids du thème — le
# nombre de bâtiments analysés) et le chaînon analytique FLAGSHIP (issue #138).
# Le seam enchaîne les builders de analytics_mobilite.R — il ne calcule RIEN
# lui-même :
#   - la « Taille » : nb_buildings par niveau (agreger_nb_buildings_territoires) ;
#   - les 5 parts d'isolation (1 − share_*, calculer_parts_isolation_communes)
#     agrégées aux quatre niveaux (agreger_parts_isolation_territoires — la
#     moyenne pondérée par les bâtiments, jamais une moyenne de parts) ;
#   - div_loss_t/b (calculer_div_loss_communes — la neutralité modale sur la
#     base d'abord) aux quatre niveaux (agreger_div_loss_territoires — les
#     valeurs du fichier, recalcul depuis les parties quand le fichier est muet) ;
#   - la classification de saillance (construire_saillance_territoires), la
#     signature de densité (construire_signature_densite), le nuage même-échelle
#     (construire_nuage_territoires) et les rangs-en-contexte des parts
#     d'isolation via la machinerie partagée (construire_rangs_isolation) ;
#   - le sous-bloc « L'offre de mobilité alternative » (issue #140) : l'offre
#     TC (calculer_part_proches_arret_communes — la jointure SPATIALE arrêts
#     Korrigo × communes, le proxy documenté à 500 m), les bornes de recharge
#     (calculer_bornes_communes — les stations IRVE par commune) et le
#     stationnement vélo (calculer_stationnement_velo_communes — les places /
#     1 000 hab du hub Ecolab, millésime le plus récent), agrégés aux quatre
#     niveaux par SA règle (agreger_offre_territoires).
# Tous les artefacts sont persistés sous data/processed/mobilite/ — la matière
# que le ticket payload (#141) assemble. La garde de forme s'étend aux familles
# analytiques : un input corrompu s'arrête ICI, avant la moindre écriture.
construire_analytiques_mobilite <- function(donnees, base_epci,
                                            sortie = "data/processed/mobilite") {
  snapshot <- donnees$mobilite_snapshot
  manquantes <- setdiff(COLONNES_ANALYTIQUES_MOBILITE, names(snapshot))
  if (length(manquantes) > 0) {
    stop("construire_analytiques_mobilite : colonne(s) requise(s) manquante(s) ",
         "du snapshot porté : ", paste(manquantes, collapse = ", "),
         " — un input corrompu arrête le run avant payload partiel.",
         call. = FALSE)
  }

  mobilite_communes <- snapshot %>%
    dplyr::select(commune, nb_buildings)
  nb_buildings_territoires <- agreger_nb_buildings_territoires(
    mobilite_communes, base_epci
  )

  # le chaînon analytique flagship (issue #138)
  isolation_communes <- calculer_parts_isolation_communes(snapshot)
  isolation_territoires <- agreger_parts_isolation_territoires(
    isolation_communes, mobilite_communes, base_epci
  )
  div_communes <- calculer_div_loss_communes(snapshot)
  div_loss_territoires <- agreger_div_loss_territoires(
    div_communes, snapshot, base_epci
  )
  saillance_territoires <- construire_saillance_territoires(div_loss_territoires)
  densite_territoires <- construire_signature_densite(snapshot, base_epci)
  nuage_territoires <- construire_nuage_territoires(div_loss_territoires,
                                                    base_epci)
  territoires <- construire_territoires_mobilite(
    base_epci, list(mobilite_communes = mobilite_communes)
  )
  isolation_rangs <- construire_rangs_isolation(isolation_territoires,
                                                territoires)

  # le sous-bloc « L'offre de mobilité alternative » (issue #140)
  offre_tc_communes <- calculer_part_proches_arret_communes(
    donnees$mobibreizh_stops, donnees$communes_referentiel
  )
  bornes_communes <- calculer_bornes_communes(
    donnees$bornes_recharges, donnees$communes_referentiel
  )
  stationnement_velo_communes <- calculer_stationnement_velo_communes(
    donnees$stationnement_velo
  )
  offre_territoires <- agreger_offre_territoires(
    offre_tc_communes, bornes_communes, stationnement_velo_communes,
    mobilite_communes, base_epci
  )

  if (!dir.exists(sortie)) dir.create(sortie, recursive = TRUE)
  readr::write_rds(mobilite_communes, file.path(sortie, "mobilite_communes.rds"))
  readr::write_rds(nb_buildings_territoires,
                   file.path(sortie, "nb_buildings_territoires.rds"))
  readr::write_rds(isolation_territoires,
                   file.path(sortie, "isolation_territoires.rds"))
  readr::write_rds(div_loss_territoires,
                   file.path(sortie, "div_loss_territoires.rds"))
  readr::write_rds(saillance_territoires,
                   file.path(sortie, "saillance_territoires.rds"))
  readr::write_rds(densite_territoires,
                   file.path(sortie, "densite_territoires.rds"))
  readr::write_rds(nuage_territoires,
                   file.path(sortie, "nuage_territoires.rds"))
  readr::write_rds(isolation_rangs,
                   file.path(sortie, "isolation_rangs.rds"))
  readr::write_rds(offre_tc_communes,
                   file.path(sortie, "offre_tc_communes.rds"))
  readr::write_rds(bornes_communes,
                   file.path(sortie, "bornes_communes.rds"))
  readr::write_rds(stationnement_velo_communes,
                   file.path(sortie, "stationnement_velo_communes.rds"))
  readr::write_rds(offre_territoires,
                   file.path(sortie, "offre_territoires.rds"))

  list(
    mobilite_communes = mobilite_communes,
    nb_buildings_territoires = nb_buildings_territoires,
    isolation_territoires = isolation_territoires,
    div_loss_territoires = div_loss_territoires,
    saillance_territoires = saillance_territoires,
    densite_territoires = densite_territoires,
    nuage_territoires = nuage_territoires,
    isolation_rangs = isolation_rangs,
    offre_tc_communes = offre_tc_communes,
    bornes_communes = bornes_communes,
    stationnement_velo_communes = stationnement_velo_communes,
    offre_territoires = offre_territoires
  )
}

# INDICATEURS_MOBILITE ---------------------------------------------------------
# La table déclarative des indicateurs du thème (issue #9/#97) : chaque clé du
# payload y est déclarée avec sa source de référence (l'id du manifeste qui
# l'estampille — les vintages T7) et sa multiplicité. Le chaînon flagship
# (issue #138) publie « nb_buildings » (la « Taille » du thème — le nombre de
# bâtiments résidentiels analysés par commune, le poids du thème dans le
# squelette). Issue #140 : le sous-bloc « L'offre de mobilité alternative »
# ajoute les TROIS clés d'infrastructure — « offre_tc » (la part des bâtiments
# près d'un arrêt, estampillée du vintage des arrêts Korrigo), « bornes_
# recharge » (les stations IRVE / commune, Licence Ouverte) et « places_
# stationnement_velo_1000 » (le hub Ecolab pris tel quel, ODbL). Chaque clé
# est à UNE ligne PAR TERRITOIRE (commune / EPCI / département / région : les
# agrégats sont recalculés depuis les parties — la moyenne pondérée pour la
# part, la somme pour le compte, Σ places ÷ Σ population pour le taux, jamais
# une moyenne de valeurs communales).
INDICATEURS_MOBILITE <- tibble::tibble(
  key = c("nb_buildings", "offre_tc", "bornes_recharge",
          "places_stationnement_velo_1000"),
  libelle = c(
    "Bâtiments résidentiels analysés",
    "Part des bâtiments près d'un arrêt (à 500 m)",
    "Bornes de recharge pour véhicules électriques",
    "Places de stationnement vélo pour 1 000 hab."
  ),
  sources = list(
    "mobilite_snapshot",
    c("korrigo", "mobibreizh-stops", "communes-france"),
    "bornes-recharges",
    "stationnement-velo"
  ),
  source_reference = c(
    "mobilite_snapshot",
    "mobibreizh-stops",
    "bornes-recharges",
    "stationnement-velo"
  ),
  multiplicite = c(1L, 1L, 1L, 1L)
)

# APERCU_MOBILITE ---------------------------------------------------------------
# La table déclarative des clés de l'Aperçu du thème (issue #32, ADR-0007) :
# VIDE — le gating par thème. Mobilité ne déclare aucune clé aujourd'hui : la
# table `apercu` du payload d'un run Mobilité est présente mais vide (jamais
# un « under construction »).
APERCU_MOBILITE <- tibble::tibble(
  key = character(),
  libelle = character(),
  multiplicite = integer()
)

# construire_territoires_mobilite ----------------------------------------------
# La table des territoires du thème : le squelette PARTAGÉ (squelette_territoires,
# compute.R) — communes/EPCIs/départements/région avec les noms réels de la
# base des EPCI (lire_epci), la règle de pluralité départementale — avec le
# POIDS du thème : le nombre de bâtiments analysés par commune (nb_buildings du
# snapshot porté — la mesure signature de l'analyse d'accessibilité).
construire_territoires_mobilite <- function(base_epci, analytiques) {
  poids <- analytiques$mobilite_communes %>%
    dplyr::select(commune, nb_buildings)
  communes <- base_epci %>%
    dplyr::transmute(
      code = CODGEO, nom = LIBGEO, departement = DEP,
      epci = EPCI, nom_epci = LIBEPCI
    ) %>%
    dplyr::left_join(poids, by = c("code" = "commune")) %>%
    dplyr::mutate(nb_buildings = dplyr::coalesce(nb_buildings, 0))
  squelette_territoires(communes, poids = "nb_buildings")
}

# construire_indicateurs_mobilite ----------------------------------------------
# Les indicateurs publiés du thème : UNE ligne par territoire (commune / EPCI /
# département / région), la valeur d'un agrégat RECALCULÉE depuis les parties
# communales (jamais une moyenne de valeurs — les tables agrégées de
# agreger_nb_buildings_territoires / agreger_offre_territoires). Quatre clés :
# la « Taille » (nb_buildings — le tracer bullet #137/#138) et les trois clés
# du sous-bloc « L'offre de mobilité alternative » (#140) — offre_tc, bornes_
# recharge, places_stationnement_velo_1000. L'assemblage réutilise la
# MACHINERIE PARTAGÉE telle quelle : compute_ranks (les rangs-en-contexte par
# niveau entre pairs) et assembler_indicateurs (la forme du contrat — rangs +
# estampilles T7 depuis INDICATEURS_MOBILITE + vintages). Les tables sont
# ALIGNÉES sur la référence : un territoire sans donnée porte NA — jamais une
# ligne manquante (la multiplicité 1 de la table déclarative l'exige).
construire_indicateurs_mobilite <- function(analytiques, territoires, vintages) {
  aligner <- function(table_agregee, key, unit) {
    dplyr::left_join(territoires["code"], table_agregee, by = "code") %>%
      dplyr::transmute(
        code = code, key = key, detail = NA_character_,
        value = value, unit = unit
      )
  }
  sous_bloc <- function(key) {
    dplyr::left_join(
      territoires["code"],
      analytiques$offre_territoires %>%
        dplyr::filter(key == !!key) %>%
        dplyr::select(code, value),
      by = "code"
    )
  }

  tables <- list(
    nb_buildings = aligner(analytiques$nb_buildings_territoires,
                           "nb_buildings", "bâtiments"),
    offre_tc = aligner(sous_bloc("offre_tc"), "offre_tc", "%"),
    bornes_recharge = aligner(sous_bloc("bornes_recharge"),
                              "bornes_recharge", "bornes"),
    places_stationnement_velo_1000 = aligner(
      sous_bloc("places_stationnement_velo_1000"),
      "places_stationnement_velo_1000", "places / 1 000 hab"
    )
  )

  rangs <- compute_ranks(territoires, tables, scalaires = list())

  assembler_indicateurs(territoires, tables, rangs, theme = "mobilite",
                        indicateurs_table = INDICATEURS_MOBILITE,
                        vintages = vintages)
}

# compute_histoires_mobilite ---------------------------------------------------
# Les Stories du thème (issue #138, ADR-0012) : la table MULTI-ROW par
# territoire, une ligne par story_key, avec la matière du Story et les
# estampilles vintage (issue #74 — chaque ligne est estampillée du vintage de
# SA source de référence : le snapshot porté, la date d'instantané comme
# référence).
#
#   - « vingt-minutes-sans-voiture » (le DÉFAUT, toujours allumé — une ligne
#     par territoire, communes + EPCIs + départements + région) : div_loss_t
#     (la lecture — le nombre de types de services qui disparaissent à pied ou
#     en transports en commun à 20 minutes, la médiane de la distribution
#     bâtiment par bâtiment), div_loss_b et le delta (la matière de la
#     saillance), le story depth pct_iso_full_t (la part des bâtiments qui
#     perdent TOUT accès), la SIGNATURE DE DENSITÉ (les quelques nombres
#     précalculés de la distribution — dens_1..10, dec_1..10, min/max, jamais
#     la matrice, leçon de l'issue #131) et la classification de saillance ;
#   - « ce-que-le-velo-preserve » (la saillance — se déclenche SEULEMENT où le
#     delta est réel, le top décile : delta ≥ SEUIL_SAILLANCE_VELO) : le delta
#     + les deux lectures (div_loss_t/b) + la classification. Ailleurs, le
#     défaut reste la seule Story (ADR-0002).
# Le nuage même-échelle (ADR-0011) est dérivable côté app depuis les lignes de
# défaut des pairs (chaque territoire porte SA div_loss_t) — le pattern de la
# Story Démographie ; le résumé du nuage (médiane/min/max/n des pairs) est
# l'artefact analytique `nuage_territoires.rds`.
compute_histoires_mobilite <- function(analytiques, vintages) {
  tampon <- vintages %>%
    dplyr::filter(id == "mobilite_snapshot")
  if (nrow(tampon) != 1) {
    stop("compute_histoires_mobilite : la source de référence « mobilite_",
         "snapshot » est absente des vintages — les Stories ne peuvent pas ",
         "être estampillées.", call. = FALSE)
  }
  tampon <- tampon %>%
    dplyr::transmute(
      vintage_source = source,
      vintage_version = version,
      vintage_date_reference = date_reference,
      vintage_date_publication = date_publication
    )

  div <- analytiques$div_loss_territoires
  saillance <- analytiques$saillance_territoires[c("code", "classification")]
  signature <- analytiques$densite_territoires

  vingt <- div %>%
    dplyr::left_join(signature, by = "code") %>%
    dplyr::left_join(saillance, by = "code") %>%
    dplyr::mutate(
      type = type_territoire_mobilite(code),
      theme = "mobilite",
      story_key = "vingt-minutes-sans-voiture"
    ) %>%
    dplyr::rename(territoire = code,
                  classification_saillance = classification) %>%
    dplyr::select(territoire, type, theme, story_key,
                  div_loss_t, div_loss_b, delta, pct_iso_full_t,
                  dens_min, dens_max,
                  dplyr::all_of(paste0("dens_", 1:10)),
                  dplyr::all_of(paste0("dec_", 1:10)),
                  classification_saillance) %>%
    dplyr::arrange(territoire)

  velo <- div %>%
    dplyr::left_join(saillance, by = "code") %>%
    dplyr::filter(classification == "saillant") %>%
    dplyr::mutate(
      type = type_territoire_mobilite(code),
      theme = "mobilite",
      story_key = "ce-que-le-velo-preserve"
    ) %>%
    dplyr::rename(territoire = code,
                  classification_saillance = classification) %>%
    dplyr::select(territoire, type, theme, story_key,
                  div_loss_t, div_loss_b, delta, classification_saillance) %>%
    dplyr::arrange(territoire)

  dplyr::bind_rows(vingt, velo) %>%
    dplyr::bind_cols(tampon)
}

# construire_apercu_mobilite ---------------------------------------------------
# Les stats de base de l'onglet Aperçu (ADR-0007) : AUCUNE aujourd'hui — le
# gating par thème (APERCU_MOBILITE vide). Retourne la liste vide ; la table
# `apercu` du payload reste présente et vide (la forme du contrat).
construire_apercu_mobilite <- function(territoires) {
  list()
}

# validations_mobilite ---------------------------------------------------------
# Les vérifications de valeur propres au thème (point 7) : déclarées ici,
# exécutées par validate_payload() après ses vérifications génériques.
validations_mobilite <- list(
  # la « Taille » du thème est un total non négatif (une valeur NA — commune
  # hors snapshot — est un cas légitime, jamais une corruption)
  function(payload) {
    nb <- payload$indicateurs$value[payload$indicateurs$key == "nb_buildings"]
    if (any(!is.na(nb) & nb < 0)) {
      stop("Payload invalide : des bâtiments analysés négatifs.",
           call. = FALSE)
    }
    invisible(payload)
  },
  # l'offre TC est une part dans [0, 1] (une valeur NA — territoire sans
  # calcul — est un cas légitime, jamais une corruption)
  function(payload) {
    tc <- payload$indicateurs$value[payload$indicateurs$key == "offre_tc"]
    if (any(!is.na(tc) & (tc < 0 | tc > 1))) {
      stop("Payload invalide : une part de bâtiments près d'un arrêt hors [0, 1].",
           call. = FALSE)
    }
    invisible(payload)
  },
  # les bornes de recharge sont un compte entier non négatif
  function(payload) {
    b <- payload$indicateurs$value[payload$indicateurs$key == "bornes_recharge"]
    if (any(!is.na(b) & (b < 0 | b != floor(b)))) {
      stop("Payload invalide : un compte de bornes de recharge négatif ou non entier.",
           call. = FALSE)
    }
    invisible(payload)
  },
  # le stationnement vélo est un taux non négatif (les places / 1 000 hab)
  function(payload) {
    v <- payload$indicateurs$value[
      payload$indicateurs$key == "places_stationnement_velo_1000"]
    if (any(!is.na(v) & v < 0)) {
      stop("Payload invalide : un taux de stationnement vélo négatif.",
           call. = FALSE)
    }
    invisible(payload)
  }
)

# construire_payload_mobilite --------------------------------------------------
# L'assembleur du payload du thème : les quatre tables du contrat (la forme
# d'compute_payload, compute.R) — indicateurs (avec rangs + estampilles T7),
# histoires (vide — le Story arrive au ticket #138), territoires (référence
# partagée) et apercu (vide — gating). Validé par la validation GÉNÉRIQUE
# avec les tables déclaratives du thème — un payload invalide s'arrête là.
construire_payload_mobilite <- function(analytiques, base_epci, vintages) {
  territoires <- construire_territoires_mobilite(base_epci, analytiques)

  payload <- list(
    indicateurs = construire_indicateurs_mobilite(analytiques, territoires, vintages),
    histoires = compute_histoires_mobilite(analytiques, vintages),
    territoires = reference_territoires(territoires),
    apercu = assemble_apercu(territoires, construire_apercu_mobilite(territoires))
  )

  validate_payload(payload,
                   indicateurs = INDICATEURS_MOBILITE,
                   vintages = vintages,
                   validations = validations_mobilite,
                   apercu = APERCU_MOBILITE)
  payload
}

# publier_mobilite -------------------------------------------------------------
# Le seam de publication du thème : lit le référentiel partagé (base_epci du
# cache), enchaîne le calcul (construire_analytiques_mobilite — les artefacts
# sont régénérés sous data/processed/mobilite/), assemble le payload, le
# valide et le publie via la machinerie PARTAGÉE publish (backend "static"
# par défaut — parquet + projections JSON + vintages). Retourne le payload,
# comme run_pipeline l'attend.
publier_mobilite <- function(donnees, cache = "data/raw", vintages = NULL,
                             sortie = "public/data",
                             sortie_analytiques = file.path(dirname(cache),
                                                            "processed", "mobilite")) {
  if (is.null(vintages)) vintages <- vintages_mobilite()

  base_epci <- lire_epci(file.path(cache, "extracted", "EPCI_au_01-01-2025.xlsx"))
  analytiques <- construire_analytiques_mobilite(donnees, base_epci,
                                                 sortie = sortie_analytiques)
  payload <- construire_payload_mobilite(analytiques, base_epci, vintages)
  publish(payload, sortie)
  payload
}

# MEMBRES_DESCRIPTEUR_MOBILITE -------------------------------------------------
# Les membres requis du descripteur — le contrat de FORME du thème (ce que la
# machinerie partagée consomme : theme, manifest, vintages, construire_donnees
# — et ce que le run branche : construire_analytiques, publier). La même idée
# que MEMBRES_DESCRIPTEUR_ECONOMIE : un descripteur incomplet échoue FORT, en
# nommant le membre fautif.
MEMBRES_DESCRIPTEUR_MOBILITE <- c(
  "theme", "manifest", "vintages", "construire_donnees",
  "construire_analytiques", "publier"
)

# verifier_descripteur_mobilite -------------------------------------------------
# La validation de FORME du descripteur : tout membre requis manquant fait
# échouer la validation bruyamment, en nommant le membre fautif. Exécutée par
# theme_mobilite() sur son propre résultat (la construction échoue si le
# descripteur est cassé) et par les tests sur des fixtures négatives.
verifier_descripteur_mobilite <- function(descripteur) {
  manquants <- setdiff(MEMBRES_DESCRIPTEUR_MOBILITE, names(descripteur))
  if (length(manquants) > 0) {
    stop("Descripteur Mobilité invalide — membre(s) requis manquant(s) : ",
         paste(manquants, collapse = ", "), ".", call. = FALSE)
  }
  invisible(TRUE)
}

# theme_mobilite ---------------------------------------------------------------
# Le descripteur du thème Mobilité : la même forme de contrat que
# theme_economie() / theme_demographie(), avec les pièces du thème. Le
# descripteur est validé à la construction (verifier_descripteur_mobilite) :
# un membre manquant échoue là où il est construit, jamais plus tard dans la
# machinerie.
theme_mobilite <- function() {
  descripteur <- list(
    theme = "mobilite",
    manifest = MANIFEST_MOBILITE,
    vintages = vintages_mobilite,
    construire_donnees = construire_donnees_mobilite,
    construire_analytiques = construire_analytiques_mobilite,
    publier = publier_mobilite
  )
  verifier_descripteur_mobilite(descripteur)
  descripteur
}
