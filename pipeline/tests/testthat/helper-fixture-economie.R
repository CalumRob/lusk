# helper-fixture-economie -------------------------------------------------------
# Fixtures analytiques déjà utilisées par le test de run du thème Économie.
# Elles sont partagées avec les tests de contrats qui ont besoin de faits issus
# du vrai assembleur de payload, sans dépendre d'une ancienne projection JSON.

base_epci_economie <- tibble::tribble(
  ~CODGEO, ~LIBGEO, ~EPCI, ~LIBEPCI, ~DEP, ~REG,
  "22001", "Commune A1", "200000001", "EPCI X", "22", "53",
  "22002", "Commune D", "200000001", "EPCI X", "22", "53",
  "29001", "Commune B", "200000002", "EPCI Y", "29", "53",
  "29002", "Commune C", "200000002", "EPCI Y", "29", "53"
)

fixture_analytiques_economie <- function() {
  lq <- tibble::tribble(
    ~commune, ~activity_code, ~activity_label, ~lq, ~n, ~n_c, ~n_a,
    ~rang_epci, ~rang_dep, ~rang_reg,
    "22001", "A", "Activité A", 1.5, 2, 10, 6, 0.5, 0.5, 0.4,
    "22001", "B", "Activité B", 0.5, 3, 10, 8, 0.0, 0.0, 0.0,
    "22001", "C", "Activité C", 1.2, 2, 10, 4, 0.5, 0.5, 0.4,
    "22002", "A", "Activité A", 1.0, 4, 10, 6, 0.5, 0.5, 0.4,
    "22002", "B", "Activité B", 1.2, 5, 10, 8, 0.5, 0.5, 0.4,
    "22002", "C", "Activité C", 0.8, 3, 10, 4, 0.0, 0.0, 0.0,
    "29001", "A", "Activité A", 0.8, 6, 10, 6, 0.5, 0.5, 0.4,
    "29001", "B", "Activité B", 1.8, 7, 10, 8, 0.5, 0.5, 0.4,
    "29001", "C", "Activité C", 1.1, 4, 10, 4, 0.5, 0.5, 0.4,
    "29002", "A", "Activité A", 1.1, 8, 10, 6, 0.5, 0.5, 0.4,
    "29002", "B", "Activité B", 0.9, 9, 10, 8, 0.5, 0.5, 0.4,
    "29002", "C", "Activité C", 1.4, 3, 10, 4, 0.5, 0.5, 0.4
  )
  eco <- tibble::tribble(
    ~commune, ~departement, ~n_etablissements, ~n_eco, ~n_eco_100, ~n_eco_partial,
    ~part_economie_verte, ~rang_epci, ~rang_dep, ~rang_reg,
    "22001", "22", 10, 4, 3, 1, 0.4, 0.5, 0.5, 0.4,
    "22002", "22", 10, 5, 4, 1, 0.5, 0.5, 0.5, 0.4,
    "29001", "29", 10, 6, 5, 1, 0.6, 0.5, 0.5, 0.4,
    "29002", "29", 10, 7, 6, 1, 0.7, 0.5, 0.5, 0.4
  )
  dortoir <- tibble::tribble(
    ~commune, ~departement, ~workplace, ~resident, ~ratio, ~classification,
    "22001", "22", 2, 10, 0.2, "dortoir-profond",
    "22002", "22", 6, 10, 0.6, "equilibre",
    "29001", "29", 8, 10, 0.8, "equilibre",
    "29002", "29", 7, 10, 0.7, "equilibre"
  )
  chomage <- tibble::tribble(
    ~commune, ~departement, ~chomeurs, ~actifs_occupes, ~population_active,
    ~taux_chomage, ~rang_epci, ~rang_dep, ~rang_reg,
    "22001", "22", 2, 8, 10, 0.2, 0.5, 0.5, 0.4,
    "22002", "22", 1, 9, 10, 0.1, 0.0, 0.0, 0.0,
    "29001", "29", 3, 7, 10, 0.3, 0.5, 0.5, 0.4,
    "29002", "29", 4, 6, 10, 0.4, 0.5, 0.5, 0.4
  )
  histoires_lq <- lq %>%
    dplyr::select(commune, activity_code, activity_label, lq, n) %>%
    dplyr::group_by(commune) %>%
    dplyr::arrange(dplyr::desc(lq), activity_code, .by_group = TRUE) %>%
    dplyr::mutate(rang = dplyr::row_number()) %>%
    dplyr::ungroup() %>%
    dplyr::select(commune, rang, activity_code, activity_label, lq, n)

  effectifs <- dortoir %>% dplyr::transmute(commune, effectifs_salaries = workplace)

  list(
    lq = lq,
    histoires_lq = histoires_lq,
    m = tibble::tibble(commune = character(), activity_code = character(), m = integer()),
    lq_emploi_a88 = lq,
    lq_emploi_a38 = lq,
    eco_activites = eco,
    dortoir = dortoir,
    chomage = chomage,
    effectifs = effectifs,
    effectifs_territoires = agreger_effectifs_territoires(effectifs, base_epci_economie),
    chomage_territoires = agreger_chomage_territoires(chomage, base_epci_economie),
    eco_territoires = agreger_eco_territoires(eco, base_epci_economie),
    histoires = construire_histoires_economie_payload(lq, base_epci_economie)
  )
}
