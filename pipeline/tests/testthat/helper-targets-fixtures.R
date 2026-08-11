# helper-targets-fixtures --------------------------------------------------------
# La machinerie des tests fixtures du port targets (#340, épique #329) : un
# mini-paquet toy (« toypkg ») et un mini-graphe autonome dans un répertoire
# temporaire — construits avec les MÊMES options que le graphe réel (imports,
# trust_timestamps, error), pour verrouiller la SÉMANTIQUE de skip et de
# rapport SANS les données réelles et SANS entrer dans le graphe du pipeline
# (US 15 — la porte CI reste la suite testthat).
#
# Le mini-paquet est chargé par pkgload::load_all (le workflow de dev, spike
# 07) ; entre deux scénarios on ÉDITE le source sur disque puis on recharge le
# namespace — le hash des imports (deparse(body) + dépendances transitives,
# hash_import_object.function) reflète le nouveau corps. Le mini-graphe est
# évalué EN SESSION (callr_function = NULL) — rapide et déterministe en CI ;
# la forme des commandes (appels directs aux fonctions du thème, jamais un nom
# de thème en dur) est celle du graphe réel.

# toypkg ------------------------------------------------------------------------
# Le mini-paquet : les mêmes pièces qu'un thème du pipeline — manifeste,
# download, construire (lit un fichier d'entrée), vintages, compute, publish,
# et le descripteur theme_toy() qui les assemble (le hub de dispatch, issue
# #13). Tout est exporté (exportPattern), comme un thème réel du paquet.

TOYPKG_DESCRIPTION <- c(
  "Package: toypkg",
  "Title: Toy",
  "Version: 0.0.1",
  'Authors@R: person("Toy", "Author", role = c("aut", "cre"))',
  "Description: Toy package for the targets fixtures (issue #340).",
  "License: MIT + file LICENSE",
  "Encoding: UTF-8"
)

# ecrire_source_toypkg ---------------------------------------------------------
# Écrit R/toy.R pour un scénario (base | compute-v2 | builder-v3 |
# compute-echec), puis recharge le namespace. Les scénarios changent UNE pièce
# à la fois — exactement les mutations que le spike 20/30/40 a démontrées.
ecrire_source_toypkg <- function(projet, scenario) {
  construire <- switch(
    scenario,
    base = "  data.frame(code = base$code, base = base$base, stringsAsFactors = FALSE)",
    builder_v3 = "  data.frame(code = base$code, base = base$base + 100L, stringsAsFactors = FALSE)",
    stop("scénario inconnu : ", scenario)
  )
  compute <- switch(
    scenario,
    base = "  brut$double <- brut$base * 2",
    compute_v2 = "  brut$double <- brut$base * 3",
    compute_echec = "  stop('compute exploded (scénario fixtures)')",
    stop("scénario inconnu : ", scenario)
  )
  src <- c(
    "download_fake <- function(manifest, cache = \"data/raw\", mode = c(\"full\", \"cron\")) {",
    "  mode <- match.arg(mode)",
    "  data.frame(id = manifest$id, mode = mode, status = \"frais\", stringsAsFactors = FALSE)",
    "}",
    "construire_fake <- function(cache = \"data/raw\") {",
    "  base <- read.csv(file.path(cache, \"entree.txt\"), stringsAsFactors = FALSE)",
    construire,
    "}",
    "compute_fake <- function(brut) {",
    compute,
    "  brut",
    "}",
    "publish_fake <- function(payload, sortie = \"out.txt\") {",
    "  writeLines(as.character(payload$double), sortie)",
    "  sortie",
    "}",
    "vintages_fake <- function() {",
    "  data.frame(id = \"a\", version = \"2023\", stringsAsFactors = FALSE)",
    "}",
    "# le descripteur du thème — le hub de dispatch (issue #13)",
    "theme_toy <- function() {",
    "  list(",
    "    theme = \"toy\",",
    "    manifest = data.frame(",
    "      id = \"a\", fichier = \"entree.txt\", mode = \"cron\", type = \"fichier\",",
    "      url = \"https://example.invalid/a.txt\", stringsAsFactors = FALSE",
    "    ),",
    "    construire_donnees = construire_fake,",
    "    vintages = vintages_fake",
    "  )",
    "}"
  )
  writeLines(src, file.path(projet, "toypkg", "R", "toy.R"))
  recharger_toypkg(projet)
  invisible(projet)
}

# recharger_toypkg --------------------------------------------------------------
# Décharge puis recharge le namespace du mini-paquet : les imports de targets
# (hash_imports) sont recalculés au prochain tar_outdated()/tar_make() — le
# corps modifié est pris en compte.
recharger_toypkg <- function(projet) {
  if ("toypkg" %in% loadedNamespaces()) pkgload::unload("toypkg")
  pkgload::load_all(file.path(projet, "toypkg"), quiet = TRUE)
  invisible(projet)
}

# editer_fonction_toypkg --------------------------------------------------------
# Édite le source du mini-paquet (remplacement fixe, pas de regex — le motif
# contient des $) puis recharge. Retourne invisible.
editer_fonction_toypkg <- function(projet, motif, remplacement) {
  chemin <- file.path(projet, "toypkg", "R", "toy.R")
  src <- readLines(chemin, warn = FALSE)
  src <- sub(motif, remplacement, src, fixed = TRUE)
  writeLines(src, chemin)
  recharger_toypkg(projet)
  invisible(projet)
}

# ecrire_mini_graphe ------------------------------------------------------------
# Le mini-graphe : la même forme que le graphe réel — download (statuts) ->
# fichiers du cache (format = "file", fraîcheur par contenu) -> construire ->
# vintages -> compute -> publish, plus le rapport de run en target indépendant
# réestampillé à chaque run (tar_cue mode = "always"). Les commandes appellent
# les fonctions du thème PAR SYMBOLE (le suivi d'imports les hashe) ; le
# manifeste et les chemins sont des variables du script (hashées par valeur).
# `avec_rapport = FALSE` sert au test de skip qui n'a pas besoin du rapport.
ecrire_mini_graphe <- function(projet, avec_rapport = TRUE) {
  rapport <- c(
    '  tar_target(rapport_toy, { writeLines(format(Sys.time(), "%Y-%m-%dT%H:%M:%OS6Z", tz = "UTC"), ',
    'file.path(SORTIE_RUN, "rapport.txt")); file.path(SORTIE_RUN, "rapport.txt") }, ',
    'format = "file", cue = tar_cue(mode = "always"))'
  )
  lignes <- c(
    sprintf('pkgload::load_all("%s", quiet = TRUE)',
            gsub("\\\\", "/", file.path(projet, "toypkg"))),
    "library(targets)",
    'tar_option_set(imports = "toypkg", trust_timestamps = FALSE, error = "continue")',
    'CACHE_RUN <- "data/raw"',
    'MODE_RUN <- "full"',
    'SORTIE_RUN <- "out"',
    "manifeste <- theme_toy()$manifest",
    "list(",
    "  tar_target(sources_toy, download_fake(manifeste, cache = CACHE_RUN, mode = MODE_RUN)),",
    '  tar_target(fichiers_toy, { sources_toy; file.path(CACHE_RUN, manifeste$fichier) }, format = "file"),',
    "  tar_target(brut_toy, { fichiers_toy; construire_fake(cache = CACHE_RUN) }),",
    "  tar_target(vintages_toy, vintages_fake()),",
    "  tar_target(payload_toy, compute_fake(brut_toy)),"
  )
  if (avec_rapport) {
    lignes <- c(
      lignes,
      '  tar_target(publie_toy, publish_fake(payload_toy, file.path(SORTIE_RUN, "out.txt")), format = "file"),',
      rapport
    )
  } else {
    # pas de virgule finale — R évalue un argument vide en erreur
    lignes <- c(
      lignes,
      '  tar_target(publie_toy, publish_fake(payload_toy, file.path(SORTIE_RUN, "out.txt")), format = "file")'
    )
  }
  lignes <- c(lignes, ")")
  writeLines(lignes, file.path(projet, "_targets.R"))
  invisible(projet)
}

# installer_mini_projet ---------------------------------------------------------
# Crée un mini-projet targets autonome dans tempdir() : le mini-paquet
# (scénario base), le fichier d'entrée, le répertoire de sortie et le
# mini-graphe. Retourne le chemin du projet — le test se place dedans
# (withr::local_dir) : tar_make()/tar_outdated() y trouvent _targets.R et le
# store, sans jamais toucher au graphe ni au store du pipeline.
installer_mini_projet <- function(avec_rapport = TRUE) {
  projet <- tempfile("mini-graphe-")
  dir.create(file.path(projet, "toypkg", "R"), recursive = TRUE)
  dir.create(file.path(projet, "data", "raw"), recursive = TRUE)
  dir.create(file.path(projet, "out"), recursive = TRUE)

  writeLines(TOYPKG_DESCRIPTION, file.path(projet, "toypkg", "DESCRIPTION"))
  writeLines('exportPattern("^[^\\\\.]")', file.path(projet, "toypkg", "NAMESPACE"))
  writeLines(c("code,base", "a,1", "b,2", "c,3"),
             file.path(projet, "data", "raw", "entree.txt"))

  ecrire_source_toypkg(projet, "base")
  ecrire_mini_graphe(projet, avec_rapport = avec_rapport)
  projet
}

# lire_rapport ------------------------------------------------------------------
# Lit le rapport du mini-graphe (NULL s'il n'a jamais été écrit).
lire_rapport <- function(projet) {
  chemin <- file.path(projet, "out", "rapport.txt")
  if (!file.exists(chemin)) return(NULL)
  readLines(chemin, warn = FALSE)
}
