# test-subventions --------------------------------------------------------------
# Le module des agrégats de subventions du payload programmes (issue #176,
# ADR-0013) : l'ingestion de l'export SCDL des subventions de la Région
# (subventions_attribuees_scdl0, data.bretagne.bzh) et le calcul des agrégats —
# la table des faits subventions du payload `programmes` (les lignes
# d'adhésion, elles, sont le ticket #175 ; la publication du payload partagé
# est le ticket #178).
#
# Les règles verrouillées ici (le contrat, docs/research/
# programmes-financements.md §5) :
#   - l'ancre est `dossier_commune_insee` (91,9 % de codes valides) — le
#     marqueur officiel « Non disponible » est EXCLU, jamais additionné comme
#     zéro ;
#   - le cadrage est l'ANNÉE DE DÉCISION (`dateconvention`), l'année complète
#     la plus récente seulement — annuel, jamais cumulatif (2026 est partielle,
#     2025 est l'année de référence) ;
#   - `montant` est le total DÉCIDÉ par convention, jamais un montant par
#     versement ;
#   - niveau commune : le total annuel ventilé par domaine (`programme_libl`),
#     avec le garde-fou top-N + « autres » au-delà du seuil (~6 domaines) ;
#   - niveaux EPCI / département / région : un total annuel UNIQUE, agrégé
#     depuis les montants attribués des communes membres (jamais une moyenne
#     de parts) — une convention ancrée sur une commune SANS EPCI compte quand
#     même dans les totaux de son département et de la région ;
#   - chaque ligne d'agrégat porte l'estampille de fraîcheur HEBDOMADAIRE.
# Tests de comportement externe uniquement — le seam de fixtures du pipeline
# (jamais le réseau, jamais les fichiers réels).

# fixture_conventions_scdl ------------------------------------------------------
# La forme BRUTE de l'export SCDL (les colonnes de la source, en caractères —
# ce que le lecteur lit) : 5 communes ancrées (4 avec EPCI + l'île sans EPCI
# 29155), les années 2024 (complète mais PAS la référence), 2025 (l'année
# complète la plus récente) et 2026 (partielle, exclue), le marqueur
# « Non disponible » et un domaine manquant. 22002 porte HUIT domaines en
# 2025 — le cas du garde-fou top-6 + « autres ».
fixture_conventions_scdl <- function() {
  tibble::tribble(
    ~dateconvention, ~montant, ~dossier_commune_insee, ~programme_libl,
    # 2025 — l'année complète de référence : 22001 (2 domaines, le cas médian)
    "2025-03-10", "10000", "22001", "Développement économique",
    "2025-06-20", "5000", "22001", "Emploi",
    # 22002 : HUIT domaines — le garde-fou top-6 + « autres » (450 + 70)
    "2025-01-15", "100", "22002", "Domaine 1",
    "2025-01-16", "90", "22002", "Domaine 2",
    "2025-01-17", "80", "22002", "Domaine 3",
    "2025-01-18", "70", "22002", "Domaine 4",
    "2025-01-19", "60", "22002", "Domaine 5",
    "2025-01-20", "50", "22002", "Domaine 6",
    "2025-01-21", "40", "22002", "Domaine 7",
    "2025-01-22", "30", "22002", "Domaine 8",
    # 29002 : un gros montant (30 000 € — le total décidé d'UNE convention,
    # jamais éclaté en versements) + un second domaine
    "2025-04-02", "30000", "29002", "Agriculture",
    "2025-04-03", "7000", "29002", "Culture",
    # 29155 (l'île sans EPCI, dép. 29) : une convention 2025 — compte au
    # département et à la région, jamais à un EPCI
    "2025-05-12", "20000", "29155", "Emploi",
    # 2024 — une année complète mais PAS la plus récente : jamais publiée
    "2024-03-10", "8000", "22001", "Développement économique",
    "2024-06-20", "12000", "29001", "Emploi",
    # 2026 — l'année PARTIELLE (la donnée s'arrête en juillet) : jamais publiée
    "2026-02-10", "6000", "22001", "Développement économique",
    # le marqueur officiel « Non disponible » : EXCLU de tout agrégat
    "2025-02-10", "999999", "Non disponible", "Développement économique",
    # un code INSEE invalide (bruit de qualité de la donnée) : exclu
    "2025-02-11", "111", "abc", "Emploi",
    # un montant vide (le « 1 empty row » documenté de la source) : exclu
    "2025-02-12", "", "22001", "Culture",
    # une date de convention illisible : exclue (jamais comptée comme zéro)
    "pas-une-date", "500", "22001", "Emploi"
  )
}

# base_epci_subventions ---------------------------------------------------------
# La forme de lire_epci (CODGEO / LIBGEO / EPCI / LIBEPCI / DEP / REG) du
# fixture : 5 communes — 2 EPCIs (dép. 22 et 29) + l'île 29155 SANS EPCI
# (la base INSEE la code « ZZZZZZZZZ », normalisée en NA à la lecture).
base_epci_subventions <- function() {
  tibble::tribble(
    ~CODGEO, ~LIBGEO, ~EPCI, ~LIBEPCI, ~DEP, ~REG,
    "22001", "Commune A1", "200000001", "EPCI X", "22", "53",
    "22002", "Commune D", "200000001", "EPCI X", "22", "53",
    "29001", "Commune B", "200000002", "EPCI Y", "29", "53",
    "29002", "Commune C", "200000002", "EPCI Y", "29", "53",
    "29155", "Île sans EPCI", NA_character_, NA_character_, "29", "53"
  )
}

# vintages du fixture — la table des vintages telle que le run la passerait
# (la projection du manifeste, une ligne par source).
vintages_subventions_fixture <- function() {
  vintages_subventions()
}

test_that("MANIFEST_SUBVENTIONS : la source SCDL, une ligne, son contrat", {
  m <- MANIFEST_SUBVENTIONS

  # une source — l'export SCDL des subventions de la Région —, les 11 colonnes
  # standard du manifeste
  expect_s3_class(m, "tbl_df")
  expect_equal(nrow(m), 1L)
  expect_equal(nrow(m), length(unique(m$id)))
  expect_true(all(c("id", "source", "url", "fichier", "vintage",
                    "date_reference", "date_publication", "licence",
                    "note", "mode", "type") %in% names(m)))

  # le contrat de la source : l'export hebdomadaire, Licence Ouverte, cron
  expect_equal(m$id, "subventions_scdl")
  expect_equal(m$fichier, "subventions_attribuees_scdl0.csv")
  expect_equal(m$licence, "lov2")
  expect_equal(m$mode, "cron")
  expect_equal(m$type, "fichier")
  # l'estampille HEBDOMADAIRE : la référence (le traitement du jeu) précède ou
  # égale la publication — le vintage n'est JAMAIS « aujourd'hui »
  expect_true(grepl("^[0-9]{4}-[0-9]{2}-[0-9]{2}$", m$vintage))
  expect_true(as.Date(m$date_publication) >= as.Date(m$date_reference))

  # le contrat réel passe sa validation
  expect_true(verifier_contrat_subventions(MANIFEST_SUBVENTIONS))
})

test_that("verifier_contrat_subventions : une dérive de la source échoue bruyamment", {
  # un id hors contrat
  defectueux <- MANIFEST_SUBVENTIONS
  defectueux$id <- "autre_source"
  expect_error(verifier_contrat_subventions(defectueux), "subventions_scdl")

  # un fichier hors contrat
  defectueux <- MANIFEST_SUBVENTIONS
  defectueux$fichier <- "autre-export.csv"
  expect_error(verifier_contrat_subventions(defectueux), "subventions_attribuees_scdl0")

  # une licence hors contrat (la source est Licence Ouverte, jamais ODbL)
  defectueux <- MANIFEST_SUBVENTIONS
  defectueux$licence <- "odbl"
  expect_error(verifier_contrat_subventions(defectueux), "lov2")

  # un mode non-cron (l'export est hebdomadaire — jamais un portage à la main)
  defectueux <- MANIFEST_SUBVENTIONS
  defectueux$mode <- "manuel"
  expect_error(verifier_contrat_subventions(defectueux), "cron")

  # une publication antérieure à la référence
  defectueux <- MANIFEST_SUBVENTIONS
  defectueux$date_publication <- "2026-01-01"
  expect_error(verifier_contrat_subventions(defectueux), "publication")

  # la source absente
  expect_error(verifier_contrat_subventions(
    MANIFEST_SUBVENTIONS[0, ]), "absente")
})

test_that("vintages_subventions : la ligne hebdomadaire de la source", {
  v <- vintages_subventions()

  expect_equal(nrow(v), 1L)
  expect_named(v, c("id", "source", "version", "licence",
                    "date_reference", "date_publication"))
  expect_equal(v$id, "subventions_scdl")
  expect_equal(v$licence, "lov2")
  expect_equal(v$version, MANIFEST_SUBVENTIONS$vintage)
  expect_equal(v$date_reference, MANIFEST_SUBVENTIONS$date_reference)
  expect_equal(v$date_publication, MANIFEST_SUBVENTIONS$date_publication)
})

test_that("normaliser_subventions_scdl : l'ancre, le montant et l'année de décision", {
  norm <- normaliser_subventions_scdl(fixture_conventions_scdl())

  # la forme du contrat : commune (code valide), annee (de dateconvention),
  # domaine, montant numérique
  expect_named(norm, c("commune", "annee", "programme_libl", "montant"))
  # le marqueur « Non disponible » est EXCLU — jamais additionné comme zéro
  expect_false("Non disponible" %in% norm$commune)
  # le code INSEE invalide est exclu, le montant vide est exclu, la date
  # illisible est exclue
  expect_false("abc" %in% norm$commune)
  expect_true(all(!is.na(norm$montant)))
  expect_true(all(!is.na(norm$annee)))
  # l'année de décision est dérivée de dateconvention
  expect_true(all(norm$annee %in% c(2024L, 2025L, 2026L)))
  expect_true(22001 %in% norm$commune[norm$annee == 2026L])
  # les montants sont numériques — le total décidé tel quel
  expect_equal(norm$montant[norm$commune == "29002" &
                              norm$programme_libl == "Agriculture"], 30000)
  # les lignes conservées : les 16 conventions valides (20 brutes − 2 exclues
  # par l'ancre − 1 montant vide − 1 date illisible)
  expect_equal(nrow(norm), 16L)
})

test_that("normaliser_subventions_scdl : un input corrompu s'arrête bruyamment", {
  # une colonne requise manquante nomme la colonne fautive
  corrompu <- fixture_conventions_scdl()["montant"]
  expect_error(normaliser_subventions_scdl(corrompu), "dateconvention")

  # un fichier vide est une corruption
  vide <- tibble::tibble(
    dateconvention = character(), montant = character(),
    dossier_commune_insee = character(), programme_libl = character()
  )
  expect_error(normaliser_subventions_scdl(vide), "aucune ligne")
})

test_that("lire_subventions_scdl : lit l'export CSV du cache (délimiteur ;)", {
  # le seam d'entrée : un petit export SCDL en fichier, la forme réelle
  # (délimiteur « ; », montants en caractères)
  fichier <- tempfile("scdl-", fileext = ".csv")
  on.exit(unlink(fichier))
  lignes <- c(
    "dateconvention;montant;dossier_commune_insee;programme_libl",
    "2025-03-10;10000;22001;Développement économique",
    "2025-02-10;999999;Non disponible;Développement économique"
  )
  writeLines(lignes, fichier, useBytes = TRUE)

  table <- lire_subventions_scdl(fichier)

  # la forme brute de la source : tout en caractères, les colonnes présentes
  expect_equal(nrow(table), 2L)
  expect_true(all(c("dateconvention", "montant", "dossier_commune_insee",
                    "programme_libl") %in% names(table)))
  expect_type(table$montant, "character")
})

test_that("construire_donnees_subventions : le seam d'ingestion depuis le cache", {
  # la couture : le lecteur lit le fichier du cache PAR SON id, le normaliseur
  # le nettoie — le seam d'entrée du run (le fichier réel n'entre jamais dans
  # la boucle de test)
  appels <- new.env()
  local_mocked_bindings(
    lire_subventions_scdl = function(chemin) {
      appels$chemin <- chemin
      fixture_conventions_scdl()
    },
    .package = "lusk"
  )

  donnees <- construire_donnees_subventions(cache = "cache-test")

  # la liste nommée du thème : la table normalisée des conventions
  expect_named(donnees, "conventions")
  expect_named(donnees$conventions, c("commune", "annee", "programme_libl",
                                      "montant"))
  # le lecteur reçoit le chemin du fichier épinglé dans le cache
  expect_equal(appels$chemin,
               file.path("cache-test", "subventions_attribuees_scdl0.csv"))
})

test_that("annee_reference_subventions : l'année complète la plus récente (2026 est partielle → 2025)", {
  # la règle du cadrage : l'année de DÉCISION, l'année COMPLÈTE la plus
  # récente seulement — jamais une année partielle, jamais un cumul
  expect_equal(annee_reference_subventions(c(2024L, 2025L, 2026L)), 2025L)
  # une seule année = partielle par construction : pas d'année de référence
  expect_equal(annee_reference_subventions(2026L), 2025L)
})

test_that("calculer_subventions_communes : le total annuel par domaine, année de référence seule", {
  norm <- normaliser_subventions_scdl(fixture_conventions_scdl())
  communes <- calculer_subventions_communes(norm)

  # la forme : une ligne par (commune × domaine × année de référence)
  expect_named(communes, c("commune", "annee", "programme_libl", "montant"))
  # UNIQUEMENT l'année complète la plus récente (2025) — jamais 2024 (année
  # révolue mais pas la plus récente), jamais 2026 (partielle), jamais un cumul
  expect_setequal(unique(communes$annee), 2025L)
  # 22001 : ses deux domaines de 2025, pas les 8 000 € de 2024
  lire <- function(commune, domaine) {
    communes$montant[communes$commune == commune &
                       communes$programme_libl == domaine]
  }
  expect_equal(lire("22001", "Développement économique"), 10000)
  expect_equal(lire("22001", "Emploi"), 5000)
  # 29002 : le total décidé d'UNE convention, jamais éclaté en versements
  expect_equal(lire("29002", "Agriculture"), 30000)
  # 29155 (l'île sans EPCI) a bien ses lignes communales
  expect_equal(lire("29155", "Emploi"), 20000)
  # 29001 n'a que des conventions 2024 : aucune ligne 2025
  expect_false("29001" %in% communes$commune)
})

test_that("calculer_subventions_communes : le garde-fou top-N + « autres »", {
  norm <- normaliser_subventions_scdl(fixture_conventions_scdl())
  communes <- calculer_subventions_communes(norm)

  # 22001 (2 domaines, le cas médian — ≤ au seuil) : AUCUNE ligne « autres »
  expect_false(any(communes$programme_libl == LIBELLE_AUTRES_SUBVENTIONS &
                     communes$commune == "22001"))
  expect_equal(nrow(communes[communes$commune == "22001", ]), 2L)

  # 22002 (8 domaines > au seuil) : les 6 premiers domaines + UNE ligne
  # « autres » pour le reste — le garde-fou de lisibilité
  g22002 <- communes[communes$commune == "22002", ]
  expect_equal(nrow(g22002), SEUIL_AXES_SUBVENTIONS_COMMUNE + 1L)
  attendus <- c(paste0("Domaine ", 1:6), LIBELLE_AUTRES_SUBVENTIONS)
  expect_setequal(g22002$programme_libl, attendus)
  # les 6 premiers : les domaines aux montants les plus élevés (100..50)
  expect_equal(g22002$montant[g22002$programme_libl == "Domaine 1"], 100)
  expect_equal(g22002$montant[g22002$programme_libl == "Domaine 6"], 50)
  # « autres » = la somme du reste (40 + 30) — jamais un zéro, jamais perdu
  expect_equal(g22002$montant[g22002$programme_libl == LIBELLE_AUTRES_SUBVENTIONS],
               70)
  # les 7 lignes de 22002 somment au total annuel de la commune (520)
  expect_equal(sum(g22002$montant), 520)
})

test_that("calculer_subventions_agregats : un total annuel unique par niveau, agrégé des communes", {
  norm <- normaliser_subventions_scdl(fixture_conventions_scdl())
  agregats <- calculer_subventions_agregats(norm, base_epci_subventions())

  # la forme : une ligne par (niveau × année de référence), montant unique
  # (jamais une ventilation par domaine — illisible à ces échelles)
  expect_named(agregats, c("code", "type", "annee", "montant"))
  expect_setequal(unique(agregats$annee), 2025L)
  # les quatre niveaux, une ligne chacun (2 EPCIs + 2 départements + la région
  # — les communes n'y figurent pas, elles vivent dans la table communale)
  expect_setequal(agregats$type, c("epci", "departement", "region"))
  expect_equal(nrow(agregats), 2L + 2L + 1L)

  lire <- function(code) agregats$montant[agregats$code == code]

  # EPCI X = 22001 (15 000) + 22002 (520) — la SOMME des montants attribués
  # de ses communes, jamais une moyenne de parts
  expect_equal(lire("200000001"), 15520)
  # EPCI Y = 29002 seul (37 000) — 29001 n'a rien en 2025, l'île 29155 n'a
  # pas d'EPCI et n'y entre JAMAIS
  expect_equal(lire("200000002"), 37000)
  # département 22 = l'EPCI X ; département 29 = EPCI Y + l'île 29155 (une
  # convention ancrée sur une commune SANS EPCI compte dans SON département)
  expect_equal(lire("22"), 15520)
  expect_equal(lire("29"), 37000 + 20000)
  # la région = tout le monde, île comprise
  expect_equal(lire("53"), 15520 + 37000 + 20000)
})

test_that("construire_analytiques_subventions : la table d'agrégats complète, estampillée chaque semaine", {
  norm <- normaliser_subventions_scdl(fixture_conventions_scdl())
  analytiques <- construire_analytiques_subventions(
    norm, base_epci_subventions(), vintages_subventions_fixture())

  # la table des faits : lignes communales (ventilées) + une ligne par niveau
  # agrégé, toutes estampillées du vintage HEBDOMADAIRE de la source
  expect_true(all(c("territoire", "type", "annee", "programme_libl",
                    "montant",
                    "vintage_source", "vintage_version",
                    "vintage_date_reference", "vintage_date_publication") %in%
                    names(analytiques)))
  expect_setequal(unique(analytiques$annee), 2025L)

  # communes : 22001 (2) + 22002 (7) + 29002 (2) + 29155 (1) = 12 lignes ;
  # EPCI/départements/région : 5 lignes — aucune ligne « Non disponible »
  expect_equal(nrow(analytiques[analytiques$type == "commune", ]), 12L)
  expect_equal(nrow(analytiques[analytiques$type != "commune", ]), 5L)
  expect_false("Non disponible" %in% analytiques$territoire)

  # les totaux par niveau : les agrégats portent la somme des communes
  expect_equal(sum(analytiques$montant[analytiques$type == "region"]), 72520)
  expect_equal(analytiques$montant[analytiques$territoire == "200000001"],
               15520)
  expect_equal(analytiques$montant[analytiques$territoire == "53"],
               72520)

  # l'estampille HEBDOMADAIRE sur CHAQUE ligne : la ligne de la source dans la
  # table des vintages, jamais un tampon de thème
  ref <- vintages_subventions_fixture()
  expect_true(all(analytiques$vintage_source == ref$source))
  expect_true(all(analytiques$vintage_version == ref$version))
  expect_true(all(analytiques$vintage_date_reference == ref$date_reference))
  expect_true(all(analytiques$vintage_date_publication == ref$date_publication))

  # déterministe : trié par type puis code puis domaine
  expect_true(!is.unsorted(analytiques$type))
  for (t in unique(analytiques$type)) {
    lignes <- analytiques[analytiques$type == t, ]
    expect_true(!is.unsorted(lignes$territoire), info = t)
  }
})

test_that("construire_analytiques_subventions : une source de référence absente des vintages échoue fort", {
  norm <- normaliser_subventions_scdl(fixture_conventions_scdl())
  vintages <- vintages_subventions_fixture()
  vintages <- vintages[vintages$id != "subventions_scdl", ]

  expect_error(
    construire_analytiques_subventions(norm, base_epci_subventions(), vintages),
    "subventions_scdl"
  )
})

test_that("construire_analytiques_subventions : une commune HORS Bretagne n'entre JAMAIS dans les agrégats", {
  # la discipline de l'honnêteté « attribué à un territoire breton » (le même
  # filtre que les totaux) : une convention ancrée sur une commune absente de
  # la base bretonne des EPCI — hors Bretagne (l'export SCDL porte des
  # bénéficiaires de toute la France, ex. 10081 en Aube) ou écart de COG — ne
  # peut être attribuée à AUCUN territoire breton. Elle est exclue de la
  # ventilation communale comme des totaux : le payload ne doit jamais porter
  # une ligne pour un territoire inconnu du référentiel de l'app.
  brutes <- tibble::tribble(
    ~dateconvention, ~montant, ~dossier_commune_insee, ~programme_libl,
    "2025-03-10", "10000", "22001", "Développement économique",
    "2025-03-11", "5000", "10081", "Développement économique",
    "2024-06-20", "8000", "22001", "Emploi",
    "2026-02-10", "6000", "22001", "Développement économique"
  )
  norm <- normaliser_subventions_scdl(brutes)
  analytiques <- construire_analytiques_subventions(
    norm, base_epci_subventions(), vintages_subventions_fixture())

  # la commune bretonne a ses lignes communales ; la commune de l'Aube
  # n'apparaît NULLE PART — ni en ligne communale, ni dans les totaux (le
  # département 10 et l'EPCI hors Bretagne n'existent pas dans la base)
  expect_true(any(analytiques$territoire == "22001"))
  expect_false(any(analytiques$territoire == "10081"))
  # le total de la région ne porte que les montants des communes bretonnes
  expect_equal(sum(analytiques$montant[analytiques$type == "region"]), 10000)
})

test_that("construire_donnees_subventions : une source absente du cache s'arrête bruyamment", {
  # le lecteur lève une erreur de fichier absent — le run s'arrête ICI, avant
  # de construire quoi que ce soit (jamais un succès partiel silencieux)
  local_mocked_bindings(
    lire_subventions_scdl = function(chemin) {
      stop("Fichier absent : ", chemin, call. = FALSE)
    },
    .package = "lusk"
  )
  expect_error(
    construire_donnees_subventions(cache = "cache-test"),
    "subventions_attribuees_scdl0"
  )
})

# Données réelles --------------------------------------------------------------
# Le bloc « données réelles » (hors boucle par défaut — LUSK_RUN_REAL=1, le
# helper skip_sans_donnees_reelles) : l'export SCDL réel du cache
# (pipeline/data/raw/, gitignoré). Il attrape les dérives de format de
# l'export réel (délimiteur, noms de champs, types) que les fixtures ne
# peuvent pas voir — sans fichier réel, le test est sauté.

test_that("données réelles : l'export SCDL réel s'ingère et agrège sans dérive de format", {
  cache <- testthat::test_path("..", "..", "data", "raw")
  fichier <- file.path(cache, "subventions_attribuees_scdl0.csv")
  skip_sans_donnees_reelles(file.exists(fichier),
                            "l'export SCDL réel est absent du cache")

  donnees <- construire_donnees_subventions(cache = cache)
  conventions <- donnees$conventions

  # la forme du contrat, l'ancre TOUJOURS valide (le marqueur « Non
  # disponible » n'y figure jamais)
  expect_named(conventions, c("commune", "annee", "programme_libl", "montant"))
  expect_true(all(grepl("^[0-9]{5}$", conventions$commune)))
  expect_true(all(conventions$montant >= 0))

  # l'année complète la plus récente porte des conventions (jamais un agrégat
  # vide) et le seam de calcul complet s'exécute, estampillé hebdomadaire
  annee_ref <- annee_reference_subventions(conventions$annee)
  expect_true(annee_ref %in% conventions$annee)
  base_epci <- lire_epci(file.path(cache, "extracted", "EPCI_au_01-01-2025.xlsx"))
  analytiques <- construire_analytiques_subventions(
    conventions, base_epci, vintages_subventions())
  ref <- vintages_subventions()
  expect_true(all(analytiques$vintage_source == ref$source))
  expect_true(all(analytiques$montant >= 0))
})
