# compute ---------------------------------------------------------------------
# Étape 3 : calcul. Dérive les indicateurs de la fiche, les rangs-en-contexte
# et l'Histoire. Le SEAM de test : compute_payload() — la forme tabulaire du
# payload (deux tables : indicateurs + histoires) est le contrat
# (test-contract-payload.R). Le story classifier (soldes + classification 2x2)
# arrive au ticket 4 (issue #5).

# Vintage de référence du RP — les vintages réels arrivent du manifeste au
# ticket 5 (issue #6). Ici, la source est unique et connue. Deux dates (point
# 5) : date_reference (ce que « RP 2023 » veut dire) et date_publication (la
# mise en ligne réelle — vérifiée sur data.gouv, 2026-06-30).
VINTAGE_RP <- list(
  source = "INSEE RP — dossier complet",
  version = "2023",
  date_reference = "2023-01-01",
  date_publication = "2026-06-30"
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

# departement_pluralite -------------------------------------------------------
# La règle d'attribution d'un EPCI à cheval sur plusieurs départements
# (décision 2026-08-03, point 6) : l'EPCI est attribué au département qui
# détient la pluralité de sa population — pas au premier de la liste. Ex æquo :
# le plus petit code de département (règle déterministe, documentée).
departement_pluralite <- function(population, departement) {
  tibble::tibble(population, departement) %>%
    dplyr::group_by(departement) %>%
    dplyr::summarise(pop = sum(population), .groups = "drop") %>%
    dplyr::arrange(dplyr::desc(pop), departement) %>%
    dplyr::slice(1) %>%
    dplyr::pull(departement)
}

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
  # la somme des lignes de ses communes. Le nom d'un EPCI est son LIBEPCI
  # (porté par ses communes, point 1) ; son département est celui de la
  # pluralité de sa population (point 6).
  epcis <- base %>%
    dplyr::group_by(epci) %>%
    dplyr::summarise(
      code = dplyr::first(epci),
      nom = dplyr::first(nom_epci),
      type = "epci",
      departement = departement_pluralite(population, departement),
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

# compute_ranks ---------------------------------------------------------------
# Les rangs-en-contexte : le percentile d'une valeur au sein de son groupe de
# comparaison. Règle documentée (Méthodes) : part strictement inférieure +
# moitié des ex æquo (autres que soi), sur le total du groupe — symétrique
# pour les égalités ; un groupe à un seul membre donne 0. Point 2 : les
# valeurs NA (commune sans population_1968, etc.) sont exclues du dénominateur
# du groupe — elles n'empoisonnent pas les rangs des autres — et le territoire
# NA lui-même n'a pas de rang (NA).
percentile_par_groupe <- function(valeurs, groupes) {
  vapply(seq_along(valeurs), function(i) {
    g <- groupes[i]
    if (is.na(g)) return(NA_real_)
    # le groupe de comparaison exclut les valeurs NA (point 2)
    membres <- !is.na(groupes) & groupes == g & !is.na(valeurs)
    n <- sum(membres)
    if (n == 0) return(NA_real_)
    if (is.na(valeurs[i])) return(NA_real_)
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
# par âge classée par la part des moins de 20 ans (agrégat Y_LT20, présent
# dans les données ; documenté, Méthodes).
scalaire_pour <- function(cle, tab, territoires) {
  if (cle == "structure_age") {
    territoires$age_lt20 / territoires$population
  } else {
    tab$value
  }
}

compute_ranks <- function(territoires, indicateurs) {
  groupes <- groupes_comparaison(territoires)

  lapply(names(indicateurs), function(cle) {
    tab <- indicateurs[[cle]]
    scalaire <- scalaire_pour(cle, tab, territoires)
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

assembler_indicateurs <- function(territoires, indicateurs, rangs,
                                  vintage = VINTAGE_RP) {
  lapply(names(indicateurs), function(cle) {
    dplyr::left_join(indicateurs[[cle]], rangs[[cle]], by = c("code", "key"))
  }) %>%
    dplyr::bind_rows() %>%
    dplyr::left_join(territoires[c("code", "type")], by = "code") %>%
    dplyr::rename(territoire = code) %>%
    dplyr::mutate(
      theme = "demographie",
      vintage_source = vintage$source,
      vintage_version = vintage$version,
      vintage_date_reference = vintage$date_reference,
      vintage_date_publication = vintage$date_publication
    ) %>%
    dplyr::select(territoire, type, theme, key, detail, value, unit,
                  rang_epci, rang_dep, rang_reg,
                  vintage_source, vintage_version,
                  vintage_date_reference, vintage_date_publication)
}

# compute_histoires ------------------------------------------------------------
# L'Histoire « Attractive ou fertile ? » — une décomposition, une
# classification 2x2 (ADR-0002, docs/themes/demographie.md).
#
# Décompose la variation récente de population en deux soldes :
#   solde naturel    = naissances - décès
#   solde migratoire = variation totale - solde naturel (le résidu)
# puis classe chaque territoire dans l'un des quatre quadrants :
#   - axe de croissance : le taux de variation, relatif à la médiane du groupe
#     de comparaison (le même que pour les rangs — communes vs EPCIs vs
#     départements, sur la région). La région, sans groupe, se compare à une
#     croissance nulle.
#   - axe de solde : le plus grand des deux |soldes| domine ; ex æquo -> le
#     solde naturel.
# Quatre lectures, une par quadrant : fertile (croît × naturel), attractive
# (croît × migratoire), vieillissante (décroît × naturel), exode (décroît ×
# migratoire). Règle déterministe documentée (Méthodes).
compute_histoires <- function(territoires) {
  groupe_reg <- groupes_comparaison(territoires)$reg

  soldes <- territoires %>%
    dplyr::mutate(
      groupe_reg = groupe_reg,
      solde_naturel = naissances - deces,
      solde_migratoire = (population - population_precedente) - (naissances - deces),
      taux_croissance = (population - population_precedente) / population_precedente
    )

  medianes <- soldes %>%
    dplyr::filter(!is.na(groupe_reg)) %>%
    dplyr::group_by(groupe_reg) %>%
    dplyr::summarise(mediane = stats::median(taux_croissance), .groups = "drop")

  soldes %>%
    dplyr::left_join(medianes, by = "groupe_reg") %>%
    dplyr::mutate(
      croit = dplyr::if_else(is.na(mediane),
                             taux_croissance > 0,
                             taux_croissance > mediane),
      migratoire_domine = abs(solde_migratoire) > abs(solde_naturel),
      classification = dplyr::case_when(
        croit & !migratoire_domine ~ "fertile",
        croit & migratoire_domine ~ "attractive",
        !croit & !migratoire_domine ~ "vieillissante",
        !croit & migratoire_domine ~ "exode"
      )
    ) %>%
    dplyr::transmute(
      territoire = code,
      type = type,
      theme = "demographie",
      story_key = "attractive-ou-fertile",
      solde_naturel,
      solde_migratoire,
      classification
    )
}

# reference_territoires -------------------------------------------------------
# La table de référence des territoires — les noms réels (LIBGEO/LIBEPCI) et
# l'appartenance départementale, une ligne par territoire. C'est la dimension
# que l'app joint aux deux tables de faits : elle rend (les noms), elle ne
# calcule pas. Projetée depuis build_territoires() — jamais une seconde source
# de noms. La région n'appartient à aucun département (NA) ; les EPCIs portent
# le département de la pluralité (point 6).
reference_territoires <- function(territoires) {
  territoires %>%
    dplyr::transmute(
      territoire = code,
      type = type,
      nom = nom,
      departement = departement
    )
}

# validate_payload ------------------------------------------------------------
# Point 7 : la validation de bon sens du payload. Attrape les dérives de
# format des sources sur les données réelles — une vague INSEE qui change de
# structure se traduit ici par une erreur bruyante, pas par des chiffres faux
# publiés silencieusement. Appelée à la sortie de compute_payload().
validate_payload <- function(payload) {
  ind <- payload$indicateurs
  ref <- payload$territoires

  # 1. pas de ligne en double (territoire × key × detail)
  dups <- duplicated(ind[c("territoire", "key", "detail")])
  if (any(dups)) {
    stop("Payload invalide : lignes en double (territoire × key × detail).",
         call. = FALSE)
  }

  # 2. chaque territoire porte les 4 clés d'indicateur, structure = 7 tranches
  comptes <- table(ind$territoire, ind$key)
  attendues <- c(densite = 1, structure_age = 7, evolution_1968 = 1,
                 taille_menages = 1)
  manquantes <- setdiff(names(attendues), colnames(comptes))
  if (length(manquantes) > 0) {
    stop("Payload invalide : clés d'indicateur manquantes : ",
         paste(manquantes, collapse = ", "), ".", call. = FALSE)
  }
  mal <- rownames(comptes)[apply(comptes[, names(attendues), drop = FALSE],
                                 1, function(ligne) any(ligne != attendues))]
  if (length(mal) > 0) {
    stop("Payload invalide : clés d'indicateur inattendues pour ",
         paste(mal, collapse = ", "), ".", call. = FALSE)
  }

  # 3. densité : finie et positive partout
  dens <- ind$value[ind$key == "densite"]
  if (any(!is.finite(dens) | dens <= 0)) {
    stop("Payload invalide : densité non finie ou non positive.", call. = FALSE)
  }

  # 4. structure par âge : les parts somment à 1 par territoire
  parts <- stats::aggregate(value ~ territoire, ind[ind$key == "structure_age", ],
                            sum)
  if (any(abs(parts$value - 1) > 1e-6)) {
    stop("Payload invalide : les parts d'âge ne somment pas à 1.", call. = FALSE)
  }

  # 5. les rangs vivent dans [0, 1] (NA = groupe de comparaison absent)
  rangs <- unlist(ind[c("rang_epci", "rang_dep", "rang_reg")])
  if (any(!is.na(rangs) & (rangs < 0 | rangs > 1))) {
    stop("Payload invalide : un rang sort de [0, 1].", call. = FALSE)
  }

  # 6. la table de référence : une ligne par territoire, un nom partout
  if (anyDuplicated(ref$territoire)) {
    stop("Payload invalide : la table de référence a des territoires en double.",
         call. = FALSE)
  }
  if (any(is.na(ref$nom))) {
    stop("Payload invalide : un territoire sans nom dans la table de référence.",
         call. = FALSE)
  }
  # intégrité référentielle : les faits ne citent que des territoires connus
  connus <- unique(ref$territoire)
  inconnus <- setdiff(unique(ind$territoire), connus)
  if (length(inconnus) > 0) {
    stop("Payload invalide : indicateurs pour un territoire inconnu : ",
         paste(inconnus, collapse = ", "), ".", call. = FALSE)
  }

  invisible(payload)
}

# compute_payload -------------------------------------------------------------
# LE SEAM. Données filtrées (forme du fixture) -> payload de la fiche.
# `vintage` est le tampon de fraîcheur du thème (source/version/dates) — par
# défaut VINTAGE_RP ; run_pipeline() le tire de la table des vintages.
compute_payload <- function(data, vintage = VINTAGE_RP) {
  territoires <- build_territoires(data)
  indicateurs <- list(
    densite = indicator_densite(territoires),
    structure_age = indicator_structure_age(territoires),
    evolution_1968 = indicator_evolution(territoires),
    taille_menages = indicator_taille_menages(territoires)
  )
  rangs <- compute_ranks(territoires, indicateurs)

  payload <- list(
    indicateurs = assembler_indicateurs(territoires, indicateurs, rangs, vintage),
    histoires = compute_histoires(territoires),
    territoires = reference_territoires(territoires)
  )

  # le garde-fou du pipeline réel (point 7) : un payload invalide s'arrête là
  validate_payload(payload)
}
