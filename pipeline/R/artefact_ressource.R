# Artefact de ressource (ADR-0049, #1135) -------------------------------------
# Un Artefact de ressource est la sortie immuable et adressée par contenu d'UNE
# Ressource sémantique de service. Il vit sous <LUSK_ARTEFACTS>/<ressource>/<version>/
# (par défaut pipeline/data/artefacts, sous l'ACL de suppression de pipeline/data).
# Une version existante n'est JAMAIS réécrite : l'écriture d'un contenu identique
# est un no-op vérifié (manifest + empreintes + relecture + re-hachage).
# La Version de ressource publiée est le contenu haché par scalar_content_version().
#
# Ce module est purement local : aucune connexion à la base de service, aucun
# source_id de domaine écrit en dur, aucune suppression d'artefact.

ARTEFACTES_FICHIERS <- c(
  faits = "facts.rds",
  descripteur = "descriptor.rds",
  provenance = "provenance.rds",
  comparaison = "comparison.rds",
  digests_lignage = "lineage-digests.json",
  manifeste = "manifest.json"
)
# Le manifeste ne peut pas s'auto-hasher : seuls les grains de contenu sont
# checksummés ; le manifeste porte ces empreintes et son propre nom de fichier.
ARTEFACTES_GRAINS_HACHES <- ARTEFACTES_FICHIERS[setdiff(names(ARTEFACTES_FICHIERS), "manifeste")]

racine_artefacts <- function(root = NULL) {
  if (is.null(root)) {
    root <- Sys.getenv("LUSK_ARTEFACTS", unset = file.path("data", "artefacts"))
  }
  if (!is.character(root) || length(root) != 1L || is.na(root) || !nzchar(root))
    stop("Artefact store root is invalid", call. = FALSE)
  path.expand(root)
}

valider_identite_ressource <- function(ressource) {
  if (!is.character(ressource) || length(ressource) != 1L || is.na(ressource) ||
      !grepl("^[a-z][a-z0-9_]{0,95}$", ressource))
    stop("Ressource identity is invalid: expected a stable semantic resource id", call. = FALSE)
  invisible(ressource)
}

# Seul nom de la « Version de ressource publiée » dans ce slice : délégation
# explicite à scalar_content_version(), dont on garde la sémantique de hachage.
version_artefact <- function(contenu) {
  scalar_content_version(contenu)
}

# Version des FAITS d'une ressource (#1135 token rule) : descripteur + faits +
# provenance, comparaison exclue. UNE seule définition, partagée par le splitter
# (`scalar_content_version` de la comparaison), par le liage déclaré du profil
# enregistré à la construction et par `apply` (vérification de dépendance).
version_faits_artefact <- function(artefact) {
  if (!is.list(artefact) || !is.list(artefact$contenu))
    stop("Facts version requires an Artefact de ressource", call. = FALSE)
  contenu <- artefact$contenu
  version_artefact(contenu_artefact(contenu$faits, contenu$descriptor,
                                    contenu$provenance, NULL))
}

contenu_artefact <- function(faits, descripteur, provenance, comparaison = NULL) {
  list(faits = faits, descriptor = descripteur, provenance = provenance,
       comparison = comparaison)
}

# Les digests de lignage portent EXACTEMENT les source_id présents dans la
# provenance de la ressource (ADR-0048/0049 : le gel ne vérifie que la lignage).
# Un source_id sans empreinte dans source-digests.json est consigné comme absent
# (sha256 = NA, absent = TRUE) — jamais tu, jamais remplacé par une autre source.
# Le Plan de publication (#1136) s'appuie sur ces entrées explicites pour refuser
# une ressource dont le lignage ne peut être vérifié.
digests_lignage_ressource <- function(source_ids, digests = list()) {
  ids <- sort(unique(as.character(source_ids[!is.na(source_ids)])))
  if (!length(ids)) return(list())
  presents <- if (is.list(digests) && length(digests)) digests[names(digests) %in% ids] else list()
  manquants <- setdiff(ids, names(presents))
  for (id in manquants)
    presents[[id]] <- list(source_id = id, sha256 = NA_character_, absent = TRUE)
  presents[sort(names(presents))]
}

verifier_dossier_artefact <- function(dossier, ressource, forme, version) {
  manifest_path <- file.path(dossier, "manifest.json")
  if (!file.exists(manifest_path))
    stop("Artefact de ressource : manifest missing at ", dossier, call. = FALSE)
  manifest <- jsonlite::fromJSON(manifest_path, simplifyVector = FALSE)
  if (!identical(manifest$version, version) ||
      !identical(manifest$ressource, ressource) || !identical(manifest$forme, forme))
    stop("Artefact de ressource manifest disagrees with its address", call. = FALSE)
  noms <- unname(unlist(manifest$files))
  if (!identical(noms, unname(ARTEFACTES_GRAINS_HACHES)))
    stop("Artefact de ressource manifest has an undeclared file set", call. = FALSE)
  chemins <- stats::setNames(file.path(dossier, ARTEFACTES_GRAINS_HACHES),
                             names(ARTEFACTES_GRAINS_HACHES))
  if (any(!file.exists(chemins)))
    stop("Artefact de ressource is incomplete at ", dossier, call. = FALSE)
  hashes <- unname(unlist(manifest$hashes))
  if (!identical(hashes, unname(tools::md5sum(chemins))))
    stop("Artefact de ressource checksum mismatch at ", dossier, call. = FALSE)
  lire <- function(grain) {
    if (identical(grain, "digests_lignage")) {
      jsonlite::fromJSON(chemins[["digests_lignage"]], simplifyVector = FALSE)
    } else readRDS(chemins[[grain]])
  }
  contenu <- contenu_artefact(lire("faits"), lire("descripteur"),
    lire("provenance"), lire("comparaison"))
  if (!identical(version_artefact(contenu), version))
    stop("Artefact de ressource content no longer matches its version", call. = FALSE)
  list(contenu = contenu, digests_lignage = lire("digests_lignage"), manifest = manifest)
}

ecrire_artefact_ressource <- function(ressource, forme, contenu,
                                      digests_lignage = list(), root = NULL) {
  valider_identite_ressource(ressource)
  # Le registre des formes est l'unique source de vérité : aucune énumération
  # parallèle dans le magasin d'Artefacts de ressource.
  if (!is.character(forme) || length(forme) != 1L || is.na(forme) ||
      !forme %in% names(REGISTRE_FORMES_RESSOURCE))
    stop("Unknown resource shape: ", forme, call. = FALSE)
  if (!is.list(contenu) || !all(c("faits", "descriptor", "provenance") %in% names(contenu)))
    stop("Artefact de ressource content is missing a required grain", call. = FALSE)
  if (!is.list(digests_lignage)) stop("Lineage digests must be a named list", call. = FALSE)
  version <- version_artefact(contenu)
  dossier <- file.path(racine_artefacts(root), ressource, version)
  parent <- dirname(dossier)
  if (!dir.exists(parent)) dir.create(parent, recursive = TRUE, showWarnings = FALSE)
  if (dir.exists(dossier)) {
    verifier_dossier_artefact(dossier, ressource, forme, version)
    return(list(ressource = ressource, forme = forme, version = version,
                statut = "unchanged"))
  }
  stage <- tempfile(pattern = ".artefact-", tmpdir = parent)
  dir.create(stage, recursive = FALSE)
  installe <- FALSE
  on.exit(if (!installe && dir.exists(stage)) unlink(stage, recursive = TRUE), add = TRUE)
  saveRDS(contenu$faits, file.path(stage, ARTEFACTES_FICHIERS[["faits"]]), version = 3)
  saveRDS(contenu$descriptor, file.path(stage, ARTEFACTES_FICHIERS[["descripteur"]]), version = 3)
  saveRDS(contenu$provenance, file.path(stage, ARTEFACTES_FICHIERS[["provenance"]]), version = 3)
  saveRDS(contenu$comparison, file.path(stage, ARTEFACTES_FICHIERS[["comparaison"]]), version = 3)
  jsonlite::write_json(digests_lignage,
    file.path(stage, ARTEFACTES_FICHIERS[["digests_lignage"]]),
    auto_unbox = TRUE, pretty = TRUE, na = "null", digits = 17)
  chemins <- stats::setNames(file.path(stage, ARTEFACTES_GRAINS_HACHES),
                             names(ARTEFACTES_GRAINS_HACHES))
  hashes <- stats::setNames(unname(tools::md5sum(chemins)), names(ARTEFACTES_GRAINS_HACHES))
  manifest <- list(version = version, ressource = ressource, forme = forme,
                   files = as.list(ARTEFACTES_GRAINS_HACHES), hashes = as.list(hashes))
  jsonlite::write_json(manifest, file.path(stage, ARTEFACTES_FICHIERS[["manifeste"]]),
    auto_unbox = TRUE, pretty = TRUE)
  # Valider les octets mis en scène par le même lecteur qui servira la lecture,
  # avant de rendre la version visible.
  verifier_dossier_artefact(stage, ressource, forme, version)
  if (!file.rename(stage, dossier)) {
    if (!dir.exists(dossier))
      stop("Could not install Artefact de ressource at ", dossier, call. = FALSE)
    verifier_dossier_artefact(dossier, ressource, forme, version)
    return(list(ressource = ressource, forme = forme, version = version,
                statut = "unchanged"))
  }
  installe <- TRUE
  verifier_dossier_artefact(dossier, ressource, forme, version)
  list(ressource = ressource, forme = forme, version = version, statut = "new")
}

lire_artefact_ressource <- function(ressource, version, root = NULL, forme = NULL) {
  valider_identite_ressource(ressource)
  dossier <- file.path(racine_artefacts(root), ressource, version)
  if (!dir.exists(dossier))
    stop("Artefact de ressource version is unavailable: ", ressource, "/", version, call. = FALSE)
  manifest <- jsonlite::fromJSON(file.path(dossier, "manifest.json"), simplifyVector = FALSE)
  # L'adresse demandée doit correspondre au manifeste : un artefact déplacé sous
  # une autre ressource/version ne peut pas être lu sous cette identité.
  if (!identical(manifest$ressource, ressource) || !identical(manifest$version, version))
    stop("Artefact de ressource manifest disagrees with the requested ressource/version",
      call. = FALSE)
  if (!is.null(forme) && !identical(manifest$forme, forme))
    stop("Artefact de ressource manifest disagrees with the requested shape", call. = FALSE)
  lu <- verifier_dossier_artefact(dossier, ressource, manifest$forme, version)
  c(list(ressource = ressource, version = version, forme = manifest$forme),
    lu[c("contenu", "digests_lignage", "manifest")])
}

lister_artefacts_ressource <- function(root = NULL, ressource = NULL) {
  racine <- racine_artefacts(root)
  vides <- data.frame(ressource = character(), forme = character(),
                      version = character(), chemin = character(), stringsAsFactors = FALSE)
  if (!dir.exists(racine)) return(vides)
  ressources <- if (is.null(ressource)) list.files(racine, full.names = FALSE) else as.character(ressource)
  lignes <- list()
  for (id in sort(ressources)) {
    dossier_ressource <- file.path(racine, id)
    if (!dir.exists(dossier_ressource)) next
    for (version in sort(list.files(dossier_ressource, full.names = FALSE))) {
      dossier <- file.path(dossier_ressource, version)
      manifest_path <- file.path(dossier, "manifest.json")
      if (!dir.exists(dossier) || !file.exists(manifest_path)) next
      manifest <- jsonlite::fromJSON(manifest_path, simplifyVector = FALSE)
      if (!identical(manifest$version, version) || !identical(manifest$ressource, id)) next
      lignes[[length(lignes) + 1L]] <- data.frame(ressource = id, forme = manifest$forme,
        version = version, chemin = dossier, stringsAsFactors = FALSE)
    }
  }
  if (!length(lignes)) return(vides)
  do.call(rbind, lignes)
}

# Sélecteur de rétention PUR (aucune écriture, aucune suppression) : chaque
# version publiée, plus le build non publié le plus récent par ressource.
selection_retention_artefacts <- function(builds, publiees) {
  colonnes <- c("ressource", "version", "built_at")
  if (!is.data.frame(builds) || !all(colonnes %in% names(builds)))
    stop("Retention selection requires resource/version/built_at builds", call. = FALSE)
  if (!is.data.frame(publiees) || !all(c("ressource", "version") %in% names(publiees)))
    stop("Retention selection requires resource/version published rows", call. = FALSE)
  cle <- function(x) paste(as.character(x$ressource), as.character(x$version), sep = "\r")
  pub <- unique(publiees[c("ressource", "version")])
  pub$ressource <- as.character(pub$ressource)
  pub$version <- as.character(pub$version)
  pub$raison <- rep("publiee", nrow(pub))
  candidats <- builds[!cle(builds) %in% cle(pub), , drop = FALSE]
  if (nrow(candidats)) {
    ordre <- order(as.character(candidats$ressource),
                   -as.numeric(candidats$built_at), as.character(candidats$version))
    candidats <- candidats[ordre, , drop = FALSE]
    derniers <- candidats[!duplicated(candidats$ressource), , drop = FALSE]
    derniers$raison <- rep("dernier_build_non_publie", nrow(derniers))
    pub <- rbind(pub, derniers[c("ressource", "version", "raison")])
  }
  pub <- unique(pub)
  rownames(pub) <- NULL
  retenues <- cle(pub)
  a_retirer <- builds[!cle(builds) %in% retenues, c("ressource", "version"), drop = FALSE]
  rownames(a_retirer) <- NULL
  list(conserver = pub, retirer = a_retirer)
}
