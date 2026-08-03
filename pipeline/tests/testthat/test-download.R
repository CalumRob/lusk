# mini_zip --------------------------------------------------------------------
# Un zip minimal valide (une entrée stockée, vide) — pour fabriquer un
# « bon téléchargement » dans les tests sans réseau. Structure vérifiée :
# utils::unzip(list = TRUE) l'accepte.
mini_zip <- function(nom = "a.txt") {
  nm <- charToRaw(nom)
  n <- length(nm)
  lh <- c(
    as.raw(c(0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 0, 0, 0, 0, 0x21, 0)),
    as.raw(c(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)),
    as.raw(c(n, 0, 0, 0)),
    nm
  )
  cd <- c(
    as.raw(c(0x50, 0x4b, 0x01, 0x02, 20, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0x21, 0)),
    as.raw(c(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)),
    as.raw(c(n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)),
    nm
  )
  eocd <- as.raw(c(0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 1, 0, 1, 0))
  cd_size <- length(cd)
  cd_off <- length(lh)
  eocd <- c(
    eocd,
    as.raw(c(
      cd_size %% 256, (cd_size %/% 256) %% 256,
      (cd_size %/% 65536) %% 256, cd_size %/% 16777216,
      cd_off %% 256, (cd_off %/% 256) %% 256,
      (cd_off %/% 65536) %% 256, cd_off %/% 16777216,
      0, 0
    ))
  )
  c(lh, cd, eocd)
}

# manifeste factice : URL qui échouerait si elle était touchée
manifeste_factice <- function(fichier = "fichier-test.zip", mode = "cron") {
  tibble::tibble(
    id = "test", source = "test", url = "https://example.invalid/x",
    fichier = fichier, vintage = "2023", date_reference = "2023-01-01",
    date_publication = "2026-06-30", licence = "lov2", note = "test",
    mode = mode
  )
}

# manifeste mixte : 2 sources cron + 1 manuel — le contrat des tests du mode
# cron (issue #8) : les cron sont téléchargées, la manuel est sautée et
# enregistrée « à traiter à la main ».
manifeste_mixte <- function() {
  tibble::tibble(
    id = c("cron_a", "manuel_b", "cron_c"),
    source = c("test", "test", "test"),
    url = c("https://example.invalid/a", "https://example.invalid/b",
            "https://example.invalid/c"),
    fichier = c("a.zip", "b.zip", "c.zip"),
    vintage = c("2023", "2023", "2023"),
    date_reference = c("2023-01-01", "2023-01-01", "2023-01-01"),
    date_publication = c("2026-06-30", "2026-06-30", "2026-06-30"),
    licence = c("lov2", "lov2", "lov2"),
    note = c("test", "test", "test"),
    mode = c("cron", "manuel", "cron")
  )
}

test_that("le manifeste liste les sources démographiques avec leurs métadonnées", {
  expect_s3_class(MANIFEST_DEMOGRAPHIE, "tbl_df")
  expect_true(all(c("id", "source", "url", "fichier", "vintage",
                    "date_reference", "date_publication", "licence", "note",
                    "mode") %in%
                    names(MANIFEST_DEMOGRAPHIE)))
  expect_true(all(!duplicated(MANIFEST_DEMOGRAPHIE$id)))
  expect_true(all(startsWith(MANIFEST_DEMOGRAPHIE$url, "https://")))
  expect_true(all(MANIFEST_DEMOGRAPHIE$licence == "lov2"))
  expect_true(all(!is.na(MANIFEST_DEMOGRAPHIE$note)))

  # 4 sources : série historique (pop/superficie/soldes), ménages,
  # détail par âge (PRINC), base des EPCI.
  expect_equal(nrow(MANIFEST_DEMOGRAPHIE), 4)
  expect_setequal(
    MANIFEST_DEMOGRAPHIE$vintage,
    c(serie_historique = "2023", menages = "2023", age_detail = "2023",
      epci = "2025")
  )

  # mode de récupération (issue #8) : les 4 sources INSEE sont « cron » —
  # téléchargement direct sans clé (vérifié en direct le 2026-08-03).
  expect_true(all(MANIFEST_DEMOGRAPHIE$mode == "cron"))
  expect_setequal(MANIFEST_DEMOGRAPHIE$mode, "cron")
})

test_that("verifier_fichier : un zip valide passe, un fichier corrompu non", {
  cache <- tempfile("cache-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  # zip valide (mini_zip) -> vrai
  bon <- file.path(cache, "bon.zip")
  writeBin(mini_zip(), bon)
  expect_true(verifier_fichier(bon))

  # fichier inexistant -> faux
  expect_false(verifier_fichier(file.path(cache, "absent.zip")))

  # fichier vide -> faux
  vide <- file.path(cache, "vide.zip")
  file.create(vide)
  expect_false(verifier_fichier(vide))

  # texte déguisé en zip (téléchargement partiel/corrompu) -> faux
  corrompu <- file.path(cache, "corrompu.zip")
  writeLines("pas un zip", corrompu)
  expect_false(verifier_fichier(corrompu))
})

test_that("download_sources est idempotent : un fichier intact est laissé intact", {
  cache <- tempfile("cache-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  # un zip valide déjà présent : l'URL factice ne doit jamais être touchée
  cible <- file.path(cache, "fichier-test.zip")
  writeBin(mini_zip(), cible)

  expect_no_error(download_sources(manifeste_factice(), cache))
  # intact : toujours un zip valide, même contenu
  expect_true(verifier_fichier(cible))
})

test_that("download_sources : un fichier corrompu est re-téléchargé (point 3)", {
  cache <- tempfile("cache-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  # un fichier corrompu déjà présent (texte déguisé en zip)
  cible <- file.path(cache, "fichier-test.zip")
  writeLines("deja telecharge mais corrompu", cible)

  # le téléchargement est mocké : il écrit un vrai zip
  local_mocked_bindings(
    telecharger_fichier = function(url, cible) writeBin(mini_zip(), cible),
    .package = "lusk"
  )

  expect_no_error(download_sources(manifeste_factice(), cache))
  expect_true(verifier_fichier(cible))  # le corrompu a été remplacé
})

test_that("download_sources : un échec réseau est retenté, puis échoue fort", {
  cache <- tempfile("cache-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  essais <- 0
  local_mocked_bindings(
    telecharger_fichier = function(url, cible) {
      essais <<- essais + 1
      stop("panne réseau")
    },
    .package = "lusk"
  )

  expect_error(
    download_sources(manifeste_factice(), cache),
    "Téléchargement invalide après 2 essais"
  )
  expect_equal(essais, 2)          # retenté exactement une fois
  expect_false(file.exists(file.path(cache, "fichier-test.zip")))  # nettoyé
})

test_that("download_sources : un téléchargement corrompu est retenté, puis échoue fort", {
  cache <- tempfile("cache-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  essais <- 0
  local_mocked_bindings(
    telecharger_fichier = function(url, cible) {
      essais <<- essais + 1
      writeLines("encore corrompu", cible)  # « réussit » mais invalide
    },
    .package = "lusk"
  )

  expect_error(
    download_sources(manifeste_factice(), cache),
    "Téléchargement invalide après 2 essais"
  )
  expect_equal(essais, 2)
  expect_false(file.exists(file.path(cache, "fichier-test.zip")))
})

# mode cron (issue #8, ADR-0004) ----------------------------------------------
# En mode cron, download_sources télécharge les sources « cron », saute les
# sources « manuel » sans échec (enregistrées « à traiter à la main »), et
# renvoie un tableau de statuts par source (id, mode, status). Un échec cron
# après les retries est enregistré « échec » puis le run s'arrête fort.

test_that("en mode cron, download_sources saute les sources manuel et les enregistre", {
  cache <- tempfile("cache-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  telecharge <- character(0)
  local_mocked_bindings(
    telecharger_fichier = function(url, cible) {
      telecharge <<- c(telecharge, url)
      writeBin(mini_zip(), cible)
    },
    .package = "lusk"
  )

  statuts <- download_sources(manifeste_mixte(), cache, mode = "cron")

  # seules les sources cron sont téléchargées ; la manuel jamais touchée
  expect_equal(sort(telecharge),
               c("https://example.invalid/a", "https://example.invalid/c"))
  expect_false(file.exists(file.path(cache, "b.zip")))

  # une ligne par source, dans l'ordre du manifeste : cron -> frais,
  # manuel -> à traiter à la main
  expect_equal(statuts$id, c("cron_a", "manuel_b", "cron_c"))
  expect_equal(statuts$mode, c("cron", "manuel", "cron"))
  expect_equal(statuts$status, c("frais", "à traiter à la main", "frais"))
})

test_that("en mode cron, une source cron déjà en cache est frais sans re-télécharger", {
  cache <- tempfile("cache-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  # a.zip déjà présent et valide : laissé intact, jamais re-téléchargé
  writeBin(mini_zip(), file.path(cache, "a.zip"))

  telecharge <- character(0)
  local_mocked_bindings(
    telecharger_fichier = function(url, cible) {
      telecharge <<- c(telecharge, url)
      writeBin(mini_zip(), cible)
    },
    .package = "lusk"
  )

  statuts <- download_sources(manifeste_mixte(), cache, mode = "cron")

  expect_equal(telecharge, "https://example.invalid/c")  # seule cron_c à faire
  expect_equal(statuts$status, c("frais", "à traiter à la main", "frais"))
})

test_that("en mode cron, un échec cron après retries est enregistré échec puis arrête fort", {
  cache <- tempfile("cache-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  local_mocked_bindings(
    telecharger_fichier = function(url, cible) {
      if (grepl("/c$", url)) stop("panne réseau") else writeBin(mini_zip(), cible)
    },
    .package = "lusk"
  )

  erreur <- tryCatch(
    download_sources(manifeste_mixte(), cache, mode = "cron"),
    error = function(e) e
  )

  expect_s3_class(erreur, "erreur_telechargement")
  expect_match(conditionMessage(erreur), "Téléchargement invalide après 2 essais")
  # les statuts du run sont portés par l'erreur, échec inclus — le rapport de
  # run (ticket #10) peut être écrit malgré l'arrêt
  expect_equal(erreur$statuts$id, c("cron_a", "manuel_b", "cron_c"))
  expect_equal(erreur$statuts$mode, c("cron", "manuel", "cron"))
  expect_equal(erreur$statuts$status, c("frais", "à traiter à la main", "échec"))
  expect_false(file.exists(file.path(cache, "c.zip")))
})

test_that("en mode full (défaut), tout est téléchargé, y compris les sources manuel", {
  cache <- tempfile("cache-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  local_mocked_bindings(
    telecharger_fichier = function(url, cible) writeBin(mini_zip(), cible),
    .package = "lusk"
  )

  statuts <- download_sources(manifeste_mixte(), cache)

  expect_true(file.exists(file.path(cache, "b.zip")))
  expect_equal(statuts$status, c("frais", "frais", "frais"))
  expect_equal(statuts$mode, c("cron", "manuel", "cron"))
})

test_that("un manifeste sans colonne mode est traité tout en cron (comportement historique)", {
  cache <- tempfile("cache-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  ancien <- manifeste_factice()[, setdiff(names(manifeste_factice()), "mode")]

  local_mocked_bindings(
    telecharger_fichier = function(url, cible) writeBin(mini_zip(), cible),
    .package = "lusk"
  )

  statuts <- download_sources(ancien, cache, mode = "cron")

  expect_true(file.exists(file.path(cache, "fichier-test.zip")))
  expect_equal(statuts$mode, "cron")
  expect_equal(statuts$status, "frais")
})
