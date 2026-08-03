# download --------------------------------------------------------------------
# Étape 1 : téléchargement. Lit le manifeste des sources, récupère les jeux de
# données vers le cache brut (data/raw, dans le dépôt — jamais sur C:).
# Le manifeste est le SEAM du téléchargement : une table de sources vérifiées
# (docs/research/rp-dossier-complet.md), testée pour son intégrité, jamais
# exécutée contre le réseau dans la boucle de test.

# MANIFEST_DEMOGRAPHIE ---------------------------------------------------------
# La table des sources vérifiées (docs/research/rp-dossier-complet.md). Deux
# dates par source (point 5) :
#   - date_reference   : la date de référence de la donnée (« RP 2023 » = au
#     1er janvier 2023) — ce que le tampon de fraîcheur affiche.
#   - date_publication : la date de mise en ligne réelle — ce que le watchdog
#     comparera à data.gouv (ADR-0001). Vérifiée sur l'API data.gouv le
#     2026-08-03 (created_at des ressources 2023 = 2026-06-30). La base des
#     EPCI vit sur insee.fr, qui n'expose pas de date de fichier : NA, à
#     compléter par le watchdog.
# Et le mode de récupération (issue #8, ADR-0004) : « cron » = le runner
# télécharge directement (petit fichier HTTP sans clé), « manuel » = trop gros
# / outil de bureau / clé API (OSM, OCS GE, BDNB). Les 4 sources INSEE
# Démographie sont toutes « cron » (vérifié en direct le 2026-08-03).
MANIFEST_DEMOGRAPHIE <- tibble::tribble(
  ~id, ~source, ~url, ~fichier, ~vintage, ~date_reference, ~date_publication, ~licence, ~note, ~mode,
  "serie_historique",
  "INSEE — Série historique du recensement",
  "https://api.insee.fr/melodi/file/DS_RP_SERIE_HISTORIQUE/DS_RP_SERIE_HISTORIQUE_2023_CSV_FR",
  "DS_RP_SERIE_HISTORIQUE_2023_CSV_FR.zip", "2023", "2023-01-01", "2026-06-30", "lov2",
  "Population 1968-2023 (POP), superficie (SUP, km2), naissances/décès cumulés entre recensements (BRTH/DEATH)",
  "cron",
  "menages",
  "INSEE — Ménages (dossier complet)",
  "https://api.insee.fr/melodi/file/DS_RP_MENAGES_COMP/DS_RP_MENAGES_COMP_2023_CSV_FR",
  "DS_RP_MENAGES_COMP_2023_CSV_FR.zip", "2023", "2023-01-01", "2026-06-30", "lov2",
  "Nombre de ménages (DWELLINGS) et population des ménages (DWELLINGS_POPSIZE)",
  "cron",
  "age_detail",
  "INSEE — Population par sexe et âge (PRINC)",
  "https://api.insee.fr/melodi/file/DS_RP_POPULATION_PRINC/DS_RP_POPULATION_PRINC_2023_CSV_FR",
  "DS_RP_POPULATION_PRINC_2023_CSV_FR.zip", "2023", "2023-01-01", "2026-06-30", "lov2",
  "Structure par âge : 7 tranches exhaustives + agrégats (dont Y_LT20, moins de 20 ans)",
  "cron",
  "epci",
  "INSEE — Base des EPCI à fiscalité propre au 01/01/2025",
  "https://www.insee.fr/fr/statistiques/fichier/2510634/epci_au_01-01-2025.zip",
  "epci_au_01-01-2025.zip", "2025", "2025-01-01", NA_character_, "lov2",
  "Feuille Composition_communale : CODGEO -> EPCI (SIREN), LIBEPCI, DEP, REG",
  "cron"
)

# verifier_fichier ------------------------------------------------------------
# L'intégrité d'un fichier du cache : il existe, il n'est pas vide, et s'il
# s'agit d'un zip il s'ouvre. C'est le garde-fou de l'idempotence (point 3) :
# un téléchargement partiel ou corrompu est détecté et re-téléchargé au lieu
# d'être traité comme complet pour toujours.
verifier_fichier <- function(chemin) {
  if (!file.exists(chemin)) return(FALSE)
  if (file.size(chemin) == 0) return(FALSE)
  if (tools::file_ext(chemin) == "zip") {
    ok <- tryCatch({
      utils::unzip(chemin, list = TRUE)
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
# Retour : le tableau des statuts par source (id, mode, status) — une ligne par
# source traitée, dans l'ordre du manifeste. En cas d'échec, le run s'arrête et
# les statuts sont portés par l'erreur de classe « erreur_telechargement »
# (champ $statuts). Un manifeste sans colonne `mode` est traité tout en « cron »
# (comportement historique).
download_sources <- function(manifest = MANIFEST_DEMOGRAPHIE,
                             cache = "data/raw",
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

  statuts <- tibble::tibble(
    id = character(0), mode = character(0), status = character(0)
  )

  for (i in seq_len(nrow(manifest))) {
    # en mode cron, une source « manuel » est sautée sans être touchée : jamais
    # de réseau, jamais d'échec — enregistrée « à traiter à la main ».
    if (mode == "cron" && mode_source[i] == "manuel") {
      statuts <- tibble::add_row(
        statuts, id = manifest$id[i], mode = "manuel", status = "à traiter à la main"
      )
      next
    }

    cible <- file.path(cache, manifest$fichier[i])

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
        telecharger_fichier(manifest$url[i], cible)
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
      # la condition porte le message d'origine ET les statuts (le champ `call`
      # est déjà NULL dans la condition — stop() ne reçoit qu'un argument)
      stop(erreur_telechargement(statuts, manifest$url[i]))
    }
    statuts <- tibble::add_row(
      statuts, id = manifest$id[i], mode = mode_source[i], status = "frais"
    )
  }

  statuts
}
