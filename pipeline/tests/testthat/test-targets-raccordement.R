# test-targets-raccordement -------------------------------------------------------
# LE CÂBLAGE du raccordement dans le graphe (issue #486) : les épingles du
# package, la cible de calcul et la publication chaînée — plus LA PREUVE du
# skip. Deux portes, la discipline de la suite targets (#340) :
#   - STRUCTURE : les pièces de _targets.R chargées hors du graphe (le même
#     motif que charger_pieces_graphe) construisent la grappe Mobilité en
#     mode full ET cron : les cibles du trait existent, la publication est
#     CHAÎNÉE derrière le calcul, et le mode cron pose cue = "never" sur la
#     chaîne (jamais évaluée par l'horloge légère) ;
#   - FIXTURE : un mini-graphe À LA MÊME FORME (épingle = cible de fichiers à
#     expression pure → calcul persisté en cible de fichiers → publication
#     qui lit) exécuté en session : un second appel SAUTE tout ; une entrée
#     touchée n'invalide QUE la chaîne ; en mode cron RIEN ne s'exécute même
#     périmé (le compteur d'exécutions ne bouge pas, l'enveloppe garde son
#     octet).
#
# La FRAÎCHEUR de l'enveloppe est unit-testée ici aussi (lire_raccordement :
# absent ou périmé s'arrête en nommant le recalcul à lancer).

# pieces_graphe_raccordement ------------------------------------------------------
# Les pièces de MÉCANIQUE de _targets.R (grappe_theme, publie_theme et leurs
# dépendances), évaluées dans un environnement dont le parent est l'env de
# test — la chaîne d'environnements atteint le namespace du paquet (les
# constantes internes du raccordement y vivent) et le search path (targets,
# importé par DESCRIPTION). JAMAIS le script entier : pas de load_all ni de
# store touché.
pieces_graphe_raccordement <- function() {
  arbres <- parse(file.path(pkgload::pkg_path(), "_targets.R"))
  noms <- c("attributs_nuls", "meme_fonction_paquet", "symbole_ns",
            "grappe_theme", "publie_theme")
  defs <- arbres[vapply(arbres, function(a) {
    is.call(a) && identical(a[[1]], as.name("<-")) &&
      is.name(a[[2]]) && as.character(a[[2]]) %in% noms
  }, logical(1))]
  stopifnot(length(defs) == length(noms))
  env <- new.env(parent = environment())
  eval(defs, env)
  # le NAMESPACE à la main ne déclare pas les imports targets : les corps des
  # pièces résolvent tar_target_raw / tar_cue depuis le namespace du paquet
  for (sym in c("tar_target_raw", "tar_cue")) {
    assign(sym, get(sym, asNamespace("targets")), envir = env)
  }
  env
}

cue_de <- function(cibles, nom) {
  cible <- cibles[vapply(cibles, function(t) identical(t$name, nom),
                         logical(1))][[1L]]
  cible$cue$mode
}

test_that("structure : le trait câble les épingles, la cible de calcul et la chaîne de publication", {
  env <- pieces_graphe_raccordement()
  grappe <- env$grappe_theme(theme = theme_mobilite(), mode = "full",
                                  cache = tempfile("cache-struct-"),
                                  sortie = tempfile("sortie-struct-"))
  noms <- vapply(grappe, function(t) t$name, character(1))

  # les épingles du package + la cible de calcul (format = "file")
  expect_true("pin_matrice_temps_mobilite" %in% noms)
  expect_true("pin_population_mobilite" %in% noms)
  expect_true("raccordement_mobilite" %in% noms)

  # la publication est CHAÎNÉE derrière le calcul — sa commande référence la
  # cible (elle lit une enveloppe fraîche, jamais un recalcul au fil des
  # republications)
  publie <- env$publie_theme(theme = theme_mobilite(),
                             cache = tempfile("cache-struct-"),
                             sortie = tempfile("sortie-struct-"))
  expect_true(any(grepl("raccordement_mobilite",
                        deparse(publie$command$expr), fixed = TRUE)))
})

test_that("structure : le mode cron pose cue = never, le mode full non", {
  env <- pieces_graphe_raccordement()
  # le cron : la chaîne du raccordement n'est JAMAIS évaluée
  grappe_cron <- env$grappe_theme(theme = theme_mobilite(), mode = "cron",
                                  cache = tempfile("cache-struct-"),
                                  sortie = tempfile("sortie-struct-"))
  expect_identical(cue_de(grappe_cron, "raccordement_mobilite"), "never")
  # le full (manuel / desktop) : la cue normale — le skip suit ses entrées
  grappe_full <- env$grappe_theme(theme = theme_mobilite(), mode = "full",
                                  cache = tempfile("cache-struct-"),
                                  sortie = tempfile("sortie-struct-"))
  expect_false(identical(cue_de(grappe_full, "raccordement_mobilite"),
                         "never"))
  # le dispatch est PAR TRAIT : un thème sans le membre raccordement ne
  # porte AUCUNE cible du bloc
  grappe_demo <- env$grappe_theme(theme = theme_demographie(),
                                  mode = "cron",
                                  cache = tempfile("cache-struct-"),
                                  sortie = tempfile("sortie-struct-"))
  noms_demo <- vapply(grappe_demo, function(t) t$name, character(1))
  expect_false(any(grepl("^pin_", noms_demo)))
  expect_false("raccordement_demographie" %in% noms_demo)
})

# mini_graphe_raccordement --------------------------------------------------------
# Le mini-graphe À LA MÊME FORME que le câblage réel (#486) : une ÉPINGLE
# (expression pure rendant le chemin, format = "file" — la forme des
# fichier_<theme>_<id> et des pin_* du vrai graphe), la cible de CALCUL
# (format = "file" : elle copie l'épingle vers l'enveloppe ET incrémente un
# compteur d'exécutions HORS contrat — la trace qu'elle a tourné), puis la
# PUBLICATION qui lit l'enveloppe. `mode_run` contrôle le cue exactement
# comme _targets.R : cron -> tar_cue(mode = "never").
mini_graphe_raccordement <- function(projet, mode_run = "full") {
  lignes <- c(
    "library(targets)",
    'tar_option_set(trust_timestamps = FALSE)',
    sprintf('MODE_RUN <- "%s"', mode_run),
    'ENTREE <- "data/raw/entree.txt"',
    'COMPTEUR <- "compteur.txt"',
    "lire_compteur <- function() {",
    "  if (!file.exists(COMPTEUR)) return(0L)",
    "  as.integer(readLines(COMPTEUR, warn = FALSE))",
    "}",
    "calculer <- function(chemin_entree) {",
    "  writeLines(as.character(lire_compteur() + 1L), COMPTEUR)",
    '  file.copy(chemin_entree, "processed/enveloppe.rds", overwrite = TRUE)',
    '  "processed/enveloppe.rds"',
    "}",
    "publier <- function(chemin_enveloppe) {",
    '  if (!file.exists(chemin_enveloppe)) stop("enveloppe absente")',
    '  writeLines("publie", "out.txt")',
    '  "out.txt"',
    "}",
    "list(",
    "  tar_target(pin, ENTREE, format = \"file\"),",
    "  tar_target(calcul, { pin; calculer(pin) }, format = \"file\",",
    "             cue = if (identical(MODE_RUN, \"cron\")) {",
    '               tar_cue(mode = "never")',
    "             } else {",
    "               tar_cue()",
    "             }),",
    '  tar_target(publie, { calcul; publier(calcul) }, format = "file")',
    ")"
  )
  writeLines(lignes, file.path(projet, "_targets.R"))
  invisible(projet)
}

installer_projet_raccordement <- function(mode_run = "full") {
  projet <- tempfile("mini-raccordement-")
  dir.create(file.path(projet, "data", "raw"), recursive = TRUE)
  dir.create(file.path(projet, "processed"))
  writeLines(c("code,population", "11111,100"),
             file.path(projet, "data", "raw", "entree.txt"))
  mini_graphe_raccordement(projet, mode_run = mode_run)
  projet
}

compteur_de <- function(projet) {
  as.integer(readLines(file.path(projet, "compteur.txt")))
}

test_that("discipline de cue : un second appel SAUTE tout, une entrée touchée n'invalide que la chaîne", {
  projet <- installer_projet_raccordement()
  withr::local_dir(projet)

  targets::tar_make(callr_function = NULL)
  expect_length(targets::tar_outdated(callr_function = NULL), 0)
  expect_equal(compteur_de(projet), 1L)

  # LE second appel : rien à rejouer, le calcul n'est PAS relancé — la
  # discipline de cue exigée par le ticket (#486)
  targets::tar_make(callr_function = NULL)
  expect_length(targets::tar_outdated(callr_function = NULL), 0)
  expect_equal(compteur_de(projet), 1L)

  # l'épingle change de contenu : SEUL le raccordement et son aval sont
  # invalidés puis rejoués
  writeLines(c("code,population", "11111,200"),
             file.path(projet, "data", "raw", "entree.txt"))
  perimes <- targets::tar_outdated(callr_function = NULL)
  expect_setequal(perimes, c("pin", "calcul", "publie"))
  targets::tar_make(callr_function = NULL)
  expect_equal(compteur_de(projet), 2L)
  expect_length(targets::tar_outdated(callr_function = NULL), 0)
})

test_that("LE CRON SAUTE LA CHAÎNE : après l'amorçage, plus JAMAIS un recalcul", {
  projet <- installer_projet_raccordement(mode_run = "cron")
  withr::local_dir(projet)

  # l'amorçage : un store sans valeur ne peut rien servir — la cible se
  # construit UNE fois (le même comportement que le graphe réel sur un
  # runner froid), puis ne tourne PLUS jamais en cron
  targets::tar_make(callr_function = NULL)
  expect_equal(compteur_de(projet), 1L)
  empreinte_avant <- tools::md5sum(
    file.path(projet, "processed", "enveloppe.rds"))

  # une entrée TOUCHÉE : la chaîne est périmée, mais cue never interdit toute
  # re-évaluation — ni recalcul ni republication, la valeur servie reste
  # celle de l'amorçage (l'horloge légère ne paie JAMAIS le raccordement)
  writeLines(c("code,population", "11111,999"),
             file.path(projet, "data", "raw", "entree.txt"))
  perimes <- targets::tar_outdated(callr_function = NULL)
  expect_true("pin" %in% perimes)
  expect_false("calcul" %in% perimes)   # cue never : jamais « à rejouer »
  expect_false("publie" %in% perimes)

  targets::tar_make(callr_function = NULL)
  expect_equal(compteur_de(projet), 1L)  # le calcul n'a PAS tourné
  empreinte_apres <- tools::md5sum(
    file.path(projet, "processed", "enveloppe.rds"))
  expect_identical(unname(empreinte_avant), unname(empreinte_apres))
})

test_that("lire_raccordement : absent ou périmé s'arrête en nommant le recalcul", {
  sortie <- tempfile("raccordement-lire-")
  dir.create(sortie)
  on.exit(unlink(sortie, recursive = TRUE), add = TRUE)

  # ABSENT : le calcul à lancer est nommé, jamais un payload amputé
  expect_error(lire_raccordement(sortie), "preparer_raccordement")

  # PÉRIMÉ : une empreinte d'entrée qui ne coïncide plus avec les fichiers
  # épinglés actuels est refusée (republier des parts calculées depuis une
  # autre matrice serait une fraude à la fraîcheur)
  enveloppe <- list(
    entrees = list(
      sha_matrice = paste0(rep("0", 64L), collapse = ""),
      sha_population = POPULATION_RACCORDEMENT_SHA256,
      recette = RECETTE_MATRICE_TEMPS_MAIRIES
    ),
    calcul = list(communes = tibble::tibble(code = character()))
  )
  readr::write_rds(enveloppe, file.path(sortie, RACCORDEMENT_ARTEFACT))
  expect_error(lire_raccordement(sortie), "matrice temps a changé")

  # FRAIS : les empreintes actuelles passent (forme minimale pour le lecteur)
  enveloppe$entrees$sha_matrice <- empreinte_fichier_raccordement(
    system.file("extdata", MATRICE_TEMPS_MAIRIES_FICHIER, package = "lusk"))
  readr::write_rds(enveloppe, file.path(sortie, RACCORDEMENT_ARTEFACT))
  relu <- lire_raccordement(sortie)
  expect_identical(relu$entrees$sha_matrice, enveloppe$entrees$sha_matrice)
})
