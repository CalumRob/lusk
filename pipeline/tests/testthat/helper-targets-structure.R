# Memoised structural reads of the targets graph (#1172).
# Dependency assertions inspect _targets.R, not a build. One manifest/network is
# therefore retained per effective graph environment and process. Caller-owned
# cache/output paths do not affect structure; this helper supplies isolated paths
# and an isolated network store so parallel tests never inspect real metadata.

if (!exists(".lusk_cache_graphe_structure", globalenv(), inherits = FALSE)) {
  assign(".lusk_cache_graphe_structure", new.env(parent = emptyenv()), globalenv())
}

environnement_graphe_structure <- function() {
  defauts <- c(LUSK_THEMES = "", LUSK_MODE = "full", LUSK_PUBLISH_DB = "",
               LUSK_PUBLISH_PROFILE = "", LUSK_SCALAR_SCOPE = "")
  stats::setNames(lapply(names(defauts), function(nom) {
    Sys.getenv(nom, unset = defauts[[nom]])
  }), names(defauts))
}

entree_graphe_structure <- function() {
  cible <- file.path(getwd(), "_targets.R")
  if (!file.exists(cible)) stop("_targets.R is required for a structural graph read")
  description <- list(
    directory = normalizePath(getwd(), winslash = "/", mustWork = TRUE),
    environnement = environnement_graphe_structure(),
    cible = unname(tools::md5sum(cible))
  )
  cle <- as.character(openssl::md5(serialize(description, NULL, version = 2L)))
  cache <- get(".lusk_cache_graphe_structure", globalenv(), inherits = FALSE)
  if (!exists(cle, cache, inherits = FALSE)) {
    assign(cle, list(
      cache = tempfile("cache-graphe-structure-"),
      sortie = tempfile("sortie-graphe-structure-"),
      store = tempfile("graphe-structure-")
    ), cache)
  }
  list(cle = cle, environnement = description$environnement,
       chemins = get(cle, cache, inherits = FALSE))
}

avec_environnement_graphe_structure <- function(entree, code) {
  variables <- c(as.list(entree$environnement),
                 list(LUSK_CACHE = entree$chemins$cache,
                      LUSK_SORTIE = entree$chemins$sortie))
  do.call(withr::local_envvar, variables)
  # _targets.R reloads the already-loaded package for standalone builds. A
  # structural read needs its functions, not that namespace-changing side effect;
  # suppressing it lets targets evaluate in-process without polluting test mocks.
  testthat::local_mocked_bindings(load_all = function(...) invisible(NULL),
                                  .package = "pkgload")
  tar_option_set_original <- targets::tar_option_set
  noms_options <- setdiff(names(formals(tar_option_set_original)),
                          "trust_object_timestamps")
  options_precedentes <- lapply(noms_options, targets::tar_option_get)
  names(options_precedentes) <- noms_options
  on.exit({
    do.call(tar_option_set_original, options_precedentes)
    targets::tar_option_unset(noms_options[vapply(options_precedentes, is.null,
                                                  logical(1))])
  }, add = TRUE)
  force(code)
}

lire_graphe_structure <- function(kind) {
  entree <- entree_graphe_structure()
  slot <- paste(kind, entree$cle, sep = ":")
  cache <- get(".lusk_cache_graphe_structure", globalenv(), inherits = FALSE)
  if (!exists(slot, cache, inherits = FALSE)) {
    valeur <- avec_environnement_graphe_structure(entree, tryCatch(
      if (identical(kind, "manifest")) {
        targets::tar_manifest(callr_function = NULL)
      } else {
        reseau <- targets::tar_network(store = entree$chemins$store,
                                       callr_function = NULL)
        attr(reseau, "store_structure") <- entree$chemins$store
        reseau
      },
      error = identity
    ))
    assign(slot, valeur, cache)
  }
  valeur <- get(slot, cache, inherits = FALSE)
  if (inherits(valeur, "error")) stop(valeur)
  valeur
}

manifeste_graphe <- function(noms = NULL) {
  manifeste <- lire_graphe_structure("manifest")
  if (is.null(noms)) return(manifeste)
  manifeste[manifeste$name %in% noms, , drop = FALSE]
}

reseau_graphe <- function() {
  lire_graphe_structure("reseau")
}
