# vintage ---------------------------------------------------------------------
# Étape 4 : vintages. Écrit source / version / licence / dates pour chaque jeu
# de données, depuis le manifeste — la table des fraîcheurs et le SEAM du
# watchdog (ADR-0001 : la licence y figure). Deux dates par source (point 5) :
# date_reference (ce que « RP 2023 » veut dire) et date_publication (la mise
# en ligne réelle — ce que le watchdog comparera à data.gouv pour déclencher
# le pipeline). `id` reste dans la table pour un pointage explicite par source.
# Issue #13 : le build des vintages est générique — il se projette depuis le
# manifeste DU THÈME ; le module du thème expose son builder (vintages_<theme>)
# qui passe son propre manifeste.
# Issue #1103 : la table publiée porte la vintage DÉRIVÉE de chaque source.
# Quand les octets du run égalent ceux du lockfile, la valeur est celle du
# lockfile (déterministe, sans horloge) ; sinon elle vient du digest du run,
# jamais d'un littéral figé pour les bases dérivées.

# Erreurs nommées du fail-closed (issue #1114) ----------------------------------
# Une base dérivée SANS attestation (ni lockfile, ni sidecar valide) ne publie
# jamais le littéral du manifeste : elle lève une condition nommée. Même garde
# pour un format de version dérivée qui ne serait pas `YYYY-MM`.
erreur_vintage_non_attestee <- function(id) {
  structure(
    list(
      message = paste0(
        "Vintage non attestée (issue #1114) pour la source « ", as.character(id),
        " » : base dérivée sans enregistrement de lockfile ni sidecar valide. ",
        "Aucun run n'atteste d'acquisition — le littéral du manifeste ne peut ",
        "pas être publié."
      ),
      call = NULL, id = as.character(id)
    ),
    class = c("erreur_vintage_non_attestee", "error", "condition")
  )
}

erreur_format_vintage <- function(id, version) {
  structure(
    list(
      message = paste0(
        "Format de vintage invalide (issue #1114) pour la source « ",
        as.character(id), " » : « ", as.character(version),
        " » — une base dérivée publie une version YYYY-MM."
      ),
      call = NULL, id = as.character(id), version = as.character(version)
    ),
    class = c("erreur_format_vintage", "error", "condition")
  )
}

# attestation_vintage -----------------------------------------------------------
# L'attestation d'une source — le digest du run et/ou le lockfile. Le lock n'est
# utilisable que pour les octets qu'il verrouille ou quand aucun digest n'existe
# (le fichier n'a pas bougé depuis le lock). Partagé par la projection et par la
# garde de fail-closed pour qu'elles ne puissent pas diverger.
attestation_vintage <- function(id, cache, fichier = NULL, lock = NULL) {
  digest <- lire_digest_cache(id, cache, fichier = fichier)
  verrouille <- lire_lock(lock)[[id]]
  lock_utilisable <- !is.null(verrouille) &&
    (is.null(digest) ||
       identical(as.character(verrouille$sha256), as.character(digest$sha256)))
  list(digest = digest, verrouille = verrouille, lock_utilisable = lock_utilisable)
}

vintages_depuis_manifest <- function(manifest,
                                      cache = Sys.getenv("LUSK_CACHE", unset = "data/raw"),
                                      lock = NULL, exiger_attestation = FALSE) {
  manifest <- declarer_bases(manifest)
  vintages <- manifest %>%
    dplyr::transmute(
      id = id,
      source = source,
      version = vintage,
      licence = licence,
      date_reference = date_reference,
      date_publication = date_publication
    )

  for (i in seq_len(nrow(manifest))) {
    base <- manifest$vintage_basis[i]
    if (!(base %in% BASIS_VINTAGE_DERIVES)) next
    id <- manifest$id[i]
    attestation <- attestation_vintage(id, cache, fichier = manifest$fichier[i],
                                       lock = lock)
    digest <- attestation$digest
    verrouille <- attestation$verrouille
    lock_utilisable <- attestation$lock_utilisable
    # Issue #1114 : en mode run, une base dérivée sans lock ni sidecar est une
    # erreur nommée — jamais le littéral du manifeste publié.
    if (exiger_attestation && !lock_utilisable && is.null(digest)) {
      stop(erreur_vintage_non_attestee(id))
    }
    if (lock_utilisable) {
      # Locked bytes: deterministic, clock-free vintage from the lockfile.
      vintages$version[i] <- as.character(verrouille$vintage)
      vintages$date_reference[i] <- as.character(verrouille$date_reference)
      vintages$date_publication[i] <- as.character(verrouille$acquired_at)
    } else if (!is.null(digest)) {
      # A real run: the derived value recorded by the resolver (never a stale
      # literal for a `telechargement` source).
      vintages$version[i] <- as.character(digest$vintage)
      vintages$date_reference[i] <- as.character(digest$date_reference)
      vintages$date_publication[i] <- as.character(digest$acquired_at)
    }
    # Sans digest ni verrou, aucun run n'atteste d'acquisition : on garde le
    # vintage déclaré (par exemple un builder de thème appelé hors d'un run).
    # Une source qui déclare NA n'a pas de date de publication (ORT line-by-line,
    # DPE base roulante) : on ne lui en invente pas une à partir de
    # l'acquisition — ADR-0048, respecté aussi par les sources attestées.
    if (!is.na(manifest$date_publication[i])) next
    vintages$date_publication[i] <- NA_character_
  }
  vintages
}

# verifier_vintages_attestees --------------------------------------------------
# Garde de fail-closed du GRAPHE (issue #1114) : la table d'un thème est produite
# APRÈS le téléchargement de ses sources (les cibles `sources_<thème>` et
# `fichiers_<thème>` sont des dépendances) ; on exige donc que chaque source à
# base dérivée porte une attestation, et que sa version publiée soit YYYY-MM.
# Les sources `declaree` gardent leur vintage déclaré, sans attestation requise.
verifier_vintages_attestees <- function(vintages, manifest,
                                        cache = Sys.getenv("LUSK_CACHE", unset = "data/raw"),
                                        lock = NULL) {
  manifest <- declarer_bases(manifest)
  for (i in seq_len(nrow(manifest))) {
    base <- manifest$vintage_basis[i]
    if (!(base %in% BASIS_VINTAGE_DERIVES)) next
    id <- manifest$id[i]
    attestation <- attestation_vintage(id, cache, fichier = manifest$fichier[i],
                                       lock = lock)
    if (!attestation$lock_utilisable && is.null(attestation$digest)) {
      stop(erreur_vintage_non_attestee(id))
    }
    ligne <- vintages[vintages$id == id, , drop = FALSE]
    if (nrow(ligne) && !grepl("^\\d{4}-\\d{2}$", as.character(ligne$version[[1L]]))) {
      stop(erreur_format_vintage(id, ligne$version[[1L]]))
    }
  }
  invisible(vintages)
}

# fusionner_vintages -----------------------------------------------------------
# Issue #124 : la table des vintages est PARTAGÉE (pas par-thème) — un run doit
# FUSIONNER ses sources dans la table déjà sur disque au lieu d'écraser le
# fichier commun avec les seules sources de son thème (last-writer-wins par
# thème, le même bug que #116 a corrigé pour apercu). Sémantique d'upsert par
# source : lire l'existante (le parquet canonique, ADR-0004) si présente,
# bind_rows avec les vintages du thème — les sources du run sont les plus
# fraîches et gagnent sur leur id — puis dédupliquer par `id`. Une source ne
# disparaît jamais de la table partagée parce qu'un autre thème a tourné.
# Issue #243 : `retires` — les ids que le thème ne déclare PLUS (sa source a
# été remplacée dans son manifeste, ex. les quatre différentielles OCS-GE
# sorties par l'amendement) sont RETIRÉS de la table partagée : une source
# remplacée ne doit pas rester estampillée « fraîche » à côté de son
# remplaçante. Déclaré par le thème (retire_vintages du descripteur), jamais
# inféré — le thème sait quelles sources il a retirées.
fusionner_vintages <- function(vintages, sortie = "public/data",
                                retires = character(0)) {
  chemin <- file.path(sortie, "vintages.parquet")
  if (!file.exists(chemin)) {
    return(vintages)
  }
  existantes <- nanoparquet::read_parquet(chemin)
  existantes <- existantes[!existantes$id %in% retires, ]
  dplyr::bind_rows(vintages, existantes) %>%
    dplyr::distinct(id, .keep_all = TRUE)
}
