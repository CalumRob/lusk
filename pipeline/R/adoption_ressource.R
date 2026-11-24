# Adoption d'une Ressource semantique de service (ADR-0049 step 2, #1142).
# La comparaison est exacte sur les lignes projetees par l'adaptateur de forme.
# Elle ne connait aucune table et ne contient aucune branche par forme.

# PostgreSQL dates, integer64 counts and numeric SQL values must compare by
# value, not by an R storage class chosen by the driver. Row order is not data.
normaliser_valeur_adoption <- function(x) {
  if (inherits(x, "integer64")) x <- as.integer(as.character(x))
  if (inherits(x, "Date")) x <- as.character(x)
  if (inherits(x, "POSIXt")) x <- format(x, "%Y-%m-%dT%H:%M:%OS6", tz = "UTC")
  if (is.numeric(x)) x <- as.numeric(x)
  x
}

normaliser_adoption <- function(x) {
  if (is.data.frame(x)) {
    x <- as.data.frame(lapply(x, normaliser_valeur_adoption), stringsAsFactors = FALSE,
                       optional = TRUE)
    if (nrow(x) > 1L) {
      keys <- vapply(seq_len(nrow(x)), function(i)
        paste(as.integer(serialize(x[i, , drop = FALSE], NULL)), collapse = ","),
        character(1))
      x <- x[order(keys), , drop = FALSE]
    }
    rownames(x) <- NULL
    return(x)
  }
  if (is.list(x)) {
    x <- x[!vapply(x, is.null, logical(1))]
    return(lapply(x, normaliser_adoption))
  }
  normaliser_valeur_adoption(x)
}

comparer_valeur_adoption <- function(attendu, live, ignore = character()) {
  if (is.data.frame(attendu) || is.data.frame(live)) {
    if (!is.data.frame(attendu) || !is.data.frame(live)) return(FALSE)
    if (length(setdiff(names(live), c(names(attendu), ignore)))) return(FALSE)
    # Extra built columns are real artefact content and must not disappear.
    if (length(setdiff(names(attendu), c(names(live), ignore)))) return(FALSE)
    colonnes <- intersect(names(live), names(attendu))
    colonnes <- setdiff(colonnes, ignore)
    attendu <- attendu[, colonnes, drop = FALSE]
    live <- live[, colonnes, drop = FALSE]
    return(identical(normaliser_adoption(attendu), normaliser_adoption(live)))
  }
  identical(normaliser_adoption(attendu), normaliser_adoption(live))
}

# NULL comparison and an empty comparison row set are the same absence. AEDAR's
# littoral sibling uses NULL before the extension and a zero-row frame after a
# current publication; neither contains a fact.
absence_comparaison <- function(x) {
  is.null(x) || (is.list(x) && all(vapply(x, function(part)
    is.null(part) || (is.data.frame(part) && nrow(part) == 0L), logical(1))))
}

comparer_ressource_adoptation <- function(attendu, live, handler) {
  if (!is.list(attendu) || !is.list(live) || !is.list(handler))
    stop("Adoption comparison requires projected live and artefact rows", call. = FALSE)
  parties <- character()
  for (champ in handler$champs_live) {
    a <- attendu[[champ]]
    b <- live[[champ]]
    if (identical(champ, "comparison")) {
      if (absence_comparaison(a) && absence_comparaison(b)) next
      if (absence_comparaison(a) || absence_comparaison(b)) {
        parties <- c(parties, "comparison")
        next
      }
      for (partie in handler$champs_comparaison) {
        if (!comparer_valeur_adoption(a[[partie]], b[[partie]]))
          parties <- c(parties, paste0("comparison.", partie))
      }
      next
    }
    ignore <- as.character(handler$colonnes_stockage[[champ]] %||% character())
    if (!comparer_valeur_adoption(a, b, ignore))
      parties <- c(parties, if (identical(champ, "projection")) "facts" else champ)
  }
  list(identique = !length(parties), parties = unique(parties))
}
