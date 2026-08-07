# test-manifest-programmes ------------------------------------------------------
# Le manifeste du thème Programmes & financements (issue #175) : les CINQ
# sources officielles du payload `programmes` (ADR-0013) — les quatre jeux
# ANCT sur data.gouv.fr (ACV, PVD, CRTE, Territoires d'industrie) et le fichier
# DGALN/ANCT ORT, ressource XLSX UNIQUEMENT (la ressource CSV sert un
# sous-ensemble Lot-et-Garonne cassé). La discipline des fragments (issue #13) :
# une ligne par source, chaque source garde SON vintage, SA référence et SA
# publication — aucun alignement de date. La fraîcheur ORT est l'actualisation
# PAR LIGNE « Dernière actualisation » : la référence et la publication source
# sont NA (la métadonnée de page, mai 2025, est périmée d'environ 15 mois).

test_that("MANIFEST_PROGRAMMES : les cinq sources du thème, les 11 colonnes standard", {
  m <- MANIFEST_PROGRAMMES

  expect_s3_class(m, "tbl_df")
  expect_equal(nrow(m), 5L)
  expect_equal(nrow(m), length(unique(m$id)))
  expect_setequal(m$id,
                  c("acv", "pvd", "crte", "territoires_industrie", "ort"))

  expect_true(all(c("id", "source", "url", "fichier", "vintage",
                    "date_reference", "date_publication", "licence",
                    "note", "mode", "type") %in% names(m)))

  # les cinq sources sont des fichiers téléchargeables en cron (des jeux
  # officiels ouverts — jamais un portage à la main), Licence Ouverte 2.0
  expect_true(all(m$type == "fichier"))
  expect_true(all(m$mode == "cron"))
  expect_true(all(m$licence == "lov2"))

  # chaque source garde SON vintage : aucune colonne d'alignement de date
  expect_false(any(grepl("align", tolower(names(m)))))
})

test_that("MANIFEST_PROGRAMMES : les quatre jeux ANCT épinglés sur data.gouv.fr", {
  m <- MANIFEST_PROGRAMMES

  acv <- m[m$id == "acv", ]
  expect_equal(acv$fichier, "liste-acv-com2025-20250704.csv")
  expect_true(grepl("data.gouv.fr", acv$url))
  expect_equal(acv$vintage, "2025")
  expect_equal(acv$date_reference, "2025-01-01")   # le cadre COG 2025
  expect_equal(acv$date_publication, "2025-09-24") # la mise en ligne du fichier

  pvd <- m[m$id == "pvd", ]
  expect_equal(pvd$fichier, "liste-pvd-com2025-20260427.csv")
  expect_true(grepl("data.gouv.fr", pvd$url))
  expect_equal(pvd$date_publication, "2026-04-27")

  crte <- m[m$id == "crte", ]
  # LE fichier du périmètre (les EPCI signataires), jamais la liste des contrats
  # ni la liste des communes couvertes — les signataires y sont au grain EPCI
  expect_equal(crte$fichier, "liste-crte-grpt2025-20250717.csv")
  expect_true(grepl("data.gouv.fr", crte$url))
  expect_equal(crte$vintage, "2025")
  expect_equal(crte$date_reference, "2025-07-17") # les données du 17/07/2025

  ti <- m[m$id == "territoires_industrie", ]
  expect_true(grepl("caissedesdepots.fr", ti$url))
  expect_equal(ti$vintage, "2022")                # les territoires arrêtés fin 2022
  expect_equal(ti$date_reference, "2022-12-31")
})

test_that("MANIFEST_PROGRAMMES : la source ORT — la ressource XLSX uniquement", {
  ort <- MANIFEST_PROGRAMMES[MANIFEST_PROGRAMMES$id == "ort", ]

  # LA ressource XLSX du jeu data.gouv (id ec3eb2fc-…) ; la ressource CSV sert
  # un sous-ensemble Lot-et-Garonne cassé — le contrat refuse tout autre
  # fichier de cache
  expect_true(grepl("xlsx", ort$fichier))
  expect_true(grepl("grist.numerique.gouv.fr", ort$url))
  expect_equal(ort$vintage, "en continu")
  # la fraîcheur est PAR LIGNE (la colonne « Dernière actualisation ») — la
  # référence et la publication source sont NA : la métadonnée de page
  # (mai 2025) est périmée d'environ 15 mois et ne doit JAMAIS être citée
  expect_true(is.na(ort$date_reference))
  expect_true(is.na(ort$date_publication))
})

test_that("verifier_contrat_programmes : le manifeste réel passe son contrat", {
  expect_true(verifier_contrat_programmes(MANIFEST_PROGRAMMES))
})

test_that("verifier_contrat_programmes : un manifeste corrompu échoue bruyamment", {
  manquer <- function(manif, motif) {
    expect_error(verifier_contrat_programmes(manif), motif)
  }

  # une source manquante (le contrat exige les CINQ)
  manquer(MANIFEST_PROGRAMMES[MANIFEST_PROGRAMMES$id != "ort", ], "CINQ")

  # un id dupliqué
  duplique <- dplyr::bind_rows(MANIFEST_PROGRAMMES, MANIFEST_PROGRAMMES[1, ])
  manquer(duplique, "dupliqu")

  # la source ORT ne peut PAS être remplacée par la ressource CSV cassée
  defectueux <- MANIFEST_PROGRAMMES
  defectueux$fichier[defectueux$id == "ort"] <- "ort-subset-lot-garonne.csv"
  manquer(defectueux, "XLSX")

  # une licence hors contrat (toutes les sources sont Licence Ouverte)
  defectueux <- MANIFEST_PROGRAMMES
  defectueux$licence[defectueux$id == "acv"] <- "odbl"
  manquer(defectueux, "lov2")

  # une source qui n'est pas un fichier téléchargeable
  defectueux <- MANIFEST_PROGRAMMES
  defectueux$mode[defectueux$id == "pvd"] <- "manuel"
  manquer(defectueux, "cron")

  # une date de publication antérieure à la référence (ACV)
  defectueux <- MANIFEST_PROGRAMMES
  defectueux$date_publication[defectueux$id == "acv"] <- "2024-01-01"
  manquer(defectueux, "publication")

  # la source ORT ne doit JAMAIS recevoir une date inventée (le contrat exige
  # que SA fraîcheur reste par ligne — référence et publication NA)
  defectueux <- MANIFEST_PROGRAMMES
  defectueux$date_reference[defectueux$id == "ort"] <- "2025-05-14"
  manquer(defectueux, "PAR LIGNE")
})
