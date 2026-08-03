# nettoyer_dpe ---------------------------------------------------------------
# Le nettoyage de la base ADEME DPE (issue #16) : du pull brut (une ligne par
# DPE, la vue publique data-fair) à la table DPE PROCESSÉE — une ligne par
# LOGEMENT-ÉQUIVALENT, dans la forme que les indicateurs Habitat consommeront.
# Règles (spec #12, docs/research/ademe-dpe.md §7.4, docs/themes/habitat.md) :
#   1. actifs seulement — la vue publique exclut déjà les DPE désactivés
#      (dpe_desactive = 0, filtre virtuel de la dataset data-fair) ; le filtre
#      est DÉFENSIF, pour le cas d'un dump brut. Une ligne sans valeur de
#      dpe_desactive est conservée (statut inconnu, on ne supprime pas sans
#      preuve) ; sans colonne du tout (le pull ne la sélectionne jamais), rien
#      n'est filtré.
#   2. DPE remplacés retirés — un DPE dont le numero_dpe figure dans
#      numero_dpe_remplace d'une autre ligne est un ancien certificat : la
#      chaîne (A -> B -> C) laisse le dernier.
#   3. dédoublonnage par LOGEMENT — la clé de logement, par priorité :
#      appartement -> (numero_dpe_immeuble_associe, position_logement_dans_immeuble) ;
#      maison/immeuble -> id_rnb ; sinon aucune identité fiable -> chaque ligne
#      reste son propre logement (on ne fusionne pas sans preuve). Dans chaque
#      clé, le représentant est : la date d'établissement la plus récente,
#      puis version_dpe >= 2.1 (le modèle post-transitoire, plus contrôlé),
#      puis le plus grand numero_dpe (déterminisme).
#   4. immeubles PONDÉRÉS — un DPE de type_batiment = "immeuble" représente
#      nombre_appartement logements ; le poids de l'immeuble est réduit du
#      nombre d'appartements du même immeuble qui ont leur PROPRE DPE
#      (numero_dpe_immeuble_associe) — « l'appartement l'emporte sur son
#      immeuble ». Un immeuble sans nombre_appartement (inconnu) est retiré :
#      on ne fabrique pas d'équivalents-logements sans base. Poids nul ->
#      retiré. Maisons et appartements = poids 1. Le poids est la représentation
#      de l'équivalent-logement (une colonne, pas des lignes dupliquées : les
#      immeubles peuvent compter des centaines d'appartements, et les parts
#      pondérées se calculent directement sur la colonne).
#   5. les DEUX dates portées (date_etablissement_dpe, date_derniere_modification_dpe)
#      — la cassure des seuils 2024 (40 m²) et 2026 (facteur 2,3 -> 1,9)
#      s'analyse sur ces dates dans la couche données ; les parts par régime
#      sont calculées par l'étape indicateurs (pas encore publiées, issue #12).
#   6. code commune (code_insee_ban, 5 chiffres, zéros de tête conservés) et
#      étiquette (etiquette_dpe, normalisée en majuscules) conservés.
# Entrée : la table brute du pull (toutes les colonnes larges sélectionnées,
#     les lignes éventuellement déjà filtrées par code_departement_ban).
# Sortie : la table processée (code_insee_ban, code_departement_ban,
#     etiquette_dpe, etiquette_ges, type_batiment, poids,
#     date_etablissement_dpe, date_derniere_modification_dpe, version_dpe,
#     numero_dpe, numero_dpe_immeuble_associe, id_rnb).

# version_numero_dpe ----------------------------------------------------------
# La version du modèle DPE en nombre ("2.1" -> 2.1, "2.1.3" -> 2.1). NA si
# absente ou illisible — une version inconnue ne gagne jamais le choix du
# représentant (elle ne satisfait pas "version >= 2.1").
version_numero_dpe <- function(version) {
  as.numeric(sub("^(\\d+(\\.\\d+)?).*$", "\\1", version))
}

# cle_logement ----------------------------------------------------------------
# La clé d'identité du logement pour le dédoublonnage (règle 3). NA = aucune
# identité fiable -> la ligne est son propre logement (conservateur).
cle_logement <- function(dpe) {
  dplyr::case_when(
    dpe$type_batiment %in% "appartement" &
      !is.na(dpe$numero_dpe_immeuble_associe) &
      !is.na(dpe$position_logement_dans_immeuble) ~
      paste0("imm:", dpe$numero_dpe_immeuble_associe,
             ":pos:", dpe$position_logement_dans_immeuble),
    dpe$type_batiment %in% c("maison", "immeuble") & !is.na(dpe$id_rnb) ~
      paste0("rnb:", dpe$id_rnb),
    TRUE ~ NA_character_
  )
}

# filtrer_dpe_actifs ----------------------------------------------------------
# Règle 1 : actifs seulement (défensif). Absent du pull — la vue publique
# data-fair applique déjà le filtre virtuel dpe_desactive = 0.
filtrer_dpe_actifs <- function(dpe) {
  if ("dpe_desactive" %in% names(dpe)) {
    dpe <- dplyr::filter(
      dpe, is.na(dpe_desactive) | dpe_desactive %in% "0"
    )
  }
  dpe
}

# retirer_dpe_remplaces -------------------------------------------------------
# Règle 2 : un DPE remplacé (son numero_dpe apparaît dans numero_dpe_remplace
# d'une autre ligne) est un ancien certificat — retiré. Les chaînes de
# remplacement (A -> B -> C) se résolvent par transitivité : A est référencé
# par B, B par C, seuls C restent.
retirer_dpe_remplaces <- function(dpe) {
  remplaces <- dpe$numero_dpe_remplace[!is.na(dpe$numero_dpe_remplace)]
  dplyr::filter(dpe, !(numero_dpe %in% remplaces))
}

# dedupe_par_logement ---------------------------------------------------------
# Règle 3 : le représentant par logement. Tri global (date la plus récente,
# puis version >= 2.1, puis numero_dpe) puis une ligne par clé de logement.
dedupe_par_logement <- function(dpe) {
  # sans identité fiable (cle NA), chaque ligne est SON propre logement : une
  # clé unique par ligne — group_by(cle) fusionnerait tous les NA en un groupe
  cle <- cle_logement(dpe)
  cle[is.na(cle)] <- paste0("solo:", seq_len(sum(is.na(cle))))
  dpe$cle <- cle
  dpe$version_num <- version_numero_dpe(dpe$version_dpe)

  dpe %>%
    dplyr::arrange(
      dplyr::desc(date_etablissement_dpe),
      dplyr::desc(version_num >= 2.1),
      dplyr::desc(numero_dpe)
    ) %>%
    dplyr::group_by(cle) %>%
    dplyr::slice(1) %>%
    dplyr::ungroup() %>%
    dplyr::select(-cle, -version_num)
}

# ponderer_immeubles ----------------------------------------------------------
# Règle 4 : le poids d'équivalent-logement. Les appartements avec leur propre
# DPE comptent 1 et réduisent d'autant le poids de l'immeuble qui les contient
# (numero_dpe_immeuble_associe -> numero_dpe de l'immeuble).
ponderer_immeubles <- function(dpe) {
  # les appartements retenus, comptés par immeuble lié
  appartements_par_immeuble <- dpe %>%
    dplyr::filter(
      type_batiment %in% "appartement",
      !is.na(numero_dpe_immeuble_associe)
    ) %>%
    dplyr::count(numero_dpe_immeuble_associe, name = "appartements_propres")

  dpe %>%
    dplyr::left_join(
      appartements_par_immeuble,
      by = c("numero_dpe" = "numero_dpe_immeuble_associe")
    ) %>%
    dplyr::mutate(
      poids = dplyr::case_when(
        type_batiment %in% "immeuble" ~
          pmax(nombre_appartement - dplyr::coalesce(appartements_propres, 0), 0),
        TRUE ~ 1
      )
    ) %>%
    # immeuble sans nombre_appartement (inconnu) ou de poids nul (tous ses
    # appartements ont leur propre DPE) : aucun équivalent-logement à porter
    dplyr::filter(
      !(type_batiment %in% "immeuble" &
          (is.na(nombre_appartement) | poids < 1))
    ) %>%
    dplyr::select(-appartements_propres)
}

# nettoyer_dpe ----------------------------------------------------------------
# L'entrée du nettoyage : la table brute du pull -> la table DPE processée.
nettoyer_dpe <- function(dpe) {
  # garde du schéma : les champs que le nettoyage consomme doivent exister —
  # un pull dont la forme a changé (champ renommé par l'API) doit échouer FORT
  # et clairement, pas produire un nettoyage silencieusement vide
  requis <- c(
    "numero_dpe", "numero_dpe_remplace", "numero_dpe_immeuble_associe",
    "date_etablissement_dpe", "date_derniere_modification_dpe", "version_dpe",
    "etiquette_dpe", "etiquette_ges", "type_batiment", "nombre_appartement",
    "position_logement_dans_immeuble", "code_insee_ban",
    "code_departement_ban", "id_rnb"
  )
  manquants <- setdiff(requis, names(dpe))
  if (length(manquants) > 0) {
    stop("Table DPE incomplète : champs manquants — ",
         paste(manquants, collapse = ", "), ".", call. = FALSE)
  }

  dpe %>%
    filtrer_dpe_actifs() %>%
    retirer_dpe_remplaces() %>%
    dplyr::mutate(
      date_etablissement_dpe = as.Date(date_etablissement_dpe),
      date_derniere_modification_dpe = as.Date(date_derniere_modification_dpe)
    ) %>%
    dedupe_par_logement() %>%
    ponderer_immeubles() %>%
    dplyr::mutate(
      etiquette_dpe = toupper(trimws(etiquette_dpe)),
      etiquette_ges = toupper(trimws(etiquette_ges))
    ) %>%
    dplyr::select(
      code_insee_ban, code_departement_ban, etiquette_dpe, etiquette_ges,
      type_batiment, poids,
      date_etablissement_dpe, date_derniere_modification_dpe,
      version_dpe, numero_dpe, numero_dpe_immeuble_associe, id_rnb
    )
}
