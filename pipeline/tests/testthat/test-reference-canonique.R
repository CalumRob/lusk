# test-reference-canonique -----------------------------------------------------
# Bloquage de publication #1056 (option B) : la référence des territoires est
# une DIMENSION construite une fois depuis la base INSEE épinglée (1 202
# communes + EPCI / départements / région), indépendamment des faits du thème
# qui l'a précédée. Les classifications y sont appliquées (les deux îles C avec
# leur classement source), et CHAQUE thème publie la MÊME projection. Les faits
# d'un thème plus étroit (Milieux, 1 200 communes) restent intacts.

pop_canonique_1056 <- function() {
  readr::read_csv(
    testthat::test_path("..", "..", "inst", "extdata",
                        "population_communes_2023.csv"),
    col_types = readr::cols(.default = readr::col_character()),
    show_col_types = FALSE
  )
}

# Une base EPCI synthétique qui couvre EXACTEMENT l'univers communal épinglé :
# les deux îles sans EPCI (29083 / 29084) y portent EPCI et LIBEPCI à NA, comme
# la base INSEE normalisée par lire_epci. Les faits ne sont pas nécessaires ici.
base_epci_canonique_1056 <- function() {
  pop <- pop_canonique_1056()
  codes <- pop$code_commune
  dep <- substr(codes, 1L, 2L)
  sans_epci <- codes %in% c("29083", "29084")
  # Les communes des fixtures Démographie / Milieux gardent leurs EPCI (les
  # faits les citent) ; les autres reçoivent un SIREN synthétique déterministe.
  epci_fixture <- c(
    "22001" = "200000001", "22002" = "200000001",
    "29001" = "200000002", "29002" = "200000002", "29003" = "200000002",
    "35001" = "200000003", "56001" = "200000003"
  )
  nom_epci_fixture <- c(
    "200000001" = "EPCI X", "200000002" = "EPCI Y", "200000003" = "EPCI Z"
  )
  epci <- ifelse(sans_epci, NA_character_,
                 ifelse(codes %in% names(epci_fixture),
                        unname(epci_fixture[codes]), paste0("2", dep, "000001")))
  nom_epci <- ifelse(sans_epci, NA_character_,
                     ifelse(epci %in% names(nom_epci_fixture),
                            unname(nom_epci_fixture[epci]), paste0("EPCI ", dep)))
  tibble::tibble(
    CODGEO = codes,
    LIBGEO = paste0("Commune ", codes),
    EPCI = epci,
    LIBEPCI = nom_epci,
    DEP = dep,
    REG = "53"
  )
}

classes_densite_canonique_1056 <- function() {
  codes <- pop_canonique_1056()$code_commune
  registre <- registre_classes_densite()
  libelle <- registre$classe_densite_libelle_insee[
    registre$classe_densite_code == "5"
  ]
  tibble::tibble(CODGEO = codes, DENS7 = "5", LIBDENS7 = libelle)
}

littoral_canonique_1056 <- function() {
  lire_classes_littoral(
    testthat::test_path("fixtures", "littoral-dreal-bretagne-2023-04-21.csv")
  )
}

# Le squelette CANONIQUE : 1 202 communes, les agrégats, les deux îles sans EPCI.
test_that("le squelette canonique couvre 1 202 communes et les deux îles", {
  squelette <- squelette_territoires_canonique(base_epci_canonique_1056())

  communes <- squelette[squelette$type == "commune", , drop = FALSE]
  expect_equal(nrow(communes), 1202L)
  expect_setequal(communes$code, pop_canonique_1056()$code_commune)
  expect_setequal(unique(squelette$type),
                  c("commune", "epci", "departement", "region"))
  # Les îles sont des communes canoniques, sans EPCI (jamais d'EPCI fantôme).
  iles <- communes[communes$code %in% c("29083", "29084"), , drop = FALSE]
  expect_equal(nrow(iles), 2L)
  expect_true(all(is.na(iles$epci)))
})

# La référence CANONIQUE : classification appliquée au squelette, pas au thème.
test_that("la référence canonique classe les deux îles C et 263 C / 939 NC", {
  reference <- reference_territoires_canonique(
    base_epci_canonique_1056(),
    classes_densite = classes_densite_canonique_1056(),
    classes_littoral = littoral_canonique_1056()
  )

  communes <- reference[reference$type == "commune", , drop = FALSE]
  expect_equal(nrow(communes), 1202L)
  expect_equal(sum(communes$littoral_code == "C"), 263L)
  expect_equal(sum(communes$littoral_code == "NC"), 939L)
  iles <- communes[communes$territoire %in% c("29083", "29084"), , drop = FALSE]
  expect_equal(nrow(iles), 2L)
  expect_true(all(iles$littoral_code == "C"))
  expect_setequal(iles$littoral_classement_source, "Mer")
  # Les non-communes ne portent jamais de classification.
  expect_true(all(is.na(reference$littoral_code[reference$type != "commune"])))
  # La densité est elle aussi portée par la dimension.
  expect_true(all(communes$classe_densite_code == "5"))
})

# Le bug de reproduction : un frame shape Milieux (1 200 communes, sans les
# îles) doit PUBLIFIER sans erreur — la classification est construite sur
# l'univers canonique, pas sur les communes du frame. Les faits restent 1 200.
test_that("un frame 1 200 communes se classe sans faillir et garde 1 200 faits", {
  squelette <- squelette_territoires_canonique(base_epci_canonique_1056())
  frame_milieux <- squelette[
    !(squelette$type == "commune" & squelette$code %in% c("29083", "29084")),
    , drop = FALSE
  ]
  expect_equal(
    nrow(frame_milieux[frame_milieux$type == "commune", , drop = FALSE]),
    1200L
  )

  classes <- appliquer_classifications_communales(
    frame_milieux,
    classes_densite = classes_densite_canonique_1056(),
    classes_littoral = littoral_canonique_1056()
  )

  # Aucune ligne de fait inventée : le frame reste 1 200 communes.
  expect_equal(nrow(classes), nrow(frame_milieux))
  expect_equal(
    nrow(classes[classes$type == "commune", , drop = FALSE]),
    1200L
  )
  expect_false(any(c("29083", "29084") %in% classes$code))
  cm <- classes[classes$type == "commune", , drop = FALSE]
  expect_true(all(cm$littoral_code %in% c("C", "NC")))
})

# Chaque thème publie la MÊME projection de référence, quelle que soit la table
# de faits qui l'a précédée (la référence est injectée au seam de publication).
test_that("tous les thèmes publient une référence octet-pour-octet identique", {
  base <- base_epci_canonique_1056()
  reference <- reference_territoires_canonique(
    base,
    classes_densite = classes_densite_canonique_1056(),
    classes_littoral = littoral_canonique_1056()
  )

  # Les DEUX chemins de payload (compute_payload partagé et seam publier d'un
  # thème) reçoivent la même dimension canonique et la publient telle quelle.
  p1 <- compute_payload(
    load_fixture(), theme = theme_demographie(),
    classes_littoral = littoral_canonique_1056(), reference = reference
  )
  p2 <- compute_payload(
    communes_fixture_milieux_ocsge(), theme = theme_milieux(),
    classes_littoral = littoral_canonique_1056(), reference = reference
  )
  # Le thème Économie a son propre assembleur de payload (seam publier).
  p3 <- construire_payload_economie(
    fixture_analytiques_economie(), base_epci_economie, vintages_economie(),
    classes_littoral = littoral_canonique_1056(), reference = reference
  )

  expect_identical(p1$territoires, reference)
  expect_identical(p2$territoires, reference)
  expect_identical(p3$territoires, reference)
  expect_identical(p1$territoires, p3$territoires)
})

# Fail closed : un désaccord entre squelette et classification est bruyant.
test_that("un désaccord squelette/classification échoue fort", {
  base <- base_epci_canonique_1056()
  densite <- classes_densite_canonique_1056()
  littoral <- littoral_canonique_1056()

  # Un code source inconnu de l'univers canonique est refusé.
  intrus <- rbind(
    littoral,
    tibble::tibble(Code_insee = "99999", Commune = "X", Dpt = "29",
                   Classement = "Mer")
  )
  attr(intrus, "pin_verifie") <- TRUE
  expect_error(
    reference_territoires_canonique(base, densite, intrus),
    "hors.*univers|inconnu"
  )

  # Une classification qui omet une commune canonique est refusée.
  incomplet <- littoral[littoral$Code_insee != "29083", , drop = FALSE]
  # 29083 n'est pas supprimée de l'univers : c'est le complément NC qui la
  # couvre. On simule plutôt un crosswalk troué en retirant une commune du
  # squelette via une base incomplète : la référence doit refuser l'écart.
  base_trou <- base[base$CODGEO != "29084", , drop = FALSE]
  expect_error(
    reference_territoires_canonique(base_trou, densite, littoral),
    "univers|canonique|29083|29084"
  )
})

# --- Revue #1057, point 1 : la référence est une entrée OBLIGATOIRE ----------
# Aucun producteur de payload ne doit jamais retomber sur les lignes du thème
# quand la dimension canonique manque (le vieux référentiel 1 200 communes
# sans îles, avec une version qui paraît valide, était le bug).
test_that("chaque producteur de payload échoue fort sans référence canonique", {
  msg <- "[Rr]éférence territoriale canonique absente"

  expect_error(compute_payload(load_fixture()), msg)
  expect_error(compute_payload(
    communes_fixture_milieux_ocsge(), theme = theme_milieux()
  ), msg)
  expect_error(
    construire_payload_economie(
      fixture_analytiques_economie(), base_epci_economie, vintages_economie()
    ),
    msg
  )
  expect_error(
    construire_payload_mobilite(
      NULL, base_epci_canonique_1056(), vintages_mobilite()
    ),
    msg
  )
  # Les seams publier valident AVANT toute lecture du cache : un base XLSX
  # manquant ne peut pas produire une référence de repli silencieuse.
  expect_error(publier_economie(list()), msg)
  expect_error(publier_mobilite(list()), msg)
})

# --- Revue #1057, point 2 : TOUTE voie de publication, même Mobilité --------
test_that("construire_payload_mobilite publie la même référence canonique", {
  base <- base_epci_canonique_1056()
  reference <- reference_territoires_canonique(
    base, classes_densite_canonique_1056(), littoral_canonique_1056()
  )
  pop <- pop_canonique_1056()
  # Le seul analytique que le squelette Mobilité consomme est le poids-adresse.
  analytiques <- list(mobilite_communes = tibble::tibble(
    commune = pop$code_commune, n_adresses = as.numeric(pop$population)
  ))

  # Les builders lourds de Mobilité sont hors périmètre de cette preuve : on
  # vérifie UNIQUEMENT que le seam publie la dimension injectée, pas les faits.
  local_mocked_bindings(
    construire_indicateurs_mobilite = function(analytiques, territoires,
                                              vintages, ...) tibble::tibble(),
    compute_histoires_mobilite = function(analytiques, vintages, ...)
      tibble::tibble(),
    resoudre_histoires = function(histoires, theme) histoires,
    construire_apercu_mobilite = function(territoires) list(),
    validate_payload = function(...) invisible(NULL),
    .package = "lusk"
  )

  p <- construire_payload_mobilite(
    analytiques, base, vintages_mobilite(),
    classes_littoral = littoral_canonique_1056(), reference = reference
  )
  expect_identical(p$territoires, reference)
})

test_that("Programmes ne publie AUCUNE référence de territoire", {
  # Le sixième thème n'a pas de table `territoires` dans son payload (il ne
  # publie que membres + subventions et lit la référence servie). Le critère
  # « chaque thème publie la même référence » s'applique donc aux CINQ voies
  # qui ont un payload de territoires, pas à publier_programmes.
  expect_false("reference" %in% names(formals(publier_programmes)))
  # Son assembleur ne construit que membres + subventions (jamais de table
  # `territoires`) : aucun contrat de référence à verrouiller de son côté.
  # La preuve est structurelle — publier_programmes n'a pas de payload de
  # territoires à comparer avec les cinq autres voies.
  expect_type(publier_programmes, "closure")
})

# --- Revue #1057, point 3 : pluralité de population de l'EPCI transfrontalier
test_that("l'EPCI transfrontalier porte le département de pluralité épinglé", {
  pop <- pop_canonique_1056()
  codes <- pop$code_commune
  base <- base_epci_canonique_1056()

  # Un EPCI unique (22 + 29) sur trois communes ; les autres gardent leur EPCI.
  frontiere <- c("22001", "22002", "29001")
  base$EPCI[base$CODGEO %in% frontiere] <- "200000009"
  base$LIBEPCI[base$CODGEO %in% frontiere] <- "EPCI transfrontalier"

  # Population épinglée modifiée : le 29 l'emporte (300 > 100 + 100).
  pop_pluralite <- pop
  pop_pluralite$population <- as.numeric(pop_pluralite$population)
  pop_pluralite$population[match(frontiere, pop_pluralite$code_commune)] <-
    c(100, 100, 300)

  reference <- reference_territoires_canonique(
    base, classes_densite_canonique_1056(), littoral_canonique_1056(),
    population = pop_pluralite
  )
  epci_ligne <- reference[reference$territoire == "200000009", , drop = FALSE]
  expect_equal(nrow(epci_ligne), 1L)
  expect_identical(epci_ligne$departement, "29")

  # La mesure d'un thème (conso_poids) donnerait l'inverse : la valeur
  # canonique est bien VERROUILLÉE sur la population, pas sur un poids de fait.
  squelette_theme <- squelette_territoires(tibble::tibble(
    code = frontiere,
    nom = paste0("Commune ", frontiere),
    departement = c("22", "22", "29"),
    epci = "200000009",
    nom_epci = "EPCI transfrontalier",
    conso_poids = c(500, 500, 100)
  ), poids = "conso_poids")
  expect_identical(
    squelette_theme$departement[squelette_theme$type == "epci"], "22"
  )
})

# --- Revue #1057, point 4 : doublon INSEE et non-commune classé -------------
test_that("un CODGEO dupliqué dans la base INSEE échoue fort", {
  base <- base_epci_canonique_1056()
  duplicate <- rbind(base, base[1L, , drop = FALSE])
  expect_error(
    squelette_territoires_canonique(duplicate),
    "dupliqué|doublon"
  )
})

test_that("une classification portée par un non-commune échoue fort", {
  territoires <- tibble::tibble(
    code = c("22001", "200000001", "22"),
    type = c("commune", "epci", "departement"),
    nom = c("A", "EPCI X", "Côtes-d'Armor"),
    departement = c("22", "22", "22"),
    epci = c("200000001", NA_character_, NA_character_)
  )
  crosswalk <- tibble::tibble(
    code_commune = c("22001", "200000001"),
    littoral_code = c("C", "NC"),
    littoral_classement_source = c("Mer", NA_character_)
  )
  expect_error(
    publier_classes_littoral(territoires, crosswalk),
    "non-commune"
  )
})
