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
