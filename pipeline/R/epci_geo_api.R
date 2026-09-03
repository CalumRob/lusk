# epci_geo_api -----------------------------------------------------------------
# Le nom public d'un EPCI vient du champ `nom` de l'API Découpage administratif
# de geo.api.gouv.fr. La table est épinglée dans inst/extdata : le pipeline ne
# dépend jamais d'un appel réseau pour construire un payload reproductible.

EPCI_GEO_API_ENDPOINT <- paste0(
  "https://geo.api.gouv.fr/epcis?codeRegion=53&fields=nom,code,type"
)
EPCI_GEO_API_FICHIER <- "epci_geo_api.json"

# valider_noms_epci_geo_api -----------------------------------------------------
# Le seam de validation du canon : les codes attendus viennent des lignes EPCI
# construites depuis la base INSEE ; le mapping épinglé doit les couvrir une fois
# chacun, sans ajouter d'EPCI étranger au référentiel.
valider_noms_epci_geo_api <- function(noms, codes_attendus) {
  if (!is.character(noms) || is.null(names(noms))) {
    stop("Mapping Geo API invalide : les noms doivent être un vecteur nommé.",
         call. = FALSE)
  }

  codes <- as.character(names(noms))
  attendus <- unique(as.character(codes_attendus))
  doublons <- unique(codes[duplicated(codes)])
  if (length(doublons) > 0) {
    stop("Mapping Geo API invalide : code(s) en doublon : ",
         paste(doublons, collapse = ", "), ".", call. = FALSE)
  }

  manquants <- setdiff(attendus, codes)
  if (length(manquants) > 0) {
    stop("Mapping Geo API invalide : EPCI attendu(s) absent(s) : ",
         paste(manquants, collapse = ", "), ".", call. = FALSE)
  }

  inattendus <- setdiff(codes, attendus)
  if (length(inattendus) > 0) {
    stop("Mapping Geo API invalide : code(s) inattendu(s) : ",
         paste(inattendus, collapse = ", "), ".", call. = FALSE)
  }

  vides <- codes[is.na(noms) | !nzchar(trimws(noms))]
  if (length(vides) > 0) {
    stop("Mapping Geo API invalide : nom(s) vide(s) pour : ",
         paste(vides, collapse = ", "), ".", call. = FALSE)
  }

  invisible(TRUE)
}

# appliquer_noms_epci_geo_api ---------------------------------------------------
# Remplace le nom interne des seules lignes EPCI. Les communes gardent leur
# LIBGEO ; les agrégats département/région gardent leur nom propre.
appliquer_noms_epci_geo_api <- function(territoires, noms) {
  est_epci <- territoires$type == "epci"
  codes <- as.character(territoires$code[est_epci])
  valider_noms_epci_geo_api(noms, codes)

  territoires$nom[est_epci] <- unname(noms[codes])
  territoires
}

# lire_noms_epci_geo_api --------------------------------------------------------
# Lit le snapshot JSON versionné du package et expose un vecteur nommé, pratique
# à injecter dans le constructeur de référence. Le snapshot conserve aussi le
# endpoint, la date de récupération et le type retourné par Geo API pour rester
# auditable sans faire entrer ces métadonnées dans territoires.nom.
lire_noms_epci_geo_api <- function(chemin = NULL) {
  if (is.null(chemin)) {
    chemin <- system.file("extdata", EPCI_GEO_API_FICHIER, package = "lusk")
  }
  if (!nzchar(chemin) || !file.exists(chemin)) {
    stop("Snapshot Geo API introuvable : ", chemin, ".", call. = FALSE)
  }

  snapshot <- jsonlite::fromJSON(chemin, simplifyVector = TRUE)
  if (!is.list(snapshot) || is.null(snapshot$labels) ||
      !is.data.frame(snapshot$labels)) {
    stop("Snapshot Geo API invalide : la liste « labels » est absente.",
         call. = FALSE)
  }
  if (!identical(as.character(snapshot$endpoint), EPCI_GEO_API_ENDPOINT)) {
    stop("Snapshot Geo API invalide : endpoint inattendu.", call. = FALSE)
  }
  if (!is.character(snapshot$retrieved_at) ||
      length(snapshot$retrieved_at) != 1L ||
      !grepl("^\\d{4}-\\d{2}-\\d{2}$", snapshot$retrieved_at)) {
    stop("Snapshot Geo API invalide : date de récupération absente ou invalide.",
         call. = FALSE)
  }

  labels <- snapshot$labels
  requis <- c("code", "nom", "type")
  manquantes <- setdiff(requis, names(labels))
  if (length(manquantes) > 0) {
    stop("Snapshot Geo API invalide : colonne(s) absente(s) : ",
         paste(manquantes, collapse = ", "), ".", call. = FALSE)
  }

  noms <- as.character(labels$nom)
  names(noms) <- as.character(labels$code)
  valider_noms_epci_geo_api(noms, names(noms))
  noms
}
