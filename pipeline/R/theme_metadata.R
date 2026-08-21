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

# La petite grammaire partagée des figures (parent #308, ADR-0023) : la
# grammaire FERMÉE des huit familles prédéfinies — scalar (une valeur),
# composition (des parts qui somment, mode-colored quand les parts sont des
# modes), trajectory (une évolution), distribution (une signature de
# répartition), relationship (une relation entre deux forces — le nuage),
# list (un classement ordonné — le top-5 LQ ; les profils produit passent par
# cette famille), pyramid (la pyramide des âges),
# comparison-bars (des barres de comparaison — les états M2→M3, les barres
# iso_* avec la médiane). Des identifiants de contrat, en anglais — les labels
# français vivent dans les métadonnées. Toute famille hors des huit est rejetée
# par les validateurs (R + TS — le miroir exact de l'app, jamais une dérive).
FAMILLES_FIGURE <- c("scalar", "composition", "trajectory", "distribution",
                     "relationship", "list", "pyramid", "comparison-bars")

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
  # Issue #370 : `ce-que-la-bretagne-abrite` QUITTE la fiche (la lecture
  # régionale débranchée — le sous-groupe structure-verte ne déclare plus de
  # lecture, le registre ne porte que ce que la fiche lit).
  economie = "ce-que-la-commune-abrite",
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
# font foi — amendés par la décomposition #370 : « trajectoire-demographique »
# (Démographie — la lecture vit dans le sous-groupe du même nom, jamais dans
# « etat-de-la-population » qui ne déclare pas de lecture), « etat-energetique-
# du-parc » (Habitat — la lecture vit dans le sous-groupe du même nom, jamais
# dans « composition-du-parc » ni « marche »), « sante-et-taille » (Économie —
# l'unique lecture, `ce-que-la-bretagne-abrite` retirée, #370). Pour les thèmes
# sans fixture encore publiée (Mobilité, Milieux), le groupe est LE slot de
# lecture du thème — un nom de fiche stable que les métadonnées publiées
# (#311) reprennent.
# Mobilité est le SEUL pool (ADR-0002) : « vingt-minutes-sans-voiture » est le
# défaut de chaque territoire, « ce-que-le-velo-preserve » le remplace là où
# le delta est réel (raison « delta-velo-saillant »). Économie n'a pas de pool :
# sa story vit dans SON groupe (la lecture de spécialisation des
# communes/EPCIs/départements).
STORIES_RESOLUES_PAR_THEME <- list(
  mobilite = tibble::tibble(
    story_key = c("vingt-minutes-sans-voiture", "ce-que-le-velo-preserve"),
    groupe = "acces-aux-services",
    ordre = c(1L, 2L),
    salience_reason = c(NA_character_, "delta-velo-saillant")
  ),
  demographie = tibble::tibble(
    story_key = "trajectoire-demographique",
    groupe = "trajectoire-demographique",
    ordre = 1L,
    salience_reason = NA_character_
  ),
  habitat = tibble::tibble(
    story_key = "etat-energetique-du-parc",
    groupe = "etat-energetique-du-parc",
    ordre = 1L,
    salience_reason = NA_character_
  ),
  economie = tibble::tibble(
    story_key = "ce-que-la-commune-abrite",
    groupe = "sante-et-taille",
    ordre = 1L,
    salience_reason = NA_character_
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

  # 5bis. les libellés d'indicateurs (issue #318) — la carte du vocabulaire
  #      payload-owned : EXACTEMENT indicator_keys (la bijection, comme les
  #      sources), chaque valeur un libellé français non vide. C'est le seul
  #      vocabulaire que la fiche et la carte rendent — jamais une clé brute.
  if (is.null(metadata$indicator_labels) || !est_liste(metadata$indicator_labels)) {
    manquer("indicator_labels",
            "la carte des libellés d'indicateurs est absente ou non-objet")
  }
  cles_libelles <- names(metadata$indicator_labels)
  sans_libelle <- setdiff(cles_indicateurs, cles_libelles)
  fantomes_libelle <- setdiff(cles_libelles, cles_indicateurs)
  if (length(sans_libelle) > 0 || length(fantomes_libelle) > 0) {
    manquer("indicator_labels", paste0(
      "la carte des libellés doit déclarer EXACTEMENT les indicateurs du ",
      "registre — sans libellé : ", paste(sans_libelle, collapse = ", "),
      " ; non déclarés : ", paste(fantomes_libelle, collapse = ", ")))
  }
  if (any(!vapply(metadata$indicator_labels, est_chaine_non_vide, logical(1L)))) {
    manquer("indicator_labels",
            "un libellé d'indicateur doit être une chaîne non vide")
  }

  # 5ter. les libellés de détail (issue #318) — la carte détail → libellé des
  #       clés multi-détails : chaque clé déclarée appartient au registre
  #       indicator_keys, chaque libellé est une chaîne non vide. La COUVERTURE
  #       bidirectionnelle contre les faits publiés (chaque (key, detail) du
  #       payload a son libellé, aucun libellé mort) est la parité vérifiée
  #       ailleurs (l'app : verifierPariteLibelles ; les tests R sur le payload
  #       committé) — le fichier, lui, reste auto-contenu comme sources.
  if (is.null(metadata$detail_labels) || !est_liste(metadata$detail_labels)) {
    manquer("detail_labels",
            "la carte des libellés de détail est absente ou non-objet")
  }
  cles_details <- names(metadata$detail_labels)
  hors_registre_details <- setdiff(cles_details, cles_indicateurs)
  if (length(hors_registre_details) > 0) {
    manquer("detail_labels", paste0(
      "une clé de détail hors du registre indicator_keys : ",
      paste(hors_registre_details, collapse = ", ")))
  }
  if (anyDuplicated(cles_details)) {
    manquer("detail_labels", "une clé de détail est en double")
  }
  for (cle_detail in cles_details) {
    carte_details <- metadata$detail_labels[[cle_detail]]
    if (!est_liste(carte_details)) {
      manquer("detail_labels", paste0(
        "« ", cle_detail, " » : la carte des détails doit être un objet"))
    }
    if (length(carte_details) == 0L) {
      manquer("detail_labels", paste0(
        "« ", cle_detail, " » : la carte des détails est vide"))
    }
    details <- names(carte_details)
    if (any(!nzchar(details)) || anyDuplicated(details)) {
      manquer("detail_labels", paste0(
        "« ", cle_detail, " » : un détail est vide ou en double"))
    }
    if (any(!vapply(carte_details, est_chaine_non_vide, logical(1L)))) {
      manquer("detail_labels", paste0(
        "« ", cle_detail, " » : un libellé de détail doit être une chaîne non vide"))
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
  # L'union des paramètres de lecture DÉCLARÉS par les sous-groupes, dans
  # l'ordre de première déclaration — la base de la carte param_labels (#318).
  params_uniques <- character(0L)

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
    # Composition: one URL-backed scalar facet may be declared while the full
    # composition remains visible.  The shape is shared with the TS validator.
    comparaison <- groupe$figure$comparison
    if (!is.null(comparaison)) {
      palette <- if ("palette" %in% names(comparaison)) comparaison[["palette"]] else NULL
      if (!is.null(palette) && !is.na(palette) && !identical(palette, "theme") && !identical(palette, "dpe")) {
        manquer("figure.comparison", paste0("« ", cle, " » : palette doit être theme ou dpe"))
      }
      if (!est_liste(comparaison) || !"detail" %in% names(comparaison) ||
          !(is.null(comparaison$detail) || est_chaine_non_vide(comparaison$detail))) {
        manquer("figure.comparison", paste0("« ", cle, " » : detail doit être une chaîne ou NULL"))
      }
      sex <- if ("sex" %in% names(comparaison)) comparaison[["sex"]] else NULL
      if (is.character(sex) && length(sex) == 1L && !is.na(sex) && nzchar(sex) &&
          !identical(sex, "F") && !identical(sex, "M")) {
        manquer("figure.comparison", paste0("« ", cle, " » : sex doit être F, M ou NULL"))
      }
      if (!identical(famille, "composition")) {
        manquer("figure.comparison", paste0("« ", cle, " » : comparison est réservé à composition"))
      }
      detail_comparaison <- comparaison[["detail"]]
      details_figure <- metadata$detail_labels[[indicateur_figure]]
      if (!is.null(detail_comparaison) && !is.na(detail_comparaison) &&
          (is.null(details_figure) || !detail_comparaison %in% names(details_figure))) {
        manquer("figure.comparison", paste0("« ", cle, " » : detail absent de detail_labels"))
      }
      if (identical(palette, "dpe") && (is.null(details_figure) || length(details_figure) == 0L ||
          any(!names(details_figure) %in% LETTERS[1:7]))) {
        manquer("figure.comparison", paste0("« ", cle, " » : palette DPE exige des détails A à G"))
      }
    }

    # la lecture résolue — le lien explicite vers l'histoire du sous-groupe
    # (parent #308 : l'app n'infère jamais la relation depuis les noms).
    # Issue #370 : la lecture est OPTIONNELLE — un sous-groupe peut ne déclarer
    # aucune lecture (structure-verte, la « structure verte » d'Économie, rend
    # ses indicateurs en silence). Un sous-groupe sans lecture ne lie aucune
    # story, ne déclare aucun paramètre ni template : le slot est honnêtement
    # silencieux — jamais une lecture inventée ni une story forcée.
    if (is.null(groupe$reading)) {
      story <- NULL
      params <- character(0L)
      # la bijection « chaque histoire est lue par EXACTEMENT un sous-groupe »
      # reste vraie : un sous-groupe sans lecture ne compte aucune histoire
    } else {
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
      nouveaux_params <- params[!params %in% params_uniques]
      params_uniques <- c(params_uniques, nouveaux_params)

      # le template — le texte riche TYPÉ
      valider_template(groupe$reading$template, params, cle, manquer)

    if (!is.null(groupe$reading$figure)) {
      rf <- groupe$reading$figure
      if (!est_liste(rf) || is.null(rf$family) || !rf$family %in% FAMILLES_FIGURE ||
          is.null(rf$indicator) || !est_chaine_non_vide(rf$indicator) ||
          !rf$indicator %in% params) {
         manquer("lecture", paste0("« ", cle, " » : reading.figure est invalide"))
       }
      }
    }
  }

  # 6bis. les libellés des paramètres de lecture (issue #318) — la carte du
  #       vocabulaire des reading.params : EXACTEMENT l'union des paramètres
  #       déclarés par les sous-groupes (la bijection, comme indicator_labels),
  #       chaque valeur un libellé français non vide. C'est le vocabulaire que
  #       la carte lit pour les couches de scalaires de Story — jamais la clé
  #       brute d'un champ d'histoires.
  if (is.null(metadata$param_labels) || !est_liste(metadata$param_labels)) {
    manquer("param_labels",
            "la carte des libellés de paramètres est absente ou non-objet")
  }
  cles_params <- names(metadata$param_labels)
  sans_param <- setdiff(params_uniques, cles_params)
  fantomes_param <- setdiff(cles_params, params_uniques)
  if (length(sans_param) > 0 || length(fantomes_param) > 0) {
    manquer("param_labels", paste0(
      "la carte des libellés de paramètres doit déclarer EXACTEMENT les ",
      "reading.params — sans libellé : ", paste(sans_param, collapse = ", "),
      " ; non déclarés : ", paste(fantomes_param, collapse = ", ")))
  }
  if (any(!vapply(metadata$param_labels, est_chaine_non_vide, logical(1L)))) {
    manquer("param_labels",
            "un libellé de paramètre doit être une chaîne non vide")
  }

  # 6ter. les libellés des classifications (issue #362) — la 4e carte du
  #       vocabulaire : les VALEURS de lecture (les quadrants/lectures du
  #       pipeline), pas les paramètres — jamais une clé brute (attire-meurt,
  #       parc-intermediaire…) dans le texte français. REQUISE dès que l'union
  #       des reading.params référence `classification` — le miroir EXACT de
  #       l'app (validerThemeMetadata) : la règle est locale aux métadonnées
  #       (aucun besoin des histoires publiées) ; le thème qui ne la référence
  #       jamais (Mobilité) n'en a pas besoin. Présente, elle doit être un objet
  #       NON VIDE de chaînes non vides (la discipline des cartes #318). La
  #       couverture contre les valeurs publiées est la parité de chargement de
  #       l'app (verifierPariteLibelles) — le fichier, lui, reste auto-contenu.
  if ("classification" %in% params_uniques && is.null(metadata$classification_labels)) {
    manquer("classification_labels",
            "la lecture référence « classification » — la carte des libellés est requise (jamais une clé brute)")
  }
  if (!is.null(metadata$classification_labels)) {
    if (!est_liste(metadata$classification_labels)) {
      manquer("classification_labels",
              "la carte des libellés de classification doit être un objet")
    }
    if (length(metadata$classification_labels) == 0L) {
      manquer("classification_labels",
              "la carte des libellés de classification est vide")
    }
    if (any(!vapply(metadata$classification_labels, est_chaine_non_vide, logical(1L)))) {
      manquer("classification_labels",
              "un libellé de classification doit être une chaîne non vide")
    }
  }

  # Page d'indicateur scalaire (#401) : optional for legacy descriptors, but
  # once declared it is a complete, self-contained publication contract.
  if (!is.null(metadata$indicator_pages)) {
    if (!is.list(metadata$indicator_pages) || is.null(names(metadata$indicator_pages))) {
      manquer("indicator_pages", "la carte des pages doit être un objet")
    }
    for (indicator_key in names(metadata$indicator_pages)) {
      page <- metadata$indicator_pages[[indicator_key]]
      if (!is.null(page$vintage)) manquer("indicator_pages.vintage", "la fraîcheur vient des source_records, pas de la page")
      if (!indicator_key %in% cles_indicateurs) {
        manquer("indicator_pages", paste0("la page « ", indicator_key, " » référence un indicateur inconnu"))
      }
    champs <- c("indicator", "label", "definition", "unit", "calculation",
                "direction", "caveats")
    if (!is.list(page) || any(!vapply(champs, function(x)
      est_chaine_non_vide(page[[x]]), logical(1)))) {
      manquer("indicator_pages", "le descripteur scalaire est incomplet")
    }
    if (!page$indicator %in% cles_indicateurs) {
      manquer("indicator_pages", "l'indicateur n'appartient pas au registre")
    }
      if (!identical(page$indicator, indicator_key)) {
      manquer("indicator_pages.indicator", paste0("« ", indicator_key, " » doit correspondre à sa clé"))
    }
    if (!identical(page$direction, "high") && !identical(page$direction, "low")) {
      manquer("indicator_pages.direction", "la direction doit être high ou low")
    }
    if (is.null(page$levels) || length(page$levels) == 0L ||
        anyDuplicated(unlist(page$levels, use.names = FALSE)) ||
        any(!page$levels %in% c("commune", "epci", "departement"))) {
      manquer("indicator_pages.levels", "les niveaux comparables sont invalides")
    }
    if (is.null(page$sources) || !is.list(page$sources) || length(page$sources) == 0L ||
        any(!vapply(page$sources, est_chaine_non_vide, logical(1)))) {
      manquer("indicator_pages.sources", "aucune source complète n'est déclarée")
    }
    if (anyDuplicated(unlist(page$sources, use.names = FALSE))) {
      manquer("indicator_pages.sources", "une source de page est en double")
    }
    if (!metadata$sources[[indicator_key]] %in% unlist(page$sources, use.names = FALSE)) {
      manquer("indicator_pages.sources", paste0("la page « ", indicator_key, " » doit contenir sa source de référence « ", metadata$sources[[indicator_key]], " »"))
    }
    if (is.null(metadata$source_records) || !is.list(metadata$source_records)) {
      manquer("source_records", "les références de source ne sont pas publiées")
    }
    for (source_id in page$sources) {
      source <- metadata$source_records[[source_id]]
      if (!is.list(source) || any(!vapply(c("dataset", "publisher", "url", "licence", "vintage", "freshness"),
          function(x) est_chaine_non_vide(source[[x]]), logical(1)))) {
        manquer("indicator_pages.sources", "une source est incomplète")
      }
      if (!is.null(page$family) && !page$family %in% FAMILLES_FIGURE) {
        manquer("indicator_pages.family", paste0("« ", indicator_key, " » : famille hors contrat"))
      }
    }
    detail <- page$detail
    if (!is.null(detail) && !(is.character(detail) && length(detail) == 1L)) {
      manquer("indicator_pages.detail", paste0("« ", indicator_key, " » doit être une chaîne ou NULL"))
    }
    if (!is.null(detail) && (is.null(metadata$detail_labels[[indicator_key]]) || is.null(metadata$detail_labels[[indicator_key]][[detail]]))) {
      manquer("indicator_pages.detail", paste0("détail inconnu « ", detail, " »"))
    }
    # Family descriptors are an additive seam: omitted means the #401 scalar
    # contract. The six page families are deliberately mirrored by TS.
    famille <- if (is.null(page$family)) "scalar" else page$family
    if (!est_chaine_non_vide(famille) || !famille %in% c("scalar", "trajectory",
        "composition", "distribution", "list", "relationship",
        "pyramid", "comparison-bars")) {
      manquer("indicator_pages.family", paste0("famille hors contrat « ", famille, " »"))
    }
    if (!is.null(page$comparison)) {
      comparison <- page$comparison
      if (!is.list(comparison)) manquer("indicator_pages.comparison", "la facette doit être un objet")
      if (!is.null(comparison$indicator) && !est_chaine_non_vide(comparison$indicator)) manquer("indicator_pages.comparison.indicator", "l'indicateur est invalide")
      if (!is.null(comparison$indicator) && !comparison$indicator %in% cles_indicateurs) manquer("indicator_pages.comparison.indicator", "l'indicateur est inconnu")
      for (champ in c("details", "sexes", "dimensions")) {
        if (!is.null(comparison[[champ]])) {
          valeurs <- unlist(comparison[[champ]], use.names = FALSE)
          if (!is.character(valeurs) || !length(valeurs) || any(!vapply(valeurs, est_chaine_non_vide, logical(1L))) || anyDuplicated(valeurs)) manquer(paste0("indicator_pages.comparison.", champ), "les valeurs doivent être une liste non vide de chaînes distinctes")
        }
      }
      if (!is.null(comparison$sexes) && !all(comparison$sexes %in% c("F", "M"))) manquer("indicator_pages.comparison.sexes", "le sexe doit être F ou M")
      if (!is.null(comparison$detail) && !is.null(comparison$details) && !comparison$detail %in% comparison$details) manquer("indicator_pages.comparison.detail", "le détail n'est pas déclaré dans details")
      if (!is.null(comparison$sex) && !is.null(comparison$sexes) && !comparison$sex %in% comparison$sexes) manquer("indicator_pages.comparison.sex", "le sexe n'est pas déclaré dans sexes")
      if (!is.null(comparison$dimension) && !is.null(comparison$dimensions) && !comparison$dimension %in% comparison$dimensions) manquer("indicator_pages.comparison.dimension", "la dimension n'est pas déclarée dans dimensions")
      for (champ in c("detail", "dimension", "unit")) if (!is.null(comparison[[champ]]) && !est_chaine_non_vide(comparison[[champ]])) manquer(paste0("indicator_pages.comparison.", champ), "la valeur est invalide")
      if (!is.null(comparison$sex) && !comparison$sex %in% c("F", "M")) manquer("indicator_pages.comparison.sex", "le sexe doit être F ou M")
      if (!is.null(comparison$direction) && !comparison$direction %in% c("high", "low")) manquer("indicator_pages.comparison.direction", "la direction doit être high ou low")
      if (!is.null(comparison$labels) && (!is.list(comparison$labels) || any(!vapply(comparison$labels, est_chaine_non_vide, logical(1))))) manquer("indicator_pages.comparison.labels", "les libellés sont invalides")
    }
    extensions <- list(
      trajectory = c("endpoints"), composition = c("parts"),
      distribution = c("signature", "summary"), list = c("categories"),
      pyramid = c("dimensions"), `comparison-bars` = c("series")
    )
    extension_keys <- c("trajectory", "composition", "distribution", "relationship", "list", "pyramid", "comparison-bars", "comparison_bars")
    for (candidate in setdiff(extension_keys, famille)) if (!is.null(page[[candidate]])) manquer(paste0("indicator_pages.", indicator_key, ".", candidate), "l'extension ne correspond pas à la famille déclarée")
      extension <- page[[if (famille == "comparison-bars") "comparison-bars" else famille]]
    if (famille != "scalar" && is.null(extension)) manquer(paste0("indicator_pages.", indicator_key, ".", famille), "l'extension est requise")
    if (!is.null(extension)) {
      if (!is.list(extension)) manquer(paste0("indicator_pages.", indicator_key, ".", famille), "l'extension doit être un objet")
      for (champ in if (is.null(extensions[[famille]])) character() else extensions[[famille]]) {
        valeur <- extension[[champ]]
        valeurs <- if (is.character(valeur) || is.list(valeur)) unlist(valeur, use.names = FALSE) else valeur
        ok <- if (is.character(valeurs)) length(valeurs) > 0L && all(vapply(valeurs, est_chaine_non_vide, logical(1L))) else est_chaine_non_vide(valeurs)
        if (!ok) manquer(paste0("indicator_pages.", indicator_key, ".", famille, ".", champ), "le champ est incomplet")
      }
      if (famille %in% c("composition", "pyramid")) {
        declarees <- extension[[if (famille == "composition") "parts" else "dimensions"]]
        labels <- if (is.null(metadata$detail_labels[[indicator_key]])) list() else metadata$detail_labels[[indicator_key]]
        if (famille == "composition" && any(!vapply(declarees, function(x) !is.null(labels[[x]]), logical(1)))) manquer(paste0("indicator_pages.", indicator_key, ".", famille), "une part ne possède pas de libellé canonical")
        if (famille == "pyramid" && !all(c("detail", "sex") %in% declarees)) manquer(paste0("indicator_pages.", indicator_key, ".pyramid"), "detail et sex sont requis")
        if (!is.null(comparison) && !is.null(comparison$details) && any(!declarees[declarees %in% names(labels)] %in% comparison$details)) manquer(paste0("indicator_pages.", indicator_key, ".comparison.details"), "les détails déclarés ne sont pas couverts")
        if (famille == "pyramid" && (is.null(comparison$sexes) || !length(comparison$sexes))) manquer(paste0("indicator_pages.", indicator_key, ".comparison.sex"), "le sexe est requis pour une pyramide")
      }
      if (famille == "relationship") {
        if (!is.list(extension$roles) || !est_chaine_non_vide(extension$roles$x) || !est_chaine_non_vide(extension$roles$y) || !est_chaine_non_vide(extension$measure)) manquer("indicator_pages.relationship", "roles et measure sont requis")
      }
    }
    }
  }

  # 7. la bijection sous-groupes ↔ registres : chaque indicateur vit dans
  #    EXACTEMENT un sous-groupe, chaque histoire est lue par EXACTEMENT un
  #    sous-groupe — rien d'orphelin, rien de partagé (l'identité
  #    (territoire × groupe) unique du parent #308). Une story déclarée au
  #    registre sans sous-groupe qui la lit est LÉGITIME quand le registre de
  #    résolution (STORIES_RESOLUES_PAR_THEME) la déclare candidate de
  #    saillance (ADR-0002) du groupe d'un sous-groupe déclaré : le pool
  #    Mobilité partage SON slot — « ce-que-le-velo-preserve » remplace le
  #    défaut dans le même groupe, jamais une lecture en double, jamais un
  #    slot supplémentaire.
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
  registre_resolution <- STORIES_RESOLUES_PAR_THEME[[theme]]
  est_candidate_legitime <- function(cle) {
    if (is.null(registre_resolution)) return(FALSE)
    ligne <- registre_resolution[registre_resolution$story_key == cle, , drop = FALSE]
    if (nrow(ligne) != 1L) return(FALSE)
    if (is.na(ligne$salience_reason[1])) return(FALSE)  # le défaut, lui, est lié
    ligne$groupe[1] %in% cles_groupes
  }
  orphelines_hist <- setdiff(cles_histoires, names(histoires_groupes))
  illegitimes <- orphelines_hist[!vapply(orphelines_hist, est_candidate_legitime, logical(1L))]
  if (length(illegitimes) > 0) {
    manquer("histoires", paste0(
      "histoire(s) orpheline(s) — déclarée(s) au registre sans sous-groupe qui la lit, ",
      "sans être candidate de saillance déclarée (ADR-0002) : ",
      paste(illegitimes, collapse = ", ")))
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
