# subventions ------------------------------------------------------------------
# Le module des AGRÉGATS de subventions du payload `programmes` (issue #176,
# ADR-0013) : l'ingestion de l'export SCDL des subventions de la Région
# (subventions_attribuees_scdl0, data.bretagne.bzh — la source documentée dans
# docs/research/programmes-financements.md §5) et le calcul de la table des
# faits subventions. Les lignes d'adhésion aux programmes (ACV/PVD/CRTE/TI/ORT)
# sont le ticket #175 ; la publication du payload PARTAGÉ `programmes` (parquet
# + JSON + vintages) est le ticket #178 — ce module livre la table d'agrégats,
# pas sa sérialisation.
#
# Les règles verrouillées ici (le contrat du PRD #162 et de l'ADR-0013) :
#   - l'ancre est `dossier_commune_insee` (91,9 % de codes valides) — le
#     marqueur officiel « Non disponible » est EXCLU, jamais additionné comme
#     zéro ; un code INSEE invalide (le bruit de qualité de la donnée) est
#     exclu de même ;
#   - le cadrage est l'ANNÉE DE DÉCISION (`dateconvention` — « la date de la
#     convention correspond à la date de décision »), l'année complète la plus
#     récente seulement — annuel, JAMAIS cumulatif (2026 est partielle, 2025
#     est l'année de référence) ;
#   - `montant` est le total DÉCIDÉ par convention (la définition SCDL :
#     « montant total de la subvention attribuée ») — jamais un montant par
#     versement ;
#   - niveau COMMUNE : le total annuel ventilé par domaine (`programme_libl`),
#     avec le garde-fou top-N + « autres » au-delà du seuil (~6 domaines — la
#     médiane des communes-années est à 2 domaines) ;
#   - niveaux EPCI / département / région : un total annuel UNIQUE (une
#     ventilation par domaine y est illisible — médiane 13 domaines par
#     EPCI-année), agrégé depuis les montants attribués des communes membres
#     (JAMAIS une moyenne de parts). Une convention ancrée sur une commune SANS
#     EPCI (les îles, fix « Sans objet » #131) compte quand même dans les
#     totaux de son département et de la région ;
#   - chaque ligne d'agrégat porte l'estampille de fraîcheur HEBDOMADAIRE de la
#     source (le vintage de la table des vintages, jamais un tampon de thème).
#
# Le seam de calcul (construire_analytiques_subventions) enchaîne les builders
# purs : normaliser (l'ancre, l'année, le montant) → la ventilation communale →
# les agrégats par niveau → l'estampillage. Le seam d'entrée du run
# (construire_donnees_subventions) lit le fichier du cache PAR SON id et
# normalise — le même motif que les autres thèmes, testé sur fixtures (jamais
# le réseau dans la boucle de test).

# MARQUEUR_MANQUANT_SUBVENTIONS -------------------------------------------------
# Le marqueur officiel de donnée manquante de l'ancre communale : la chaîne
# littérale « Non disponible » (vérifiée sur l'export réel : 8 179 lignes sur
# les 8 230 sans code valide portent EXACTEMENT cette valeur). Elle est
# EXCLUE de tout agrégat — jamais montrée, jamais additionnée comme zéro (le
# PRD #162, l'ADR-0013).
MARQUEUR_MANQUANT_SUBVENTIONS <- "Non disponible"

# SEUIL_AXES_SUBVENTIONS_COMMUNE ------------------------------------------------
# Le garde-fou de lisibilité de la ventilation communale (PRD #162, user story
# 5) : au-delà de ce nombre de domaines (`programme_libl`), la commune-année
# s'effondre en top-N + « autres ». La médiane des communes-années est à 2
# domaines ; le seuil est verrouillé à 6 — une commune-année à ≤ 6 domaines
# est publiée telle quelle, au-delà seuls les 6 premiers restent nommés.
SEUIL_AXES_SUBVENTIONS_COMMUNE <- 6L

# LIBELLE_AUTRES_SUBVENTIONS ----------------------------------------------------
# Le libellé de la ligne d'effondrement de la ventilation communale — le
# « autres » du garde-fou top-N + « autres » de l'ADR-0013, la somme des
# domaines restés sous le seuil (jamais une valeur inventée : la somme des
# montants attribués des domaines non nommés).
LIBELLE_AUTRES_SUBVENTIONS <- "« autres »"

# LIBELLE_AXE_NON_RENSEIGNE -----------------------------------------------------
# Une convention dont le domaine (`programme_libl`) est vide devient « Non
# renseigné » — la ventilation communale doit TOUJOURS sommer au total annuel
# de la commune : une convention sans domaine n'est jamais perdue de la somme.
LIBELLE_AXE_NON_RENSEIGNE <- "Non renseigné"

# VINTAGE_SUBVENTIONS -----------------------------------------------------------
# Le millésime HEBDOMADAIRE de la source : la date de traitement du jeu
# (data_processed 2026-08-05, vérifiée en recherche — docs/research/
# programmes-financements.md §5). La RÉFÉRENCE est ce que la donnée couvre
# (les décisions traitées jusqu'à cette date) ; la PUBLICATION est la mise en
# ligne du traitement (la même date — le jeu est rafraîchi chaque semaine).
# Le vintage n'est JAMAIS « aujourd'hui » : il est verrouillé au contrat.
VINTAGE_SUBVENTIONS <- "2026-08-05"
DATE_REFERENCE_SUBVENTIONS <- "2026-08-05"
DATE_PUBLICATION_SUBVENTIONS <- "2026-08-05"

# MANIFEST_SUBVENTIONS ----------------------------------------------------------
# Le fragment de manifeste de la source SCDL : UNE ligne, les 11 colonnes
# standard (la même forme que les fragments des autres thèmes, issue #13).
# `url` pointe l'export CSV de l'API data.bretagne.bzh (le délimiteur « ; »,
# les noms de champs bruts — use_labels=false). Mode « cron » : l'export est
# rafraîchi chaque semaine, le run programmé le télécharge comme les autres
# sources cron. Licence Ouverte v2.0 (Etalab). Validé par
# verifier_contrat_subventions.
MANIFEST_SUBVENTIONS <- tibble::tribble(
  ~id, ~source, ~url, ~fichier, ~vintage, ~date_reference,
  ~date_publication, ~licence, ~note, ~mode, ~type,
  "subventions_scdl",
  "Région Bretagne — subventions attribuées (SCDL), subventions_attribuees_scdl0 (data.bretagne.bzh, rafraîchi chaque semaine)",
  "https://data.bretagne.bzh/api/explore/v2.1/catalog/datasets/subventions_attribuees_scdl0/exports/csv?limit=-1&timezone=UTC&use_labels=false&delimiter=%3B",
  "subventions_attribuees_scdl0.csv",
  VINTAGE_SUBVENTIONS,
  DATE_REFERENCE_SUBVENTIONS,
  DATE_PUBLICATION_SUBVENTIONS,
  "lov2",
  paste0(
    "La moitié « subventions » de l'élément Programmes & financements : ",
    "l'export SCDL des subventions de la Région Bretagne (101 131 lignes, ",
    "une ligne = une décision de subvention par bénéficiaire — JAMAIS un ",
    "versement ; `montant` = le total décidé, la définition SCDL). ",
    "Rafraîchi CHAQUE SEMAINE (update_frequency WEEKLY ; data_processed ",
    "2026-08-05, le vintage verrouillé du contrat). L'ancre communale est ",
    "`dossier_commune_insee` (91,9 % de codes valides) — le marqueur ",
    "officiel « Non disponible » est EXCLU, jamais additionné comme zéro. ",
    "Pas de seuil minimal (la Région publie l'intégralité des subventions, ",
    "vs décret n° 2017-779). Licence Ouverte v2.0 (Etalab). Le cadrage est ",
    "l'année de DÉCISION (`dateconvention`), l'année complète la plus ",
    "récente seulement — annuel, jamais cumulatif."
  ),
  "cron", "fichier"
)

# verifier_contrat_subventions --------------------------------------------------
# La validation du contrat du fragment : UNE source, les champs épinglés (id,
# fichier, licence, mode, type), les dates ISO bien formées avec la
# publication jamais antérieure à la référence. Toute violation échoue
# bruyamment en nommant le champ fautif — un manifeste corrompu échoue là où
# il est construit, jamais plus tard dans la machinerie.
verifier_contrat_subventions <- function(manifest) {
  manquer <- function(champ, detail) {
    stop(sprintf("Contrat Subventions violé — %s : %s.", champ, detail),
         call. = FALSE)
  }
  if (!inherits(manifest, "tbl_df")) {
    manquer("forme", "le manifeste doit être un tibble")
  }
  if (nrow(manifest) == 0L) {
    manquer("id", "la source 'subventions_scdl' est absente du manifeste")
  }
  if (nrow(manifest) != 1L) {
    manquer("id", "le contrat épingle UNE source — une seule ligne")
  }
  if (anyDuplicated(manifest$id)) manquer("id", "id dupliqué")
  if (manifest$id != "subventions_scdl") {
    manquer("id", "id attendu : 'subventions_scdl'")
  }
  if (manifest$fichier != "subventions_attribuees_scdl0.csv") {
    manquer("fichier", "fichier de cache attendu : subventions_attribuees_scdl0.csv")
  }
  if (manifest$licence != "lov2") {
    manquer("licence", "licence attendue : 'lov2' (Licence Ouverte v2.0 — Etalab)")
  }
  if (manifest$mode != "cron" || manifest$type != "fichier") {
    manquer("mode/type", "mode 'cron' (l'export est hebdomadaire) et type 'fichier'")
  }
  toutes <- c(manifest$vintage, manifest$date_reference,
              manifest$date_publication)
  if (any(is.na(toutes)) ||
      any(!grepl("^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$", toutes))) {
    manquer("dates", "vintage / date_reference / date_publication manquants ou mal formés")
  }
  if (as.Date(manifest$date_publication) < as.Date(manifest$date_reference)) {
    manquer("date_publication", "la publication doit être postérieure ou égale à la référence")
  }
  invisible(TRUE)
}

# vintages_subventions ----------------------------------------------------------
# Le builder de vintages du module : la projection générique depuis le
# manifeste (vintages_depuis_manifest, vintage.R) — la ligne hebdomadaire de
# la source SCDL.
vintages_subventions <- function() {
  vintages_depuis_manifest(MANIFEST_SUBVENTIONS)
}

# lire_subventions_scdl ---------------------------------------------------------
# Le lecteur de l'export : lit le CSV du cache (délimiteur « ; » — l'export de
# l'API data.bretagne.bzh), TOUTES les colonnes en caractères (la forme brute
# de la source). Le nettoiement — ancre, montant, année — est l'affaire du
# normaliseur, jamais du lecteur.
lire_subventions_scdl <- function(chemin) {
  readr::read_delim(chemin, delim = ";",
                    col_types = readr::cols(.default = readr::col_character()),
                    show_col_types = FALSE)
}

# nettoyer_montant_subventions --------------------------------------------------
# Le montant en numérique : les caractères hors nombre (espaces de groupement
# des milliers, etc.) sont retirés, une valeur vide devient NA (le « 1 empty
# row » documenté de la source). Une valeur non vide et non numérique reste NA
# et la ligne est exclue — jamais additionnée comme zéro.
nettoyer_montant_subventions <- function(x) {
  propre <- gsub("[^0-9.eE+-]", "", as.character(x))
  as.numeric(ifelse(propre == "", NA_character_, propre))
}

# nettoyer_date_subventions -----------------------------------------------------
# La date de convention en Date (le format ISO « AAAA-MM-JJ », les séparateurs
# « / » normalisés) — une valeur illisible devient NA et la ligne est exclue.
nettoyer_date_subventions <- function(x) {
  as.Date(gsub("/", "-", as.character(x)), format = "%Y-%m-%d")
}

# normaliser_subventions_scdl ---------------------------------------------------
# LE normaliseur de l'export : la forme brute de la source → la table des
# conventions (commune | annee | programme_libl | montant). Les règles du
# contrat y sont appliquées :
#   - la forme : les colonnes requises présentes, le fichier non vide — un
#     input corrompu s'arrête ICI, en nommant la colonne fautive (jamais un
#     succès partiel silencieux) ;
#   - l'ancre : seules les communes à code INSEE valide (5 chiffres) — le
#     marqueur « Non disponible » et le bruit sont EXCLUS ;
#   - le montant : numérique, les valeurs vides/illisibles exclues ;
#   - l'année de décision dérivée de `dateconvention`, les dates illisibles
#     exclues ;
#   - le domaine : une valeur vide devient « Non renseigné » (la ventilation
#     communale doit toujours sommer au total annuel de la commune).
normaliser_subventions_scdl <- function(table) {
  requis <- c("dateconvention", "montant", "dossier_commune_insee",
              "programme_libl")
  manquantes <- setdiff(requis, names(table))
  if (length(manquantes) > 0) {
    stop("normaliser_subventions_scdl : colonne(s) requise(s) manquante(s) ",
         "de l'export SCDL : ", paste(manquantes, collapse = ", "), ".",
         call. = FALSE)
  }
  if (nrow(table) == 0L) {
    stop("normaliser_subventions_scdl : l'export SCDL ne porte aucune ligne.",
         call. = FALSE)
  }

  table %>%
    dplyr::mutate(
      montant = nettoyer_montant_subventions(.data$montant),
      annee = as.integer(format(nettoyer_date_subventions(.data$dateconvention),
                                "%Y"))
    ) %>%
    # l'ancre : le marqueur officiel et le bruit sont EXCLUS — jamais montrés,
    # jamais additionnés comme zéro
    dplyr::filter(grepl("^[0-9]{5}$", .data$dossier_commune_insee)) %>%
    dplyr::filter(!is.na(.data$montant)) %>%
    dplyr::filter(!is.na(.data$annee)) %>%
    dplyr::transmute(
      commune = .data$dossier_commune_insee,
      annee = .data$annee,
      programme_libl = dplyr::if_else(
        is.na(.data$programme_libl) | .data$programme_libl == "",
        LIBELLE_AXE_NON_RENSEIGNE, .data$programme_libl),
      montant = .data$montant
    )
}

# construire_donnees_subventions ------------------------------------------------
# L'acte « trouver la donnée » du module : le lecteur lit le fichier du cache
# PAR SON id (le fichier épinglé du manifeste), le normaliseur le nettoie.
# Retourne la liste nommée des conventions normalisées — la forme que le seam
# de calcul consomme et que le ticket #178 assemblera au payload `programmes`.
construire_donnees_subventions <- function(cache = "data/raw") {
  brut <- lire_subventions_scdl(file.path(cache, MANIFEST_SUBVENTIONS$fichier))
  list(conventions = normaliser_subventions_scdl(brut))
}

# annee_reference_subventions ---------------------------------------------------
# La règle du cadrage (PRD #162) : l'ANNÉE DE DÉCISION, l'année COMPLÈTE la
# plus récente seulement — annuel, jamais cumulatif. La dernière année de la
# donnée est, par construction, PARTIELLE (un flux vivant hebdomadaire n'a
# pas fini son année en cours — 2026 s'arrête en juillet dans l'export) :
# l'année complète la plus récente est donc la dernière année de décision
# MOINS UN (2025). Une seule année dans la donnée = partielle par
# construction : aucune année de référence (les agrégats sont vides).
annee_reference_subventions <- function(annees) {
  max(annees) - 1L
}

# calculer_subventions_communes --------------------------------------------------
# La ventilation communale : le total annuel de l'année de référence, par
# domaine (`programme_libl`), avec le garde-fou top-N + « autres »
# (SEUIL_AXES_SUBVENTIONS_COMMUNE). Une commune-année à ≤ 6 domaines est
# publiée telle quelle ; au-delà, les 6 domaines aux montants les plus élevés
# (égalités départagées par le libellé — déterministe) restent nommés et le
# reste s'effondre dans UNE ligne « autres » (la somme des montants restés —
# jamais un zéro, jamais une valeur inventée). Les lignes d'une commune
# somment toujours au total annuel de la commune (la ventilation est exacte).
calculer_subventions_communes <- function(conventions) {
  # `annee_ref` — JAMAIS `annee` : la table porte une colonne `annee` et le
  # masquage de données de dplyr résoudrait le symbole nu à la COLONNE (le
  # filtre deviendrait toujours vrai). Le suffixe `_ref` lève l'ambiguïté.
  annee_ref <- annee_reference_subventions(conventions$annee)
  par_domaine <- conventions %>%
    dplyr::filter(.data$annee == !!annee_ref) %>%
    dplyr::group_by(.data$commune, .data$programme_libl) %>%
    dplyr::summarise(montant = sum(.data$montant), .groups = "drop") %>%
    dplyr::mutate(annee = !!annee_ref)

  # les lignes nommées : toutes les lignes sous le seuil, le top-N (par
  # montant décroissant, libellé pour départager) au-dessus
  lignes <- par_domaine %>%
    dplyr::arrange(.data$commune, dplyr::desc(.data$montant),
                   .data$programme_libl) %>%
    dplyr::group_by(.data$commune) %>%
    dplyr::mutate(n_domaines = dplyr::n()) %>%
    dplyr::filter(.data$n_domaines <= SEUIL_AXES_SUBVENTIONS_COMMUNE |
                    dplyr::row_number() <= SEUIL_AXES_SUBVENTIONS_COMMUNE) %>%
    dplyr::select(-"n_domaines") %>%
    dplyr::ungroup()

  # la ligne « autres » : le reste des communes au-dessus du seuil
  autres <- par_domaine %>%
    dplyr::group_by(.data$commune) %>%
    dplyr::mutate(n_domaines = dplyr::n()) %>%
    dplyr::filter(.data$n_domaines > SEUIL_AXES_SUBVENTIONS_COMMUNE) %>%
    dplyr::ungroup() %>%
    dplyr::anti_join(lignes, by = c("commune", "programme_libl")) %>%
    dplyr::group_by(.data$commune) %>%
    dplyr::summarise(
      annee = dplyr::first(.data$annee),
      programme_libl = LIBELLE_AUTRES_SUBVENTIONS,
      montant = sum(.data$montant),
      .groups = "drop"
    )

  dplyr::bind_rows(lignes, autres) %>%
    dplyr::arrange(.data$commune, .data$programme_libl) %>%
    dplyr::select("commune", "annee", "programme_libl", "montant")
}

# calculer_subventions_agregats --------------------------------------------------
# Les totaux annuels des niveaux EPCI / département / région : UNE ligne par
# niveau (une ventilation par domaine y est illisible — médiane 13 domaines
# par EPCI-année, hors de portée du PRD), agrégés depuis les montants
# attribués des communes membres — la SOMME des parties, jamais une moyenne
# de parts :
#   - EPCI : la somme des communes membres ; une commune sans EPCI (les îles,
#     fix « Sans objet » #131) n'y entre JAMAIS (le filtre explicite) ;
#   - département : la somme des communes du département — une convention
#     ancrée sur une commune SANS EPCI compte dans SON département ;
#   - région : la somme de toutes les communes bretonnes.
# Une commune absente de la base des EPCI (hors Bretagne, ou écart de COG)
# ne peut être attribuée à aucun territoire breton : elle est exclue des trois
# niveaux (l'honnêteté du « attribué à un territoire breton »).
calculer_subventions_agregats <- function(conventions, base_epci) {
  # `annee_ref` — jamais `annee` (le masquage de données de dplyr résoudrait
  # le symbole nu à la colonne `annee` de la table : filtre toujours vrai)
  annee_ref <- annee_reference_subventions(conventions$annee)
  par_commune <- conventions %>%
    dplyr::filter(.data$annee == !!annee_ref) %>%
    dplyr::group_by(.data$commune) %>%
    dplyr::summarise(montant = sum(.data$montant), .groups = "drop")

  if (nrow(par_commune) == 0L) {
    return(tibble::tibble(code = character(), type = character(),
                          annee = integer(), montant = numeric()))
  }

  ctx <- par_commune %>%
    dplyr::left_join(base_epci[c("CODGEO", "EPCI", "DEP")],
                     by = c("commune" = "CODGEO")) %>%
    # seules les communes attribuables à un territoire breton (la base des
    # EPCI est le référentiel breton de lire_epci) contribuent aux totaux
    dplyr::filter(!is.na(.data$DEP))

  dplyr::bind_rows(
    ctx %>%
      dplyr::filter(!is.na(.data$EPCI)) %>%
      dplyr::group_by(code = .data$EPCI) %>%
      dplyr::summarise(type = "epci", annee = !!annee_ref,
                       montant = sum(.data$montant), .groups = "drop"),
    ctx %>%
      dplyr::group_by(code = .data$DEP) %>%
      dplyr::summarise(type = "departement", annee = !!annee_ref,
                       montant = sum(.data$montant), .groups = "drop"),
    ctx %>%
      dplyr::summarise(code = "53", type = "region", annee = !!annee_ref,
                       montant = sum(.data$montant), .groups = "drop")
  ) %>%
    dplyr::arrange(.data$code)
}

# estampiller_subventions -------------------------------------------------------
# L'estampille HEBDOMADAIRE de chaque ligne d'agrégat : le vintage de SA
# source de référence (subventions_scdl — la ligne de la table des vintages),
# jamais un tampon de thème (la discipline de l'issue #9/#74). Une source de
# référence absente des vintages est une erreur en soi : les agrégats ne
# peuvent pas être estampillés — échec fort, en nommant la source.
estampiller_subventions <- function(table, vintages) {
  tampon <- vintages %>%
    dplyr::filter(.data$id == "subventions_scdl")
  if (nrow(tampon) != 1L) {
    stop("construire_analytiques_subventions : la source de référence ",
         "« subventions_scdl » est absente des vintages — les agrégats ne ",
         "peuvent pas être estampillés.", call. = FALSE)
  }
  tampon <- tampon %>%
    dplyr::transmute(
      vintage_source = .data$source,
      vintage_version = .data$version,
      vintage_date_reference = .data$date_reference,
      vintage_date_publication = .data$date_publication
    )
  dplyr::bind_cols(table, tampon)
}

# construire_analytiques_subventions --------------------------------------------
# LE seam de calcul du module : la table d'agrégats complète du payload
# `programmes` (ADR-0013) — les lignes COMMUNALES (la ventilation par domaine,
# top-N + « autres ») + les lignes des niveaux EPCI / département / région
# (le total annuel unique), toutes estampillées du vintage hebdomadaire. La
# forme du contrat : territoire | type | annee | programme_libl | montant |
# les quatre colonnes d'estampille. `conventions` est la table normalisée
# (construire_donnees_subventions), `base_epci` le référentiel partagé (la
# forme de lire_epci), `vintages` la table des vintages du run. Déterministe :
# trié par type puis code puis domaine.
# La discipline de l'honnêteté « attribué à un territoire breton » (le même
# filtre que les totaux, calculer_subventions_agregats) : une commune absente
# de la base bretonne des EPCI — hors Bretagne (l'export SCDL porte des
# bénéficiaires de toute la France), ou écart de COG — ne peut être attribuée
# à AUCUN territoire breton. La ventilation communale est donc limitée aux
# communes du référentiel : le payload ne porte JAMAIS une ligne pour un
# territoire inconnu de l'app (le contrat « chaque ligne = un territoire du
# référentiel » que valide l'app, issue #179).
construire_analytiques_subventions <- function(conventions, base_epci,
                                               vintages) {
  communales <- calculer_subventions_communes(conventions) %>%
    dplyr::semi_join(base_epci, by = c("commune" = "CODGEO")) %>%
    dplyr::mutate(type = "commune", territoire = .data$commune) %>%
    dplyr::select(-"commune")

  agregats <- calculer_subventions_agregats(conventions, base_epci) %>%
    dplyr::rename(territoire = "code") %>%
    dplyr::mutate(programme_libl = NA_character_)

  table <- dplyr::bind_rows(communales, agregats) %>%
    dplyr::select("territoire", "type", "annee", "programme_libl", "montant") %>%
    dplyr::arrange(.data$type, .data$territoire, .data$programme_libl)

  estampiller_subventions(table, vintages)
}
