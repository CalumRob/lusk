test_that("publish(backend = 'parquet') écrit le payload en parquet, lisible en retour", {
  payload <- compute_payload(load_fixture())
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))

  publish(payload, cible, backend = "parquet")

  indicateurs <- nanoparquet::read_parquet(
    file.path(cible, "indicateurs_demographie.parquet"))
  histoires <- nanoparquet::read_parquet(
    file.path(cible, "histoires_demographie.parquet"))
  territoires <- nanoparquet::read_parquet(
    file.path(cible, "territoires.parquet"))
  expect_equal(nrow(indicateurs), nrow(payload$indicateurs))
  expect_equal(nrow(histoires), nrow(payload$histoires))
  expect_equal(nrow(territoires), nrow(payload$territoires))
  expect_equal(indicateurs$value, payload$indicateurs$value)
  expect_equal(histoires$classification, payload$histoires$classification)
  # la référence porte les noms — c'est elle que l'app joint
  expect_equal(territoires$nom, payload$territoires$nom)
  # le backend local historique : parquet seul, pas de projection JSON
  expect_false(file.exists(file.path(cible, "indicateurs_demographie.json")))
})

test_that("le backend par défaut est 'static' vers le home public du payload", {
  # issue #10, ADR-0004 : la cible par défaut est public/data/ à la racine du
  # dépôt — le cron écrit là où Pages et l'app lisent, sans réglage.
  expect_equal(formals(publish)$cible, "public/data")
  expect_equal(formals(publish)$backend, "static")
})

test_that("publish(backend = 'static') écrit parquet + JSON des trois tables", {
  payload <- compute_payload(load_fixture())
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))

  publish(payload, cible)

  for (nom in c("indicateurs_demographie", "histoires_demographie",
                "territoires")) {
    expect_true(file.exists(file.path(cible, paste0(nom, ".parquet"))), info = nom)
    expect_true(file.exists(file.path(cible, paste0(nom, ".json"))), info = nom)
  }
})

test_that("le JSON se relit exactement comme les tables parquet — dérive impossible", {
  # issue #10, ADR-0004 : les deux sérialisations sortent des mêmes tables en
  # mémoire ; ce test lit chacune en retour et verrouille l'égalité colonne
  # pour colonne, valeur pour valeur (bit à bit). Si l'une des deux dérive,
  # le test casse — c'est le contrat de non-dérive. Issue #13 : le contrat
  # couvre le nouveau layout — faits par thème + référence partagée.
  payload <- compute_payload(load_fixture())
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))

  publish(payload, cible)

  for (nom in c("indicateurs_demographie", "histoires_demographie",
                "territoires")) {
    parquet <- nanoparquet::read_parquet(file.path(cible, paste0(nom, ".parquet")))
    json <- jsonlite::fromJSON(file.path(cible, paste0(nom, ".json")))
    # colonne pour colonne : le même ordre, les mêmes noms
    expect_identical(names(json), names(parquet), info = nom)
    expect_equal(nrow(json), nrow(parquet), info = nom)
    # valeur pour valeur. Les colonnes numériques sont comparées en double
    # (as.numeric) : le texte JSON d'un entier relu par jsonlite est un
    # entier (70) quand le parquet le relit en double (70) — une
    # différence de STOCKAGE, pas de valeur ; en double, l'aller-retour à
    # digits = 17 est bit à bit identique.
    for (col in names(parquet)) {
      if (is.numeric(parquet[[col]])) {
        expect_identical(as.numeric(json[[col]]), as.numeric(parquet[[col]]),
                         info = paste(nom, col))
      } else {
        expect_identical(json[[col]], parquet[[col]], info = paste(nom, col))
      }
    }
  }
})

test_that("la publication est par thème : le thème du payload nomme les fichiers", {
  # issue #13 : les faits partent en indicateurs_<theme> / histoires_<theme>,
  # la référence des territoires est partagée (territoires, un seul fichier).
  # Les noms génériques d'avant l'issue #13 ne sont plus écrits.
  payload <- compute_payload(load_fixture())
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))

  publish(payload, cible)

  expect_true(file.exists(file.path(cible, "indicateurs_demographie.parquet")))
  expect_true(file.exists(file.path(cible, "histoires_demographie.parquet")))
  expect_true(file.exists(file.path(cible, "territoires.parquet")))
  expect_false(file.exists(file.path(cible, "indicateurs.parquet")))
  expect_false(file.exists(file.path(cible, "histoires.parquet")))
})

test_that("un payload d'un autre thème écrit les fichiers de CE thème", {
  # le thème se lit sur le payload (la colonne `theme` des faits) : le même
  # publish sert Habitat sans changer de code — les thèmes ne se marchent
  # jamais dessus.
  payload <- compute_payload(load_fixture())
  payload$indicateurs$theme <- "habitat"
  payload$histoires$theme <- "habitat"
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))

  publish(payload, cible)

  expect_true(file.exists(file.path(cible, "indicateurs_habitat.parquet")))
  expect_true(file.exists(file.path(cible, "histoires_habitat.parquet")))
  expect_false(file.exists(file.path(cible, "indicateurs_demographie.parquet")))
})

test_that("publish est un upsert : relancer écrase sans dupliquer", {
  payload <- compute_payload(load_fixture())
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))

  publish(payload, cible)
  publish(payload, cible) # idempotent

  indicateurs <- nanoparquet::read_parquet(
    file.path(cible, "indicateurs_demographie.parquet"))
  expect_equal(nrow(indicateurs), nrow(payload$indicateurs))
})

test_that("le backend supabase est un seam documenté, pas câblé", {
  payload <- compute_payload(load_fixture())
  expect_error(publish(payload, backend = "supabase"), "supabase")
})

test_that("un backend inconnu s'arrête bruyamment", {
  payload <- compute_payload(load_fixture())
  expect_error(publish(payload, backend = "mongodb"), "n'existe pas")
})
