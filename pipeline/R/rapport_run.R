# rapport_run ----------------------------------------------------------------
# Le rapport de run (issue #10, ADR-0004) : le trace durable de chaque run,
# écrit à côté du payload (run-report.json dans public/data/) — par source, le
# statut du run (cron -> « frais » / « échec » ; manuel -> « à traiter à la
# main »), plus le mode du run et un horodatage. C'est l'entrée du seam de
# notification (le workflow ouvre une issue GitHub seulement quand il faut
# l'humain — un échec cron aujourd'hui) et la preuve diffable de ce que le run
# a fait.
# Issue #233 : le rapport porte aussi le diagnostic de couverture du snapshot
# Geovelo quand le thème le fournit — par département, lignes + km du snapshot
# courant vs le précédent, plus le signal de régression (un fait de première
# classe du run, distinct des statuts par source : une chute nette d'un
# département est un signal pour l'humain, jamais un crash — la porte de
# qualité reste la garde bruyante). Les thèmes sans diagnostic écrivent la
# forme historique : la clé `couverture` n'apparaît jamais vide.

# rapport_run : la forme pure du rapport — mode, horodatage, statuts par
# source, et le diagnostic de couverture quand il est fourni (NULL sinon — la
# clé absente, jamais une clé vide). Les statuts sont la table renvoyée par
# download_sources() (issue #8) : id, mode, status. L'horodatage est ISO 8601
# UTC, passé explicitement pour rendre les tests déterministes.
rapport_run <- function(statuts, mode,
                        timestamp = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ",
                                           tz = "UTC"),
                        couverture = NULL) {
  rapport <- list(
    mode = mode,
    timestamp = timestamp,
    statuts = statuts
  )
  if (!is.null(couverture)) rapport$couverture <- couverture
  rapport
}

# ecrire_rapport_run : écrit le rapport (run-report.json) à côté du payload.
# Sur un échec cron, les statuts voyagent sur l'erreur (issue #8) :
# run_pipeline() l'appelle AVANT de re-signaler l'erreur, pour que l'échec
# reste tracé même quand le run s'arrête bruyamment. Le diagnostic de
# couverture (issue #233) est passé tel quel quand le thème le porte.
ecrire_rapport_run <- function(statuts, mode, cible = "public/data",
                               timestamp = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ",
                                                  tz = "UTC"),
                               couverture = NULL) {
  if (!dir.exists(cible)) dir.create(cible, recursive = TRUE)
  rapport <- rapport_run(statuts, mode, timestamp, couverture)
  jsonlite::write_json(
    rapport,
    file.path(cible, "run-report.json"),
    dataframe = "rows", na = "null", pretty = TRUE,
    auto_unbox = TRUE, digits = 17
  )
  invisible(rapport)
}
