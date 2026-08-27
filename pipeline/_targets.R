# _targets.R --------------------------------------------------------------------
# Le graphe targets du pipeline (#329) — généralisé aux CINQ thèmes (#341) :
# une grappe par thème, construite depuis SON descripteur (issue #13, jamais
# un nom de thème en dur, jamais une liste de pas par thème), plus les
# artefacts PARTAGÉS du run (la fusion des vintages #124/#243, le rapport de
# run, la géométrie ADR-0008). Remplace la séquence d'orchestration de
# run_pipeline() (download -> construire -> vintages -> compute -> publish ->
# géométrie -> fusion des vintages -> rapport) par un DAG :
#
#   - la régénération devient chirurgicale : un changement de compute ne
#     rejoue pas la couche construire lourde (Q1) — et la frontière du skip
#     suit la frontière des DESCRIPTEURS : les étapes de données d'un thème
#     ne dépendent jamais de celles d'un autre (test-targets-graphe-cinq-themes) ;
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
# Les fichiers PARTAGÉS du home public (territoires.*, vintages.*,
# run-report.json) sont écrits par des cibles chaînées ou uniques — le DAG
# produit la MÊME sortie que six run_pipeline() séquentiels (le cron : les
# CINQ thèmes + le payload partagé Programmes, #343) :
#   - la référence des territoires est écrite par chaque publish ; le dernier
#     thème de la chaîne publie_* gagne (comme le dernier appel du cron) ;
#   - la table des vintages est FUSIONNÉE par UN target unique (fusion_vintages)
#     qui upsert séquentiellement les tables des thèmes du run — les CINQ
#     grappes + Programmes sur le run complet (issue #178) — dans la table
#     partagée sur disque, ids retirés du thème compris (retire_vintages, #243) ;
#   - run-report.json est écrit par les rapports de run chaînés, le dernier
#     thème gagne (Programmes sur le run complet — le même dernier appel que
#     le cron).

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

# THEMES_RUN : les CINQ descripteurs — LA donnée du graphe. LUSK_THEMES
# restreint le run à un sous-ensemble (le cron slow-clock de Mobilité, les
# tests byte-identical un thème à la fois) ; vide = les cinq. Les manifestes
# sont des variables du script : targets hashe leur VALEUR (siphash) — une
# source ajoutée/retirée d'un manifeste invalide le téléchargement de SON
# thème et tout son aval.
THEMES_RUN <- list(
  demographie = theme_demographie(),
  habitat = theme_habitat(),
  economie = theme_economie(),
  mobilite = theme_mobilite(),
  milieux = theme_milieux()
)
selection <- Sys.getenv("LUSK_THEMES", unset = "")
if (nzchar(selection)) {
  selection <- strsplit(selection, ",")[[1L]]
  inconnus <- setdiff(selection, names(THEMES_RUN))
  if (length(inconnus) > 0) {
    stop("LUSK_THEMES : thème(s) inconnu(s) : ",
         paste(inconnus, collapse = ", "), ".", call. = FALSE)
  }
  THEMES_RUN <- THEMES_RUN[selection]
}
for (t in THEMES_RUN) assign(paste0("manifeste_", t$theme), t$manifest)

# attributs_nuls -----------------------------------------------------------------
# Le corps d'une fonction chargée par parse() porte des attributs de source
# (srcref, srcfile, wholeSrcref — en surface ET sur les éléments imbriqués)
# qui diffèrent entre deux chargements du même fichier : les comparer ferait
# échouer identical() sur deux générations d'un même corps. On les retire
# RÉCURSIVEMENT pour comparer l'arbre de parse nu.
attributs_nuls <- function(x) {
  if (is.call(x) || is.pairlist(x)) {
    attributes(x) <- NULL
    # Issue #341 : le parser R stocke la srcref d'une fonction anonyme comme
    # QUATRIÈME ÉLÉMENT de l'appel `function` (jamais un attribut) — elle
    # porte un srcfile (un environnement) qui diffère entre deux chargements
    # du même fichier : comparer deux générations d'un corps qui contient une
    # fonction anonyme (construire_donnees_mobilite) échouerait. On la retire
    # AVANT la boucle (l'arbre rétrécit, mais seq_along est recalculé après —
    # pas de dépassement) ; deparse l'ignore, l'arbre de parse nu est intact.
    if (is.call(x) && length(x) == 4L &&
        identical(x[[1L]], as.name("function")) &&
        inherits(x[[4L]], "srcref")) {
      x[[4L]] <- NULL
    }
    for (i in seq_along(x)) {
      # Issue #351 : un enfant NULL (les formals vides d'une fonction anonyme
      # `function() ...` — le seam `metadata` de #311, mais toute fonction
      # anonyme du paquet passe par là) ne doit PAS être affecté : en R,
      # `x[[i]] <- NULL` RETIRE l'élément de l'appel, l'arbre rétrécit et le
      # seq_along(x) précalculé dépasse (subscript out of bounds). On garde le
      # nœud tel quel — l'arbre de parse nu est préservé (un enfant NULL reste
      # NULL, deparse produit la même forme).
      # Issue #341 : une FENTE VIDE (x[i, ] — l'index manquant d'un subscript
      # à virgule, des corps comme construire_donnees_programmes) est
      # l'argument manquant R_MissingArg : y récurser forcerait la promesse et
      # lèverait « argument manquant ». On la garde telle quelle — elle fait
      # partie de l'arbre de parse, les deux générations la portent.
      if (identical(x[[i]], quote(expr = ))) next
      enfant <- attributs_nuls(x[[i]])
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
# La grappe d'UN thème — construite depuis SON descripteur : download (mode
# full/cron préservé, idempotent) -> fichiers du cache brut (fraîcheur par
# contenu) -> construire -> vintages -> [compute] -> [métadonnées]. La
# publication (publie_theme), la fusion partagée (fusion_themes) et le
# rapport de run (rapport_theme) vivent dans le câblage commun ci-dessous —
# les fichiers partagés qu'ils écrivent doivent être déterministes (chaînes).
# Les seams se dispatchent sur les TRAITS du descripteur, jamais sur les noms
# de thèmes :
#   - `metadata` (issue #311) : un target publie theme_<theme>.json quand le
#     descripteur le déclare ;
#   - `publier` (issue #97) : dispatché par publie_theme — un thème qui
#     expose `publier` n'a PAS de target compute ici : son seam produit le
#     payload lui-même, à l'identique de run_pipeline ;
#   - la SIGNATURE de `vintages` (issue #19) : le cache atteint le builder
#     qui le déclare (vintages_habitat lit la date de pull des DPE sur le
#     mtime du cache) — le même dispatch sur formals() que run_pipeline.
grappe_theme <- function(theme = THEMES_RUN[[1L]], mode = MODE_RUN,
                         cache = CACHE_RUN, sortie = SORTIE_RUN) {
  nom <- theme$theme
  theme_c <- as.name(paste0("theme_", nom))   # le constructeur du descripteur
  theme_descripteur <- bquote(.(theme_c)())
  construire <- symbole_ns(theme$construire_donnees)
  vintages_fn <- symbole_ns(theme$vintages)
  manifeste <- as.name(paste0("manifeste_", nom))

  sources <- as.name(paste0("sources_", nom))
  fichiers <- as.name(paste0("fichiers_", nom))
  brut <- as.name(paste0("brut_", nom))
  vintages <- as.name(paste0("vintages_table_", nom))
  payload <- as.name(paste0("payload_", nom))
  metadata <- as.name(paste0("metadata_", nom))

  # vintages : le builder du thème prend le cache seulement s'il le déclare —
  # le dispatch sur la signature, à l'identique de run_pipeline (Démographie
  # n'en prend pas, Habitat lit les dates de pull DPE sur le cache).
  appel_vintages <- if ("cache" %in% names(formals(theme$vintages))) {
    bquote(.(vintages_fn)(cache = .(cache)))
  } else {
    bquote(.(vintages_fn)())
  }

  grappe <- list(
    # download : idempotent (saute ce qui existe et est valide, retente et
    # s'arrête bruyamment sinon), le mode full/cron d'ADR-0004 est transmis
    # tel quel. Renvoie les statuts par source — le cœur du rapport de run.
    tar_target_raw(
      as.character(sources),
      bquote(download_sources(.(manifeste), cache = .(cache), mode = .(mode)))
    ),
    # les fichiers du cache brut comme cibles de fichiers : la fraîcheur des
    # entrées est par CONTENU (trust_timestamps = FALSE). Un re-téléchargement
    # (fichier corrompu) ou une source modifiée change le hash -> construire
    # et tout l'aval sont invalidés. La dépendance sur `sources` ordonne : le
    # hash n'est pris qu'après le téléchargement du run.
    tar_target_raw(
      as.character(fichiers),
      bquote({ .(sources); file.path(.(cache), .(manifeste)$fichier) }),
      format = "file"
    ),
    # construire : le builder du thème, appelé par son SYMBOLE — un
    # changement de corps invalide tout l'aval même sans changement d'entrées
    # (Q2) ; un changement de compute, lui, ne le touche pas (Q1).
    tar_target_raw(
      as.character(brut),
      bquote({ .(fichiers); .(construire)(cache = .(cache)) })
    ),
    tar_target_raw(as.character(vintages), appel_vintages)
  )

  # compute : le payload de la fiche. Un thème qui expose `publier` (issue
  # #97 — Économie, Mobilité) n'a PAS de target compute : son seam de
  # publication produit le payload lui-même (publie_theme), à l'identique de
  # run_pipeline — le dispatch est PAR TRAIT (is.function(theme$publier)),
  # jamais un nom de thème. Le descripteur est reconstruit par son
  # constructeur (theme_<slug>(), la convention des modules de thème) — le
  # corps du constructeur référence TOUTES les pièces du thème : le hash
  # transitif des imports couvre chacune, sans liste déclarée à maintenir.
  if (!is.function(theme$publier)) {
    grappe <- c(grappe, list(
      tar_target_raw(
        as.character(payload),
        bquote(compute_payload(.(brut), theme = .(theme_descripteur),
                               vintages = .(vintages)))
      )
    ))
  }

  # les métadonnées du thème (issue #311) : le seam metadata de run_pipeline —
  # un thème qui déclare `metadata` (la fonction qui lit son fichier épinglé
  # inst/extdata/theme-metadata/) publie SON theme_<theme>.json à côté des
  # faits ; le dispatch est PAR TRAIT et un thème sans membre n'écrit NI
  # n'écrase rien. Publier les métadonnées ne recompute JAMAIS les tables de
  # faits : le target n'écrit que theme_<theme>.json, validé contre les
  # vintages du thème (publier_theme_metadata — la garde theme_attendu refuse
  # la collision).
  #
  # Le CANON ÉPINGLÉ est une DÉPENDANCE SUIVIE (issue #434) : fichier_metadata_
  # <thème> est une cible format = "file" qui résout la ressource du paquet
  # (system.file — résolue aussi sous pkgload, le précédent artefact_egss.R) ;
  # la fraîcheur est PAR CONTENU (trust_timestamps = FALSE) — un changement du
  # canon SEUL change le hash de la cible et invalide exactement metadata_
  # <thème> au run suivant (l'observation 2026-08-11 #4 : sans suivi, la
  # publication sautait silencieusement après l'édition d'un seul JSON —
  # 29d5277, contournement manuel tar_invalidate). La cible canon est LEAF :
  # rien d'autre du graphe ne la référence, le reste du thème ne bouge pas ;
  # un run sans changement garde tout frais (pas de fausse invalidation).
  if ("metadata" %in% names(theme)) {
    canon <- as.name(paste0("fichier_metadata_", nom))
    fichier_canon <- paste0("theme_", nom, ".json")
    grappe <- c(grappe, list(
      tar_target_raw(
        as.character(canon),
        bquote(system.file("extdata", "theme-metadata", .(fichier_canon),
                           package = "lusk")),
        format = "file"
      ),
      tar_target_raw(
        as.character(metadata),
        bquote({
          .(canon)
          theme_ <- .(theme_descripteur)
          publier_theme_metadata(theme_$metadata(), .(sortie),
                                 vintages = .(vintages),
                                 theme_attendu = theme_$theme,
                                 directions_module = theme_$directions)
        })
      )
    ))
  }

  # LE RACCORDEMENT (issue #486) : le trait `raccordement` du descripteur
  # câble SA chaîne de calcul. Les DEUX épingles du package (la matrice temps
  # figée, la population RP 2023) sont des cibles format = "file" (fraîcheur
  # PAR CONTENU) ; raccordement_<thème> vérifie les contrats, résout la
  # projection COG depuis le zip INSEE du cache (cog_passage — ordonné après
  # le téléchargement du thème et l'extraction du référentiel partagé), calcule
  # et persiste l'enveloppe sous le répertoire analytique du thème. La cible
  # rend LE CHEMIN de l'enveloppe (format = "file" à son tour) : le skip suit
  # exactement ses entrées — une matrice changée invalide le calcul SEUL puis
  # l'aval ; rien d'autre du thème ne bouge.
  #
  # LE CRON SAUTE LA CHAÎNE (le même mode que les sources « manuel »,
  # ADR-0004) : en mode cron la cible porte cue mode = "never" — jamais
  # évaluée, jamais payée par l'horloge légère ; sa valeur (et celle de tout
  # l'aval qui en dépend) reste celle du dernier run manuel, et
  # lire_raccordement REFUSERAIT une enveloppe périmée plutôt que de laisser
  # republier en silence des parts calculées depuis une autre matrice.
  if (!is.null(theme$raccordement)) {
    pin_matrice <- as.name(paste0("pin_matrice_temps_", nom))
    pin_population <- as.name(paste0("pin_population_", nom))
    pin_cog_passage <- as.name(paste0("pin_cog_passage_", nom))
    cible_raccordement <- as.name(paste0("raccordement_", nom))
    sortie_raccordement <- file.path(dirname(cache), "processed", nom)
    grappe <- c(grappe, list(
      tar_target_raw(
        as.character(pin_matrice),
        bquote(system.file("extdata", MATRICE_TEMPS_MAIRIES_FICHIER,
                           package = "lusk")),
        format = "file"
      ),
      tar_target_raw(
        as.character(pin_population),
        bquote(system.file("extdata", POPULATION_RACCORDEMENT_FICHIER,
                           package = "lusk")),
        format = "file"
      ),
      tar_target_raw(
        as.character(pin_cog_passage),
        bquote({
          .(sources)
          fichier <- .(manifeste)$fichier[.(manifeste)$id == "cog_passage"]
          stopifnot(length(fichier) == 1L)
          file.path(.(cache), fichier)
        }),
        format = "file"
      ),
      tar_target_raw(
        as.character(cible_raccordement),
        bquote({
          .(sources)
          .(pin_matrice)
          .(pin_population)
          .(pin_cog_passage)
          fichier_epci_extrait
          preparer_raccordement(
            .(pin_cog_passage),
            file.path(.(cache), "extracted", "EPCI_au_01-01-2025.xlsx"),
            sortie = .(sortie_raccordement))
          file.path(.(sortie_raccordement), RACCORDEMENT_ARTEFACT)
        }),
        format = "file",
        cue = if (identical(mode, "cron")) {
          tar_cue(mode = "never")
        } else {
          tar_cue()
        }
      )
    ))
  }

  grappe
}

# publie_theme ------------------------------------------------------------------
# La publication d'UN thème — le seam `publier` du descripteur quand il
# l'expose (issue #97 : Économie, Mobilité — theme$publier(brut, cache,
# vintages, sortie), à l'identique de run_pipeline) ; la machinerie partagée
# (compute_payload + publish) sinon (Démographie, Habitat, Milieux).
# `precedent` CHAÎNE les écritures de la référence partagée des territoires
# (territoires.* est écrit par chaque publish, le dernier thème gagne — comme
# cinq run_pipeline séquentiels) : sans chaîne, cinq cibles indépendantes
# écriraient le fichier partagé en parallèle (course, vainqueur non
# déterministe). La chaîne est construite depuis THEMES_RUN, jamais une
# décision par thème.
publie_theme <- function(theme, cache = CACHE_RUN, sortie = SORTIE_RUN,
                         precedent = NULL) {
  nom <- theme$theme
  if (is.function(theme$publier)) {
    publier_fn <- symbole_ns(theme$publier)
    command <- bquote(
      .(publier_fn)(.(as.name(paste0("brut_", nom))), cache = .(cache),
                    vintages = .(as.name(paste0("vintages_table_", nom))),
                    sortie = .(sortie))
    )
    # LE RACCORDEMENT (issue #486) : le trait du descripteur CHAÎNE la
    # publication derrière la cible de calcul — elle lit une enveloppe fraîche
    # (ou refuse une périmée), jamais un recalcul au fil des republications.
    if (!is.null(theme$raccordement)) {
      command <- bquote({
        .(as.name(paste0("raccordement_", nom)))
        .(command)
      })
    }
  } else {
    command <- bquote(
      publish(.(as.name(paste0("payload_", nom))), .(sortie))
    )
  }
  if (!is.null(precedent)) {
    command <- bquote({ .(precedent); .(command) })
  }
  tar_target_raw(paste0("publie_", nom), command)
}

# fusion_themes -----------------------------------------------------------------
# La fusion PARTAGÉE des vintages (issue #124, amendée #243) : UN target pour
# les thèmes du run — chaque table du thème est upsertée SÉQUENTIELLEMENT dans
# la table partagée déjà sur disque (parquet écrit entre deux fusions, la même
# accumulation que cinq run_pipeline successifs), puis les projections
# parquet/JSON. `retire_vintages` (issue #243) : les ids que le thème ne
# déclare plus, retirés de la table partagée à SON étape (les différentielles
# OCS-GE de Milieux) — dispatché par trait, jamais un nom de thème.
fusion_themes <- function(themes = THEMES_RUN, sortie = SORTIE_RUN) {
  corps <- list(bquote(v <- NULL))
  for (t in themes) {
    retires <- if ("retire_vintages" %in% names(t)) {
      t$retire_vintages
    } else {
      character(0)
    }
    table <- as.name(paste0("vintages_table_", t$theme))
    corps <- c(corps, list(bquote({
      v <- fusionner_vintages(.(table), .(sortie), retires = .(retires))
      nanoparquet::write_parquet(v, file.path(.(sortie), "vintages.parquet"))
    })))
  }
  corps <- c(corps, list(
    # Issue #73 : la table des vintages est aussi projetée en JSON — la table
    # partagée que l'app lit pour citer les sources d'un bloc.
    bquote(jsonlite::write_json(v, file.path(.(sortie), "vintages.json"),
                                dataframe = "rows", na = "null",
                                digits = 17, pretty = TRUE)),
    bquote(v)
  ))
  tar_target_raw("fusion_vintages", as.call(c(list(as.name("{")), corps)))
}

# rapport_theme -----------------------------------------------------------------
# Le rapport de run d'UN thème : un target INDÉPENDANT des étapes aval
# (aucune dépendance sur payload/publie/fusion), réestampillé à CHAQUE run
# (tar_cue mode = "always") même quand la chaîne saute, et survivant à
# l'échec d'une étape aval (error = "continue") — la sémantique #8/#10 du
# cron (Q4). Le diagnostic de couverture (issue #233) y voyage quand le BRUT
# du thème le porte — le même seam `names(brut)` que run_pipeline (Mobilité,
# jamais un nom de thème en dur ; NULL pour les autres, jamais une clé vide).
# `precedent` CHAÎNE les écritures du fichier PARTAGÉ run-report.json (le
# dernier thème gagne, comme cinq run_pipeline séquentiels).
# NB : sur un échec du TÉLÉCHARGEMENT lui-même, les statuts sont portés par
# l'erreur (issue #8) — le rapport d'échec est une responsabilité de l'étape
# de câblage cron (étape 5 du port), pas du DAG.
rapport_theme <- function(theme, mode = MODE_RUN, sortie = SORTIE_RUN,
                          precedent = NULL) {
  nom <- theme$theme
  brut <- as.name(paste0("brut_", nom))
  sources <- as.name(paste0("sources_", nom))
  corps <- list(
    bquote(brut_ <- .(brut)),
    bquote(couverture <- if ("couverture" %in% names(brut_)) {
      brut_$couverture
    } else {
      NULL
    }),
    bquote(ecrire_rapport_run(.(sources), .(mode), .(sortie),
                              couverture = couverture)),
    bquote(file.path(.(sortie), "run-report.json"))
  )
  if (!is.null(precedent)) {
    corps <- c(list(bquote(.(precedent))), corps)
  }
  tar_target_raw(
    paste0("rapport_", nom),
    as.call(c(list(as.name("{")), corps)),
    format = "file",
    cue = tar_cue(mode = "always")
  )
}

# Les verrous « données réelles » (issue #329 US 13/14 — ticket #342) ----------
# Les blocs « données réelles » de la suite testthat (les verrous de FORMAT
# sur les vrais fichiers du cache, gitignorés) deviennent des targets PILOTÉS
# PAR LEURS ENTRÉES ; LUSK_RUN_REAL est supprimé (variable, helper de skip,
# câblage cron). Chaque verrou = UN target LEAF `verif_<slug>` :
#   - RIEN en aval : l'identité byte-identique du payload est préservée
#     (test-targets-byte-identical.R est la porte — un verrou n'écrit rien) ;
#   - il rejoue quand (a) SES fichiers bruts changent (les cibles
#     format = "file" à hash de contenu, trust_timestamps = FALSE — le
#     download d'un fichier corrompu ou d'une source modifiée change le hash)
#     ou (b) le corps d'un lecteur/normaliseur change (les vérificateurs sont
#     appelés PAR SYMBOLE via symbole_ns — le suivi d'imports hashe leur corps
#     ET leurs dépendances transitives : toute la chaîne métier est couverte,
#     sans liste déclarée à maintenir) ;
#   - il SAUTE sinon — la vérification réelle n'est plus un flag opt-in à
#     retenir, elle suit la frontière des entrées du graphe ;
#   - un verrou cassé fait ÉCHOUER son target (stop()) — avec error =
#     "continue", le rapport de run s'écrit quand même et le run reste rouge
#     (l'alerte est le câblage cron #343) : une dérive de la donnée réelle est
#     BRUYANTE, jamais un silence.
# La précision du skip suit la forme du verrou (la REGISTRE ci-dessous) :
#   - sur les fichiers bruts directs (table de passage COG, snapshot Geovelo,
#     CSV CONSOENAF, série historique, exports SCDL/ANCT) : le verrou ne
#     dépend QUE de SES sources (fichier_<theme>_<id>, une cible de fichiers
#     PAR SOURCE du manifeste, ordonnée après le téléchargement du thème) —
#     jamais de tout le thème ;
#   - sur les tables normalisées (les blocs analytiques Économie, le run
#     complet Milieux, le e2e Mobilité) : le verrou reçoit le BRUT du thème
#     (brut_<theme> — déjà calculé par le graphe, jamais re-dérivé : pas de
#     course d'écriture avec les builders) et suit sa fraîcheur (toutes les
#     sources du thème + ses lecteurs).
#
# Le sweep PRÉ-RELEASE (US 14) : une invalidation EXPLICITE, jamais un flag
# par défaut — revérifier TOUTE la donnée réelle :
#   targets::tar_invalidate(starts_with("verif_"))
#   targets::tar_make()
# (les cibles de fichiers fichier_* et les bruts restent frais — seuls les
# verrous rejouent, sur les fichiers déjà à jour du cache.)

# VERIFICATIONS_RUN -------------------------------------------------------------
# La REGISTRE des verrous : par thème du graphe, la liste des (slug,
# verificateur, entrées). Chaque entrée décrit comment le verrou reçoit SES
# entrées (voir les verifier_*_reel) :
#   - `sur_brut = TRUE` : le verrou reçoit les tables NORMALISÉES du thème
#     (donnees = brut_<theme>, déjà calculé par le graphe) — jamais de
#     re-dérivation ni d'écriture : il suit la fraîcheur du brut du thème
#     (toutes ses sources et ses lecteurs, via fichiers_<theme> + imports) ;
#   - `args` : la liste nommée des CHEMINS que le verrou lit — nom = le
#     paramètre de la fonction, valeur = l'id de la source du manifeste du
#     thème (créé en cible fichier_<theme>_<id>, à hash de contenu — la
#     précision du skip par source) OU le sentinelle "epci" (le référentiel
#     partagé extrait, fichier_epci_extrait). La cible de fichiers passée en
#     ARGUMENT est la dépendance : le manifeste résout le chemin, la commande
#     ne hard-code JAMAIS un nom de fichier.
VERIFICATIONS_RUN <- list(
  mobilite = list(
    list(slug = "mobilite_passage_cog",
         verifier = verifier_passage_cog_reel,
         args = list(zip = "cog_passage")),
    list(slug = "mobilite_amenagements",
         verifier = verifier_amenagements_cyclables_reel,
         args = list(parquet = "amenagements_cyclables",
                     zip_cog = "cog_passage")),
    list(slug = "mobilite_raccordement",
         verifier = verifier_raccordement_reel,
         # la sentinelle "raccordement" : l'artefact calculé par la cible
         # raccordement_mobilite (le trait du descripteur) — la vérification
         # suit SA fraîcheur, jamais un re-routage ; la cible published porte
         # le JSON effectivement publié, sans refaire tourner le pipeline
         args = list(artefact = "raccordement", payload = "published")),
    list(slug = "mobilite_e2e",
         verifier = verifier_mobilite_e2e_reel,
         sur_brut = TRUE,
         args = list(base_epci = "epci"))
  ),
  milieux = list(
    list(slug = "milieux_consoenaf",
         verifier = verifier_consoenaf_reel,
         args = list(fichier = "consoenaf")),
    list(slug = "milieux_serie_historique",
         verifier = verifier_serie_historique_reel,
         args = list(zip = "serie_historique")),
    list(slug = "milieux_histoires",
         verifier = verifier_milieux_histoires_reel,
         sur_brut = TRUE)
  ),
  economie = list(
    list(slug = "economie_dortoir",
         verifier = verifier_dortoir_economie_reel,
         sur_brut = TRUE),
    list(slug = "economie_chomage",
         verifier = verifier_chomage_economie_reel,
         sur_brut = TRUE),
    list(slug = "economie_lq_flores",
         verifier = verifier_lq_flores_reel,
         sur_brut = TRUE),
    list(slug = "economie_lq",
         verifier = verifier_lq_economie_reel,
         sur_brut = TRUE),
    list(slug = "economie_eco_activites",
         verifier = verifier_eco_activites_economie_reel,
         sur_brut = TRUE),
    list(slug = "economie_rangs",
         verifier = verifier_rangs_economie_reel,
         sur_brut = TRUE,
         args = list(base_epci = "epci")),
    list(slug = "economie_e2e",
         verifier = verifier_economie_e2e_reel,
         sur_brut = TRUE,
         args = list(base_epci = "epci"))
  )
)

# VERIFICATIONS_PROGRAMMES -------------------------------------------------------
# Les verrous des sources du thème Programmes (hors DAG des CINQ thèmes : le
# payload partagé programmes.json est publié par la chaîne programmes_publication,
# #343 — le bloc des verrous, lui, ne fait que TÉLÉCHARGER et VÉRIFIER). Câblés
# sur le run COMPLET SEULEMENT (LUSK_THEMES vide — le cron) : le graphe
# télécharge alors les six sources du manifeste complet (sources_programmes) et
# les verrous les vérifient ; un run restreint ne force rien de tout cela.
# `args` suit la même convention que VERIFICATIONS_RUN (nom du paramètre -> id
# du manifeste ou "epci").
VERIFICATIONS_PROGRAMMES <- list(
  list(slug = "subventions",
       verifier = verifier_subventions_reel,
       args = list(scdl = "subventions_scdl",
                   base_epci = "epci")),
  list(slug = "programmes",
       verifier = verifier_programmes_reel,
       args = list(acv = "acv",
                   pvd = "pvd",
                   crte = "crte",
                   ti = "territoires_industrie",
                   ort = "ort",
                   scdl = "subventions_scdl",
                   base_epci = "epci"))
)

# fichier_source ----------------------------------------------------------------
# La cible de fichiers d'UNE source : le fichier brut comme target
# format = "file" (fraîcheur PAR CONTENU), ordonné après le téléchargement
# (sources_<thème>) et résolu depuis le manifeste (jamais un nom de fichier
# en dur — le manifeste est la seule source de vérité des fichiers du cache).
fichier_source <- function(theme_nom, id, manifeste, sources,
                           cache = CACHE_RUN) {
  tar_target_raw(
    paste0("fichier_", theme_nom, "_", id),
    bquote({
      .(sources)
      fichier <- .(manifeste)$fichier[.(manifeste)$id == .(id)]
      stopifnot(length(fichier) == 1L)
      file.path(.(cache), fichier)
    }),
    format = "file"
  )
}

# verifications_theme -----------------------------------------------------------
# Les cibles de vérification d'UN thème du graphe (la REGISTRE) : le verrou
# reçoit SES entrées en ARGUMENTS — les cibles de fichiers PAR SOURCE
# (fichier_<theme>_<id>, dédupliquées entre verrous du thème, ordonnées
# après le téléchargement), ou le brut du thème (`sur_brut`), ou le
# référentiel partagé (la sentinelle "epci"). Passer la cible en argument EST
# la dépendance — le manifeste résout le chemin, la commande ne hard-code
# jamais un nom de fichier.
verifications_theme <- function(theme, cache = CACHE_RUN, sortie = SORTIE_RUN) {
  spec <- VERIFICATIONS_RUN[[theme$theme]]
  if (is.null(spec)) return(list())
  cibles <- list()
  deja <- character(0)
  for (v in spec) {
    fn_sym <- symbole_ns(v$verifier)
    appels <- list()
    if (isTRUE(v$sur_brut)) {
      appels[["donnees"]] <- as.name(paste0("brut_", theme$theme))
    }
    for (param in names(v$args)) {
      id <- v$args[[param]]
      if (identical(id, "epci")) {
        appels[[param]] <- as.name("fichier_epci_extrait")
      } else if (identical(id, "raccordement")) {
        # la sentinelle du raccordement (#486) : l'artefact calculé par la
        # cible du trait — le verrou reçoit SON chemin (format = "file"),
        # la vérification suit SA fraîcheur
        appels[[param]] <- as.name(paste0("raccordement_", theme$theme))
      } else if (identical(id, "published")) {
        # La vérification du raccordement lit le JSON publié, mais le chemin
        # est lui-même une cible de fichiers ordonnée après la publication :
        # une dérive du payload ne peut pas laisser le verrou frais.
        cible_payload <- as.name(paste0("fichier_payload_", theme$theme))
        if (!id %in% deja) {
          cibles <- c(cibles, list(
            tar_target_raw(
              as.character(cible_payload),
              bquote({
                .(as.name(paste0("publie_", theme$theme)))
                .(file.path(sortie, paste0("indicateurs_", theme$theme, ".json")))
              }),
              format = "file"
            )
          ))
          deja <- c(deja, id)
        }
        appels[[param]] <- cible_payload
      } else {
        if (!id %in% deja) {
          cibles <- c(cibles, list(fichier_source(
            theme$theme, id,
            as.name(paste0("manifeste_", theme$theme)),
            as.name(paste0("sources_", theme$theme)),
            cache = cache
          )))
          deja <- c(deja, id)
        }
        appels[[param]] <- as.name(paste0("fichier_", theme$theme, "_", id))
      }
    }
    cibles <- c(cibles, list(
      tar_target_raw(
        paste0("verif_", v$slug),
        as.call(c(list(fn_sym), appels))
      )
    ))
  }
  cibles
}

# verifications_programmes -------------------------------------------------------
# Les cibles de vérification du thème Programmes (hors DAG) : le
# téléchargement des six sources (sources_programmes), les cibles de fichiers
# par source (dédupliquées entre verrous), puis les verrous LEAF qui reçoivent
# leurs chemins en arguments — la même mécanique que verifications_theme,
# sans grappe.
verifications_programmes <- function(cache = CACHE_RUN, mode = MODE_RUN) {
  cibles <- list(
    tar_target_raw(
      "sources_programmes",
      bquote(download_sources(manifeste_programmes, cache = .(cache),
                              mode = .(mode)))
    )
  )
  deja <- character(0)
  for (v in VERIFICATIONS_PROGRAMMES) {
    fn_sym <- symbole_ns(v$verifier)
    appels <- list()
    for (param in names(v$args)) {
      id <- v$args[[param]]
      if (identical(id, "epci")) {
        appels[[param]] <- as.name("fichier_epci_extrait")
      } else {
        if (!id %in% deja) {
          cibles <- c(cibles, list(fichier_source(
            "programmes", id,
            as.name("manifeste_programmes"), as.name("sources_programmes"),
            cache = cache
          )))
          deja <- c(deja, id)
        }
        appels[[param]] <- as.name(paste0("fichier_programmes_", id))
      }
    }
    cibles <- c(cibles, list(
      tar_target_raw(
        paste0("verif_", v$slug),
        as.call(c(list(fn_sym), appels))
      )
    ))
  }
  cibles
}

# programmes_publication -------------------------------------------------------
# La publication du payload PARTAGÉ programmes (ADR-0013) dans le graphe : le
# thème Programmes n'est pas un thème de THEMES_RUN (les CINQ thèmes du
# payload par-thème — la porte byte-identical) mais le run COMPLET (le cron,
# #343) publie SON payload partagé : programmes.json + les parquets par table
# (ecrire_programmes_partage, le contrat « 404 = table absente »). Le
# téléchargement est celui du bloc des verrous (sources_programmes — la même
# source de vérité) ; la chaîne ajoute :
#   - fichiers_programmes : les SIX fichiers du manifeste complet en cible
#     format = "file" (fraîcheur PAR CONTENU, la même mécanique que
#     fichiers_<thème>) — une source modifiée invalide le brut et la
#     publication, sans jamais toucher au payload des cinq thèmes ;
#   - brut_programmes : construire_donnees_programmes, appelé PAR SYMBOLE
#     (le suivi d'imports hashe son corps et ses dépendances transitives) ;
#   - vintages_table_programmes : vintages_programmes (la projection
#     générique depuis le manifeste complet, SCDL comprise) — la table que la
#     fusion PARTAGÉE des vintages upsert, au même rang que le cron séquentiel
#     (issue #178) ;
#   - publie_programmes : le seam publier_programmes appelé PAR SYMBOLE avec
#     la MÊME forme d'appel que publie_theme (brut, cache, vintages, sortie —
#     l'identité byte-identique avec run_pipeline(theme = theme_programmes())).
#     La dépendance sur fichier_epci_extrait ordonne l'extraction du
#     référentiel partagé que le seam lit PAR CHEMIN
#     (cache/extracted/EPCI_au_01-01-2025.xlsx) ; sortie_analytiques garde SON
#     défaut (dirname(cache)/processed/programmes — le même rangement que
#     run_pipeline).
# Câblée sur le run COMPLET SEULEMENT (LUSK_THEMES vide — le cron), le même
# trait que les verrous VERIFICATIONS_PROGRAMMES : un run restreint ne force
# rien de tout cela. La chaîne est LEAF : rien des CINQ thèmes n'en dépend —
# la publication programmes ne peut pas invalider le payload des cinq thèmes.
programmes_publication <- function(cache = CACHE_RUN, sortie = SORTIE_RUN) {
  theme <- theme_programmes()
  construire <- symbole_ns(theme$construire_donnees)
  vintages_fn <- symbole_ns(theme$vintages)
  publier_fn <- symbole_ns(theme$publier)
  list(
    tar_target_raw(
      "fichiers_programmes",
      bquote({
        sources_programmes
        file.path(.(cache), manifeste_programmes$fichier)
      }),
      format = "file"
    ),
    tar_target_raw(
      "brut_programmes",
      bquote({
        fichiers_programmes
        .(construire)(cache = .(cache))
      })
    ),
    tar_target_raw("vintages_table_programmes", bquote(.(vintages_fn)())),
    tar_target_raw(
      "publie_programmes",
      bquote({
        fichier_epci_extrait
        .(publier_fn)(brut_programmes, cache = .(cache),
                      vintages = vintages_table_programmes,
                      sortie = .(sortie))
      })
    ),
    # les métadonnées du sixième thème (#408) : le canon épinglé est une
    # DÉPENDANCE SUIVIE (format = "file", fraîcheur par contenu — la même
    # mécanique que fichier_metadata_<thème> des cinq thèmes), la publication
    # passe par le trait `metadata` du descripteur et la garde theme_attendu.
    # Chaînée sur publie_programmes : les écritures de la cible partagée se
    # sérialisent, jamais une course entre deux targets du bloc.
    tar_target_raw(
      "fichier_metadata_programmes",
      bquote(system.file("extdata", "theme-metadata", "theme_programmes.json",
                         package = "lusk")),
      format = "file"
    ),
    tar_target_raw(
      "metadata_programmes",
      bquote({
        publie_programmes
        fichier_metadata_programmes
        # directions_module : theme_programmes() n'expose PAS de registre de
        # directions (le thème ne classe pas, ses rangs sont tous NA — la
        # croisée #506 ne vit que là où les deux déclarations existent) ;
        # l'expression reste le point de câblage si un jour il en gagne un.
        publier_theme_metadata(theme_programmes()$metadata(), .(sortie),
                               vintages = vintages_table_programmes,
                               theme_attendu = theme_programmes()$theme,
                               directions_module = theme_programmes()$directions)
      })
    )
  )
}

# construire_fichier_epci_extrait ------------------------------------------------
# Le référentiel partagé des EPCI EXTRAIT (extracted/EPCI_au_01-01-2025.xlsx) :
# la base transversale que les normalisateurs lisent dans le cache (déclarée
# sous son zip par les manifestes Démographie/Habitat/Milieux — JAMAIS une
# source Économie/Mobilité/Programmes). Le target de fichiers la suit PAR
# CONTENU (une nouvelle édition du zip change l'xlsx -> les verrous qui la
# lisent rejouent) et garantit l'extraction CONTENT-idempotente : overwrite =
# TRUE — une nouvelle édition du zip REMPLACE l'xlsx extrait (le hash du
# target change, les verrous rejouent), un zip inchangé ré-extraie des
# fichiers byte-identiques (même hash, les verrous sautent). L'ORDRE : quand
# un thème du run déclare la source `epci`, le target est ordonné après SON
# téléchargement (sources_<thème> — pas de course entre l'extraction et le
# download du run) ; sur un run restreint sans thème déclarant epci, il lit
# le cache tel quel (la base y est déjà — la condition préexistante des runs
# mono-thème, publier_<thème> la lit pareil).
construire_fichier_epci_extrait <- function(cache = CACHE_RUN) {
  proprietaire <- NULL
  for (t in THEMES_RUN) {
    if ("epci" %in% t$manifest$id) {
      proprietaire <- t$theme
      break
    }
  }
  entetes <- list()
  if (!is.null(proprietaire)) {
    entetes <- c(entetes, list(as.name(paste0("sources_", proprietaire))))
    manifeste_var <- as.name(paste0("manifeste_", proprietaire))
    zip_expr <- bquote(file.path(.(cache), .(manifeste_var)$fichier[
      .(manifeste_var)$id == "epci"]))
  } else {
    zip_expr <- bquote(file.path(.(cache), "epci_au_01-01-2025.zip"))
  }
  corps <- c(entetes, list(bquote({
    extrait <- file.path(.(cache), "extracted")
    if (!dir.exists(extrait)) dir.create(extrait, recursive = TRUE)
    zip_epci <- .(zip_expr)
    if (!file.exists(zip_epci)) {
      stop("Le référentiel partagé des EPCI est absent du cache (", zip_epci,
           ") — les verrous « données réelles » en ont besoin.", call. = FALSE)
    }
    suppressWarnings(utils::unzip(zip_epci, exdir = extrait, overwrite = TRUE))
    file.path(extrait, "EPCI_au_01-01-2025.xlsx")
  })))
  tar_target_raw("fichier_epci_extrait",
                 as.call(c(list(as.name("{")), corps)),
                 format = "file")
}

# Le graphe ---------------------------------------------------------------------
# Les grappes des thèmes du run, puis les artefacts partagés : les
# publications chaînées (la référence des territoires est déterministe), la
# fusion partagée des vintages, les rapports de run chaînés, et la géométrie
# du fond de carte — un artefact PARTAGÉ du run (issue #60, ADR-0008), pas
# une table du thème : publiée vers la même cible que le payload, upsert
# comme lui.
grappes <- unlist(lapply(THEMES_RUN, grappe_theme), recursive = FALSE)

publies <- list()
precedent <- NULL
for (t in THEMES_RUN) {
  publies <- c(publies, list(publie_theme(t, precedent = precedent)))
  precedent <- as.name(paste0("publie_", t$theme))
}

rapports <- list()
precedent <- NULL
for (t in THEMES_RUN) {
  rapports <- c(rapports, list(rapport_theme(t, precedent = precedent)))
  precedent <- as.name(paste0("rapport_", t$theme))
}
# Le run COMPLET (le cron, #343) : le rapport de run du thème Programmes,
# chaîné DERNIER — le rapport final porte les statuts du thème Programmes,
# exactement comme six run_pipeline séquentiels (le dernier thème gagne).
if (!nzchar(selection)) {
  rapports <- c(rapports, list(rapport_theme(theme_programmes(),
                                             precedent = precedent)))
}

# Les verrous « données réelles » du run : par thème du graphe, plus (sur le
# run COMPLET — LUSK_THEMES vide, le cron) les verrous du thème Programmes.
# Le référentiel partagé extrait (fichier_epci_extrait) n'est câblé qu'une
# fois, et seulement si un verrou du run le lit (la sentinelle "epci" de SES
# args — la REGISTRE) OU si la chaîne du raccordement d'un thème en dépend
# (le trait `raccordement` — issue #486 : ses niveaux agrégés lisent
# l'EPCI_au_01-01-2025.xlsx extrait).
verifications <- list()
besoin_epci <- FALSE
for (t in THEMES_RUN) {
  verifications <- c(verifications, verifications_theme(t))
  spec <- VERIFICATIONS_RUN[[t$theme]]
  if (!is.null(spec) &&
      any(vapply(spec, function(v) "epci" %in% unlist(v$args), logical(1)))) {
    besoin_epci <- TRUE
  }
  if (!is.null(t$raccordement)) besoin_epci <- TRUE
}
publication_programmes <- list()
if (!nzchar(selection)) {
  # le manifeste COMPLET du thème Programmes (les six sources ANCT/DGALN +
  # SCDL) : la variable du script que les commandes du bloc résolvent (la
  # même convention que les manifeste_<thème> du graphe)
  assign("manifeste_programmes", MANIFEST_PROGRAMMES_COMPLET)
  verifications <- c(verifications, verifications_programmes())
  # la publication du payload PARTAGÉ programmes (ADR-0013) : le run COMPLET
  # (le cron) publie programmes.json + les parquets par table — le même rang
  # que le SIXIÈME appel run_pipeline(theme = theme_programmes()) de l'oracle
  # (test-targets-byte-identical). LEAF : rien des CINQ thèmes n'en dépend.
  publication_programmes <- programmes_publication()
  if (any(vapply(VERIFICATIONS_PROGRAMMES,
                 function(v) "epci" %in% unlist(v$args), logical(1)))) {
    besoin_epci <- TRUE
  }
}
if (besoin_epci) {
  verifications <- c(verifications, list(construire_fichier_epci_extrait()))
}

# La fusion PARTAGÉE des vintages : les CINQ thèmes du run — plus, sur le run
# COMPLET (le cron, #343), le thème Programmes : la table partagée porte
# aussi les SIX sources du module, SCDL comprise (issue #178 — l'upsert par
# id, le même rang que six run_pipeline séquentiels).
themes_fusion <- if (!nzchar(selection)) {
  c(THEMES_RUN, list(programmes = theme_programmes()))
} else {
  THEMES_RUN
}

list(
  grappes,
  publies,
  fusion_themes(themes_fusion),
  rapports,
  tar_target(geometrie, publier_geometrie(SORTIE_RUN)),
  verifications,
  publication_programmes
)
