# vintages_habitat -------------------------------------------------------------
# Les trois vintages du thème, honnêtes PAR SOURCE (issue #19, spec #12) :
#   - RP Logements : millésime annuel (les dates du manifeste) ;
#   - DVF : livraisons semestrielles (les dates de publication du manifeste) ;
#   - DPE : base roulante — pas de date de référence unique ; version et
#     date_publication = la date du pull, lue sur le mtime du cache .rds ;
#     sans pull (premier run, fixtures), l'horloge devient celle du RUN
#     (#408 — jamais une ligne publiée sans AUCUNE horloge).
# Chaque indicateur du payload est estampillé depuis le vintage de SA source de
# référence déclarée (le mécanisme partagé, issue #9 — assembler_indicateurs).

test_that("les vintages Habitat sont par source : RP annuel, DVF semestriel, DPE roulant", {
  v <- vintages_habitat()

  # RP Logements : le millésime annuel, ses deux dates du manifeste
  rp <- v[v$id == "logements", ]
  expect_equal(rp$version, "2023")
  expect_equal(rp$date_reference, "2023-01-01")
  expect_equal(rp$date_publication, "2026-06-30")

  # DVF : un millésime par année de la fenêtre, livraisons semestrielles
  dvf <- v[v$id %in% MANIFEST_HABITAT_DVF$id, ]
  expect_setequal(dvf$version, as.character(ANNEE_DVF))
  # chaque millésime a sa date de référence (fin d'année) et SA livraison
  expect_true(all(dvf$date_reference == paste0(dvf$version, "-12-31")))
  expect_true(all(dvf$date_publication == DATE_PUBLICATION_DVF))
  # la source de référence du prix est le millésime le plus récent de la fenêtre
  expect_equal(
    INDICATEURS_HABITAT$source_reference[INDICATEURS_HABITAT$key == "prix_m2"],
    paste0("dvf_", max(ANNEE_DVF), "_dep22")
  )

  # DPE : la base roulante — pas de date de référence unique ; sans pull,
  # l'horloge de publication est celle du RUN (#408 : au moins une horloge)
  dpe <- v[v$id %in% MANIFEST_HABITAT_DPE$id, ]
  expect_true(all(is.na(dpe$date_reference)))
  expect_true(all(dpe$version == as.character(Sys.Date())))
  expect_true(all(dpe$date_publication == as.character(Sys.Date())))
})

test_that("la date de pull des DPE est lue sur le mtime du cache, pas inventée", {
  cache <- tempfile("cache-dpe-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  # un pull « a eu lieu » : les .rds du cache existent, mtime fixé
  for (id in MANIFEST_HABITAT_DPE$id) {
    chemin <- file.path(cache, MANIFEST_HABITAT_DPE$fichier[
      MANIFEST_HABITAT_DPE$id == id])
    readr::write_rds(tibble::tibble(x = 1), chemin)
    Sys.setFileTime(chemin, as.POSIXct("2026-07-01 12:00:00", tz = "UTC"))
  }

  v <- vintages_habitat(cache = cache)

  dpe <- v[v$id %in% MANIFEST_HABITAT_DPE$id, ]
  # version ET date_publication = la date du pull (le jour, pas l'heure)
  expect_true(all(dpe$version == "2026-07-01"))
  expect_true(all(dpe$date_publication == "2026-07-01"))
  # la base roulante garde sa sémantique : pas de date de référence
  expect_true(all(is.na(dpe$date_reference)))
  # RP et DVF ne bougent pas : leurs dates restent celles du manifeste
  expect_equal(v$date_publication[v$id == "logements"], "2026-06-30")
  expect_equal(v$date_publication[v$id == "dvf_2025_dep22"], "2026-05-18")
})

test_that("chaque estampille du payload vient de la source de référence déclarée", {
  # le mécanisme partagé (issue #9) : la table INDICATEURS_HABITAT déclare la
  # source de référence de chaque clé ; les vintages sont différenciés par
  # source — chaque indicateur doit porter le vintage de SA référence.
  vintages <- vintages_habitat()
  # on différencie les dates de publication des trois familles (#408 : la DPE
  # aussi porte SON horloge — jamais une ligne sans aucune date)
  vintages$date_publication[vintages$id == "logements"] <- "2026-01-15"
  vintages$date_publication[vintages$id == "dvf_2025_dep22"] <- "2026-02-20"
  vintages$date_publication[vintages$id %in% MANIFEST_HABITAT_DPE$id] <- "2026-03-01"

  p <- compute_payload(load_fixture_habitat(), theme = theme_habitat(),
                       vintages = vintages)

  attendus <- tibble::tibble(
    key = c("mix_logements", "statut", "age_du_bati", "type", "prix_m2",
            "part_passoires", "distribution_dpe"),
    source = c(rep("INSEE — Logements (dossier complet)", 4),
               "Etalab — DVF géolocalisées",
               "ADEME — Observatoire DPE, logements existants",
               "ADEME — Observatoire DPE, logements existants"),
    publication = c("2026-01-15", "2026-01-15", "2026-01-15", "2026-01-15",
                    "2026-02-20", "2026-03-01", "2026-03-01")
  )
  for (i in seq_len(nrow(attendus))) {
    cle <- attendus$key[i]
    expect_equal(
      unique(p$indicateurs$vintage_source[p$indicateurs$key == cle]),
      attendus$source[i],
      info = cle
    )
    expect_equal(
      unique(p$indicateurs$vintage_date_publication[
        p$indicateurs$key == cle]),
      attendus$publication[i],
      info = cle
    )
  }
})
