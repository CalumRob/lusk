# test-artefact-raccordement -----------------------------------------------------
# Les artefacts VERSIONNÉS du raccordement (issue #485, parent #482) : la
# matrice temps mairie à mairie figée de la recherche et la table des mairies
# DILA, portées sous inst/extdata comme artefacts de code (le même pattern que
# l'artefact NAF→A17 #426), derrière un contrat qui REFUSE tout substitut :
#   - le nom de fichier épinglé (la garde du snapshot porté — jamais un autre
#     fichier, jamais l'artefact d'une autre recette) ;
#   - l'empreinte sha256 du fichier épinglé (un substitut STRUCTURELLEMENT
#     valide — une autre matrice, un autre millésime — est refusé aussi) ;
#   - la forme des tables (colonnes, couverture, diagonale, cap) ;
#   - la recette estampillée : vintages des feeds, date 2026-09-16, fenêtre
#     07:00–20:00, meilleur départ p01, marche ≤ 40 min, cap 600 min.
# Chaque règle est exercée des DEUX CÔTÉS sans donnée externe : les fichiers
# réels ÉPINGLÉS passent ; les copies renommées, les contenus altérés et les
# métadonnées corrompues échouent bruyamment en nommant le fait constaté.

test_that("la table des mairies épinglée passe son contrat", {
  artefact <- artefact_mairies_bretagne()
  expect_invisible(verifier_contrat_mairies_bretagne(artefact))
})

test_that("la matrice temps épinglée passe son contrat sur le vrai fichier", {
  artefact <- artefact_matrice_temps()
  expect_invisible(verifier_contrat_matrice_temps(artefact))
})

test_that("la couverture des deux artefacts est celle constatée à la migration", {
  mai <- lire_mairies_bretagne()
  m <- lire_matrice_temps_mairies()
  # 1 213 points mairie (les entrées bretonnes de l'édition DILA), ids uniques,
  # les quatre départements
  expect_equal(nrow(mai), 1213L)
  expect_equal(anyDuplicated(mai$id), 0L)
  expect_setequal(unique(substr(mai$id, 1, 2)), c("22", "29", "35", "56"))
  # la matrice route exactement 1 200 × 1 200 communes, toutes à un point
  # mairie ; p01 complet sous le cap ; la diagonale (inclusion propre t = 0)
  expect_equal(nrow(m), 250482L)
  expect_setequal(names(m), c("from_id", "to_id",
                              "travel_time_p01", "travel_time_p50"))
  expect_equal(length(unique(m$from_id)), 1200L)
  expect_equal(length(unique(m$to_id)), 1200L)
  expect_true(all(m$from_id %in% mai$id))
  expect_equal(anyDuplicated(paste(m$from_id, m$to_id)), 0L)
  expect_false(anyNA(m$travel_time_p01))
  expect_true(all(m$travel_time_p01 >= 0 & m$travel_time_p01 <= 600))
  expect_equal(sum(m$from_id == m$to_id), 1200L)
})

test_that("TRIPWIRE — une copie RENOMMÉE de la matrice est refusée", {
  # la garde du snapshot porté : le contrat épingle LE fichier, jamais « un »
  faux <- artefact_matrice_temps()
  faux$fichier <- "matrice_recherche_autre.csv.gz" # substitut renommé
  expect_error(verifier_contrat_matrice_temps(faux),
               "matrice_temps_mairies\\.csv\\.gz")
})

test_that("TRIPWIRE — un contenu SUBSTITUÉ (même nom) est refusé par l'empreinte", {
  # une autre matrice, structurellement valide mais pas LE fichier figé :
  # l'empreinte sha256 calculée sur le fichier réel ne colle plus — refus
  chemin <- tempfile("matrice-substituee-", fileext = ".csv.gz")
  on.exit(unlink(chemin), add = TRUE)
  falsifiee <- lire_matrice_temps_mairies()
  falsifiee$travel_time_p01[1] <- falsifiee$travel_time_p01[1] + 1
  readr::write_csv(falsifiee, chemin)
  faux <- artefact_matrice_temps()
  faux$sha256 <- paste(openssl::sha256(file(chemin, "rb")))
  faux$table <- falsifiee
  expect_error(verifier_contrat_matrice_temps(faux), "sha256")
})

test_that("TRIPWIRE — une matrice hors cap ou sans diagonale échoue en nommant la règle", {
  base <- artefact_matrice_temps()

  # une cellule au-delà du cap 600 : la sémantique du figé casse
  hors_cap <- base
  hors_cap$table$travel_time_p01[1] <- 601
  expect_error(verifier_contrat_matrice_temps(hors_cap), "cap")

  # la diagonale amputée SANS changer le nombre de paires ni créer de doublon :
  # une paire diagonale devient une paire orientée absente. On choisit une
  # diagonale dont l'origine porte AUSSI d'autres lignes (une île sans aucune
  # paire joignable n'a QUE sa diagonale — retirer celle-là ferait chuter la
  # couverture, un autre contrat)
  sans_diagonale <- base
  sorties <- table(sans_diagonale$table$from_id)
  existantes <- paste(sans_diagonale$table$from_id,
                      sans_diagonale$table$to_id)
  diag_multi <- with(sans_diagonale$table,
                     which(from_id == to_id & sorties[from_id] > 1)[1])
  stopifnot(!is.na(diag_multi))
  existantes <- existantes[-diag_multi]
  candidates <- expand.grid(u = names(sorties)[1:50],
                            v = names(sorties)[1:50],
                            stringsAsFactors = FALSE)
  candidates <- candidates[candidates$u != candidates$v, ]
  candidates$paires <- paste(candidates$u, candidates$v)
  candidates <- candidates[!candidates$paires %in% existantes, ]
  stopifnot(nrow(candidates) > 0)
  sans_diagonale$table$from_id[diag_multi] <- candidates$u[[1]]
  sans_diagonale$table$to_id[diag_multi] <- candidates$v[[1]]
  expect_equal(nrow(sans_diagonale$table), 250482L)
  expect_error(verifier_contrat_matrice_temps(sans_diagonale),
               "diagonale")
})

test_that("TRIPWIRE — une table de mairies tronquée (couverture perdue) est refusée", {
  base <- artefact_mairies_bretagne()
  tronquee <- base
  tronquee$table <- tronquee$table[-(1:50), ]
  expect_error(verifier_contrat_mairies_bretagne(tronquee), "1213")
})

test_that("la recette estampillée porte EXACTEMENT les paramètres de la spécification", {
  r <- RECETTE_MATRICE_TEMPS_MAIRIES
  expect_equal(r$date_mesure, "2026-09-16")       # le mercredi réel de période scolaire
  expect_equal(r$fenetre_depart, "07:00")          # fenêtre 07:00–20:00
  expect_equal(r$fenetre_fin, "20:00")
  expect_equal(r$duree_fenetre_min, 780L)
  expect_equal(r$percentile, 1L)                   # le meilleur départ de la journée (p01)
  expect_equal(r$marche_max_min, 40L)              # marche ≤ 40 min aux deux extrémités
  expect_equal(r$cap_duree_min, 600L)              # durée maximale d'un trajet
  # les VINTAGES des feeds qui ont produit la matrice (pin-on-acquisition)
  expect_equal(r$feed_korrigo_version, "80335")
  expect_equal(r$feed_sncf_version, "2026-08-24")
  expect_equal(r$geometrie, "mairie a mairie")     # Mairie à mairie (sans accent : identifiant)
})

test_that("les empreintes épinglées sont celles des fichiers migrés verbatim", {
  # la migration est UNE COPIE OCTET PAR OCTET des fichiers vérifiés de la
  # recherche (E:\Temp\opencode\e1-r5r) — les empreintes constantes sont la
  # trace de cette vérification, refaites ici depuis le disque épinglé.
  # openssl::sha256 exige une CONNEXION BINAIRE (« rb ») : un mode texte
  # altérerait les octets sous Windows, et un chemin passé en caractère
  # hacherait la CHAÎNE du chemin, pas le fichier.
  chemin_mai <- system.file("extdata", MAIRIES_BRETAGNE_FICHIER, package = "lusk")
  chemin_mat <- system.file("extdata", MATRICE_TEMPS_MAIRIES_FICHIER, package = "lusk")
  expect_true(nzchar(chemin_mai))
  expect_true(nzchar(chemin_mat))
  expect_equal(paste(openssl::sha256(file(chemin_mai, "rb"))),
               MAIRIES_BRETAGNE_SHA256)
  expect_equal(paste(openssl::sha256(file(chemin_mat, "rb"))),
               MATRICE_TEMPS_MAIRIES_SHA256)
})
