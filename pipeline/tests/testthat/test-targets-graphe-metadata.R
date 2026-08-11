# test-targets-graphe-metadata ---------------------------------------------------
# Régression #351 : le graphe de #340 cassait sur main mergé (après l'arrivée
# de #311) de deux façons, invisibles à la suite de #340 parce que la branche
# feature (89c20b6) était basée sur 27b22f4, antérieure à #311.
#
# Défaut 1 — attributs_nuls plantait sur les descripteurs : #311 a ajouté aux
# cinq descripteurs un argument de fonction anonyme `metadata = function() ...`
# (theme_demographie.R:575, et sœurs). Dans attributs_nuls, le nœud
# `function() ...` a un enfant NULL (les formals vides) ; l'affectation
# `x[[i]] <- NULL` RETIRAIT l'élément de l'appel et le seq_along(x) précalculé
# dépassait (subscript out of bounds) — la construction du graphe entière
# échouait (tar_make, tar_manifest).
#
# Défaut 2 — le seam metadata manquait au graphe : grappe_theme() n'avait
# aucun target pour publier theme_<theme>.json, là où run_pipeline (post-#311)
# publie les métadonnées quand le descripteur déclare `metadata`.
#
# Ces tests sont des FIXTURES (aucune donnée réelle, CI-safe — US 15) : ils
# chargent les fonctions de MÉCANIQUE du VRAI _targets.R (jamais le graphe
# entier, jamais le store) et prouvent que le chemin de construction survit au
# seam metadata. La preuve de bout en bout sur données réelles reste
# test-targets-byte-identical.R (detecter_changement FALSE sur le même cache).

# charger_pieces_graphe ---------------------------------------------------------
# Charge les fonctions de mécanique de _targets.R (jamais le graphe entier) dans
# un environnement vierge : parse du fichier, sélection des définitions par nom
# (les affectations `nom <- function(...)`), évaluation dans un environnement
# dont le parent est baseenv. Ce sont les MÊMES fonctions que tar_make exécute
# à la construction, sans les effets de bord du script (pkgload::load_all,
# tar_option_set, le graphe évalué en tête de fichier).
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

test_that("attributs_nuls : un descripteur portant metadata = function() ne rétrécit pas l'appel (#351)", {
  env <- charger_pieces_graphe("attributs_nuls")

  # Le corps du VRAI theme_demographie() porte `metadata = function() ...` — la
  # fonction anonyme aux formals vides dont l'enfant NULL faisait dépasser le
  # seq_along(x) précalculé (x[[i]] <- NULL retire l'élément de l'appel).
  nu <- env$attributs_nuls(body(theme_demographie))

  # l'arbre de parse nu : sans attributs de source, idempotent, et le membre
  # metadata a SURVÉCU au décapage (le nœud NULL reste en place — la forme de
  # l'appel est préservée, elle n'est pas rétrécie)
  expect_null(attributes(nu))
  expect_identical(nu, env$attributs_nuls(nu))
  expect_true(any(grepl("metadata = function()", deparse(nu), fixed = TRUE)))
})

test_that("symbole_ns : la construction du graphe survit au seam metadata (#351)", {
  env <- charger_pieces_graphe(c("attributs_nuls", "meme_fonction_paquet",
                                 "symbole_ns"))
  theme <- theme_demographie()

  # Les DEUX appels que grappe_theme() fait à la construction. La pièce
  # `vintages` (formals vides) fait parcourir les candidats `()` du namespace
  # (les cinq theme_*, erreur_telechargement) : le chemin meme_fonction_paquet
  # -> attributs_nuls(body(candidat)) plantait sur leur fonction anonyme.
  expect_identical(
    env$symbole_ns(theme$vintages),
    as.name("vintages_demographie")
  )
  expect_identical(
    env$symbole_ns(theme$construire_donnees),
    as.name("construire_donnees_brut")
  )
})
