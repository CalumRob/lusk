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
