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
