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

test_that("le garde accepte des empreintes exactement conformes au lock", {
  expect_true(verifier_gel_release(digests = digests_conformes()))
})

test_that("une empreinte modifiée refuse avec zéro écriture", {
  d <- digests_conformes()
  d[[1]]$sha256 <- paste(rep("f", 64), collapse = "")
  erreur <- tryCatch(verifier_gel_release(digests = d), error = function(e) e)
  expect_s3_class(erreur, "error")
  expect_match(conditionMessage(erreur), "publication refusée, zéro écriture", fixed = TRUE)
  expect_match(conditionMessage(erreur), "dérive de", fixed = TRUE)
  expect_match(conditionMessage(erreur), "relock requis", ignore.case = TRUE)
})

test_that("une source sans référence refuse avec zéro écriture", {
  d <- c(digests_conformes(), list(list(source_id = "inconnu", sha256 = paste(rep("a", 64), collapse = ""))))
  erreur <- tryCatch(verifier_gel_release(digests = d), error = function(e) e)
  expect_s3_class(erreur, "error")
  expect_match(conditionMessage(erreur), "aucune référence pour 'inconnu'", fixed = TRUE)
})

test_that("une source verrouillée absente du run refuse aussi", {
  d <- digests_conformes()
  d <- d[-1]
  erreur <- tryCatch(verifier_gel_release(digests = d), error = function(e) e)
  expect_s3_class(erreur, "error")
  expect_match(conditionMessage(erreur), "empreinte absente", fixed = TRUE)
})

test_that("sans source-digests.json, le garde refuse avec zéro écriture", {
  sortie <- tempfile("sortie-sans-digests-")
  dir.create(sortie)
  on.exit(unlink(sortie, recursive = TRUE))
  erreur <- tryCatch(verifier_gel_release(sortie), error = function(e) e)
  expect_s3_class(erreur, "error")
  expect_match(conditionMessage(erreur), "absent", fixed = TRUE)
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

test_that("chaque point d'entrée de publication appelle le garde", {
  racine <- normalizePath(testthat::test_path("..", ".."))
  for (entree in ENTRY_POINTS_GEL_RELEASE) {
    chemin <- file.path(racine, entree$file)
    expect_true(file.exists(chemin), info = entree$file)
    source <- paste(readLines(chemin, warn = FALSE), collapse = "\n")
    expect_true(grepl("verifier_gel_release", source, fixed = TRUE),
                info = paste(entree$file, entree$why))
  }
  # Le target LUSK_PUBLISH_DB passe bien par le point d'entrée gardé.
  cible <- paste(readLines(file.path(racine, "_targets.R"), warn = FALSE),
                 collapse = "\n")
  expect_true(grepl("LUSK_PUBLISH_DB", cible, fixed = TRUE))
  expect_true(grepl("publish_retained_backend_from_parquet", cible, fixed = TRUE))
  expect_true(grepl("publier_declared_profiles_postgres", cible, fixed = TRUE))
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
