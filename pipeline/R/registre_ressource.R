# Registre de publication et reçus (ADR-0049 step 2, #1137) -------------------
# Le registre `resource_publication` est la SEULE réponse à « qu'est-ce qui est
# en direct ». Le lecteur ci-dessous remplace le listing injecté LUSK_LIVE_LISTING
# comme source vive du Plan de publication : il lit une CONNEXION DÉJÀ OUVERTE
# (fournie par `apply`, le seul code qui ouvre une connexion de service). Le
# listing fichier reste une option hors-ligne explicite dans plan_publication().
#
# Aucun de ces helpers n'ouvre de connexion : ils reçoivent `con`.

# Lecture du registre -> data.frame(ressource, version, forme, retired) tel que
# plan_publication() le consomme. Les lignes retired sont conservées avec leur
# version : ainsi un artefact retiré n'est pas reproposé par `plan` (sa version
# live égale la version construite) jusqu'à la cutover API de l'étape 4.
lire_registre_ressource <- function(con, ressource = NULL) {
  sql <- paste0("SELECT resource_id AS ressource, shape AS forme, ",
                "content_version AS version, retired FROM resource_publication")
  params <- NULL
  if (!is.null(ressource)) {
    sql <- paste0(sql, " WHERE resource_id = $1")
    params <- list(as.character(ressource)[[1L]])
  }
  sql <- paste0(sql, " ORDER BY resource_id")
  lignes <- if (is.null(params)) DBI::dbGetQuery(con, sql) else
    DBI::dbGetQuery(con, sql, params = params)
  if (!is.data.frame(lignes))
    lignes <- data.frame(ressource = character(), forme = character(),
                         version = character(), retired = logical(),
                         stringsAsFactors = FALSE)
  lignes$ressource <- as.character(lignes$ressource)
  lignes$forme <- as.character(lignes$forme)
  lignes$version <- as.character(lignes$version)
  lignes$retired <- as.logical(lignes$retired)
  rownames(lignes) <- NULL
  lignes
}

lire_listing_live_registre <- function(con) {
  registre <- lire_registre_ressource(con)
  registre[c("ressource", "version")]
}

# Version des FAITS vivants d'une ressource scalaire : le jeton
# `scalar_content_version` du marqueur de comparaison PAR RESSOURCE (#1137),
# qui est précisément la version des faits de cette ressource (#1135). Le token
# global `table_publication['scalar_observation']` n'est JAMAIS utilisé ici.
# NA_character_ si le marqueur n'existe pas (dépendance absente du vivant).
version_faits_live_ressource <- function(con, ressource) {
  valider_identite_ressource(ressource)
  ligne <- DBI::dbGetQuery(con, paste0(
    "SELECT scalar_content_version FROM scalar_resource_comparison_publication ",
    "WHERE indicator_id=$1"), params = list(as.character(ressource)[[1L]]))
  if (!is.data.frame(ligne) || !nrow(ligne) || is.na(ligne$scalar_content_version[[1L]]) ||
      !nzchar(as.character(ligne$scalar_content_version[[1L]])))
    return(NA_character_)
  as.character(ligne$scalar_content_version[[1L]])
}

# Upsert de la ligne de registre, DANS LA MÊME TRANSACTION que les lignes de
# l'adaptateur. `retired = TRUE` garde la version connue mais retire la
# ressource de l'ensemble vivant.
ecrire_registre_ressource <- function(con, ressource, forme, version,
                                      reference_content_version = NULL,
                                      retired = FALSE) {
  valider_identite_ressource(ressource)
  reference <- if (is.null(reference_content_version)) NA_character_ else
    as.character(reference_content_version)[[1L]]
  DBI::dbExecute(con, paste0(
    "INSERT INTO resource_publication(resource_id,shape,content_version,",
    "reference_content_version,published_at,retired) VALUES($1,$2,$3,$4,now(),$5) ",
    "ON CONFLICT(resource_id) DO UPDATE SET shape=EXCLUDED.shape, ",
    "content_version=EXCLUDED.content_version, ",
    "reference_content_version=EXCLUDED.reference_content_version, ",
    "published_at=EXCLUDED.published_at, retired=EXCLUDED.retired"),
    params = list(as.character(ressource), as.character(forme)[[1L]],
                  as.character(version)[[1L]], reference, isTRUE(retired)))
  invisible(TRUE)
}

# Reçu APPEND-ONLY dans la base ( INSERT seulement — aucun UPDATE/DELETE ).
ecrire_recette_ressource <- function(con, ressource, forme, operation,
                                     old_version = NULL, new_version = NULL,
                                     commit_sha = NULL,
                                     confirmed_definition = FALSE,
                                     lineage_digests = list()) {
  valider_identite_ressource(ressource)
  digests <- if (length(lineage_digests)) {
    jsonlite::toJSON(lineage_digests, auto_unbox = TRUE, digits = 17)
  } else jsonlite::toJSON(list(), auto_unbox = TRUE)
  DBI::dbExecute(con, paste0(
    "INSERT INTO resource_publication_event(resource_id,shape,operation,",
    "old_content_version,new_content_version,commit_sha,recorded_at,",
    "confirmed_definition,lineage_digests) VALUES($1,$2,$3,$4,$5,$6,now(),$7,$8::jsonb)"),
    params = list(as.character(ressource), as.character(forme)[[1L]],
                  as.character(operation)[[1L]],
                  if (is.null(old_version)) NA_character_ else as.character(old_version)[[1L]],
                  if (is.null(new_version)) NA_character_ else as.character(new_version)[[1L]],
                  if (is.null(commit_sha)) NA_character_ else as.character(commit_sha)[[1L]],
                  isTRUE(confirmed_definition), as.character(digests)))
  invisible(TRUE)
}

# Répertoire des reçus JSON locaux : HORS DU DÉPÔT par défaut, configurable via
# LUSK_PUBLICATION_RECEIPTS (par ex. sous la racine des artefacts).
chemin_recettes_locales <- function(dir = NULL) {
  if (is.null(dir)) {
    dir <- Sys.getenv("LUSK_PUBLICATION_RECEIPTS",
                      unset = file.path(tempdir(), "lusk-publication-receipts"))
  }
  if (!is.character(dir) || length(dir) != 1L || is.na(dir) || !nzchar(dir))
    stop("Receipt directory is invalid", call. = FALSE)
  path.expand(dir)
}

# Déclaration de découverte publiée AVEC la Version de ressource publiée (#1140).
# L'API ne reçoit plus theme-metadata : elle intersecte le grammaire de forme
# embarqué dans l'image avec ces déclarations producteur et le registre vivant.
.repertoire_metadata_ressource <- function(metadata_directory = NULL) {
  if (is.null(metadata_directory))
    system.file("extdata", "theme-metadata", package = "lusk") else metadata_directory
}

.champ_nomme <- function(valeur, nom) {
  if (is.null(valeur) || is.null(valeur[[nom]])) NULL else
    stats::setNames(list(valeur[[nom]]), nom)
}

declaration_ressource_metadata <- function(ressource, metadata_directory = NULL) {
  valider_identite_ressource(ressource)
  repertoire <- .repertoire_metadata_ressource(metadata_directory)
  fichiers <- sort(list.files(repertoire, pattern = "^theme_.*\\.json$", full.names = TRUE))
  for (chemin in fichiers) {
    metadata <- jsonlite::fromJSON(chemin, simplifyVector = FALSE)
    ids <- as.character(unlist(metadata$indicator_keys, use.names = FALSE))
    if (!ressource %in% ids) next

    aliases <- list()
    for (proprietaire in names(metadata$owned_series_routes %||% list())) {
      route <- metadata$owned_series_routes[[proprietaire]]
      if (isTRUE(route$reference_read_route) && !is.null(route$reference_indicator))
        aliases[[route$reference_indicator]] <- proprietaire
    }
    parent <- aliases[[ressource]]
    collection <- (metadata$observed_collection_contracts %||% list())[[ressource]]
    page <- (metadata$indicator_pages %||% list())[[ressource]] %||%
      if (!is.null(parent)) (metadata$indicator_pages %||% list())[[parent]] else NULL
    page <- page %||% collection
    source_id <- (metadata$sources %||% list())[[ressource]]
    source_keys <- unique(c(source_id, as.character(unlist(page$sources, use.names = FALSE))))
    source_keys <- source_keys[!is.na(source_keys) & nzchar(source_keys)]
    records <- metadata$source_records %||% list()
    source_records <- records[intersect(source_keys, names(records))]

    # Self-contained one-resource producer declaration. Optional empty maps are
    # omitted rather than emitted as JSON arrays where Python expects objects.
    declaration <- list(
      theme = metadata$theme,
      indicator_keys = list(ressource),
      sources = stats::setNames(list(source_id), ressource),
      source_records = source_records)
    declaration$indicator_pages <- if (!is.null(parent))
      .champ_nomme(metadata$indicator_pages, parent) else
      .champ_nomme(metadata$indicator_pages, ressource)
    if (is.null(declaration$indicator_pages) && !is.null(collection))
      declaration$indicator_pages <- stats::setNames(list(collection), ressource)
    for (nom in c("indicator_labels", "scalar_contracts", "profile_contracts",
                  "distribution_contracts", "observed_collection_contracts",
                  "detail_labels", "map_layers")) {
      valeur <- .champ_nomme(metadata[[nom]], ressource)
      if (!is.null(valeur)) declaration[[nom]] <- valeur
    }
    proprietaire <- if (!is.null(parent)) parent else ressource
    route <- .champ_nomme(metadata$owned_series_routes, proprietaire)
    if (!is.null(route)) declaration$owned_series_routes <- route
    return(declaration)
  }
  NULL
}

declarations_semantiques_publication <- function(publication_resource_id,
                                                 metadata_directory = NULL) {
  valider_identite_ressource(publication_resource_id)
  repertoire <- .repertoire_metadata_ressource(metadata_directory)
  chemin <- if (is.null(metadata_directory))
    system.file("extdata", "semantic-resource-contracts.json", package = "lusk") else
    file.path(dirname(repertoire), "semantic-resource-contracts.json")
  if (!nzchar(chemin) || !file.exists(chemin)) return(list())
  contrat <- jsonlite::fromJSON(chemin, simplifyVector = FALSE)
  ressources <- contrat$resources %||% list()
  noms <- vapply(ressources, `[[`, character(1), "resource_id")
  garder <- vapply(ressources, function(declaration)
    identical(declaration$publication_resource_id %||% declaration$resource_id,
              publication_resource_id), logical(1))
  declarations <- ressources[garder]
  stats::setNames(lapply(declarations, function(declaration)
    list(kind = declaration$kind, declaration = declaration)), noms[garder])
}

declarations_decouverte_ressource <- function(ressource, metadata_directory = NULL) {
  indicateur <- declaration_ressource_metadata(ressource, metadata_directory)
  if (!is.null(indicateur))
    return(stats::setNames(list(list(kind = "indicator", metadata = indicateur)), ressource))
  declarations_semantiques_publication(ressource, metadata_directory)
}

attacher_declaration_ressource <- function(descripteur, ressource, metadata_directory = NULL) {
  declarations <- declarations_decouverte_ressource(ressource, metadata_directory)
  json <- jsonlite::toJSON(declarations, auto_unbox = TRUE, null = "null", digits = 17)
  if (is.data.frame(descripteur)) {
    if (!nrow(descripteur)) stop("Resource descriptor must carry at least one row", call. = FALSE)
    descripteur$discovery <- json
  } else if (is.list(descripteur)) {
    descripteur$discovery <- json
  } else {
    stop("Resource descriptor is invalid", call. = FALSE)
  }
  descripteur
}

extraire_declaration_ressource <- function(descripteur) {
  ligne <- if (is.data.frame(descripteur)) as.list(descripteur[1L, , drop = FALSE]) else descripteur
  json <- ligne$discovery
  if (is.null(json) || !length(json) || is.na(json[[1L]])) return(list())
  if (length(json) != 1L || !is.character(json)) stop("Resource discovery declaration is invalid", call. = FALSE)
  jsonlite::fromJSON(json, simplifyVector = FALSE)
}

ecrire_descripteurs_ressource <- function(con, publication_resource_id, version,
                                          declarations = list()) {
  valider_identite_ressource(publication_resource_id)
  if (!is.character(version) || length(version) != 1L || is.na(version) || !nzchar(version))
    stop("Resource descriptor version is invalid", call. = FALSE)
  if (!is.list(declarations) || (length(declarations) && is.null(names(declarations))))
    stop("Resource discovery declarations must be named by semantic resource", call. = FALSE)
  DBI::dbExecute(con,
    "DELETE FROM resource_publication_descriptor WHERE publication_resource_id=$1",
    params = list(as.character(publication_resource_id)))
  for (ressource in names(declarations)) {
    valider_identite_ressource(ressource)
    json <- jsonlite::toJSON(declarations[[ressource]], auto_unbox = TRUE,
      null = "null", digits = 17)
    DBI::dbExecute(con, paste0(
      "INSERT INTO resource_publication_descriptor(resource_id,publication_resource_id,",
      "content_version,descriptor) VALUES($1,$2,$3,$4::jsonb)"),
      params = list(as.character(ressource), as.character(publication_resource_id),
                    as.character(version), as.character(json)))
  }
  invisible(TRUE)
}

# Copie JSON locale, écrite APRÈS LE COMMIT par apply (jamais dans la transaction).
ecrire_recette_locale <- function(recette, dir = NULL) {
  dossier <- chemin_recettes_locales(dir)
  if (!dir.exists(dossier)) dir.create(dossier, recursive = TRUE, showWarnings = FALSE)
  horodatage <- format(Sys.time(), "%Y%m%dT%H%M%OS3", tz = "UTC")
  nom <- sprintf("recette-%s-%s-%s.json", recette$ressource,
                 substr(recette$operation, 1L, 5L), horodatage)
  chemin <- file.path(dossier, nom)
  jsonlite::write_json(recette, chemin, auto_unbox = TRUE, pretty = TRUE,
                       na = "null", digits = 17)
  invisible(chemin)
}
