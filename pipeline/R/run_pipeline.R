# run_pipeline ----------------------------------------------------------------
# L'entrée unique et documentée du pipeline (docs/architecture.md §Pipeline) :
# download -> construire (filter/reshape) -> vintage -> compute -> publish.
# Idempotent par construction : les téléchargements sautent ce qui existe (et
# valide), le rebuild est déterministe, la publication écrase (sémantique
# d'upsert).
# Issue #60 : le run publie aussi la géométrie du fond de carte (ADR-0008) —
# les trois masques CARTO-PE sous public/data/, un artefact partagé qui n'est
# pas une table du thème (publier_geometrie, appelée après publish vers la
# même cible).
# mode (issue #8, ADR-0004) : "full" (défaut, local) télécharge tout ; "cron"
# (runner GitHub Actions) ne télécharge que les sources « cron » du manifeste,
# saute les « manuel » (enregistrées « à traiter à la main ») et s'arrête
# bruyamment si une source cron échoue après les retries. Transmis tel quel à
# download_sources().
# Issue #10 : le rapport de run. download_sources() renvoie les statuts par
# source (id, mode, status) ; run_pipeline les capture et écrit le rapport de
# run (mode + horodatage + statuts) à côté du payload — le trace durable du
# run et l'entrée du seam de notification. Sur un échec cron, les statuts sont
# portés par l'erreur (issue #8) : le rapport est écrit AVANT l'arrêt bruyant,
# pour que l'échec reste tracé.
# Issue #233 : quand le thème porte un diagnostic de couverture (la Mobilité —
# les lignes + km par département du snapshot Geovelo courant vs le précédent,
# le signal de régression distinct de la porte de qualité), le rapport l'écrit
# à côté des statuts — un fait de première classe du run, jamais un crash.
# Issue #13 : `theme` est le descripteur du thème (theme_demographie() par
# défaut) — le run compose les MÊMES étapes partagées avec les pièces du thème
# (manifeste, construction des données, vintages, compute). Un thème suivant
# (Habitat) tourne avec son propre descripteur, sans toucher à cette fonction.
# La cible par défaut est le home public du payload (public/data/ à la racine
# du dépôt, ADR-0004) : le cron écrit là où Pages et l'app lisent — parquet +
# JSON (backend "static" par défaut de publish) + vintages + rapport de run.

run_pipeline <- function(theme = theme_demographie(), cache = "data/raw",
                         sortie = "public/data",
                         mode = c("full", "cron")) {
  mode <- match.arg(mode)

  # Le téléchargement renvoie les statuts par source — le cœur du rapport de
  # run. En mode cron, un échec s'arrête ici en portant les statuts sur
  # l'erreur (issue #8) : on écrit le rapport AVANT de re-signaler — un échec
  # sans trace est un échec perdu.
  statuts <- tryCatch(
    download_sources(theme$manifest, cache = cache, mode = mode),
    erreur_telechargement = function(e) {
      ecrire_rapport_run(e$statuts, mode, sortie)
      stop(e)
    }
  )

  brut <- theme$construire_donnees(cache = cache)

  # Issue #233 : le diagnostic de couverture du thème (lignes + km par
  # département, courant vs précédent) quand il le porte — NULL pour les
  # thèmes sans diagnostic (le rapport garde sa forme historique). La lecture
  # passe par `names` : le seam peut rendre une table (tbl_df) dont `$`
  # dplyr lèverait une erreur sur une colonne inconnue.
  couverture <- if ("couverture" %in% names(brut)) brut$couverture else NULL

  # Issue #19 : le cache du run atteint le builder de vintages du thème —
  # vintages_habitat(cache = ...) lit la date de pull des DPE (base roulante)
  # sur le mtime des .rds du cache ; sans le cache, la date ne peut jamais
  # être lue. vintages_demographie() ne prend pas de cache : on ne le passe
  # que si le builder le déclare (signature du thème — Démographie intacte).
  vintages <- if ("cache" %in% names(formals(theme$vintages))) {
    theme$vintages(cache = cache)
  } else {
    theme$vintages()
  }
  # Issue #9 : la table des vintages entière passe au compute — chaque
  # indicateur est estampillé depuis le vintage de sa source de référence
  # déclarée (la table INDICATEURS_<theme>), plus de tampon de fraîcheur du
  # thème.
  # Issue #97 : le thème Économie câble SA publication par le seam `publier`
  # du descripteur (le chaînon analytique T1-T6 → payload → publish). Les
  # thèmes classiques (Démographie, Habitat) n'exposent pas ce seam : ils
  # gardent compute_payload + publish, à l'identique (régression
  # byte-identical).
  if (is.function(theme$publier)) {
    payload <- theme$publier(brut, cache = cache, vintages = vintages,
                             sortie = sortie)
  } else {
    payload <- compute_payload(brut, theme = theme, vintages = vintages)
    publish(payload, sortie)
  }
  # Issue #311 : la publication des métadonnées du thème (theme_<theme>.json)
  # est une étape SÉPARÉE du payload — un thème qui déclare `metadata` (la
  # fonction qui lit son fichier épinglé inst/extdata/theme-metadata/) publie
  # SON fichier après les faits ; un thème sans membre (Programmes, ADR-0013 —
  # un contrat de publication SÉPARÉ) ne publie NI n'écrase rien. Publier les
  # métadonnées ne recompute JAMAIS les tables de faits : l'étape n'écrit que
  # theme_<theme>.json. Le nom du fichier dérive du thème VALIDÉ du contenu
  # (jamais d'un paramètre) et la garde theme_attendu refuse qu'un thème
  # écrive le fichier d'un autre — la collision est impossible.
  if ("metadata" %in% names(theme)) {
    publier_theme_metadata(theme$metadata(), sortie,
                           vintages = vintages,
                           theme_attendu = theme$theme)
  }
  # Issue #60 : la géométrie du fond de carte (ADR-0008) est un artefact
  # partagé, pas une table du thème — le run la publie vers la MÊME cible que
  # le payload (communes/epcis/departements.geojson sous public/data/), depuis
  # Admin Express CARTO-PE. Upsert comme le payload : relancer écrase, et un
  # échec de fetch s'arrête bruyamment (le run ne part jamais avec une carte
  # cassée).
  publier_geometrie(sortie)
  # Issue #124 : la table des vintages est PARTAGÉE (pas par-thème) — le run
  # FUSIONNE ses sources dans la table déjà sur disque (upsert par id, jamais
  # un écrasement last-writer-wins qui cacherait les sources des autres thèmes
  # au Story qui les cite). La table du compute reste celle du thème
  # (l'estampillage par source de référence) ; le merge n'intervient qu'à la
  # sérialisation. Issue #243 : le thème peut déclarer les ids RETIRÉS de son
  # manifeste (retire_vintages — les différentielles OCS-GE sorties par
  # l'amendement) : ils sont retirés de la table partagée au merge, jamais
  # laissés estampiller « fraîche » à côté de leur remplaçante.
  retires <- if ("retire_vintages" %in% names(theme)) {
    theme$retire_vintages
  } else {
    character(0)
  }
  vintages <- fusionner_vintages(vintages, sortie, retires = retires)
  nanoparquet::write_parquet(vintages, file.path(sortie, "vintages.parquet"))
  # Issue #73 : la table des vintages est aussi projetée en JSON — la table
  # partagée que l'app lit pour citer les sources d'un bloc (le Story cite SES
  # jeux de données, plus jamais un tampon de thème).
  jsonlite::write_json(vintages, file.path(sortie, "vintages.json"),
                       dataframe = "rows", na = "null",
                       digits = 17, pretty = TRUE)

  # Le rapport du run réussi, écrit après la publication — il décrit un run
  # complet. Le diagnostic de couverture (issue #233) y voyage quand le thème
  # le porte.
  ecrire_rapport_run(statuts, mode, sortie, couverture = couverture)

  payload
}
