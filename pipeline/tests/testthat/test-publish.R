test_that("publish(backend = 'parquet') écrit les faits Mobilité en parquet, lisible en retour", {
  # #757 : la Mobilité est le SEUL thème qui conserve ses parquets de faits
  # (indicateurs_<theme> / histoires_<theme>) — l'exception #619. Les cinq
  # autres thèmes passent par les artefacts de service ; leur parquet par-thème
  # est retiré (voir le test dédié plus bas et le contrat de non-dérive).
  payload <- compute_payload(load_fixture())
  payload$indicateurs$theme <- "mobilite"
  payload$histoires$theme <- "mobilite"
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))

  publish(payload, cible, backend = "parquet")

  indicateurs <- nanoparquet::read_parquet(
    file.path(cible, "indicateurs_mobilite.parquet"))
  histoires <- nanoparquet::read_parquet(
    file.path(cible, "histoires_mobilite.parquet"))
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
  expect_false(file.exists(file.path(cible, "indicateurs_mobilite.json")))
})

test_that("publish(backend = 'parquet') n'écrit PAS les parquets de faits d'un thème retiré (#757)", {
  payload <- compute_payload(load_fixture()) # Démographie : thème retiré
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))

  publish(payload, cible, backend = "parquet")

  expect_false(file.exists(file.path(cible, "indicateurs_demographie.parquet")))
  expect_false(file.exists(file.path(cible, "histoires_demographie.parquet")))
  # la référence partagée des territoires est toujours écrite
  expect_true(file.exists(file.path(cible, "territoires.parquet")))
})

test_that("theme_parquet_retire marque les cinq thèmes non-mobilité (#757)", {
  # le prédicat consommé par publish : vrai pour les cinq thèmes dont les
  # parquets de faits par-thème sont retirés, faux pour la Mobilité (#619).
  expect_false(theme_parquet_retire("mobilite"))
  for (theme in c("demographie", "habitat", "economie", "milieux", "programmes")) {
    expect_true(theme_parquet_retire(theme), info = theme)
  }
  # la liste se DÉRIVE du registre canonique des thèmes (THEMES_METADATA) —
  # jamais recopiée : ce contrat échoue si un thème canonique est oublié.
  expect_identical(themes_parquet_retires(), setdiff(THEMES_METADATA, "mobilite"))
  expect_setequal(
    themes_parquet_retires(),
    c("demographie", "habitat", "economie", "milieux", "programmes")
  )
})

test_that("le backend par défaut est 'static' vers le home public du payload", {
  # issue #10, ADR-0004 : la cible par défaut est public/data/ à la racine du
  # dépôt — le cron écrit là où Pages et l'app lisent, sans réglage.
  expect_equal(formals(publish)$cible, "public/data")
  expect_equal(formals(publish)$backend, "static")
})

test_that("publish(backend = 'static') écrit le JSON des faits de tous les thèmes + le parquet partagé", {
  # #757 : les faits des thèmes retirés ne partent plus qu'en JSON ; les tables
  # partagées (territoires, apercu) gardent parquet + JSON.
  payload <- compute_payload(load_fixture())
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))

  publish(payload, cible)

  for (nom in c("indicateurs_demographie", "histoires_demographie")) {
    expect_false(file.exists(file.path(cible, paste0(nom, ".parquet"))), info = nom)
    expect_true(file.exists(file.path(cible, paste0(nom, ".json"))), info = nom)
  }
  for (nom in c("territoires", "apercu")) {
    expect_true(file.exists(file.path(cible, paste0(nom, ".parquet"))), info = nom)
    expect_true(file.exists(file.path(cible, paste0(nom, ".json"))), info = nom)
  }
})

test_that("publish écrit la projection BPE bornée quand le payload la porte", {
  payload <- compute_payload(load_fixture())
  payload$profils_acces_bpe <- tibble::tibble(
    territoire = "22001", type = "commune", profil = "velo-compense",
    profil_libelle = "Le vélo compense", nombre_typequ = 1L,
    exemplar_typequ = "D267",
    exemplar_libelle = "Spécialiste en dermatologie vénéréologie",
    exemplar_c = 0.1, exemplar_b = 0.4, exemplar_t = 0.1
  )
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))

  publish(payload, cible)

  expect_true(file.exists(file.path(cible, "profils_acces_bpe.parquet")))
  expect_true(file.exists(file.path(cible, "profils_acces_bpe.json")))
  parquet <- nanoparquet::read_parquet(file.path(cible, "profils_acces_bpe.parquet"))
  json <- jsonlite::fromJSON(file.path(cible, "profils_acces_bpe.json"))
  verifier_non_derivee(parquet, json, "profils_acces_bpe")
})

# verifier_non_derivee (vivante dans helper-payload.R — partagée avec
# test-run-pipeline-economie.R, issue #131) : le contrat de non-dérive
# (issue #10, ADR-0004).

test_that("le JSON se relit exactement comme les tables en mémoire / parquet — dérive impossible", {
  # issue #10, ADR-0004 : les deux sérialisations sortent des mêmes tables en
  # mémoire. #757 : les faits des thèmes retirés n'écrivent plus de parquet —
  # la projection JSON se compare donc à la table EN MÉMOIRE dont elle est
  # issue (même contrat, même rigueur). Les tables partagées, encore écrites
  # dans les deux formats, se comparent parquet contre JSON.
  payload <- compute_payload(load_fixture())
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))

  publish(payload, cible)

  for (nom in c("territoires", "apercu")) {
    parquet <- nanoparquet::read_parquet(file.path(cible, paste0(nom, ".parquet")))
    json <- jsonlite::fromJSON(file.path(cible, paste0(nom, ".json")))
    verifier_non_derivee(parquet, json, nom)
  }
  verifier_projection_sur_table(
    payload$indicateurs,
    jsonlite::fromJSON(file.path(cible, "indicateurs_demographie.json")),
    "indicateurs_demographie"
  )
  verifier_projection_sur_table(
    payload$histoires,
    jsonlite::fromJSON(file.path(cible, "histoires_demographie.json")),
    "histoires_demographie"
  )
})

test_that("la publication est par thème : le thème du payload nomme les fichiers", {
  # issue #13 : les faits partent en indicateurs_<theme> / histoires_<theme>,
  # la référence des territoires est partagée (territoires, un seul fichier).
  # Les noms génériques d'avant l'issue #13 ne sont plus écrits.
  payload <- compute_payload(load_fixture())
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))

  publish(payload, cible)

  expect_true(file.exists(file.path(cible, "indicateurs_demographie.json")))
  expect_true(file.exists(file.path(cible, "histoires_demographie.json")))
  expect_true(file.exists(file.path(cible, "territoires.json")))
  expect_true(file.exists(file.path(cible, "apercu.json")))
  # #757 : le parquet par-thème est retiré pour un thème non-mobilité
  expect_false(file.exists(file.path(cible, "indicateurs_demographie.parquet")))
  expect_false(file.exists(file.path(cible, "histoires_demographie.parquet")))
  expect_false(file.exists(file.path(cible, "indicateurs.json")))
  expect_false(file.exists(file.path(cible, "histoires.json")))
  # l'Aperçu est partagé entre les thèmes, comme la référence — pas par thème
  expect_false(file.exists(file.path(cible, "apercu_demographie.parquet")))
})

test_that("un payload d'un autre thème écrit les fichiers JSON de CE thème (parquet retiré, #757)", {
  # le thème se lit sur le payload (la colonne `theme` des faits) : le même
  # publish sert Habitat sans changer de code — les thèmes ne se marchent
  # jamais dessus. Habitat étant retiré, seuls ses JSON sont écrits.
  payload <- compute_payload(load_fixture())
  payload$indicateurs$theme <- "habitat"
  payload$histoires$theme <- "habitat"
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))

  publish(payload, cible)

  expect_true(file.exists(file.path(cible, "indicateurs_habitat.json")))
  expect_true(file.exists(file.path(cible, "histoires_habitat.json")))
  expect_false(file.exists(file.path(cible, "indicateurs_habitat.parquet")))
  expect_false(file.exists(file.path(cible, "histoires_habitat.parquet")))
  expect_false(file.exists(file.path(cible, "indicateurs_demographie.json")))
})

test_that("publish est un upsert : relancer écrase sans dupliquer", {
  payload <- compute_payload(load_fixture())
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))

  publish(payload, cible)
  publish(payload, cible) # idempotent

  indicateurs <- jsonlite::fromJSON(file.path(cible, "indicateurs_demographie.json"))
  expect_equal(nrow(indicateurs), nrow(payload$indicateurs))
})

test_that("publish conserve un parquet canonique inchangé", {
  payload <- compute_payload(load_fixture())
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))
  publish(payload, cible, backend = "parquet")
  fichier <- file.path(cible, "territoires.parquet")
  avant <- file.info(fichier)$mtime
  Sys.sleep(1.1)
  publish(payload, cible, backend = "parquet")
  expect_identical(file.info(fichier)$mtime, avant)
})

# issue #19 : le layout par thème s'étend à Habitat ; #757 retire sa
# sérialisation parquet par-thème — les faits partent en JSON seul, la
# référence reste partagée, le contrat de non-dérive couvre les nouveaux JSON.

test_that("le payload Habitat publie les JSON par thème + la référence partagée, sans l'aperçu", {
  # issue #116 : l'Aperçu d'Habitat est vide par design — la table partagée
  # apercu n'est NI écrite NI écrasée par un thème sans aperçu (seul
  # Démographie la peuple ; le test de la sentinelle plus bas verrouille la
  # non-écrasement d'un aperçu existant).
  payload <- payload_habitat()
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))

  publish(payload, cible)

  # #757 : Habitat est un thème retiré — les faits ne partent qu'en JSON
  for (nom in c("indicateurs_habitat", "histoires_habitat")) {
    expect_false(file.exists(file.path(cible, paste0(nom, ".parquet"))), info = nom)
    expect_true(file.exists(file.path(cible, paste0(nom, ".json"))), info = nom)
  }
  expect_true(file.exists(file.path(cible, "territoires.parquet")))
  expect_true(file.exists(file.path(cible, "territoires.json")))
  # aucun fichier Démographie écrit par un run Habitat
  expect_false(file.exists(file.path(cible, "indicateurs_demographie.parquet")))
  expect_false(file.exists(file.path(cible, "histoires_demographie.parquet")))
  # le fichier partagé de l'Aperçu n'existe pas après un run Habitat
  expect_false(file.exists(file.path(cible, "apercu.parquet")))
  expect_false(file.exists(file.path(cible, "apercu.json")))
})

test_that("le JSON Habitat se relit exactement comme les tables en mémoire — dérive impossible", {
  # le contrat de non-dérive (issue #10, ADR-0004) appliqué au payload Habitat :
  # #757 retire le parquet par-thème, la projection JSON se compare donc à la
  # table EN MÉMOIRE dont elle est issue. La colonne nullable `n` (NA pour les
  # stocks, entiers pour DVF/DPE) et les valeurs supprimées (NA) doivent
  # survivre bit à bit à la sérialisation. Issue #116 : l'Aperçu d'Habitat est
  # vide par design — publish ne sérialise la table partagée que si elle porte
  # des lignes.
  payload <- payload_habitat()
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))

  publish(payload, cible)

  verifier_projection_sur_table(
    payload$indicateurs,
    jsonlite::fromJSON(file.path(cible, "indicateurs_habitat.json")),
    "indicateurs_habitat"
  )
  verifier_projection_sur_table(
    payload$histoires,
    jsonlite::fromJSON(file.path(cible, "histoires_habitat.json")),
    "histoires_habitat"
  )
  parquet <- nanoparquet::read_parquet(file.path(cible, "territoires.parquet"))
  json <- jsonlite::fromJSON(file.path(cible, "territoires.json"))
  verifier_non_derivee(parquet, json, "territoires")
})

test_that("publish est un upsert pour le payload Habitat : relancer ne duplique pas", {
  payload <- payload_habitat()
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))

  publish(payload, cible)
  publish(payload, cible) # idempotent

  indicateurs <- jsonlite::fromJSON(file.path(cible, "indicateurs_habitat.json"))
  expect_equal(nrow(indicateurs), nrow(payload$indicateurs))
  histoires <- jsonlite::fromJSON(file.path(cible, "histoires_habitat.json"))
  expect_equal(nrow(histoires), nrow(payload$histoires))
})

# issue #116 : apercu.json est un fichier PARTAGÉ (pas par-thème) — seule la
# table Démographie le peuple. Un thème sans aperçu (Habitat, Économie) ne doit
# NI écrire NI écraser le fichier partagé : la table du payload reste présente
# et vide (le contrat, validate_payload l'exige), publish ne la sérialise que
# lorsqu'elle porte des lignes.

test_that("un thème sans aperçu laisse INTACT l'apercu déjà publié (sentinelle, issue #116)", {
  payload <- payload_habitat() # apercu vide par design
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))
  dir.create(cible)

  # la sentinelle : l'aperçu peuplé qu'un run Démographie aurait publié
  apercu_demo <- compute_payload(load_fixture())$apercu
  jsonlite::write_json(apercu_demo, file.path(cible, "apercu.json"),
                       dataframe = "rows", na = "null",
                       digits = 17, pretty = TRUE)
  nanoparquet::write_parquet(apercu_demo, file.path(cible, "apercu.parquet"))
  octets <- function(fichier) {
    readBin(file.path(cible, fichier), "raw",
            n = file.info(file.path(cible, fichier))$size)
  }
  json_avant <- octets("apercu.json")
  parquet_avant <- octets("apercu.parquet")

  publish(payload, cible)

  # la sentinelle est INTACTE : ni écrasée (par `[]`), ni supprimée
  expect_identical(octets("apercu.json"), json_avant)
  expect_identical(octets("apercu.parquet"), parquet_avant)
})

test_that("un thème sans aperçu ne crée jamais les fichiers partagés apercu (issue #116)", {
  payload <- payload_habitat() # apercu vide par design
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))

  publish(payload, cible)

  # les faits du thème (JSON seul, #757) + la référence partagée sont écrits
  for (nom in c("indicateurs_habitat", "histoires_habitat")) {
    expect_true(file.exists(file.path(cible, paste0(nom, ".json"))), info = nom)
  }
  expect_true(file.exists(file.path(cible, "territoires.parquet")))
  expect_true(file.exists(file.path(cible, "territoires.json")))
  # mais JAMAIS apercu : le fichier partagé ne naît pas d'un thème sans aperçu
  expect_false(file.exists(file.path(cible, "apercu.parquet")))
  expect_false(file.exists(file.path(cible, "apercu.json")))
})

test_that("le backend supabase est un seam documenté, pas câblé", {
  payload <- compute_payload(load_fixture())
  expect_error(publish(payload, backend = "supabase"), "supabase")
})

test_that("un backend inconnu s'arrête bruyamment", {
  payload <- compute_payload(load_fixture())
  expect_error(publish(payload, backend = "mongodb"), "n'existe pas")
})
