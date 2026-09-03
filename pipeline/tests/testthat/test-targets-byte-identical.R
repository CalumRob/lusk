# test-targets-byte-identical ----------------------------------------------------
# Seam 1 (#340, épique #329) : le CONTRAT du payload — le plus haut seam
# existant. Un run du graphe targets sur store FROID doit produire un payload
# byte-identique à run_pipeline() sur le même cache : l'oracle
# detecter_changement() (test-diff-skip.R) doit répondre FALSE. C'est la
# preuve que le port n'a rien changé à la donnée (US 12).
#
# Issue #341 : le contrat est généralisé aux CINQ thèmes. Deux portes :
#   - par thème : le graphe (restreint au thème via LUSK_THEMES — le même
#     seam que le cron slow-clock utilisera) produit la sortie byte-identique
#     à run_pipeline(theme) sur le même cache — la porte de #340, répétée ;
#   - le run COMPLET : le graphe (LUSK_THEMES vide) produit la MÊME sortie que
#     SIX run_pipeline SÉQUENTIELS dans la même cible (l'ordre du cron : les
#     CINQ thèmes + le payload partagé Programmes, #343) — la fusion partagée
#     des vintages (#124, amendée #243, + #178 pour le module Programmes) et
#     la référence des territoires y sont byte-identiques, chaînes incluses.
#
# Les deux sorties sont des répertoires temporAIRES — jamais le public/data du
# dépôt. Le store _targets/ (gitignoré) est supprimé au départ : la porte est
# un run de zéro, comme sur un runner froid.
#
# Données réelles : le test saute proprement quand le cache (pipeline/data/raw)
# est absent — le même motif que les blocs « données réelles » existants — la
# CI froide le saute, les runs locaux prouvent la propriété.

# la géométrie porte le timeStamp du serveur WFS (data.geopf.fr horodate
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

THEMES_RUN_TEST <- list(
  demographie = theme_demographie(),
  habitat = theme_habitat(),
  economie = theme_economie(),
  mobilite = theme_mobilite(),
  milieux = theme_milieux()
)

test_that("graphe targets vs run_pipeline : chaque thème byte-identique sur le même cache", {
  racine_paquet <- pkgload::pkg_path()
  withr::local_dir(racine_paquet)

  skip_if_not(
    dir.exists(file.path(racine_paquet, "data", "raw")),
    "le cache des données réelles n'est pas présent (pipeline/data/raw)"
  )

  for (nom in names(THEMES_RUN_TEST)) {
    # store FROID par thème : le graphe (restreint au thème sous test) part de
    # zéro, comme sur un runner froid
    unlink("_targets", recursive = TRUE)
    on.exit(unlink("_targets", recursive = TRUE), add = TRUE)

    sortie_graphe <- tempfile(paste0("graphe-", nom, "-"))
    sortie_oracle <- tempfile(paste0("oracle-", nom, "-"))
    on.exit(unlink(c(sortie_graphe, sortie_oracle), recursive = TRUE), add = TRUE)

    # le graphe lit sa configuration dans l'environnement (le cron la câblera
    # explicitement, étape 5) — on pointe la sortie vers un répertoire
    # temporaire, le cache reste le vrai cache du dépôt
    withr::local_envvar(
      LUSK_SORTIE = sortie_graphe,
      LUSK_CACHE = "data/raw",
      LUSK_MODE = "full",
      LUSK_THEMES = nom
    )

    targets::tar_make(callr_function = NULL)

    # l'oracle — le run actuel, inchangé, sur le même cache
    run_pipeline(theme = THEMES_RUN_TEST[[nom]], cache = "data/raw",
                 sortie = sortie_oracle,
                 noms_epci_geo_api = lire_noms_epci_geo_api())

    neutraliser_time_stamp(sortie_graphe)
    neutraliser_time_stamp(sortie_oracle)

    # le contrat : byte-identique (detecter_changement exclut run-report.json —
    # le rapport porte un horodatage par run, la donnée, elle, ne change pas)
    expect_false(
      detecter_changement(sortie_graphe, sortie_oracle),
      info = paste("thème", nom)
    )
  }
})

test_that("graphe cinq thèmes vs cinq run_pipeline séquentiels : sortie complète byte-identique", {
  racine_paquet <- pkgload::pkg_path()
  withr::local_dir(racine_paquet)

  skip_if_not(
    dir.exists(file.path(racine_paquet, "data", "raw")),
    "le cache des données réelles n'est pas présent (pipeline/data/raw)"
  )

  # store FROID : le graphe complet part de zéro
  unlink("_targets", recursive = TRUE)
  on.exit(unlink("_targets", recursive = TRUE), add = TRUE)

  sortie_graphe <- tempfile("graphe-cinq-")
  sortie_oracle <- tempfile("oracle-cinq-")
  on.exit(unlink(c(sortie_graphe, sortie_oracle), recursive = TRUE), add = TRUE)

  # le graphe COMPLET (LUSK_THEMES vide = les cinq thèmes) — un seul run
  withr::local_envvar(
    LUSK_SORTIE = sortie_graphe,
    LUSK_CACHE = "data/raw",
    LUSK_MODE = "full",
    LUSK_THEMES = ""
  )
  targets::tar_make(callr_function = NULL)

  # l'oracle : cinq run_pipeline SÉQUENTIELS dans la MÊME sortie (l'ordre du
  # cron) — la fusion partagée des vintages s'accumule sur disque, la
  # référence des territoires et le rapport sont écrits par le dernier thème :
  # exactement ce que le graphe chaîné produit (publie_/rapport_ chaînés,
  # fusion_vintages unique)
  for (nom in names(THEMES_RUN_TEST)) {
    run_pipeline(theme = THEMES_RUN_TEST[[nom]], cache = "data/raw",
                 sortie = sortie_oracle,
                 noms_epci_geo_api = lire_noms_epci_geo_api())
  }
  # Issue #343 — la résolution du run complet : le graphe publie AUSSI le
  # payload PARTAGÉ programmes (programmes.json + les parquets par table,
  # ADR-0013) et fusionne les SIX sources du module dans la table partagée des
  # vintages (#178) — comme le cron qui invoque maintenant le graphe
  # (LUSK_THEMES vide). L'oracle du run complet EST donc SIX run_pipeline
  # séquentiels (les cinq thèmes + theme_programmes()) : le SIXIÈME appel
  # écrit programmes.json et le rapport final, dans le même rang que la chaîne
  # programmes du graphe (publie_programmes, rapport_programmes chaîné
  # dernier). L'alternative « ne pas publier programmes sur la sortie
  # par défaut » a été rejetée : le payload de production (public/data) porte
  # programmes.json — le câblage cron #343 le publierait sinon en régression.
  run_pipeline(theme = theme_programmes(), cache = "data/raw",
               sortie = sortie_oracle,
               noms_epci_geo_api = lire_noms_epci_geo_api())

  neutraliser_time_stamp(sortie_graphe)
  neutraliser_time_stamp(sortie_oracle)

  expect_false(detecter_changement(sortie_graphe, sortie_oracle))
})
