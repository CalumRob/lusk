# test-presence-reseaux-tc -------------------------------------------------------
# La porte de PRÉSENCE DE SERVICE du raccordement (issue #485, parent #482 —
# décision « service-presence gate » de la spec ; leçon du millésime Korrigo
# périmé : 12 réseaux sombres sur une date de septembre, recherche note
# accessibilite-extra-communale.md §5a). Fonction PURE sur des tables GTFS
# DÉJÀ parsées (jamais de réseau, jamais de zip dans la boucle de test) :
# trajets actifs par réseau sur la date cible, zéros VISIBLES (un réseau
# sombre est une ligne à 0, jamais une absence silencieuse), puis la porte
# qui REFUSE la promotion tant qu'un réseau sans service n'est pas documenté.
# Les deux réseaux sombres ACCEPTÉS du millésime frais v80335 (Coralie
# Concarneau, LinéotimL30) sont des attentes documentées, pas des surprises.
#
# Sémantique GTFS réelle (vérifiée sur les deux feeds épinglés, issue #485) :
# ni KorrigoBret ni l'export SNCF ne portent calendar.txt — les services sont
# pilotés par calendar_dates (REGEN_* en ajouts exception_type=1). La fonction
# gère les DEUX registres : calendrier hebdomadaire optionnel + exceptions.

date_mercredi <- "20260916" # le mercredi réel de période scolaire de la recette

fixture_reseaux <- function() {
  # Deux réseaux, deux services :
  #   - STAR : service hebdomadaire actif les mercredis de septembre-décembre ;
  #   - CORALIE : un service présent dans trips mais AUCUN calendrier actif
  #     (le cas « réseau sombre » du millésime périmé).
  agences <- tibble::tibble(
    agency_id = c("STAR", "CORALIE"),
    agency_name = c("STAR (Rennes Métropole)",
                     "Réseau Coralie (Concarneau Cornouaille Agglomération)")
  )
  lignes <- tibble::tibble(
    route_id = c("STAR:1", "CORALIE:1"),
    agency_id = c("STAR", "CORALIE")
  )
  trajets <- tibble::tibble(
    route_id = rep(lignes$route_id, each = 2),
    service_id = c("hebdo_star", "hebdo_star", "vacances_coralie", "vacances_coralie"),
    trip_id = paste0("t", 1:4)
  )
  calendrier <- tibble::tibble(
    service_id = c("hebdo_star", "vacances_coralie"),
    monday = c(0, 1), tuesday = c(0, 1), wednesday = c(1, 1),
    thursday = c(0, 1), friday = c(0, 1), saturday = c(0, 1), sunday = c(0, 0),
    start_date = c("20260901", "20260701"),
    end_date = c("20261231", "20260831")
  )
  list(agences = agences, lignes = lignes, trajets = trajets,
       calendrier = calendrier, exceptions_calendrier = NULL)
}

test_that("les trajets actifs par réseau sur la date cible — chaque réseau SA ligne, les zéros visibles", {
  f <- fixture_reseaux()
  presence <- compter_trajets_actifs_par_reseau(
    agences = f$agences, lignes = f$lignes, trajets = f$trajets,
    calendrier = f$calendrier,
    exceptions_calendrier = f$exceptions_calendrier,
    date = date_mercredi)

  expect_s3_class(presence, "tbl_df")
  expect_setequal(names(presence),
                  c("agency_id", "agency_name", "n_trajets_actifs"))
  # TOUS les réseaux sont rapportés — un réseau sombre est une ligne à 0,
  # jamais une absence silencieuse (la porte doit le VOIR pour le nommer)
  expect_setequal(presence$agency_id, c("STAR", "CORALIE"))
  star <- presence[presence$agency_id == "STAR", ]
  coralie <- presence[presence$agency_id == "CORALIE", ]
  expect_equal(star$n_trajets_actifs, 2L)      # le mercredi compte
  expect_equal(coralie$n_trajets_actifs, 0L)   # vacances_coralie finit le 31/08
})

test_that("le jour de semaine compte — un service du mardi reste sombre le mercredi", {
  f <- fixture_reseaux()
  presence_mardi <- compter_trajets_actifs_par_reseau(
    agences = f$agences, lignes = f$lignes, trajets = f$trajets,
    calendrier = f$calendrier, exceptions_calendrier = NULL,
    date = "20260915") # mardi
  expect_equal(presence_mardi$n_trajets_actifs[presence_mardi$agency_id == "STAR"], 0L)

  presence_samedi <- compter_trajets_actifs_par_reseau(
    agences = f$agences, lignes = f$lignes, trajets = f$trajets,
    calendrier = f$calendrier, exceptions_calendrier = NULL,
    date = "20260919") # samedi
  expect_equal(presence_samedi$n_trajets_actifs[presence_samedi$agency_id == "STAR"], 0L)
})

test_that("exception_type = 1 ajoute un service absent du calendrier hebdomadaire", {
  f <- fixture_reseaux()
  exceptions <- tibble::tibble(
    service_id = "reouverture_coralie",
    date = date_mercredi,
    exception_type = 1L
  )
  trajets <- dplyr::bind_rows(
    f$trajets,
    tibble::tibble(route_id = "CORALIE:1", service_id = "reouverture_coralie",
                   trip_id = "t5"))
  presence <- compter_trajets_actifs_par_reseau(
    agences = f$agences, lignes = f$lignes, trajets = trajets,
    calendrier = f$calendrier, exceptions_calendrier = exceptions,
    date = date_mercredi)
  expect_equal(presence$n_trajets_actifs[presence$agency_id == "CORALIE"], 1L)
})

test_that("exception_type = 2 retire un service pourtant actif au calendrier", {
  f <- fixture_reseaux()
  exceptions <- tibble::tibble(
    service_id = "hebdo_star",
    date = date_mercredi,
    exception_type = 2L
  )
  presence <- compter_trajets_actifs_par_reseau(
    agences = f$agences, lignes = f$lignes, trajets = f$trajets,
    calendrier = f$calendrier, exceptions_calendrier = exceptions,
    date = date_mercredi)
  expect_equal(presence$n_trajets_actifs[presence$agency_id == "STAR"], 0L)
})

test_that("un feed SANS calendar.txt (la réalité Korrigo/SNCF) vit sur ses seules exceptions", {
  f <- fixture_reseaux()
  exceptions <- tibble::tibble(
    service_id = c("REGEN_1258", "REGEN_1258"),
    date = rep(date_mercredi, 2),
    exception_type = c(1L, 1L)
  )
  trajets <- tibble::tibble(
    route_id = rep(f$lignes$route_id, each = 1),
    service_id = rep("REGEN_1258", 2),
    trip_id = c("k1", "k2")
  )
  presence <- compter_trajets_actifs_par_reseau(
    agences = f$agences, lignes = f$lignes, trajets = trajets,
    calendrier = NULL, exceptions_calendrier = exceptions,
    date = date_mercredi)
  expect_equal(presence$n_trajets_actifs[presence$agency_id == "STAR"], 1L)
  expect_equal(presence$n_trajets_actifs[presence$agency_id == "CORALIE"], 1L)
})

test_that("une route sans agency_id avec UNE seule agence lui est attribuée", {
  f <- fixture_reseaux()
  lignes <- tibble::tibble(route_id = "STAR:1", agency_id = NA_character_)
  trajets <- tibble::tibble(route_id = "STAR:1", service_id = "hebdo_star",
                            trip_id = "t1")
  presence <- compter_trajets_actifs_par_reseau(
    agences = f$agences[1, ], lignes = lignes, trajets = trajets,
    calendrier = f$calendrier, exceptions_calendrier = NULL,
    date = date_mercredi)
  expect_equal(presence$n_trajets_actifs[presence$agency_id == "STAR"], 1L)
})

test_that("une route sans agency_id avec PLUSIEURS agences échoue bruyamment", {
  f <- fixture_reseaux()
  lignes <- dplyr::mutate(f$lignes, agency_id = NA_character_)
  expect_error(
    compter_trajets_actifs_par_reseau(
      agences = f$agences, lignes = lignes, trajets = f$trajets,
      calendrier = f$calendrier, exceptions_calendrier = NULL,
      date = date_mercredi),
    "agency_id")
})

test_that("une route dont l'id est absent de routes.txt échoue bruyamment", {
  f <- fixture_reseaux()
  trajets <- tibble::tibble(route_id = "INCONNU:9", service_id = "hebdo_star",
                            trip_id = "tx")
  expect_error(
    compter_trajets_actifs_par_reseau(
      agences = f$agences, lignes = f$lignes, trajets = trajets,
      calendrier = f$calendrier, exceptions_calendrier = NULL,
      date = date_mercredi),
    "INCONNU:9")
})

# --- la PORTE -------------------------------------------------------------------

test_that("TRIPWIRE — un réseau sombre NON documenté bloque la promotion et est NOMMÉ", {
  f <- fixture_reseaux()
  presence <- compter_trajets_actifs_par_reseau(
    agences = f$agences, lignes = f$lignes, trajets = f$trajets,
    calendrier = f$calendrier, exceptions_calendrier = NULL,
    date = date_mercredi)
  # Coralie est sombre et rien ne l'accepte : la porte refuse EN NOMMANT
  expect_error(verifier_presence_reseaux(presence, acceptes = character(0)),
               "CORALIE")
  expect_error(verifier_presence_reseaux(presence, acceptes = character(0)),
               "sans service")
})

test_that("les deux réseaux sombres ACCEPTÉS du millésime v80335 passent la porte", {
  # Le constat E2b (research §5b) : sur le millésime frais v80335 et le
  # mercredi cible, seuls Coralie (Concarneau) et LinéotimL30 (Morlaix) sont
  # sombres — des écarts DOCUMENTÉS, acceptés par décision, jamais muets.
  agences <- tibble::tibble(
    agency_id = c("STAR", "CORALIE", "LINEOTIML30"),
    agency_name = c("STAR (Rennes Métropole)",
                     "Réseau Coralie (Concarneau Cornouaille Agglomération)",
                     "LinéotimL30 (Morlaix)")
  )
  lignes <- tibble::tibble(
    route_id = c("STAR:1", "CORALIE:1", "LINEOTIML30:1"),
    agency_id = agences$agency_id)
  trajets <- tibble::tibble(
    route_id = lignes$route_id,
    service_id = "REGEN_star",
    trip_id = c("s1", "c1", "l1"))
  calendrier <- tibble::tibble(
    service_id = "REGEN_star",
    monday = 0, tuesday = 0, wednesday = 1, thursday = 0, friday = 0,
    saturday = 0, sunday = 0,
    start_date = "20260901", end_date = "20261231")
  presence <- compter_trajets_actifs_par_reseau(
    agences = agences, lignes = lignes, trajets = trajets,
    calendrier = calendrier, exceptions_calendrier = NULL,
    date = date_mercredi)

  # la constante documentée porte EXACTEMENT ces deux réseaux
  expect_setequal(RESEAUX_SANS_SERVICE_ACCEPTES_KORRIGO_80335,
                  c("CORALIE", "LINEOTIML30"))

  expect_invisible(
    verifier_presence_reseaux(
      presence, acceptes = RESEAUX_SANS_SERVICE_ACCEPTES_KORRIGO_80335))
})

test_that("un troisième réseau sombre, même avec la liste d'acceptation v80335, reste bloqué", {
  f <- fixture_reseaux()
  presence <- compter_trajets_actifs_par_reseau(
    agences = f$agences, lignes = f$lignes, trajets = f$trajets,
    calendrier = f$calendrier, exceptions_calendrier = NULL,
    date = date_mercredi)
  # Coralie acceptée… mais la liste ne couvre QUE les écarts documentés :
  # ici Coralie EST la seule sombre, elle passe ; on force alors un cas où
  # STAR devient sombre (jour hors service) — il n'est pas documenté, la
  # porte refuse même quand la liste d'acceptation est fournie.
  presence_mardi <- compter_trajets_actifs_par_reseau(
    agences = f$agences, lignes = f$lignes, trajets = f$trajets,
    calendrier = f$calendrier, exceptions_calendrier = NULL,
    date = "20260915")
  expect_error(
    verifier_presence_reseaux(
      presence_mardi, acceptes = RESEAUX_SANS_SERVICE_ACCEPTES_KORRIGO_80335),
    "STAR")
})
