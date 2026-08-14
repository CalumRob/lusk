# graphe_cron ------------------------------------------------------------------
# Le seam de décision du build cron (revue #386) : la logique qui vivait dans
# l'étape « Build en mode cron » de .github/workflows/pipeline-cron.yml en un
# one-liner R non testable — l'invocation du graphe targets, la détection des
# cibles en échec et, quand le TÉLÉCHARGEMENT lui-même échoue, l'écriture du
# rapport d'échec (la responsabilité du câblage cron, documentée dans
# _targets.R et ADR-0004). Le YAML ne porte plus que l'appel ; la décision est
# testée ici (test-graphe-cron.R).
#
# Contrat — l'identique de la sémantique qu'il remplace :
#   - invoque le graphe : targets::tar_make(callr_function = NULL) ;
#   - lit les cibles en échec : targets::tar_errored() ;
#   - aucune cible en échec -> succès (invisible TRUE) ;
#   - cibles en échec -> la responsabilité du rapport d'échec : quand le
#     rapport de run n'existe pas ET qu'une cible sources_* a échoué (le DAG
#     n'écrit aucun rapport — les rapports dépendent des sources), on rejoue
#     download_sources sur les manifestes des thèmes du run (dérivés de
#     LUSK_THEMES — la même source de vérité que _targets.R, jamais une liste
#     en dur) et on écrit le rapport quand l'un d'eux porte un « échec » ;
#     échec signalé (invisible FALSE) — l'appelant en fait un exit non nul.
# La configuration du run est lue dans l'environnement comme _targets.R le
# fait (LUSK_MODE, LUSK_CACHE, LUSK_SORTIE, LUSK_THEMES) — le workflow la
# câble explicitement, les tests la pointent sur des répertoires temporaires.

# themes_graphe ----------------------------------------------------------------
# La registre des descripteurs du graphe — le MIROIR de THEMES_RUN de
# _targets.R (les CINQ thèmes du payload par-thème ; Programmes n'est pas un
# thème de THEMES_RUN — son payload partagé est câblé à part, sur le run
# complet). LUSK_THEMES sélectionne dans cette registre, à l'identique du
# graphe : vide = les cinq, nom inconnu = erreur. La convention du graphe : le
# descripteur d'un thème s'obtient par SON constructeur (theme_<slug>(), la
# convention des modules de thème) — jamais un nom de thème en dur ailleurs.
# Une FONCTION (jamais une liste évaluée au chargement du paquet) : les
# descripteurs sont construits par leur constructeur à l'appel — le chargement
# des fichiers R est alphabétique, les modules de thème (theme_*.R) arrivent
# après graphe_cron.R.
themes_graphe <- function() {
  list(
    demographie = theme_demographie(),
    habitat = theme_habitat(),
    economie = theme_economie(),
    mobilite = theme_mobilite(),
    milieux = theme_milieux()
  )
}

# manifestes_pour --------------------------------------------------------------
# Les manifestes des thèmes du run, dérivés de la variable LUSK_THEMES (celle
# que _targets.R lit) — la MÊME convention de sélection que le graphe : vide =
# les CINQ thèmes, une liste nommée = le sous-ensemble dans l'ordre donné, un
# nom inconnu = erreur (stop, la convention du graphe).
manifestes_pour <- function(themes) {
  tous <- themes_graphe()
  selection <- if (nzchar(themes)) {
    strsplit(themes, ",")[[1L]]
  } else {
    names(tous)
  }
  inconnus <- setdiff(selection, names(tous))
  if (length(inconnus) > 0) {
    stop("LUSK_THEMES : thème(s) inconnu(s) : ",
         paste(inconnus, collapse = ", "), ".", call. = FALSE)
  }
  lapply(tous[selection], `[[`, "manifest")
}

# executer_graphe_cron ---------------------------------------------------------
# Le seam appelé par le workflow : TRUE = run propre (aucune cible en échec) ;
# FALSE = échec signalé (au moins une cible en échec). L'appelant traduit le
# retour en code de sortie — le YAML : quit(status = if (executer_graphe_cron())
# 0 else 1). Le seam ne quitte JAMAIS lui-même : c'est l'appelant qui décide
# du code de sortie (l'identique du set +e / status=$? de l'ancien câblage).
executer_graphe_cron <- function() {
  mode <- Sys.getenv("LUSK_MODE", unset = "full")
  cache <- Sys.getenv("LUSK_CACHE", unset = "data/raw")
  sortie <- Sys.getenv("LUSK_SORTIE", unset = "../public/data")
  themes <- Sys.getenv("LUSK_THEMES", unset = "")

  targets::tar_make(callr_function = NULL)
  erreurs <- targets::tar_errored()
  if (length(erreurs) == 0) return(invisible(TRUE))

  # la responsabilité du câblage cron (ADR-0004) : quand le TÉLÉCHARGEMENT
  # lui-même échoue, le DAG n'écrit aucun rapport (les rapports dépendent des
  # sources) — le seam écrit alors le rapport d'échec. Condition préservée à
  # l'identique : le rapport n'existe pas ET une cible sources_* est en échec.
  rapport <- file.path(sortie, "run-report.json")
  if (!file.exists(rapport) && any(grepl("^sources_", erreurs))) {
    statuts <- NULL
    for (m in manifestes_pour(themes)) {
      # un échec cron est porté par l'erreur (issue #8) : on récupère les
      # statuts et on s'arrête au premier thème en échec — le rapport porte
      # les statuts du thème fautif, à l'identique de l'ancien câblage.
      statuts <- tryCatch(
        download_sources(m, cache = cache, mode = mode),
        erreur_telechargement = function(e) e$statuts
      )
      if (any(statuts$status == "échec")) break
    }
    if (any(statuts$status == "échec")) {
      ecrire_rapport_run(statuts, mode, sortie)
    }
  }
  invisible(FALSE)
}
