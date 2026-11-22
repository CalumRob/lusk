# wfs_digest — empreinte des lectures WFS (issue #1119, revue 1) -----------------
#
# Une réponse GetFeature de data.geopf.fr (Admin Express, fond de carte ADR-0008
# comme référentiel des limites communales `communes_limites`) porte une enveloppe
# VOLATILE : `timeStamp` change à chaque requête — mesuré le 2026-11-22, deux
# fetches à 2 s d'écart ne différaient QUE par ce membre — et `numberMatched` /
# `numberReturned` / `totalFeatures` suivent la charge. Hacher la réponse brute
# rendait l'empreinte instable : le gel de release (ADR-0048, décision 5) refusait
# TOUTE publication.
#
# UN SEUL helper sert toutes les lectures WFS : il hache les OCTETS BRUTS de la
# plage du tableau `features`, exactement tels que le serveur les a envoyés.
# Ni parse JSON, ni re-sérialisation : la première version (jsonlite parse +
# toJSON) prenait 574,9 s sur le vrai communes_limites.geojson de 97 Mo. Les
# bornes sont trouvées par analyses BORNÉES de l'en-tête et de la queue ; le
# hachage d'un fichier est streamé par blocs (jamais de chaîne de 97 Mo en R).
# Une enveloppe non reconnue échoue bruyamment — jamais de repli sur tout le
# fichier. `bytes` est la taille de la plage hachée ; `hachage` le dit.

# erreur_enveloppe_wfs -----------------------------------------------------------
erreur_enveloppe_wfs <- function(detail) {
  structure(
    list(
      message = paste0(
        "Enveloppe WFS non reconnue : ", detail,
        " — aucun hachage du fichier entier (intentionnellement fail-closed)."
      ),
      call = NULL
    ),
    class = c("erreur_enveloppe_wfs", "error", "condition")
  )
}

# --fenetres_wfs ----------------------------------------------------------------
# Deux fenêtres BORNÉES : l'en-tête (où GeoServer écrit
# `{"type":"FeatureCollection","features":[`) et la queue (où il écrit
# `],"numberMatched":…,"numberReturned":…,"timeStamp":"…"}`). Le tableau lui-
# même, potentiellement énorme, n'est jamais lu ici (la queue peut s'élargir
# par pas jusqu'à 64 Mo si le dernier feature est exceptionnellement grand).
.fenetres_wfs <- function(source, queue_head, queue_tail) {
  if (is.raw(source)) {
    total <- length(source)
    tete <- source[seq_len(min(queue_head, total))]
    debut_queue <- max(0L, total - queue_tail)
    queue <- if (debut_queue == 0L) source else source[(debut_queue + 1L):total]
  } else {
    if (!is.character(source) || length(source) != 1L || !file.exists(source)) {
      stop(erreur_enveloppe_wfs("source ni fichier lisible ni vecteur brut"))
    }
    total <- as.numeric(file.info(source)$size)
    con <- file(source, "rb")
    on.exit(close(con), add = TRUE)
    tete <- readBin(con, "raw", n = min(queue_head, total))
    debut_queue <- max(0, total - queue_tail)
    seek(con, where = debut_queue, origin = "start")
    queue <- readBin(con, "raw", n = min(queue_tail, total - debut_queue))
  }
  list(total = total, tete = tete, debut_queue = debut_queue, queue = queue)
}

# --localiser_features_wfs ------------------------------------------------------
# Retourne les offsets 0-based [debut, fin] de la plage `features` (crochets
# inclus). La fermeture est le `]` immédiatement suivi d'un membre d'enveloppe
# connu — pas un `]` interne à une géométrie (on prend le DERNIER de la queue,
# donc le plus proche de la fin du document).
.localiser_features_wfs <- function(source, queue_head, queue_tail) {
  motif <- paste0(
    '\\][[:space:]]*,[[:space:]]*',
    '"(totalFeatures|numberMatched|numberReturned|timeStamp|crs)"'
  )

  # 1. En-tête BORNÉ : la clé `features` et son '[' d'ouverture.
  tete <- .fenetres_wfs(source, queue_head, queue_tail)
  if (tete$total == 0L) stop(erreur_enveloppe_wfs("réponse vide"))
  m <- regexpr('"features"[[:space:]]*:', rawToChar(tete$tete),
               perl = TRUE, useBytes = TRUE)
  if (m[[1L]] < 1L) {
    stop(erreur_enveloppe_wfs("clé \"features\" absente de l'en-tête"))
  }
  pos <- m[[1L]] + attr(m, "match.length")
  blancs <- c(0x20, 0x09, 0x0a, 0x0d)
  while (pos <= length(tete$tete) && as.integer(tete$tete[pos]) %in% blancs) {
    pos <- pos + 1L
  }
  if (pos > length(tete$tete) || as.integer(tete$tete[pos]) != as.integer(0x5b)) {
    stop(erreur_enveloppe_wfs("'[' d'ouverture de features introuvable en tête"))
  }
  debut <- pos - 1L

  # 2. Queue BORNÉE : le ']' de fermeture, suivi d'un membre d'enveloppe connu.
  # Si le DERNIER feature est exceptionnellement volumineux, on élargit par pas
  # jusqu'à un plafond — jamais le fichier entier.
  plafond <- 64L * 1024L * 1024L
  occ <- NULL
  f <- NULL
  qt <- queue_tail
  repeat {
    f <- .fenetres_wfs(source, queue_head, qt)
    trouve <- gregexpr(motif, rawToChar(f$queue), perl = TRUE, useBytes = TRUE)[[1L]]
    if (!(length(trouve) == 1L && trouve[[1L]] == -1L)) {
      occ <- trouve
      break
    }
    if (qt >= plafond || f$total <= qt) break
    qt <- min(qt * 2L, plafond)
  }
  if (is.null(occ)) {
    stop(erreur_enveloppe_wfs(
      "membre de fin (timeStamp/numberMatched/numberReturned/crs) absent — ']' de fermeture introuvable"
    ))
  }

  fin <- f$debut_queue + occ[length(occ)] - 1L
  if (fin <= debut) {
    stop(erreur_enveloppe_wfs("fermeture de features avant son ouverture"))
  }
  list(debut = debut, fin = fin, octets = fin - debut + 1L)
}

# --sha256_span_fichier ---------------------------------------------------------
# Stream de la plage vers un fichier temporaire par blocs de 1 Mo, puis hachage
# via openssl sur une CONNECTION (le C d'openssl lit par blocs : empreinte mémoire
# constante, jamais 97 Mo en R). Le fichier d'origine n'est pas modifié.
.sha256_span_fichier <- function(chemin, debut, fin, bloc) {
  temporaire <- tempfile("wfs-span-")
  entree <- file(chemin, "rb")
  on.exit(try(close(entree), silent = TRUE), add = TRUE)
  sortie <- file(temporaire, "wb")
  on.exit({
    try(close(sortie), silent = TRUE)
    unlink(temporaire)
  }, add = TRUE)

  seek(entree, where = debut, origin = "start")
  restant <- fin - debut + 1
  while (restant > 0) {
    n <- min(bloc, restant)
    octets <- readBin(entree, "raw", n = n)
    if (length(octets) != n) {
      stop(erreur_enveloppe_wfs("lecture tronquée de la plage features"))
    }
    writeBin(octets, sortie)
    restant <- restant - n
  }
  close(sortie)
  # openssl::sha256(con) consomme et FERME la connection elle-même.
  hachage <- file(temporaire, "rb")
  paste(openssl::sha256(hachage))
}

# empreinte_wfs_features --------------------------------------------------------
# Le SEUL propriétaire du hachage WFS. `source` est soit le CHEMIN d'un fichier
# GeoJSON (streamé), soit le CORPS BRUT d'une réponse (vecteur raw, tel que
# httr2::resp_body_raw()). Les deux chemins produisent exactement le même sha256
# pour les mêmes octets — c'est le contrat testé en revue #1119.
empreinte_wfs_features <- function(source, queue_head = 8192L,
                                   queue_tail = 8388608L, bloc = 1048576L) {
  span <- .localiser_features_wfs(source, queue_head, queue_tail)
  sha256 <- if (is.raw(source)) {
    paste(openssl::sha256(source[(span$debut + 1L):(span$fin + 1L)]))
  } else {
    .sha256_span_fichier(source, span$debut, span$fin, bloc)
  }
  list(
    sha256 = sha256,
    bytes = span$octets,
    hachage = "octets_features_wfs"
  )
}

# --- Hachage d'un fichier du cache ---------------------------------------------
# Un « hacheur » renvoie toujours {sha256, bytes, hachage} : `bytes` est la
# taille de CE QUI EST HACHÉ. La taille brute du fichier reste portée à part par
# le digest (`fichier_octets`) pour la validité du sidecar.

empreinte_fichier_brut <- function(chemin) {
  list(
    sha256 = empreinte_fichier(chemin),
    bytes = as.numeric(file.size(chemin)),
    hachage = "octets_bruts"
  )
}

# communes_limites.geojson est téléchargé sur le MÊME WFS que le fond de carte :
# son enveloppe porte le même timeStamp volatile. On laisse les octets du fichier
# INTACTS (c'est le contrat du cache) et on ne hache que sa plage features.
empreinte_fichier_wfs <- function(chemin) {
  empreinte_wfs_features(chemin)
}

# HACHAGE_WFS_PAR_ID -------------------------------------------------------------
# Les sources de MANIFEST_* dont le fichier cache est une réponse GetFeature
# GeoJSON. Registre par id, comme VINTAGE_BASIS_PAR_ID : aucun défaut implicite —
# une nouvelle lecture WFS doit être déclarée ici (et couverte par un test).
HACHAGE_WFS_PAR_ID <- c(communes_limites = "empreinte_fichier_wfs")

# Le hacheur d'une source, résolu au point d'usage (pas de dépendance Collate).
empreinte_source <- function(id) {
  nom <- unname(HACHAGE_WFS_PAR_ID[as.character(id)])
  if (length(nom) != 1L || is.na(nom) || !nzchar(nom)) {
    return(empreinte_fichier_brut)
  }
  get(nom, envir = asNamespace("lusk"), mode = "function", inherits = FALSE)
}
