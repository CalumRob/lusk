# analytics_economie_ranks ------------------------------------------------------
# Les rangs-en-contexte des indicateurs analytiques du thème Économie/Emploi
# (plan economie-analytical-phase, todo 6 / T6) : pour chaque indicateur publié
# (LQ T1, LQ d'emploi T2, score vert T3, chômage T5), les rangs
# rang_epci / rang_dep / rang_reg en fractions dans [0, 1].
#
# La MACHINERIE PARTAGÉE des rangs (compute.R) est RÉUTILISÉE telle quelle —
# jamais re-forkée :
#   - `groupes_comparaison()` construit les groupes de comparaison (une commune
#     se compare aux communes de son EPCI, de son département, de la région) ;
#   - `percentile_par_groupe()` calcule le percentile de chaque valeur dans son
#     groupe (part strictement inférieure + moitié des ex æquo ; les valeurs NA
#     exclues du dénominateur — point 2).
# Les règles NA du contrat (CONTEXT.md « Rang ») sont donc celles de la
# machinerie partagée, vérifiées par les tests : la région ne se classe nulle
# part ; une EPCI ne se classe que dans son département (de pluralité) et la
# région ; une valeur NA n'a pas de rang et n'empoisonne pas son groupe.
#
# Deux formes de tables analytiques :
#   - une valeur par commune (score vert, chômage) : la commune est classée
#     dans son EPCI / département / région ;
#   - une valeur par cellule commune × activité (LQ, LQ d'emploi) : la cellule
#     est classée dans (activité × groupe de comparaison) — une LQ de
#     l'agriculture ne se compare qu'aux LQ de l'agriculture, jamais à une LQ
#     du commerce. `percentile_par_groupe` étant quadratique sur le nombre de
#     valeurs, l'application se fait activité par activité : le groupe d'une
#     cellule ne contenant que sa propre activité, les deux calculs sont
#     identiques, le second est seul faisable sur les 135 784 cellules réelles.
#
# Le contexte EPCI vient de la base partagée (lire_epci) : chaque commune porte
# son EPCI et son département. Une commune absente de la base est une ERREUR
# (jamais un rang NA silencieux — le contrat « pas de NA silencieux » exige de
# documenter les territoires sans groupe de comparaison, pas de les passer sous
# silence).
#
# Les tables classées sont persistées sous data/processed/economie/ en artefacts
# SÉPARÉS (*_rangs.rds) : les tables analytiques T1-T5 gardent leur contrat
# octet-pour-octet (leurs tests l'exigent), T7/T8 consommeront les artefacts
# classés. Aucun artefact de fiche, aucune Histoire classée — les Stories (LQ,
# dortoir) ne sont pas des indicateurs.

# attacher_rangs_analytiques ---------------------------------------------------
# Le cœur : attache rang_epci / rang_dep / rang_reg à une table analytique
# communale. `valeur` nomme la colonne classée ; `par_activite` nomme (si la
# table est commune × activité) la colonne d'activité — la cellule est alors
# classée dans (activité × groupe). La base des EPCI (la forme de lire_epci :
# CODGEO / LIBGEO / EPCI / LIBEPCI / DEP / REG) fournit l'EPCI et le département
# de chaque commune. Déterministe : même entrée → mêmes rangs, pour toujours.
attacher_rangs_analytiques <- function(table, base_epci, valeur,
                                       par_activite = NULL) {
  requises <- c("commune", valeur, par_activite)
  manquantes <- setdiff(requises, names(table))
  if (length(manquantes) > 0) {
    stop("Rangs économie — la table doit porter les colonnes ",
         paste(requises, collapse = ", "), " (manquantes : ",
         paste(manquantes, collapse = ", "), ").", call. = FALSE)
  }

  # le contexte partagé : commune → EPCI / département (la base lire_epci)
  contexte <- table %>%
    dplyr::left_join(
      base_epci[c("CODGEO", "EPCI", "DEP")],
      by = c("commune" = "CODGEO")
    )
  # une commune ABSENTE de la base (aucune ligne → DEP NA après la jointure)
  # est une ERREUR (jamais un rang NA silencieux). Une commune PRÉSENTE mais
  # sans EPCI (les îles — fix « Sans objet », issue #131 : EPCI = NA dans la
  # base) est LÉGITIME : son rang_epci est NA, elle garde ses rangs de
  # département et de région.
  absentes <- unique(contexte$commune[is.na(contexte$DEP)])
  if (length(absentes) > 0) {
    stop("Rangs économie — commune absente de la base des EPCI (jamais un rang ",
         "NA silencieux) : ", paste(absentes, collapse = ", "), ".",
         call. = FALSE)
  }

  # les groupes de comparaison de la machinerie partagée (compute.R)
  groupes <- groupes_comparaison(tibble::tibble(
    type = rep("commune", nrow(contexte)),
    epci = contexte$EPCI,
    departement = contexte$DEP
  ))

  # le percentile partagé, appliqué activité par activité pour les tables
  # commune × activité (le groupe d'une cellule ne contient que sa propre
  # activité : le calcul est identique, seul le coût change)
  classer <- function(groupe) {
    if (is.null(par_activite)) {
      return(percentile_par_groupe(contexte[[valeur]], groupe))
    }
    activites <- contexte[[par_activite]]
    rangs <- numeric(nrow(contexte))
    for (a in unique(activites)) {
      idx <- which(activites == a)
      rangs[idx] <- percentile_par_groupe(contexte[[valeur]][idx], groupe[idx])
    }
    rangs
  }

  table %>%
    dplyr::mutate(
      rang_epci = classer(groupes$epci),
      rang_dep = classer(groupes$dep),
      rang_reg = classer(groupes$reg)
    )
}

# attacher_rangs_lq -------------------------------------------------------------
# LQ continue (T1) : une cellule (commune × activité) classée dans
# (activité × EPCI / département / région).
attacher_rangs_lq <- function(lq, base_epci) {
  attacher_rangs_analytiques(lq, base_epci, valeur = "lq",
                             par_activite = "activity_code")
}

# attacher_rangs_lq_emploi ------------------------------------------------------
# LQ d'emploi (T2, grain A88 livré) : la même forme que la LQ continue — le
# même chaînon, la même sémantique.
attacher_rangs_lq_emploi <- function(lq_emploi, base_epci) {
  attacher_rangs_analytiques(lq_emploi, base_epci, valeur = "lq",
                             par_activite = "activity_code")
}

# attacher_rangs_eco_activites --------------------------------------------------
# Score vert (T3) : une part par commune, classée dans son EPCI / département /
# région. La commune supprimée (part NA, plancher gate D) n'a pas de rang et
# n'empoisonne pas son groupe (point 2).
attacher_rangs_eco_activites <- function(eco, base_epci) {
  attacher_rangs_analytiques(eco, base_epci, valeur = "part_economie_verte")
}

# attacher_rangs_chomage --------------------------------------------------------
# Chômage (T5) : un taux par commune, classé dans son EPCI / département /
# région. La commune sans taux calculable (NA) n'a pas de rang et n'empoisonne
# pas son groupe.
attacher_rangs_chomage <- function(chomage, base_epci) {
  attacher_rangs_analytiques(chomage, base_epci, valeur = "taux_chomage")
}

# construire_rangs_analytiques_economie -----------------------------------------
# L'acte « calculer » de T6 : attache les rangs aux quatre tables analytiques
# publiées (LQ, LQ d'emploi A88, score vert, chômage) et les persiste sous la
# localisation Économie/Emploi des données processées (défaut :
# data/processed/economie/) en artefacts SÉPARÉS (*_rangs.rds) — les tables
# T1-T5 gardent leur contrat, T7/T8 consomment les tables classées. Retourne la
# liste {lq, lq_emploi, eco, chomage} — la forme de test. Idempotent (les
# écritures écrassent) et déterministe (les tibbles retournés relisent
# l'identique des fichiers persistés).
construire_rangs_analytiques_economie <- function(lq, lq_emploi, eco, chomage,
                                                  base_epci,
                                                  sortie = "data/processed/economie") {
  liste <- list(
    lq = attacher_rangs_lq(lq, base_epci),
    lq_emploi = attacher_rangs_lq_emploi(lq_emploi, base_epci),
    eco = attacher_rangs_eco_activites(eco, base_epci),
    chomage = attacher_rangs_chomage(chomage, base_epci)
  )

  if (!dir.exists(sortie)) dir.create(sortie, recursive = TRUE)
  readr::write_rds(liste$lq, file.path(sortie, "lq_economie_rangs.rds"))
  readr::write_rds(liste$lq_emploi,
                   file.path(sortie, "lq_emploi_a88_rangs.rds"))
  readr::write_rds(liste$eco,
                   file.path(sortie, "eco_activites_economie_rangs.rds"))
  readr::write_rds(liste$chomage,
                   file.path(sortie, "chomage_economie_rangs.rds"))

  liste
}
