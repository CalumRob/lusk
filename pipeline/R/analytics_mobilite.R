# analytics_mobilite -----------------------------------------------------------
# Le chaînon analytique flagship du thème Mobilité (issue #138) : les builders
# PURS des artefacts — la neutralité modale (la garde de base), les 5 parts
# d'isolation (recalculées depuis les parties, jamais une moyenne de parts),
# div_loss_t/b (la garde appliquée d'abord), la signature de densité + le
# nuage même-échelle (les quelques nombres précalculés par territoire, jamais
# la matrice — leçon de l'issue #131), la classification de saillance (seuils
# verrouillés sur la distribution réelle) et les rangs-en-contexte (la
# machinerie partagée compute_ranks, compute.R). Le seam
# construire_analytiques_mobilite (theme_mobilite.R) les enchaîne et les
# persiste sous data/processed/mobilite/.
#
# Le vocabulaire (CONTEXT.md, ADR-0012) : « Part des bâtiments isolés »
# (1 − share_*, la grille), « Perte de diversité » (div_loss — le Story),
# « Vingt minutes sans voiture » (le Story par défaut), « Ce que le vélo
# préserve » (le delta, saillance). Les libellés disent « à pied ou en
# transports en commun » — jamais « sans voiture » hors du titre de la Story.

# CLES_ISOLATION_MOBILITE ------------------------------------------------------
# Les 5 clusters de services de la grille (ADR-0012 point 2) : la clé
# analytique (le vocabulaire CONTEXT : alimentation, santé, administration,
# école, banque) et la colonne du snapshot porté qui porte sa part d'accès à
# pied/TC (share_*_t). L'indicateur EST le miroir — 1 − share_*, le même fait
# en cadrage de privation, jamais un second indicateur.
CLES_ISOLATION_MOBILITE <- c(
  iso_alimentation = "share_food_t",
  iso_sante = "share_health_t",
  iso_administration = "share_admin_t",
  iso_ecole = "share_school_t",
  iso_banque = "share_bank_t"
)

# SEUIL_DELTA_REEL_VELO / SEUIL_SAILLANCE_VELO ---------------------------------
# Les seuils de saillance de « Ce que le vélo préserve », VERROUILLÉS sur la
# distribution réelle du snapshot porté (2026-08-06, 1 200 communes — le delta
# div_loss_t − div_loss_b, les médianes du fichier, jamais recalculées) :
#   - médiane réelle = 1 type (pas de Story — la majorité des communes ne
#     sauve qu'un type) ;
#   - top QUARTILE réel : delta ≥ 4 (q75 = 4 ; 343 communes, 28.6 %) — le delta
#     devient « réel » (la bande notable, jamais une Story) ;
#   - top DÉCILE réel : delta ≥ 10 (q90 = 10 ; 130 communes, 10.8 %) — la
#     SAillance : l'Histoire « Ce que le vélo préserve » se déclenche.
# La classification est une échelle à trois marches (le vocabulaire kebab des
# autres lectures du pipeline) : « non-saillant » (delta < 4 — le médian ~1),
# « notable » (4 ≤ delta < 10 — le top quartile), « saillant » (delta ≥ 10 —
# le top décile, le déclenchement). Les bornes exactes déclenchent (≥) :
# déterministe et testé.
SEUIL_DELTA_REEL_VELO <- 4
SEUIL_SAILLANCE_VELO <- 10
CLASSEMENTS_SAILLANCE_VELO <- c("saillant", "notable", "non-saillant")

# ensure_mode_neutrality -------------------------------------------------------
# La garde de base du PRD #136 : la neutralité modale appliquée D'ABORD sur la
# base — le vélo n'est JAMAIS pire que pied/TC (div_loss_b ≤ div_loss_t,
# toujours, aucun delta négatif possible). Le fichier de production est propre
# (les deltas y sont déjà ≥ 0) ; la garde est le rempart contre l'artefact
# non-production (indicateurs_summarized_communes.csv, deltas vélo négatifs) —
# une donnée négative est CLAMPÉE à l'égalité, jamais publiée. Testée sur un
# input synthétique négatif (le fichier réel étant propre, la garde n'y
# déclenche jamais).
ensure_mode_neutrality <- function(div_loss_t, div_loss_b) {
  dplyr::if_else(div_loss_b > div_loss_t, div_loss_t, div_loss_b)
}

# calculer_parts_isolation_communes --------------------------------------------
# Les 5 parts d'isolation COMMUNALES : le miroir des parts d'accès à pied/TC —
# 1 − share_*_t par cluster (alimentation, santé, administration, école,
# banque). Table longue (commune × key × value), triée par commune puis clé —
# déterministe. La part d'isolation d'une commune est SA valeur telle quelle :
# l'agrégation des niveaux est l'affaire d'agreger_parts_isolation_territoires.
calculer_parts_isolation_communes <- function(snapshot) {
  dplyr::bind_rows(lapply(seq_along(CLES_ISOLATION_MOBILITE), function(i) {
    tibble::tibble(
      commune = snapshot$commune,
      key = names(CLES_ISOLATION_MOBILITE)[[i]],
      value = 1 - snapshot[[CLES_ISOLATION_MOBILITE[[i]]]]
    )
  })) %>%
    dplyr::arrange(commune, key)
}

# agreger_parts_isolation_territoires ------------------------------------------
# Les parts d'isolation aux QUATRE niveaux de territoire (commune / EPCI /
# département / région) en appliquant LA RÈGLE D'AGRÉGATION décidée (ADR-0012,
# CONTEXT.md « Taille ») : un agrégat est RECALCULÉ depuis les parties —
# Σ (part × bâtiments) ÷ Σ bâtiments, la moyenne pondérée par les bâtiments
# analysés, JAMAIS la moyenne des parts communales (qui donnerait le même poids
# à une commune de 50 bâtiments et à une métropole). Les communes SANS EPCI
# (les îles — fix « Sans objet » #131) n'agrègent à AUCUN niveau EPCI. Une
# commune absente du snapshot n'a pas de ligne ici. Déterministe : trié par
# code puis clé.
agreger_parts_isolation_territoires <- function(isolation, poids, base_epci) {
  ctx <- isolation %>%
    dplyr::left_join(poids, by = "commune") %>%
    dplyr::left_join(base_epci[c("CODGEO", "EPCI", "DEP")],
                     by = c("commune" = "CODGEO"))

  dplyr::bind_rows(
    # commune : la valeur communale telle quelle
    ctx %>%
      dplyr::select(commune, key, value) %>%
      dplyr::rename(code = commune),
    # EPCI : la moyenne pondérée des communes membres — jamais les sans-EPCI
    ctx %>%
      dplyr::filter(!is.na(EPCI)) %>%
      dplyr::group_by(code = EPCI, key) %>%
      dplyr::summarise(value = sum(value * nb_buildings) / sum(nb_buildings),
                       .groups = "drop"),
    # département : la moyenne pondérée des communes du département
    ctx %>%
      dplyr::group_by(code = DEP, key) %>%
      dplyr::summarise(value = sum(value * nb_buildings) / sum(nb_buildings),
                       .groups = "drop"),
    # région : la moyenne pondérée de toutes les communes
    ctx %>%
      dplyr::group_by(key) %>%
      dplyr::summarise(code = "53",
                       value = sum(value * nb_buildings) / sum(nb_buildings),
                       .groups = "drop")
  ) %>%
    dplyr::select(code, key, value) %>%
    dplyr::arrange(code, key)
}

# valeur_fichier_niveau --------------------------------------------------------
# La valeur d'un niveau portée par le fichier : les lignes membres portent
# TOUTES la même valeur (l'agrégat du niveau, calculé par l'analyse d'origine
# sur la base bâtiment par bâtiment). La garde vérifie l'UNICITÉ (deux valeurs
# différentes entre membres = une corruption — jamais un choix silencieux) et
# renvoie NA quand AUCUNE n'est portée (le trou Brest Métropole du portage :
# tout le bloc _epci y est absent).
valeur_fichier_niveau <- function(valeurs) {
  uniques <- unique(valeurs[!is.na(valeurs)])
  if (length(uniques) > 1) {
    stop("Snapshot Mobilité corrompu — des communes d'un même niveau portent ",
         "des valeurs de niveau différentes.", call. = FALSE)
  }
  if (length(uniques) == 0) NA_real_ else uniques[[1]]
}

# mediane_ponderee -------------------------------------------------------------
# La médiane PONDÉRÉE par les bâtiments : la statistique de recalcul d'une
# médiane depuis les parties communales (le trou Brest Métropole) — la même
# idée que la moyenne pondérée des parts, appliquée à une médiane. Les valeurs
# sont triées, les poids cumulés : la première valeur qui atteint 50 % du
# poids total EST la médiane pondérée. Déterministe (ordre stable).
mediane_ponderee <- function(valeurs, poids) {
  o <- order(valeurs)
  cumul <- cumsum(poids[o]) / sum(poids)
  valeurs[o][which(cumul >= 0.5)[1]]
}

# calculer_div_loss_communes ---------------------------------------------------
# div_loss_t/b COMMUNAL (la matière du Story « Vingt minutes sans voiture ») :
# la perte de diversité lue à la MÉDIANE de la distribution bâtiment par
# bâtiment du fichier (med_div_loss_t/b — dec_5 == med, vérifié sur le réel),
# avec la garde de neutralité modale appliquée D'ABORD sur la base (bike ≥
# transit — div_loss_b ≤ div_loss_t, un delta négatif est clampé à l'égalité).
# Le story depth pct_iso_full_t (la part des bâtiments qui perdent TOUT accès)
# passe tel quel — la matière du « cas le plus dur », jamais un dérivé.
calculer_div_loss_communes <- function(snapshot) {
  snapshot %>%
    dplyr::transmute(
      commune,
      div_loss_t = med_div_loss_t,
      div_loss_b = ensure_mode_neutrality(med_div_loss_t, med_div_loss_b),
      pct_iso_full_t = pct_iso_full_t
    ) %>%
    dplyr::mutate(delta = div_loss_t - div_loss_b) %>%
    dplyr::select(commune, div_loss_t, div_loss_b, delta, pct_iso_full_t) %>%
    dplyr::arrange(commune)
}

# agreger_div_loss_territoires -------------------------------------------------
# div_loss_t/b aux QUATRE niveaux de territoire. Les niveaux agrégés portent la
# valeur du FICHIER (la médiane de la base bâtiment par bâtiment, la même pour
# toutes les communes membres — JAMAIS une moyenne des médianes communales) ;
# quand le fichier est muet (le trou Brest Métropole du portage : tout le bloc
# _epci absent), le niveau est RECALCULÉ depuis les parties — la médiane
# pondérée par les bâtiments des valeurs communales (déjà clamées : la garde
# sur la base d'abord), et la moyenne pondérée pour pct_iso_full_t (une part).
# La garde de neutralité modale est ré-appliquée sur chaque ligne de niveau —
# aucun delta négatif possible à aucun niveau. Déterministe : trié par code.
agreger_div_loss_territoires <- function(div_communes, snapshot, base_epci) {
  ctx <- snapshot %>%
    # seules les valeurs CLAMÉES de div_loss_t/b viennent de la table communale
    # (le pct_iso_full_t du snapshot est déjà le sien — pas de doublon de
    # colonne à la jointure)
    dplyr::left_join(div_communes[c("commune", "div_loss_t", "div_loss_b")],
                     by = "commune") %>%
    dplyr::left_join(base_epci[c("CODGEO", "EPCI", "DEP")],
                     by = c("commune" = "CODGEO"))

  epci <- ctx %>%
    dplyr::filter(!is.na(EPCI)) %>%
    dplyr::group_by(EPCI) %>%
    dplyr::summarise(
      fichier_t = valeur_fichier_niveau(med_div_loss_t_epci),
      fichier_b = valeur_fichier_niveau(med_div_loss_b_epci),
      fichier_iso = valeur_fichier_niveau(pct_iso_full_t_epci),
      recalcul_t = mediane_ponderee(div_loss_t, nb_buildings),
      recalcul_b = mediane_ponderee(div_loss_b, nb_buildings),
      recalcul_iso = sum(pct_iso_full_t * nb_buildings) / sum(nb_buildings),
      .groups = "drop"
    ) %>%
    dplyr::transmute(
      code = EPCI,
      div_loss_t = dplyr::coalesce(fichier_t, recalcul_t),
      div_loss_b = dplyr::coalesce(fichier_b, recalcul_b),
      pct_iso_full_t = dplyr::coalesce(fichier_iso, recalcul_iso)
    )

  dep <- ctx %>%
    dplyr::group_by(code = DEP) %>%
    dplyr::summarise(
      div_loss_t = valeur_fichier_niveau(med_div_loss_t_dep),
      div_loss_b = valeur_fichier_niveau(med_div_loss_b_dep),
      pct_iso_full_t = valeur_fichier_niveau(pct_iso_full_t_dep),
      .groups = "drop"
    )

  region <- ctx %>%
    dplyr::summarise(
      code = "53",
      div_loss_t = valeur_fichier_niveau(med_div_loss_t_reg),
      div_loss_b = valeur_fichier_niveau(med_div_loss_b_reg),
      pct_iso_full_t = valeur_fichier_niveau(pct_iso_full_t_reg),
      .groups = "drop"
    )

  dplyr::bind_rows(
    div_communes %>% dplyr::rename(code = commune),
    epci, dep, region
  ) %>%
    dplyr::mutate(
      div_loss_b = ensure_mode_neutrality(div_loss_t, div_loss_b),
      delta = div_loss_t - div_loss_b
    ) %>%
    dplyr::select(code, div_loss_t, div_loss_b, delta, pct_iso_full_t) %>%
    dplyr::arrange(code)
}

# type_territoire_mobilite -----------------------------------------------------
# Le type de territoire d'un code de la table analytique : la forme du code —
# la région « 53 », un département breton (2 chiffres), un EPCI (SIREN 9
# chiffres), sinon une commune (COG 5 chiffres). La même lecture que le
# squelette partagé, appliquée aux artefacts analytiques.
type_territoire_mobilite <- function(code) {
  dplyr::case_when(
    code == "53" ~ "region",
    code %in% DEPT_BRETAGNE ~ "departement",
    grepl("^[0-9]{9}$", code) ~ "epci",
    TRUE ~ "commune"
  )
}

# classifier_saillance_velo ----------------------------------------------------
# La classification DÉTERMINISTE du delta « ce que le vélo préserve »
# (div_loss_t − div_loss_b), l'échelle à trois marches verrouillée sur la
# distribution réelle du snapshot porté (2026-08-06, 1 200 communes) :
#   - « non-saillant » : delta < SEUIL_DELTA_REEL_VELO — la médiane réelle est
#     ~1 type : pas de Story (le défaut « Vingt minutes sans voiture » reste) ;
#   - « notable »      : SEUIL_DELTA_REEL_VELO ≤ delta < SEUIL_SAILLANCE_VELO —
#     le top quartile réel (q75 = 4) : un delta réel, jamais une Story ;
#   - « saillant »     : delta ≥ SEUIL_SAILLANCE_VELO — le top décile réel
#     (q90 = 10) : l'Histoire « Ce que le vélo préserve » se déclenche.
# Les bornes exactes déclenchent (≥) — déterministe (ADR-0002). Un delta
# inconnu (NA) n'est jamais classé.
classifier_saillance_velo <- function(delta) {
  dplyr::case_when(
    is.na(delta) ~ NA_character_,
    delta >= SEUIL_SAILLANCE_VELO ~ "saillant",
    delta >= SEUIL_DELTA_REEL_VELO ~ "notable",
    TRUE ~ "non-saillant"
  )
}

# construire_saillance_territoires ---------------------------------------------
# La table de saillance de TOUS les territoires (communes, EPCIs, départements,
# région — le delta est bien défini à chaque échelle, ADR-0012) : code × delta
# × classification. C'est la matière du déclenchement de « Ce que le vélo
# préserve » — les lignes saillantes portent l'Histoire, les autres le défaut.
# Déterministe : trié par code.
construire_saillance_territoires <- function(div_territoires) {
  div_territoires %>%
    dplyr::transmute(
      code = code,
      delta = delta,
      classification = classifier_saillance_velo(delta)
    ) %>%
    dplyr::arrange(code)
}

# construire_signature_densite -------------------------------------------------
# La signature de densité (la distribution bâtiment par bâtiment que la Story
# rend — ADR-0012, leçon de l'issue #131 : JAMAIS la matrice, seulement les
# quelques nombres précalculés par territoire) : pour chaque territoire, les
# bornes min/max, les 10 densités et les 10 bornes de déciles de la
# distribution de div_loss_t — les familles dens_div_t_* / div_loss_t_dec_*
# du snapshot porté, au niveau du territoire (commune / _epci / _dep / _reg).
# Les lignes membres portent toutes la même valeur de niveau (l'agrégat du
# fichier) ; le trou du portage (Brest Métropole : densités présentes, déciles
# absents) porte NA — jamais une valeur inventée. Déterministe : trié par code.
construire_signature_densite <- function(snapshot, base_epci) {
  noms_sig <- c(paste0("dens_", 1:10), paste0("dec_", 1:10))
  cols_commune <- c("dens_div_t_min", "dens_div_t_max",
                    paste0("dens_div_t_", 1:10), paste0("div_loss_t_dec_", 1:10))

  communes <- snapshot %>%
    dplyr::select(commune, dplyr::all_of(cols_commune)) %>%
    stats::setNames(c("code", "dens_min", "dens_max", noms_sig)) %>%
    dplyr::mutate(type = "commune", .before = 1)

  ctx <- snapshot %>%
    dplyr::left_join(base_epci[c("CODGEO", "EPCI", "DEP")],
                     by = c("commune" = "CODGEO"))

  niveau <- function(cle_groupe, type, suffixe, sans_na = FALSE) {
    cols <- c(paste0("dens_div_t_min_", suffixe),
              paste0("dens_div_t_max_", suffixe),
              paste0("dens_div_t_", 1:10, "_", suffixe),
              paste0("div_loss_t_dec_", 1:10, "_", suffixe))
    ctx_groupe <- ctx
    if (sans_na) {
      # les communes SANS EPCI (les îles — fix « Sans objet » #131) n'agrègent
      # à AUCUN niveau EPCI : jamais un groupe NA fabriqué
      ctx_groupe <- ctx_groupe %>% dplyr::filter(!is.na(.data[[cle_groupe]]))
    }
    ctx_groupe %>%
      dplyr::group_by(code = .data[[cle_groupe]]) %>%
      dplyr::summarise(dplyr::across(dplyr::all_of(cols), valeur_fichier_niveau),
                       .groups = "drop") %>%
      stats::setNames(c("code", "dens_min", "dens_max", noms_sig)) %>%
      dplyr::mutate(type = type, .before = 1)
  }

  epcis <- niveau("EPCI", "epci", "epci", sans_na = TRUE)
  deps <- niveau("DEP", "departement", "dep")
  region <- ctx %>%
    dplyr::summarise(dplyr::across(
      dplyr::all_of(c(paste0("dens_div_t_min_reg"), paste0("dens_div_t_max_reg"),
                      paste0("dens_div_t_", 1:10, "_reg"),
                      paste0("div_loss_t_dec_", 1:10, "_reg"))),
      valeur_fichier_niveau),
      .groups = "drop") %>%
    stats::setNames(c("dens_min", "dens_max", noms_sig)) %>%
    dplyr::mutate(type = "region", code = "53", .before = 1)

  dplyr::bind_rows(communes, epcis, deps, region) %>%
    dplyr::select(type, code, dens_min, dens_max, dplyr::all_of(noms_sig)) %>%
    dplyr::arrange(code)
}

# construire_nuage_territoires -------------------------------------------------
# Le nuage même-échelle de la Story (pattern ADR-0011) : pour chaque
# territoire, le RÉSUMÉ de son groupe de comparaison au même niveau — les
# div_loss_t de ses pairs — en QUELQUES nombres (médiane / min / max / n),
# jamais la matrice ni la liste des pairs (leçon de l'issue #131). Les groupes
# (la même portée que groupes_comparaison, compute.R) : une commune voit les
# communes de SON EPCI (ou de son département quand elle n'a pas d'EPCI — les
# îles), un EPCI les autres EPCIs, un département les autres départements, la
# région toutes ses communes. Déterministe : trié par code.
construire_nuage_territoires <- function(div_territoires, base_epci) {
  membres <- base_epci %>%
    dplyr::transmute(code = CODGEO, epci = EPCI, departement = DEP)
  tab <- div_territoires %>%
    dplyr::left_join(membres, by = "code") %>%
    dplyr::mutate(type = type_territoire_mobilite(code))

  resume <- function(codes_peers) {
    v <- tab$div_loss_t[tab$code %in% codes_peers]
    if (length(v) == 0) {
      tibble::tibble(nuage_median = NA_real_, nuage_min = NA_real_,
                     nuage_max = NA_real_, nuage_n = 0L)
    } else {
      tibble::tibble(nuage_median = stats::median(v),
                     nuage_min = min(v), nuage_max = max(v),
                     nuage_n = length(v))
    }
  }

  dplyr::bind_rows(lapply(seq_len(nrow(tab)), function(i) {
    code <- tab$code[i]
    peers <- if (tab$type[i] == "commune") {
      if (!is.na(tab$epci[i])) {
        tab$code[!is.na(tab$epci) & tab$epci == tab$epci[i] & tab$code != code]
      } else {
        tab$code[!is.na(tab$departement) &
                   tab$departement == tab$departement[i] & tab$code != code]
      }
    } else if (tab$type[i] == "epci") {
      tab$code[tab$type == "epci" & tab$code != code]
    } else if (tab$type[i] == "departement") {
      tab$code[tab$type == "departement" & tab$code != code]
    } else {
      tab$code[tab$type == "commune"]
    }
    dplyr::bind_cols(tibble::tibble(code = code, type = tab$type[i]),
                     resume(peers))
  })) %>%
    dplyr::arrange(code)
}

# construire_rangs_isolation ---------------------------------------------------
# Les rangs-en-contexte des 5 parts d'isolation, calculés avec la MACHINERIE
# PARTAGÉE (compute_ranks, compute.R) — jamais re-forkée : la valeur d'un
# territoire est classée dans SON groupe de comparaison (commune → EPCI /
# département / région, EPCI → département / région, département → région), en
# fractions dans [0, 1]. `territoires` est le squelette partagé du thème (la
# forme de construire_territoires_mobilite). Le contrat POSITIONNEL de
# compute_ranks est respecté : chaque table est ALIGNÉE sur le squelette
# (left_join sur les codes, l'ordre du squelette) — un territoire sans donnée
# porte NA, jamais une ligne manquante, et son rang reste NA (il n'empoisonne
# pas son groupe, la règle du percentile partagé). Sortie longue (code × key ×
# les trois rangs), triée par code puis clé — déterministe.
construire_rangs_isolation <- function(isolation_territoires, territoires) {
  tables <- lapply(names(CLES_ISOLATION_MOBILITE), function(key) {
    dplyr::left_join(
      territoires["code"],
      isolation_territoires %>% dplyr::filter(key == !!key),
      by = "code"
    )
  })
  names(tables) <- names(CLES_ISOLATION_MOBILITE)

  dplyr::bind_rows(compute_ranks(territoires, tables, scalaires = list())) %>%
    dplyr::arrange(code, key)
}
