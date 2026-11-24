# Attribution des échecs de verrous (issue #1103) -------------------------------
# Un verrou qui casse est soit une DÉRIVE DE DONNÉES (une entrée diffère du
# lockfile, ou n'a pas de référence) — rapportée, non fatale — soit une
# RÉGRESSION DE CODE (toutes les entrées sont identiques au lockfile) — fatale.

lock_test <- function() {
  l <- lire_lock()
  l
}

digest_de <- function(l, id) {
  e <- l[[id]]
  list(source_id = id, sha256 = e$sha256, acquired_at = e$acquired_at,
       vintage = e$vintage, date_reference = e$date_reference)
}

test_that("une empreinte modifiée produit la dérive de données, non fatale", {
  l <- lock_test()
  digests <- list(osm_reseaux = digest_de(l, "osm_reseaux"))
  digests$osm_reseaux$sha256 <- paste(rep("0", 64), collapse = "")
  a <- attribuer_echec_lock("osm_reseaux", digests)
  expect_equal(a$type, "drift")
  expect_match(a$message, "dérive de osm_reseaux depuis 2026-11-18", fixed = TRUE)
  expect_match(a$message, "relock requis", fixed = TRUE)
  expect_equal(a$expected, l$osm_reseaux$sha256)
  expect_equal(a$observed, paste(rep("0", 64), collapse = ""))
})

test_that("une source sans référence produit une dérive « pas de référence »", {
  l <- lock_test()
  digests <- list(source_nouvelle = list(source_id = "source_nouvelle",
                                         sha256 = paste(rep("a", 64), collapse = "")))
  a <- attribuer_echec_lock("source_nouvelle", digests)
  expect_equal(a$type, "drift")
  expect_match(a$message, "pas de référence pour source_nouvelle", fixed = TRUE)
  expect_match(a$message, "relock requis", fixed = TRUE)
})

test_that("la dérive nomme TOUTES les entrées fautives avec leur date (#1109)", {
  verrou <- tempfile("lock-attribution-multiple-")
  on.exit(unlink(verrou), add = TRUE)
  sha <- function(caractere) paste(rep(caractere, 64), collapse = "")
  ecrire_lock(list(
    stable = list(source_id = "stable", sha256 = sha("c"), acquired_at = "2026-11-01"),
    acv = list(source_id = "acv", sha256 = sha("a"), acquired_at = "2026-11-20"),
    rp_logement_princ = list(source_id = "rp_logement_princ", sha256 = sha("b"),
                             acquired_at = "2026-11-18")
  ), verrou)
  digests <- list(
    stable = list(source_id = "stable", sha256 = sha("c")),
    acv = list(source_id = "acv", sha256 = sha("0")),
    source_nouvelle = list(source_id = "source_nouvelle", sha256 = sha("e"))
    # rp_logement_princ : aucune empreinte observée
  )
  a <- attribuer_echec_lock(
    c("stable", "acv", "rp_logement_princ", "source_nouvelle"), digests, verrou
  )
  expect_equal(a$type, "drift")
  expect_setequal(names(a$sources), c("acv", "rp_logement_princ", "source_nouvelle"))
  expect_false("stable" %in% names(a$sources))
  expect_match(a$message, "acv depuis 2026-11-20", fixed = TRUE)
  expect_match(a$message, "rp_logement_princ depuis 2026-11-18", fixed = TRUE)
  expect_match(a$message, "pas de référence pour source_nouvelle", fixed = TRUE)
  expect_false(grepl("stable", a$message, fixed = TRUE))
  expect_identical(a$sources$acv$date_lockfile, "2026-11-20")
  expect_identical(a$sources$rp_logement_princ$date_lockfile, "2026-11-18")
  expect_null(a$sources$source_nouvelle$date_lockfile)
  expect_null(a$sources$source_nouvelle$expected)
})

test_that("des empreintes identiques produisent une régression fatale", {
  l <- lock_test()
  digests <- list(
    osm_reseaux = digest_de(l, "osm_reseaux"),
    korrigo = digest_de(l, "korrigo")
  )
  a <- attribuer_echec_lock(c("osm_reseaux", "korrigo"), digests)
  expect_equal(a$type, "regression")
  expect_match(a$message, "régression de code : entrées identiques, sortie modifiée",
               fixed = TRUE)
})

test_that("les valeurs absentes d'une attribution sont sérialisées null (#1109)", {
  digests <- list(source_nouvelle = list(
    source_id = "source_nouvelle", sha256 = paste(rep("a", 64), collapse = "")
  ))
  a <- attribuer_echec_lock("source_nouvelle", digests)
  sortie <- tempfile("sortie-attribution-null-")
  dir.create(sortie)
  on.exit(unlink(sortie, recursive = TRUE), add = TRUE)
  enregistrer_attribution_derive(a, sortie)
  ecrire_rapport_run(
    tibble::tibble(id = "source_nouvelle", mode = "cron", status = "frais"),
    "cron", cible = sortie, attributions = list(a)
  )
  for (fichier in c(NOM_ATTRIBUTIONS, "run-report.json")) {
    lignes <- readLines(file.path(sortie, fichier), warn = FALSE)
    expect_true(any(grepl('"date_lockfile": null', lignes, fixed = TRUE)), info = fichier)
    expect_true(any(grepl('"expected": null', lignes, fixed = TRUE)), info = fichier)
    expect_false(any(grepl('"date_lockfile": {}', lignes, fixed = TRUE)), info = fichier)
    expect_false(any(grepl('"expected": {}', lignes, fixed = TRUE)), info = fichier)
  }
})

test_that("verifier_egale / verifier_vrai signalent une condition verrou_casse nommée (#1118)", {
  err <- expect_error(
    verifier_vrai(FALSE, "un verrou", "un détail"),
    class = "verrou_casse"
  )
  expect_match(conditionMessage(err),
               "Verrou « données réelles » cassé — un verrou", fixed = TRUE)
  expect_match(conditionMessage(err), "un détail", fixed = TRUE)
  err2 <- expect_error(
    verifier_egale(40, 42, "un autre verrou"),
    class = "verrou_casse"
  )
  expect_match(conditionMessage(err2), "attendu « 42 »", fixed = TRUE)
  expect_silent(verifier_vrai(TRUE, "ok"))
  expect_silent(verifier_egale(42, 42, "ok"))
})

test_that("une erreur hors verrou n'est PAS attribuée et propage son message (#1118)", {
  # Un artefact amont manquant, une lecture qui échoue, une panne de téléchargement
  # ne sont PAS des valeurs de verrou cassées : le wrapper ne doit ni les
  # étiqueter « régression de code » (empreintes identiques), ni les avaler en
  # « dérive » (empreintes divergentes). Le message d'origine est re-signalisé.
  l <- lock_test()
  identiques <- list(osm_reseaux = digest_de(l, "osm_reseaux"))
  divergentes <- list(osm_reseaux = digest_de(l, "osm_reseaux"))
  divergentes$osm_reseaux$sha256 <- paste(rep("b", 64), collapse = "")
  sortie <- tempfile("sortie-hors-verrou-")
  dir.create(sortie)
  on.exit(unlink(sortie, recursive = TRUE), add = TRUE)

  err <- expect_error(verifier_avec_attribution(
    verifier = function(x) stop("artefact absent : mobilite.parquet"),
    args = list(x = 1), ids_sources = "osm_reseaux", sortie = sortie,
    digests = identiques
  ))
  expect_match(conditionMessage(err), "artefact absent : mobilite.parquet", fixed = TRUE)
  expect_false(grepl("régression de code", conditionMessage(err), fixed = TRUE))

  err2 <- expect_error(verifier_avec_attribution(
    verifier = function(x) stop("lecture Parquet impossible"),
    args = list(x = 1), ids_sources = "osm_reseaux", sortie = sortie,
    digests = divergentes
  ))
  expect_match(conditionMessage(err2), "lecture Parquet impossible", fixed = TRUE)
  expect_false(grepl("dérive de", conditionMessage(err2), fixed = TRUE))
  expect_length(lire_attributions(sortie), 0L)
})

test_that("un verrou cassé avec empreintes identiques reste une régression fatale (#1118)", {
  l <- lock_test()
  digests <- list(osm_reseaux = digest_de(l, "osm_reseaux"))
  sortie <- tempfile("sortie-verrou-regression-")
  dir.create(sortie)
  on.exit(unlink(sortie, recursive = TRUE), add = TRUE)
  err <- expect_error(verifier_avec_attribution(
    verifier = function(x) {
      verifier_vrai(FALSE, "un verrou", "valeur 40 au lieu de 42")
    },
    args = list(x = 1), ids_sources = "osm_reseaux", sortie = sortie,
    digests = digests
  ))
  expect_match(conditionMessage(err),
               "régression de code : entrées identiques, sortie modifiée", fixed = TRUE)
  expect_match(conditionMessage(err),
               "Verrou « données réelles » cassé — un verrou", fixed = TRUE)
  expect_length(lire_attributions(sortie), 0L)
})

test_that("un verrou cassé avec dérive reste une attribution non fatale (#1118)", {
  l <- lock_test()
  digests <- list(osm_reseaux = digest_de(l, "osm_reseaux"))
  digests$osm_reseaux$sha256 <- paste(rep("b", 64), collapse = "")
  sortie <- tempfile("sortie-verrou-drive-")
  dir.create(sortie)
  on.exit(unlink(sortie, recursive = TRUE), add = TRUE)
  a <- verifier_avec_attribution(
    verifier = function(x) verifier_egale(40, 42, "un verrou"),
    args = list(x = 1), ids_sources = "osm_reseaux", sortie = sortie,
    digests = digests
  )
  expect_equal(a$type, "drift")
  expect_match(a$verrou, "Verrou « données réelles » cassé — un verrou", fixed = TRUE)
  expect_match(a$message, "dérive de osm_reseaux", fixed = TRUE)
})

test_that("le wrapper rapporte la dérive et la trace dans le rapport de run", {
  l <- lock_test()
  digests <- list(osm_reseaux = digest_de(l, "osm_reseaux"))
  digests$osm_reseaux$sha256 <- paste(rep("b", 64), collapse = "")
  sortie <- tempfile("sortie-attribution-")
  dir.create(sortie)
  on.exit(unlink(sortie, recursive = TRUE))

  resultat <- verifier_avec_attribution(
    verifier = function(x) verifier_egale(40, 42, "valeur"),
    args = list(x = 1),
    ids_sources = "osm_reseaux",
    sortie = sortie,
    digests = digests
  )
  expect_false(isTRUE(resultat))
  a <- lire_attributions(sortie)
  expect_length(a, 1L)
  expect_equal(a[[1]]$type, "drift")
  expect_match(a[[1]]$message, "dérive de osm_reseaux", fixed = TRUE)

  ecrire_rapport_run(
    tibble::tibble(id = "osm_reseaux", mode = "cron", status = "frais"),
    "cron", cible = sortie, timestamp = "2026-11-18T00:00:00Z"
  )
  rapport <- jsonlite::fromJSON(file.path(sortie, "run-report.json"))
  expect_true("attributions" %in% names(rapport))
  message_attr <- if (is.data.frame(rapport$attributions)) {
    rapport$attributions$message[[1L]]
  } else {
    rapport$attributions[[1L]]$message
  }
  expect_match(message_attr, "dérive de osm_reseaux", fixed = TRUE)
})

test_that("le wrapper arrête bruyamment sur une régression de code", {
  l <- lock_test()
  digests <- list(osm_reseaux = digest_de(l, "osm_reseaux"))
  sortie <- tempfile("sortie-regression-")
  dir.create(sortie)
  on.exit(unlink(sortie, recursive = TRUE))

  erreur <- tryCatch(
    verifier_avec_attribution(
      verifier = function(x) {
        verifier_vrai(FALSE, "regression fixture", "42 attendu, 40 obtenu")
      },
      args = list(x = 1), ids_sources = "osm_reseaux",
      sortie = sortie, digests = digests
    ),
    error = function(e) e
  )
  expect_s3_class(erreur, "error")
  expect_match(conditionMessage(erreur),
               "régression de code : entrées identiques, sortie modifiée", fixed = TRUE)
  expect_length(lire_attributions(sortie), 0L)
})

test_that("un verrou qui passe n'écrit aucune attribution", {
  sortie <- tempfile("sortie-ok-")
  dir.create(sortie)
  on.exit(unlink(sortie, recursive = TRUE))
  expect_identical(verifier_avec_attribution(
    verifier = function() TRUE, args = list(),
    ids_sources = "osm_reseaux", sortie = sortie
  ), list())
  expect_length(lire_attributions(sortie), 0L)
})

test_that("le wrapper retourne l'attribution comme valeur de cible", {
  l <- lock_test()
  digests <- list(osm_reseaux = digest_de(l, "osm_reseaux"))
  digests$osm_reseaux$sha256 <- paste(rep("b", 64), collapse = "")
  a <- verifier_avec_attribution(
    verifier = function() verifier_vrai(FALSE, "retour cible"), args = list(),
    ids_sources = "osm_reseaux", sortie = tempfile("sortie-retour-"),
    digests = digests
  )
  expect_type(a, "list")
  expect_equal(a$type, "drift")
  expect_match(a$message, "dérive de osm_reseaux", fixed = TRUE)
  expect_identical(
    verifier_avec_attribution(
      verifier = function() TRUE, args = list(),
      ids_sources = "osm_reseaux", sortie = tempfile("sortie-retour-ok-")
    ),
    list()
  )
})

test_that("les rapports du graphe dépendent des verrous du même run", {
  withr::local_dir(pkgload::pkg_path())
  withr::local_envvar(LUSK_THEMES = "", LUSK_MODE = "full",
                      LUSK_SORTIE = tempfile("sortie-rapport-"),
                      LUSK_CACHE = tempfile("cache-rapport-"))
  edges <- reseau_graphe()$edges
  for (theme in c("economie", "milieux", "mobilite")) {
    verifs <- edges$from[grepl("^verif_", edges$from) &
                           edges$to == paste0("rapport_", theme)]
    expect_true(length(verifs) > 0L, info = theme)
  }
})

test_that("un thème sans verrou n'a aucune dépendance verif_ (#1109)", {
  # `paste0("verif_", character(0))` renvoie "verif_" : le rapport d'un thème
  # sans verrou (Démographie, Habitat) dépendait d'une cible inexistante.
  withr::local_dir(pkgload::pkg_path())
  withr::local_envvar(LUSK_THEMES = "demographie,habitat", LUSK_MODE = "full",
                      LUSK_SORTIE = tempfile("sortie-sans-verif-"),
                      LUSK_CACHE = tempfile("cache-sans-verif-"))
  manifeste <- manifeste_graphe()
  expect_false("verif_" %in% manifeste$name)
  for (theme in c("demographie", "habitat")) {
    commande <- manifeste$command[manifeste$name == paste0("rapport_", theme)]
    expect_false(grepl("verif_", commande, fixed = TRUE), info = theme)
  }
})

test_that("les ids d'entrée de la REGISTRE sont extraits correctement", {
  spec_args <- list(slug = "x", verifier = function() TRUE,
                    args = list(fichier = "consoenaf", base_epci = "epci"))
  expect_equal(sources_verification(spec_args), "consoenaf")
  spec_brut <- list(slug = "y", verifier = function() TRUE, sur_brut = TRUE,
                    args = list(base_epci = "epci"))
  expect_setequal(sources_verification(spec_brut, MANIFEST_ECONOMIE),
                  MANIFEST_ECONOMIE$id)
})
