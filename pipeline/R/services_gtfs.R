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
               departure_min = dep, arrival_min = arr,
               stringsAsFactors = FALSE)
  })
  resultat <- do.call(rbind, aretes[!vapply(aretes, is.null, logical(1))])
  if (is.null(resultat)) {
    return(data.frame(from_stop_id = character(), to_stop_id = character(),
                      trip_id = character(), departure_min = numeric(),
                      arrival_min = numeric(), stringsAsFactors = FALSE))
  }
  rownames(resultat) <- NULL
  resultat
}

# aretes_transfert_gtfs ---------------------------------------------------------
# Proximité à vol d'oiseau, plafonnée au rayon contractuel ; marche au pas
# constant déclaré. Les règles stop-à-stop explicites prévalent : type 3
# interdit, type 2 impose une durée minimale. Les contraintes par route/trip ne
# sont pas modélisées et sont refusées pour éviter de les ignorer en silence.
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
    requis <- c("from_stop_id", "to_stop_id", "transfer_type")
    if (!is.data.frame(transfers) || !all(requis %in% names(transfers))) {
      stop("Contrat GTFS violé — transfers.txt incomplet.", call. = FALSE)
    }
    contraintes <- intersect(c("from_route_id", "to_route_id",
                               "from_trip_id", "to_trip_id"), names(transfers))
    if (length(contraintes) && any(vapply(transfers[contraintes], function(x) {
      any(!is.na(x) & nzchar(as.character(x)))
    }, logical(1)))) {
      stop("Transferts GTFS conditionnés par route/trip non pris en charge.",
           call. = FALSE)
    }
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
    if (any(!types %in% c("0", "1", "2", "3"))) {
      stop("Type de transfert GTFS non pris en charge.", call. = FALSE)
    }
    interdits <- transfers[types == "3", c("from_stop_id", "to_stop_id"),
                          drop = FALSE]
    if (nrow(interdits)) {
      cle_interdit <- paste(interdits$from_stop_id, interdits$to_stop_id, sep = "\r")
      paires <- paires[!paste(paires$from_stop_id, paires$to_stop_id,
                              sep = "\r") %in% cle_interdit, , drop = FALSE]
    }
    regles <- transfers[types %in% c("1", "2"), , drop = FALSE]
    if (nrow(regles)) {
      regle_id <- paste(regles$from_stop_id, regles$to_stop_id, sep = "\r")
      paires_id <- paste(paires$from_stop_id, paires$to_stop_id, sep = "\r")
      for (i in seq_len(nrow(regles))) {
        hit <- which(paires_id == regle_id[i])
        if (!length(hit)) {
          from <- s[s$stop_id == regles$from_stop_id[i], , drop = FALSE]
          to <- s[s$stop_id == regles$to_stop_id[i], , drop = FALSE]
          if (nrow(from) && nrow(to)) {
            from_pt <- sf::st_transform(sf::st_as_sf(from, coords = c("stop_lon", "stop_lat"), crs = 4326), 2154)
            to_pt <- sf::st_transform(sf::st_as_sf(to, coords = c("stop_lon", "stop_lat"), crs = 4326), 2154)
            d <- as.numeric(sf::st_distance(from_pt, to_pt))
            paires <- rbind(paires, data.frame(
              from_stop_id = regles$from_stop_id[i],
              to_stop_id = regles$to_stop_id[i], walk_m = d))
            hit <- nrow(paires)
            paires_id <- c(paires_id, regle_id[i])
          }
        }
        if (length(hit) && as.character(regles$transfer_type[i]) == "2") {
          minimum <- if ("min_transfer_time" %in% names(regles))
            as.numeric(regles$min_transfer_time[i]) / 60 else 0
          if (!is.finite(minimum)) minimum <- 0
          paires$walk_m[hit] <- max(paires$walk_m[hit], minimum *
                                      vitesse_marche_kmh * 1000 / 60)
        }
      }
    }
  }
  paires$duration_min <- paires$walk_m * 60 / (vitesse_marche_kmh * 1000)
  paires$transfer_type <- "distance"
  if (nrow(paires) && !is.null(transfers)) {
    id_rule <- paste(transfers$from_stop_id, transfers$to_stop_id, sep = "\r")
    id_edge <- paste(paires$from_stop_id, paires$to_stop_id, sep = "\r")
    for (i in which(id_edge %in% id_rule)) {
      j <- match(id_edge[i], id_rule)
      paires$transfer_type[i] <- as.character(transfers$transfer_type[j])
    }
  }
  paires
}

# meilleur_trajet_gtfs ----------------------------------------------------------
# Minimise la durée écoulée d'un trajet dont le premier embarquement a lieu
# dans la fenêtre [début, fin). Aucun transfert à pied n'est permis avant le
# premier ou après le dernier trajet : les arrêts fournis sont les endpoints.
meilleur_trajet_gtfs <- function(rides, transfers, origine, destination,
                                 debut_fenetre, fin_fenetre) {
  requis <- c("from_stop_id", "to_stop_id", "departure_min", "arrival_min")
  if (!is.data.frame(rides) || !all(requis %in% names(rides)) ||
      !is.data.frame(transfers) ||
      !all(c("from_stop_id", "to_stop_id", "duration_min") %in% names(transfers))) {
    stop("Contrat routeur GTFS violé — arêtes incomplètes.", call. = FALSE)
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
  origines <- as.character(origine); destinations <- as.character(destination)
  if (length(intersect(origines, destinations))) {
    return(list(travel_time_min = 0, departure_min = NA_real_, arrival_min = NA_real_))
  }
  departures <- rides[rides$from_stop_id %in% origines &
                        rides$departure_min >= debut & rides$departure_min < fin, ,
                      drop = FALSE]
  meilleurs <- list()
  if (!nrow(departures)) {
    return(list(travel_time_min = NA_real_, departure_min = NA_real_, arrival_min = NA_real_))
  }
  par_arret <- split(rides, as.character(rides$from_stop_id))
  transferts_par_arret <- split(seq_len(nrow(transfers)),
                                as.character(transfers$from_stop_id))
  charger_rides <- function(arret, pret) {
    rr <- par_arret[[arret]]
    if (is.null(rr)) return(rides[FALSE, , drop = FALSE])
    rr[rr$departure_min >= pret, , drop = FALSE]
  }
  actualiser <- function(depart, meilleurs) {
    atteints <- numeric(); file <- list()
    propager <- function(arret, heure) {
      if (!arret %in% names(atteints) || heure < atteints[[arret]]) {
        atteints[arret] <<- heure
        file[[length(file) + 1L]] <<- c(arret = arret, heure = heure)
      }
    }
    for (i in which(departures$departure_min == depart)) {
      dest <- as.character(departures$to_stop_id[i])
      arr <- departures$arrival_min[i]
      if (dest %in% destinations) {
        meilleurs[[length(meilleurs) + 1L]] <- c(depart = depart, arrivee = arr)
      }
      propager(dest, arr)
    }
    lu <- 1L
    while (lu <= length(file)) {
      item <- file[[lu]]; lu <- lu + 1L
      arret <- unname(item[["arret"]]); arrivee <- as.numeric(item[["heure"]])
      if (atteints[[arret]] < arrivee) next
      candidats <- list(list(stop = arret, ready = arrivee))
      ids_t <- transferts_par_arret[[arret]]
      if (length(ids_t)) {
        tt <- transfers[ids_t, , drop = FALSE]
        candidats <- c(candidats, lapply(seq_len(nrow(tt)), function(j) {
          list(stop = as.character(tt$to_stop_id[j]),
               ready = arrivee + as.numeric(tt$duration_min[j]))
        }))
      }
      for (candidate in candidats) {
        rr <- charger_rides(candidate$stop, candidate$ready)
        if (!nrow(rr)) next
        for (j in seq_len(nrow(rr))) {
          dest <- as.character(rr$to_stop_id[j]); arr <- rr$arrival_min[j]
          if (dest %in% destinations) {
            meilleurs[[length(meilleurs) + 1L]] <- c(depart = depart,
                                                     arrivee = arr)
          }
          propager(dest, arr)
        }
      }
    }
    list(meilleurs = meilleurs)
  }
  for (depart in sort(unique(departures$departure_min))) {
    meilleurs <- actualiser(depart, meilleurs)$meilleurs
  }
  if (!length(meilleurs)) {
    return(list(travel_time_min = NA_real_, departure_min = NA_real_, arrival_min = NA_real_))
  }
  resultats <- do.call(rbind, meilleurs)
  durees <- resultats[, "arrivee"] - resultats[, "depart"]
  k <- which.min(durees)
  list(travel_time_min = unname(durees[k]),
       departure_min = unname(resultats[k, "depart"]),
       arrival_min = unname(resultats[k, "arrivee"]))
}
