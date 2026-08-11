# resoudre_histoires -------------------------------------------------------------
# Issue #312 (parent #308) : la RÉSOLUTION des histoires remonte dans le
# pipeline. Les modules de thème calculent les lignes CANDIDATES (une ligne
# par territoire × story_key — la matière de chaque lecture), et la machinerie
# partagée RÉSOUT : une lecture par (territoire, groupe) de fiche, avec la
# clé choisie (story_key), la raison de saillance (salience_reason), la
# matière de la lecture et les faits de fraîcheur applicables. Le pool de
# candidats est de la logique de pipeline — JAMAIS des lignes par territoire
# dans le payload (ADR-0002) : là où la saillance tire, la lecture saillante
# REMPLACE le défaut ; ailleurs, le défaut reste la lecture.
#
# Le registre partagé STORIES_RESOLUES_PAR_THEME (theme_metadata.R) déclare,
# par thème : le groupe de fiche de chaque story, l'ORDRE dans le pool
# (1 = le défaut) et la raison de saillance des candidats. La résolution est
# déterministe : même candidats + même registre -> mêmes lectures, toujours.
#
# Entrée : les lignes candidates du thème (territoire, type, theme, story_key,
# + la matière). Sortie : les lignes résolues (une par territoire × groupe),
# avec groupe + salience_reason en tête et la matière conservée. Le thème est
# le nom du descripteur (la colonne `theme` des lignes).

# resoudre_histoires -------------------------------------------------------------
# La résolution partagée : joint le registre aux candidats, puis par
# (territoire, groupe) garde la story la PLUS AVANCÉE du pool (l'ordre du
# registre — la saillance remplace le défaut, jamais l'inverse). La raison de
# saillance de la ligne gagnante est « defaut » pour le défaut, la raison
# déclarée pour un candidat qui a tiré. L'ordre de sortie est déterministe :
# groupe, territoire, story_key.
resoudre_histoires <- function(candidats, theme) {
  registre <- STORIES_RESOLUES_PAR_THEME[[theme]]
  if (is.null(registre)) {
    stop("resoudre_histoires : thème « ", theme,
         " » sans registre de stories résolues (STORIES_RESOLUES_PAR_THEME).",
         call. = FALSE)
  }

  lignes <- dplyr::left_join(candidats, registre, by = "story_key")
  inconnues <- unique(lignes$story_key[is.na(lignes$groupe)])
  if (length(inconnues) > 0) {
    stop("resoudre_histoires : story(s) candidate(s) inconnue(s) du registre « ",
         theme, " » : ", paste(inconnues, collapse = ", "),
         " — le pool est de la logique de pipeline, jamais une story hors contrat.",
         call. = FALSE)
  }

  # par (territoire, groupe) : la story la PLUS AVANCÉE du pool gagne (ordre
  # décroissant — le défaut en 1er, les candidats après — puis slice(1))
  resolues <- lignes %>%
    dplyr::group_by(territoire, groupe) %>%
    dplyr::arrange(dplyr::desc(ordre), story_key, .by_group = TRUE) %>%
    dplyr::slice(1) %>%
    dplyr::ungroup()

  # la raison de saillance : « defaut » pour le défaut, la raison déclarée
  # pour un candidat qui a tiré (jamais une raison inventée)
  resolues$salience_reason <- dplyr::if_else(
    is.na(resolues$salience_reason), SALIENCE_DEFAUT, resolues$salience_reason
  )

  resolues %>%
    dplyr::select(-ordre) %>%
    dplyr::select(territoire, type, theme, groupe, story_key, salience_reason,
                  dplyr::everything()) %>%
    dplyr::arrange(groupe, territoire, story_key)
}

# valider_histoires_resolues ------------------------------------------------------
# Le garde-fou de la résolution (issue #312) : chaque ligne du payload porte
# son groupe de fiche, sa story choisie et sa raison de saillance, et
# l'identité (territoire × groupe) est UNIQUE — jamais deux lectures pour le
# même slot de sous-groupe. Toute dérive échoue FORT, en nommant la faute :
#   - une story_key hors du registre du thème (une lecture qui n'existe pas) ;
#   - un groupe hors du registre (un slot de fiche inconnu) ;
#   - une story qui n'appartient pas au pool de SON groupe ;
#   - un doublon (territoire × groupe) (le pool non résolu a fui le payload) ;
#   - une salience_reason incohérente avec la story (le défaut doit dire
#     « defaut », un candidat SA raison déclarée).
# La complétude (« chaque territoire du payload porte au moins une lecture »)
# est vérifiée par validate_payload, qui a la table des territoires.
valider_histoires_resolues <- function(histoires, theme) {
  registre <- STORIES_RESOLUES_PAR_THEME[[theme]]
  if (is.null(registre)) {
    stop("Payload invalide : thème « ", theme,
         " » sans registre de stories résolues.", call. = FALSE)
  }
  if (nrow(histoires) == 0) {
    stop("Payload invalide : aucune histoire résolue pour le thème « ", theme,
         " ».", call. = FALSE)
  }
  manquants <- setdiff(c("territoire", "type", "theme", "groupe",
                         "story_key", "salience_reason"), names(histoires))
  if (length(manquants) > 0) {
    stop("Payload invalide : colonne(s) d'histoire résolue manquante(s) : ",
         paste(manquants, collapse = ", "), ".", call. = FALSE)
  }

  # 1. la story choisie est déclarée dans le registre du thème
  inconnues <- setdiff(unique(histoires$story_key), unique(registre$story_key))
  if (length(inconnues) > 0) {
    stop("Payload invalide : story(s) résolue(s) hors du registre « ", theme,
         " » : ", paste(inconnues, collapse = ", "), ".", call. = FALSE)
  }
  # 2. le groupe est déclaré
  groupes_inconnus <- setdiff(unique(histoires$groupe),
                              unique(registre$groupe))
  if (length(groupes_inconnus) > 0) {
    stop("Payload invalide : groupe(s) de fiche inconnu(s) du registre « ",
         theme, " » : ", paste(groupes_inconnus, collapse = ", "), ".",
         call. = FALSE)
  }
  # 3. la story appartient au pool de SON groupe (une story dans le mauvais
  #    slot est une lecture déplacée)
  pool_par_groupe <- split(registre$story_key, registre$groupe)
  mal_placees <- mapply(function(groupe, story) {
    !story %in% pool_par_groupe[[groupe]]
  }, histoires$groupe, histoires$story_key)
  if (any(mal_placees)) {
    stop("Payload invalide : une story résolue ne vit pas dans le groupe qui ",
         "la lit (« ", histoires$story_key[mal_placees][1], " » dans « ",
         histoires$groupe[mal_placees][1], " »).", call. = FALSE)
  }
  # 4. l'identité (territoire × groupe) est unique — jamais le pool non résolu
  dups <- duplicated(histoires[c("territoire", "groupe")])
  if (any(dups)) {
    stop("Payload invalide : lecture en double (territoire × groupe) pour le ",
         "thème « ", theme, " » — le pool n'est pas résolu, une seule lecture ",
         "par slot de sous-groupe.", call. = FALSE)
  }
  # 5. la salience_reason est cohérente avec la story choisie : « defaut » pour
  #    le défaut, la raison DÉCLARÉE pour un candidat qui a tiré
  raison_declaree <- stats::setNames(registre$salience_reason,
                                     registre$story_key)
  attendue <- dplyr::if_else(
    is.na(raison_declaree[histoires$story_key]),
    SALIENCE_DEFAUT,
    raison_declaree[histoires$story_key]
  )
  incohérentes <- histoires$salience_reason != attendue
  if (any(incohérentes)) {
    stop("Payload invalide : salience_reason incohérente avec la story « ",
         histoires$story_key[incohérentes][1], " » (attendu « ",
         attendue[incohérentes][1], " », reçu « ",
         histoires$salience_reason[incohérentes][1], " »).", call. = FALSE)
  }

  invisible(histoires)
}
