# normaliser_mobilite -----------------------------------------------------------
# Le lecteur et le normaliseur du snapshot porté de Mobilité (issue #137) :
# le CSV bretagne_mobility_super_dashboard_gravity.csv (une ligne par commune,
# ~2 061 colonnes — l'identité, les métriques d'accessibilité aux trois modes,
# les déciles, les signatures de densité, puis les MÊMES familles aux niveaux
# _epci/_dep/_reg déjà agrégés dans le fichier). Le portage EST le fichier :
# la table normalisée conserve TOUTES les colonnes — les tickets #138 (grille
# d'isolation + div_loss + Story), #139 (demande/réseaux) et #140 (sous-bloc)
# consommeront les familles directement depuis cette table.

# COLONNES_REQUISES_MOBILITE ----------------------------------------------------
# Les colonnes REQUISES du snapshot — la garde de forme du portage : l'identité
# (commune COG, nom, département, EPCI nommé) et la mesure signature du thème
# (nb_buildings — le nombre de bâtiments résidentiels analysés, la « Taille »).
# Toute colonne requise manquante (une vague qui change de structure) arrête
# la normalisation bruyamment — jamais un succès partiel silencieux.
COLONNES_REQUISES_MOBILITE <- c(
  "code_insee", "nom_commune", "code_departement_insee", "raison_sociale",
  "nb_buildings"
)

# MOTIF_NUMERIQUES_MOBILITE -----------------------------------------------------
# Le motif des colonnes NUMÉRIQUES du snapshot : tout ce qui n'est pas
# l'identité ou un libellé. Il couvre les familles métriques du dashboard —
# share_* (les parts d'accès), med_*/avg_* (les vulnérabilités), div_*/tot_*
# (les pertes de diversité et de volume), pct_iso_* (les parts isolées), les
# déciles *_dec_*, les parts par service dep_*/res_*, les rangs rank_*, les
# signatures de densité dens_* et la percentile régionale — aux TROIS niveaux
# (commune, _epci, _dep, _reg : le motif opère sur le nom complet). Tout le
# reste (region, raison_sociale, code_*, nom_commune, les libellés unique_*,
# les champs *_raw) reste en caractères — les codes ne sont JAMAIS devinés
# numériques.
MOTIF_NUMERIQUES_MOBILITE <- paste0(
  "^(nb_buildings|share_|med_|avg_|div_|tot_|pct_iso_|dep_|res_|rank_|dens_|",
  "region_percentile)"
)

# lire_snapshot_mobilite ---------------------------------------------------------
# Le lecteur du fichier réel. Tout en caractères : les codes (code_insee,
# code_departement_insee) ne doivent JAMAIS être devinés numériques (le « 29 »
# du département, le « 29011 » de la commune). La numérisation des métriques
# est l'affaire du normaliseur, jamais du lecteur. Non testé dans la boucle de
# test (comme lire_snapshot_sirene) : il lit le vrai fichier ; la
# normalisation, elle, est testée sur la forme réelle.
lire_snapshot_mobilite <- function(chemin) {
  readr::read_csv(
    chemin,
    col_types = readr::cols(.default = readr::col_character()),
    show_col_types = FALSE, progress = FALSE
  )
}

# normaliser_snapshot_mobilite ---------------------------------------------------
# La normalisation pure : un snapshot brut (tibble, une ligne par commune, tout
# en caractères) vers la table normalisée — l'identité vérifiée (la garde de
# forme) et les métriques numérisées. Les gardes s'ARRÊTENT bruyamment : le
# fichier porté est vérifié en production, toute déviation est une corruption,
# jamais une ligne silencieusement perdue. Retourne la table (la forme que
# construire_donnees_mobilite persiste et que le chaînon analytique consomme).
normaliser_snapshot_mobilite <- function(snapshot) {
  # 1. la garde de forme : les colonnes requises du portage
  manquantes <- setdiff(COLONNES_REQUISES_MOBILITE, names(snapshot))
  if (length(manquantes) > 0) {
    stop("Snapshot Mobilité corrompu — colonne(s) requise(s) manquante(s) : ",
         paste(manquantes, collapse = ", "), ".", call. = FALSE)
  }
  if (nrow(snapshot) == 0) {
    stop("Snapshot Mobilité corrompu — le fichier ne porte aucune ligne.",
         call. = FALSE)
  }

  # 2. l'identité : code INSEE COG 5 chiffres, département breton, nom présent
  if (any(!grepl("^[0-9]{5}$", snapshot$code_insee))) {
    stop("Snapshot Mobilité corrompu — un code_insee hors format COG ",
         "(5 chiffres).", call. = FALSE)
  }
  if (any(!snapshot$code_departement_insee %in% DEPT_BRETAGNE)) {
    stop("Snapshot Mobilité corrompu — un département hors Bretagne ",
         "(22/29/35/56).", call. = FALSE)
  }
  if (any(is.na(snapshot$nom_commune) | !nzchar(snapshot$nom_commune))) {
    stop("Snapshot Mobilité corrompu — une commune sans nom.", call. = FALSE)
  }

  # 3. la numérisation des métriques : une valeur qui refuse la conversion est
  # une corruption (une colonne métrique qui porte du texte), jamais une NA
  # silencieuse
  numeriques <- grepl(MOTIF_NUMERIQUES_MOBILITE, names(snapshot))
  table <- snapshot
  for (col in names(snapshot)[numeriques]) {
    converti <- suppressWarnings(as.numeric(table[[col]]))
    nouveaux_na <- is.na(converti) & !is.na(table[[col]])
    if (any(nouveaux_na)) {
      stop("Snapshot Mobilité corrompu — la colonne « ", col,
           " » porte des valeurs non numériques.", call. = FALSE)
    }
    table[[col]] <- converti
  }

  # 4. l'identité normalisée : la forme du contrat (commune / nom / departement
  # / epci_nom), triée par commune — déterministe
  table %>%
    dplyr::rename(
      commune = code_insee,
      nom = nom_commune,
      departement = code_departement_insee,
      epci_nom = raison_sociale
    ) %>%
    dplyr::arrange(commune)
}

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
#   C_GE2 -> menages_deux_plus.
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
      CARS %in% c("_T", "C0", "C_GE2"),
      # la Bretagne : le préfixe départemental du code commune (le même filtre
      # que le snapshot porté — jamais une commune hors 22/29/35/56)
      substr(GEO, 1, 2) %in% DEPT_BRETAGNE
    ) %>%
    dplyr::select(GEO, CARS, OBS_VALUE) %>%
    tidyr::pivot_wider(id_cols = GEO, names_from = CARS,
                       values_from = OBS_VALUE) %>%
    dplyr::rename(commune = GEO, menages_total = `_T`,
                  menages_sans_voiture = C0, menages_deux_plus = C_GE2)

  absentes <- setdiff(c("commune", "menages_total", "menages_sans_voiture",
                        "menages_deux_plus"), names(voitures))
  if (length(absentes) > 0) {
    stop("Voitures/ménage corrompu — la dimension CARS du cube ne porte pas ",
         "les comptes attendus (C0 / C_GE2 / _T) : ", paste(absentes, collapse = ", "),
         ".", call. = FALSE)
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
    dplyr::select(code_insee) %>%
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
  if (!"highway" %in% names(lignes)) {
    stop("Extrait OSM corrompu — la couche des lignes ne porte pas highway.",
         call. = FALSE)
  }
  lignes
}
