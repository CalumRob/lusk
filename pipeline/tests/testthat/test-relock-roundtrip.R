# Round-trip relock -> gel de release sur le jeu complet d'un run (#1122) --------
# Le premier relock réel (run4 du #1105) échouait : relock_sources() validait
# chaque id via base_vintage(), qui ne connaissait que les ids de manifeste.
# Les lectures réseau non-manifeste `geometrie_*` (registre LECTURES_RESEAU,
# base `telechargement`) étaient inconnues, donc AUCUN run complet ne pouvait
# être relocké — alors que le garde exige que CHAQUE empreinte soit verrouillée.
#
# Ce jeu de tests construit le jeu d'empreintes que le target `digests_run`
# publie réellement, avec les MÊMES helpers que ce target, puis relocke et
# garde le MÊME répertoire de run. Aucune liste d'ids maintenue à la main :
# l'ajout d'une source au graphe fait grandir le jeu automatiquement.

digest_pour_1122 <- function(id) {
  list(
    source_id = id, url = "https://example.invalid/x",
    sha256 = paste0("sha-", id),
    bytes = 10, acquired_at = "2026-11-22",
    # Tel qu'un run le publie : la base a été dérivée à l'acquisition, elle
    # n'est PAS recalculée au relock (c'est précisément ce que le test isole).
    vintage_basis = "telechargement",
    vintage = "2026-11", date_reference = NA_character_
  )
}

# Les manifestes que le graphe télécharge sur un run complet : les cinq thèmes,
# les deux classifications partagées du référentiel, et Programmes.
manifestes_run_1122 <- function() {
  c(
    lapply(list(theme_demographie(), theme_habitat(), theme_economie(),
                theme_mobilite(), theme_milieux()), function(t) t$manifest),
    list(MANIFEST_CLASSES_DENSITE, MANIFEST_CLASSES_LITTORAL,
         MANIFEST_PROGRAMMES_COMPLET)
  )
}

statut_1122 <- function(ids) {
  s <- tibble::tibble(id = ids, mode = "cron", status = "frais")
  attr(s, "digests") <- stats::setNames(lapply(ids, digest_pour_1122), ids)
  s
}

test_that("chaque id que digests_run d'un run complet publie résout vers une base (#1122)", {
  manifestes <- manifestes_run_1122()
  ids <- ids_digests_publication(manifestes = manifestes)
  # Aucune liste maintenue à la main : le contrat suit les manifestes + le
  # registre des lectures réseau.
  expect_setequal(
    ids,
    unique(c(unlist(lapply(manifestes, function(m) as.character(m$id))),
             names(LECTURES_RESEAU)))
  )
  expect_true(all(paste0("geometrie_", names(NIVEAUX_GEOMETRIE)) %in% ids))
  for (id in ids) expect_true(nzchar(base_vintage(id)), info = id)
})

test_that("relock puis garde sur le MÊME run complet passent ; une dérive est refusée (#1122)", {
  run_dir <- tempfile("run-roundtrip-1122-")
  cache <- tempfile("cache-roundtrip-1122-")
  lock <- tempfile("lock-roundtrip-1122-")
  dir.create(run_dir, recursive = TRUE)
  dir.create(cache, recursive = TRUE)
  on.exit(unlink(c(run_dir, cache, lock), recursive = TRUE), add = TRUE)

  themes <- stats::setNames(
    list(theme_demographie(), theme_habitat(), theme_economie(),
         theme_mobilite(), theme_milieux()),
    c("demographie", "habitat", "economie", "mobilite", "milieux")
  )
  manifestes <- c(lapply(themes, function(t) t$manifest),
                  list(MANIFEST_CLASSES_DENSITE, MANIFEST_CLASSES_LITTORAL,
                       MANIFEST_PROGRAMMES_COMPLET))

  # `publier_geometrie` a déjà écrit les trois lectures réseau dans le fichier
  # de sortie ; on rejoue ensuite la commande RÉELLE du target digests_run.
  ecrire_digests_source(stats::setNames(
    lapply(names(LECTURES_RESEAU), digest_pour_1122), names(LECTURES_RESEAU)
  ), file.path(run_dir, NOM_DIGESTS))

  noms <- c(paste0("sources_", names(themes)), "sources_classes_densite",
            "sources_classes_littoral", "sources_programmes")
  fournir <- stats::setNames(lapply(manifestes, function(m) as.character(m$id)), noms)
  publier_digests_run(lapply(fournir, statut_1122), cache = cache, sortie = run_dir)

  publies <- lire_digests_source(file.path(run_dir, NOM_DIGESTS))
  expect_setequal(names(publies), ids_digests_publication(manifestes = manifestes))
  expect_true(all(paste0("geometrie_", names(NIVEAUX_GEOMETRIE)) %in% names(publies)))

  # Le relock accepte TOUS les ids du run, y compris geometrie_*, puis le garde
  # accepte ce MÊME répertoire.
  relock_sources(run_dir, lock = lock)
  expect_true(verifier_gel_release(run_dir, lock = lock))

  # Une seule empreinte mutée — précisément une couche WFS non-manifeste — est
  # refusée avec la raison nommée `derive`.
  cible <- names(LECTURES_RESEAU)[[1L]]
  publies[[cible]]$sha256 <- paste(rep("f", 64), collapse = "")
  ecrire_digests_source(publies, file.path(run_dir, NOM_DIGESTS))
  erreur <- tryCatch(verifier_gel_release(run_dir, lock = lock), error = function(e) e)
  expect_s3_class(erreur, "erreur_gel_release")
  expect_identical(erreur$raison, "derive")
  expect_true(grepl(cible, conditionMessage(erreur), fixed = TRUE))
})

test_that("la commande de relock documentée est celle qui marche (#1122)", {
  racine <- pkgload::pkg_path()
  script <- paste(readLines(
    file.path(racine, "scripts", "relock-sources.R"), warn = FALSE
  ), collapse = "\n")
  # Une seule forme documentée : lancée depuis pipeline/ (renv actif).
  expect_true(grepl("cd pipeline && Rscript scripts/relock-sources\\.R", script))
  expect_true(grepl("RENV_PROJECT", script))  # garde anti-lancement depuis la racine
  expect_identical(
    commande_relock(),
    "cd pipeline && Rscript scripts/relock-sources.R <run-dir>"
  )
})
