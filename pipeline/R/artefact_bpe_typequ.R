# artefact_bpe_typequ ------------------------------------------------------------
# Le référentiel BPE des 53 destinations retenues par l'analyse Mobilité. La
# table est importée depuis le fichier porté de l'analyse d'origine, puis
# versionnée dans inst/extdata : aucune source externe n'est lue pendant le run.
#
# Le code TYPEQU est l'identité stable qui voyage dans l'artefact complet et la
# projection publiée. Le libellé français est résolu ici, une seule fois ; ni
# le pipeline ni l'app ne recopient des libellés locaux ou ne déduisent un label
# depuis le code.

BPE_TYPEQU_ARTEFACT_FICHIER <- "correspondances_TYPEQU.csv"
BPE_TYPEQU_COLONNES <- c("TYPEQU", "Libelle_TYPEQU", "Description")

# verifier_contrat_bpe_typequ ----------------------------------------------------
# La correspondance est un artefact fermé : codes BPE au format TYPEQU, uniques,
# avec un libellé et une description non vides. `codes_attendus` permet au
# snapshot consommateur de vérifier que son univers est exactement celui du
# registre, jamais un sous-ensemble silencieux.
verifier_contrat_bpe_typequ <- function(table, codes_attendus = NULL) {
  if (!is.data.frame(table)) {
    stop("Correspondance BPE TYPEQU invalide — une table est attendue.",
         call. = FALSE)
  }
  manquantes <- setdiff(BPE_TYPEQU_COLONNES, names(table))
  if (length(manquantes)) {
    stop("Correspondance BPE TYPEQU invalide — colonne(s) manquante(s) : ",
         paste(manquantes, collapse = ", "), ".", call. = FALSE)
  }
  table <- table[BPE_TYPEQU_COLONNES]
  if (!nrow(table)) {
    stop("Correspondance BPE TYPEQU invalide — aucune ligne.", call. = FALSE)
  }
  if (any(is.na(table$TYPEQU) | !grepl("^[A-Z][0-9]{3}$", table$TYPEQU))) {
    stop("Correspondance BPE TYPEQU invalide — un code TYPEQU est hors format.",
         call. = FALSE)
  }
  if (anyDuplicated(table$TYPEQU)) {
    stop("Correspondance BPE TYPEQU invalide — les codes doivent être uniques.",
         call. = FALSE)
  }
  for (col in c("Libelle_TYPEQU", "Description")) {
    if (any(is.na(table[[col]]) | !nzchar(trimws(table[[col]])))) {
      stop("Correspondance BPE TYPEQU invalide — la colonne « ", col,
           " » contient une valeur vide.", call. = FALSE)
    }
  }
  if (!is.null(codes_attendus) &&
      !setequal(table$TYPEQU, as.character(codes_attendus))) {
    stop("Correspondance BPE TYPEQU invalide — l'univers du registre ne correspond",
         " pas aux codes du snapshot.", call. = FALSE)
  }
  invisible(table)
}

# lire_correspondances_typequ ----------------------------------------------------
# Lit le CSV épinglé en conservant codes et libellés en caractères. Le paramètre
# permet aux tests de passer une copie volontairement corrompue ; le défaut
# pointe vers la ressource du package, résolue aussi sous pkgload.
lire_correspondances_typequ <- function(chemin = NULL) {
  if (is.null(chemin)) {
    chemin <- system.file("extdata", BPE_TYPEQU_ARTEFACT_FICHIER,
                         package = "lusk")
  }
  if (is.na(chemin) || !nzchar(chemin) || !file.exists(chemin)) {
    stop("Correspondance BPE TYPEQU introuvable : ",
         BPE_TYPEQU_ARTEFACT_FICHIER, ".", call. = FALSE)
  }
  table <- readr::read_csv(
    chemin,
    col_types = readr::cols(.default = readr::col_character()),
    show_col_types = FALSE,
    progress = FALSE
  )
  verifier_contrat_bpe_typequ(table)
  table
}

# CLES_PROFILS_ACCES_BPE ----------------------------------------------------------
# La forme interne complète : un triptyque c/b/t et la lecture mutuellement
# exclusive pour chaque (territoire × Type d'équipement BPE). Les suffixes de
# niveau sont ceux du snapshot porté : rien n'est recalculé depuis les seuls
# agrégats déjà publiés.
CLES_PROFILS_ACCES_BPE <- c("territoire", "type", "typequ", "libelle_typequ",
                            "description_typequ", "c", "b", "t", "profil",
                            "profil_libelle")

CLES_PROJECTION_PROFILS_ACCES_BPE <- c(
  "territoire", "type", "profil", "profil_libelle", "nombre_typequ",
  "exemplar_typequ", "exemplar_libelle", "exemplar_c", "exemplar_b",
  "exemplar_t"
)

# convertir_valeurs_bpe -----------------------------------------------------------
# Le snapshot porté conserve parfois les métriques comme caractères (le CSV
# d'origine est typé de cette façon). La conversion est explicite et stricte :
# une chaîne non numérique arrête l'artefact, elle ne devient jamais un NA
# silencieux.
convertir_valeurs_bpe <- function(valeurs, colonne) {
  numeriques <- suppressWarnings(as.numeric(valeurs))
  texte <- as.character(valeurs)
  invalides <- !is.na(valeurs) & nzchar(trimws(texte)) & is.na(numeriques)
  if (any(invalides)) {
    stop("Artefact BPE : la colonne « ", colonne,
         " » contient une valeur non numérique.", call. = FALSE)
  }
  numeriques
}

# verifier_base_epci_profils_bpe -------------------------------------------------
verifier_base_epci_profils_bpe <- function(base_epci) {
  requises <- c("CODGEO", "EPCI", "DEP", "REG")
  if (!is.data.frame(base_epci)) {
    stop("Artefact BPE : la base territoriale doit être une table.", call. = FALSE)
  }
  manquantes <- setdiff(requises, names(base_epci))
  if (length(manquantes)) {
    stop("Artefact BPE : colonne(s) manquante(s) dans la base territoriale : ",
         paste(manquantes, collapse = ", "), ".", call. = FALSE)
  }
  invisible(TRUE)
}

# construire_matrice_profils_acces_bpe -------------------------------------------
# Construit la matrice complète à partir des douze colonnes du snapshot pour
# chaque Type d'équipement (trois modes × quatre niveaux). Les valeurs _epci /
# _dep / _reg sont répétées sur les communes membres dans le fichier porté :
# leur divergence est une corruption et non une invitation à prendre la
# première valeur.
construire_matrice_profils_acces_bpe <- function(snapshot, base_epci,
                                                 registre = lire_correspondances_typequ()) {
  if (!is.data.frame(snapshot)) {
    stop("Artefact BPE : le snapshot doit être une table.", call. = FALSE)
  }
  if (!"commune" %in% names(snapshot)) {
    stop("Artefact BPE : la colonne « commune » manque au snapshot.", call. = FALSE)
  }
  verifier_contrat_bpe_typequ(
    registre,
    codes_attendus = unique(registre$TYPEQU)
  )
  colonnes_snapshot <- grep(
    "^has_[A-Z][0-9]{3}_(t|b|c)(_(epci|dep|reg))?_raw$",
    names(snapshot), value = TRUE
  )
  codes_snapshot <- unique(sub(
    "^has_([A-Z][0-9]{3})_(t|b|c)(_(epci|dep|reg))?_raw$", "\\1",
    colonnes_snapshot
  ))
  if (!setequal(codes_snapshot, registre$TYPEQU) ||
      length(codes_snapshot) != nrow(registre)) {
    stop("Artefact BPE : l'univers des codes du snapshot ne correspond pas au",
         " registre TYPEQU.", call. = FALSE)
  }
  verifier_base_epci_profils_bpe(base_epci)

  communes <- as.character(snapshot$commune)
  if (anyNA(communes) || any(!nzchar(communes)) || anyDuplicated(communes)) {
    stop("Artefact BPE : les communes du snapshot doivent être non vides et uniques.",
         call. = FALSE)
  }

  base <- base_epci %>%
    dplyr::transmute(
      commune = as.character(CODGEO),
      epci = as.character(EPCI),
      departement = as.character(DEP),
      region = as.character(REG)
    )
  if (anyNA(base$commune) || any(!nzchar(base$commune)) ||
      anyDuplicated(base$commune)) {
    stop("Artefact BPE : CODGEO doit être non vide et unique.", call. = FALSE)
  }

  identites <- tibble::tibble(commune = communes) %>%
    dplyr::left_join(base, by = "commune")
  if (anyNA(identites$departement) || anyNA(identites$region)) {
    stop("Artefact BPE : une commune du snapshot est absente de la base territoriale.",
         call. = FALSE)
  }

  niveaux <- list(
    commune = list(type = "commune", colonne = "commune", suffixe = ""),
    epci = list(type = "epci", colonne = "epci", suffixe = "_epci"),
    departement = list(type = "departement", colonne = "departement", suffixe = "_dep"),
    region = list(type = "region", colonne = "region", suffixe = "_reg")
  )
  modes <- c("c", "b", "t")

  morceaux <- lapply(niveaux, function(niveau) {
    territoire <- identites[[niveau$colonne]]
    if (niveau$type != "commune") {
      territoire[is.na(territoire) | !nzchar(territoire)] <- NA_character_
    }
    lapply(seq_len(nrow(registre)), function(i) {
      code <- registre$TYPEQU[[i]]
      colonnes <- paste0("has_", code, "_", modes,
                         niveau$suffixe, "_raw")
      manquantes <- setdiff(colonnes, names(snapshot))
      if (length(manquantes)) {
        stop("Artefact BPE : colonne(s) manquante(s) pour ", code,
             " au niveau ", niveau$type, " : ",
             paste(manquantes, collapse = ", "), ".", call. = FALSE)
      }
      valeurs <- lapply(colonnes, function(colonne)
        convertir_valeurs_bpe(snapshot[[colonne]], colonne))
      tibble::tibble(
        territoire = territoire,
        type = niveau$type,
        typequ = code,
        c = valeurs[[1L]],
        b = valeurs[[2L]],
        t = valeurs[[3L]]
      )
    }) %>% dplyr::bind_rows()
  }) %>% dplyr::bind_rows()

  morceaux <- morceaux %>%
    dplyr::filter(!is.na(territoire)) %>%
    dplyr::group_by(territoire, type, typequ) %>%
    dplyr::summarise(
      c = {
        if (dplyr::n_distinct(c) != 1L)
          stop("Artefact BPE : valeurs « c » divergentes pour ", typequ[[1L]],
               " sur le territoire ", territoire[[1L]], ".", call. = FALSE)
        c[[1L]]
      },
      b = {
        if (dplyr::n_distinct(b) != 1L)
          stop("Artefact BPE : valeurs « b » divergentes pour ", typequ[[1L]],
               " sur le territoire ", territoire[[1L]], ".", call. = FALSE)
        b[[1L]]
      },
      t = {
        if (dplyr::n_distinct(t) != 1L)
          stop("Artefact BPE : valeurs « t » divergentes pour ", typequ[[1L]],
               " sur le territoire ", territoire[[1L]], ".", call. = FALSE)
        t[[1L]]
      },
      .groups = "drop"
    )

  morceaux$profil <- classifier_profil_acces_bpe(
    morceaux$c, morceaux$b, morceaux$t
  )
  libelles <- stats::setNames(registre$Libelle_TYPEQU, registre$TYPEQU)
  descriptions <- stats::setNames(registre$Description, registre$TYPEQU)
  morceaux %>%
    dplyr::mutate(
      libelle_typequ = unname(libelles[typequ]),
      description_typequ = unname(descriptions[typequ]),
      profil_libelle = unname(PROFILS_ACCES_BPE[profil])
    ) %>%
    dplyr::select(dplyr::all_of(CLES_PROFILS_ACCES_BPE)) %>%
    dplyr::arrange(type, territoire, typequ)
}

# construire_projection_profils_acces_bpe ---------------------------------------
# Projection publique bornée : un compte de types par profil et, si le profil
# est non vide, au plus un exemplaire. L'exemplaire maximise d'abord la saillance
# propre à son profil : t pour l'accès à pied/TC, b - t pour le vélo,
# -max(b, t) pour la voiture, et -max(c, b, t) pour l'inaccessible. L'égalité est
# ensuite résolue par la rareté du profil puis par le code TYPEQU croissant. La
# règle rend la sortie stable et évite de publier 53 lignes par territoire.
construire_projection_profils_acces_bpe <- function(matrice) {
  manquantes <- setdiff(CLES_PROFILS_ACCES_BPE, names(matrice))
  if (length(manquantes)) {
    stop("Projection BPE : colonne(s) manquante(s) dans la matrice : ",
         paste(manquantes, collapse = ", "), ".", call. = FALSE)
  }
  frequences <- matrice %>%
    dplyr::count(typequ, profil, name = "frequence_typequ")
  exemplaires <- matrice %>%
    dplyr::left_join(frequences, by = c("typequ", "profil")) %>%
    dplyr::mutate(
      salience = dplyr::case_when(
        profil == "acces-pied-tc" ~ t,
        profil == "velo-compense" ~ b - t,
        profil == "voiture-requise" ~ -pmax(b, t),
        profil == "inaccessible-20-minutes" ~ -pmax(c, b, t),
        TRUE ~ NA_real_
      )
    ) %>%
    dplyr::arrange(territoire, type, profil, dplyr::desc(salience),
                   frequence_typequ, typequ) %>%
    dplyr::group_by(territoire, type, profil) %>%
    dplyr::slice_head(n = 1L) %>%
    dplyr::ungroup() %>%
    dplyr::transmute(
      territoire, type, profil,
      exemplar_typequ = typequ,
      exemplar_libelle = libelle_typequ,
      exemplar_c = c,
      exemplar_b = b,
      exemplar_t = t
    )

  matrice %>%
    dplyr::count(territoire, type, profil, name = "nombre_typequ") %>%
    dplyr::left_join(
      matrice %>% dplyr::distinct(territoire, type, profil, profil_libelle),
      by = c("territoire", "type", "profil")
    ) %>%
    dplyr::left_join(exemplaires, by = c("territoire", "type", "profil")) %>%
    dplyr::select(dplyr::all_of(CLES_PROJECTION_PROFILS_ACCES_BPE)) %>%
    dplyr::arrange(type, territoire, profil)
}

# verifier_contrat_projection_profils_acces_bpe ----------------------------------
verifier_contrat_projection_profils_acces_bpe <- function(projection) {
  if (!is.data.frame(projection) ||
      !identical(names(projection), CLES_PROJECTION_PROFILS_ACCES_BPE)) {
    stop("Projection BPE invalide — colonnes inattendues.", call. = FALSE)
  }
  if (anyDuplicated(projection[c("territoire", "type", "profil")])) {
    stop("Projection BPE invalide — profil en double pour un territoire.",
         call. = FALSE)
  }
  if (any(projection$nombre_typequ < 1L) ||
      any(!is.finite(projection$nombre_typequ))) {
    stop("Projection BPE invalide — un profil publié doit être non vide.",
         call. = FALSE)
  }
  invisible(projection)
}
