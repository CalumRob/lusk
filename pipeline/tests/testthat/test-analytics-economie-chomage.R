# test-analytics-economie-chomage -----------------------------------------------
# Le chômage au sens du recensement du thème Économie/Emploi (plan
# economie-analytical-phase, gate G — NOUVELLE source RP) : l'indicateur 3
# « Chômage (population active) » de docs/themes/economie-emploi.md — la part
# de la population active résidente de 15 à 64 ans au chômage, commune par
# commune.
#
# La source (contrat épinglé par MANIFEST_ECONOMIE_CHOMAGE, résolu contre les
# sources primaires le 2026-08-05) : le dossier complet du recensement
# « Population active et chômage – Principaux indicateurs »,
# DS_RP_EMPLOI_LR_PRINC, exploitation principale — le fichier derrière la table
# EMP T4 « Chômage (au sens du recensement) des 15-64 ans ». Le fichier long
# harmonisé porte GEO;GEO_OBJECT;SEX;EMPSTA_ENQ;AGE;EDUC;RP_MEASURE;FREQ;
# OBS_STATUS;TIME_PERIOD;OBS_VALUE (11 colonnes, séparateur ;, champs entre
# guillemets — vérifié sur le fichier réel le 2026-08-05, 17 877 132 lignes).
#
# EMPSTA_ENQ, l'interrupteur du chômage :
#   - "1"   : actifs occupés (partie du dénominateur) ;
#   - "2"   : CHÔMEURS au sens du recensement (le NUMÉRATEUR) ;
#   - "1T2" : actifs = population active totale (le DÉNOMINATEUR) ;
#   - "3"/"31"/"33"/"35"/"36"/"35T36" : les inactifs — JAMAIS au numérateur,
#     JAMAIS au dénominateur ;
#   - "_T"  : le total — jamais une mesure du contrat.
#
# Les filtres EXACTS du taux (EMP T4) :
#   GEO_OBJECT == "COM" × RP_MEASURE == "POP" (la mesure résidente — une ligne
#   « emploi au lieu de travail » est exclue et rapportée, JAMAIS relabellée en
#   chômage) × SEX == "_T" × OBS_STATUS == "A" × TIME_PERIOD == 2023 ×
#   EDUC == "_T" × AGE == "Y15T64". Taux INSEE officiel : chômeurs / population
#   active = "2" / "1T2" (formules_emp.pdf, table EMP T4), dans [0, 1].
#
# ⚠️ CAVEAT DU CONCEPT (fiche conseils INSEE « Activité – Emploi – Chômage »,
# juin 2026, https://www.insee.fr/fr/information/2383177) : l'indicateur est le
# CHÔMAGE AU SENS DU RECENSEMENT — PAS la mesure BIT de l'enquête Emploi (les
# taux censitaires sont systématiquement supérieurs de 2 à 3 points), PAS la
# mesure administrative France Travail/DARES (le classement au recensement est
# totalement déconnecté de l'inscription à France Travail), et PAS les taux de
# chômage localisés (enquête Emploi + France Travail, qui n'existent pas à la
# commune). Le recensement lisse la collecte sur cinq années : la valeur 2023
# est une moyenne quinquennale, pas un point conjoncturel.
#
# ⚠️ Le fichier ACT4/ACT5 déjà ingéré (rp_emploi, DS_RP_TD_ACTIVITE_
# PCSACTIVITY_COMP) ne porte AUCUN chômage — vérifié sur le fichier réel le
# 2026-08-05 : EMPSTA_ENQ n'y expose que "1". Le chômage vit dans UNE source
# sœur (DS_RP_EMPLOI_LR_PRINC) : rp_chomage reste SA table, jamais fusionnée
# avec rp_emploi. Le réseau n'entre jamais dans la boucle de test.

# chargement du fixture : le lecteur PARTAGÉ (lire_csv_long, filter.R) lit les
# vrais fichiers long INSEE — le fixture doit donc se lire à l'identique. Il
# reproduit le format RÉEL du fichier (11 colonnes dans l'ordre réel, ; et
# guillemets) et couvre tous les cas du contrat.
charger_fixture_chomage <- function() {
  lire_csv_long(testthat::test_path("fixtures", "rp-chomage-fixture.csv"))
}

# le référentiel breton (lire_epci, déjà filtré Bretagne) — même forme que dans
# les fixtures Démographie/Habitat ; une commune par département breton plus les
# communes à taux non calculable (22002 sans chômeurs, 22003 à population
# active nulle) ; 44001 (Nantes) en est absente
epci_chomage_mini <- tibble::tribble(
  ~CODGEO, ~LIBGEO, ~EPCI, ~LIBEPCI, ~DEP, ~REG,
  "22001", "Commune A1", "200000001", "EPCI X", "22", "53",
  "22002", "Commune A2", "200000001", "EPCI X", "22", "53",
  "22003", "Commune A3", "200000001", "EPCI X", "22", "53",
  "29001", "Commune B", "200000002", "EPCI Y", "29", "53",
  "35001", "Commune C", "200000003", "EPCI Z", "35", "53",
  "56001", "Commune D", "200000004", "EPCI W", "56", "53"
)

# 1. Le contrat de la source : MANIFEST_ECONOMIE_CHOMAGE -------------------------

test_that("MANIFEST_ECONOMIE_CHOMAGE : une seule source, mêmes colonnes que les autres fragments, id rp_chomage", {
  expect_s3_class(MANIFEST_ECONOMIE_CHOMAGE, "tbl_df")
  expect_equal(
    names(MANIFEST_ECONOMIE_CHOMAGE),
    c("id", "source", "url", "fichier", "vintage", "date_reference",
      "date_publication", "licence", "note", "mode", "type")
  )
  expect_equal(nrow(MANIFEST_ECONOMIE_CHOMAGE), 1)
  expect_equal(MANIFEST_ECONOMIE_CHOMAGE$id, "rp_chomage")
  expect_true(all(!is.na(MANIFEST_ECONOMIE_CHOMAGE$note)))
  # le contrat est valide au sens du vérificateur
  expect_length(verifier_contrat_rp_chomage(MANIFEST_ECONOMIE_CHOMAGE), 0)
})

test_that("MANIFEST_ECONOMIE_CHOMAGE : source officielle INSEE, fichier et dates épinglés", {
  # le dossier complet « Population active et chômage – Principaux indicateurs »
  # (DS_RP_EMPLOI_LR_PRINC, exploitation principale) — résolu contre le
  # catalogue Melodi le 2026-08-05 (produit émis le 2026-07-15)
  expect_match(
    MANIFEST_ECONOMIE_CHOMAGE$url,
    "DS_RP_EMPLOI_LR_PRINC/DS_RP_EMPLOI_LR_PRINC_2023_CSV_FR"
  )
  expect_equal(MANIFEST_ECONOMIE_CHOMAGE$fichier,
               "DS_RP_EMPLOI_LR_PRINC_2023_CSV_FR.zip")
  expect_equal(MANIFEST_ECONOMIE_CHOMAGE$vintage, "2023")
  expect_equal(MANIFEST_ECONOMIE_CHOMAGE$date_reference, "2023-01-01")
  expect_equal(MANIFEST_ECONOMIE_CHOMAGE$date_publication, "2026-07-15")
  expect_true(all(MANIFEST_ECONOMIE_CHOMAGE$licence == "lov2"))
  expect_true(all(MANIFEST_ECONOMIE_CHOMAGE$mode == "cron"))
  expect_true(all(MANIFEST_ECONOMIE_CHOMAGE$type == "fichier"))
})

test_that("MANIFEST_ECONOMIE_CHOMAGE : le caveat du concept censitaire est déclaré dans la note", {
  # le concept : chômage AU SENS DU RECENSEMENT — jamais la mesure BIT, jamais
  # la mesure administrative France Travail/DARES (le contrat l'exige dans le
  # code ET la déclaration de la source)
  expect_match(MANIFEST_ECONOMIE_CHOMAGE$note, "chômage")
  expect_match(MANIFEST_ECONOMIE_CHOMAGE$note, "recensement")
  expect_match(MANIFEST_ECONOMIE_CHOMAGE$note, "BIT")
  expect_match(MANIFEST_ECONOMIE_CHOMAGE$note, "France Travail")
  expect_match(MANIFEST_ECONOMIE_CHOMAGE$note, "DARES")
  # la clé commune GEO (GEO_OBJECT=COM), le filtre Bretagne et les filtres du
  # taux (EMPSTA_ENQ, Y15T64) sont déclarés
  expect_match(MANIFEST_ECONOMIE_CHOMAGE$note, "GEO_OBJECT=COM")
  expect_match(MANIFEST_ECONOMIE_CHOMAGE$note, "DEPT_BRETAGNE")
  expect_match(MANIFEST_ECONOMIE_CHOMAGE$note, "EMPSTA_ENQ")
  expect_match(MANIFEST_ECONOMIE_CHOMAGE$note, "Y15T64")
})

test_that("le vérificateur rejette un contrat qui labellise la mesure comme chômage BIT ou France Travail", {
  # remplacer le caveau censitaire par la mesure administrative : la garde
  # « recensement » saute — jamais un taux France Travail/DARES publié comme
  # indicateur du pipeline (gsub : TOUTES les occurrences du concept sautent)
  mauvais <- MANIFEST_ECONOMIE_CHOMAGE
  mauvais$note <- gsub("recensement", "France Travail/DARES", mauvais$note)
  problemes <- verifier_contrat_rp_chomage(mauvais)
  expect_true(any(grepl("recensement", problemes)))
})

test_that("le vérificateur rejette un contrat au mauvais id, à la mauvaise URL ou aux dates incohérentes", {
  # id dupliqué sur le contrat Flores/RP existant — les sources restent
  # indépendantes
  mauvais_id <- MANIFEST_ECONOMIE_CHOMAGE
  mauvais_id$id <- "rp_emploi"
  expect_true(any(grepl("id", verifier_contrat_rp_chomage(mauvais_id))))

  # URL non officielle
  mauvaise_url <- MANIFEST_ECONOMIE_CHOMAGE
  mauvaise_url$url <- "http://api.insee.fr/melodi/file/DS_RP_EMPLOI_LR_PRINC/DS_RP_EMPLOI_LR_PRINC_2023_CSV_FR"
  expect_true(any(grepl("URL", verifier_contrat_rp_chomage(mauvaise_url))))

  # dates incohérentes : la publication doit être postérieure ou égale à la
  # référence (2023-01-01) — jamais l'inverse
  mauvaises_dates <- MANIFEST_ECONOMIE_CHOMAGE
  mauvaises_dates$date_publication <- "2022-12-31"
  expect_true(any(grepl("date", verifier_contrat_rp_chomage(mauvaises_dates))))
})

test_that("MANIFEST_ECONOMIE_CHOMAGE alimente la table des vintages partagée", {
  v <- vintages_depuis_manifest(MANIFEST_ECONOMIE_CHOMAGE)
  expect_equal(nrow(v), 1)
  expect_named(v, c("id", "source", "version", "licence",
                    "date_reference", "date_publication"))
  expect_equal(v$id, "rp_chomage")
  expect_equal(v$version, "2023")
  expect_true(all(v$licence == "lov2"))
  expect_true(all(!is.na(v$date_reference)))
  expect_true(all(!is.na(v$date_publication)))
})

# 2. Le remodelage : du fichier long vers la table rp_chomage --------------------

test_that("le fixture reproduit le vrai format du fichier (11 colonnes dans l'ordre réel, ;, guillemets)", {
  f <- charger_fixture_chomage()

  expect_equal(
    names(f),
    c("GEO", "GEO_OBJECT", "SEX", "EMPSTA_ENQ", "AGE", "EDUC",
      "RP_MEASURE", "FREQ", "OBS_STATUS", "TIME_PERIOD", "OBS_VALUE")
  )
  # le fixture contient bien les cas du contrat : une commune hors Bretagne,
  # une ligne d'emploi au lieu de travail, des lignes détaillées (sexe, âge,
  # diplôme), les inactifs et des doublons d'inclusion
  expect_true("44001" %in% f$GEO)
  expect_true("EMPLT" %in% f$RP_MEASURE)
  expect_true(any(f$SEX == "F"))
  expect_true(any(f$AGE == "Y15T24"))
  expect_true(any(f$EDUC == "001T100_RP"))
  expect_true(all(c("3", "31", "33", "35", "36", "35T36", "_T") %in% f$EMPSTA_ENQ))
  expect_true(any(f$OBS_STATUS == "K"))
  expect_true(any(f$GEO_OBJECT == "BV2022"))
  expect_true(any(f$TIME_PERIOD == 2017))
})

test_that("pivoter_chomage : une ligne par commune × mesure, seules les lignes du contrat sont gardées", {
  p <- pivoter_chomage(charger_fixture_chomage())

  # les 7 communes du fixture × leurs mesures du contrat (22001 : 3 mesures ;
  # 22002 : seule la population active ; 22003 : chômeurs + population active)
  expect_equal(nrow(p), 18)
  expect_setequal(unique(p$commune),
                  c("22001", "22002", "22003", "29001", "35001", "56001", "44001"))
  expect_setequal(p$measure, c("chomeurs", "actifs_occupes", "population_active"))

  # la sémantique EMPSTA_ENQ : chômeurs = "2", actifs occupés = "1",
  # population active = "1T2" — 22001 porte exactement 2 chômeurs pour 10 actifs
  a <- p[p$commune == "22001", ]
  expect_equal(a$value[a$measure == "chomeurs"], 2)
  expect_equal(a$value[a$measure == "actifs_occupes"], 8)
  expect_equal(a$value[a$measure == "population_active"], 10)

  # les lignes HORS contrat tombent : inactifs ("3", "31", "33", "35", "36",
  # "35T36"), total ("_T"), sexes détaillés (F), âges détaillés (Y15T24),
  # diplômes détaillés (001T100_RP), doublons d'inclusion (K), autres
  # millésimes (2017), bassins de vie (BV2022) et l'emploi au lieu de travail
  # (EMPLT) — aucune n'est relabellée en mesure de chômage
  expect_false(any(p$value == 90.0))    # EMPSTA_ENQ = "3" (inactifs)
  expect_false(any(p$value == 91.0))    # EMPSTA_ENQ = "31"
  expect_false(any(p$value == 92.0))    # EMPSTA_ENQ = "33"
  expect_false(any(p$value == 93.0))    # EMPSTA_ENQ = "35"
  expect_false(any(p$value == 94.0))    # EMPSTA_ENQ = "36"
  expect_false(any(p$value == 95.0))    # EMPSTA_ENQ = "35T36"
  expect_false(any(p$value == 102.0))   # EMPSTA_ENQ = "_T"
  expect_false(any(p$value == 1.0))     # SEX = F
  expect_false(any(p$value == 0.5))     # EDUC = 001T100_RP
  expect_false(any(p$value == 99999.0)) # OBS_STATUS = K
  expect_false(any(p$value == 100.0))   # TIME_PERIOD = 2017
  expect_false(any(p$value == 555.0))   # GEO_OBJECT = BV2022
  expect_false(any(p$value == 9999.0))  # RP_MEASURE = EMPLT (lieu de travail)
})

test_that("assembler_chomage : l'enveloppe du contrat, Bretagne seulement, aucune colonne Flores/SIRENE", {
  b <- assembler_chomage(
    pivoter_chomage(charger_fixture_chomage()), epci_chomage_mini
  )

  # une ligne par (commune bretonne × mesure) ; 44001 (Nantes) éliminée à la
  # jointure avec le référentiel breton
  expect_equal(nrow(b), 15)
  expect_false("44001" %in% b$commune)
  expect_setequal(b$departement, c("22", "29", "35", "56"))

  # l'enveloppe du contrat : commune | departement | concept | measure | value |
  # source | vintage — le même squelette que rp_emploi (sans colonne secteur :
  # le chômage n'a pas de dimension sectorielle)
  expect_named(b, c("commune", "departement", "concept", "measure",
                    "value", "source", "vintage"))

  # aucune colonne Flores (flores_a38 / flores_a88) ni SIRENE
  expect_false(any(grepl("flores|sirene|a38|a88", names(b), ignore.case = TRUE)))

  # le concept : le chômage au sens du recensement, partout
  expect_true(all(b$concept == CONCEPT_RP_CHOMAGE))

  # la provenance : la source et le millésime du manifeste
  expect_true(all(b$source == "rp_chomage"))
  expect_true(all(b$vintage == "2023"))

  # les valeurs de 22001 : 2 chômeurs / 10 actifs (la paire du taux à la main)
  a <- b[b$commune == "22001", ]
  expect_equal(a$value[a$measure == "chomeurs"], 2)
  expect_equal(a$value[a$measure == "population_active"], 10)

  # tri déterministe : commune puis mesure
  expect_equal(b$commune, sort(b$commune))
  expect_equal(
    b$measure[b$commune == "22001"],
    c("actifs_occupes", "chomeurs", "population_active")
  )
})

test_that("les lignes d'emploi au lieu de travail sont exclues, jamais relabellées en chômage", {
  f <- charger_fixture_chomage()
  resultat <- normaliser_chomage(f, epci_chomage_mini)

  # la ligne EMPLT (emploi au lieu de travail, 9999.0) n'apparaît pas dans la
  # table — exclue au pivot par la borne de la mesure résidente RP_MEASURE=POP
  expect_false(any(resultat$table$value == 9999.0))
  # le concept porté est LE concept censitaire constant — rien d'autre
  expect_setequal(unique(resultat$table$concept), CONCEPT_RP_CHOMAGE)

  # le rapport la signale comme exclue, avec la raison qui nomme le piège
  expect_true("22001" %in% resultat$exclusions$commune)
  expect_true(any(grepl("EMPLT", resultat$exclusions$motif)))
  expect_true(any(grepl("lieu de travail", resultat$exclusions$motif)))
  expect_true(any(grepl("chômage", resultat$exclusions$motif)))
})

test_that("la géographie invalide est rapportée et exclue", {
  resultat <- normaliser_chomage(charger_fixture_chomage(), epci_chomage_mini)

  # la commune hors Bretagne (44001) est exclue de la table... et rapportée
  expect_false("44001" %in% resultat$table$commune)
  expect_true("44001" %in% resultat$exclusions$commune)
  expect_true(any(grepl("Bretagne", resultat$exclusions$motif[
    resultat$exclusions$commune == "44001"
  ])))

  # toutes les communes conservées joignent le référentiel breton ; aucune
  # valeur de la non-bretonne ne subsiste (7 chômeurs / 70 actifs)
  expect_true(all(resultat$table$commune %in% epci_chomage_mini$CODGEO))
  expect_false(any(resultat$table$value %in% c(7.0, 63.0, 70.0)))
})

test_that("un fixture 100 % emploi au lieu de travail échoue bruyamment, jamais relabellé en chômage (QA)", {
  f <- charger_fixture_chomage()
  seulement_travail <- f[f$RP_MEASURE != "POP", ]

  # le piège du contrat : toutes les lignes « chômage » labellisées au lieu de
  # travail — la table doit être VIDE et le rapport DOIT les nommer (un échec
  # silencieux réinterpréterait l'emploi au lieu de travail comme du chômage)
  resultat <- normaliser_chomage(seulement_travail, epci_chomage_mini)
  expect_equal(nrow(resultat$table), 0)
  expect_true("22001" %in% resultat$exclusions$commune)
  expect_true(any(grepl("EMPLT", resultat$exclusions$motif)))
  expect_true(any(grepl("lieu de travail", resultat$exclusions$motif)))
  expect_false(any(resultat$table$value == 9999.0))
})

# 3. L'indicateur : le taux de chômage communal ----------------------------------

test_that("le taux à la main : 2 chômeurs / 10 actifs -> 0.2 (la paire du contrat)", {
  f <- charger_fixture_chomage()
  res <- construire_chomage_economie(normaliser_chomage(f, epci_chomage_mini)$table)
  d <- res$table
  taux <- function(code) d$taux_chomage[d$commune == code]

  # 22001 : 2 chômeurs / 10 actifs = 0.2 — le calcul à la main du contrat
  expect_equal(taux("22001"), 0.2)
  # 29001 : 5 / 25 = 0.2
  expect_equal(taux("29001"), 0.2)
  # 35001 : 3 / 50 = 0.06
  expect_equal(taux("35001"), 3 / 50)
  # 56001 : 0 chômeur / 40 actifs = 0 (le zéro est un taux valide)
  expect_equal(taux("56001"), 0)

  # toutes les taux vivent dans [0, 1] — jamais un taux > 1 ou négatif
  expect_true(all(d$taux_chomage[!is.na(d$taux_chomage)] >= 0))
  expect_true(all(d$taux_chomage[!is.na(d$taux_chomage)] <= 1))
})

test_that("la sémantique EMPSTA_ENQ : seuls chômeurs et population active entrent dans le taux", {
  # 22001 porte des inactifs ("3"=90, "31"=10, "33"=30, "35"=15, "36"=25,
  # "35T36"=20) et un total ("_T"=102) : AUCUN n'entre dans le taux — la paire
  # 2/10 reste exacte (jamais 2/(10+90+...))
  res <- construire_chomage_economie(
    normaliser_chomage(charger_fixture_chomage(), epci_chomage_mini)$table
  )
  d <- res$table
  expect_equal(d$chomeurs[d$commune == "22001"], 2)
  expect_equal(d$population_active[d$commune == "22001"], 10)

  # la cohérence structurelle du fichier : population active = actifs occupés +
  # chômeurs (1T2 = 1 + 2) — vérifiée sur le fichier réel
  expect_equal(d$population_active[d$commune == "22001"],
               d$actifs_occupes[d$commune == "22001"] +
                 d$chomeurs[d$commune == "22001"])
  expect_equal(d$population_active[d$commune == "29001"],
               d$actifs_occupes[d$commune == "29001"] +
                 d$chomeurs[d$commune == "29001"])
})

test_that("un taux non calculable est NA et rapporté — jamais un zéro ou un infini inventé", {
  res <- construire_chomage_economie(
    normaliser_chomage(charger_fixture_chomage(), epci_chomage_mini)$table
  )
  d <- res$table

  # 22002 : la ligne chômeurs est absente -> taux NA, jamais 0/30 = 0 inventé
  expect_true(is.na(d$taux_chomage[d$commune == "22002"]))
  # 22003 : population active nulle -> taux NA, jamais un infini
  expect_true(is.na(d$taux_chomage[d$commune == "22003"]))
  # les deux sont rapportées avec leur motif — aucune suppression silencieuse
  expect_setequal(res$suppression$commune, c("22002", "22003"))
  expect_match(res$suppression$motif[res$suppression$commune == "22002"],
               "chômeurs")
  expect_match(res$suppression$motif[res$suppression$commune == "22003"],
               "population active")
})

test_that("le schéma de la table : commune × 1 taux, colonnes du contrat, déterminisme (ADR-0002)", {
  f <- charger_fixture_chomage()
  d1 <- construire_chomage_economie(
    normaliser_chomage(f, epci_chomage_mini)$table
  )$table
  d2 <- construire_chomage_economie(
    normaliser_chomage(f, epci_chomage_mini)$table
  )$table

  expect_named(d1, c("commune", "departement", "chomeurs", "actifs_occupes",
                     "population_active", "taux_chomage"))
  # une ligne par commune, triée — même commune + mêmes données -> même taux
  expect_equal(anyDuplicated(d1$commune), 0L)
  expect_equal(d1$commune, sort(d1$commune))
  expect_identical(d1, d2)
})

test_that("persister_chomage_economie : table + rapport de suppression sous data/processed/economie/", {
  sortie <- tempfile("chomage-")
  on.exit(unlink(sortie, recursive = TRUE), add = TRUE)
  res <- construire_chomage_economie(
    normaliser_chomage(charger_fixture_chomage(), epci_chomage_mini)$table
  )

  persister_chomage_economie(res, sortie = sortie)

  expect_true(file.exists(file.path(sortie, "chomage_economie.rds")))
  expect_true(file.exists(file.path(sortie, "chomage_economie_suppression.rds")))
  expect_identical(readr::read_rds(file.path(sortie, "chomage_economie.rds")),
                   res$table)
  expect_identical(
    readr::read_rds(file.path(sortie, "chomage_economie_suppression.rds")),
    res$suppression
  )
  # la cible par défaut est le dossier Économie/Emploi des données processées
  # (data/ étant gitignoré, seul le chemin est vérifié — jamais public/)
  expect_match(as.character(formals(persister_chomage_economie)$sortie),
               "data/processed/economie")
})

# 4. Données réelles : la table et le taux sur les 1202 communes -----------------

# Les tables réelles vivent sous pipeline/data/ (gitignoré) — résolues par
# rapport au dossier des tests, comme test-analytics-economie-green.R.
chemin_reel_chomage <- function(fichier) {
  file.path(testthat::test_path("..", ".."),
            "data", "processed", "economie", fichier)
}

test_that("données réelles : rp_chomage.rds couvre 1202 communes × 3 mesures, aucun doublon", {
  chemin <- chemin_reel_chomage("rp_chomage.rds")
  skip_if_not(file.exists(chemin),
              "la table réelle n'est pas présente (data/ est gitignoré)")

  rp <- readr::read_rds(chemin)

  # acceptance : 1202 communes bretonnes × les 3 mesures du contrat
  expect_equal(length(unique(rp$commune)), 1202)
  expect_equal(nrow(rp), 1202 * 3)
  expect_equal(anyDuplicated(rp[c("commune", "measure")]), 0L)
  expect_setequal(rp$measure, c("chomeurs", "actifs_occupes", "population_active"))
  # le concept et la provenance
  expect_true(all(rp$concept == CONCEPT_RP_CHOMAGE))
  expect_true(all(rp$source == "rp_chomage"))
  expect_true(all(rp$vintage == "2023"))
  # les 1202 communes couvrent les quatre départements bretons
  expect_setequal(unique(substr(rp$commune, 1, 2)), c("22", "29", "35", "56"))
})

test_that("données réelles : chomage_economie.rds = commune × 1 taux dans [0,1], aucune suppression", {
  chemin_rp <- chemin_reel_chomage("rp_chomage.rds")
  skip_if_not(file.exists(chemin_rp),
              "la table réelle n'est pas présente (data/ est gitignoré)")

  res <- construire_chomage_economie(readr::read_rds(chemin_rp))
  d <- res$table

  # acceptance : 1202 communes, une ligne par commune, taux dans [0, 1]
  expect_equal(nrow(d), 1202)
  expect_equal(anyDuplicated(d$commune), 0L)
  expect_true(all(d$taux_chomage >= 0 & d$taux_chomage <= 1))
  # aucune commune sans taux calculable sur le réel (chaque commune porte ses
  # trois mesures) — le rapport de suppression est vide
  expect_equal(sum(is.na(d$taux_chomage)), 0)
  expect_equal(nrow(res$suppression), 0)
  # la cohérence structurelle 1T2 = 1 + 2 tient sur les 1202 communes — au
  # dernier arrondi près : INSEE publie la population active (1T2) et la somme
  # actifs occupés + chômeurs indépendamment, à 5 décimales (vérifié sur le
  # réel : écart maximal 1e-5, relatif ~3e-7)
  expect_equal(d$population_active,
               d$actifs_occupes + d$chomeurs, tolerance = 1e-4)

  # l'indicateur persisté existe et est exactement la table calculée
  chemin_ind <- chemin_reel_chomage("chomage_economie.rds")
  skip_if_not(file.exists(chemin_ind),
              "l'indicateur persisté n'est pas présent (data/ est gitignoré)")
  expect_identical(readr::read_rds(chemin_ind), d)
})
