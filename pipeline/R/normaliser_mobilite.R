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
  "nb_buildings", "med_tot_loss_t", "med_tot_loss_b"
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
  if (!"highway" %in% names(lignes)) {
    stop("Extrait OSM corrompu — la couche des lignes ne porte pas highway.",
         call. = FALSE)
  }
  lignes
}

# Parking fermé (ways + relations) shares the Geofabrik extract with networks.
# Nodes and non-parking features are deliberately not admitted to the contract.
normaliser_parkings_osm <- function(x) {
  if (!"amenity" %in% names(x)) stop("OSM parkings : colonne amenity absente.", call. = FALSE)
  # Do not let NA in the GDAL attribute vector select an NA feature row.
  # The OSM multipolygon driver can append one such geometry-collection row;
  # it is not a parking feature and has no polygonal area to attribute.
  amenity <- as.character(x$amenity)
  x <- x[!is.na(amenity) & amenity == "parking", , drop = FALSE]
  if (!"osm_id" %in% names(x)) stop("OSM parkings : osm_id absent.", call. = FALSE)
  x <- x[!duplicated(as.character(x$osm_id)), , drop = FALSE]
  # The OSM multipolygon layer contains a small number of invalid relations
  # (usually duplicate edges between member ways).  Repair at ingestion, before
  # any area or commune attribution operation.  st_make_valid preserves the
  # polygonal area and can legitimately return POLYGON for a MULTIPOLYGON.
  x <- sf::st_make_valid(x)
  if (any(!sf::st_is_valid(x)))
    stop("OSM parkings : géométrie invalide après réparation.", call. = FALSE)
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

# BPE25 is an equipment-row file: one retained B316 row is one station.
selectionner_bpe_b316_2025 <- function(x) {
  requis <- c("DEPCOM", "TYPEQU")
  manquantes <- setdiff(requis, names(x))
  if (length(manquantes)) stop("BPE25 : colonne(s) manquante(s) : ",
                               paste(manquantes, collapse = ", "), ".", call. = FALSE)
  type <- toupper(trimws(as.character(x$TYPEQU)))
  if (any(is.na(type) | !nzchar(type)))
    stop("BPE25 : TYPEQU ne doit pas être manquant.", call. = FALSE)
  if ("GEO_OBJECT" %in% names(x)) x <- x[as.character(x$GEO_OBJECT) == "COM", , drop = FALSE]
  type <- toupper(trimws(as.character(x$TYPEQU)))
  y <- x[type == "B316", , drop = FALSE]
  if (!nrow(y)) stop("BPE25 : aucune observation communale B316 pour 2025.", call. = FALSE)
  depcom <- as.character(y$DEPCOM)
  if (any(!grepl("^[0-9]{5}$", depcom)))
    stop("BPE25 : code commune invalide pour B316.", call. = FALSE)
  y <- y[substr(depcom, 1, 2) %in% DEPT_BRETAGNE, , drop = FALSE]
  if (!nrow(y)) stop("BPE25 : aucune observation communale B316 pour 2025.", call. = FALSE)
  y <- tibble::tibble(GEO = as.character(y$DEPCOM), FACILITIES = "B316", NB_EQUIP = 1)
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
