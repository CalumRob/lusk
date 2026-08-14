# theme_habitat ---------------------------------------------------------------
# Le module du thème Habitat (issue #17) : tout ce qui DIFFÈRE d'un thème à
# l'autre vit ici, déclaré dans le descripteur theme_habitat() que la
# machinerie partagée (download/compute/publish) consomme sans jamais nommer le
# thème — même forme de descripteur que theme_demographie() (issue #13).
# Habitat brise le confort du traceur de balle : trois sources (INSEE RP
# Logements, Etalab DVF, ADEME DPE), des données PONCTUELLES (transactions,
# DPE) qui s'agrègent par territoire au lieu de se sommer, la suppression
# statistique (n < 10 / n < 30) et une colonne `n` publiée honnêtement.
#
# Le descripteur porte : le manifeste des sources (les trois fragments #14/#15/
# #16 + la base des EPCI partagée), la table déclarative des indicateurs, le
# builder de vintages, la construction des données, la construction de la table
# des territoires (squelette partagé + colonnes d'agrégation du thème), les
# constructeurs d'indicateurs, les scalaires de classement, le calcul de
# l'Histoire (les 4 lectures de l'état énergétique du parc, issue #18) et les
# validations spécifiques au thème.

# MANIFEST_HABITAT ------------------------------------------------------------
# Le manifeste du thème : les trois fragments concaténés (RP Logements #14,
# DVF #15, DPE #16) PLUS la source partagée « epci » — la base des EPCI à
# fiscalité propre (le référentiel commune -> EPCI -> département -> région que
# toute table des territoires consomme ; le manifeste Démographie la déclare
# déjà, on réutilise le MÊME id/URL — le cache idempotent évite le
# re-téléchargement).
MANIFEST_HABITAT <- dplyr::bind_rows(
  tibble::tribble(
    ~id, ~source, ~url, ~fichier, ~vintage, ~date_reference, ~date_publication, ~licence, ~note, ~mode, ~type,
    "epci",
    "INSEE — Base des EPCI à fiscalité propre au 01/01/2025",
    "https://www.insee.fr/fr/statistiques/fichier/2510634/epci_au_01-01-2025.zip",
    "epci_au_01-01-2025.zip", "2025", "2025-01-01", NA_character_, "lov2",
    "Feuille Composition_communale : CODGEO -> EPCI (SIREN), LIBEPCI, DEP, REG",
    "cron", "fichier"
  ),
  MANIFEST_HABITAT_RP,
  MANIFEST_HABITAT_DVF,
  MANIFEST_HABITAT_DPE
)

# INDICATEURS_HABITAT ---------------------------------------------------------
# La table déclarative des indicateurs du thème (issue #9/#17) : chaque clé du
# payload y est déclarée avec ses sources (ids du manifeste), sa source de
# référence et sa multiplicité (le nombre de lignes par territoire — la
# validation générique la vérifie). La source de référence est DÉCLARÉE, jamais
# inférée : « la source du composant signature de l'indicateur ».
#   - mix_logements (3) : une ligne par catégorie (principales/secondaires/
#     vacants) — source logements (RP). Le scalaire classé est la part de
#     résidences principales (issue #368 — plus de logements occupés, mieux ;
#     la part de secondaires était classée low-is-good avant l'audit ordinal).
#   - statut (4) : propriétaire / HLM (le parc social) / locataire du parc
#     privé / logé gratuitement — le split de l'ancienne clé à 14 modalités
#     (issue #368). Le scalaire classé est la part HLM (high-is-good).
#   - age_du_bati (6) : les six tranches de la période d'achèvement (RP
#     BUILD_END) — issue #368. Le scalaire classé est la part du parc d'avant
#     1971 (low-is-good : le vieux bâti est dur à isoler, la tension DPE).
#   - type (2) : maison / appartement — issue #368. Le scalaire classé est la
#     part d'appartements (high-is-good).
#   - prix_m2 (6) : une ligne poolée (detail NA, le headline classé) + une
#     ligne par année de la fenêtre glissante (ANNEE_DVF, la série
#     d'évolution) — source DVF. La référence est le millésime le plus récent
#     de la fenêtre (dvf_2025_dep22) : la fraîcheur de la série poolée est
#     celle de la livraison qui a régénéré la fenêtre. Direction LOW depuis
#     l'audit ordinal (issue #368) : un prix élevé pèse sur l'accès au
#     logement — moins cher, mieux.
#   - part_passoires (1) + distribution_dpe (7) : le F/G et les parts A–G de la
#     distribution — source DPE (la base roulante, vintage = date du pull).
INDICATEURS_HABITAT <- tibble::tibble(
  key = c("mix_logements", "statut", "age_du_bati", "type", "prix_m2",
          "part_passoires", "distribution_dpe"),
  libelle = c(
    "Mix de logements",
    "Statut d’occupation",
    "Âge du bâti",
    "Type de logement",
    "Médiane prix au m²",
    "Part de passoires thermiques",
    "Distribution des étiquettes DPE (A à G)"
  ),
  sources = list(
    "logements",
    "logements",
    "logements",
    "logements",
    MANIFEST_HABITAT_DVF$id,
    MANIFEST_HABITAT_DPE$id,
    MANIFEST_HABITAT_DPE$id
  ),
  source_reference = c("logements", "logements", "logements", "logements",
                       "dvf_2025_dep22", "dpe_22", "dpe_22"),
  multiplicite = c(3L, 4L, 6L, 2L, 1L + length(ANNEE_DVF), 1L, 7L)
)

# La construction des données du thème ----------------------------------------
# L'acte « trouver la donnée » : assemble les trois tables processées (RP
# Logements, DVF, DPE) + la base des EPCI (extrait ici — le manifeste du thème
# la porte, le builder RP la lit dans data/raw/extracted) dans la forme brute
# du thème : UNE LISTE nommée (communes / transactions / dpe) que
# construire_territoires_habitat() consomme. Idempotent par construction,
# comme les builders des sources.
construire_donnees_habitat <- function(cache = "data/raw") {
  extrait <- file.path(cache, "extracted")
  if (!dir.exists(extrait)) dir.create(extrait, recursive = TRUE)

  # la base des EPCI est partagée entre les thèmes : le manifeste du thème la
  # télécharge, on l'extrait ici (idempotent) pour le builder RP qui la lit
  zip_epci <- MANIFEST_HABITAT$fichier[MANIFEST_HABITAT$id == "epci"]
  suppressWarnings(
    utils::unzip(file.path(cache, zip_epci), exdir = extrait, overwrite = FALSE)
  )

  list(
    communes = construire_donnees_brut_rp(cache = cache),
    transactions = construire_transactions_dvf(cache = cache),
    dpe = construire_dpe_processe(cache = cache)
  )
}

# La construction de la table des territoires du thème ------------------------
# Le squelette partagé (squelette_territoires, compute.R) fournit les codes,
# les vrais noms, la hiérarchie et la règle de pluralité départementale ; le
# thème ajoute SES colonnes d'agrégation :
#   - les colonnes de stock RP, sommées par niveau de territoire (le pattern
#     Démographie — les comptes de logements se somment) ;
#   - les colonnes ISSUES DES POINTS (DVF, DPE) : chaque transaction / DPE est
#     étendue à TOUS ses territoires (commune + EPCI + département + région),
#     puis les médianes prix/m², les parts A–G et les n sont calculés PAR
#     TERRITOIRE — les indicateurs d'échantillon ne passent jamais par la table
#     agrégée des communes.

# COLONNES_HABITAT_RP ---------------------------------------------------------
# Les colonnes de mesure du stock RP, sommées par niveau de territoire.
COLONNES_HABITAT_RP <- c(
  "logements", "logements_principales", "logements_secondaires",
  "logements_vacants",
  "statut_proprietaire", "statut_hlm", "statut_locataire_prive",
  "statut_loge_gratuit",
  "bati_lt1919", "bati_1919_1945", "bati_1946_1970",
  "bati_1971_1990", "bati_1991_2005", "bati_2006_plus",
  "type_maison", "type_appartement"
)

# agreger_territoires_habitat : la part du thème côté stock — les comptes RP,
# agrégés par niveau de territoire (même structure que Démographie), rejoints
# sur le squelette partagé par code.
agreger_territoires_habitat <- function(communes, squelette) {
  base <- communes %>%
    dplyr::mutate(dplyr::across(c(departement, epci), as.character))

  mesures <- dplyr::bind_rows(
    base[c("code", COLONNES_HABITAT_RP)],
    base %>%
      dplyr::group_by(epci) %>%
      dplyr::summarise(
        dplyr::across(dplyr::all_of(COLONNES_HABITAT_RP), sum),
        .groups = "drop"
      ) %>%
      dplyr::rename(code = epci),
    base %>%
      dplyr::group_by(departement) %>%
      dplyr::summarise(
        dplyr::across(dplyr::all_of(COLONNES_HABITAT_RP), sum),
        .groups = "drop"
      ) %>%
      dplyr::rename(code = departement),
    base %>%
      dplyr::summarise(
        dplyr::across(dplyr::all_of(COLONNES_HABITAT_RP), sum),
        .groups = "drop"
      ) %>%
      dplyr::mutate(code = "53")
  )

  dplyr::left_join(squelette, mesures, by = "code")
}

# etendre_points --------------------------------------------------------------
# L'astuce du point-par-territoire (spec #12) : chaque ligne point (transaction
# DVF, DPE) est étendue en UNE ligne par territoire auquel elle appartient —
# sa commune, son EPCI, son département et la région — via le référentiel des
# communes (celui du squelette). Une ligne dont la commune est inconnue du
# référentiel (hors Bretagne, ou commune non couverte) tombe — la garde du
# schéma, comme la jointure EPCI côté Démographie.
etendre_points <- function(points, communes, colonne_commune) {
  liens <- communes %>%
    dplyr::transmute(
      !!colonne_commune := as.character(code),
      epci = as.character(epci),
      departement = as.character(departement),
      region = "53"
    )
  points %>%
    dplyr::left_join(liens, by = colonne_commune) %>%
    dplyr::filter(!is.na(epci)) %>%
    tidyr::pivot_longer(
      cols = dplyr::all_of(c(colonne_commune, "epci", "departement", "region")),
      names_to = "niveau",
      values_to = "territoire"
    ) %>%
    dplyr::select(-niveau)
}

# agreger_dvf_par_territoire --------------------------------------------------
# Le prix/m² par mutation (une ligne = une mutation après dédupe, #15), étendu
# à tous ses territoires, puis :
#   - la médiane POOLÉE (toutes années de la fenêtre confondues — le headline
#     classé) et son n (le nombre de mutations) ;
#   - une médiane par année de la fenêtre (la série d'évolution) et son n ;
#   - suppression : n < 10 -> la valeur devient NA (le n, lui, est publié) ;
#   - un territoire sans transaction reçoit n = 0 (une absence est une
#     observation de zéro — jamais NA inventé), donc des valeurs NA.
agreger_dvf_par_territoire <- function(transactions, communes) {
  tx <- transactions %>%
    dplyr::mutate(prix_m2 = valeur_fonciere / surface_reelle_bati) %>%
    # le département vient du référentiel EPCI (évite la collision de noms dans
    # la jointure) — la colonne du reshape est dérivée du code commune
    dplyr::select(-departement)

  longs <- etendre_points(tx, communes, "code_commune")

  ns_annees <- longs %>%
    dplyr::count(territoire, annee)
  ns_pool <- longs %>%
    dplyr::count(territoire)
  med_annees <- longs %>%
    dplyr::group_by(territoire, annee) %>%
    dplyr::summarise(median = stats::median(prix_m2), .groups = "drop")
  med_pool <- longs %>%
    dplyr::group_by(territoire) %>%
    dplyr::summarise(median = stats::median(prix_m2), .groups = "drop")

  codes <- sort(unique(c(ns_pool$territoire, communes$code,
                         communes$epci, communes$departement, "53")))

  # le bloc poolé : la ligne « detail = NA »
  pool <- tibble::tibble(territoire = codes) %>%
    dplyr::left_join(ns_pool, by = "territoire") %>%
    dplyr::left_join(med_pool, by = "territoire") %>%
    dplyr::transmute(
      code = territoire,
      # un territoire sans transaction reçoit n = 0 (une absence est une
      # observation de zéro, jamais NA) — et donc une valeur supprimée
      prix_m2_n = dplyr::coalesce(n, 0L),
      prix_m2_median = dplyr::if_else(dplyr::coalesce(n, 0L) < 10,
                                      NA_real_, median)
    )

  # le bloc par année : une paire de colonnes par année de la fenêtre
  annees <- lapply(ANNEE_DVF, function(a) {
    tibble::tibble(territoire = codes) %>%
      dplyr::left_join(ns_annees[ns_annees$annee == a, ], by = "territoire") %>%
      dplyr::left_join(med_annees[med_annees$annee == a, ], by = "territoire") %>%
      dplyr::transmute(
        code = territoire,
        !!paste0("prix_m2_", a, "_n") := dplyr::coalesce(n, 0L),
        !!paste0("prix_m2_", a, "_median") :=
          dplyr::if_else(dplyr::coalesce(n, 0L) < 10, NA_real_, median)
      )
  })

  # la jointure en chaîne des blocs par année sur le bloc poolé (pas de purrr)
  bloc <- pool
  for (a in annees) bloc <- dplyr::left_join(bloc, a, by = "code")
  bloc
}

# agreger_dpe_par_territoire --------------------------------------------------
# Les DPE (une ligne par logement-équivalent, `poids`, #16) étendus à tous
# leurs territoires, puis les parts pondérées par étiquette A–G, la part F/G et
# le n (la somme des poids — le nombre d'équivalents-logements). Suppression :
# n < 30 -> toutes les valeurs NA (le n, lui, est publié). Un territoire sans
# DPE reçoit n = 0 et des parts NA.
agreger_dpe_par_territoire <- function(dpe, communes) {
  longs <- etendre_points(dpe, communes, "code_insee_ban")

  totaux <- longs %>%
    dplyr::group_by(territoire) %>%
    dplyr::summarise(n = sum(poids), .groups = "drop")
  parts <- longs %>%
    dplyr::group_by(territoire, etiquette_dpe) %>%
    dplyr::summarise(p = sum(poids), .groups = "drop")

  codes <- sort(unique(c(totaux$territoire, communes$code,
                         communes$epci, communes$departement, "53")))

  large <- parts %>%
    # les étiquettes manquantes d'un territoire (aucun DPE F, etc.) comptent 0
    tidyr::complete(
      territoire = codes, etiquette_dpe = c("A", "B", "C", "D", "E", "F", "G"),
      fill = list(p = 0)
    ) %>%
    dplyr::left_join(totaux, by = "territoire") %>%
    dplyr::mutate(
      # un territoire sans DPE reçoit n = 0 (une absence est une observation
      # de zéro) — et des parts supprimées
      n = dplyr::coalesce(n, 0L),
      part = dplyr::if_else(n < 30, NA_real_, p / n)
    )

  # la part F/G : la somme des deux queues, depuis les parts déjà supprimées
  fg <- large %>%
    dplyr::filter(etiquette_dpe %in% c("F", "G")) %>%
    dplyr::group_by(territoire, n) %>%
    dplyr::summarise(part_fg = sum(part), .groups = "drop")

  large %>%
    tidyr::pivot_wider(
      id_cols = c(territoire, n),
      names_from = etiquette_dpe,
      values_from = part,
      names_prefix = "dpe_share_"
    ) %>%
    dplyr::left_join(fg, by = c("territoire", "n")) %>%
    dplyr::rename(code = territoire, dpe_n = n)
}

# construire_territoires_habitat ---------------------------------------------
# Une ligne par territoire (communes + agrégats EPCI / département / région),
# mêmes colonnes partout : le squelette partagé + les colonnes d'agrégation du
# thème (stock RP sommé + points DVF/DPE agrégés par territoire). Une fois que
# chaque territoire est une ligne d'une seule table, les constructeurs
# d'indicateurs s'appliquent uniformément.
construire_territoires_habitat <- function(donnees) {
  communes <- donnees$communes
  # la table RP Logements ne porte pas la population : la pluralité
  # départementale d'un EPCI est pesée par SON stock de logements
  # (le « poids » du thème — même règle, autre mesure)
  squelette <- squelette_territoires(communes, poids = "logements")

  agreger_territoires_habitat(communes, squelette) %>%
    dplyr::left_join(
      agreger_dvf_par_territoire(donnees$transactions, communes),
      by = "code"
    ) %>%
    dplyr::left_join(
      agreger_dpe_par_territoire(donnees$dpe, communes),
      by = "code"
    )
}

# Les constructeurs d'indicateurs ---------------------------------------------
# Mêmes entrées (la table des territoires), mêmes sorties : une table longue
# code, key, detail, value, unit, n. `detail` ne sert qu'aux multi-valeurs ;
# `n` porte le nombre d'observations pour les indicateurs d'échantillon (DVF,
# DPE) et vaut NA pour les indicateurs de stock.

# 1. Mix de logements : les parts des trois catégories (principales /
# secondaires / vacants) sur le total des logements. Indicateur de stock :
# n = NA. Le scalaire classé est la part de secondaires (documenté, Méthodes).
indicator_mix_logements <- function(territoires) {
  territoires %>%
    tidyr::pivot_longer(
      cols = c(logements_principales, logements_secondaires, logements_vacants),
      names_to = "categorie",
      values_to = "effectif"
    ) %>%
    dplyr::mutate(
      key = "mix_logements",
      detail = sub("^logements_", "", categorie),
      value = effectif / logements,
      unit = "%",
      n = NA_real_
    ) %>%
    dplyr::select(code, key, detail, value, unit, n)
}

# 2. Statut d'occupation : les QUATRE parts (propriétaire / HLM — le parc
# social — / locataire du parc privé / logé gratuitement) en part des
# résidences principales (issue #368 — le split de l'ancienne clé à 14
# modalités, la taille et l'ancienneté quittent le payload). Indicateur de
# stock : n = NA. Le scalaire classé est la part HLM (documenté, Méthodes).
indicator_statut <- function(territoires) {
  territoires %>%
    tidyr::pivot_longer(
      cols = c(statut_proprietaire, statut_hlm, statut_locataire_prive,
               statut_loge_gratuit),
      names_to = "categorie",
      values_to = "effectif"
    ) %>%
    dplyr::mutate(
      key = "statut",
      detail = sub("^statut_", "", categorie),
      value = effectif / logements_principales,
      unit = "%",
      n = NA_real_
    ) %>%
    dplyr::select(code, key, detail, value, unit, n)
}

# 3. Âge du bâti : les SIX tranches de la période d'achèvement (RP BUILD_END,
# issue #368) en part du stock dont la période est CONNUE (la somme des six
# tranches — le résidu « période inconnue » du RP, ~2,3 % des RP en Bretagne,
# est un fait de la donnée, jamais une part fabriquée sur un total qui ne
# ferme pas : la composition des âges s'affiche sur l'univers connu).
# Indicateur de stock : n = NA. Le scalaire classé est la part du parc d'avant
# 1971 (les trois tranches les plus anciennes — le stock d'avant la première
# réglementation thermique, la tension DPE ; low-is-good).
indicator_age_du_bati <- function(territoires) {
  # le stock dont la période est connue : la somme des six tranches, calculée
  # AVANT le pivot (les colonnes bati_* n'existent plus une fois en long) et
  # rejointes par code — jamais un recyclage de vecteur qui mélangerait les
  # communes
  connu <- tibble::tibble(
    code = territoires$code,
    connu = territoires$bati_lt1919 + territoires$bati_1919_1945 +
      territoires$bati_1946_1970 + territoires$bati_1971_1990 +
      territoires$bati_1991_2005 + territoires$bati_2006_plus
  )

  territoires %>%
    tidyr::pivot_longer(
      cols = c(bati_lt1919, bati_1919_1945, bati_1946_1970,
               bati_1971_1990, bati_1991_2005, bati_2006_plus),
      names_to = "tranche",
      values_to = "effectif"
    ) %>%
    dplyr::left_join(connu, by = "code") %>%
    dplyr::mutate(
      key = "age_du_bati",
      detail = sub("^bati_", "", tranche),
      value = effectif / connu,
      unit = "%",
      n = NA_real_
    ) %>%
    dplyr::select(code, key, detail, value, unit, n)
}

# 4. Type de logement : les parts maison / appartement (RP TDW, issue #368)
# sur l'univers (maison + appartement) — la famille « autres logements de
# métropole » (3T6, ~0,7 %) écartée comme les dépendances côté DVF : les deux
# parts somment à 1. Indicateur de stock : n = NA. Le scalaire classé est la
# part d'appartements (high-is-good).
indicator_type <- function(territoires) {
  # l'univers (maison + appartement) par code, rejoint AVANT le pivot — la
  # famille « autres » (3T6) est écartée, les deux parts somment à 1
  univers <- tibble::tibble(
    code = territoires$code,
    univers_type = territoires$type_maison + territoires$type_appartement
  )

  territoires %>%
    tidyr::pivot_longer(
      cols = c(type_maison, type_appartement),
      names_to = "categorie",
      values_to = "effectif"
    ) %>%
    dplyr::left_join(univers, by = "code") %>%
    dplyr::mutate(
      key = "type",
      detail = sub("^type_", "", categorie),
      value = effectif / univers_type,
      unit = "%",
      n = NA_real_
    ) %>%
    dplyr::select(code, key, detail, value, unit, n)
}

# 5. Médiane du prix au m² : une ligne poolée (detail = NA, le headline classé)
# + une ligne par année de la fenêtre (la série d'évolution). Les valeurs et
# les n viennent de la table des territoires (déjà supprimées : n < 10 -> NA).
indicator_prix_m2 <- function(territoires) {
  pool <- tibble::tibble(
    code = territoires$code,
    key = "prix_m2",
    detail = NA_character_,
    value = territoires$prix_m2_median,
    unit = "€/m²",
    n = territoires$prix_m2_n
  )
  annees <- lapply(ANNEE_DVF, function(a) {
    tibble::tibble(
      code = territoires$code,
      key = "prix_m2",
      detail = as.character(a),
      value = territoires[[paste0("prix_m2_", a, "_median")]],
      unit = "€/m²",
      n = territoires[[paste0("prix_m2_", a, "_n")]]
    )
  })
  dplyr::bind_rows(pool, annees)
}

# 6a. Part de passoires thermiques : le scalaire F/G (classé), déjà supprimé
# (n < 30 -> NA) ; n = le nombre d'équivalents-logements (somme des poids).
indicator_part_passoires <- function(territoires) {
  tibble::tibble(
    code = territoires$code,
    key = "part_passoires",
    detail = NA_character_,
    value = territoires$part_fg,
    unit = "%",
    n = territoires$dpe_n
  )
}

# 6b. Distribution des étiquettes DPE : les parts A–G, la donnée du graphique.
# Les parts viennent de la table des territoires (déjà supprimées si n < 30) ;
# n est répété sur les 7 lignes.
indicator_distribution_dpe <- function(territoires) {
  territoires %>%
    tidyr::pivot_longer(
      cols = c(dpe_share_A, dpe_share_B, dpe_share_C, dpe_share_D,
               dpe_share_E, dpe_share_F, dpe_share_G),
      names_to = "etiquette",
      values_to = "value"
    ) %>%
    dplyr::mutate(
      key = "distribution_dpe",
      detail = sub("^dpe_share_", "", etiquette),
      unit = "%",
      n = dpe_n
    ) %>%
    dplyr::select(code, key, detail, value, unit, n)
}

# construire_indicateurs_habitat : le thème déclare SES constructeurs — la
# liste nommée des tables longues que compute_payload() assemble.
construire_indicateurs_habitat <- function(territoires) {
  list(
    mix_logements = indicator_mix_logements(territoires),
    statut = indicator_statut(territoires),
    age_du_bati = indicator_age_du_bati(territoires),
    type = indicator_type(territoires),
    prix_m2 = indicator_prix_m2(territoires),
    part_passoires = indicator_part_passoires(territoires),
    distribution_dpe = indicator_distribution_dpe(territoires)
  )
}

# Les scalaires de classement du thème ----------------------------------------
# Le scalaire classé par indicateur : la valeur elle-même pour les scalaires,
# et pour les multi-valeurs la composante signature du classement (documenté,
# Méthodes — l'audit ordinal de l'issue #368) :
#   - mix_logements          -> la part de résidences principales (plus de
#                               logements occupés, mieux — high-is-good) ;
#   - statut                 -> la part HLM (le parc social — high-is-good) ;
#   - age_du_bati            -> la part du parc d'avant 1971 (les trois
#                               tranches les plus anciennes — le stock d'avant
#                               la première réglementation thermique, la
#                               tension DPE — low-is-good) ;
#   - type                   -> la part d'appartements (high-is-good) ;
#   - prix_m2                -> la médiane poolée (déjà NA si n < 10 : le rang
#                               suit la suppression) — low-is-good (un prix
#                               élevé pèse sur l'accès au logement) ;
#   - distribution_dpe       -> la part F/G (la composante signature du
#                               graphique — même classement que part_passoires) ;
#   - part_passoires         -> la part F/G (héritée de la valeur).
scalaires_habitat <- list(
  mix_logements = function(territoires) {
    territoires$logements_principales / territoires$logements
  },
  statut = function(territoires) {
    territoires$statut_hlm / territoires$logements_principales
  },
  age_du_bati = function(territoires) {
    connu <- territoires$bati_lt1919 + territoires$bati_1919_1945 +
      territoires$bati_1946_1970 + territoires$bati_1971_1990 +
      territoires$bati_1991_2005 + territoires$bati_2006_plus
    (territoires$bati_lt1919 + territoires$bati_1919_1945 +
       territoires$bati_1946_1970) / connu
  },
  type = function(territoires) {
    territoires$type_appartement /
      (territoires$type_maison + territoires$type_appartement)
  },
  prix_m2 = function(territoires) {
    territoires$prix_m2_median
  },
  part_passoires = function(territoires) {
    territoires$part_fg
  },
  distribution_dpe = function(territoires) {
    territoires$part_fg
  }
)

# compute_histoires_habitat ---------------------------------------------------
# L'Histoire « L'état énergétique du parc » — la classification DÉTERMINISTE de
# la distribution DPE du territoire (spec #12, issue #18) : exactement une des
# quatre lectures, calculées DANS L'ORDRE :
#   1. parc-heterogene      — A/B/C >= 25 % ET F/G >= 25 % (bimodal : un
#                              territoire à deux visages — vérifié EN PREMIER) ;
#   2. passoire-energetique — sinon F/G >= 30 % (la queue F/G domine) ;
#   3. parc-performant      — sinon A/B/C >= 50 % (concentré sur le bon bout) ;
#   4. parc-intermediaire   — le résidu : un stock du milieu (C/D/E).
# Les parts viennent des colonnes d'agrégation #17 de la table des territoires
# (dpe_share_A..G, part_fg — la part F/G = F + G, part_abc = A + B + C) ; elles
# sont déjà supprimées sous n < 30 (la même règle que l'indicateur) : quand
# n_dpe < 30, la classification ET les parts de justification sont NA — le n,
# lui, est publié. Seuils 25 / 30 / 50 % PROVISOIRES : fixés au premier run
# réel (point de contrôle documenté, spec #12 « Further Notes » — si une
# lecture s'effondre ou qu'un département entier tombe dans une, revoir).
# Contrat déterministe : même territoire + mêmes données -> même lecture,
# toujours.
compute_histoires_habitat <- function(territoires) {
  territoires %>%
    dplyr::mutate(
      part_abc = dpe_share_A + dpe_share_B + dpe_share_C,
      classification = dplyr::case_when(
        # suppression (n < 30) : les parts sont NA — la classification aussi
        is.na(part_fg) | is.na(part_abc) ~ NA_character_,
        # 1. parc hétérogène : les deux extrémités présentes (vérifié 1er)
        part_abc >= 0.25 & part_fg >= 0.25 ~ "parc-heterogene",
        # 2. sinon passoire énergétique : la queue F/G >= 30 %
        part_fg >= 0.30 ~ "passoire-energetique",
        # 3. sinon parc performant : A/B/C >= 50 %
        part_abc >= 0.50 ~ "parc-performant",
        # 4. sinon le résidu : un stock du milieu (C/D/E)
        TRUE ~ "parc-intermediaire"
      )
    ) %>%
    dplyr::transmute(
      territoire = code,
      type = type,
      theme = "habitat",
      story_key = "etat-energetique-du-parc",
      classification,
      part_passoires = part_fg,
      part_abc,
      n_dpe = dpe_n
    )
}

# Les validations spécifiques au thème ----------------------------------------
# Les vérifications de valeur propres à Habitat (point 7) : le thème les
# déclare, validate_payload() les exécute après ses vérifications génériques.
validations_habitat <- list(
  # mix de logements : les parts somment à 1 par territoire
  function(payload) {
    parts <- stats::aggregate(
      value ~ territoire,
      payload$indicateurs[payload$indicateurs$key == "mix_logements", ],
      sum
    )
    if (any(abs(parts$value - 1) > 1e-6)) {
      stop("Payload invalide : les parts de mix ne somment pas à 1.",
           call. = FALSE)
    }
    invisible(payload)
  },
  # statut / âge du bâti / type : chaque clé SOMME à 1 par territoire (issue
  # #368 — les quatre parts de statut et les deux parts de type partitionnent
  # les RP ; les six tranches d'âge somment à 1 sur le stock connu)
  function(payload) {
    for (cle in c("statut", "age_du_bati", "type")) {
      tab <- payload$indicateurs[payload$indicateurs$key == cle, ]
      parts <- stats::aggregate(value ~ territoire, tab, sum)
      if (any(abs(parts$value - 1) > 1e-6)) {
        stop("Payload invalide : les parts de « ", cle,
             " » ne somment pas à 1.", call. = FALSE)
      }
    }
    invisible(payload)
  },
  # distribution DPE : les parts A–G somment à 1 par territoire (quand elles
  # ne sont pas supprimées — les lignes NA sont écartées)
  function(payload) {
    tab <- payload$indicateurs[
      payload$indicateurs$key == "distribution_dpe" &
        !is.na(payload$indicateurs$value), ]
    if (nrow(tab) > 0) {
      parts <- stats::aggregate(value ~ territoire, tab, sum)
      if (any(abs(parts$value - 1) > 1e-6)) {
        stop("Payload invalide : la distribution DPE ne somme pas à 1.",
             call. = FALSE)
      }
    }
    invisible(payload)
  },
  # prix au m² : non négatif quand il n'est pas supprimé
  function(payload) {
    px <- payload$indicateurs$value[payload$indicateurs$key == "prix_m2"]
    if (any(!is.na(px) & px < 0)) {
      stop("Payload invalide : un prix au m² négatif.", call. = FALSE)
    }
    invisible(payload)
  }
)

# Le builder de vintages du thème ---------------------------------------------
# Les vintages se projettent depuis le manifeste (vintages_depuis_manifest,
# vintage.R). Les sources DPE sont une base ROULANTE : leur vintage est la date
# du pull — lue sur le cache (.rds écrit au pull). Tant que le pull n'a pas eu
# lieu (premier run), les dates restent NA : honnête, jamais inventé.
vintages_habitat <- function(cache = "data/raw") {
  v <- vintages_depuis_manifest(MANIFEST_HABITAT)
  dpe_ids <- MANIFEST_HABITAT$id[MANIFEST_HABITAT$type == "api"]
  for (id in dpe_ids) {
    chemin <- file.path(cache, MANIFEST_HABITAT$fichier[MANIFEST_HABITAT$id == id])
    if (file.exists(chemin)) {
      date_pull <- as.character(as.Date(file.info(chemin)$mtime))
      v$version[v$id == id] <- date_pull
      v$date_publication[v$id == id] <- date_pull
    }
  }
  v
}

# APERCU_HABITAT ---------------------------------------------------------------
# La table déclarative des clés de l'Aperçu du thème Habitat (issue #32,
# ADR-0007) : VIDE — le gating par thème. Habitat ne déclare aucune clé
# aujourd'hui : ses stats de base de l'Aperçu n'existent pas encore, la table
# `apercu` du payload d'un run Habitat est présente mais vide (jamais un
# « under construction »). Les clés Habitat s'ajouteront ici quand le thème
# les définira.
APERCU_HABITAT <- tibble::tibble(
  key = character(),
  libelle = character(),
  multiplicite = integer()
)

construire_apercu_habitat <- function(territoires) {
  list()
}

# theme_habitat ---------------------------------------------------------------
# Le descripteur du thème Habitat : la même forme de contrat que
# theme_demographie(), avec les pièces du thème.
theme_habitat <- function() {
  list(
    theme = "habitat",
    manifest = MANIFEST_HABITAT,
    indicateurs = INDICATEURS_HABITAT,
    apercu = APERCU_HABITAT,
    vintages = vintages_habitat,
    construire_donnees = construire_donnees_habitat,
    construire_territoires = construire_territoires_habitat,
    construire_indicateurs = construire_indicateurs_habitat,
    construire_apercu = construire_apercu_habitat,
    scalaires = scalaires_habitat,
    # la désirabilité par clé (ADR-0015, l'audit ordinal de l'issue #368) —
    # AUCUNE clé ne se repose sur le défaut high-is-good, chaque clé classée
    # déclare SA direction :
    #   - low-is-good : la part de passoires et la distribution DPE (le même
    #     fait, la précarité énergétique), l'âge du bâti (classé par la part du
    #     parc d'avant 1971 — le vieux stock est dur à isoler, la tension DPE)
    #     et le prix au m² (un prix élevé pèse sur l'accès au logement) ;
    #   - high-is-good : le mix (classé par la part de résidences principales —
    #     plus de logements occupés, mieux), le statut (classé par la part HLM
    #     — plus de logement social, mieux) et le type (classé par la part
    #     d'appartements).
    directions = list(
      mix_logements = "high",
      statut = "high",
      age_du_bati = "low",
      type = "high",
      prix_m2 = "low",
      part_passoires = "low",
      distribution_dpe = "low"
    ),
    compute_histoires = compute_histoires_habitat,
    validations = validations_habitat,
    # Issue #311 : les métadonnées du thème (le fichier épinglé
    # inst/extdata/theme-metadata/) — publiées par run_pipeline après le
    # payload, jamais un recompute des tables de faits
    metadata = function() lire_theme_metadata("habitat")
  )
}
