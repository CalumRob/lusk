# theme_programmes --------------------------------------------------------------
# Le module du thème Programmes & financements (issue #175, ADR-0013) : le
# descripteur LÉGER theme_programmes() que la machinerie partagée
# (download/compute/publish) consomme sans jamais nommer le thème — la même
# forme de contrat que theme_mobilite() / theme_economie().
#
# Ce qui vit ici, ce qui ne vit pas ici :
#   - le manifeste CONCATÉNÉ : les CINQ fragments par source (ACV, PVD, CRTE,
#     Territoires d'industrie, ORT), dans manifest_programmes.R — chacun garde
#     SON contrat, SON vintage, SA référence et SA publication ;
#   - les LECTEURS de sources (lire_acv, lire_pvd, lire_crte, lire_ti,
#     lire_ort) : la normalisation des fichiers de cache, chacun filtré
#     Bretagne et réduit à l'identité — le seam d'entrée du run, testé sur des
#     fixtures (jamais le réseau) ;
#   - la construction des données : construire_donnees_programmes assemble les
#     cinq tables normalisées en UNE liste nommée ;
#   - le builder de vintages (la projection générique depuis le manifeste,
#     vintages_depuis_manifest, vintage.R) ;
#   - le CALCUL des lignes d'adhésion : construire_membres_programmes — une
#     ligne par (territoire × programme) au niveau d'ancrage du programme, le
#     drapeau « convention valant ORT », les estampilles vintage. Les règles de
#     badge (CONTEXT.md §ORT) y sont verrouillées : ORT Signée seulement, une
#     commune labellisée ACV/PVD ne reçoit JAMAIS une seconde ligne ORT (son
#     label porte le drapeau), un EPCI dont l'ORT est entièrement porté par les
#     labels n'a pas de ligne ORT ;
#   - la validation du payload : verifier_membres_programmes — un sigle inconnu,
#     un territoire inconnu, un double badge ou une ligne cassée échouent FORT
#     (PRD #162, user story 19 : la dérive ne doit jamais atteindre la fiche
#     silencieusement) ;
#   - le SEAM de publication : publier_programmes, câblé — le chaînon
#     (construire_analytiques_programmes) calcule la table des adhésions, la
#     valide et la persiste sous data/processed/programmes/ ; le seam ASSEMBLE
#     le payload complet (les adhésions + les agrégats de subventions du ticket
#     #176, via les signatures documentées de subventions.R) et publie le
#     FICHIER PARTAGÉ programmes.json + les parquets par table (le contrat
#     « 404 = table absente », le précédent apercu #116 — issue #178) ;
#   - le manifeste COMPLET du run : MANIFEST_PROGRAMMES_COMPLET — les CINQ
#     sources ANCT/DGALN du manifeste #175 + la source SCDL des subventions
#     (#176), pour que le téléchargement, le rapport de run et la table
#     partagée des vintages couvrent aussi la source des subventions (issue
#     #178 : « the module's source vintages are merged into the shared vintages
#     table »).
# Ce qui N'y vit PAS : aucun calcul de subventions (ticket #176 — le module
# subventions.R garde SES seams), aucune modification de
# theme_demographie/theme_habitat.

# Les lecteurs de sources ------------------------------------------------------
# Chaque lecteur lit SON fichier de cache (par son id de manifeste), filtre
# Bretagne et réduit à l'identité normalisée du contrat. Un fichier corrompu —
# une colonne requise manquante, une identité invalide, un fichier vide —
# s'arrête bruyamment en nommant la colonne fautive (jamais un échec
# silencieux, la discipline des lecteurs du pipeline).

# lire_acv --------------------------------------------------------------------
# La liste lauréate ACV (ANCT, COG 2025) : insee_com, lib_com, id_acv, lib_acv,
# date_signature. Filtre Bretagne (DEPT_BRETAGNE), identité normalisée :
# code_commune / nom_commune / id_acv.
lire_acv <- function(chemin) {
  table <- readr::read_csv(
    chemin,
    col_types = readr::cols(
      insee_com = readr::col_character(),
      lib_com = readr::col_character(),
      id_acv = readr::col_character(),
      .default = readr::col_character()
    ),
    show_col_types = FALSE
  )
  verifier_lecture(table, c("insee_com", "lib_com", "id_acv"), "ACV")
  table %>%
    dplyr::filter(substr(insee_com, 1, 2) %in% DEPT_BRETAGNE) %>%
    dplyr::transmute(code_commune = insee_com,
                     nom_commune = lib_com,
                     id_acv = id_acv)
}

# lire_pvd --------------------------------------------------------------------
# La liste lauréate PVD (ANCT, COG 2025) : insee_com, lib_com, id_pvd,
# date_signature. Filtre Bretagne, identité normalisée : code_commune /
# nom_commune / id_pvd.
lire_pvd <- function(chemin) {
  table <- readr::read_csv(
    chemin,
    col_types = readr::cols(
      insee_com = readr::col_character(),
      lib_com = readr::col_character(),
      id_pvd = readr::col_character(),
      .default = readr::col_character()
    ),
    show_col_types = FALSE
  )
  verifier_lecture(table, c("insee_com", "lib_com", "id_pvd"), "PVD")
  table %>%
    dplyr::filter(substr(insee_com, 1, 2) %in% DEPT_BRETAGNE) %>%
    dplyr::transmute(code_commune = insee_com,
                     nom_commune = lib_com,
                     id_pvd = id_pvd)
}

# lire_crte -------------------------------------------------------------------
# Le suivi du périmètre CRTE (ANCT, COG 2025) : la table des groupements
# couverts par chaque contrat — UNE ligne par groupement, qui peut être une
# COMMUNE (nature_juridique « COM » — une commune signataire individuelle) ou
# un EPCI (« CC » / « CA » / « METRO » — l'intercommunalité signataire). Le
# SIREN de la ligne (siren_epci) est celui du groupement lui-même : pour une
# ligne COM, c'est le SIREN de la commune — jamais l'EPCI de la commune. Le
# badge CRTE est ancré à l'EPCI : seules les lignes EPCI du fichier portent le
# badge (le filtre nature_juridique vit au calcul). Filtre Bretagne (insee_reg
# 53). Identité normalisée : id_crte / lib_crte / type_grp_crte /
# nature_juridique / siren_epci.
lire_crte <- function(chemin) {
  table <- readr::read_csv(
    chemin,
    col_types = readr::cols(
      insee_reg = readr::col_double(),
      id_crte = readr::col_character(),
      lib_crte = readr::col_character(),
      type_grp_crte = readr::col_character(),
      nature_juridique = readr::col_character(),
      siren_epci = readr::col_character(),
      .default = readr::col_character()
    ),
    show_col_types = FALSE
  )
  verifier_lecture(table, c("insee_reg", "id_crte", "nature_juridique",
                            "siren_epci"), "CRTE")
  table %>%
    dplyr::filter(insee_reg == 53) %>%
    dplyr::transmute(id_crte = id_crte,
                     lib_crte = lib_crte,
                     type_grp_crte = type_grp_crte,
                     nature_juridique = nature_juridique,
                     siren_epci = siren_epci)
}

# lire_ti ---------------------------------------------------------------------
# La liste des Territoires d'industrie (Banque des Territoires/ANCT) : un CSV
# délimité ';' (le fichier réel porte une colonne géométrie énorme, jamais
# lue), une ligne par commune du territoire avec le code officiel de l'EPCI.
# Filtre Bretagne (Code Officiel Région 53) et écarte les lignes vides du
# fichier (sans id). Identité normalisée : id_ti / lib_ti / siren_epci /
# nom_epci.
lire_ti <- function(chemin) {
  table <- readr::read_delim(
    chemin,
    delim = ";",
    col_types = readr::cols(.default = readr::col_character()),
    show_col_types = FALSE,
    locale = readr::locale(encoding = "UTF-8")
  )
  verifier_lecture(table, c("id_ti", "Code Officiel Région", "Code Officiel EPCI"),
                   "Territoires d'industrie")
  table %>%
    dplyr::filter(`Code Officiel Région` == "53",
                  !is.na(id_ti), id_ti != "") %>%
    dplyr::transmute(id_ti = id_ti,
                     lib_ti = lib_ti,
                     siren_epci = `Code Officiel EPCI`,
                     nom_epci = `Nom Officiel EPCI`)
}

# lire_ort --------------------------------------------------------------------
# Le classeur ORT (DGALN/ANCT, ressource XLSX uniquement), feuille « Suivi
# conventions » : une ligne par commune-convention. Filtre Bretagne (Région),
# écarte les doublons signalés, et normalise : code_commune (en caractères —
# les zéros de tête du COG sont préservés), statut (la colonne « Signée ? » :
# Signée / Terminée / Non signée / En cours) et actualisation — la date PAR
# LIGNE « Dernière actualisation », la fraîcheur de la source (jamais la
# métadonnée de page, périmée d'environ 15 mois).
lire_ort <- function(chemin) {
  table <- readxl::read_excel(chemin, sheet = "Suivi conventions",
                              col_types = "text")
  verifier_lecture(table, c("Région", "Code commune", "Signée ?",
                            "Dernière actualisation"), "ORT")
  table %>%
    dplyr::filter(grepl("Bretagne", `Région`)) %>%
    dplyr::filter(is.na(doublon) | doublon != "TRUE") %>%
    dplyr::transmute(
      code_commune = `Code commune`,
      statut = `Signée ?`,
      actualisation = date_iso(`Dernière actualisation`)
    )
}

# date_iso --------------------------------------------------------------------
# La date « Dernière actualisation » en ISO (AAAA-MM-JJ), quelle que soit la
# forme lue : un POSIXct (le classeur réel documenté), un numéro de série
# Excel — numérique ou lu en texte (le classeur RÉEL est lu par lire_ort avec
# col_types = "text", le zéro de tête du code commune préservé : la cellule de
# date arrive comme sa valeur brute « 46076.5860 », jamais une date ISO) — ou
# une chaîne « AAAA-MM-JJ HH:MM:SS » (les fixtures). Jamais l'heure — la
# fraîcheur est la journée de la convention.
date_iso <- function(x) {
  if (inherits(x, "POSIXt")) {
    format(as.Date(x), "%Y-%m-%d")
  } else {
    chaine <- as.character(x)
    # le numéro de série Excel (une valeur purement numérique, entière ou
    # décimale) est converti depuis l'origine Excel 1899-12-30 ; toute autre
    # chaîne (les fixtures « AAAA-MM-JJ HH:MM:SS ») garde sa date. La
    # conversion ne touche QUE les éléments numériques — jamais de NA par
    # coercition sur les chaînes ISO.
    serie <- grepl("^[0-9]+(\\.[0-9]+)?$", chaine)
    resultat <- substr(chaine, 1, 10)
    if (any(serie)) {
      resultat[serie] <- format(as.Date(as.numeric(chaine[serie]),
                                        origin = "1899-12-30"), "%Y-%m-%d")
    }
    resultat
  }
}

# verifier_lecture -------------------------------------------------------------
# La garde de forme commune aux lecteurs : les colonnes requises présentes, au
# moins une ligne. Un fichier qui change de structure échoue ICI, en nommant
# la colonne fautive — jamais plus tard dans la machinerie.
verifier_lecture <- function(table, colonnes, source) {
  manquantes <- setdiff(colonnes, names(table))
  if (length(manquantes) > 0) {
    stop("Lecture ", source, " : colonne(s) requise(s) manquante(s) : ",
         paste(manquantes, collapse = ", "), ".", call. = FALSE)
  }
  if (nrow(table) == 0L) {
    stop("Lecture ", source, " : fichier sans aucune ligne.", call. = FALSE)
  }
  invisible(TRUE)
}

# construire_donnees_programmes ------------------------------------------------
# L'acte « trouver la donnée » du thème : les cinq lecteurs — chacun lit SON
# fichier dans le cache (par son id de manifeste) — assemblés en UNE liste
# nommée (la forme que le calcul consomme).
construire_donnees_programmes <- function(cache = "data/raw") {
  chemin <- function(id) {
    file.path(cache, MANIFEST_PROGRAMMES$fichier[
      MANIFEST_PROGRAMMES$id == id])
  }
  list(
    acv = lire_acv(chemin("acv")),
    pvd = lire_pvd(chemin("pvd")),
    crte = lire_crte(chemin("crte")),
    territoires_industrie = lire_ti(chemin("territoires_industrie")),
    ort = lire_ort(chemin("ort"))
  )
}

# MANIFEST_PROGRAMMES_COMPLET ---------------------------------------------------
# Le manifeste COMPLET du run du thème (issue #178) : les CINQ sources du
# manifeste #175 (MANIFEST_PROGRAMMES — ACV, PVD, CRTE, Territoires
# d'industrie, ORT) + la source SCDL des subventions (#176 — MANIFEST_SUBVENTIONS,
# subventions_scdl, l'export hebdomadaire de data.bretagne.bzh). C'est LE
# manifeste que la machinerie partagée consomme (download_sources, rapport de
# run) — le run télécharge et trace les SIX sources du payload. Le manifeste
# #175 reste intact (verifier_contrat_programmes continue de verrouiller SES
# cinq fragments) ; le fragment SCDL garde SA validation (verifier_contrat_
# subventions). MANIFEST_PROGRAMMES_COMPLET est construit ICI (après les deux
# modules) : l'ordre de chargement des fichiers garantit que MANIFEST_SUBVENTIONS
# existe déjà.
MANIFEST_PROGRAMMES_COMPLET <- dplyr::bind_rows(
  MANIFEST_PROGRAMMES,
  MANIFEST_SUBVENTIONS
)

# vintages_programmes ----------------------------------------------------------
# Le builder de vintages du thème : la projection générique depuis le manifeste
# COMPLET du run (vintages_depuis_manifest, vintage.R) — les CINQ sources du
# manifeste #175 + la source SCDL des subventions (#176, subventions_scdl).
# Chaque source garde SA référence et SA publication. L'ORT : version « en
# continu », référence et publication NA (la fraîcheur est par ligne, la
# métadonnée de page est périmée). La projection couvre le manifeste COMPLET
# pour que la table PARTAGÉE des vintages porte aussi la source des
# subventions après un run du thème (issue #178, issue #124 — upsert par id,
# jamais l'écrasement last-writer-wins des sources des autres thèmes).
vintages_programmes <- function() {
  vintages_depuis_manifest(MANIFEST_PROGRAMMES_COMPLET)
}

# construire_membres_programmes ------------------------------------------------
# LE calcul des lignes d'adhésion (ADR-0013) : une ligne par (territoire ×
# programme) au niveau d'ancrage du programme —
#   - ACV/PVD : une ligne par commune LABELLISÉE (les listes lauréates ANCT) ;
#   - CRTE/TI : une ligne par EPCI signataire (les paires contrat × EPCI des
#     sources) ;
#   - ORT     : les conventions « Signée » des communes NON labellisées, aux
#     deux ancrages — la commune ET son EPCI (via le référentiel partagé
#     commune → EPCI, jamais le libellé du fichier). Une commune labellisée
#     ACV/PVD avec une convention signée porte le drapeau « convention valant
#     ORT » sur SA ligne de label — JAMAIS une seconde ligne ORT (le double
#     badge est interdit). Un EPCI dont l'ORT est entièrement porté par les
#     labels de ses communes membres n'a pas de ligne ORT (user story #162-9) ;
#     « Terminée » et « Non signée » ne produisent AUCUNE ligne.
# Chaque ligne est estampillée du vintage de SA source — la mise à jour du jeu
# ANCT pour les labels/contrats, l'actualisation PAR LIGNE pour l'ORT.
construire_membres_programmes <- function(donnees, base_epci, vintages) {
  acv <- donnees$acv
  pvd <- donnees$pvd
  crte <- donnees$crte
  ti <- donnees$territoires_industrie
  ort <- donnees$ort

  labellisees <- c(acv$code_commune, pvd$code_commune)
  # %in% plutôt que == : une convention au statut NA (le fichier réel porte des
  # lignes sans statut) ou « En cours » n'est JAMAIS une convention signée —
  # le badge ORT ne s'allume que sur le statut « Signée »
  signee <- ort[ort$statut %in% "Signée", ]
  signee_codes <- unique(signee$code_commune)

  # les labels, ancrés à la commune, avec le drapeau « convention valant ORT »
  acv_rows <- tibble::tibble(
    territoire = acv$code_commune,
    type = "commune",
    sigle = "ACV",
    convention_valant_ort = acv$code_commune %in% signee_codes
  )
  pvd_rows <- tibble::tibble(
    territoire = pvd$code_commune,
    type = "commune",
    sigle = "PVD",
    convention_valant_ort = pvd$code_commune %in% signee_codes
  )

  # les contrats, ancrés à l'EPCI signataire — SEULES les lignes EPCI du
  # fichier de suivi (les groupements « CC » / « CA » / « METRO ») portent le
  # badge : une ligne « COM » est une commune signataire individuelle, son
  # SIREN est celui de la commune, jamais l'EPCI — et un EPCI dont une seule
  # commune a signé n'a PAS signé (la source distingue les deux)
  crte_rows <- crte %>%
    dplyr::filter(nature_juridique != "COM") %>%
    dplyr::distinct(id_crte, siren_epci) %>%
    dplyr::transmute(
      territoire = as.character(siren_epci),
      type = "epci",
      sigle = "CRTE",
      convention_valant_ort = FALSE
    )
  ti_rows <- ti %>%
    dplyr::distinct(id_ti, siren_epci) %>%
    dplyr::transmute(
      territoire = as.character(siren_epci),
      type = "epci",
      sigle = "Territoires d'industrie",
      convention_valant_ort = FALSE
    )

  # l'ORT : les conventions SIGNÉES des communes NON labellisées, aux deux
  # ancrages. Le référentiel commune → EPCI (CODGEO → EPCI de la base partagée)
  # donne l'ancrage EPCI — jamais le libellé du fichier, qui n'est pas un SIREN.
  non_labellisees <- signee[!(signee$code_commune %in% labellisees), ]
  referentiel <- base_epci %>%
    dplyr::transmute(code = as.character(CODGEO), epci = as.character(EPCI)) %>%
    dplyr::distinct()
  inconnues <- setdiff(unique(non_labellisees$code_commune), referentiel$code)
  if (length(inconnues) > 0) {
    stop("construire_membres_programmes : commune(s) ORT inconnue(s) du ",
         "référentiel des territoires : ",
         paste(inconnues, collapse = ", "), ".", call. = FALSE)
  }
  avec_epci <- non_labellisees %>%
    dplyr::left_join(referentiel, by = c("code_commune" = "code")) %>%
    # une convention SIGNÉE sans actualisation ne porte pas de fraîcheur par
    # ligne (le contrat estampille chaque ligne ORT de SA date) — elle n'entre
    # dans AUCUN agrégat de fraîcheur
    dplyr::filter(!is.na(.data$actualisation))

  # l'actualisation la plus récente de chaque convention (commune) et de
  # chaque EPCI — la fraîcheur par ligne portée par les lignes ORT. La garde
  # n() > 0 : sur un input SANS lignes (un run à tables vides, issue #178), un
  # max() sur le groupe vide déclencherait « no non-missing arguments ».
  ort_communes <- avec_epci %>%
    dplyr::group_by(code_commune) %>%
    dplyr::summarise(
      actualisation = if (dplyr::n() > 0) max(actualisation) else NA_character_,
      .groups = "drop"
    ) %>%
    dplyr::transmute(
      territoire = code_commune, type = "commune", sigle = "ORT",
      convention_valant_ort = FALSE, actualisation = actualisation
    )
  ort_epcis <- avec_epci %>%
    dplyr::group_by(epci) %>%
    dplyr::summarise(
      actualisation = if (dplyr::n() > 0) max(actualisation) else NA_character_,
      .groups = "drop"
    ) %>%
    dplyr::transmute(
      territoire = epci, type = "epci", sigle = "ORT",
      convention_valant_ort = FALSE, actualisation = actualisation
    )

  dplyr::bind_rows(acv_rows, pvd_rows, crte_rows, ti_rows,
                   ort_communes, ort_epcis) %>%
    estamper_membres_programmes(vintages)
}

# estamper_membres_programmes ---------------------------------------------------
# Les estampilles vintage de chaque ligne : le vintage de SA source de
# référence (la jointure sigle → id du manifeste → vintages). Exception ORT :
# la ligne porte l'actualisation PAR LIGNE de sa convention (la colonne
# actualisation) comme date de référence — jamais la référence du manifeste
# (NA par contrat : la fraîcheur du fichier est par ligne).
estamper_membres_programmes <- function(rows, vintages) {
  sources <- tibble::tibble(
    sigle = c("ACV", "PVD", "CRTE", "Territoires d'industrie", "ORT"),
    source_reference = c("acv", "pvd", "crte", "territoires_industrie", "ort")
  )
  tampons <- sources %>%
    dplyr::left_join(vintages, by = c("source_reference" = "id")) %>%
    dplyr::select(sigle,
                  vintage_source = source,
                  vintage_version = version,
                  vintage_date_reference_source = date_reference,
                  vintage_date_publication = date_publication)

  rows %>%
    dplyr::left_join(tampons, by = "sigle") %>%
    dplyr::mutate(
      vintage_date_reference = dplyr::if_else(
        sigle == "ORT", actualisation, vintage_date_reference_source
      )
    ) %>%
    dplyr::select(territoire, type, sigle, convention_valant_ort,
                  vintage_source, vintage_version, vintage_date_reference,
                  vintage_date_publication) %>%
    dplyr::arrange(sigle, type, territoire)
}

# verifier_membres_programmes ---------------------------------------------------
# La validation FORTE du payload des adhésions (PRD #162, user story 19) : un
# sigle inconnu, un territoire inconnu du référentiel, un double badge (une
# commune labellisée AVEC une ligne ORT), un drapeau hors label, un vintage
# manquant ou une ligne en double échouent bruyamment — la dérive ne doit
# jamais atteindre la fiche silencieusement.
verifier_membres_programmes <- function(membres, base_epci, vintages) {
  manquer <- function(champ, detail) {
    stop(sprintf("Payload programmes invalide — %s : %s.", champ, detail),
         call. = FALSE)
  }
  attendus <- c("ACV", "PVD", "CRTE", "Territoires d'industrie", "ORT")

  if (!identical(names(membres),
                 c("territoire", "type", "sigle", "convention_valant_ort",
                   "vintage_source", "vintage_version",
                   "vintage_date_reference", "vintage_date_publication"))) {
    manquer("forme", "la table des adhésions n'a pas la forme du contrat")
  }
  if (anyDuplicated(membres[c("territoire", "sigle")])) {
    manquer("doublons", "lignes en double (territoire × sigle)")
  }
  inconnus <- setdiff(unique(membres$sigle), attendus)
  if (length(inconnus) > 0) {
    manquer("sigle", paste0("sigle(s) inconnu(s) : ", paste(inconnus, collapse = ", ")))
  }

  # les territoires cités existent dans le référentiel (communes → CODGEO,
  # EPCIs → EPCI) — jamais un territoire fantôme
  connus <- c(unique(base_epci$CODGEO), unique(base_epci$EPCI))
  fantomes <- setdiff(membres$territoire, connus)
  if (length(fantomes) > 0) {
    manquer("territoire", paste0("territoire(s) inconnu(s) : ",
                                 paste(fantomes, collapse = ", ")))
  }

  # JAMAIS de double badge : une commune avec une ligne ORT ne porte aucun
  # label, et le drapeau « convention valant ORT » n'existe que sur les labels
  labellisees <- unique(membres$territoire[membres$sigle %in% c("ACV", "PVD")])
  ort_communes <- membres$territoire[
    membres$sigle == "ORT" & membres$type == "commune"]
  if (length(intersect(labellisees, ort_communes)) > 0) {
    manquer("double badge", paste0(
      "une commune labellisée porte une ligne ORT : ",
      paste(intersect(labellisees, ort_communes), collapse = ", ")))
  }
  drapeau_hors_label <- membres$convention_valant_ort[
    !(membres$sigle %in% c("ACV", "PVD"))]
  if (any(drapeau_hors_label)) {
    manquer("drapeau", "le drapeau « convention valant ORT » n'existe que sur les labels")
  }

  # les estampilles : chaque source de référence présente dans les vintages,
  # et les lignes ORT portent leur actualisation par ligne (la date de
  # référence n'est jamais NA pour elles)
  refs <- c("acv", "pvd", "crte", "territoires_industrie", "ort")
  sans_vintage <- setdiff(refs, vintages$id)
  if (length(sans_vintage) > 0) {
    manquer("vintages", paste0("source(s) absente(s) des vintages : ",
                               paste(sans_vintage, collapse = ", ")))
  }
  if (any(is.na(membres$vintage_source)) || any(is.na(membres$vintage_version))) {
    manquer("vintage", "une ligne sans estampille de source")
  }
  ort <- membres[membres$sigle == "ORT", ]
  if (any(is.na(ort$vintage_date_reference))) {
    manquer("vintage", "une ligne ORT sans actualisation par ligne")
  }

  invisible(membres)
}

# construire_analytiques_programmes ---------------------------------------------
# Le chaînon du thème : le calcul des lignes d'adhésion (construire_membres_
# programmes) — les tables en mémoire et la base partagée des EPCI en entrée —
# validé (verifier_membres_programmes) et persisté sous le dossier analytique
# du run (data/processed/programmes/). Retourne la liste des tables
# analytiques, la forme que le seam de publication consomme.
construire_analytiques_programmes <- function(donnees, base_epci,
                                              vintages = NULL,
                                              sortie = "data/processed/programmes") {
  if (is.null(vintages)) vintages <- vintages_programmes()
  membres <- construire_membres_programmes(donnees, base_epci, vintages)
  verifier_membres_programmes(membres, base_epci, vintages)

  if (!dir.exists(sortie)) dir.create(sortie, recursive = TRUE)
  readr::write_rds(membres, file.path(sortie, "membres_programmes.rds"))

  list(membres = membres)
}

# publier_programmes -----------------------------------------------------------
# Le seam de publication du thème (issue #178) : lit le référentiel partagé
# (base_epci du cache), enchaîne les DEUX calculs du payload `programmes`
# (ADR-0013) —
#   - les LIGNES D'ADHÉSION (ticket #175) : construire_analytiques_programmes
#     (le chaînon, validé, persisté sous data/processed/programmes/) ;
#   - les AGRÉGATS DE SUBVENTIONS (ticket #176) : les signatures documentées de
#     subventions.R — construire_donnees_subventions (l'ingestion SCDL depuis
#     le cache, par l'id du manifeste) puis construire_analytiques_subventions
#     (le calcul, estampillé hebdomadaire) ;
# — assemble le payload `list(membres, subventions)`, publie le FICHIER
# PARTAGÉ programmes.json + les parquets par table (ecrire_programmes_partage —
# le contrat « 404 = table absente », le précédent apercu #116) et retourne le
# payload, comme run_pipeline l'attend.
publier_programmes <- function(donnees, cache = "data/raw", vintages = NULL,
                               sortie = "public/data",
                               sortie_analytiques = file.path(dirname(cache),
                                                              "processed",
                                                              "programmes")) {
  if (is.null(vintages)) vintages <- vintages_programmes()

  base_epci <- lire_epci(file.path(cache, "extracted", "EPCI_au_01-01-2025.xlsx"))

  # les adhésions (ticket #175) : le chaînon analytique, validé et persisté
  analytiques <- construire_analytiques_programmes(donnees, base_epci, vintages,
                                                   sortie = sortie_analytiques)
  membres <- analytiques$membres

  # les agrégats de subventions (ticket #176) : l'ingestion SCDL puis le calcul
  conventions <- construire_donnees_subventions(cache = cache)$conventions
  subventions <- construire_analytiques_subventions(conventions, base_epci,
                                                    vintages)
  readr::write_rds(subventions,
                   file.path(sortie_analytiques, "subventions_programmes.rds"))

  payload <- list(membres = membres, subventions = subventions)

  # le seam de publication du run crée la cible comme publish() — le rapport de
  # run et les vintages partagés y sont écrits par la machinerie (même pour un
  # run à tables vides : la trace du run ne disparaît jamais)
  if (!dir.exists(sortie)) dir.create(sortie, recursive = TRUE)

  # le fichier PARTAGÉ : écrit SEULEMENT quand une table porte des lignes — un
  # run vide ne doit JAMAIS clobber la publication existante (issue #178)
  ecrire_programmes_partage(payload, sortie)

  payload
}

# ecrire_programmes_partage -----------------------------------------------------
# La publication du FICHIER PARTAGÉ `programmes` (issue #178, le précédent
# apercu #116 — le contrat « 404 = table absente ») : la cible que l'app lit.
#   - programmes.json : la projection JSON des DEUX tables en UN objet
#     { membres, subventions } — la forme que l'app consomme (issue #179) ;
#   - un parquet PAR TABLE (le format parquet ne tient qu'une table) :
#     programmes_membres.parquet / programmes_subventions.parquet — les
#     artefacts canoniques téléchargeables (ADR-0004) ;
#   - les deux sérialisations sortent des MÊMES tables en mémoire : le JSON se
#     relit BIT À BIT comme les parquets (le contrat de non-dérive, ADR-0004 —
#     test-publish-programmes.R, verifier_non_derivee) ;
#   - la sentinelle : un payload dont AUCUNE table ne porte de lignes n'écrit
#     RIEN et ne touche à aucun fichier existant — un run vide n'écrase jamais
#     la publication précédente (le motif de test-publish.R, issue #116).
ecrire_programmes_partage <- function(payload, sortie = "public/data") {
  if (nrow(payload$membres) == 0 && nrow(payload$subventions) == 0) {
    return(invisible(payload))
  }
  if (!dir.exists(sortie)) dir.create(sortie, recursive = TRUE)

  nanoparquet::write_parquet(payload$membres,
                             file.path(sortie, "programmes_membres.parquet"))
  nanoparquet::write_parquet(payload$subventions,
                             file.path(sortie, "programmes_subventions.parquet"))

  # digits = 17 : assez de décimales pour qu'un double relu en JSON soit BIT À
  # BIT le double du parquet (la même discipline que publish, ADR-0004)
  jsonlite::write_json(
    list(membres = payload$membres, subventions = payload$subventions),
    file.path(sortie, "programmes.json"),
    dataframe = "rows", na = "null", digits = 17, pretty = TRUE
  )
  invisible(payload)
}

# MEMBRES_DESCRIPTEUR_PROGRAMMES ------------------------------------------------
# Les membres requis du descripteur — le contrat de FORME du thème (ce que la
# machinerie partagée consomme : theme, manifest, vintages, construire_donnees
# — et ce que le seam de publication branche : construire_analytiques,
# publier). La même idée que MEMBRES_DESCRIPTEUR_MOBILITE : un descripteur
# incomplet échoue FORT, en nommant le membre fautif.
MEMBRES_DESCRIPTEUR_PROGRAMMES <- c(
  "theme", "manifest", "vintages", "construire_donnees",
  "construire_analytiques", "publier"
)

# verifier_descripteur_programmes ------------------------------------------------
# La validation de FORME du descripteur : tout membre requis manquant fait
# échouer la validation bruyamment, en nommant le membre fautif. Exécutée par
# theme_programmes() sur son propre résultat et par les tests sur des fixtures
# négatives.
verifier_descripteur_programmes <- function(descripteur) {
  manquants <- setdiff(MEMBRES_DESCRIPTEUR_PROGRAMMES, names(descripteur))
  if (length(manquants) > 0) {
    stop("Descripteur Programmes invalide — membre(s) requis manquant(s) : ",
         paste(manquants, collapse = ", "), ".", call. = FALSE)
  }
  invisible(TRUE)
}

# theme_programmes ---------------------------------------------------------------
# Le descripteur du thème Programmes & financements : la même forme de contrat
# que theme_mobilite() / theme_economie(), avec les pièces du thème. Le
# descripteur est validé à la construction (verifier_descripteur_programmes) :
# un membre manquant échoue là où il est construit, jamais plus tard dans la
# machinerie.
theme_programmes <- function() {
  descripteur <- list(
    theme = "programmes",
    manifest = MANIFEST_PROGRAMMES_COMPLET,
    vintages = vintages_programmes,
    construire_donnees = construire_donnees_programmes,
    construire_analytiques = construire_analytiques_programmes,
    publier = publier_programmes
  )
  verifier_descripteur_programmes(descripteur)
  descripteur
}
