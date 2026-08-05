# analytics_economie_lq --------------------------------------------------------
# L'analyse LQ continue du thème Économie/Emploi (plan economie-analytical-phase,
# todo 1 — gates C/D/E verrouillées 2026-08-05 ; docs/themes/economie-emploi.md
# §Story pool : la LQ est l'Histoire par défaut « ce que la commune sait
# faire »). Le chaînon analytique qui transforme la table normalisée
# `sirene_snapshot` (commune × code APE × tranche d'effectifs → nombre
# d'établissements ACTIFS) en quatre artefacts sous data/processed/economie/ :
#
#   1. `agreger_sirene_par_activite`  — regroupement de la dimension tranche :
#      somme de `value` par commune × code APE. La table long et creuse du
#      contrat (une ligne par cellule observée commune × APE × tranche, la
#      taille reste une valeur atomique par ligne) redevient le comptage du
#      grain fin commune × activité.
#   2. `appliquer_plancher_communes`  — le plancher de commune gate D : une
#      commune n'entre dans le calcul analytique que si son TOTAL
#      d'établissements actifs (somme de ligne sur tous les codes APE) ≥ 5.
#      Les communes sous le plancher sont SUPPRIMÉES et COMPTÉES dans un
#      rapport de suppression (jamais écartées en silence) — la preuve réelle
#      (181 481 lignes, 1202 communes) supprime 0 commune (min = 10
#      établissements), la fixture analytique exerce la règle.
#   3. `calculer_lq_balassa`          — la LQ de Balassa CONTINUE par commune ×
#      code APE 5 chiffres vs la moyenne bretonne (gate E — référence
#      Bretagne seule, jamais France entière) :
#          LQ_ca = (n_ca / n_c.) / (n_.a / n_..)
#      avec n_ca = établissements de la commune c dans l'activité a, n_c. =
#      total de la commune, n_.a = total de l'activité sur la Bretagne retenue,
#      n_.. = total général. Les colonnes de transparence n_c / n_a / n sont
#      persistées à côté de la LQ. La LQ reste CONTINUE : aucun seuillage
#      (gate C — le seuil n'existe pas dans cette phase, la matrice binaire
#      part dans le sidecar M).
#   4. `calculer_histoires_lq`        — l'Histoire « ce que la commune sait
#      faire » : les TOP_N_SPECIALISATIONS_LQ (décision de build : top-3,
#      documentée) spécialisations par LQ, valeurs CONTINUES uniquement. Une
#      entrée binaire (une matrice M 0/1 passée par erreur) échoue
#      bruyamment — l'Histoire ne se seuille jamais (gate C). Sélection
#      déterministe (ADR-0002) : tri par LQ décroissante puis code APE
#      croissant — même entrée → même Histoire, pour toujours.
#   5. `calculer_matrice_m`           — le sidecar M : la matrice d'incidence
#      binaire (LQ ≥ 1, commune × activité) comme artefact SÉPARÉ pour la
#      relatedness future (gate F — docs/research/relatedness.md §5 Layer 1 :
#      « entry = 1 if the commune's LQ ≥ 1 »). L'Histoire ne l'utilise jamais.
#
# `construire_analytique_lq_economie` enchaîne les cinq étapes et persiste les
# quatre artefacts sous la localisation dédiée Économie/Emploi des données
# processées (data/processed/economie/). Idempotent et déterministe (les
# tibbles sont triés, les écritures relisent l'identique) — relancer produit
# les mêmes artefacts, octet-pour-octet. Aucun payload de fiche ici : les
# preuves vivent sous pipeline/data/ (gitignoré), jamais sous public/.
# Aucun appel réseau dans la boucle de test : la fixture analytique
# (test-analytics-economie-lq.R) est le seam d'entrée, la vraie table est
# lue quand elle est présente.

# SEUIL_PLANCHER_COMMUNES_LQ ---------------------------------------------------
# Le plancher de commune gate D (décision 2026-08-05) : une commune entre dans
# le calcul analytique si son TOTAL d'établissements actifs (somme de ligne
# sur tous les codes APE) est ≥ 5. Verrouillé sur la preuve réelle : min = 10
# établissements/commune → 0 commune supprimée ; la fixture analytique
# (56001, total 3) exerce la règle de suppression+comptage.
SEUIL_PLANCHER_COMMUNES_LQ <- 5

# TOP_N_SPECIALISATIONS_LQ -----------------------------------------------------
# La profondeur de l'Histoire « ce que la commune sait faire » (décision de
# build, documentée) : les top-3 spécialisations par LQ. Le plan
# (economie-analytical-phase, todo 1) laisse le choix top-3/top-5 au build ;
# top-3 est retenu — la lecture de fiche la plus lisible, alignée sur le
# top-3 du §5 Layer 1 de docs/research/relatedness.md (« top-3 sectors »).
TOP_N_SPECIALISATIONS_LQ <- 3

# agreger_sirene_par_activite --------------------------------------------------
# Le regroupement de la dimension tranche (étape 1) : somme de `value` par
# commune × code APE, le libellé d'activité conservé (premier non manquant).
# La table doit porter les colonnes du contrat commune / activity_code /
# value (une valeur par ligne, positive) — la forme de normaliser_sirene_
# snapshot. Déterministe : triée par commune puis code APE.
agreger_sirene_par_activite <- function(snapshot) {
  manquantes <- setdiff(c("commune", "activity_code", "value"), names(snapshot))
  if (length(manquantes) > 0) {
    stop("Analyse LQ — le snapshot doit porter les colonnes commune, ",
         "activity_code et value (manquantes : ",
         paste(manquantes, collapse = ", "), ").", call. = FALSE)
  }
  if (any(is.na(snapshot$commune) | is.na(snapshot$activity_code))) {
    stop("Analyse LQ — commune ou activity_code manquant dans le snapshot.",
         call. = FALSE)
  }
  if (any(is.na(snapshot$value) | snapshot$value <= 0)) {
    stop("Analyse LQ — value doit être positive (le snapshot ne porte que des ",
         "cellules observées).", call. = FALSE)
  }

  snapshot %>%
    dplyr::group_by(commune, activity_code) %>%
    dplyr::summarise(
      activity_label = premier_libelle(activity_label),
      n = sum(value),
      .groups = "drop"
    ) %>%
    dplyr::arrange(commune, activity_code)
}

# appliquer_plancher_communes --------------------------------------------------
# Le plancher de commune gate D (étape 2) : le total par commune (la somme de
# ligne sur tous les codes APE) détermine l'entrée dans le calcul. Retourne
# la liste {retenu, suppression} :
#   - retenu     : les lignes commune × activité des communes ≥ seuil ;
#   - suppression : LE rapport de suppression — une ligne par commune écartée
#     avec son total (n_total) et son nombre d'activités (n_activites), plus
#     le seuil appliqué. JAMAIS une suppression silencieuse : le rapport est
#     un artefact persisté, vide quand aucune commune n'est écartée.
# Le seuil est nommé (SEUIL_PLANCHER_COMMUNES_LQ) et paramétrable — la
# fixture l'exerce ; la vraie table supprime 0 commune.
appliquer_plancher_communes <- function(agrege, seuil = SEUIL_PLANCHER_COMMUNES_LQ) {
  totaux <- agrege %>%
    dplyr::group_by(commune) %>%
    dplyr::summarise(
      n_total = sum(n),
      n_activites = dplyr::n(),
      .groups = "drop"
    )

  retenues <- totaux$commune[totaux$n_total >= seuil]

  list(
    retenu = agrege %>%
      dplyr::filter(commune %in% retenues) %>%
      dplyr::arrange(commune, activity_code),
    suppression = totaux %>%
      dplyr::filter(commune %in% setdiff(totaux$commune, retenues)) %>%
      dplyr::mutate(seuil_commune = seuil) %>%
      dplyr::arrange(commune)
  )
}

# calculer_lq_balassa ----------------------------------------------------------
# La LQ de Balassa continue (étape 3) : par cellule commune × activité,
#   LQ_ca = (n_ca / n_c.) / (n_.a / n_..)
# où les totaux bretons (n_.a par activité, n_.. général) se calculent sur la
# Bretagne RETENUE seulement — les communes sous le plancher n'entrent ni
# dans le numérateur ni dans les références bretonnes. La référence est la
# Bretagne seule (gate E). Les colonnes de transparence du contrat sont
# persistées : n (la cellule n_ca), n_c (le total de la commune), n_a (le
# total de l'activité sur la Bretagne retenue). Déterministe : trié par
# commune puis code APE.
calculer_lq_balassa <- function(retenu) {
  totaux_commune <- retenu %>%
    dplyr::group_by(commune) %>%
    dplyr::summarise(n_c = sum(n), .groups = "drop")
  totaux_activite <- retenu %>%
    dplyr::group_by(activity_code) %>%
    dplyr::summarise(n_a = sum(n), .groups = "drop")
  total_general <- sum(retenu$n)

  if (total_general <= 0) {
    stop("Analyse LQ — total général nul : aucune commune retenue.", call. = FALSE)
  }

  retenu %>%
    dplyr::left_join(totaux_commune, by = "commune") %>%
    dplyr::left_join(totaux_activite, by = "activity_code") %>%
    dplyr::mutate(
      lq = (n / n_c) / (n_a / total_general)
    ) %>%
    dplyr::select(commune, activity_code, activity_label, lq, n, n_c, n_a) %>%
    dplyr::arrange(commune, activity_code)
}

# calculer_histoires_lq --------------------------------------------------------
# L'Histoire « ce que la commune sait faire » (étape 4) : les top-N
# spécialisations par LQ, valeurs CONTINUES uniquement. Une colonne lq
# binaire (toutes valeurs dans {0, 1}) est REFUSÉE — l'Histoire ne se
# seuille jamais (gate C), la matrice M n'est pas un Story driver. La
# sélection est déterministe (ADR-0002) : tri par lq décroissante puis code
# APE croissant (l'ex æquo déterministe — même entrée, même Histoire, pour
# toujours). Une commune avec moins de top_n activités reçoit toutes ses
# activités (le rang suit le nombre d'activités, jamais de padding).
calculer_histoires_lq <- function(lq, top_n = TOP_N_SPECIALISATIONS_LQ) {
  if (!"lq" %in% names(lq)) {
    stop("Analyse LQ — l'Histoire exige une colonne lq.", call. = FALSE)
  }
  if (any(is.na(lq$lq))) {
    stop("Analyse LQ — lq manquant : la LQ doit être calculée avant l'Histoire.",
         call. = FALSE)
  }
  if (all(lq$lq %in% c(0, 1))) {
    stop("Analyse LQ — l'Histoire exige une LQ continue : l'entrée est binaire ",
         "(la matrice M ne pilote jamais l'Histoire, gate C).", call. = FALSE)
  }

  lq %>%
    dplyr::group_by(commune) %>%
    dplyr::arrange(dplyr::desc(lq), activity_code, .by_group = TRUE) %>%
    dplyr::slice_head(n = top_n) %>%
    dplyr::mutate(rang = dplyr::row_number()) %>%
    dplyr::ungroup() %>%
    dplyr::select(commune, rang, activity_code, activity_label, lq) %>%
    dplyr::arrange(commune, rang)
}

# calculer_matrice_m -----------------------------------------------------------
# Le sidecar M (étape 5) : la matrice d'incidence binaire commune × activité,
# m = 1 si LQ ≥ 1, 0 sinon (le seuil 1.0 appartient à la spécialisation —
# LQ ≥ 1, jamais LQ > 1). Artefact SÉPARÉ : le CROISEMENT COMPLET commune ×
# activité (l'univers des activités de la Bretagne retenue) — une ligne par
# cellule de la matrice, les zéros explicites compris — exactement la forme
# que docs/research/relatedness.md §7 attend (M : regions × industries, 0/1,
# LQ ≥ 1 ; colSums(M) = ubiquité). L'Histoire n'y touche jamais. Déterministe :
# trié par commune puis code APE.
calculer_matrice_m <- function(lq) {
  croise <- tidyr::crossing(
    commune = sort(unique(lq$commune)),
    activity_code = sort(unique(lq$activity_code))
  )

  croise %>%
    dplyr::left_join(
      lq[c("commune", "activity_code", "lq")],
      by = c("commune", "activity_code")
    ) %>%
    dplyr::mutate(m = as.integer(!is.na(lq) & lq >= 1)) %>%
    dplyr::select(commune, activity_code, m) %>%
    dplyr::arrange(commune, activity_code)
}

# construire_analytique_lq_economie --------------------------------------------
# L'acte « calculer » du chaînon : le snapshot normalisé (lignes
# commune × APE × tranche) vers les quatre artefacts analytiques, persistés
# sous la localisation Économie/Emploi des données processées (défaut :
# data/processed/economie/). Retourne la liste {lq, histoires, m, suppression}
# — la forme de test. Le paramètre `snapshot` permet aux tests de passer la
# fixture directement (le même chemin de code que la vraie table). Idempotent
# (les écritures écrassent) et déterministe (les tibbles retournés relisent
# l'identique des fichiers persistés).
construire_analytique_lq_economie <- function(snapshot,
                                              sortie = "data/processed/economie") {
  agrege <- agreger_sirene_par_activite(snapshot)
  plancher <- appliquer_plancher_communes(agrege)
  lq <- calculer_lq_balassa(plancher$retenu)
  histoires <- calculer_histoires_lq(lq)
  m <- calculer_matrice_m(lq)

  if (!dir.exists(sortie)) dir.create(sortie, recursive = TRUE)
  readr::write_rds(lq, file.path(sortie, "lq_economie.rds"))
  readr::write_rds(histoires, file.path(sortie, "histoires_lq_economie.rds"))
  readr::write_rds(m, file.path(sortie, "m_economie.rds"))
  readr::write_rds(plancher$suppression,
                   file.path(sortie, "suppression_lq_economie.rds"))

  list(lq = lq, histoires = histoires, m = m,
       suppression = plancher$suppression)
}
