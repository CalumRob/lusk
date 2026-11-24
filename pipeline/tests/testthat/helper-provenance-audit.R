# Structural audit of serving-DB connection sites (issue #1103, review round 1)
# A guard is valid only where a serving connection is OPENED. This scanner finds
# every `dbConnect(`/`configuration_service_postgres(` call site and checks that
# an enclosing function/script branch calls `verifier_gel_release(` before it,
# or that the site is explicitly allowlisted with a reason.

BLOCS_OUVRANTS <- "function\\s*\\(|\\bif\\s*\\(|\\bfor\\s*\\(|\\bwhile\\s*\\("

# autorisations : liste de listes (fichier, raison) — fichier peut être un regex.
# Les chemins historiques sont autorisés EN ATTENDANT l'étape 4 (ADR-0049) :
# ils sont explicitement marqués « retire in ADR-0049 step 4 ». Le SEUL nouveau
# chemin autorisé est `apply`, la couture de publication (step 2, #1137).
AUTORISATIONS_DB <- list(
  list(fichier = "^R/apply_publication\\.R$",
       raison = "ADR-0049 step 2 (#1137) : apply est la SEULE couture de connexion de service ; refus avant toute écriture"),
  list(fichier = "^R/publish_serving_bridge\\.R$",
       raison = "pont offre_tc #1072 — retire in ADR-0049 step 4"),
  list(fichier = "^scripts/smoke-.*\\.R$",
       raison = "tests de fumée ciblent des schémas lusk_it_* jetables — retire in ADR-0049 step 4"),
  list(fichier = "^scripts/publish-aedar-aggregates\\.R$",
       motif = "reference_connection",
       raison = "branche --check READ ONLY — retire in ADR-0049 step 4"),
  list(fichier = "^scripts/publish-serving-tables\\.R$",
       motif = "configuration_service_postgres\\(\\) # fail before any upstream compute",
       raison = "branche --targets : validation de configuration seulement — retire in ADR-0049 step 4"),
  list(fichier = "^R/publish_postgres_configuration\\.R$",
       raison = "configuration_service_postgres() n'ouvre aucune connexion — retire in ADR-0049 step 4")
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
  list(fichier = "^R/aedar_aggregates\\.R$", motif = "utils::download\\.file",
       raison = "acquisition AEDAR content-pinned by sha1 in AEDAR_SOURCE_RESOURCES / by sha256 in AEDAR_TYPEQU_METADATA_RESOURCES — artefact separe, hors run des sept themes",
       couvert = FALSE)
)

MOTIF_RESEAU <- paste0(
  "utils::download\\.file|download\\.file\\(", "|req_perform\\(", "|httr::GET\\(", "|httr2::request\\(",
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
      # `download = utils::download.file` est une DÉCLARATION de seam réseau
      # (AEDAR) : elle doit être auditée, pas ignorée.
      if (grepl("(fetch|download_file)\\s*=", l)) next
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

# Hachage d'enveloppes WFS (issue #1119) ----------------------------------------
# Une réponse GetFeature porte un `timeStamp` volatile : la hacher rend le gel
# de release (ADR-0048) permanent. Le scanner repère toute sérialisation JSON
# hachée dont l'entrée ressemble à une réponse/enveloppe WFS entière ; seul le
# helper canonique (wfs_digest.R) est autorisé à hacher des features WFS.
MOTIF_HASH_JSON <- "sha256\\s*\\(.*toJSON\\s*\\("
MOTIF_ENVELOPPE_WFS <- "toJSON\\s*\\(\\s*(brut|reponse|response|collection|limites|enveloppe|collection_wfs)\\b"

auditer_hachages_wfs <- function(racine) {
  fichiers <- list.files(racine, pattern = "\\.R$", full.names = TRUE, recursive = TRUE)
  fichiers <- fichiers[grepl("/(R|scripts)/[^/]+\\.R$", fichiers)]
  trousses <- list()
  for (f in fichiers) {
    rel <- relatif_sous(f, racine)
    lignes <- readLines(f, warn = FALSE)
    for (i in seq_along(lignes)) {
      l <- sub("#.*$", "", lignes[[i]])
      if (!grepl(MOTIF_HASH_JSON, l)) next
      enveloppe <- grepl(MOTIF_ENVELOPPE_WFS, l)
      autorise <- !enveloppe || grepl("^R/wfs_digest\\.R$", rel)
      trousses[[length(trousses) + 1L]] <- data.frame(
        fichier = rel, ligne = i, enveloppe = enveloppe,
        autorise = autorise, source = trimws(l), stringsAsFactors = FALSE
      )
    }
  }
  if (!length(trousses)) {
    return(data.frame(fichier = character(), ligne = integer(),
                      enveloppe = logical(), autorise = logical(),
                      source = character(), stringsAsFactors = FALSE))
  }
  do.call(rbind, trousses)
}

verifier_structure_hachages_wfs <- function(racine) {
  sites <- auditer_hachages_wfs(racine)
  fautes <- sites[sites$enveloppe & !sites$autorise, , drop = FALSE]
  if (nrow(fautes)) {
    stop(
      "Structural WFS-hash audit — ", nrow(fautes),
      " raw GetFeature envelope(s) hashed outside the canonical helper:\n",
      paste0("  ", fautes$fichier, ":", fautes$ligne, "  ", trimws(fautes$source),
             collapse = "\n"),
      call. = FALSE
    )
  }
  invisible(sites)
}

# Paramètres DBI positionnels (revue #1170) -----------------------------------
# RPostgres refuse une liste `params` nommée (« `params` must not be named »).
# Un test avec DBI mocké ne le voit pas : ce scanner extrait CHAQUE appel
# dbExecute/dbGetQuery/dbSendQuery de R/ (parenthèses équilibrées) et exige des
# paramètres positionnels : `list(a, b)` ou `unname(as.list(x))`, jamais
# `list(nom = ...)` ni `as.list(...)` dont les noms viennent du data.frame.
extraire_appels_dbi <- function(texte) {
  appels <- character()
  positions <- gregexpr("db(Execute|GetQuery|SendQuery)\\s*\\(", texte)[[1L]]
  if (positions[[1L]] < 0L) return(appels)
  for (p in seq_along(positions)) {
    debut <- positions[[p]]
    profondeur <- 0L
    for (k in debut:nchar(texte)) {
      ch <- substr(texte, k, k)
      if (ch == "(") profondeur <- profondeur + 1L
      if (ch == ")") {
        profondeur <- profondeur - 1L
        if (profondeur == 0L) {
          appels <- c(appels, substr(texte, debut, k))
          break
        }
      }
    }
  }
  appels
}

auditer_params_dbi <- function(racine) {
  fichiers <- list.files(file.path(racine, "R"), pattern = "\\.R$", full.names = TRUE)
  trousses <- list()
  for (f in fichiers) {
    texte <- paste(readLines(f, warn = FALSE), collapse = "\n")
    for (appel in extraire_appels_dbi(texte)) {
      if (!grepl("params\\s*=", appel)) next
      nomme <- grepl("params\\s*=\\s*list\\s*\\([^)]*[[:alnum:]_.]+\\s*=", appel) ||
        (grepl("params\\s*=\\s*as\\.list\\s*\\(", appel) &&
           !grepl("unname\\s*\\(\\s*as\\.list\\s*\\(", appel))
      if (!nomme) next
      trousses[[length(trousses) + 1L]] <- data.frame(
        fichier = relatif_sous(f, racine),
        source = gsub("\\s+", " ", appel), stringsAsFactors = FALSE)
    }
  }
  if (!length(trousses)) return(data.frame(fichier = character(), source = character()))
  do.call(rbind, trousses)
}

verifier_params_dbi_positionnels <- function(racine) {
  fautes <- auditer_params_dbi(racine)
  if (nrow(fautes)) {
    stop("DBI named-params audit — ", nrow(fautes),
      " call(s) pass a named `params` list (RPostgres rejects these):\n",
      paste0("  ", fautes$fichier, "  ", fautes$source, collapse = "\n"),
      call. = FALSE)
  }
  invisible(fautes)
}

# Écriture des tables de service (ADR-0049 décision 8 / #1137) -----------------
# SEUL un adaptateur de forme peut écrire les tables de service d'une forme.
# Le scanner repère toute écriture (DELETE/INSERT/UPDATE/TRUNCATE/dbWriteTable)
# sur une table de service scalaire ; un site non autorisé fait échouer la
# suite. Les producteurs historiques sont autorisés « retire in ADR-0049 step 4 »
# ; `apply` n'écrit AUCUNE table de service directement — il délègue à l'adaptateur.
TABLES_SERVICE_SCALAIRE <- paste0(
  "scalar_observation|scalar_descriptor|scalar_comparison_",
  "|comparison_source_lineage|scalar_resource_comparison_publication")
MOTIF_ECRITURE_SERVEUR <- paste0(
  "(DELETE FROM|INSERT INTO|UPDATE|TRUNCATE)\\s+(", TABLES_SERVICE_SCALAIRE, ")",
  "|db(Write|Append)Table\\s*\\([^,]+,\\s*[\"'](", TABLES_SERVICE_SCALAIRE, ")")

AUTORISATIONS_ECRITURE_SERVEUR <- list(
  list(fichier = "^R/adaptateur_.*\\.R$",
       raison = "adaptateur de forme ADR-0049 — seul écrivain des tables de service de sa forme"),
  list(fichier = "^R/publish.*\\.R$",
       raison = "producteur historique — retire in ADR-0049 step 4"),
  list(fichier = "^R/aedar_aggregates\\.R$",
       raison = "producteur historique — retire in ADR-0049 step 4"),
  list(fichier = "^scripts/.*\\.R$",
       raison = "smoke/producteur historique — retire in ADR-0049 step 4")
)

auditer_ecritures_serveur <- function(racine,
                                      autorisations = AUTORISATIONS_ECRITURE_SERVEUR) {
  fichiers <- list.files(racine, pattern = "\\.R$", full.names = TRUE, recursive = TRUE)
  fichiers <- fichiers[grepl("/(R|scripts)/[^/]+\\.R$", fichiers)]
  trousses <- list()
  for (f in fichiers) {
    rel <- relatif_sous(f, racine)
    lignes <- readLines(f, warn = FALSE)
    for (i in seq_along(lignes)) {
      l <- sub("#.*$", "", lignes[[i]])
      if (!grepl(MOTIF_ECRITURE_SERVEUR, l, ignore.case = TRUE)) next
      raison <- NA_character_
      for (a in autorisations) {
        if (grepl(a$fichier, rel)) { raison <- a$raison; break }
      }
      trousses[[length(trousses) + 1L]] <- data.frame(
        fichier = rel, ligne = i, autorise = !is.na(raison),
        raison = if (is.na(raison)) "" else raison,
        source = trimws(l), stringsAsFactors = FALSE
      )
    }
  }
  if (!length(trousses)) {
    return(data.frame(fichier = character(), ligne = integer(),
                      autorise = logical(), raison = character(), source = character()))
  }
  do.call(rbind, trousses)
}

verifier_structure_ecritures_serveur <- function(racine,
                                                 autorisations = AUTORISATIONS_ECRITURE_SERVEUR) {
  sites <- auditer_ecritures_serveur(racine, autorisations)
  fautes <- sites[!sites$autorise, , drop = FALSE]
  if (nrow(fautes)) {
    stop(
      "Structural serving-table write audit — ", nrow(fautes),
      " write(s) to a serving table outside a shape adapter:\n",
      paste0("  ", fautes$fichier, ":", fautes$ligne, "  ", fautes$source,
             collapse = "\n"),
      call. = FALSE
    )
  }
  invisible(sites)
}
