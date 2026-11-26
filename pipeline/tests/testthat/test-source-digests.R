# Digests de run : UNE empreinte par source (issue #1103, revue) ----------------

enregistrement <- function(id, sha) {
  list(source_id = id, url = "https://example.invalid/x", sha256 = sha,
       bytes = 10, acquired_at = "2026-11-18", vintage_basis = "telechargement",
       vintage = "2026-11", date_reference = "2026-11-18")
}

# Unlike the structural manifest helper (which deliberately substitutes isolated
# paths), this command is evaluated. Bind it once per R session to stable caller
# paths so its embedded cache/sortie arguments are the ones this proof populates.
if (!exists(".lusk_digests_run_session", globalenv(), inherits = FALSE)) {
  session <- local({
    cache <- tempfile("cache-eval-digests-session-")
    sortie <- tempfile("sortie-eval-digests-session-")
    dir.create(cache); dir.create(sortie)
    commande <- withr::with_dir(pkgload::pkg_path(), withr::with_envvar(
      c(LUSK_THEMES = "", LUSK_MODE = "full", LUSK_CACHE = cache, LUSK_SORTIE = sortie),
      targets::tar_manifest(names = "digests_run")$command
    ))
    list(cache = cache, sortie = sortie, commande = commande)
  })
  assign(".lusk_digests_run_session", session, globalenv())
}
.digests_run_session <- get(".lusk_digests_run_session", globalenv(), inherits = FALSE)

test_that("l'agrégat du cache garde une seule empreinte par source_id", {
  cache <- tempfile("cache-aggregate-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))
  ecrire_digests_cache_aggregate(list(a = enregistrement("a", "old"),
                                      b = enregistrement("b", "b1")), cache)
  ecrire_digests_cache_aggregate(list(a = enregistrement("a", "new")), cache)

  agg <- lire_digests_cache_aggregate(cache)
  expect_setequal(names(agg), c("a", "b"))
  expect_identical(agg$a$sha256, "new")  # last wins
  expect_identical(agg$b$sha256, "b1")
})

test_that("une source retirée de tous les manifestes est filtrée du cache agrégé", {
  # Le cache <cache>/source-digests.json survit aux runs : une source retirée
  # ne doit pas rester dans source-digests.json (le garde la refuserait avec
  # `sans_reference`, #1103 revue 2).
  themes <- list(
    theme_demographie(), theme_habitat(), theme_economie(),
    theme_mobilite(), theme_milieux()
  )
  ids <- ids_digests_publication(themes)
  expect_true("serie_historique" %in% ids)
  expect_true("osm_reseaux" %in% ids)
  expect_true(all(paste0("geometrie_", names(NIVEAUX_GEOMETRIE)) %in% ids))

  agg <- list(
    serie_historique = enregistrement("serie_historique", "a"),
    source_retiree = enregistrement("source_retiree", "b"),
    geometrie_communes = enregistrement("geometrie_communes", "c")
  )
  filtre <- filtrer_digests_ids(agg, ids)
  expect_setequal(names(filtre), c("serie_historique", "geometrie_communes"))
})

test_that("aucune commande du graphe ne contient de splice bquote non résolu (#1112)", {
  # `bquote(f(list(..(x))))` sans `splice = TRUE` laisse le nom `..` dans la
  # commande : le target échoue alors avec `could not find function ".."`.
  racine <- pkgload::pkg_path()
  withr::local_dir(racine)
  withr::local_envvar(LUSK_THEMES = "", LUSK_MODE = "full",
                      LUSK_SORTIE = tempfile("sortie-splice-"),
                      LUSK_CACHE = tempfile("cache-splice-"))
  manifeste <- manifeste_graphe()
  expect_false(any(grepl("..(", manifeste$command, fixed = TRUE)))
  commande <- manifeste$command[manifeste$name == "digests_run"]
  # Toute dépendance `sources_*` du target est bien citée dans sa commande —
  # pas seulement dans la liste des dépendances calculée par targets.
  aretes <- reseau_graphe()$edges
  dependances <- aretes$from[aretes$to == "digests_run" &
                               grepl("^sources_", aretes$from)]
  expect_true(length(dependances) >= 8L)
  for (cible in dependances) {
    expect_true(grepl(cible, commande, fixed = TRUE), info = cible)
  }
})

test_that("la commande réelle de digests_run s'évalue et publie tous les ids lus (#1112)", {
  cache <- .digests_run_session$cache
  sortie <- .digests_run_session$sortie

  racine <- pkgload::pkg_path()
  withr::local_dir(racine)
  withr::local_envvar(LUSK_THEMES = "", LUSK_MODE = "full",
                      LUSK_CACHE = cache, LUSK_SORTIE = sortie)
  commande <- .digests_run_session$commande
  # `publier_geometrie` a déjà écrit les trois lectures réseau dans le fichier.
  ecrire_digests_source(stats::setNames(
    lapply(names(LECTURES_RESEAU), function(id) enregistrement(id, paste0("sha-", id))),
    names(LECTURES_RESEAU)
  ), file.path(sortie, NOM_DIGESTS))

  themes <- stats::setNames(
    list(theme_demographie(), theme_habitat(), theme_economie(),
         theme_mobilite(), theme_milieux()),
    c("demographie", "habitat", "economie", "mobilite", "milieux")
  )
  fournir <- stats::setNames(
    c(lapply(themes, function(t) t$manifest$id),
      list(MANIFEST_CLASSES_DENSITE$id, MANIFEST_CLASSES_LITTORAL$id,
           MANIFEST_PROGRAMMES_COMPLET$id)),
    c(paste0("sources_", names(themes)), "sources_classes_densite",
      "sources_classes_littoral", "sources_programmes")
  )
  statut_pour <- function(ids) {
    s <- tibble::tibble(id = ids, mode = "cron", status = "frais")
    attr(s, "digests") <- stats::setNames(
      lapply(ids, function(id) enregistrement(id, paste0("sha-", id))), ids
    )
    s
  }
  environnement <- new.env(parent = environment())
  for (nom in names(fournir)) assign(nom, statut_pour(fournir[[nom]]), envir = environnement)
  assign("geometrie", "geometrie publiee", envir = environnement)

  expression <- parse(text = commande)[[1L]]
  eval(expression, envir = environnement)
  publies <- lire_digests_source(file.path(sortie, NOM_DIGESTS))
  expect_setequal(
    names(publies),
    ids_digests_publication(manifestes = c(
      lapply(themes, function(t) t$manifest),
      list(MANIFEST_CLASSES_DENSITE, MANIFEST_CLASSES_LITTORAL,
           MANIFEST_PROGRAMMES_COMPLET)
    ))
  )
})

test_that("la cible digests_run projette les ids courants, pas tout le cache", {
  racine <- pkgload::pkg_path()
  withr::local_dir(racine)
  withr::local_envvar(LUSK_THEMES = "", LUSK_MODE = "full",
                      LUSK_SORTIE = tempfile("sortie-digests-"),
                      LUSK_CACHE = tempfile("cache-digests-"))
  manifeste <- manifeste_graphe()
  ligne <- manifeste$command[manifeste$name == "digests_run"]
  expect_true(length(ligne) == 1L)
  expect_true(grepl("publier_digests_run", ligne, fixed = TRUE))
})

test_that("les ids attendus couvrent TOUS les manifestes téléchargés par le graphe (#1109)", {
  # Les trois familles oubliées par `ids_digests_publication(THEMES_RUN)` :
  # Programmes (run complet), les deux classifications de la référence et
  # les lectures WFS de géométrie. On les dérive des manifestes réels.
  themes <- list(theme_demographie(), theme_habitat(), theme_economie(),
                 theme_mobilite(), theme_milieux())
  manifestes <- c(
    lapply(themes, function(t) t$manifest),
    list(MANIFEST_CLASSES_DENSITE, MANIFEST_CLASSES_LITTORAL,
         MANIFEST_PROGRAMMES_COMPLET)
  )
  ids <- ids_digests_publication(manifestes = manifestes)
  for (m in manifestes) expect_true(all(m$id %in% ids))
  expect_true(all(paste0("geometrie_", names(NIVEAUX_GEOMETRIE)) %in% ids))
  # Aucune liste maintenue à la main : un id du manifeste est attendu.
  expect_setequal(
    intersect(ids, unlist(lapply(manifestes, function(m) m$id))),
    unique(unlist(lapply(manifestes, function(m) m$id)))
  )
})

test_that("le fichier publié couvre chaque source réellement lue du run (#1109)", {
  cache <- tempfile("cache-couverture-")
  sortie <- tempfile("sortie-couverture-")
  dir.create(cache); dir.create(sortie)
  on.exit(unlink(c(cache, sortie), recursive = TRUE), add = TRUE)

  # Statuts des quatre téléchargements du graphe : thèmes, Programmes,
  # classifications. Le digest de chaque source lue est porté par le statut.
  ids_programmes <- MANIFEST_PROGRAMMES_COMPLET$id
  ids_classes <- c(MANIFEST_CLASSES_DENSITE$id, MANIFEST_CLASSES_LITTORAL$id)
  ids <- c("serie_historique", ids_programmes, ids_classes)
  statut <- function(id) {
    s <- tibble::tibble(id = id, mode = "cron", status = "frais")
    attr(s, "digests") <- stats::setNames(list(enregistrement(id, paste0("sha-", id))), id)
    s
  }
  statuts <- lapply(ids, statut)
  # Les géométries sont écrites par `publier_geometrie` dans le fichier de sortie.
  ecrire_digests_source(stats::setNames(
    lapply(names(LECTURES_RESEAU), function(id) enregistrement(id, paste0("sha-", id))),
    names(LECTURES_RESEAU)
  ), file.path(sortie, NOM_DIGESTS))
  # Un digest périmé d'une source retirée ne doit pas être republié.
  ecrire_digests_cache_aggregate(list(source_retiree = enregistrement("source_retiree", "x")), cache)

  publies <- publier_digests_run(statuts, cache = cache, sortie = sortie)
  expect_setequal(names(publies), c(ids, names(LECTURES_RESEAU)))
  expect_true(all(vapply(publies, function(d) identical(d$vintage_basis, "telechargement"), logical(1))))
  fichier <- lire_digests_source(file.path(sortie, NOM_DIGESTS))
  expect_setequal(names(fichier), c(ids, names(LECTURES_RESEAU)))
})

test_that("les classifications et Programmes sont hachés puis publiés (#1109)", {
  cache <- tempfile("cache-manifestes-")
  sortie <- tempfile("sortie-manifestes-")
  dir.create(cache); dir.create(sortie)
  on.exit(unlink(c(cache, sortie), recursive = TRUE), add = TRUE)

  manifestes <- list(MANIFEST_CLASSES_DENSITE, MANIFEST_CLASSES_LITTORAL,
                     MANIFEST_PROGRAMMES_COMPLET)
  manifest <- dplyr::bind_rows(lapply(manifestes, function(m) {
    m$sha256 <- NA_character_  # les octets synthétiques ne sont pas ceux du manifeste
    m
  }))
  ids <- manifest$id
  local_mocked_bindings(
    telecharger_fichier = function(url, cible) writeLines("octets synthetiques", cible)
  )
  statuts <- download_sources(manifest, cache = cache, mode = "full",
                              horloge = as.Date("2026-11-22"))
  digests <- attr(statuts, "digests")
  expect_setequal(names(digests), ids)
  expect_true(all(vapply(digests, function(d) nzchar(d$vintage_basis), logical(1))))

  ecrire_digests_source(stats::setNames(
    lapply(names(LECTURES_RESEAU), function(id) enregistrement(id, paste0("sha-", id))),
    names(LECTURES_RESEAU)
  ), file.path(sortie, NOM_DIGESTS))
  publies <- publier_digests_run(list(statuts), cache = cache, sortie = sortie)
  expect_setequal(names(publies), c(ids, names(LECTURES_RESEAU)))
})

test_that("une source lue sans empreinte publiée fait échouer digests_run (#1109)", {
  cache <- tempfile("cache-manquant-")
  sortie <- tempfile("sortie-manquant-")
  dir.create(cache); dir.create(sortie)
  on.exit(unlink(c(cache, sortie), recursive = TRUE), add = TRUE)
  s <- tibble::tibble(id = c("acv", "classe_densite_communale"),
                      mode = "cron", status = "frais")
  # `acv` est lue mais son digest n'a pas été enregistré : le contrat échoue.
  attr(s, "digests") <- list(classe_densite_communale = enregistrement("classe_densite_communale", "c"))
  erreur <- tryCatch(publier_digests_run(list(s), cache = cache, sortie = sortie),
                     error = function(e) e)
  expect_s3_class(erreur, "error")
  expect_match(conditionMessage(erreur), "acv", fixed = TRUE)
})

test_that("digests_run dépend de tous les téléchargements du graphe (#1109)", {
  racine <- pkgload::pkg_path()
  withr::local_dir(racine)
  withr::local_envvar(LUSK_THEMES = "", LUSK_MODE = "full",
                      LUSK_SORTIE = tempfile("sortie-graphe-digests-"),
                      LUSK_CACHE = tempfile("cache-graphe-digests-"))
  manifeste <- manifeste_graphe()
  commande <- manifeste$command[manifeste$name == "digests_run"]
  for (cible in c("sources_programmes", "sources_classes_densite",
                  "sources_classes_littoral", "geometrie", "sources_demographie",
                  "sources_habitat", "sources_economie", "sources_mobilite",
                  "sources_milieux")) {
    expect_true(grepl(cible, commande, fixed = TRUE), info = cible)
  }
})

test_that("un run partiel ne dépend pas des téléchargements Programmes (#1109)", {
  racine <- pkgload::pkg_path()
  withr::local_dir(racine)
  withr::local_envvar(LUSK_THEMES = "economie", LUSK_MODE = "cron",
                      LUSK_SORTIE = tempfile("sortie-partielle-digests-"),
                      LUSK_CACHE = tempfile("cache-partielle-digests-"))
  manifeste <- manifeste_graphe()
  commande <- manifeste$command[manifeste$name == "digests_run"]
  expect_false(grepl("sources_programmes", commande, fixed = TRUE))
  expect_true(grepl("sources_classes_densite", commande, fixed = TRUE))
})

test_that("le fichier de run déduplique aussi les ids", {
  p <- tempfile("digests-dedupe-")
  ecrire_digests_source(list(
    x = enregistrement("x", "v1"),
    y = enregistrement("y", "y1"),
    x2 = enregistrement("x", "v2")
  ), p)
  d <- lire_digests_source(p)
  expect_setequal(names(d), c("x", "y"))
  expect_identical(d$x$sha256, "v2")
})
