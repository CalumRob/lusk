# DB-free proofs of the CLI entry functions and of the rollout gaps (#1142).

test_that("adopt and apply take the same service options with the same defaults", {
  adopt <- formals(commande_publication_adopt)
  apply <- formals(commande_publication_apply)
  communes <- c("root", "lock", "registre", "con", "receipts_dir", "commit_sha", "out")
  expect_true(all(communes %in% names(adopt)))
  expect_true(all(communes %in% names(apply)))
  for (nom in communes)
    expect_identical(deparse(adopt[[nom]]), deparse(apply[[nom]]), info = nom)
  # The lock/registre defaults are NULL: the shared lire_lock() / session seam decide.
  expect_null(adopt$lock); expect_null(adopt$registre); expect_null(adopt$con)
  # listing uses the same lock / registre / con options too.
  listing <- formals(commande_publication_listing)
  for (nom in c("lock", "registre", "con"))
    expect_identical(deparse(listing[[nom]]), deparse(adopt[[nom]]), info = nom)
})

test_that("the dispatcher routes arguments to the entry functions and refuses unknown commands", {
  expect_error(executer_commande_publication(character()), "Usage: Rscript")
  expect_error(executer_commande_publication("bogus"), "Usage: Rscript")
  vu <- NULL
  local_mocked_bindings(adopter_ressources = function(sortie, dry_run, ...) {
    vu <<- list(sortie = sortie, dry_run = dry_run, ...)
    list(adopted = character(), comparaisons = data.frame(ressource = "a", forme = "scalar",
      version = "v", identique = TRUE, motif = NA_character_, parties = "",
      stringsAsFactors = FALSE), receipts = list())
  })
  sortie <- capture.output(executer_commande_publication(
    c("adopt", "/chemin/sortie", "--dry-run"), root = "/r", lock = "/l", registre = list(x = 1),
    con = "con", commit_sha = "sha"))
  expect_identical(vu$sortie, "/chemin/sortie")
  expect_true(vu$dry_run)
  expect_identical(vu$root, "/r"); expect_identical(vu$lock, "/l")
  expect_identical(vu$registre, list(x = 1)); expect_identical(vu$con, "con")
  expect_identical(vu$commit_sha, "sha")
  expect_true(any(grepl("adoption=match", sortie)))
  expect_error(executer_commande_publication(c("adopt")), "Usage")
  expect_error(executer_commande_publication(c("adopt", "s", "--oups")), "Usage")
  expect_error(executer_commande_publication(c("adopt", "s", "--dry-run", "x")), "Usage")
})

test_that("listing reads the registry read-only through the shared seam and plan can consume it", {
  statements <- character()
  local_mocked_bindings(
    dbWithTransaction = function(conn, code, ...) force(code),
    dbExecute = function(conn, statement, ...) { statements <<- c(statements, statement); 0L },
    dbGetQuery = function(conn, statement, params = NULL, ...) {
      statements <<- c(statements, statement)
      data.frame(ressource = c("a", "b"), forme = c("scalar", "scalar"),
                 version = c("va", "vb"), retired = c(FALSE, TRUE), stringsAsFactors = FALSE)
    }, .package = "DBI")
  con <- structure(list(), class = "mock")
  json <- capture.output(commande_publication_listing("listing", con = con))
  expect_match(statements[[1L]], "SET TRANSACTION READ ONLY", fixed = TRUE)
  expect_false(any(grepl("^(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE)", statements)))
  fichier <- tempfile(fileext = ".json"); on.exit(unlink(fichier), add = TRUE)
  writeLines(json, fichier)
  listing <- lire_listing_live_fichier(fichier)
  expect_identical(listing$ressource, c("a", "b"))
  expect_identical(listing$version, c("va", "vb"))
  expect_identical(version_live_ressource("b", listing), "vb")

  # The seam is the ONLY connection owner: it must be what listing goes through.
  expect_true(grepl("avec_session_service_publication\\(",
    paste(deparse(lister_registre_publication), collapse = "\n")))
  # An empty registry prints a listing the plan reader treats as "not adopted".
  local_mocked_bindings(dbGetQuery = function(conn, statement, params = NULL, ...)
    data.frame(ressource = character(), forme = character(), version = character(),
               retired = logical()), .package = "DBI")
  vide <- capture.output(commande_publication_listing("listing", con = con))
  writeLines(vide, fichier)
  expect_null(lire_listing_live_fichier(fichier))
})

test_that("plan stays offline: it never opens a connection and reads a listing FILE", {
  corps <- paste(deparse(commande_publication_plan), collapse = "\n")
  expect_false(grepl("dbConnect|DBI::|RPostgres|avec_session", corps))
  expect_identical(formals(commande_publication_plan)$live,
                   quote(Sys.getenv("LUSK_LIVE_LISTING", unset = "")))
})

test_that("a sortie without AEDAR files or manifest refuses the aedar resource with a typed reason", {
  builds <- function(...) data.frame(ressource = c(...), forme = rep("scalar", length(c(...))),
                                     version = "v", stringsAsFactors = FALSE)
  sans <- refus_aedar_adoption(builds("a"), list(a = list()))
  expect_identical(sans$motif, "aedar_canonique_absent")
  expect_false(sans$identique)
  expect_identical(sans$ressource, "aedar")
  expect_match(sans$parties, "aedar_canonique_absent", fixed = TRUE)

  avec <- data.frame(ressource = c("a", "aedar"), forme = c("scalar", "aedar"),
                     version = "v", stringsAsFactors = FALSE)
  sans_manifeste <- refus_aedar_adoption(avec, list(a = list(),
    aedar = list(contenu = list(comparison = NULL))))
  expect_identical(sans_manifeste$motif, "aedar_manifeste_absent")
  expect_match(sans_manifeste$parties, NOM_MANIFESTE_COMPARAISON_AEDAR, fixed = TRUE)

  expect_null(refus_aedar_adoption(avec, list(a = list(),
    aedar = list(contenu = list(comparison = list(groups = data.frame()))))))
})

test_that("adopter_ressources refuses a sortie lacking AEDAR before any connection or write", {
  for (cas in c("fichiers", "manifeste")) {
    builds <- if (cas == "fichiers")
      data.frame(ressource = "a", forme = "scalar", version = "v", stringsAsFactors = FALSE) else
      data.frame(ressource = c("a", "aedar"), forme = c("scalar", "aedar"), version = "v",
                 stringsAsFactors = FALSE)
    artefacts <- list(a = list(), aedar = list(contenu = list(comparison = NULL)))
    connecte <- FALSE
    local_mocked_bindings(
      splitter_sortie = function(...) builds,
      charger_artefacts_construits = function(...) artefacts,
      avec_session_service_publication = function(...) { connecte <<- TRUE; NULL },
      adopter_artefacts = function(...) { connecte <<- TRUE; NULL })
    err <- tryCatch(adopter_ressources("/sortie"), error = identity)
    expect_s3_class(err, "erreur_adoption")
    expect_identical(err$refus, if (cas == "fichiers") "aedar_canonique_absent" else
                                 "aedar_manifeste_absent", info = cas)
    expect_false(err$comparaisons$identique, info = cas)
    expect_false(connecte, info = cas)
  }
})

test_that("a real sortie directory without AEDAR canonical files locates nothing", {
  sortie <- tempfile("sortie-sans-aedar-"); dir.create(sortie)
  on.exit(unlink(sortie, recursive = TRUE), add = TRUE)
  withr::local_envvar(LUSK_AEDAR_CANONICAL_DIR = file.path(sortie, "nulle-part"))
  expect_null(localiser_aedar_sortie(sortie))
  expect_null(lire_projection_aedar_sortie(sortie))
})
