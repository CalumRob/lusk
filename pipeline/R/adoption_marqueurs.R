# Marqueurs de comparaison par ressource écrits par l'adoption (#1142, rounds 9-10).
#
# Le nouveau lecteur d'API (snapshot_reads.py, profile_reads.py) exige, pour chaque
# ressource scalaire ou profil à comparaison, un marqueur PAR RESSOURCE
# (`scalar_resource_comparison_publication` / `profile_resource_comparison_publication`)
# dont les prédicats sont (voir .adopt_db_predicats_api pour le miroir, ligne à ligne) :
#   * le marqueur existe, la référence du marqueur == référence vivante ==
#     `resource_publication.reference_content_version` ;
#   * `comparison_source_lineage.comparison_content_version == marker.content_version` ;
#   * profil : `profile_comparison_group/territory.profile_content_version ==
#     marker.profile_content_version` ;
#   * profil lié à un scalaire : `scalar_resource_comparison_publication.
#     scalar_content_version == profile_descriptor.required_scalar_version`
#     (profile_reads.py:focal_profiles).
# Les lignes vivantes portent les jetons GLOBAUX d'aujourd'hui : l'adoption les REPORTE
# tels quels dans le marqueur, par les MÊMES écrivains que `apply`, sans jamais réécrire
# une ligne. Elle n'INVENTE jamais un jeton : sans jeton vivant à reporter (alors que la
# comparaison a des lignes) elle refuse, avec une raison typée. Elle n'ÉCRASE jamais un
# marqueur existant : identique => rien à écrire ; différent => refus typé.
# Series, collections et AEDAR n'ont pas de marqueur par ressource à créer : les leurs
# (`ordered_series_comparison_publication` par dataset, `observed_collection_comparison_
# publication` par indicateur, `aedar_comparison_publication` singleton) existent déjà.
#
# Un profil dont la comparaison est un simple GABARIT sans ligne (profil lié à un
# scalaire, p. ex. distribution_dpe) n'a aucun jeton vivant à reporter et l'API ne lit
# jamais son marqueur (profile_reads/snapshot_reads ne le demandent que pour les profils
# sans `comparison_scalar`) : l'adoption n'en écrit pas ; le prochain `apply` l'écrit.

.jeton_vivant_unique <- function(ressource, ...) {
  valeurs <- unique(as.character(unlist(list(...), use.names = FALSE)))
  valeurs <- valeurs[!is.na(valeurs) & nzchar(valeurs)]
  if (length(valeurs) > 1L)
    stop(erreur_adoption("jeton_comparaison_multiple", paste0(
      "adoption : jeton_comparaison_multiple: ", ressource, " porte ", length(valeurs),
      " jetons distincts (", paste(valeurs, collapse = ", "),
      ") — un seul marqueur ne peut pas les reporter.")))
  if (length(valeurs)) valeurs else NULL
}

.jeton_vivant_requis <- function(ressource, quoi, valeurs) {
  jeton <- .jeton_vivant_unique(ressource, valeurs)
  if (is.null(jeton))
    stop(erreur_adoption("jeton_comparaison_absent", paste0(
      "adoption : jeton_comparaison_absent: ", ressource, " a une comparaison à lignes mais ",
      "aucun jeton vivant (", quoi, ") à reporter dans son marqueur — jamais inventé.")))
  jeton
}

.nb_lignes <- function(x) if (is.data.frame(x)) nrow(x) else 0L

# Le marqueur existant (lu avec les lignes vivantes) doit être IDENTIQUE à ce que
# l'adoption écrirait, sinon refus : jamais d'écrasement pendant adopt.
.plan_marqueur <- function(ressource, table, valeurs, existant, ecrire) {
  identique <- FALSE
  if (is.data.frame(existant) && nrow(existant)) {
    champs <- names(valeurs)
    identique <- all(vapply(champs, function(champ)
      identical(as.character(existant[[champ]][[1L]]), as.character(valeurs[[champ]])),
      logical(1)))
    if (!identique)
      stop(erreur_adoption("marqueur_existant_divergent", paste0(
        "adoption : marqueur_existant_divergent: ", table, " porte déjà une ligne pour ",
        ressource, " qui diffère de la comparaison vivante (",
        paste(champs[!vapply(champs, function(champ) identical(
          as.character(existant[[champ]][[1L]]), as.character(valeurs[[champ]])),
          logical(1))], collapse = ", "), ") — jamais écrasé par adopt.")))
  }
  list(table = table, ressource = ressource, content_version = valeurs$content_version,
       identique = identique, ecrire = ecrire)
}

planifier_marqueur_adoption_scalaire <- function(ressource, artefact, live, reference,
                                                 lectures = list(), artefacts = list()) {
  comparaison <- artefact$contenu$comparison
  if (!is.list(comparaison) || !.nb_lignes(comparaison$groups)) return(NULL)
  lignage <- live$comparison_source_lineage
  jeton <- .jeton_vivant_requis(ressource, "comparison_source_lineage.comparison_content_version",
                                lignage$comparison_content_version)
  # La liaison du profil : `scalar_content_version` du marqueur DOIT valoir le
  # `required_scalar_version` que portent les profils vivants qui en dépendent
  # (profile_reads.py:focal_profiles). Ce jeton a déjà été prouvé (version des faits de
  # l'artefact, ou chaîne globale attestée par la sortie) avant d'arriver ici.
  dependants <- names(artefacts)[vapply(names(artefacts), function(id) {
    a <- artefacts[[id]]
    identical(as.character(a$forme), "declared_profile") &&
      identical(as.character(champ_descripteur(a$contenu$descriptor, "comparison_scalar"))[1L], ressource)
  }, logical(1))]
  portes <- unlist(lapply(dependants, function(id)
    lectures[[id]]$profile_descriptor$required_scalar_version), use.names = FALSE)
  faits <- .jeton_vivant_unique(ressource, portes) %||% as.character(comparaison$scalar_content_version)
  valeurs <- list(content_version = jeton, scalar_content_version = faits,
    reference_content_version = as.character(reference$version),
    group_row_count = .nb_lignes(live$scalar_comparison_group),
    territory_row_count = .nb_lignes(live$scalar_comparison_territory),
    lineage_row_count = .nb_lignes(lignage))
  .plan_marqueur(ressource, "scalar_resource_comparison_publication", valeurs,
    attr(live, "marqueur_existant"), function(con)
      ecrire_marqueur_comparaison_scalaire(con, ressource, valeurs$content_version,
        valeurs$scalar_content_version, valeurs$reference_content_version,
        valeurs$group_row_count, valeurs$territory_row_count, valeurs$lineage_row_count,
        ecraser = FALSE))
}

planifier_marqueur_adoption_profil <- function(ressource, artefact, live, reference,
                                               lectures = list(), artefacts = list()) {
  comparaison <- artefact$contenu$comparison
  if (!is.list(comparaison) || !.nb_lignes(comparaison$groups)) return(NULL)
  jeton <- .jeton_vivant_requis(ressource, "comparison_source_lineage.comparison_content_version",
                                live$comparison_source_lineage$comparison_content_version)
  faits <- .jeton_vivant_requis(ressource, "profile_comparison_*.profile_content_version",
    c(live$profile_comparison_group$profile_content_version,
      live$profile_comparison_territory$profile_content_version))
  valeurs <- list(content_version = jeton, profile_content_version = faits,
    reference_content_version = as.character(reference$version),
    group_row_count = .nb_lignes(live$profile_comparison_group),
    territory_row_count = .nb_lignes(live$profile_comparison_territory),
    lineage_row_count = .nb_lignes(live$comparison_source_lineage))
  .plan_marqueur(ressource, "profile_resource_comparison_publication", valeurs,
    attr(live, "marqueur_existant"), function(con)
      ecrire_marqueur_comparaison_profil(con, ressource, valeurs$content_version,
        valeurs$profile_content_version, valeurs$reference_content_version,
        valeurs$group_row_count, valeurs$territory_row_count, valeurs$lineage_row_count,
        ecraser = FALSE))
}

# Écrit le marqueur planifié (rien si l'existant est déjà identique).
ecrire_marqueur_adoption <- function(con, plan) {
  if (is.null(plan)) return(NULL)
  if (!isTRUE(plan$identique)) plan$ecrire(con)
  plan
}
