# analytics_economie_territoires ------------------------------------------------
# L'agrégation du payload Économie aux niveaux EPCI / département / région
# (issue #131, décisions verrouillées 2026-08-06 — CONTEXT.md « Taille » et
# « Rang »). Les tables analytiques T1-T5 sont COMMUNALES : ce module les
# propage aux quatre niveaux de territoire (commune / EPCI / département /
# région) en appliquant LES RÈGLES D'AGRÉGATION décidées — jamais une moyenne
# de parts communales :
#
#   - `effectifs_salaries` (la « Taille ») : le total effectifs salariés au
#     lieu de travail (Flores A88 — l'agrégation du dortoir) SOMMÉ par niveau ;
#   - `chomage` (santé) : le taux d'un agrégat est RECALCULÉ depuis les parties
#     — Σ chômeurs ÷ Σ population active, jamais la moyenne des taux ;
#   - `eco_activites` (verdure) : Σ établissements verts ÷ Σ établissements,
#     jamais la moyenne des parts ;
#   - la LQ des agrégats est recalée à RÉFÉRENCE MÊME-ÉCHELLE (un EPCI vs les
#     autres EPCIs, un département vs les autres départements — jamais vs la
#     moyenne bretonne des communes) : la matière des histoires.
# Les communes SANS EPCI (les trois îles bretonnes — fix « Sans objet »,
# issue #131) n'agrègent à AUCUN niveau EPCI : elles vivent commune /
# département / région. Aucun artefact de fiche ici : ce module nourrit
# l'assemblage du payload (theme_economie.R), la publication reste celle de
# T8. Les tests (test-analytics-economie-territoires.R) sont le seam.

# decliner_aux_niveaux ---------------------------------------------------------
# La mécanique partagée des trois indicateurs : la table communale (avec une
# colonne `commune`) est jointe à son EPCI / département (la base partagée
# lire_epci), puis déclinée aux QUATRE niveaux — la commune telle quelle, son
# EPCI (les communes membres, JAMAIS les sans-EPCI), son département, la
# région. `mesures` nomme les colonnes SOMMÉES par niveau d'agrégat (les
# numérateurs des taux : effectifs, chômeurs + actifs, verts + établissements
# — les agrégats RECALCULENT, ils ne moyennent jamais une part). Une cellule
# NA reste NA dans la somme (un niveau dont une partie est inconnue est
# inconnu — jamais un total partiel inventé).
decliner_aux_niveaux <- function(table, base_epci, mesures) {
  ctx <- table %>%
    dplyr::left_join(base_epci[c("CODGEO", "EPCI", "DEP")],
                     by = c("commune" = "CODGEO"))

  dplyr::bind_rows(
    # commune : la valeur communale telle quelle
    ctx %>%
      dplyr::select(dplyr::all_of(c("commune", mesures))) %>%
      dplyr::rename(code = commune),
    # EPCI : la somme des communes membres — les sans-EPCI (les îles) n'y
    # entrent jamais (fix « Sans objet »)
    ctx %>%
      dplyr::filter(!is.na(EPCI)) %>%
      dplyr::group_by(code = EPCI) %>%
      dplyr::summarise(dplyr::across(dplyr::all_of(mesures), sum),
                       .groups = "drop"),
    # département : la somme des communes du département
    ctx %>%
      dplyr::group_by(code = DEP) %>%
      dplyr::summarise(dplyr::across(dplyr::all_of(mesures), sum),
                       .groups = "drop"),
    # région : la somme de toutes les communes
    ctx %>%
      dplyr::summarise(code = "53",
                       dplyr::across(dplyr::all_of(mesures), sum),
                       .groups = "drop")
  )
}

# agreger_effectifs_territoires -------------------------------------------------
# La « Taille » (issue #131) : le total effectifs salariés au lieu de travail
# par niveau — les communes portent leur propre effectif, les agrégats la
# SOMME (jamais une moyenne). L'entrée est la table (commune,
# effectifs_salaries) de l'agrégation du dortoir (agreger_effectifs_travail,
# ressuscitée) : une commune avec une cellule non diffusée (statut K) porte
# une somme NA — un niveau qui la contient est NA, jamais un total partiel.
# Déterministe : trié par code.
agreger_effectifs_territoires <- function(effectifs, base_epci) {
  decliner_aux_niveaux(effectifs, base_epci, "effectifs_salaries") %>%
    dplyr::rename(value = effectifs_salaries) %>%
    dplyr::arrange(code)
}

# agreger_chomage_territoires ---------------------------------------------------
# Le chômage par niveau : les numérateurs (chômeurs, population active) sont
# SOMMÉS par niveau, le taux est RECALCULÉ (Σ chômeurs ÷ Σ actifs) — jamais la
# moyenne des taux communaux. Un niveau dont une commune manque un numérateur
# (NA) est NA : la règle du « jamais un zéro inventé » du taux communal, au
# niveau agrégé. Déterministe : trié par code.
agreger_chomage_territoires <- function(chomage, base_epci) {
  decliner_aux_niveaux(chomage, base_epci, c("chomeurs", "population_active")) %>%
    dplyr::mutate(
      value = dplyr::if_else(
        !is.na(.data$chomeurs) &
          !is.na(.data$population_active) & .data$population_active > 0,
        .data$chomeurs / .data$population_active,
        NA_real_
      )
    ) %>%
    dplyr::select(code, value) %>%
    dplyr::arrange(code)
}

# agreger_eco_territoires -------------------------------------------------------
# La part des éco-activités par niveau : Σ établissements verts ÷ Σ
# établissements (les numérateurs de la table green, T3) — jamais la moyenne
# des parts communales. Déterministe : trié par code.
agreger_eco_territoires <- function(eco, base_epci) {
  decliner_aux_niveaux(eco, base_epci, c("n_eco", "n_etablissements")) %>%
    dplyr::mutate(
      value = dplyr::if_else(
        !is.na(.data$n_etablissements) & .data$n_etablissements > 0,
        .data$n_eco / .data$n_etablissements,
        NA_real_
      )
    ) %>%
    dplyr::select(code, value) %>%
    dplyr::arrange(code)
}

# histoires_lq_niveau ----------------------------------------------------------
# La mécanique PARTAGÉE des niveaux agrégés de « ce que la commune abrite » :
# les cellules communales retenues sont agrégées au niveau (`cle` : EPCI ou
# DEP — les communes sans EPCI, les îles, n'entrent dans AUCUN EPCI), la LQ
# est recalée à RÉFÉRENCE MÊME-ÉCHELLE (calculer_lq_par_niveau), puis le top-N
# déterministe (LQ décroissante, code APE croissant — ADR-0002) avec `n`
# conservé. Retourne les lignes du payload (type porté par l'appelant).
histoires_lq_niveau <- function(lq, base_epci, cle, type, top_n) {
  lq %>%
    dplyr::left_join(base_epci[c("CODGEO", cle)], by = c("commune" = "CODGEO")) %>%
    dplyr::filter(!is.na(.data[[cle]])) %>%
    dplyr::group_by(.data[[cle]], activity_code) %>%
    dplyr::summarise(
      activity_label = premier_libelle(activity_label),
      n = sum(n),
      .groups = "drop"
    ) %>%
    calculer_lq_par_niveau(cle) %>%
    dplyr::group_by(.data[[cle]]) %>%
    dplyr::arrange(dplyr::desc(lq), activity_code, .by_group = TRUE) %>%
    dplyr::slice_head(n = top_n) %>%
    dplyr::mutate(rang = dplyr::row_number()) %>%
    dplyr::ungroup() %>%
    dplyr::transmute(
      territoire = .data[[cle]], type = type,
      story_key = "ce-que-la-commune-abrite",
      rang, activity_code, activity_label, lq, n,
      part_parc = NA_real_
    )
}

# construire_histoires_economie_payload ----------------------------------------
# Les lignes d'Histoire du payload Économie (issue #131) — MULTI-LIGNES par
# territoire :
#   - « ce que la commune abrite » : le top-N des spécialisations par LQ
#     (rang / activity_code / activity_label / lq / n — `n` conservé), pour
#     les COMMUNES (vs la moyenne bretonne, gate E), les EPCIs et les
#     DÉPARTEMENTS (LQ recalée à référence MÊME-ÉCHELLE — un EPCI vs les
#     autres EPCIs, jamais vs la moyenne bretonne des communes).
# Issue #370 : la lecture régionale « ce que la Bretagne abrite » est RETIRÉE
# de la fiche (le sous-groupe structure-verte ne déclare plus de lecture) — la
# région (53) ne porte plus AUCUNE ligne d'Histoire Économie : son onglet rend
# les indicateurs du bloc seuls (la LQ régionale est dégénérée, tous les
# ratios ≡ 1). `calculer_presence_bretagne` reste un artefact analytique
# (data/processed/economie — la matière de la structure régionale), jamais une
# ligne de payload.
# Sélection déterministe (ADR-0002) partout : LQ (ou n) décroissante, puis
# code APE croissant. Une commune / EPCI / département avec moins de top_n
# activités reçoit toutes ses activités (jamais de padding). Le type de
# territoire est porté par les lignes (la forme du contrat histoires).
construire_histoires_economie_payload <- function(lq, base_epci,
                                                  top_n = TOP_N_SPECIALISATIONS_LQ) {
  # niveau commune : l'Histoire existante (la LQ vs la Bretagne, gate E)
  communes <- calculer_histoires_lq(lq, top_n = top_n) %>%
    dplyr::transmute(
      territoire = commune, type = "commune",
      story_key = "ce-que-la-commune-abrite",
      rang, activity_code, activity_label, lq, n,
      part_parc = NA_real_
    )

  # niveaux EPCI et département : la même mécanique (les îles n'entrent dans
  # AUCUN EPCI ; la LQ de chaque niveau est à référence même-échelle)
  epcis <- histoires_lq_niveau(lq, base_epci, "EPCI", "epci", top_n)
  deps <- histoires_lq_niveau(lq, base_epci, "DEP", "departement", top_n)

  dplyr::bind_rows(communes, epcis, deps) %>%
    dplyr::arrange(territoire, story_key, rang)
}

# replier_top5_en_lecture -------------------------------------------------------
# Issue #312 (parent #308) : une lecture RÉSOLUE par (territoire, groupe) — le
# top-5 de « ce que la commune abrite » / « ce que la Bretagne abrite » devient
# la MATIÈRE d'UNE SEULE ligne, en paramètres plats (top1_*..top5_* : code,
# label, LQ, n, part du parc — les champs null selon la lecture, le LQ pour la
# spécialisation, la part du parc pour la structure régionale). Le rang est
# porté par l'index (top1 = rang 1, jamais une colonne de plus) ; un territoire
# à moins de top_n activités garde ses seules activités réelles (jamais de
# padding — les colonnes au-delà restent NA). L'identité (territoire × groupe)
# est UNIQUE : le payload ne porte jamais les lignes du top-5 comme autant de
# lectures, il porte la lecture et sa matière.
replier_top5_en_lecture <- function(histoires_longues, top_n = 5L) {
  if (nrow(histoires_longues) == 0L) {
    return(histoires_longues)
  }
  rangees <- histoires_longues %>%
    dplyr::group_by(territoire, story_key) %>%
    dplyr::arrange(rang, activity_code, .by_group = TRUE) %>%
    dplyr::mutate(k = dplyr::row_number()) %>%
    dplyr::ungroup()

  base <- unique(rangees[c("territoire", "type", "story_key")])
  for (k in seq_len(top_n)) {
    bloc <- rangees[rangees$k == k, c("territoire", "story_key",
                                      "activity_code", "activity_label",
                                      "lq", "n", "part_parc")]
    names(bloc)[3:7] <- paste0("top", k, "_", c("activity_code", "activity_label",
                                                "lq", "n", "part_parc"))
    base <- dplyr::left_join(base, bloc, by = c("territoire", "story_key"))
  }
  base %>%
    dplyr::arrange(territoire, story_key)
}

# construire_territoires_agregats_economie --------------------------------------
# L'acte « calculer » du module : les tables communales des T1-T5 (effectifs,
# éco, chômage, LQ) + la base des EPCI → les tables agrégées du payload (les
# trois indicateurs aux quatre niveaux + les lignes d'Histoire). C'est LE seam
# que le chaînon analytique (construire_analytiques_economie, T8) appelle —
# les tests de publication le mockent comme les builders T1-T5. Retourne la
# liste {effectifs, chomage, eco, histoires} — la forme de test.
construire_territoires_agregats_economie <- function(effectifs, eco, chomage, lq,
                                                     base_epci) {
  list(
    effectifs = agreger_effectifs_territoires(effectifs, base_epci),
    chomage = agreger_chomage_territoires(chomage, base_epci),
    eco = agreger_eco_territoires(eco, base_epci),
    histoires = construire_histoires_economie_payload(lq, base_epci)
  )
}
