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
    "    vintages = vintages_fake,",
    "    compute = compute_fake,",
    "    publish = publish_fake",
    "  )",
    "}",
    "# Le SECOND thème du mini-paquet (issue #341) : un thème « futur » avec SES",
    "# propres pièces (construire_fake2, compute_fake2, ...) — câblé dans le",
    "# mini-graphe par la SEULE liste des descripteurs, zéro édit à la fabrique.",
    "# Les corps sont DISTINCTS de ceux de toy (base2, id \"b\") pour que les",
    "# éditions de fixture (sub, fixed = TRUE) ne touchent jamais qu'un thème.",
    "construire_fake2 <- function(cache = \"data/raw\") {",
    "  base <- read.csv(file.path(cache, \"entree2.txt\"), stringsAsFactors = FALSE)",
    "  data.frame(code = base$code, base2 = base$base, stringsAsFactors = FALSE)",
    "}",
    "compute_fake2 <- function(brut) {",
    "  brut$double <- brut$base2 * 7",
    "  brut",
    "}",
    "publish_fake2 <- function(payload, sortie = \"out.txt\") {",
    "  writeLines(c(\"toy2\", as.character(payload$double)), sortie)",
    "  sortie",
    "}",
    "vintages_fake2 <- function() {",
    "  data.frame(id = \"b\", version = \"2023\", stringsAsFactors = FALSE)",
    "}",
    "theme_toy2 <- function() {",
    "  list(",
    "    theme = \"toy2\",",
    "    manifest = data.frame(",
    "      id = \"b\", fichier = \"entree2.txt\", mode = \"cron\", type = \"fichier\",",
    "      url = \"https://example.invalid/b.txt\", stringsAsFactors = FALSE",
    "    ),",
    "    construire_donnees = construire_fake2,",
    "    vintages = vintages_fake2,",
    "    compute = compute_fake2,",
    "    publish = publish_fake2",
    "  )",
    "}",
    "# Le TROISIÈME thème du mini-paquet (revue #341, finding 5) : le thème",
    "# « jetable » — le SIXIÈME thème jetable du mini-graphe, SES propres pièces",
    "# (construire_fake_jetable, compute_fake_jetable, ...) et SON propre fichier",
    "# d'entrée (entree3.txt). La preuve « futur thème » EXÉCUTÉE : ajouter un",
    "# thème au mini-graphe = ajouter SES pièces au paquet, SON constructeur et",
    "# SA ligne dans la liste — la FABRIQUE (grappe_mini) ne change jamais.",
    "construire_fake_jetable <- function(cache = \"data/raw\") {",
    "  base <- read.csv(file.path(cache, \"entree3.txt\"), stringsAsFactors = FALSE)",
    "  data.frame(code = base$code, base3 = base$base, stringsAsFactors = FALSE)",
    "}",
    "compute_fake_jetable <- function(brut) {",
    "  brut$double <- brut$base3 * 11",
    "  brut",
    "}",
    "publish_fake_jetable <- function(payload, sortie = \"out.txt\") {",
    "  writeLines(c(\"jetable\", as.character(payload$double)), sortie)",
    "  sortie",
    "}",
    "vintages_fake_jetable <- function() {",
    "  data.frame(id = \"c\", version = \"2023\", stringsAsFactors = FALSE)",
    "}",
    "theme_jetable <- function() {",
    "  list(",
    "    theme = \"jetable\",",
    "    manifest = data.frame(",
    "      id = \"c\", fichier = \"entree3.txt\", mode = \"cron\", type = \"fichier\",",
    "      url = \"https://example.invalid/c.txt\", stringsAsFactors = FALSE",
    "    ),",
    "    construire_donnees = construire_fake_jetable,",
    "    vintages = vintages_fake_jetable,",
    "    compute = compute_fake_jetable,",
    "    publish = publish_fake_jetable",
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

# charger_pieces_graphe ---------------------------------------------------------
# Charge les fonctions de MÉCANIQUE de _targets.R (jamais le graphe entier)
# dans un environnement vierge : parse du fichier, sélection des définitions
# par nom (les affectations `nom <- function(...)`), évaluation dans un
# environnement dont le parent est baseenv. Ce sont les MÊMES fonctions que
# tar_make exécute à la construction, sans les effets de bord du script
# (pkgload::load_all, tar_option_set, le graphe évalué en tête de fichier).
# Défini dans le HELPER (et non dans un fichier de test) : les tests targets
# tournent dans des processus parallèles, un helper est sourcé par chacun.
charger_pieces_graphe <- function(noms) {
  arbres <- parse(file.path(pkgload::pkg_path(), "_targets.R"))
  defs <- arbres[vapply(arbres, function(a) {
    is.call(a) && identical(a[[1]], as.name("<-")) &&
      is.name(a[[2]]) && as.character(a[[2]]) %in% noms
  }, logical(1))]
  stopifnot("définitions introuvables dans _targets.R" = length(defs) == length(noms))
  env <- new.env(parent = baseenv())
  eval(defs, env)
  env
}

# ecrire_mini_graphe_multi ------------------------------------------------------
# Le mini-graphe PLURITHÈME (issue #341) : une FABRIQUE de grappe
# (grappe_mini) écrite DANS le _targets.R — la même mécanique que la vraie
# grappe_theme (noms par thème via paste0, pièces résolues par SYMBOLE dans le
# namespace du mini-paquet, jamais un nom de thème en dur) — appliquée à la
# LISTE des descripteurs. La propriété « futur thème » : ajouter un thème au
# mini-graphe = l'ajouter à la liste (et ses pièces au paquet) — la fabrique
# ne change pas. Les fichiers de sortie sont par thème (out_<theme>.txt) : le
# mini-graphe n'a pas les fichiers partagés du graphe réel (territoires.*,
# vintages.*, run-report.json) et donc pas leurs chaînes de sérialisation —
# la preuve porte sur la mécanique (descripteur -> grappe) et l'isolation du
# skip, jamais sur les artefacts partagés (prouvés par le graphe réel).
ecrire_mini_graphe_multi <- function(projet, themes = c("toy", "toy2")) {
  noms_themes <- paste0("theme_", themes, "()", collapse = ", ")
  lignes <- c(
    sprintf('pkgload::load_all("%s", quiet = TRUE)',
            gsub("\\\\", "/", file.path(projet, "toypkg"))),
    "library(targets)",
    'tar_option_set(imports = "toypkg", trust_timestamps = FALSE, error = "continue")',
    'CACHE_RUN <- "data/raw"',
    'MODE_RUN <- "full"',
    'SORTIE_RUN <- "out"',
    "# la fabrique de grappe — la même forme que grappe_theme du graphe réel :",
    "# une grappe par DESCRIPTEUR, les pièces appelées PAR SYMBOLE (le suivi",
    "# d'imports hashe leur corps), aucun nom de thème en dur.",
    "grappe_mini <- function(theme, cache = CACHE_RUN, sortie = SORTIE_RUN) {",
    "  nom <- theme$theme",
    '  ns <- asNamespace("toypkg")',
    "  trouver <- function(piece) {",
    "    noms <- ls(ns, all.names = TRUE)",
    "    noms <- noms[vapply(noms, function(n)",
    "      identical(get(n, envir = ns, inherits = FALSE), piece), logical(1))]",
    "    stopifnot(length(noms) == 1L)",
    "    as.name(noms[[1L]])",
    "  }",
    "  construire <- trouver(theme$construire_donnees)",
    "  vintages_fn <- trouver(theme$vintages)",
    "  compute_fn <- trouver(theme$compute)",
    "  publish_fn <- trouver(theme$publish)",
    "  sources <- as.name(paste0(\"sources_\", nom))",
    "  fichiers <- as.name(paste0(\"fichiers_\", nom))",
    "  brut <- as.name(paste0(\"brut_\", nom))",
    "  vintages <- as.name(paste0(\"vintages_table_\", nom))",
    "  payload <- as.name(paste0(\"payload_\", nom))",
    "  publie <- as.name(paste0(\"publie_\", nom))",
    "  list(",
    "    tar_target_raw(as.character(sources),",
    "               bquote(download_fake(.(theme$manifest), cache = .(cache),",
    "                                    mode = MODE_RUN))),",
    '    tar_target_raw(as.character(fichiers),',
    '               bquote({ .(sources); file.path(.(cache), .(theme$manifest)$fichier) }),',
    '               format = "file"),',
    "    tar_target_raw(as.character(brut),",
    "               bquote({ .(fichiers); .(construire)(cache = .(cache)) })),",
    "    tar_target_raw(as.character(vintages), bquote(.(vintages_fn)())),",
    "    tar_target_raw(as.character(payload), bquote(.(compute_fn)(.(brut)))),",
    "    tar_target_raw(as.character(publie),",
    "               bquote(.(publish_fn)(.(payload),",
    '                                     file.path(.(sortie),',
    '                                              .(paste0("out_", nom, ".txt"))))),',
    '               format = "file")',
    "  )",
    "}",
    paste0("THEMES <- list(", noms_themes, ")"),
    "list(unlist(lapply(THEMES, grappe_mini), recursive = FALSE))"
  )
  writeLines(lignes, file.path(projet, "_targets.R"))
  invisible(projet)
}

# installer_mini_projet_multi ---------------------------------------------------
# La variante PLURITHÈME d'installer_mini_projet : le mini-paquet porte toy ET
# toy2 (ecrire_source_toypkg les écrit tous les deux), le fichier d'entrée du
# second thème est créé, et le mini-graphe est construit par la fabrique sur
# la liste des descripteurs.
installer_mini_projet_multi <- function(themes = c("toy", "toy2")) {
  projet <- tempfile("mini-multi-")
  dir.create(file.path(projet, "toypkg", "R"), recursive = TRUE)
  dir.create(file.path(projet, "data", "raw"), recursive = TRUE)
  dir.create(file.path(projet, "out"), recursive = TRUE)

  writeLines(TOYPKG_DESCRIPTION, file.path(projet, "toypkg", "DESCRIPTION"))
  writeLines('exportPattern("^[^\\\\.]")', file.path(projet, "toypkg", "NAMESPACE"))
  writeLines(c("code,base", "a,1", "b,2", "c,3"),
             file.path(projet, "data", "raw", "entree.txt"))
  writeLines(c("code,base", "a,1", "b,2", "c,3"),
             file.path(projet, "data", "raw", "entree2.txt"))
  writeLines(c("code,base", "a,10", "b,20", "c,30"),
             file.path(projet, "data", "raw", "entree3.txt"))

  ecrire_source_toypkg(projet, "base")
  ecrire_mini_graphe_multi(projet, themes = themes)
  projet
}
