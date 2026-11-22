# download --------------------------------------------------------------------
# Étape 1 : téléchargement. Lit le manifeste des sources (le manifeste vit
# dans le module du thème — issue #13), récupère les jeux de données vers le
# cache brut (data/raw, dans le dépôt — jamais sur C:).
# Le manifeste est le SEAM du téléchargement : une table de sources vérifiées
# (docs/research/rp-dossier-complet.md), testée pour son intégrité, jamais
# exécutée contre le réseau dans la boucle de test. Chaque source déclare son
# `type` (issue #13) :
#   - "fichier" : URL -> fichier, intégrité vérifiée (le comportement
#     historique) ;
#   - "api"     : une fonction de pull, mise en cache dans un fichier — le
#     seam mockable du pull DPE qui arrive dans un ticket ultérieur (Habitat),
#     testé avec un faux, jamais contre le réseau.
# Un manifeste sans colonne `type` est traité tout en « fichier » (manifestes
# antérieurs à l'issue #13 — comportement historique).
#
# Issue #1103 : tout fetch passe par resoudre_source() (source_lock.R)
# — le résolveur unique. Le téléchargement lui-même reste mockable ici via
# telecharger_fichier/tirer_source, exactement comme avant.

# ecrire_atomique -------------------------------------------------------------
# Écrire un fichier complet dans un TEMPORAIRE du MÊME dossier, puis le renommer
# vers sa destination (issue #1103) : un téléchargement partiel ou un lockfile
# à moitié écrit ne peut jamais remplacer une bonne copie. Le seam `ecrire` est
# injectable pour tester l'échec en cours d'écriture. Sur Windows, file.rename
# ne remplace pas une cible existante : on ne la retire qu'après un premier
# échec, la nouvelle copie étant déjà complète.
ecrire_atomique <- function(ecrire, cible) {
  dossier <- dirname(cible)
  dir.create(dossier, recursive = TRUE, showWarnings = FALSE)
  temporaire <- tempfile(pattern = ".ecriture-", tmpdir = dossier)
  on.exit(if (file.exists(temporaire)) unlink(temporaire), add = TRUE)
  ecrire(temporaire)
  ok <- file.rename(temporaire, cible)
  if (!ok && file.exists(cible)) {
    unlink(cible)
    ok <- file.rename(temporaire, cible)
  }
  if (!ok) stop("Écriture atomique impossible : ", cible, call. = FALSE)
  invisible(cible)
}

# Validation structurelle des textes (issue #1108) -----------------------------
# Un export délimité ou JSON tronqué ressemble à une dérive amont : il passe le
# garde-fou « existe et non vide » puis est réutilisé comme frais indéfiniment
# (et, depuis #1103, se fait hacher et figer dans sources.lock.json). On ne PARSE
# jamais le fichier entier — jusqu'à ~370 Mo — : deux lectures BORNÉES suffisent,
# l'en-tête (délimiteur + nombre de champs attendu) et la fin (dernier octet +
# dernier enregistrement). Les formats binaires (.rds, .zip, .7z, .gz, .pbf,
# .parquet, .xlsx…) gardent leurs contrôles historiques et ne sont pas touchés.

TAILLE_FIN_LECTURE <- 262144L  # 256 Kio : largement plusieurs enregistrements

lire_octet_final <- function(chemin) {
  con <- file(chemin, "rb")
  on.exit(close(con), add = TRUE)
  seek(con, where = -1L, origin = "end")
  readBin(con, "raw", n = 1L)
}

lire_octets_fin <- function(chemin, n = TAILLE_FIN_LECTURE) {
  taille <- file.size(chemin)
  a_lire <- as.integer(min(taille, as.numeric(n)))
  con <- file(chemin, "rb")
  on.exit(close(con), add = TRUE)
  seek(con, where = taille - a_lire, origin = "start")
  readBin(con, "raw", n = a_lire)
}

lire_entete_csv <- function(chemin, n = 65536L) {
  con <- file(chemin, "rb")
  on.exit(close(con), add = TRUE)
  brut <- readBin(con, "raw", n = as.integer(min(file.size(chemin), as.numeric(n))))
  saut <- which(brut == as.raw(0x0a))[1L]
  fin <- if (is.na(saut)) length(brut) else saut - 1L
  entete <- if (fin > 0L) brut[seq_len(fin)] else raw(0L)
  # CRLF : on retire le '\r' qui précède le '\n' (forme réelle des exports ODS).
  if (length(entete) && entete[length(entete)] == as.raw(0x0d)) {
    entete <- entete[-length(entete)]
  }
  rawToChar(entete)
}

# Compte les séparateurs HORS guillemets. Les exports ODS épinglent de la
# géométrie GeoJSON dans des champs cités : ces champs contiennent ',' et ';'
# qui ne sont PAS des séparateurs. Un double guillemet ("") est un guillemet
# échappé : deux bascules consécutives, donc aucune modification nette de l'état.
compter_separateurs <- function(ligne, separateur) {
  caracteres <- strsplit(ligne, "", fixed = TRUE)[[1L]]
  n <- length(caracteres)
  total <- 0L
  dans_guillemet <- FALSE
  i <- 1L
  while (i <= n) {
    c <- caracteres[i]
    if (identical(c, "\"")) {
      if (dans_guillemet && i < n && identical(caracteres[i + 1L], "\"")) {
        i <- i + 2L
        next
      }
      dans_guillemet <- !dans_guillemet
    } else if (!dans_guillemet && identical(c, separateur)) {
      total <- total + 1L
    }
    i <- i + 1L
  }
  total
}

compter_champs <- function(ligne, separateur) {
  compter_separateurs(ligne, separateur) + 1L
}

delimiteur_csv <- function(entete) {
  if (compter_separateurs(entete, ";") > compter_separateurs(entete, ",")) ";" else ","
}

derniere_ligne_complete <- function(octets_fin) {
  lignes <- strsplit(rawToChar(octets_fin), "\n", fixed = TRUE)[[1L]]
  if (!length(lignes)) return("")
  # strsplit supprime le champ vide final : le fichier se terminant par '\n'
  # (vérifié avant), le dernier élément est le dernier enregistrement complet.
  derniere <- lignes[length(lignes)]
  if (nchar(derniere) &&
      identical(substr(derniere, nchar(derniere), nchar(derniere)), "\r")) {
    derniere <- substr(derniere, 1L, nchar(derniere) - 1L)
  }
  derniere
}

verifier_csv_structure <- function(chemin) {
  # 1. Une coupure en milieu d'enregistrement n'a PAS de newline final.
  if (!identical(lire_octet_final(chemin), as.raw(0x0a))) return(FALSE)
  # 2. Le dernier enregistrement complet a le nombre de champs de l'en-tête,
  #    compté hors guillemets (les ';' / ',' de la géométrie ne comptent pas).
  #    On lit la FIN en bloc borné et on traite la dernière ligne physique
  #    comme le dernier enregistrement : les exports ODS épinglés ici n'ont pas
  #    de champ cité contenant un saut de ligne (GeoJSON compacté sur une ligne).
  #    UN TEL CHAMP MULTILIGNE est donc accepté comme limite connue : il
  #    déclencherait au pire un re-téléchargement supplémentaire (fail-closed),
  #    jamais l'acceptation d'un fichier tronqué.
  entete <- lire_entete_csv(chemin)
  if (!nzchar(entete)) return(FALSE)
  separateur <- delimiteur_csv(entete)
  n_entete <- compter_champs(entete, separateur)
  identical(
    compter_champs(derniere_ligne_complete(lire_octets_fin(chemin)), separateur),
    n_entete
  )
}

verifier_json_structure <- function(chemin) {
  octets <- lire_octets_fin(chemin)
  i <- length(octets)
  # communes_limites.geojson se termine par '...}}}' SANS newline final : on
  # ignore les blancs finaux mais on N'impose PAS de newline.
  while (i > 0L && as.integer(octets[i]) %in% c(0x20, 0x09, 0x0a, 0x0d)) {
    i <- i - 1L
  }
  i > 0L && as.integer(octets[i]) %in% c(0x7d, 0x5d)  # '}' ou ']'
}

# verifier_fichier ------------------------------------------------------------
# L'intégrité d'un fichier du cache : il existe, il n'est pas vide, et s'il
# s'agit d'un zip il s'ouvre (ou d'un .rds il se relit — le format de cache
# des sources api, issue #13 ; ou d'un .7z il porte la signature 7-Zip — les
# couches OCS-GE de la Géoplateforme, issue #234). Depuis #1108, un .csv/.txt
# doit se terminer par un saut de ligne ET avoir un dernier enregistrement
# complet (même nombre de champs que l'en-tête, hors guillemets) ; un
# .json/.geojson doit se terminer par '}' ou ']' (blancs finaux tolérés, newline
# NON exigé). C'est le garde-fou de l'idempotence (point 3) : un téléchargement
# partiel ou corrompu est détecté et re-téléchargé au lieu d'être traité comme
# complet pour toujours.
# La signature .7z (les six octets magiques « 37 7A BC AF 27 1C ») est la
# seule vérification possible SANS dépendance : ni le paquet `archive` ni un
# binaire 7-Zip ne sont disponibles (renv.lock) — une archive tronquée ou un
# texte déguisé en .7z est rejeté, un vrai .7z passe.
verifier_fichier <- function(chemin) {
  if (!file.exists(chemin)) return(FALSE)
  if (file.size(chemin) == 0) return(FALSE)
  ext <- tools::file_ext(chemin)
  if (ext == "zip") {
    ok <- tryCatch({
      utils::unzip(chemin, list = TRUE)
      TRUE
    }, error = function(e) FALSE)
    if (!ok) return(FALSE)
  }
  if (ext == "rds") {
    ok <- tryCatch({
      readRDS(chemin)
      TRUE
    }, error = function(e) FALSE)
    if (!ok) return(FALSE)
  }
  if (ext == "7z") {
    ok <- tryCatch({
      magie <- readBin(chemin, what = "raw", n = 6L)
      identical(magie, as.raw(c(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c)))
    }, error = function(e) FALSE)
    if (!ok) return(FALSE)
  }
  # Textes structurés (issue #1108) — le SEAM unique, utilisé aussi bien sur un
  # téléchargement neuf que sur la réutilisation d'un fichier déjà en cache.
  ext_texte <- tolower(ext)
  if (ext_texte %in% c("csv", "txt")) return(verifier_csv_structure(chemin))
  if (ext_texte %in% c("json", "geojson")) return(verifier_json_structure(chemin))
  TRUE
}

# verifier_empreinte_fichier ---------------------------------------------------
# Les sources qui portent une colonne `sha256` épinglent les octets attendus,
# pas seulement un nom de fichier ou une extension. Les manifestes historiques
# n'ont pas cette colonne et conservent leur garde d'intégrité structurelle.
verifier_empreinte_fichier <- function(chemin, sha256 = NULL) {
  if (is.null(sha256) || length(sha256) == 0L || is.na(sha256) || !nzchar(sha256)) {
    return(TRUE)
  }
  if (!grepl("^[0-9a-f]{64}$", sha256)) return(FALSE)
  con <- file(chemin, "rb")
  on.exit(close(con), add = TRUE)
  identical(paste(openssl::sha256(con)), sha256)
}

verifier_source <- function(chemin, sha256 = NULL) {
  verifier_fichier(chemin) && verifier_empreinte_fichier(chemin, sha256)
}

# TELECHARGEMENT_TIMEOUT ------------------------------------------------------
# Le timeout de téléchargement en secondes (issue #105). Sur R 4.4.1 (version
# épinglée), utils::download.file n'a PAS d'argument `timeout` — le seul levier
# est l'option globale options(timeout=), par défaut 60 s. Mesuré en réel :
# l'export SIRENE prend ~112 s et le zip chômage fait ~121 Mo — un run froid
# (mode full ou cron) dépassait le plafond de 60 s et échouait avec
# « Timeout of 60 seconds ». 600 s couvre les deux avec de la marge.

TELECHARGEMENT_TIMEOUT <- 600

# telecharger_fichier ---------------------------------------------------------
# Télécharge une URL vers le cache. Wrapper séparé pour être mockable dans les
# tests (le réseau n'entre jamais dans la boucle de test) — le seam de test du
# téléchargement.
# Le timeout est relevé ICI, au seam (issue #105) : l'option globale est
# appliquée autour de l'appel et restaurée avec on.exit() à sa valeur
# précédente — l'option n'est JAMAIS laissée modifiée après le retour.
telecharger_fichier <- function(url, cible) {
  ancien_timeout <- getOption("timeout")
  on.exit(options(timeout = ancien_timeout), add = TRUE)
  options(timeout = TELECHARGEMENT_TIMEOUT)
  ecrire_atomique(
    function(temporaire) utils::download.file(url, temporaire, mode = "wb", quiet = TRUE),
    cible
  )
}

# tirer_api -------------------------------------------------------------------
# Le seam du type "api" (issue #13) : appelle la fonction de pull de la source
# et met son résultat en cache dans un .rds. Le VRAI pull (le pull paginé de
# l'Observatoire DPE d'ADEME) arrive dans un ticket ultérieur — ici c'est le
# stub mockable : la fonction de pull ne touche JAMAIS le réseau dans la boucle
# de test, les tests fournissent un faux.
tirer_api <- function(pull, cible) {
  resultat <- pull()
  readr::write_rds(resultat, cible)
  invisible(resultat)
}

# erreur_manifeste ------------------------------------------------------------
# L'erreur de CONFIGURATION du manifeste (issue #13) : une source déclarée
# « api » sans fonction de pull est une erreur de manifeste, pas un échec
# réseau — elle s'arrête IMMÉDIATEMENT, sans retry (retenter ne répare pas un
# manifeste mal déclaré) et sans être confondue avec un téléchargement invalide.
erreur_manifeste <- function(id) {
  structure(
    list(
      message = paste0("Source api sans fonction de pull : ", id, "."),
      call = NULL
    ),
    class = c("erreur_manifeste", "error", "condition")
  )
}

# tirer_source ----------------------------------------------------------------
# Le dispatch du type de source (issue #13) : « fichier » -> télécharger_fichier
# (URL vers fichier), « api » -> tirer_api (la fonction de pull de la source).
# Un type inconnu est une erreur forte — une source mal déclarée doit être
# visible, pas silencieuse. (L'absence de fonction de pull est détectée AVANT
# la boucle de retry, dans download_sources — une erreur de manifeste ne se
# retente pas.)
tirer_source <- function(type, manifest, i, cible) {
  if (type %in% "fichier") {
    telecharger_fichier(manifest$url[i], cible)
  } else if (type %in% "api") {
    tirer_api(manifest$pull[[i]], cible)
  } else {
    stop("Type de source inconnu : ", type, call. = FALSE)
  }
}

# erreur_telechargement --------------------------------------------------------
# L'erreur portée par download_sources() quand un téléchargement échoue après
# les retries. Classe S3 « condition » : le message reste celui d'origine, et
# les statuts du run (dont le « échec » de la source fautive) sont attachés
# dans le champ $statuts — le rapport de run (ticket #10) peut ainsi être
# écrit malgré l'arrêt bruyant du run.
erreur_telechargement <- function(statuts, url) {
  structure(
    list(
      message = paste0(
        "Téléchargement invalide après 2 essais : ", url,
        " (échec réseau ou fichier partiel/corrompu)"
      ),
      call = NULL,
      statuts = statuts
    ),
    class = c("erreur_telechargement", "error", "condition")
  )
}

# download_sources ------------------------------------------------------------
# Télécharge les sources du manifeste vers le cache brut, selon le mode du run
# (issue #8, ADR-0004) :
#   - mode = "full" (défaut, local) : tout est téléchargé, manuel compris ; un
#     échec après les retries arrête le run bruyamment — comportement
#     historique inchangé.
#   - mode = "cron" (runner GitHub Actions) : seules les sources « cron » sont
#     téléchargées ; les sources « manuel » sont sautées sans échec et
#     enregistrées « à traiter à la main ». Un échec cron après les retries est
#     enregistré « échec » puis le run s'arrête bruyamment.
# Idempotent MAIS pas naïf (point 3) et, depuis #1103, content-addressed : le
# résolveur resoudre_source() décide, pour chaque source, d'utiliser les octets
# du cache, de la télécharger ou de dériver son vintage ; il enregistre le digest
# du run. La dérive n'est pas une erreur de pin : elle est attribuée aux verrous
# et refusée à la publication si le lockfile n'a pas été relocké.
# Retour : le tableau des statuts par source (id, mode, status) — une ligne par
# source traitée, dans l'ordre du manifeste. En cas d'échec, le run s'arrête et
# les statuts sont portés par l'erreur de classe « erreur_telechargement »
# (champ $statuts). Un manifeste sans colonne `mode` est traité tout en « cron »
# (comportement historique).
download_sources <- function(manifest, cache = "data/raw",
                             mode = c("full", "cron"), horloge = NULL) {
  mode <- match.arg(mode)
  if (!dir.exists(cache)) dir.create(cache, recursive = TRUE)

  # Issue #1103 : chaque source déclare EXPLICITEMENT sa base de vintage (le
  # registre 00_source_basis.R, sans défaut implicite) et TOUT fetch passe par
  # resoudre_source(), le résolveur unique.
  manifest <- declarer_bases(manifest)

  # le mode de chaque source : la colonne `mode` du manifeste, ou « cron » par
  # défaut si le manifeste ne la porte pas (manifestes antérieurs à l'issue #8)
  mode_source <- if ("mode" %in% names(manifest)) {
    manifest$mode
  } else {
    rep("cron", nrow(manifest))
  }

  # le type de chaque source : la colonne `type` du manifeste, ou « fichier »
  # par défaut si le manifeste ne la porte pas (manifestes antérieurs à l'issue #13)
  type_source <- if ("type" %in% names(manifest)) {
    manifest$type
  } else {
    rep("fichier", nrow(manifest))
  }
  sha256_source <- if ("sha256" %in% names(manifest)) {
    manifest$sha256
  } else {
    rep(NA_character_, nrow(manifest))
  }
  vintage_source <- if ("vintage" %in% names(manifest)) {
    manifest$vintage
  } else {
    rep(NA_character_, nrow(manifest))
  }
  reference_source <- if ("date_reference" %in% names(manifest)) {
    manifest$date_reference
  } else {
    rep(NA_character_, nrow(manifest))
  }

  # L'accumulateur de statuts est partagé avec le résolveur : un échec réseau
  # porte les statuts déjà acquis dans l'erreur (le rapport de run les lit).
  etat <- new.env(parent = emptyenv())
  etat$statuts <- tibble::tibble(
    id = character(0), mode = character(0), status = character(0)
  )
  # Le résolveur a déjà haché chaque fichier : on RÉUTILISE son digest, jamais
  # un second hachage (le PBF fait 330 Mo).
  digests <- list()

  for (i in seq_len(nrow(manifest))) {
    # en mode cron, une source « manuel » est sautée sans être touchée : jamais
    # de réseau, jamais d'échec — enregistrée « à traiter à la main ». (%in%
    # plutôt que == : une valeur NA est traitée comme « cron », pas en erreur)
    if (mode == "cron" && mode_source[i] %in% "manuel") {
      etat$statuts <- tibble::add_row(
        etat$statuts, id = manifest$id[i], mode = "manuel",
        status = "à traiter à la main"
      )
      next
    }

    # une erreur de MANIFESTE n'est pas retentée : une source « api » sans
    # fonction de pull s'arrête immédiatement, avant la boucle de retry — elle
    # ne doit pas être confondue avec un téléchargement invalide (issue #13)
    if (type_source[i] %in% "api" &&
        (!"pull" %in% names(manifest) || is.null(manifest$pull[[i]]))) {
      stop(erreur_manifeste(manifest$id[i]))
    }

    resolu <- resoudre_source(
      id = manifest$id[i], url = manifest$url[i], fichier = manifest$fichier[i],
      cache = cache, type = type_source[i],
      pull = if ("pull" %in% names(manifest)) manifest$pull[[i]] else NULL,
      mode_source = mode_source[i], sha256_manifeste = sha256_source[i],
      vintage_basis = manifest$vintage_basis[i],
      vintage_declare = vintage_source[i],
      reference_declaree = reference_source[i],
      horloge = horloge, etat = etat
    )
    digests[[manifest$id[i]]] <- resolu$digest
    etat$statuts <- tibble::add_row(
      etat$statuts, id = manifest$id[i], mode = mode_source[i], status = "frais"
    )
  }

  verifier_digests_couvrent(etat$statuts, digests)
  if (length(digests)) ecrire_digests_cache_aggregate(digests, cache)
  attr(etat$statuts, "digests") <- digests
  etat$statuts
}
