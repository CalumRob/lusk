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
#   - le sixième thème (#408) : Programmes et subventions EST un thème — il
#     publie SON theme_programmes.json avec un registre d'histoires VIDE
#     (des indicateurs catégoriels et numériques, aucune lecture inventée).

lire_metadata <- function(nom) {
  jsonlite::fromJSON(
    testthat::test_path("fixtures", "theme-metadata", nom),
    simplifyVector = FALSE
  )
}

test_that("valider_theme_metadata : les fixtures valides passent", {
  for (nom in c("theme-demographie-valide.json", "theme-economie-valide.json",
                "theme-mobilite-valide.json", "theme-programmes-valide.json")) {
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

test_that("valider_theme_metadata : un thème hors du canon est rejeté (les six thèmes, #408)", {
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$theme <- NULL
  expect_error(valider_theme_metadata(meta), "theme")

  meta <- lire_metadata("theme-demographie-valide.json")
  meta$theme <- "financements"
  expect_error(valider_theme_metadata(meta), "thème inconnu")
})

test_that("valider_theme_metadata : le sixième thème — Programmes et subventions sans aucune lecture (#408)", {
  # Le verdict #400/#408 : Programmes et subventions EST un thème — le sixième
  # du contrat canonique. Il publie SON theme_programmes.json avec un registre
  # d'histoires VIDE : ses sous-groupes portent des indicateurs catégoriels et
  # numériques et AUCUNE lecture — jamais une lecture inventée pour remplir
  # le registre.
  meta <- lire_metadata("theme-programmes-valide.json")
  validee <- valider_theme_metadata(meta)
  expect_identical(validee$theme, "programmes")
  expect_length(validee$story_keys, 0L)
  cles <- vapply(validee$subgroups, function(g) g$key, character(1L))
  expect_identical(cles, c("couverture", "subventions"))
  for (groupe in validee$subgroups) {
    expect_null(groupe$reading)
  }

  # Le registre VIDE est légitime ; une story déclarée reste tenue à
  # l'herméticité : Programmes n'en possède aucune — toute déclaration est
  # soit cross-thème, soit inconnue du contrat.
  meta <- lire_metadata("theme-programmes-valide.json")
  meta$story_keys <- list("vingt-minutes-sans-voiture")
  expect_error(valider_theme_metadata(meta), "cross-thème")

  meta <- lire_metadata("theme-programmes-valide.json")
  meta$story_keys <- list("histoire-inconnue")
  expect_error(valider_theme_metadata(meta), "inconnue du contrat")
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

# La concordance des directions (issue #506) : la direction DÉCLARÉE par le
# descripteur de la Page d'indicateur (`indicator_pages.<clé>.direction` — le
# glyphe ▲▼ et les rangs Repères) doit ÉGALER celle du module de thème qui
# calcule les rangs publiés lus par les chips de fiche
# (`theme_<theme>()$directions` -> compute_ranks -> rang_epci/rang_dep/
# rang_reg). Une clé absente du registre du module vaut « high » — le défaut
# EXACT de compute_ranks : jamais un « moins = mieux » qui signifierait deux
# choses selon la surface, la dérive meurt à l'écriture.
test_that("valider_theme_metadata : un descripteur contradictoire au module est rejeté (#506)", {
  directions_demographie <- theme_demographie()$directions

  # le cas concordant passe : la fixture déclare « high » comme le module
  meta <- lire_metadata("theme-demographie-valide.json")
  expect_no_error(
    valider_theme_metadata(meta, directions_module = directions_demographie))

  # la contradiction : le descripteur déclare « low » là où le module déclare
  # « high » — le message nomme l'indicateur, les DEUX directions et les DEUX
  # sources de vérité (le descripteur vs le module de thème)
  meta$indicator_pages$densite$direction <- "low"
  erreur <- expect_error(
    valider_theme_metadata(meta, directions_module = directions_demographie),
    "indicator_pages\\.densite\\.direction")
  expect_match(conditionMessage(erreur),
               paste0("la direction du descripteur (« low ») contredit ",
                      "celle du module de thème (« high »)"),
               fixed = TRUE)
})

test_that("valider_theme_metadata : une clé absente du registre du module vaut high — le défaut exact de compute_ranks (#506)", {
  # le descripteur déclare « low », le module ne déclare RIEN pour la clé :
  # les rangs publiés classeraient high-is-good — la contradiction est rejetée
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$indicator_pages$densite$direction <- "low"
  expect_error(valider_theme_metadata(meta, directions_module = list()),
               "module de thème")

  # le module qui DÉCLARE « low » rend le descripteur concordant
  expect_no_error(
    valider_theme_metadata(meta, directions_module = list(densite = "low")))
})

test_that("valider_theme_metadata : sans registre de directions, la croisée ne s'applique pas (#506)", {
  # l'appel historique sans le paramètre reste valide — Programmes et
  # subventions (le thème non classé, ses rangs tous NA) ne se voit pas
  # imposer une croisée vide : la règle ne vit que là où LES DEUX
  # déclarations existent
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$indicator_pages$densite$direction <- "low"
  expect_no_error(valider_theme_metadata(meta))
})

test_that("concordance des directions : les SIX canons épinglés passent telle quelle (#506)", {
  # La porte de régression : ZÉRO faux positif sur le canon COMMITTÉ — chaque
  # thème épinglé est croisé contre SON module réel et passe sans une seule
  # exception ; Programmes (sans registre de directions) traverse la porte
  # vide, rien à contredire
  for (theme in THEMES_METADATA) {
    descripteur <- get(paste0("theme_", theme))()
    expect_error(
      valider_theme_metadata(lire_theme_metadata(theme),
                             directions_module = descripteur$directions),
      NA, info = theme)
  }
})

# La décomposition des sous-groupes (issue #370, parent #367 ; étendue par
# #408) : les SIX thèmes déclarent leurs sous-groupes en ordre de fiche —
# Mobilité ×4, Démographie ×2, Habitat ×3, Économie ×2, Milieux ×1,
# Programmes et subventions ×2 (QUATORZE sous-groupes). Le fichier épinglé
# est le contrat : les clés exactes, l'ordre, les libellés et l'appartenance
# des indicateurs — la parité registres ↔ sous-groupes (chaque indicateur dans
# EXACTEMENT un sous-groupe, chaque story lue par EXACTEMENT un sous-groupe ou
# candidate déclarée) reste vérifiée par valider_theme_metadata.
# `structure-verte` ne déclare AUCUNE lecture — le sous-groupe silencieux de
# la grammaire (#370) ; les DEUX sous-groupes Programmes (#408) n'en
# déclarent aucun non plus (le thème sans lecture).
test_that("sous-groupes : la décomposition #370 + #408 — quatorze sous-groupes, ordre de fiche exact, familles des huit", {
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
    ),
    programmes = list(
      c("couverture", "subventions"),
      c("list", "scalar")
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

test_that("valider_theme_metadata : les familles connues sont acceptées et les inconnues rejetées (#424)", {
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$subgroups[[1L]]$figure$family <- "camembert"
  expect_error(valider_theme_metadata(meta), "hors contrat")
})

# La symétrie stricte de la facette comparison (issue #431) : la variable
# comparison est scopée PAR page d'indicateur — une page SANS comparison ne
# peut jamais observer l'état (frais ou absent) des pages précédentes de la
# boucle. Fixtures miroirs : une page AVEC comparison suivie d'une SANS, dans
# les DEUX ordres — les verdicts ne dépendent jamais de l'ordre d'itération,
# et restent identiques au validateur TypeScript de l'app (validerTheme-
# Metadata). Le canon #403 n'est pas touché : ses sept descripteurs portent
# déjà leurs labels et leur comparison complète.

page_indicateur_base <- function(ind, src) {
  list(
    indicator = ind, label = "Libellé", definition = "Définition",
    unit = "unité", calculation = "Calcul", direction = "high",
    caveats = "Réserve",
    levels = list("commune", "epci", "departement"),
    sources = list(src)
  )
}

comparaison_pyramide_minimale <- function() {
  # le miroir du contrat #403 : des sexes déclarés, un détail par défaut
  list(details = list("<15", "15-24"), detail = "<15",
       sexes = list("F", "M"), sex = "F", unit = "%")
}

test_that("valider_theme_metadata : une pyramide sans comparison est rejetée quel que soit l'ordre des pages (#431)", {
  meta_pyramides <- function(inverse = FALSE) {
    meta <- lire_metadata("theme-demographie-valide.json")
    avec <- c(page_indicateur_base("evolution_1968", "serie_historique"),
              list(family = "pyramid",
                   pyramid = list(dimensions = list("detail", "sex")),
                   comparison = comparaison_pyramide_minimale()))
    sans <- c(page_indicateur_base("densite", "serie_historique"),
              list(family = "pyramid",
                   pyramid = list(dimensions = list("detail", "sex"))))
    meta$indicator_pages <- if (!inverse) {
      list(evolution_1968 = avec, densite = sans)
    } else {
      list(densite = sans, evolution_1968 = avec)
    }
    meta
  }
  # le sexe est requis pour une pyramide — dans LES DEUX ordres : la page
  # sans comparison ne peut pas hériter des sexes de la page précédente
  expect_error(valider_theme_metadata(meta_pyramides(FALSE)), "sexe est requis")
  expect_error(valider_theme_metadata(meta_pyramides(TRUE)), "sexe est requis")
})

test_that("valider_theme_metadata : une composition sans comparison reste valide quel que soit l'ordre des pages (#431)", {
  meta_compositions <- function(inverse = FALSE) {
    meta <- lire_metadata("theme-demographie-valide.json")
    avec <- c(page_indicateur_base("densite", "serie_historique"),
              list(family = "composition",
                   composition = list(parts = list("a", "b")),
                   comparison = list(details = list("a", "b"), detail = "a",
                                     unit = "u",
                                     labels = list(a = "A", b = "B"))))
    sans <- c(page_indicateur_base("evolution_1968", "serie_historique"),
              list(family = "composition",
                   composition = list(parts = list("x", "y"))))
    meta$detail_labels$densite <- list(a = "A", b = "B")
    meta$detail_labels$evolution_1968 <- list(x = "X", y = "Y")
    meta$indicator_pages <- if (!inverse) {
      list(densite = avec, evolution_1968 = sans)
    } else {
      list(evolution_1968 = sans, densite = avec)
    }
    meta
  }
  # une composition sans comparison est LÉGITIME — elle ne doit jamais
  # hériter des détails couverts par la comparison de la page précédente
  # (le rejet spurieux « détails non couverts » était dépendant de l'ordre)
  expect_no_error(valider_theme_metadata(meta_compositions(FALSE)))
  expect_no_error(valider_theme_metadata(meta_compositions(TRUE)))
})

test_that("valider_theme_metadata : parité négative composition/pyramid — libellés, parts, dimensions, sexes (#431)", {
  # une part sans libellé canonical
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$detail_labels$densite <- list(a = "A")
  meta$indicator_pages <- list(densite = c(
    page_indicateur_base("densite", "serie_historique"),
    list(family = "composition", composition = list(parts = list("a", "b")))))
  expect_error(valider_theme_metadata(meta), "libellé")

  # des parts absentes (l'extension est requise, complète)
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$indicator_pages <- list(densite = c(
    page_indicateur_base("densite", "serie_historique"),
    list(family = "composition", composition = list())))
  expect_error(valider_theme_metadata(meta), "incomplet")

  # une pyramide dont les dimensions n'incluent pas sex
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$indicator_pages <- list(densite = c(
    page_indicateur_base("densite", "serie_historique"),
    list(family = "pyramid",
         pyramid = list(dimensions = list("detail")),
         comparison = comparaison_pyramide_minimale())))
  expect_error(valider_theme_metadata(meta), "detail et sex")

  # une pyramide sans comparison.sexes
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$indicator_pages <- list(densite = c(
    page_indicateur_base("densite", "serie_historique"),
    list(family = "pyramid",
         pyramid = list(dimensions = list("detail", "sex")))))
  expect_error(valider_theme_metadata(meta), "sexe est requis")
})

# La parité trajectoires ↔ faits publiés (issue #438) : les pages de famille
# « trajectory » déclarent un chemin EXACTEMENT égal aux détails publiés de la
# clé, des bornes déclarées sans année morte, et aucun détail non annuel hors
# bornes. Le miroir TypeScript vit dans verifierPariteTrajectoires (validate.ts,
# appelée au chargement) ; côté pipeline, les règles STRUCTURELLES des bornes
# vivent dans valider_theme_metadata (donc à chaque publication et cible
# targets), et la couverture des faits s'exécute sur le payload COMMITTÉ (le
# contrat de payload committé, comme la parité des libellés) — jamais du code
# mort, jamais un chemin qui ment.

faits_trajectoires_milieux <- function() {
  tibble::tibble(
    theme = "milieux",
    key = c(rep("artif_par_habitant", 8L), rep("conso_enaf_annuel", 14L)),
    detail = c("M2", "M3", "2020", "2021", "2022", "2023", "2024", "2025",
               as.character(2011:2024))
  )
}

test_that("verifier_parite_trajectoires : le canon Milieux épinglé est en parité avec ses faits (#438)", {
  meta <- lire_theme_metadata("milieux")
  expect_identical(meta$indicator_pages$artif_par_habitant$family, "trajectory")
  expect_no_error(verifier_parite_trajectoires(meta, faits_trajectoires_milieux()))
})

test_that("verifier_parite_trajectoires : le payload COMMITTÉ et les descripteurs épinglés sont en parité (#438)", {
  # Le payload COMMITTÉ est l'artefact que l'app fetch — la même lecture que
  # la parité des libellés, et le miroir exact de verifierPariteTrajectoires
  # au chargement de l'app : chaque page trajectoire épinglée couvre
  # EXACTEMENT les détails publiés de sa clé.
  racine_public <- file.path(testthat::test_path("..", "..", ".."), "public", "data")
  expect_true(dir.exists(racine_public), info = "public/data absent - la racine du dépôt est introuvable")

  pages_trajectoires <- 0L
  for (theme in THEMES_METADATA) {
    meta <- lire_theme_metadata(theme)
    cles <- names(meta$indicator_pages)
    if (!any(vapply(meta$indicator_pages, function(p) identical(p$family, "trajectory"), logical(1L)))) next

    faits <- jsonlite::fromJSON(file.path(racine_public, paste0("indicateurs_", theme, ".json")))
    verifier_parite_trajectoires(meta, faits)
    pages_trajectoires <- pages_trajectoires +
      sum(vapply(meta$indicator_pages, function(p) identical(p$family, "trajectory"), logical(1L)))
  }
  # La couverture du devoir : les TROIS indicateurs trajectoires publiés ont
  # leur page — jamais une famille trajectoire orpheline.
  expect_identical(pages_trajectoires, 3L)
})

test_that("verifier_parite_trajectoires : une année morte déclarée échoue fort (#438)", {
  meta <- lire_theme_metadata("milieux")
  meta$indicator_pages$conso_enaf_annuel$comparison$details <-
    c(unlist(meta$indicator_pages$conso_enaf_annuel$comparison$details,
             use.names = FALSE), "2030")
  expect_error(verifier_parite_trajectoires(meta, faits_trajectoires_milieux()),
               "jamais publié")
})

test_that("verifier_parite_trajectoires : une année publiée absente du chemin échoue fort (#438)", {
  meta <- lire_theme_metadata("milieux")
  faits <- dplyr::bind_rows(faits_trajectoires_milieux(),
                            tibble::tibble(theme = "milieux", key = "conso_enaf_annuel", detail = "2010"))
  expect_error(verifier_parite_trajectoires(meta, faits), "absent du chemin")
})

test_that("valider_theme_metadata : des bornes de trajectoire incomplètes ou hors axe échouent fort (#438)", {
  meta <- lire_theme_metadata("milieux")

  # une seule borne — la trajectoire exige initial ET final
  meta$indicator_pages$artif_par_habitant$trajectory$endpoints <- list("M2")
  expect_error(valider_theme_metadata(meta), "distincts au moins")
  meta <- lire_theme_metadata("milieux")

  # une borne non déclarée dans comparison.details
  meta$indicator_pages$artif_par_habitant$trajectory$endpoints <- list("M2", "M9")
  expect_error(valider_theme_metadata(meta), "non déclarée")
  meta <- lire_theme_metadata("milieux")

  # un détail non annuel hors des bornes (l'axe ne sait pas le positionner)
  meta$indicator_pages$artif_par_habitant$comparison$details <-
    c(unlist(meta$indicator_pages$artif_par_habitant$comparison$details,
             use.names = FALSE), "ETAT")
  expect_error(valider_theme_metadata(meta), "borne déclarée")
  meta <- lire_theme_metadata("milieux")

  # l'axe fermé est REQUIS pour une trajectoire
  meta$indicator_pages$artif_par_habitant$comparison <- NULL
  expect_error(valider_theme_metadata(meta), "requis pour une trajectoire")
})

test_that("publier_theme_metadata : les bornes structurales sont câblées à la publication (#438)", {
  meta <- lire_theme_metadata("milieux")
  meta_casse <- lire_theme_metadata("milieux")
  meta_casse$indicator_pages$conso_enaf_annuel$trajectory$endpoints <-
    list("2011", "2099")

  sortie <- file.path(tempdir(), "bornes-trajectoires")
  dir.create(sortie, showWarnings = FALSE)
  on.exit(unlink(sortie, recursive = TRUE), add = TRUE)

  # un descripteur qui annonce une borne hors de son axe échoue FORT sans rien écrire
  expect_error(
    publier_theme_metadata(meta_casse, sortie, theme_attendu = "milieux"),
    "2099"
  )
  expect_false(file.exists(file.path(sortie, "theme_milieux.json")))

  # le canon épinglé passe la même porte et écrit son fichier
  expect_no_error(publier_theme_metadata(meta, sortie, theme_attendu = "milieux"))
  expect_true(file.exists(file.path(sortie, "theme_milieux.json")))
})

# La parité distributions ↔ faits publiés (issue #440) : les pages de famille
# « distribution » déclarent une signature EXACTEMENT égale aux détails
# publiés de la clé. Le miroir TypeScript vit dans verifierPariteDistributions
# (validate.ts, appelée au chargement) ; côté pipeline, les règles
# STRUCTURELLES (la facette résumée nomme sa clé et son libellé public, les
# détails de la signature ont leurs libellés canonical) vivent dans
# valider_theme_metadata (donc à chaque publication et cible targets), et la
# couverture des faits s'exécute sur le payload COMMITTÉ (le contrat de
# payload committé, comme les trajectoires #438) — jamais du code mort,
# jamais une signature qui ment.

faits_distributions_habitat <- function(details = c("A", "B", "C", "D", "E", "F", "G")) {
  tibble::tibble(theme = "habitat", key = "distribution_dpe", detail = details)
}

test_that("verifier_parite_distributions : le canon Habitat épinglé est en parité avec ses faits (#440)", {
  meta <- lire_theme_metadata("habitat")
  expect_identical(meta$indicator_pages$distribution_dpe$family, "distribution")
  expect_no_error(verifier_parite_distributions(meta, faits_distributions_habitat()))
})

test_that("verifier_parite_distributions : le payload COMMITTÉ est en parité et distribution_dpe est LA SEULE distribution publiée (#440)", {
  # Le payload COMMITTÉ est l'artefact que l'app fetch — le miroir exact de
  # verifierPariteDistributions au chargement de l'app. L'énumération est le
  # devoir : distribution_dpe (Habitat) est la SEULE page de famille
  # « distribution » publiée à travers les six thèmes — jamais une famille
  # orpheline, jamais une seconde distribution non déclarée.
  racine_public <- file.path(testthat::test_path("..", "..", ".."), "public", "data")
  expect_true(dir.exists(racine_public), info = "public/data absent - la racine du dépôt est introuvable")

  pages_distribution <- list()
  for (theme in THEMES_METADATA) {
    meta <- lire_theme_metadata(theme)
    cles <- names(meta$indicator_pages)
    if (is.null(cles)) next
    pour_theme <- cles[vapply(meta$indicator_pages, function(p) identical(p$family, "distribution"), logical(1L))]
    if (!length(pour_theme)) next
    faits <- jsonlite::fromJSON(file.path(racine_public, paste0("indicateurs_", theme, ".json")))
    verifier_parite_distributions(meta, faits)
    pages_distribution[[paste(theme, pour_theme, sep = ":")]] <- pour_theme
  }
  expect_length(pages_distribution, 1L)
  expect_identical(names(pages_distribution), "habitat:distribution_dpe")
})

test_that("verifier_parite_distributions : un détail mort ou une étiquette publiée absente échouent fort (#440)", {
  meta <- lire_theme_metadata("habitat")
  meta$indicator_pages$distribution_dpe$distribution$signature <-
    c(unlist(meta$indicator_pages$distribution_dpe$distribution$signature, use.names = FALSE), "Z")
  expect_error(verifier_parite_distributions(meta, faits_distributions_habitat()),
               "jamais publié")

  meta <- lire_theme_metadata("habitat")
  expect_error(
    verifier_parite_distributions(meta, faits_distributions_habitat(c("A", "B", "C", "D", "E", "F", "G", "H"))),
    "absent de la signature")
})

test_that("valider_theme_metadata : une distribution sans facette résumée complète échoue fort (#440)", {
  meta <- lire_theme_metadata("habitat")

  # pas de facette résumée du tout
  meta$indicator_pages$distribution_dpe$comparison <- NULL
  expect_error(valider_theme_metadata(meta), "requise pour une distribution")
  meta <- lire_theme_metadata("habitat")

  # la facette résumée ne nomme pas sa clé publiée
  meta$indicator_pages$distribution_dpe$comparison$indicator <- NULL
  expect_error(valider_theme_metadata(meta), "est requise")
  meta <- lire_theme_metadata("habitat")

  # la facette résumée n'a pas de libellé public — elle serait invisible du visiteur
  meta$indicator_pages$distribution_dpe$comparison$label <- NULL
  expect_error(valider_theme_metadata(meta), "visible du visiteur")
  meta <- lire_theme_metadata("habitat")

  # un détail de la signature sans libellé canonical
  meta$indicator_pages$distribution_dpe$distribution$signature <-
    as.list(c(unlist(meta$indicator_pages$distribution_dpe$distribution$signature,
                      use.names = FALSE), "Z"))
  expect_error(valider_theme_metadata(meta), "libellé canonical")
})

test_that("publier_theme_metadata : les règles structurales des distributions sont câblées à la publication (#440)", {
  meta <- lire_theme_metadata("habitat")
  meta_casse <- lire_theme_metadata("habitat")
  meta_casse$indicator_pages$distribution_dpe$comparison$label <- NULL

  sortie <- file.path(tempdir(), "distributions-publication")
  dir.create(sortie, showWarnings = FALSE)
  on.exit(unlink(sortie, recursive = TRUE), add = TRUE)

  # un descripteur dont la facette résumée est muette échoue FORT sans rien écrire
  expect_error(
    publier_theme_metadata(meta_casse, sortie, theme_attendu = "habitat"),
    "visible du visiteur"
  )
  expect_false(file.exists(file.path(sortie, "theme_habitat.json")))

  # le canon épinglé passe la même porte et écrit son fichier
  expect_no_error(publier_theme_metadata(meta, sortie, theme_attendu = "habitat"))
  expect_true(file.exists(file.path(sortie, "theme_habitat.json")))
})

# La parité listes ↔ faits publiés (issue #439) : les pages de famille
# « list » déclarent des catégories EXACTEMENT égales aux détails publiés de
# la clé. Le miroir TypeScript vit dans verifierPariteListes (validate.ts,
# appelée au chargement) ; côté pipeline, les règles STRUCTURELLES (chaque
# catégorie possède son libellé canonical, l'axe comparison.details couvre les
# catégories quand la facette est déclarée) vivent dans valider_theme_metadata
# (donc à chaque publication et cible targets), et la couverture des faits
# s'exécute sur le payload COMMITTÉ — le contrat de payload committé, comme
# les trajectoires #438 et les distributions #440.

faits_listes_mobilite <- function(details = c("t_longueur", "t_densite", "b_longueur", "b_densite", "c_longueur", "c_densite")) {
  tibble::tibble(theme = "mobilite", key = "reseaux", detail = details)
}

test_that("verifier_parite_listes : une catégorie morte ou un détail publié absent échouent fort (#439)", {
  meta <- lire_theme_metadata("mobilite")
  meta$indicator_pages$reseaux$list$categories <-
    c(unlist(meta$indicator_pages$reseaux$list$categories, use.names = FALSE), "Z")
  expect_error(verifier_parite_listes(meta, faits_listes_mobilite()),
               "jamais publié")

  meta <- lire_theme_metadata("mobilite")
  expect_error(
    verifier_parite_listes(meta, faits_listes_mobilite(c("t_longueur", "t_densite", "b_longueur", "b_densite", "c_longueur", "c_densite", "Z2"))),
    "absent des catégories")
})

test_that("verifier_parite_listes : le payload COMMITTÉ est en parité et les DEUX listes publiées sont déclarées (#439, #462)", {
  # Le payload COMMITTÉ est l'artefact que l'app fetch — le miroir exact de
  # verifierPariteListes au chargement de l'app. L'énumération est le devoir :
  # reseaux (Mobilité) puis subventions_par_domaine (#462) sont LES DEUX pages
  # de famille « list » publiées à travers les SIX thèmes — jamais une famille
  # orpheline, jamais une liste non déclarée.
  racine_public <- file.path(testthat::test_path("..", "..", ".."), "public", "data")
  expect_true(dir.exists(racine_public), info = "public/data absent - la racine du dépôt est introuvable")

  pages_listes <- list()
  for (theme in THEMES_METADATA) {
    meta <- lire_theme_metadata(theme)
    cles <- names(meta$indicator_pages)
    if (is.null(cles)) next
    pour_theme <- cles[vapply(meta$indicator_pages, function(p) identical(p$family, "list"), logical(1L))]
    if (!length(pour_theme)) next
    faits <- jsonlite::fromJSON(file.path(racine_public, paste0("indicateurs_", theme, ".json")))
    verifier_parite_listes(meta, faits)
    pages_listes[[paste(theme, pour_theme, sep = ":")]] <- pour_theme
  }
  expect_length(pages_listes, 2L)
  expect_identical(names(pages_listes), c("mobilite:reseaux", "programmes:subventions_par_domaine"))
})

# La Page d'indicateur « profil/liste » de subventions_par_domaine (#462) :
# le descripteur épinglé de Programmes et subventions publie la ventilation
# par domaine comme page de famille « list » — le profil COMPLET des 39
# domaines canoniques reste visible et la catégorie comparée pilote médiane,
# extrêmes, tableau et carte par les seams partagés (#439). Le contrat est
# prouvé ici contre le payload COMMITTÉ : la parité listes ↔ faits, le compte
# des domaines verrouillé bruyamment, la facette déclarée dans l'axe, et la
# publication RÉELLE du canon (le trait `metadata` du descripteur).

test_that("la page liste subventions_par_domaine publie valablement contre le payload committé (#462)", {
  meta <- lire_theme_metadata("programmes")
  page <- meta$indicator_pages$subventions_par_domaine

  # la famille « list » est déclarée, au SEUL niveau publié de la clé — la
  # ventilation par domaine est un fait communal, jamais inventé à un autre
  expect_identical(page$family, "list")
  expect_identical(unlist(page$levels, use.names = FALSE), "commune")

  racine_public <- file.path(testthat::test_path("..", "..", ".."), "public", "data")
  skip_if_not(dir.exists(racine_public), "public/data absent - la racine du dépôt est introuvable")
  faits <- jsonlite::fromJSON(file.path(racine_public, "indicateurs_programmes.json"))

  # la parité listes ↔ faits COMMITTÉS — le miroir exact de
  # verifierPariteListes au chargement de l'app
  expect_error(verifier_parite_listes(meta, faits), NA)

  # l'énumération LOUDE : les 39 domaines déclarés SONT les détails publiés,
  # la catégorie comparée vit dans l'axe fermé qui couvre les catégories
  declarees <- unlist(page$list$categories, use.names = FALSE)
  details_publies <- unique(as.character(faits$detail[faits$key == "subventions_par_domaine" &
                                                         !is.na(faits$detail)]))
  expect_length(declarees, 39L)
  expect_setequal(declarees, details_publies)
  expect_setequal(unlist(page$comparison$details, use.names = FALSE), declarees)
  expect_true(page$comparison$detail %in% declarees)

  # la page scalaire existante déclare SA dimension publiée — sans elle la
  # facette résout « toute dimension » côté modèle mais AUCUNE ligne côté
  # dispatch (le filtre strict), et ses Repères rendraient « indisponible »
  dimension_publiee <- unique(as.character(faits$dimension[faits$key == "subventions_annuelles"]))
  expect_identical(unlist(meta$indicator_pages$subventions_annuelles$comparison$dimension,
                          use.names = FALSE), dimension_publiee)

  # la publication RÉELLE du canon : le trait `metadata` passe la porte de
  # validation (sources croisées contre SES vintages) et écrit SON fichier
  descripteur <- theme_programmes()
  sortie <- file.path(tempdir(), "programmes-pages-462")
  dir.create(sortie, showWarnings = FALSE)
  on.exit(unlink(sortie, recursive = TRUE), add = TRUE)
  expect_no_error(
    publier_theme_metadata(descripteur$metadata(), sortie,
                           vintages = descripteur$vintages(),
                           theme_attendu = "programmes")
  )
  relu <- jsonlite::fromJSON(file.path(sortie, "theme_programmes.json"),
                             simplifyVector = FALSE)
  expect_error(valider_theme_metadata(relu), NA)

  # la stabilité BYTE du contrat (#462) : le canon republié par le trait
  # `metadata` est BIT À BIT l'artefact COMMITTÉ que l'app fetch — jamais un
  # écart de sérialisation entre ce qui est validé et ce qui est publié
  publie <- readBin(file.path(sortie, "theme_programmes.json"), "raw",
                    n = file.info(file.path(sortie, "theme_programmes.json"))$size)
  commis <- readBin(file.path(racine_public, "theme_programmes.json"), "raw",
                    n = file.info(file.path(racine_public, "theme_programmes.json"))$size)
  expect_identical(
    publie, commis,
    info = paste0("Programmes — le canon republié n'est PAS bit à bit ",
                  "public/data/theme_programmes.json : régénérer l'artefact ",
                  "committé par le seam (publier_theme_metadata, trait ",
                  "`metadata`) après toute modification du canon épinglé")
  )
})

test_that("valider_theme_metadata : une liste sans libellé canonical ou hors axe échoue fort (#439)", {
  meta <- lire_theme_metadata("mobilite")

  # une catégorie sans libellé canonical
  meta$indicator_pages$reseaux$list$categories <-
    as.list(c(unlist(meta$indicator_pages$reseaux$list$categories,
                      use.names = FALSE), "Z"))
  expect_error(valider_theme_metadata(meta), "libellé canonical")
  meta <- lire_theme_metadata("mobilite")

  # une catégorie déclarée absente de l'axe comparison.details
  meta$indicator_pages$reseaux$comparison$details <-
    as.list(head(unlist(meta$indicator_pages$reseaux$list$categories,
                        use.names = FALSE), 5L))
  expect_error(valider_theme_metadata(meta), "couvertes")
})

test_that("publier_theme_metadata : les règles structurales des listes sont câblées à la publication (#439)", {
  meta <- lire_theme_metadata("mobilite")
  meta_casse <- lire_theme_metadata("mobilite")
  meta_casse$indicator_pages$reseaux$list$categories <-
    as.list(c(unlist(meta_casse$indicator_pages$reseaux$list$categories,
                      use.names = FALSE), "Z"))

  sortie <- file.path(tempdir(), "listes-publication")
  dir.create(sortie, showWarnings = FALSE)
  on.exit(unlink(sortie, recursive = TRUE), add = TRUE)

  # un descripteur avec une catégorie morte échoue FORT sans rien écrire
  expect_error(
    publier_theme_metadata(meta_casse, sortie, theme_attendu = "mobilite"),
    "libellé canonical"
  )
  expect_false(file.exists(file.path(sortie, "theme_mobilite.json")))

  # le canon épinglé passe la même porte et écrit son fichier
  expect_no_error(publier_theme_metadata(meta, sortie, theme_attendu = "mobilite"))
  expect_true(file.exists(file.path(sortie, "theme_mobilite.json")))
})

# La grammaire Repères des relations (issue #441) : la facette scalaire est
# STRUCTURELLE — comparison déclarée, elle nomme SA clé publiée et son libellé
# public (le miroir des distributions #440) — et les deux rôles du nuage
# référencent des clés publiées en portant leurs libellés et unités propres
# (ADR-0023 : jamais une clé brute au rendu). Le miroir exact vit dans
# validerThemeMetadata (app/src/payload/validate.ts).

roles_relation_minimaux <- function() {
  list(
    x = list(indicator = "densite", detail = NULL, label = "Axe X", unit = "hab/km²"),
    y = list(indicator = "densite", detail = NULL, label = "Axe Y", unit = "hab/km²")
  )
}

page_relation <- function(roles = roles_relation_minimaux(), comparison = list(indicator = "densite", label = "Densité comparée", unit = "%")) {
  c(page_indicateur_base("densite", "serie_historique"),
    list(family = "relationship",
         relationship = list(roles = roles),
         comparison = comparison))
}

test_that("valider_theme_metadata : une relation bien formée passe les deux portes (#441)", {
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$indicator_pages <- list(densite = page_relation())
  validee <- valider_theme_metadata(meta)
  expect_identical(validee$indicator_pages$densite$family, "relationship")
  expect_identical(validee$indicator_pages$densite$relationship$roles$x$label, "Axe X")
  expect_null(validee$indicator_pages$densite$relationship$roles$x$detail)
})

test_that("valider_theme_metadata : une relation sans facette scalaire complète échoue fort (#441)", {
  # pas de facette scalaire du tout
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$indicator_pages <- list(densite = page_relation(comparison = NULL))
  expect_error(valider_theme_metadata(meta), "comparison.indicator")

  # la facette scalaire ne nomme pas sa clé publiée
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$indicator_pages <- list(densite = page_relation(comparison = list(label = "Densité comparée", unit = "%")))
  expect_error(valider_theme_metadata(meta), "comparison.indicator")

  # la facette scalaire n'a pas de libellé public — elle serait invisible du visiteur
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$indicator_pages <- list(densite = page_relation(comparison = list(indicator = "densite", unit = "%")))
  expect_error(valider_theme_metadata(meta), "visible du visiteur")
})

test_that("valider_theme_metadata : un rôle du nuage muet, fantôme ou à détail inconnu échoue fort (#441)", {
  # un rôle sans son libellé public — jamais une clé brute au rendu (ADR-0023)
  roles <- roles_relation_minimaux()
  roles$y$label <- NULL
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$indicator_pages <- list(densite = page_relation(roles = roles))
  expect_error(valider_theme_metadata(meta), "libellé et son unité")

  # un rôle qui référence une clé inconnue du thème
  roles <- roles_relation_minimaux()
  roles$x$indicator <- "fantome"
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$indicator_pages <- list(densite = page_relation(roles = roles))
  expect_error(valider_theme_metadata(meta), "indicateur publié")

  # un rôle sans unité — l'axe du nuage est lisible avec la sienne
  roles <- roles_relation_minimaux()
  roles$x$unit <- NULL
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$indicator_pages <- list(densite = page_relation(roles = roles))
  expect_error(valider_theme_metadata(meta), "indicateur publié")

  # les deux rôles sont requis
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$indicator_pages <- list(densite = page_relation(roles = list(x = roles_relation_minimaux()$x)))
  expect_error(valider_theme_metadata(meta), "deux rôles")

  # un détail déclaré par un rôle doit être connu de SA clé
  roles <- roles_relation_minimaux()
  roles$y$detail <- "fantome"
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$indicator_pages <- list(densite = page_relation(roles = roles))
  expect_error(valider_theme_metadata(meta), "détail inconnu")
})

# L'énumération des relations publiées (issue #441) — le devoir de recensement
# comme pour les trajectoires (#438), les listes (#439) et les distributions
# (#440) : AUCUNE page de famille « relationship » n'est encore publiée à
# travers les cinq thèmes. La grammaire, le contrat des deux miroirs et le
# rendu existent et sont testés sur des fixtures ; le premier descripteur
# épinglé viendra avec ses faits. Ce verrou force la mise à jour CONSCIENTE
# du compte quand elle arrivera — jamais une famille orpheline en silence.
test_that("l'énumération des relations publiées est connue — aucune page relation à travers les six thèmes (#441)", {
  pages_relations <- 0L
  pour_theme <- character(0)
  for (theme in THEMES_METADATA) {
    meta <- lire_theme_metadata(theme)
    cles <- names(meta$indicator_pages)
    if (is.null(cles)) next
    relations_theme <- cles[vapply(meta$indicator_pages, function(p) identical(p$family, "relationship"), logical(1L))]
    pages_relations <- pages_relations + length(relations_theme)
    if (length(relations_theme)) pour_theme <- c(pour_theme, paste(theme, relations_theme, sep = ":"))
  }
  expect_identical(pages_relations, 0L)
  expect_length(pour_theme, 0L)
})
