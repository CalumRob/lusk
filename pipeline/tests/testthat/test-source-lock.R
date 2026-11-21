# Lockfile de sources et résolveur unique (issue #1103) -------------------------
# Contrats testés sans réseau ni données réelles :
#   - des octets verrouillés publient un vintage DÉTERMINISTE (sans horloge) ;
#   - une source absente du lockfile est résolue mais signalée « sans référence »;
#   - une dérive d'octets est ADOPTÉE (cron), jamais une erreur de pin ;
#   - le vintage vient de la base déclarée (date_maj, timestamp PBF, achat) ;
#   - le digest du run est écrit une fois et réutilisé.

octets_fixture <- function(texte) charToRaw(texte)

empreinte_fixture <- function(contenu) {
  f <- tempfile("empreinte-")
  writeBin(contenu, f)
  on.exit(unlink(f), add = TRUE)
  con <- file(f, "rb")
  on.exit(close(con), add = TRUE)
  paste(openssl::sha256(con))
}

lock_fixture <- function(enregistrements = list()) {
  p <- tempfile("sources-lock-")
  ecrire_lock(enregistrements, p)
  p
}

pb_varint <- function(x) {
  r <- as.numeric(x)
  out <- raw(0)
  while (r >= 128) {
    out <- c(out, as.raw(r %% 128 + 128))
    r <- floor(r / 128)
  }
  c(out, as.raw(r))
}
pb_entier <- function(champ, valeur) c(pb_varint(champ * 8), pb_varint(valeur))
pb_octets <- function(champ, valeur) c(pb_varint(champ * 8 + 2), pb_varint(length(valeur)), valeur)
pb_be32 <- function(x) as.raw(c(
  (x %/% 2^24) %% 256, (x %/% 2^16) %% 256, (x %/% 2^8) %% 256, x %% 256
))

pbf_fixture <- function(timestamp = 1794864156, compresse = TRUE) {
  header <- pb_entier(32L, timestamp)
  contenu_blob <- if (compresse) memCompress(header, type = "gzip") else header
  blob <- c(
    pb_entier(2L, length(header)),
    if (compresse) pb_octets(3L, contenu_blob) else pb_octets(1L, contenu_blob)
  )
  blob_header <- c(pb_octets(1L, charToRaw("OSMHeader")), pb_entier(3L, length(blob)))
  c(pb_be32(length(blob_header)), blob_header, blob)
}

test_that("des octets verrouillés publient un vintage identique à deux horloges", {
  contenu <- octets_fixture("octets épinglés\n")
  h <- empreinte_fixture(contenu)
  verrouille <- list(list(
    source_id = "osm_reseaux", url = "https://example.invalid/osm",
    sha256 = h, bytes = length(contenu), acquired_at = "2026-11-18",
    vintage_basis = "contenu_timestamp", vintage = "2026-11",
    date_reference = "2026-11-16"
  ))
  lock <- lock_fixture(verrouille)
  resoudre <- function(jour) {
    cache <- tempfile("cache-lock-")
    r <- resoudre_source(
      id = "osm_reseaux", url = "https://example.invalid/osm",
      fichier = "extrait.pbf", cache = cache, lock = lock,
      horloge = as.Date(jour), vintage_basis = "contenu_timestamp",
      tirer = function(url, cible) writeBin(contenu, cible)
    )
    unlink(cache, recursive = TRUE)
    r
  }
  a <- resoudre("2026-11-18")
  b <- resoudre("2027-03-09")
  expect_true(a$verrouille)
  expect_identical(a$vintage, b$vintage)
  expect_identical(a$date_reference, b$date_reference)
  expect_identical(a$acquired_at, b$acquired_at)
  expect_identical(a$vintage, "2026-11")
  expect_identical(a$date_reference, "2026-11-16")
})

test_that("une source absente du lockfile est résolue et signalée sans référence", {
  cache <- tempfile("cache-sans-ref-")
  r <- resoudre_source(
    id = "source_nouvelle", url = "https://example.invalid/nouvelle",
    fichier = "nouvelle.csv", cache = cache, lock = lock_fixture(),
    horloge = as.Date("2026-11-18"), vintage_basis = "telechargement",
    reference_declaree = "2026-11-18",
    tirer = function(url, cible) writeBin(octets_fixture("flux roulant"), cible)
  )
  expect_true(r$sans_reference)
  expect_false(r$verrouille)
  expect_identical(r$vintage, "2026-11")
  expect_identical(r$date_reference, "2026-11-18")
  expect_identical(r$digest$source_id, "source_nouvelle")
  unlink(cache, recursive = TRUE)
})

test_that("une dérive d'octets est adoptée sans erreur de pin", {
  cache <- tempfile("cache-derive-")
  h_old <- empreinte_fixture(octets_fixture("vieux octets"))
  lock <- lock_fixture(list(list(
    source_id = "flux", url = "https://example.invalid/flux", sha256 = h_old,
    bytes = 12, acquired_at = "2026-01-01", vintage_basis = "telechargement",
    vintage = "2026-01", date_reference = "2026-01-01"
  )))
  r <- resoudre_source(
    id = "flux", url = "https://example.invalid/flux", fichier = "flux.bin",
    cache = cache, lock = lock, horloge = as.Date("2026-11-18"),
    vintage_basis = "telechargement",
    tirer = function(url, cible) writeBin(octets_fixture("nouveaux octets du flux"), cible)
  )
  expect_false(r$verrouille)
  expect_false(r$sans_reference)
  expect_identical(r$vintage, "2026-11")
  expect_identical(r$acquired_at, "2026-11-18")
  unlink(cache, recursive = TRUE)
})

test_that("un fichier réutilisé porte sa date de modification", {
  cache <- tempfile("cache-mtime-")
  dir.create(cache, recursive = TRUE)
  cible <- file.path(cache, "deja-la.csv")
  writeBin(octets_fixture("déjà téléchargé\n"), cible)
  Sys.setFileTime(cible, as.POSIXct("2026-10-02T12:00:00", tz = "UTC"))
  r <- resoudre_source(
    id = "mtime", url = "https://example.invalid/x", fichier = "deja-la.csv",
    cache = cache, lock = lock_fixture(), vintage_basis = "telechargement",
    reference_declaree = "2026-10-02",
    tirer = function(url, cible) stop("aucun téléchargement attendu")
  )
  expect_identical(r$acquired_at, "2026-10-02")
  expect_identical(r$date_reference, "2026-10-02")
  unlink(cache, recursive = TRUE)
})

test_that("le vintage des bornes vient de la date maximale du contenu", {
  cache <- tempfile("cache-bornes-")
  csv <- charToRaw(paste0(
    "id_station_itinerance;date_maj\n",
    "STIF-1;2026-07-12\nSTIF-2;2026-11-16\nSTIF-3;2026-09-30\n"
  ))
  r <- resoudre_source(
    id = "bornes-recharges", url = "https://example.invalid/bornes",
    fichier = "bornes.csv", cache = cache, lock = lock_fixture(),
    horloge = as.Date("2026-11-18"), vintage_basis = "contenu_date",
    tirer = function(url, cible) writeBin(csv, cible)
  )
  expect_identical(r$vintage_basis, "contenu_date")
  expect_identical(r$date_reference, "2026-11-16")
  expect_identical(r$vintage, "2026-11")
  unlink(cache, recursive = TRUE)
})

test_that("le vintage OSM vient du HeaderBlock PBF compressé (champ 32)", {
  octets <- pbf_fixture(1794864156, compresse = TRUE)
  r <- resoudre_source(
    id = "osm_reseaux", url = "https://example.invalid/osm",
    fichier = "extrait.pbf", cache = tempfile("cache-pbf-"), lock = lock_fixture(),
    horloge = as.Date("2026-11-18"), vintage_basis = "contenu_timestamp",
    tirer = function(url, cible) writeBin(octets, cible)
  )
  expect_identical(r$vintage_basis, "contenu_timestamp")
  expect_identical(r$date_reference, "2026-11-16")
})

test_that("le HeaderBlock PBF non compressé (champ raw) est aussi lu", {
  octets <- pbf_fixture(1794864156, compresse = FALSE)
  r <- resoudre_source(
    id = "osm_brut", url = "https://example.invalid/osm",
    fichier = "extrait.pbf", cache = tempfile("cache-pbf-brut-"), lock = lock_fixture(),
    horloge = as.Date("2026-11-18"), vintage_basis = "contenu_timestamp",
    tirer = function(url, cible) writeBin(octets, cible)
  )
  expect_identical(r$date_reference, "2026-11-16")
})

test_that("un OSM sans timestamp lisible retombe sur la date de téléchargement", {
  r <- resoudre_source(
    id = "osm_sans_timestamp", url = "https://example.invalid/osm",
    fichier = "extrait.pbf", cache = tempfile("cache-pbf-vide-"), lock = lock_fixture(),
    horloge = as.Date("2026-11-18"), vintage_basis = "contenu_timestamp",
    reference_declaree = "2026-11-18",
    tirer = function(url, cible) writeBin(charToRaw("pas de header"), cible)
  )
  expect_identical(r$vintage_basis, "telechargement")
  expect_identical(r$date_reference, "2026-11-18")
})

test_that("une source declaree garde son vintage de contrat", {
  r <- resoudre_source(
    id = "rp_emploi", url = "https://example.invalid/rp",
    fichier = "rp.bin", cache = tempfile("cache-declaree-"), lock = lock_fixture(),
    horloge = as.Date("2027-01-01"), vintage_basis = "declaree",
    vintage_declare = "2023", reference_declaree = "2023-01-01",
    tirer = function(url, cible) writeBin(octets_fixture("rp"), cible)
  )
  expect_identical(r$vintage, "2023")
  expect_identical(r$date_reference, "2023-01-01")
  expect_identical(r$vintage_basis, "declaree")
})

test_that("le digest est écrit une seule fois dans le sidecar du cache", {
  cache <- tempfile("cache-digest-")
  contenu <- octets_fixture("contenu haché une fois\n")
  r <- resoudre_source(
    id = "hachage", url = "https://example.invalid/x", fichier = "x.bin",
    cache = cache, lock = lock_fixture(), horloge = as.Date("2026-11-18"),
    vintage_basis = "telechargement",
    tirer = function(url, cible) writeBin(contenu, cible)
  )
  sidecar <- lire_digest_cache("hachage", cache)
  expect_equal(sidecar, r$digest)
  expect_identical(sidecar$sha256, empreinte_fixture(contenu))
  unlink(cache, recursive = TRUE)
})

test_that("le lockfile commité garde exactement les trois empreintes d'origine", {
  l <- lire_lock()
  expect_setequal(names(l), c("osm_reseaux", "korrigo", "bornes-recharges"))
  expect_equal(l$osm_reseaux$sha256,
               "fb8e00775d77f39f4c68ad5ac4b20d5589383734308ba5579d286c9f3e010704")
  expect_equal(l$osm_reseaux$bytes, 330755575)
  expect_equal(l$osm_reseaux$date_reference, "2026-11-16")
  expect_equal(l$osm_reseaux$vintage_basis, "contenu_timestamp")
  expect_equal(l$`bornes-recharges`$sha256,
               "733a0e8caadc28c29ddaab548d3d6b1d60d4a332d6de7530048a34e5b6629dc0")
  expect_equal(l$`bornes-recharges`$date_reference, "2026-11-11")
  expect_equal(l$`bornes-recharges`$vintage_basis, "contenu_date")
  expect_equal(l$korrigo$sha256,
               "321ded4dba4292b64ca35f1b73f9d820938b189ebc6e07165f79ca58aace2be0")
  expect_equal(l$korrigo$date_reference, "2026-11-18")
  expect_equal(l$korrigo$acquired_at, "2026-11-18")
  for (e in l) {
    expect_equal(e$acquired_at, "2026-11-18")
    expect_equal(e$vintage, "2026-11")
    expect_true(grepl("^[0-9a-f]{64}$", e$sha256))
  }
})

test_that("deux builds depuis les octets verrouillés sont byte-identiques à deux horloges", {
  manifest <- MANIFEST_DEMOGRAPHIE
  manifest$fichier <- paste0(manifest$id, ".txt")
  cache <- tempfile("cache-byte-identique-")
  dir.create(cache, recursive = TRUE)
  contenu <- charToRaw("octets verrouillés\n")
  h <- empreinte_fixture(contenu)
  registre <- list()
  for (i in seq_len(nrow(manifest))) {
    id <- manifest$id[[i]]
    writeBin(contenu, file.path(cache, manifest$fichier[[i]]))
    base <- manifest$vintage_basis[[i]]
    vintage <- if (identical(base, "declaree")) manifest$vintage[[i]] else "2026-11"
    reference <- if (identical(base, "declaree")) manifest$date_reference[[i]] else "2026-11-18"
    enregistrement <- list(
      source_id = id, url = manifest$url[[i]], sha256 = h,
      bytes = length(contenu), acquired_at = "2026-11-18",
      vintage_basis = base, vintage = vintage, date_reference = reference
    )
    registre[[id]] <- enregistrement
    ecrire_digest_cache(enregistrement, cache)
  }
  lock <- tempfile("lock-byte-identique-")
  ecrire_lock(registre, lock)

  construire <- function(jour) {
    # Deux horloges différentes, mêmes octets verrouillés.
    for (f in manifest$fichier) {
      Sys.setFileTime(file.path(cache, f),
                      as.POSIXct(paste0(jour, "T12:00:00"), tz = "UTC"))
    }
    for (i in seq_len(nrow(manifest))) {
      resoudre_source(
        id = manifest$id[[i]], url = manifest$url[[i]],
        fichier = manifest$fichier[[i]], cache = cache, lock = lock,
        horloge = as.Date(jour), vintage_basis = manifest$vintage_basis[[i]],
        vintage_declare = manifest$vintage[[i]],
        reference_declaree = manifest$date_reference[[i]],
        tirer = function(url, cible) stop("aucun téléchargement attendu")
      )
    }
    v <- vintages_depuis_manifest(manifest, cache = cache, lock = lock)
    sortie <- tempfile("sortie-byte-")
    dir.create(sortie)
    p <- compute_payload_test(load_fixture(), vintages = v)
    publish(p, sortie)
    sortie
  }

  a <- construire("2026-11-18")
  b <- construire("2027-04-02")
  fichiers <- intersect(list.files(a), list.files(b))
  expect_true(length(fichiers) > 0L)
  md5 <- function(dossier) {
    vapply(file.path(dossier, fichiers), function(f) unname(tools::md5sum(f)), character(1))
  }
  expect_identical(unname(md5(a)), unname(md5(b)))
})

test_that("relock_sources réécrit les enregistrements depuis un run, atomiquement", {
  run_dir <- tempfile("run-relock-")
  dir.create(run_dir)
  digests <- list(
    osm_reseaux = list(
      source_id = "osm_reseaux", url = "https://example.invalid/osm",
      sha256 = paste(rep("c", 64), collapse = ""), bytes = 42,
      acquired_at = "2027-01-06", vintage_basis = "contenu_timestamp",
      vintage = "2027-01", date_reference = "2027-01-05"
    )
  )
  ecrire_digests_source(digests, file.path(run_dir, NOM_DIGESTS))
  lock <- tempfile("lock-relock-")
  ecrire_lock(lire_lock(), lock)
  avant <- lire_lock(lock)

  relock_sources(run_dir, "osm_reseaux", lock)
  apres <- lire_lock(lock)
  expect_identical(apres$osm_reseaux$sha256, digests$osm_reseaux$sha256)
  expect_identical(apres$osm_reseaux$acquired_at, "2027-01-06")
  expect_identical(apres$osm_reseaux$vintage, "2027-01")
  # les autres enregistrements sont inchangés
  expect_identical(apres$korrigo$sha256, avant$korrigo$sha256)
})

test_that("une écriture atomique du lockfile qui échoue laisse l'ancien fichier", {
  p <- tempfile("lock-atomique-")
  ecrire_lock(list(list(source_id = "a", sha256 = "old")), p)
  avant <- readLines(p, warn = FALSE)
  err <- tryCatch(
    ecrire_atomique(function(temporaire) stop("panne"), p),
    error = function(e) e
  )
  expect_s3_class(err, "error")
  expect_identical(readLines(p, warn = FALSE), avant)
})
