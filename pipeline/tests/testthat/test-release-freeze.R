# Gel de release (issue #1103) ---------------------------------------------------
# Une publication refuse avec ZÉRO écriture dès qu'une empreinte du run ne
# correspond pas au lockfile. Un build cron/static n'appelle jamais ce garde.

digests_conformes <- function() {
  l <- lire_lock()
  stats::setNames(lapply(names(l), function(id) {
    e <- l[[id]]
    list(source_id = id, sha256 = e$sha256, bytes = e$bytes,
         acquired_at = e$acquired_at, vintage_basis = e$vintage_basis,
         vintage = e$vintage, date_reference = e$date_reference)
  }), names(l))
}

test_that("le garde exige le répertoire réellement publié", {
  # `sortie` est REQUIS : aucun défaut LUSK_SORTIE / ../public/data implicite —
  # un script doit nommer exactement le dossier qu'il lit et publie.
  expect_error(
    verifier_gel_release(digests = digests_conformes()),
    "sortie"
  )
})

test_that("le garde accepte des empreintes exactement conformes au lock", {
  expect_true(verifier_gel_release(tempdir(), digests = digests_conformes()))
})

test_that("une empreinte modifiée refuse avec zéro écriture", {
  d <- digests_conformes()
  d[[1]]$sha256 <- paste(rep("f", 64), collapse = "")
  erreur <- tryCatch(verifier_gel_release(tempdir(), digests = d), error = function(e) e)
  expect_s3_class(erreur, "error")
  expect_match(conditionMessage(erreur), "publication refusée, zéro écriture", fixed = TRUE)
  expect_match(conditionMessage(erreur), "dérive de", fixed = TRUE)
  expect_match(conditionMessage(erreur), "relock requis", ignore.case = TRUE)
})

test_that("une source sans référence refuse avec zéro écriture", {
  d <- c(digests_conformes(), list(list(source_id = "inconnu", sha256 = paste(rep("a", 64), collapse = ""))))
  erreur <- tryCatch(verifier_gel_release(tempdir(), digests = d), error = function(e) e)
  expect_s3_class(erreur, "error")
  expect_match(conditionMessage(erreur), "aucune référence pour 'inconnu'", fixed = TRUE)
})

test_that("le garde couvre les publications Programmes (#1109)", {
  # Les six sources du manifeste complet sont lues par le run complet ; dès
  # qu'elles sont verrouillées, leur absence ou leur dérive dans le fichier
  # publié doit refuser la publication, comme toute autre source.
  ids <- MANIFEST_PROGRAMMES_COMPLET$id
  sha <- paste(rep("a", 64), collapse = "")
  registre <- stats::setNames(lapply(ids, function(id) {
    list(source_id = id, url = "https://example.invalid/x", sha256 = sha,
         bytes = 10, acquired_at = "2026-11-22", vintage_basis = "telechargement",
         vintage = "2026-11", date_reference = "2026-11-22")
  }), ids)
  digests <- stats::setNames(lapply(ids, function(id) {
    e <- registre[[id]]
    list(source_id = id, sha256 = e$sha256, bytes = e$bytes,
         acquired_at = e$acquired_at, vintage_basis = e$vintage_basis,
         vintage = e$vintage, date_reference = e$date_reference)
  }), ids)

  sortie <- tempfile("sortie-gel-programmes-")
  lock <- tempfile("lock-gel-programmes-")
  dir.create(sortie)
  on.exit(unlink(c(sortie, lock), recursive = TRUE), add = TRUE)
  ecrire_lock(registre, lock)

  ecrire_digests_source(digests[-1], file.path(sortie, NOM_DIGESTS))
  erreur <- tryCatch(verifier_gel_release(sortie, lock = lock), error = function(e) e)
  expect_s3_class(erreur, "erreur_gel_release")
  expect_identical(erreur$raison, "empreinte_absente")
  expect_true(grepl(ids[[1L]], conditionMessage(erreur), fixed = TRUE))

  digests[[2L]]$sha256 <- paste(rep("f", 64), collapse = "")
  ecrire_digests_source(digests, file.path(sortie, NOM_DIGESTS))
  erreur <- tryCatch(verifier_gel_release(sortie, lock = lock), error = function(e) e)
  expect_s3_class(erreur, "erreur_gel_release")
  expect_identical(erreur$raison, "derive")
  expect_true(grepl(ids[[2L]], conditionMessage(erreur), fixed = TRUE))
})

test_that("une source verrouillée absente du run refuse aussi", {
  d <- digests_conformes()
  d <- d[-1]
  erreur <- tryCatch(verifier_gel_release(tempdir(), digests = d), error = function(e) e)
  expect_s3_class(erreur, "error")
  expect_match(conditionMessage(erreur), "empreinte absente", fixed = TRUE)
})

test_that("sans source-digests.json, le garde refuse avec une raison nommée", {
  sortie <- tempfile("sortie-sans-digests-")
  dir.create(sortie)
  on.exit(unlink(sortie, recursive = TRUE))
  erreur <- tryCatch(verifier_gel_release(sortie), error = function(e) e)
  expect_s3_class(erreur, "erreur_gel_release")
  expect_identical(erreur$raison, "digests_absents")
  expect_match(conditionMessage(erreur), "absent", fixed = TRUE)
})

test_that("le flux opérateur build -> relock -> commit -> publish est accepté", {
  # L'empreinte est écrite PAR LE RUN, puis le lockfile est reconstruit DEPUIS
  # ces empreintes et commité : le lockfile est donc nécessairement PLUS RÉCENT
  # que le source-digests.json du run publié. Ce n'est PAS une péremption.
  sortie <- tempfile("sortie-flux-operateur-")
  dir.create(sortie)
  on.exit(unlink(sortie, recursive = TRUE))
  digests <- digests_conformes()
  ecrire_digests_source(digests, file.path(sortie, NOM_DIGESTS))

  run_dir <- tempfile("run-operateur-")
  dir.create(run_dir)
  on.exit(unlink(run_dir, recursive = TRUE), add = TRUE)
  ecrire_digests_source(digests, file.path(run_dir, NOM_DIGESTS))
  lock <- tempfile("lock-relock-operateur-")
  relock_sources(run_dir, lock = lock)

  # Le lockfile vient d'être écrit (mtime plus récent) : le garde doit passer.
  expect_true(file.mtime(lock) > file.mtime(file.path(sortie, NOM_DIGESTS)))
  expect_true(verifier_gel_release(sortie, lock = lock))
  # Un checkout/merge peut aussi toucher le mtime du lockfile — sans effet.
  Sys.setFileTime(lock, as.POSIXct("2030-01-01T00:00:00", tz = "UTC"))
  expect_true(verifier_gel_release(sortie, lock = lock))
})

test_that("le target de publication dépend de digests_run (empreintes du run)", {
  racine <- pkgload::pkg_path()
  withr::local_dir(racine)
  withr::local_envvar(
    LUSK_THEMES = "", LUSK_PUBLISH_DB = "1", LUSK_PUBLISH_PROFILE = "1",
    LUSK_MODE = "full",
    LUSK_SORTIE = tempfile("sortie-graphe-"),
    LUSK_CACHE = tempfile("cache-graphe-")
  )
  manifeste <- manifeste_graphe()
  expect_true("digests_run" %in% manifeste$name)
  # A command reference is a tracked targets dependency; asserting it directly
  # avoids rebuilding the full network for this publication-edge contract.
  for (cible in c("publie_backend_retained", "publie_profiles_declares")) {
    commande <- manifeste$command[manifeste$name == cible]
    expect_true(grepl("digests_run", commande, fixed = TRUE), info = cible)
  }
})

test_that("le point d'entrée retained refuse avant toute connexion DB", {
  sortie <- tempfile("sortie-gel-")
  dir.create(sortie)
  on.exit(unlink(sortie, recursive = TRUE))
  d <- digests_conformes()
  d[[1]]$sha256 <- paste(rep("9", 64), collapse = "")
  ecrire_digests_source(d, file.path(sortie, NOM_DIGESTS))
  appels_connect <- 0L
  local_mocked_bindings(
    dbConnect = function(...) { appels_connect <<- appels_connect + 1L; stop("connexioninterdite") },
    .package = "DBI"
  )
  erreur <- tryCatch(
    publish_retained_backend_from_parquet(sortie),
    error = function(e) e
  )
  expect_s3_class(erreur, "error")
  expect_match(conditionMessage(erreur), "zéro écriture", fixed = TRUE)
  expect_identical(appels_connect, 0L)
})

test_that("chaque ouverture de connexion de service est gardée (audit structurel)", {
  racine <- normalizePath(testthat::test_path("..", ".."))
  sites <- auditer_appels_db(racine)
  expect_true(nrow(sites) > 0L)
  # Aucune faute : tout appel non autorisé porte un garde dans son bloc.
  expect_equal(nrow(sites[!sites$garde & !sites$autorise, , drop = FALSE]), 0L)
  # Les exceptions sont toutes documentées (jamais une raison vide).
  expect_false(any(sites$autorise & !nzchar(sites$raison)))
  # Le chemin LUSK_SCALAR_SCOPE est couvert par le garde à l'ouverture.
  scope <- sites[grepl("publish_postgres_configuration", sites$fichier), ]
  expect_true(any(scope$garde))
})

test_that("aucun appel au garde n'omet le répertoire à contrôler", {
  racine <- normalizePath(testthat::test_path("..", ".."))
  sites <- auditer_appels_garde(racine)
  expect_true(nrow(sites) > 0L)
  expect_equal(nrow(sites[sites$sans_argument, , drop = FALSE]), 0L)
})

test_that("l'audit des appels au garde échoue sur un appel sans argument (preuve)", {
  d <- tempfile("audit-garde-")
  dir.create(file.path(d, "R"), recursive = TRUE)
  writeLines(c("foo <- function() {", "  verifier_gel_release()", "}"),
             file.path(d, "R", "unguarded.R"))
  expect_error(verifier_structure_garde(d), "without an explicit sortie")
})

test_that("publish-serving-tables lit et garde le même répertoire", {
  racine <- normalizePath(testthat::test_path("..", ".."))
  script <- paste(readLines(
    file.path(racine, "scripts", "publish-serving-tables.R"), warn = FALSE
  ), collapse = "\n")
  # Un seul `sortie` est calculé et servi au lecteur ET au garde — y compris
  # pour --series-publish, qui lisait auparavant un chemin codé en dur.
  expect_true(grepl("sortie <- Sys.getenv\\(\"LUSK_SORTIE\"", script))
  expect_true(grepl("read_conso_enaf_series_projection\\(sortie\\)", script))
  expect_false(grepl("read_conso_enaf_series_projection\\(file.path\\(\"\\.\\.\"", script))
  expect_true(all(grepl("verifier_gel_release\\(sortie\\)",
                        unlist(regmatches(script, gregexpr("verifier_gel_release\\([^)]*\\)", script))))))
})

test_that("l'audit structurel échoue sur une connexion non gardée (preuve)", {
  d <- tempfile("audit-gel-")
  dir.create(file.path(d, "R"), recursive = TRUE)
  writeLines(c(
    "foo <- function(con) {",
    "  con <- DBI::dbConnect(RPostgres::Postgres(), dbname = 'lusk')",
    "}"
  ), file.path(d, "R", "unguarded.R"))
  sites <- auditer_appels_db(d)
  expect_true(any(grepl("unguarded\\.R", sites$fichier)))
  expect_true(any(!sites$garde & !sites$autorise))
  expect_error(verifier_structure_gel(d), "without a freeze guard")
})

test_that("le chemin LUSK_SCALAR_SCOPE refuse avant toute écriture", {
  sortie <- tempfile("sortie-scope-gel-")
  dir.create(sortie)
  on.exit(unlink(sortie, recursive = TRUE))
  d <- digests_conformes()
  d[[1]]$sha256 <- paste(rep("7", 64), collapse = "")
  ecrire_digests_source(d, file.path(sortie, NOM_DIGESTS))
  appels <- 0L
  local_mocked_bindings(
    dbConnect = function(...) { appels <<- appels + 1L; stop("connexion interdite") },
    .package = "DBI"
  )
  withr::local_envvar(LUSK_SCALAR_SCOPE = "supply:供给")
  erreur <- tryCatch(
    publish_retained_backend_from_parquet(sortie),
    error = function(e) e
  )
  expect_s3_class(erreur, "erreur_gel_release")
  expect_identical(appels, 0L)
})

test_that("les chemins cron/fixture n'appellent pas le garde", {
  # Les publication `--*-fixture-*` ciblent une base lusk_it_* jetable, pas la
  # base de service : elles ne sont pas des points d'entrée de release.
  racine <- normalizePath(testthat::test_path("..", ".."))
  script <- paste(readLines(
    file.path(racine, "scripts", "publish-serving-tables.R"), warn = FALSE
  ), collapse = "\n")
  expect_true(grepl("--scalar-fixture-publish", script, fixed = TRUE))
  expect_true(grepl("lusk_it_", script, fixed = TRUE))
})
