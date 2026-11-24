# TEST ONLY — fixtures for the read-only Plan de publication (#1136).
# Nothing here is called by production code. The projections are the #1135
# synthetic producer projections, extended with `part_passoires` (the scalar the
# DPE declared profile declares as its `comparison_scalar`).

plan_fixture_ids <- c("census_densite", "bpe_offer", "dpe_energy", "profile_source",
                      "series_source", "collection_source", "aedar_source",
                      "unrelated_source")

plan_fixture_root <- function() tempfile("plan-artefacts-")

plan_fixture_lock <- function(ids = plan_fixture_ids) {
  registre <- stats::setNames(lapply(as.character(ids), function(id) {
    list(source_id = id, url = "https://example.invalid/x",
         sha256 = paste0("sha256-", id), bytes = 10L,
         acquired_at = "2026-11-23", vintage_basis = "telechargement",
         vintage = "2026-11", date_reference = "2026-11-23")
  }), as.character(ids))
  lock <- tempfile("plan-lock-")
  ecrire_lock(registre, lock)
  list(registre = registre, lock = lock)
}

plan_fixture_projections <- function(reference_version = "reference-v1",
                                     valeurs_offre = NULL,
                                     valeurs_part = NULL) {
  projections <- artefacts_fixture_all_projections(reference_version)
  part <- artefacts_fixture_scalar_indicator("part_passoires", "dpe_energy",
    c(20, 30, 40, 50, 60, 70, 80, 90, 100, 110))
  if (!is.null(valeurs_part)) part$facts$value <- valeurs_part
  projections$scalar$part_passoires <- part
  if (!is.null(valeurs_offre))
    projections$scalar$offre_tc$facts$value <- valeurs_offre
  projections
}

plan_fixture_build <- function(root, reference_version = "reference-v1",
                               projections = NULL, digests = NULL) {
  if (is.null(projections)) projections <- plan_fixture_projections(reference_version)
  if (is.null(digests)) digests <- artefacts_fixture_digests(plan_fixture_ids)
  reference <- artefacts_fixture_reference(reference_version)
  splitter_sortie(tempfile("sortie-plan-"), root = root, projections = projections,
                  reference = reference, digests = digests)
}

plan_fixture_builds <- function(resultat) {
  data.frame(ressource = resultat$ressource, forme = resultat$forme,
             version = resultat$version, stringsAsFactors = FALSE)
}

plan_fixture_listing <- function(resultat) {
  data.frame(ressource = resultat$ressource, version = resultat$version,
             stringsAsFactors = FALSE)
}

plan_fixture_listing_json <- function(live) {
  chemin <- tempfile("plan-live-")
  jsonlite::write_json(lapply(seq_len(nrow(live)), function(i)
    list(ressource = live$ressource[[i]], version = live$version[[i]])),
    chemin, auto_unbox = TRUE)
  chemin
}

plan_fixture_attributions <- function() {
  # Un code regression est fatal au build (ADR-0048 §4) : aucun artefact n'est
  # produit et il n'atteint jamais verif-attributions.json. Seules des derives
  # de donnees y figurent.
  list(
    list(type = "drift", source = "dpe_energy",
         message = "donnees : derive de dpe_energy depuis 2026-11-23"),
    list(type = "drift", source = "census_densite",
         message = "donnees : derive de census_densite depuis 2026-11-23"),
    # Entrees sur deux sources : aucune ressource n'a les DEUX dans son
    # lignage -> aucune attribution (regle du sous-ensemble complet).
    list(type = "drift", sources = list(list(source_id = "dpe_energy"),
                                        list(source_id = "profile_source")),
         message = "donnees : derive horizontale")
  )
}

plan_fixture_attributions_dir <- function(attributions) {
  dossier <- tempfile("plan-attributions-")
  dir.create(dossier)
  jsonlite::write_json(attributions, file.path(dossier, NOM_ATTRIBUTIONS),
                       auto_unbox = TRUE)
  dossier
}
