# theme_mobilite ---------------------------------------------------------------
# Le module du thème Mobilité (issues #137 tracer bullet + #138 la chaîne
# analytique flagship + #139 l'étage demande/réseaux + #140 le sous-bloc
# « L'offre de mobilité alternative ») : le descripteur theme_mobilite() que la
# machinerie partagée (download/compute/publish) consomme sans jamais nommer le
# thème — la même forme de contrat que theme_economie() (issue #96) et
# theme_demographie()/theme_habitat().
#
# Ce qui vit ici, ce qui ne vit pas ici :
#   - le manifeste des sources : le snapshot PORTÉ de l'analyse d'accessibilité
#     « Vingt minutes sans voiture » + les sept sources des étages
#     demande/réseaux (issue #139) et sous-bloc (issue #140)
#     (manifest_mobilite.R) — chaque source SA ligne, SA référence et SA
#     publication ;
#   - la construction des données : la normalisation du snapshot porté (le
#     lecteur du CSV + le normaliseur : identité vérifiée, métriques
#     numérisées, la table complète des 2 061 colonnes conservée) + les
#     lecteurs de l'étage demande/réseaux (issue #139) + les sources du
#     sous-bloc (issue #140, construire_sources_offre_mobilite) ;
#   - le builder de vintages (la projection générique depuis le manifeste,
#     vintages_depuis_manifest, vintage.R) ;
#   - le SEAM de calcul : construire_analytiques_mobilite enchaîne la table
#     communale (la « Taille » du thème : nb_buildings), l'agrégation aux
#     quatre niveaux (recalculée depuis les parties — jamais une moyenne) et
#     le chaînon analytique FLAGSHIP (issue #138) — les 5 parts d'isolation,
#     div_loss_t/b (la neutralité modale sur la base d'abord), la signature de
#     densité + le nuage même-échelle, la saillance et les rangs-en-contexte
#     (les builders vivent dans analytics_mobilite.R) — puis l'étage
#     demande/réseaux (issue #139 : voitures/ménage et réseaux t/b/c, les
#     builders dans demande_reseaux_mobilite.R) et le sous-bloc « L'offre de
#     mobilité alternative » (issue #140 : offre_tc — la VRAIE part des
#     bâtiments à 500 m d'un arrêt GTFS, la correction de la méthode —, bornes
#     IRVE et stationnement vélo hub Ecolab, les builders dans
#     sources_offre_mobilite.R), tous persistés sous data/processed/mobilite/ ;
#   - le SEAM de publication : publier_mobilite — le payload contractuel
#     (territoires / indicateurs / histoires / apercu) publié par la
#     machinerie partagée publish. Le chaînon publie les ONZE clés du thème
#     (voitures_menage + reseaux + offre_tc + bornes_recharge +
#     places_stationnement_velo_1000 + offre_cyclable — la figure « L'offre
#     cyclable » du sous-bloc, issue #231 — + les 5 parts d'isolation de la
#     grille, assemblées au ticket #141 avec leurs rangs et l'estampille
#     snapshot).
# Ce qui N'y vit PAS : aucun calcul d'indicateur de la grille (la matière
# analytique est au ticket #138, l'assemblage des clés au #141 — les parts
# d'isolation sont CALCULÉES par le chaînon et ASSEMBLÉES ici), aucune
# modification de theme_demographie / theme_economie / theme_habitat ni du
# cœur partagé (compute.R, publish.R).

# construire_donnees_mobilite --------------------------------------------------
# L'acte « trouver la donnée » du thème : le lecteur lit le snapshot porté
# (le CSV du cache, une ligne par commune), le normaliseur le valide et le
# nettoie (identité vérifiée, métriques numérisées), et la table complète est
# persistée sous data/processed/mobilite/ (idempotent, comme les builders des
# sources). Depuis l'issue #139, l'étage demande/réseaux a SES sources :
#   - les voitures/ménage (le cube RP exploitation principale DS_RP_LOGEMENT_
#     PRINC — le code de table épinglé LOG T12, voir manifest_mobilite.R) ;
#   - les limites communales Admin Express (le référentiel géométrique des
#     réseaux — attribution + surface) ;
#   - les lignes OSM de l'extrait Geofabrik Bretagne (la couche `lines`, les
#     modes t/c) ;
#   - depuis l'issue #230 (ADR-0016), le snapshot Geovelo « Aménagements
#     cyclables » (le mode `b`) via construire_amenagements_cyclables — la
#     porte de qualité + le repli sur le dernier bon, la table normalisée
#     bretonne aux clés COG 2025 (la table de passage COG est construite
#     depuis le zip du cache par construire_mappe_cog_bretagne).
# Issue #140 : le seam assemble aussi les QUATRE sources du sous-bloc
# « L'offre de mobilité alternative » (construire_sources_offre_mobilite —
# korrigo GTFS, batiments_residentiels, bornes-recharges, stationnement-velo),
# chacune lue dans le cache et normalisée par SON normaliseur
# (sources_offre_mobilite.R), jamais re-persistée ici (la matière des
# indicateurs est l'affaire du chaînon analytique). Chaque source est lue par
# SON lecteur (normaliser_mobilite.R / sources_offre_mobilite.R) — le seam
# d'entrée du run. Les paramètres `snapshot` et `sources` permettent aux tests
# de passer les fixtures directement : le chemin de code de normalisation et
# de persistance est le même que pour les fichiers réels.
construire_donnees_mobilite <- function(cache = "data/raw",
                                        sortie = "data/processed/mobilite/mobilite_snapshot.rds",
                                        snapshot = NULL,
                                        sources = NULL) {
  fichier_source <- function(id) {
    MANIFEST_MOBILITE$fichier[MANIFEST_MOBILITE$id == id]
  }

  if (is.null(snapshot)) {
    snapshot <- lire_snapshot_mobilite(
      file.path(cache, fichier_source("mobilite_snapshot"))
    )
  }

  table <- normaliser_snapshot_mobilite(snapshot)
  voitures <- lire_voitures_communes(
    file.path(cache, fichier_source("rp_logement_princ"))
  )
  limites <- lire_communes_limites(
    file.path(cache, fichier_source("communes_limites"))
  )
  lignes <- lire_lignes_osm(
    file.path(cache, fichier_source("osm_reseaux"))
  )
  # le mode `b` (issue #230, ADR-0016) : la table Geovelo normalisée via
  # l'orchestrateur (porte de qualité + repli sur le dernier bon) — la table
  # de passage COG vient du zip du cache, le dernier bon vit à côté du
  # snapshot porté (le même dossier processed du thème)
  if (!dir.exists(dirname(sortie))) dir.create(dirname(sortie), recursive = TRUE)
  amenagements <- construire_amenagements_cyclables(
    file.path(cache, fichier_source("amenagements_cyclables")),
    sortie = file.path(dirname(sortie), "amenagements_dernier_bon.rds"),
    vintage = MANIFEST_MOBILITE$date_reference[
      MANIFEST_MOBILITE$id == "amenagements_cyclables"],
    mappe = construire_mappe_cog_bretagne(
      file.path(cache, fichier_source("cog_passage"))
    )
  )
  if (is.null(sources)) {
    sources <- construire_sources_offre_mobilite(cache)
    if (is.null(sources$parkings_osm))
      sources$parkings_osm <- lire_parkings_osm(file.path(cache, fichier_source("osm_reseaux")))
    if (is.null(sources$stations_service))
      sources$stations_service <- normaliser_bpe_b316(
        lire_bpe_b316(file.path(cache, fichier_source("bpe_b316"))))
  }

  readr::write_rds(table, sortie)

  c(list(
    mobilite_snapshot = table,
    voitures_communes = voitures,
    communes_limites = limites,
    lignes_osm = lignes,
    parkings_osm = sources$parkings_osm,
    stations_service = sources$stations_service,
    amenagements_cyclables = amenagements$table,
    # l'issue #233 : le diagnostic de couverture du snapshot Geovelo (lignes +
    # km par département, courant vs précédent, le signal de régression) — la
    # matière du run report, portée par le seam d'entrée du run quand
    # l'orchestrateur le fournit (NULL pour les autres thèmes)
    couverture = amenagements$couverture
  ), sources[setdiff(names(sources), c("parkings_osm", "stations_service"))])
}

# VINTAGES_RACCORDEMENT -----------------------------------------------------------
# Les DEUX faits de vintage CONSTRUITS du raccordement (issue #486) : la
# matrice temps figée et la population RP 2023 épinglées sous inst/extdata ne
# sont PAS des sources téléchargées — elles n'ont pas de ligne de manifeste —
# mais ce sont des données VERSIONNÉES (la recette figée et les empreintes
# sha256 d'artefact_raccordement.R / calcul_raccordement.R). Leurs lignes
# voyagent dans la table des vintages du thème : l'estampillage des clés du
# raccordement passe par la jointure source_reference standard, la validation
# des métadonnées les retrouve, et la table partagée (fusionner_vintages) les
# publie à Sources comme toute autre fraîcheur.
VINTAGES_RACCORDEMENT <- tibble::tribble(
  ~id, ~source, ~version, ~licence, ~date_reference, ~date_publication,
  "matrice_temps_mairies",
  paste0("Lusk — matrice temps mairie à mairie figée du raccordement ",
         "(routage r5r sur SNCF Voyageurs national 2026-08-24 + ",
         "KorrigoBret v80335, mercredi réel de période scolaire 2026-09-16, ",
         "meilleur départ p01 — recherche raccordement, issue #485)"),
  "2026-09-16", "odbl", "2026-08-25", "2026-08-26",
  "population_raccordement",
  paste0("INSEE — Recensement de la population 2023 : la population totale ",
         "des 1 202 communes bretonnes COG 2025 (le dénominateur W = ",
         "3 449 370), transcription épinglée du run de recherche vérifié ",
         "(calcul_raccordement.R, issue #486)"),
  "2023", "lov2", "2023-01-01", "2026-08-26"
)

# vintages_mobilite ------------------------------------------------------------
# Le builder de vintages du thème : la projection générique depuis le
# manifeste — une source, SA référence (l'instantané de l'analyse) et SA
# publication (le portage), jamais alignées. Depuis l'issue #486, les DEUX
# faits construits du raccordement voyagent à leurs côtés.
vintages_mobilite <- function() {
  dplyr::bind_rows(vintages_depuis_manifest(MANIFEST_MOBILITE),
                   VINTAGES_RACCORDEMENT)
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
  unname(CLES_ACCES_MOBILITE),
  "med_div_loss_t", "med_div_loss_b", "pct_iso_full_t",
  "med_tot_loss_t", "med_tot_loss_b",
  "med_tot_loss_t_epci", "med_tot_loss_b_epci",
  "med_tot_loss_t_dep", "med_tot_loss_b_dep",
  "med_tot_loss_t_reg", "med_tot_loss_b_reg",
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
#   - les 15 parts d'accès direct (calculer_parts_acces_communes) et leurs
#     quatre niveaux (agreger_parts_acces_territoires — la moyenne pondérée par
#     les bâtiments, jamais une moyenne de parts) ; les 5 parts d'isolation
#     restent assemblées comme miroir de compatibilité ;
#   - div_loss_t/b (calculer_div_loss_communes — la neutralité modale sur la
#     base d'abord) aux quatre niveaux (agreger_div_loss_territoires — les
#     valeurs du fichier, recalcul depuis les parties quand le fichier est muet) ;
#   - la classification de saillance (construire_saillance_territoires), la
#     signature de densité (construire_signature_densite), le nuage même-échelle
#     (construire_nuage_territoires) et les rangs-en-contexte des parts
#     d'accès et d'isolation via la machinerie partagée
#     (construire_rangs_acces / construire_rangs_isolation) ;
#   - l'étage demande/réseaux (issue #139) : la demande (voitures/ménage — la
#     moyenne pondérée par les ménages, jamais une moyenne de parts) et les
#     réseaux t/b/c (longueurs sommées, densités Σ L ÷ Σ surface — la règle
#     d'agrégation partagée, les builders dans demande_reseaux_mobilite.R) ;
#   - le sous-bloc « L'offre de mobilité alternative » (issue #140) : l'offre
#     TC (calculer_part_proches_arret_communes — la VRAIE part des bâtiments à
#     500 m d'un arrêt GTFS, la correction de la méthode), les bornes de
#     recharge (calculer_bornes_communes — les stations IRVE par commune) et le
#     stationnement vélo (calculer_stationnement_velo_communes — les places /
#     1 000 hab du hub Ecolab, millésime le plus récent), agrégés aux quatre
#     niveaux par SA règle (agreger_offre_territoires — les builders vivent
#     dans sources_offre_mobilite.R) ; la figure « L'offre cyclable » (issue
#     #231 : calculer_offre_cyclable_communes — les km protégé/partagé / 1 000
#     hab et le total cyclable, la binaison provisoire d'ADR-0016, la longueur
#     en GÉOMÉTRIE UNIQUE — le numérateur du ratio ; la population du
#     dénominateur vient du hub stationnement vélo, le même dénominateur que
#     les places / 1 000 hab du sous-bloc).
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
  acces_communes <- calculer_parts_acces_communes(snapshot)
  acces_territoires <- agreger_parts_acces_territoires(
    acces_communes, mobilite_communes, base_epci
  )
  isolation_communes <- calculer_parts_isolation_communes(snapshot)
  isolation_territoires <- agreger_parts_isolation_territoires(
    isolation_communes, mobilite_communes, base_epci
  )
  div_communes <- calculer_div_loss_communes(snapshot)
  div_loss_territoires <- agreger_div_loss_territoires(
    div_communes, snapshot, base_epci
  )
  tot_loss_territoires <- agreger_tot_loss_territoires(
    calculer_tot_loss_communes(snapshot), snapshot, base_epci)
  saillance_territoires <- construire_saillance_territoires(div_loss_territoires)
  densite_territoires <- construire_signature_densite(snapshot, base_epci)
  nuage_territoires <- construire_nuage_territoires(div_loss_territoires,
                                                    base_epci)
  territoires <- construire_territoires_mobilite(
    base_epci, list(mobilite_communes = mobilite_communes)
  )
  # Le Type d'équipement BPE : la matrice complète reste un artefact interne
  # (territoire × TYPEQU × c/b/t × profil), sa projection bornée sera la
  # seule matière BPE du payload public.
  matrice_profils_acces_bpe <- construire_matrice_profils_acces_bpe(
    snapshot, base_epci
  )
  profils_acces_bpe <- construire_projection_profils_acces_bpe(
    matrice_profils_acces_bpe
  )
  acces_rangs <- construire_rangs_acces(acces_territoires, territoires)
  isolation_rangs <- construire_rangs_isolation(isolation_territoires,
                                                territoires)

  # l'étage demande/réseaux (issue #139) : la demande (voitures/ménage — la
  # moyenne pondérée par les ménages, jamais une moyenne de parts) et les
  # réseaux t/c (OSM) + b (le jeu Geovelo depuis l'issue #230, ADR-0016 — le
  # comptage par direction, l'attribution par le côté porteur). Les longueurs
  # sont sommées, les densités Σ L ÷ Σ surface — la règle d'agrégation
  # partagée, les builders dans demande_reseaux_mobilite.R ; la table communale
  # complète (t/c du OSM, b du Geovelo) est fusionnée AVANT l'agrégation — la
  # forme du contrat est celle que agreger_reseaux_territoires lit (inchangé)
  voitures_communes <- calculer_voitures_communes(donnees$voitures_communes)
  voitures_territoires <- agreger_voitures_territoires(voitures_communes,
                                                       base_epci)
  reseaux_communes <- fusionner_reseaux_velo_communes(
    calculer_reseaux_communes(donnees$lignes_osm, donnees$communes_limites),
    calculer_reseaux_velo_communes(donnees$amenagements_cyclables,
                                   donnees$communes_limites)
  )
  reseaux_territoires <- agreger_reseaux_territoires(reseaux_communes,
                                                     base_epci)

  # le sous-bloc « L'offre de mobilité alternative » (issue #140) + la figure
  # « L'offre cyclable » (issue #231, la binaison provisoire d'ADR-0016) :
  # l'offre TC (la VRAIE part des bâtiments à 500 m d'un arrêt GTFS), les
  # bornes de recharge (les stations IRVE par commune), le stationnement vélo
  # (les places / 1 000 hab du hub Ecolab) et l'offre cyclable (les km
  # protégé/partagé / 1 000 hab + le total cyclable — le numérateur du ratio,
  # la longueur en GÉOMÉTRIE UNIQUE, l'attribution par le côté porteur
  # d'ADR-0016). La population communale du dénominateur des km/1 000 hab est
  # celle du hub stationnement vélo (la population INSEE du hub — le même
  # dénominateur que les places / 1 000 hab du sous-bloc, la cohérence des
  # deux taux). L'agrégation des QUATRE clés passe par agreger_offre_territoires
  # (la forme longue code × key × detail × value du contrat).
  offre_tc_communes <- calculer_part_proches_arret_communes(
    donnees$korrigo, donnees$batiments_residentiels
  )
  bornes_communes <- calculer_bornes_communes(donnees$bornes_recharges,
                                              base_epci)
  stationnement_velo_communes <- calculer_stationnement_velo_communes(
    donnees$stationnement_velo
  )
  offre_cyclable_communes <- calculer_offre_cyclable_communes(
    donnees$amenagements_cyclables,
    stationnement_velo_communes[c("commune", "population")]
  )
  stationnement_voiture_communes <- NULL
  if (all(c("parkings_osm", "lignes_osm", "communes_limites") %in% names(donnees))) {
    stationnement_voiture_communes <- calculer_stationnement_voiture_communes(
      donnees$parkings_osm, donnees$lignes_osm, donnees$communes_limites)
  }
  fuel_communes <- if ("stations_service" %in% names(donnees))
    calculer_fuel_communes(donnees$stations_service) else NULL
  if (is.null(stationnement_voiture_communes) && is.null(fuel_communes)) {
    offre_territoires <- agreger_offre_territoires(
      offre_tc_communes, bornes_communes, stationnement_velo_communes,
      base_epci, offre_cyclable_communes)
  } else {
    offre_territoires <- agreger_offre_territoires(
      offre_tc_communes, bornes_communes, stationnement_velo_communes,
      base_epci, offre_cyclable_communes, stationnement_voiture_communes,
      fuel_communes)
  }

  if (!dir.exists(sortie)) dir.create(sortie, recursive = TRUE)
  readr::write_rds(mobilite_communes, file.path(sortie, "mobilite_communes.rds"))
  readr::write_rds(nb_buildings_territoires,
                   file.path(sortie, "nb_buildings_territoires.rds"))
  readr::write_rds(acces_territoires,
                   file.path(sortie, "acces_territoires.rds"))
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
  readr::write_rds(acces_rangs,
                   file.path(sortie, "acces_rangs.rds"))
  readr::write_rds(voitures_communes,
                   file.path(sortie, "voitures_communes.rds"))
  readr::write_rds(voitures_territoires,
                   file.path(sortie, "voitures_territoires.rds"))
  readr::write_rds(reseaux_communes,
                   file.path(sortie, "reseaux_communes.rds"))
  readr::write_rds(reseaux_territoires,
                   file.path(sortie, "reseaux_territoires.rds"))
  readr::write_rds(offre_tc_communes,
                   file.path(sortie, "offre_tc_communes.rds"))
  readr::write_rds(bornes_communes,
                   file.path(sortie, "bornes_communes.rds"))
  readr::write_rds(stationnement_velo_communes,
                   file.path(sortie, "stationnement_velo_communes.rds"))
  readr::write_rds(offre_cyclable_communes,
                   file.path(sortie, "offre_cyclable_communes.rds"))
  readr::write_rds(offre_territoires,
                   file.path(sortie, "offre_territoires.rds"))
  readr::write_rds(matrice_profils_acces_bpe,
                   file.path(sortie, "matrice_profils_acces_bpe.rds"))
  readr::write_rds(profils_acces_bpe,
                   file.path(sortie, "profils_acces_bpe.rds"))

  list(
    mobilite_communes = mobilite_communes,
    nb_buildings_territoires = nb_buildings_territoires,
    acces_territoires = acces_territoires,
    isolation_territoires = isolation_territoires,
    div_loss_territoires = div_loss_territoires,
    saillance_territoires = saillance_territoires,
    densite_territoires = densite_territoires,
    nuage_territoires = nuage_territoires,
    isolation_rangs = isolation_rangs,
    acces_rangs = acces_rangs,
    voitures_communes = voitures_communes,
    voitures_territoires = voitures_territoires,
    reseaux_communes = reseaux_communes,
    reseaux_territoires = reseaux_territoires,
    offre_tc_communes = offre_tc_communes,
    bornes_communes = bornes_communes,
    stationnement_velo_communes = stationnement_velo_communes,
    offre_cyclable_communes = offre_cyclable_communes,
    offre_territoires = offre_territoires,
    tot_loss_territoires = tot_loss_territoires,
    matrice_profils_acces_bpe = matrice_profils_acces_bpe,
    profils_acces_bpe = profils_acces_bpe
  )
}

# INDICATEURS_MOBILITE ---------------------------------------------------------
# La table déclarative des indicateurs du thème (issue #9/#97) : chaque clé du
# payload y est déclarée avec sa source de référence (l'id du manifeste qui
# l'estampille — les vintages T7) et sa multiplicité. ONZE clés depuis les
# issues #139 + #140 + #141 + #231 — `nb_buildings` QUITTE le payload à l'issue
# #368 (décision #196, jamais exécutée : la « Taille » reste la pondération
# INTERNE du thème — le poids des agrégats et la règle de pluralité — mais
# n'est plus une clé publiée) :
#   - « voitures_menage » (l'étage demande, #139) : les TROIS parts réelles
#     des ménages SANS voiture / avec UNE voiture / avec 2+ voitures (la
#     dimension CARS du cube RP : C0 / C1 / C_GE2 — la catégorie du milieu
#     C1 publiée depuis l'issue #368, les trois parts SOMMENT à 1), une ligne
#     par (territoire × part) — la multiplicité 3, agrégée depuis les parties
#     par la moyenne pondérée par les ménages, JAMAIS une moyenne de parts. Le
#     scalaire classé de la fiche est la part SANS voiture (high-is-good,
#     ADR-0015). Source de référence : le cube RP exploitation principale
#     (rp_logement_princ — le code de table épinglé LOG T12) ;
#   - « reseaux » (l'étage réseaux, #139, mode `b` alimenté par le jeu Geovelo
#     depuis #222/#228) : les longueurs et densités des réseaux t/b/c (à pied /
#     vélo / voiture), une ligne par (territoire × mesure) — la multiplicité 6
#     (longueur + densité × trois modes), les longueurs SOMMÉES et les densités
#     Σ L ÷ Σ surface depuis les parties communales. Source de référence : le
#     jeu Geovelo « Aménagements cyclables » (amenagements_cyclables — le mode
#     `b` est la composante SIGNATURE de l'indicateur, sa fraîcheur mensuelle
#     est ce que l'indicateur promet ; règle « Reference source » de
#     CONTEXT.md) ; l'extrait OSM (osm_reseaux, les modes t/c) et les limites
#     communales (communes_limites, la surface du dénominateur) restent des
#     sources de l'indicateur.
#   - « offre_tc » (le sous-bloc, #140) : la VRAIE part des bâtiments près
#     d'un arrêt — la fraction des BÂTIMENTS de la commune à moins de 500 m
#     d'un arrêt GTFS (la correction de la méthode), une ligne par territoire,
#     la multiplicité 1. Source de référence : la base GTFS korrigo (les
#     arrêts — le stops.txt, ODbL) ; la couche bâtiments (batiments_
#     residentiels) porte les dénominateurs.
#   - « bornes_recharge » (le sous-bloc, #140) : les stations IRVE distinctes
#     par commune, la multiplicité 1. Source de référence : bornes-recharges
#     (le fichier consolidé IRVE, Licence Ouverte).
#   - « places_stationnement_velo_1000 » (le sous-bloc, #140) : le hub Ecolab
#     pris tel quel — les places / 1 000 hab, la multiplicité 1. Source de
#     référence : stationnement-velo (ODbL, producteur OSM).
#   - « offre_cyclable » (le sous-bloc, #231) : la figure « L'offre cyclable »
#     — les km protégé / partagé (et / 1 000 hab) + le total cyclable (le
#     numérateur du ratio « X % de l'infrastructure routière »), la
#     multiplicité 5, la longueur en GÉOMÉTRIE UNIQUE (la convention du ratio,
#     jamais le comptage par direction du mode `b` — ADR-0016). Source de
#     RÉFÉRENCE : l'extrait OSM (osm_reseaux — l'horloge lente) : le headline
#     compare le vélo au réseau `c` (OSM), le ratio est limité par SA plus
#     lente horloge — jamais le vintage Geovelo frais (décision #226, US6) ;
#     le jeu Geovelo (amenagements_cyclables) et la population du hub
#     (stationnement-velo, le dénominateur des km/1 000 hab) restent des
#     sources de l'indicateur.
#   - les QUINZE parts d'accès (share_*_t/b/c) : les faits directs de la grille,
#     une ligne par territoire et clé, la multiplicité 1 ;
#   - les CINQ parts d'isolation (issue #141) : iso_alimentation, iso_sante,
#     iso_administration, iso_ecole, iso_banque — le miroir legacy des parts
#     d'accès à pied ou en transports en commun (1 − share_*_t), conservé le
#     temps que le rendu prototype soit migré ;
#     Chaque part porte SON rang-en-contexte (l'artefact isolation_rangs.rds)
#     et l'estampille SNAPSHOT (la source de référence « mobilite_snapshot » —
#     la date d'instantané de l'analyse, le fait de vintage de première classe
#     du flagship, ADR-0012).
#   - « raccordement_tc » / « raccordement_courbe » / « raccordement_reference »
#     (issue #486) : LE RACCORDEMENT — la part de la population bretonne
#     joignable en 90 minutes en TC (le scalaire classé), sa courbe cumulative
#     (11 détails « t0000 » → « t0360 », la matière de la figure) et la courbe
#     de référence de la commune bretonne médiane (les mêmes détails, portés
#     par la seule ligne régionale). Calculés depuis la matrice temps FIGÉE
#     SEULE + la population RP 2023 épinglée — jamais re-routés. Source de
#     référence : matrice_temps_mairies (le fait construit de VINTAGES_
#     RACCORDEMENT — l'horloge du figé, la recette 2026-09-16). Multiplicité
#     NA pour la référence : elle ne vit que sur la région (nombre de lignes
#     variable par territoire).
INDICATEURS_MOBILITE <- tibble::tibble(
  key = c("voitures_menage", "reseaux",
          "offre_tc", "bornes_recharge", "places_stationnement_velo_1000",
           "places_stationnement_voiture_1000", "bornes_ev_par_station_service",
           "stationnement_velo_par_voiture", "tot_loss_t", "tot_loss_b",
           "offre_cyclable",
           names(CLES_ISOLATION_MOBILITE),
           names(CLES_ACCES_MOBILITE),
           "raccordement_tc", "raccordement_courbe", "raccordement_reference"),
  libelle = c(
    "Voitures par ménage",
    "Réseaux à pied / vélo / voiture",
    "Part des bâtiments près d’un arrêt (à 500 m)",
    "Bornes de recharge pour véhicules électriques",
    "Places de stationnement vélo pour 1 000 hab.",
     "Places de stationnement voiture pour 1 000 hab.",
     "Bornes de recharge par station-service",
     "Places de stationnement vélo pour 1 place voiture",
     "Perte totale d’accès — à pied ou en transports en commun",
     "Perte totale d’accès — à vélo",
    "L’offre cyclable",
    "Part des bâtiments sans accès à l’alimentation (à pied ou en transports en commun)",
    "Part des bâtiments sans accès à la santé (à pied ou en transports en commun)",
     "Part des bâtiments sans accès aux services administratifs (à pied ou en transports en commun)",
     "Part des bâtiments sans accès à l’école (à pied ou en transports en commun)",
     "Part des bâtiments sans accès à la banque (à pied ou en transports en commun)",
     "Part des bâtiments avec accès à l’alimentation — à pied ou en transports en commun",
     "Part des bâtiments avec accès à l’alimentation — à vélo",
     "Part des bâtiments avec accès à l’alimentation — en voiture",
     "Part des bâtiments avec accès à la santé — à pied ou en transports en commun",
     "Part des bâtiments avec accès à la santé — à vélo",
     "Part des bâtiments avec accès à la santé — en voiture",
     "Part des bâtiments avec accès aux services administratifs — à pied ou en transports en commun",
     "Part des bâtiments avec accès aux services administratifs — à vélo",
     "Part des bâtiments avec accès aux services administratifs — en voiture",
     "Part des bâtiments avec accès à l’école — à pied ou en transports en commun",
     "Part des bâtiments avec accès à l’école — à vélo",
     "Part des bâtiments avec accès à l’école — en voiture",
     "Part des bâtiments avec accès à la banque — à pied ou en transports en commun",
     "Part des bâtiments avec accès à la banque — à vélo",
     "Part des bâtiments avec accès à la banque — en voiture",
     "Population bretonne joignable en 90 minutes en TC",
    "Courbe cumulative — population bretonne joignable en TC",
    "Référence médiane — commune bretonne"
  ),
  sources = list(
    "rp_logement_princ",
    c("amenagements_cyclables", "osm_reseaux", "communes_limites"),
    c("korrigo", "batiments_residentiels"),
    "bornes-recharges",
    "stationnement-velo",
     "osm_reseaux", c("bornes-recharges", "bpe_b316"),
     c("stationnement-velo", "osm_reseaux"), "mobilite_snapshot", "mobilite_snapshot",
    c("amenagements_cyclables", "osm_reseaux", "stationnement-velo"),
     "mobilite_snapshot", "mobilite_snapshot", "mobilite_snapshot",
     "mobilite_snapshot", "mobilite_snapshot",
     "mobilite_snapshot", "mobilite_snapshot", "mobilite_snapshot",
     "mobilite_snapshot", "mobilite_snapshot", "mobilite_snapshot",
     "mobilite_snapshot", "mobilite_snapshot", "mobilite_snapshot",
     "mobilite_snapshot", "mobilite_snapshot", "mobilite_snapshot",
     "mobilite_snapshot", "mobilite_snapshot", "mobilite_snapshot",
     "matrice_temps_mairies", "matrice_temps_mairies", "matrice_temps_mairies"
  ),
   source_reference = c("rp_logement_princ", "amenagements_cyclables",
                        "korrigo", "bornes-recharges", "stationnement-velo",
                        "osm_reseaux", "bpe_b316", "osm_reseaux",
                         "mobilite_snapshot", "mobilite_snapshot", "osm_reseaux",
                         rep("mobilite_snapshot", 5),
                         rep("mobilite_snapshot", 15),
                         "matrice_temps_mairies", "matrice_temps_mairies",
                        "matrice_temps_mairies"),
    multiplicite = c(3L, 6L, 1L, 1L, 1L, 1L, 1L, 1L, 1L, 1L, 5L, rep(1L, 5),
                     rep(1L, 15),
                    1L,
                    length(grille_raccordement()),
                    NA_integer_)
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
# Les indicateurs publiés du thème : les ONZE clés déclarées (issue #368 :
# `nb_buildings` QUITTE le payload — la décision #196, jamais exécutée ; la
# « Taille » reste la pondération INTERNE du thème, elle n'est plus une clé),
# alignées sur la référence (un territoire sans donnée porte NA — jamais une
# ligne manquante, la multiplicité de la table déclarative l'exige), avec leurs
# rangs et leurs estampilles T7 (la machinerie partagée compute_ranks +
# assembler_indicateurs pour les clés scalaires, un rang PAR DÉTAIL pour les
# clés multi-mesures).
#   - voitures_menage / reseaux / offre_cyclable : une ligne par (territoire ×
#     détail) — chaque MESURE porte le rang-en-contexte de SA valeur (la part
#     sans voiture classée contre les parts sans voiture des pairs, la
#     longueur cyclable contre les longueurs cyclables… — jamais un rang
#     unique qui mélangerait des unités) ;
#   - offre_tc / bornes_recharge / places_stationnement_velo_1000 (le
#     sous-bloc, issue #140) : une ligne par territoire, la valeur de
#     l'agrégat agreger_offre_territoires (la moyenne pondérée par les
#     bâtiments pour la part, la somme pour le compte, Σ places ÷ Σ population
#     pour le taux), le rang de compute_ranks ;
#   - offre_cyclable (le sous-bloc, issue #231) : une ligne par (territoire ×
#     mesure) — les longueurs protégé/partagé/total et les km/1 000 hab de la
#     figure « L'offre cyclable » (la multiplicité 5 de la table déclarative),
#     le rang PAR DÉTAIL de construire_rangs_detail, l'estampille de la source
#     de référence osm_reseaux (l'horloge lente du ratio) ;
#   - les 5 parts d'isolation (issue #141, la GRILLE du flagship) : une ligne
#     par territoire, la valeur de l'artefact analytique isolation_territoires
#     (la moyenne pondérée par les bâtiments des parts communales — jamais une
#     moyenne de parts), avec le rang-en-contexte de l'artefact
#     isolation_rangs (calculé par construire_rangs_isolation via la
#     machinerie partagée — jamais re-forké ici).
# Les estampilles viennent des vintages de SA source de référence (les tampons
# de la table déclarative) — la même règle que la machinerie partagée.
construire_indicateurs_mobilite <- function(analytiques, territoires, vintages,
                                             directions = DIRECTIONS_MOBILITE) {
  # LE RACCORDEMENT (issue #486) : les artefacts calculés doivent être là —
  # un absent nomme la chaîne à lancer, jamais un payload amputé en silence
  if (is.null(analytiques$raccordement)) {
    stop("construire_indicateurs_mobilite : les artefacts du raccordement ",
         "(issue #486) sont absents des analytiques — lancez le calcul ",
         "(preparer_raccordement / la cible raccordement_mobilite du graphe).",
         call. = FALSE)
  }
  racc <- analytiques$raccordement
  grille <- grille_raccordement()

  aligner <- function(table_agregee, key, unit) {
    if (!"rider" %in% names(table_agregee)) table_agregee$rider <- NA_character_
    dplyr::left_join(territoires["code"], table_agregee, by = "code") %>%
      dplyr::transmute(
        code = code, key = key, detail = NA_character_,
        value = value, unit = unit, rider = rider
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

  # les clés scalaires : les trois clés du sous-bloc — le rang via la
  # machinerie partagée (compute_ranks) — `nb_buildings` n'est PLUS publié
  # (issue #368, décision #196)
  tables <- list(
    offre_tc = aligner(sous_bloc("offre_tc"), "offre_tc", "%"),
    bornes_recharge = aligner(sous_bloc("bornes_recharge"),
                              "bornes_recharge", "bornes"),
    places_stationnement_velo_1000 = aligner(
      sous_bloc("places_stationnement_velo_1000"),
      "places_stationnement_velo_1000", "places / 1 000 hab")
    ,places_stationnement_voiture_1000 = aligner(
      sous_bloc("places_stationnement_voiture_1000"),
      "places_stationnement_voiture_1000", "places / 1 000 hab")
     ,bornes_ev_par_station_service = aligner(
       analytiques$offre_territoires %>% dplyr::filter(key == "bornes_ev_par_station_service") %>%
         dplyr::select(dplyr::any_of(c("code", "value", "rider"))),
       "bornes_ev_par_station_service", "bornes / station")
     ,stationnement_velo_par_voiture = aligner(
       sous_bloc("stationnement_velo_par_voiture"),
       "stationnement_velo_par_voiture", "places vélo / place voiture")
  )

  # le scalaire classé du raccordement : la part @90 aux QUATRE niveaux —
  # les communes non routées portent NA + leur motif nommé dans `rider`
  # (l'alignement sur la référence garantit une ligne par territoire) ;
  # les agrégats portent dans `rider` la phrase de COUVERTURE précalculée
  # quand une part de leur population n'est pas mesurable par le réseau
  # (sémantique routés-seuls — rien n'est caché)
  rider_couverture <- function(couverture) {
    dplyr::if_else(
      !is.na(couverture) & couverture < 1,
      paste0("Part de la population réellement mesurée par le réseau : ",
             sub(".", ",",
                 sprintf("%.1f", 100 * couverture), fixed = TRUE),
             " % (les communes non routées sont exclues du calcul)."),
      NA_character_)
  }
  racc_scalaire <- dplyr::bind_rows(
    racc$calcul$communes %>%
      dplyr::transmute(code = code, value = part_90, rider = motif),
    racc$calcul$epcis %>%
      dplyr::transmute(code = code, value = part_90,
                       rider = rider_couverture(couverture)),
    racc$calcul$departements %>%
      dplyr::transmute(code = code, value = part_90,
                       rider = rider_couverture(couverture)),
    racc$calcul$region %>%
      dplyr::transmute(code = code, value = part_90,
                       rider = rider_couverture(couverture))
  )
  tables$raccordement_tc <- aligner(racc_scalaire, "raccordement_tc", "%")
  rangs <- compute_ranks(territoires, tables, scalaires = list(),
                         directions = directions)

  # les 15 parts d'accès direct : les valeurs de l'artefact
  # analytique acces_territoires (longue code × key × value), alignées sur la
  # référence — leurs rangs viennent de acces_rangs.
  acces <- lapply(names(CLES_ACCES_MOBILITE), function(key) {
    aligner(
      analytiques$acces_territoires %>%
        dplyr::filter(key == !!key) %>%
        dplyr::select(code, value),
      key, "%"
    )
  })
  names(acces) <- names(CLES_ACCES_MOBILITE)
  rangs_acces <- analytiques$acces_rangs %>%
    dplyr::mutate(detail = NA_character_)

  # les 5 parts d'isolation (issue #141, la grille du flagship) : les valeurs
  # de l'artefact analytique isolation_territoires (longue code × key × value),
  # alignées sur la référence — leurs rangs-en-contexte viennent de l'artefact
  # isolation_rangs (construire_rangs_isolation, la machinerie partagée — les
  # parts sont déjà classées par le chaînon, jamais re-forkées à l'assemblage)
  isolation <- lapply(names(CLES_ISOLATION_MOBILITE), function(key) {
    aligner(
      analytiques$isolation_territoires %>%
        dplyr::filter(key == !!key) %>%
        dplyr::select(code, value),
      key, "%"
    )
  })
  names(isolation) <- names(CLES_ISOLATION_MOBILITE)
  rangs_isolation <- analytiques$isolation_rangs %>%
    dplyr::mutate(detail = NA_character_)

  # les clés multi-mesures (issue #139) : le squelette (territoire × détail)
  # étend la table agrégée — chaque territoire porte TOUTES les mesures, NA si
  # la donnée manque (la multiplicité de la table déclarative)
  aligner_detail <- function(table_long, key, unites) {
    details <- names(unites)
    squelette_detail <- tidyr::crossing(code = territoires$code, detail = details)
    dplyr::left_join(squelette_detail, table_long, by = c("code", "detail")) %>%
      dplyr::mutate(key = key, unit = unites[detail]) %>%
      dplyr::select(code, key, detail, value, unit)
  }

  voitures <- aligner_detail(
    analytiques$voitures_territoires, "voitures_menage",
    c(sans_voiture = "%", une_voiture = "%", deux_plus = "%")
  )
  reseaux <- aligner_detail(
    analytiques$reseaux_territoires, "reseaux",
    c(t_longueur = "km", b_longueur = "km", c_longueur = "km",
      t_densite = "km/km²", b_densite = "km/km²", c_densite = "km/km²")
  )
  # la figure « L'offre cyclable » (issue #231) : les cinq mesures de la clé
  # multi-mesures — les longueurs protégé/partagé/total et les km/1 000 hab —
  # alignées sur le squelette (le détail NA des clés scalaires du sous-bloc ne
  # les concerne pas : la clé porte SES détails, la même forme que reseaux)
    offre_cyclable <- aligner_detail(
    analytiques$offre_territoires %>%
      dplyr::filter(key == "offre_cyclable"),
    "offre_cyclable",
    c(protege_longueur = "km", protege_km_1000 = "km / 1 000 hab",
      partage_longueur = "km", partage_km_1000 = "km / 1 000 hab",
      total_longueur = "km")
  )
  # Comme les autres clés scalaires, chaque famille est d'abord alignée sur le
  # squelette canonique. Le snapshot ne couvre pas nécessairement tous les
  # territoires (notamment les îles 29083 et 29084) : ils restent publiés avec
  # leur clé canonique et une valeur NA, jamais avec une clé NA.
  tot_loss <- dplyr::bind_rows(
    aligner(analytiques$tot_loss_territoires %>%
              dplyr::select(code, value = tot_loss_t),
            "tot_loss_t", "accès perdus"),
    aligner(analytiques$tot_loss_territoires %>%
              dplyr::select(code, value = tot_loss_b),
            "tot_loss_b", "accès perdus")
  )

  # le rang PAR DÉTAIL : chaque mesure est classée dans SON groupe de
  # comparaison (le percentile partagé de compute.R, jamais re-forké)
  rangs_voitures <- construire_rangs_detail(
    analytiques$voitures_territoires, territoires
  )
  rangs_reseaux <- construire_rangs_detail(
    analytiques$reseaux_territoires, territoires
  )
  rangs_offre_cyclable <- construire_rangs_detail(
    analytiques$offre_territoires %>%
      dplyr::filter(key == "offre_cyclable"),
    territoires
  )
  rangs_tot_loss <- construire_rangs_detail(
    tot_loss %>% dplyr::select(code, key, detail, value),
    territoires)

  # la COURBE du raccordement (la matière de la figure) : les 11 points de la
  # grille déclarée aux quatre niveaux — le squelette (territoire × détail)
  # garantit la multiplicité déclarée partout, NA pour les communes non
  # routées (leur motif voyage sur le scalaire) ; JAMAIS classée (des courbes
  # ne sont pas désirables, elles sont vraies)
  racc_courbes <- dplyr::bind_rows(
    racc$calcul$courbes_communes,
    racc$calcul$courbes_epcis,
    racc$calcul$courbes_departements,
    racc$calcul$courbe_region
  ) %>%
    dplyr::transmute(code = code,
                     detail = paste0("t", sprintf("%04d", minute)),
                     value = part)
  raccordement_courbe <- tidyr::crossing(
    code = territoires$code, detail = grille
  ) %>%
    dplyr::left_join(racc_courbes, by = c("code", "detail")) %>%
    dplyr::mutate(key = "raccordement_courbe", unit = "%") %>%
    dplyr::select(code, key, detail, value, unit)

  # la RÉFÉRENCE médiane bretonne : les mêmes marques de grille, portées par
  # la seule ligne régionale (la multiplicité NA de la table déclarative
  # l'autorise — un nombre de lignes variable par territoire)
  raccordement_reference <- tibble::tibble(
    code = "53",
    key = "raccordement_reference",
    detail = grille,
    value = racc$calcul$reference$part_mediane[
      match(as.integer(sub("^t", "", grille)),
            racc$calcul$reference$minute)],
    unit = "%"
  )

  # l'assemblage : les onze clés + leurs rangs (le détail NA des clés
  # scalaires joint sur le détail NA des rangs partagés) + les tampons de la
  # table déclarative — la même forme que la machinerie partagée
  # assembler_indicateurs
  tampons <- INDICATEURS_MOBILITE %>%
    dplyr::select(key, source_reference) %>%
    dplyr::left_join(vintages, by = c("source_reference" = "id")) %>%
    dplyr::select(key,
                  vintage_source = source,
                  vintage_version = version,
                  vintage_date_reference = date_reference,
                  vintage_date_publication = date_publication)

  rangs_combines <- dplyr::bind_rows(
    dplyr::bind_rows(lapply(rangs, function(rang) {
      rang %>% dplyr::mutate(detail = NA_character_)
    })),
    rangs_acces,
    rangs_isolation,
    rangs_voitures,
    rangs_reseaux,
    rangs_offre_cyclable
    ,rangs_tot_loss
  )

  dplyr::bind_rows(
    tables$offre_tc,
    tables$bornes_recharge,
    tables$places_stationnement_velo_1000,
    tables$places_stationnement_voiture_1000,
    tables$bornes_ev_par_station_service,
    tables$stationnement_velo_par_voiture,
    tot_loss,
    dplyr::bind_rows(acces),
    dplyr::bind_rows(isolation),
    voitures,
    reseaux,
    offre_cyclable,
    tables$raccordement_tc,
    raccordement_courbe,
    raccordement_reference
  ) %>%
    dplyr::left_join(rangs_combines, by = c("code", "key", "detail")) %>%
    dplyr::left_join(territoires[c("code", "type")], by = "code") %>%
    dplyr::rename(territoire = code) %>%
    dplyr::mutate(theme = "mobilite") %>%
    dplyr::left_join(tampons, by = "key") %>%
    dplyr::select(dplyr::any_of(c(
      "territoire", "type", "theme", "key", "detail", "value", "unit",
      "rang_epci", "rang_dep", "rang_reg",
      "rang_epci_n", "rang_dep_n", "rang_reg_n",
      "vintage_source", "vintage_version",
       "vintage_date_reference", "vintage_date_publication", "rider"
    )))
}

# construire_rangs_detail --------------------------------------------------------
# Les rangs-en-contexte PAR DÉTAIL d'une table longue multi-mesures (les clés
# voitures_menage / reseaux / offre_cyclable de l'étage demande/réseaux,
# issue #139/#231) : chaque mesure est classée dans SON groupe de comparaison
# (commune → les communes de son EPCI, ou les communes de la région sans EPCI ;
# EPCI → tous les EPCIs bretons ; département → les départements — ADR-0021)
# avec la MACHINERIE PARTAGÉE rang_ordinal_par_groupe (compute.R) — l'ordinal
# directionnel « Xᵉ / Y » (ADR-0015), les NA exclus du dénominateur. Depuis
# l'audit ordinal de l'issue #368, AUCUN détail ne se repose sur le défaut
# high-is-good : la direction de SA clé (la déclaration DIRECTIONS_MOBILITE —
# high-is-good par design pour les trois clés multi-mesures : plus de mesure,
# mieux) est passée à chaque rang_ordinal_par_groupe. `territoires` est le
# squelette partagé du thème (la forme de construire_territoires_mobilite).
# Sortie longue (code × key × detail × les trois rangs et leurs tailles),
# triée par code puis détail — déterministe.
construire_rangs_detail <- function(table_long, territoires,
                                    directions = DIRECTIONS_MOBILITE) {
  groupes <- groupes_comparaison(territoires)
  tab <- dplyr::left_join(
    territoires[c("code", "type", "epci", "departement")],
    table_long,
    by = "code"
  )

  groupes_detail <- unique(tab[c("key", "detail")])
  groupes_detail <- groupes_detail[order(groupes_detail$key,
                                         groupes_detail$detail,
                                         na.last = TRUE), , drop = FALSE]
  dplyr::bind_rows(lapply(seq_len(nrow(groupes_detail)), function(i) {
    cle <- groupes_detail$key[[i]]
    detail <- groupes_detail$detail[[i]]
    lignes <- tab[tab$key == cle & (is.na(tab$detail) == is.na(detail)) &
                    (is.na(detail) | tab$detail == detail), , drop = FALSE]
    # la direction DÉCLARÉE de la clé (issue #368 — aucune clé ne se repose sur
    # le défaut high-is-good de rang_ordinal_par_groupe) ; une clé sans
    # déclaration est une erreur de descripteur, jamais un défaut silencieux
    if (!cle %in% names(directions)) {
      stop("construire_rangs_detail : la clé « ", cle,
           " » n'a pas de direction déclarée (DIRECTIONS_MOBILITE).",
           call. = FALSE)
    }
    tibble::tibble(
      code = lignes$code,
      key = cle,
      detail = detail,
      rang_epci = rang_ordinal_par_groupe(lignes$value, groupes$epci,
                                          direction = directions[[cle]]),
      rang_epci_n = taille_groupe(lignes$value, groupes$epci),
      rang_dep = rang_ordinal_par_groupe(lignes$value, groupes$dep,
                                         direction = directions[[cle]]),
      rang_dep_n = taille_groupe(lignes$value, groupes$dep),
      rang_reg = rang_ordinal_par_groupe(lignes$value, groupes$reg,
                                         direction = directions[[cle]]),
      rang_reg_n = taille_groupe(lignes$value, groupes$reg)
    )
  })) %>%
    dplyr::arrange(code, detail)
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
  tot <- analytiques$tot_loss_territoires
  if (is.null(tot) || !all(c("tot_loss_t", "tot_loss_b") %in% names(tot)))
    stop("compute_histoires_mobilite : tot_loss absent des analytiques.", call. = FALSE)
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
    # The resolved payload has one row per (territoire, groupe).  The vélo
    # reading therefore carries the default reading's shared distribution
    # explicitly; it must never rely on a second default row at app runtime.
    dplyr::left_join(signature, by = "code") %>%
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
                   div_loss_t, div_loss_b, delta, classification_saillance,
                   dens_min, dens_max, dplyr::all_of(paste0("dens_", 1:10)),
                   dplyr::all_of(paste0("dec_", 1:10))) %>%
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
  # les parts voitures/ménage sont des parts dans [0, 1] (une part hors de la
  # borne est une corruption — un ratio RP qui déraille, jamais un NA)
  function(payload) {
    voitures <- payload$indicateurs$value[
      payload$indicateurs$key == "voitures_menage"]
    if (any(!is.na(voitures) & (voitures < 0 | voitures > 1))) {
      stop("Payload invalide : une part voitures/ménage sort de [0, 1].",
           call. = FALSE)
    }
    invisible(payload)
  },
  # les TROIS parts voitures/ménage (0 / 1 / 2+) SOMMENT à 1 par territoire
  # (issue #368 — la dimension CARS partitionne les ménages : C0 + C1 + C_GE2
  # = _T ; un total qui déraille est une corruption)
  function(payload) {
    parts <- stats::aggregate(
      value ~ territoire,
      payload$indicateurs[payload$indicateurs$key == "voitures_menage", ],
      sum
    )
    if (any(abs(parts$value - 1) > 1e-6)) {
      stop("Payload invalide : les parts voitures/ménage ne somment pas à 1.",
           call. = FALSE)
    }
    invisible(payload)
  },
  # les réseaux sont des longueurs et densités non négatives (une mesure
  # négative est une corruption — jamais une longueur publiée négative)
  function(payload) {
    reseaux <- payload$indicateurs$value[payload$indicateurs$key == "reseaux"]
    if (any(!is.na(reseaux) & reseaux < 0)) {
      stop("Payload invalide : une longueur ou densité de réseau négative.",
           call. = FALSE)
    }
    invisible(payload)
  },
  # l'offre TC est une part dans [0, 1] (une valeur NA — commune sans bâtiment
  # dans la couche — est un cas légitime, jamais une corruption)
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
  },
  function(payload) {
    keys <- payload$indicateurs$key
    p <- payload$indicateurs$value[keys == "places_stationnement_voiture_1000"]
    r <- payload$indicateurs$value[keys == "bornes_ev_par_station_service"]
    if (any(!is.na(c(p, r)) & c(p, r) < 0))
      stop("Payload invalide : stationnement voiture ou ratio EV/fuel négatif.", call. = FALSE)
    invisible(payload)
  },
  # la figure « L'offre cyclable » (issue #231) : des longueurs et taux non
  # négatifs (une longueur protégé/partagé/total négative — le numérateur du
  # ratio — ou un km/1 000 hab négatif est une corruption, jamais une offre
  # publiée négative)
  function(payload) {
    cyclable <- payload$indicateurs$value[
      payload$indicateurs$key == "offre_cyclable"]
    if (any(!is.na(cyclable) & cyclable < 0)) {
      stop("Payload invalide : une longueur ou un km/1 000 hab de l'offre ",
           "cyclable négatif.", call. = FALSE)
    }
    invisible(payload)
  },
  # les 15 parts d'accès et leurs 5 miroirs sont des parts dans [0, 1] (une
  # part hors de la borne est une corruption, jamais une part de bâtiments
  # supérieure à 100 %)
  function(payload) {
    parts <- payload$indicateurs$value[
      payload$indicateurs$key %in% c(names(CLES_ACCES_MOBILITE),
                                     names(CLES_ISOLATION_MOBILITE))]
    if (any(!is.na(parts) & (parts < 0 | parts > 1))) {
      stop("Payload invalide : une part d'accès sort de [0, 1].",
           call. = FALSE)
    }
    invisible(payload)
  },
  # LE RACCORDEMENT (issue #486) : les parts joignables — scalaire, courbe et
  # référence — sont des parts dans [0, 1] (une valeur NA — la commune non
  # routée au géocode DILA aberrant, son motif nommé voyage dans `rider` — est
  # légitime ; une part hors de la borne est une corruption du calcul)
  function(payload) {
    racc <- payload$indicateurs$value[
      payload$indicateurs$key %in% c("raccordement_tc", "raccordement_courbe",
                                     "raccordement_reference")]
    if (any(!is.na(racc) & (racc < 0 | racc > 1))) {
      stop("Payload invalide : une part de population joignable (raccordement)",
           " sort de [0, 1].", call. = FALSE)
    }
    invisible(payload)
  },
  # la projection BPE est optionnelle pour les fixtures historiques, mais
  # lorsqu'elle est présente elle porte exactement sa forme bornée — aucun
  # tableau interne ou profil vide ne doit franchir le seam public
  function(payload) {
    if (!"profils_acces_bpe" %in% names(payload) ||
        is.null(payload$profils_acces_bpe)) return(invisible(payload))
    verifier_contrat_projection_profils_acces_bpe(payload$profils_acces_bpe)
    invisible(payload)
  },
  # la GRILLE de la courbe du raccordement : les 11 détails déclarés « t0000 »
  # → « t0360 » — un détail hors grille, ancien ou mal formé est une
  # corruption, jamais une courbe qui ment sur son axe
  function(payload) {
    grille_attendue <- grille_raccordement()
    for (cle in c("raccordement_courbe", "raccordement_reference")) {
      lignes <- payload$indicateurs[
        payload$indicateurs$key == cle &
          !is.na(payload$indicateurs$detail), , drop = FALSE]
      par_territoire <- split(lignes$detail, lignes$territoire)
      if (length(par_territoire) > 0 && any(!vapply(
        par_territoire,
        function(details) identical(as.character(details), grille_attendue),
        logical(1L)))) {
        stop("Payload invalide : la grille de la courbe du raccordement ",
             "(", cle, ") n'est pas la grille publiée déclarée.",
             call. = FALSE)
      }
    }
    invisible(payload)
  }
)

# construire_payload_mobilite --------------------------------------------------
# L'assembleur du payload du thème : les quatre tables du contrat (la forme
# d'compute_payload, compute.R) — indicateurs (les quatorze clés — les onze
# historiques + le raccordement #486 — avec rangs + estampilles T7, les 5
# parts d'isolation portant l'estampille snapshot),
# histoires (les deux story keys), territoires (référence partagée), la
# projection BPE bornée et apercu (vide — gating). Validé par la validation
# GÉNÉRIQUE avec les tables
# déclaratives du thème — un payload invalide s'arrête là.
construire_payload_mobilite <- function(analytiques, base_epci, vintages) {
  territoires <- construire_territoires_mobilite(base_epci, analytiques)

  payload <- list(
    indicateurs = construire_indicateurs_mobilite(analytiques, territoires, vintages),
    # Issue #312 : le pool de Stories se RÉSOUT ici — une lecture par
    # (territoire, groupe), la saillance vélo remplace le défaut là où elle
    # tire, jamais le pool dans le payload (ADR-0002)
    histoires = resoudre_histoires(
      compute_histoires_mobilite(analytiques, vintages), "mobilite"),
    territoires = reference_territoires(territoires),
    profils_acces_bpe = analytiques$profils_acces_bpe,
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
# sont régénérés sous data/processed/mobilite/), LIT l'artefact du
# RACCORDEMENT calculé (issue #486 — `raccordement` : le chemin de l'enveloppe
# passée par la cible du graphe, ou à défaut le répertoire analytique
# conventionnel ; absent ou périmé, la lecture s'arrête bruyamment — les parts
# ne se recalculent QUE quand leurs entrées figées changent, jamais au fil des
# republications), assemble le payload, le valide et le publie via la
# machinerie PARTAGÉE publish (backend "static" par défaut — parquet +
# projections JSON + vintages). Retourne le payload, comme run_pipeline
# l'attend.
publier_mobilite <- function(donnees, cache = "data/raw", vintages = NULL,
                             sortie = "public/data",
                             sortie_analytiques = file.path(dirname(cache),
                                                            "processed", "mobilite"),
                             raccordement = NULL) {
  if (is.null(vintages)) vintages <- vintages_mobilite()

  base_epci <- lire_epci(file.path(cache, "extracted", "EPCI_au_01-01-2025.xlsx"))
  analytiques <- construire_analytiques_mobilite(donnees, base_epci,
                                                 sortie = sortie_analytiques)
  analytiques$raccordement <- lire_raccordement(
    if (is.null(raccordement)) sortie_analytiques else raccordement)
  payload <- construire_payload_mobilite(analytiques, base_epci, vintages)
  publish(payload, sortie)
  payload
}

# MEMBRES_DESCRIPTEUR_MOBILITE -------------------------------------------------
# Les membres requis du descripteur — le contrat de FORME du thème (ce que la
# machinerie partagée consomme : theme, manifest, vintages, construire_donnees
# — et ce que le run branche : construire_analytiques, publier). `directions`
# est requis depuis l'audit ordinal de l'issue #368 : chaque clé classée
# déclare SA désirabilité (ADR-0015) — un descripteur sans déclaration se
# reposerait sur le défaut high-is-good. La même idée que
# MEMBRES_DESCRIPTEUR_ECONOMIE : un descripteur incomplet échoue FORT, en
# nommant le membre fautif.
MEMBRES_DESCRIPTEUR_MOBILITE <- c(
  "theme", "manifest", "vintages", "construire_donnees",
  "construire_analytiques", "publier", "directions", "metadata",
  "raccordement"
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

# DIRECTIONS_MOBILITE ----------------------------------------------------------
# La désirabilité par clé (ADR-0015, l'audit ordinal de l'issue #368) — AUCUNE
# clé ne se repose sur le défaut high-is-good. Les CINQ parts d'isolation de la
# grille sont low-is-good (le cadrage en privation : moins de bâtiments sans
# accès, mieux — la machinerie de construire_rangs_isolation les classe low) ;
# tout le reste est high-is-good, le scalaire classé de chaque clé nommé :
# la part sans voiture pour voitures_menage, la longueur vélo pour reseaux, la
# part près d'un arrêt pour offre_tc, les bornes, le stationnement vélo, la
# longueur protégée/totale pour offre_cyclable. Les LECTURES de la Story
# (div_loss_t/b — le nombre de types de services qui disparaissent) sont elles
# aussi déclarées low-is-good : moins de services perdus, mieux — ce sont des
# valeurs de lecture, jamais des clés du registre. La constante est la SOURCE
# UNIQUE : le descripteur (theme_mobilite) et la machinerie de rangs
# (construire_indicateurs_mobilite) la consomment — jamais un appel à
# theme_mobilite() depuis un builder (le graphe targets ne peut pas suivre le
# cycle descriptor → builder → descriptor).
DIRECTIONS_MOBILITE <- list(
  voitures_menage = "high",
  reseaux = "high",
  offre_tc = "high",
  bornes_recharge = "high",
  places_stationnement_velo_1000 = "high",
  places_stationnement_voiture_1000 = "low",
  bornes_ev_par_station_service = "high",
  stationnement_velo_par_voiture = "high",
  tot_loss_t = "low",
  tot_loss_b = "low",
  offre_cyclable = "high",
  div_loss_t = "low",
  div_loss_b = "low",
  raccordement_tc = "high",
  # les deux clés de MATIÈRE DE FIGURE du raccordement (#486) : déclarées
  # pour l'audit directions↔registre (la bijection du contrat), jamais
  # consommées — des courbes ne sont classées nulle part
  raccordement_courbe = "high",
  raccordement_reference = "high",
  share_food_t = "high", share_food_b = "high", share_food_c = "high",
  share_health_t = "high", share_health_b = "high", share_health_c = "high",
  share_admin_t = "high", share_admin_b = "high", share_admin_c = "high",
  share_school_t = "high", share_school_b = "high", share_school_c = "high",
  share_bank_t = "high", share_bank_b = "high", share_bank_c = "high",
  iso_alimentation = "low", iso_sante = "low",
  iso_administration = "low", iso_ecole = "low", iso_banque = "low"
)

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
    publier = publier_mobilite,
    # la désirabilité par clé — la constante DIRECTIONS_MOBILITE (l'audit
    # ordinal de l'issue #368 : aucune clé ne se repose sur le défaut
    # high-is-good)
    directions = DIRECTIONS_MOBILITE,
    # Issue #311 : les métadonnées du thème (le fichier épinglé
    # inst/extdata/theme-metadata/) — publiées par run_pipeline après le
    # payload, jamais un recompute des tables de faits
    metadata = function() lire_theme_metadata("mobilite"),
    # LE TRAIT RACCORDEMENT (issue #486) : le graphe le voit et câble la
    # chaîne de calcul — les épingles du package en cibles de fichiers, la
    # cible raccordement_mobilite (le calcul, persisté), la publication
    # chaînée derrière. Le mode cron pose cue = "never" sur la chaîne :
    # l'horloge légère ne paie JAMAIS le raccordement.
    raccordement = TRUE
  )
  verifier_descripteur_mobilite(descripteur)
  descripteur
}
