# Memoised structural reads of the targets graph (#1172).
# Dependency assertions inspect _targets.R, not a build. One manifest/network is
# therefore retained per effective graph environment and process. Caller-owned
# cache/output paths do not affect structure; this helper supplies isolated paths
# and an isolated network store so parallel tests never inspect real metadata.

if (!exists(".lusk_cache_graphe_structure", globalenv(), inherits = FALSE)) {
  assign(".lusk_cache_graphe_structure", new.env(parent = emptyenv()), globalenv())
}
if (!exists(".lusk_cache_imports_namespace", globalenv(), inherits = FALSE)) {
  assign(".lusk_cache_imports_namespace", new.env(parent = emptyenv()), globalenv())
}

# Enumerated by searching Sys.getenv("LUSK_ in _targets.R and pipeline/R/.
# LUSK_CACHE/LUSK_SORTIE are intentionally absent: structural reads replace both
# with isolated paths, so caller-owned temporary paths cannot affect the graph.
ENV_GRAPHE_STRUCTURE <- c(
  "LUSK_THEMES", "LUSK_MODE", "LUSK_SCALAR_SCOPE", "LUSK_PUBLISH_DB",
  "LUSK_PUBLISH_PROFILE", "LUSK_AEDAR_ADDRESS_ORIGINS", "LUSK_AEDAR_PUBLISH_PROGRESS",
  "LUSK_ARTEFACTS", "LUSK_PUBLICATION_RECEIPTS", "LUSK_PUBLISH_OWNED_SERIES",
  "LUSK_PUBLISH_SERIES", "LUSK_BRIDGE_LOCK_TIMEOUT_MS",
  "LUSK_BRIDGE_STATEMENT_TIMEOUT_MS", "LUSK_BRIDGE_TEST_CLEANUP",
  "LUSK_PUBLISH_PORT", "LUSK_AEDAR_CANONICAL_DIR", "LUSK_SOURCES_LOCK"
)

environnement_graphe_structure <- function() {
  defauts <- c(
    LUSK_THEMES = "", LUSK_MODE = "full", LUSK_SCALAR_SCOPE = "",
    LUSK_PUBLISH_DB = "", LUSK_PUBLISH_PROFILE = "",
    LUSK_AEDAR_ADDRESS_ORIGINS = "", LUSK_AEDAR_PUBLISH_PROGRESS = "",
    LUSK_ARTEFACTS = file.path("data", "artefacts"),
    LUSK_PUBLICATION_RECEIPTS = file.path(tempdir(), "lusk-publication-receipts"),
    LUSK_PUBLISH_OWNED_SERIES = "", LUSK_PUBLISH_SERIES = "",
    LUSK_BRIDGE_LOCK_TIMEOUT_MS = "5000",
    LUSK_BRIDGE_STATEMENT_TIMEOUT_MS = "120000", LUSK_BRIDGE_TEST_CLEANUP = "",
    LUSK_PUBLISH_PORT = "5432",
    LUSK_AEDAR_CANONICAL_DIR = file.path("data", "processed", "aedar"),
    LUSK_SOURCES_LOCK = ""
  )
  stats::setNames(lapply(ENV_GRAPHE_STRUCTURE, function(nom) {
    Sys.getenv(nom, unset = defauts[[nom]])
  }), ENV_GRAPHE_STRUCTURE)
}

entrees_graphe_structure <- function() {
  cible <- file.path(getwd(), "_targets.R")
  if (!file.exists(cible)) stop("_targets.R is required for a structural graph read")
  sources <- if (dir.exists("R")) {
    list.files("R", pattern = "\\.R$", full.names = TRUE)
  } else character()
  metadata <- if (dir.exists(file.path("inst", "extdata", "theme-metadata"))) {
    list.files(file.path("inst", "extdata", "theme-metadata"),
               pattern = "\\.json$", full.names = TRUE)
  } else character()
  fichiers <- c(cible, sources, metadata)
  stats::setNames(unname(tools::md5sum(fichiers)),
                  sub("^\\./", "", normalizePath(fichiers, winslash = "/",
                                                  mustWork = TRUE)))
}

entree_graphe_structure <- function() {
  description <- list(
    directory = normalizePath(getwd(), winslash = "/", mustWork = TRUE),
    environnement = environnement_graphe_structure(),
    entrees = entrees_graphe_structure()
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
        targets::tar_manifest(callr_function = NULL,
                              envir = new.env(parent = globalenv()))
      } else {
        reseau <- targets::tar_network(store = entree$chemins$store,
                                       callr_function = NULL,
                                       envir = new.env(parent = globalenv()))
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

# targets:::edges_envir() walks the whole loaded namespace. It is a structural
# fixture, not per-test work: retain both its edge table and simplified DAG for
# the namespace version in this R session.
cle_imports_namespace <- function(ns) {
  paste(getNamespaceName(ns), getNamespaceVersion(ns), sep = "\n")
}

aretes_imports_namespace <- function(ns = asNamespace("lusk"),
                                     cache = get(".lusk_cache_imports_namespace",
                                                 globalenv(), inherits = FALSE)) {
  slot <- paste("aretes", cle_imports_namespace(ns), sep = ":")
  if (!exists(slot, cache, inherits = FALSE)) {
    assign(slot, targets:::edges_envir(ns), cache)
  }
  get(slot, cache, inherits = FALSE)
}

graphe_imports_namespace <- function(ns = asNamespace("lusk"),
                                     cache = get(".lusk_cache_imports_namespace",
                                                 globalenv(), inherits = FALSE)) {
  slot <- paste("graphe", cle_imports_namespace(ns), sep = ":")
  if (!exists(slot, cache, inherits = FALSE)) {
    aretes <- aretes_imports_namespace(ns, cache = cache)
    assign(slot, igraph::simplify(igraph::graph_from_data_frame(aretes)), cache)
  }
  get(slot, cache, inherits = FALSE)
}
