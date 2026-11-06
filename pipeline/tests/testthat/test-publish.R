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

test_that("publish(backend = 'static') conserve les artefacts partagés sans recréer les JSON numériques retirés", {
  # Les faits restent dans le payload producteur ; les Parquets de thème des
  # cinq thèmes non-Mobilité ont déjà été retirés (#757), et leurs projections
  # JSON navigateur sont retirées ici. Les artefacts partagés restent publiés.
  payload <- compute_payload(load_fixture())
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))

  publish(payload, cible)

  for (nom in c("indicateurs_demographie", "histoires_demographie")) {
    expect_false(file.exists(file.path(cible, paste0(nom, ".parquet"))), info = nom)
    expect_false(file.exists(file.path(cible, paste0(nom, ".json"))), info = nom)
  }
  expect_true(file.exists(file.path(cible, "territoires.parquet")))
  expect_true(file.exists(file.path(cible, "territoires.json")))
  # #894 : apercu.parquet est toujours écrit (table peuplée par Démographie),
  # apercu.json N'EST PLUS écrit — aucun chemin ne le crée
  expect_true(file.exists(file.path(cible, "apercu.parquet")))
  expect_false(file.exists(file.path(cible, "apercu.json")))
})

test_that("publish ne recrée pas la projection BPE retirée", {
  payload <- compute_payload(load_fixture())
  payload$profils_acces_bpe <- tibble::tibble(
    territoire = "22001", type = "commune", profil = "velo-compense",
    profil_libelle = "Le vélo compense", nombre_typequ = 1L,
    exemplar_typequ = "D267",
    exemplar_libelle = "Spécialiste en dermatologie vénéréologie",
    exemplar_c = 0.1, exemplar_b = 0.4, exemplar_t = 0.1
  )
  payload$profils_acces_bpe_univers <- tibble::tibble(
    territoire = "22001", type = "commune", typequ = "D267"
  )
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))

  publish(payload, cible)

  expect_false(file.exists(file.path(cible, "profils_acces_bpe.parquet")))
  expect_false(file.exists(file.path(cible, "profils_acces_bpe_univers.parquet")))
  expect_false(file.exists(file.path(cible, "profils_acces_bpe.json")))
})

test_that("publish ne recrée ni la grille ni la rampe legacy malgré leur présence dans un payload", {
  payload <- compute_payload(load_fixture())
  payload$distribution_acces_batiments <- tibble::tibble(legacy_grid = 1L)
  payload$distribution_acces_batiments_comparaisons <- tibble::tibble(legacy_grid = 1L)
  payload$rampe_acces_batiments <- tibble::tibble(legacy_ramp = 1L)
  payload$rampe_acces_batiments_comparaisons <- tibble::tibble(legacy_ramp = 1L)
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))

  publish(payload, cible)

  for (name in c("distribution_acces_batiments.json",
                 "distribution_acces_batiments.parquet",
                 "distribution_acces_batiments_comparaisons.json",
                 "distribution_acces_batiments_comparaisons.parquet")) {
    expect_false(file.exists(file.path(cible, name)), info = name)
  }
  for (name in c("rampe_acces_batiments.json",
                 "rampe_acces_batiments.parquet",
                 "rampe_acces_batiments_comparaisons.json",
                 "rampe_acces_batiments_comparaisons.parquet")) {
    expect_false(file.exists(file.path(cible, name)), info = name)
  }
})

test_that("les artefacts partagés conservés gardent leurs faits exacts", {
  # La non-dérive se vérifie toujours pour les projections partagées retenues.
  # Il n'y a plus de parité de sérialisation JSON pour indicateurs/histoires.
  payload <- compute_payload(load_fixture())
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))

  publish(payload, cible)

  # la table partagée territoires, écrite dans les deux formats, se compare
  # parquet contre JSON
  parquet <- nanoparquet::read_parquet(file.path(cible, "territoires.parquet"))
  json <- jsonlite::fromJSON(file.path(cible, "territoires.json"))
  verifier_non_derivee(parquet, json, "territoires")
  # #894 : apercu n'a PLUS de projection JSON à comparer — le parquet partagé
  # se compare à la table EN MÉMOIRE dont il est issu (même contrat de
  # non-dérive, appliqué mémoire → parquet comme #893), et aucun apercu.json
  # n'existe
  parquet_apercu <- nanoparquet::read_parquet(file.path(cible, "apercu.parquet"))
  verifier_non_derivee(parquet_apercu, payload$apercu, "apercu")
  expect_false(file.exists(file.path(cible, "apercu.json")))
  expect_false(file.exists(file.path(cible, "indicateurs_demographie.json")))
  expect_false(file.exists(file.path(cible, "histoires_demographie.json")))
})

test_that("le Parquet Mobilité conservé garde les faits canoniques et leurs rangs", {
  # Mobilité reste l'exception explicite (#619) : ses faits sont encore publiés
  # en Parquet. Les projections JSON retirées ne sont pas recréées.
  payload <- compute_payload(load_fixture())
  payload$indicateurs$theme <- "mobilite"
  payload$histoires$theme <- "mobilite"
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))

  publish(payload, cible) # backend static : parquet (mobilite) + JSON

  colonnes_rang <- grep("^rang_", names(payload$indicateurs), value=TRUE)
  expect_gt(length(colonnes_rang), 0L)
  expect_true(all(colonnes_rang %in% names(payload$indicateurs)))
  parquet <- nanoparquet::read_parquet(file.path(cible, "indicateurs_mobilite.parquet"))
  expect_true(all(colonnes_rang %in% names(parquet)))
  for (col in colonnes_rang) {
    expect_identical(as.numeric(parquet[[col]]),
                     as.numeric(payload$indicateurs[[col]]), info = col)
  }
  verifier_non_derivee(parquet, payload$indicateurs, "indicateurs_mobilite")
  histoires <- nanoparquet::read_parquet(file.path(cible, "histoires_mobilite.parquet"))
  verifier_non_derivee(histoires, payload$histoires, "histoires_mobilite")
  expect_false(file.exists(file.path(cible, "indicateurs_mobilite.json")))
  expect_false(file.exists(file.path(cible, "histoires_mobilite.json")))
})

test_that("la publication conserve le référentiel partagé sans projection de faits par thème", {
  # Les faits en mémoire conservent leur identité de thème, tandis que publish
  # n'écrit plus de fichiers numériques indicateurs/histoires.
  payload <- compute_payload(load_fixture())
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))

  publish(payload, cible)

  expect_false(file.exists(file.path(cible, "indicateurs_demographie.json")))
  expect_false(file.exists(file.path(cible, "histoires_demographie.json")))
  expect_true(file.exists(file.path(cible, "territoires.json")))
  # #894 : la projection JSON apercu est retirée — seul le parquet partagé
  # reste (écrit sous la règle non-vide, la table Démographie peuple l'aperçu)
  expect_false(file.exists(file.path(cible, "apercu.json")))
  expect_true(file.exists(file.path(cible, "apercu.parquet")))
  # #757 : le parquet par-thème est retiré pour un thème non-mobilité
  expect_false(file.exists(file.path(cible, "indicateurs_demographie.parquet")))
  expect_false(file.exists(file.path(cible, "histoires_demographie.parquet")))
  expect_false(file.exists(file.path(cible, "indicateurs.json")))
  expect_false(file.exists(file.path(cible, "histoires.json")))
  # l'Aperçu est partagé entre les thèmes, comme la référence — pas par thème
  expect_false(file.exists(file.path(cible, "apercu_demographie.parquet")))
})

test_that("un payload d'un autre thème écrit les fichiers JSON de CE thème (parquet retiré, #757)", {
  # Le thème reste une propriété des faits en mémoire. Le writer ne crée plus
  # de projection numérique, quel que soit le thème du payload.
  payload <- compute_payload(load_fixture())
  payload$indicateurs$theme <- "habitat"
  payload$histoires$theme <- "habitat"
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))

  publish(payload, cible)

  expect_false(file.exists(file.path(cible, "indicateurs_habitat.json")))
  expect_false(file.exists(file.path(cible, "histoires_habitat.json")))
  expect_false(file.exists(file.path(cible, "indicateurs_habitat.parquet")))
  expect_false(file.exists(file.path(cible, "histoires_habitat.parquet")))
  expect_false(file.exists(file.path(cible, "indicateurs_demographie.json")))
})

test_that("publish répété conserve les ressources partagées sans créer de faits JSON", {
  payload <- compute_payload(load_fixture())
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))

  publish(payload, cible)
  publish(payload, cible) # idempotent

  territoires <- jsonlite::fromJSON(file.path(cible, "territoires.json"))
  expect_equal(nrow(territoires), nrow(payload$territoires))
  expect_false(file.exists(file.path(cible, "indicateurs_demographie.json")))
  expect_false(file.exists(file.path(cible, "histoires_demographie.json")))
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

# Habitat garde ses faits producteurs en mémoire ; ses artefacts servis sont
# détenus par les publishers dédiés, pas par des projections JSON par thème.

test_that("publish Habitat conserve les ressources partagées sans créer de JSON de faits", {
  # issue #116 : l'Aperçu d'Habitat est vide par design — la table partagée
  # apercu n'est NI écrite NI écrasée par un thème sans aperçu (seul
  # Démographie la peuple ; le test de la sentinelle plus bas verrouille la
  # non-écrasement d'un aperçu existant). #894 : idem pour la projection JSON,
  # qui n'est de toute façon plus écrite par aucun thème.
  payload <- payload_habitat()
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))

  publish(payload, cible)

  # Habitat n'écrit ni Parquet de faits thématique (#757), ni JSON numérique
  # retiré (#881).
  for (nom in c("indicateurs_habitat", "histoires_habitat")) {
    expect_false(file.exists(file.path(cible, paste0(nom, ".parquet"))), info = nom)
    expect_false(file.exists(file.path(cible, paste0(nom, ".json"))), info = nom)
  }
  expect_true(file.exists(file.path(cible, "territoires.parquet")))
  expect_true(file.exists(file.path(cible, "territoires.json")))
  # aucun fichier Démographie écrit par un run Habitat
  expect_false(file.exists(file.path(cible, "indicateurs_demographie.parquet")))
  expect_false(file.exists(file.path(cible, "histoires_demographie.parquet")))
  # les fichiers partagés de l'Aperçu n'existent pas après un run Habitat
  expect_false(file.exists(file.path(cible, "apercu.parquet")))
  expect_false(file.exists(file.path(cible, "apercu.json")))
})

test_that("publish Habitat ne sérialise ni ne modifie les tables canoniques en mémoire", {
  payload <- payload_habitat()
  indicateurs <- payload$indicateurs
  histoires <- payload$histoires
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))

  publish(payload, cible)

  expect_identical(payload$indicateurs, indicateurs)
  expect_identical(payload$histoires, histoires)
  expect_false(file.exists(file.path(cible, "indicateurs_habitat.json")))
  expect_false(file.exists(file.path(cible, "histoires_habitat.json")))
})

test_that("publish répété pour Habitat ne crée pas de projections numériques", {
  payload <- payload_habitat()
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))

  publish(payload, cible)
  publish(payload, cible) # idempotent

  expect_false(file.exists(file.path(cible, "indicateurs_habitat.json")))
  expect_false(file.exists(file.path(cible, "histoires_habitat.json")))
  expect_equal(nrow(jsonlite::fromJSON(file.path(cible, "territoires.json"))),
               nrow(payload$territoires))
})

# issue #116 : la table apercu est un fichier PARTAGÉ (pas par-thème) — seule
# la table Démographie la peuple. Un thème sans aperçu (Habitat, Économie) ne
# doit NI écrire NI écraser le fichier partagé : la table du payload reste
# présente et vide (le contrat, validate_payload l'exige), publish ne la
# sérialise que lorsqu'elle porte des lignes.
# issue #894 : la projection JSON apercu.json n'est PLUS écrite du tout
# (source-only) — un apercu.json périmé préexistant est une relique : ni
# réécrit ni supprimé par le run.

test_that("un thème sans aperçu laisse INTACT l'apercu déjà publié (sentinelle, issue #116)", {
  payload <- payload_habitat() # apercu vide par design
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))
  dir.create(cible)

  # la sentinelle : l'aperçu peuplé qu'un run Démographie aurait publié
  # (parquet canonique + relique JSON périmée depuis #894)
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

  # la sentinelle est INTACTE : ni écrasée (par `[]`), ni supprimée — la
  # relique JSON comme le parquet canonique
  expect_identical(octets("apercu.json"), json_avant)
  expect_identical(octets("apercu.parquet"), parquet_avant)
})

test_that("#894 : un run peuplé écrit apercu.parquet sous la règle non-vide mais JAMAIS apercu.json — la relique reste intacte", {
  payload <- compute_payload(load_fixture()) # Démographie peuple l'aperçu
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))
  dir.create(cible)

  # la relique : un apercu.json périmé encore présent (par ex. servi par
  # un ancien déploiement — l'artefact commité est supprimé depuis #903, mais
  # le run ne fait aucun cleanup) ; il ne doit NI être réécrit NI supprimé
  writeLines('[{"territoire":"99999","type":"commune","key":"relique","value":1,"unit":"u"}]',
             file.path(cible, "apercu.json"))
  relique_avant <- readBin(file.path(cible, "apercu.json"), "raw",
                           n = file.info(file.path(cible, "apercu.json"))$size)

  publish(payload, cible) # backend static

  # le parquet partagé est écrit (règle non-vide inchangée, #116) et égale la
  # table EN MÉMOIRE dont il est issu — le contrat de non-dérive, ADR-0004
  expect_true(file.exists(file.path(cible, "apercu.parquet")))
  parquet <- nanoparquet::read_parquet(file.path(cible, "apercu.parquet"))
  verifier_non_derivee(parquet, payload$apercu, "apercu")
  # AUCUN apercu.json n'est créé par le run — et la relique préexistante est
  # laissée EXACTEMENT telle quelle (ni réécrite ni supprimée)
  expect_identical(
    readBin(file.path(cible, "apercu.json"), "raw",
            n = file.info(file.path(cible, "apercu.json"))$size),
    relique_avant
  )
})

test_that("un thème sans aperçu ne crée jamais les fichiers partagés apercu (issue #116)", {
  payload <- payload_habitat() # apercu vide par design
  cible <- tempfile("pub-")
  on.exit(unlink(cible, recursive = TRUE))

  publish(payload, cible)

  # la référence partagée est écrite, sans fichiers de faits numériques
  for (nom in c("indicateurs_habitat", "histoires_habitat")) {
    expect_false(file.exists(file.path(cible, paste0(nom, ".json"))), info = nom)
  }
  expect_true(file.exists(file.path(cible, "territoires.parquet")))
  expect_true(file.exists(file.path(cible, "territoires.json")))
  # mais JAMAIS apercu : les fichiers partagés ne naissent pas d'un thème
  # sans aperçu (parquet sous la règle non-vide #116 ; JSON retiré #894)
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
