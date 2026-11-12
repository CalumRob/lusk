# test-scalar-scope -------------------------------------------------------------
# #989 : la matérialisation scalaire CIBLÉE par indicateur. Les preuves :
#   - le périmètre enregistré est fermé (thème, indicateurs, sources) ;
#   - l'agrégation de ravitaillement extraite est EXACTEMENT celle du producteur
#     complet (parité sur fixture, jamais une seconde arithmétique) ;
#   - l'assemblage partagé produit la même forme de ligne (unité, type,
#     estampilles) que le producteur complet ;
#   - le matérialiseur fusionne les faits ciblés SANS toucher aux descripteurs /
#     faits / provenances non concernés, et refuse une base périmée ;
#   - la cible du graphe ne dépend QUE des sources légères du périmètre.

base_scalar_scope_fixture <- function() {
  tibble::tribble(
    ~CODGEO, ~EPCI, ~DEP,
    "22001", "200000001", "22",
    "22002", "200000001", "22",
    "29001", "200000002", "29",
    "29002", NA, "29"
  )
}

population_scalar_scope_fixture <- function() {
  tibble::tibble(
    commune = c("22001", "22002", "29001", "29002"),
    places = c(10, 20, 30, 40),
    population = c(1000, 2000, 3000, 4000),
    places_1000 = c(10, 20, 30, 40) / c(1000, 2000, 3000, 4000) * 1000
  )
}

scope_rows_for <- function(indicator_id, territory_id, territory_type, value,
                           unit, vintage) {
  data.frame(
    territory_id = territory_id,
    territory_type = territory_type,
    indicator_id = indicator_id,
    value = value,
    unit = unit,
    source_name = as.character(vintage$source[[1L]]),
    source_version = as.character(vintage$version[[1L]]),
    reference_date = as.character(vintage$date_reference[[1L]]),
    publication_date = as.character(vintage$date_publication[[1L]]),
    stringsAsFactors = FALSE
  )
}

test_that("le périmètre scalaire est enregistré et strictement validé (#989)", {
  contract <- scalar_scope_contract("mobilite")
  expect_setequal(contract$indicators,
                  c("stations_service", "stations_service_1000",
                    "bornes_recharge_1000"))
  expect_setequal(contract$sources,
                  c("mobilite_snapshot", "bpe_b316", "bornes-recharges",
                    "stationnement-velo"))

  parsed <- parse_scalar_scope(
    "mobilite:stations_service,stations_service_1000,bornes_recharge_1000")
  expect_identical(parsed$theme, "mobilite")
  expect_identical(parsed$indicators,
                   c("stations_service", "stations_service_1000",
                     "bornes_recharge_1000"))

  expect_error(parse_scalar_scope(""), "empty")
  expect_error(parse_scalar_scope("mobilite"), "must be")
  expect_error(parse_scalar_scope("inconnu:stations_service"),
               "No registered scalar scope")
  expect_error(parse_scalar_scope("mobilite:pas_un_indicateur"),
               "unregistered indicators")
  expect_error(parse_scalar_scope("mobilite:stations_service,stations_service"),
               "invalid")
})

test_that("le bloc ravitaillement extrait est identique au producteur complet (#989)", {
  base <- base_scalar_scope_fixture()
  velo <- population_scalar_scope_fixture()
  bornes <- tibble::tibble(
    commune = c("22001", "22002", "29001"),
    nb_bornes = c(4L, 2L, 1L)
  )
  fuel <- tibble::tibble(
    code = c("22001", "22002", "29001", "29002"),
    fuel = c(0, 2, 1, 3)
  )
  offre_tc <- tibble::tibble(
    commune = base$CODGEO,
    part_proche = c(0.1, 0.2, 0.3, 0.4),
    n_batiments = c(10L, 20L, 30L, 40L)
  )

  full <- agreger_offre_territoires(
    offre_tc, bornes, velo, base, NULL, NULL, fuel)
  extracted <- agreger_ravitaillement_territoires(
    bornes, velo, fuel, base[c("CODGEO", "EPCI", "DEP")])

  for (piece in c("bornes", "bornes_1000", "stations")) {
    expected <- full[full$key %in% extracted[[piece]]$key,
                     c("code", "key", "detail", "value")]
    expected <- expected[order(expected$code, expected$key), ]
    actual <- extracted[[piece]][, c("code", "key", "detail", "value")]
    actual <- actual[order(actual$code, actual$key), ]
    rownames(expected) <- NULL
    rownames(actual) <- NULL
    expect_equal(actual, expected)
  }

  # BPE absente : NA propagé, jamais un zéro inventé.
  stations <- extracted$stations[
    extracted$stations$key == "stations_service", ]
  expect_true(is.na(stations$value[stations$code == "200000001"]) == FALSE)
  absent <- agreger_ravitaillement_territoires(
    bornes, velo,
    tibble::tibble(code = c("22001", "22002", "29001"),
                   fuel = c(NA_real_, 2, 1)),
    base[c("CODGEO", "EPCI", "DEP")])
  expect_true(is.na(absent$stations$value[
    absent$stations$code == "200000001" &
      absent$stations$key == "stations_service"]))
})

test_that("l'assemblage partagé rend la forme complète des lignes ciblées (#989)", {
  base <- base_scalar_scope_fixture()
  poids <- tibble::tibble(
    commune = base$CODGEO,
    nb_buildings = c(1L, 2L, 3L, 4L)
  )
  territoires <- construire_territoires_mobilite(
    base %>% dplyr::transmute(
      CODGEO, LIBGEO = CODGEO, DEP, EPCI, LIBEPCI = EPCI),
    list(mobilite_communes = poids))
  long <- tibble::tibble(
    code = rep(territoires$code, each = 1L),
    key = "stations_service",
    detail = NA_character_,
    value = 1
  )
  table <- aligner_indicateur_mobilite(
    territoires, long[long$key == "stations_service", c("code", "value")],
    "stations_service", "stations")
  tables <- list(stations_service = table)
  rangs <- compute_ranks(territoires, tables, scalaires = list(),
                         directions = DIRECTIONS_MOBILITE)
  rangs_combines <- dplyr::bind_rows(lapply(rangs, function(rang)
    rang %>% dplyr::mutate(detail = NA_character_)))
  lignes <- assembler_indicateurs_mobilite(
    dplyr::bind_rows(tables), rangs_combines, territoires, vintages_mobilite())

  expect_true(all(c("territoire", "type", "theme", "key", "detail", "value",
                    "unit", "rang_epci", "rang_dep", "rang_reg",
                    "vintage_source", "vintage_version",
                    "vintage_date_reference", "vintage_date_publication") %in%
                  names(lignes)))
  expect_true(all(lignes$theme == "mobilite"))
  expect_true(all(lignes$unit == "stations"))
  expect_true(all(lignes$type %in%
                    c("commune", "epci", "departement", "region")))
  bpe <- vintages_mobilite()[vintages_mobilite()$id == "bpe_b316", ]
  expect_true(all(lignes$vintage_version == bpe$version))
})

# --- matérialiseur ------------------------------------------------------------

scope_materializer_fixture <- function() {
  metadata <- lire_theme_metadata("mobilite")
  reference_rows <- data.frame(
    territory_id = c("22001", "200000001", "22", "53"),
    territory_type = c("commune", "epci", "departement", "region"),
    stringsAsFactors = FALSE)
  vintages <- vintages_mobilite()
  eligible <- scalar_scope_reference_universe(metadata, reference_rows)
  viv <- vintages[vintages$id == "bornes-recharges", ]
  base_rows <- rbind(
    scope_rows_for("bornes_recharge", c("22001", "200000001", "22"),
                   c("commune", "epci", "departement"), c(2, 2, 2),
                   "bornes", viv))
  base_projection <- project_scalar_canonical_rows(
    base_rows, metadata, "bornes_recharge", eligible, source_vintages = vintages)
  directory <- tempfile("scalar-scope-")
  dir.create(directory, recursive = TRUE)
  write_scalar_serving_artifact(
    base_projection, file.path(directory, "scalar-serving", "mobilite"))
  list(metadata = metadata, reference_rows = reference_rows,
       vintages = vintages, eligible = eligible, directory = directory)
}

scope_fake_contract <- function() {
  vintages <- vintages_mobilite()
  bpe <- vintages[vintages$id == "bpe_b316", ]
  viv <- vintages[vintages$id == "bornes-recharges", ]
  ids <- c("stations_service", "stations_service_1000", "bornes_recharge_1000")
  produce <- function(cache, indicator_ids, metadata, vintages) {
    levels <- c("commune", "epci", "departement")
    territory_id <- c("22001", "200000001", "22")
    do.call(rbind, lapply(indicator_ids, function(id) {
      spec <- switch(id,
        stations_service = list(unit = "stations", value = c(1, 2, 3), vintage = bpe),
        stations_service_1000 = list(unit = "stations / 1 000 hab",
                                     value = c(0.5, 0.6, 0.7), vintage = bpe),
        bornes_recharge_1000 = list(unit = "bornes / 1 000 hab",
                                    value = c(1.1, 1.2, 1.3), vintage = viv))
      scope_rows_for(id, territory_id, levels, spec$value, spec$unit,
                     spec$vintage)
    }))
  }
  list(theme = "mobilite", indicators = ids,
       sources = c("mobilite_snapshot", "bpe_b316", "bornes-recharges",
                   "stationnement-velo"),
       produce = produce)
}

test_that("la matérialisation ciblée préserve les lignes non concernées (#989)", {
  fixture <- scope_materializer_fixture()
  contract <- scope_fake_contract()
  before <- read_scalar_serving_artifact(
    file.path(fixture$directory, "scalar-serving", "mobilite"))

  result <- materialize_scoped_scalar_artifact(
    theme = "mobilite", indicator_ids = contract$indicators,
    cache = tempfile("unused-cache-"), metadata = fixture$metadata,
    vintages = fixture$vintages, reference_rows = fixture$reference_rows,
    directory = fixture$directory, contract = contract)

  after <- read_scalar_serving_artifact(
    file.path(fixture$directory, "scalar-serving", "mobilite"))
  expect_false(identical(before$facts, after$facts))
  expect_setequal(after$descriptors$indicator_id,
                  c("bornes_recharge", contract$indicators))

  # Les faits et provenances NON concernés sont inchangés, ligne pour ligne.
  preserved <- function(projection) {
    clean <- function(frame) {
      rownames(frame) <- NULL
      frame
    }
    list(
      facts = clean(projection$facts[
        projection$facts$indicator_id == "bornes_recharge", ]),
      provenance = clean(projection$provenance[
        projection$provenance$indicator_id == "bornes_recharge", ]),
      descriptor = clean(projection$descriptors[
        projection$descriptors$indicator_id == "bornes_recharge", ])
    )
  }
  expect_equal(preserved(before), preserved(after))

  # Les trois faits ciblés sont présents, aux niveaux autorisés, estampillés.
  scoped <- after$facts[after$facts$indicator_id %in% contract$indicators, ]
  expect_setequal(scoped$indicator_id, contract$indicators)
  expect_true(all(scoped$territory_type %in%
                    c("commune", "epci", "departement")))
  expect_true(all(scoped$status == "measured"))
  expect_true(all(after$provenance$source_id[after$provenance$indicator_id ==
    "stations_service"] == "bpe_b316"))
  expect_true(all(after$provenance$source_id[after$provenance$indicator_id ==
    "bornes_recharge_1000"] == "bornes-recharges"))
  expect_type(result$version, "character")
  pointer <- jsonlite::fromJSON(file.path(
    fixture$directory, "scalar-serving", "mobilite", "scalar-current.json"))
  expect_identical(pointer$version, result$version)
})

test_that("la matérialisation ciblée refuse une base périmée (#989)", {
  fixture <- scope_materializer_fixture()
  contract <- scope_fake_contract()
  base <- read_scalar_serving_artifact(
    file.path(fixture$directory, "scalar-serving", "mobilite"))

  tampered <- base
  tampered$descriptors$unit[tampered$descriptors$indicator_id ==
    "bornes_recharge"] <- "unités"
  expect_error(
    assert_scalar_scope_base(tampered, "bornes_recharge", fixture$metadata,
                             fixture$vintages, fixture$eligible,
                             contract$indicators),
    "stale against current metadata")

  # Une dérive PUREMENT documentaire (jeton descriptor_version) est acceptée :
  # le descripteur publié reste celui de la base, la dérive est rapportée.
  drifted <- base
  drifted$descriptors$descriptor_version[
    drifted$descriptors$indicator_id == "bornes_recharge"] <- "jeton-ancien"
  expect_silent(assert_scalar_scope_base(
    drifted, "bornes_recharge", fixture$metadata, fixture$vintages,
    fixture$eligible, contract$indicators))

  stale_vintages <- fixture$vintages
  stale_vintages$version[stale_vintages$id == "bornes-recharges"] <- "1999-01"
  expect_error(
    assert_scalar_scope_base(base, "bornes_recharge", fixture$metadata,
                             stale_vintages, fixture$eligible,
                             contract$indicators),
    "stale for source")

  narrower <- fixture$eligible[fixture$eligible$territory_type != "region", ]
  expect_error(
    assert_scalar_scope_base(base, "bornes_recharge", fixture$metadata,
                             fixture$vintages, narrower, contract$indicators),
    "eligible universe differs")

  expect_error(
    assert_scalar_scope_base(base, "bornes_recharge", fixture$metadata,
                             fixture$vintages, fixture$eligible,
                             "pas_un_indicateur"),
    "not a retained contract")
})

test_that("la cible du graphe ne dépend que des sources légères du périmètre (#989)", {
  env <- charger_pieces_graphe("scalar_scope_targets")
  env$tar_target_raw <- targets::tar_target_raw
  scope <- scalar_scope_contract("mobilite")
  pieces <- env$scalar_scope_targets(scope, cache = "data/raw",
                                     sortie = "../public/data", mode = "full")
  names <- vapply(pieces, function(piece) piece$settings$name, character(1))
  expect_setequal(names, c(
    "sources_scalar_scope",
    "fichier_scalar_scope_mobilite_snapshot",
    "fichier_scalar_scope_bpe_b316",
    "fichier_scalar_scope_bornes_recharges",
    "fichier_scalar_scope_stationnement_velo",
    "fichier_scalar_base",
    "fichier_scalar_scope_territoires",
    "scalar_serving_scope"))

  lourd <- "brut_|publie_|raccordement_|ocsge|osm_|amenagements|korrigo"
  for (piece in pieces) {
    expect_false(any(grepl(lourd, piece$deps)), info = piece$settings$name)
  }
  scope_target <- pieces[[length(pieces)]]
  expect_true(all(c("fichier_scalar_scope_bpe_b316",
                    "fichier_scalar_scope_bornes_recharges",
                    "fichier_scalar_scope_stationnement_velo",
                    "fichier_scalar_scope_mobilite_snapshot",
                    "fichier_scalar_base",
                    "fichier_scalar_scope_territoires",
                    "fichier_epci_extrait",
                    "vintages_table_mobilite") %in% scope_target$deps))
  commande <- paste(deparse(scope_target$command$expr), collapse = "\n")
  expect_true(grepl("materialize_scoped_scalar_artifact", commande,
                    fixed = TRUE))
})
