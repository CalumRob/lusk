# test-targets-byte-identical ----------------------------------------------------
# Seam 1 (#340, épique #329) : le CONTRAT du payload — le plus haut seam
# existant. Un run du graphe targets sur store FROID doit produire un payload
# byte-identique à run_pipeline() sur le même cache : l'oracle
# detecter_changement() (test-diff-skip.R) doit répondre FALSE. C'est la
# preuve que le port n'a rien changé à la donnée (US 12).
#
# Les deux sorties sont des répertoires temporAIRES — jamais le public/data du
# dépôt. Le store _targets/ (gitignoré) est supprimé au départ : la porte est
# un run de zéro, comme sur un runner froid.
#
# Données réelles : le test saute proprement quand le cache (pipeline/data/raw)
# est absent — le même motif que les blocs « données réelles » existants — la
# CI froide le saute, les runs locaux prouvent la propriété.

test_that("graphe targets vs run_pipeline : payload byte-identique sur le même cache", {
  # le paquet est chargé (test_local) : sa racine est le CWD du run — on s'y
  # ancre explicitement, que le test soit lancé seul (test_file) ou par la
  # suite (test_local), et le graphe y trouve son _targets.R
  racine_paquet <- pkgload::pkg_path()
  withr::local_dir(racine_paquet)

  skip_if_not(
    dir.exists(file.path(racine_paquet, "data", "raw")),
    "le cache des données réelles n'est pas présent (pipeline/data/raw)"
  )

  # store FROID : le graphe part de zéro
  unlink("_targets", recursive = TRUE)
  on.exit(unlink("_targets", recursive = TRUE), add = TRUE)

  sortie_graphe <- tempfile("graphe-")
  sortie_oracle <- tempfile("oracle-")
  on.exit(unlink(c(sortie_graphe, sortie_oracle), recursive = TRUE), add = TRUE)

  # le graphe lit sa configuration dans l'environnement (le cron la câblera
  # explicitement, étape 5) — on pointe la sortie du graphe vers un répertoire
  # temporaire, le cache reste le vrai cache du dépôt
  withr::local_envvar(
    LUSK_SORTIE = sortie_graphe,
    LUSK_CACHE = "data/raw",
    LUSK_MODE = "full"
  )

  # le run du port
  targets::tar_make(callr_function = NULL)

  # l'oracle — le run actuel, inchangé, sur le même cache
  run_pipeline(theme = theme_demographie(), cache = "data/raw",
               sortie = sortie_oracle)

  # La géométrie porte le timeStamp du serveur WFS (data.geopf.fr horodate
  # chaque réponse GetFeature) — un artefact de SOURCE, pas de donnée : deux
  # appels successifs au WFS diffèrent par construction, même entre deux runs
  # de run_pipeline. On le neutralise des deux côtés (la même classe
  # d'artefact que l'horodatage du rapport, déjà exclu par detecter_changement)
  # — TOUT LE RESTE doit être byte-identique.
  neutraliser_time_stamp <- function(rep) {
    for (f in list.files(rep, pattern = "[.]geojson$")) {
      chemin <- file.path(rep, f)
      txt <- paste(readLines(chemin, warn = FALSE), collapse = "\n")
      txt <- gsub('"timeStamp":"[^"]*"', '"timeStamp":""', txt)
      writeLines(txt, chemin)
    }
    invisible(rep)
  }
  neutraliser_time_stamp(sortie_graphe)
  neutraliser_time_stamp(sortie_oracle)

  # le contrat : byte-identique (detecter_changement exclut run-report.json —
  # le rapport porte un horodatage par run, la donnée, elle, ne change pas)
  expect_false(detecter_changement(sortie_graphe, sortie_oracle))
})
