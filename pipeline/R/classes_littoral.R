# classes_littoral -------------------------------------------------------------
# Référentiel producteur de la classification littorale communale (#1041,
# enfant de #1040). La source est la LISTE POSITIVE officielle de la DREAL
# Bretagne publiée au titre de la loi Littoral de 1986 (décret 2004-311) ;
# elle ne vient ni d'un champ Cerema antérieur, ni d'une supplémentation
# insulaire. Le complément de l'univers communal canonique est Non littoral.
#
# Le crosswalk complet est construit UNE fois au seam producteur : seuls les
# codes de la liste validée deviennent C, le complément validé devient NC.
# Une ligne absente d'un crosswalk ultérieur n'est jamais interprétée comme
# NC — elle échoue fort. Les comptes 263 C / 939 NC de l'univers inspecté
# sont une preuve d'instantané épinglé (tests), jamais une politique d'app.

CLASSES_LITTORAL_FICHIER <- "communes_littorales_dreal_bretagne_2023-04-21.csv"

CLASSES_LITTORAL_DOMAINE <- c("C", "NC")
CLASSES_LITTORAL_CLASSEMENTS <- c("Mer", "Estuaire")

CLASSES_LITTORAL_URL <- paste0(
  "https://geobretagne.fr/geoserver/dreal_b/l_communes_littorales/wfs?",
  "SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&",
  "TYPENAMES=dreal_b:l_communes_littorales&OUTPUTFORMAT=csv&",
  "propertyName=Code_insee,Commune,Dpt,Classement&SRSNAME=EPSG:4326"
)

MANIFEST_CLASSES_LITTORAL <- tibble::tribble(
  ~id, ~source, ~url, ~fichier, ~vintage, ~date_reference, ~date_publication,
  ~licence, ~sha256, ~note, ~mode, ~type,
  "classe_littorale_communale",
  "DREAL Bretagne — communes littorales au titre de la loi Littoral (1986, décret 2004-311)",
  CLASSES_LITTORAL_URL,
  CLASSES_LITTORAL_FICHIER,
  "Liste positive DREAL Bretagne — métadonnées de diffusion modifiées le 2023-04-21",
  NA_character_,
  "2023-04-21",
  "lov2",
  "d68f20e7ea2928ac36e104201fdd81327b610a384c1a3a6d6c33521fe61153cc",
  "WFS dreal_b:l_communes_littorales, CSV UTF-8, Classement Mer/Estuaire ; liste positive exhaustive pour la Bretagne administrative",
  "cron",
  "fichier"
)

# lire_classes_littoral ---------------------------------------------------------
# Lit le CSV WFS réel : UTF-8 sans BOM, séparateur virgule, CRLF, colonnes
# Code_insee / Commune / Dpt / Classement. Le lecteur valide l'identité
# communale, l'unicité et le domaine source AVANT toute projection ; un
# fichier vide, un doublon ou un classement inventé échoue bruyamment.
lire_classes_littoral <- function(chemin,
                                  sha256 = MANIFEST_CLASSES_LITTORAL$sha256[[1L]]) {
  if (!file.exists(chemin)) {
    stop("Liste littorale DREAL introuvable : ", chemin, call. = FALSE)
  }
  # L'identité de la source est vérifiée ICI, au seam de lecture : un cache
  # existant, tronqué ou altéré, ne peut jamais produire un crosswalk qui
  # reclasse en NC les communes disparues. Le seam synthétique des tests doit
  # désactiver le pin EXPLICITEMENT (`sha256 = NULL`), jamais par défaut.
  if (!is.null(sha256)) {
    if (!grepl("^[0-9a-f]{64}$", sha256) ||
        !verifier_empreinte_fichier(chemin, sha256)) {
      stop(
        "Liste littorale DREAL invalide : l'empreinte SHA-256 du fichier ne ",
        "correspond pas au pin de production (", sha256, ").",
        call. = FALSE
      )
    }
  }
  source <- readr::read_csv(
    chemin,
    col_types = readr::cols(.default = readr::col_character()),
    locale = readr::locale(encoding = "UTF-8"),
    show_col_types = FALSE,
    progress = FALSE
  )
  requis <- c("Code_insee", "Commune", "Dpt", "Classement")
  manquants <- setdiff(requis, names(source))
  if (length(manquants) > 0L) {
    stop(
      "Liste littorale invalide : colonne(s) absente(s) : ",
      paste(manquants, collapse = ", "), ".",
      call. = FALSE
    )
  }
  source <- source[requis]
  source$Code_insee <- trimws(source$Code_insee)
  source$Classement <- trimws(source$Classement)
  source$Commune <- trimws(source$Commune)
  source$Dpt <- trimws(source$Dpt)

  if (nrow(source) == 0L) {
    stop("Liste littorale vide : aucune commune.", call. = FALSE)
  }
  mal_formes <- source$Code_insee[
    is.na(source$Code_insee) | !grepl("^[0-9]{5}$", source$Code_insee)
  ]
  if (length(mal_formes) > 0L) {
    stop(
      "Liste littorale invalide : code INSEE mal formé : ",
      paste(unique(mal_formes), collapse = ", "), ".",
      call. = FALSE
    )
  }
  if (anyNA(source$Commune) || any(!nzchar(source$Commune))) {
    stop("Liste littorale invalide : commune sans nom.", call. = FALSE)
  }
  if (anyDuplicated(source$Code_insee)) {
    doublons <- unique(source$Code_insee[duplicated(source$Code_insee)])
    stop(
      "Liste littorale invalide : doublon communal pour ",
      paste(doublons, collapse = ", "), ".",
      call. = FALSE
    )
  }
  classements <- unique(source$Classement)
  inconnus <- setdiff(classements, CLASSES_LITTORAL_CLASSEMENTS)
  if (length(inconnus) > 0L) {
    stop(
      "Liste littorale invalide : classement source inconnu : ",
      paste(inconnus, collapse = ", "), ".",
      call. = FALSE
    )
  }
  attr(source, "pin_verifie") <- !is.null(sha256)
  source
}

# construire_crosswalk_littoral -------------------------------------------------
# LE crosswalk complet et exhaustif : la liste positive validée devient C ;
# CHAQUE commune canonique absente de la liste devient NC. La fonction refuse
# une source vide, dupliquée ou hors de l'univers canonique — l'absence n'est
# jamais convertie en NC avant cette validation.
construire_crosswalk_littoral <- function(source, communes,
                                          exiger_identite = TRUE) {
  if (exiger_identite && !isTRUE(attr(source, "pin_verifie"))) {
    stop(
      "Crosswalk littoral invalide : la source n'a pas été admise par ",
      "l'empreinte épinglée (aucun complément NC ne peut être généré).",
      call. = FALSE
    )
  }
  requis <- c("Code_insee", "Classement")
  manquants <- setdiff(requis, names(source))
  if (length(manquants) > 0L) {
    stop(
      "Crosswalk littoral invalide : colonne(s) source absente(s) : ",
      paste(manquants, collapse = ", "), ".",
      call. = FALSE
    )
  }
  communes <- unique(as.character(communes))
  if (length(communes) == 0L) {
    stop("Crosswalk littoral invalide : univers communal vide.", call. = FALSE)
  }
  codes <- trimws(as.character(source$Code_insee))
  if (length(codes) == 0L) {
    stop("Crosswalk littoral invalide : liste source vide.", call. = FALSE)
  }
  if (anyDuplicated(codes)) {
    doublons <- unique(codes[duplicated(codes)])
    stop(
      "Crosswalk littoral invalide : doublon source pour ",
      paste(doublons, collapse = ", "), ".",
      call. = FALSE
    )
  }
  hors <- setdiff(codes, communes)
  if (length(hors) > 0L) {
    stop(
      "Crosswalk littoral invalide : code(s) hors de l'univers canonique : ",
      paste(sort(hors), collapse = ", "), ".",
      call. = FALSE
    )
  }
  classements <- trimws(as.character(source$Classement))
  inconnus <- setdiff(unique(classements), CLASSES_LITTORAL_CLASSEMENTS)
  if (length(inconnus) > 0L) {
    stop(
      "Crosswalk littoral invalide : classement source inconnu : ",
      paste(inconnus, collapse = ", "), ".",
      call. = FALSE
    )
  }

  classement_par_code <- stats::setNames(classements, codes)
  tibble::tibble(
    code_commune = communes,
    littoral_code = ifelse(communes %in% codes, "C", "NC"),
    littoral_classement_source = unname(classement_par_code[communes])
  )[order(communes), , drop = FALSE]
}

# publier_classes_littoral ------------------------------------------------------
# Joint le crosswalk validé sur le squelette territorial. Le crosswalk doit
# couvrir EXACTEMENT les communes canoniques : une commune manquante, un code
# dupliqué ou inconnu, un code hors domaine C/NC, un classement incohérent ou
# une classification portée par un non-commune échouent fort. Les non-communes
# portent NA (miroir des classes de densité).
publier_classes_littoral <- function(territoires, crosswalk) {
  cle_territoire <- if ("territoire" %in% names(territoires)) {
    "territoire"
  } else if ("code" %in% names(territoires)) {
    "code"
  } else {
    stop("Territoires invalides : aucune clé code/territoire.", call. = FALSE)
  }
  requis <- c("code_commune", "littoral_code", "littoral_classement_source")
  manquants <- setdiff(requis, names(crosswalk))
  if (length(manquants) > 0L) {
    stop(
      "Crosswalk littoral invalide : colonne(s) absente(s) : ",
      paste(manquants, collapse = ", "), ".",
      call. = FALSE
    )
  }
  if (anyDuplicated(crosswalk$code_commune)) {
    doublons <- unique(crosswalk$code_commune[duplicated(crosswalk$code_commune)])
    stop(
      "Crosswalk littoral invalide : doublon communal pour ",
      paste(doublons, collapse = ", "), ".",
      call. = FALSE
    )
  }
  codes <- trimws(as.character(crosswalk$littoral_code))
  inconnus <- setdiff(unique(codes), CLASSES_LITTORAL_DOMAINE)
  if (length(inconnus) > 0L) {
    stop(
      "Crosswalk littoral invalide : code littoral inconnu : ",
      paste(inconnus, collapse = ", "), ".",
      call. = FALSE
    )
  }
  classements <- trimws(as.character(crosswalk$littoral_classement_source))
  est_c <- codes == "C"
  classement_manquant <- est_c & !(classements %in% CLASSES_LITTORAL_CLASSEMENTS)
  if (any(classement_manquant)) {
    stop(
      "Crosswalk littoral invalide : classement source inconnu ou manquant pour ",
      paste(crosswalk$code_commune[classement_manquant], collapse = ", "), ".",
      call. = FALSE
    )
  }
  classement_nc <- !est_c & !is.na(classements)
  if (any(classement_nc)) {
    stop(
      "Crosswalk littoral invalide : classement source incohérent pour un code NC : ",
      paste(crosswalk$code_commune[classement_nc], collapse = ", "), ".",
      call. = FALSE
    )
  }

  communes <- as.character(territoires[[cle_territoire]][
    territoires$type == "commune"
  ])
  extra <- setdiff(crosswalk$code_commune, communes)
  if (length(extra) > 0L) {
    non_communes <- intersect(extra, as.character(territoires[[cle_territoire]]))
    if (length(non_communes) > 0L) {
      stop(
        "Crosswalk littoral invalide : classification littorale pour un territoire non-commune : ",
        paste(non_communes, collapse = ", "), ".",
        call. = FALSE
      )
    }
    stop(
      "Crosswalk littoral invalide : code(s) inconnu(s) de l'univers canonique : ",
      paste(sort(extra), collapse = ", "), ".",
      call. = FALSE
    )
  }
  sans_classification <- setdiff(communes, crosswalk$code_commune)
  if (length(sans_classification) > 0L) {
    stop(
      "Crosswalk littoral invalide : commune(s) ",
      paste(sans_classification, collapse = ", "),
      " sans classification littorale.",
      call. = FALSE
    )
  }

  rattachements <- tibble::tibble(
    cle = as.character(crosswalk$code_commune),
    littoral_code = codes,
    littoral_classement_source = classements
  )
  publies <- dplyr::left_join(
    territoires, rattachements, by = stats::setNames("cle", cle_territoire)
  )
  non_communes <- publies$type != "commune"
  publies[non_communes, c(
    "littoral_code",
    "littoral_classement_source"
  )] <- NA_character_
  publies
}

# codes_communes ----------------------------------------------------------------
# Les codes communaux canoniques d'un squelette territorial (clé code ou
# territoire — les builders et la référence n'utilisent pas la même).
codes_communes <- function(territoires) {
  cle <- if ("code" %in% names(territoires)) "code" else "territoire"
  as.character(territoires[[cle]][territoires$type == "commune"])
}

# appliquer_classifications_communales ------------------------------------------
# LE seam partagé : chaque producteur de thème applique les classifications
# communales disponibles dans le même ordre, sans dépendre d'un autre thème
# ni d'un run Milieux préalable.
appliquer_classifications_communales <- function(territoires,
                                                 classes_densite = NULL,
                                                 classes_littoral = NULL) {
  if (!is.null(classes_densite)) {
    territoires <- publier_classes_densite(territoires, classes_densite)
  }
  if (!is.null(classes_littoral)) {
    crosswalk <- construire_crosswalk_littoral(
      classes_littoral, codes_communes(territoires)
    )
    territoires <- publier_classes_littoral(territoires, crosswalk)
  }
  territoires
}

# metadata_classes_littorale ----------------------------------------------------
# La provenance de la classification : identité de la source, licence,
# empreinte du fichier acquis, millésime daté, définition statutaire, règle
# géographique et limites. Une liste, jamais un commentaire de code.
metadata_classes_littorale <- function() {
  list(
    dataset = "Communes littorales en Bretagne au titre de la loi",
    publisher = "DREAL Bretagne",
    url = "https://www.data.gouv.fr/datasets/communes-littorales-en-bretagne-au-titre-de-la-loi",
    acquisition_url = MANIFEST_CLASSES_LITTORAL$url[[1L]],
    licence = "Licence Ouverte 2.0 (lov2)",
    sha256 = MANIFEST_CLASSES_LITTORAL$sha256[[1L]],
    vintage = "Liste positive DREAL Bretagne — métadonnées de diffusion du 2023-04-21",
    freshness = "Dernière modification déclarée par data.gouv.fr le 21 avril 2023 — ce n'est pas une date de relevé du périmètre juridique",
    definition = "Communes définies par la loi Littoral de 1986, complétées par le décret 2004-311.",
    coverage = paste(
      "Liste positive exhaustive pour les quatre départements bretons ;",
      "le complément de l'univers communal canonique est Non littoral (NC).",
      "La DREAL exclut Plouvien (29209), que le zonage Cerema/ANCT antérieur",
      "classait encore littoral après la modification communale de 2015."
    ),
    classements = CLASSES_LITTORAL_CLASSEMENTS,
    caveat = paste(
      "Instantané daté de la liste DREAL : ce n'est pas une garantie juridique",
      "en vigueur ni un relevé de périmètre à une date certaine.",
      "Les limites communales et la liste peuvent évoluer ; la liste positive",
      "DREAL est la seule source de C, le complément validé est NC.",
      "Plouvien (29209) est exclue par la DREAL depuis la modification",
      "communale de 2015, alors que le zonage Cerema/ANCT antérieur la classait",
      "encore littorale : ce n'est pas une divergence d'interprétation mais une",
      "différence de périmètre datée."
    ),
    vintages = list(list(
      id = MANIFEST_CLASSES_LITTORAL$id[[1L]],
      label = "Communes littorales en Bretagne au titre de la loi",
      version = "Liste positive DREAL Bretagne — diffusion 2023-04-21",
      licence = "Licence Ouverte 2.0 (lov2)",
      # Aucune date de relevé du périmètre juridique n'est publiée par la
      # source : la référence reste honnêtement absente (null), la date de
      # diffusion déclarée porte l'horloge de publication.
      dateReference = NA_character_,
      datePublication = "2023-04-21"
    ))
  )
}

# metadata_reference_territoriale ------------------------------------------------
# Le sidecar PARTAGÉ de la référence (un seul propriétaire : territory_reference).
# La source littorale n'est déclarée que lorsque la référence publiée porte
# réellement la classification — une référence de transition (ancien artefact
# sans littoral) garde exactement son sidecar historique.
metadata_reference_territoriale <- function(territoires = NULL) {
  metadata <- metadata_classes_densite()
  champs_littoral <- c("littoral_code", "littoral_classement_source")
  if (!is.null(territoires) && all(champs_littoral %in% names(territoires))) {
    metadata$source_records$classe_littorale_communale <-
      metadata_classes_littorale()
    metadata$territory_reference_label <-
      "Référentiel territorial — classifications communales"
  }
  metadata
}
