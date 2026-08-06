# test-analytics-economie-green -------------------------------------------------
# Le score « vert » (plan economie-analytical-phase, todo 3 / T3) : la part des
# établissements ACTIFS dans les classes d'éco-activités, commune par commune —
# la jointure au grain CLASSE (gate H = B : la liste opérationnelle Eurostat
# des activités EGSS, classes NACE/NAF 4 chiffres, drapeaux 100 %/partiel).
#
# Le contrat de la source (docs/research/sdes-economie-verte.md) : le périmètre
# SDES est une liste de PRODUITS (CPF), pas une liste NAF — la jointure au
# grain classe est donc une APPROXIMATION documentée, celle d'Eurostat, pas la
# liste officielle SDES. La règle de jointure est épinglée : classe NAF =
# substr(activity_code, 1, 5) → « NN.NN » (l'APET SIRENE est « NN.NN(L) » 6
# caractères) ; un code EGSS couvre une classe quand ses chiffres (sans point)
# sont un PREFIXE des chiffres de la classe (ex. EGSS « 38.1 » couvre 38.11,
# 38.12 ; EGSS « 37 » couvre 37.00 ; EGSS « 38.21 » couvre 38.21).
#
# Décision de pondération (décidée à la construction, documentée) : **count-all**
# — chaque établissement dont la classe est dans la liste EGSS compte ENTIER au
# numérateur, que le drapeau EGSS soit « h » (100 %) ou « v » (partiel). Le
# drapeau 100 %/partiel est RETENU (colonnes n_eco_100 / n_eco_partial), jamais
# supprimé : le flag-only exclurait 169 classes sur 174 (0.3 % des
# établissements) et trahirait le périmètre SDES qui compte les établissements
# des classes d'éco-activités — le drapeau Eurostat est une annotation de
# part d'output/emploi, pas une exclusion d'établissement. Les valeurs
# spéciales APET : « 00.00Z » (inconnue) et NULL → jamais vertes (elles restent
# au dénominateur — ce sont des établissements actifs), décision documentée.
# Plancher communal gate D : n ≥ 5 établissements actifs par commune (lignes
# SOMMÉES, pas par cellule — vérifié sur le réel : min 10, 0 commune
# supprimée). Sélection déterministe (ADR-0002) : même commune + mêmes données
# -> même part, toujours ; la table est triée par commune.
#
# L'artefact EGSS est VERSIONNÉ et TESTÉ : un CSV épinglé
# (inst/extdata/egss_operational_activities_2024.csv, transcrit depuis le
# fichier officiel Eurostat « EGSS list of environmental products based on CPA
# and CN, 2024 », feuille Activities) + ses métadonnées (id, source, vintage,
# licence) + l'intégrité vérifiée par verifier_contrat_egss() — un artefact
# corrompu (format de classe invalide) échoue FORT en nommant l'artefact ET la
# règle de jointure (le QA du plan). Aucun appel réseau dans la boucle de test.

# Le fixture en forme de table sirene_snapshot ---------------------------------
# Les communes 22001..22009 couvrent TOUS les cas du contrat. La classe est
# substr(activity_code, 1, 5) :
#   - 22001 : 5 étabs TOUS dans la classe EGSS « 37.00 » (37 — assainissement,
#     drapeau h) -> part = 1 (le scénario QA « toutes les cellules dans une
#     classe EGSS -> part = 1 ») ;
#   - 22002 : 3 étabs verts (37.00) + 2 non verts (47.11) -> part = 3/5 = 0.6 ;
#   - 22003 : aucune classe EGSS (47.11) -> part = 0 ;
#   - 22004 : 4 étabs totaux < plancher gate D (5) -> commune SUPPRIMÉE ;
#   - 22005 : 5 étabs dans une classe PARTIELLE EGSS « 28.30 » (drapeau v) ->
#     part = 1 — la décision count-all (la classe partielle compte entière) ;
#   - 22006 : 4 étabs verts (37.00) + 1 « 00.00Z » (inconnue) -> part = 4/5, la
#     00.00Z n'est JAMAIS verte mais reste au dénominateur ;
#   - 22007 : 4 étabs verts (37.00) + 1 code APET NULL -> part = 4/5, NULL
#     jamais vert (défensif : la normalisation exclut déjà les APET NULL) ;
#   - 22008 : 5 étabs dans « 38.11Z » couverts par le code EGSS GROUPE « 38.1 »
#     (drapeau v) -> part = 1 — la règle de jointure au prefixe de classe ;
#   - 22009 : 2 étabs « 37.00 » (h) + 3 étabs « 28.30 » (v) -> n_eco = 5,
#     n_eco_100 = 2, n_eco_partial = 3, part = 1 — la distinction 100/partiel
#     est RETENUE dans la table.
fixture_sirene_green <- function() {
  tibble::tibble(
    commune = c(
      rep("22001", 5), rep("22002", 5), rep("22003", 5), rep("22004", 4),
      rep("22005", 5), rep("22006", 5), rep("22007", 5), rep("22008", 5),
      rep("22009", 5)
    ),
    activity_code = c(
      rep("37.00Z", 5),
      rep("37.00Z", 3), rep("47.11Z", 2),
      rep("47.11Z", 5),
      rep("37.00Z", 4),
      rep("28.30Z", 5),
      rep("37.00Z", 4), "00.00Z",
      rep("37.00Z", 4), NA_character_,
      rep("38.11Z", 5),
      rep("37.00Z", 2), rep("28.30Z", 3)
    ),
    activity_label = "libellé de fixture",
    value = 1L,
    measure = "ETABLISSEMENTS_ACTIFS",
    source = "data.bretagne.bzh — Base SIRENE - Région Bretagne",
    vintage = "2026-04",
    etat_administratif = "Actif",
    tranche_effectifs = "0 salarié",
    naf_version = "NAF rév. 2"
  )
}

# Les tables réelles vivent sous pipeline/data/ (gitignoré) — résolues par
# rapport au dossier des tests (testthat::test_path), comme test-analytics-
# economie-dormitory.R.
chemin_reel_economie <- function(fichier) {
  file.path(testthat::test_path("..", ".."),
            "data", "processed", "economie", fichier)
}

# construire le fixture prêt pour le calcul
construire_green_fixture <- function() {
  construire_eco_activites_economie(fixture_sirene_green(), artefact_egss())
}

# 1. L'artefact EGSS : versionné, épinglé, testé ---------------------------------

test_that("l'artefact EGSS est versionné : id, source, vintage, licence, fichier épinglé", {
  art <- artefact_egss()

  # l'enveloppe du contrat : id, source, vintage, licence, note, table
  expect_true(all(c("id", "source", "vintage", "licence", "note", "table") %in%
                    names(art)))
  expect_equal(art$id, "egss_operational_activities_2024")
  expect_match(art$source, "Eurostat")
  expect_match(art$vintage, "^[0-9]{4}$")
  expect_true(nzchar(art$licence))
  expect_true(nzchar(art$note))

  # la table épinglée : les colonnes du contrat + le vocabulaire fermé des
  # drapeaux (h = 100 % de la classe est environnementale, v = partielle)
  expect_true(all(c("activity_id", "activity", "nace_code", "flag",
                    "cepa_crema_class") %in% names(art$table)))
  expect_setequal(unique(art$table$flag), c("h", "v"))
  # la transcription : 82 activités de la liste opérationnelle 2024, aucune
  # ligne en double (activity_id × nace_code), un seul « Not available »
  expect_equal(nrow(art$table), 192)
  expect_equal(length(unique(art$table$activity_id)), 82)
  expect_equal(anyDuplicated(art$table[c("activity_id", "nace_code")]), 0L)
  expect_equal(sum(art$table$nace_code == "Not available"), 1)
})

test_that("l'intégrité de l'artefact : chaque code EGSS est une forme NACE/NAF valide (la règle de jointure)", {
  # la règle de jointure épingle le grain classe : les codes EGSS sont des
  # divisions (NN), groupes (NN.N) ou classes (NN.NN) NACE rév. 2 — toute
  # autre forme est un artefact corrompu
  codes <- artefact_egss()$table$nace_code
  codes <- codes[codes != "Not available"]
  expect_true(all(grepl("^[0-9]{2}(\\.[0-9]{1,2})?$", codes)))

  # la source contient une coquille (« 28:30 ») corrigée en 28.30 à la
  # transcription — documentée, pas silencieuse : aucune forme « : » ne passe
  expect_false(any(grepl(":", codes)))
})

test_that("un artefact corrompu (format de classe invalide) échoue FORT en nommant l'artefact et la règle de jointure", {
  # le QA du plan : corrompre l'artefact -> échec bruyant qui nomme l'artefact
  # ET la règle de jointure — jamais un échec silencieux
  corrompu <- artefact_egss()
  corrompu$table$nace_code[1] <- "38.21Z"  # pas une forme NACE valide

  expect_error(verifier_contrat_egss(corrompu), "egss_operational_activities_2024")
  expect_error(verifier_contrat_egss(corrompu), "jointure")

  # un code numérique (silencieux, il détruirait les zéros de tête) est lui
  # aussi une corruption : la lecture doit rester caractère, jamais numérique —
  # « 8.21 » (un seul chiffre de division, la forme qu'une coercition
  # numérique donnerait à « 08.21 ») n'est pas une forme NACE valide
  numerique <- corrompu
  numerique$table$nace_code[1] <- "8.21"
  expect_error(verifier_contrat_egss(numerique), "egss_operational_activities_2024")
})

test_that("l'artefact refuse aussi une métadonnée manquante (id/source/vintage/licence)", {
  sans_id <- artefact_egss()
  sans_id$id <- NA_character_
  expect_error(verifier_contrat_egss(sans_id), "id")
  sans_source <- artefact_egss()
  sans_source$source <- ""
  expect_error(verifier_contrat_egss(sans_source), "source")
  sans_vintage <- artefact_egss()
  sans_vintage$vintage <- NA_character_
  expect_error(verifier_contrat_egss(sans_vintage), "vintage")
})

# 2. La jointure au grain classe et la part communale ---------------------------

test_that("la jointure au prefixe : un code EGSS couvre la classe et la classe seule", {
  art <- artefact_egss()

  # un code de DIVISION couvre ses classes (37 -> 37.00)
  expect_equal(table_drapeaux_egss("37.00", art)$drapeau_egss, "h")
  # un code de GROUPE couvre ses classes (38.1 -> 38.11, 38.12)
  expect_equal(table_drapeaux_egss(c("38.11", "38.12"), art)$drapeau_egss,
               c("v", "v"))
  # un code de CLASSE ne couvre que sa classe (38.21 -> 38.21)
  expect_equal(table_drapeaux_egss("38.21", art)$drapeau_egss, "v")
  # une classe couverte par la division 39 (réhabilitation de sites miniers)
  expect_equal(table_drapeaux_egss("39.00", art)$drapeau_egss, "v")
  # la classe 00.00 (APET inconnue) n'est couverte par AUCUN code EGSS
  expect_true(is.na(table_drapeaux_egss("00.00", art)$drapeau_egss))
  # une classe couverte par un code h ET un code v reçoit h (100 % l'emporte)
  expect_equal(table_drapeaux_egss("37.00", art)$drapeau_egss, "h")
})

test_that("la part est commune × 1 dans [0, 1] — le calcul à la main sur le fixture", {
  res <- construire_green_fixture()
  d <- res$table
  part <- function(code) d$part_economie_verte[d$commune == code]

  # 22001 : toutes les cellules dans la classe EGSS 37.00 -> part = 1 (QA)
  expect_equal(part("22001"), 1)
  # 22002 : 3 verts / 5 établissements -> 0.6
  expect_equal(part("22002"), 3 / 5)
  # 22003 : aucune classe EGSS -> 0
  expect_equal(part("22003"), 0)
  # 22005 : une classe PARTIELLE (28.30, drapeau v) compte entière (count-all)
  expect_equal(part("22005"), 1)
  # 22006 : la 00.00Z n'est jamais verte mais reste au dénominateur -> 4/5
  expect_equal(part("22006"), 4 / 5)
  # 22007 : l'APET NULL n'est jamais vert mais reste au dénominateur -> 4/5
  expect_equal(part("22007"), 4 / 5)
  # 22008 : le code EGSS GROUPE 38.1 couvre la classe 38.11 -> part = 1
  expect_equal(part("22008"), 1)

  # toutes les parts vivent dans [0, 1] — jamais de part > 1 ou négative
  expect_true(all(d$part_economie_verte[!is.na(d$part_economie_verte)] >= 0))
  expect_true(all(d$part_economie_verte[!is.na(d$part_economie_verte)] <= 1))
  # une ligne par commune (1201 non supprimées + 22004 supprimée)
  expect_equal(nrow(d), 9)
  expect_equal(anyDuplicated(d$commune), 0L)
})

test_that("la distinction 100 %/partiel est retenue : n_eco_100 et n_eco_partial", {
  d <- construire_green_fixture()$table

  # 22009 : 2 étabs en classe h (37.00) + 3 étabs en classe v (28.30)
  expect_equal(d$n_eco_100[d$commune == "22009"], 2)
  expect_equal(d$n_eco_partial[d$commune == "22009"], 3)
  expect_equal(d$n_eco[d$commune == "22009"], 5)
  # 22001 : la classe 37.00 est 100 % -> tout en n_eco_100
  expect_equal(d$n_eco_100[d$commune == "22001"], 5)
  expect_equal(d$n_eco_partial[d$commune == "22001"], 0)
})

test_that("plancher gate D : n ≥ 5 établissements actifs par commune — suppression comptée, jamais silencieuse", {
  res <- construire_green_fixture()
  d <- res$table

  # 22004 n'a que 4 établissements totaux : supprimée (part NA), comptée
  expect_true(is.na(d$part_economie_verte[d$commune == "22004"]))
  expect_equal(sort(res$suppression$commune), "22004")
  expect_match(res$suppression$motif[res$suppression$commune == "22004"],
               "plancher")
  # toutes les autres communes (≥ 5 établissements) ont une part définie
  expect_equal(sum(is.na(d$part_economie_verte)), 1)
})

test_that("déterminisme (ADR-0002) : même commune + mêmes données -> même part, toujours", {
  d1 <- construire_green_fixture()$table
  d2 <- construire_green_fixture()$table
  expect_identical(d1, d2)
  # la table est triée par commune
  expect_true(all(d1$commune == sort(d1$commune)))
})

test_that("le schéma de la table : commune × 1 part, colonnes du contrat", {
  d <- construire_green_fixture()$table
  expect_named(d, c("commune", "departement", "n_etablissements", "n_eco",
                    "n_eco_100", "n_eco_partial", "part_economie_verte"))
  # le département est porté (22 pour le fixture)
  expect_true(all(d$departement == "22"))
  # les totaux : n_eco = n_eco_100 + n_eco_partial (la distinction est une
  # partition, jamais un double comptage)
  expect_equal(d$n_eco, d$n_eco_100 + d$n_eco_partial)
})

test_that("persister_eco_activites_economie : table + rapport de suppression sous data/processed/economie/", {
  sortie <- tempfile("green-")
  on.exit(unlink(sortie, recursive = TRUE), add = TRUE)
  res <- construire_green_fixture()

  persister_eco_activites_economie(res, sortie = sortie)

  expect_true(file.exists(file.path(sortie, "eco_activites_economie.rds")))
  expect_true(file.exists(file.path(sortie, "eco_activites_economie_suppression.rds")))
  expect_identical(readr::read_rds(file.path(sortie, "eco_activites_economie.rds")),
                   res$table)
  expect_identical(readr::read_rds(file.path(sortie, "eco_activites_economie_suppression.rds")),
                   res$suppression)
  # la cible par défaut est le dossier Économie/Emploi des données processées
  # (data/ étant gitignoré, seul le chemin est vérifié — jamais public/)
  expect_match(as.character(formals(persister_eco_activites_economie)$sortie),
               "data/processed/economie")
})

# 3. Données réelles : la part sur les 1202 communes ---------------------------------

test_that("données réelles : part calculable pour 1202 communes, 0 supprimée, distribution verrouillée", {
  chemin <- chemin_reel_economie("sirene_snapshot.rds")
  skip_sans_donnees_reelles(file.exists(chemin),
              "les tables réelles ne sont pas présentes (data/ est gitignoré)")

  res <- construire_eco_activites_economie(readr::read_rds(chemin), artefact_egss())
  d <- res$table

  # acceptance : 1202 communes, aucune suppression au plancher gate D
  # (vérifié sur le réel : min 10 établissements actifs par commune)
  expect_equal(nrow(d), 1202)
  expect_equal(nrow(res$suppression), 0)
  # une ligne par commune, part dans [0, 1]
  expect_equal(anyDuplicated(d$commune), 0L)
  expect_true(all(d$part_economie_verte >= 0 & d$part_economie_verte <= 1))
  # la distribution verrouillée à la construction (2026-08-05) : part moyenne
  # ~0.32, min ~0.076, max ~0.684 — un déplacement de plusieurs points signalerait
  # une liste EGSS ou un snapshot changé
  expect_lt(mean(d$part_economie_verte), 0.35)
  expect_gt(mean(d$part_economie_verte), 0.29)
  expect_gt(min(d$part_economie_verte), 0.05)
  expect_lt(max(d$part_economie_verte), 0.75)
  # les 1202 communes couvrent les quatre départements bretons
  expect_setequal(unique(substr(d$commune, 1, 2)), c("22", "29", "35", "56"))
})
