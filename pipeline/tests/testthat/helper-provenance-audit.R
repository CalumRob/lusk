# Structural audit of serving-DB connection sites (issue #1103, review round 1)
# A guard is valid only where a serving connection is OPENED. This scanner finds
# every `dbConnect(`/`configuration_service_postgres(` call site and checks that
# an enclosing function/script branch calls `verifier_gel_release(` before it,
# or that the site is explicitly allowlisted with a reason.

BLOCS_OUVRANTS <- "function\\s*\\(|\\bif\\s*\\(|\\bfor\\s*\\(|\\bwhile\\s*\\("

# autorisations : liste de listes (fichier, raison) — fichier peut être un regex.
AUTORISATIONS_DB <- list(
  list(fichier = "^R/publish_serving_bridge\\.R$",
       raison = "pont offre_tc #1072 — outil de recovery, hors périmètre #1103"),
  list(fichier = "^scripts/smoke-.*\\.R$",
       raison = "tests de fumée ciblent exclusivement des schémas lusk_it_* jetables"),
  list(fichier = "^scripts/publish-aedar-aggregates\\.R$",
       motif = "reference_connection",
       raison = "branche --check : connexion READ ONLY de référence territoriale, aucune écriture"),
  list(fichier = "^scripts/publish-serving-tables\\.R$",
       motif = "configuration_service_postgres\\(\\) # fail before any upstream compute",
       raison = "branche --targets : validation de configuration seulement, le garde est dans le target du graphe"),
  list(fichier = "^R/publish_postgres_configuration\\.R$",
       raison = "configuration_service_postgres() ne ouvre aucune connexion ; le garde précède dbConnect")
)

relatif_sous <- function(chemin, racine) {
  p <- normalizePath(chemin, winslash = "/", mustWork = TRUE)
  r <- normalizePath(racine, winslash = "/", mustWork = TRUE)
  sub(paste0("^", r, "/"), "", p)
}

autorise_site <- function(rel, source, autorisations) {
  for (a in autorisations) {
    if (!grepl(a$fichier, rel)) next
    if (!is.null(a$motif) && !grepl(a$motif, source)) next
    return(a$raison)
  }
  NA_character_
}

auditer_appels_db <- function(racine, motif = "dbConnect\\(|configuration_service_postgres\\(",
                              autorisations = AUTORISATIONS_DB) {
  fichiers <- list.files(racine, pattern = "\\.R$", full.names = TRUE, recursive = TRUE)
  fichiers <- fichiers[grepl("/(R|scripts)/[^/]+\\.R$", fichiers)]
  trousses <- list()
  for (f in fichiers) {
    rel <- relatif_sous(f, racine)
    lignes <- readLines(f, warn = FALSE)
    for (i in seq_along(lignes)) {
      l <- lignes[[i]]
      if (!grepl(motif, l)) next
      # Une DÉFINITION de fonction n'est pas un appel.
      if (grepl("(<-|=)\\s*function\\s*\\(", l)) next
      debut <- which(grepl(BLOCS_OUVRANTS, lignes[seq_len(i)]))
      garde <- FALSE
      if (length(debut)) {
        for (j in debut) {
          if (any(grepl("verifier_gel_release\\(", lignes[j:i]))) {
            garde <- TRUE
            break
          }
        }
      }
      raison <- autorise_site(rel, l, autorisations)
      trousses[[length(trousses) + 1L]] <- data.frame(
        fichier = rel, ligne = i, garde = garde,
        autorise = !is.na(raison), raison = if (is.na(raison)) "" else raison,
        source = l, stringsAsFactors = FALSE
      )
    }
  }
  if (!length(trousses)) {
    return(data.frame(fichier = character(), ligne = integer(), garde = logical(),
                      autorise = logical(), raison = character(), source = character()))
  }
  do.call(rbind, trousses)
}

verifier_structure_gel <- function(racine, autorisations = AUTORISATIONS_DB) {
  sites <- auditer_appels_db(racine, autorisations = autorisations)
  fautes <- sites[!sites$garde & !sites$autorise, , drop = FALSE]
  if (nrow(fautes)) {
    stop(
      "Structural guard audit — ", nrow(fautes),
      " serving-DB call site(s) without verifier_gel_release() and without an allowlist reason:\n",
      paste0("  ", fautes$fichier, ":", fautes$ligne, "  ", trimws(fautes$source),
             collapse = "\n"),
      call. = FALSE
    )
  }
  invisible(sites)
}

# Appels au garde (issue #1103, revue 2) ----------------------------------------
# `sortie` est requis : un appel `verifier_gel_release()` sans argument est une
# faute structurelle — il laisserait le garde lire un dossier implicite.
auditer_appels_garde <- function(racine) {
  fichiers <- list.files(racine, pattern = "\\.R$", full.names = TRUE, recursive = TRUE)
  fichiers <- fichiers[grepl("/(R|scripts)/[^/]+\\.R$", fichiers)]
  trousses <- list()
  for (f in fichiers) {
    rel <- relatif_sous(f, racine)
    lignes <- readLines(f, warn = FALSE)
    for (i in seq_along(lignes)) {
      l <- sub("#.*$", "", lignes[[i]])
      if (!grepl("verifier_gel_release\\s*\\(", l)) next
      trousses[[length(trousses) + 1L]] <- data.frame(
        fichier = rel, ligne = i,
        sans_argument = grepl("verifier_gel_release\\s*\\(\\s*\\)", l),
        source = trimws(l), stringsAsFactors = FALSE
      )
    }
  }
  if (!length(trousses)) {
    return(data.frame(fichier = character(), ligne = integer(),
                      sans_argument = logical(), source = character()))
  }
  do.call(rbind, trousses)
}

verifier_structure_garde <- function(racine) {
  sites <- auditer_appels_garde(racine)
  fautes <- sites[sites$sans_argument, , drop = FALSE]
  if (nrow(fautes)) {
    stop(
      "Guard-call audit — ", nrow(fautes),
      " verifier_gel_release() call(s) without an explicit sortie:\n",
      paste0("  ", fautes$fichier, ":", fautes$ligne, "  ", fautes$source,
             collapse = "\n"),
      call. = FALSE
    )
  }
  invisible(sites)
}

# Lectures réseau (issue #1103, revue) ------------------------------------------
# Toute lecture réseau est soit COUVERTE par un enregistrement de digest (avec
# une base déclarée), soit explicitement AUTORISÉE avec une raison. Un nouveau
# appel non listé fait échouer la suite.
AUTORISATIONS_RESEAU <- list(
  list(fichier = "^R/download\\.R$", motif = "utils::download\\.file\\(",
       raison = "resoudre_source() hache et enregistre un digest par source de manifeste",
       couvert = TRUE),
  list(fichier = "^R/manifest_habitat_dpe\\.R$", motif = "httr2::(request|req_perform)\\(",
       raison = "pull api DPE : tirer_api() -> resoudre_source() enregistre le digest .rds",
       couvert = TRUE),
  list(fichier = "^R/geometrie\\.R$", motif = "httr2::(request|req_perform)\\(",
       raison = "publier_geometrie() enregistre un digest par couche WFS (base telechargement)",
       couvert = TRUE),
  list(fichier = "^R/aedar_aggregates\\.R$", motif = "utils::download\\.file\\(",
       raison = "acquisition AEDAR (artefact data/processed/aedar, commande --check de l'operateur) — hors run des sept themes",
       couvert = FALSE)
)

MOTIF_RESEAU <- paste0(
  "download\\.file\\(", "|req_perform\\(", "|httr::GET\\(", "|httr2::request\\(",
  "|curl_fetch|url\\(\"https?://|st_read\\([^)]*https?://",
  "|read_csv\\([^)]*https?://|fromJSON\\([^)]*https?://"
)

auditer_appels_reseau <- function(racine, autorisations = AUTORISATIONS_RESEAU) {
  fichiers <- list.files(racine, pattern = "\\.R$", full.names = TRUE, recursive = TRUE)
  fichiers <- fichiers[grepl("/(R|scripts)/[^/]+\\.R$", fichiers)]
  trousses <- list()
  for (f in fichiers) {
    rel <- relatif_sous(f, racine)
    lignes <- readLines(f, warn = FALSE)
    for (i in seq_along(lignes)) {
      brut <- lignes[[i]]
      # On ignore les commentaires et les paramètres par défaut (download = ...).
      l <- sub("#.*$", "", brut)
      if (!grepl(MOTIF_RESEAU, l)) next
      if (grepl("(download|fetch|download_file)\\s*=", l)) next
      couvert <- FALSE; raison <- NA_character_
      for (a in autorisations) {
        if (grepl(a$fichier, rel) && grepl(a$motif, l)) {
          couvert <- isTRUE(a$couvert)
          raison <- a$raison
          break
        }
      }
      trousses[[length(trousses) + 1L]] <- data.frame(
        fichier = rel, ligne = i, couvert = couvert,
        autorise = !is.na(raison),
        raison = if (is.na(raison)) "" else raison,
        source = trimws(l), stringsAsFactors = FALSE
      )
    }
  }
  if (!length(trousses)) {
    return(data.frame(fichier = character(), ligne = integer(), couvert = logical(),
                      autorise = logical(), raison = character(), source = character()))
  }
  do.call(rbind, trousses)
}

verifier_structure_reseau <- function(racine, autorisations = AUTORISATIONS_RESEAU) {
  sites <- auditer_appels_reseau(racine, autorisations = autorisations)
  fautes <- sites[!sites$autorise, , drop = FALSE]
  if (nrow(fautes)) {
    stop(
      "Structural network-read audit — ", nrow(fautes),
      " undeclared network read(s):\n",
      paste0("  ", fautes$fichier, ":", fautes$ligne, "  ", fautes$source,
             collapse = "\n"),
      call. = FALSE
    )
  }
  invisible(sites)
}
