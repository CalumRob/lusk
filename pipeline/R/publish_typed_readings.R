# Narrow projection of the already-selected R history records for typed serving.
# This deliberately does not publish candidate pools or recompute story selection.
project_typed_reading_facts <- function(histories, theme) {
  required <- switch(theme,
    demographie = c("territoire", "type", "theme", "groupe", "story_key", "salience_reason",
      "periode", "solde_naturel", "solde_migratoire", "taux_solde_naturel",
      "taux_solde_migratoire", "classification"),
    habitat = c("territoire", "type", "theme", "groupe", "story_key", "salience_reason",
      "classification", "part_passoires", "part_abc", "n_dpe"),
    economie = c("territoire", "type", "theme", "groupe", "story_key", "salience_reason",
      unlist(lapply(seq_len(5), function(i) paste0("top", i, c("_activity_code", "_activity_label", "_lq", "_n", "_part_parc"))), use.names=FALSE)),
    milieux = c("territoire", "type", "theme", "groupe", "story_key", "salience_reason",
      "periode_pop", "periode_artif", "delta_population", "taux_variation_population",
      "artif_m2_par_habitant", "artif_m3_par_habitant", "trajectoire_artif_par_habitant", "classification"),
    mobilite = c("territoire", "type", "theme", "groupe", "story_key", "salience_reason",
      "div_loss_t", "div_loss_b"),
    stop("Unsupported typed-reading theme: ", theme, call.=FALSE))
  if (!is.data.frame(histories) || !all(required %in% names(histories)))
    stop("Canonical selected reading is missing fields for ", theme, call.=FALSE)
  rows <- histories[histories$theme == theme, required, drop=FALSE]
  if (anyNA(rows[c("territoire", "type", "groupe", "story_key", "salience_reason")]) ||
      any(!rows$type %in% c("commune", "epci", "departement", "region")) ||
      anyDuplicated(rows[c("territoire", "type", "groupe")]))
    stop("Invalid or duplicate selected reading identity for ", theme, call.=FALSE)
  names(rows)[names(rows) == "territoire"] <- "territory_id"
  names(rows)[names(rows) == "type"] <- "territory_type"
  rows
}
