# Liaisons globales explicites de l'adoption (#1142).
#
# Les publishers d'AUJOURD'HUI lient certaines colonnes vivantes à des jetons
# GLOBAUX (le snapshot scalaire complet, le snapshot de comparaison complet),
# alors que l'Artefact de ressource les lie à des jetons PAR RESSOURCE (version
# des faits de la ressource). C'est une différence systématique ANTÉRIEURE au
# registre, pas une divergence à cacher, mais elle ne doit JAMAIS être résolue par
# une réécriture silencieuse de la valeur vivante (adaptateur_profil_declare.R :
# « jamais de rebind silencieux »).
#
# Chaque handler déclare donc `liaisons_globales(live, artefacts, attestations)`:
# il VÉRIFIE la chaîne exacte de jetons et renvoie, par table, les SEULES colonnes
# que la comparaison peut ignorer parce que la chaîne tient. Tout jeton hors
# chaîne n'est pas ignoré : il est comparé tel quel et diverge, ou — pour la
# dépendance scalaire d'un profil — refuse avec une raison typée. Rien n'est
# jamais réécrit dans les lignes vivantes.

.jetons_vivants <- function(live, table, colonne) {
  x <- live[[table]]
  if (!is.data.frame(x) || !colonne %in% names(x) || !nrow(x)) return(character())
  unique(as.character(x[[colonne]]))
}

# Tous les jetons vivants de la colonne valent le marqueur global vivant.
.jetons_egaux_marqueur <- function(jetons, marqueur) {
  length(jetons) > 0L && !anyNA(jetons) && length(marqueur) == 1L && !is.na(marqueur) &&
    nzchar(marqueur) && all(jetons == marqueur)
}

# UNE seule déclaration de l'exemption du jeton de lignage (table + colonne), pour
# toutes les formes : seul le MARQUEUR auquel on compare diffère par forme.
EXEMPTION_JETON_LIGNAGE <- list(comparison_source_lineage = "comparison_content_version")

.exemption_jeton_lignage <- function(live, marqueur) {
  if (.jetons_egaux_marqueur(.jetons_vivants(live, "comparison_source_lineage",
        "comparison_content_version"), marqueur)) EXEMPTION_JETON_LIGNAGE else list()
}

# Scalaire : le jeton de lignage de comparaison vivant est le contenu du singleton
# global scalar_comparison_publication, pas celui de la comparaison de la ressource.
# ATTESTÉ contre la sortie : ce singleton a été calculé sur le snapshot scalaire
# global (`scalar_comparison_publication.scalar_content_version`), qui doit être le
# marqueur scalaire vivant (`table_publication['scalar_observation']`) ET le jeton
# que la sortie a enregistré pour ce scalaire (binding.json). La sortie n'enregistre
# PAS de jeton de comparaison scalaire lui-même : c'est le jeton scalaire dont il
# dérive qui est attesté, et la comparaison est ensuite prouvée ligne à ligne.
# Si le jeton vivant EST le singleton mais que la chaîne n'est pas attestée : refus
# typé `jeton_comparaison_non_atteste`, jamais un passage silencieux.
liaisons_globales_scalaire <- function(live, artefacts, attestations = list()) {
  marqueurs <- attr(live, "marqueurs_globaux")
  exemption <- .exemption_jeton_lignage(live, marqueurs$comparison_content_version)
  if (!length(exemption)) return(list())
  entree <- as.character(marqueurs$comparison_scalar_input)
  global <- as.character(marqueurs$scalar_content_version)
  enregistre <- as.character(attestations$scalar_binding %||% NA_character_)
  if (length(entree) == 1L && !is.na(entree) && length(global) == 1L && !is.na(global) &&
      length(enregistre) == 1L && !is.na(enregistre) &&
      identical(entree, global) && identical(global, enregistre))
    return(exemption)
  stop(erreur_adoption("jeton_comparaison_non_atteste", paste0(
    "adoption : jeton_comparaison_non_atteste: le lignage de comparaison scalaire porte le ",
    "jeton global vivant, mais le snapshot scalaire dont il dérive (",
    if (length(entree) != 1L || is.na(entree)) "<absent>" else entree,
    ") n'est pas le marqueur scalaire vivant (",
    if (length(global) != 1L || is.na(global)) "<absent>" else global,
    ") enregistré par la sortie (",
    if (length(enregistre) != 1L || is.na(enregistre)) "<absent>" else enregistre, ").")))
}

# Profil déclaré : (1) les jetons de comparaison vivants sont ceux du singleton
# global profile_comparison_publication ; (2) required_scalar_version est le jeton
# scalaire GLOBAL. (2) n'est accepté que si le jeton vivant EST le marqueur
# scalaire vivant ET que ce marqueur EST le jeton que la sortie a enregistré pour
# ce scalaire (binding.json) ; sinon refus typé `dependance_divergente`.
liaisons_globales_profil <- function(live, artefacts, attestations = list()) {
  marqueurs <- attr(live, "marqueurs_globaux")
  # La sortie n'enregistre AUCUN jeton de comparaison de profil (seulement la liaison
  # scalaire) : ces jetons ne sont donc attestés que contre le singleton vivant
  # profile_comparison_publication ; le contenu, lui, est prouvé ligne à ligne.
  ignorer <- .exemption_jeton_lignage(live, marqueurs$comparison_content_version)
  for (table in c("profile_comparison_group", "profile_comparison_territory"))
    if (.jetons_egaux_marqueur(.jetons_vivants(live, table, "profile_content_version"),
                               marqueurs$profile_content_version))
      ignorer[[table]] <- "profile_content_version"

  descriptor <- as.list(live$profile_descriptor[1L, , drop = FALSE])
  dependance <- descriptor$comparison_scalar
  if (is.null(dependance) || !length(dependance) || is.na(dependance) ||
      is.null(artefacts[[as.character(dependance)[[1L]]]])) return(ignorer)
  dependance <- as.character(dependance)[[1L]]
  attendu <- version_faits_artefact(artefacts[[dependance]])
  jeton <- as.character(descriptor$required_scalar_version[[1L]])
  if (identical(jeton, attendu)) return(ignorer)
  global <- as.character(marqueurs$scalar_content_version)
  enregistre <- as.character(attestations$scalar_binding %||% NA_character_)
  if (length(jeton) == 1L && !is.na(jeton) && length(global) == 1L && !is.na(global) &&
      length(enregistre) == 1L && !is.na(enregistre) &&
      identical(jeton, global) && identical(global, enregistre)) {
    ignorer$profile_descriptor <- "required_scalar_version"
    return(ignorer)
  }
  stop(erreur_adoption("dependance_divergente", paste0(
    "adoption : dependance_divergente: ", dependance, " liée au jeton vivant ",
    if (is.na(jeton)) "<absent>" else jeton, " (marqueur scalaire global vivant ",
    if (is.na(global)) "<absent>" else global, ", jeton enregistré par la sortie ",
    if (is.na(enregistre)) "<absent>" else enregistre,
    ") — ni la version des faits de l'artefact ni la chaîne globale attestée.")))
}
