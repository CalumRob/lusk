# modeles_lecture --------------------------------------------------------------
# Projections statiques destinées à une surface de lecture (ADR-0031). Les
# tables analytiques restent canoniques ; ce module sélectionne et ordonne leur
# sous-ensemble utile sans relire les anciennes projections JSON.

construire_modele_indicateur <- function(
    indicateurs,
    metadata,
    indicateur,
    snapshot_id) {
  if (!is.data.frame(indicateurs)) {
    stop("Modèle d'indicateur : `indicateurs` doit être une table.",
         call. = FALSE)
  }
  if (is.null(metadata$theme) || is.null(metadata$label) ||
      is.null(metadata$indicator_pages[[indicateur]])) {
    stop("Modèle d'indicateur : page `", indicateur,
         "` absente de la métadonnée.", call. = FALSE)
  }
  if (!is.character(snapshot_id) || length(snapshot_id) != 1L ||
      is.na(snapshot_id) || !nzchar(snapshot_id)) {
    stop("Modèle d'indicateur : `snapshot_id` doit être une chaîne non vide.",
         call. = FALSE)
  }

  page <- metadata$indicator_pages[[indicateur]]
  cle <- page$indicator
  niveaux <- unlist(page$levels, use.names = FALSE)
  sources_page <- unlist(page$sources, use.names = FALSE)
  sources <- metadata$source_records
  if (is.null(sources) || !all(sources_page %in% names(sources))) {
    stop("Modèle d'indicateur : source_records incomplets pour `", indicateur,
         "`.", call. = FALSE)
  }
  faits <- indicateurs[
    indicateurs$theme == metadata$theme &
      indicateurs$key == cle &
      indicateurs$type %in% niveaux,
    ,
    drop = FALSE
  ]

  # La sérialisation est stable quelle que soit l'ordre d'arrivée du canon.
  ordre_type <- match(faits$type,
                      c("commune", "epci", "departement", "region"))
  texte_ordre <- function(nom) {
    if (!nom %in% names(faits)) return(rep("", nrow(faits)))
    valeur <- as.character(faits[[nom]])
    valeur[is.na(valeur)] <- ""
    valeur
  }
  ordre <- order(
    ordre_type,
    texte_ordre("territoire"),
    texte_ordre("key"),
    texte_ordre("detail"),
    texte_ordre("sex"),
    texte_ordre("dimension")
  )
  faits <- faits[ordre, , drop = FALSE]
  rownames(faits) <- NULL

  libelles_details <- metadata$detail_labels[[cle]]
  if (is.null(libelles_details)) libelles_details <- setNames(list(), character())

  list(
    schema_version = "1",
    snapshot_id = snapshot_id,
    theme = metadata$theme,
    indicator = indicateur,
    theme_label = metadata$label,
    page = page,
    detail_labels = libelles_details,
    source_records = sources[sources_page],
    facts = faits
  )
}

# identifiant_snapshot ----------------------------------------------------------
# Un modèle porte l'horloge de la donnée, pas la date de génération du fichier.
# La date de référence la plus récente du jeu de vintages est déterministe et
# change dès qu'une source du run avance.
identifiant_snapshot <- function(vintages) {
  if (!is.data.frame(vintages) || !"date_reference" %in% names(vintages)) {
    stop("Modèle d'indicateur : les vintages doivent porter `date_reference`.",
         call. = FALSE)
  }
  dates <- as.Date(as.character(vintages$date_reference))
  dates <- dates[!is.na(dates)]
  if (length(dates) == 0L) {
    stop("Modèle d'indicateur : aucun vintage ne porte de date de référence.",
         call. = FALSE)
  }
  format(max(dates), "%Y-%m-%d")
}

# publier_modele_indicateur ----------------------------------------------------
# Écrit d'abord un voisin temporaire, puis le renomme : un serveur statique ne
# voit jamais un artefact tronqué pendant sa régénération.
publier_modele_indicateur <- function(modele, sortie = "public/data") {
  requis <- c("schema_version", "snapshot_id", "theme", "indicator", "facts")
  manquants <- setdiff(requis, names(modele))
  if (length(manquants) > 0L) {
    stop("Modèle d'indicateur : champ(s) manquant(s) : ",
         paste(manquants, collapse = ", "), ".", call. = FALSE)
  }
  composant_sur <- function(valeur) {
    is.character(valeur) && length(valeur) == 1L && !is.na(valeur) &&
      grepl("^[a-z0-9_-]+$", valeur)
  }
  if (!composant_sur(modele$theme) || !composant_sur(modele$indicator)) {
    stop("Modèle d'indicateur : thème ou indicateur impropre à un chemin.",
         call. = FALSE)
  }

  repertoire <- file.path(
    sortie, "modeles-lecture", "indicateurs", modele$theme
  )
  if (!dir.exists(repertoire)) dir.create(repertoire, recursive = TRUE)
  chemin <- file.path(repertoire, paste0(modele$indicator, ".json"))
  temporaire <- tempfile(
    paste0(".", modele$indicator, "-"), tmpdir = repertoire,
    fileext = ".json"
  )
  on.exit(if (file.exists(temporaire)) unlink(temporaire), add = TRUE)
  jsonlite::write_json(
    modele, temporaire,
    dataframe = "rows", na = "null", digits = 17, pretty = TRUE,
    auto_unbox = TRUE
  )
  if (file.exists(chemin)) unlink(chemin)
  if (!file.rename(temporaire, chemin)) {
    stop("Modèle d'indicateur : impossible de publier `", chemin, "`.",
         call. = FALSE)
  }
  chemin
}

# publier_modeles_lecture -------------------------------------------------------
# Le registre `read_model` vit dans la métadonnée de chaque page : la pipeline
# ne maintient donc pas une seconde liste d'indicateurs à publier.
publier_modeles_lecture <- function(payload, metadata, vintages,
                                    sortie = "public/data") {
  if (!is.list(payload) || !is.data.frame(payload$indicateurs)) {
    stop("Modèles d'indicateur : le payload doit porter sa table d'indicateurs.",
         call. = FALSE)
  }
  pages <- metadata$indicator_pages
  if (!is.list(pages) || is.null(names(pages))) {
    stop("Modèles d'indicateur : la métadonnée doit porter ses pages.",
         call. = FALSE)
  }
  a_publier <- names(pages)[vapply(
    pages,
    function(page) isTRUE(page$read_model),
    logical(1)
  )]
  if (length(a_publier) == 0L) return(character(0))

  snapshot_id <- identifiant_snapshot(vintages)
  vapply(a_publier, function(indicateur) {
    publier_modele_indicateur(
      construire_modele_indicateur(
        payload$indicateurs, metadata, indicateur, snapshot_id
      ),
      sortie = sortie
    )
  }, character(1))
}
