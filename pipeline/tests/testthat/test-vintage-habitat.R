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
  # l'horloge de publication est celle du RUN (#408 : au moins une horloge).
  # Issue #1114 : la version est au format dérivé YYYY-MM, la date complète
  # reste dans date_publication (plus jamais un jour dans `version`).
  dpe <- v[v$id %in% MANIFEST_HABITAT_DPE$id, ]
  lock <- lire_lock()
  expect_true(all(is.na(dpe$date_reference)))
  # #1118/#1128 : l'horloge des DPE est l'acquisition ATTESTÉE par le lockfile,
  # pas la date courante de la suite (qui changeait le résultat d'un jour à
  # l'autre). La version est le mois de cette acquisition, au format YYYY-MM.
  expect_true(all(dpe$version ==
    vapply(dpe$id, function(id) lock[[id]]$vintage, character(1))))
  expect_true(all(dpe$date_publication ==
    vapply(dpe$id, function(id) lock[[id]]$acquired_at, character(1))))
})

test_that("la date de pull attestée des DPE vient du lockfile, pas du mtime du cache", {
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
  # #1103/#1128 : avec un lockfile qui atteste déjà les DPE, un cache sans
  # sidecar reprend l'acquisition verrouillée — le mtime du .rds ne pilote plus
  # la vintage publiée. Version YYYY-MM, horloge complète dans date_publication.
  lock <- lire_lock()
  expect_true(all(dpe$version ==
    vapply(dpe$id, function(id) lock[[id]]$vintage, character(1))))
  expect_true(all(dpe$date_publication ==
    vapply(dpe$id, function(id) lock[[id]]$acquired_at, character(1))))
  # la base roulante garde sa sémantique : pas de date de référence
  expect_true(all(is.na(dpe$date_reference)))
  # RP et DVF ne bougent pas : leurs dates restent celles du manifeste
  expect_equal(v$date_publication[v$id == "logements"], "2026-06-30")
  expect_equal(v$date_publication[v$id == "dvf_2025_dep22"], "2026-05-18")
})

# Une attestation DPE (sidecar OU enregistrement de lockfile) : la base roulante
# n'a PAS de date de référence (ADR-0009) — SON unique horloge de fraîcheur est
# la date d'acquisition attestée. Issue #1118 : #1117 l'avait effacée en
# appliquant aux DPE la règle ORT (« NA déclaré ⇒ pas de publication inventée »)
# alors que pour une base roulante l'acquisition EST la publication, pas une
# invention. Le contrat compute.R refuse un fait sans aucune horloge.
attester_dpe <- function(cache, acquired_at = "2026-11-18",
                         vintage = "2026-11", lock = NULL) {
  dir.create(file.path(cache, ".digests"), recursive = TRUE, showWarnings = FALSE)
  for (id in MANIFEST_HABITAT_DPE$id) {
    f <- MANIFEST_HABITAT_DPE$fichier[MANIFEST_HABITAT_DPE$id == id]
    cible <- file.path(cache, f)
    readr::write_rds(tibble::tibble(x = 1), cible)
    Sys.setFileTime(cible, as.POSIXct(paste0(acquired_at, "T12:00:00"), tz = "UTC"))
    ecrire_digest_cache(list(
      source_id = id, url = "https://example.invalid/dpe", sha256 = paste0("sha-", id),
      bytes = file.size(cible), fichier = f, mtime = as.numeric(file.mtime(cible)),
      acquired_at = acquired_at, vintage_basis = "telechargement",
      vintage = vintage, date_reference = NA_character_
    ), cache)
  }
  invisible(cache)
}

test_that("DPE : un sidecar valide publie la vintage dérivée (YYYY-MM + horloge d'acquisition)", {
  # Issue #1118 : dans un vrai run, le pull DPE écrit un sidecar par département.
  # La table publiée porte SA valeur dérivée — version au mois, date d'acquisition
  # complète en date_publication (sa seule horloge), référence NA.
  cache <- tempfile("cache-dpe-sidecar-")
  on.exit(unlink(cache, recursive = TRUE))
  attester_dpe(cache)

  v <- vintages_habitat(cache = cache)
  dpe <- v[v$id %in% MANIFEST_HABITAT_DPE$id, ]
  expect_true(all(dpe$version == "2026-11"))
  expect_true(all(dpe$date_publication == "2026-11-18"))
  expect_true(all(is.na(dpe$date_reference)))
  # RP et DVF (declaree) ne bougent pas
  expect_equal(v$version[v$id == "logements"], "2023")
})

test_that("DPE : un enregistrement de lockfile atteste aussi l'horloge d'acquisition (#1118)", {
  # L'autre canal d'attestation : le lockfile (sans sidecar). La branche
  # `lock_utilisable` de la projection doit publier la même horloge.
  cache <- tempfile("cache-dpe-lock-")
  dir.create(cache, recursive = TRUE)
  on.exit(unlink(cache, recursive = TRUE))
  verrou <- tempfile("lock-dpe-")
  on.exit(unlink(verrou), add = TRUE)
  ecrire_lock(lapply(MANIFEST_HABITAT_DPE$id, function(id) {
    list(source_id = id, sha256 = paste0("sha-", id),
         acquired_at = "2026-10-05", vintage_basis = "telechargement",
         vintage = "2026-10", date_reference = NA_character_)
  }), verrou)

  v <- vintages_depuis_manifest(MANIFEST_HABITAT_DPE, cache = cache,
                                lock = verrou, exiger_attestation = TRUE)
  expect_true(all(v$version == "2026-10"))
  expect_true(all(v$date_publication == "2026-10-05"))
  expect_true(all(is.na(v$date_reference)))
})

test_that("payload Habitat : un DPE attesté garde son horloge et le contrat passe (#1118)", {
  # Le chemin qui a cassé le run3 : le DPE attesté publiait ses deux horloges NA
  # et `verifier_horloges_vintage` refusait le payload (part_passoires). On
  # construit le payload avec la table de vintages attestée, exactement comme le
  # run le fait.
  cache <- tempfile("cache-dpe-payload-")
  on.exit(unlink(cache, recursive = TRUE))
  attester_dpe(cache)
  v <- vintages_habitat(cache = cache)

  p <- compute_payload_test(load_fixture_habitat(), theme = theme_habitat(),
                            vintages = v)
  dpe <- p$indicateurs[p$indicateurs$key %in% c("part_passoires", "distribution_dpe"), ]
  expect_true(nrow(dpe) > 0L)
  expect_true(all(!is.na(dpe$vintage_date_publication)))
  expect_true(all(dpe$vintage_date_publication == "2026-11-18"))
  expect_true(all(is.na(dpe$vintage_date_reference)))
  expect_true(all(dpe$vintage_version == "2026-11"))
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

  p <- compute_payload_test(load_fixture_habitat(), theme = theme_habitat(),
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
