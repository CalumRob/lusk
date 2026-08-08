# test-manifest-milieux ---------------------------------------------------------
# Le manifeste du thème Milieux (issue #171, étendu par #234) : la source
# CONSOENAF — le jeu Cerema « Consommation d'espaces naturels, agricoles et
# forestiers du 1er janvier 2011 au 1er janvier 2025 » (data.gouv.fr, Licence
# Ouverte 2.0, mises à jour annuelles, COG 2025) — plus la base des EPCI
# partagée (le référentiel commune -> EPCI -> département -> région que la
# table des territoires consomme ; le même id/URL que Démographie/Habitat — le
# cache idempotent évite le re-téléchargement), la série historique du
# recensement (la source partagée de la population, #174) et les QUATRE
# couches OCS-GE d'artificialisation (issue #234, spec #225) — une par
# département breton, Licence Ouverte 2.0, chacune avec SA paire de millésimes
# M2→M3 (22 : 2021→2025 · 29 : 2021→2024 · 35 : 2020→2023 · 56 : 2022→2024,
# docs/research/ocs-ge.md §2.3) et SA publication. La discipline des fragments
# (issue #13) : une ligne par source, chaque source garde SON vintage, SA
# référence et SA publication — aucun alignement de date.

test_that("MANIFEST_MILIEUX : les SEPT sources, les 11 colonnes standard", {
  m <- MANIFEST_MILIEUX

  expect_s3_class(m, "tbl_df")
  expect_equal(nrow(m), 7L)
  expect_equal(nrow(m), length(unique(m$id)))
  expect_setequal(m$id, c("epci", "consoenaf", "serie_historique",
                          "ocsge_artificialisation_22",
                          "ocsge_artificialisation_29",
                          "ocsge_artificialisation_35",
                          "ocsge_artificialisation_56"))

  expect_true(all(c("id", "source", "url", "fichier", "vintage",
                    "date_reference", "date_publication", "licence",
                    "note", "mode", "type") %in% names(m)))

  # les sept sources sont des fichiers téléchargeables en cron (des jeux
  # officiels ouverts — jamais un portage à la main), Licence Ouverte 2.0
  expect_true(all(m$type == "fichier"))
  expect_true(all(m$mode == "cron"))
  expect_true(all(m$licence == "lov2"))

  # chaque source garde SON vintage : aucune colonne d'alignement de date
  expect_false(any(grepl("align", tolower(names(m)))))
})

test_that("MANIFEST_MILIEUX : la source CONSOENAF épinglée — la ressource CSV conso_com.csv du jeu data.gouv", {
  conso <- MANIFEST_MILIEUX[MANIFEST_MILIEUX$id == "consoenaf", ]

  # LA ressource : le CSV conso_com.csv du jeu data.gouv (id
  # b258feec-f8ff-4e0a-93b3-baf1fe46ef66, mise en ligne du 24/07/2026) — jamais
  # le classeur, jamais les gpkg géométriques (conso_com_*.gpkg)
  expect_equal(conso$fichier, "conso-com.csv")
  expect_true(grepl("static.data.gouv.fr/resources/", conso$url))
  expect_true(grepl("20260724-142909/conso-com.csv", conso$url))
  expect_equal(conso$vintage, "2025")
  expect_equal(conso$date_reference, "2025-01-01")   # la fenêtre 2011-2025 (au 1er janvier 2025)
  expect_equal(conso$date_publication, "2026-07-24") # la mise en ligne après le recalcul

  # la source EPCI partagée garde SA forme (la référence, la publication NA)
  epci <- MANIFEST_MILIEUX[MANIFEST_MILIEUX$id == "epci", ]
  expect_equal(epci$fichier, "epci_au_01-01-2025.zip")
  expect_equal(epci$vintage, "2025")
  expect_equal(epci$date_reference, "2025-01-01")
  expect_true(is.na(epci$date_publication))
})

test_that("MANIFEST_MILIEUX : la note CONSOENAF documente licence, vintage annuel, recalcul 24/07/2026 et l'anomalie m²/ha", {
  note <- MANIFEST_MILIEUX$note[MANIFEST_MILIEUX$id == "consoenaf"]

  expect_true(grepl("Licence Ouverte", note))
  expect_true(grepl("annuel", note, ignore.case = TRUE))
  # le recalcul des ratios annoncé par le jeu (la description data.gouv du
  # 24/07/2026) — capturé dans la note, jamais silencieusement ignoré
  expect_true(grepl("24/07/2026", note))
  expect_true(grepl("recalcul", note))
  # l'anomalie d'unité : le dictionnaire dit hectares, le fichier distribue
  # des m² (vérifié via artcom1125, docs/research/zan-rennes.md)
  expect_true(grepl("m²", note))
  expect_true(grepl("hectare", note))
})

test_that("MANIFEST_MILIEUX : la série historique du recensement est la source partagée de Démographie", {
  serie <- MANIFEST_MILIEUX[MANIFEST_MILIEUX$id == "serie_historique", ]

  # le MÊME id/URL/fichier que Démographie (theme_demographie.R) — le cache
  # idempotent évite le re-téléchargement ; la règle de source d'ADR-0014
  dem <- MANIFEST_DEMOGRAPHIE[MANIFEST_DEMOGRAPHIE$id == "serie_historique", ]
  expect_equal(serie$url, dem$url)
  expect_equal(serie$fichier, "DS_RP_SERIE_HISTORIQUE_2023_CSV_FR.zip")
  expect_equal(serie$vintage, "2023")
  expect_equal(serie$date_reference, "2023-01-01")
  expect_equal(serie$date_publication, "2026-06-30")

  # la note documente la règle de source (jamais les populations embarquées de
  # CONSOENAF) et la règle des deux horloges (la fenêtre dérivée, jamais codée
  # en dur)
  expect_true(grepl("série historique", serie$note, ignore.case = TRUE))
  expect_true(grepl("jamais des champs embarqués", serie$note,
                    ignore.case = TRUE))
})

test_that("MANIFEST_MILIEUX : les quatre couches OCS-GE — une par département, la paire de millésimes de la spec, Licence Ouverte 2.0", {
  ids <- paste0("ocsge_artificialisation_", c("22", "29", "35", "56"))
  for (id in ids) {
    ligne <- MANIFEST_MILIEUX[MANIFEST_MILIEUX$id == id, ]
    expect_equal(nrow(ligne), 1L, info = id)
    expect_true(grepl("OCS GE Artificialisation", ligne$source), info = id)
    expect_true(grepl("data.geopf.fr/telechargement/download/OCSGE-ARTIFICIALISATION/",
                      ligne$url), info = id)
    expect_equal(ligne$licence, "lov2", info = id)
    expect_equal(ligne$mode, "cron", info = id)
    expect_equal(ligne$type, "fichier", info = id)
    expect_true(grepl("[.]7z$", ligne$fichier), info = id)
    expect_false(is.na(ligne$date_reference), info = id)
    expect_false(is.na(ligne$date_publication), info = id)
  }

  # les paires de millésimes de la spec (#225) — PINNÉES dans le nom de fichier
  # et dans les dates du vintage (la référence = le millésime final, la fin de
  # la fenêtre — la convention de CONSOENAF)
  spec <- tibble::tribble(
    ~dep, ~m2, ~m3, ~date_publication,
    "22", "2021", "2025", "2026-07-03",
    "29", "2021", "2024", "2026-06-12",
    "35", "2020", "2023", "2026-03-03",
    "56", "2022", "2024", "2026-06-08"
  )
  for (i in seq_len(nrow(spec))) {
    dep <- spec$dep[i]
    ligne <- MANIFEST_MILIEUX[
      MANIFEST_MILIEUX$id == paste0("ocsge_artificialisation_", dep), ]
    motif <- paste0("_DIFF-", spec$m2[i], "-", spec$m3[i],
                    "_GPKG_LAMB93_D0", dep, "_", spec$date_publication[i], "[.]7z$")
    expect_true(grepl(motif, ligne$fichier), info = dep)
    expect_equal(ligne$vintage, spec$m3[i], info = dep)
    expect_equal(ligne$date_reference, paste0(spec$m3[i], "-01-01"), info = dep)
    expect_equal(ligne$date_publication, spec$date_publication[i], info = dep)
  }
})

test_that("MANIFEST_MILIEUX : la note OCS-GE documente licence, couche différentielle, seuils du décret et livraison .7z", {
  note <- MANIFEST_MILIEUX$note[
    MANIFEST_MILIEUX$id == "ocsge_artificialisation_22"]
  expect_true(grepl("Licence Ouverte", note))
  expect_true(grepl("différentiel", note, ignore.case = TRUE))
  expect_true(grepl("artif", note))
  expect_true(grepl("surface", note))
  # la mesure de l'État lue, jamais re-dérivée (les couches brutes ne sont pas
  # superposées) + les seuils réglementaires déjà appliqués par l'IGN
  expect_true(grepl("jamais re-dérivée", note))
  expect_true(grepl("2023-1096", note))
  # la livraison .7z et l'étape d'extraction documentée
  expect_true(grepl("7z", note))
  expect_true(grepl("extraire_gpkg_ocsge", note))
})

test_that("verifier_contrat_milieux : le manifeste réel passe son contrat", {
  expect_true(verifier_contrat_milieux(MANIFEST_MILIEUX))
})

test_that("verifier_contrat_milieux : un manifeste corrompu échoue bruyamment", {
  manquer <- function(manif, motif) {
    expect_error(verifier_contrat_milieux(manif), motif)
  }

  # une source manquante (le contrat exige les SEPT)
  manquer(MANIFEST_MILIEUX[MANIFEST_MILIEUX$id != "consoenaf", ], "SEPT")

  # un id dupliqué
  duplique <- dplyr::bind_rows(MANIFEST_MILIEUX, MANIFEST_MILIEUX[1, ])
  manquer(duplique, "dupliqu")

  # une licence hors contrat (les sources sont Licence Ouverte 2.0)
  defectueux <- MANIFEST_MILIEUX
  defectueux$licence[defectueux$id == "consoenaf"] <- "odbl"
  manquer(defectueux, "lov2")
  defectueux <- MANIFEST_MILIEUX
  defectueux$licence[defectueux$id == "ocsge_artificialisation_22"] <- "odbl"
  manquer(defectueux, "lov2")

  # une source qui n'est pas un fichier téléchargeable
  defectueux <- MANIFEST_MILIEUX
  defectueux$mode[defectueux$id == "consoenaf"] <- "manuel"
  manquer(defectueux, "cron")

  # le fichier CONSOENAF épinglé ne peut PAS être remplacé (le CSV est LA base)
  defectueux <- MANIFEST_MILIEUX
  defectueux$fichier[defectueux$id == "consoenaf"] <- "conso-com-metro.gpkg"
  manquer(defectueux, "conso-com.csv")

  # le fichier OCS-GE épinglé ne peut PAS dériver : une paire de millésimes
  # changée dans le nom est un signal de fichier déplacé, pas un détail
  defectueux <- MANIFEST_MILIEUX
  defectueux$fichier[defectueux$id == "ocsge_artificialisation_22"] <-
    "OCS-GE-ARTIFICIALISATION_2-0_DIFF-2020-2025_GPKG_LAMB93_D022_2026-07-03.7z"
  manquer(defectueux, "2021-2025")

  # une date de publication antérieure à la référence (CONSOENAF ET OCS-GE —
  # la vérification est généralisée à toute source datée)
  defectueux <- MANIFEST_MILIEUX
  defectueux$date_publication[defectueux$id == "consoenaf"] <- "2024-01-01"
  manquer(defectueux, "publication")
  defectueux <- MANIFEST_MILIEUX
  defectueux$date_publication[defectueux$id == "ocsge_artificialisation_29"] <-
    "2020-01-01"
  manquer(defectueux, "publication")
})
