# Marqueurs de comparaison par ressource écrits par l'adoption (#1142, round 9).
#
# Le nouveau lecteur d'API (snapshot_reads.py) exige, pour chaque ressource scalaire
# ou profil à comparaison, un marqueur PAR RESSOURCE
# (`scalar_resource_comparison_publication` / `profile_resource_comparison_publication`)
# dont les prédicats sont :
#   * le marqueur existe pour chaque ressource demandée (_scalar/_profile_comparison_
#     publication_marker : `len(markers) != len(resource_ids)` => 503) ;
#   * `reference_content_version` du marqueur == version de référence vivante ==
#     `resource_publication.reference_content_version` ;
#   * `group_row_count >= 1` et `territory_row_count >= 1` ;
#   * `comparison_source_lineage.comparison_content_version == marker.content_version`
#     (_published_comparison_sources : « Published comparison provenance is stale ») ;
#   * profil : `profile_comparison_group/territory.profile_content_version ==
#     marker.profile_content_version` et `reference_content_version == marker.reference`.
# Les lignes de comparaison vivantes portent les jetons GLOBAUX d'aujourd'hui. Le
# jeton est la clé d'identité de l'API : l'adoption le REPORTE tel quel dans le
# marqueur, par les MÊMES écrivains que `apply` (ecrire_marqueur_comparaison_*), sans
# jamais réécrire une ligne de comparaison. Series, collections et AEDAR n'ont pas de
# marqueur par ressource à créer : leurs marqueurs (`ordered_series_comparison_publication`
# par dataset, `observed_collection_comparison_publication` par indicateur,
# `aedar_comparison_publication` singleton) sont déjà par ressource en production.

# Le seul jeton que portent les lignes vivantes (NULL s'il n'y a aucune ligne) ; deux
# jetons distincts dans une même ressource ne peuvent pas être reportés dans UN marqueur.
.jeton_vivant_unique <- function(ressource, ...) {
  valeurs <- unique(as.character(unlist(list(...), use.names = FALSE)))
  valeurs <- valeurs[!is.na(valeurs) & nzchar(valeurs)]
  if (length(valeurs) > 1L)
    stop(erreur_adoption("jeton_comparaison_multiple", paste0(
      "adoption : jeton_comparaison_multiple: ", ressource, " porte ", length(valeurs),
      " jetons de comparaison distincts (", paste(valeurs, collapse = ", "),
      ") — un seul marqueur ne peut pas les reporter.")))
  if (length(valeurs)) valeurs else NULL
}

.nb_lignes <- function(x) if (is.data.frame(x)) nrow(x) else 0L

marqueur_adoption_scalaire <- function(con, ressource, artefact, live, reference) {
  comparaison <- artefact$contenu$comparison
  if (!is.list(comparaison)) return(NULL)
  lignage <- live$comparison_source_lineage
  jeton <- .jeton_vivant_unique(ressource, lignage$comparison_content_version) %||%
    as.character(comparaison$content_version)
  ecrire_marqueur_comparaison_scalaire(con, ressource, content_version = jeton,
    scalar_content_version = as.character(comparaison$scalar_content_version),
    reference_content_version = reference$version,
    groupes = .nb_lignes(live$scalar_comparison_group),
    territoires = .nb_lignes(live$scalar_comparison_territory),
    lignage = .nb_lignes(lignage))
  list(table = "scalar_resource_comparison_publication", content_version = jeton)
}

marqueur_adoption_profil <- function(con, ressource, artefact, live, reference) {
  comparaison <- artefact$contenu$comparison
  if (!is.list(comparaison)) return(NULL)
  lignage <- live$comparison_source_lineage
  jeton <- .jeton_vivant_unique(ressource, lignage$comparison_content_version) %||%
    as.character(comparaison$content_version)
  faits <- .jeton_vivant_unique(ressource, live$profile_comparison_group$profile_content_version,
    live$profile_comparison_territory$profile_content_version) %||%
    as.character(comparaison$profile_content_version)
  ecrire_marqueur_comparaison_profil(con, ressource, content_version = jeton,
    profile_content_version = faits, reference_content_version = reference$version,
    groupes = .nb_lignes(live$profile_comparison_group),
    territoires = .nb_lignes(live$profile_comparison_territory),
    lignage = .nb_lignes(lignage))
  list(table = "profile_resource_comparison_publication", content_version = jeton)
}
