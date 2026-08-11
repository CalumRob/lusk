# theme_metadata ----------------------------------------------------------------
# Le contrat de métadonnées par thème (issue #309, parent #308) : chaque thème
# construit publie UN fichier theme_<theme>.json qui déclare — pour la fiche —
# l'ordre des sous-groupes, leurs labels et cadrages, les familles de figures,
# le texte riche TYPÉ des lectures (jamais de HTML brut), le lien vers
# l'histoire résolue de chaque sous-groupe et la politique de source de
# référence des indicateurs. La machinerie partagée (publish, l'app) lit ce
# fichier ; la validation (valider_theme_metadata) est le miroir R du
# validateur TypeScript de l'app (validerThemeMetadata,
# app/src/payload/validate.ts) : la même forme, les mêmes règles, des erreurs
# bruyantes des deux côtés — jamais une dérive silencieuse.
#
# Frontière explicite (parent #308) : Programmes & financements n'est PAS un
# thème — c'est un contrat de publication SÉPARÉ (programmes.json, ADR-0013)
# qui ne reçoit JAMAIS de fichier theme_programmes.json fabriqué. Un fichier
# de métadonnées déclarant theme = "programmes" est rejeté ici.

# Les cinq thèmes de données construits qui possèdent un fichier de
# métadonnées — jamais « programmes ».
THEMES_METADATA <- c("mobilite", "demographie", "habitat", "economie", "milieux")

# La petite grammaire partagée des figures (parent #308) : scalar (une valeur),
# composition (des parts qui somment), distribution (une signature de
# répartition), trajectory (une évolution), relationship (une relation entre
# deux forces), profile (un classement). Des identifiants de contrat, en
# anglais — les labels français vivent dans les métadonnées.
FAMILLES_FIGURE <- c("scalar", "composition", "distribution", "trajectory",
                     "relationship", "profile")

# Les types de nœuds du texte riche TYPÉ — une liste fermée : le HTML brut
# n'est pas un type, un contenu text avec des chevrons est rejeté.
TYPES_NOEUD_TEXTE_RICHE <- c("text", "param", "territoire", "strong", "link")

# Le registre des story_keys par thème — le miroir R de CLES_HISTOIRES_PAR_THEME
# (app/src/payload/types.ts). C'est la base de la règle d'herméticité
# (ADR-0020) : un thème ne peut lier que SES histoires, jamais celles d'un
# autre thème — une story d'un autre thème dans les métadonnées est une
# référence cross-thème, rejetée.
CLES_HISTOIRES_PAR_THEME <- list(
  mobilite = c("vingt-minutes-sans-voiture", "ce-que-le-velo-preserve"),
  demographie = "trajectoire-demographique",
  habitat = "etat-energetique-du-parc",
  economie = c("ce-que-la-commune-abrite", "ce-que-la-bretagne-abrite"),
  milieux = "se-densifier-setaler-ou-sen-aller"
)

# lire_theme_metadata / publier_theme_metadata ---------------------------------
# Le lecteur du fichier épinglé et le seam de publication vivent dans
# publier_theme_metadata.R — le contrat (valider_theme_metadata, les registres
# ci-dessus) est ici, la publication est là (la même séparation que
# theme_programmes.R : le contrat d'un côté, publier_programmes de l'autre).

# STORIES_RESOLUES_PAR_THEME ----------------------------------------------------
# Le registre de la RÉSOLUTION des histoires (issue #312, parent #308) : pour
# chaque thème, la table qui dit où chaque story vit (le `groupe` de la fiche —
# le sous-groupe que la lecture rend), l'ORDRE de la story dans le pool
# (1 = le défaut toujours allumé, ADR-0002 — les candidats de saillance le
# REPLACENT quand leur règle tire) et la raison de saillance DÉCLARÉE du
# candidat (NA pour le défaut — la raison est « defaut »). C'est la base de
# resoudre_histoires (resoudre_histoires.R) : le pipeline choisit la lecture,
# il ne publie jamais le pool.
#
# Les groupes des thèmes du contrat #309 (les fixtures theme-<theme>-valide.json)
# font foi : « etat-et-dynamique » (Démographie), « sante-et-taille » +
# « structure-verte » (Économie). Pour les thèmes sans fixture encore publiée
# (Habitat, Milieux, Mobilité), le groupe est LE slot de lecture du thème — un
# nom de fiche stable que les métadonnées publiées (#311) reprendront.
# Mobilité est le SEUL pool (ADR-0002) : « vingt-minutes-sans-voiture » est le
# défaut de chaque territoire, « ce-que-le-velo-preserve » le remplace là où
# le delta est réel (raison « delta-velo-saillant »). Économie n'a pas de pool :
# ses deux stories vivent dans DEUX groupes distincts (la lecture de
# spécialisation des communes/EPCIs/départements, la lecture de structure de
# la région).
STORIES_RESOLUES_PAR_THEME <- list(
  mobilite = tibble::tibble(
    story_key = c("vingt-minutes-sans-voiture", "ce-que-le-velo-preserve"),
    groupe = "acces-aux-services",
    ordre = c(1L, 2L),
    salience_reason = c(NA_character_, "delta-velo-saillant")
  ),
  demographie = tibble::tibble(
    story_key = "trajectoire-demographique",
    groupe = "etat-et-dynamique",
    ordre = 1L,
    salience_reason = NA_character_
  ),
  habitat = tibble::tibble(
    story_key = "etat-energetique-du-parc",
    groupe = "etat-du-parc",
    ordre = 1L,
    salience_reason = NA_character_
  ),
  economie = tibble::tibble(
    story_key = c("ce-que-la-commune-abrite", "ce-que-la-bretagne-abrite"),
    groupe = c("sante-et-taille", "structure-verte"),
    ordre = c(1L, 1L),
    salience_reason = c(NA_character_, NA_character_)
  ),
  milieux = tibble::tibble(
    story_key = "se-densifier-setaler-ou-sen-aller",
    groupe = "artificialisation",
    ordre = 1L,
    salience_reason = NA_character_
  )
)

# SALIENCE_DEFAUT ---------------------------------------------------------------
# La raison de saillance de la lecture DÉFAUT — la story toujours allumée
# (ordre 1 du pool) dont aucun candidat n'a tiré. Le vocabulaire clos de la
# colonne salience_reason : « defaut » + les raisons déclarées des candidats
# (STORIES_RESOLUES_PAR_THEME$salience_reason) — la validation refuse toute
# autre valeur (jamais une raison inventée).
SALIENCE_DEFAUT <- "defaut"

# valider_template --------------------------------------------------------------
# Le texte riche TYPÉ (parent #308) : une liste fermée de nœuds — text (avec
# son contenu, jamais de chevrons — le HTML brut est interdit), param (une
# valeur de lecture DÉCLARÉE dans reading.params), territoire (le nom du
# territoire rendu), strong et link (des conteneurs avec enfants). Un lien ne
# peut pas en contenir un autre ; un type inconnu échoue fort.
valider_template <- function(template, params, cle, manquer) {
  est_chaine_non_vide <- function(x) {
    is.character(x) && length(x) == 1L && !is.na(x) && nzchar(x)
  }
  est_liste <- function(x) is.list(x) && !is.data.frame(x)

  if (is.null(template) || !is.list(template) || length(template) == 0L) {
    manquer("texte riche",
            paste0("« ", cle, " » : le template de lecture est absent ou vide"))
  }

  valider_noeud <- function(noeud) {
    if (!est_liste(noeud) || is.null(noeud$type) || !est_chaine_non_vide(noeud$type)) {
      manquer("texte riche", paste0("« ", cle, " » : un nœud sans type"))
    }
    type <- noeud$type
    if (!type %in% TYPES_NOEUD_TEXTE_RICHE) {
      manquer("texte riche", paste0(
        "« ", cle, " » : type de nœud « ", type, " » hors contrat — attendu l'un de ",
        paste(TYPES_NOEUD_TEXTE_RICHE, collapse = " | "),
        " (le HTML brut n'est pas un type de nœud)"))
    }
    if (type == "text") {
      if (is.null(noeud$content) || !est_chaine_non_vide(noeud$content)) {
        manquer("texte riche", paste0("« ", cle, " » : un nœud text sans contenu"))
      }
      if (grepl("[<>]", noeud$content)) {
        manquer("texte riche", paste0(
          "« ", cle, " » : HTML brut interdit dans le contenu « ", noeud$content, " »"))
      }
    } else if (type == "param") {
      if (is.null(noeud$key) || !est_chaine_non_vide(noeud$key)) {
        manquer("texte riche", paste0("« ", cle, " » : un nœud param sans clé"))
      }
      if (!noeud$key %in% params) {
        manquer("texte riche", paste0(
          "« ", cle, " » : le paramètre « ", noeud$key,
          " » n'est pas déclaré dans reading.params"))
      }
    } else if (type %in% c("strong", "link")) {
      if (type == "link" && (is.null(noeud$href) || !est_chaine_non_vide(noeud$href))) {
        manquer("texte riche", paste0("« ", cle, " » : un lien sans href"))
      }
      enfants <- noeud$children
      if (is.null(enfants) || !is.list(enfants) || length(enfants) == 0L) {
        manquer("texte riche",
                paste0("« ", cle, " » : un nœud ", type, " sans enfants"))
      }
      for (enfant in enfants) {
        if (est_liste(enfant) && !is.null(enfant$type) && enfant$type == "link") {
          manquer("texte riche", paste0(
            "« ", cle, " » : un lien ne peut pas en contenir un autre (nœud ", type, ")"))
        }
        valider_noeud(enfant)
      }
    }
    # « territoire » : aucun champ requis — le nœud rend le nom du territoire.
    invisible(NULL)
  }

  for (noeud in template) valider_noeud(noeud)
  invisible(NULL)
}

# valider_theme_metadata --------------------------------------------------------
# Le garde-fou du contrat theme_<theme>.json. Entrée : le fichier lu (la forme
# jsonlite :: fromJSON(simplifyVector = FALSE) — des listes imbriquées).
# vintages, quand elle est passée (le run réel), vérifie la politique de
# source de référence : chaque source déclarée existe dans la table partagée.
# Toute dérive échoue FORT, en nommant le champ fautif — jamais un chiffre
# faux publié silencieusement.
valider_theme_metadata <- function(metadata, vintages = NULL) {
  manquer <- function(champ, detail) {
    stop(sprintf("Métadonnées du thème invalides — %s : %s.", champ, detail),
         call. = FALSE)
  }
  est_chaine_non_vide <- function(x) {
    is.character(x) && length(x) == 1L && !is.na(x) && nzchar(x)
  }
  est_liste <- function(x) is.list(x) && !is.data.frame(x)
  compter <- function(liste, cle) {
    if (is.null(liste[[cle]])) 1L else liste[[cle]] + 1L
  }

  if (!est_liste(metadata)) {
    manquer("forme",
            "le fichier theme_<theme>.json doit être un objet JSON, jamais un tableau")
  }

  # 1. le thème — présent, canonique, jamais « programmes »
  if (is.null(metadata$theme) || !est_chaine_non_vide(metadata$theme)) {
    manquer("theme", "le thème est absent ou vide")
  }
  theme <- metadata$theme
  if (theme == "programmes") {
    manquer("theme", paste0(
      "« programmes » est un contrat de publication SÉPARÉ (programmes.json, ",
      "ADR-0013), jamais un thème — aucun fichier theme_programmes.json fabriqué"))
  }
  if (!theme %in% THEMES_METADATA) {
    manquer("theme", paste0("thème inconnu « ", theme, " » — attendu l'un de ",
                            paste(THEMES_METADATA, collapse = " | ")))
  }

  # 2. le label du thème
  if (is.null(metadata$label) || !est_chaine_non_vide(metadata$label)) {
    manquer("label", "le label du thème est absent ou vide")
  }

  # 3. les clés d'indicateurs — le registre du thème
  if (is.null(metadata$indicator_keys) || length(metadata$indicator_keys) == 0L) {
    manquer("indicator_keys",
            "la liste des clés d'indicateurs est absente ou vide")
  }
  cles_indicateurs <- unlist(metadata$indicator_keys, use.names = FALSE)
  if (any(!nzchar(cles_indicateurs)) || anyDuplicated(cles_indicateurs)) {
    manquer("indicator_keys", "une clé d'indicateur est vide ou en double")
  }

  # 4. les story_keys — le registre des histoires du thème, avec la règle
  #    d'herméticité (ADR-0020) : un thème ne peut lier que SES histoires
  if (is.null(metadata$story_keys) || length(metadata$story_keys) == 0L) {
    manquer("story_keys", "la liste des histoires est absente ou vide")
  }
  cles_histoires <- unlist(metadata$story_keys, use.names = FALSE)
  if (any(!nzchar(cles_histoires)) || anyDuplicated(cles_histoires)) {
    manquer("story_keys", "une story_key est vide ou en double")
  }
  portees <- CLES_HISTOIRES_PAR_THEME[[theme]]
  autres <- unique(unlist(
    CLES_HISTOIRES_PAR_THEME[names(CLES_HISTOIRES_PAR_THEME) != theme],
    use.names = FALSE
  ))
  for (cle_histoire in cles_histoires) {
    if (!cle_histoire %in% portees) {
      if (cle_histoire %in% autres) {
        manquer("cross-thème", paste0(
          "la story « ", cle_histoire, " » appartient à un AUTRE thème — ",
          "l'herméticité (ADR-0020) interdit toute référence cross-thème"))
      }
      manquer("story_keys",
              paste0("la story « ", cle_histoire, " » est inconnue du contrat"))
    }
  }

  # 5. les sources de référence — la politique : chaque indicateur déclare la
  #    source de son composant signature (le « Reference source » de
  #    CONTEXT.md) ; la carte doit déclarer EXACTEMENT les indicateurs du
  #    registre, et chaque source existe dans les vintages quand la table est
  #    passée (le run réel — la même garde que validate_payload, point 4)
  if (is.null(metadata$sources) || !est_liste(metadata$sources)) {
    manquer("sources",
            "la carte des sources de référence est absente ou non-objet")
  }
  cles_sources <- names(metadata$sources)
  manquantes <- setdiff(cles_indicateurs, cles_sources)
  fantomes <- setdiff(cles_sources, cles_indicateurs)
  if (length(manquantes) > 0 || length(fantomes) > 0) {
    manquer("sources", paste0(
      "la carte des sources doit déclarer EXACTEMENT les indicateurs du ",
      "registre — sans source : ", paste(manquantes, collapse = ", "),
      " ; non déclarés : ", paste(fantomes, collapse = ", ")))
  }
  refs <- unlist(metadata$sources, use.names = FALSE)
  if (any(!nzchar(refs))) {
    manquer("sources", "une source de référence est vide")
  }
  if (!is.null(vintages)) {
    sans_vintage <- setdiff(refs, vintages$id)
    if (length(sans_vintage) > 0) {
      manquer("sources", paste0(
        "source(s) de référence absente(s) des vintages : ",
        paste(sans_vintage, collapse = ", ")))
    }
  }

  # 6. les sous-groupes — l'ordre de la fiche (le premier est le premier
  #    rendu) ; chaque sous-groupe porte ses indicateurs, sa figure et sa
  #    lecture résolue
  if (is.null(metadata$subgroups) || !is.list(metadata$subgroups) ||
      length(metadata$subgroups) == 0L) {
    manquer("sous-groupes", "la liste des sous-groupes est absente ou vide")
  }
  cles_groupes <- vapply(metadata$subgroups, function(groupe) {
    if (!est_liste(groupe) || is.null(groupe$key) || !est_chaine_non_vide(groupe$key)) {
      return("")
    }
    groupe$key
  }, character(1L))
  if (any(!nzchar(cles_groupes)) || anyDuplicated(cles_groupes)) {
    manquer("sous-groupe", "une clé de sous-groupe est absente, vide ou en double")
  }

  indicateurs_groupes <- list()
  histoires_groupes <- list()

  for (i in seq_along(metadata$subgroups)) {
    groupe <- metadata$subgroups[[i]]
    cle <- cles_groupes[[i]]

    if (is.null(groupe$label) || !est_chaine_non_vide(groupe$label)) {
      manquer("sous-groupe", paste0("« ", cle, " » : le label est absent ou vide"))
    }
    if (is.null(groupe$framing) || !est_chaine_non_vide(groupe$framing)) {
      manquer("sous-groupe", paste0("« ", cle, " » : le cadrage (framing) est absent ou vide"))
    }

    # les indicateurs du sous-groupe — tous déclarés dans le registre
    if (is.null(groupe$indicators) || length(groupe$indicators) == 0L) {
      manquer("sous-groupe",
              paste0("« ", cle, " » : la liste des indicateurs est absente ou vide"))
    }
    inds <- unlist(groupe$indicators, use.names = FALSE)
    if (any(!nzchar(inds)) || anyDuplicated(inds)) {
      manquer("sous-groupe",
              paste0("« ", cle, " » : un indicateur est vide ou en double"))
    }
    hors_registre <- setdiff(inds, cles_indicateurs)
    if (length(hors_registre) > 0) {
      manquer("sous-groupe", paste0(
        "« ", cle, " » : indicateur(s) hors du registre indicator_keys : ",
        paste(hors_registre, collapse = ", ")))
    }
    for (ind in inds) {
      indicateurs_groupes[[ind]] <- compter(indicateurs_groupes, ind)
    }

    # la figure — une famille du contrat, un indicateur que le sous-groupe
    # possède (la figure rend la matière du sous-groupe, jamais une autre)
    if (!est_liste(groupe$figure)) {
      manquer("figure",
              paste0("« ", cle, " » : la figure est absente ou non-objet"))
    }
    famille <- groupe$figure$family
    if (is.null(famille) || !famille %in% FAMILLES_FIGURE) {
      manquer("figure", paste0(
        "« ", cle, " » : la famille « ",
        if (is.null(famille)) "?" else famille,
        " » est hors contrat — attendue l'une de ",
        paste(FAMILLES_FIGURE, collapse = " | ")))
    }
    indicateur_figure <- groupe$figure$indicator
    if (is.null(indicateur_figure) || !est_chaine_non_vide(indicateur_figure) ||
        !indicateur_figure %in% inds) {
      manquer("figure", paste0(
        "« ", cle, " » : la figure doit rendre un indicateur que le sous-groupe possède"))
    }

    # la lecture résolue — le lien explicite vers l'histoire du sous-groupe
    # (parent #308 : l'app n'infère jamais la relation depuis les noms)
    if (!est_liste(groupe$reading)) {
      manquer("lecture",
              paste0("« ", cle, " » : la lecture (reading) est absente ou non-objet"))
    }
    story <- groupe$reading$story_key
    if (is.null(story) || !est_chaine_non_vide(story)) {
      manquer("lecture",
              paste0("« ", cle, " » : le lien d'histoire (story_key) est absent ou vide"))
    }
    if (!story %in% cles_histoires) {
      manquer("lecture", paste0(
        "« ", cle, " » : lien d'histoire inconnu « ", story,
        " » — la story doit être déclarée dans story_keys"))
    }
    histoires_groupes[[story]] <- compter(histoires_groupes, story)

    # les paramètres de lecture — les valeurs d'histoire que le template peut
    # lire (le lien résolu : la matière de la lecture, jamais inventée)
    params <- if (is.null(groupe$reading$params)) {
      character(0L)
    } else {
      unlist(groupe$reading$params, use.names = FALSE)
    }
    if (any(!nzchar(params)) || anyDuplicated(params)) {
      manquer("lecture",
              paste0("« ", cle, " » : un paramètre de lecture est vide ou en double"))
    }

    # le template — le texte riche TYPÉ
    valider_template(groupe$reading$template, params, cle, manquer)
  }

  # 7. la bijection sous-groupes ↔ registres : chaque indicateur vit dans
  #    EXACTEMENT un sous-groupe, chaque histoire est lue par EXACTEMENT un
  #    sous-groupe — rien d'orphelin, rien de partagé (l'identité
  #    (territoire × groupe) unique du parent #308)
  orphelins_ind <- setdiff(cles_indicateurs, names(indicateurs_groupes))
  if (length(orphelins_ind) > 0) {
    manquer("indicateurs", paste0(
      "indicateur(s) orphelin(s) — déclaré(s) au registre sans sous-groupe : ",
      paste(orphelins_ind, collapse = ", ")))
  }
  partages_ind <- names(indicateurs_groupes)[
    vapply(indicateurs_groupes, function(n) n > 1L, logical(1L))]
  if (length(partages_ind) > 0) {
    manquer("indicateurs", paste0(
      "indicateur(s) dans plusieurs sous-groupes : ",
      paste(partages_ind, collapse = ", ")))
  }
  orphelines_hist <- setdiff(cles_histoires, names(histoires_groupes))
  if (length(orphelines_hist) > 0) {
    manquer("histoires", paste0(
      "histoire(s) orpheline(s) — déclarée(s) au registre sans sous-groupe qui la lit : ",
      paste(orphelines_hist, collapse = ", ")))
  }
  partagees_hist <- names(histoires_groupes)[
    vapply(histoires_groupes, function(n) n > 1L, logical(1L))]
  if (length(partagees_hist) > 0) {
    manquer("histoires", paste0(
      "histoire(s) lue(s) par plusieurs sous-groupes : ",
      paste(partagees_hist, collapse = ", ")))
  }

  invisible(metadata)
}
