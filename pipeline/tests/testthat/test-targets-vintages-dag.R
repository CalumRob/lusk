# DAG des vintages publiées (issue #1114) ---------------------------------------
# La table d'un thème doit être construite APRÈS le téléchargement de SES sources
# et rejouer quand leurs octets changent. Les sidecars (`.digests/*.json`) sont
# des entrées non suivies : sans dépendance explicite sur les cibles de
# téléchargement, la table part de littérals de manifeste et n'est jamais
# invalidée. Deux portes, aucune donnée réelle : la structure du VRAI graphe
# (tar_network/tar_manifest sur _targets.R) et un mini-graphe exécuté deux fois.

test_that("chaque vintages_table_* dépend des cibles de téléchargement de son thème", {
  racine <- pkgload::pkg_path()
  withr::local_dir(racine)
  withr::local_envvar(LUSK_THEMES = "")

  # structure lue dans un store ISOLÉ — jamais le store réel (règle #341)
  reseau <- reseau_graphe()
  aretes <- reseau[["edges"]]
  dependances <- function(cible) unique(aretes$from[aretes$to == cible])

  themes <- c("demographie", "habitat", "economie", "mobilite", "milieux")
  for (theme in themes) {
    cible <- paste0("vintages_table_", theme)
    # `sources_<theme>` ordonne la résolution des octets ; `fichiers_<theme>`
    # (format = "file", fraîcheur PAR CONTENU) invalide la table quand les
    # octets changent — les deux sont nécessaires.
    expect_true(paste0("sources_", theme) %in% dependances(cible),
                info = paste(cible, "ne dépend pas de sources_", theme))
    expect_true(paste0("fichiers_", theme) %in% dependances(cible),
                info = paste(cible, "ne dépend pas de fichiers_", theme))
  }
  # Programmes, sur un run COMPLET, suit la même règle
  expect_true("sources_programmes" %in% dependances("vintages_table_programmes"))
  expect_true("fichiers_programmes" %in% dependances("vintages_table_programmes"))
})

test_that("les commandes des vintages portent le garde de fail-closed et le cache", {
  racine <- pkgload::pkg_path()
  withr::local_dir(racine)
  withr::local_envvar(LUSK_THEMES = "")

  manifeste <- manifeste_graphe()
  commande <- function(nom) manifeste$command[manifeste$name == nom]

  for (theme in c("demographie", "habitat", "economie", "mobilite", "milieux")) {
    cmd <- commande(paste0("vintages_table_", theme))
    expect_true(grepl("verifier_vintages_attestees", cmd, fixed = TRUE), info = theme)
    expect_true(grepl(paste0("sources_", theme), cmd, fixed = TRUE), info = theme)
    expect_true(grepl(paste0("fichiers_", theme), cmd, fixed = TRUE), info = theme)
  }
  cmd_p <- commande("vintages_table_programmes")
  expect_true(grepl("verifier_vintages_attestees", cmd_p, fixed = TRUE))
  expect_true(grepl("vintages_programmes(cache =", cmd_p, fixed = TRUE))
  expect_true(grepl("sources_programmes", cmd_p, fixed = TRUE))
})
