# Structural audit of serving-DB connection sites (issue #1103, review round 1)
# A guard is valid only where a serving connection is OPENED. This scanner finds
# every `dbConnect(`/`configuration_service_postgres(` call site and checks that
# an enclosing function/script branch calls `verifier_gel_release(` before it,
# or that the site is explicitly allowlisted with a reason.

BLOCS_OUVRANTS <- "function\\s*\\(|\\bif\\s*\\(|\\bfor\\s*\\(|\\bwhile\\s*\\("

# autorisations : liste de listes (fichier, raison) — fichier peut être un regex.
# Les chemins historiques sont autorisés EN ATTENDANT l'étape 4 (ADR-0049) :
# ils sont explicitement marqués « retire in ADR-0049 step 4 ». Le SEUL nouveau
# `apply` n'est PAS allowlisté : son ouverture porte le garde de gel de lignage
# (verifier_gel_lignage_ressource) au site même du dbConnect — voir #1137.
AUTORISATIONS_DB <- list(
  list(fichier = "^R/publish_serving_bridge\\.R$",
       raison = "pont offre_tc #1072 — retire in ADR-0049 step 4"),
  list(fichier = "^scripts/publish-aedar-aggregates\\.R$",
       motif = "reference_connection",
       raison = "branche --check READ ONLY — retire in ADR-0049 step 4"),
  list(fichier = "^scripts/publish-serving-tables\\.R$",
       motif = "configuration_service_postgres\\(\\) # fail before any upstream compute",
       raison = "branche --targets : validation de configuration seulement — retire in ADR-0049 step 4"),
  list(fichier = "^R/publish_postgres_configuration\\.R$",
       raison = "configuration_service_postgres() n'ouvre aucune connexion — retire in ADR-0049 step 4"),
  # Chaque smoke est nommé EXACTEMENT : un nouveau fichier ne peut pas entrer
  # dans l'allowlist par un motif large.
  list(fichier = "^scripts/smoke-comparison-lineage-fixture\\.R$",
       raison = "retire in ADR-0049 step 4"),
  list(fichier = "^scripts/smoke-demographic-reading-postgres\\.R$",
       raison = "retire in ADR-0049 step 4"),
  list(fichier = "^scripts/smoke-fiche-series-postgres\\.R$",
       raison = "retire in ADR-0049 step 4"),
  list(fichier = "^scripts/smoke-habitat-reading-postgres\\.R$",
       raison = "retire in ADR-0049 step 4"),
  list(fichier = "^scripts/smoke-housing-economy-postgres\\.R$",
       raison = "retire in ADR-0049 step 4"),
  list(fichier = "^scripts/smoke-littoral-reference\\.R$",
       raison = "retire in ADR-0049 step 4"),
  list(fichier = "^scripts/smoke-milieux-reading-postgres\\.R$",
       raison = "retire in ADR-0049 step 4"),
  list(fichier = "^scripts/smoke-profile-postgres\\.R$",
       raison = "retire in ADR-0049 step 4"),
  list(fichier = "^scripts/smoke-programme-postgres\\.R$",
       raison = "retire in ADR-0049 step 4"),
  list(fichier = "^scripts/smoke-retained-baseline-postgres\\.R$",
       raison = "retire in ADR-0049 step 4"),
  list(fichier = "^scripts/smoke-retained-territory-reference\\.R$",
       raison = "retire in ADR-0049 step 4"),
  list(fichier = "^scripts/smoke-scalar-postgres\\.R$",
       raison = "retire in ADR-0049 step 4"),
  list(fichier = "^scripts/smoke-series-postgres\\.R$",
       raison = "retire in ADR-0049 step 4")
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
  fichiers <- fichiers_structure(racine, motif = "dbConnect|configuration_service_postgres")
  trousses <- list()
  for (f in fichiers) {
    rel <- relatif_sous(f, racine)
    source <- source_structure(f)
    appels <- appels_structure(source)
    sites <- appels[appels$fonction %in%
                      c("dbConnect", "configuration_service_postgres"), , drop = FALSE]
    # `do.call(DBI::dbConnect, ...)` opens the same connection but the parser
    # represents dbConnect as a function reference, not a direct call node.
    references <- references_structure(
      source, c("dbConnect", "configuration_service_postgres"))
    references <- references[vapply(references$id, function(id) {
      ancetres <- appels_ancetres(id, source)
      do_call <- ancetres[ancetres$fonction == "do.call", , drop = FALSE]
      if (!nrow(do_call)) return(FALSE)
      any(vapply(do_call$id, function(appel_id) {
        argument <- premier_argument_appel(appel_id, source)
        !is.na(argument) && appel_descendant_de(id, argument, source)
      }, logical(1)))
    }, logical(1)), , drop = FALSE]
    sites <- rbind(sites, references)
    sites <- sites[!duplicated(paste(sites$fonction, sites$line1, sites$col1)), ,
                   drop = FALSE]
    for (i in seq_len(nrow(sites))) {
      site <- sites[i, , drop = FALSE]
      if (!grepl(motif, appel_ligne(site, source))) next
      blocs <- appels_ancetres(site$id, source)
      blocs <- blocs[blocs$fonction %in% c("function", "if", "for", "while"), ,
                     drop = FALSE]
      gardes <- appels[appels$fonction %in%
                         c("verifier_gel_release", "verifier_gel_lignage_ressource"), ,
                       drop = FALSE]
      garde <- FALSE
      for (j in seq_len(nrow(blocs))) {
        dans_bloc <- vapply(gardes$id, function(id) {
          appel_descendant_de(id, blocs$id[[j]], source)
        }, logical(1))
        avant <- vapply(seq_len(nrow(gardes)), function(k) {
          appel_avant(gardes[k, , drop = FALSE], site)
        }, logical(1))
        if (any(dans_bloc & avant)) {
          garde <- TRUE
          break
        }
      }
      ligne <- appel_ligne(site, source)
      raison <- autorise_site(rel, ligne, autorisations)
      trousses[[length(trousses) + 1L]] <- data.frame(
        fichier = rel, ligne = site$line1[[1L]], garde = garde,
        autorise = !is.na(raison), raison = if (is.na(raison)) "" else raison,
        source = ligne, stringsAsFactors = FALSE
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
      " serving-DB call site(s) without a freeze guard (verifier_gel_release() / verifier_gel_lignage_ressource()) and without an allowlist reason:\n",
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
  fichiers <- fichiers_structure(racine, motif = "verifier_gel_release")
  trousses <- list()
  for (f in fichiers) {
    rel <- relatif_sous(f, racine)
    source <- source_structure(f)
    appels <- appels_structure(source)
    sites <- appels[appels$fonction == "verifier_gel_release", , drop = FALSE]
    for (i in seq_len(nrow(sites))) {
      site <- sites[i, , drop = FALSE]
      trousses[[length(trousses) + 1L]] <- data.frame(
        fichier = rel, ligne = site$line1[[1L]],
        sans_argument = is.na(argument_nomme(site$id, "sortie", source)) &&
          nrow(arguments_appel(site$id, source)) == 0L,
        source = appel_ligne(site, source), stringsAsFactors = FALSE
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

FONCTIONS_RESEAU <- c(
  "download.file", "req_perform", "GET", "request", "curl_fetch",
  "url", "st_read", "read_csv", "fromJSON"
)
FONCTIONS_RESEAU_URL <- c("url", "st_read", "read_csv", "fromJSON")

auditer_appels_reseau <- function(racine, autorisations = AUTORISATIONS_RESEAU) {
  fichiers <- fichiers_structure(racine, motif = paste(FONCTIONS_RESEAU, collapse = "|"))
  trousses <- list()
  noms <- FONCTIONS_RESEAU
  for (f in fichiers) {
    rel <- relatif_sous(f, racine)
    source <- source_structure(f)
    appels <- appels_structure(source)
    sites <- appels[appels$fonction %in% noms, , drop = FALSE]
    sites <- sites[vapply(seq_len(nrow(sites)), function(i) {
      if (!sites$fonction[[i]] %in% FONCTIONS_RESEAU_URL) return(TRUE)
      grepl("https?://", appel_texte(sites[i, , drop = FALSE], source))
    }, logical(1)), , drop = FALSE]

    # A default such as `download = utils::download.file` is an audited network
    # seam even though it is a function reference, not a call. `fetch` and
    # `download_file` defaults remain excluded exactly as before.
    references <- references_structure(source, noms)
    references <- references[vapply(references$id, function(id) {
      ligne <- source$lignes[[references$line1[references$id == id][[1L]]]]
      if (grepl("(fetch|download_file)\\s*=", ligne)) return(FALSE)
      if (grepl("(^|,)\\s*download\\s*=", ligne)) return(TRUE)
      ancetres <- appels_ancetres(id, source)
      do_call <- ancetres[ancetres$fonction == "do.call", , drop = FALSE]
      if (!nrow(do_call)) return(FALSE)
      any(vapply(do_call$id, function(appel_id) {
        argument <- premier_argument_appel(appel_id, source)
        !is.na(argument) && appel_descendant_de(id, argument, source)
      }, logical(1)))
    }, logical(1)), , drop = FALSE]
    sites <- rbind(sites, references)
    sites <- sites[!duplicated(paste(sites$fonction, sites$line1, sites$col1)), ,
                   drop = FALSE]

    for (i in seq_len(nrow(sites))) {
      appel <- sites[i, , drop = FALSE]
      couvert <- FALSE; raison <- NA_character_
      ligne <- appel_ligne(appel, source)
      for (a in autorisations) {
        if (grepl(a$fichier, rel) && grepl(a$motif, ligne)) {
          couvert <- isTRUE(a$couvert)
          raison <- a$raison
          break
        }
      }
      trousses[[length(trousses) + 1L]] <- data.frame(
        fichier = rel, ligne = appel$line1[[1L]], couvert = couvert,
        autorise = !is.na(raison),
        raison = if (is.na(raison)) "" else raison,
        source = ligne, stringsAsFactors = FALSE
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
  fichiers <- fichiers_structure(racine, motif = "sha256")
  trousses <- list()
  noms_enveloppe <- "brut|reponse|response|collection|limites|enveloppe|collection_wfs"
  for (f in fichiers) {
    rel <- relatif_sous(f, racine)
    source <- source_structure(f)
    appels <- appels_structure(source)
    hachages <- appels[appels$fonction == "sha256", , drop = FALSE]
    for (i in seq_len(nrow(hachages))) {
      hachage <- hachages[i, , drop = FALSE]
      json <- appels[vapply(appels$id, function(id) {
        appel_descendant_de(id, hachage$id, source)
      }, logical(1)) & appels$fonction == "toJSON", , drop = FALSE]
      enveloppe <- FALSE
      for (j in seq_len(nrow(json))) {
        argument <- premier_argument_appel(json$id[[j]], source)
        if (is.na(argument)) next
        texte <- trimws(noeud_texte(argument, source))
        if (grepl(paste0("^(", noms_enveloppe, ")\\b"), texte)) {
          enveloppe <- TRUE
          break
        }
      }
      autorise <- !enveloppe || grepl("^R/wfs_digest\\.R$", rel)
      trousses[[length(trousses) + 1L]] <- data.frame(
        fichier = rel, ligne = hachage$line1[[1L]], enveloppe = enveloppe,
        autorise = autorise, source = appel_ligne(hachage, source),
        stringsAsFactors = FALSE
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
# Un test avec DBI mocké ne le voit pas : les appels dbExecute/dbGetQuery/
# dbSendQuery sont lus dans le parse data partagé et exigent des paramètres
# positionnels : `list(a, b)` ou `unname(as.list(x))`, jamais `list(nom = ...)`
# ni `as.list(...)` dont les noms viennent du data.frame.
params_dbi_nommes <- function(valeur, source) {
  if (is.na(valeur)) return(FALSE)
  appels <- appels_structure(source)
  descendants <- appels[vapply(appels$id, function(id) {
    appel_descendant_de(id, valeur, source)
  }, logical(1)), , drop = FALSE]
  for (i in seq_len(nrow(descendants))) {
    appel <- descendants[i, , drop = FALSE]
    if (appel$fonction == "list" &&
        any(enfants_parse(appel$id, source)$terminal &
            enfants_parse(appel$id, source)$text == "=")) return(TRUE)
    if (appel$fonction == "as.list") {
      ancetres <- appels_ancetres(appel$id, source)
      if (!nrow(ancetres) || !identical(ancetres$fonction[[1L]], "unname")) return(TRUE)
    }
  }
  FALSE
}

auditer_params_dbi <- function(racine) {
  fichiers <- fichiers_structure(
    racine, sous = "R", motif = "dbExecute|dbGetQuery|dbSendQuery")
  trousses <- list()
  for (f in fichiers) {
    source <- source_structure(f)
    appels <- appels_structure(source)
    sites <- appels[appels$fonction %in% c("dbExecute", "dbGetQuery", "dbSendQuery"), ,
                   drop = FALSE]
    for (i in seq_len(nrow(sites))) {
      site <- sites[i, , drop = FALSE]
      valeur <- argument_nomme(site$id, "params", source)
      if (!params_dbi_nommes(valeur, source)) next
      trousses[[length(trousses) + 1L]] <- data.frame(
        fichier = relatif_sous(f, racine),
        source = appel_texte(site, source), stringsAsFactors = FALSE)
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
# sur une table de service d'une forme enregistrée ; un site non autorisé fait échouer la
# suite. Les producteurs historiques sont autorisés « retire in ADR-0049 step 4 »
# ; `apply` n'écrit AUCUNE table de service directement — il délègue à l'adaptateur.
TABLES_SERVICE_SCALAIRE <- paste0(
  "scalar_observation|scalar_descriptor|scalar_comparison_",
  "|comparison_source_lineage|scalar_resource_comparison_publication")
TABLES_SERVICE_PROFIL <- paste0(
  "profile_descriptor|profile_axis|profile_observation|profile_comparison_",
  "|profile_resource_comparison_publication")
TABLES_SERVICE_SERIE <- paste0(
  "series_dataset_publication|series_dataset_descriptor|series_dataset_observation",
  "|series_observation_provenance|series_provenance_revision|series_named_reference",
  "|series_context_parent_policy|ordered_series_comparison_")
TABLES_SERVICE_COLLECTION <- paste0(
  "observed_collection_publication|observed_collection_descriptor",
  "|observed_collection_category|observed_collection_comparison_",
  "|period_detail_observation|anchored_membership")
TABLES_SERVICE_AEDAR <- paste0(
  "aedar_territorial_aggregate|aedar_territory_summary|aedar_comparison_",
  "|aedar_density_class_summary|aedar_littoral_summary")
TABLES_SERVICE_REGISTRE <- "resource_publication"
TABLES_SERVICE <- paste0(TABLES_SERVICE_SCALAIRE, "|", TABLES_SERVICE_PROFIL, "|",
  TABLES_SERVICE_SERIE, "|", TABLES_SERVICE_COLLECTION, "|", TABLES_SERVICE_AEDAR,
  "|", TABLES_SERVICE_REGISTRE)
MOTIF_ECRITURE_SERVEUR <- paste0(
  "(DELETE FROM|INSERT INTO|UPDATE|TRUNCATE)\\s+(", TABLES_SERVICE, ")",
  "|db(Write|Append)Table\\s*\\([^,]+,\\s*[\"'](", TABLES_SERVICE, ")")

AUTORISATIONS_ECRITURE_SERVEUR <- list(
  list(fichier = "^R/adaptateur_scalaire\\.R$",
       raison = "adaptateur de forme ADR-0049 — seul écrivain des tables de service de sa forme"),
  list(fichier = "^R/adaptateur_profil_declare\\.R$",
       raison = "adaptateur de forme ADR-0049 — seul écrivain des tables de service de sa forme"),
  list(fichier = "^R/adaptateur_series\\.R$",
       raison = "adaptateur de forme ADR-0049 — seul écrivain des tables de service de sa forme"),
  list(fichier = "^R/adaptateur_collection\\.R$",
       raison = "adaptateur de forme ADR-0049 — seul écrivain des tables de service de sa forme"),
  list(fichier = "^R/adaptateur_aedar\\.R$",
       raison = "adaptateur de forme ADR-0049 — seul écrivain des tables de service de sa forme"),
  list(fichier = "^R/registre_ressource\\.R$",
       raison = "écrivain partagé du registre et des reçus ADR-0049"),
  list(fichier = "^R/publish_scalar\\.R$",
       raison = "producteur historique — retire in ADR-0049 step 4"),
  list(fichier = "^R/publish_series\\.R$",
       raison = "producteur historique partagé avec l'adaptateur — retire in ADR-0049 step 4"),
  list(fichier = "^R/publish_observed_collections\\.R$",
       raison = "producteur historique partagé avec l'adaptateur — retire in ADR-0049 step 4"),
  list(fichier = "^R/publish_profile\\.R$",
       raison = "producteur historique — retire in ADR-0049 step 4"),
  list(fichier = "^R/aedar_aggregates\\.R$",
       raison = "producteur historique — retire in ADR-0049 step 4"),
  list(fichier = "^scripts/smoke-profile-postgres\\.R$",
       raison = "smoke historique — retire in ADR-0049 step 4"),
  list(fichier = "^scripts/smoke-scalar-postgres\\.R$",
       raison = "smoke historique — retire in ADR-0049 step 4"),
  list(fichier = "^scripts/smoke-habitat-reading-postgres\\.R$",
       raison = "smoke historique — retire in ADR-0049 step 4"),
  list(fichier = "^scripts/smoke-retained-baseline-postgres\\.R$",
       raison = "smoke historique — retire in ADR-0049 step 4"),
  list(fichier = "^scripts/smoke-series-postgres\\.R$",
       raison = "smoke historique — retire in ADR-0049 step 4"),
  list(fichier = "^scripts/smoke-fiche-series-postgres\\.R$",
       raison = "smoke historique — retire in ADR-0049 step 4"),
  list(fichier = "^scripts/smoke-comparison-lineage-fixture\\.R$",
       raison = "smoke historique — retire in ADR-0049 step 4"),
  list(fichier = "^scripts/smoke-programme-postgres\\.R$",
       raison = "smoke historique — retire in ADR-0049 step 4")
)

auditer_ecritures_serveur <- function(racine,
                                      autorisations = AUTORISATIONS_ECRITURE_SERVEUR) {
  fichiers <- fichiers_structure(
    racine, motif = paste0(TABLES_SERVICE, "|dbWriteTable|dbAppendTable"))
  trousses <- list()
  sql <- paste0("(DELETE FROM|INSERT INTO|UPDATE|TRUNCATE)\\s+(",
                TABLES_SERVICE, ")")
  for (f in fichiers) {
    rel <- relatif_sous(f, racine)
    source <- source_structure(f)
    donnees <- source$donnees
    appels <- appels_structure(source)
    lignes_fautives <- integer()
    if (!is.null(donnees)) {
      chaines <- donnees[donnees$terminal, , drop = FALSE]
      chaines <- chaines[grepl(sql, chaines$text, ignore.case = TRUE), ,
                         drop = FALSE]
      lignes_fautives <- c(lignes_fautives, chaines$line1)
    }
    ecritures <- appels[appels$fonction %in% c("dbWriteTable", "dbAppendTable"), ,
                       drop = FALSE]
    for (i in seq_len(nrow(ecritures))) {
      arguments <- arguments_appel(ecritures$id[[i]], source)
      if (nrow(arguments) < 2L) next
      nom_table <- trimws(noeud_texte(arguments$id[[2L]], source))
      if (grepl(paste0("^[\"'](", TABLES_SERVICE, ")[\"']$"),
                nom_table)) {
        lignes_fautives <- c(lignes_fautives, ecritures$line1[[i]])
      }
    }
    for (i in unique(lignes_fautives)) {
      raison <- NA_character_
      for (a in autorisations) {
        if (grepl(a$fichier, rel)) { raison <- a$raison; break }
      }
      trousses[[length(trousses) + 1L]] <- data.frame(
        fichier = rel, ligne = i, autorise = !is.na(raison),
        raison = if (is.na(raison)) "" else raison,
        source = trimws(source$lignes[[i]]), stringsAsFactors = FALSE
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
