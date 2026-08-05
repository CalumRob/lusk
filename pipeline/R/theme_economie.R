# theme_economie ---------------------------------------------------------------
# Le module du thème Économie/Emploi (issue #96, gate A) : le descripteur
# LÉGER theme_economie() que la machinerie partagée (download/compute/publish)
# consomme sans jamais nommer le thème — la même forme de contrat que
# theme_demographie() (issue #13) et theme_habitat() (issue #17).
#
# Ce qui vit ici, ce qui ne vit pas ici :
#   - le manifeste CONCATÉNÉ du thème : les quatre fragments par source
#     (SIRENE régional, Flores A38/A88, RP Emploi, RP Chômage), chacun gardant
#     SON contrat, SON vintage, SA référence et SA publication — AUCUN
#     alignement de date entre sources ;
#   - la construction des données : les QUATRE builders de sources (les
#     normalisateurs des fragments) assemblés en une liste nommée ;
#   - le builder de vintages (la projection générique depuis le manifeste,
#     vintages_depuis_manifest, vintage.R) ;
#   - le SEAM de calcul de T8 : construire_analytiques_economie enchaîne les
#     builders analytiques des T1-T5 (analytics_economie_{lq,lq_flores,green,
#     dormitory,chomage}) puis les rangs-en-contexte de T6 (analytics_economie_
#     ranks) — le seam ne CALCULE RIEN lui-même, les indicateurs vivent dans
#     les T1-T5 (MUST NOT du plan) ;
#   - le SEAM de publication de T8 : publier_economie, STUB — T8 câble la
#     publication du payload Économie ; tant qu'il n'est pas livré, un appel
#     échoue fort (jamais un « under construction » silencieux).
# Ce qui N'y vit PAS : aucun calcul d'indicateur (T1-T5), aucune publication
# (T8), aucun alignement de dates, aucune modification de
# theme_demographie/theme_habitat.

# MANIFEST_ECONOMIE ------------------------------------------------------------
# Le manifeste du thème : les QUATRE fragments concaténés (la convention des
# fragments par source, issue #13) — une ligne par source, jamais de doublon de
# cache. Chaque source garde son vintage : SIRENE 2026-04 (référence
# 2026-03-31, publication 2026-05-01), Flores A38/A88 2024 (référence
# 2024-12-31, publication 2026-03-31), RP Emploi 2023 (référence 2023-01-01,
# publication 2026-06-30), RP Chômage 2023 (référence 2023-01-01, publication
# 2026-07-15). Le référentiel partagé « epci » n'est PAS une source Économie :
# la base des EPCI bretonne est la ressource transversale que les
# normalisateurs lisent dans le cache partagé (déclarée par les manifestes
# Démographie/Habitat) — jamais re-déclarée ici.
MANIFEST_ECONOMIE <- dplyr::bind_rows(
  MANIFEST_ECONOMIE_SIRENE,
  MANIFEST_ECONOMIE_FLORES,
  MANIFEST_ECONOMIE_RP,
  MANIFEST_ECONOMIE_CHOMAGE
)

# construire_donnees_economie --------------------------------------------------
# L'acte « trouver la donnée » du thème : les quatre builders de sources —
# chacun décompresse son cache, normalise, persiste SA table sous
# data/processed/economie/ (idempotent, comme les builders des sources) — et
# assemble les tables normalisées en UNE liste nommée (la forme que le chaînon
# analytique et T8 consomment). Les builders gardent leurs signatures et leurs
# sorties ; l'assembleur ne ré-implémente RIEN. Le référentiel EPCI partagé est
# lu par les builders dans le cache (lire_epci), comme dans la phase
# source-table (test-run-economie-contracts.R) — pas une source du thème.
construire_donnees_economie <- function(cache = "data/raw") {
  flores <- construire_donnees_brut_flores(cache = cache)

  list(
    sirene_snapshot = construire_sirene_normalise(cache = cache),
    flores_a38 = flores$flores_a38$table,
    flores_a88 = flores$flores_a88$table,
    rp_emploi = construire_donnees_brut_emploi_rp(cache = cache)$table,
    rp_chomage = construire_donnees_brut_chomage(cache = cache)$table
  )
}

# vintages_economie ------------------------------------------------------------
# Le builder de vintages du thème : la projection générique depuis le manifeste
# (vintages_depuis_manifest, vintage.R) — chaque source garde SA référence et
# SA publication, AUCUN alignement (les sources RP sœurs rp_emploi / rp_chomage
# partagent le millésime 2023 mais pas la publication : 2026-06-30 vs
# 2026-07-15).
vintages_economie <- function() {
  vintages_depuis_manifest(MANIFEST_ECONOMIE)
}

# construire_analytiques_economie ----------------------------------------------
# LE seam de calcul de T8 : le chaînon analytique complet T1→T6. Il enchaîne
# les builders EXISTANTS — jamais un calcul dans l'assembleur (les indicateurs
# vivent dans les T1-T5, MUST NOT du plan) :
#   - T1 la LQ continue (SIRENE, analytics_economie_lq.R) ;
#   - T2 la LQ d'emploi (Flores, les DEUX grains natifs A88 et A38, jamais
#     fusionnés — analytics_economie_lq_flores.R ; A88 est le grain livré) ;
#   - T3 le score vert (SIRENE × EGSS, analytics_economie_green.R) ;
#   - T4 le ratio dortoir (Flores A88 × RP Emploi, analytics_economie_
#     dormitory.R) ;
#   - T5 le chômage (RP Chômage, analytics_economie_chomage.R) ;
#   - T6 les rangs-en-contexte des quatre indicateurs publiés — les artefacts
#     *_rangs.rds (analytics_economie_ranks.R).
# `donnees` est la liste nommée de construire_donnees_economie ; `base_epci`
# la base des EPCI (la forme de lire_epci : CODGEO/EPCI/DEP) que T6 consomme ;
# `artefact` la liste EGSS épinglée (artefact_egss) que T3 consomme. Retourne
# la liste des tables analytiques (les artefacts T6 classés pour les quatre
# indicateurs publiés + les tables de support T1/T2) — la forme de test et
# l'entrée du seam de publication de T8.
construire_analytiques_economie <- function(donnees, base_epci, artefact,
                                            sortie = "data/processed/economie") {
  # T1 — la LQ continue (SIRENE) : lq + histoires + matrice M + suppression
  lq <- construire_analytique_lq_economie(donnees$sirene_snapshot, sortie = sortie)
  # T2 — la LQ d'emploi (Flores, les deux grains natifs)
  lq_emploi_a88 <- construire_analytique_lq_flores(donnees$flores_a88, "A88",
                                                   sortie = sortie)
  lq_emploi_a38 <- construire_analytique_lq_flores(donnees$flores_a38, "A38",
                                                   sortie = sortie)
  # T3 — le score vert (SIRENE × EGSS) + son rapport de suppression
  eco <- construire_eco_activites_economie(donnees$sirene_snapshot, artefact)
  persister_eco_activites_economie(eco, sortie = sortie)
  # T4 — le ratio dortoir (Flores A88 × RP Emploi) + son rapport de suppression
  dortoir <- construire_dortoir_economie(donnees$flores_a88, donnees$rp_emploi)
  persister_dortoir_economie(dortoir, sortie = sortie)
  # T5 — le chômage (RP Chômage) + son rapport de suppression
  chomage <- construire_chomage_economie(donnees$rp_chomage)
  persister_chomage_economie(chomage, sortie = sortie)
  # T6 — les rangs-en-contexte (les artefacts *_rangs.rds ; A88 livré d'abord)
  rangs <- construire_rangs_analytiques_economie(
    lq$lq, lq_emploi_a88$lq, eco$table, chomage$table,
    base_epci, sortie = sortie
  )

  list(
    lq = rangs$lq,
    histoires_lq = lq$histoires,
    m = lq$m,
    lq_emploi_a88 = rangs$lq_emploi,
    lq_emploi_a38 = lq_emploi_a38$lq,
    eco_activites = rangs$eco,
    dortoir = dortoir$table,
    chomage = rangs$chomage
  )
}

# publier_economie -------------------------------------------------------------
# LE seam de publication de T8 : STUB. T8 câble la publication du payload
# Économie (les artefacts analytiques *_rangs.rds et la fiche) — tant que T8
# n'est pas livré, un appel échoue FORT plutôt que de publier un état
# incomplet (jamais un « under construction » silencieux). Le descripteur
# porte le seam pour que la forme du contrat soit complète.
publier_economie <- function(...) {
  stop(
    "publier_economie : le seam de publication est câblé par T8 — appel hors contrat.",
    call. = FALSE
  )
}

# MEMBRES_DESCRIPTEUR_ECONOMIE -------------------------------------------------
# Les membres requis du descripteur — le contrat de FORME du thème (ce que la
# machinerie partagée consomme : theme, manifest, vintages, construire_donnees
# — et ce que T8 branche : construire_analytiques, publier). La même idée que
# les contrats de manifeste des fragments (verifier_contrat_flores, ...) :
# un descripteur incomplet échoue FORT, en nommant le membre fautif.
MEMBRES_DESCRIPTEUR_ECONOMIE <- c(
  "theme", "manifest", "vintages", "construire_donnees",
  "construire_analytiques", "publier"
)

# verifier_descripteur_economie -------------------------------------------------
# La validation de FORME du descripteur : tout membre requis manquant fait
# échouer la validation bruyamment, en nommant le membre fautif. Exécutée par
# theme_economie() sur son propre résultat (la construction échoue si le
# descripteur est cassé) et par les tests sur des fixtures négatives.
verifier_descripteur_economie <- function(descripteur) {
  manquants <- setdiff(MEMBRES_DESCRIPTEUR_ECONOMIE, names(descripteur))
  if (length(manquants) > 0) {
    stop("Descripteur Économie invalide — membre(s) requis manquant(s) : ",
         paste(manquants, collapse = ", "), ".", call. = FALSE)
  }
  invisible(TRUE)
}

# theme_economie ---------------------------------------------------------------
# Le descripteur du thème Économie/Emploi : la même forme de contrat que
# theme_demographie() / theme_habitat(), avec les pièces du thème. Le
# descripteur est validé à la construction (verifier_descripteur_economie) :
# un membre manquant échoue là où il est construit, jamais plus tard dans la
# machinerie.
theme_economie <- function() {
  descripteur <- list(
    theme = "economie",
    manifest = MANIFEST_ECONOMIE,
    vintages = vintages_economie,
    construire_donnees = construire_donnees_economie,
    construire_analytiques = construire_analytiques_economie,
    publier = publier_economie
  )
  verifier_descripteur_economie(descripteur)
  descripteur
}
