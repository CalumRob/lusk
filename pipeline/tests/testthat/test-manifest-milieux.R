# test-manifest-milieux ---------------------------------------------------------
# Le manifeste du thème Milieux (issue #171) : la source CONSOENAF — le jeu
# Cerema « Consommation d'espaces naturels, agricoles et forestiers du 1er
# janvier 2011 au 1er janvier 2025 » (data.gouv.fr, Licence Ouverte 2.0, mises
# à jour annuelles, COG 2025) — plus la base des EPCI partagée (le référentiel
# commune -> EPCI -> département -> région que la table des territoires
# consomme ; le même id/URL que Démographie/Habitat — le cache idempotent évite
# le re-téléchargement). La discipline des fragments (issue #13) : une ligne
# par source, chaque source garde SON vintage, SA référence et SA publication —
# aucun alignement de date.

test_that("MANIFEST_MILIEUX : la source CONSOENAF et la base EPCI partagée, les 11 colonnes standard", {
  m <- MANIFEST_MILIEUX

  expect_s3_class(m, "tbl_df")
  expect_equal(nrow(m), 2L)
  expect_equal(nrow(m), length(unique(m$id)))
  expect_setequal(m$id, c("epci", "consoenaf"))

  expect_true(all(c("id", "source", "url", "fichier", "vintage",
                    "date_reference", "date_publication", "licence",
                    "note", "mode", "type") %in% names(m)))

  # les deux sources sont des fichiers téléchargeables en cron (des jeux
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

test_that("verifier_contrat_milieux : le manifeste réel passe son contrat", {
  expect_true(verifier_contrat_milieux(MANIFEST_MILIEUX))
})

test_that("verifier_contrat_milieux : un manifeste corrompu échoue bruyamment", {
  manquer <- function(manif, motif) {
    expect_error(verifier_contrat_milieux(manif), motif)
  }

  # une source manquante (le contrat exige les DEUX)
  manquer(MANIFEST_MILIEUX[MANIFEST_MILIEUX$id != "consoenaf", ], "DEUX")

  # un id dupliqué
  duplique <- dplyr::bind_rows(MANIFEST_MILIEUX, MANIFEST_MILIEUX[1, ])
  manquer(duplique, "dupliqu")

  # une licence hors contrat (les deux sources sont Licence Ouverte 2.0)
  defectueux <- MANIFEST_MILIEUX
  defectueux$licence[defectueux$id == "consoenaf"] <- "odbl"
  manquer(defectueux, "lov2")

  # une source qui n'est pas un fichier téléchargeable
  defectueux <- MANIFEST_MILIEUX
  defectueux$mode[defectueux$id == "consoenaf"] <- "manuel"
  manquer(defectueux, "cron")

  # le fichier CONSOENAF épinglé ne peut PAS être remplacé (le CSV est LA base)
  defectueux <- MANIFEST_MILIEUX
  defectueux$fichier[defectueux$id == "consoenaf"] <- "conso-com-metro.gpkg"
  manquer(defectueux, "conso-com.csv")

  # une date de publication antérieure à la référence (CONSOENAF)
  defectueux <- MANIFEST_MILIEUX
  defectueux$date_publication[defectueux$id == "consoenaf"] <- "2024-01-01"
  manquer(defectueux, "publication")
})
