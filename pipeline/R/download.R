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

# verifier_fichier ------------------------------------------------------------
# L'intégrité d'un fichier du cache : il existe, il n'est pas vide, et s'il
# s'agit d'un zip il s'ouvre (ou d'un .rds il se relit — le format de cache
# des sources api, issue #13). C'est le garde-fou de l'idempotence (point 3) :
# un téléchargement partiel ou corrompu est détecté et re-téléchargé au lieu
# d'être traité comme complet pour toujours.
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
  TRUE
}

# telecharger_fichier ---------------------------------------------------------
# Télécharge une URL vers le cache. Wrapper séparé pour être mockable dans les
# tests (le réseau n'entre jamais dans la boucle de test) — le seam de test du
# téléchargement.
telecharger_fichier <- function(url, cible) {
  utils::download.file(url, cible, mode = "wb", quiet = TRUE)
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
# Idempotent MAIS pas naïf (point 3) : un fichier présent et intact est laissé ;
# un fichier présent mais corrompu (partiel, zip invalide) est supprimé et
# re-téléchargé ; un téléchargement qui échoue (réseau ou fichier invalide) est
# retenté une fois, puis le pipeline s'arrête bruyamment.
# Issue #13 : chaque source est récupérée selon son `type` (fichier | api) —
# le dispatch vit dans tirer_source(). Un manifeste sans colonne `type` est
# traité tout en « fichier » (comportement historique).
# Retour : le tableau des statuts par source (id, mode, status) — une ligne par
# source traitée, dans l'ordre du manifeste. En cas d'échec, le run s'arrête et
# les statuts sont portés par l'erreur de classe « erreur_telechargement »
# (champ $statuts). Un manifeste sans colonne `mode` est traité tout en « cron »
# (comportement historique).
download_sources <- function(manifest, cache = "data/raw",
                             mode = c("full", "cron")) {
  mode <- match.arg(mode)
  if (!dir.exists(cache)) dir.create(cache, recursive = TRUE)

  # le mode de chaque source : la colonne `mode` du manifeste, ou « cron » par
  # défaut si le manifeste ne la porte pas (manifestes antérieurs à l'issue #8)
  mode_source <- if ("mode" %in% names(manifest)) {
    manifest$mode
  } else {
    rep("cron", nrow(manifest))
  }

  # le type de chaque source : la colonne `type` du manifeste, ou « fichier »
  # par défaut si le manifeste ne la porte pas (issue #13)
  type_source <- if ("type" %in% names(manifest)) {
    manifest$type
  } else {
    rep("fichier", nrow(manifest))
  }

  statuts <- tibble::tibble(
    id = character(0), mode = character(0), status = character(0)
  )

  for (i in seq_len(nrow(manifest))) {
    # en mode cron, une source « manuel » est sautée sans être touchée : jamais
    # de réseau, jamais d'échec — enregistrée « à traiter à la main ». (%in%
    # plutôt que == : une valeur NA est traitée comme « cron », pas en erreur)
    if (mode == "cron" && mode_source[i] %in% "manuel") {
      statuts <- tibble::add_row(
        statuts, id = manifest$id[i], mode = "manuel", status = "à traiter à la main"
      )
      next
    }

    cible <- file.path(cache, manifest$fichier[i])

    # une erreur de MANIFESTE n'est pas retentée : une source « api » sans
    # fonction de pull s'arrête immédiatement, avant la boucle de retry — elle
    # ne doit pas être confondue avec un téléchargement invalide (issue #13)
    if (type_source[i] %in% "api" &&
        (!"pull" %in% names(manifest) || is.null(manifest$pull[[i]]))) {
      stop(erreur_manifeste(manifest$id[i]))
    }

    if (file.exists(cible) && verifier_fichier(cible)) {
      statuts <- tibble::add_row(
        statuts, id = manifest$id[i], mode = mode_source[i], status = "frais"
      )
      next
    }
    if (file.exists(cible)) unlink(cible)  # corrompu : on repart propre

    ok <- FALSE
    for (essai in 1:2) {
      reussi <- tryCatch({
        tirer_source(type_source[i], manifest, i, cible)
        TRUE
      }, error = function(e) FALSE)
      if (reussi && verifier_fichier(cible)) {
        ok <- TRUE
        break
      }
      unlink(cible)  # partiel/corrompu/échec : supprimer et réessayer
    }
    if (!ok) {
      statuts <- tibble::add_row(
        statuts, id = manifest$id[i], mode = mode_source[i], status = "échec"
      )
      # l'étiquette de la source dans le message : l'URL pour un fichier, le
      # nom de la source pour une api
      etiquette <- if (type_source[i] %in% "api") {
        paste0("api:", manifest$id[i])
      } else {
        manifest$url[i]
      }
      # la condition porte le message d'origine ET les statuts (le champ `call`
      # est déjà NULL dans la condition — stop() ne reçoit qu'un argument)
      stop(erreur_telechargement(statuts, etiquette))
    }
    statuts <- tibble::add_row(
      statuts, id = manifest$id[i], mode = mode_source[i], status = "frais"
    )
  }

  statuts
}
