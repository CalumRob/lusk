# artefact_bpe_typequ ------------------------------------------------------------
# Référentiel partagé des 53 destinations BPE utilisées par la grille et la rampe
# legacy. Le profil d'accès publié est retiré; la nomenclature reste requise par
# les producteurs conservés jusqu'à leur disposition coordonnée.

BPE_TYPEQU_ARTEFACT_FICHIER <- "correspondances_TYPEQU.csv"
BPE_TYPEQU_COLONNES <- c("TYPEQU", "Libelle_TYPEQU", "Description")

# Contrat du registre fermé : codes uniques, labels renseignés et, si demandé,
# univers identique à celui du producteur appelant.
verifier_contrat_bpe_typequ <- function(table, codes_attendus = NULL) {
  if (!is.data.frame(table)) {
    stop("Correspondance BPE TYPEQU invalide — une table est attendue.", call. = FALSE)
  }
  manquantes <- setdiff(BPE_TYPEQU_COLONNES, names(table))
  if (length(manquantes)) {
    stop("Correspondance BPE TYPEQU invalide — colonne(s) manquante(s) : ",
         paste(manquantes, collapse = ", "), ".", call. = FALSE)
  }
  table <- table[BPE_TYPEQU_COLONNES]
  if (!nrow(table)) stop("Correspondance BPE TYPEQU invalide — aucune ligne.", call. = FALSE)
  if (any(is.na(table$TYPEQU) | !grepl("^[A-Z][0-9]{3}$", table$TYPEQU))) {
    stop("Correspondance BPE TYPEQU invalide — un code TYPEQU est hors format.", call. = FALSE)
  }
  if (anyDuplicated(table$TYPEQU)) {
    stop("Correspondance BPE TYPEQU invalide — les codes doivent être uniques.", call. = FALSE)
  }
  for (col in c("Libelle_TYPEQU", "Description")) {
    if (any(is.na(table[[col]]) | !nzchar(trimws(table[[col]])))) {
      stop("Correspondance BPE TYPEQU invalide — la colonne « ", col,
           " » contient une valeur vide.", call. = FALSE)
    }
  }
  if (!is.null(codes_attendus) &&
      !setequal(table$TYPEQU, as.character(codes_attendus))) {
    stop("Correspondance BPE TYPEQU invalide — l'univers du registre ne correspond",
         " pas aux codes du snapshot.", call. = FALSE)
  }
  invisible(table)
}

# Lit le CSV épinglé en conservant les codes et libellés comme chaînes.
lire_correspondances_typequ <- function(chemin = NULL) {
  if (is.null(chemin)) {
    chemin <- system.file("extdata", BPE_TYPEQU_ARTEFACT_FICHIER, package = "lusk")
  }
  if (is.na(chemin) || !nzchar(chemin) || !file.exists(chemin)) {
    stop("Correspondance BPE TYPEQU introuvable : ", BPE_TYPEQU_ARTEFACT_FICHIER,
         ".", call. = FALSE)
  }
  table <- readr::read_csv(
    chemin,
    col_types = readr::cols(.default = readr::col_character()),
    show_col_types = FALSE,
    progress = FALSE
  )
  verifier_contrat_bpe_typequ(table)
  table
}
