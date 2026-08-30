# calcul_raccordement --------------------------------------------------------------
# LE CALCUL du raccordement (issue #486, parent #482 — « Population bretonne
# joignable en 90 minutes en TC ») : depuis la matrice temps mairie à mairie
# FIGÉE SEULE (#485, artefact_raccordement.R) et les dénominateurs de
# population RP 2023, la part de la population bretonne joignable à chaque
# territoire en 90 minutes, la courbe cumulative complète (x = temps de
# trajet, y = part joignable) et la courbe de référence de la commune
# bretonne médiane.
#
# LA SÉMANTIQUE (le meilleur départ de la journée, p01, flèche unique —
# recherche §5b/§5c, E4 : ρ = 0,99 entre les deux flèches, un seul nombre) :
# la part INBOUND — « X % de la population bretonne peut rejoindre
# {territoire} » — lit la COLONNE du territoire : pour chaque commune
# d'origine j, le temps effectif vers le territoire c est
#
#     S(j → c) = min { t(p → q) : p point mairie de j, q point mairie de c }
#
# (on peut rejoindre une commune en atteignant N'IMPORTE lequel de ses
# points ; on peut en partir de n'importe lequel). L'inclusion propre t = 0
# est la diagonale de la matrice figée. Les paires absentes ne sont jamais
# joignables.
#
# LES DÉNOMINATEURS (revue pass 2 — sémantique ROUTÉS-SEULS pour les
# agrégats) :
#   - niveau COMMUN : W est TOUTE la population bretonne RP 2023, y compris
#     les communes non routées (leurs habitants restent des Bretons ; leur
#     propre part reste NA avec un motif nommé) ;
#   - niveaux EPCI / département / région : le dénominateur ne compte que la
#     population ROUTÉE du territoire — une commune non routable n'y entre
#     ni par ses poids ni par une auto-inclusion à t = 0 (le départements
#     n'est plus structurellement boosté, la région n'est plus une identité)
#     et la COUVERTURE — la part de la population du territoire réellement
#     mesurée par le routage — est publiée à côté de chaque scalaire
#     d'agrégat : rien n'est caché.
#
# LES DEUX CAVEATS DE LA MATRICE FIGÉE se résolvent ICI, jamais en silence :
#   - les identités pré-fusion portées par la matrice sont PROJETÉES vers
#     leur commune COG 2025 par resoudre_codes_cog() — la table de passage
#     annuelle INSEE balayée sur TOUS ses millésimes (un village absorbé
#     avant 2022 ne vit dans aucune colonne CODGEO_2022) ; une scission ou
#     un code inconnu s'arrête bruyamment (la discipline passage_cog, #227) ;
#   - les 13 communes au géocode DILA aberrant sont absentes de la matrice :
#     leur part reste NA avec un MOTIF NOMMÉ — jamais un zéro silencieux.

# POPULATION_RACCORDEMENT_FICHIER ---------------------------------------------------
# Le nom épinglé de la table des populations sous inst/extdata.
POPULATION_RACCORDEMENT_FICHIER <- "population_communes_2023.csv"

# POPULATION_RACCORDEMENT_SHA256 ----------------------------------------------------
# L'empreinte du fichier épinglé — RECALCULÉE SUR LE DISQUE à chaque
# vérification du contrat (les octets relus, jamais la métadonnée déclarée).
POPULATION_RACCORDEMENT_SHA256 <-
  "8262a61c02af9b7def1564e0eb8c85c2f631f616c6ecaefa4d6144d1fe6a7cea"

# W_RACCORDEMENT --------------------------------------------------------------------
# Le dénominateur verrouillé : la population bretonne RP 2023 totale de la
# transcription de la recherche (constat §5a — W = 3 449 370). Un total
# différent est une corruption du fichier épinglé, jamais un nouveau poids.
W_RACCORDEMENT <- 3449370L

# SEUIL_RACCORDEMENT_MIN ------------------------------------------------------------
# Le seuil PUBLIÉ : 90 minutes (décision §7 du parent — « share@T, T = 90 »).
SEUIL_RACCORDEMENT_MIN <- 90L

# MINUTES_COURBE_RACCORDEMENT -------------------------------------------------------
# Les points de décision publiés de la courbe cumulative. Cette grille est
# volontairement déclarée (et non dérivée d'un pas) : elle conserve les
# ruptures utiles des 45 premières minutes, puis les repères de lecture
# jusqu'à six heures. La matrice peut rester calculée jusqu'à son cap de
# recette (600 minutes), mais le contrat de publication s'arrête à 360.
MINUTES_COURBE_RACCORDEMENT <- c(0L, 15L, 30L, 45L, 60L, 90L, 120L,
                                 180L, 240L, 300L, 360L)

# PAS_COURBE_RACCORDEMENT -----------------------------------------------------------
# Compatibilité avec l'enveloppe historique : ce champ décrit le pas de la
# recette qui a produit la matrice, pas la grille publiée. Les sorties ne
# doivent jamais être reconstruites avec ce pas.
PAS_COURBE_RACCORDEMENT <- 10L

# GRILLE_RACCORDEMENT ---------------------------------------------------------------
# SOURCE UNIQUE de la forme publiée : la table déclarative ci-dessus est
# consommée par l'assemblage, les métadonnées, les validations et les tests.
# Aucun seq(0, cap, by = pas) ne doit réintroduire l'ancien chemin de 61 points.
grille_raccordement <- function() {
  paste0("t", sprintf("%04d", MINUTES_COURBE_RACCORDEMENT))
}

# MOTIF_NON_ROUTE_RACCORDEMENT ------------------------------------------------------
# Le motif nommé porté par les communes absentes de la matrice figée — les
# géocodes DILA aberrants documentés à la migration (#485).
MOTIF_NON_ROUTE_RACCORDEMENT <- paste(
  "Non rout\u00e9e \u2014 g\u00e9ocode DILA aberrant (hors de la Bretagne),",
  "commune absente de la matrice temps fig\u00e9e (#485)")

# RACCORDEMENT_ARTEFACT -------------------------------------------------------------
# Le nom de l'artefact calculé sous data/processed/mobilite/ : l'enveloppe du
# calcul (les tables + les empreintes des entrées). Un seul fichier, une seule
# cible de graphe.
RACCORDEMENT_ARTEFACT <- "raccordement_mobilite.rds"

# lire_population_raccordement --------------------------------------------------------
# Le lecteur de la table épinglée : codes caractères (jamais numériques — la
# même discipline que les ids NAF et mairies), populations numérisées.
# `chemin` permet aux tests de passer une copie altérée ; par défaut, la
# ressource épinglée du package.
lire_population_raccordement <- function(chemin = NULL) {
  if (is.null(chemin)) {
    chemin <- system.file("extdata", POPULATION_RACCORDEMENT_FICHIER,
                          package = "lusk")
  }
  if (is.na(chemin) || !nzchar(chemin) || !file.exists(chemin)) {
    stop(sprintf(
      paste0("Artefact raccordement — %s introuvable : le dénominateur de ",
             "population épinglé doit exister."),
      POPULATION_RACCORDEMENT_FICHIER), call. = FALSE)
  }
  readr::read_csv(
    chemin,
    col_types = readr::cols(
      code_commune = readr::col_character(),
      population = readr::col_double()
    ),
    show_col_types = FALSE
  )
}

# verifier_contrat_population_raccordement ---------------------------------------------
# Le contrat de la population épinglée : les colonnes, la couverture (1 202
# communes, les quatre départements, aucun doublon, aucune NA ni négatif) et
# le TOTAL VERROUILLÉ W = 3 449 370. L'empreinte sha256 du FICHIER est
# recalculée sur le disque à chaque vérification (`chemin` permet aux tests
# de passer une copie altérée ; par défaut, la ressource épinglée).
verifier_contrat_population_raccordement <- function(population,
                                                      chemin = NULL) {
  manquer <- function(champ, detail) stop(sprintf(
    "Contrat population raccordement violé — %s : %s.", champ, detail),
    call. = FALSE)

  cols <- c("code_commune", "population")
  manquantes <- setdiff(cols, names(population))
  if (length(manquantes) > 0) {
    manquer("colonnes", paste0("manquante(s) : ",
                               paste(manquantes, collapse = ", ")))
  }
  if (!all(grepl("^[0-9]{5}$", population$code_commune))) {
    manquer("id", "codes INSEE à cinq caractères attendus (caractères)")
  }
  if (anyDuplicated(population$code_commune) > 0) {
    manquer("id", "des codes INSEE en double")
  }
  if (anyNA(population$population) ||
      any(!is.finite(population$population)) ||
      any(population$population < 0)) {
    manquer("population",
            "toutes les valeurs doivent être numériques finies >= 0")
  }
  if (nrow(population) != 1202L) {
    manquer("couverture", sprintf(
      "la table épinglée porte les 1202 communes bretonnes COG 2025, pas %d",
      nrow(population)))
  }
  if (!setequal(unique(substr(population$code_commune, 1, 2)),
                c("22", "29", "35", "56"))) {
    manquer("departements",
            "les quatre départements bretons 22/29/35/56 attendus")
  }
  if (round(sum(population$population)) != W_RACCORDEMENT) {
    manquer("total", sprintf(
      "W = %d attendu (la transcription RP 2023 de la recherche), pas %.0f",
      W_RACCORDEMENT, sum(population$population)))
  }

  # l'empreinte VÉRIFIÉE SUR LE DISQUE (les octets relus, openssl) — un
  # contenu substitué échoue là où le fichier est lu ; le même wrapper que
  # partout ailleurs (empreinte_fichier_raccordement)
  if (is.null(chemin)) {
    chemin <- system.file("extdata", POPULATION_RACCORDEMENT_FICHIER,
                          package = "lusk")
  }
  if (is.na(chemin) || !nzchar(chemin) || !file.exists(chemin)) {
    manquer("fichier", paste0(
      POPULATION_RACCORDEMENT_FICHIER,
      " introuvable ou illisible sur le disque — l'empreinte doit rester ",
      "recalculable"))
  }
  calculee <- empreinte_fichier_raccordement(chemin)
  if (!identical(calculee, POPULATION_RACCORDEMENT_SHA256)) {
    manquer("sha256", sprintf(
      paste0("empreinte recalculée sur le fichier lu (%s…) ≠ empreinte ",
             "épinglée %s — le contenu n'est pas la transcription RP 2023"),
      substr(calculee, 1, 8), POPULATION_RACCORDEMENT_SHA256))
  }

  invisible(TRUE)
}

# resoudre_codes_cog ---------------------------------------------------------------
# La projection MULTI-MILLÉSIMES des points mairie vers le COG 2025 : la
# feuille COM de la table de passage annuelle INSEE porte UNE ligne par
# commune 2025 et les anciens codes dans les colonnes CODGEO_<année> — un
# village absorbé AVANT 2022 ne vit dans aucune colonne CODGEO_2022, la
# résolution balaye donc TOUS les millésimes de la feuille.
#
# La RÈGLE DES DEUX PASSEs (constat sur le fichier réel) :
#   1. l'IDENTITÉ d'abord — un code qui est celui d'une commune 2025 passe
#      tel quel. Certains codes actuels apparaissent AUSSI dans l'HISTOIRE
#      d'une autre ligne (un même code porté par une autre commune avant
#      2003-2025 — ex. 22179, constaté dans la feuille réelle) : le présent
#      gagne, jamais l'archéologie ;
#   2. sinon le balayage historique : Discipline passage_cog (#227) — un
#      code absent de toutes les colonnes s'arrête en le nommant ; un code
#      qui apparaît dans PLUSIEURS lignes (une scission) s'arrête — jamais
#      un choix silencieux.
# Déterministe : le vecteur nommé rendu conserve l'ordre demandé.
resoudre_codes_cog <- function(codes, table_passage) {
  codes <- as.character(codes)
  if (length(codes) == 0) return(stats::setNames(character(0), character(0)))
  colonnes <- grep("^CODGEO_[0-9]{4}$", names(table_passage), value = TRUE)
  if (length(colonnes) == 0) {
    stop("Table de passage COG illisible — aucune colonne CODGEO_<année>.",
         call. = FALSE)
  }
  courant <- stats::setNames(table_passage$CODGEO_2025,
                             table_passage$CODGEO_2025)
  identites <- codes[codes %in% names(courant)]
  restants <- setdiff(codes, names(courant))
  projetes <- vapply(restants, function(code) {
    lignes <- unique(unlist(lapply(colonnes, function(col) {
      table_passage$CODGEO_2025[which(table_passage[[col]] == code)]
    })))
    if (length(lignes) == 0) {
      stop("Passage COG — code non mappé vers le COG 2025 : ", code, ".",
           call. = FALSE)
    }
    if (length(lignes) > 1) {
      stop("Passage COG — le code '", code, "' mappe vers plusieurs codes ",
           "2025 (une scission) : ", paste(lignes, collapse = ", "),
           " — jamais un choix silencieux.", call. = FALSE)
    }
    lignes
  }, character(1), USE.NAMES = TRUE)
  sortie <- c(stats::setNames(unname(courant[identites]), identites), projetes)
  sortie[codes]
}

# part_cumulee ----------------------------------------------------------------------
# La part cumulée d'un TERRITOIRE (un vecteur de temps effectifs minimaux,
# nommés par commune d'origine) sur la grille xs : part(x) =
# Σ_j w_j · 1[S(j → territoire) ≤ x] / W. Vectorisé par outer — jamais un
# recyclage implicite (un vecteur <= un vecteur comparerait élément à
# élément, pas chacun à toute la grille).
part_cumulee <- function(mins, xs, w, W) {
  reach <- outer(mins, xs, "<=")          # communes × grille
  as.vector(crossprod(reach, w[names(mins)]) / W)
}

# calculer_raccordement -------------------------------------------------------------
# Le calcul pur : matrice figée + populations + projection COG (+ la base
# EPCI pour les niveaux agrégés) -> parts @90, courbes cumulatives par
# territoire et courbe de référence médiane. AUCUN routage : la matrice est
# l'entrée figée (#485).
#
# Les niveaux EPCI/département/région lisent l'UNION des communes membres
# ROUTÉES — on peut rejoindre le territoire en atteignant n'importe laquelle,
# la sienne comprise (la diagonale) — JAMAIS une moyenne des parts communales.
# Le dénominateur est la population routée seule et chaque scalaire d'agrégat
# porte SA couverture (la part de population réellement mesurée).
calculer_raccordement <- function(matrice, population, codes_cog,
                                   base_epci = NULL,
                                   seuil = SEUIL_RACCORDEMENT_MIN,
                                   pas = PAS_COURBE_RACCORDEMENT,
                                   cap_duree_min =
                                     RECETTE_MATRICE_TEMPS_MAIRIES$cap_duree_min) {
  manquer <- function(champ, detail) stop(sprintf(
    "Calcul du raccordement impossible — %s : %s.", champ, detail),
    call. = FALSE)

  cols <- c("from_id", "to_id", "travel_time_p01")
  manquantes <- setdiff(cols, names(matrice))
  if (length(manquantes) > 0) {
    manquer("matrice", paste0("colonne(s) manquante(s) : ",
                              paste(manquantes, collapse = ", ")))
  }
  if (!all(c("code_commune", "population") %in% names(population))) {
    manquer("population",
            "les colonnes code_commune / population sont requises")
  }
  if (anyDuplicated(population$code_commune) > 0) {
    manquer("population", "des codes INSEE en double")
  }
  if (is.null(codes_cog) || length(codes_cog) == 0 || anyNA(codes_cog)) {
    manquer("projection cog",
            "la projection des points est vide ou porte des NA")
  }

  # la projection STRICTE de chaque point matrice (la discipline passage_cog)
  points <- sort(unique(matrice$from_id))
  hors_projection <- setdiff(points, names(codes_cog))
  if (length(hors_projection) > 0) {
    manquer("projection cog", sprintf(
      "%d point(s) matrice sans projection COG 2025 : %s",
      length(hors_projection),
      paste(utils::head(hors_projection, 10), collapse = ", ")))
  }

  # la réduction destination : T(p → c) = min sur les points q de c — puis la
  # réduction origine : S(j → c) = min sur les points p de j. Deux
  # agrégations min suffisent ; la forme dense reste modeste.
  reductions <- matrice[, cols]
  reductions$to_commune <- unname(codes_cog[reductions$to_id])
  reductions$from_commune <- unname(codes_cog[reductions$from_id])
  # aggregate.formula ne conserve que les colonnes de la formule : la commune
  # d'origine se re-dérive de from_id
  red_dest <- stats::aggregate(
    travel_time_p01 ~ from_id + to_commune, data = reductions, FUN = min)
  red_dest$from_commune <- unname(codes_cog[red_dest$from_id])
  S_long <- stats::aggregate(
    travel_time_p01 ~ from_commune + to_commune,
    data = red_dest[, c("from_commune", "to_commune", "travel_time_p01")],
    FUN = min)

  communes <- population$code_commune
  w <- stats::setNames(population$population, communes)
  W <- sum(w)
  routed <- sort(unique(S_long$to_commune))
  # LE DÉNOMINATEUR ROUTÉ-SEUL des agrégats : la population des communes
  # réellement mesurables par le réseau — les non routées en sortent (leur
  # poids ne pèse dans aucun agrégat ; leur part communale reste NA + motif)
  w_route <- w[routed]
  W_route <- sum(w_route)
  inconnues <- setdiff(routed, communes)
  if (length(inconnues) > 0) {
    manquer("population", sprintf(
      "%d commune(s) routée(s) sans dénominateur : %s", length(inconnues),
      paste(utils::head(inconnues, 10), collapse = ", ")))
  }

  # la forme dense : ligne = commune d'origine (LES 1202 — une commune non
  # routée n'a aucune paire, elle ne contribue vers rien d'autre qu'elle-
  # même), colonne = commune routée destination
  M <- matrix(Inf, nrow = length(communes), ncol = length(routed),
              dimnames = list(communes, routed))
  idx <- cbind(match(S_long$from_commune, communes),
               match(S_long$to_commune, routed))
  M[idx] <- S_long$travel_time_p01

  # les parts cumulées : P[x, c] = Σ_j w_j·1[S(j,c) ≤ x] / W — le produit
  # matrice × vecteur de poids (recyclé par LIGNE, chaque origine pèse son
  # w), jamais un comptage de booléens
  # Le cap et le pas restent des paramètres de la recette de routage, mais ne
  # gouvernent plus la grille de publication. La courbe est toujours produite
  # exactement sur les points déclarés par MINUTES_COURBE_RACCORDEMENT.
  if (!identical(as.integer(cap_duree_min),
                 RECETTE_MATRICE_TEMPS_MAIRIES$cap_duree_min) ||
      !identical(as.integer(pas), PAS_COURBE_RACCORDEMENT)) {
    manquer("grille", paste0(
      "la grille publiée est déclarée et ne peut pas être dérivée d'un autre ",
      "cap ou pas"))
  }
  xs <- as.numeric(MINUTES_COURBE_RACCORDEMENT)
  col_seuil <- match(seuil, xs)
  if (is.na(col_seuil)) {
    manquer("grille",
            sprintf("le seuil %d n'est pas sur la grille (pas %d)",
                    seuil, pas))
  }
  w_lignes <- w[rownames(M)]
  P <- t(vapply(xs, function(x) colSums((M <= x) * w_lignes) / W,
                numeric(ncol(M))))
  dimnames(P) <- list(NULL, routed)

  exclusions <- setdiff(communes, routed)
  communes_table <- tibble::tibble(
    code = communes,
    part_90 = ifelse(communes %in% routed, P[col_seuil, ][communes], NA_real_),
    motif = ifelse(communes %in% exclusions,
                   MOTIF_NON_ROUTE_RACCORDEMENT, NA_character_)
  )

  nrouted <- length(routed)
  courbes_communes <- tibble::tibble(
    code = rep(routed, each = length(xs)),
    minute = rep.int(xs, times = nrouted),
    # as.vector lit P ([x × commune]) COLONNE par colonne : tous les x d'une
    # commune, puis la suivante — l'ordre du long format
    part = as.vector(P)
  )

  # la courbe de référence : la MÉDIANE des communes routées à chaque x
  reference <- tibble::tibble(
    minute = xs,
    part_mediane = apply(P, 1, stats::median)
  )

  resultat <- list(
    communes = communes_table,
    courbes_communes = courbes_communes,
    reference = reference,
    exclusions = tibble::tibble(code = sort(exclusions)),
    seuil = seuil, pas = pas, cap_duree_min = cap_duree_min,
    w_total = W
  )

  # les niveaux agrégés (sémantique ROUTÉS-SEULS) : S(j → E) = min sur les
  # colonnes des membres routés — une commune non routée ne compte NI comme
  # origine (aucune paire, tout-Inf) NI par auto-inclusion à t = 0 dans SON
  # territoire ; le dénominateur est W_route et la couverture du groupe (la
  # part de sa population réellement mesurée) voyage à côté de chaque
  # scalaire. La région suit LA MÊME RÈGLE qu'un territoire quelconque.
  if (!is.null(base_epci)) {
    requis <- c("CODGEO", "EPCI", "DEP")
    manquantes_base <- setdiff(requis, names(base_epci))
    if (length(manquantes_base) > 0) {
      manquer("base epci", paste0("colonne(s) manquante(s) : ",
                                  paste(manquantes_base, collapse = ", ")))
    }
    mins_groupe <- function(membres_codes) {
      colonnes <- match(intersect(membres_codes, routed), routed)
      if (length(colonnes) > 1) {
        apply(M[, colonnes, drop = FALSE], 1, min)
      } else if (length(colonnes) == 1) {
        M[, colonnes]
      } else {
        stats::setNames(rep(Inf, length(communes)), communes)
      }
    }
    # la couverture d'un groupe : le poids de SES membres routés sur le
    # poids de TOUS ses membres (les non routées sont nommées, pas cachées)
    couverture_de <- function(groupes, groupe) {
      membres <- intersect(names(groupes[groupes == groupe]), communes)
      sum(w[intersect(membres, routed)]) / sum(w[membres])
    }

    agreger_niveau <- function(groupes) {
      f <- sort(unique(groupes[routed]))
      f <- f[!is.na(f)]
      part_par_groupe <- vapply(f, function(groupe) {
        mins <- mins_groupe(names(groupes[groupes == groupe]))
        # une grille d'UN point : la part au seuil, dénominateur routé seul
        part_cumulee(mins, seuil, w, W_route)[[1]]
      }, numeric(1))
      couverture_par_groupe <- vapply(f, function(groupe) {
        couverture_de(groupes, groupe)
      }, numeric(1))
      tibble::tibble(code = names(part_par_groupe),
                     part_90 = unname(part_par_groupe),
                     couverture = unname(couverture_par_groupe))
    }
    courbe_niveau <- function(groupes) {
      f <- sort(unique(groupes[routed]))
      f <- f[!is.na(f)]
      do.call(rbind, lapply(f, function(groupe) {
        mins <- mins_groupe(names(groupes[groupes == groupe]))
        tibble::tibble(code = groupe, minute = xs,
                       part = part_cumulee(mins, xs, w, W_route))
      }))
    }

    dep <- stats::setNames(base_epci$DEP, base_epci$CODGEO)
    resultat$departements <- agreger_niveau(dep)
    resultat$courbes_departements <- courbe_niveau(dep)

    epci <- stats::setNames(base_epci$EPCI, base_epci$CODGEO)
    epci <- epci[!is.na(epci)]
    resultat$epcis <- agreger_niveau(epci)
    resultat$courbes_epcis <- courbe_niveau(epci)

    mins_region <- mins_groupe(communes)
    part_region <- part_cumulee(mins_region, xs, w, W_route)
    resultat$region <- tibble::tibble(
      code = "53",
      part_90 = part_region[[match(seuil, xs)]],
      couverture = W_route / W)
    resultat$courbe_region <- tibble::tibble(
      code = "53", minute = xs, part = part_region)
  }

  resultat
}

# empreinte_fichier_raccordement ----------------------------------------------------
# L'empreinte sha256 des OCTETS d'un fichier relu sur le disque (la même
# discipline que les contrats — openssl exige une connexion binaire).
empreinte_fichier_raccordement <- function(chemin) {
  con <- file(chemin, "rb")
  calculee <- paste(openssl::sha256(con))
  close(con)
  calculee
}

# preparer_raccordement -------------------------------------------------------------
# L'ORCHESTRATION du calcul du raccordement : les contrats des artefacts
# épinglés sont vérifiés (matrice + population — un substitut s'arrête là où
# il est lu), la projection COG est résolue depuis le zip INSEE du cache
# (cog_passage — l'extraction vit dans un répertoire TEMPORAIRE, jamais
# cache/extracted : pas de course avec les builders), le calcul tourne et
# l'enveloppe est PERSISTÉE sous sortie/RACCORDEMENT_ARTEFACT.
# Déterministe : l'enveloppe ne porte AUCUN horodatage — deux exécutions sur
# les mêmes entrées produisent le même fichier octet pour octet (le skip du
# graphe en dépend).
preparer_raccordement <- function(zip_cog, chemin_base_epci = NULL,
                                  sortie = "data/processed/mobilite") {
  matrice <- lire_matrice_temps_mairies()
  stopifnot(identical(
    verifier_contrat_matrice_temps(artefact_matrice_temps()), TRUE))
  population <- lire_population_raccordement()
  stopifnot(identical(verifier_contrat_population_raccordement(population),
                      TRUE))

  extrait <- tempfile("raccordement-cog-")
  dir.create(extrait)
  on.exit(unlink(extrait, recursive = TRUE), add = TRUE)
  suppressWarnings(utils::unzip(zip_cog, exdir = extrait, overwrite = FALSE))
  large <- lire_table_passage(
    file.path(extrait, "table_passage_annuelle_2025.xlsx"))
  codes_cog <- resoudre_codes_cog(sort(unique(matrice$from_id)), large)

  # les niveaux agrégés : le référentiel partagé extrait (fichier_epci_
  # extrait du graphe) — sans lui, l'enveloppe ne porte que le niveau
  # communal et la publication s'arrêtera bruyamment à l'assemblage (jamais
  # un payload amputé en silence)
  base <- NULL
  if (!is.null(chemin_base_epci) && !is.na(chemin_base_epci) &&
      nzchar(chemin_base_epci)) {
    if (!file.exists(chemin_base_epci)) {
      stop("Le référentiel des EPCI est introuvable (", chemin_base_epci,
           ") — le calcul du raccordement en a besoin pour ses niveaux ",
           "agrégés.", call. = FALSE)
    }
    base <- suppressWarnings(lire_epci(chemin_base_epci))
  }

  calcul <- calculer_raccordement(matrice, population, codes_cog,
                                   base_epci = base)
  enveloppe <- list(
    entrees = list(
      sha_matrice = MATRICE_TEMPS_MAIRIES_SHA256,
      sha_population = POPULATION_RACCORDEMENT_SHA256,
      recette = RECETTE_MATRICE_TEMPS_MAIRIES,
      seuil = SEUIL_RACCORDEMENT_MIN,
      pas = PAS_COURBE_RACCORDEMENT
    ),
    calcul = calcul
  )
  if (!dir.exists(sortie)) dir.create(sortie, recursive = TRUE)
  readr::write_rds(enveloppe, file.path(sortie, RACCORDEMENT_ARTEFACT))
  enveloppe
}

# lire_raccordement -----------------------------------------------------------------
# Le lecteur de l'enveloppe calculée : `sortie` est le répertoire analytique
# du thème OU le chemin complet de l'artefact (la cible du graphe passe SON
# fichier). Le fichier doit EXISTER (un absent nomme le calcul à lancer —
# jamais un payload amputé en silence) et être FRAIS — les empreintes des
# entrées portées par l'enveloppe doivent égaler celles des fichiers épinglés
# ACTUELS du package et la recette figée. Un artefact périmé est refusé
# bruyamment : publier des parts calculées depuis une autre matrice que celle
# proclamée serait une fraude à la fraîcheur.
lire_raccordement <- function(sortie = "data/processed/mobilite") {
  chemin <- if (!is.null(sortie) &&
                basename(sortie) == RACCORDEMENT_ARTEFACT) {
    sortie
  } else {
    file.path(sortie, RACCORDEMENT_ARTEFACT)
  }
  if (!file.exists(chemin)) {
    stop("Artefact raccordement introuvable (", chemin,
         ") — lancez le calcul du raccordement (chaîne targets mode manuel, ",
         "ou preparer_raccordement()) avant de publier Mobilité.",
         call. = FALSE)
  }
  enveloppe <- readr::read_rds(chemin)
  manquer <- function(detail) stop(
    "Artefact raccordement PÉRIMÉ (", chemin, ") : ", detail,
    " — relancez preparer_raccordement().", call. = FALSE)
  requis <- c("entrees", "calcul")
  if (!all(requis %in% names(enveloppe))) {
    manquer("forme de l'enveloppe incomplète")
  }
  chemin_matrice <- system.file("extdata", MATRICE_TEMPS_MAIRIES_FICHIER,
                                package = "lusk")
  if (!identical(enveloppe$entrees$sha_matrice,
                 empreinte_fichier_raccordement(chemin_matrice))) {
    manquer("la matrice temps a changé depuis le calcul")
  }
  chemin_pop <- system.file("extdata", POPULATION_RACCORDEMENT_FICHIER,
                            package = "lusk")
  if (!identical(enveloppe$entrees$sha_population,
                 empreinte_fichier_raccordement(chemin_pop))) {
    manquer("la table des populations a changé depuis le calcul")
  }
  if (!identical(enveloppe$entrees$recette,
                 RECETTE_MATRICE_TEMPS_MAIRIES)) {
    manquer("la recette figée a changé depuis le calcul")
  }
  enveloppe
}
