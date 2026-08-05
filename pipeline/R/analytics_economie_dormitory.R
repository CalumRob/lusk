# analytics_economie_dormitory ---------------------------------------------------
# Le ratio dortoir « Le matin, la commune se vide » (plan economie-analytical-
# phase, todo 4 / T4) : l'équilibre emploi LIEU DE TRAVAIL vs RÉSIDENCE, commune
# par commune. Ratio = effectifs salariés au lieu de travail (Flores **A88**,
# gate B, mesure `effectifs_salaries`) / actifs occupés au lieu de résidence
# (rp_emploi, secteurs natifs ≠ _T). Les DEUX perspectives restent des colonnes
# distinctes de la table (workplace / resident) — JAMAIS fondues en un indicateur
# unique (MUST NOT du plan).
#
# L'Histoire est déclenchée par la SAillance, sur les QUEUES de la distribution
# réelle uniquement — jamais sur la majorité (un seuil < 0.5 déclencherait sur
# 69.4 % des 1202 communes, ce qui est précisément ce que la conception des
# queues interdit). Évidence réelle verrouillée à la construction (2026-08-05,
# 1202 communes) : médiane 0.3 ; 69.4 % < 0.5× ; 4.6 % > 1.5× ; 2.1 % > 2×. Les
# seuils sont des CONSTANTES NOMMÉES (SEUIL_DORTITOIRE_PROFOND / SEUIL_POLE_EMPLOI),
# documentées contre cette distribution, jamais des nombres magiques.
#
# Plancher communal gate D (décision 2026-08-05) : n ≥ 5 salariés au lieu de
# travail. Une commune sous le plancher est SUPPRIMÉE — classification NA — et
# comptée dans le rapport de suppression (vérifié sur le réel : 6 communes,
# 0.5 %). Aucune suppression silencieuse : toute commune non classée figure
# dans `rapport_suppression_dortoir` avec son motif.
#
# Sélection déterministe (ADR-0002) : même commune + mêmes données -> même
# classification, toujours — la table est triée par commune et la
# classification est un case_when pur. Commune sans queue (« equilibre ») :
# l'Histoire ne se déclenche pas, l'Histoire par défaut (LQ, T1) s'affiche.
# Aucun artefact de fiche : la table analytique vit sous pipeline/data/
# (gitignoré), jamais sous public/ (pas de publish, pas de payload).

# SEUIL_DORTITOIRE_PROFOND ------------------------------------------------------
# La queue basse de la distribution réelle : ratio < 0.15 = moins d'un emploi
# local pour ~7 actifs résidents — la commune se vide le matin. Verrouillé sur
# l'évidence réelle (2026-08-05) : 0.15 est la borne du 1er quartile (P25 =
# 0.147) ; 310 communes brutes < 0.15, dont 304 classées après le plancher
# gate D (25.3 %). Strictement en-deçà : une commune EXACTEMENT à 0.15 ne
# déclenche pas (elle est « equilibre ») — déterministe et testé.
SEUIL_DORTITOIRE_PROFOND <- 0.15

# SEUIL_POLE_EMPLOI -------------------------------------------------------------
# La queue haute de la distribution réelle : ratio > 1.5 = plus d'un emploi et
# demi par actif résident — la commune se remplit le matin. Verrouillé sur le
# chiffre même de l'évidence réelle (2026-08-05 : « 4.6 % > 1.5× » ; 55 communes
# classées, 4.6 %). Strictement au-delà : une commune EXACTEMENT à 1.5 ne
# déclenche pas (elle est « equilibre ») — déterministe et testé.
SEUIL_POLE_EMPLOI <- 1.5

# SEUIL_EFFECTIF_TRAVAIL --------------------------------------------------------
# Le plancher communal gate D (décision 2026-08-05) : n ≥ 5 salariés au lieu de
# travail. Sous ce plancher, la commune est supprimée (classification NA) et
# comptée dans le rapport de suppression. Vérifié sur le réel : 6 communes sous
# le plancher (0.5 %) — le plancher protège le travail d'emploi Flores sans
# toucher SIRENE ni RP (gate D du plan, « 6 Flores communes (0.5 %) »).
SEUIL_EFFECTIF_TRAVAIL <- 5L

# CLASSEMENTS_DORTITOIRE --------------------------------------------------------
# Le vocabulaire fermé des classifications (la forme kebab des autres lectures
# du pipeline) :
#   - « dortoir-profond » : ratio < SEUIL_DORTITOIRE_PROFOND — l'Histoire se
#     déclenche (commune qui se vide le matin) ;
#   - « pole-emploi »    : ratio > SEUIL_POLE_EMPLOI — l'Histoire se déclenche
#     (commune qui se remplit le matin) ;
#   - « equilibre »      : aucune queue — l'Histoire ne se déclenche pas,
#     l'Histoire par défaut (LQ, T1) s'affiche (ADR-0002).
# La suppression (plancher gate D, ratio non défini, perspective absente) est
# NA — jamais une chaîne de vocabulaire.
CLASSEMENTS_DORTITOIRE <- c("dortoir-profond", "pole-emploi", "equilibre")

# agreger_effectifs_travail -----------------------------------------------------
# L'emploi salarié au LIEU DE TRAVAIL par commune : la table Flores A88 (gate B),
# mesure « effectifs_salaries », secteurs ≠ _T (le total _T double-compterait la
# somme des divisions), sommé par commune. Les cellules non diffusées (statut K,
# valeur NA) RESTENT des NA dans la somme — jamais converties en zéro observé
# (le contrat du reshape) : une commune avec une cellule K reçoit une somme NA
# et ne peut pas être classée (elle est rapportée, pas inventée).
agreger_effectifs_travail <- function(flores_a88) {
  flores_a88 %>%
    dplyr::filter(measure == "effectifs_salaries", activity_code != "_T") %>%
    dplyr::group_by(commune) %>%
    dplyr::summarise(workplace = sum(value), .groups = "drop")
}

# agreger_actifs_occupes --------------------------------------------------------
# Les actifs occupés au lieu de RÉSIDENCE par commune : la table rp_emploi
# (mesure « actifs_occupes »), secteurs natifs ≠ _T, sommés par commune. La
# perspective résidente reste INDÉPENDANTE de la perspective lieu de travail —
# les deux sommes ne sont jamais fondues en un indicateur unique (MUST NOT).
agreger_actifs_occupes <- function(rp_emploi) {
  rp_emploi %>%
    dplyr::filter(measure == "actifs_occupes", activity_code != "_T") %>%
    dplyr::group_by(commune) %>%
    dplyr::summarise(resident = sum(value), .groups = "drop")
}

# calculer_ratio_dortoir --------------------------------------------------------
# Le ratio dortoir : workplace / resident, commune par commune. Le ratio n'est
# DÉFINI que quand les DEUX côtés sont > 0 (un ratio 1/0, 0/1 ou 0/0 n'a aucun
# sens économique) — sinon NA, jamais un zéro ou un infini inventé. La jointure
# est COMPLÈTE (full_join) : une commune présente d'un seul côté apparaît avec
# l'autre perspective NA (elle sera rapportée, jamais perdue silencieusement).
# Vérifié sur le réel : les 1202 communes bretonnes ont les deux côtés > 0 —
# le ratio est calculable pour 100 % des communes.
calculer_ratio_dortoir <- function(travail, resident) {
  dplyr::full_join(travail, resident, by = "commune") %>%
    dplyr::mutate(
      ratio = dplyr::if_else(workplace > 0 & resident > 0,
                             workplace / resident, NA_real_)
    )
}

# classifier_dortoir ------------------------------------------------------------
# La classification DÉTERMINISTE (ADR-0002) : exactement une lecture par
# commune, calculée DANS L'ORDRE —
#   1. suppression : perspective absente (workplace ou resident NA — commune
#      d'un seul côté, ou cellule non diffusée K) ;
#   2. suppression : plancher gate D (workplace < SEUIL_EFFECTIF_TRAVAIL) ;
#   3. suppression : ratio non défini (workplace ≤ 0 ou resident ≤ 0) ;
#   4. dortoir-profond — ratio < SEUIL_DORTITOIRE_PROFOND (la queue basse) ;
#   5. pole-emploi     — ratio > SEUIL_POLE_EMPLOI (la queue haute) ;
#   6. equilibre       — le résidu : aucune queue, l'Histoire par défaut s'affiche.
# Les bornes exactes ne déclenchent PAS (strictement en-deçà / au-delà) : une
# commune EXACTEMENT à 0.15 ou 1.5 est « equilibre », toujours, de façon
# déterministe.
classifier_dortoir <- function(ratios) {
  ratios %>%
    dplyr::mutate(
      classification = dplyr::case_when(
        is.na(workplace) | is.na(resident) ~ NA_character_,
        workplace < SEUIL_EFFECTIF_TRAVAIL ~ NA_character_,
        workplace <= 0 | resident <= 0 ~ NA_character_,
        ratio < SEUIL_DORTITOIRE_PROFOND ~ "dortoir-profond",
        ratio > SEUIL_POLE_EMPLOI ~ "pole-emploi",
        TRUE ~ "equilibre"
      )
    )
}

# rapport_suppression_dortoir ---------------------------------------------------
# Le rapport de suppression du contrat : UNE ligne par commune non classée,
# avec son motif — aucune suppression silencieuse. Les motifs (dans l'ordre du
# case_when de la classification) :
#   - « perspective absente » : commune sans emploi au lieu de travail ou sans
#     actifs résidents (NA d'un côté — commune absente d'une table, ou cellule
#     non diffusée K dont la somme est NA) ;
#   - « plancher gate D » : effectif salarié < 5 — la commune sous le plancher
#     communal n≥5, comptée et nommée ;
#   - « ratio non défini » : effectif salarié ou actifs résidents ≤ 0.
# Le rapport est trié par commune — déterministe.
rapport_suppression_dortoir <- function(classes) {
  classes %>%
    dplyr::filter(is.na(classification)) %>%
    dplyr::mutate(
      motif = dplyr::case_when(
        is.na(workplace) | is.na(resident) ~
          paste0("perspective absente : commune sans emploi au lieu de travail ",
                 "ou sans actifs résidents"),
        workplace < SEUIL_EFFECTIF_TRAVAIL ~
          paste0("effectif salarié < ", SEUIL_EFFECTIF_TRAVAIL,
                 " : commune sous le plancher communal n≥5 (gate D)"),
        TRUE ~ "ratio non défini : effectif salarié ou actifs résidents ≤ 0"
      )
    ) %>%
    dplyr::select(commune, motif) %>%
    dplyr::arrange(commune)
}

# construire_dortoir_economie ---------------------------------------------------
# L'acte « calculer » du ratio dortoir : les DEUX tables normalisées réelles
# (flores_a88 + rp_emploi) -> la table commune × ratio × classification +
# le rapport de suppression. Le département est porté depuis la perspective lieu
# de travail (le référentiel breton des deux tables). La table est triée par
# commune — même commune + mêmes données -> même table, toujours.
construire_dortoir_economie <- function(flores_a88, rp_emploi) {
  travail <- agreger_effectifs_travail(flores_a88)
  resident <- agreger_actifs_occupes(rp_emploi)
  departements <- dplyr::distinct(flores_a88[c("commune", "departement")])

  table <- calculer_ratio_dortoir(travail, resident) %>%
    classifier_dortoir() %>%
    dplyr::left_join(departements, by = "commune") %>%
    dplyr::select(commune, departement, workplace, resident, ratio, classification) %>%
    dplyr::arrange(commune)

  list(
    table = table,
    suppression = rapport_suppression_dortoir(table)
  )
}

# persister_dortoir_economie ----------------------------------------------------
# Persiste l'artefact analytique sous le dossier Économie/Emploi des données
# processées (data/processed/economie/, gitignoré — JAMAIS public/) : la table
# `dormitory_economie.rds` (commune × ratio × classification, la persistance du
# todo 4) et son rapport de suppression `dormitory_economie_suppression.rds`
# (même forme de sidecar que sirene_snapshot_exclusions.rds — la suppression
# reste visible, jamais silencieuse).
persister_dortoir_economie <- function(resultat,
                                       sortie = "data/processed/economie") {
  if (!dir.exists(sortie)) dir.create(sortie, recursive = TRUE)
  readr::write_rds(resultat$table, file.path(sortie, "dormitory_economie.rds"))
  readr::write_rds(resultat$suppression,
                   file.path(sortie, "dormitory_economie_suppression.rds"))
  invisible(resultat)
}
