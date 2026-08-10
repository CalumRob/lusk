test_that("vintages_demographie : une ligne par source du manifeste", {
  v <- vintages_demographie()

  expect_equal(nrow(v), nrow(MANIFEST_DEMOGRAPHIE))
  expect_named(v, c("id", "source", "version", "licence",
                    "date_reference", "date_publication"))
  expect_true(all(v$licence == "lov2"))
  expect_setequal(v$version, c("2023", "2025"))
  expect_true(all(!is.na(v$date_reference)))
})

test_that("les vintages portent les deux dates : référence et publication (point 5)", {
  v <- vintages_demographie()

  # date_reference : la date de la donnée (« RP 2023 » = au 1er janvier 2023)
  expect_equal(v$date_reference[v$id == "serie_historique"], "2023-01-01")
  expect_equal(v$date_reference[v$id == "epci"], "2025-01-01")

  # date_publication : la mise en ligne réelle — vérifiée sur data.gouv
  # (created_at des ressources 2023 = 2026-06-30). La base des EPCI vit sur
  # insee.fr, qui n'expose pas de date de fichier : NA, à compléter par le
  # watchdog.
  expect_equal(v$date_publication[v$id == "serie_historique"], "2026-06-30")
  expect_equal(v$date_publication[v$id == "menages"], "2026-06-30")
  expect_equal(v$date_publication[v$id == "age_detail"], "2026-06-30")
  expect_true(is.na(v$date_publication[v$id == "epci"]))
})

test_that("la table des vintages est le seam du watchdog (ADR-0001)", {
  v <- vintages_demographie()
  # ADR-0001 : la licence est déclarée par composant — chaque source la porte
  expect_true(all(v$licence == "lov2"))
  # une source par jeu de données, jamais de doublon
  expect_equal(nrow(v), length(unique(v$id)))
})

test_that("fusionner_vintages : sans table sur disque, les vintages du thème passent tels quels", {
  cible <- tempfile("vintages-vides-")
  dir.create(cible, recursive = TRUE)
  on.exit(unlink(cible, recursive = TRUE))

  v <- vintages_economie()
  fusionnees <- fusionner_vintages(v, sortie = cible)
  expect_identical(fusionnees, v)
  expect_false(file.exists(file.path(cible, "vintages.parquet")))
})

test_that("fusionner_vintages : l'union des tables — la dédupe par id est un upsert", {
  cible <- tempfile("vintages-union-")
  dir.create(cible, recursive = TRUE)
  on.exit(unlink(cible, recursive = TRUE))

  # un run Démographie a écrit sa table partagée (les 4 sources)
  nanoparquet::write_parquet(vintages_demographie(),
                             file.path(cible, "vintages.parquet"))

  # un run Économie fusionne SES sources dedans — l'union des deux thèmes
  fusionnees <- fusionner_vintages(vintages_economie(), sortie = cible)
  expect_equal(nrow(fusionnees), nrow(MANIFEST_DEMOGRAPHIE) + nrow(MANIFEST_ECONOMIE))
  expect_setequal(fusionnees$id, c(MANIFEST_DEMOGRAPHIE$id, MANIFEST_ECONOMIE$id))
  # serie_historique et epci (les sources citées par le Story Démographie) sont
  # TOUJOURS présentes après un run d'un autre thème
  expect_true(all(c("serie_historique", "epci") %in% fusionnees$id))

  # une source en commun (la base EPCI, partagée entre Démographie et Habitat)
  # : la ligne du run le plus frais gagne, jamais de doublon
  nanoparquet::write_parquet(fusionnees, file.path(cible, "vintages.parquet"))
  fusionnees2 <- fusionner_vintages(vintages_habitat(), sortie = cible)
  expect_equal(nrow(fusionnees2),
               nrow(MANIFEST_DEMOGRAPHIE) + nrow(MANIFEST_ECONOMIE) +
                 nrow(MANIFEST_HABITAT) - 1L)
  expect_equal(anyDuplicated(fusionnees2$id), 0L)
  expect_equal(nrow(dplyr::filter(fusionnees2, id == "epci")), 1L)
})

test_that("fusionner_vintages : les ids RETIRÉS du manifeste du thème disparaissent de la table partagée (l'amendement #243 a sorti le DIFF)", {
  cible <- tempfile("vintages-retires-")
  dir.create(cible, recursive = TRUE)
  on.exit(unlink(cible, recursive = TRUE))

  # la table partagée sur disque porte encore les QUATRE ids différentiels de
  # l'ancien manifeste Milieux (le run #253 les avait publiés) — plus une
  # source d'un autre thème qui ne doit PAS tomber
  ancienne <- dplyr::bind_rows(
    vintages_demographie(),
    tibble::tibble(
      id = c("ocsge_artificialisation_22", "ocsge_artificialisation_29",
             "ocsge_artificialisation_35", "ocsge_artificialisation_56"),
      source = "IGN — OCS GE Artificialisation v2.0 (différentiel)",
      version = "2025", licence = "lov2",
      date_reference = "2025-01-01", date_publication = "2026-07-03"
    )
  )
  nanoparquet::write_parquet(ancienne, file.path(cible, "vintages.parquet"))

  # le run Milieux amendé déclare les ids retirés : les différentielles
  # quittent la table partagée, les sources des autres thèmes restent
  fusionnees <- fusionner_vintages(vintages_milieux(), sortie = cible,
                                   retires = theme_milieux()$retire_vintages)
  expect_false(any(fusionnees$id %in%
                     c("ocsge_artificialisation_22", "ocsge_artificialisation_29",
                       "ocsge_artificialisation_35", "ocsge_artificialisation_56")))
  expect_true(all(MANIFEST_DEMOGRAPHIE$id %in% fusionnees$id))
  expect_true(all(MANIFEST_MILIEUX$id %in% fusionnees$id))
  expect_equal(anyDuplicated(fusionnees$id), 0L)
})

test_that("l'estampille vient de la source de référence, pas du dénominateur", {
  # des vintages différenciés par source : si l'estampille suivait un tampon de
  # thème (ou le dénominateur partagé), elle serait uniforme — ici chaque
  # indicateur doit porter le vintage de SA source de référence.
  vintages <- tibble::tibble(
    id = c("serie_historique", "menages", "age_detail"),
    source = c("Série historique", "Ménages", "PRINC détail"),
    version = c("2023", "2023", "2023"),
    licence = c("lov2", "lov2", "lov2"),
    date_reference = c("2023-01-01", "2023-01-01", "2023-01-01"),
    date_publication = c("2026-06-30", "2026-07-01", "2026-06-25")
  )

  p <- compute_payload(load_fixture(), vintages = vintages)

  # densite et evolution_1968 : la série historique (POP/SUP/BRTH/DEATH)
  for (cle in c("densite", "evolution_1968")) {
    src <- unique(p$indicateurs$vintage_source[p$indicateurs$key == cle])
    pub <- unique(p$indicateurs$vintage_date_publication[
      p$indicateurs$key == cle
    ])
    expect_equal(src, "Série historique", info = cle)
    expect_equal(pub, "2026-06-30", info = cle)
  }

  # taille_menages : la source ménages (DWELLINGS), pas la série historique
  expect_equal(
    unique(p$indicateurs$vintage_source[p$indicateurs$key == "taille_menages"]),
    "Ménages"
  )
  expect_equal(
    unique(p$indicateurs$vintage_date_publication[
      p$indicateurs$key == "taille_menages"
    ]),
    "2026-07-01"
  )

  # structure_age : l'estampille vient de sa source de référence (PRINC/age_detail,
  # le composant signature — les tranches), PAS du dénominateur partagé
  # (la population, série historique). Si elle suivait le dénominateur, la date
  # de publication serait "2026-06-30".
  expect_equal(
    unique(p$indicateurs$vintage_source[p$indicateurs$key == "structure_age"]),
    "PRINC détail"
  )
  expect_equal(
    unique(p$indicateurs$vintage_date_publication[
      p$indicateurs$key == "structure_age"
    ]),
    "2026-06-25"
  )
})
