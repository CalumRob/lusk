# _targets.R --------------------------------------------------------------------
# Le graphe targets du pipeline (#329) — le tracer bullet sur le thème
# Démographie (#340). Remplace la séquence d'orchestration de run_pipeline()
# (download -> construire -> vintages -> compute -> publish -> géométrie ->
# fusion des vintages -> rapport) par un DAG :
#
#   - la régénération devient chirurgicale : un changement de compute ne
#     rejoue pas la couche construire lourde (Q1) ;
#   - un changement de corps d'un builder invalide tout l'aval même sans
#     changement d'entrées — le « piège de la fraîcheur » (#325) est géré
#     nativement par le hash des fonctions importées (Q2) ;
#   - la fraîcheur des entrées est PAR CONTENU (trust_timestamps = FALSE) —
#     une modification masquée d'un fichier source est détectée (Q3) ;
#   - le rapport de run est un target INDÉPENDANT des étapes aval,
#     réestampillé à CHAQUE run (tar_cue mode = "always"), même quand la
#     chaîne saute, et survivant à l'échec d'une étape aval (error =
#     "continue") — la sémantique #8/#10 du cron (Q4).
#
# run_pipeline() reste l'ORACLE inchangé (le test byte-identical le prouve,
# test-targets-byte-identical.R) ; les fonctions métier ne sont pas touchées —
# seule la couche d'orchestration change. Le store _targets/ (gitignoré)
# remplace data/processed/*.rds comme cache intermédiaire.
#
# Le graphe se construit depuis le DESCRIPTEUR du thème (theme_demographie(),
# issue #13) — jamais un nom de thème en dur : le ticket #341 balayera les
# cinq descripteurs sans réécrire la mécanique.

library(targets)
# Le workflow de dev : le paquet est chargé par pkgload::load_all ICI (dans
# _targets.R) — le suivi d'imports de targets (hash deparse(body) + dépendances
# transitives) hashe les VRAIS corps de fonctions, y compris non exportés
# (le spike 07-loadall-imports.R l'a vérifié).
pkgload::load_all(".", quiet = TRUE)

tar_option_set(
  imports = "lusk",          # suivi de code par fonction (US 3)
  trust_timestamps = FALSE,  # fraîcheur par contenu pour les targets de fichiers (US 5)
  error = "continue"         # un échec aval n'arrête pas le rapport de run (US 7)
)

# La configuration du run (ADR-0004) : le mode (full = local, cron = runner)
# et les chemins sont lus dans l'environnement — le cron les câblera
# explicitement (étape 5 du port), les tests pointent des répertoires
# temporaires. Défauts : full, cache du dépôt, home public du payload.
MODE_RUN <- Sys.getenv("LUSK_MODE", unset = "full")
CACHE_RUN <- Sys.getenv("LUSK_CACHE", unset = "data/raw")
SORTIE_RUN <- Sys.getenv("LUSK_SORTIE", unset = "../public/data")

# Le thème du tracer bullet. Le manifeste du thème est une variable du script :
# targets hashe sa VALEUR (siphash) — une source ajoutée/retirée du manifeste
# invalide le téléchargement et tout l'aval.
THEME_RUN <- theme_demographie()
manifeste <- THEME_RUN$manifest

# attributs_nuls -----------------------------------------------------------------
# Le corps d'une fonction chargée par parse() porte des attributs de source
# (srcref, srcfile, wholeSrcref — en surface ET sur les éléments imbriqués)
# qui diffèrent entre deux chargements du même fichier : les comparer ferait
# échouer identical() sur deux générations d'un même corps. On les retire
# RÉCURSIVEMENT pour comparer l'arbre de parse nu.
attributs_nuls <- function(x) {
  if (is.call(x) || is.pairlist(x)) {
    attributes(x) <- NULL
    for (i in seq_along(x)) {
      enfant <- attributs_nuls(x[[i]])
      # Issue #351 : un enfant NULL (les formals vides d'une fonction anonyme
      # `function() ...` — le seam `metadata` de #311, mais toute fonction
      # anonyme du paquet passe par là) ne doit PAS être affecté : en R,
      # `x[[i]] <- NULL` RETIRE l'élément de l'appel, l'arbre rétrécit et le
      # seq_along(x) précalculé dépasse (subscript out of bounds). On garde le
      # nœud tel quel — l'arbre de parse nu est préservé (un enfant NULL reste
      # NULL, deparse produit la même forme).
      if (is.null(enfant)) next
      x[[i]] <- enfant
    }
  }
  x
}

# meme_fonction_paquet ----------------------------------------------------------
# Deux chargements du même paquet (le pkgload::load_all de _targets.R alors
# que le paquet est déjà chargé — le contexte testthat, où tar_make est appelé
# depuis un environnement dont la chaîne parentale atteint l'ANCIENNE
# génération du namespace) produisent deux générations : les fonctions sont
# les mêmes (formals + arbre de parse) mais ni identical() ni une comparaison
# de corps brute ne les reconnaissent (srcref). Le test : même package (le
# nom du namespace de l'environnement), mêmes formals, même arbre de parse.
meme_fonction_paquet <- function(a, b, paquet) {
  is.function(a) && is.function(b) &&
    environmentName(environment(a)) == paquet &&
    environmentName(environment(b)) == paquet &&
    identical(formals(a), formals(b)) &&
    identical(attributs_nuls(body(a)), attributs_nuls(body(b)))
}

# symbole_ns --------------------------------------------------------------------
# La pièce du thème comme SYMBOLE du namespace du paquet. Les commandes du
# graphe appellent les fonctions PAR SYMBOLE (construire_donnees_brut(cache = …),
# jamais theme_demographie()$construire_donnees) : le suivi d'imports hashe le
# corps de la fonction référencée. Une référence via `$` échapperait au graphe
# d'appels de codetools (le corps n'apparaîtrait dans aucune commande) et, pire,
# référencer le descripteur entier comme hub invaliderait TOUTES les commandes
# au premier changement d'une pièce — cassant Q1. On retrouve le nom du
# namespace dont l'objet EST la pièce (les descripteurs pointent les fonctions
# du paquet — meme_fonction_paquet les reconnaît à travers les générations).
symbole_ns <- function(piece, paquet = "lusk") {
  ns <- asNamespace(paquet)
  noms <- ls(ns, all.names = TRUE)
  noms <- noms[vapply(noms, function(nom) {
    candidat <- get(nom, envir = ns, inherits = FALSE)
    identical(candidat, piece) || meme_fonction_paquet(candidat, piece, paquet)
  }, logical(1))]
  if (length(noms) != 1L) {
    stop("Pièce du thème introuvable ou ambiguë dans le namespace ", paquet,
         " : ", paste(noms, collapse = ", "), call. = FALSE)
  }
  as.name(noms[[1L]])
}

# grappe_theme ------------------------------------------------------------------
# La grappe d'un thème — construite depuis le descripteur : download (mode
# full/cron préservé, idempotent) -> fichiers du cache brut (fraîcheur par
# contenu) -> construire -> vintages -> compute -> publish -> métadonnées du
# thème (theme_<theme>.json, le seam `metadata` de #311 — quand le descripteur
# le déclare) -> fusion des vintages (upsert, issue #124) -> rapport de run
# (indépendant, toujours).
# Le seam de publication du thème (issue #97) est respecté par le dispatch :
# un thème classique (Démographie, Habitat) n'expose pas `publier` — la
# branche compute_payload + publish, à l'identique de run_pipeline.
grappe_theme <- function(theme = THEME_RUN, mode = MODE_RUN, cache = CACHE_RUN,
                         sortie = SORTIE_RUN) {
  nom <- theme$theme
  theme_c <- as.name(paste0("theme_", nom))   # le constructeur du descripteur
  theme_descripteur <- bquote(.(theme_c)())
  construire <- symbole_ns(theme$construire_donnees)
  vintages_fn <- symbole_ns(theme$vintages)

  sources <- as.name(paste0("sources_", nom))
  fichiers <- as.name(paste0("fichiers_", nom))
  brut <- as.name(paste0("brut_", nom))
  vintages <- as.name(paste0("vintages_table_", nom))
  payload <- as.name(paste0("payload_", nom))
  publie <- as.name(paste0("publie_", nom))
  metadata <- as.name(paste0("metadata_", nom))
  rapport <- as.name(paste0("rapport_", nom))

  grappe <- list(
    # download : idempotent (saute ce qui existe et est valide, retente et
    # s'arrête bruyamment sinon), le mode full/cron d'ADR-0004 est transmis
    # tel quel. Renvoie les statuts par source — le cœur du rapport de run.
    tar_target_raw(
      as.character(sources),
      bquote(download_sources(manifeste, cache = .(cache), mode = .(mode)))
    ),
    # les fichiers du cache brut comme cibles de fichiers : la fraîcheur des
    # entrées est par CONTENU (trust_timestamps = FALSE). Un re-téléchargement
    # (fichier corrompu) ou une source modifiée change le hash -> construire
    # et tout l'aval sont invalidés. La dépendance sur `sources` ordonne : le
    # hash n'est pris qu'après le téléchargement du run.
    tar_target_raw(
      as.character(fichiers),
      bquote({ .(sources); file.path(.(cache), manifeste$fichier) }),
      format = "file"
    ),
    # construire : le builder du thème, appelé par son SYMBOLE — un
    # changement de corps invalide tout l'aval même sans changement d'entrées
    # (Q2) ; un changement de compute, lui, ne le touche pas (Q1).
    tar_target_raw(
      as.character(brut),
      bquote({ .(fichiers); .(construire)(cache = .(cache)) })
    ),
    # vintages : la table du thème (le builder prend le cache seulement s'il
    # le déclare — Démographie n'en prend pas, la signature est respectée).
    tar_target_raw(
      as.character(vintages),
      bquote(.(vintages_fn)())
    ),
    # compute : le payload de la fiche. Le descripteur est reconstruit par son
    # constructeur (theme_<slug>(), la convention des modules de thème) — le
    # corps du constructeur référence TOUTES les pièces du thème : le hash
    # transitif des imports couvre chacune, sans liste déclarée à maintenir.
    tar_target_raw(
      as.character(payload),
      bquote(compute_payload(.(brut), theme = .(theme_descripteur),
                             vintages = .(vintages)))
    ),
    # publish : la publication static du payload vers la cible du run (upsert,
    # ADR-0004). Un thème qui expose `publier` (issue #97) câblerait ici sa
    # publication au lieu de la branche compute + publish. Les métadonnées du
    # thème (theme_<theme>.json, issue #311) sont publiées par un target dédié
    # inséré APRÈS celui-ci — le même seam `metadata` que run_pipeline.
    tar_target_raw(
      as.character(publie),
      bquote(publish(.(payload), .(sortie)))
    ),
    # fusion des vintages (issue #124) : upsert dans la table partagée déjà
    # sur disque + projections parquet/JSON — la MÊME séquence que
    # run_pipeline. `retire_vintages` (issue #243) : les ids que le thème ne
    # déclare plus, déclarés par le descripteur quand il les porte.
    tar_target_raw(
      paste0("fusion_vintages_", nom),
      bquote({
        theme_ <- .(theme_descripteur)
        retires <- if ("retire_vintages" %in% names(theme_)) {
          theme_$retire_vintages
        } else {
          character(0)
        }
        v <- fusionner_vintages(.(vintages), .(sortie), retires = retires)
        nanoparquet::write_parquet(v, file.path(.(sortie), "vintages.parquet"))
        jsonlite::write_json(v, file.path(.(sortie), "vintages.json"),
                             dataframe = "rows", na = "null",
                             digits = 17, pretty = TRUE)
        v
      })
    ),
    # le rapport de run : un target indépendant des étapes AVAL (aucune
    # dépendance sur payload/publie/fusion), réestampillé à CHAQUE run
    # (tar_cue mode = "always") même quand la chaîne saute, et survivant à
    # l'échec d'une étape aval (error = "continue"). Le diagnostic de
    # couverture (issue #233) y voyage quand le thème le porte — le même seam
    # `names(brut)` que run_pipeline (NULL pour Démographie, jamais une clé
    # vide). NB : sur un échec du TÉLÉCHARGEMENT lui-même, les statuts sont
    # portés par l'erreur (issue #8) — le rapport d'échec est une
    # responsabilité de l'étape de câblage cron (étape 5 du port), pas du DAG.
    tar_target_raw(
      as.character(rapport),
      bquote({
        brut_ <- .(brut)
        couverture <- if ("couverture" %in% names(brut_)) {
          brut_$couverture
        } else {
          NULL
        }
        ecrire_rapport_run(.(sources), .(mode), .(sortie),
                           couverture = couverture)
        file.path(.(sortie), "run-report.json")
      }),
      format = "file",
      cue = tar_cue(mode = "always")
    )
  )

  # les métadonnées du thème (issue #311) : le seam metadata de run_pipeline —
  # un thème qui déclare `metadata` (la fonction qui lit son fichier épinglé
  # inst/extdata/theme-metadata/) publie SON theme_<theme>.json à côté des
  # faits ; le dispatch est PAR TRAIT (jamais un nom de thème en dur) et un
  # thème sans membre (Programmes, ADR-0013) n'écrit NI n'écrase rien.
  # Publier les métadonnées ne recompute JAMAIS les tables de faits : le
  # target n'écrit que theme_<theme>.json, validé contre les vintages du thème
  # (publier_theme_metadata — la garde theme_attendu refuse la collision).
  if ("metadata" %in% names(theme)) {
    grappe <- append(grappe, list(
      tar_target_raw(
        as.character(metadata),
        bquote({
          theme_ <- .(theme_descripteur)
          publier_theme_metadata(theme_$metadata(), .(sortie),
                                 vintages = .(vintages),
                                 theme_attendu = theme_$theme)
        })
      )
    ), after = 6L)
  }

  grappe
}

# Le graphe du tracer bullet : la grappe du thème + la géométrie du fond de
# carte — un artefact PARTAGÉ du run (issue #60, ADR-0008), pas une table du
# thème : publiée vers la même cible que le payload, upsert comme lui.
list(
  grappe_theme(),
  tar_target(geometrie, publier_geometrie(SORTIE_RUN))
)
