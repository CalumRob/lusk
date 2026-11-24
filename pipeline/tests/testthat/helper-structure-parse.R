# Shared source-aware parse cache for structural audits (#1172).
# Each R file is parsed once per content version and process. Every audit walks
# the same getParseData() table; comments and strings cannot become call sites.

if (!exists(".lusk_cache_structure_parse", globalenv(), inherits = FALSE)) {
  assign(".lusk_cache_structure_parse", new.env(parent = emptyenv()), globalenv())
}

fichiers_structure <- function(racine, sous = c("R", "scripts")) {
  fichiers <- list.files(racine, pattern = "\\.R$", full.names = TRUE,
                         recursive = TRUE)
  fichiers <- fichiers[grepl(paste0("/(", paste(sous, collapse = "|"),
                                     ")/[^/]+\\.R$"), fichiers)]
  fichiers
}

source_structure <- function(fichier) {
  canonique <- normalizePath(fichier, winslash = "/", mustWork = TRUE)
  empreinte <- unname(tools::md5sum(fichier))
  cle <- paste0(canonique, "\n", empreinte)
  cache <- get(".lusk_cache_structure_parse", globalenv(), inherits = FALSE)
  if (exists(cle, cache, inherits = FALSE)) return(get(cle, cache, inherits = FALSE))

  lignes <- readLines(fichier, warn = FALSE, encoding = "UTF-8")
  expressions <- parse(file = fichier, keep.source = TRUE)
  donnees <- utils::getParseData(expressions)
  valeur <- list(lignes = lignes, expressions = expressions, donnees = donnees)
  valeur$appels <- appels_structure(valeur)
  assign(cle, valeur, cache)
  valeur
}

enfants_parse <- function(id, donnees) {
  lignes <- donnees[donnees$parent == id, , drop = FALSE]
  lignes[order(lignes$line1, lignes$col1, lignes$id), , drop = FALSE]
}

noeud_texte <- function(id, source) {
  if (is.null(source$donnees) || !nrow(source$donnees)) return("")
  noeud <- source$donnees[match(id, source$donnees$id), , drop = FALSE]
  if (!nrow(noeud)) return("")
  lignes <- source$lignes
  debut <- noeud$line1[[1L]]
  fin <- noeud$line2[[1L]]
  if (debut == fin) {
    substr(lignes[[debut]], noeud$col1[[1L]], noeud$col2[[1L]])
  } else {
    morceaux <- lignes[debut:fin]
    morceaux[[1L]] <- substring(morceaux[[1L]], noeud$col1[[1L]])
    morceaux[[length(morceaux)]] <- substring(
      morceaux[[length(morceaux)]], 1L, noeud$col2[[1L]])
    paste(morceaux, collapse = "\n")
  }
}

appel_ligne <- function(appel, source) {
  trimws(source$lignes[[appel$line1[[1L]]]])
}

appel_texte <- function(appel, source) {
  gsub("\\s+", " ", trimws(noeud_texte(appel$id, source)))
}

appels_structure <- function(source) {
  if (!is.null(source$appels)) return(source$appels)
  donnees <- source$donnees
  vide <- data.frame(id = integer(), fonction = character(), package = character(),
                     line1 = integer(), col1 = integer(), line2 = integer(),
                     col2 = integer(), parent = integer(),
                     stringsAsFactors = FALSE)
  if (is.null(donnees) || !nrow(donnees)) return(vide)

  noeuds <- donnees[!donnees$terminal & donnees$text == "", , drop = FALSE]
  appels <- vector("list", nrow(noeuds))
  n <- 0L
  for (i in seq_len(nrow(noeuds))) {
    id <- noeuds$id[[i]]
    enfants <- enfants_parse(id, donnees)
    if (!any(enfants$terminal & enfants$text == "(")) next
    if (!nrow(enfants)) next
    appelee <- enfants[1L, , drop = FALSE]
    package <- NA_character_
    if (appelee$terminal) {
      fonction <- appelee$text
    } else {
      signature <- enfants_parse(appelee$id, donnees)
      operateur <- which(signature$terminal & signature$text == "::")
      if (length(operateur) == 1L && operateur > 1L &&
          operateur < nrow(signature)) {
        package <- signature$text[[operateur - 1L]]
        fonction <- signature$text[[operateur + 1L]]
      } else if (nrow(signature) == 1L && signature$terminal[[1L]]) {
        fonction <- signature$text[[1L]]
      } else {
        next
      }
    }
    if (!nzchar(fonction) || fonction %in% c("(", "{", "[")) next
    n <- n + 1L
    appels[[n]] <- data.frame(
      id = id, fonction = fonction, package = package,
      line1 = noeuds$line1[[i]], col1 = noeuds$col1[[i]],
      line2 = noeuds$line2[[i]], col2 = noeuds$col2[[i]],
      parent = noeuds$parent[[i]], stringsAsFactors = FALSE
    )
  }
  if (!n) return(vide)
  do.call(rbind, appels[seq_len(n)])
}

references_structure <- function(source, noms) {
  donnees <- source$donnees
  vide <- data.frame(id = integer(), fonction = character(), package = character(),
                     line1 = integer(), col1 = integer(), line2 = integer(),
                     col2 = integer(), parent = integer(),
                     stringsAsFactors = FALSE)
  if (is.null(donnees)) return(vide)
  noeuds <- donnees[donnees$terminal & donnees$text %in% noms, , drop = FALSE]
  if (!nrow(noeuds)) return(vide)
  noeuds$fonction <- noeuds$text
  noeuds$package <- NA_character_
  noeuds
}

appel_descendant_de <- function(id, ancetre, source) {
  if (identical(id, ancetre)) return(TRUE)
  donnees <- source$donnees
  parent <- donnees$parent[match(id, donnees$id)]
  while (!is.na(parent) && parent > 0L) {
    if (identical(parent, ancetre)) return(TRUE)
    parent <- donnees$parent[match(parent, donnees$id)]
  }
  FALSE
}

appels_ancetres <- function(id, source) {
  appels <- appels_structure(source)
  ancetres <- integer()
  donnees <- source$donnees
  parent <- donnees$parent[match(id, donnees$id)]
  while (!is.na(parent) && parent > 0L) {
    if (parent %in% appels$id) ancetres <- c(ancetres, parent)
    parent <- donnees$parent[match(parent, donnees$id)]
  }
  appels[match(ancetres, appels$id), , drop = FALSE]
}

appel_avant <- function(a, b) {
  a$line1[[1L]] < b$line1[[1L]] ||
    (a$line1[[1L]] == b$line1[[1L]] && a$col1[[1L]] < b$col1[[1L]])
}

arguments_appel <- function(id, source) {
  enfants <- enfants_parse(id, source$donnees)
  # The first child is the callee (a symbol or a namespaced `::` expression);
  # punctuation and the remaining expression children are not arguments.
  if (nrow(enfants) < 2L) return(enfants[FALSE, , drop = FALSE])
  enfants <- enfants[-1L, , drop = FALSE]
  enfants[!enfants$terminal & enfants$text == "", , drop = FALSE]
}

argument_nomme <- function(id, nom, source) {
  enfants <- enfants_parse(id, source$donnees)
  egaux <- which(enfants$terminal & enfants$text == "=")
  for (j in egaux) {
    if (j < 2L || !enfants$terminal[[j - 1L]] ||
        !identical(enfants$text[[j - 1L]], nom)) next
    if (j == nrow(enfants)) next
    valeur <- enfants[j + 1L, , drop = FALSE]
    if (!nrow(valeur) || valeur$terminal[[1L]]) next
    return(valeur$id[[1L]])
  }
  NA_integer_
}

premier_argument_appel <- function(id, source) {
  arguments <- arguments_appel(id, source)
  if (!nrow(arguments)) return(NA_integer_)
  arguments$id[[1L]]
}
