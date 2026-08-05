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
  # Issue #60 : la géométrie du fond de carte (ADR-0008) est un artefact
  # partagé, pas une table du thème — le run la publie vers la MÊME cible que
  # le payload (communes/epcis/departements.geojson sous public/data/), depuis
  # Admin Express CARTO-PE. Upsert comme le payload : relancer écrase, et un
  # échec de fetch s'arrête bruyamment (le run ne part jamais avec une carte
  # cassée).
  publier_geometrie(sortie)
  nanoparquet::write_parquet(vintages, file.path(sortie, "vintages.parquet"))

  # Le rapport du run réussi, écrit après la publication — il décrit un run
  # complet.
  ecrire_rapport_run(statuts, mode, sortie)

  payload
}
