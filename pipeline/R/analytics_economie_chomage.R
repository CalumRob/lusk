# analytics_economie_chomage -----------------------------------------------------
# L'indicateur « Chômage (population active) » du thème Économie/Emploi (plan
# economie-analytical-phase, gate G, ticket #94) : la part de la population
# active résidente de 15 à 64 ans au chômage, commune par commune — le taux
# INSEE officiel de la table EMP T4 du dossier complet (formules_emp.pdf) :
# taux = chômeurs / population active = EMPSTA_ENQ=="2" / EMPSTA_ENQ=="1T2",
# dans [0, 1]. Il se calcule sur la table normalisée rp_chomage.rds
# (reshape_economie_chomage.R) : commune × mesure, 3 mesures par commune.
#
# ⚠️ CAVEAT DU CONCEPT (documenté dans le code ET la note du manifeste — fiche
# conseils INSEE « Activité – Emploi – Chômage », juin 2026,
# https://www.insee.fr/fr/information/2383177) :
#   - l'indicateur est le CHÔMAGE AU SENS DU RECENSEMENT — PAS la mesure BIT de
#     l'enquête Emploi (les taux censitaires sont systématiquement supérieurs
#     de 2 à 3 points au niveau national) ;
#   - PAS la mesure administrative France Travail/DARES (le classement au
#     recensement est totalement déconnecté de l'inscription à France Travail ;
#     aucune comparaison avec les demandeurs d'emploi en fin de mois) ;
#   - PAS les taux de chômage localisés (enquête Emploi couplée à France
#     Travail, cohérents BIT, qui n'existent qu'à la région / département /
#     zone d'emploi — jamais à la commune) ;
#   - le recensement lisse la collecte sur CINQ années : la valeur 2023 est une
#     moyenne quinquennale (2019-2023), pas un point conjoncturel.
# La précision est celle du sondage du recensement : les effectifs < 200 sont à
# manier avec précaution (les comparaisons entre communes de petite taille sont
# à proscrire) — le fichier reste complet (aucun seuil de suppression dur).
#
# Plancher : AUCUN (décision gate G) — le fichier publie les chômeurs et les
# actifs pour l'ensemble des communes, sans seuil de suppression : le taux est
# calculable pour les 1202 communes bretonnes (vérifié sur le réel). Une commune
# dont une mesure manquerait (chômeurs absents, population active absente ou
# nulle) reçoit un taux NA — jamais un zéro ou un infini inventé — et est
# comptée dans le rapport de suppression. Aucune suppression silencieuse.
#
# Sélection déterministe (ADR-0002) : même commune + mêmes données -> même
# taux, toujours — la table est triée par commune. Aucun artefact de fiche :
# la table analytique vit sous pipeline/data/ (gitignoré), jamais sous public/.

# calculer_taux_chomage ---------------------------------------------------------
# Du long commune × mesure au large commune × (chômeurs, actifs occupés,
# population active) + le taux. Le taux n'est DÉFINI que quand le numérateur
# (chômeurs) ET le dénominateur (population active > 0) sont présents — sinon
# NA, jamais un zéro ou un infini inventé. Une commune sans chômeurs (0) mais
# avec une population active positive reçoit bien le taux 0 (un zéro observé,
# pas une valeur manquante).
calculer_taux_chomage <- function(rp_chomage) {
  rp_chomage %>%
    tidyr::pivot_wider(
      id_cols = "commune",
      names_from = "measure",
      values_from = "value"
    ) %>%
    dplyr::mutate(
      taux_chomage = dplyr::if_else(
        !is.na(.data$chomeurs) &
          !is.na(.data$population_active) & .data$population_active > 0,
        .data$chomeurs / .data$population_active,
        NA_real_
      )
    )
}

# rapport_suppression_chomage ---------------------------------------------------
# Le rapport de suppression du contrat : UNE ligne par commune sans taux
# calculable, avec son motif — aucune suppression silencieuse. Les motifs :
#   - « mesure chômeurs absente » : commune sans ligne chômeurs
#     (EMPSTA_ENQ == "2") dans la table ;
#   - « population active non positive » : commune sans actifs
#     (EMPSTA_ENQ == "1T2") ou population active nulle.
# Trié par commune — déterministe.
rapport_suppression_chomage <- function(table) {
  table %>%
    dplyr::filter(is.na(.data$taux_chomage)) %>%
    dplyr::mutate(
      motif = dplyr::case_when(
        is.na(.data$chomeurs) ~
          "mesure chômeurs absente : commune sans ligne chômeurs (EMPSTA_ENQ=2) dans la table",
        TRUE ~
          "population active non positive : commune sans actifs (EMPSTA_ENQ=1T2) ou population active nulle"
      )
    ) %>%
    dplyr::select(commune, motif) %>%
    dplyr::arrange(commune)
}

# construire_chomage_economie ---------------------------------------------------
# L'acte « calculer » de l'indicateur : la table normalisée rp_chomage (le
# fichier réel) -> la table commune × taux + le rapport de suppression. Le
# département est porté depuis le référentiel breton de la table normalisée.
# La table est triée par commune — même commune + mêmes données -> même table,
# toujours (ADR-0002).
construire_chomage_economie <- function(rp_chomage) {
  departements <- dplyr::distinct(rp_chomage[c("commune", "departement")])

  table <- calculer_taux_chomage(rp_chomage) %>%
    dplyr::left_join(departements, by = "commune") %>%
    dplyr::select(commune, departement, chomeurs, actifs_occupes,
                  population_active, taux_chomage) %>%
    dplyr::arrange(commune)

  list(
    table = table,
    suppression = rapport_suppression_chomage(table)
  )
}

# persister_chomage_economie ----------------------------------------------------
# Persiste l'artefact analytique sous le dossier Économie/Emploi des données
# processées (data/processed/economie/, gitignoré — JAMAIS public/) : la table
# `chomage_economie.rds` (commune × 1 taux, la persistance du gate G) et son
# rapport de suppression `chomage_economie_suppression.rds` (même forme de
# sidecar que sirene_snapshot_exclusions.rds — la suppression reste visible,
# jamais silencieuse).
persister_chomage_economie <- function(resultat,
                                       sortie = "data/processed/economie") {
  if (!dir.exists(sortie)) dir.create(sortie, recursive = TRUE)
  readr::write_rds(resultat$table, file.path(sortie, "chomage_economie.rds"))
  readr::write_rds(resultat$suppression,
                   file.path(sortie, "chomage_economie_suppression.rds"))
  invisible(resultat)
}
