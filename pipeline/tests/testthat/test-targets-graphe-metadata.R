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
#
# Issue #434 : la cible metadata_<theme> lit SON fichier épinglé
# inst/extdata/theme-metadata/theme_<theme>.json DANS la commande (via
# theme$metadata()) sans dépendance suivie — un changement du CANON SEUL laissait
# donc le graphe considérer la cible à jour et ne republiait jamais le
# descripteur public (observation 2026-08-11 #4, reproduite après 29d5277 :
# « 1 completed, 16 skipped », contournement manuel tar_invalidate). Les quatre
# tests du bas verrouillent le remède : chaque metadata_<theme> porte le JSON
# épinglé comme dépendance de fichiers (format = "file", fraîcheur PAR CONTENU),
# un changement canon-only n'invalide exactement que SA cible, et un run sans
# changement saute toujours tout.

# charger_pieces_graphe est défini dans helper-targets-fixtures.R (partagé par
# les processus parallèles de la suite targets).

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

# appel_function_a_srcref -------------------------------------------------------
# Un appel `function` porte sa srcref comme QUATRIÈME ÉLÉMENT (le parser R ne
# la met PAS en attribut) — le piège que #341 a exposé en câblant Mobilité :
# le srcfile (un environnement) diffère entre deux chargements du même fichier,
# l'arbre nu de deux générations ne pouvait pas égaler.
appel_function_a_srcref <- function(x) {
  if (is.call(x)) {
    if (identical(x[[1L]], as.name("function")) && length(x) == 4L &&
        inherits(x[[4L]], "srcref")) {
      return(TRUE)
    }
    any(vapply(as.list(x), appel_function_a_srcref, logical(1)))
  } else {
    FALSE
  }
}

# appel_function : un appel `function` quel qu'il soit (formals vides ou non).
appel_function <- function(x) {
  if (is.call(x)) {
    if (identical(x[[1L]], as.name("function"))) return(TRUE)
    any(vapply(as.list(x), appel_function, logical(1)))
  } else {
    FALSE
  }
}

test_that("attributs_nuls : la srcref embarquée d'une fonction anonyme est retirée (#341)", {
  env <- charger_pieces_graphe("attributs_nuls")

  # construire_donnees_mobilite porte des fonctions anonymes (le parser R
  # stocke leur srcref comme 4e ÉLÉMENT de l'appel `function`, avec un
  # srcfile-environnement) — le corps nu doit ne plus en porter AUCUNE : deux
  # générations du même corps deviennent comparables (le pont
  # meme_fonction_paquet), la construction du graphe Mobilité survit.
  corps <- body(construire_donnees_mobilite)
  expect_true(appel_function_a_srcref(corps))   # le corps EN porte (le piège)
  expect_true(appel_function(corps))            # des fonctions anonymes, oui

  nu <- env$attributs_nuls(corps)
  expect_false(appel_function_a_srcref(nu))     # attributs_nuls les retire
  expect_identical(nu, env$attributs_nuls(nu))  # idempotent
  expect_null(attributes(nu))

  # la forme est préservée : la fonction anonyme est toujours là, seule la
  # srcref embarquée a disparu
  expect_true(appel_function(nu))
})

# Issue #434 — le canon épinglé comme dépendance suivie -------------------------

# deparse_1 : le texte d'une commande sur UNE ligne (deparse vecteurise par
# lignes — grepl dessus renverrait un vecteur)
deparse_1 <- function(expr) paste(deparse(expr), collapse = "\n")

test_that("grappe_theme câble le JSON épinglé comme cible de fichiers suivie par metadata (#434)", {
  env <- charger_pieces_graphe(c("attributs_nuls", "meme_fonction_paquet",
                                 "symbole_ns", "grappe_theme"))
  env$tar_target_raw <- targets::tar_target_raw

  grappe <- env$grappe_theme(theme_economie(), mode = "full",
                             cache = "data/raw", sortie = "out")
  noms <- vapply(grappe, function(t) t$settings$name, character(1))
  canon <- grappe[[which(noms == "fichier_metadata_economie")]]
  meta <- grappe[[which(noms == "metadata_economie")]]

  # le canon : une cible format = "file" (la fraîcheur PAR CONTENU du graphe,
  # trust_timestamps = FALSE) résolue depuis la ressource épinglée du paquet —
  # SON fichier theme_economie.json, jamais celui d'un autre thème
  expect_identical(canon$settings$format, "file")
  expect_true(grepl('"theme_economie.json"', deparse_1(canon$command$expr), fixed = TRUE),
              info = deparse_1(canon$command$expr))

  # la dépendance : la commande metadata_ référence le canon (l'arête existe —
  # un changement du canon seul invalide la cible au prochain run)
  expect_true(grepl("fichier_metadata_economie", deparse_1(meta$command$expr), fixed = TRUE),
              info = deparse_1(meta$command$expr))
})

test_that("le graphe réel porte le canon épinglé des cinq thèmes comme dépendance suivie (#434)", {
  racine <- pkgload::pkg_path()
  withr::local_dir(racine)
  # tar_manifest ne lit JAMAIS le store réel (la structure vient du script
  # _targets.R) — pas de unlink, le store d'un worker concurrent reste intact
  # (la règle #341)
  withr::local_envvar(LUSK_THEMES = "")

  manifeste <- targets::tar_manifest()
  noms <- manifeste$name
  commande <- function(nom) manifeste$command[manifeste$name == nom]

  for (t in c("demographie", "habitat", "economie", "mobilite", "milieux")) {
    canon <- paste0("fichier_metadata_", t)
    # la cible de fichiers du canon existe et résout SON fichier épinglé
    expect_true(canon %in% noms, info = canon)
    expect_true(grepl(sprintf('"theme_%s.json"', t), commande(canon), fixed = TRUE),
                info = commande(canon))
    # metadata_<theme> référence le canon — la dépendance suivie est câblée
    expect_true(grepl(canon, commande(paste0("metadata_", t)), fixed = TRUE),
                info = paste0("metadata_", t))
  }
})

test_that("le canon épinglé d'un thème n'a aucun aval hors SA cible metadata (#434)", {
  racine <- pkgload::pkg_path()
  withr::local_dir(racine)
  withr::local_envvar(LUSK_THEMES = "")
  # Issue #341 (course en parallèle) : la vérification de structure lit un
  # store ISOLÉ (jamais le store réel, jamais de unlink)
  store_structure <- tempfile("graphe-metadata-")

  aretes <- targets::tar_network(store = store_structure)$edges
  for (t in c("demographie", "habitat", "economie", "mobilite", "milieux")) {
    # un changement du canon SEUL ne peut invalider QUE la publication des
    # métadonnées de SON thème — jamais les étapes de données ni un autre thème
    aval <- unique(aretes$to[aretes$from == paste0("fichier_metadata_", t)])
    expect_identical(sort(aval), paste0("metadata_", t),
                     info = paste("aval du canon", t))
  }
})

test_that("un changement du canon seul ne reconstruit que SA cible metadata ; sans changement tout saute (#434)", {
  projet <- installer_mini_projet_multi()
  withr::local_dir(projet)

  targets::tar_make(callr_function = NULL)

  # zéro changement : tout saute — PAS de fausse invalidation (le canon est
  # suivi PAR CONTENU, un run à l'identique ne rejoue rien)
  expect_identical(targets::tar_outdated(callr_function = NULL), character(0))

  # le CANON SEUL de toy change (le même geste que l'édition du
  # theme_economie.json de 29d5277) : exactement les DEUX cibles du mécanisme
  # deviennent périmées — le canon et la publication de SON thème. Ni toy2,
  # ni une seule étape de données de toy.
  writeLines("canon-toy-v2",
             file.path(projet, "toypkg", "inst", "extdata", "theme-metadata",
                       "theme_toy.json"))
  perimes <- sort(targets::tar_outdated(callr_function = NULL))
  expect_identical(perimes, c("fichier_metadata_toy", "metadata_toy"))

  # le run republie : le descripteur public porte le NOUVEAU canon, celui de
  # toy2 reste à l'édition 1, et le graphe redevient entièrement frais
  targets::tar_make(callr_function = NULL)
  expect_identical(readLines(file.path(projet, "out", "theme_toy.txt")),
                   "canon-toy-v2")
  expect_identical(readLines(file.path(projet, "out", "theme_toy2.txt")),
                   "canon-toy2-v1")
  expect_identical(targets::tar_outdated(callr_function = NULL), character(0))
})
