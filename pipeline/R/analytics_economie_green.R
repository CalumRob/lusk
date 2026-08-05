# analytics_economie_green ------------------------------------------------------
# Le score « vert » (plan economie-analytical-phase, todo 3 / T3, gate H = B) :
# la part des établissements ACTIFS dans les classes d'éco-activités, commune
# par commune — la jointure au grain CLASSE entre le snapshot SIRENE (APET
# NAF rév. 2 « NN.NN(L) », 6 caractères) et l'artefact EGSS (la liste
# opérationnelle Eurostat des activités EGSS, classes NACE/NAF 4 chiffres avec
# drapeaux 100 %/partiel, artefact_egss.R).
#
# La règle de jointure (épinglée dans artefact_egss.R, vérifiée par
# verifier_contrat_egss) : classe NAF = substr(activity_code, 1, 5) → « NN.NN » ;
# un code EGSS couvre une classe quand ses chiffres (sans point) sont un
# PREFIXE des chiffres de la classe. Ex. EGSS « 38.1 » couvre 38.11/38.12 ;
# EGSS « 37 » couvre 37.00 ; EGSS « 38.21 » couvre 38.21.
#
# Décision de pondération (décidée à la construction, documentée) : **count-all**
# — chaque établissement d'une classe EGSS compte ENTIER au numérateur, que le
# drapeau EGSS soit « h » (100 %) ou « v » (partiel). Le drapeau 100 %/partiel
# est RETENU : la table porte n_eco_100 / n_eco_partial (une partition de
# n_eco) — jamais supprimé, jamais fondu. Le flag-only exclurait 169 classes
# sur 174 (0.3 % des établissements) et trahirait le périmètre SDES qui compte
# les établissements des classes d'éco-activités.
#
# Valeurs spéciales APET (décision documentée) : « 00.00Z » (inconnue) et NULL
# ne sont JAMAIS vertes — la classe 00.00 n'est dans aucune liste EGSS et un
# code manquant ne peut pas être classé. Elles restent au DÉNOMINATEUR (ce sont
# des établissements actifs du snapshot) : la part mesure « parmi les
# établissements actifs, combien sont dans des classes d'éco-activités ».
#
# Plancher communal gate D (décision 2026-08-05) : n ≥ 5 établissements ACTIFS
# par commune (somme des lignes, jamais par cellule). Une commune sous le
# plancher est SUPPRIMÉE — part NA — et comptée dans le rapport de suppression
# (vérifié sur le réel : min 10 établissements, 0 commune supprimée). Aucune
# suppression silencieuse.
#
# Sélection déterministe (ADR-0002) : même commune + mêmes données -> même
# part, toujours — la table est triée par commune. Aucun artefact de fiche : la
# table analytique vit sous pipeline/data/ (gitignoré), jamais sous public/.

# SEUIL_ETABLISSEMENTS_GREEN ----------------------------------------------------
# Le plancher communal gate D (décision 2026-08-05) : n ≥ 5 établissements
# actifs par commune, lignes SOMMÉES (jamais par cellule — le plan gate D :
# « n≥5 per commune (row sums), not per cell »). Vérifié sur le réel : min 10
# établissements actifs par commune -> 0 commune supprimée (le plancher est une
# garde de contrat, pas une suppression effective sur la Bretagne 2026).
SEUIL_ETABLISSEMENTS_GREEN <- 5L

# classe_naf --------------------------------------------------------------------
# La classe NAF d'un APET SIRENE : les 5 premiers caractères de « NN.NN(L) »
# donnent « NN.NN » — la classe NAF rév. 2 4 chiffres (= la classe NACE rév. 2,
# le grain de l'artefact EGSS). Un APET manquant (NULL) donne NA : jamais une
# classe inventée.
classe_naf <- function(activity_code) {
  substr(activity_code, 1, 5)
}

# table_drapeaux_egss ------------------------------------------------------------
# La table des drapeaux EGSS par classe NAF — LE résultat de la jointure au
# grain classe, construit UNE FOIS pour toutes les classes distinctes du
# snapshot (la jointure vectorisée, jamais ligne par ligne). Pour chaque
# classe :
#   - chiffres de la classe (sans point, ex. « 3811 » pour 38.11) ;
#   - couverte par un code EGSS quand les chiffres d'AU MOINS UN code EGSS
#     (sans point) sont un PREFIXE de ceux de la classe ;
#   - drapeau : « h » si au moins un code couvrant est 100 % (h), « v » sinon,
#     NA si la classe n'est couverte par rien.
# La classe « 00.00 » (« 0000 ») n'est couverte par aucun code EGSS (ils
# commencent par 01 à 99) : jamais verte. Les codes « Not available » (aucun
# code NACE dans la source) ne couvrent rien.
table_drapeaux_egss <- function(classes, artefact) {
  codes <- artefact$table
  codes <- codes[codes$nace_code != "Not available", ]

  chiffres_classes <- gsub(".", "", classes, fixed = TRUE)
  chiffres_codes <- gsub(".", "", codes$nace_code, fixed = TRUE)

  # matrice classes × codes : couverte (le prefixe des chiffres) — construite à
  # la main (vapply renverrait un vecteur quand il n'y a qu'UNE classe, pas une
  # matrice : la forme doit être stable quel que soit le nombre de classes)
  couverte <- matrix(FALSE, nrow = length(classes), ncol = length(chiffres_codes),
                     dimnames = list(classes, codes$nace_code))
  for (j in seq_along(chiffres_codes)) {
    couverte[, j] <- startsWith(chiffres_classes, chiffres_codes[j])
  }

  drapeaux <- if (ncol(couverte) == 0) {
    rep(NA_character_, length(classes))
  } else {
    h <- apply(couverte, 1, function(ligne) any(ligne & codes$flag == "h"))
    v <- apply(couverte, 1, function(ligne) any(ligne & codes$flag == "v"))
    dplyr::case_when(h ~ "h", v ~ "v", TRUE ~ NA_character_)
  }

  tibble::tibble(classe = classes, drapeau_egss = drapeaux)
}

# marquer_eco_activites ----------------------------------------------------------
# La jointure au grain classe, appliquée à la table snapshot : chaque ligne
# (cellule commune × APET × tranche, value = nombre d'établissements ACTIFS)
# reçoit le drapeau EGSS de SA classe — « h », « v » ou NA (hors périmètre).
# Les APET NULL (activity_code NA) restent NA : jamais verts. Déterministe :
# la jointure ne dépend que de la classe et de l'artefact.
marquer_eco_activites <- function(snapshot, artefact) {
  drapeaux <- table_drapeaux_egss(unique(classe_naf(snapshot$activity_code)),
                                  artefact)
  snapshot %>%
    dplyr::mutate(classe = classe_naf(.data$activity_code)) %>%
    dplyr::left_join(drapeaux, by = "classe")
}

# agreger_part_eco_par_commune ---------------------------------------------------
# L'agrégation communale : pour chaque commune, le nombre total
# d'établissements actifs (n_etablissements), le nombre dans des classes
# d'éco-activités (n_eco = count-all, la somme des h ET des v), la partition
# 100 %/partiel (n_eco_100 / n_eco_partial) et la part (n_eco / n_etablissements,
# dans [0, 1]). Une commune sans aucun établissement n'existe pas dans le
# snapshot (cellules non observées) — elle n'apparaît pas ici (comme le
# profilage : les zéros n'existent pas dans la table). Les lignes dont la
# classe est NA (APET NULL) comptent au dénominateur (n_etablissements) et
# jamais au numérateur — décision documentée.
agreger_part_eco_par_commune <- function(snapshot, artefact) {
  marque <- marquer_eco_activites(snapshot, artefact)

  marque %>%
    dplyr::group_by(commune) %>%
    dplyr::summarise(
      n_etablissements = sum(.data$value),
      n_eco = sum(.data$value[!is.na(.data$drapeau_egss)]),
      n_eco_100 = sum(.data$value[!is.na(.data$drapeau_egss) &
                                    .data$drapeau_egss == "h"]),
      n_eco_partial = sum(.data$value[!is.na(.data$drapeau_egss) &
                                       .data$drapeau_egss == "v"]),
      .groups = "drop"
    ) %>%
    dplyr::mutate(
      departement = substr(.data$commune, 1, 2),
      part_economie_verte = dplyr::if_else(
        .data$n_etablissements >= SEUIL_ETABLISSEMENTS_GREEN,
        .data$n_eco / .data$n_etablissements,
        NA_real_
      )
    ) %>%
    dplyr::select(commune, departement, n_etablissements, n_eco,
                  n_eco_100, n_eco_partial, part_economie_verte) %>%
    dplyr::arrange(commune)
}

# rapport_suppression_eco --------------------------------------------------------
# Le rapport de suppression du contrat : UNE ligne par commune non classée,
# avec son motif — aucune suppression silencieuse. Le motif est le plancher
# gate D (n < 5 établissements actifs) : une commune sous le plancher est
# supprimée et comptée. Trié par commune — déterministe.
rapport_suppression_eco <- function(table) {
  table %>%
    dplyr::filter(is.na(.data$part_economie_verte)) %>%
    dplyr::transmute(
      commune = .data$commune,
      motif = paste0(
        "moins de ", SEUIL_ETABLISSEMENTS_GREEN,
        " établissements actifs : commune sous le plancher communal n≥5 (gate D)"
      )
    ) %>%
    dplyr::arrange(commune)
}

# construire_eco_activites_economie ----------------------------------------------
# L'acte « calculer » du score vert : le snapshot SIRENE normalisé (la table
# sirene_snapshot réelle) + l'artefact EGSS -> la table communale commune × 1
# part + le rapport de suppression. Le contrat de l'artefact est vérifié AVANT
# tout calcul : un artefact corrompu s'arrête ici, bruyamment.
construire_eco_activites_economie <- function(snapshot, artefact) {
  verifier_contrat_egss(artefact)

  table <- agreger_part_eco_par_commune(snapshot, artefact)

  list(
    table = table,
    suppression = rapport_suppression_eco(table)
  )
}

# persister_eco_activites_economie -----------------------------------------------
# Persiste l'artefact analytique sous le dossier Économie/Emploi des données
# processées (data/processed/economie/, gitignoré — JAMAIS public/) : la table
# `eco_activites_economie.rds` (commune × part, la persistance du todo 3) et son
# rapport de suppression `eco_activites_economie_suppression.rds` (même forme de
# sidecar que sirene_snapshot_exclusions.rds — la suppression reste visible,
# jamais silencieuse).
persister_eco_activites_economie <- function(resultat,
                                             sortie = "data/processed/economie") {
  if (!dir.exists(sortie)) dir.create(sortie, recursive = TRUE)
  readr::write_rds(resultat$table, file.path(sortie, "eco_activites_economie.rds"))
  readr::write_rds(resultat$suppression,
                   file.path(sortie, "eco_activites_economie_suppression.rds"))
  invisible(resultat)
}
