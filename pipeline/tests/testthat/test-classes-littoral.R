# test-classes-littoral --------------------------------------------------------
# La classification littorale communale (#1041) : la liste positive DREAL
# Bretagne est la source ; le complément de l'univers communal canonique est
# Non littoral. Les preuves ci-dessous verrouillent le lecteur (encodage
# réel, CSV quoté, domaine source), le crosswalk exhaustif, la publication
# dans la référence territoriale partagée et la provenance. Les comptes
# 263/939 sont une preuve d'instantané épinglé, jamais une politique d'app.

fixture_littorale <- function() {
  testthat::test_path("fixtures", "littoral-dreal-bretagne-2023-04-21.csv")
}

univers_canonique_1202 <- function() {
  readr::read_csv(
    testthat::test_path("..", "..", "inst", "extdata",
                        "population_communes_2023.csv"),
    col_types = readr::cols(code_commune = readr::col_character(),
                            population = readr::col_double()),
    show_col_types = FALSE
  )$code_commune
}

source_littorale <- function(codes, classement = "Mer") {
  source <- tibble::tibble(
    Code_insee = as.character(codes),
    Commune = paste("Commune", codes),
    Dpt = substr(as.character(codes), 1L, 2L),
    Classement = rep(classement, length(codes))
  )
  # Fixture synthétique BORNÉE : elle simule une source déjà admise, sans
  # toucher au défaut de production (le lecteur réel vérifie son SHA-256).
  attr(source, "pin_verifie") <- TRUE
  source
}

test_that("le lecteur littoral lit le CSV réel UTF-8 et son domaine source", {
  source <- lire_classes_littoral(fixture_littorale())

  expect_named(source, c("Code_insee", "Commune", "Dpt", "Classement"))
  expect_equal(nrow(source), 263L)
  expect_equal(anyDuplicated(source$Code_insee), 0L)
  expect_true(all(grepl("^[0-9]{5}$", source$Code_insee)))
  expect_setequal(unique(source$Classement), c("Mer", "Estuaire"))
  expect_equal(sum(source$Classement == "Mer"), 250L)
  expect_equal(sum(source$Classement == "Estuaire"), 13L)
  # l'accent du source est conservé (lecture UTF-8, pas cp1252)
  expect_identical(source$Commune[source$Code_insee == "29084"], "Île-Molène")
  expect_identical(source$Commune[source$Code_insee == "29083"], "Île-de-Sein")
})

test_that("le lecteur littoral accepte un CSV quoté (virgule dans le nom)", {
  chemin <- tempfile(fileext = ".csv")
  on.exit(unlink(chemin), add = TRUE)
  writeLines(c(
    'FID,Code_insee,Commune,Dpt,Classement',
    'l_communes_littorales.1,22001,"Commune, avec virgule",22,Mer'
  ), chemin, useBytes = TRUE)

  source <- lire_classes_littoral(chemin, sha256 = NULL)

  expect_equal(nrow(source), 1L)
  expect_identical(source$Commune, "Commune, avec virgule")
  expect_false(isTRUE(attr(source, "pin_verifie")))
})

test_that("le lecteur littoral exige l'empreinte épinglée sur le fichier réel", {
  altere <- tempfile(fileext = ".csv")
  on.exit(unlink(altere), add = TRUE)
  octets <- readBin(fixture_littorale(), "raw",
                    n = file.info(fixture_littorale())$size)
  # Un octet modifié (même longueur, CSV toujours lisible) doit échouer.
  octets[[200L]] <- as.raw(0x58)
  writeBin(octets, altere)

  expect_error(lire_classes_littoral(altere), "empreinte|SHA-256")
  expect_error(lire_classes_littoral(altere, sha256 = ""), "empreinte|SHA-256")
  # La source réelle reste admise par défaut, avec sa preuve d'identité.
  reelle <- lire_classes_littoral(fixture_littorale())
  expect_true(isTRUE(attr(reelle, "pin_verifie")))
  # Le seam borné des tests synthétiques est EXPLICITE : désactiver le pin ne
  # peut jamais être le défaut de production.
  synthetique_chemin <- tempfile(fileext = ".csv")
  on.exit(unlink(synthetique_chemin), add = TRUE)
  writeLines(c(
    "Code_insee,Commune,Dpt,Classement",
    "22001,A,22,Mer"
  ), synthetique_chemin, useBytes = TRUE)
  synthetique <- lire_classes_littoral(synthetique_chemin, sha256 = NULL)
  expect_false(isTRUE(attr(synthetique, "pin_verifie")))
})

test_that("le crosswalk refuse une source dont l'identité n'a pas été admise", {
  chemin <- tempfile(fileext = ".csv")
  on.exit(unlink(chemin), add = TRUE)
  writeLines(c(
    "Code_insee,Commune,Dpt,Classement",
    "22001,A,22,Mer"
  ), chemin, useBytes = TRUE)
  source <- lire_classes_littoral(chemin, sha256 = NULL)

  expect_error(
    construire_crosswalk_littoral(source, c("22001")),
    "non vérifiée|admise"
  )
  expect_silent(
    construire_crosswalk_littoral(source, c("22001"), exiger_identite = FALSE)
  )
})

test_that("le lecteur littoral refuse un doublon, un classement inconnu et un fichier vide", {
  doublon <- tempfile(fileext = ".csv")
  inconnu <- tempfile(fileext = ".csv")
  vide <- tempfile(fileext = ".csv")
  on.exit(unlink(c(doublon, inconnu, vide)), add = TRUE)
  writeLines(c(
    "Code_insee,Commune,Dpt,Classement",
    "22001,A,22,Mer",
    "22001,A bis,22,Estuaire"
  ), doublon, useBytes = TRUE)
  writeLines(c(
    "Code_insee,Commune,Dpt,Classement",
    "22001,A,22,Lac"
  ), inconnu, useBytes = TRUE)
  writeLines("Code_insee,Commune,Dpt,Classement", vide, useBytes = TRUE)

  expect_error(lire_classes_littoral(doublon, sha256 = NULL), "doublon|ambigu")
  expect_error(lire_classes_littoral(inconnu, sha256 = NULL),
               "classement.*inconnu|inconnu.*classement")
  expect_error(lire_classes_littoral(vide, sha256 = NULL),
               "vide|aucune commune")
})

test_that("le crosswalk exhaustif projette la liste positive sur l'univers canonique 1202", {
  source <- lire_classes_littoral(fixture_littorale())
  communes <- univers_canonique_1202()

  expect_length(communes, 1202L)
  expect_false("29209" %in% source$Code_insee) # Plouvien exclue par la DREAL
  expect_true(all(c("29083", "29084") %in% source$Code_insee))
  expect_length(setdiff(source$Code_insee, communes), 0L)

  crosswalk <- construire_crosswalk_littoral(source, communes)

  expect_named(crosswalk, c("code_commune", "littoral_code",
                            "littoral_classement_source"))
  expect_equal(nrow(crosswalk), 1202L)
  expect_setequal(crosswalk$code_commune, communes)
  expect_equal(sum(crosswalk$littoral_code == "C"), 263L)
  expect_equal(sum(crosswalk$littoral_code == "NC"), 939L)
  lire <- function(code) crosswalk[crosswalk$code_commune == code, , drop = FALSE]
  expect_identical(lire("29083")$littoral_code, "C")
  expect_identical(lire("29084")$littoral_code, "C")
  expect_identical(lire("29083")$littoral_classement_source, "Mer")
  expect_identical(lire("29209")$littoral_code, "NC")
  expect_true(is.na(lire("29209")$littoral_classement_source))
  expect_true(all(crosswalk$littoral_code %in% c("C", "NC")))
})

test_that("le crosswalk refuse une source hors univers, vide ou dupliquée", {
  communes <- c("22001", "22002", "29001")

  expect_error(
    construire_crosswalk_littoral(source_littorale("33001"), communes,
                                  exiger_identite = FALSE),
    "hors.*univers|inconnu"
  )
  expect_error(
    construire_crosswalk_littoral(source_littorale(character()), communes,
                                  exiger_identite = FALSE),
    "vide|aucune"
  )
  expect_error(
    construire_crosswalk_littoral(
      source_littorale(c("22001", "22001")), communes, exiger_identite = FALSE
    ),
    "doublon|ambigu"
  )
})

test_that("la publication refuse un crosswalk incomplet, dupliqué, inconnu ou non-communal", {
  territoires <- tibble::tibble(
    territoire = c("22001", "22002", "200000001", "22", "53"),
    type = c("commune", "commune", "epci", "departement", "region"),
    nom = c("A", "B", "EPCI", "Côtes-d'Armor", "Bretagne"),
    departement = c("22", "22", "22", "22", NA_character_),
    epci = c("200000001", "200000001", NA, NA, NA)
  )
  complet <- tibble::tibble(
    code_commune = c("22001", "22002"),
    littoral_code = c("C", "NC"),
    littoral_classement_source = c("Mer", NA_character_)
  )

  publies <- publier_classes_littoral(territoires, complet)
  expect_identical(publies$littoral_code, c("C", "NC", NA, NA, NA))
  expect_identical(publies$littoral_classement_source, c("Mer", NA, NA, NA, NA))

  expect_error(
    publier_classes_littoral(territoires, complet[complet$code_commune != "22002", ]),
    "22002.*sans classification|incompl"
  )
  expect_error(
    publier_classes_littoral(territoires, rbind(complet, complet[1, ])),
    "doublon|ambigu"
  )
  expect_error(
    publier_classes_littoral(
      territoires,
      transform(complet, littoral_code = c("X", "NC"))
    ),
    "littoral_code.*inconnu|code.*littoral.*inconnu"
  )
  expect_error(
    publier_classes_littoral(
      territoires,
      rbind(complet, tibble::tibble(code_commune = "200000001",
                                    littoral_code = "NC",
                                    littoral_classement_source = NA_character_))
    ),
    "non-commune|pas une commune"
  )
  expect_error(
    publier_classes_littoral(
      territoires,
      transform(complet, littoral_code = c("NC", "C"),
                littoral_classement_source = c("Mer", "Mer"))
    ),
    "classement.*incohérent|NC.*classement"
  )
})

test_that("la référence territoriale conserve le littoral et sa provenance", {
  source <- source_littorale("22001")
  payload <- compute_payload_test(load_fixture(), classes_littoral = source)

  expect_true(all(c("littoral_code", "littoral_classement_source") %in%
                    names(payload$territoires)))
  communes <- payload$territoires$type == "commune"
  expect_true(all(payload$territoires$littoral_code[communes] %in% c("C", "NC")))
  expect_equal(
    payload$territoires$littoral_code[
      payload$territoires$territoire == "22001"],
    "C"
  )
  expect_equal(
    payload$territoires$littoral_code[
      payload$territoires$territoire == "22002"],
    "NC"
  )
  expect_true(all(is.na(
    payload$territoires$littoral_code[!communes]
  )))

  sortie <- tempfile("publish-littoral-")
  dir.create(sortie)
  on.exit(unlink(sortie, recursive = TRUE), add = TRUE)
  publish(payload, sortie)
  json <- jsonlite::fromJSON(
    file.path(sortie, "territoires.json"), simplifyDataFrame = TRUE
  )
  expect_true(all(c("littoral_code", "littoral_classement_source") %in% names(json)))
  sidecar <- jsonlite::fromJSON(
    file.path(sortie, "territoires-metadata.json"),
    simplifyVector = FALSE
  )
  expect_true("classe_littorale_communale" %in% names(sidecar$source_records))
  expect_match(sidecar$source_records$classe_littorale_communale$sha256,
               "^[0-9a-f]{64}$")
})

test_that("chaque producteur de thème conserve la classification littorale", {
  expect_littoral <- function(territoires) {
    expect_true(all(c("littoral_code", "littoral_classement_source") %in%
                      names(territoires)))
    communes <- territoires$type == "commune"
    expect_true(all(territoires$littoral_code[communes] %in% c("C", "NC")))
    expect_equal(
      territoires$littoral_code[territoires[[if ("territoire" %in% names(territoires)) "territoire" else "code"]] == "22001"],
      "C"
    )
    expect_true(all(is.na(territoires$littoral_code[!communes])))
  }
  source <- source_littorale("22001")

  expect_littoral(compute_payload_test(
    load_fixture(), classes_littoral = source
  )$territoires)
  expect_littoral(compute_payload_test(
    load_fixture_habitat(), theme = theme_habitat(), classes_littoral = source
  )$territoires)
  expect_littoral(compute_payload_test(
    communes_fixture_milieux_ocsge(), theme = theme_milieux(),
    classes_littoral = source
  )$territoires)
  expect_littoral(construire_payload_economie_test(
    fixture_analytiques_economie(), base_epci_economie, vintages_economie(),
    classes_littoral = source
  )$territoires)
})

test_that("les métadonnées littorales portent la licence, le millésime, l'empreinte et les limites", {
  meta <- metadata_classes_littorale()

  expect_identical(meta$publisher, "DREAL Bretagne")
  expect_identical(meta$licence, "Licence Ouverte 2.0 (lov2)")
  expect_match(meta$sha256, "^[0-9a-f]{64}$")
  expect_match(meta$vintage, "2023-04-21")
  expect_match(meta$definition, "loi Littoral")
  expect_match(meta$coverage, "complément.*Non littoral|Non littoral.*complément")
  expect_setequal(meta$classements, c("Mer", "Estuaire"))
  expect_match(meta$caveat, "Plouvien")
  expect_match(meta$caveat, "pas une garantie juridique|ni une garantie")
  # Aucune date de relevé de périmètre n'est connue : jamais inventée.
  expect_true(is.na(meta$vintages[[1L]]$dateReference))
  expect_true(is.na(MANIFEST_CLASSES_LITTORAL$date_reference[[1L]]))
  expect_equal(meta$vintages[[1L]]$datePublication, "2023-04-21")

  sidecar <- metadata_reference_territoriale(
    tibble::tibble(
      territoire = c("22001", "22002"),
      type = c("commune", "commune"),
      littoral_code = c("C", "NC"),
      littoral_classement_source = c("Mer", NA_character_)
    )
  )
  expect_true("classe_littorale_communale" %in% names(sidecar$source_records))
  expect_match(sidecar$territory_reference_label, "classifications")
})

test_that("la référence servie par R est la fixture consommée par l'app", {
  fixture <- file.path(
    pkgload::pkg_path(), "..", "app", "src", "__tests__", "fixtures",
    "littoral-reference-served.json"
  )
  expect_true(file.exists(fixture),
              info = "la fixture R -> app doit être commise")
  attendu <- jsonlite::fromJSON(fixture, simplifyVector = FALSE)

  territoires <- tibble::tibble(
    territoire = c("29083", "29084", "29209", "22"),
    type = c("commune", "commune", "commune", "departement"),
    nom = c("Île-de-Sein", "Île-Molène", "Plouvien", "Finistère"),
    departement = c("29", "29", "29", "29"),
    epci = c(NA_character_, NA_character_, NA_character_, NA_character_),
    classe_densite_code = c("7", "7", "5", NA_character_),
    classe_densite_libelle_insee = c(
      "Rural à habitat très dispersé", "Rural à habitat très dispersé",
      "Bourgs ruraux", NA_character_
    ),
    classe_densite_libelle_public = c(
      "communes rurales à habitat très dispersé en Bretagne",
      "communes rurales à habitat très dispersé en Bretagne",
      "bourgs ruraux bretons", NA_character_
    ),
    littoral_code = c("C", "C", "NC", NA_character_),
    littoral_classement_source = c("Mer", "Mer", NA_character_, NA_character_)
  )
  obtenu_chemin <- tempfile(fileext = ".json")
  on.exit(unlink(obtenu_chemin), add = TRUE)
  jsonlite::write_json(
    list(territoires = territoires,
         metadata = metadata_reference_territoriale(territoires)),
    obtenu_chemin,
    dataframe = "rows", na = "null", digits = 17, pretty = TRUE,
    auto_unbox = TRUE
  )
  expect_identical(
    jsonlite::fromJSON(obtenu_chemin, simplifyVector = FALSE),
    attendu
  )
})

test_that("le littoral change l'empreinte de la référence (rollout explicite)", {
  sans <- project_territory_reference(data.frame(
    code = c("22001", "22002"), type = "commune", nom = c("A", "B"),
    departement = "22", epci = "200000001", stringsAsFactors = FALSE
  ))
  avec <- project_territory_reference(data.frame(
    code = c("22001", "22002"), type = "commune", nom = c("A", "B"),
    departement = "22", epci = "200000001",
    littoral_code = c("C", "NC"),
    littoral_classement_source = c("Mer", NA_character_),
    stringsAsFactors = FALSE
  ))

  expect_false(identical(sans$content_version, avec$content_version))
  expect_false(identical(sans$rows, avec$rows))
})
