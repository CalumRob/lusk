# helper-donnees-reelles --------------------------------------------------------
# Les blocs « données réelles » (les tests qui tournent les vraies tables du
# worktree, pipeline/data/ — gitignoré) sont HORS de la boucle par défaut :
# ils font la majeure partie des ~7 min de la suite. CI les active avec
# LUSK_RUN_REAL=1 ; en local, la suite tourne sur les fixtures seules et reste
# rapide. Le présent test garde son propre skip d'absence (les tables réelles
# ne sont pas partout) — ce helper ajoute la garde d'OPT-IN par-dessus.
skip_sans_donnees_reelles <- function(present, message) {
  testthat::skip_if_not(
    identical(Sys.getenv("LUSK_RUN_REAL"), "1"),
    "les tests « données réelles » sont désactivés — LUSK_RUN_REAL=1 pour les inclure"
  )
  testthat::skip_if_not(present, message)
}
