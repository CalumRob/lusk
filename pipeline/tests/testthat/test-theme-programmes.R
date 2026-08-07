# test-theme-programmes ----------------------------------------------------------
# Le thème Programmes & financements (issue #175, ADR-0013) : l'ingestion des
# cinq sources officielles (les jeux ANCT data.gouv ACV/PVD/CRTE/Territoires
# d'industrie + le fichier DGALN/ANCT ORT, ressource XLSX uniquement) et le
# calcul des LIGNES D'ADHÉSION du payload `programmes` — une ligne par
# (territoire × programme) au niveau d'ancrage du programme : ACV/PVD à la
# COMMUNE (les listes lauréates), CRTE/TI à l'EPCI (l'intercommunalité
# signataire), ORT à la commune ET à l'EPCI (les périmètres des conventions
# signées).
#
# Les règles de badge (CONTEXT.md §ORT, verrouillées ici) :
#   - les lignes ORT n'existent que pour les conventions au statut « Signée » —
#     « Non signée » et « Terminée » ne produisent AUCUNE ligne ;
#   - une commune labellisée ACV/PVD ne reçoit JAMAIS de seconde ligne ORT :
#     sa ligne de label porte le drapeau « convention valant ORT », jamais un
#     double badge ;
#   - au niveau EPCI, le badge ORT n'existe que là où l'ORT n'est pas déjà
#     porté par un label ACV/PVD (user story #162-9) : un EPCI dont l'ORT est
#     entièrement porté par les labels de ses communes membres n'a pas de ligne
#     ORT.
#   - chaque ligne porte le vintage de SA source (mise à jour du jeu ANCT ;
#     ORT : l'actualisation PAR LIGNE « Dernière actualisation », jamais la
#     métadonnée de page, périmée d'environ 15 mois).
#
# Le seam de test (la couture établie) : les lecteurs lisent les FIXTURES
# (petits échantillons CSV/XLSX fidèles aux sources réelles, dans fixtures/),
# le calcul reçoit les tables normalisées en mémoire — comportement EXTERNE
# uniquement, aucun détail d'implémentation.

# Le référentiel EPCI du fixture (la forme de lire_epci : CODGEO/LIBGEO/EPCI/
# LIBEPCI/DEP/REG) : 7 communes, 2 EPCIs, 2 départements.
base_epci_programmes <- function() {
  tibble::tribble(
    ~CODGEO, ~LIBGEO, ~EPCI, ~LIBEPCI, ~DEP, ~REG,
    "22001", "Commune A1", "200000001", "EPCI X", "22", "53",
    "22002", "Commune D", "200000001", "EPCI X", "22", "53",
    "22003", "Commune E", "200000001", "EPCI X", "22", "53",
    "22004", "Commune G", "200000001", "EPCI X", "22", "53",
    "29001", "Commune B", "200000002", "EPCI Y", "29", "53",
    "29002", "Commune C", "200000002", "EPCI Y", "29", "53",
    "29003", "Commune F", "200000002", "EPCI Y", "29", "53"
  )
}

# donnees_programmes_fixture -----------------------------------------------------
# Les tables normalisées du fixture — la forme que construire_donnees_programmes
# assemble : ACV/PVD (code_commune, nom_commune, id), CRTE (id_crte, lib_crte,
# type_grp_crte, nature_juridique, siren_epci — UNE ligne par groupement, la
# ligne COM est une commune signataire individuelle, jamais un EPCI), TI
# (id_ti, lib_ti, siren_epci, nom_epci), ORT (code_commune, statut,
# actualisation). Le statut ORT du fixture :
#   - 22001 (ACV)   « Signée »     → drapeau sur la ligne ACV
#   - 29002 (ACV)   « Signée »     → drapeau sur la ligne ACV
#   - 22002 (PVD)   « Terminée »   → PAS de ligne ORT, pas de drapeau
#   - 29001 (PVD)   « Non signée » → PAS de ligne ORT, pas de drapeau
#   - 22003 (autre) « Signée »     → ligne ORT commune + ligne ORT EPCI X
#   - 22004 (autre) « Signée »     → ligne ORT commune + ligne ORT EPCI X
#   - 29003 (autre) « Terminée »   → AUCUNE ligne ORT (Signée seulement)
donnees_programmes_fixture <- function() {
  list(
    acv = tibble::tribble(
      ~code_commune, ~nom_commune, ~id_acv,
      "22001", "Commune A1", "ACV001",
      "29002", "Commune C", "ACV002"
    ),
    pvd = tibble::tribble(
      ~code_commune, ~nom_commune, ~id_pvd,
      "22002", "Commune D", "pvd-53-22-1",
      "29001", "Commune B", "pvd-53-29-1"
    ),
    crte = tibble::tribble(
      ~id_crte, ~lib_crte, ~type_grp_crte, ~nature_juridique, ~siren_epci,
      "crte-53-22-1", "CRTE EPCI X", "mono", "CC", "200000001",
      "crte-53-29-1", "CRTE EPCI Y", "mono", "CA", "200000002",
      "crte-53-29-2", "CRTE pluri des deux", "pluri", "CC", "200000001",
      "crte-53-29-2", "CRTE pluri des deux", "pluri", "CA", "200000002",
      "crte-53-29-3", "CRTE à communes seules", "pluri", "COM", "22001"
    ),
    territoires_industrie = tibble::tribble(
      ~id_ti, ~lib_ti, ~siren_epci, ~nom_epci,
      "ti-5301", "Territoire Industriel A", "200000001", "EPCI X",
      "ti-5302", "Territoire Industriel B", "200000002", "EPCI Y"
    ),
    ort = tibble::tribble(
      ~code_commune, ~statut, ~actualisation,
      "22001", "Signée", "2026-02-01",
      "22002", "Terminée", "2026-01-15",
      "29001", "Non signée", "2026-03-01",
      "29002", "Signée", "2026-02-10",
      "22003", "Signée", "2026-02-20",
      "29003", "Terminée", "2025-12-01",
      "22004", "Signée", "2026-04-01"
    )
  )
}

# Les vintages du fixture — la projection du manifeste (vintages_programmes) :
# une ligne par source, l'id du manifeste comme clé.
vintages_programmes_fixture <- function() {
  tibble::tribble(
    ~id, ~source, ~version, ~licence, ~date_reference, ~date_publication,
    "acv", "ANCT — ACV", "2025", "lov2", "2025-01-01", "2025-09-24",
    "pvd", "ANCT — PVD", "2025", "lov2", "2025-01-01", "2026-04-27",
    "crte", "ANCT — CRTE", "2025", "lov2", "2025-07-17", "2025-09-24",
    "territoires_industrie", "CDC/ANCT — TI", "2022", "lov2", "2022-12-31", "2025-09-30",
    "ort", "DGALN/ANCT — ORT", "en continu", "lov2", NA, NA
  )
}

# 1. Les lecteurs de sources (le seam d'entrée : les fichiers de cache) --------

test_that("lire_acv : la liste lauréate ACV, filtrée Bretagne", {
  acv <- lire_acv(testthat::test_path("fixtures", "programmes-acv-fixture.csv"))

  # les deux communes ACV du fixture, dans l'ordre de la source, la forme
  # normalisée du contrat (code, nom, id du programme)
  expect_equal(nrow(acv), 2L)
  expect_named(acv, c("code_commune", "nom_commune", "id_acv"))
  expect_equal(acv$code_commune, c("22001", "29002"))
  expect_equal(acv$nom_commune, c("Commune A1", "Commune C"))
  expect_equal(acv$id_acv, c("ACV001", "ACV002"))
})

test_that("lire_pvd : la liste lauréate PVD, filtrée Bretagne", {
  pvd <- lire_pvd(testthat::test_path("fixtures", "programmes-pvd-fixture.csv"))

  expect_equal(nrow(pvd), 2L)
  expect_named(pvd, c("code_commune", "nom_commune", "id_pvd"))
  expect_setequal(pvd$code_commune, c("22002", "29001"))
})

test_that("lire_crte : le suivi du périmètre CRTE, filtré Bretagne (insee_reg 53)", {
  crte <- lire_crte(testthat::test_path("fixtures", "programmes-crte-fixture.csv"))

  # la ligne non-bretonne (crte-84-01-1) est écartée par le filtre régional ;
  # la ligne COM (crte-53-29-3 — une commune signataire individuelle) reste
  # LUE par le lecteur : le choix « EPCI seulement » vit au calcul, pas ici
  expect_equal(nrow(crte), 5L)
  expect_named(crte, c("id_crte", "lib_crte", "type_grp_crte",
                       "nature_juridique", "siren_epci"))
  expect_false(any(crte$id_crte == "crte-84-01-1"))
  expect_equal(crte$siren_epci[crte$id_crte == "crte-53-29-2"],
               c("200000001", "200000002"))
  expect_equal(crte$nature_juridique[crte$id_crte == "crte-53-29-3"], "COM")
  expect_type(crte$siren_epci, "character")
})

test_that("lire_ti : la liste Territoires d'industrie (CSV ';'), filtrée Bretagne", {
  ti <- lire_ti(testthat::test_path("fixtures", "programmes-ti-fixture.csv"))

  # le fichier réel est délimité par ';' avec une colonne géométrie énorme —
  # le lecteur ne retient que l'identité (id, libellé, EPCI), jamais la
  # géométrie. UNE ligne par (territoire × commune) — le dédoublonnage au
  # grain EPCI se fait au calcul, pas à la lecture. La ligne non-bretonne
  # (ti-8401) est écartée par le filtre régional.
  expect_equal(nrow(ti), 4L)
  expect_named(ti, c("id_ti", "lib_ti", "siren_epci", "nom_epci"))
  expect_false(any(ti$id_ti == "ti-8401"))
  expect_setequal(unique(ti$siren_epci), c("200000001", "200000002"))
  expect_type(ti$siren_epci, "character")
})

test_that("lire_ort : le fichier ORT (XLSX, ressource uniquement), filtré Bretagne", {
  ort <- lire_ort(testthat::test_path("fixtures", "programmes-ort-fixture.xlsx"))

  # les 7 conventions du fixture (région Bretagne) ; la forme normalisée du
  # contrat : le code commune en caractères (zéro de tête préservé), le statut,
  # l'actualisation PAR LIGNE en date ISO (la fraîcheur de la source — jamais
  # la métadonnée de page, périmée d'environ 15 mois)
  expect_equal(nrow(ort), 7L)
  expect_named(ort, c("code_commune", "statut", "actualisation"))
  expect_true(all(nchar(ort$code_commune) == 5L))
  expect_equal(ort$statut[ort$code_commune == "22003"], "Signée")
  expect_equal(ort$actualisation[ort$code_commune == "22004"], "2026-04-01")
  expect_equal(ort$actualisation[ort$code_commune == "29003"], "2025-12-01")
})

test_that("construire_donnees_programmes : assemble les cinq sources par leur id de manifeste", {
  appels <- new.env()
  local_mocked_bindings(
    lire_acv = function(chemin) { appels$acv <- chemin; tibble::tibble(code_commune = "22001") },
    lire_pvd = function(chemin) { appels$pvd <- chemin; tibble::tibble(code_commune = "22002") },
    lire_crte = function(chemin) { appels$crte <- chemin; tibble::tibble(id_crte = "crte-53-22-1") },
    lire_ti = function(chemin) { appels$ti <- chemin; tibble::tibble(id_ti = "ti-5301") },
    lire_ort = function(chemin) { appels$ort <- chemin; tibble::tibble(code_commune = "22003") },
    .package = "lusk"
  )

  donnees <- construire_donnees_programmes(cache = "cache-test")

  expect_named(donnees,
               c("acv", "pvd", "crte", "territoires_industrie", "ort"))
  # chaque lecteur reçoit le chemin de SON fichier dans le cache (par son id)
  expect_equal(appels$acv,
               file.path("cache-test", MANIFEST_PROGRAMMES$fichier[
                 MANIFEST_PROGRAMMES$id == "acv"]))
  expect_equal(appels$ort,
               file.path("cache-test", MANIFEST_PROGRAMMES$fichier[
                 MANIFEST_PROGRAMMES$id == "ort"]))
  expect_equal(appels$ti,
               file.path("cache-test", MANIFEST_PROGRAMMES$fichier[
                 MANIFEST_PROGRAMMES$id == "territoires_industrie"]))
})

test_that("construire_donnees_programmes : une source absente du cache s'arrête bruyamment", {
  local_mocked_bindings(
    lire_acv = function(chemin) tibble::tibble(code_commune = "22001"),
    lire_pvd = function(chemin) stop("Fichier absent : ", chemin, call. = FALSE),
    .package = "lusk"
  )
  expect_error(
    construire_donnees_programmes(cache = "cache-test"),
    "liste-pvd"
  )
})

# 2. Le calcul des lignes d'adhésion (construire_membres_programmes) -----------

test_that("construire_membres_programmes : ACV/PVD à la commune, CRTE/TI à l'EPCI, ORT commune + EPCI", {
  membres <- construire_membres_programmes(
    donnees_programmes_fixture(), base_epci_programmes(), vintages_programmes_fixture()
  )

  # la forme du contrat : une ligne par (territoire × programme) au niveau
  # d'ancrage, le drapeau « convention valant ORT », les estampilles vintage
  expect_named(membres, c("territoire", "type", "sigle", "convention_valant_ort",
                          "vintage_source", "vintage_version",
                          "vintage_date_reference", "vintage_date_publication"))

  lire <- function(sigle) membres[membres$sigle == sigle, ]

  # ACV/PVD : une ligne par commune labellisée (2 + 2)
  acv <- lire("ACV")
  expect_equal(nrow(acv), 2L)
  expect_true(all(acv$type == "commune"))
  expect_setequal(acv$territoire, c("22001", "29002"))
  pvd <- lire("PVD")
  expect_equal(nrow(pvd), 2L)
  expect_true(all(pvd$type == "commune"))
  expect_setequal(pvd$territoire, c("22002", "29001"))

  # CRTE/TI : une ligne par EPCI signataire (les paires id_crte × EPCI du
  # fixture ; le CRTE pluri porte SES DEUX EPCIs). La ligne COM du fixture
  # (crte-53-29-3 — une commune signataire individuelle) ne produit AUCUNE
  # ligne : son SIREN est celui de la commune, jamais l'EPCI.
  crte <- lire("CRTE")
  expect_equal(nrow(crte), 4L)
  expect_true(all(crte$type == "epci"))
  expect_equal(sort(crte$territoire), rep(c("200000001", "200000002"), each = 2))
  expect_false("22001" %in% crte$territoire)
  ti <- lire("Territoires d'industrie")
  expect_equal(nrow(ti), 2L)
  expect_true(all(ti$type == "epci"))
  expect_setequal(ti$territoire, c("200000001", "200000002"))

  # ORT : les conventions SIGNÉES des communes non labellisées, aux DEUX
  # ancrages — commune (22003, 22004) ET EPCI (200000001 — l'EPCI X, qui porte
  # les deux). L'EPCI Y ne porte que l'ORT de sa commune ACV labellisée : la
  # convention est portée par le label, AUCUNE ligne ORT EPCI (jamais double).
  ort <- lire("ORT")
  expect_equal(nrow(ort), 3L)
  expect_setequal(ort$territoire[ort$type == "commune"], c("22003", "22004"))
  expect_equal(ort$territoire[ort$type == "epci"], "200000001")
})

test_that("construire_membres_programmes : l'ORT ne badge QUE les conventions « Signée »", {
  membres <- construire_membres_programmes(
    donnees_programmes_fixture(), base_epci_programmes(), vintages_programmes_fixture()
  )
  ort <- membres[membres$sigle == "ORT", ]

  # « Terminée » (22002 PVD, 29003 autre) et « Non signée » (29001 PVD) ne
  # produisent AUCUNE ligne ORT — la commune 29003 (autre, Terminée) n'a ni
  # ligne commune ni ligne EPCI, et l'EPCI Y n'apparaît jamais
  expect_false("29003" %in% ort$territoire)
  expect_false("22002" %in% ort$territoire)
  expect_false("29001" %in% ort$territoire)
  expect_false("200000002" %in% ort$territoire)
})

test_that("construire_membres_programmes : un statut NA ou « En cours » n'est jamais une convention signée", {
  # le fichier réel porte des lignes sans statut et « En cours » — aucune ne
  # doit produire de ligne ORT ni de drapeau (le badge ne s'allume que sur le
  # statut « Signée », jamais sur une valeur manquante)
  donnees <- donnees_programmes_fixture()
  donnees$ort <- dplyr::bind_rows(
    donnees$ort,
    tibble::tribble(
      ~code_commune, ~statut, ~actualisation,
      "22005", NA_character_, "2026-01-01",
      "22006", "En cours", "2026-01-02"
    )
  )
  base <- dplyr::bind_rows(
    base_epci_programmes(),
    tibble::tribble(
      ~CODGEO, ~LIBGEO, ~EPCI, ~LIBEPCI, ~DEP, ~REG,
      "22005", "Commune H", "200000001", "EPCI X", "22", "53",
      "22006", "Commune I", "200000001", "EPCI X", "22", "53"
    )
  )

  membres <- construire_membres_programmes(donnees, base, vintages_programmes_fixture())
  ort <- membres[membres$sigle == "ORT", ]
  expect_false(any(c("22005", "22006") %in% ort$territoire))
})

test_that("construire_membres_programmes : le drapeau « convention valant ORT » sur les labels, jamais un second badge", {
  membres <- construire_membres_programmes(
    donnees_programmes_fixture(), base_epci_programmes(), vintages_programmes_fixture()
  )

  # les communes labellisées avec une convention SIGNÉE portent le drapeau sur
  # leur ligne de label (22001, 29002 — ACV) ; celles sans convention signée
  # (22002, 29001 — PVD « Terminée » / « Non signée ») ne portent RIEN
  acv <- membres[membres$sigle == "ACV", ]
  expect_true(all(acv$convention_valant_ort == TRUE))
  pvd <- membres[membres$sigle == "PVD", ]
  expect_true(all(pvd$convention_valant_ort == FALSE))

  # JAMAIS de double badge : aucune commune labellisée n'a de ligne ORT
  labellisees <- c("22001", "22002", "29001", "29002")
  ort_communes <- membres$territoire[membres$sigle == "ORT" &
                                       membres$type == "commune"]
  expect_false(any(ort_communes %in% labellisees))
  # et aucune ligne ORT ne porte le drapeau (il est réservé aux labels)
  expect_true(all(membres$convention_valant_ort[
    membres$sigle == "ORT"] == FALSE))
})

test_that("construire_membres_programmes : une commune labellisée marquée « 3. Autre » par l'ORT garde son drapeau (la liste ANCT fait foi)", {
  # la dérive : la liste ANCT labellise 29002 (ACV), mais le fichier ORT la
  # marque « 3. Autre » (statut incohérent) avec une convention signée. La règle
  # « jamais double badge » tient : la ligne ACV porte le drapeau, AUCUNE ligne
  # ORT n'est créée — la liste lauréate fait foi, pas le marquage du fichier.
  donnees <- donnees_programmes_fixture()
  donnees$ort$statut[donnees$ort$code_commune == "29002"] <- "3. Autre"
  donnees$ort$statut[donnees$ort$code_commune == "29002"] <- "Signée"

  membres <- construire_membres_programmes(
    donnees, base_epci_programmes(), vintages_programmes_fixture()
  )

  acv <- membres[membres$sigle == "ACV", ]
  expect_true(acv$convention_valant_ort[acv$territoire == "29002"])
  ort <- membres[membres$sigle == "ORT" & membres$type == "commune", ]
  expect_false("29002" %in% ort$territoire)
})

test_that("construire_membres_programmes : chaque ligne porte le vintage de SA source", {
  membres <- construire_membres_programmes(
    donnees_programmes_fixture(), base_epci_programmes(), vintages_programmes_fixture()
  )

  lire <- function(sigle) membres[membres$sigle == sigle, ]

  # ACV/PVD : la mise à jour du jeu ANCT (référence + publication du manifeste)
  acv <- lire("ACV")
  expect_true(all(acv$vintage_source == "ANCT — ACV"))
  expect_true(all(acv$vintage_version == "2025"))
  expect_true(all(acv$vintage_date_reference == "2025-01-01"))
  expect_true(all(acv$vintage_date_publication == "2025-09-24"))
  pvd <- lire("PVD")
  expect_true(all(pvd$vintage_date_publication == "2026-04-27"))

  # CRTE/TI : leurs sources
  crte <- lire("CRTE")
  expect_true(all(crte$vintage_source == "ANCT — CRTE"))
  ti <- lire("Territoires d'industrie")
  expect_true(all(ti$vintage_version == "2022"))

  # ORT : la fraîcheur PAR LIGNE — la date d'actualisation de la convention
  # (jamais la métadonnée de page) ; la ligne EPCI porte l'actualisation la
  # plus récente de ses conventions (22004 : 2026-04-01)
  ort <- lire("ORT")
  expect_true(all(ort$vintage_source == "DGALN/ANCT — ORT"))
  expect_true(all(ort$vintage_version == "en continu"))
  lire_ort <- function(territoire) {
    ort$vintage_date_reference[ort$territoire == territoire]
  }
  expect_equal(lire_ort("22003"), "2026-02-20")
  expect_equal(lire_ort("22004"), "2026-04-01")
  expect_equal(lire_ort("200000001"), "2026-04-01")
  expect_true(all(is.na(ort$vintage_date_publication)))
})

test_that("construire_membres_programmes : un territoire ORT inconnu du référentiel s'arrête bruyamment", {
  donnees <- donnees_programmes_fixture()
  donnees$ort$code_commune[donnees$ort$code_commune == "22003"] <- "99999"

  # une commune ORT absente du référentiel EPCI est une corruption — le payload
  # ne peut pas porter un territoire inconnu (PRD #162, user story 19)
  expect_error(
    construire_membres_programmes(donnees, base_epci_programmes(),
                                  vintages_programmes_fixture()),
    "99999"
  )
})

test_that("construire_membres_programmes : un sigle inconnu n'existe pas — les cinq sigles du contrat", {
  membres <- construire_membres_programmes(
    donnees_programmes_fixture(), base_epci_programmes(), vintages_programmes_fixture()
  )
  expect_setequal(unique(membres$sigle),
                  c("ACV", "PVD", "CRTE", "Territoires d'industrie", "ORT"))
})

# 3. Le descripteur du thème -----------------------------------------------------

test_that("theme_programmes : le descripteur porte les membres requis du contrat", {
  th <- theme_programmes()

  expect_named(th, MEMBRES_DESCRIPTEUR_PROGRAMMES)
  expect_equal(th$theme, "programmes")
  # le manifeste du run est le manifeste COMPLET : les cinq sources ANCT/DGALN
  # (#175) + la source SCDL des subventions (#176) — le téléchargement, le
  # rapport de run et les vintages partagés couvrent les SIX sources du payload
  expect_identical(th$manifest, MANIFEST_PROGRAMMES_COMPLET)
  expect_true(is.function(th$vintages))
  expect_true(is.function(th$construire_donnees))
  expect_true(is.function(th$construire_analytiques))
  expect_true(is.function(th$publier))
  expect_true(verifier_descripteur_programmes(th))
})

test_that("verifier_descripteur_programmes : un membre requis manquant échoue bruyamment", {
  th <- theme_programmes()
  for (membre in MEMBRES_DESCRIPTEUR_PROGRAMMES) {
    defectueux <- th[setdiff(names(th), membre)]
    expect_error(verifier_descripteur_programmes(defectueux), membre,
                 info = membre)
  }
  expect_error(verifier_descripteur_programmes(list()), "manquant")
})

test_that("vintages_programmes : six sources (les cinq ANCT/DGALN + la SCDL), chacune avec SA référence et SA publication", {
  v <- vintages_programmes()

  # le manifeste COMPLET du run (issue #178) : les cinq sources du ticket #175
  # + la source SCDL des subventions du ticket #176 — la table partagée des
  # vintages porte la source des subventions après un run du thème
  expect_equal(nrow(v), 6L)
  expect_named(v, c("id", "source", "version", "licence",
                    "date_reference", "date_publication"))
  expect_setequal(v$id,
                  c("acv", "pvd", "crte", "territoires_industrie", "ort",
                    "subventions_scdl"))

  # l'ORT : version « en continu », la fraîcheur est PAR LIGNE — la référence
  # et la publication source sont NA (la métadonnée de page, périmée d'environ
  # 15 mois, n'est JAMAIS citée)
  ort <- v[v$id == "ort", ]
  expect_equal(ort$version, "en continu")
  expect_true(is.na(ort$date_reference))
  expect_true(is.na(ort$date_publication))
  expect_equal(ort$licence, "lov2")

  # la SCDL : l'estampille HEBDOMADAIRE de la source des subventions (#176)
  scdl <- v[v$id == "subventions_scdl", ]
  expect_equal(scdl$version, MANIFEST_SUBVENTIONS$vintage)
  expect_equal(scdl$date_reference, MANIFEST_SUBVENTIONS$date_reference)
  expect_true(!is.na(scdl$date_publication))
})

test_that("publier_programmes : le seam de publication est câblé (plus un stub)", {
  # un appel sans données échoue pour une raison de DONNÉES (cache absent),
  # jamais sur un message de stub — la même garde que publier_mobilite
  expect_false(grepl("stub", tryCatch(
    publier_programmes(list()),
    error = function(e) conditionMessage(e)
  )))
})
