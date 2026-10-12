# Construire la matrice dirigée à partir des seams publics du routeur GTFS.
# Une ligne NA reste un OD non joignable; aucun résultat ni diagonale n'est inventé.
construire_matrice_trajets_gtfs <- function(
    rides, transfers, origins, destinations, debut_fenetre, fin_fenetre,
    regles_transfert = NULL, ids_stops = NULL) {
  verifier_stop_sets <- function(x, label) {
    if (!is.list(x) || !length(x) || is.null(names(x)) ||
        anyNA(names(x)) || any(!nzchar(names(x))) || anyDuplicated(names(x))) {
      stop(label, " doit être une liste nommée non vide de stop sets.",
           call. = FALSE)
    }
  }
  verifier_stop_sets(origins, "origins")
  verifier_stop_sets(destinations, "destinations")

  lignes <- lapply(names(origins), function(origin_id) {
    search <- rechercher_trajets_gtfs_compiled(
      rides, transfers, origins[[origin_id]], destinations,
      debut_fenetre, fin_fenetre, regles_transfert, ids_stops
    )
    if (!is.list(search$journeys) ||
        !identical(names(search$journeys), names(destinations))) {
      stop("Le routeur n'a pas rendu exactement les destinations demandées pour ",
           origin_id, ".", call. = FALSE)
    }
    do.call(rbind, lapply(names(destinations), function(destination_id) {
      journey <- search$journeys[[destination_id]]
      elapsed <- as.numeric(journey$travel_time_min)
      reachable <- length(elapsed) == 1L && !is.na(elapsed)
      data.frame(
        origin_id = as.character(origin_id),
        destination_id = as.character(destination_id),
        reachable = reachable,
        travel_time_min = if (reachable) elapsed else NA_real_,
        departure_min = if (reachable) as.numeric(journey$departure_min) else NA_real_,
        arrival_min = if (reachable) as.numeric(journey$arrival_min) else NA_real_,
        transfers = if (reachable) as.integer(journey$transfers) else NA_integer_,
        walking_transfers = if (reachable) as.integer(journey$walking_transfers) else NA_integer_,
        stringsAsFactors = FALSE
      )
    }))
  })
  matrix <- do.call(rbind, lignes)
  rownames(matrix) <- NULL

  expected_rows <- length(origins) * length(destinations)
  if (nrow(matrix) != expected_rows ||
      anyDuplicated(matrix[c("origin_id", "destination_id")]) ||
      !identical(matrix$origin_id,
        rep(names(origins), each = length(destinations))) ||
      !identical(matrix$destination_id,
        rep(names(destinations), times = length(origins)))) {
    stop("La matrice GTFS n'a pas exactement une réponse dirigée par OD.",
         call. = FALSE)
  }
  reachable <- matrix$reachable
  if (any(!is.finite(matrix$travel_time_min[reachable])) ||
      any(matrix$travel_time_min[reachable] < 0) ||
      any(!is.na(matrix$travel_time_min[!reachable])) ||
      any(!is.na(matrix$departure_min[!reachable])) ||
      any(!is.na(matrix$arrival_min[!reachable])) ||
      any(!is.na(matrix$transfers[!reachable])) ||
      any(!is.na(matrix$walking_transfers[!reachable])) ||
      any(matrix$transfers[reachable] < 0) ||
      any(matrix$walking_transfers[reachable] < 0) ||
      any(matrix$walking_transfers[reachable] > matrix$transfers[reachable])) {
    stop("La matrice GTFS a des résultats de trajet incohérents avec reachability.",
         call. = FALSE)
  }
  self_zero <- matrix$reachable &
    matrix$origin_id == matrix$destination_id & matrix$travel_time_min == 0
  timed <- matrix$reachable & !self_zero
  if (any(!is.finite(matrix$departure_min[timed])) ||
      any(!is.finite(matrix$arrival_min[timed])) ||
      any(abs(matrix$travel_time_min[timed] -
        (matrix$arrival_min[timed] - matrix$departure_min[timed])) > 1e-8) ||
      any(matrix$departure_min[timed] < 420 | matrix$departure_min[timed] >= 1200)) {
    stop("La matrice GTFS viole le contrat de temps de trajet / fenêtre de départ.",
         call. = FALSE)
  }
  if (any(self_zero & (!is.na(matrix$departure_min) | !is.na(matrix$arrival_min)))) {
    stop("La politique de diagonale nulle du routeur a changé.", call. = FALSE)
  }
  matrix
}
