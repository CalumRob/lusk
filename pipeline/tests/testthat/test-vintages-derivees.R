# Vintages dérivées — fail closed et format (issue #1114) -----------------------
# La table publiée ne doit JAMAIS porter le littéral d'un manifeste pour une
# source à base dérivée : sans attestation (lockfile ou sidecar valide) on échoue
# bruyamment en mode run, et toute base dérivée publie `version = YYYY-MM`.
# Hors run (appel direct d'un builder de thème, fixtures), le vintage déclaré
# reste — ADR-0048 : aucun run n'atteste d'acquisition, on n'en invente pas.

manifest_telechargement_fixture <- function(vintage = "2026-08") {
  tibble::tibble(
    id = "korrigo_fixture", source = "Korrigo (fixture)",
    url = "https://example.invalid/korrigo", fichier = "korrigo_fixture.csv",
    vintage = vintage, date_reference = "2026-08-25",
    date_publication = "2026-08-25", licence = "lov2",
    vintage_basis = "telechargement"
  )
}

test_that("une source dérivée sans lock ni sidecar échoue en mode run (erreur nommée)", {
  cache <- tempfile("cache-sans-attestation-")
  dir.create(cache, recursive = TRUE)
  on.exit(unlink(cache, recursive = TRUE))
  lock_vide <- tempfile("lock-vide-")
  m <- manifest_telechargement_fixture()

  err <- expect_error(
    vintages_depuis_manifest(m, cache = cache, lock = lock_vide,
                             exiger_attestation = TRUE),
    class = "erreur_vintage_non_attestee"
  )
  expect_match(conditionMessage(err), "korrigo_fixture", fixed = TRUE)
})

test_that("hors run, une source dérivée sans attestation garde son vintage déclaré (ADR-0048)", {
  cache <- tempfile("cache-hors-run-")
  dir.create(cache, recursive = TRUE)
  on.exit(unlink(cache, recursive = TRUE))
  m <- manifest_telechargement_fixture()

  v <- vintages_depuis_manifest(m, cache = cache, lock = tempfile("lock-vide-"))
  expect_equal(v$version, "2026-08")
})

test_that("une source declaree garde son vintage déclaré même en fail-closed", {
  cache <- tempfile("cache-declaree-")
  dir.create(cache, recursive = TRUE)
  on.exit(unlink(cache, recursive = TRUE))
  m <- manifest_telechargement_fixture(vintage = "2023")
  m$vintage_basis <- "declaree"

  v <- vintages_depuis_manifest(m, cache = cache, lock = tempfile("lock-vide-"),
                                exiger_attestation = TRUE)
  expect_equal(v$version, "2023")
})

test_that("un sidecar valide atteste la source : le vintage dérivé est publié en YYYY-MM", {
  cache <- tempfile("cache-atteste-")
  dir.create(cache, recursive = TRUE)
  on.exit(unlink(cache, recursive = TRUE))
  m <- manifest_telechargement_fixture()

  cible <- file.path(cache, m$fichier[[1L]])
  writeBin(charToRaw("octets du run\n"), cible)
  Sys.setFileTime(cible, as.POSIXct("2026-11-18T12:00:00", tz = "UTC"))
  ecrire_digest_cache(list(
    source_id = m$id[[1L]], url = m$url[[1L]], sha256 = "abc",
    bytes = file.size(cible), fichier = m$fichier[[1L]],
    mtime = as.numeric(file.mtime(cible)), acquired_at = "2026-11-18",
    vintage_basis = "telechargement", vintage = "2026-11",
    date_reference = NA_character_
  ), cache)

  v <- vintages_depuis_manifest(m, cache = cache, lock = tempfile("lock-vide-"),
                                exiger_attestation = TRUE)
  expect_equal(v$version, "2026-11")
  expect_equal(v$date_publication, "2026-11-18")
  expect_true(is.na(v$date_reference))
  expect_true(grepl("^\\d{4}-\\d{2}$", v$version))
})

test_that("toute source à base dérivée attestée porte au moins une horloge (#1118)", {
  # Les trois bases dérivées, avec les deux profils de déclaration : une source
  # dont la fraîcheur vit dans le contenu (contenu_date / contenu_timestamp,
  # ex. ORT) garde publication NA mais porte une référence ; une base roulante
  # (telechargement, ex. DPE) n'a pas de référence et DOIT garder l'acquisition
  # comme publication. Aucune ligne attestée ne peut sortir SANS horloge —
  # c'est ce que refuse `verifier_horloges_vintage` (compute.R) côté payload.
  cache <- tempfile("cache-horloges-")
  dir.create(file.path(cache, ".digests"), recursive = TRUE)
  on.exit(unlink(cache, recursive = TRUE))
  m <- tibble::tribble(
    ~id, ~source, ~url, ~fichier, ~vintage, ~date_reference, ~date_publication,
    ~licence, ~vintage_basis,
    "ort_fixture", "ORT (fixture)", "https://example.invalid/ort", "ort.csv",
    NA_character_, NA_character_, NA_character_, "lov2", "contenu_date",
    "osm_fixture", "OSM (fixture)", "https://example.invalid/osm", "osm.pbf",
    NA_character_, NA_character_, NA_character_, "lov2", "contenu_timestamp",
    "dpe_fixture", "DPE (fixture)", "https://example.invalid/dpe", "dpe.csv",
    NA_character_, NA_character_, NA_character_, "lov2", "telechargement",
    "korrigo_fixture", "Korrigo (fixture)", "https://example.invalid/korrigo",
    "korrigo.csv", NA_character_, NA_character_, "2026-01-01", "lov2",
    "telechargement"
  )
  # référence attestée : NON NA pour les bases à contenu (l'horloge est le
  # contenu), NA pour les bases roulantes (l'horloge est l'acquisition).
  reference_attestee <- c(
    ort_fixture = "2026-10-15", osm_fixture = "2026-10-16",
    dpe_fixture = NA_character_, korrigo_fixture = "2026-10-17"
  )
  for (i in seq_len(nrow(m))) {
    cible <- file.path(cache, m$fichier[i])
    writeBin(charToRaw("octets du run\n"), cible)
    Sys.setFileTime(cible, as.POSIXct("2026-11-18T12:00:00", tz = "UTC"))
    ecrire_digest_cache(list(
      source_id = m$id[i], url = m$url[i], sha256 = paste0("sha-", m$id[i]),
      bytes = file.size(cible), fichier = m$fichier[i],
      mtime = as.numeric(file.mtime(cible)), acquired_at = "2026-11-18",
      vintage_basis = m$vintage_basis[i], vintage = "2026-11",
      date_reference = reference_attestee[[m$id[i]]]
    ), cache)
  }

  v <- vintages_depuis_manifest(m, cache = cache, lock = tempfile("lock-vide-"),
                                exiger_attestation = TRUE)
  for (i in seq_len(nrow(v))) {
    expect_true(
      !is.na(v$date_reference[i]) || !is.na(v$date_publication[i]),
      info = paste("aucune horloge pour", v$id[i])
    )
  }
  # les deux profils restent distincts : ORT garde sa référence et NA en
  # publication ; la base roulante DPE garde l'acquisition et NA en référence.
  expect_equal(v$date_reference[v$id == "ort_fixture"], "2026-10-15")
  expect_true(is.na(v$date_publication[v$id == "ort_fixture"]))
  expect_equal(v$date_publication[v$id == "dpe_fixture"], "2026-11-18")
  expect_true(is.na(v$date_reference[v$id == "dpe_fixture"]))
})

test_that("verifier_vintages_attestees : une table dont le vintage dérivé n'est pas YYYY-MM échoue", {
  cache <- tempfile("cache-format-")
  dir.create(cache, recursive = TRUE)
  on.exit(unlink(cache, recursive = TRUE))
  m <- manifest_telechargement_fixture()

  # une attestation VALIDE, mais qui porte un jour au lieu d'un mois — le garde
  # de format doit rejeter la table publiée
  cible <- file.path(cache, m$fichier[[1L]])
  writeBin(charToRaw("octets\n"), cible)
  Sys.setFileTime(cible, as.POSIXct("2026-08-25T12:00:00", tz = "UTC"))
  ecrire_digest_cache(list(
    source_id = m$id[[1L]], url = m$url[[1L]], sha256 = "abc",
    bytes = file.size(cible), fichier = m$fichier[[1L]],
    mtime = as.numeric(file.mtime(cible)), acquired_at = "2026-08-25",
    vintage_basis = "telechargement", vintage = "2026-08-25",
    date_reference = NA_character_
  ), cache)
  lock_vide <- tempfile("lock-vide-")

  v <- vintages_depuis_manifest(m, cache = cache, lock = lock_vide)
  expect_equal(v$version, "2026-08-25")  # ce que le bug publierait

  err <- expect_error(
    verifier_vintages_attestees(v, m, cache = cache, lock = lock_vide),
    class = "erreur_format_vintage"
  )
  expect_match(conditionMessage(err), "korrigo_fixture", fixed = TRUE)
})

# Le mini-graphe : la même chaîne que grappe_theme (sources -> fichiers ->
# vintages) exécutée DEUX fois sur un store jetable, avec des octets qui
# changent entre les deux. Les vraies fonctions de résolution/projection sont
# appelées ; seul le câblage est reproduit à échelle fixture.
ecrire_projet_vintages <- function(projet, horloge, payload, pipe) {
  dir.create(file.path(projet, "data", "raw"), recursive = TRUE, showWarnings = FALSE)
  writeLines(payload, file.path(projet, "payload.txt"))
  writeLines("[]", file.path(projet, "lock.json"))
  pipeline <- gsub("\\\\", "/", normalizePath(pipe))
  cible <- file.path(projet, "_targets.R")
  lignes <- c(
    "library(targets)",
    sprintf("pkgload::load_all('%s', quiet = TRUE)", pipeline),
    "tar_option_set(imports = 'lusk', trust_timestamps = FALSE, error = 'stop')",
    'CACHE <- "data/raw"',
    sprintf('HORLOGE <- "%s"', horloge),
    sprintf('LOCK <- "%s"', gsub("\\\\", "/", file.path(projet, "lock.json"))),
    sprintf('PAYLOAD <- "%s"', gsub("\\\\", "/", file.path(projet, "payload.txt"))),
    "MANIFESTE <- data.frame(",
    '  id = "korrigo_fixture", source = "Korrigo (fixture)",',
    '  url = "https://example.invalid/korrigo", fichier = "src.csv",',
    '  vintage = "2020-01", date_reference = "2020-01-01",',
    '  date_publication = "2020-01-01", licence = "lov2",',
    '  vintage_basis = "telechargement", stringsAsFactors = FALSE',
    ")",
    "tirer_fixture <- function(url, cible) {",
    "  file.copy(PAYLOAD, cible, overwrite = TRUE)",
    "  invisible(NULL)",
    "}",
    "list(",
    "  tar_target(sources_fixture, {",
    "    resoudre_source(",
    "      id = MANIFESTE$id, url = MANIFESTE$url, fichier = MANIFESTE$fichier,",
    "      cache = CACHE, vintage_basis = MANIFESTE$vintage_basis,",
    "      vintage_declare = MANIFESTE$vintage, horloge = HORLOGE,",
    "      tirer = tirer_fixture, lock = LOCK)",
    "  }),",
    "  tar_target(fichiers_fixture, {",
    "    sources_fixture",
    "    file.path(CACHE, MANIFESTE$fichier)",
    '  }, format = "file"),',
    "  tar_target(vintages_fixture, {",
    "    sources_fixture",
    "    fichiers_fixture",
    "    t <- vintages_depuis_manifest(MANIFESTE, cache = CACHE, lock = LOCK,",
    "                                  exiger_attestation = TRUE)",
    "    verifier_vintages_attestees(t, MANIFESTE, cache = CACHE, lock = LOCK)",
    "    t",
    "  })",
    ")"
  )
  writeLines(lignes, cible)
  invisible(projet)
}

test_that("vintages_economie : le cache atteint la projection pour sirene_snapshot (base dérivée)", {
  # Issue #1114 : thread `cache` jusqu'au builder — sans lui, une source
  # `telechargement` publierait le littéral du manifeste au lieu du sidecar.
  cache <- tempfile("cache-sirene-")
  dir.create(cache, recursive = TRUE)
  on.exit(unlink(cache, recursive = TRUE))
  f <- MANIFEST_ECONOMIE_SIRENE$fichier[[1L]]
  cible <- file.path(cache, f)
  writeBin(charToRaw("sirene-fixture\n"), cible)
  Sys.setFileTime(cible, as.POSIXct("2026-11-18T12:00:00", tz = "UTC"))
  ecrire_digest_cache(list(
    source_id = "sirene_snapshot", url = "https://example.invalid/sirene",
    sha256 = "abc", bytes = file.size(cible), fichier = f,
    mtime = as.numeric(file.mtime(cible)), acquired_at = "2026-11-18",
    vintage_basis = "telechargement", vintage = "2026-11",
    date_reference = "2026-11-18"
  ), cache)

  v <- vintages_economie(cache = cache)
  expect_equal(v$version[v$id == "sirene_snapshot"], "2026-11")
  expect_equal(v$date_publication[v$id == "sirene_snapshot"], "2026-11-18")
  # les sources declaree ne bougent pas
  expect_equal(v$version[v$id == "rp_emploi"], "2023")
})

test_that("absences délibérées de vintages.json (ADR-0048 §3bis) — aucun ajout silencieux", {
  # Ces ids sont dans source-digests.json mais PAS dans la table des vintages :
  # lectures réseau géométrie, lignes techniques OCS-GE (une source éditoriale
  # les remplace), classifications dont la vintage vit dans source_records.
  tables <- list(
    vintages_demographie(), vintages_habitat(), vintages_economie(),
    vintages_mobilite(), vintages_milieux(), vintages_programmes()
  )
  ids <- unique(unlist(lapply(tables, function(t) t$id), use.names = FALSE))

  absents <- c(
    "geometrie_communes", "geometrie_epcis", "geometrie_departements",
    "ocsge_reseaux_22_2025", "ocsge_reseaux_29_2024",
    "ocsge_reseaux_35_2023", "ocsge_reseaux_56_2024",
    "classe_densite_communale", "classe_littorale_communale"
  )
  expect_false(any(absents %in% ids))
  # les QUATRE lignes techniques sont remplacées par UNE source éditoriale
  expect_true("ocsge_reseaux_routiers" %in% ids)
})

test_that("fixture : les octets changent entre deux tar_make et la version publiée suit", {
  projet <- tempfile("vintages-fixture-")
  on.exit(unlink(projet, recursive = TRUE))
  pipe <- pkgload::pkg_path()
  ecrire_projet_vintages(projet, "2026-11-18", "octets-v1", pipe)

  withr::local_dir(projet)
  targets::tar_make(callr_function = NULL)
  v1 <- targets::tar_read(vintages_fixture)
  expect_equal(v1$version, "2026-11")
  expect_equal(v1$date_publication, "2026-11-18")

  # de nouveaux octets sont résolus à une autre date d'acquisition
  writeLines("octets-v2", file.path(projet, "payload.txt"))
  unlink(file.path(projet, "data", "raw", "src.csv"))
  # réécrire _targets.R avec la nouvelle horloge (le store est, lui, conservé)
  ecrire_projet_vintages(projet, "2026-12-20", "octets-v2", pipe)
  targets::tar_make(callr_function = NULL)
  v2 <- targets::tar_read(vintages_fixture)
  expect_equal(v2$version, "2026-12")
  expect_equal(v2$date_publication, "2026-12-20")
})
