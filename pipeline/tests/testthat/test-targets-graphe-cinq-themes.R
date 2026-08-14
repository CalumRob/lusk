# test-targets-graphe-cinq-themes -------------------------------------------------
# Issue #341 : le graphe targets généralisé aux CINQ thèmes — piloté par les
# descripteurs (THEMES_RUN), jamais une liste de pas par thème. Les seams
# optionnels se découvrent par les TRAITS du descripteur (publier, couverture,
# retire_vintages, metadata), jamais par un nom de thème en dur.
#
# Deux portes complémentaires, aucune donnée réelle (CI-safe — US 15) :
#   - STRUCTURE : le VRAI graphe (tar_manifest / tar_network sur le _targets.R
#     du pipeline) — les cinq familles de targets présentes, les seams
#     dispatchés par trait dans les commandes, et l'ISOLATION par thème des
#     étapes de données (aucune arête entre les cibles de données de deux
#     thèmes — la sémantique de skip par thème au niveau du graphe) ;
#   - FIXTURES : le mini-paquet plurithème (helper-targets-fixtures) — un
#     deuxième thème se câble dans un mini-graphe FABRIQUE par la seule liste
#     des descripteurs (la propriété « futur thème » qui tourne), et un
#     changement de pièce d'un thème n'invalide que SON aval.
# La preuve de bout en bout sur données réelles reste test-targets-byte-identical.R
# (detecter_changement FALSE par thème sur le même cache).

# charger_pieces_graphe ---------------------------------------------------------
# (défini dans test-targets-graphe-metadata.R — partagé par la suite targets)

test_that("le graphe câble les cinq thèmes depuis leurs descripteurs — aucun pas par thème", {
  racine <- pkgload::pkg_path()
  withr::local_dir(racine)
  # le graphe complet (LUSK_THEMES vide = les cinq). Issue #341 (course en
  # parallèle) : tar_manifest ne lit JAMAIS le store réel (la structure vient
  # du script _targets.R) — pas de unlink, le store du worker byte-identical
  # reste intact.
  withr::local_envvar(LUSK_THEMES = "")

  manifeste <- targets::tar_manifest()
  noms <- manifeste$name

  # les cinq grappes : la MÊME famille de targets par thème, nommée depuis le
  # descripteur (paste0) — une liste de pas par thème n'existe nulle part
  for (theme in c("demographie", "habitat", "economie", "mobilite", "milieux")) {
    expect_true(
      all(c(paste0("sources_", theme), paste0("fichiers_", theme),
            paste0("brut_", theme), paste0("vintages_table_", theme),
            paste0("publie_", theme), paste0("metadata_", theme),
            paste0("rapport_", theme)) %in% noms),
      info = paste("famille de targets du thème", theme)
    )
  }
  # les thèmes classiques (sans seam publier) ont un target compute ; Économie
  # et Mobilité (qui EXPOSENT publier) n'en ont pas — leur seam produit le
  # payload, le même dispatch que run_pipeline
  expect_true(all(c("payload_demographie", "payload_habitat",
                    "payload_milieux") %in% noms))
  expect_false(any(c("payload_economie", "payload_mobilite") %in% noms))

  # les artefacts partagés du run
  expect_true("fusion_vintages" %in% noms)
  expect_true("geometrie" %in% noms)
})

test_that("les seams se dispatchent sur les traits du descripteur, jamais sur les noms de thèmes", {
  racine <- pkgload::pkg_path()
  withr::local_dir(racine)
  # Issue #341 (course en parallèle) : pas de unlink du store réel (tar_manifest
  # ne le lit jamais).
  withr::local_envvar(LUSK_THEMES = "")

  manifeste <- targets::tar_manifest()
  commande <- function(nom) manifeste$command[manifeste$name == nom]

  # publier : Économie et Mobilité publient PAR leur seam (theme$publier),
  # les thèmes classiques par la machinerie partagée — le dispatch est
  # is.function(theme$publier), jamais un nom de thème
  expect_true(grepl("publier_economie", commande("publie_economie"), fixed = TRUE))
  expect_true(grepl("publier_mobilite", commande("publie_mobilite"), fixed = TRUE))
  expect_true(grepl("publish(", commande("publie_demographie"), fixed = TRUE))
  expect_true(grepl("publish(", commande("publie_habitat"), fixed = TRUE))
  expect_true(grepl("publish(", commande("publie_milieux"), fixed = TRUE))
  expect_false(grepl("publier_", commande("publie_demographie"), fixed = TRUE))

  # vintages : le cache atteint le builder qui le DÉCLARE (Habitat lit la date
  # de pull des DPE sur le mtime du cache — issue #19) — dispatch sur la
  # signature du thème, à l'identique de run_pipeline
  expect_true(grepl("vintages_habitat(cache =", commande("vintages_table_habitat"),
                    fixed = TRUE))
  expect_true(grepl("vintages_demographie()", commande("vintages_table_demographie"),
                    fixed = TRUE))

  # couverture : le diagnostic voyage dans le rapport quand le BRUT du thème
  # le porte (le seam names(brut) de run_pipeline — Mobilité, un fait de
  # première classe du rapport de run)
  expect_true(grepl("brut_mobilite", commande("rapport_mobilite"), fixed = TRUE))
  expect_true(grepl("couverture", commande("rapport_mobilite"), fixed = TRUE))

  # retire_vintages : la fusion PARTAGÉE applique les ids retirés que le
  # descripteur déclare (les différentielles OCS-GE de Milieux, #243) ; les
  # thèmes sans trait retirent rien
  expect_true(grepl("ocsge_artificialisation_22", commande("fusion_vintages"),
                    fixed = TRUE))
  expect_true(grepl("retires = character(0)", commande("fusion_vintages"),
                    fixed = TRUE))
})

test_that("les étapes de données d'un thème ne dépendent jamais de celles d'un autre (skip par thème)", {
  racine <- pkgload::pkg_path()
  withr::local_dir(racine)
  withr::local_envvar(LUSK_THEMES = "")
  # Issue #341 (course en parallèle) : la vérification de structure lit un
  # store ISOLÉ (jamais le store réel, jamais de unlink) — voir le test de
  # régression ci-dessous.
  store_structure <- tempfile("graphe-structure-")

  reseau <- targets::tar_network(store = store_structure)
  aretes <- reseau$edges
  partages <- c("fusion_vintages", "geometrie")

  # les targets de DONNÉES par thème : sources/fichiers/brut/vintages_table/
  # payload/metadata — leur voisinage ne traverse JAMAIS la frontière d'un
  # autre thème (les chaînes publie_/rapport_ et la fusion partagée sont des
  # artefacts partagés, explicitement câblés — hors du périmètre de la
  # preuve). Un changement de compute d'un thème ne peut donc pas invalider
  # les étapes de données d'un autre.
  prefixe_donnees <- "^(sources|fichiers|brut|vintages_table|payload|metadata)_"
  cibles_donnees <- aretes$from[grepl(prefixe_donnees, aretes$from)]
  for (t in cibles_donnees) {
    theme_t <- sub(prefixe_donnees, "", t)
    voisins <- unique(c(aretes$to[aretes$from == t], aretes$from[aretes$to == t]))
    for (v in voisins) {
      if (v %in% partages) next
      if (grepl(prefixe_donnees, v)) {
        expect_identical(sub(prefixe_donnees, "", v), theme_t,
                         info = paste("target de données", t,
                                      "relié à un autre thème :", v))
      }
    }
  }
})

test_that("la vérification de structure lit un store isolé — jamais la meta réelle en cours d'écriture (course parallèle #341)", {
  # Régression #341 : en parallèle, le worker de test-targets-byte-identical
  # écrit le store RÉEL (tar_make sur le même cache) pendant que ce fichier
  # vérifie la structure du graphe (tar_manifest/tar_network). Le mode
  # d'origine lisait la meta réelle (échec « replacement has 0 rows, data has
  # 489 ») et faisait un unlink("_targets") qui pouvait DÉTRUIRE le store du
  # worker concurrent mid-run. La vérification de structure est PURE : un
  # store jetable ISOLÉ, jamais le chemin réel — prouvé en deux portes qui ne
  # touchent JAMAIS au store réel (aucune course possible en parallèle) :
  #   - le VRAI graphe se lit avec un store isolé (edges) ;
  #   - un mini-graphe portant une meta PARTIELLEMENT ÉCRITE (l'état mid-run)
  #     se lit pareil, et la meta factice reste INTACTE après la vérification
  #     (ni lue, ni supprimée, ni réécrite).
  racine <- pkgload::pkg_path()
  withr::local_dir(racine)
  withr::local_envvar(LUSK_THEMES = "")

  # 1) le VRAI graphe : la structure se lit avec un store isolé
  reseau <- targets::tar_network(
                                 store = tempfile("graphe-structure-"))
  expect_true(nrow(reseau$edges) > 0)

  # 2) le mini-graphe : une meta partiellement écrite ne gêne pas la lecture
  # isolée — et reste INTACTE (jamais lue par la vérification, qui n'en a pas
  # besoin : la structure vient du script _targets.R, jamais de la meta)
  projet <- installer_mini_projet()
  dir.create(file.path(projet, "_targets", "meta"), recursive = TRUE)
  meta_midrun <- as.raw(c(0x50, 0x41, 0x52, 0x31, 0x00, 0xde, 0xad, 0xef))
  writeBin(meta_midrun, file.path(projet, "_targets", "meta", "meta"))
  withr::local_dir(projet)
  on.exit(unlink(projet, recursive = TRUE), add = TRUE)

  reseau2 <- targets::tar_network(
                                  store = tempfile("graphe-structure-"))
  expect_true(nrow(reseau2$edges) > 0)
  expect_identical(readBin(file.path(projet, "_targets", "meta", "meta"),
                           "raw", n = 8L), meta_midrun)
})

test_that("la fabrique réelle construit la famille de cibles d'un descripteur arbitraire (la structure « futur thème »)", {
  env <- charger_pieces_graphe(c("attributs_nuls", "meme_fonction_paquet",
                                 "symbole_ns", "grappe_theme", "publie_theme"))
  # les pièces targets (hors baseenv — l'environnement de charger_pieces_graphe)
  env$tar_target_raw <- targets::tar_target_raw

  # un descripteur JETABLE construit ici (jamais dans le paquet) à partir de
  # pièces RÉELLES du namespace — la preuve porte sur la MÉCANIQUE du graphe :
  # la fabrique construit la famille de cibles d'un descripteur arbitraire.
  # L'EXÉCUTION d'un sixième thème (avec SON constructeur, SES pièces, SA ligne
  # de liste) est prouvée par le test mini-graphe « futur thème » ci-dessous —
  # le généré réel référence theme_<slug>() par construction (la convention des
  # modules de thème), un constructeur inexistant ne peut pas s'exécuter.
  jetable <- list(
    theme = "jetable",
    manifest = theme_demographie()$manifest,
    construire_donnees = theme_demographie()$construire_donnees,
    vintages = theme_demographie()$vintages
  )

  grappe <- env$grappe_theme(jetable, mode = "full", cache = "data/raw",
                             sortie = "out")
  noms <- vapply(grappe, function(t) t$settings$name, character(1))
  expect_true(all(
    c("sources_jetable", "fichiers_jetable", "brut_jetable",
      "vintages_table_jetable", "payload_jetable") %in% noms
  ))

  # la publication, câblée par publie_theme : le seam publier se dispatch par
  # TRAIT — ce jetable ne l'expose pas → la branche compute_payload + publish,
  # à l'identique de run_pipeline (le jetable a un target compute, pas un seam)
  publie <- env$publie_theme(jetable, cache = "data/raw", sortie = "out")
  expect_identical(publie$settings$name, "publie_jetable")
})

# Les deux portes FIXTURES ------------------------------------------------------
# Le mini-paquet plurithème (helper-targets-fixtures) : la fabrique de grappe
# est écrite DANS le _targets.R du mini-projet — la même mécanique que la vraie
# grappe_theme (noms par thème, pièces par symbole) appliquée à la liste des
# descripteurs.

test_that("un deuxième thème se câble dans le mini-graphe par la seule liste des descripteurs", {
  projet <- installer_mini_projet_multi()
  withr::local_dir(projet)

  targets::tar_make(callr_function = NULL)

  # les DEUX grappes ont tourné — le thème « futur » (toy2) n'a demandé aucun
  # édit à la fabrique (seulement sa pièce dans le paquet et sa ligne dans la
  # liste des descripteurs). Le CONTENU EXACT des deux sorties prouve que
  # CHAQUE thème a tourné avec SES propres pièces (compute/publish du
  # descripteur — toy2 écrit son marqueur et son multiplicateur ×7, jamais les
  # pièces de toy : c'est le seam de dispatch que le graphe réel exploite).
  expect_identical(readLines(file.path(projet, "out", "out_toy.txt")),
                   c("2", "4", "6"))
  expect_identical(readLines(file.path(projet, "out", "out_toy2.txt")),
                   c("toy2", "7", "14", "21"))
})

test_that("un sixième thème jetable se câble dans le mini-graphe avec zéro édit de la fabrique — EXÉCUTÉ", {
  # la preuve « futur thème » de bout en bout : un thème de plus se câble par
  # SON constructeur (theme_jetable, sa ligne dans la liste) et SES pièces —
  # la fabrique (grappe_mini) ne change pas. Le mini-graphe EXÉCUTE le thème :
  # sa sortie porte SON marqueur et SON multiplicateur (×11) sur SON fichier
  # d'entrée (entree3.txt = 10/20/30 → 110/220/330).
  projet <- installer_mini_projet_multi(themes = c("toy", "toy2", "jetable"))
  withr::local_dir(projet)

  targets::tar_make(callr_function = NULL)

  expect_identical(readLines(file.path(projet, "out", "out_jetable.txt")),
                   c("jetable", "110", "220", "330"))
  # les thèmes historiques tournent toujours
  expect_identical(readLines(file.path(projet, "out", "out_toy.txt")),
                   c("2", "4", "6"))
  expect_identical(readLines(file.path(projet, "out", "out_toy2.txt")),
                   c("toy2", "7", "14", "21"))
})

test_that("sémantique de skip par thème : un changement de pièce de toy ne touche pas toy2", {
  projet <- installer_mini_projet_multi()
  withr::local_dir(projet)

  targets::tar_make(callr_function = NULL)

  # construire_fake (toy) change de corps — construire_fake2 (toy2) reste
  # intact : le piège de la fraîcheur (#325) est géré PAR THÈME — la frontière
  # du skip suit la frontière des pièces du descripteur, jamais un autre thème
  editer_fonction_toypkg(projet, "base = base$base,", "base = base$base + 100L,")

  perimes <- targets::tar_outdated(callr_function = NULL)
  expect_true(all(c("brut_toy", "payload_toy", "publie_toy") %in% perimes))
  expect_false(any(c("brut_toy2", "payload_toy2", "publie_toy2") %in% perimes))
})
