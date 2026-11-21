# pin_sources -------------------------------------------------------------------
# Content-addressed source pins and derived vintage (issue #1099, parent #1040).
#
# A source that points at a live URL while the manifest declares a fixed vintage
# makes a rebuild change facts under an unchanged version label. This module is
# the ONE resolver every manifest fetch goes through:
#
#   - a pin exists and the cached bytes hash to it -> use them, no network ;
#   - the cached content is missing -> download it and verify against the pin ;
#   - no pin yet -> download, hash, derive the vintage and write the pin ;
#   - a pin exists but the bytes differ -> HARD ERROR naming the source, both
#     hashes and the deliberate repin command. Never silent drift.
#
# Vintage is DERIVED, never hardcoded: from an in-content date when the source
# carries one (content `date_maj`, OSM extract timestamp), else from the recorded
# download date. What is published in source_vintage is what the file actually
# is. Sources whose vintage comes from an immutable dated filename keep their
# declared vintage (`vintage_basis = "fichier_date"`).
#
# The pin registry lives at <cache>/pins/<source_id>.json (cache = data/raw by
# default). Those JSON files ARE versioned; the bytes they pin are not.

# `%||%` ------------------------------------------------------------------------
`%||%` <- function(x, y) if (is.null(x)) y else x

# BASIS_VINTAGE -----------------------------------------------------------------
# The closed vocabulary of vintage bases. `fichier_date` is the historical,
# dated-source case: the vintage is declared from an immutable filename/URL and
# must not move. The three others are derived and recorded in the pin.
BASIS_VINTAGE_DERIVES <- c("contenu_date_maj", "contenu_timestamp", "telechargement")
BASIS_VINTAGE <- c("fichier_date", BASIS_VINTAGE_DERIVES)

# SOURCES_EPINGLEES -------------------------------------------------------------
# The sources migrated to mandatory content pinning (issue #1099). A migrated
# source with no pin, or with an unmaterialised pin, fails closed; only the
# documented repin entry point may create/replace its pin. Other sources get a
# pin opportunistically on first acquisition, preserving the historical flow.
SOURCES_EPINGLEES <- list(
  osm_reseaux = list(vintage_basis = "contenu_timestamp"),
  korrigo = list(vintage_basis = "telechargement"),
  `bornes-recharges` = list(vintage_basis = "contenu_date_maj")
)

# chemin_pin --------------------------------------------------------------------
chemin_pin <- function(id, cache = "data/raw") {
  file.path(cache, "pins", paste0(id, ".json"))
}

# lire_pin / ecrire_pin ---------------------------------------------------------
lire_pin <- function(id, cache = "data/raw") {
  p <- chemin_pin(id, cache)
  if (!file.exists(p)) return(NULL)
  tryCatch(jsonlite::fromJSON(p, simplifyVector = FALSE), error = function(e) NULL)
}

ecrire_pin <- function(pin, cache = "data/raw") {
  dir.create(file.path(cache, "pins"), recursive = TRUE, showWarnings = FALSE)
  jsonlite::write_json(
    pin, chemin_pin(pin$source_id, cache),
    auto_unbox = TRUE, pretty = TRUE, na = "null"
  )
  invisible(pin)
}

# commande_repin ----------------------------------------------------------------
# The documented, deliberate repin entry point. Named in every pin error so the
# operator always knows how to move a vintage forward.
commande_repin <- function(id) {
  sprintf("Rscript pipeline/scripts/repin-source.R %s", id)
}

erreur_pin <- function(id, raison, sha256_attendu = NULL, sha256_observe = NULL) {
  cmd <- commande_repin(id)
  msg <- sprintf(
    "Pin source '%s' — %s. empreinte attendue : %s ; observée : %s. Pour réépingler délibérément : %s.",
    id, raison,
    sha256_attendu %||% "<absente>", sha256_observe %||% "<absente>", cmd
  )
  structure(
    list(
      message = msg, call = NULL, source_id = id,
      sha256_attendu = sha256_attendu, sha256_observe = sha256_observe,
      commande_repin = cmd
    ),
    class = c("erreur_pin", "error", "condition")
  )
}

# avec_vintage_basis ------------------------------------------------------------
# Every manifest source declares a vintage basis. Sources that do not declare
# one explicitly are dated sources (`fichier_date`) — their vintage is an
# immutable fact of the filename, never of the download clock.
avec_vintage_basis <- function(manifest, defaut = "fichier_date") {
  if (!"vintage_basis" %in% names(manifest)) {
    manifest$vintage_basis <- rep(defaut, nrow(manifest))
  } else {
    bases <- as.character(manifest$vintage_basis)
    manquants <- is.na(bases) | !nzchar(bases)
    bases[manquants] <- defaut
    manifest$vintage_basis <- bases
  }
  manifest
}

# deriver_date_maj --------------------------------------------------------------
# The bornes export is an ODS CSV export carrying a per-row `date_maj`. The real
# content date is the latest observation in the file, not the declared vintage.
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
# (osmosis_replication_timestamp, Unix seconds). The Geofabrik extract carries
# its "data up to" timestamp there; it is the honest reference date. A best
# effort reader: when the header is compressed/absent the caller falls back to
# the recorded download date, and records that basis instead.
deriver_timestamp_pbf <- function(chemin) {
  raw <- tryCatch(
    readBin(chemin, "raw", n = min(file.size(chemin), 65536)),
    error = function(e) raw(0)
  )
  if (!length(raw)) return(NULL)

  lire_varint <- function(r, pos) {
    valeur <- 0
    multiplicateur <- 1
    i <- pos
    while (i <= length(r) && i < pos + 10L) {
      octet <- as.integer(r[i])
      valeur <- valeur + (octet %% 128) * multiplicateur
      if (octet < 128) return(list(valeur = valeur, pos = i + 1L))
      multiplicateur <- multiplicateur * 128
      i <- i + 1L
    }
    NULL
  }

  i <- 1L
  while (i <= length(raw) - 1L) {
    cle <- lire_varint(raw, i)
    if (is.null(cle)) break
    champ <- cle$valeur %/% 8
    type <- cle$valeur %% 8
    if (type == 0L) {
      valeur <- lire_varint(raw, cle$pos)
      if (is.null(valeur)) break
      # Plausibility window: 2000-01-01 .. 2100-01-01, in seconds.
      if (champ == 32L &&
          valeur$valeur >= 946684800 && valeur$valeur <= 4102444800) {
        return(as.Date(as.POSIXct(valeur$valeur, origin = "1970-01-01", tz = "UTC")))
      }
      i <- valeur$pos
    } else if (type == 2L) {
      longueur <- lire_varint(raw, cle$pos)
      if (is.null(longueur)) break
      i <- longueur$pos + longueur$valeur
    } else if (type == 5L) {
      i <- cle$pos + 4L
    } else if (type == 1L) {
      i <- cle$pos + 8L
    } else {
      break
    }
  }
  NULL
}

# deriver_vintage ---------------------------------------------------------------
deriver_vintage <- function(chemin, jour, vintage_basis = "telechargement",
                            vintage_declare = NULL, reference_declaree = NULL) {
  base <- vintage_basis %||% "telechargement"
  par_telechargement <- function(basis = "telechargement") {
    list(
      vintage = format(jour, "%Y-%m"),
      date_reference = as.character(jour),
      vintage_basis = basis
    )
  }
  if (identical(base, "fichier_date")) {
    return(list(
      vintage = vintage_declare %||% format(jour, "%Y-%m"),
      date_reference = reference_declaree %||% as.character(jour),
      vintage_basis = "fichier_date"
    ))
  }
  if (identical(base, "contenu_date_maj")) {
    date <- deriver_date_maj(chemin)
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
  par_telechargement(base)
}

# resoudre_source ---------------------------------------------------------------
# The single resolver. `tirer(url, cible)` injects the fetch (the network seam);
# `horloge` injects the acquisition date. `etat` accumulates run statuses so a
# download failure carries them into erreur_telechargement as before.
resoudre_source <- function(id, url = NULL, fichier = NULL, cache = "data/raw",
                            type = "fichier", pull = NULL, mode_source = "cron",
                            sha256_manifeste = NULL, vintage_basis = NULL,
                            vintage_declare = NULL, reference_declaree = NULL,
                            tirer = NULL, horloge = NULL, repin = FALSE,
                            etat = NULL) {
  if (is.null(etat)) {
    etat <- new.env(parent = emptyenv())
    etat$statuts <- NULL
  }
  dir.create(file.path(cache, "pins"), recursive = TRUE, showWarnings = FALSE)
  cible <- file.path(cache, fichier)
  jour <- if (is.null(horloge)) Sys.Date() else as.Date(horloge)
  pin <- lire_pin(id, cache)
  requis <- id %in% names(SOURCES_EPINGLEES)
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

  empreinte <- function() {
    if (!file.exists(cible)) return(NULL)
    con <- file(cible, "rb")
    on.exit(close(con), add = TRUE)
    paste(openssl::sha256(con))
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

  # Un pin existe : le contenu est la référence, jamais l'URL live.
  if (!is.null(pin)) {
    if (!identical(pin$etat, "materialise") ||
        is.null(pin$sha256) || !nzchar(pin$sha256)) {
      stop(erreur_pin(id, "pin non matérialisé — repin requis"))
    }
    if (!file.exists(cible) || !verifier_fichier(cible)) {
      ok <- FALSE
      for (essai in 1:2) {
        reussi <- tryCatch({
          tirer_maintenant()
          TRUE
        }, error = function(e) FALSE)
        if (reussi && file.exists(cible) && verifier_fichier(cible)) {
          ok <- TRUE
          break
        }
        if (file.exists(cible)) unlink(cible)
      }
      if (!ok) echec()
    }
    h <- empreinte()
    if (!identical(h, pin$sha256)) {
      stop(erreur_pin(id, "contenu modifié sans repin", pin$sha256, h))
    }
    return(list(
      chemin = cible, sha256 = h, bytes = file.size(cible),
      vintage = pin$vintage, vintage_basis = pin$vintage_basis,
      date_reference = pin$date_reference, downloaded_at = pin$downloaded_at,
      pin = pin, statut = "frais"
    ))
  }

  # Aucun pin : une source épinglée échoue ; les autres suivent le flux
  # historique (sha256 du manifeste, 2 essais) puis sont épinglées.
  if (requis && !repin) {
    stop(erreur_pin(id, "source à pin obligatoire sans pin — repin requis"))
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
  }

  h <- empreinte()
  d <- deriver_vintage(
    cible, jour, vintage_basis = vintage_basis,
    vintage_declare = vintage_declare, reference_declaree = reference_declaree
  )
  pin <- list(
    source_id = id, url = url, sha256 = h, bytes = as.numeric(file.size(cible)),
    downloaded_at = as.character(jour), vintage = d$vintage,
    vintage_basis = d$vintage_basis, date_reference = d$date_reference,
    etat = "materialise"
  )
  ecrire_pin(pin, cache)
  list(
    chemin = cible, sha256 = h, bytes = file.size(cible),
    vintage = d$vintage, vintage_basis = d$vintage_basis,
    date_reference = d$date_reference, downloaded_at = pin$downloaded_at,
    pin = pin, statut = "frais"
  )
}

# tous_manifestes ---------------------------------------------------------------
# Les manifestes chargés dans l'espace de noms — utilisés par le repin pour
# retrouver la ligne d'une source sans maintenir une seconde liste d'URLs.
tous_manifestes <- function() {
  ns <- asNamespace("lusk")
  noms <- ls(ns, all.names = TRUE)
  noms <- noms[grepl("^MANIFEST_[A-Z0-9_]+$", noms)]
  objets <- mget(noms, envir = ns, inherits = TRUE)
  objets[vapply(objets, inherits, logical(1), "tbl_df")]
}

# repin_source ------------------------------------------------------------------
# The deliberate repin entry point: force a fresh acquisition of one migrated
# source, recompute its hash and vintage, replace its pin. This is the ONLY way
# a mandatory pin may move forward.
repin_source <- function(id, manifest = NULL, cache = "data/raw",
                         horloge = NULL, tirer = NULL) {
  if (is.null(manifest)) {
    candidats <- Filter(function(m) id %in% m$id, tous_manifestes())
    if (!length(candidats)) stop("Source inconnue : ", id, call. = FALSE)
    manifest <- candidats[[1L]]
  }
  ligne <- manifest[manifest$id == id, , drop = FALSE]
  if (nrow(ligne) != 1L) stop("Source inconnue : ", id, call. = FALSE)

  cible <- file.path(cache, ligne$fichier)
  if (file.exists(cible)) unlink(cible)
  p <- chemin_pin(id, cache)
  if (file.exists(p)) unlink(p)

  resoudre_source(
    id = id, url = ligne$url, fichier = ligne$fichier, cache = cache,
    type = if ("type" %in% names(ligne)) ligne$type else "fichier",
    pull = if ("pull" %in% names(ligne)) ligne$pull[[1L]] else NULL,
    vintage_basis = if ("vintage_basis" %in% names(ligne)) ligne$vintage_basis else NULL,
    vintage_declare = if ("vintage" %in% names(ligne)) ligne$vintage else NULL,
    reference_declaree = if ("date_reference" %in% names(ligne)) ligne$date_reference else NULL,
    horloge = horloge, tirer = tirer, repin = TRUE
  )
}
