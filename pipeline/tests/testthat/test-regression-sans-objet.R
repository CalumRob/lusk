# test-regression-sans-objet ---------------------------------------------------
# LE GATE DE RÉGRESSION du fix « Sans objet » (issue #131, décision 2026-08-06).
#
# Ce que le gate certifie : les payloads Démographie et Habitat ne changent
# QUE par le retrait des lignes « Sans objet » — rien d'autre. Le fix touche la
# machinerie PARTAGÉE (lire_epci normalise le code « ZZZZZZZZZ » de la base
# INSEE en NA — theme_demographie.R ; squelette_territoires refuse de fabriquer
# un EPCI fantôme — compute.R ; validate_payload §5bis inverse la règle —
# compute.R) : les trois thèmes partagent la même référence, un changement de
# squelette les affecte tous. Le gate verrouille que l'affectation se limite
# au retrait du fantôme.
#
# ⚠️ BORNE DU GATE — la forme RÉELLE du critère d'acceptation de l'issue #131
# (« payloads Démographie/Habitat octet-pour-octet identiques à l'exception des
# lignes « Sans objet » retirées ») compare les payloads COMMITÉS avant/après
# sur les données réelles. Elle est un pas MANUEL de QA (issue #123 le note) :
# la boucle de test n'a pas data/raw (gitignoré) et les payloads commités sous
# public/ ne sont JAMAIS régénérés en test. Le gate CI-enforced d'ici est son
# SUBSTITUT FIXTURE : le MÊME delta, prouvé sur le jeu synthétique.
#
# Le delta prouvé (Démographie comme Habitat) :
#   1. l'ANCIEN monde (entrée brute : les îles portent epci = « ZZZZZZZZZ »,
#      libellé « Sans objet ») fabriquait un EPCI fantôme dont les mesures
#      agrégées sont les sommes des îles ;
#   2. le NOUVEAU monde (entrée normalisée — ce que lire_epci produit) ne
#      fabrique AUCUN EPCI fantôme, les trois îles portent epci = null, et
#      TOUT le reste — communes, EPCIs réels, départements, région, colonnes
#      de mesure — est octet-pour-octet identique à l'ancien monde débarrassé
#      du fantôme ;
#   3. le payload post-change (normalisation + compute + validation, le chemin
#      réel) ne laisse traîner nulle part « Sans objet » / « ZZZZZZZZZ » et
#      porte les îles en communes sans EPCI.
# Les lignes non-îles sont comparées au niveau de la TABLE DES TERRITOIRES du
# thème (build_territoires / construire_territoires_habitat) : c'est l'unique
# source dont dérivent indicateurs, histoires et aperçu — leur identité
# octet-pour-octet garantit celle du payload entier (les constructeurs sont des
# fonctions pures de cette table).

# --- La matière partagée : les trois îles et la normalisation des communes ---

# Les trois îles bretonnes SANS EPCI (la base INSEE les code « ZZZZZZZZZ »).
ILES_BRETAGNE <- c("22016", "29083", "29155")

# Les îles DANS LA FORME des communes processées (la sortie d'assembler_communes
# / du reshape Habitat), à l'état BRUT de la base INSEE — epci = « ZZZZZZZZZ »,
# libellé « Sans objet » — pour simuler l'ancien monde. Valeurs synthétiques
# plausibles : chaque île porte des mesures valides (le payload doit les
# calculer, jamais les supprimer).
iles_demographie <- function() {
  tibble::tribble(
    ~code, ~nom, ~departement, ~epci, ~nom_epci,
    ~population, ~population_1968, ~population_precedente, ~superficie_km2,
    ~naissances, ~deces,
    ~age_lt15, ~age_15_24, ~age_25_39, ~age_40_54, ~age_55_64, ~age_65_79,
    ~age_80_plus, ~age_lt20, ~population_menages, ~menages,
    "22016", "Île-de-Bréhat", "22", "ZZZZZZZZZ", "Sans objet",
    350, 300, 340, 3.1, 2, 4, 40, 30, 50, 60, 80, 50, 40, 70, 340, 180,
    "29083", "Île-de-Sein", "29", "ZZZZZZZZZ", "Sans objet",
    260, 300, 270, 0.6, 1, 4, 25, 20, 35, 40, 60, 45, 35, 45, 255, 140,
    "29155", "Ouessant", "29", "ZZZZZZZZZ", "Sans objet",
    820, 900, 830, 15.6, 5, 12, 90, 70, 120, 140, 180, 130, 90, 160, 800, 420
  )
}

iles_habitat <- function() {
  tibble::tribble(
    ~code, ~nom, ~departement, ~epci, ~nom_epci,
    ~logements, ~logements_principales, ~logements_secondaires, ~logements_vacants,
    ~statut_proprietaire, ~statut_hlm, ~statut_locataire_prive,
    ~statut_loge_gratuit,
    ~bati_lt1919, ~bati_1919_1945, ~bati_1946_1970, ~bati_1971_1990,
    ~bati_1991_2005, ~bati_2006_plus,
    ~type_maison, ~type_appartement,
    # le contrat des indicateurs Habitat (le split #368) : mix → parts de
    # `logements` ; statut (4 parts) et type (2 parts) → parts des RÉSIDENCES
    # PRINCIPALES (chaque famille de comptes somme à logements_principales),
    # âge du bâti → les 6 tranches (le stock connu)
    "22016", "Île-de-Bréhat", "22", "ZZZZZZZZZ", "Sans objet",
    300, 150, 140, 10, 90, 20, 25, 15, 15, 20, 25, 20, 30, 40, 100, 50,
    "29083", "Île-de-Sein", "29", "ZZZZZZZZZ", "Sans objet",
    200, 120, 70, 10, 70, 15, 20, 15, 12, 18, 24, 18, 24, 24, 80, 40,
    "29155", "Ouessant", "29", "ZZZZZZZZZ", "Sans objet",
    450, 250, 180, 20, 150, 30, 45, 25, 25, 35, 40, 40, 50, 60, 170, 80
  )
}

# normaliser_epci_communes -----------------------------------------------------
# Le miroir COMMUNES de normaliser_epci_manquants : la normalisation RÉELLE vit
# dans lire_epci (theme_demographie.R), sur la forme BASE (CODGEO/EPCI/LIBEPCI) ;
# les fixtures communes consomment SA sortie (assembler_communes a déjà
# renommé EPCI → epci, LIBEPCI → nom_epci). Appliquée à une table communes,
# elle produit exactement l'entrée que le pipeline post-change reçoit — les
# îles à epci = null, libellé tombé, le reste intouché.
normaliser_epci_communes <- function(communes) {
  communes %>%
    dplyr::mutate(
      epci = dplyr::if_else(epci == "ZZZZZZZZZ", NA_character_, epci),
      nom_epci = dplyr::if_else(is.na(epci), NA_character_, nom_epci)
    )
}

# --- 1. La machinerie partagée : lire_epci + squelette_territoires ----------

test_that("normaliser_epci_manquants : les îles passent à epci=null, les autres lignes restent octet-pour-octet", {
  base <- tibble::tribble(
    ~CODGEO, ~LIBGEO, ~EPCI, ~LIBEPCI, ~DEP, ~REG,
    "22001", "Commune A1", "200000001", "EPCI X", "22", "53",
    "22002", "Commune D", "200000001", "EPCI X", "22", "53",
    "22016", "Île-de-Bréhat", "ZZZZZZZZZ", "Sans objet", "22", "53",
    "29083", "Île-de-Sein", "ZZZZZZZZZ", "Sans objet", "29", "53"
  )
  norm <- normaliser_epci_manquants(base)

  # les îles : le code ET le libellé tombent (une commune sans EPCI n'a pas de
  # nom d'EPCI — la garde de squelette_territoires l'exige)
  expect_true(all(is.na(norm$EPCI[norm$CODGEO %in% ILES_BRETAGNE])))
  expect_true(all(is.na(norm$LIBEPCI[norm$CODGEO %in% ILES_BRETAGNE])))
  # les autres lignes : IDENTIQUES à l'entrée brute, colonne pour colonne
  for (code in c("22001", "22002")) {
    expect_identical(
      norm[norm$CODGEO == code, ],
      base[base$CODGEO == code, ],
      info = code
    )
  }
})

test_that("squelette_territoires : le retrait du fantôme est le SEUL delta (toutes les autres lignes octet-pour-octet)", {
  brutes <- dplyr::bind_rows(
    # le fixture lit `departement` en double (« 22 ») ; la base réelle et les
    # îles le portent en caractère — on aligne le fixture (le squelette cast
    # en caractère de toute façon)
    dplyr::mutate(load_fixture(), departement = as.character(departement)),
    iles_demographie()
  )
  normalisees <- normaliser_epci_communes(brutes)

  ancien <- squelette_territoires(brutes)
  nouveau <- squelette_territoires(normalisees)

  # l'ancien monde fabrique le fantôme « Sans objet » ; le nouveau non
  expect_true("ZZZZZZZZZ" %in% ancien$code)
  expect_false("ZZZZZZZZZ" %in% nouveau$code)
  expect_true(any(grepl("Sans objet", ancien$nom)))
  expect_false(any(grepl("Sans objet", nouveau$nom)))

  # le delta : retirer le fantôme + passer l'epci des îles à null →
  # octet-pour-octet identique au nouveau monde
  delta <- ancien %>%
    dplyr::filter(code != "ZZZZZZZZZ") %>%
    dplyr::mutate(epci = dplyr::if_else(code %in% ILES_BRETAGNE,
                                        NA_character_, epci)) %>%
    dplyr::arrange(code)
  expect_identical(delta, nouveau %>% dplyr::arrange(code))
})

# --- 2. Le gate Démographie ----------------------------------------------------

test_that("Démographie : le payload ne change que par le retrait du fantôme « Sans objet » (issue #131)", {
  brutes <- dplyr::bind_rows(
    dplyr::mutate(load_fixture(), departement = as.character(departement)),
    iles_demographie()
  )
  normalisees <- normaliser_epci_communes(brutes)

  # le delta au niveau de la TABLE DES TERRITOIRES (d'où dérivent indicateurs,
  # histoires et aperçu — des fonctions pures de cette table) : l'ancien monde
  # moins le fantôme, epci des îles à null = le nouveau monde, octet-pour-octet
  ancien <- build_territoires(brutes)
  nouveau <- build_territoires(normalisees)
  delta <- ancien %>%
    dplyr::filter(code != "ZZZZZZZZZ") %>%
    dplyr::mutate(epci = dplyr::if_else(code %in% ILES_BRETAGNE,
                                        NA_character_, epci)) %>%
    dplyr::arrange(code)
  expect_identical(delta, nouveau %>% dplyr::arrange(code))

  # le payload post-change (le chemin réel : normalisation + compute + validation)
  payload <- compute_payload(normalisees, theme = theme_demographie())

  # aucune trace de « Sans objet » / « ZZZZZZZZZ » nulle part dans le payload
  expect_false(any(grepl("Sans objet|ZZZZZZZZZ", unlist(payload))))
  # les trois îles sont des communes avec epci = null
  for (ile in ILES_BRETAGNE) {
    ligne <- payload$territoires[payload$territoires$territoire == ile, ]
    expect_equal(ligne$type, "commune", info = ile)
    expect_true(is.na(ligne$epci), info = ile)
  }
  # seuls les EPCIs RÉELS existent (jamais le fantôme)
  expect_setequal(payload$territoires$territoire[payload$territoires$type == "epci"],
                  c("200000001", "200000002"))
  # aucune commune n'est perdue : le fixture + les trois îles
  expect_equal(sum(payload$territoires$type == "commune"),
               nrow(load_fixture()) + length(ILES_BRETAGNE))
  # les îles portent leurs indicateurs (une densité calculée, jamais un trou)
  expect_true(is.finite(valeur_payload(payload, "22016", "densite")$value))
  expect_true(is.finite(valeur_payload(payload, "29155", "evolution_1968")$value))
})

# --- 3. Le gate Habitat --------------------------------------------------------

test_that("Habitat : le payload ne change que par le retrait du fantôme « Sans objet » (issue #131)", {
  fx <- load_fixture_habitat()
  brutes <- list(
    communes = dplyr::bind_rows(fx$communes, iles_habitat()),
    transactions = fx$transactions,
    dpe = fx$dpe
  )
  normalisees <- list(
    communes = normaliser_epci_communes(brutes$communes),
    transactions = fx$transactions,
    dpe = fx$dpe
  )

  # le delta au niveau de la table des territoires Habitat (squelette partagé
  # + agrégats RP/DVF/DPE) : identique, à l'exception du fantôme retiré
  ancien <- construire_territoires_habitat(brutes)
  nouveau <- construire_territoires_habitat(normalisees)
  delta <- ancien %>%
    dplyr::filter(code != "ZZZZZZZZZ") %>%
    dplyr::mutate(epci = dplyr::if_else(code %in% ILES_BRETAGNE,
                                        NA_character_, epci)) %>%
    dplyr::arrange(code)
  expect_identical(delta, nouveau %>% dplyr::arrange(code))

  # le payload post-change (le chemin réel) — valide, sans trace du fantôme
  payload <- compute_payload(normalisees, theme = theme_habitat())

  expect_false(any(grepl("Sans objet|ZZZZZZZZZ", unlist(payload))))
  for (ile in ILES_BRETAGNE) {
    ligne <- payload$territoires[payload$territoires$territoire == ile, ]
    expect_equal(ligne$type, "commune", info = ile)
    expect_true(is.na(ligne$epci), info = ile)
  }
  # les EPCIs réels du fixture Habitat (200000001, 200000002), jamais le fantôme
  expect_setequal(payload$territoires$territoire[payload$territoires$type == "epci"],
                  c("200000001", "200000002"))
  expect_equal(sum(payload$territoires$type == "commune"),
               nrow(fx$communes) + length(ILES_BRETAGNE))
  # une île porte ses indicateurs de stock (jamais un trou de ligne)
  expect_true(all(valeur_payload(payload, "22016", "mix_logements")$value >= 0))
})
