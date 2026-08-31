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

# CLES_ACCES_MOBILITE / CLES_ISOLATION_MOBILITE -------------------------------
# Les 5 clusters de services de la grille (ADR-0012 point 2), dans les trois
# modes du snapshot porté. Les clés `share_*` publient le fait direct : la part
# des bâtiments ayant accès au service. Les clés `iso_*` restent calculées et
# publiées pendant la transition de l'ancien rendu vers le nouveau contrat :
# elles sont le miroir 1 − share_* en cadrage de privation, jamais un second
# calcul analytique.
CLES_ACCES_MOBILITE <- c(
  share_food_t = "share_food_t",
  share_food_b = "share_food_b",
  share_food_c = "share_food_c",
  share_health_t = "share_health_t",
  share_health_b = "share_health_b",
  share_health_c = "share_health_c",
  share_admin_t = "share_admin_t",
  share_admin_b = "share_admin_b",
  share_admin_c = "share_admin_c",
  share_school_t = "share_school_t",
  share_school_b = "share_school_b",
  share_school_c = "share_school_c",
  share_bank_t = "share_bank_t",
  share_bank_b = "share_bank_b",
  share_bank_c = "share_bank_c"
)

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

# calculer_parts_acces_communes -----------------------------------------------
# Les 15 parts d'accès COMMUNALES, directement lues dans le snapshot porté.
# Table longue (commune × clé × valeur), triée par commune puis clé —
# déterministe. L'agrégation des niveaux est l'affaire de
# agreger_parts_acces_territoires.
calculer_parts_acces_communes <- function(snapshot) {
  dplyr::bind_rows(lapply(seq_along(CLES_ACCES_MOBILITE), function(i) {
    tibble::tibble(
      commune = snapshot$commune,
      key = names(CLES_ACCES_MOBILITE)[[i]],
      value = snapshot[[CLES_ACCES_MOBILITE[[i]]]]
    )
  })) %>%
    dplyr::arrange(commune, key)
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

# agreger_parts_acces_territoires ----------------------------------------------
# Les 15 parts d'accès aux QUATRE niveaux. Même règle que pour le miroir :
# moyenne pondérée par les bâtiments, jamais moyenne des communes.
agreger_parts_acces_territoires <- function(acces, poids, base_epci) {
  ctx <- acces %>%
    dplyr::left_join(poids, by = "commune") %>%
    dplyr::left_join(base_epci[c("CODGEO", "EPCI", "DEP")],
                     by = c("commune" = "CODGEO"))

  dplyr::bind_rows(
    ctx %>%
      dplyr::select(commune, key, value) %>%
      dplyr::rename(code = commune),
    ctx %>%
      dplyr::filter(!is.na(EPCI)) %>%
      dplyr::group_by(code = EPCI, key) %>%
      dplyr::summarise(value = sum(value * nb_buildings) / sum(nb_buildings),
                       .groups = "drop"),
    ctx %>%
      dplyr::group_by(code = DEP, key) %>%
      dplyr::summarise(value = sum(value * nb_buildings) / sum(nb_buildings),
                       .groups = "drop"),
    ctx %>%
      dplyr::group_by(key) %>%
      dplyr::summarise(code = "53",
                       value = sum(value * nb_buildings) / sum(nb_buildings),
                       .groups = "drop")
  ) %>%
    dplyr::select(code, key, value) %>%
    dplyr::arrange(code, key)
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

# La perte de volume suit le même snapshot que la perte de diversité. Le clamp
# est appliqué avant agrégation : le vélo ne peut pas perdre davantage que le
# mode pied/TC.
calculer_tot_loss_communes <- function(snapshot) {
  requis <- c("commune", "med_tot_loss_t", "med_tot_loss_b")
  manquantes <- setdiff(requis, names(snapshot))
  if (length(manquantes) > 0) stop("Snapshot Mobilité : colonne(s) tot_loss manquante(s) : ",
                                   paste(manquantes, collapse = ", "), call. = FALSE)
  snapshot %>% dplyr::transmute(
    commune, tot_loss_t = med_tot_loss_t,
    tot_loss_b = ensure_mode_neutrality(med_tot_loss_t, med_tot_loss_b)
  ) %>% dplyr::arrange(commune)
}

agreger_tot_loss_territoires <- function(tot_communes, snapshot, base_epci) {
  ctx <- snapshot %>% dplyr::left_join(tot_communes, by = "commune") %>%
    dplyr::left_join(base_epci[c("CODGEO", "EPCI", "DEP")], by = c("commune" = "CODGEO"))
  niveau <- function(groupe, tcol, bcol) ctx %>% dplyr::filter(!is.na(.data[[groupe]])) %>%
    dplyr::group_by(code = .data[[groupe]]) %>% dplyr::summarise(
      fichier_t = valeur_fichier_niveau(.data[[tcol]]),
      fichier_b = valeur_fichier_niveau(.data[[bcol]]),
      recalcul_t = mediane_ponderee(tot_loss_t, nb_buildings),
      recalcul_b = mediane_ponderee(tot_loss_b, nb_buildings), .groups = "drop") %>%
    dplyr::transmute(code, tot_loss_t = dplyr::coalesce(fichier_t, recalcul_t),
                     tot_loss_b = dplyr::coalesce(fichier_b, recalcul_b))
  epci <- niveau("EPCI", "med_tot_loss_t_epci", "med_tot_loss_b_epci")
  dep <- ctx %>% dplyr::group_by(code = DEP) %>% dplyr::summarise(
    tot_loss_t = valeur_fichier_niveau(med_tot_loss_t_dep),
    tot_loss_b = valeur_fichier_niveau(med_tot_loss_b_dep), .groups = "drop")
  reg <- ctx %>% dplyr::summarise(code = "53",
    tot_loss_t = valeur_fichier_niveau(med_tot_loss_t_reg),
    tot_loss_b = valeur_fichier_niveau(med_tot_loss_b_reg))
  dplyr::bind_rows(tot_communes %>% dplyr::rename(code = commune), epci, dep, reg) %>%
    dplyr::mutate(tot_loss_b = ensure_mode_neutrality(tot_loss_t, tot_loss_b)) %>%
    dplyr::arrange(code)
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
# territoire est classée dans SON groupe de comparaison (commune → les
# communes de son EPCI, ou les communes de la région sans EPCI ; EPCI → tous
# les EPCIs bretons ; département → les départements — ADR-0021), en ORDINAL
# directionnel « Xᵉ / Y » (ADR-0015), la taille du groupe portée à côté du
# rang. `territoires` est le squelette partagé du thème (la forme de
# construire_territoires_mobilite). Le contrat POSITIONNEL de compute_ranks est
# respecté : chaque table est ALIGNÉE sur le squelette (left_join sur les
# codes, l'ordre du squelette) — un territoire sans donnée porte NA, jamais
# une ligne manquante, et son rang reste NA (il n'empoisonne pas son groupe).
# Les cinq parts d'isolation sont low-is-good (ADR-0015 — le cadrage en
# privation : moins de bâtiments sans accès, mieux) : la plus petite part est
# la meilleure (1er). Sortie longue (code × key × les trois rangs et leurs
# tailles), triée par code puis clé — déterministe.
construire_rangs_isolation <- function(isolation_territoires, territoires) {
  tables <- lapply(names(CLES_ISOLATION_MOBILITE), function(key) {
    dplyr::left_join(
      territoires["code"],
      isolation_territoires %>% dplyr::filter(key == !!key),
      by = "code"
    )
  })
  names(tables) <- names(CLES_ISOLATION_MOBILITE)

  directions <- stats::setNames(rep("low", length(CLES_ISOLATION_MOBILITE)),
                                names(CLES_ISOLATION_MOBILITE))

  dplyr::bind_rows(compute_ranks(territoires, tables, scalaires = list(),
                                 directions = directions)) %>%
    dplyr::arrange(code, key)
}

# construire_rangs_acces -------------------------------------------------------
# Les 15 parts d'accès sont high-is-good : plus de bâtiments atteignent le
# service, mieux c'est. Elles partagent la même machinerie de rangs et le même
# contexte que leurs miroirs iso_* ; les deux familles restent distinctes dans
# le payload pour permettre la transition du rendu sans recalcul côté app.
construire_rangs_acces <- function(acces_territoires, territoires) {
  tables <- lapply(names(CLES_ACCES_MOBILITE), function(key) {
    dplyr::left_join(
      territoires["code"],
      acces_territoires %>% dplyr::filter(key == !!key),
      by = "code"
    )
  })
  names(tables) <- names(CLES_ACCES_MOBILITE)

  directions <- stats::setNames(rep("high", length(CLES_ACCES_MOBILITE)),
                                names(CLES_ACCES_MOBILITE))

  dplyr::bind_rows(compute_ranks(territoires, tables, scalaires = list(),
                                 directions = directions)) %>%
    dplyr::arrange(code, key)
}

# =============================================================================
# Le sous-bloc « L'offre de mobilité alternative » (issue #140)
# =============================================================================
# Les builders du sous-bloc : l'offre TC (la VRAIE part des bâtiments près
# d'un arrêt — la correction de la méthode : la fraction des BÂTIMENTS de la
# commune à moins de 500 m d'un arrêt GTFS, jamais une part de superficie
# communale), les bornes de recharge (les stations IRVE par commune) et le
# stationnement vélo (les places / 1 000 hab du hub Ecolab, pris tel quel).
# Les tables communales sont ensuite agrégées aux QUATRE niveaux
# (agreger_offre_territoires) par la règle du thème (CONTEXT.md « Taille ») :
# un agrégat est RECALCULÉ depuis les parties — la moyenne pondérée par les
# bâtiments pour une part, la SOMME pour un compte, Σ places ÷ Σ population
# pour un taux — jamais la moyenne des valeurs communales.

# DISTANCE_ARRET_M / CRS_OFFRE_MOBILITE ----------------------------------------
# La DÉCISION DE BUILD verrouillée de l'offre TC (l'item 🔶 du contrat,
# docs/themes/mobilite.md §Open items, documentée dans le manifeste et la
# Méthodes) : la distance « près d'un arrêt » = 500 m à vol d'oiseau
# (straight-line) — le rayon classique « 10 minutes à pied » de l'offre TC (la
# famille du PTAL britannique, du « stop coverage »). La part est la VRAIE
# fraction des bâtiments de la commune à moins de cette distance d'un arrêt
# GTFS (la correction de la première passe : le proxy de superficie communale
# a été rejeté — Rennes superficie 0,40 vs bâtiments 0,996). Le rayon est UNE
# constante verrouillée, testée. La projection du calcul spatial :
# EPSG:2154 (Lambert-93) — la projection nationale française, adaptée à la
# Bretagne entière, les distances en mètres (le buffer de 500 m y est un vrai
# 500 m). Les arrêts sont en WGS84 (EPSG:4326) et reprojetés au calcul ; les
# bâtiments sont déjà en 2154 (le format natif de la couche).
DISTANCE_ARRET_M <- 500
CRS_OFFRE_MOBILITE <- 2154

# calculer_part_proches_arret_communes -----------------------------------------
# L'offre TC COMMUNALE — la VRAIE part des bâtiments près d'un arrêt (la
# correction de la méthode de la première passe, issue #140) : pour chaque
# commune, la fraction de SES bâtiments (la couche batiments_residentiels, les
# geom_adresse POINT EPSG:2154) à moins de `distance` mètres à vol d'oiseau
# d'un arrêt GTFS (stops.txt Korrigo, WGS84). La mécanique spatiale (sf) : les
# arrêts sont reprojetés en Lambert-93 (CRS_OFFRE_MOBILITE, les distances en
# mètres), tamponnés à `distance`, et les bâtiments sont intersectés avec les
# tampons — l'INDEX SPATIAL de GEOS (st_intersects), jamais une matrice de
# distances complète (le principe du manifeste). Chaque bâtiment est « proche »
# si son point tombe dans au moins un tampon ; la part communale est
# n_proches ÷ n_batiments. La géométrie sphérique (s2) est désactivée pour le
# calcul planaire et restaurée après (on.exit) — le calcul ne laisse aucune
# trace d'état global. Sortie : {commune, n_batiments, n_proches, part_proche},
# triée par commune — déterministe (GEOS, même entrée → même sortie).
# Seules les communes à bâtiments figurent (les deux îles sans bâtiment
# géocodé — 29083/29084 — n'ont pas de part, un fait de la couche).
calculer_part_proches_arret_communes <- function(stops, batiments,
                                                 distance = DISTANCE_ARRET_M) {
  if (!all(c("stop_lat", "stop_lon") %in% names(stops))) {
    stop("calculer_part_proches_arret_communes : le tableau des arrêts doit ",
         "porter stop_lat et stop_lon.", call. = FALSE)
  }
  if (!inherits(batiments, "sf") || !"code_commune_insee" %in% names(batiments)) {
    stop("calculer_part_proches_arret_communes : la couche bâtiments doit être ",
         "un sf portant code_commune_insee.", call. = FALSE)
  }

  ancien_s2 <- sf::sf_use_s2(FALSE)
  on.exit(sf::sf_use_s2(ancien_s2), add = TRUE)

  points_arrets <- sf::st_sfc(
    lapply(seq_len(nrow(stops)), function(i) {
      sf::st_point(c(stops$stop_lon[i], stops$stop_lat[i]))
    }),
    crs = 4326
  )
  arrets_proj <- sf::st_transform(points_arrets, CRS_OFFRE_MOBILITE)
  tampons <- sf::st_buffer(arrets_proj, distance)

  proches <- lengths(sf::st_intersects(batiments, tampons)) > 0
  batiments$proche <- proches

  sf::st_drop_geometry(batiments) %>%
    dplyr::group_by(commune = code_commune_insee) %>%
    dplyr::summarise(
      n_batiments = dplyr::n(),
      n_proches = sum(proche),
      .groups = "drop"
    ) %>%
    dplyr::mutate(part_proche = n_proches / n_batiments) %>%
    dplyr::arrange(commune)
}

FACTEUR_PLACE_VOITURE_M2 <- c(lot = 25, street_side = 11.5)
# Empirical decision recorded by the contract: publish the count ratio
# (places vélo / places voiture), not the discarded area proxy.
RATIO_STATIONNEMENT_VELO_DECISION <- "places_velo_par_places_voiture"
# calculer_stationnement_voiture_communes ---------------------------------------
# Les surfaces OSM sont converties en places estimées. `capacity` est
# volontairement ignoré : sa couverture est insuffisante et son sens varie.
# Les objets fermés sont dédupliqués par osm_id (ways/relations compris) ; les
# lignes ne contribuent que par leurs côtés parking:lane explicitement tagués.
calculer_stationnement_voiture_communes <- function(parkings, lignes, limites) {
  if (!inherits(parkings, "sf") || !inherits(lignes, "sf") || !inherits(limites, "sf"))
    stop("Stationnement voiture : parkings, lignes et limites doivent être sf.", call. = FALSE)
  if (any(!sf::st_geometry_type(parkings) %in% c("POLYGON", "MULTIPOLYGON")))
    stop("Stationnement voiture : seuls les ways fermés et relations sont acceptés.", call. = FALSE)
  if (!"code_insee" %in% names(limites)) stop("Stationnement voiture : limites sans code_insee.", call. = FALSE)
  if (!"osm_id" %in% names(parkings)) parkings$osm_id <- seq_len(nrow(parkings))
  parkings <- parkings[!duplicated(parkings$osm_id), ]
  parkings <- sf::st_transform(parkings, sf::st_crs(limites))
  # Attribute once, at the representative point: a large polygon crossing a
  # commune boundary must not be counted once per intersected commune.
  points <- sf::st_point_on_surface(parkings)
  points$parking_area <- as.numeric(sf::st_area(parkings))
  pol <- sf::st_join(points, limites["code_insee"], left = FALSE)
  parking_tag <- if ("parking" %in% names(pol)) tolower(as.character(pol$parking)) else rep(NA_character_, nrow(pol))
  kind <- ifelse(!is.na(parking_tag) & parking_tag == "street_side", "street_side", "lot")
  areas <- tibble::tibble(commune = pol$code_insee,
                            places = pol$parking_area /
                             ifelse(kind == "street_side", 11.5, 25))
  lignes <- lignes[!is.na(lignes$highway) & nzchar(as.character(lignes$highway)), ]
  lane_cols <- grep("^(parking:lane:(left|right|both)|parking:(left|right|both)|parking_lane_(left|right|both))$",
                    names(lignes), value = TRUE)
  linear <- tibble::tibble(commune = character(), places = numeric())
  if (length(lane_cols) > 0) {
      tagged <- apply(sf::st_drop_geometry(lignes[, lane_cols, drop = FALSE]), 1,
      function(x) sum(vapply(seq_along(x), function(j) {
        v <- x[[j]]
         v <- tolower(as.character(v)); !is.na(v) && nzchar(v) &&
           !v %in% c("no", "no_parking", "no_stopping", "separate", "none", "0")
       }, logical(1)) * ifelse(grepl("both", lane_cols) | tolower(as.character(x)) == "both", 2, 1))
    )
    tagged <- which(tagged > 0)
    if (length(tagged) > 0) {
      ln <- sf::st_join(lignes[tagged, , drop = FALSE], limites["code_insee"], left = FALSE)
      lane_count <- apply(sf::st_drop_geometry(ln[, lane_cols, drop = FALSE]), 1,
        function(x) sum(vapply(seq_along(x), function(j) {
          v <- x[[j]]
          v <- tolower(as.character(v)); !is.na(v) && nzchar(v) &&
            !v %in% c("no", "no_parking", "no_stopping", "separate", "none", "0")
        }, logical(1)) * ifelse(grepl("both", lane_cols) | tolower(as.character(x)) == "both", 2, 1)))
      ln <- sf::st_transform(ln, sf::st_crs(limites))
      linear <- tibble::tibble(commune = ln$code_insee,
                                places = as.numeric(sf::st_length(ln)) *
                                  (lane_count * 2.3) / 11.5)
    }
  }
  dplyr::bind_rows(areas, linear) %>% dplyr::group_by(commune) %>%
    dplyr::summarise(places_voiture = sum(places), .groups = "drop") %>%
    dplyr::arrange(commune)
}

agreger_stationnement_voiture_territoires <- function(voiture_communes,
                                                       velo_communes, base_epci) {
  ref <- base_epci[c("CODGEO", "EPCI", "DEP")]
  ctx <- tibble::tibble(commune = sort(unique(as.character(ref$CODGEO)))) %>%
    dplyr::left_join(voiture_communes, by = "commune") %>%
    dplyr::mutate(places_voiture = dplyr::coalesce(places_voiture, 0)) %>%
    dplyr::left_join(velo_communes[c("commune", "population")], by = "commune") %>%
    dplyr::left_join(ref, by = c("commune" = "CODGEO"))
  calc <- function(g) {
    x <- ctx
    dplyr::bind_rows(
      x %>% dplyr::transmute(code = commune, places = places_voiture,
                              population = population),
      x %>% dplyr::filter(!is.na(EPCI)) %>% dplyr::group_by(code = EPCI) %>%
        dplyr::summarise(places = sum(places_voiture), population = sum(population), .groups = "drop"),
      x %>% dplyr::group_by(code = DEP) %>% dplyr::summarise(places = sum(places_voiture), population = sum(population), .groups = "drop"),
      x %>% dplyr::summarise(code = "53", places = sum(places_voiture), population = sum(population))
    )
  }
  # Decision recorded in the contract: compare counts, not area proxies.  The
  # ratio below is the only candidate published (the rejected area candidate
  # must not survive as an unowned computation).
  out <- calc("EPCI") %>% dplyr::mutate(value = places / population * 1000,
                                        key = "places_stationnement_voiture_1000") %>%
    dplyr::select(code, key, value)
  # The readable ratio is places vélo / places voiture.  Aggregate its two
  # counts before dividing; never average commune ratios.
  ratio_ctx <- tibble::tibble(commune = sort(unique(as.character(ref$CODGEO)))) %>%
    dplyr::left_join(velo_communes %>% dplyr::select(commune, places_velo = places), by = "commune") %>%
    dplyr::left_join(voiture_communes %>% dplyr::select(commune, places_voiture), by = "commune") %>%
    dplyr::mutate(places_voiture = dplyr::coalesce(places_voiture, 0)) %>%
    dplyr::left_join(ref, by = c("commune" = "CODGEO"))
  ratio_agg <- function(group = NULL) {
    x <- ratio_ctx
    if (!is.null(group)) x <- x %>% dplyr::filter(!is.na(.data[[group]]))
    if (is.null(group)) {
      x %>% dplyr::summarise(code = "53", pv = sum(places_velo), pc = sum(places_voiture))
    } else {
      x %>% dplyr::group_by(code = .data[[group]]) %>%
        dplyr::summarise(pv = sum(places_velo), pc = sum(places_voiture), .groups = "drop")
    }
  }
  ratio <- dplyr::bind_rows(
    ratio_ctx %>% dplyr::transmute(code = commune, pv = places_velo, pc = places_voiture),
    ratio_agg("EPCI"), ratio_agg("DEP"), ratio_agg()
  ) %>% dplyr::transmute(code, key = "stationnement_velo_par_voiture",
                         detail = NA_character_, value = dplyr::if_else(pc > 0, pv / pc, NA_real_))
  dplyr::bind_rows(out, ratio)
}

calculer_ratios_mobilite <- function(bornes, fuel, velo, voiture) {
  # fuel is a count table; callers must not pass a table already joined to it.
  x <- bornes %>% dplyr::full_join(fuel, by = "code") %>%
    dplyr::full_join(velo, by = "code") %>% dplyr::full_join(voiture, by = "code") %>%
    dplyr::mutate(
      bornes_ev_par_station_service = dplyr::if_else(!is.na(fuel) & fuel > 0, bornes / fuel, NA_real_),
      rider = dplyr::case_when(is.na(fuel) ~ "Donnée stations-service indisponible",
        fuel > 0 ~ NA_character_, bornes > 0 ~
        "Aucune station-service sur le territoire", TRUE ~ "Aucune borne ni station-service")
      )
    x
}

calculer_fuel_communes <- function(fuel) {
  if (!all(c("commune", "fuel") %in% names(fuel)))
    stop("BPE B316 normalisée : commune et fuel requis.", call. = FALSE)
  fuel %>% dplyr::transmute(code = commune, fuel = fuel)
}

# calculer_bornes_communes ------------------------------------------------------
# Les bornes de recharge COMMUNALES : le nombre de STATIONS IRVE distinctes
# (id_station_itinerance) par commune — « bornes » = stations, jamais les
# points de charge (une station porte plusieurs prises). Deux caveats SOURCE
# (documentés dans le manifeste et la Méthodes) appliqués ici : les stations
# sans code commune (les lignes mal géolocalisées du fichier) n'entrent dans
# aucun comptage, et le champ code_insee_commune du fichier consolidé porte
# des valeurs HORS référentiel (des codes postaux comme 22100, des codes
# départementaux comme 22000, « 99999 », des communes hors Bretagne) — seules
# les communes du RÉFÉRENTIEL partagé (base_epci : CODGEO) sont comptées, le
# reste tombe. Une commune sans station n'a pas de ligne ici (le zéro est
# porté par l'agrégation). Trié par commune — déterministe.
calculer_bornes_communes <- function(bornes, base_epci) {
  communes_valides <- sort(unique(as.character(base_epci$CODGEO)))
  bornes %>%
    dplyr::filter(!is.na(code_insee_commune),
                  code_insee_commune %in% communes_valides) %>%
    dplyr::distinct(code_insee_commune, id_station_itinerance) %>%
    dplyr::count(code_insee_commune, name = "nb_bornes") %>%
    dplyr::rename(commune = code_insee_commune) %>%
    dplyr::arrange(commune)
}

# calculer_stationnement_velo_communes ------------------------------------------
# Le stationnement vélo COMMUNAL : les places / 1 000 hab du hub Ecolab, PRIS
# TEL QUEL (décision 2026-08-04) — la valeur du millésime le PLUS RÉCENT par
# commune (le hub est annuel, 2022-2025 ; la table normalisée porte une ligne
# par commune × millésime avec les places, la population et le taux). La
# table porte places + population en plus du taux : l'agrégation des niveaux
# recompose Σ places ÷ Σ population × 1 000 (jamais la moyenne des taux).
# Trié par commune — déterministe.
calculer_stationnement_velo_communes <- function(velo) {
  velo %>%
    dplyr::group_by(geocode_commune) %>%
    dplyr::slice_max(annee, with_ties = FALSE) %>%
    dplyr::ungroup() %>%
    dplyr::rename(commune = geocode_commune) %>%
    dplyr::select(commune, annee, places, population, places_1000) %>%
    dplyr::arrange(commune)
}

# agreger_offre_territoires -----------------------------------------------------
# Le sous-bloc aux QUATRE niveaux de territoire (commune / EPCI / département /
# région), chaque indicateur agrégé par SA règle (CONTEXT.md « Taille » — un
# agrégat est RECALCULÉ depuis les parties, jamais une moyenne de valeurs) :
#   - offre_tc (une part) : la moyenne pondérée par les BÂTIMENTS de la couche
#     — Σ (part × n_batiments) ÷ Σ n_batiments, le dénominateur même de la
#     part (la correction : le poids EST le nombre de bâtiments de la couche
#     qui fonde la part, jamais un poids étranger). Les communes sans bâtiment
#     (les deux îles) n'ont pas de part — elles n'entrent dans aucun agrégat ;
#   - bornes_recharge (un compte) : la SOMME des stations communales, avec le
#     ZÉRO porté par toute commune du référentiel sans station (une commune
#     sans borne a 0 borne — un fait, jamais un NA) ;
#   - places_stationnement_velo_1000 (un taux) : Σ places ÷ Σ population
#     × 1 000 — recomposé depuis les parties, jamais la moyenne des taux ;
#   - offre_cyclable (issue #231, la figure « L'offre cyclable ») : une clé
#     MULTI-MESURE (5 détails) — les longueurs protégé/partagé/total SOMMÉES,
#     les km/1 000 hab RECOMPOSÉS depuis les parties (Σ km ÷ Σ population
#     × 1 000, jamais la moyenne des taux communaux), le ZÉRO porté par toute
#     commune sans aménagement (un fait, jamais un NA — la même règle que les
#     bornes).
# Sortie longue (code × key × detail × value), une ligne par (territoire ×
# clé × détail), triée par code puis clé puis détail — déterministe. Depuis
# l'issue #231, la sortie porte une colonne `detail` : NA pour les clés
# scalaires du sous-bloc (offre_tc / bornes_recharge /
# places_stationnement_velo_1000), le nom de la mesure pour offre_cyclable —
# la forme longue du contrat, la même que les autres clés multi-mesures du
# payload. Les communes sans EPCI (les îles) n'agrègent à AUCUN niveau EPCI
# (la règle du fix « Sans objet » #131).
agreger_offre_territoires <- function(offre_tc_communes, bornes_communes,
                                       velo_communes, base_epci,
                                       offre_cyclable_communes = NULL,
                                       stationnement_voiture_communes = NULL,
                                       fuel_communes = NULL) {
  ref <- base_epci[c("CODGEO", "EPCI", "DEP")]

  # offre_tc : la moyenne pondérée par les bâtiments de la couche (le
  # dénominateur de la part) — jamais la moyenne des parts communales
  ctx_tc <- offre_tc_communes %>%
    dplyr::left_join(ref, by = c("commune" = "CODGEO"))
  offre_tc <- dplyr::bind_rows(
    ctx_tc %>% dplyr::transmute(code = commune, value = part_proche),
    ctx_tc %>% dplyr::filter(!is.na(EPCI)) %>%
      dplyr::group_by(code = EPCI) %>%
      dplyr::summarise(value = sum(part_proche * n_batiments) / sum(n_batiments),
                       .groups = "drop"),
    ctx_tc %>% dplyr::group_by(code = DEP) %>%
      dplyr::summarise(value = sum(part_proche * n_batiments) / sum(n_batiments),
                       .groups = "drop"),
    ctx_tc %>% dplyr::summarise(
      code = "53",
      value = sum(part_proche * n_batiments) / sum(n_batiments),
      .groups = "drop")
  ) %>%
    dplyr::mutate(key = "offre_tc", detail = NA_character_)

  # bornes : la SOMME, avec le zéro porté par toute commune du référentiel
  # partagé (base_epci — jamais un NA) ; les communes sans EPCI (les îles)
  # n'agrègent à aucun niveau EPCI
  communes_univers <- sort(unique(as.character(ref$CODGEO)))
  ctx_b <- tibble::tibble(
    commune = communes_univers,
    nb_bornes = 0L
  ) %>%
    dplyr::rows_update(
      bornes_communes %>% dplyr::mutate(nb_bornes = as.integer(nb_bornes)),
      by = "commune"
    ) %>%
    dplyr::rename(value = nb_bornes) %>%
    dplyr::left_join(ref, by = c("commune" = "CODGEO"))
  bornes <- dplyr::bind_rows(
    ctx_b %>% dplyr::transmute(code = commune, value),
    ctx_b %>% dplyr::filter(!is.na(EPCI)) %>%
      dplyr::group_by(code = EPCI) %>%
      dplyr::summarise(value = sum(value), .groups = "drop"),
    ctx_b %>% dplyr::group_by(code = DEP) %>%
      dplyr::summarise(value = sum(value), .groups = "drop"),
    ctx_b %>% dplyr::summarise(code = "53", value = sum(value),
                               .groups = "drop")
  ) %>%
    dplyr::mutate(key = "bornes_recharge", detail = NA_character_)

  # velo : Σ places ÷ Σ population × 1 000 — recomposé depuis les parties
  # (jamais la moyenne des taux) ; les communes sans EPCI n'agrègent à aucun
  # niveau EPCI
  ctx_v <- velo_communes %>%
    dplyr::left_join(ref, by = c("commune" = "CODGEO"))
  velo <- dplyr::bind_rows(
    ctx_v %>% dplyr::transmute(code = commune, value = places_1000),
    ctx_v %>% dplyr::filter(!is.na(EPCI)) %>%
      dplyr::group_by(code = EPCI) %>%
      dplyr::summarise(value = sum(places) / sum(population) * 1000,
                       .groups = "drop"),
    ctx_v %>% dplyr::group_by(code = DEP) %>%
      dplyr::summarise(value = sum(places) / sum(population) * 1000,
                       .groups = "drop"),
    ctx_v %>% dplyr::summarise(
      code = "53",
      value = sum(places) / sum(population) * 1000,
      .groups = "drop")
  ) %>%
    dplyr::mutate(key = "places_stationnement_velo_1000",
                  detail = NA_character_)

  # offre_cyclable (issue #231) : les cinq mesures de la figure, chacune
  # agrégée par SA règle — les longueurs (protégé/partagé/total) SOMMÉES, les
  # km/1 000 hab RECOMPOSÉS depuis les parties (Σ km ÷ Σ population × 1 000).
  # La commune sans aménagement porte 0 (la forme de calculer_offre_cyclable_
  # communes : TOUTES les communes de l'univers y figurent) ; les communes
  # sans EPCI n'agrègent à aucun niveau EPCI.
  cyclable <- NULL
  if (!is.null(offre_cyclable_communes)) {
    # les km/1 000 hab sont RECOMPOSÉS depuis les LONGUEURS (la colonne sœur)
    # — Σ km ÷ Σ population × 1 000, jamais une somme de taux
    longueur_des_taux <- c(protege_km_1000 = "protege_longueur",
                           partage_km_1000 = "partage_longueur")
    mesures_longueur <- c("protege_longueur", "partage_longueur",
                          "total_longueur")
    mesures_taux <- c("protege_km_1000", "partage_km_1000")
    ctx_c <- offre_cyclable_communes %>%
      dplyr::left_join(ref, by = c("commune" = "CODGEO"))
    agreger_longueur_c <- function(colonne) {
      dplyr::bind_rows(
        ctx_c %>% dplyr::transmute(code = commune, valeur = .data[[colonne]]),
        ctx_c %>% dplyr::filter(!is.na(EPCI)) %>%
          dplyr::group_by(code = EPCI) %>%
          dplyr::summarise(valeur = sum(.data[[colonne]]), .groups = "drop"),
        ctx_c %>% dplyr::group_by(code = DEP) %>%
          dplyr::summarise(valeur = sum(.data[[colonne]]), .groups = "drop"),
        ctx_c %>% dplyr::summarise(code = "53",
                                   valeur = sum(.data[[colonne]]),
                                   .groups = "drop")
      ) %>%
        dplyr::transmute(code, key = "offre_cyclable",
                         detail = colonne, value = valeur)
    }
    agreger_taux_c <- function(colonne) {
      colonne_longueur <- longueur_des_taux[[colonne]]
      dplyr::bind_rows(
        ctx_c %>% dplyr::transmute(code = commune, valeur = .data[[colonne]]),
        ctx_c %>% dplyr::filter(!is.na(EPCI)) %>%
          dplyr::group_by(code = EPCI) %>%
          dplyr::summarise(
            valeur = sum(.data[[colonne_longueur]]) / sum(population) * 1000,
            .groups = "drop"),
        ctx_c %>% dplyr::group_by(code = DEP) %>%
          dplyr::summarise(
            valeur = sum(.data[[colonne_longueur]]) / sum(population) * 1000,
            .groups = "drop"),
        ctx_c %>% dplyr::summarise(
          code = "53",
          valeur = sum(.data[[colonne_longueur]]) / sum(population) * 1000,
          .groups = "drop")
      ) %>%
        dplyr::transmute(code, key = "offre_cyclable",
                         detail = colonne, value = valeur)
    }
    cyclable <- dplyr::bind_rows(
      lapply(c(mesures_longueur, mesures_taux), function(colonne) {
        if (colonne %in% mesures_longueur) {
          agreger_longueur_c(colonne)
        } else {
          agreger_taux_c(colonne)
        }
      })
    )
  }

  voiture <- NULL
  if (!is.null(stationnement_voiture_communes)) {
    voiture <- agreger_stationnement_voiture_territoires(
      stationnement_voiture_communes, velo_communes, base_epci)
  }
  ratios <- NULL
  if (!is.null(fuel_communes)) {
    # Aggregate the two counts first, then divide; absent fuel remains NA.
    ctx_r <- tibble::tibble(commune = sort(unique(as.character(ref$CODGEO)))) %>%
      dplyr::left_join(bornes_communes %>% dplyr::rename(bornes = nb_bornes), by = "commune") %>%
      dplyr::mutate(bornes = dplyr::coalesce(bornes, 0)) %>%
      dplyr::left_join(fuel_communes %>% dplyr::rename(fuel_value = fuel), by = c("commune" = "code")) %>%
      dplyr::left_join(ref, by = c("commune" = "CODGEO"))
    agg <- function(g) ctx_r %>% dplyr::filter(!is.na(.data[[g]])) %>%
      dplyr::group_by(code = .data[[g]]) %>% dplyr::summarise(
        bornes = sum(bornes),
        # A missing BPE observation means unavailable, not zero.  A group is
        # unavailable when any of its members is unavailable.
        fuel = if (anyNA(fuel_value)) NA_real_ else sum(fuel_value), .groups = "drop")
    rr <- dplyr::bind_rows(ctx_r %>% dplyr::transmute(code = commune, bornes, fuel = fuel_value),
                           agg("EPCI"), agg("DEP"),
                            ctx_r %>% dplyr::summarise(code = "53", bornes = sum(bornes), fuel = if (anyNA(fuel_value)) NA_real_ else sum(fuel_value)))
     ratios <- calculer_ratios_mobilite(rr %>% dplyr::select(code, bornes),
       rr %>% dplyr::select(code, fuel),
      tibble::tibble(code = rr$code, places_velo = NA_real_),
      tibble::tibble(code = rr$code, places_voiture = NA_real_)) %>%
       dplyr::transmute(code, key = "bornes_ev_par_station_service", detail = NA_character_,
                        value = bornes_ev_par_station_service, rider)
  }
  dplyr::bind_rows(offre_tc, bornes, velo, cyclable, voiture, ratios) %>%
    dplyr::select(code, key, detail, value, dplyr::any_of("rider")) %>%
    dplyr::arrange(code, key, detail)
}
