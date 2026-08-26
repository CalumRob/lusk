# presence_reseaux_tc -------------------------------------------------------------
# La PORTE DE PRÉSENCE DE SERVICE du raccordement (issue #485, parent #482 —
# la décision « service-presence gate » de la spec, issue des deux incidents de
# recherche : le millésime Korrigo périmé laissait DOUZE réseaux sombres sur
# toute date de septembre, et les micro-sondages « les autocars ne montent pas »
# ont patiné avant que le constat ne tombe — docs/research/accessibilite-extra-
# communale.md §5a). Une fonction PURE sur des tables GTFS DÉJÀ parsées :
#
#   compter_trajets_actifs_par_reseau(agences, lignes, trajets,
#       calendrier = NULL, exceptions_calendrier = NULL, date) ->
#       agency_id | agency_name | n_trajets_actifs
#
# puis la porte qui refuse la promotion tant qu'un réseau sans service n'est
# pas DOCUMENTÉ :
#
#   verifier_presence_reseaux(presence, acceptes)
#
# Sémantique GTFS (la réalité des deux feeds épinglés, vérifiée à la
# migration #485) : ni KorrigoBret ni l'export SNCF Voyageurs ne portent
# calendar.txt — leurs services REGEN_*/numériques vivent exclusivement en
# calendar_dates (exception_type = 1 ajout, 2 retrait). Le calendrier
# hebdomadaire est donc OPTIONNEL ; quand il existe, une date y est active si
# elle tombe dans [start_date, end_date] ET porte le drapeau du jour de la
# semaine. Les exceptions s'appliquent PAR-DÈS : un type 2 retire même un
# service actif au calendrier, un type 1 ajoute un service sans ligne de
# calendrier.
#
# Deux règles de forme :
#   - TOUS les réseaux du feed sont rapportés — un réseau sombre est une
#     LIGNE À ZÉRO, jamais une absence silencieuse (la porte doit le voir
#     pour le nommer) ;
#   - l'agence d'un trajet remonte par route_id ; une route sans agency_id
#     est attribuée à l'agence unique du feed (la règle GTFS) ou fait échouer
#     bruyamment si le feed en porte plusieurs.

# compter_trajets_actifs_par_reseau ------------------------------------------------
# Les trajets actifs par réseau sur une date cible. `date` est au format GTFS
# natif « YYYYMMDD » (comparaisons de chaînes exactes — jamais de devinette
# de fuseau ni de coercition Date silencieuse).
compter_trajets_actifs_par_reseau <- function(agences, lignes, trajets,
                                              calendrier = NULL,
                                              exceptions_calendrier = NULL,
                                              date) {
  manquer <- function(detail) stop(
    "Porte de présence des réseaux TC — ", detail, call. = FALSE)

  if (!grepl("^[0-9]{8}$", date)) {
    manquer("la date cible doit être au format GTFS « YYYYMMDD »")
  }
  requis_agences <- c("agency_id", "agency_name")
  if (!all(requis_agences %in% names(agences))) {
    manquer(paste0("agency.txt doit porter ",
                   paste(requis_agences, collapse = " / ")))
  }
  if (!all(c("route_id", "agency_id") %in% names(lignes))) {
    manquer("routes.txt doit porter route_id / agency_id")
  }
  if (!all(c("route_id", "service_id") %in% names(trajets))) {
    manquer("trips.txt doit porter route_id / service_id")
  }
  if (!is.null(calendrier) &&
      !all(c("service_id", "monday", "tuesday", "wednesday", "thursday",
             "friday", "saturday", "sunday",
             "start_date", "end_date") %in% names(calendrier))) {
    manquer("calendar.txt doit porter service_id, les sept drapeaux de jour, start_date et end_date")
  }
  if (!is.null(exceptions_calendrier) &&
      !all(c("service_id", "date", "exception_type") %in%
           names(exceptions_calendrier))) {
    manquer("calendar_dates.txt doit porter service_id / date / exception_type")
  }

  # — l'attribution des trajets aux réseaux ------------------------------------
  routes_sans_agence <- is.na(lignes$agency_id) | !nzchar(lignes$agency_id)
  if (any(routes_sans_agence)) {
    if (nrow(agences) == 1L) {
      # la règle GTFS : agency_id optionnel seulement pour un feed mono-agence
      lignes$agency_id[routes_sans_agence] <- agences$agency_id[1]
    } else {
      manquer(paste0(
        "routes.txt porte des lignes sans agency_id alors que le feed liste ",
        nrow(agences), " agences — l'attribution des réseaux est ambiguë"))
    }
  }

  trajets_par_route <- trajets$route_id
  inconnues <- unique(trajets_par_route[!trajets_par_route %in% lignes$route_id])
  if (length(inconnues) > 0) {
    manquer(paste0(
      "trips.txt référence des routes absentes de routes.txt : ",
      paste(inconnues, collapse = ", ")))
  }

  trajets <- dplyr::left_join(
    trajets, lignes[, c("route_id", "agency_id")], by = "route_id")

  # — les services actifs sur la date cible -------------------------------------
  actifs <- character(0)

  # le registre hebdomadaire (optionnel — aucun des deux feeds épinglés ne le
  # porte) : la fenêtre de validité + le drapeau du jour de la semaine
  if (!is.null(calendrier) && nrow(calendrier) > 0) {
    jour_semaine <- format(as.Date(date, format = "%Y%m%d"), "%u") # 1=lundi … 7=dimanche
    drapeau <- c("1" = "monday", "2" = "tuesday", "3" = "wednesday",
                 "4" = "thursday", "5" = "friday", "6" = "saturday",
                 "7" = "sunday")[[jour_semaine]]
    au_calendrier <-
      calendrier$start_date <= date &
      calendrier$end_date >= date &
      calendrier[[drapeau]] == 1
    actifs <- c(actifs, calendrier$service_id[au_calendrier])
  }

  # les exceptions par-dessus : type 1 = ajout (même sans ligne de calendrier),
  # type 2 = retrait (même d'un service actif au calendrier)
  retraits <- character(0)
  if (!is.null(exceptions_calendrier) && nrow(exceptions_calendrier) > 0) {
    ce_jour <- exceptions_calendrier[
      exceptions_calendrier$date == date, , drop = FALSE]
    actifs <- c(actifs, ce_jour$service_id[ce_jour$exception_type == 1])
    retraits <- ce_jour$service_id[ce_jour$exception_type == 2]
  }

  services_actifs <- setdiff(unique(actifs), retraits)

  # — le comptage par réseau, zéros VISIBLES -----------------------------------
  # le facteur est posé sur TOUS les réseaux du feed : un réseau sans aucun
  # trajet actif reste dans la table, à zéro (jamais une absence silencieuse)
  actifs_par_reseau <- trajets$agency_id[
    !is.na(trajets$agency_id) & trajets$service_id %in% services_actifs]
  compte_par_reseau <- table(
    factor(actifs_par_reseau, levels = agences$agency_id))
  tibble::tibble(
    agency_id = agences$agency_id,
    agency_name = agences$agency_name,
    n_trajets_actifs = as.integer(compte_par_reseau)
  )
}

# RESEAUX_SANS_SERVICE_ACCEPTES_KORRIGO_80335 --------------------------------------
# Les écarts DOCUMENTÉS du millésime frais v80335 (constat E2b de la recherche,
# docs/research/accessibilite-extra-communale.md §5b) : sur les dates de
# septembre 2026, seuls ces deux réseaux du Concarneau/Morlaix sont sombres —
# des réseaux dont AUCUN service n'est publié dans le feed à l'horizon chargé.
# Ils sont ACCEPTÉS par décision explicite, nommés ici pour que la porte les
# laisse passer SANS jamais rendre muet un troisième écart. Un nouveau
# millésime devra re-faire ce constat et re-déclarer SA liste.
RESEAUX_SANS_SERVICE_ACCEPTES_KORRIGO_80335 <- c("CORALIE", "LINEOTIML30")

# verifier_presence_reseaux ---------------------------------------------------------
# LA PORTE : les réseaux sans service non-documentés bloquent la promotion.
# `presence` est la sortie de compter_trajets_actifs_par_reseau() ;
# `acceptes` les agency_ids sombres documentés (par défaut la liste v80335).
# Un écart non listé échoue en NOMMANT chaque réseau fautif — l'acquisition
# d'un vintage avec des réseaux sombres non déclarés s'arrête là, jamais plus
# loin dans la machinerie.
verifier_presence_reseaux <- function(presence,
                                      acceptes = RESEAUX_SANS_SERVICE_ACCEPTES_KORRIGO_80335) {
  if (!inherits(presence, "tbl_df") ||
      !all(c("agency_id", "n_trajets_actifs") %in% names(presence))) {
    stop("Porte de présence des réseaux TC — table de présence invalide.",
         call. = FALSE)
  }
  sombres <- presence$agency_id[presence$n_trajets_actifs == 0]
  non_documentes <- setdiff(sombres, acceptes)
  if (length(non_documentes) > 0) {
    noms <- presence$agency_name[match(non_documentes, presence$agency_id)]
    stop(paste0(
      "Porte de présence des réseaux TC — promotion refusée : ",
      length(non_documentes), " réseau(x) sans service sur la date cible, ",
      "non documenté(s) : ",
      paste(sprintf("%s (%s)", non_documentes, noms), collapse = ", "),
      ". Les écarts connus du millésime courant sont ",
      paste(acceptes, collapse = ", "),
      " — un nouveau réseau sombre exige un constat documenté, jamais un ",
      "passage en silence."),
      call. = FALSE)
  }
  invisible(TRUE)
}
