# services_gtfs_a_la_date -------------------------------------------------------
# Résout les services GTFS actifs à une date locale donnée. GTFS autorise
# calendar.txt, calendar_dates.txt, ou les deux ; les exceptions ajoutées ou
# supprimées dans calendar_dates.txt prévalent sur le calendrier hebdomadaire.
# Les heures de départ et l'ordonnancement des arrêts relèvent du routeur, pas
# de cette fonction.
services_gtfs_a_la_date <- function(calendar, calendar_dates, date) {
  exiger_colonnes <- function(table, colonnes, nom) {
    if (is.null(table)) return(invisible(NULL))
    if (!is.data.frame(table) || !all(colonnes %in% names(table))) {
      stop(sprintf("Contrat GTFS violé — %s doit contenir : %s.", nom,
                   paste(colonnes, collapse = ", ")), call. = FALSE)
    }
  }

  date_iso <- as.character(date)
  if (length(date_iso) != 1L || is.na(date_iso) ||
      !grepl("^\\d{4}-?\\d{2}-?\\d{2}$", date_iso)) {
    stop("Date GTFS invalide : attendre YYYY-MM-DD ou YYYYMMDD.",
         call. = FALSE)
  }
  date_iso <- gsub("-", "", date_iso, fixed = TRUE)
  date_obj <- as.Date(date_iso, format = "%Y%m%d")
  if (is.na(date_obj) || format(date_obj, "%Y%m%d") != date_iso) {
    stop("Date GTFS invalide : date calendrier impossible.", call. = FALSE)
  }

  exiger_colonnes(
    calendar,
    c("service_id", "monday", "tuesday", "wednesday", "thursday",
      "friday", "saturday", "sunday", "start_date", "end_date"),
    "calendar.txt"
  )
  exiger_colonnes(calendar_dates,
                  c("service_id", "date", "exception_type"),
                  "calendar_dates.txt")
  if (is.null(calendar) && is.null(calendar_dates)) {
    stop("Contrat GTFS violé — aucun calendrier fourni.", call. = FALSE)
  }

  actifs <- character()
  if (!is.null(calendar) && nrow(calendar)) {
    jour_semaine <- c("monday", "tuesday", "wednesday", "thursday",
                      "friday", "saturday", "sunday")[[
                        as.integer(format(date_obj, "%u"))]]
    debuts <- as.Date(as.character(calendar$start_date), "%Y%m%d")
    fins <- as.Date(as.character(calendar$end_date), "%Y%m%d")
    active <- !is.na(debuts) & !is.na(fins) &
      debuts <= date_obj & fins >= date_obj &
      as.character(calendar[[jour_semaine]]) == "1"
    actifs <- as.character(calendar$service_id[active])
  }

  if (!is.null(calendar_dates) && nrow(calendar_dates)) {
    dates_exception <- gsub("-", "", as.character(calendar_dates$date),
                            fixed = TRUE)
    exceptions <- calendar_dates[dates_exception == date_iso, , drop = FALSE]
    if (nrow(exceptions)) {
      types <- as.character(exceptions$exception_type)
      if (any(!types %in% c("1", "2"))) {
        stop("Contrat GTFS violé — exception_type doit valoir 1 ou 2.",
             call. = FALSE)
      }
      # Le standard interdit plusieurs exceptions pour un service et une date.
      cles <- paste(exceptions$service_id, dates_exception[
        dates_exception == date_iso], sep = "\r")
      if (anyDuplicated(cles)) {
        stop("Contrat GTFS violé — exception service/date dupliquée.",
             call. = FALSE)
      }
      actifs <- union(actifs, as.character(exceptions$service_id[types == "1"]))
      actifs <- setdiff(actifs, as.character(exceptions$service_id[types == "2"]))
    }
  }

  sort(unique(actifs))
}

# heures_gtfs_minutes -----------------------------------------------------------
heures_gtfs_minutes <- function(heures) {
  h <- as.character(heures)
  ok <- grepl("^[0-9]{1,3}:[0-5][0-9]:[0-5][0-9]$", h)
  if (any(!ok | is.na(h))) {
    stop("Contrat GTFS violé — heure attendue H+:MM:SS.", call. = FALSE)
  }
  morceaux <- strsplit(h, ":", fixed = TRUE)
  vapply(morceaux, function(x) as.numeric(x[[1]]) * 60 +
           as.numeric(x[[2]]) + as.numeric(x[[3]]) / 60, numeric(1))
}

# aretes_trajet_gtfs ------------------------------------------------------------
# Les segments adjacents d'un même trip constituent des arêtes ordonnées du
# graphe temporel. Le service doit avoir été résolu pour la date mesurée.
aretes_trajet_gtfs <- function(trips, stop_times, services_actifs) {
  requis_trips <- c("trip_id", "service_id")
  requis_temps <- c("trip_id", "stop_id", "stop_sequence", "arrival_time",
                    "departure_time")
  if (!is.data.frame(trips) || !all(requis_trips %in% names(trips)) ||
      !is.data.frame(stop_times) || !all(requis_temps %in% names(stop_times))) {
    stop("Contrat GTFS violé — trips/stop_times incomplets.", call. = FALSE)
  }
  actifs <- trips[as.character(trips$service_id) %in% services_actifs, , drop = FALSE]
  temps <- stop_times[as.character(stop_times$trip_id) %in% actifs$trip_id,
                      , drop = FALSE]
  if (!nrow(temps)) {
    return(data.frame(from_stop_id = character(), to_stop_id = character(),
                      trip_id = character(), departure_min = numeric(),
                      arrival_min = numeric(), stringsAsFactors = FALSE))
  }
  temps$stop_sequence <- as.numeric(temps$stop_sequence)
  temps <- temps[order(temps$trip_id, temps$stop_sequence), , drop = FALSE]
  groupe <- split(temps, as.character(temps$trip_id))
  aretes <- lapply(groupe, function(t) {
    if (nrow(t) < 2L) return(NULL)
    i <- seq_len(nrow(t) - 1L)
    dep <- heures_gtfs_minutes(t$departure_time[i])
    arr <- heures_gtfs_minutes(t$arrival_time[i + 1L])
    if (any(arr < dep)) {
      stop("Contrat GTFS violé — arrivée avant départ dans stop_times.",
           call. = FALSE)
    }
    data.frame(from_stop_id = as.character(t$stop_id[i]),
               to_stop_id = as.character(t$stop_id[i + 1L]),
               trip_id = as.character(t$trip_id[i]),
               route_id = if ("route_id" %in% names(trips))
                 as.character(trips$route_id[match(as.character(t$trip_id[i]),
                                                    as.character(trips$trip_id))]) else NA_character_,
               departure_min = dep, arrival_min = arr,
               stringsAsFactors = FALSE)
  })
  resultat <- do.call(rbind, aretes[!vapply(aretes, is.null, logical(1))])
  if (is.null(resultat)) {
    return(data.frame(from_stop_id = character(), to_stop_id = character(),
                      trip_id = character(), route_id = character(), departure_min = numeric(),
                      arrival_min = numeric(), stringsAsFactors = FALSE))
  }
  rownames(resultat) <- NULL
  resultat
}

# etendre_regles_transfert_gtfs -------------------------------------------------
# Les règles peuvent viser une station parente. On les projette sur ses quais
# avant de filtrer aux arrêts montables, sans confondre les deux identifiants.
etendre_regles_transfert_gtfs <- function(transfers, stops) {
  if (is.null(transfers) || !nrow(transfers)) return(transfers)
  if (!is.data.frame(stops) ||
      !all(c("stop_id", "location_type") %in% names(stops))) {
    stop("Contrat GTFS violé — arrêts requis pour résoudre les stations parentes.",
         call. = FALSE)
  }
  if (anyDuplicated(stops$stop_id)) stop("stop_id dupliqué dans stops.txt.", call. = FALSE)
  enfants <- if ("parent_station" %in% names(stops)) {
    parent <- as.character(stops$parent_station)
    split(as.character(stops$stop_id[!is.na(parent) & nzchar(parent)]),
          parent[!is.na(parent) & nzchar(parent)])
  } else list()
  feuilles <- function(id) {
    i <- match(id, stops$stop_id)
    if (is.na(i)) stop(sprintf("Référence de transfert inconnue : %s.", id),
                       call. = FALSE)
    type <- as.character(stops$location_type[i])
    if (is.na(type) || type %in% c("", "0")) return(id)
    if (type == "1" && length(enfants[[id]])) return(enfants[[id]])
    stop(sprintf("Référence de transfert GTFS non résolue : %s.", id),
         call. = FALSE)
  }
  sorties <- lapply(seq_len(nrow(transfers)), function(i) {
    f <- feuilles(as.character(transfers$from_stop_id[i]))
    t <- feuilles(as.character(transfers$to_stop_id[i]))
    resultat <- transfers[rep(i, length(f) * length(t)), , drop = FALSE]
    resultat$from_stop_id <- rep(f, each = length(t))
    resultat$to_stop_id <- rep(t, times = length(f))
    resultat
  })
  resultat <- do.call(rbind, sorties)
  verifier_regles_connection_gtfs(resultat)
  resultat
}

# verifier_regles_connection_gtfs ------------------------------------------------
verifier_regles_connection_gtfs <- function(transfers) {
  if (is.null(transfers) || !nrow(transfers)) return(invisible(NULL))
  if (!is.data.frame(transfers) ||
      !all(c("from_stop_id", "to_stop_id", "transfer_type") %in% names(transfers))) {
    stop("Contrat GTFS violé — transfers.txt incomplet.", call. = FALSE)
  }
  types <- as.character(transfers$transfer_type)
  if (any(!types %in% c("0", "1", "2", "3"))) {
    stop("Type de transfert GTFS non pris en charge.", call. = FALSE)
  }
  if (any(types == "1")) {
    stop("Transfert GTFS de type 1 (timed) non pris en charge.", call. = FALSE)
  }
  if (any(types == "2")) {
    if (!"min_transfer_time" %in% names(transfers)) {
      stop("Transfert GTFS de type 2 sans min_transfer_time.", call. = FALSE)
    }
    minimum <- suppressWarnings(as.numeric(transfers$min_transfer_time[types == "2"]))
    if (any(!is.finite(minimum) | minimum < 0)) {
      stop("Transfert GTFS de type 2 avec min_transfer_time invalide.",
           call. = FALSE)
    }
  }
  contraintes <- intersect(c("from_route_id", "to_route_id",
                             "from_trip_id", "to_trip_id"), names(transfers))
  if (length(contraintes) && any(vapply(transfers[contraintes], function(x) {
    any(!is.na(x) & nzchar(as.character(x)))
  }, logical(1)))) {
    stop("Transferts GTFS conditionnés par route/trip non pris en charge.",
         call. = FALSE)
  }
  cle <- paste(transfers$from_stop_id, transfers$to_stop_id, sep = "\r")
  for (g in split(seq_along(cle), cle)) {
    if (length(g) < 2L) next
    types_g <- unique(types[g])
    mins_g <- if ("min_transfer_time" %in% names(transfers))
      unique(as.character(transfers$min_transfer_time[g][types[g] == "2"])) else character()
    if (length(types_g) > 1L || length(mins_g) > 1L) {
      stop("Règles GTFS contradictoires pour la même paire d'arrêts.",
           call. = FALSE)
    }
  }
  invisible(NULL)
}

# aretes_transfert_gtfs ---------------------------------------------------------
# Proximité à vol d'oiseau, plafonnée au rayon contractuel ; marche au pas
# constant déclaré. Les transferts GTFS type 0/2 explicites sont ajoutés même
# hors rayon (la durée reste mesurée), type 2 impose un minimum, type 3 interdit.
# Type 1 (timed), types GTFS inconnus et contraintes route/trip échouent
# explicitement : ils ne sont pas assimilés à une simple marche.
aretes_transfert_gtfs <- function(stops, transfers = NULL, rayon_m = 300,
                                  vitesse_marche_kmh = 4) {
  if (!is.data.frame(stops) ||
      !all(c("stop_id", "stop_lat", "stop_lon") %in% names(stops))) {
    stop("Contrat GTFS violé — stops doit fournir id, latitude et longitude.",
         call. = FALSE)
  }
  if (length(rayon_m) != 1L || !is.finite(rayon_m) || rayon_m < 0 ||
      length(vitesse_marche_kmh) != 1L || !is.finite(vitesse_marche_kmh) ||
      vitesse_marche_kmh <= 0) {
    stop("Paramètres transfert invalides — rayon >= 0 et vitesse > 0.",
         call. = FALSE)
  }
  if (!is.null(transfers)) {
    verifier_regles_connection_gtfs(transfers)
    transfers <- etendre_regles_transfert_gtfs(transfers, stops)
  }
  s <- stops
  if ("location_type" %in% names(s)) {
    s <- s[is.na(s$location_type) | as.character(s$location_type) %in% c("", "0"), ,
           drop = FALSE]
  }
  s$stop_lat <- as.numeric(s$stop_lat)
  s$stop_lon <- as.numeric(s$stop_lon)
  s <- s[is.finite(s$stop_lat) & is.finite(s$stop_lon), , drop = FALSE]
  if (anyDuplicated(s$stop_id)) stop("stop_id dupliqué dans stops.txt.", call. = FALSE)
  if (nrow(s) < 2L || rayon_m == 0) {
    paires <- data.frame(from_stop_id = character(), to_stop_id = character(),
                         walk_m = numeric(), stringsAsFactors = FALSE)
  } else {
    points <- sf::st_as_sf(s, coords = c("stop_lon", "stop_lat"), crs = 4326,
                           remove = FALSE)
    points <- sf::st_transform(points, 2154)
    voisinage <- sf::st_is_within_distance(points, points, dist = rayon_m)
    ii <- rep(seq_along(voisinage), lengths(voisinage))
    jj <- unlist(voisinage, use.names = FALSE)
    garder <- ii != jj
    ii <- ii[garder]; jj <- jj[garder]
    xy <- sf::st_coordinates(points)
    distance <- sqrt((xy[ii, 1] - xy[jj, 1])^2 + (xy[ii, 2] - xy[jj, 2])^2)
    paires <- data.frame(from_stop_id = as.character(s$stop_id[ii]),
                         to_stop_id = as.character(s$stop_id[jj]),
                         walk_m = distance, stringsAsFactors = FALSE)
  }
  if (!is.null(transfers) && nrow(transfers)) {
    types <- as.character(transfers$transfer_type)
    interdits <- transfers[types == "3", c("from_stop_id", "to_stop_id"),
                           drop = FALSE]
    if (nrow(interdits)) {
      cle_interdit <- paste(interdits$from_stop_id, interdits$to_stop_id, sep = "\r")
      paires <- paires[!paste(paires$from_stop_id, paires$to_stop_id,
                              sep = "\r") %in% cle_interdit, , drop = FALSE]
    }
    regles <- transfers[types %in% c("0", "2"), , drop = FALSE]
    if (nrow(regles)) {
      paires_id <- paste(paires$from_stop_id, paires$to_stop_id, sep = "\r")
      regle_id <- paste(regles$from_stop_id, regles$to_stop_id, sep = "\r")
      explicit <- regles$from_stop_id != regles$to_stop_id &
        !regle_id %in% paires_id
      if (any(explicit)) {
        from_i <- match(regles$from_stop_id[explicit], s$stop_id)
        to_i <- match(regles$to_stop_id[explicit], s$stop_id)
        valide <- !is.na(from_i) & !is.na(to_i)
        if (any(valide)) {
          a <- sf::st_as_sf(s[from_i[valide], , drop = FALSE],
                            coords = c("stop_lon", "stop_lat"), crs = 4326)
          b <- sf::st_as_sf(s[to_i[valide], , drop = FALSE],
                            coords = c("stop_lon", "stop_lat"), crs = 4326)
          a <- sf::st_transform(a, 2154); b <- sf::st_transform(b, 2154)
          d <- as.numeric(sf::st_distance(a, b, by_element = TRUE))
          paires <- rbind(paires, data.frame(
            from_stop_id = regles$from_stop_id[explicit][valide],
            to_stop_id = regles$to_stop_id[explicit][valide], walk_m = d))
        }
      }
    }
  }
  paires$transfer_type <- rep("distance", nrow(paires))
  if (nrow(paires) && !is.null(transfers)) {
    id_rule <- paste(transfers$from_stop_id, transfers$to_stop_id, sep = "\r")
    id_edge <- paste(paires$from_stop_id, paires$to_stop_id, sep = "\r")
    j <- match(id_edge, id_rule)
    hit <- !is.na(j)
    paires$transfer_type[hit] <- as.character(transfers$transfer_type[j[hit]])
    type2 <- hit & as.character(transfers$transfer_type[pmax(j, 1)]) == "2"
    if (any(type2) && "min_transfer_time" %in% names(transfers)) {
      minimum <- as.numeric(transfers$min_transfer_time[j[type2]]) / 60
      minimum[!is.finite(minimum)] <- 0
      paires$walk_m[type2] <- pmax(paires$walk_m[type2],
                                    minimum * vitesse_marche_kmh * 1000 / 60)
    }
  }
  paires$duration_min <- paires$walk_m * 60 / (vitesse_marche_kmh * 1000)
  attr(paires, "regles_transfert") <- transfers
  paires
}

# meilleur_trajet_gtfs ----------------------------------------------------------
# Minimise la durée écoulée d'un trajet dont le premier embarquement a lieu
# dans la fenêtre [début, fin). Aucun transfert à pied n'est permis avant le
# premier ou après le dernier trajet : les arrêts fournis sont les endpoints.
meilleurs_trajets_gtfs_multi_destination <- function(
    rides, transfers, origine, destinations, debut_fenetre, fin_fenetre,
    regles_transfert = NULL, ids_stops = NULL) {
  requis <- c("from_stop_id", "to_stop_id", "trip_id", "departure_min", "arrival_min")
  if (!is.data.frame(rides) || !all(requis %in% names(rides)) ||
      !is.data.frame(transfers) ||
      !all(c("from_stop_id", "to_stop_id", "duration_min") %in% names(transfers))) {
    stop("Contrat routeur GTFS violé — arêtes incomplètes.", call. = FALSE)
  }
  if (is.null(regles_transfert)) {
    regles_transfert <- attr(transfers, "regles_transfert", exact = TRUE)
  }
  verifier_regles_connection_gtfs(regles_transfert)
  ids_connus <- unique(c(as.character(ids_stops),
                         as.character(rides$from_stop_id),
                         as.character(rides$to_stop_id),
                         as.character(transfers$from_stop_id),
                         as.character(transfers$to_stop_id)))
  if (!is.null(regles_transfert) && nrow(regles_transfert) &&
      any(!regles_transfert$from_stop_id %in% ids_connus |
          !regles_transfert$to_stop_id %in% ids_connus)) {
    stop("Référence de transfert hors du graphe; résoudre les stations parentes avant routage.",
         call. = FALSE)
  }
  parse_hm <- function(x) {
    if (length(x) != 1L || is.na(x) ||
        !grepl("^[0-9]{1,3}:[0-5][0-9]$", x)) {
      stop("Fenêtre GTFS invalide — attendre H+:MM.", call. = FALSE)
    }
    z <- as.numeric(strsplit(x, ":", fixed = TRUE)[[1]])
    z[1] * 60 + z[2]
  }
  debut <- parse_hm(debut_fenetre); fin <- parse_hm(fin_fenetre)
  if (fin <= debut) stop("Fenêtre GTFS vide ou inversée.", call. = FALSE)
  if (!is.list(destinations) || is.null(names(destinations)) ||
      any(!nzchar(names(destinations)))) {
    stop("Destinations GTFS attendues comme liste nommée d'ensembles d'arrêts.",
         call. = FALSE)
  }
  origines <- as.character(origine)
  target_stops <- unlist(destinations, use.names = FALSE)
  target_names <- rep(names(destinations), lengths(destinations))
  targets_by_stop <- split(target_names, target_stops)
  meilleurs <- setNames(rep(list(NULL), length(destinations)), names(destinations))
  for (name in names(destinations)) {
    if (length(intersect(origines, as.character(destinations[[name]])))) {
      meilleurs[[name]] <- list(travel_time_min = 0, departure_min = NA_real_,
                                arrival_min = NA_real_)
    }
  }
  departures <- rides[rides$from_stop_id %in% origines &
                        rides$departure_min >= debut & rides$departure_min < fin, ,
                      drop = FALSE]
  if (!nrow(departures)) {
    return(lapply(meilleurs, function(x) if (is.null(x)) {
      list(travel_time_min = NA_real_, departure_min = NA_real_, arrival_min = NA_real_)
    } else x))
  }
  par_arret <- split(rides, as.character(rides$from_stop_id))
  transferts_par_arret <- split(seq_len(nrow(transfers)),
                                as.character(transfers$from_stop_id))
  if (is.null(regles_transfert)) regles_transfert <- data.frame(
    from_stop_id = character(), to_stop_id = character(), transfer_type = character())
  cle_regles <- paste(regles_transfert$from_stop_id,
                      regles_transfert$to_stop_id, sep = "\r")
  duree_regle <- function(from, to) {
    i <- match(paste(from, to, sep = "\r"), cle_regles)
    if (is.na(i)) return(0)
    type <- as.character(regles_transfert$transfer_type[i])
    if (type == "3") return(Inf)
    if (type == "2" && "min_transfer_time" %in% names(regles_transfert)) {
      minimum <- suppressWarnings(as.numeric(regles_transfert$min_transfer_time[i]))
      if (is.finite(minimum)) return(minimum / 60)
    }
    0
  }
  charger_rides <- function(arret, pret) {
    rr <- par_arret[[arret]]
    if (is.null(rr)) return(rides[FALSE, , drop = FALSE])
    rr[rr$departure_min >= pret, , drop = FALSE]
  }
  frontieres <- list(); file <- list()
  enregistrer <- function(target, depart, arrivee) {
    duree <- arrivee - depart
    ancien <- meilleurs[[target]]
    if (is.null(ancien) || duree < ancien$travel_time_min) {
      meilleurs[[target]] <<- list(travel_time_min = duree,
                                    departure_min = depart,
                                    arrival_min = arrivee)
    }
  }
  propager <- function(arret, trip, arrivee, depart) {
    cle <- paste(arret, trip, sep = "\r")
    duree <- arrivee - depart
    existants <- frontieres[[cle]]
    if (!is.null(existants) && any(existants$arrival_min <= arrivee &
                                   existants$travel_time_min <= duree)) return(FALSE)
    if (is.null(existants)) existants <- data.frame(
      arrival_min = numeric(), travel_time_min = numeric(), departure_min = numeric())
    garder <- !(existants$arrival_min >= arrivee &
                existants$travel_time_min >= duree)
    frontieres[[cle]] <<- rbind(existants[garder, , drop = FALSE], data.frame(
      arrival_min = arrivee, travel_time_min = duree, departure_min = depart))
    file[[length(file) + 1L]] <<- list(stop = arret, trip = trip,
                                       arrival = arrivee, departure = depart)
    TRUE
  }
  for (i in seq_len(nrow(departures))) {
    dest <- as.character(departures$to_stop_id[i])
    dep <- departures$departure_min[i]; arr <- departures$arrival_min[i]
    cibles <- targets_by_stop[[dest]]
    if (length(cibles)) for (target in cibles) enregistrer(target, dep, arr)
    propager(dest, as.character(departures$trip_id[i]), arr, dep)
  }
  lu <- 1L
  while (lu <= length(file)) {
    item <- file[[lu]]; lu <- lu + 1L
    arret <- item$stop; incoming_trip <- item$trip
    arrivee <- item$arrival; depart <- item$departure
    cle <- paste(arret, incoming_trip, sep = "\r")
    frontiere <- frontieres[[cle]]
    encore_actif <- any(frontiere$arrival_min == arrivee &
                          frontiere$travel_time_min == arrivee - depart &
                          frontiere$departure_min == depart)
    if (!encore_actif) next
    candidats <- list(list(stop = arret, walk = 0))
    ids_t <- transferts_par_arret[[arret]]
    if (length(ids_t)) {
      tt <- transfers[ids_t, , drop = FALSE]
      candidats <- c(candidats, lapply(seq_len(nrow(tt)), function(j) {
        list(stop = as.character(tt$to_stop_id[j]),
             walk = as.numeric(tt$duration_min[j]))
      }))
    }
    for (candidate in candidats) {
      ready_marche <- arrivee + candidate$walk
      rr <- charger_rides(candidate$stop, ready_marche)
      if (!nrow(rr)) next
      for (j in seq_len(nrow(rr))) {
        outgoing_trip <- as.character(rr$trip_id[j])
        same_trip <- identical(outgoing_trip, incoming_trip)
        continuation <- identical(candidate$stop, arret) && same_trip
        if (same_trip && !continuation) next
        minimum <- if (continuation) 0 else duree_regle(arret, candidate$stop)
        if (!is.finite(minimum)) next
        ready <- arrivee + max(candidate$walk, minimum)
        if (rr$departure_min[j] < ready) next
        dest <- as.character(rr$to_stop_id[j]); arr <- rr$arrival_min[j]
        cibles <- targets_by_stop[[dest]]
        if (length(cibles)) for (target in cibles) enregistrer(target, depart, arr)
        propager(dest, outgoing_trip, arr, depart)
      }
    }
  }
  lapply(meilleurs, function(x) {
    if (is.null(x)) list(travel_time_min = NA_real_, departure_min = NA_real_,
                         arrival_min = NA_real_) else x
  })
}

meilleur_trajet_gtfs <- function(rides, transfers, origine, destination,
                                 debut_fenetre, fin_fenetre,
                                 regles_transfert = NULL, ids_stops = NULL) {
  resultats <- meilleurs_trajets_gtfs_multi_destination(
    rides, transfers, origine, list(destination = destination),
    debut_fenetre, fin_fenetre, regles_transfert, ids_stops
  )
  resultats$destination
}

# rechercher_trajets_gtfs_compiled ---------------------------------------------
# Scan chronologique des connexions en C++ (multi-source / multi-destination).
# Les arrivées successives restent labels non dominés par arrêt et dernier trip.
rechercher_trajets_gtfs_compiled <- function(
    rides, transfers, origine, destinations, debut_fenetre, fin_fenetre,
    regles_transfert = NULL, ids_stops = NULL) {
  if (is.null(regles_transfert)) {
    regles_transfert <- attr(transfers, "regles_transfert", exact = TRUE)
  }
  verifier_regles_connection_gtfs(regles_transfert)
  if (is.null(regles_transfert)) {
    regles_transfert <- data.frame(
      from_stop_id = character(), to_stop_id = character(),
      transfer_type = character(), stringsAsFactors = FALSE)
  }
  if (!is.null(ids_stops) && nrow(regles_transfert) &&
      any(!regles_transfert$from_stop_id %in% ids_stops |
          !regles_transfert$to_stop_id %in% ids_stops)) {
    stop("Référence de règle de transfert hors de stops.txt.", call. = FALSE)
  }
  minute <- function(x) {
    if (length(x) != 1L || is.na(x) ||
        !grepl("^[0-9]{1,3}:[0-5][0-9]$", x)) {
      stop("Fenêtre GTFS invalide — attendre H+:MM.", call. = FALSE)
    }
    z <- as.numeric(strsplit(x, ":", fixed = TRUE)[[1]])
    z[1] * 60 + z[2]
  }
  debut <- minute(debut_fenetre); fin <- minute(fin_fenetre)
  if (fin <= debut) stop("Fenêtre GTFS vide ou inversée.", call. = FALSE)
  csa_multi_target(rides, transfers, as.character(origine), destinations,
                   debut, fin, regles_transfert)
}

# executer_experience_raccordement_gtfs ----------------------------------------
# Une exécution expérimentale, pour un rayon de correspondance et un ensemble
# d'origines : chaque origine est routée une seule fois vers tous les territoires.
# La sortie conserve les réponses par couple et les diagnostics permettant de
# comparer les rayons avant d'élargir l'expérience.
executer_experience_raccordement_gtfs <- function(
    rides, stops, origines, destinations, rayon_m,
    vitesse_marche_kmh = 3, regles_transfert = NULL,
    debut_fenetre = "07:00", fin_fenetre = "20:00") {
  verifier_stop_sets <- function(x, label) {
    if (!is.list(x) || is.null(names(x)) || !length(x) ||
        anyNA(names(x)) || any(!nzchar(names(x))) || anyDuplicated(names(x))) {
      stop(label, " doit être une liste nommée non vide de stop sets.",
           call. = FALSE)
    }
    invisible(NULL)
  }
  verifier_stop_sets(origines, "origines")
  verifier_stop_sets(destinations, "destinations")

  temps_transferts <- system.time({
    transferts <- aretes_transfert_gtfs(
      stops, regles_transfert, rayon_m = rayon_m,
      vitesse_marche_kmh = vitesse_marche_kmh
    )
  })[["elapsed"]]

  temps_routes <- vector("list", length(origines))
  lignes_journeys <- vector("list", length(origines))
  for (i in seq_along(origines)) {
    temps <- system.time({
      route <- rechercher_trajets_gtfs_compiled(
        rides, transferts, origines[[i]], destinations,
        debut_fenetre, fin_fenetre, regles_transfert,
        ids_stops = stops$stop_id
      )
    })[["elapsed"]]
    journeys <- route$journeys
    lignes_journeys[[i]] <- do.call(rbind, lapply(names(destinations), function(id) {
      j <- journeys[[id]]
      data.frame(
        origin_id = names(origines)[i], destination_id = id,
        transfer_radius_m = rayon_m,
        walking_speed_kmh = vitesse_marche_kmh,
        travel_time_min = j$travel_time_min,
        departure_min = j$departure_min,
        arrival_min = j$arrival_min,
        transfers = j$transfers,
        walking_transfers = j$walking_transfers,
        stringsAsFactors = FALSE
      )
    }))
    temps_routes[[i]] <- data.frame(
      origin_id = names(origines)[i],
      transfer_radius_m = rayon_m,
      walking_speed_kmh = vitesse_marche_kmh,
      search_seconds = temps,
      transfer_build_seconds = temps_transferts,
      transfer_edges = route$metrics$transfer_edges,
      connections_scanned = route$metrics$connections_scanned,
      labels_inserted = route$metrics$labels_inserted,
      labels_retained = route$metrics$labels_retained,
      label_checks = route$metrics$label_checks,
      labels_examined = route$metrics$labels_examined,
      stale_labels_examined = route$metrics$stale_labels_examined,
      labels_compacted = route$metrics$labels_compacted,
      stringsAsFactors = FALSE
    )
  }

  list(
    journeys = do.call(rbind, lignes_journeys),
    diagnostics = do.call(rbind, temps_routes),
    transfer_edges = transferts
  )
}
