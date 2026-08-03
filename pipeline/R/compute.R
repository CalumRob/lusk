# compute ---------------------------------------------------------------------
# Étape 3 : calcul. Dérive les indicateurs de la fiche, les rangs-en-contexte
# et l'Histoire. Le SEAM de test : compute_payload() — la forme tabulaire du
# payload (deux tables : indicateurs + histoires) est le contrat
# (test-contract-payload.R). Le story classifier (soldes + classification 2x2)
# arrive au ticket 4 (issue #5).

# Vintage de référence du RP — les vintages réels arrivent du manifeste au
# ticket 5 (issue #6). Ici, la source est unique et connue.
VINTAGE_RP <- list(
  source = "INSEE RP — dossier complet",
  version = "2023",
  date = "2023-01-01"
)

# build_territoires -----------------------------------------------------------
# Une ligne par territoire (communes + agrégats EPCI / département / région),
# mêmes colonnes partout. L'astuce du module profond : une fois que chaque
# territoire est une ligne d'une seule table, les constructeurs d'indicateurs
# s'appliquent uniformément — ils n'ont pas à savoir quel type de territoire
# ils calculent.
build_territoires <- function(communes) {
  base <- communes %>%
    dplyr::mutate(
      type = "commune",
      dplyr::across(c(departement, epci), as.character)
    )

  # Chaque niveau d'agrégat = un group_by + une somme des colonnes
  # démographiques (population -> menages) : l'agrégat d'un territoire est
  # la somme des lignes de ses communes.
  epcis <- base %>%
    dplyr::group_by(epci) %>%
    dplyr::summarise(
      code = dplyr::first(epci),
      nom = paste0("EPCI ", dplyr::first(epci)),
      type = "epci",
      departement = dplyr::first(departement),
      dplyr::across(population:menages, sum),
      .groups = "drop"
    )

  deps <- base %>%
    dplyr::group_by(departement) %>%
    dplyr::summarise(
      code = dplyr::first(departement),
      nom = paste0("Département ", dplyr::first(departement)),
      type = "departement",
      departement = dplyr::first(departement),
      epci = NA_character_,
      dplyr::across(population:menages, sum),
      .groups = "drop"
    )

  region <- base %>%
    dplyr::summarise(
      code = "53",
      nom = "Bretagne",
      type = "region",
      departement = NA_character_,
      epci = NA_character_,
      dplyr::across(population:menages, sum),
      .groups = "drop"
    )

  dplyr::bind_rows(base, epcis, deps, region)
}

# Les constructeurs d'indicateurs ---------------------------------------------
# Mêmes entrées (la table des territoires), mêmes sorties : une table longue
# code, key, detail, value, unit. Chaque indicateur est un petit module pur —
# la structure que les thèmes suivants réutiliseront. `detail` ne sert qu'aux
# indicateurs multi-valeurs (structure par âge : une ligne par tranche) ; il
# est NA pour les indicateurs scalaires.

indicator_densite <- function(territoires) {
  tibble::tibble(
    code = territoires$code,
    key = "densite",
    detail = NA_character_,
    value = territoires$population / territoires$superficie_km2,
    unit = "hab/km²"
  )
}

indicator_structure_age <- function(territoires) {
  territoires %>%
    tidyr::pivot_longer(
      cols = c(age_0_19, age_20_39, age_40_59, age_60_74, age_75_plus),
      names_to = "bande",
      values_to = "effectif"
    ) %>%
    dplyr::mutate(
      key = "structure_age",
      detail = dplyr::recode(
        bande,
        age_0_19 = "0-19", age_20_39 = "20-39", age_40_59 = "40-59",
        age_60_74 = "60-74", age_75_plus = "75+"
      ),
      value = effectif / population,
      unit = "%"
    ) %>%
    dplyr::select(code, key, detail, value, unit)
}

indicator_evolution <- function(territoires) {
  tibble::tibble(
    code = territoires$code,
    key = "evolution_1968",
    detail = NA_character_,
    value = (territoires$population - territoires$population_1968) /
      territoires$population_1968,
    unit = "%"
  )
}

indicator_taille_menages <- function(territoires) {
  tibble::tibble(
    code = territoires$code,
    key = "taille_menages",
    detail = NA_character_,
    value = territoires$population / territoires$menages,
    unit = "pers./ménage"
  )
}

# compute_ranks ---------------------------------------------------------------
# Les rangs-en-contexte : le percentile d'une valeur au sein de son groupe de
# comparaison. Règle documentée (Méthodes) : part strictement inférieure +
# moitié des ex æquo (autres que soi), sur le total du groupe — symétrique
# pour les égalités ; un groupe à un seul membre donne 0.
percentile_par_groupe <- function(valeurs, groupes) {
  vapply(seq_along(valeurs), function(i) {
    g <- groupes[i]
    if (is.na(g)) return(NA_real_)
    membres <- !is.na(groupes) & groupes == g
    n <- sum(membres)
    ex_aequo_autres <- sum(membres & valeurs == valeurs[i]) - 1
    (sum(membres & valeurs < valeurs[i]) + 0.5 * ex_aequo_autres) / n
  }, numeric(1))
}

# Le groupe de comparaison dépend du type de territoire (communes vs EPCIs
# ne se comparent jamais entre eux) :
#   commune      -> EPCI (ses communes), département (ses communes), région
#   EPCI         -> département (ses EPCIs), région (toutes EPCIs)
#   département  -> région (les départements)
#   région       -> aucun rang
groupes_comparaison <- function(territoires) {
  groupe_epci <- rep(NA_character_, nrow(territoires))
  est_commune <- territoires$type == "commune"
  groupe_epci[est_commune] <- territoires$epci[est_commune]

  groupe_dep <- rep(NA_character_, nrow(territoires))
  est_epci <- territoires$type == "epci"
  groupe_dep[est_commune] <- paste0("commune|", territoires$departement[est_commune])
  groupe_dep[est_epci] <- paste0("epci|", territoires$departement[est_epci])

  groupe_reg <- rep(NA_character_, nrow(territoires))
  groupe_reg[est_commune] <- "communes"
  groupe_reg[est_epci] <- "epcis"
  groupe_reg[territoires$type == "departement"] <- "departements"

  list(epci = groupe_epci, dep = groupe_dep, reg = groupe_reg)
}

# Le scalaire classé par indicateur : la valeur elle-même, sauf la structure
# par âge classée par la part des moins de 20 ans (documenté, Méthodes).
scalaire_indic <- function(tab) {
  if ("detail" %in% names(tab) && any(tab$detail == "0-19", na.rm = TRUE)) {
    tab$value[tab$detail == "0-19"]
  } else {
    tab$value
  }
}

compute_ranks <- function(territoires, indicateurs) {
  groupes <- groupes_comparaison(territoires)

  lapply(names(indicateurs), function(cle) {
    tab <- indicateurs[[cle]]
    scalaire <- scalaire_indic(tab)
    tibble::tibble(
      code = unique(tab$code),
      key = cle,
      rang_epci = percentile_par_groupe(scalaire, groupes$epci),
      rang_dep = percentile_par_groupe(scalaire, groupes$dep),
      rang_reg = percentile_par_groupe(scalaire, groupes$reg)
    )
  }) %>% stats::setNames(names(indicateurs))
}

# assemble_payload ------------------------------------------------------------
# Deux tables, le contrat : indicateurs (une ligne par territoire x clé, détail
# pour les multi-valeurs) et histoires (une ligne par territoire). C'est aussi
# le schéma Supabase — rien de plus, rien de moins (docs/architecture.md).

assembler_indicateurs <- function(territoires, indicateurs, rangs) {
  lapply(names(indicateurs), function(cle) {
    dplyr::left_join(indicateurs[[cle]], rangs[[cle]], by = c("code", "key"))
  }) %>%
    dplyr::bind_rows() %>%
    dplyr::left_join(territoires[c("code", "type")], by = "code") %>%
    dplyr::rename(territoire = code) %>%
    dplyr::mutate(
      theme = "demographie",
      vintage_source = VINTAGE_RP$source,
      vintage_version = VINTAGE_RP$version,
      vintage_date = VINTAGE_RP$date
    ) %>%
    dplyr::select(territoire, type, theme, key, detail, value, unit,
                  rang_epci, rang_dep, rang_reg,
                  vintage_source, vintage_version, vintage_date)
}

assembler_histoires <- function(territoires) {
  tibble::tibble(
    territoire = territoires$code,
    type = territoires$type,
    theme = "demographie",
    story_key = "attractive-ou-fertile",
    solde_naturel = NA_real_,
    solde_migratoire = NA_real_,
    classification = NA_character_
  )
}

# compute_payload -------------------------------------------------------------
# LE SEAM. Données filtrées (forme du fixture) -> payload de la fiche.
compute_payload <- function(data) {
  territoires <- build_territoires(data)
  indicateurs <- list(
    densite = indicator_densite(territoires),
    structure_age = indicator_structure_age(territoires),
    evolution_1968 = indicator_evolution(territoires),
    taille_menages = indicator_taille_menages(territoires)
  )
  rangs <- compute_ranks(territoires, indicateurs)

  list(
    indicateurs = assembler_indicateurs(territoires, indicateurs, rangs),
    histoires = assembler_histoires(territoires)
  )
}
