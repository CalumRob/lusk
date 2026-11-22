# Digests de run : UNE empreinte par source (issue #1103, revue) ----------------

enregistrement <- function(id, sha) {
  list(source_id = id, url = "https://example.invalid/x", sha256 = sha,
       bytes = 10, acquired_at = "2026-11-18", vintage_basis = "telechargement",
       vintage = "2026-11", date_reference = "2026-11-18")
}

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

test_that("la cible digests_run projette les ids courants, pas tout le cache", {
  racine <- pkgload::pkg_path()
  withr::local_dir(racine)
  withr::local_envvar(LUSK_THEMES = "", LUSK_MODE = "full",
                      LUSK_SORTIE = tempfile("sortie-digests-"),
                      LUSK_CACHE = tempfile("cache-digests-"))
  commandes <- targets::tar_manifest()$command
  ligne <- grep("ecrire_digests_source", commandes, value = TRUE)
  expect_true(length(ligne) > 0L)
  expect_true(any(grepl("filtrer_digests_ids", ligne)))
  expect_true(any(grepl("ids_digests_publication", ligne)))
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
