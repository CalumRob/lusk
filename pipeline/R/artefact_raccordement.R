# artefact_raccordement ------------------------------------------------------------
# Les artefacts VERSIONNÉS du raccordement (issue #485, parent #482 — la
# fondation données de « Population bretonne joignable en 90 minutes en TC »).
# La matrice des temps mairie à mairie et la table des mairies produites par la
# recherche (E1–E6 passées, docs/research/accessibilite-extra-communale.md
# §5a/§5b/§5c) migrent ici comme artefacts de code ÉPINGLÉS sous inst/extdata —
# le même pattern que l'artefact NAF→A17 (#426) : une transcription une fois,
# versionnée avec le pipeline, jamais re-calculée à l'exécution, jamais un
# téléchargement. Le calcul lourd (acquire → derive → build → route) est le
# travail de la chaîne targets à venir ; en attendant, TOUTE consommation
# part de CES fichiers vérifiés.
#
#   - mairies_bretagne.csv          : les 1 213 points mairie bretons extraits
#     de l'édition DILA « Base de données locales » du 2026-08-25 (id INSEE,
#     lat, lon) — la géométrie « Mairie à mairie », 1 202 communes COG 2025
#     couvertes ;
#   - matrice_temps_mairies.csv.gz  : la matrice OD figée (250 482 paires
#     routées sur exactement 1 200 × 1 200 communes), colonnes from_id /
#     to_id / travel_time_p01 / travel_time_p50 — le meilleur départ de la
#     journée (p01) est la sémantique retenue, p50 voyage à ses côtés.
#
# LA RECETTE FIGÉE (estampillée dans RECETTE_MATRICE_TEMPS_MAIRIES) :
# feeds SNCF Voyageurs national (version 2026-08-24) + KorrigoBret v80335,
# mercredi réel de période scolaire 2026-09-16, fenêtre de départ 07:00–20:00,
# meilleur départ p01, marche ≤ 40 min aux deux extrémités, durée plafonnée à
# 600 min, r5r schedule-based, élévation NONE, aucun tronçon voiture.
#
# LE CONTRAT REFUSE TOUT SUBSTITUT (la garde du snapshot porté, durcie) : le
# nom de fichier épinglé est constant et l'empreinte sha256 est RECALCULÉE
# SUR LE DISQUE à chaque vérification (openssl hache les OCTETS du fichier
# relu — jamais la seule métadonnée déclarée par l'enveloppe) : une copie
# renommée, un fichier illisible ou un seul octet modifié échouent bruyamment
# en nommant la règle.
#
# Les DEUX CAVEATS constatés à la migration sont documentés, jamais corrigés
# en silence (la fidélité au figé d'abord ; l'alignement COG est le travail du
# ticket de calcul, via la discipline passage_cog()) :
#   - 13 entrées mairie portent un géocode aberrant À L'EST de la Bretagne
#     (lon > -0,5 — un défaut de géocodage DILA) ; ce sont EXACTEMENT les 13
#     communes absentes de la matrice (non routables dans l'extrait) ;
#   - 11 identités pré-fusion 2022→2025 (22027+22043, 22200, 22309, 35112,
#     35113, 35303, 35341, 35348, 56049, 56059) portent des lignes de la
#     matrice alors qu'elles ont quitté le COG 2025 — la projection vers le
#     squelette communal se fera côté consommateur.

# MAIRIES_BRETAGNE_FICHIER ----------------------------------------------------------
# Le nom épinglé de la table des mairies sous inst/extdata (un artefact de
# code — jamais un autre nom, jamais un substitut).
MAIRIES_BRETAGNE_FICHIER <- "mairies_bretagne.csv"

# MATRICE_TEMPS_MAIRIES_FICHIER -----------------------------------------------------
# Le nom épinglé de la matrice temps sous inst/extdata.
MATRICE_TEMPS_MAIRIES_FICHIER <- "matrice_temps_mairies.csv.gz"

# MAIRIES_BRETAGNE_SHA256 / MATRICE_TEMPS_MAIRIES_SHA256 ----------------------------
# Les empreintes des fichiers migrés VERBATIM depuis la recherche vérifiée
# (E:\Temp\opencode\e1-r5r, constats §5a/§5c) — la trace du refus de tout
# substitut de contenu : à chaque vérification du contrat, les octets du
# fichier épinglé sont relus du disque, hachés (openssl) et comparés à CETTE
# constante.
MAIRIES_BRETAGNE_SHA256 <-
  "37cf11addb965dccfb82877ee92864587932fe4bb0937a21df66771f5cfe42be"
MATRICE_TEMPS_MAIRIES_SHA256 <-
  "af12b4e6207bbf06c64d572cbd405cc41388057e61545f7d23dafd082ca6445c"

# RECETTE_MATRICE_TEMPS_MAIRIES -----------------------------------------------------
# La recette EXACTE de la production figée (la spécification parente #482) :
# chaque paramètre est une constante nommée — jamais dispersée dans la prose.
RECETTE_MATRICE_TEMPS_MAIRIES <- list(
  date_mesure = "2026-09-16",        # le mercredi réel de période scolaire
  fenetre_depart = "07:00",
  fenetre_fin = "20:00",
  duree_fenetre_min = 780L,
  percentile = 1L,                   # le meilleur départ de la journée (p01)
  marche_max_min = 40L,              # aux deux extrémités
  cap_duree_min = 600L,
  feed_korrigo_version = "80335",    # KorrigoBret frais (zip brut 663d7db6…)
  feed_sncf_version = "2026-08-24",  # export national SNCF Voyageurs
  edition_dila = "2026-08-25",       # l'édition BDL des points mairie
  geometrie = "mairie a mairie",     # Mairie à mairie (identifiant sans accent)
  moteur = "r5r schedule-based",     # élévation NONE, aucun tronçon voiture
  fleche_unique = TRUE               # ρ = 0,99 out/in (§5b/E4) : un seul nombre
)

# lire_mairies_bretagne ---------------------------------------------------------------
# Le lecteur de la table épinglée. Les ids INSEE restent CARACTÈRES (jamais de
# devinette numérique — la même discipline que les codes NAF) ; les coordonnées
# sont numérisées explicitement. `chemin` permet aux tests de passer une copie
# altérée ; par défaut, la ressource épinglée du package.
lire_mairies_bretagne <- function(chemin = NULL) {
  if (is.null(chemin)) {
    chemin <- system.file("extdata", MAIRIES_BRETAGNE_FICHIER, package = "lusk")
  }
  if (is.na(chemin) || !nzchar(chemin) || !file.exists(chemin)) {
    stop(sprintf(
      "Artefact raccordement — %s introuvable : la table des mairies épinglée doit exister (la géométrie Mairie à mairie).",
      MAIRIES_BRETAGNE_FICHIER), call. = FALSE)
  }
  table <- readr::read_csv(
    chemin,
    col_types = readr::cols(
      id = readr::col_character(),
      lat = readr::col_double(),
      lon = readr::col_double()
    ),
    show_col_types = FALSE
  )
  table
}

# lire_matrice_temps_mairies -----------------------------------------------------------
# Le lecteur de la matrice épinglée : ids caractères, temps numériques.
lire_matrice_temps_mairies <- function(chemin = NULL) {
  if (is.null(chemin)) {
    chemin <- system.file("extdata", MATRICE_TEMPS_MAIRIES_FICHIER,
                          package = "lusk")
  }
  if (is.na(chemin) || !nzchar(chemin) || !file.exists(chemin)) {
    stop(sprintf(
      "Artefact raccordement — %s introuvable : la matrice temps épinglée doit exister (le calcul ne se refait JAMAIS à l'exécution).",
      MATRICE_TEMPS_MAIRIES_FICHIER), call. = FALSE)
  }
  brut <- readr::read_csv(
    chemin,
    col_types = readr::cols(.default = readr::col_character()),
    show_col_types = FALSE
  )
  brut$travel_time_p01 <- as.numeric(brut$travel_time_p01)
  brut$travel_time_p50 <- as.numeric(brut$travel_time_p50)
  brut
}

# artefact_mairies_bretagne -------------------------------------------------------------
# L'enveloppe VERSIONNÉE de la table des mairies : les métadonnées du contrat +
# la table relue. Construit à la demande — la table est revérifiée à chaque
# consommation (un fichier corrompu sur disque échoue là où il est lu).
artefact_mairies_bretagne <- function() {
  list(
    id = "mairies_bretagne",
    fichier = MAIRIES_BRETAGNE_FICHIER,
    sha256 = MAIRIES_BRETAGNE_SHA256,
    source = paste0(
      "DILA — « Base de données locales » (Service-public.gouv.fr, ",
      "Annuaire de l'administration, v4) : les points mairie (géocodage ",
      "lat/lon de l'entrée « Mairie » de chaque commune)"
    ),
    url = paste0(
      "https://lecomarquage.service-public.gouv.fr/donnees_locales_v4/",
      "all_latest.tar.bz2"
    ),
    vintage = "2026-08-25",
    licence = "Licence Ouverte 2.0 (Etalab) — paternité Service-Public.gouv.fr / DILA",
    note = NOTE_ARTEFACT_MAIRIES_BRETAGNE,
    table = lire_mairies_bretagne()
  )
}

NOTE_ARTEFACT_MAIRIES_BRETAGNE <- paste0(
  "Les points mairie du raccordement (issue #485, parent #482) : 1 213 ",
  "entrées bretonnes de l'édition DILA du 2026-08-25 (id INSEE, lat, lon), ",
  "couverture complète des 1 202 communes COG 2025 — les îles comprises ",
  "(la raison d'être de la géométrie Mairie à mairie : aucun territoire ",
  "n'est rendu vide par l'absence de bâtiment géocodé). CAVEAT documenté, ",
  "jamais corrigé en silence : 13 entrées portent un géocode aberrant à ",
  "l'EST de la Bretagne (lon > -0,5 — un défaut de géocodage DILA) et ce ",
  "sont EXACTEMENT les 13 communes non routées de la matrice ; 11 entrées ",
  "portent un code pré-fusion 2022→2025 (22027, 22043, 22200, 22309, 35112, ",
  "35113, 35303, 35341, 35348, 56049, 56059) — la projection vers le ",
  "squelette COG 2025 est le travail du consommateur (discipline ",
  "passage_cog). Empreinte sha256 épinglée : tout substitut de contenu est ",
  "refusé."
)

# artefact_matrice_temps ------------------------------------------------------------------
# L'enveloppe VERSIONNÉE de la matrice temps : métadonnées + recette + table.
artefact_matrice_temps <- function() {
  list(
    id = "matrice_temps_mairies",
    fichier = MATRICE_TEMPS_MAIRIES_FICHIER,
    sha256 = MATRICE_TEMPS_MAIRIES_SHA256,
    source = paste0(
      "Lusk — matrice temps mairie à mairie figée de la recherche ",
      "« Population bretonne joignable en 90 minutes en TC » (routage r5r ",
      "sur SNCF Voyageurs national 2026-08-24 + KorrigoBret v80335, ",
      "recherche docs/research/accessibilite-extra-communale.md §5c)"
    ),
    url = NA_character_,
    vintage = "2026-09-16",
    licence = paste0(
      "Calcul Lusk depuis des sources ouvertes — ODbL (SNCF, Korrigo/OSM, ",
      "ADR-0001) et Licence Ouverte 2.0 (DILA)"
    ),
    recette = RECETTE_MATRICE_TEMPS_MAIRIES,
    note = NOTE_ARTEFACT_MATRICE_TEMPS,
    table = lire_matrice_temps_mairies()
  )
}

NOTE_ARTEFACT_MATRICE_TEMPS <- paste0(
  "La matrice temps du raccordement (issue #485, parent #482) : 250 482 ",
  "paires origine-destination routées sur exactement 1 200 × 1 200 communes, ",
  "colonnes from_id / to_id / travel_time_p01 / travel_time_p50 (minutes). ",
  "Recette FIGÉE : mercredi réel de période scolaire 2026-09-16, départ ",
  "07:00–20:00 (780 min), meilleur départ de la journée (p01 — la sémantique ",
  "retenue ; p50 voyage à ses côtés pour la courbe complète), marche ≤ 40 ",
  "min aux deux extrémités, cap 600 min, r5r schedule-based élévation NONE, ",
  "aucun tronçon voiture, flèche unique (ρ = 0,99 out/in, §5b/E4). Feeds : ",
  "SNCF Voyageurs national version 2026-08-24 (sha256 816d172f…) + ",
  "KorrigoBret v80335 (zip brut 663d7db6…, agrégat allégé de son agence SNCF ",
  "au routage — 51394e80…) ; points mairie DILA édition 2026-08-25. ",
  "COUVERTURE (constat de migration, documenté jamais corrigé en silence) : ",
  "les ids de la matrice sont les 1 200 points mairie routables — hors les ",
  "13 géocodes aberrants à l'est de la Bretagne (voir artefact_mairies_",
  "bretagne) ; 11 identités pré-fusion 2022→2025 y figurent encore — ",
  "l'alignement COG est le travail du consommateur. La diagonale (inclusion ",
  "propre t ≈ 0) y est ; p01 complet ≤ 600. Un nouveau millésime sera un ",
  "NOUVEL artefact versionné, jamais une réécriture silencieuse de celui-ci."
)

# verifier_contrat_mairies_bretagne --------------------------------------------------------
# Le contrat de la table des mairies : le fichier épinglé (nom + empreinte
# RECALCULÉE SUR LE DISQUE), les colonnes, la couverture constatée (1 213
# lignes, ids uniques, les quatre départements, coordonnées numériques
# finies). Toute violation échoue FORT en nommant le champ fautif et la règle.
# `chemin` permet aux tests de passer une copie altérée du fichier ; par
# défaut, la ressource épinglée du package (le même pattern que les lecteurs).
verifier_contrat_mairies_bretagne <- function(artefact, chemin = NULL) {
  manquer <- function(champ, detail) stop(sprintf(
    "Contrat mairies Bretagne violé — %s : %s.", champ, detail),
    call. = FALSE)

  requis <- c("id", "fichier", "sha256", "source", "vintage", "licence",
              "note", "table")
  manquants <- setdiff(requis, names(artefact))
  if (length(manquants) > 0) {
    manquer("forme", paste0("métadonnée(s) absente(s) : ",
                            paste(manquants, collapse = ", ")))
  }

  # LE fichier épinglé — la garde du snapshot porté : jamais un substitut
  # renommé (l'artefact d'une autre recette, un autre millésime renommé pour
  # ressembler au bon)
  if (!identical(artefact$fichier, MAIRIES_BRETAGNE_FICHIER)) {
    manquer("fichier", sprintf(
      "le contrat épingle %s — tout autre nom est un substitut refusé",
      MAIRIES_BRETAGNE_FICHIER))
  }

  # l'empreinte VÉRIFIÉE SUR LE DISQUE : les OCTETS du fichier épinglé sont
  # relus et hachés (openssl) à chaque vérification — jamais la seule
  # métadonnée déclarée par l'enveloppe ; un contenu corrompu ou substitué
  # échoue là où le fichier est lu. openssl::sha256 exige une CONNEXION
  # BINAIRE (« rb ») : un chemin passé en caractère hacherait la CHAÎNE du
  # chemin, pas le fichier.
  if (!is.character(artefact$sha256) ||
      !grepl("^[0-9a-f]{64}$", artefact$sha256)) {
    manquer("sha256", "empreinte absente ou mal formée")
  }
  if (is.null(chemin)) {
    chemin <- system.file("extdata", MAIRIES_BRETAGNE_FICHIER, package = "lusk")
  }
  if (is.na(chemin) || !nzchar(chemin) || !file.exists(chemin)) {
    manquer("fichier", paste0(
      MAIRIES_BRETAGNE_FICHIER,
      " introuvable ou illisible sur le disque — l'empreinte du fichier ",
      "épinglé doit rester recalculable"))
  }
  calculee <- paste(openssl::sha256(file(chemin, "rb")))
  if (!identical(calculee, MAIRIES_BRETAGNE_SHA256)) {
    manquer("sha256", sprintf(
      "empreinte recalculée sur le fichier lu (%s…) ≠ empreinte épinglée %s — le contenu n'est pas la table migrée verbatim",
      substr(calculee, 1, 8), MAIRIES_BRETAGNE_SHA256))
  }

  table <- artefact$table
  cols <- c("id", "lat", "lon")
  manquantes <- setdiff(cols, names(table))
  if (length(manquantes) > 0) {
    manquer("colonnes", paste0("manquante(s) : ",
                               paste(manquantes, collapse = ", ")))
  }

  # la couverture constatée à la migration (#485) : 1 213 entrées, ids
  # uniques, les quatre départements bretons, coordonnées finies
  if (nrow(table) != 1213L) {
    manquer("couverture", sprintf(
      "la table épinglée porte 1213 entrées bretonnes, pas %d",
      nrow(table)))
  }
  if (anyDuplicated(table$id) > 0) {
    manquer("id", "des codes INSEE en double")
  }
  if (!all(grepl("^[0-9]{5}$", table$id))) {
    manquer("id", "codes INSEE à cinq caractères attendus (caractères, jamais numériques)")
  }
  departements <- unique(substr(table$id, 1, 2))
  if (!setequal(departements, c("22", "29", "35", "56"))) {
    manquer("departements", "les quatre départements bretons 22/29/35/56 attendus")
  }
  if (anyNA(table$lat) || anyNA(table$lon) ||
      any(!is.finite(table$lat)) || any(!is.finite(table$lon))) {
    manquer("coordonnees", "toutes les positions doivent être numériques finies")
  }
  if (any(table$lat < 47 | table$lat > 49)) {
    manquer("coordonnees", "latitudes hors de la Bretagne (47–49)")
  }

  invisible(TRUE)
}

# verifier_contrat_matrice_temps -------------------------------------------------------------
# Le contrat de la matrice temps : le fichier épinglé (nom + empreinte
# RECALCULÉE SUR LE DISQUE), les colonnes, la forme figée (250 482 paires,
# 1200×1200, ids ⊆ mairies, pas de paire dupliquée, p01 complet dans [0, cap],
# la diagonale présente) et la recette exacte (chaque paramètre de la
# spécification, jamais une valeur approchante). Toute violation échoue FORT
# en nommant la règle. `chemin` permet aux tests de passer une copie altérée
# du fichier ; par défaut, la ressource épinglée du package (le même pattern
# que les lecteurs).
verifier_contrat_matrice_temps <- function(artefact, chemin = NULL) {
  manquer <- function(champ, detail) stop(sprintf(
    "Contrat matrice temps violé — %s : %s.", champ, detail), call. = FALSE)

  requis <- c("id", "fichier", "sha256", "source", "vintage", "licence",
              "recette", "note", "table")
  manquants <- setdiff(requis, names(artefact))
  if (length(manquants) > 0) {
    manquer("forme", paste0("métadonnée(s) absente(s) : ",
                            paste(manquants, collapse = ", ")))
  }

  # LE fichier épinglé — jamais un substitut renommé
  if (!identical(artefact$fichier, MATRICE_TEMPS_MAIRIES_FICHIER)) {
    manquer("fichier", sprintf(
      "le contrat épingle %s — tout autre nom est un substitut refusé",
      MATRICE_TEMPS_MAIRIES_FICHIER))
  }

  # l'empreinte VÉRIFIÉE SUR LE DISQUE : les OCTETS du fichier épinglé sont
  # relus et hachés (openssl) à chaque vérification — jamais la seule
  # métadonnée déclarée par l'enveloppe ; un contenu corrompu ou substitué
  # échoue là où le fichier est lu. openssl::sha256 exige une CONNEXION
  # BINAIRE (« rb ») : un chemin passé en caractère hacherait la CHAÎNE du
  # chemin, pas le fichier.
  if (!is.character(artefact$sha256) ||
      !grepl("^[0-9a-f]{64}$", artefact$sha256)) {
    manquer("sha256", "empreinte absente ou mal formée")
  }
  if (is.null(chemin)) {
    chemin <- system.file("extdata", MATRICE_TEMPS_MAIRIES_FICHIER,
                          package = "lusk")
  }
  if (is.na(chemin) || !nzchar(chemin) || !file.exists(chemin)) {
    manquer("fichier", paste0(
      MATRICE_TEMPS_MAIRIES_FICHIER,
      " introuvable ou illisible sur le disque — l'empreinte du fichier ",
      "épinglé doit rester recalculable"))
  }
  calculee <- paste(openssl::sha256(file(chemin, "rb")))
  if (!identical(calculee, MATRICE_TEMPS_MAIRIES_SHA256)) {
    manquer("sha256", sprintf(
      "empreinte recalculée sur le fichier lu (%s…) ≠ empreinte épinglée %s — le contenu n'est pas la matrice figée",
      substr(calculee, 1, 8), MATRICE_TEMPS_MAIRIES_SHA256))
  }

  # la recette EXACTE — chaque paramètre de la spécification
  recette <- artefact$recette
  attendus <- RECETTE_MATRICE_TEMPS_MAIRIES
  for (champ in names(attendus)) {
    if (!champ %in% names(recette) ||
        !identical(recette[[champ]], attendus[[champ]])) {
      manquer("recette", sprintf(
        "paramètre '%s' absent ou différent de la recette figée (%s)",
        champ, paste(deparse(attendus[[champ]]), collapse = "")))
    }
  }

  table <- artefact$table
  cols <- c("from_id", "to_id", "travel_time_p01", "travel_time_p50")
  manquantes <- setdiff(cols, names(table))
  if (length(manquantes) > 0) {
    manquer("colonnes", paste0("manquante(s) : ",
                               paste(manquantes, collapse = ", ")))
  }

  # la forme figée : 250 482 paires, 1200 × 1200
  if (nrow(table) != 250482L) {
    manquer("forme", sprintf(
      "la matrice figée porte 250482 paires, pas %d", nrow(table)))
  }
  origins <- unique(table$from_id)
  destinations <- unique(table$to_id)
  if (length(origins) != 1200L || length(destinations) != 1200L) {
    manquer("couverture", sprintf(
      "1200 origines × 1200 destinations attendues, pas %d × %d",
      length(origins), length(destinations)))
  }
  if (!all(origins %in% destinations) || !all(destinations %in% origins)) {
    manquer("couverture", "les ensembles d'origines et de destinations doivent coïncider")
  }

  # les ids sont des communes à point mairie — jamais un code inventé
  mairies <- lire_mairies_bretagne()
  hors_mairie <- setdiff(origins, mairies$id)
  if (length(hors_mairie) > 0) {
    manquer("ids", sprintf(
      "%d id(s) sans point mairie : %s", length(hors_mairie),
      paste(utils::head(hors_mairie, 10), collapse = ", ")))
  }

  # pas de paire dupliquée (une ligne par paire orientée)
  if (anyDuplicated(paste(table$from_id, table$to_id)) > 0) {
    manquer("paires", "une paire orientée dupliquée")
  }

  # p01 complet et sous le cap — la sémantique du meilleur départ est définie
  # pour CHAQUE paire stockée ; p50 peut porter des NA (services clairsemés,
  # constat E5 : 89 109 médianes infinies documentées)
  if (anyNA(table$travel_time_p01)) {
    manquer("p01", "le meilleur départ (p01) doit être défini pour chaque paire")
  }
  cap <- artefact$recette$cap_duree_min
  if (any(table$travel_time_p01 < 0) || any(table$travel_time_p01 > cap)) {
    manquer("cap", sprintf(
      "p01 doit rester dans [0, %d] — une valeur hors cap casse la sémantique du figé",
      cap))
  }

  # la diagonale : l'inclusion propre t = 0 de la spécification (une ligne
  # par commune, i → i)
  diagonales <- sum(table$from_id == table$to_id)
  if (diagonales != 1200L) {
    manquer("diagonale", sprintf(
      "1200 lignes diagonales attendues (l'inclusion propre t = 0), pas %d",
      diagonales))
  }

  invisible(TRUE)
}
