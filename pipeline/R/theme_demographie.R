# theme_demographie ------------------------------------------------------------
# Le module du thème Démographie (issue #13) : tout ce qui DIFFÈRE d'un thème à
# l'autre vit ici, déclaré dans le descripteur theme_demographie() que la
# machinerie partagée (download/compute/publish) consomme sans jamais nommer le
# thème. Habitat et les thèmes suivants fournissent leur propre module
# (theme_habitat(), ...) avec la même forme de descripteur — le squelette
# partagé ne change pas quand un thème arrive.
#
# Le descripteur porte : le nom du thème (la colonne `theme` du payload et le
# nom des fichiers publiés), le manifeste des sources, la table déclarative
# des indicateurs ET celle des clés de l'Aperçu (issue #32), le builder de
# vintages, la construction des données, la construction de la table des
# territoires (squelette partagé + colonnes d'agrégation du thème), les
# constructeurs d'indicateurs et d'Aperçu, les scalaires de classement, le
# calcul de l'Histoire et les validations spécifiques au thème.

# MANIFEST_DEMOGRAPHIE ---------------------------------------------------------
# La table des sources vérifiées (docs/research/rp-dossier-complet.md). Deux
# dates par source (point 5) :
#   - date_reference   : la date de référence de la donnée (« RP 2023 » = au
#     1er janvier 2023) — ce que le tampon de fraîcheur affiche.
#   - date_publication : la date de mise en ligne réelle — ce que le watchdog
#     comparera à data.gouv (ADR-0001). Vérifiée sur l'API data.gouv le
#     2026-08-03 (created_at des ressources 2023 = 2026-06-30). La base des
#     EPCI vit sur insee.fr, qui n'expose pas de date de fichier : NA, à
#     compléter par le watchdog.
# Le mode de récupération (issue #8, ADR-0004) : « cron » = le runner
# télécharge directement (petit fichier HTTP sans clé), « manuel » = trop gros
# / outil de bureau / clé API (OSM, OCS GE, BDNB). Les 4 sources INSEE
# Démographie sont toutes « cron » (vérifié en direct le 2026-08-03).
# Et le type de récupération (issue #13) : « fichier » = URL -> fichier,
# intégrité vérifiée (le comportement historique) ; « api » = une fonction de
# pull, mise en cache — aucun pull Démographie aujourd'hui, le seam arrive
# avec le pull DPE (Habitat).
MANIFEST_DEMOGRAPHIE <- tibble::tribble(
  ~id, ~source, ~url, ~fichier, ~vintage, ~date_reference, ~date_publication, ~licence, ~note, ~mode, ~type,
  "serie_historique",
  "INSEE — Série historique du recensement",
  "https://api.insee.fr/melodi/file/DS_RP_SERIE_HISTORIQUE/DS_RP_SERIE_HISTORIQUE_2023_CSV_FR",
  "DS_RP_SERIE_HISTORIQUE_2023_CSV_FR.zip", "2023", "2023-01-01", "2026-06-30", "lov2",
  "Population 1968-2023 (POP), superficie (SUP, km2), naissances/décès cumulés entre recensements (BRTH/DEATH)",
  "cron", "fichier",
  "menages",
  "INSEE — Ménages (dossier complet)",
  "https://api.insee.fr/melodi/file/DS_RP_MENAGES_COMP/DS_RP_MENAGES_COMP_2023_CSV_FR",
  "DS_RP_MENAGES_COMP_2023_CSV_FR.zip", "2023", "2023-01-01", "2026-06-30", "lov2",
  "Nombre de ménages (DWELLINGS) et population des ménages (DWELLINGS_POPSIZE)",
  "cron", "fichier",
  "age_detail",
  "INSEE — Population par sexe et âge (PRINC)",
  "https://api.insee.fr/melodi/file/DS_RP_POPULATION_PRINC/DS_RP_POPULATION_PRINC_2023_CSV_FR",
  "DS_RP_POPULATION_PRINC_2023_CSV_FR.zip", "2023", "2023-01-01", "2026-06-30", "lov2",
  "Structure par âge : 7 tranches exhaustives + agrégats (dont Y_LT20, moins de 20 ans)",
  "cron", "fichier",
  "epci",
  "INSEE — Base des EPCI à fiscalité propre au 01/01/2025",
  "https://www.insee.fr/fr/statistiques/fichier/2510634/epci_au_01-01-2025.zip",
  "epci_au_01-01-2025.zip", "2025", "2025-01-01", NA_character_, "lov2",
  "Feuille Composition_communale : CODGEO -> EPCI (SIREN), LIBEPCI, DEP, REG",
  "cron", "fichier"
)

# INDICATEURS_DEMOGRAPHIE ------------------------------------------------------
# La table déclarative des indicateurs du thème (issue #9) : chaque clé du
# payload y est déclarée avec ses sources (ids du manifeste), sa source de
# référence et sa multiplicité. La source de référence est DÉCLARÉE, jamais
# inférée : la règle est « la source du composant signature de l'indicateur,
# jamais un dénominateur partagé » — structure_age prend ses tranches de
# PRINC (age_detail) mais son dénominateur (la population) de la série
# historique : sa référence est age_detail.
INDICATEURS_DEMOGRAPHIE <- tibble::tibble(
  key = c("densite", "structure_age", "evolution_1968", "taille_menages"),
  libelle = c(
    "Densité de population",
    "Structure par âge",
    "Évolution de la population depuis 1968",
    "Taille moyenne des ménages"
  ),
  sources = list(
    "serie_historique",
    c("age_detail", "serie_historique"),
    "serie_historique",
    "menages"
  ),
  source_reference = c("serie_historique", "age_detail",
                       "serie_historique", "menages"),
  multiplicite = c(1L, 7L, 1L, 1L)
)

# La construction des données du thème -----------------------------------------
# L'acte « trouver la donnée » : décompresse le cache brut, lit les fichiers
# longs INSEE + la base des EPCI, et produit la table des communes bretonnes
# dans la forme du contrat (data/processed). Les pivots et l'assembleur sont
# spécifiques au thème — ils restent dans le module, le lecteur CSV partagé
# (lire_csv_long, filter.R) est réutilisé.

# pivoter_serie ----------------------------------------------------------------
# Série historique du recensement : population (1968/2017/2023), superficie,
# naissances/décès cumulés entre recensements — une ligne par commune.
# OBS_STATUS = "A" écarte les lignes K/W (doublons d'inclusion) ; on ne garde
# que les mesures et périodes du contrat.
pivoter_serie <- function(long) {
  long %>%
    dplyr::filter(
      GEO_OBJECT == "COM", # une commune réapparaît comme BV2022/AAV2020, etc.
      OBS_STATUS == "A",
      (RP_MEASURE == "POP" & TIME_PERIOD %in% c(1968, 2017, 2023)) |
        (RP_MEASURE %in% c("SUP", "BRTH", "DEATH") & TIME_PERIOD == 2023)
    ) %>%
    dplyr::select(GEO, RP_MEASURE, TIME_PERIOD, OBS_VALUE) %>%
    tidyr::pivot_wider(
      id_cols = GEO,
      names_from = c(RP_MEASURE, TIME_PERIOD),
      values_from = OBS_VALUE
    ) %>%
    dplyr::rename(
      population = `POP_2023`,
      population_1968 = `POP_1968`,
      population_precedente = `POP_2017`,
      superficie_km2 = `SUP_2023`,
      naissances = `BRTH_2023`,
      deces = `DEATH_2023`
    )
}

# pivoter_menages --------------------------------------------------------------
# Ménages (dossier complet) : nombre de ménages et population des ménages —
# les lignes totales (TPH = _T, PCS = _T) des résidences principales.
pivoter_menages <- function(long) {
  long %>%
    dplyr::filter(
      GEO_OBJECT == "COM",
      RP_MEASURE %in% c("DWELLINGS", "DWELLINGS_POPSIZE"),
      OCS == "DW_MAIN", TPH == "_T", PCS == "_T",
      TIME_PERIOD == 2023, OBS_STATUS == "A"
    ) %>%
    dplyr::select(GEO, RP_MEASURE, OBS_VALUE) %>%
    tidyr::pivot_wider(id_cols = GEO, names_from = RP_MEASURE, values_from = OBS_VALUE) %>%
    dplyr::rename(menages = DWELLINGS, population_menages = DWELLINGS_POPSIZE)
}

# pivoter_age -----------------------------------------------------------------
# Population par sexe et âge (PRINC) : les 7 tranches exhaustives + l'agrégat
# moins de 20 ans (Y_LT20), sexe total (_T), recensement 2023, statut A.
pivoter_age <- function(long) {
  long %>%
    dplyr::filter(
      GEO_OBJECT == "COM",
      SEX == "_T", TIME_PERIOD == 2023, OBS_STATUS == "A",
      AGE %in% c("Y_LT15", "Y15T24", "Y25T39", "Y40T54", "Y55T64",
                 "Y65T79", "Y_GE80", "Y_LT20")
    ) %>%
    dplyr::select(GEO, AGE, OBS_VALUE) %>%
    tidyr::pivot_wider(id_cols = GEO, names_from = AGE, values_from = OBS_VALUE) %>%
    dplyr::rename(
      age_lt15 = Y_LT15, age_15_24 = Y15T24, age_25_39 = Y25T39,
      age_40_54 = Y40T54, age_55_64 = Y55T64, age_65_79 = Y65T79,
      age_80_plus = Y_GE80, age_lt20 = Y_LT20
    )
}

# assembler_communes ----------------------------------------------------------
# Assemble les trois pivots en une table par commune, dans la forme du contrat.
# La jointure avec la base des EPCI (limitée à la Bretagne) est LE filtre :
# les communes hors 22/29/35/56 tombent.
assembler_communes <- function(serie, menages, age, epci) {
  serie %>%
    dplyr::left_join(menages, by = "GEO") %>%
    dplyr::left_join(age, by = "GEO") %>%
    dplyr::inner_join(epci, by = c("GEO" = "CODGEO")) %>%
    dplyr::rename(
      code = GEO, nom = LIBGEO, departement = DEP, epci = EPCI,
      nom_epci = LIBEPCI
    ) %>%
    dplyr::select(code, nom, departement, epci, nom_epci,
                  population, population_1968, population_precedente,
                  superficie_km2, naissances, deces,
                  age_lt15, age_15_24, age_25_39, age_40_54,
                  age_55_64, age_65_79, age_80_plus, age_lt20,
                  population_menages, menages)
}

lire_epci <- function(chemin) {
  # skip = 5 : les 4 premières lignes de la feuille sont titre + métadonnées,
  # la 5e est l'en-tête réel (CODGEO;LIBGEO;EPCI;LIBEPCI;DEP;REG).
  readxl::read_excel(chemin, sheet = "Composition_communale",
                     col_types = "text", skip = 5) %>%
    dplyr::filter(DEP %in% DEPT_BRETAGNE)
}

construire_donnees_brut <- function(cache = "data/raw",
                                    sortie = "data/processed/communes_brut.rds") {
  extrait <- file.path(cache, "extracted")
  if (!dir.exists(extrait)) dir.create(extrait, recursive = TRUE)
  if (!dir.exists(dirname(sortie))) dir.create(dirname(sortie), recursive = TRUE)

  # décompresse (idempotent : overwrite = FALSE — les fichiers déjà extraits
  # sont laissés intacts, sans spammer de warning à chaque relance)
  for (f in MANIFEST_DEMOGRAPHIE$fichier) {
    suppressWarnings(
      utils::unzip(file.path(cache, f), exdir = extrait, overwrite = FALSE)
    )
  }

  serie <- lire_csv_long(
    file.path(extrait, "DS_RP_SERIE_HISTORIQUE_2023_data.csv")
  )
  menages <- lire_csv_long(
    file.path(extrait, "DS_RP_MENAGES_COMP_2023_data.csv")
  )
  age <- lire_csv_long(
    file.path(extrait, "DS_RP_POPULATION_PRINC_2023_data.csv")
  )
  epci <- lire_epci(file.path(extrait, "EPCI_au_01-01-2025.xlsx"))

  brut <- assembler_communes(
    pivoter_serie(serie), pivoter_menages(menages), pivoter_age(age), epci
  )

  # L'étape « filter » documentée (docs/architecture.md) : la jointure EPCI
  # (limitée à la Bretagne) est LE filtre ; filter_bretagne est la garde
  # explicite du schéma — redondante mais défensive, elle coûte une ligne.
  brut <- filter_bretagne(brut)

  readr::write_rds(brut, sortie)
  brut
}

# La construction de la table des territoires du thème ------------------------
# Le squelette partagé (squelette_territoires, compute.R) fournit les codes,
# les vrais noms, la hiérarchie et la règle de pluralité départementale ;
# le thème ajoute SES colonnes d'agrégation (les mesures démographiques,
# sommées par niveau) — un thème suivant fournit ses propres colonnes sans
# toucher au squelette.

COLONNES_DEMOGRAPHIE <- c(
  "population", "population_1968", "population_precedente",
  "superficie_km2", "naissances", "deces",
  "age_lt15", "age_15_24", "age_25_39", "age_40_54",
  "age_55_64", "age_65_79", "age_80_plus", "age_lt20",
  "population_menages", "menages"
)

# agreger_territoires_demographie : la part du thème — les colonnes de mesure,
# agrégées par niveau de territoire (une ligne par commune = ses propres
# valeurs ; EPCI / département / région = la somme des lignes de leurs
# communes), rejointes sur le squelette partagé par code.
agreger_territoires_demographie <- function(communes, squelette) {
  base <- communes %>%
    dplyr::mutate(dplyr::across(c(departement, epci), as.character))

  mesures <- dplyr::bind_rows(
    base[c("code", COLONNES_DEMOGRAPHIE)],
    base %>%
      dplyr::group_by(epci) %>%
      dplyr::summarise(
        dplyr::across(dplyr::all_of(COLONNES_DEMOGRAPHIE), sum),
        .groups = "drop"
      ) %>%
      dplyr::rename(code = epci),
    base %>%
      dplyr::group_by(departement) %>%
      dplyr::summarise(
        dplyr::across(dplyr::all_of(COLONNES_DEMOGRAPHIE), sum),
        .groups = "drop"
      ) %>%
      dplyr::rename(code = departement),
    base %>%
      dplyr::summarise(
        dplyr::across(dplyr::all_of(COLONNES_DEMOGRAPHIE), sum),
        .groups = "drop"
      ) %>%
      dplyr::mutate(code = "53")
  )

  dplyr::left_join(squelette, mesures, by = "code")
}

# build_territoires -----------------------------------------------------------
# Une ligne par territoire (communes + agrégats EPCI / département / région),
# mêmes colonnes partout : le squelette partagé + les colonnes d'agrégation du
# thème. L'astuce du module profond : une fois que chaque territoire est une
# ligne d'une seule table, les constructeurs d'indicateurs s'appliquent
# uniformément — ils n'ont pas à savoir quel type de territoire ils calculent.
build_territoires <- function(communes) {
  squelette <- squelette_territoires(communes)
  agreger_territoires_demographie(communes, squelette)
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
      cols = c(age_lt15, age_15_24, age_25_39, age_40_54,
               age_55_64, age_65_79, age_80_plus),
      names_to = "bande",
      values_to = "effectif"
    ) %>%
    dplyr::mutate(
      key = "structure_age",
      detail = dplyr::recode(
        bande,
        age_lt15 = "<15", age_15_24 = "15-24", age_25_39 = "25-39",
        age_40_54 = "40-54", age_55_64 = "55-64", age_65_79 = "65-79",
        age_80_plus = "80+"
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
    # Population des ménages / nombre de ménages (définition INSEE — les
    # collectivités ne comptent pas dans la taille moyenne des ménages).
    value = territoires$population_menages / territoires$menages,
    unit = "pers./ménage"
  )
}

# construire_indicateurs_demographie : le thème déclare SES constructeurs —
# la liste nommée des tables longues que compute_payload() assemble.
construire_indicateurs_demographie <- function(territoires) {
  list(
    densite = indicator_densite(territoires),
    structure_age = indicator_structure_age(territoires),
    evolution_1968 = indicator_evolution(territoires),
    taille_menages = indicator_taille_menages(territoires)
  )
}

# Les scalaires de classement du thème ----------------------------------------
# Le scalaire classé par indicateur : la valeur elle-même, sauf la structure
# par âge classée par la part des moins de 20 ans (agrégat Y_LT20, présent
# dans les données ; documenté, Méthodes). Un thème déclare ici le scalaire de
# SES indicateurs multi-valeurs ; les scalaires héritent de la valeur.
scalaires_demographie <- list(
  structure_age = function(territoires) {
    territoires$age_lt20 / territoires$population
  }
)

# compute_histoires_demographie -----------------------------------------------
# L'Histoire « Trajectoire démographique » — une décomposition, une lecture
# par quadrant de taux (ADR-0011, docs/themes/demographie.md).
#
# Décompose la variation récente de population en deux soldes :
#   solde naturel    = naissances - décès
#   solde migratoire = variation totale - solde naturel (le résidu)
# puis exprime chacun en taux annuel pour mille habitants :
#   taux_solde = solde / 6 ans / population moyenne x 1000
#   (population moyenne = (POP 2017 + POP 2023) / 2, convention INSEE).
# La lecture est le signe seul des deux taux — les quatre quadrants du plan
# (zéro compte négatif), rien de relatif à la région :
#   attire-renouvelle  (naturel > 0  × migratoire > 0)
#   attire-meurt       (naturel <= 0 × migratoire > 0)
#   vide-meurt         (naturel <= 0 × migratoire <= 0)
#   vide-renouvelle    (naturel > 0  × migratoire <= 0)
# Les soldes bruts restent publiés à côté des taux. Règle déterministe
# documentée (Méthodes).
compute_histoires_demographie <- function(territoires) {
  soldes <- territoires %>%
    dplyr::mutate(
      solde_naturel = naissances - deces,
      solde_migratoire = (population - population_precedente) - (naissances - deces),
      population_moyenne = (population_precedente + population) / 2,
      # Les deux forces lues par l'histoire sont des TAUX annuels pour mille
      # habitants (INSEE) — solde / 6 ans / population moyenne x 1000 — jamais
      # les soldes bruts (ADR-0011).
      taux_solde_naturel = solde_naturel / 6 / population_moyenne * 1000,
      taux_solde_migratoire = solde_migratoire / 6 / population_moyenne * 1000,
      # Quatre lectures = les quatre quadrants du plan des deux taux ; signe
      # seul (zéro compte négatif), rien de relatif à la région (ADR-0011).
      classification = dplyr::case_when(
        taux_solde_naturel > 0 & taux_solde_migratoire > 0 ~ "attire-renouvelle",
        taux_solde_naturel <= 0 & taux_solde_migratoire > 0 ~ "attire-meurt",
        taux_solde_naturel <= 0 & taux_solde_migratoire <= 0 ~ "vide-meurt",
        taux_solde_naturel > 0 & taux_solde_migratoire <= 0 ~ "vide-renouvelle"
      )
    ) %>%
    dplyr::transmute(
      territoire = code,
      type = type,
      theme = "demographie",
      story_key = "trajectoire-demographique",
      solde_naturel,
      solde_migratoire,
      taux_solde_naturel,
      taux_solde_migratoire,
      classification
    )
}

# Les validations spécifiques au thème ----------------------------------------
# Les vérifications de valeur propres à Démographie (point 7) : le thème les
# déclare, validate_payload() les exécute après ses vérifications génériques.
# Un thème suivant déclare les siennes dans son module.
validations_demographie <- list(
  # densité : finie et positive partout
  function(payload) {
    dens <- payload$indicateurs$value[payload$indicateurs$key == "densite"]
    if (any(!is.finite(dens) | dens <= 0)) {
      stop("Payload invalide : densité non finie ou non positive.", call. = FALSE)
    }
    invisible(payload)
  },
  # structure par âge : les parts somment à 1 par territoire
  function(payload) {
    parts <- stats::aggregate(
      value ~ territoire,
      payload$indicateurs[payload$indicateurs$key == "structure_age", ],
      sum
    )
    if (any(abs(parts$value - 1) > 1e-6)) {
      stop("Payload invalide : les parts d'âge ne somment pas à 1.", call. = FALSE)
    }
    invisible(payload)
  }
)

# APERCU_DEMOGRAPHIE -----------------------------------------------------------
# La table déclarative des clés de l'Aperçu du thème (issue #32, ADR-0007) :
# chaque clé y est déclarée avec sa multiplicité (une ligne par territoire —
# la validation générique la vérifie). La table `apercu` du payload est
# PARTAGÉE entre les thèmes (comme la référence) ; chaque thème déclare SES
# clés — le gating par thème : les clés des thèmes non construits sont
# absentes de la table, jamais un « under construction » (ADR-0007). Les
# valeurs se dérivent des MÊMES colonnes que les indicateurs du thème (jamais
# une seconde source de chiffres) : population et densité de la série
# historique, part 65+ des tranches 65-79 + 80+ de la structure par âge.
APERCU_DEMOGRAPHIE <- tibble::tibble(
  key = c("population", "densite", "part_65_plus"),
  libelle = c(
    "Population",
    "Densité de population",
    "Part des 65 ans et plus"
  ),
  multiplicite = c(1L, 1L, 1L)
)

# Les constructeurs de l'Aperçu du thème --------------------------------------
# Même forme que les constructeurs d'indicateurs : une table longue
# code, key, value, unit par clé — assemble_apercu (compute.R) les lie en la
# table du contrat (territoire | type | key | value | unit).

apercu_population <- function(territoires) {
  tibble::tibble(
    code = territoires$code,
    key = "population",
    value = territoires$population,
    unit = "hab."
  )
}

apercu_densite <- function(territoires) {
  tibble::tibble(
    code = territoires$code,
    key = "densite",
    value = territoires$population / territoires$superficie_km2,
    unit = "hab/km²"
  )
}

apercu_part_65_plus <- function(territoires) {
  tibble::tibble(
    code = territoires$code,
    key = "part_65_plus",
    # la part 65+ se lit sur les tranches exhaustives de la structure par âge
    # (65-79 + 80+), le dénominateur étant la population — la même source que
    # l'indicateur structure_age, jamais une seconde paire de chiffres.
    value = (territoires$age_65_79 + territoires$age_80_plus) /
      territoires$population,
    unit = "%"
  )
}

construire_apercu_demographie <- function(territoires) {
  list(
    population = apercu_population(territoires),
    densite = apercu_densite(territoires),
    part_65_plus = apercu_part_65_plus(territoires)
  )
}

# Le builder de vintages du thème ---------------------------------------------
# Les vintages se projettent depuis le manifeste (vintages_depuis_manifest,
# vintage.R) — le thème déclare simplement SON manifeste.
vintages_demographie <- function() {
  vintages_depuis_manifest(MANIFEST_DEMOGRAPHIE)
}

# theme_demographie -----------------------------------------------------------
# Le descripteur du thème : tout ce que la machinerie partagée doit savoir
# pour faire tourner Démographie sans jamais nommer le thème. La forme du
# contrat pour les thèmes suivants — theme_habitat() et ses sœurs livrent la
# même liste avec leurs propres pièces.
theme_demographie <- function() {
  list(
    theme = "demographie",
    manifest = MANIFEST_DEMOGRAPHIE,
    indicateurs = INDICATEURS_DEMOGRAPHIE,
    apercu = APERCU_DEMOGRAPHIE,
    vintages = vintages_demographie,
    construire_donnees = construire_donnees_brut,
    construire_territoires = build_territoires,
    construire_indicateurs = construire_indicateurs_demographie,
    construire_apercu = construire_apercu_demographie,
    scalaires = scalaires_demographie,
    compute_histoires = compute_histoires_demographie,
    validations = validations_demographie
  )
}
