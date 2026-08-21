# test-theme-metadata ----------------------------------------------------------
# Le contrat de métadonnées par thème (issue #309, parent #308) : chaque thème
# construit publie UN fichier theme_<theme>.json qui déclare l'ordre des
# sous-groupes de la fiche, leurs labels et cadrages, les familles de figures,
# le texte riche TYPÉ des lectures (jamais de HTML brut), le lien vers
# l'histoire résolue de chaque sous-groupe et la politique de source de
# référence des indicateurs. Ce test EST le contrat côté pipeline — le miroir
# de app/src/__tests__/theme-metadata.spec.ts (le même jeu de règles, les
# mêmes fixtures).
#
# Les cas couverts (acceptance #309) :
#   - les fixtures valides passent (un thème à un sous-groupe : Démographie ;
#     un thème à deux sous-groupes : Économie — l'ordre des sous-groupes) ;
#   - la politique de source : chaque indicateur déclare sa source de référence,
#     présente dans les vintages quand la table est passée ;
#   - échouent FORT : thème absent, sous-groupe invalide, figure invalide,
#     texte riche invalide, référence cross-thème et lien d'histoire inconnu ;
#   - la frontière explicite : Programmes & financements est un contrat de
#     publication SÉPARÉ (programmes.json, ADR-0013) — jamais un thème, aucun
#     fichier theme_programmes.json fabriqué.

lire_metadata <- function(nom) {
  jsonlite::fromJSON(
    testthat::test_path("fixtures", "theme-metadata", nom),
    simplifyVector = FALSE
  )
}

test_that("valider_theme_metadata : les fixtures valides passent", {
  for (nom in c("theme-demographie-valide.json", "theme-economie-valide.json",
                "theme-mobilite-valide.json")) {
    expect_no_error(valider_theme_metadata(lire_metadata(nom)))
  }
})

test_that("valider_theme_metadata : le pool Mobilité déclare sa candidate de saillance au registre", {
  # Le registre story_keys du thème déclare AUSSI les candidates de saillance
  # (ADR-0002) — pas seulement la story liée par le sous-groupe : le payload
  # publié résout « ce-que-le-velo-preserve » là où le delta tire, le candidat
  # partage le slot du défaut (acces-aux-services). Une story déclarée mais non
  # liée est LÉGITIME quand le registre de résolution la déclare candidate du
  # groupe d'un sous-groupe — jamais une lecture en double, jamais un slot
  # supplémentaire. La bijection (territoire × groupe) reste garantie : le
  # candidat partage le groupe du défaut, une lecture résolue par slot.
  meta <- lire_metadata("theme-mobilite-valide.json")
  expect_identical(unlist(meta$story_keys, use.names = FALSE),
                   c("vingt-minutes-sans-voiture", "ce-que-le-velo-preserve"))
  expect_no_error(valider_theme_metadata(meta))
})

test_that("valider_theme_metadata : les sources de référence existent dans les vintages du thème", {
  expect_no_error(
    valider_theme_metadata(lire_metadata("theme-demographie-valide.json"),
                           vintages = vintages_demographie())
  )
  expect_no_error(
    valider_theme_metadata(lire_metadata("theme-economie-valide.json"),
                           vintages = vintages_economie())
  )
})

test_that("valider_theme_metadata : un thème absent est rejeté", {
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$theme <- NULL
  expect_error(valider_theme_metadata(meta), "theme")
})

test_that("valider_theme_metadata : la frontière Programmes — jamais un thème", {
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$theme <- "programmes"
  expect_error(valider_theme_metadata(meta), "SÉPARÉ")
})

test_that("valider_theme_metadata : un sous-groupe invalide est rejeté", {
  # clé de sous-groupe en double
  meta <- lire_metadata("theme-economie-valide.json")
  meta$subgroups[[2]]$key <- meta$subgroups[[1]]$key
  expect_error(valider_theme_metadata(meta), "double")

  # indicateur hors du registre indicator_keys
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$subgroups[[1]]$indicators <- c(meta$subgroups[[1]]$indicators, "fantome")
  expect_error(valider_theme_metadata(meta), "indicator_keys")

  # liste d'indicateurs vide
  meta <- lire_metadata("theme-economie-valide.json")
  meta$subgroups[[2]]$indicators <- list()
  expect_error(valider_theme_metadata(meta), "indicateur")
})

test_that("valider_theme_metadata : une figure invalide est rejetée", {
  # famille hors contrat
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$subgroups[[1]]$figure$family <- "camembert"
  expect_error(valider_theme_metadata(meta), "figure")

  # la figure rend un indicateur que le sous-groupe ne possède pas
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$subgroups[[1]]$figure$indicator <- "fantome"
  expect_error(valider_theme_metadata(meta), "figure")
})

test_that("valider_theme_metadata : un texte riche invalide est rejeté", {
  # type de nœud inconnu (le HTML n'est pas un type) — la lecture vit dans le
  # sous-groupe 2 (trajectoire-demographique) de la fixture #370
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$subgroups[[2]]$reading$template[[1]]$type <- "html"
  expect_error(valider_theme_metadata(meta), "HTML")

  # HTML brut dans un nœud text
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$subgroups[[2]]$reading$template[[1]]$content <- "<strong>gras</strong>"
  expect_error(valider_theme_metadata(meta), "HTML")

  # lien sans href
  meta <- lire_metadata("theme-demographie-valide.json")
  template <- meta$subgroups[[2]]$reading$template
  lien_idx <- which(vapply(template, function(n) identical(n$type, "link"), logical(1L)))
  meta$subgroups[[2]]$reading$template[[lien_idx]]$href <- NULL
  expect_error(valider_theme_metadata(meta), "lien")

  # paramètre non déclaré dans reading.params
  meta <- lire_metadata("theme-demographie-valide.json")
  template <- meta$subgroups[[2]]$reading$template
  param_idx <- which(vapply(template, function(n) identical(n$type, "param"), logical(1L)))[1]
  meta$subgroups[[2]]$reading$template[[param_idx]]$key <- "fantome"
  expect_error(valider_theme_metadata(meta), "param")
})

test_that("valider_theme_metadata : une référence cross-thème est rejetée", {
  # une story d'un autre thème dans story_keys (la Mobilité dans la Démographie)
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$story_keys <- c(meta$story_keys, "vingt-minutes-sans-voiture")
  expect_error(valider_theme_metadata(meta), "cross-thème")
})

test_that("valider_theme_metadata : un lien d'histoire inconnu est rejeté", {
  # la lecture d'un sous-groupe pointe une story non déclarée dans story_keys
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$subgroups[[2]]$reading$story_key <- "histoire-inconnue"
  expect_error(valider_theme_metadata(meta), "inconnu")

  # une story déclarée sans sous-groupe qui la lit (orpheline) — #370 : la
  # lecture retirée du seul sous-groupe qui la lisait, la story n'est plus
  # liée et n'est pas une candidate de saillance déclarée (ADR-0002)
  meta <- lire_metadata("theme-economie-valide.json")
  meta$subgroups[[1]]$reading <- NULL
  # les libellés de paramètres suivent l'union des lectures restantes (vide)
  meta$param_labels <- list()
  expect_error(valider_theme_metadata(meta), "orpheline")
})

test_that("valider_theme_metadata : la politique de source de référence", {
  # une clé d'indicateur sans source déclarée
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$sources <- meta$sources[names(meta$sources) != "densite"]
  expect_error(valider_theme_metadata(meta), "source")

  # une source de référence absente des vintages
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$sources$densite <- "source-fantome"
  expect_error(
    valider_theme_metadata(meta, vintages = vintages_demographie()),
    "vintages"
  )
})

test_that("valider_theme_metadata : les pages scalaires rejettent les cinq dérives typées", {
  mutations <- list(
    direction_typée = function(meta) { meta$indicator_pages$densite$direction <- "Descriptif"; meta },
    niveaux_dupliqués = function(meta) { meta$indicator_pages$densite$levels <- c("commune", "commune"); meta },
    source_inconnue = function(meta) { meta$indicator_pages$densite$sources <- "missing"; meta },
    source_dupliquée = function(meta) { meta$indicator_pages$densite$sources <- c("serie_historique", "serie_historique"); meta },
    source_de_référence_absente = function(meta) { meta$indicator_pages$densite$sources <- "age_detail"; meta },
    vintage_dupliqué = function(meta) { meta$indicator_pages$densite$vintage <- "ancienne valeur"; meta },
    détail_invalide = function(meta) { meta$indicator_pages$densite$detail <- 42; meta },
    clé_indicateur_incohérente = function(meta) { meta$indicator_pages$densite$indicator <- "autre"; meta }
  )
  for (nom in names(mutations)) {
    meta <- lire_metadata("theme-demographie-valide.json")
    meta <- mutations[[nom]](meta)
    expect_error(valider_theme_metadata(meta), "indicator_pages", info = nom)
  }
})

# Les libellés payload-owned (issue #318) — les trois cartes de vocabulaire
# que le thème déclare : indicator_labels (EXACTEMENT indicator_keys),
# detail_labels (clés ⊆ indicator_keys, chaque valeur une carte détail →
# libellé non vide) et param_labels (EXACTEMENT l'union des reading.params
# déclarés par les sous-groupes, dans l'ordre de première déclaration).
# Chaque fixture des tests ci-dessous reçoit les cartes minimales du contrat.

metadonnees_demographie_avec_libelles <- function() {
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$indicator_labels <- list(
    densite = "Densité de population",
    structure_age = "Structure par âge",
    evolution_1968 = "Évolution de la population depuis 1968",
    taille_menages = "Taille moyenne des ménages"
  )
  meta$detail_labels <- list(
    structure_age = list(
      "<15" = "Moins de 15 ans", "15-24" = "15 à 24 ans",
      "25-39" = "25 à 39 ans", "40-54" = "40 à 54 ans",
      "55-64" = "55 à 64 ans", "65-79" = "65 à 79 ans",
      "80+" = "80 ans et plus"
    )
  )
  meta$param_labels <- list(
    periode = "Période",
    taux_solde_naturel = "Solde naturel (‰/an)",
    taux_solde_migratoire = "Solde migratoire (‰/an)",
    classification = "Classification"
  )
  # la 4e carte (issue #362) : les valeurs de lecture — la démographie
  # référence `classification`, la carte est requise (le miroir de l'app)
  meta$classification_labels <- list(
    `attire-renouvelle` = "attire et se renouvelle",
    `attire-meurt` = "attire, mais se meurt",
    `vide-meurt` = "se vide et se meurt",
    `vide-renouvelle` = "se vide, mais se renouvelle"
  )
  meta
}

test_that("valider_theme_metadata : les cartes de libellés valides passent (indicator/detail/param)", {
  expect_no_error(valider_theme_metadata(metadonnees_demographie_avec_libelles()))
})

test_that("valider_theme_metadata : indicator_labels déclare EXACTEMENT indicator_keys", {
  # un indicateur du registre sans libellé
  meta <- metadonnees_demographie_avec_libelles()
  meta$indicator_labels <- meta$indicator_labels[names(meta$indicator_labels) != "densite"]
  expect_error(valider_theme_metadata(meta), "indicator_labels")

  # un libellé déclaré pour une clé hors du registre (fantôme)
  meta <- metadonnees_demographie_avec_libelles()
  meta$indicator_labels$fantome <- "Libellé fantôme"
  expect_error(valider_theme_metadata(meta), "indicator_labels")

  # un libellé vide
  meta <- metadonnees_demographie_avec_libelles()
  meta$indicator_labels$densite <- ""
  expect_error(valider_theme_metadata(meta), "indicator_labels")

  # une carte absente
  meta <- metadonnees_demographie_avec_libelles()
  meta$indicator_labels <- NULL
  expect_error(valider_theme_metadata(meta), "indicator_labels")
})

test_that("valider_theme_metadata : detail_labels — clés ⊆ indicator_keys, libellés non vides", {
  # une clé de détail hors du registre des indicateurs
  meta <- metadonnees_demographie_avec_libelles()
  meta$detail_labels$fantome <- list(x = "y")
  expect_error(valider_theme_metadata(meta), "detail_labels")

  # un libellé de détail vide
  meta <- metadonnees_demographie_avec_libelles()
  meta$detail_labels$structure_age[["15-24"]] <- ""
  expect_error(valider_theme_metadata(meta), "detail_labels")

  # un libellé de détail non-chaîne
  meta <- metadonnees_demographie_avec_libelles()
  meta$detail_labels$structure_age[["15-24"]] <- 42
  expect_error(valider_theme_metadata(meta), "detail_labels")

  # une carte de détail absente
  meta <- metadonnees_demographie_avec_libelles()
  meta$detail_labels <- NULL
  expect_error(valider_theme_metadata(meta), "detail_labels")
})

test_that("valider_theme_metadata : param_labels déclare EXACTEMENT l'union des reading.params", {
  # un paramètre de lecture sans libellé
  meta <- metadonnees_demographie_avec_libelles()
  meta$param_labels <- meta$param_labels[names(meta$param_labels) != "periode"]
  expect_error(valider_theme_metadata(meta), "param_labels")

  # un libellé pour un paramètre jamais déclaré (fantôme)
  meta <- metadonnees_demographie_avec_libelles()
  meta$param_labels$fantome <- "Libellé fantôme"
  expect_error(valider_theme_metadata(meta), "param_labels")

  # une carte absente
  meta <- metadonnees_demographie_avec_libelles()
  meta$param_labels <- NULL
  expect_error(valider_theme_metadata(meta), "param_labels")
})

# Les libellés des classifications (issue #362) — la 4e carte du vocabulaire :
# les VALEURS de lecture (les quadrants/lectures du pipeline), pas les
# paramètres. REQUISE dès que l'union des reading.params référence
# `classification` — le miroir EXACT de l'app (validerThemeMetadata) ; le thème
# qui ne la référence jamais (Mobilité) n'en a pas besoin. Présente, elle doit
# être un objet NON VIDE de chaînes non vides (la discipline des cartes #318).
# La couverture contre les valeurs publiées est la parité de chargement de
# l'app (verifierPariteLibelles) — le fichier, lui, reste auto-contenu.

test_that("valider_theme_metadata : classification_labels — une carte non vide de chaînes non vides", {
  # le cas valide passe (la carte complète des quatre lectures)
  expect_no_error(valider_theme_metadata(metadonnees_demographie_avec_libelles()))

  # un libellé vide est rejeté
  meta <- metadonnees_demographie_avec_libelles()
  meta$classification_labels[["attire-meurt"]] <- ""
  expect_error(valider_theme_metadata(meta), "classification_labels")

  # un libellé non-chaîne est rejeté
  meta <- metadonnees_demographie_avec_libelles()
  meta$classification_labels[["attire-meurt"]] <- 42
  expect_error(valider_theme_metadata(meta), "classification_labels")

  # une carte non-objet est rejetée
  meta <- metadonnees_demographie_avec_libelles()
  meta$classification_labels <- "attire et se renouvelle"
  expect_error(valider_theme_metadata(meta), "classification_labels")

  # une carte vide est rejetée
  meta <- metadonnees_demographie_avec_libelles()
  meta$classification_labels <- list()
  expect_error(valider_theme_metadata(meta), "classification_labels")
})

test_that("valider_theme_metadata : la lecture qui référence « classification » exige la carte (#362, le miroir exact de l'app)", {
  # La démographie référence `classification` dans ses reading.params — sans la
  # carte, la lecture rendrait la clé brute (attire-meurt) : rejetée FORT,
  # exactement comme le validateur de l'app (validerThemeMetadata). La règle est
  # locale aux métadonnées (l'union des reading.params) — aucun besoin des
  # histoires publiées : le miroir R/TS peut être exact.
  meta <- metadonnees_demographie_avec_libelles()
  meta$classification_labels <- NULL
  expect_error(valider_theme_metadata(meta), "classification_labels")
})

# L'audit ordinal de l'issue #368 : CHAQUE clé classée de CHAQUE thème déclare
# SA direction (ADR-0015) — aucune clé ne se repose sur le défaut high-is-good
# de la machinerie. Le registre des clés classées est la table déclarative des
# indicateurs du thème (INDICATEURS_<THEME>) ; les valeurs de lecture
# supplémentaires (div_loss_t/b, trajectoire_artif_par_habitant) sont des
# déclarations documentées, jamais des clés du registre.
test_that("directions : chaque clé classée de chaque thème déclare SA direction (aucun défaut silencieux, #368)", {
  # le registre par thème : les thèmes légers (Économie, Mobilité) ne portent
  # pas de membre `indicateurs` — leur registre est leur table déclarative
  registre <- list(
    demographie = INDICATEURS_DEMOGRAPHIE$key,
    habitat = INDICATEURS_HABITAT$key,
    milieux = INDICATEURS_MILIEUX$key,
    economie = INDICATEURS_ECONOMIE$key,
    mobilite = INDICATEURS_MOBILITE$key
  )
  # les valeurs de lecture supplémentaires déclarées (jamais des clés du
  # registre — des lectures de Story rendues avec leur glyph directionnel)
  lectures_documentees <- list(
    mobilite = c("div_loss_t", "div_loss_b"),
    milieux = "trajectoire_artif_par_habitant"
  )

  for (theme in names(registre)) {
    descripteur <- get(paste0("theme_", theme))()
    directions <- descripteur$directions

    # le membre directions est présent et déclare EXACTEMENT le registre +
    # les lectures documentées — aucune clé du registre sans direction
    manquantes <- setdiff(registre[[theme]], names(directions))
    expect_true(length(manquantes) == 0L, info = paste(
      theme, ": clé(s) classée(s) sans direction (défaut high-is-good) :",
      paste(manquantes, collapse = ", ")))
    lectures <- if (is.null(lectures_documentees[[theme]])) {
      character(0L)
    } else {
      lectures_documentees[[theme]]
    }
    expect_setequal(names(directions), c(registre[[theme]], lectures))
    # chaque direction est une valeur du contrat (high | low)
    expect_true(all(vapply(directions, function(d) d %in% c("high", "low"),
                           logical(1L))), info = theme)
  }
})

# La décomposition des sous-groupes (issue #370, parent #367) : les CINQ thèmes
# déclarent leurs sous-groupes en ordre de fiche — Mobilité ×4, Démographie ×2,
# Habitat ×3, Économie ×2, Milieux ×1 (douze sous-groupes : le « 13 » des
# tickets #367/#370 est une coquille de comptage, la décomposition énumérée
# fait foi). Le fichier épinglé est le contrat : les clés exactes, l'ordre,
# les libellés et l'appartenance des indicateurs — la parité registres ↔
# sous-groupes (chaque indicateur dans EXACTEMENT un sous-groupe, chaque story
# lue par EXACTEMENT un sous-groupe ou candidate déclarée) reste vérifiée par
# valider_theme_metadata. `structure-verte` ne déclare AUCUNE lecture — le
# sous-groupe silencieux de la grammaire (#370).
test_that("sous-groupes : la décomposition #370 — douze sous-groupes, ordre de fiche exact, familles des huit", {
  attendu <- list(
    mobilite = list(
      c("acces-aux-services", "partage-de-lespace-public",
        "motorisation", "offre-transports-commun"),
      c("comparison-bars", "composition", "composition", "scalar")
    ),
    demographie = list(
      c("etat-de-la-population", "trajectoire-demographique"),
      c("pyramid", "trajectory")
    ),
    habitat = list(
      c("composition-du-parc", "etat-energetique-du-parc", "marche"),
      c("composition", "composition", "trajectory")
    ),
    economie = list(
      c("sante-et-taille", "structure-verte"),
      c("scalar", "scalar")
    ),
    milieux = list(
      c("artificialisation"),
      c("comparison-bars")
    )
  )
  familles_contractuelles <- c(
    "scalar", "composition", "trajectory", "distribution",
    "relationship", "list", "pyramid", "comparison-bars"
  )
  expect_identical(FAMILLES_FIGURE, familles_contractuelles)

  for (theme in names(attendu)) {
    meta <- lire_theme_metadata(theme)
    cles <- vapply(meta$subgroups, function(g) g$key, character(1L))
    familles <- vapply(meta$subgroups, function(g) g$figure$family, character(1L))
    expect_identical(cles, attendu[[theme]][[1L]], info = theme)
    expect_identical(familles, attendu[[theme]][[2L]], info = theme)
    # chaque famille déclarée est l'une des huit de la grammaire (ADR-0023)
    expect_true(all(familles %in% FAMILLES_FIGURE), info = theme)
    # le registre des sous-groupes et la résolution restent en parité : le
    # groupe de chaque story résolue est un sous-groupe déclaré
    registre <- STORIES_RESOLUES_PAR_THEME[[theme]]
    expect_true(all(registre$groupe %in% cles), info = theme)
    expect_no_error(valider_theme_metadata(meta))
  }
})

test_that("Mobilité #369 places parking and fuel comparison in their semantic groups", {
  meta <- lire_theme_metadata("mobilite")
  groupe <- setNames(lapply(meta$subgroups, `[[`, "indicators"),
                     vapply(meta$subgroups, `[[`, character(1), "key"))

  expect_true(all(c("tot_loss_t", "tot_loss_b") %in% groupe[["acces-aux-services"]]))
  expect_false(any(c("places_stationnement_voiture_1000",
                     "stationnement_velo_par_voiture",
                     "bornes_ev_par_station_service") %in% groupe[["acces-aux-services"]]))
  expect_true(all(c("places_stationnement_voiture_1000",
                    "stationnement_velo_par_voiture") %in% groupe[["partage-de-lespace-public"]]))
  expect_true("bornes_ev_par_station_service" %in% groupe[["motorisation"]])
})

test_that("sous-groupes : structure-verte ne déclare AUCUNE lecture — le sous-groupe silencieux (#370)", {
  meta <- lire_theme_metadata("economie")
  structure_verte <- meta$subgroups[[2L]]
  expect_identical(structure_verte$key, "structure-verte")
  expect_null(structure_verte$reading)
  # la bijection des histoires reste vraie : l'unique story d'Économie est lue
  # par EXACTEMENT un sous-groupe (sante-et-taille), rien d'orphelin
  expect_no_error(valider_theme_metadata(meta))
  # ce-que-la-bretagne-abrite a QUITTÉ le registre de la fiche (#370) — la
  # région ne porte plus de lecture de structure, la story est retirée du
  # contrat des deux côtés
  expect_identical(unlist(meta$story_keys, use.names = FALSE),
                   "ce-que-la-commune-abrite")
  expect_identical(CLES_HISTOIRES_PAR_THEME$economie,
                   "ce-que-la-commune-abrite")
  expect_identical(STORIES_RESOLUES_PAR_THEME$economie$story_key,
                   "ce-que-la-commune-abrite")
})

test_that("valider_theme_metadata : un sous-groupe sans lecture valide (le sous-groupe silencieux, #370)", {
  meta <- lire_metadata("theme-economie-valide.json")
  expect_null(meta$subgroups[[2L]]$reading)
  expect_no_error(valider_theme_metadata(meta))
})

test_that("valider_theme_metadata : la famille de figure hors des huit styles prédéfinis est rejetée (#370)", {
  # la grammaire fermée (ADR-0023) : les huit familles seulement — `profile`
  # (la famille d'avant la grammaire) comme `camembert` sont hors contrat
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$subgroups[[1L]]$figure$family <- "profile"
  expect_error(valider_theme_metadata(meta), "hors contrat")
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$subgroups[[1L]]$figure$family <- "camembert"
  expect_error(valider_theme_metadata(meta), "hors contrat")
})
