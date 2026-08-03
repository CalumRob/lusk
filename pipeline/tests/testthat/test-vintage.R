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
