# helper-payload ---------------------------------------------------------------
# Accès de test au payload tabulaire : les lignes d'un indicateur pour un
# territoire (et une tranche de détail, pour la structure par âge).
valeur_payload <- function(payload, territoire, key, detail = NULL) {
  tab <- payload$indicateurs
  lignes <- tab[tab$territoire == territoire & tab$key == key, , drop = FALSE]
  if (!is.null(detail)) {
    lignes <- lignes[lignes$detail == detail, , drop = FALSE]
  }
  lignes
}
