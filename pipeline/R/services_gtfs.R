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
