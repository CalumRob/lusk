# helper-fixture-habitat -------------------------------------------------------
# Le jeu de données synthétique du thème Habitat (issue #17, étendu #18) : la
# même trame que le fixture Démographie (6 communes / 2 EPCIs / 2 départements /
# région) étendue aux trois sources Habitat, DANS LA FORME des tables processées
# que construire_donnees_habitat() assemble (les reshape/nettoyages #14/#15/#16
# sont testés par leurs propres tests ; ici on consomme LEUR sortie) :
#   - communes   : la table du stock RP Logements (une ligne par commune,
#                  habitat-rp-fixture.csv) ;
#   - transactions : la table des mutations DVF dédupliquées (une ligne par
#                  mutation, habitat-dvf-fixture.csv) ;
#   - dpe        : la table DPE processée — le fixture brut (habitat-dpe-
#                  fixture.csv) passe par nettoyer_dpe() dans le helper, comme
#                  le fait le pipeline réel (construire_dpe_processe) : les cas
#                  de dédoublonnage et de pondération des immeubles arrivent
#                  au compute VRAIMENT résolus, pas préparés à la main.
# Le jeu couvre : un ex æquo de médiane prix/m² (A1/C), un cas n < 10 (D),
# un cas poolé-vs-année (B), un cas n < 30 (D), un immeuble pondéré poids > 1
# (IMM-B1 poids 20, IMM-B2 10 - 1), un dédoublonnage (M-C1 remplacé par M-C2) —
# et, depuis l'issue #18, les QUATRE lectures de l'état énergétique du parc :
# A1 intermédiaire, B hétérogène, E (22003) performant, F (22004) passoire,
# D (22002) le cas n < 30 supprimé.

load_fixture_habitat <- function() {
  communes <- readr::read_csv(
    testthat::test_path("fixtures", "habitat-rp-fixture.csv"),
    col_types = readr::cols(
      code = readr::col_character(),
      departement = readr::col_character(),
      epci = readr::col_character()
    ),
    show_col_types = FALSE
  )
  transactions <- readr::read_csv(
    testthat::test_path("fixtures", "habitat-dvf-fixture.csv"),
    col_types = readr::cols(
      id_mutation = readr::col_character(),
      code_commune = readr::col_character(),
      date_mutation = readr::col_character(),
      annee = readr::col_character(),
      departement = readr::col_character()
    ),
    show_col_types = FALSE
  )
  dpe_brut <- readr::read_csv(
    testthat::test_path("fixtures", "habitat-dpe-fixture.csv"),
    col_types = readr::cols(
      .default = readr::col_character(),
      nombre_appartement = readr::col_double()
    ),
    show_col_types = FALSE
  )

  list(
    communes = communes,
    transactions = transactions,
    dpe = nettoyer_dpe(dpe_brut)
  )
}

# Le payload Habitat du fixture — la valeur par défaut des tests du thème.
payload_habitat <- function() {
  compute_payload(load_fixture_habitat(), theme = theme_habitat())
}
