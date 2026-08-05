# analytics_economie_lq_flores --------------------------------------------------
# La LQ d'emploi de la source Flores (plan economie-analytical-phase, todo 2 —
# gates B/D verrouillées 2026-08-05 ; docs/themes/economie-emploi.md : les
# tables flores_a38 / flores_a88 sont les tables d'emploi au LIEU DE TRAVAIL).
# Le chaînon qui transforme une table Flores normalisée (commune × secteur ×
# effectifs salariés) en LQ de Balassa CONTINUE par commune × secteur sur
# `effectifs_salaries` vs la moyenne bretonne :
#
#   1. `agreger_flores_par_activite` — le regroupement par grain : la mesure
#      `effectifs_salaries` seule (les établissements n'entrent jamais dans la
#      LQ d'emploi), la ligne d'activité `_T` (le total de la commune) EXCLUE,
#      et le grain A38 en plus sur les seules lignes `tranche_effectifs ==
#      "_T"` (les totaux par poste — les fichiers A88 ne sont pas déclinés par
#      tranche, la table A88 ne porte donc PAS de colonne tranche). Le contrat
#      de grain est EXIGEANT : un grain A88 porteur d'une colonne tranche est
#      refusé, un grain A38 sans colonne tranche est refusé, un grain inconnu
#      est refusé. Une valeur effectifs manquante (cellule non diffusée, statut
#      K) échoue bruyamment : jamais de sous-comptage silencieux d'une commune.
#   2. `calculer_lq_emploi_flores` — le chaînon complet : l'agrégation de grain
#      puis le NOYAU PARTAGÉ de T1 (analytics_economie_lq.R), réutilisé tel
#      quel : `appliquer_plancher_communes` (le plancher de commune gate D :
#      une commune n'entre que si son TOTAL de salariés, la somme de ligne, est
#      ≥ 5 ; les communes sous le plancher sont SUPPRIMÉES et COMPTÉES dans un
#      rapport — jamais écartées en silence) et `calculer_lq_balassa` (la LQ
#      continue par commune × secteur vs la moyenne bretonne, gate E) :
#          LQ_ca = (n_ca / n_c.) / (n_.a / n_..)
#      avec n_ca = salariés de la commune c dans le secteur a, n_c. = total de
#      la commune, n_.a = total du secteur sur la Bretagne RETENUE, n_.. =
#      total général. Les colonnes de transparence n / n_c / n_a du noyau sont
#      persistées à côté de la LQ. La LQ reste CONTINUE : aucun seuillage
#      (gate C).
#   3. `construire_analytique_lq_flores` — l'acte « calculer » : persiste la
#      LQ sous la localisation Économie/Emploi des données processées
#      (défaut : data/processed/economie/) en `lq_emploi_<grain>.rds` +
#      `suppression_emploi_<grain>.rds` (le rapport de suppression — l'artefact
#      qui rend la suppression visible). A88 est le grain LIVRÉ d'abord
#      (lq_emploi_a88.rds, gate B) ; A38 passe par la MÊME fonction, la même
#      persistance — les deux grains restent des artefacts SÉPARÉS, jamais
#      fusionnés, aucun crosswalk A88↔A38↔NAF, aucune date alignée. Idempotent
#      et déterministe (les tibbles sont triés, les écritures relisent
#      l'identique). Aucun payload de fiche ici : les preuves vivent sous
#      pipeline/data/ (gitignoré), jamais sous public/. Aucun appel réseau dans
#      la boucle de test : la fixture analytique
#      (test-analytics-economie-lq-flores.R) est le seam d'entrée, les vraies
#      tables sont lues quand elles sont présentes.

# Le plancher gate D est le même que celui du noyau partagé de T1
# (SEUIL_PLANCHER_COMMUNES_LQ = 5, verrouillé 2026-08-05) : une commune entre
# dans la LQ d'emploi si son TOTAL de salariés (la somme de ligne sur tous les
# secteurs) est ≥ 5. La preuve réelle : 6 communes supprimées en A88 comme en
# A38 (min = 2 salariés) — toutes comptées dans le rapport.

# GRAINS_FLORES ----------------------------------------------------------------
# Les deux grains natifs de la source Flores (une nomenclature agrégée par
# table, jamais fusionnées) : A88 = 86 divisions à 2 chiffres (SANS tranche
# d'effectifs), A38 = 38 postes à 2 lettres (AVEC la dimension tranche).
GRAINS_FLORES <- c("A88", "A38")

# MESURE_LQ_FLORES -------------------------------------------------------------
# La mesure du contrat de la LQ d'emploi : les effectifs salariés présents la
# dernière semaine de décembre (EMPL3112 → effectifs_salaries du manifeste).
# La mesure etablissements (UNIT_LOC) n'entre jamais dans la LQ d'emploi.
MESURE_LQ_FLORES <- "effectifs_salaries"

# TOTAL_ACTIVITE_FLORES --------------------------------------------------------
# Le code d'activité `_T` des fichiers Flores : la ligne TOTALE de la commune
# (toutes activités confondues). Ce n'est pas un secteur — toujours exclue du
# calcul, sinon les totaux de commune seraient doublés.
TOTAL_ACTIVITE_FLORES <- "_T"

# agreger_flores_par_activite --------------------------------------------------
# Le regroupement par grain (étape 1) : une table Flores normalisée vers le
# comptage du grain fin commune × secteur, sur la mesure du contrat. Le grain
# est un paramètre EXIGEANT :
#   - "A88" : pas de colonne tranche (les fichiers A88 ne sont pas déclinés
#     par tranche) — une colonne tranche_effectifs présente est refusée ;
#   - "A38" : seules les lignes tranche_effectifs == "_T" (les totaux par
#     poste) portent les effectifs du grain — une table sans colonne tranche
#     est refusée.
# La ligne d'activité `_T` (le total de la commune) et la mesure etablissements
# sont exclues dans les deux grains. Une valeur effectifs manquante (cellule
# non diffusée au grain retenu) échoue bruyamment — jamais de sous-comptage
# silencieux. Déterministe : triée par commune puis code d'activité. Retourne
# la forme du noyau partagé (commune / activity_code / activity_label / n) que
# `appliquer_plancher_communes` attend.
agreger_flores_par_activite <- function(flores, grain) {
  grain <- match.arg(grain, GRAINS_FLORES)

  requises <- c("commune", "activity_code", "activity_label", "measure", "value")
  manquantes <- setdiff(requises, names(flores))
  if (length(manquantes) > 0) {
    stop("Analyse LQ Flores — la table doit porter les colonnes ",
         paste(requises, collapse = ", "),
         " (manquantes : ", paste(manquantes, collapse = ", "), ").",
         call. = FALSE)
  }
  if (grain == "A38" && !"tranche_effectifs" %in% names(flores)) {
    stop("Analyse LQ Flores — grain A38 : la table doit porter la colonne ",
         "tranche_effectifs (absente).", call. = FALSE)
  }
  if (grain == "A88" && "tranche_effectifs" %in% names(flores)) {
    stop("Analyse LQ Flores — grain A88 : la table ne porte PAS de tranche ",
         "d'effectifs (colonne tranche_effectifs présente).", call. = FALSE)
  }

  effectifs <- flores %>%
    dplyr::filter(measure == MESURE_LQ_FLORES)
  if (grain == "A38") {
    effectifs <- effectifs %>%
      dplyr::filter(tranche_effectifs == "_T")
  }
  effectifs <- effectifs %>%
    dplyr::filter(activity_code != TOTAL_ACTIVITE_FLORES)

  if (any(is.na(effectifs$value))) {
    stop("Analyse LQ Flores — une valeur effectifs_salaries manquante (cellule ",
         "non diffusée) au grain retenu : la commune ne peut pas entrer dans ",
         "le calcul — jamais de suppression silencieuse.", call. = FALSE)
  }
  if (any(effectifs$value <= 0)) {
    stop("Analyse LQ Flores — value doit être positive (le grain ne porte que ",
         "des effectifs observés).", call. = FALSE)
  }

  effectifs %>%
    dplyr::group_by(commune, activity_code) %>%
    dplyr::summarise(
      activity_label = premier_libelle(activity_label),
      n = sum(value),
      .groups = "drop"
    ) %>%
    dplyr::arrange(commune, activity_code)
}

# calculer_lq_emploi_flores -----------------------------------------------------
# Le chaînon LQ d'emploi complet : la table Flores normalisée + son grain vers
# la LQ de Balassa CONTINUE par commune × secteur vs la moyenne bretonne.
# RÉUTILISE le noyau partagé de T1 tel quel — appliquer_plancher_communes
# (gate D : total de commune ≥ seuil, SUPPRESSION + rapport, jamais silencieux)
# puis calculer_lq_balassa (gate E : la LQ continue, les totaux bretons sur la
# Bretagne RETENUE seulement). Le seuil par défaut est le plancher gate D du
# noyau partagé (SEUIL_PLANCHER_COMMUNES_LQ). Retourne la liste {lq,
# suppression} : lq = le tibble du noyau (commune, activity_code,
# activity_label, lq, n, n_c, n_a), suppression = le rapport des communes
# écartées (vide quand aucune). Déterministe : même entrée → mêmes tibbles.
calculer_lq_emploi_flores <- function(flores, grain,
                                      seuil = SEUIL_PLANCHER_COMMUNES_LQ) {
  agrege <- agreger_flores_par_activite(flores, grain)
  plancher <- appliquer_plancher_communes(agrege, seuil)
  list(
    lq = calculer_lq_balassa(plancher$retenu),
    suppression = plancher$suppression
  )
}

# construire_analytique_lq_flores ----------------------------------------------
# L'acte « calculer » du chaînon Flores : la table normalisée + son grain vers
# les artefacts persistés sous la localisation Économie/Emploi des données
# processées (défaut : data/processed/economie/) — lq_emploi_<grain>.rds (la
# LQ, A88 livrée d'abord) et suppression_emploi_<grain>.rds (le rapport de
# suppression gate D : JAMAIS une suppression silencieuse). Retourne la liste
# {lq, suppression} — la forme de test. Le paramètre `flores` permet aux tests
# de passer la fixture directement (le même chemin de code que la vraie table).
# Idempotent (les écritures écrassent) et déterministe (les tibbles retournés
# relisent l'identique des fichiers persistés).
construire_analytique_lq_flores <- function(flores, grain,
                                            sortie = "data/processed/economie") {
  res <- calculer_lq_emploi_flores(flores, grain)
  suffixe <- tolower(grain)

  if (!dir.exists(sortie)) dir.create(sortie, recursive = TRUE)
  readr::write_rds(res$lq, file.path(sortie, paste0("lq_emploi_", suffixe, ".rds")))
  readr::write_rds(res$suppression,
                   file.path(sortie, paste0("suppression_emploi_", suffixe, ".rds")))

  res
}
