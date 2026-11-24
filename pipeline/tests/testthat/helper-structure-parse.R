# Shared source-aware parse cache for structural audits (#1172).
# Each R file is parsed once per content version and process. Every audit walks
# the same getParseData() table; comments and strings cannot become call sites.

if (!exists(".lusk_cache_structure_parse", globalenv(), inherits = FALSE)) {
  assign(".lusk_cache_structure_parse", new.env(parent = emptyenv()), globalenv())
}

fichiers_structure <- function(racine, sous = c("R", "scripts"), motif = NULL) {
  fichiers <- list.files(racine, pattern = "\\.R$", full.names = TRUE,
                         recursive = TRUE)
  fichiers <- fichiers[grepl(paste0("/(", paste(sous, collapse = "|"),
                                     ")/[^/]+\\.R$"), fichiers)]
  if (!is.null(motif)) {
    fichiers <- fichiers[vapply(fichiers, function(f) {
      any(grepl(motif, readLines(f, warn = FALSE, encoding = "UTF-8")))
    }, logical(1))]
  }
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
  if (is.null(donnees) || !nrow(donnees)) {
    valeur$index_enfants <- list()
    valeur$index_parent <- integer()
  } else {
    index <- split(seq_len(nrow(donnees)), as.character(donnees$parent))
    valeur$index_enfants <- lapply(index, function(lignes) {
      lignes[order(donnees$line1[lignes], donnees$col1[lignes], donnees$id[lignes])]
    })
    valeur$index_parent <- stats::setNames(donnees$parent, as.character(donnees$id))
  }
  valeur$index_ancetres <- new.env(parent = emptyenv())
  valeur$appels <- appels_structure(valeur)
  assign(cle, valeur, cache)
  valeur
}

enfants_parse <- function(id, source) {
  lignes <- source$index_enfants[[as.character(id)]]
  if (is.null(lignes)) return(source$donnees[FALSE, , drop = FALSE])
  source$donnees[lignes, , drop = FALSE]
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
  ids <- integer(nrow(noeuds)); fonctions <- character(nrow(noeuds))
  packages <- character(nrow(noeuds)); lignes <- integer(nrow(noeuds))
  colonnes <- integer(nrow(noeuds)); fins <- integer(nrow(noeuds))
  parents <- integer(nrow(noeuds)); n <- 0L
  for (i in seq_len(nrow(noeuds))) {
    id <- noeuds$id[[i]]
    enfants <- source$index_enfants[[as.character(id)]]
    if (is.null(enfants) || length(enfants) < 2L) next
    if (!any(donnees$terminal[enfants] & donnees$text[enfants] == "(")) next
    appelee <- enfants[[1L]]
    package <- NA_character_
    if (donnees$terminal[[appelee]]) {
      fonction <- donnees$text[[appelee]]
    } else {
      signature <- source$index_enfants[[as.character(donnees$id[[appelee]])]]
      if (is.null(signature)) next
      operateur <- which(donnees$terminal[signature] & donnees$text[signature] == "::")
      if (length(operateur) == 1L && operateur > 1L &&
          operateur < length(signature)) {
        package <- donnees$text[[signature[[operateur - 1L]]]]
        fonction <- donnees$text[[signature[[operateur + 1L]]]]
      } else if (length(signature) == 1L && donnees$terminal[[signature]]) {
        fonction <- donnees$text[[signature]]
      } else {
        next
      }
    }
    if (!nzchar(fonction) || fonction %in% c("(", "{", "[")) next
    n <- n + 1L
    ids[[n]] <- id; fonctions[[n]] <- fonction; packages[[n]] <- package
    lignes[[n]] <- noeuds$line1[[i]]; colonnes[[n]] <- noeuds$col1[[i]]
    fins[[n]] <- noeuds$line2[[i]]; parents[[n]] <- noeuds$parent[[i]]
  }
  if (!n) return(vide)
  data.frame(
    id = ids[seq_len(n)], fonction = fonctions[seq_len(n)],
    package = packages[seq_len(n)], line1 = lignes[seq_len(n)],
    col1 = colonnes[seq_len(n)], line2 = fins[seq_len(n)],
    col2 = noeuds$col2[match(ids[seq_len(n)], noeuds$id)],
    parent = parents[seq_len(n)], stringsAsFactors = FALSE
  )
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
  data.frame(
    id = noeuds$id, fonction = noeuds$text, package = NA_character_,
    line1 = noeuds$line1, col1 = noeuds$col1, line2 = noeuds$line2,
    col2 = noeuds$col2, parent = noeuds$parent, stringsAsFactors = FALSE
  )
}

ancetres_noeud <- function(id, source) {
  cle <- as.character(id)
  if (exists(cle, source$index_ancetres, inherits = FALSE)) {
    return(get(cle, source$index_ancetres, inherits = FALSE))
  }
  parent <- source$index_parent[[cle]]
  ancetres <- integer()
  while (!is.na(parent) && parent > 0L) {
    ancetres <- c(ancetres, parent)
    parent <- source$index_parent[[as.character(parent)]]
  }
  assign(cle, ancetres, source$index_ancetres)
  ancetres
}

references_do_call <- function(source, noms) {
  references <- references_structure(source, noms)
  references[vapply(references$id, function(id) {
    ancetres <- appels_ancetres(id, source)
    do_call <- ancetres[ancetres$fonction == "do.call", , drop = FALSE]
    if (!nrow(do_call)) return(FALSE)
    any(vapply(do_call$id, function(appel_id) {
      argument <- premier_argument_appel(appel_id, source)
      !is.na(argument) && appel_descendant_de(id, argument, source)
    }, logical(1)))
  }, logical(1)), , drop = FALSE]
}

liste_arguments_do_call <- function(id, source) {
  arguments <- arguments_appel(id, source)
  if (nrow(arguments) < 2L) return(arguments[FALSE, , drop = FALSE])
  liste <- arguments$id[[2L]]
  appels <- appels_structure(source)
  if (!identical(appels$fonction[match(liste, appels$id)], "list")) {
    return(arguments[FALSE, , drop = FALSE])
  }
  arguments_appel(liste, source)
}

appel_descendant_de <- function(id, ancetre, source) {
  identical(id, ancetre) || ancetre %in% ancetres_noeud(id, source)
}

appels_ancetres <- function(id, source) {
  appels <- appels_structure(source)
  ancetres <- intersect(ancetres_noeud(id, source), appels$id)
  appels[match(ancetres, appels$id), , drop = FALSE]
}

appel_avant <- function(a, b) {
  a$line1[[1L]] < b$line1[[1L]] ||
    (a$line1[[1L]] == b$line1[[1L]] && a$col1[[1L]] < b$col1[[1L]])
}

arguments_appel <- function(id, source) {
  enfants <- enfants_parse(id, source)
  # The first child is the callee (a symbol or a namespaced `::` expression);
  # punctuation and the remaining expression children are not arguments.
  if (nrow(enfants) < 2L) return(enfants[FALSE, , drop = FALSE])
  enfants <- enfants[-1L, , drop = FALSE]
  enfants[!enfants$terminal & enfants$text == "", , drop = FALSE]
}

argument_nomme <- function(id, nom, source) {
  enfants <- enfants_parse(id, source)
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
