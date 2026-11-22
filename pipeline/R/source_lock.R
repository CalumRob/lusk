# source_lock -------------------------------------------------------------------
# Unified source provenance (issue #1103, supersedes ADR-0047).
#
# ONE committed file, `sources.lock.json`, is the attribution baseline, the
# release freeze and the replacement for opt-in pins. One record per source:
# {source_id, url, sha256, bytes, acquired_at, vintage_basis, vintage,
#  date_reference}. It works like renv.lock.
#
# `resoudre_source()` remains the single resolver for every manifest fetch. It
# NEVER hard-fails on an upstream byte change (cron adopts the new bytes). When
# the resolved bytes hash to the lockfile record, it uses the record's
# acquired_at/vintage verbatim — deterministic, clock-free. Otherwise it
# derives the vintage from the declared basis. A source absent from the
# lockfile has "no baseline": it is resolved and derived normally, but lock
# attribution reports "no baseline" and publication refuses the run.
#
# Per-source digest sidecars are written under <cache>/.digests/ so vintage
# builders never re-hash large files and keep the `cache=` plumbing.

# champ_caractere ---------------------------------------------------------------
# L'UNIQUE normaliseur des champs d'enregistrement — lockfile `sources.lock.json`
# ET digests de run `source-digests.json`. `jsonlite` ramène un JSON `null` à
# NULL et un `[]` à une liste vide ; `as.character(NULL)` donne character(0),
# ce qui casse l'affectation d'une cellule et ré-écrit `[]` dans le lockfile au
# relock suivant (review PR #1121 : le relock #1105 écrit un enregistrement pour
# CHAQUE source, dont les DPE dont `date_reference` est NA). On normalise en
# NA_character_ — « champ absent », pas « pas d'attestation ».
champ_caractere <- function(x) {
  if (length(x) != 1L) return(NA_character_)
  as.character(x)
}

# Les champs TEXTE d'un enregistrement, normalisés une fois pour toutes dès la
# lecture du lockfile : aucun consommateur n'a à refaire la conversion.
CHAMPS_LOCK_TEXTE <- c(
  "source_id", "url", "sha256", "acquired_at", "vintage_basis", "vintage",
  "date_reference"
)

# chemin_lock -------------------------------------------------------------------
chemin_lock <- function(lock = NULL) {
  if (!is.null(lock)) return(lock)
  env <- Sys.getenv("LUSK_SOURCES_LOCK", unset = "")
  if (nzchar(env)) return(env)
  p <- system.file("sources.lock.json", package = "lusk")
  if (nzchar(p) && file.exists(p)) return(p)
  "sources.lock.json"
}

# lire_lock / ecrire_lock -------------------------------------------------------
lire_lock <- function(lock = NULL) {
  p <- chemin_lock(lock)
  if (!file.exists(p)) return(list())
  brut <- tryCatch(
    jsonlite::fromJSON(p, simplifyVector = FALSE),
    error = function(e) NULL
  )
  if (is.null(brut)) return(list())
  enregistrements <- if (is.list(brut) && !is.null(brut$sources)) brut$sources else brut
  if (!is.list(enregistrements) || !length(enregistrements)) return(list())
  noms <- vapply(enregistrements, function(e) as.character(e$source_id %||% ""), character(1))
  enregistrements <- lapply(enregistrements, function(e) {
    for (champ in CHAMPS_LOCK_TEXTE) {
      e[[champ]] <- champ_caractere(e[[champ]])
    }
    e
  })
  stats::setNames(enregistrements, noms)
}

ecrire_lock <- function(enregistrements, lock = NULL) {
  p <- chemin_lock(lock)
  ecrire_atomique(
    function(temporaire) {
      jsonlite::write_json(
        unname(enregistrements), temporaire, auto_unbox = TRUE,
        pretty = TRUE, na = "null", digits = 17
      )
    },
    p
  )
  invisible(enregistrements)
}

# commande_relock ---------------------------------------------------------------
commande_relock <- function(id = NULL) {
  # Issue #1122 : une seule forme documentée, celle qui marche — lancée depuis
  # pipeline/ pour que le .Rprofile active la bibliothèque renv. Le script
  # refuse tôt toute invocation depuis la racine (jamais de renv:: actif ici).
  base <- "cd pipeline && Rscript scripts/relock-sources.R <run-dir>"
  if (is.null(id)) base else paste(base, id)
}

# empreinte_fichier -------------------------------------------------------------
empreinte_fichier <- function(chemin) {
  if (!file.exists(chemin)) return(NULL)
  con <- file(chemin, "rb")
  on.exit(close(con), add = TRUE)
  paste(openssl::sha256(con))
}

# Digest sidecars (per cache, runtime only — never committed) -------------------
chemin_digest_cache <- function(id, cache = "data/raw") {
  file.path(cache, ".digests", paste0(id, ".json"))
}

lire_digest_cache <- function(id, cache = "data/raw", fichier = NULL) {
  p <- chemin_digest_cache(id, cache)
  if (!file.exists(p)) return(NULL)
  d <- tryCatch(jsonlite::fromJSON(p, simplifyVector = FALSE), error = function(e) NULL)
  if (is.null(d)) return(NULL)
  # Review #1121 : UN seul normaliseur pour les champs d'enregistrement, y
  # compris ceux du sidecar (un `null` JSON doit devenir NA_character_, jamais
  # character(0) — sinon le champ disparaît à l'écriture suivante).
  for (champ in CHAMPS_LOCK_TEXTE) {
    d[[champ]] <- champ_caractere(d[[champ]])
  }
  # Issue #1103 (revue) : un sidecar n'est valable QUE pour les octets qu'il a
  # hachés. Nom de fichier, taille et mtime doivent concorder, sinon le digest
  # est périmé et le résolveur doit re-hacher.
  if (!is.null(fichier)) {
    cible <- file.path(cache, fichier)
    # Issue #1119 : `bytes` est la taille de CE QUI EST HACHÉ — la plage d'octets
    # `features` pour une lecture WFS, pas les octets du fichier. La fraîcheur du
    # sidecar suit donc `fichier_octets` (la taille réelle du fichier) quand il
    # est présent ; les sidecars plus anciens n'ont que `bytes` (octets bruts).
    octets_fichier <- champ_caractere(d$fichier_octets %||% d$bytes)
    if (!file.exists(cible) ||
        !identical(champ_caractere(d$fichier), champ_caractere(fichier)) ||
        !isTRUE(all.equal(as.numeric(octets_fichier), as.numeric(file.size(cible)))) ||
        !isTRUE(all.equal(as.numeric(champ_caractere(d$mtime)),
                          as.numeric(file.mtime(cible))))) {
      return(NULL)
    }
  }
  d
}

ecrire_digest_cache <- function(digest, cache = "data/raw") {
  ecrire_atomique(
    function(temporaire) {
      jsonlite::write_json(
        digest, temporaire, auto_unbox = TRUE, na = "null", digits = 17
      )
    },
    chemin_digest_cache(digest$source_id, cache)
  )
  invisible(digest)
}

# deriver_date_maj --------------------------------------------------------------
deriver_date_maj <- function(chemin) {
  donnees <- tryCatch(
    readr::read_delim(
      chemin, delim = ";",
      col_types = readr::cols(.default = readr::col_character()),
      show_col_types = FALSE
    ),
    error = function(e) NULL
  )
  if (is.null(donnees) || !"date_maj" %in% names(donnees)) return(NULL)
  dates <- suppressWarnings(as.Date(
    as.character(donnees$date_maj),
    tryFormats = c("%Y-%m-%d", "%Y/%m/%d", "%Y-%m-%dT%H:%M:%S", "%d/%m/%Y")
  ))
  dates <- dates[!is.na(dates)]
  if (!length(dates)) NULL else max(dates)
}

# deriver_timestamp_pbf ---------------------------------------------------------
# Minimal protobuf scan of an OSM PBF header for field 32
# (osmosis_replication_timestamp, Unix seconds). The real Geofabrik extract
# stores a zlib-compressed HeaderBlock (Blob field 3); R's memDecompress with
# type="gzip" accepts both zlib and gzip streams. Verified on
# bretagne-latest.osm.pbf: field 32 = 1794864156, i.e. 2026-11-16. Keep the
# compression parse and its fixtures intact (known pitfall, issue #1103).
lire_varint_protobuf <- function(octets, pos) {
  valeur <- 0
  multiplicateur <- 1
  i <- pos
  while (i <= length(octets) && i < pos + 10L) {
    octet <- as.integer(octets[i])
    valeur <- valeur + (octet %% 128) * multiplicateur
    if (octet < 128) return(list(valeur = valeur, pos = i + 1L))
    multiplicateur <- multiplicateur * 128
    i <- i + 1L
  }
  NULL
}

lire_champs_protobuf <- function(octets) {
  champs <- list()
  i <- 1L
  while (i <= length(octets)) {
    cle <- lire_varint_protobuf(octets, i)
    if (is.null(cle)) break
    champ <- cle$valeur %/% 8
    type <- cle$valeur %% 8
    if (type == 0L) {
      valeur <- lire_varint_protobuf(octets, cle$pos)
      if (is.null(valeur)) break
      champs[[length(champs) + 1L]] <- list(champ = champ, type = type, valeur = valeur$valeur)
      i <- valeur$pos
    } else if (type == 2L) {
      longueur <- lire_varint_protobuf(octets, cle$pos)
      if (is.null(longueur)) break
      fin <- longueur$pos + longueur$valeur - 1
      if (fin > length(octets)) break
      champs[[length(champs) + 1L]] <- list(
        champ = champ, type = type, valeur = octets[longueur$pos:fin]
      )
      i <- fin + 1L
    } else if (type == 5L) {
      if (cle$pos + 3L > length(octets)) break
      champs[[length(champs) + 1L]] <- list(
        champ = champ, type = type, valeur = octets[cle$pos:(cle$pos + 3L)]
      )
      i <- cle$pos + 4L
    } else if (type == 1L) {
      if (cle$pos + 7L > length(octets)) break
      champs[[length(champs) + 1L]] <- list(
        champ = champ, type = type, valeur = octets[cle$pos:(cle$pos + 7L)]
      )
      i <- cle$pos + 8L
    } else {
      break
    }
  }
  champs
}

champ_protobuf <- function(champs, numero, type) {
  for (c in champs) {
    if (c$champ == numero && c$type == type) return(c$valeur)
  }
  NULL
}

deriver_timestamp_pbf <- function(chemin) {
  con <- tryCatch(file(chemin, "rb"), error = function(e) NULL)
  if (is.null(con)) return(NULL)
  on.exit(close(con), add = TRUE)

  taille <- readBin(con, "raw", n = 4L)
  if (length(taille) < 4L) return(NULL)
  n <- as.integer(taille[1]) * 2^24 + as.integer(taille[2]) * 2^16 +
       as.integer(taille[3]) * 2^8 + as.integer(taille[4])
  if (!is.finite(n) || n < 1 || n > 1e6) return(NULL)
  blob_header <- readBin(con, "raw", n = n)
  if (length(blob_header) < n) return(NULL)
  champs_header <- lire_champs_protobuf(blob_header)
  type <- champ_protobuf(champs_header, 1L, 2L)
  if (is.null(type) || !identical(rawToChar(type), "OSMHeader")) return(NULL)
  taille_blob <- champ_protobuf(champs_header, 3L, 0L)
  if (is.null(taille_blob) || taille_blob < 1 || taille_blob > 1e8) return(NULL)

  blob <- readBin(con, "raw", n = taille_blob)
  if (length(blob) < taille_blob) return(NULL)
  champs_blob <- lire_champs_protobuf(blob)
  brut <- champ_protobuf(champs_blob, 1L, 2L)
  compresse <- champ_protobuf(champs_blob, 3L, 2L)
  header_block <- if (!is.null(brut)) {
    brut
  } else if (!is.null(compresse)) {
    tryCatch(memDecompress(compresse, type = "gzip"), error = function(e) NULL)
  } else {
    NULL
  }
  if (is.null(header_block)) return(NULL)

  timestamp <- champ_protobuf(lire_champs_protobuf(header_block), 32L, 0L)
  if (is.null(timestamp) || timestamp < 946684800 || timestamp > 4102444800) {
    return(NULL)
  }
  as.Date(as.POSIXct(timestamp, origin = "1970-01-01", tz = "UTC"))
}

# deriver_vintage ---------------------------------------------------------------
# Derive the published vintage from the declared basis. `declaree` keeps the
# manifest's literal; derived bases read the file, falling back to the
# acquisition date (basis `telechargement`) when no content date is present.
deriver_vintage <- function(chemin, jour, vintage_basis = "telechargement",
                            vintage_declare = NULL, reference_declaree = NULL,
                            id = NULL) {
  base <- vintage_basis %||% "telechargement"
  par_telechargement <- function() {
    list(
      vintage = format(jour, "%Y-%m"),
      # Une source qui déclare NA n'a PAS de date de référence unique (ORT,
      # DPE) : on ne lui en invente pas une, même en base `telechargement`.
      date_reference = if (length(reference_declaree) &&
                           !is.na(reference_declaree)) {
        as.character(jour)
      } else {
        NA_character_
      },
      vintage_basis = "telechargement"
    )
  }
  if (identical(base, "declaree")) {
    return(list(
      vintage = vintage_declare %||% format(jour, "%Y-%m"),
      date_reference = reference_declaree %||% as.character(jour),
      vintage_basis = "declaree"
    ))
  }
  if (identical(base, "contenu_date")) {
    # One registry of extractors, keyed by source id — no if-cascade on ids.
    # The ORT extractor reuses lire_ort() itself (no re-implemented XLSX parse).
    date <- extracteur_date_contenu(id)(chemin)
    if (!is.null(date)) {
      return(list(
        vintage = format(date, "%Y-%m"), date_reference = as.character(date),
        vintage_basis = base
      ))
    }
    return(par_telechargement())
  }
  if (identical(base, "contenu_timestamp")) {
    date <- deriver_timestamp_pbf(chemin)
    if (!is.null(date)) {
      return(list(
        vintage = format(date, "%Y-%m"), date_reference = as.character(date),
        vintage_basis = base
      ))
    }
    return(par_telechargement())
  }
  par_telechargement()
}

# resoudre_source ---------------------------------------------------------------
# The single resolver. `tirer(url, cible)` injects the fetch (network seam);
# `horloge` injects the acquisition date for a fresh download. `lock` injects
# the lockfile (tests use a temporary one). Drift is never fatal here: the
# resolver records the run's digest and lets attribution/publication decide.
resoudre_source <- function(id, url = NULL, fichier = NULL, cache = "data/raw",
                            type = "fichier", pull = NULL, mode_source = "cron",
                            sha256_manifeste = NULL, vintage_basis = "declaree",
                            vintage_declare = NULL, reference_declaree = NULL,
                            tirer = NULL, horloge = NULL, etat = NULL,
                            lock = NULL, empreinte = NULL) {
  if (is.null(etat)) {
    etat <- new.env(parent = emptyenv())
    etat$statuts <- NULL
  }
  dir.create(cache, recursive = TRUE, showWarnings = FALSE)
  cible <- file.path(cache, fichier)
  jour_fichier <- if (file.exists(cible)) as.Date(file.mtime(cible)) else NULL
  jour_fetch <- if (!is.null(horloge)) as.Date(horloge) else Sys.Date()
  etiquette <- if (identical(type, "api")) paste0("api:", id) else url

  tirer_maintenant <- function() {
    if (!is.null(tirer)) {
      tirer(url, cible)
      return(invisible(NULL))
    }
    ligne <- tibble::tibble(
      id = id, url = url, fichier = fichier, mode = mode_source,
      type = type, pull = list(pull)
    )
    tirer_source(type, ligne, 1L, cible)
    invisible(NULL)
  }

  echec <- function() {
    statuts <- etat$statuts
    if (is.null(statuts)) {
      statuts <- tibble::tibble(
        id = character(0), mode = character(0), status = character(0)
      )
    }
    statuts <- tibble::add_row(statuts, id = id, mode = mode_source, status = "échec")
    stop(erreur_telechargement(statuts, etiquette))
  }

  if (!file.exists(cible) || !verifier_fichier(cible) ||
      !verifier_empreinte_fichier(cible, sha256_manifeste)) {
    if (file.exists(cible)) unlink(cible)
    ok <- FALSE
    for (essai in 1:2) {
      reussi <- tryCatch({
        tirer_maintenant()
        TRUE
      }, error = function(e) FALSE)
      if (reussi && file.exists(cible) && verifier_source(cible, sha256_manifeste)) {
        ok <- TRUE
        break
      }
      if (file.exists(cible)) unlink(cible)
    }
    if (!ok) echec()
    jour <- jour_fetch
  } else {
    jour <- jour_fichier %||% jour_fetch
  }

  # Issue #1119 : le hacheur est choisi par le registre des lectures WFS (ou
  # injecté). Il renvoie {sha256, bytes, hachage} : pour communes_limites, le
  # sha256 porte sur la plage d'octets `features` du GeoJSON et non sur l'enveloppe
  # volatile, tandis que `fichier_octets` garde la taille réelle du fichier.
  hacheur <- empreinte %||% empreinte_source(id)
  detail <- hacheur(cible)
  h <- detail$sha256
  registre <- lire_lock(lock)
  verrouille <- registre[[id]]
  verrouille_ok <- !is.null(verrouille) &&
    identical(champ_caractere(verrouille$sha256), champ_caractere(h))

  if (verrouille_ok) {
    # Determinism: locked bytes publish the lock's vintage, never the clock.
    # Les champs sont déjà normalisés par lire_lock() : un `date_reference`
    # JSON null est NA_character_, jamais un vecteur vide.
    acquired_at <- champ_caractere(verrouille$acquired_at)
    vintage <- champ_caractere(verrouille$vintage)
    date_reference <- champ_caractere(verrouille$date_reference)
    base <- champ_caractere(verrouille$vintage_basis)
  } else {
    d <- deriver_vintage(
      cible, jour, vintage_basis = vintage_basis,
      vintage_declare = vintage_declare, reference_declaree = reference_declaree,
      id = id
    )
    acquired_at <- as.character(jour)
    vintage <- d$vintage
    date_reference <- d$date_reference
    base <- d$vintage_basis
  }

  digest <- list(
    source_id = id,
    url = url,
    sha256 = h,
    bytes = as.numeric(champ_caractere(detail$bytes)),
    hachage = champ_caractere(detail$hachage),
    # Empreinte de fraîcheur du sidecar (issue #1103, revue) : nom, taille et
    # mtime du fichier réellement lu — tout changement invalide le digest.
    # `bytes` peut être la taille de la plage features hachée (#1119) : la taille
    # BRUTE du fichier est donc portée séparément pour la garde de fraîcheur.
    fichier = fichier,
    fichier_octets = as.numeric(file.size(cible)),
    mtime = as.numeric(file.mtime(cible)),
    acquired_at = acquired_at,
    vintage_basis = base,
    vintage = vintage,
    date_reference = date_reference
  )
  ecrire_digest_cache(digest, cache)

  list(
    chemin = cible, sha256 = h, bytes = file.size(cible),
    acquired_at = acquired_at, vintage = vintage, vintage_basis = base,
    date_reference = date_reference, digest = digest,
    verrouille = verrouille_ok, sans_reference = is.null(verrouille),
    statut = "frais"
  )
}

# relock_sources ----------------------------------------------------------------
# The deliberate relock entry point (issue #1103): rewrite lockfile records
# from a run's source-digests.json in ONE atomic write. A failed write keeps
# the previous lockfile intact. Without ids, every digest of the run is used.
relock_sources <- function(run_dir, ids = NULL, lock = NULL) {
  digests <- lire_digests_source(file.path(run_dir, NOM_DIGESTS))
  if (!length(digests)) {
    stop("Aucune empreinte dans ", file.path(run_dir, NOM_DIGESTS),
         " — relock impossible.", call. = FALSE)
  }
  cibles <- if (is.null(ids)) names(digests) else as.character(ids)
  manquants <- setdiff(cibles, names(digests))
  if (length(manquants)) {
    stop("Source absente des empreintes du run : ",
         paste(manquants, collapse = ", "), ".", call. = FALSE)
  }
  # Toute source relockée doit avoir une base déclarée (échec bruyant sinon).
  for (id in cibles) invisible(base_vintage(id))
  registre <- lire_lock(lock)
  for (id in cibles) {
    d <- digests[[id]]
    # Un digest de run est du JSON au même titre que le lockfile : un champ
    # `null` (date_reference des bases roulantes) doit devenir NA_character_,
    # jamais character(0) ré-écrit `[]` dans le lockfile par write_json.
    registre[[id]] <- list(
      source_id = champ_caractere(id),
      url = champ_caractere(d$url),
      sha256 = champ_caractere(d$sha256),
      bytes = as.numeric(champ_caractere(d$bytes)),
      acquired_at = champ_caractere(d$acquired_at),
      vintage_basis = champ_caractere(d$vintage_basis),
      vintage = champ_caractere(d$vintage),
      date_reference = champ_caractere(d$date_reference)
    )
  }
  ecrire_lock(registre, lock)
  invisible(registre)
}

# tous_manifestes ---------------------------------------------------------------
tous_manifestes <- function() {
  ns <- asNamespace("lusk")
  noms <- ls(ns, all.names = TRUE)
  noms <- noms[grepl("^MANIFEST_[A-Z0-9_]+$", noms)]
  objets <- mget(noms, envir = ns, inherits = TRUE)
  objets[vapply(objets, inherits, logical(1), "tbl_df")]
}
