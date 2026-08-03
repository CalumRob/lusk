# compute ---------------------------------------------------------------------
# Étape 3 : calcul. Dérive les indicateurs de la fiche, les rangs-en-contexte
# et l'Histoire. Le SEAM de test : compute_payload() — la forme tabulaire du
# payload (deux tables : indicateurs + histoires) est le contrat
# (test-contract-payload.R).
# Issue #13 : la machinerie ici est partagée — elle ne nomme jamais le thème.
# Tout ce qui diffère d'un thème à l'autre (la table INDICATEURS_<theme>, la
# construction des territoires, les constructeurs d'indicateurs, les scalaires
# de classement, le calcul de l'Histoire, les validations spécifiques) vit
# dans le module du thème (theme_demographie.R) et arrive via le descripteur
# theme_demographie().

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

# squelette_territoires -------------------------------------------------------
# Le squelette PARTAGÉ de la table des territoires (issue #13) : une ligne par
# territoire (communes + agrégats EPCI / département / région), avec les
# colonnes d'identité — codes, vrais noms (LIBGEO/LIBEPCI), hiérarchie (type,
# epci, departement) et la règle de pluralité départementale. Aucune colonne de
# mesure : les colonnes d'agrégation du thème sont ajoutées par le module du
# thème (build_territoires -> agreger_territoires_<theme>). `poids` est la
# colonne qui pèse la pluralité départementale (la population par défaut — un
# thème peut passer la sienne).
squelette_territoires <- function(communes, poids = "population") {
  base <- communes %>%
    dplyr::mutate(
      type = "commune",
      dplyr::across(c(departement, epci), as.character)
    )

  # Chaque niveau d'agrégat = un group_by des identifiants. Le nom d'un EPCI
  # est son LIBEPCI (porté par ses communes, point 1) ; son département est
  # celui de la pluralité de sa population (point 6).
  epcis <- base %>%
    dplyr::group_by(epci) %>%
    dplyr::summarise(
      code = dplyr::first(epci),
      nom = dplyr::first(nom_epci),
      type = "epci",
      departement = departement_pluralite(.data[[poids]], departement),
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
      .groups = "drop"
    )

  region <- base %>%
    dplyr::summarise(
      code = "53",
      nom = "Bretagne",
      type = "region",
      departement = NA_character_,
      epci = NA_character_,
      .groups = "drop"
    )

  dplyr::bind_rows(
    base[c("code", "nom", "type", "departement", "epci")],
    epcis,
    deps,
    region
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

# compute_ranks : le scalaire classé par indicateur est la valeur elle-même,
# sauf pour les indicateurs multi-valeurs du thème, qui déclarent leur scalaire
# (issue #13 — `scalaires` : une liste nommée de fonctions, fournie par le
# module du thème ; ex. structure_age classée par la part des moins de 20 ans).
compute_ranks <- function(territoires, indicateurs, scalaires = list()) {
  groupes <- groupes_comparaison(territoires)

  lapply(names(indicateurs), function(cle) {
    tab <- indicateurs[[cle]]
    scalaire <- if (!is.null(scalaires[[cle]])) {
      scalaires[[cle]](territoires)
    } else {
      tab$value
    }
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

# L'estampille de chaque indicateur vient du vintage de SA source de référence
# (déclarée dans la table INDICATEURS_<theme> du thème) — jamais d'un tampon de
# thème (issue #9). La jointure se fait sur l'id du manifeste
# (source_reference -> vintages$id), jamais par un sous-ensemble implicite.
# Issue #13 : `theme` est le nom du thème (colonne du payload) et
# `indicateurs_table` SA table déclarative — tout vient du descripteur.
assembler_indicateurs <- function(territoires, indicateurs, rangs,
                                  theme, indicateurs_table, vintages) {
  tampons <- indicateurs_table %>%
    dplyr::select(key, source_reference) %>%
    dplyr::left_join(vintages, by = c("source_reference" = "id")) %>%
    dplyr::select(key,
                  vintage_source = source,
                  vintage_version = version,
                  vintage_date_reference = date_reference,
                  vintage_date_publication = date_publication)

  lapply(names(indicateurs), function(cle) {
    dplyr::left_join(indicateurs[[cle]], rangs[[cle]], by = c("code", "key"))
  }) %>%
    dplyr::bind_rows() %>%
    dplyr::left_join(territoires[c("code", "type")], by = "code") %>%
    dplyr::rename(territoire = code) %>%
    dplyr::mutate(theme = theme) %>%
    dplyr::left_join(tampons, by = "key") %>%
    dplyr::select(territoire, type, theme, key, detail, value, unit,
                  rang_epci, rang_dep, rang_reg,
                  vintage_source, vintage_version,
                  vintage_date_reference, vintage_date_publication)
}

# reference_territoires -------------------------------------------------------
# La table de référence des territoires — les noms réels (LIBGEO/LIBEPCI) et
# l'appartenance départementale, une ligne par territoire. C'est la dimension
# que l'app joint aux tables de faits : elle rend (les noms), elle ne calcule
# pas. Projetée depuis la table des territoires — jamais une seconde source de
# noms. Issue #13 : le squelette étant partagé, UNE SEULE table de référence
# sert tous les thèmes (la région n'appartient à aucun département — NA ; les
# EPCIs portent le département de la pluralité, point 6).
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
# Issue #9 : la validation s'appuie sur la table INDICATEURS_<theme> (toute clé
# du payload doit y être déclarée, avec la bonne multiplicité) et sur la table
# des vintages (chaque estampille doit égaler le vintage de la source de
# référence déclarée). Issue #13 : les vérifications de VALEUR propres au
# thème (densité positive, parts qui somment à 1...) sont déclarées par le
# thème et exécutées après les vérifications génériques.
validate_payload <- function(payload,
                             indicateurs = INDICATEURS_DEMOGRAPHIE,
                             vintages = vintages_demographie(),
                             validations = list()) {
  ind <- payload$indicateurs
  ref <- payload$territoires

  # 1. pas de ligne en double (territoire × key × detail)
  dups <- duplicated(ind[c("territoire", "key", "detail")])
  if (any(dups)) {
    stop("Payload invalide : lignes en double (territoire × key × detail).",
         call. = FALSE)
  }

  # 2. la table des indicateurs du thème fait foi : chaque clé du payload y est
  # déclarée (issue #9), avec la bonne multiplicité par territoire.
  declares <- stats::setNames(indicateurs$multiplicite, indicateurs$key)
  comptes <- table(ind$territoire, ind$key)
  non_declarees <- setdiff(colnames(comptes), names(declares))
  if (length(non_declarees) > 0) {
    stop("Payload invalide : clé d'indicateur non déclarée : ",
         paste(non_declarees, collapse = ", "), ".", call. = FALSE)
  }
  manquantes <- setdiff(names(declares), colnames(comptes))
  if (length(manquantes) > 0) {
    stop("Payload invalide : clés d'indicateur manquantes : ",
         paste(manquantes, collapse = ", "), ".", call. = FALSE)
  }
  mal <- rownames(comptes)[apply(comptes[, names(declares), drop = FALSE],
                                 1, function(ligne) any(ligne != declares))]
  if (length(mal) > 0) {
    stop("Payload invalide : clés d'indicateur inattendues pour ",
         paste(mal, collapse = ", "), ".", call. = FALSE)
  }

  # 3. les rangs vivent dans [0, 1] (NA = groupe de comparaison absent)
  rangs <- unlist(ind[c("rang_epci", "rang_dep", "rang_reg")])
  if (any(!is.na(rangs) & (rangs < 0 | rangs > 1))) {
    stop("Payload invalide : un rang sort de [0, 1].", call. = FALSE)
  }

  # 4. les estampilles égalent le vintage de la source de référence déclarée
  # (issue #9). Une source de référence absente de la table des vintages est
  # une erreur en soi ; une estampille qui ne vient pas de sa source de
  # référence est une fraude à la fraîcheur — les deux échouent fort.
  refs <- unique(indicateurs$source_reference)
  sans_vintage <- setdiff(refs, vintages$id)
  if (length(sans_vintage) > 0) {
    stop("Payload invalide : source de référence absente des vintages : ",
         paste(sans_vintage, collapse = ", "), ".", call. = FALSE)
  }

  attendus <- indicateurs %>%
    dplyr::select(key, source_reference) %>%
    dplyr::left_join(vintages, by = c("source_reference" = "id"))

  joint <- ind %>%
    dplyr::transmute(
      key = key,
      vintage_source = vintage_source,
      vintage_version = vintage_version,
      vintage_date_reference = vintage_date_reference,
      vintage_date_publication = vintage_date_publication
    ) %>%
    dplyr::left_join(attendus, by = "key")

  # deux NA comptent pour égaux (un vintage sans date de publication reste
  # un vintage valide) — mais jamais NA face à une valeur déclarée
  egal_na <- function(a, b) {
    (is.na(a) & is.na(b)) | (!is.na(a) & !is.na(b) & a == b)
  }
  mauvaise_estampille <- !(
    egal_na(joint$vintage_source, joint$source) &
      egal_na(joint$vintage_version, joint$version) &
      egal_na(joint$vintage_date_reference, joint$date_reference) &
      egal_na(joint$vintage_date_publication, joint$date_publication)
  )
  if (any(mauvaise_estampille)) {
    stop("Payload invalide : une estampille ne vient pas de la source de ",
         "référence déclarée.", call. = FALSE)
  }

  # 5. la table de référence : une ligne par territoire, un nom partout
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

  # 6. les validations de valeur déclarées par le thème (issue #13)
  for (valider in validations) valider(payload)

  invisible(payload)
}

# compute_payload -------------------------------------------------------------
# LE SEAM. Données filtrées (forme du fixture) -> payload de la fiche.
# `theme` est le descripteur du thème (issue #13) : par défaut Démographie —
# tout (constructeurs, scalaires, Histoire, validations, table des indicateurs)
# en vient. `vintages` est la table des vintages (issue #9) : chaque indicateur
# est estampillé depuis le vintage de sa source de référence déclarée — plus de
# tampon de fraîcheur du thème. Par défaut les vintages du thème (sa table
# réelle) ; run_pipeline() les passe explicitement. Pure : fixture + thème +
# table -> payload.
compute_payload <- function(data, theme = theme_demographie(),
                            vintages = NULL) {
  territoires <- theme$construire_territoires(data)
  indicateurs <- theme$construire_indicateurs(territoires)
  rangs <- compute_ranks(territoires, indicateurs, scalaires = theme$scalaires)

  if (is.null(vintages)) vintages <- theme$vintages()

  payload <- list(
    indicateurs = assembler_indicateurs(
      territoires, indicateurs, rangs,
      theme = theme$theme,
      indicateurs_table = theme$indicateurs,
      vintages = vintages
    ),
    histoires = theme$compute_histoires(territoires),
    territoires = reference_territoires(territoires)
  )

  # le garde-fou du pipeline réel (point 7) : un payload invalide s'arrête là.
  # La validation reçoit la même table des vintages que l'estampillage — elle
  # vérifie chaque estampille contre la source de référence déclarée (issue #9)
  # puis exécute les validations de valeur du thème (issue #13).
  validate_payload(payload,
                   indicateurs = theme$indicateurs,
                   vintages = vintages,
                   validations = theme$validations)
}
