# compute ---------------------------------------------------------------------
# Étape 3 : calcul. Dérive les indicateurs de la fiche, les rangs-en-contexte
# et l'Histoire. Le SEAM de test : compute_payload() — la forme tabulaire du
# payload (quatre tables : indicateurs + histoires + territoires + apercu) est
# le contrat (test-contract-payload.R).
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

# nom_departement -------------------------------------------------------------
# Les VRAIS noms INSEE des départements bretons (issue #115) : le `nom` d'un
# département est son nom réel (Ille-et-Vilaine, Morbihan…), jamais l'étiquette
# fonctionnelle « Département XX ». Déclaré dans le squelette PARTAGÉ — chaque
# thème (et chaque consommateur : fiche, fil d'Ariane, sous-titre d'Histoire)
# hérite du même nom. Un code hors carte (défensif) garde l'étiquette
# fonctionnelle — le squelette nomme ce qu'il connaît, ne casse pas ce qu'il
# ne connaît pas.
NOMS_DEPARTEMENTS <- c(
  "22" = "Côtes-d'Armor",
  "29" = "Finistère",
  "35" = "Ille-et-Vilaine",
  "56" = "Morbihan"
)

nom_departement <- function(code) {
  unname(ifelse(is.na(NOMS_DEPARTEMENTS[code]),
                paste0("Département ", code),
                NOMS_DEPARTEMENTS[code]))
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

  # Fix « Sans objet » (issue #131, décision 2026-08-06) : une commune sans
  # EPCI (les trois îles bretonnes — la base INSEE les code « ZZZZZZZZZ »,
  # normalisé en NA à la lecture par lire_epci) n'agrège à AUCUN niveau EPCI.
  # GARDE, pas un skip silencieux : une commune qui porte un libellé d'EPCI
  # sans SIREN est une donnée corrompue — le squelette refuse de fabriquer un
  # EPCI fantôme (« Sans objet ») dont tous les membres seraient sans EPCI.
  sans_siren <- base[is.na(base$epci) & !is.na(base$nom_epci), ]
  if (nrow(sans_siren) > 0) {
    stop("squelette_territoires : communes avec un libellé d'EPCI mais sans ",
         "SIREN (une commune sans EPCI doit porter epci = NA ET nom_epci = NA — ",
         "le code « ZZZZZZZZZ » de la base INSEE n'est pas un EPCI) : ",
         paste(unique(sans_siren$code), collapse = ", "), ".", call. = FALSE)
  }

  # Chaque niveau d'agrégat = un group_by des identifiants. Le nom d'un EPCI
  # est son LIBEPCI (porté par ses communes, point 1) ; son département est
  # celui de la pluralité de sa population (point 6). Issue #32 : les lignes
  # EPCI portent epci = NA (la colonne epci ne concerne que les communes —
  # miroir de `departement`, qui ne concerne que communes + EPCIs). Le
  # group_by(epci) garderait la clé comme colonne : on l'écrase en NA
  # explicitement, sinon l'EPCI « s'appartiendrait ». Issue #131 : les
  # communes SANS EPCI sont filtrées EXPLICITEMENT avant le group_by — jamais
  # un EPCI fantôme construit depuis un group NA (la garde ci-dessus rend la
  # donnée corrompue bruyante, le filtre rend le cas légitime déterministe).
  epcis <- base %>%
    dplyr::filter(!is.na(epci)) %>%
    dplyr::group_by(epci) %>%
    dplyr::summarise(
      code = dplyr::first(epci),
      nom = dplyr::first(nom_epci),
      type = "epci",
      departement = departement_pluralite(.data[[poids]], departement),
      epci = NA_character_,
      .groups = "drop"
    )

  deps <- base %>%
    dplyr::group_by(departement) %>%
    dplyr::summarise(
      code = dplyr::first(departement),
      nom = nom_departement(dplyr::first(departement)),
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
# Quatre tables, le contrat : indicateurs (une ligne par territoire x clé,
# détail pour les multi-valeurs), histoires (une ligne par territoire), la
# référence des territoires (les noms réels) et apercu (les stats de base de
# l'onglet Aperçu, une ligne par territoire x clé). C'est aussi le schéma
# Supabase — rien de plus, rien de moins (docs/architecture.md).

# L'estampille de chaque indicateur vient du vintage de SA source de référence
# (déclarée dans la table INDICATEURS_<theme> du thème) — jamais d'un tampon de
# thème (issue #9). La jointure se fait sur l'id du manifeste
# (source_reference -> vintages$id), jamais par un sous-ensemble implicite.
# Issue #13 : `theme` est le nom du thème (colonne du payload) et
# `indicateurs_table` SA table déclarative — tout vient du descripteur.
# Issue #17 : la colonne nullable `n` (le nombre d'observations des indicateurs
# d'échantillon — DVF/DPE) est portée si (et seulement si) les tables
# d'indicateurs du thème la déclarent — `any_of` : Démographie (pas de n)
# garde exactement son contrat, Habitat la publie.
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
    dplyr::select(dplyr::any_of(c(
      "territoire", "type", "theme", "key", "detail", "value", "unit",
      "rang_epci", "rang_dep", "rang_reg",
      "vintage_source", "vintage_version",
      "vintage_date_reference", "vintage_date_publication",
      "n"
    )))
}

# assemble_apercu -------------------------------------------------------------
# La table des stats de base de l'onglet Aperçu (issue #32, ADR-0007) : une
# ligne par (territoire × clé), la forme du contrat (territoire | type | key |
# value | unit). L'app la rend, elle ne la dérive jamais. Chaque thème déclare
# SES clés (construire_apercu_<theme> + APERCU_<theme>) — le gating par thème :
# un thème non construit ne déclare rien et la table est vide mais présente,
# jamais un « under construction » (ADR-0007). La colonne `type` vient de la
# table des territoires, comme pour les indicateurs.
assemble_apercu <- function(territoires, apercu) {
  if (length(apercu) == 0) {
    return(tibble::tibble(
      territoire = character(),
      type = character(),
      key = character(),
      value = numeric(),
      unit = character()
    ))
  }
  apercu %>%
    dplyr::bind_rows() %>%
    dplyr::left_join(territoires[c("code", "type")], by = "code") %>%
    dplyr::rename(territoire = code) %>%
    dplyr::select(territoire, type, key, value, unit)
}

# reference_territoires -------------------------------------------------------
# La table de référence des territoires — les noms réels (LIBGEO/LIBEPCI) et
# l'appartenance départementale, une ligne par territoire. C'est la dimension
# que l'app joint aux tables de faits : elle rend (les noms), elle ne calcule
# pas. Projetée depuis la table des territoires — jamais une seconde source de
# noms. Issue #13 : le squelette étant partagé, UNE SEULE table de référence
# sert tous les thèmes (la région n'appartient à aucun département — NA ; les
# EPCIs portent le département de la pluralité, point 6).
# Issue #32 : la colonne epci — chaque commune porte l'EPCI dont elle est
# membre (le SIREN — le nom vit dans la colonne nom), les EPCIs / départements
# / région portent NA. Miroir de `departement` : c'est l'échelle du contexte
# switcher (commune -> EPCI -> département -> région) qu'ADR-0007 branche sur
# l'onglet Aperçu.
reference_territoires <- function(territoires) {
  territoires %>%
    dplyr::transmute(
      territoire = code,
      type = type,
      nom = nom,
      departement = departement,
      epci = epci
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
                             validations = list(),
                             apercu = APERCU_DEMOGRAPHIE) {
  ind <- payload$indicateurs
  ref <- payload$territoires

  # 1. pas de ligne en double (territoire × key × detail)
  dups <- duplicated(ind[c("territoire", "key", "detail")])
  if (any(dups)) {
    stop("Payload invalide : lignes en double (territoire × key × detail).",
         call. = FALSE)
  }

  # 2. la table des indicateurs du thème fait foi : chaque clé du payload y est
  # déclarée (issue #9), avec la bonne multiplicité par territoire. Issue #97 :
  # une multiplicité NA (table INDICATEURS_<theme>) déclare une clé à nombre de
  # lignes VARIABLE par territoire — la LQ commune × activité n'a pas un nombre
  # fixe de lignes par commune (une ligne par cellule observée). La clé reste
  # déclarée et présente, seule l'égalité exacte est levée pour elle ; les
  # autres clés gardent leur multiplicité entière (comportement inchangé pour
  # Démographie/Habitat, qui ne déclarent jamais NA).
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
  fixes <- !is.na(declares)
  mal <- rownames(comptes)[apply(comptes[, names(declares), drop = FALSE],
                                 1, function(ligne) {
                                   any(ligne[fixes] != declares[fixes])
                                 })]
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

  # 5bis. la colonne epci de la table de référence (issue #32, INVERSEE par le
  # fix « Sans objet » #131 — décision 2026-08-06) : une commune PEUT être
  # sans EPCI (légitime — les trois îles bretonnes 22016 Île-de-Bréhat, 29083
  # Île-de-Sein, 29155 Ouessant, que la base INSEE code « ZZZZZZZZZ »,
  # normalisé en NA à la lecture). L'échelle reste verrouillée : les EPCIs /
  # départements / région portent NA (miroir de `departement`), chaque EPCI
  # porté par une commune est un territoire EPCI de la référence — et une
  # ligne EPCI doit porter un VRAI SIREN (9 chiffres), jamais un code fantôme
  # fabriqué depuis des communes sans EPCI.
  if (!"epci" %in% names(ref)) {
    stop("Payload invalide : la colonne epci manque à la table de référence.",
         call. = FALSE)
  }
  agrega_avec_epci <- ref$territoire[ref$type != "commune" & !is.na(ref$epci)]
  if (length(agrega_avec_epci) > 0) {
    stop("Payload invalide : un territoire non-commune porte un EPCI : ",
         paste(agrega_avec_epci, collapse = ", "), ".", call. = FALSE)
  }
  epcis_connus <- ref$territoire[ref$type == "epci"]
  portes <- ref$epci[ref$type == "commune"]
  # les communes sans EPCI (NA) ne portent rien à vérifier — seules les
  # valeurs réelles doivent être des EPCIs connus de la référence
  epci_inconnus <- setdiff(portes[!is.na(portes)], epcis_connus)
  if (length(epci_inconnus) > 0) {
    stop("Payload invalide : un EPCI de commune inconnu de la référence : ",
         paste(epci_inconnus, collapse = ", "), ".", call. = FALSE)
  }
  sirens <- ref$territoire[ref$type == "epci"]
  non_siren <- sirens[!grepl("^[0-9]{9}$", sirens)]
  if (length(non_siren) > 0) {
    stop("Payload invalide : une ligne EPCI ne porte pas un vrai SIREN : ",
         paste(non_siren, collapse = ", "), ".", call. = FALSE)
  }

  # 5ter. la table apercu (issue #32, ADR-0007) : présente, la forme du
  # contrat, une ligne par (territoire × clé) — chaque clé déclarée par le
  # thème (sa table APERCU_<theme>), chaque territoire couvert, aucune clé
  # hors contrat. La table est le contrat de l'onglet Aperçu : l'app la rend,
  # elle ne la dérive jamais — une clé manquante ou une clé fantôme casse
  # l'onglet.
  if (!"apercu" %in% names(payload)) {
    stop("Payload invalide : la table apercu manque au payload.", call. = FALSE)
  }
  ap <- payload$apercu
  if (!identical(names(ap), c("territoire", "type", "key", "value", "unit"))) {
    stop("Payload invalide : la table apercu n'a pas la forme du contrat ",
         "(territoire | type | key | value | unit).", call. = FALSE)
  }
  if (any(duplicated(ap[c("territoire", "key")]))) {
    stop("Payload invalide : lignes apercu en double (territoire × key).",
         call. = FALSE)
  }
  declares_ap <- stats::setNames(apercu$multiplicite, apercu$key)
  comptes_ap <- table(ap$territoire, ap$key)
  non_declarees_ap <- setdiff(colnames(comptes_ap), names(declares_ap))
  if (length(non_declarees_ap) > 0) {
    stop("Payload invalide : clé apercu non déclarée : ",
         paste(non_declarees_ap, collapse = ", "), ".", call. = FALSE)
  }
  manquantes_ap <- setdiff(names(declares_ap), colnames(comptes_ap))
  if (length(manquantes_ap) > 0) {
    stop("Payload invalide : clés apercu manquantes : ",
         paste(manquantes_ap, collapse = ", "), ".", call. = FALSE)
  }
  if (nrow(comptes_ap) > 0 && ncol(comptes_ap) > 0) {
    mal_ap <- rownames(comptes_ap)[
      apply(comptes_ap[, names(declares_ap), drop = FALSE],
            1, function(ligne) any(ligne != declares_ap))]
    if (length(mal_ap) > 0) {
      stop("Payload invalide : clés apercu inattendues pour ",
           paste(mal_ap, collapse = ", "), ".", call. = FALSE)
    }
  }
  inconnus_ap <- setdiff(unique(ap$territoire), connus)
  if (length(inconnus_ap) > 0) {
    stop("Payload invalide : apercu pour un territoire inconnu : ",
         paste(inconnus_ap, collapse = ", "), ".", call. = FALSE)
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
    territoires = reference_territoires(territoires),
    apercu = assemble_apercu(territoires, theme$construire_apercu(territoires))
  )

  # le garde-fou du pipeline réel (point 7) : un payload invalide s'arrête là.
  # La validation reçoit la même table des vintages que l'estampillage — elle
  # vérifie chaque estampille contre la source de référence déclarée (issue #9)
  # puis exécute les validations de valeur du thème (issue #13). Issue #32 :
  # elle reçoit aussi la table déclarative APERCU_<theme> du thème — les clés
  # de l'Aperçu sont vérifiées comme celles des indicateurs.
  validate_payload(payload,
                   indicateurs = theme$indicateurs,
                   vintages = vintages,
                   validations = theme$validations,
                   apercu = theme$apercu)
}
