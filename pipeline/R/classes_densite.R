# classes_densite -------------------------------------------------------------
# Référentiel autoritaire de la Classe de densité communale (ADR-0030). La
# pipeline publie le code, le libellé INSEE exact et le libellé grammatical de
# portée ; l'app ne reconstruit jamais cette correspondance.

CLASSES_DENSITE_FICHIER <- "grille_densite_communale_2025.xlsx"

MANIFEST_CLASSES_DENSITE <- tibble::tribble(
  ~id, ~source, ~url, ~fichier, ~vintage, ~date_reference, ~date_publication,
  ~licence, ~sha256, ~note, ~mode, ~type,
  "classe_densite_communale",
  "INSEE — Grille de densité 2025, maille communale",
  "https://www.insee.fr/fr/statistiques/fichier/8571524/fichier_diffusion_2026.xlsx",
  CLASSES_DENSITE_FICHIER,
  "Grille de densité 2025 — géographie communale au 01/01/2026",
  "2021-01-01",
  "2026-05-15",
  "lov2",
  "8ebf3011743db45ab94c4ffb74d1bcb06929f0076ecd5b8247011bca861ca978",
  "Feuille Maille communale : CODGEO, DENS7, LIBDENS7",
  "cron",
  "fichier"
)

registre_classes_densite <- function() {
  tibble::tribble(
    ~classe_densite_code, ~classe_densite_libelle_insee, ~classe_densite_libelle_public,
    "1", "Grands centres urbains", "grands centres urbains bretons",
    "2", "Centres urbains intermédiaires", "centres urbains intermédiaires bretons",
    "3", "Petites villes", "petites villes bretonnes",
    "4", "Ceintures urbaines", "ceintures urbaines bretonnes",
    "5", "Bourgs ruraux", "bourgs ruraux bretons",
    "6", "Rural à habitat dispersé", "communes rurales à habitat dispersé en Bretagne",
    "7", "Rural à habitat très dispersé", "communes rurales à habitat très dispersé en Bretagne"
  )
}

lire_classes_densite <- function(chemin) {
  if (!file.exists(chemin)) {
    stop("Grille de densité communale introuvable : ", chemin, call. = FALSE)
  }
  classes <- readxl::read_excel(
    chemin,
    sheet = "Maille communale",
    skip = 4,
    col_types = "text"
  )
  requis <- c("CODGEO", "DENS7", "LIBDENS7")
  manquants <- setdiff(requis, names(classes))
  if (length(manquants) > 0L) {
    stop(
      "Grille de densité communale invalide : colonne(s) absente(s) : ",
      paste(manquants, collapse = ", "), ".",
      call. = FALSE
    )
  }
  classes %>% dplyr::select(dplyr::all_of(requis))
}

metadata_classes_densite <- function() {
  registre <- registre_classes_densite()
  classes <- lapply(seq_len(nrow(registre)), function(i) {
    list(
      code = registre$classe_densite_code[[i]],
      libelle_insee = registre$classe_densite_libelle_insee[[i]],
      libelle_public = registre$classe_densite_libelle_public[[i]]
    )
  })
  names(classes) <- registre$classe_densite_code
  list(
    schema_version = "1",
    source_records = list(
      classe_densite_communale = list(
        dataset = "Grille de densité 2025 — maille communale",
        publisher = "INSEE",
        url = MANIFEST_CLASSES_DENSITE$url[[1L]],
        licence = "Licence Ouverte 2.0",
        sha256 = MANIFEST_CLASSES_DENSITE$sha256[[1L]],
        vintage = "Classification 2025 · géographie communale au 01/01/2026 · RP 2021",
        freshness = "Publication INSEE du 15 mai 2026",
        vintages = list(list(
          id = "classe_densite_communale",
          label = "Grille de densité communale 2025",
          version = "Classification 2025 · géographie communale au 01/01/2026 · RP 2021",
          licence = "Licence Ouverte 2.0",
          dateReference = "2021-01-01",
          datePublication = "2026-05-15"
        )),
        caveat = "La classe de densité communale est une classification officielle fondée sur le nombre et la concentration spatiale des habitants."
      )
    ),
    territory_reference_label = "Référentiel territorial — classes de densité communale",
    density_classes = classes
  )
}

publier_classes_densite <- function(territoires, classes) {
  cle_territoire <- if ("territoire" %in% names(territoires)) {
    "territoire"
  } else if ("code" %in% names(territoires)) {
    "code"
  } else {
    stop("Territoires invalides : aucune clé code/territoire.", call. = FALSE)
  }
  requis <- c("CODGEO", "DENS7", "LIBDENS7")
  manquants <- setdiff(requis, names(classes))
  if (length(manquants) > 0L) {
    stop(
      "Grille de densité communale invalide : colonne(s) absente(s) : ",
      paste(manquants, collapse = ", "), ".",
      call. = FALSE
    )
  }
  if (anyDuplicated(classes$CODGEO)) {
    doublons <- unique(classes$CODGEO[duplicated(classes$CODGEO)])
    stop(
      "Classe de densité invalide : jointure communale ambiguë pour ",
      paste(doublons, collapse = ", "), ".",
      call. = FALSE
    )
  }
  rattachements <- classes %>%
    dplyr::transmute(
      cle = as.character(CODGEO),
      classe_densite_code = as.character(DENS7),
      classe_densite_libelle_insee = as.character(LIBDENS7)
    ) %>%
    dplyr::left_join(registre_classes_densite(), by = c(
      "classe_densite_code",
      "classe_densite_libelle_insee"
    ))

  publies <- territoires %>%
    dplyr::left_join(rattachements, by = setNames("cle", cle_territoire))
  inconnues <- publies[[cle_territoire]][
    publies$type == "commune" &
      !is.na(publies$classe_densite_code) &
      is.na(publies$classe_densite_libelle_public)
  ]
  if (length(inconnues) > 0L) {
    stop(
      "Classe de densité invalide : code ou libellé de classe inconnu pour la/les commune(s) ",
      paste(inconnues, collapse = ", "), ".",
      call. = FALSE
    )
  }
  sans_classe <- publies[[cle_territoire]][
    publies$type == "commune" & is.na(publies$classe_densite_code)
  ]
  if (length(sans_classe) > 0L) {
    stop(
      "Classe de densité invalide : commune(s) ",
      paste(sans_classe, collapse = ", "),
      " sans classe de densité.",
      call. = FALSE
    )
  }
  non_communes <- publies$type != "commune"
  publies[non_communes, c(
    "classe_densite_code",
    "classe_densite_libelle_insee",
    "classe_densite_libelle_public"
  )] <- NA_character_
  publies
}
