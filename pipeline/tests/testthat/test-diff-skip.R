# diff-and-skip ---------------------------------------------------------------
# Issue #10, ADR-0004 : le helper du workflow décide s'il y a quelque chose à
# publier — le workflow ne committe que si la donnée a changé (« rien à
# publier » sinon). Décision par contenu (md5), jamais par date : deux runs
# identiques produisent des fichiers identiques.

test_that("un payload identique n'a rien à publier", {
  payload <- compute_payload(load_fixture())
  a <- tempfile("pub-a-")
  b <- tempfile("pub-b-")
  on.exit({ unlink(a, recursive = TRUE); unlink(b, recursive = TRUE) })

  publish(payload, a)
  publish(payload, b)

  expect_false(detecter_changement(a, b))
})

test_that("une valeur changée est à publier", {
  payload <- compute_payload(load_fixture())
  a <- tempfile("pub-a-")
  b <- tempfile("pub-b-")
  on.exit({ unlink(a, recursive = TRUE); unlink(b, recursive = TRUE) })

  publish(payload, a)
  publish(payload, b)
  # on change la valeur d'un indicateur dans b, puis on relit le parquet
  indicateurs <- nanoparquet::read_parquet(file.path(b, "indicateurs.parquet"))
  indicateurs$value[1] <- indicateurs$value[1] + 1
  nanoparquet::write_parquet(indicateurs, file.path(b, "indicateurs.parquet"))

  expect_true(detecter_changement(a, b))
})

test_that("le rapport de run n'entre pas dans la décision commit/skip", {
  # deux runs identiques mais des rapports à des horodatages différents : rien
  # à publier — le rapport change à chaque run, pas la donnée. Le rapport est
  # committé avec le payload quand celui-ci change.
  statuts <- tibble::tibble(
    id = "serie_historique", mode = "cron", status = "frais"
  )
  payload <- compute_payload(load_fixture())
  a <- tempfile("pub-a-")
  b <- tempfile("pub-b-")
  on.exit({ unlink(a, recursive = TRUE); unlink(b, recursive = TRUE) })

  publish(payload, a)
  publish(payload, b)
  ecrire_rapport_run(statuts, "cron", a, timestamp = "2026-08-03T10:00:00Z")
  ecrire_rapport_run(statuts, "cron", b, timestamp = "2026-08-03T11:00:00Z")

  expect_false(detecter_changement(a, b))
})

test_that("un fichier absent d'un seul côté est un changement", {
  payload <- compute_payload(load_fixture())
  a <- tempfile("pub-a-")
  b <- tempfile("pub-b-")
  on.exit({ unlink(a, recursive = TRUE); unlink(b, recursive = TRUE) })

  publish(payload, a)
  publish(payload, b)
  # on supprime un fichier du payload dans b : les ensembles diffèrent
  unlink(file.path(b, "territoires.parquet"))

  expect_true(detecter_changement(a, b))
})

test_that("deux dossiers vides n'ont rien à publier", {
  a <- tempfile("pub-a-")
  b <- tempfile("pub-b-")
  dir.create(a)
  dir.create(b)
  on.exit({ unlink(a, recursive = TRUE); unlink(b, recursive = TRUE) })

  expect_false(detecter_changement(a, b))
})
