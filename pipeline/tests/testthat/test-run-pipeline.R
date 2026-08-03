# run_pipeline ----------------------------------------------------------------
# L'entrée unique. Point 11 : la composition des étapes (download -> construire
# -> vintage -> compute -> publish) est verrouillée par un test à étapes
# mockées — le réseau et les vrais fichiers n'entrent jamais dans la boucle de
# test. Issue #9 : la table des vintages entière passe au compute — les
# estampilles sont par indicateur (source de référence déclarée), plus de
# tampon de thème pointé par un id.

test_that("run_pipeline est l'entrée unique, sur les dossiers du dépôt", {
  expect_type(run_pipeline, "closure")
  # les chemins par défaut vivent dans le dépôt (jamais sur C:)
  expect_equal(formals(run_pipeline)$cache, "data/raw")
  expect_equal(formals(run_pipeline)$sortie, "data/processed")
})

test_that("run_pipeline compose les étapes dans l'ordre, à étapes mockées (point 11)", {
  # trace des appels : chaque étape enregistre ce qu'elle reçoit
  appels <- new.env(parent = emptyenv())
  appels$download <- 0
  appels$construire <- 0
  appels$publish <- 0
  appels$parquet <- 0
  appels$donnees_vues <- NULL
  appels$vintages_compute_vus <- NULL
  appels$payload_vu <- NULL
  appels$vintages_vus <- NULL

  faux_payload <- list(
    indicateurs = data.frame(x = 1),
    histoires = data.frame(y = 2),
    territoires = data.frame(territoire = "53", nom = "Bretagne")
  )
  faux_vintages <- tibble::tibble(
    id = c("serie_historique", "menages"),
    source = c("INSEE — Série historique du recensement", "INSEE — Ménages"),
    version = c("2023", "2023"),
    licence = c("lov2", "lov2"),
    date_reference = c("2023-01-01", "2023-01-01"),
    date_publication = c("2026-06-30", "2026-06-30")
  )

  local_mocked_bindings(
    download_sources = function(manifest, cache) {
      appels$download <- appels$download + 1
      invisible(manifest)
    },
    construire_donnees_brut = function(cache) {
      appels$construire <- appels$construire + 1
      load_fixture()
    },
    vintages_demographie = function() faux_vintages,
    compute_payload = function(data, vintages = NULL) {
      appels$donnees_vues <- data
      appels$vintages_compute_vus <- vintages
      faux_payload
    },
    publish = function(payload, cible) {
      appels$publish <- appels$publish + 1
      appels$payload_vu <- payload
      invisible(payload)
    },
    .package = "lusk"
  )
  local_mocked_bindings(
    write_parquet = function(x, file) {
      appels$parquet <- appels$parquet + 1
      appels$vintages_vus <- x
      invisible(NULL)
    },
    .package = "nanoparquet"
  )

  resultat <- run_pipeline()

  # chaque étape est appelée exactement une fois, dans l'ordre
  expect_equal(appels$download, 1)
  expect_equal(appels$construire, 1)
  expect_equal(appels$publish, 1)
  expect_equal(appels$parquet, 1)

  # la donnée du compute vient de construire_donnees_brut
  expect_s3_class(appels$donnees_vues, "tbl_df")

  # issue #9 : la table des vintages entière passe au compute — l'estampillage
  # est par indicateur (source de référence déclarée), plus de tampon de thème
  expect_identical(appels$vintages_compute_vus, faux_vintages)

  # publish reçoit le payload de compute ; les vintages partent en parquet
  expect_identical(appels$payload_vu, faux_payload)
  expect_equal(nrow(appels$vintages_vus), 2)

  # le retour est le payload
  expect_identical(resultat, faux_payload)
})
