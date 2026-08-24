# theme_programmes_faits --------------------------------------------------------
# Les faits du SIXIÈME thème (issue #408) : Programmes et subventions cesse
# d'être un simple contrat de publication partagé (ADR-0013) et publie SA
# paire hermétique — indicateurs_programmes.json + histoires_programmes.json —
# à côté du fichier partagé programmes.json (qui reste la table cross-thème
# de la carte et des Méthodes jusqu'à la bascule #410 ; ADR-0020 l'autorise).
#
# Trois clés d'indicateurs, les DEUX natures de faits du thème (CONTEXT.md
# §Programmes et subventions — le périmètre verrouillé 2026-08-06) :
#   - couverture_programmes (CATÉGORIEL) : une ligne par adhésion au niveau
#     d'ANCRAGE du programme (ACV/PVD communes, CRTE/TI EPCIs, ORT aux deux),
#     detail = le sigle, value = 1, unit = « adhésion » ; le rider « convention
#     valant ORT » voyage sur la ligne du label qui le porte (jamais un second
#     badge), et chaque ligne garde l'estampille de SA source — les lignes ORT
#     portent leur actualisation par ligne SANS date de publication (le contrat
#     manifeste #175 : la page périmée n'est jamais citée ; l'app accepte une
#     date de référence sans publication, le miroir exact de la base roulante
#     DPE d'ADR-0009) ;
#   - subventions_annuelles (NUMÉRIQUE) : le total annuel poolé par territoire
#     pour SON année de référence (la plus récente présente — la règle du
#     sélecteur #305, désormais calculée côté pipeline : « the app renders,
#     the pipeline computes ») — detail null, dimension = l'année, unit « € » ;
#   - subventions_par_domaine (NUMÉRIQUE multi-détails) : la ventilation
#     communale COMPLÈTE par domaine (ADR-0013 amendé #305 — chaque domaine,
#     jamais de ligne « autres »), detail = programme_libl, dimension = année.
#
# Les gardes : le total poolé d'une commune ÉGALERA toujours la somme de ses
# domaines (vérifié ici, bruyamment), un territoire ne porte jamais deux lignes
# de la même clé/détail/année, et AUCUN rang n'est calculé — les faits
# d'action publique (adhésions, montants attribués) ne sont pas un classement
# de désirabilité ; l'élément de fiche n'en a jamais porté (ADR-0015 : les
# rangs sont le fait des indicateurs de tension, pas des badges).
#
# Ce qui N'y vit PAS : la dérivation EN ÉCHELLE des voix (lauréate / couverte /
# porte / compte / ort) reste une jointure relationnelle APP-SIDE sur le
# référentiel territoires (ADR-0013 — « les jointures sont l'affaire de
# l'app ») ; le builder publie les ancrages, l'app nomme.

# CLE_PROGRAMME_COUVERTURE / CLES_PROGRAMMES_SUBVENTIONS ------------------------
# Les trois clés du registre du thème (#408) — déclarées UNE fois, le miroir
# des indicator_keys du canon épinglé (theme_programmes.json).
CLE_PROGRAMME_COUVERTURE <- "couverture_programmes"
CLES_PROGRAMMES_SUBVENTIONS <- c("subventions_annuelles", "subventions_par_domaine")

# INDICATEURS_PROGRAMMES --------------------------------------------------------
# La table déclarative du thème (le même contrat que INDICATEURS_<THEME> des
# cinq autres) : la vocabulaire officielle (la colonne `libelle` est LA source
# de vérité que la parité test-parite-libelles croise avec le canon épinglé),
# les sources de chaque clé et SA source de référence. `multiplicite` vaut NA
# pour les deux clés à présence VARIABLE (une adhésion est un fait, jamais un
# étage complet : tous les territoires ne portent pas les cinq sigles, ni le
# même nombre de domaines) ; le total annuel, lui, est unique par territoire
# et par année de référence. Le thème ne passe PAS par compute_payload (son
# seam publie directement) : la table est déclarative, la validation des faits
# vit dans construire_indicateurs_programmes.
INDICATEURS_PROGRAMMES <- tibble::tibble(
  key = c(CLE_PROGRAMME_COUVERTURE, CLES_PROGRAMMES_SUBVENTIONS),
  libelle = c(
    "Couverture programmatique",
    "Subventions régionales attribuées (année de référence)",
    "Subventions régionales par domaine"
  ),
  sources = list(
    c("acv", "pvd", "crte", "territoires_industrie", "ort"),
    "subventions_scdl",
    "subventions_scdl"
  ),
  source_reference = c("acv", "subventions_scdl", "subventions_scdl"),
  multiplicite = c(NA_integer_, NA_integer_, NA_integer_)
)

# construire_indicateurs_programmes ---------------------------------------------
# Le builder des faits du thème : les tables normalisées EN MÉMOIRE du seam
# (membres + subventions — les mêmes tables que ecrire_programmes_partage
# projette) en entrée, la table d'indicateurs du contrat en sortie. Une table
# vide produit une table vide — l'absence honnête (le thème n'est pas
# construit, jamais un zéro inventé).
construire_indicateurs_programmes <- function(membres, subventions) {
  manquer <- function(champ, detail) {
    stop(sprintf("Faits du thème Programmes invalides — %s : %s.", champ, detail),
         call. = FALSE)
  }

  # ---- couverture_programmes : les adhésions au niveau d'ancrage ----------
  # (le pipeline dplyr gère la table vide : zéro ligne en sortie, les colonnes
  # du contrat)
  couverture <- membres %>%
    dplyr::transmute(
        territoire = territoire,
        type = type,
        theme = "programmes",
        key = CLE_PROGRAMME_COUVERTURE,
        detail = sigle,
        sex = NA_character_,
        dimension = NA_character_,
        value = 1,
        unit = "adhésion",
        rider = dplyr::if_else(convention_valant_ort, "convention valant ORT", NA_character_),
        rang_epci = NA_real_,
        rang_epci_n = NA_real_,
        rang_dep = NA_real_,
        rang_dep_n = NA_real_,
        rang_reg = NA_real_,
        rang_reg_n = NA_real_,
        vintage_source = vintage_source,
        vintage_version = vintage_version,
        vintage_date_reference = vintage_date_reference,
        vintage_date_publication = vintage_date_publication
      )

  # ---- subventions : le total poolé + la ventilation communale complète ---
  if (nrow(subventions) > 0L &&
      any(subventions$type != "commune" & !is.na(subventions$programme_libl))) {
    manquer("forme", "une ligne d'agrégat (EPCI/département/région) porte un domaine")
  }

  # L'année de référence PAR TERRITOIRE (la plus récente présente — jamais un
  # mélange de millésimes dans un total, la règle #305 déplacée côté pipeline).
  # La table vide court-circuite le calcul : jamais un « max » sur rien.
  annees_reference <- if (nrow(subventions) == 0L) {
    tibble::tibble(territoire = character(), annee = numeric())
  } else {
    subventions %>%
      dplyr::group_by(territoire) %>%
      dplyr::summarise(annee = max(annee), .groups = "drop")
  }

  annuelles <- subventions %>%
    dplyr::inner_join(annees_reference, by = "territoire", suffix = c("", "_ref")) %>%
    dplyr::filter(annee == annee_ref) %>%
    dplyr::group_by(territoire, type, annee) %>%
    dplyr::summarise(montant = sum(montant), .groups = "drop") %>%
    dplyr::transmute(
      territoire = territoire,
      type = type,
      theme = "programmes",
      key = "subventions_annuelles",
      detail = NA_character_,
      sex = NA_character_,
      dimension = as.character(annee),
      value = montant,
      unit = "€",
      rider = NA_character_,
      rang_epci = NA_real_,
      rang_epci_n = NA_real_,
      rang_dep = NA_real_,
      rang_dep_n = NA_real_,
      rang_reg = NA_real_,
      rang_reg_n = NA_real_,
      # l'estampille hebdomadaire SCDL — identique sur toutes les lignes du
      # jeu (la même que la ventilation ci-dessous porte)
      vintage_source = subventions$vintage_source[1L],
      vintage_version = subventions$vintage_version[1L],
      vintage_date_reference = subventions$vintage_date_reference[1L],
      vintage_date_publication = subventions$vintage_date_publication[1L]
    )

  domaines <- subventions %>%
    dplyr::filter(type == "commune") %>%
    dplyr::transmute(
      territoire = territoire,
      type = type,
      theme = "programmes",
      key = "subventions_par_domaine",
      detail = programme_libl,
      sex = NA_character_,
      dimension = as.character(annee),
      value = montant,
      unit = "€",
      rider = NA_character_,
      rang_epci = NA_real_,
      rang_epci_n = NA_real_,
      rang_dep = NA_real_,
      rang_dep_n = NA_real_,
      rang_reg = NA_real_,
      rang_reg_n = NA_real_,
      vintage_source = vintage_source,
      vintage_version = vintage_version,
      vintage_date_reference = vintage_date_reference,
      vintage_date_publication = vintage_date_publication
    )

  ind <- dplyr::bind_rows(couverture, annuelles, domaines)

  # ---- les gardes du contrat ----------------------------------------------
  if (nrow(ind) > 0L) {
    # unicité (territoire × key × detail × dimension) — le contrat de l'app
    # (validate.ts, la clé d'unicité du payload)
    doublons <- ind %>%
      dplyr::count(territoire, key, detail, dimension) %>%
      dplyr::filter(n > 1L)
    if (nrow(doublons) > 0L) {
      manquer("doublons", paste0(
        "ligne(s) en double (territoire × key × detail × dimension) : ",
        paste(doublons$territoire, doublons$key, coalesce_na(doublons$detail),
              coalesce_na(doublons$dimension), sep = "·", collapse = ", ")))
    }
    # le total poolé égale la somme des domaines (par commune, par année)
    controle <- annuelles %>%
      dplyr::filter(type == "commune") %>%
      dplyr::left_join(
        domaines %>%
          dplyr::group_by(territoire, dimension) %>%
          dplyr::summarise(somme = sum(value), .groups = "drop"),
        by = c("territoire", "dimension")
      ) %>%
      dplyr::mutate(ecart = abs(value - dplyr::coalesce(somme, 0)))
    if (any(controle$ecart > 1e-6)) {
      pires <- controle %>% dplyr::filter(ecart > 1e-6)
      manquer("cohérence", paste0(
        "le total poolé ne correspond pas à la somme des domaines pour : ",
        paste(pires$territoire, pires$dimension, sep = " · ", collapse = ", ")))
    }
    # les lignes ORT gardent leur actualisation comme référence et AUCUNE
    # date de publication (le contrat #175) — jamais une date inventée
    ort <- couverture %>% dplyr::filter(detail == "ORT")
    if (nrow(ort) > 0L &&
        (any(is.na(ort$vintage_date_reference)) ||
         any(!is.na(ort$vintage_date_publication)))) {
      manquer("vintage", "une ligne ORT sans actualisation par ligne ou avec une date de publication inventée")
    }
    # les deux horloges du tampon (#408 — le miroir de l'app, TOUTE ligne
    # publiée : le seam ne passe PAS par validate_payload, la règle vient à
    # lui — au moins une des deux dates existe, sinon l'app refuserait au
    # chargement ce que le pipeline aurait publié)
    verifier_horloges_vintage(ind)
  }

  # l'ordre déterministe du fichier publié (les projections sont stables)
  ind %>%
    dplyr::arrange(key, type, territoire, dimension, detail) %>%
    dplyr::select(territoire, type, theme, key, detail, sex, dimension, value,
                  unit, rider, rang_epci, rang_epci_n, rang_dep, rang_dep_n,
                  rang_reg, rang_reg_n, vintage_source, vintage_version,
                  vintage_date_reference, vintage_date_publication)
}

# coalesce_na -------------------------------------------------------------------
# L'étiquette « ∅ » d'un détail/année NA dans un message d'erreur (jamais « NA »
# cru dans une phrase destinée au diagnostic).
coalesce_na <- function(x) {
  ifelse(is.na(x), "∅", x)
}

# ecrire_theme_programmes -------------------------------------------------------
# La publication de la PAIRE hermétique du thème (#408, le précédent apercu
# #116 — le contrat « 404 = thème absent ») :
#   - indicateurs_programmes.json : la projection JSON des faits ;
#   - histoires_programmes.json : le tableau VIDE — le thème sans lecture
#     (le loader exige la présence de la paire dès que les faits existent) ;
#   - la sentinelle : zéro fait → RIEN n'est écrit (un run vide n'invente pas
#     un thème construit, n'écrase jamais une publication existante).
ecrire_theme_programmes <- function(indicateurs, sortie = "public/data") {
  if (nrow(indicateurs) == 0L) {
    return(invisible(indicateurs))
  }
  if (!dir.exists(sortie)) dir.create(sortie, recursive = TRUE)
  jsonlite::write_json(
    indicateurs,
    file.path(sortie, "indicateurs_programmes.json"),
    dataframe = "rows", na = "null", digits = 17, pretty = TRUE
  )
  jsonlite::write_json(
    list(),
    file.path(sortie, "histoires_programmes.json"),
    dataframe = "rows", na = "null", digits = 17, pretty = TRUE, auto_unbox = TRUE
  )
  invisible(indicateurs)
}
