test_that("territory reference is projected from retained canonical territory facts", {
  canonical <- data.frame(code=c("29001", "29002"), type="commune",
    nom=c("Alpha", "Beta"), departement="29", epci="200000001",
    classe_densite_code=c("D1", "D2"),
    classe_densite_libelle_public=c("Dense", "Rural"), stringsAsFactors=FALSE)
  projection <- project_territory_reference(canonical)
  expect_identical(names(projection$rows), c("territory_id", "territory_type", "name",
    "department_id", "epci_id", "density_class_code", "density_class_label",
    "littoral_code", "littoral_classement_source"))
  expect_identical(projection$rows$territory_id, c("29001", "29002"))
  expect_true(nzchar(projection$content_version))
  expect_error(project_territory_reference(canonical[c(1, 1), ]), "duplicate identities")
})

test_that("l'adapter PostgreSQL écrit les neuf colonnes de la référence", {
  source <- paste(deparse(territory_reference_postgres_adapter), collapse = "\n")
  for (colonne in c("territory_id", "territory_type", "name", "department_id",
                    "epci_id", "density_class_code", "density_class_label",
                    "littoral_code", "littoral_classement_source")) {
    expect_match(source, colonne, fixed = TRUE)
    if (colonne != "territory_id") {
      expect_match(source, paste0(colonne, "=EXCLUDED.", colonne),
                   fixed = TRUE)
    }
  }
  expect_match(source, "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", fixed = TRUE)
})

test_that("littoral projection is all-or-nothing and rejects non-commune codes", {
  complete <- data.frame(code=c("29001", "29002"), type="commune",
    nom=c("Alpha", "Beta"), departement="29", epci="200000001",
    littoral_code=c("C", "NC"),
    littoral_classement_source=c("Mer", NA_character_), stringsAsFactors=FALSE)
  projection <- project_territory_reference(complete)
  expect_identical(projection$rows$littoral_code, c("C", "NC"))
  expect_identical(projection$rows$littoral_classement_source,
                   c("Mer", NA_character_))

  partial <- complete
  partial$littoral_code[[2L]] <- NA_character_
  expect_error(project_territory_reference(partial), "incomplete")

  non_commune <- rbind(
    complete[1L, , drop=FALSE],
    data.frame(code="200000001", type="epci", nom="EPCI", departement="29",
               epci=NA_character_, littoral_code="C",
               littoral_classement_source="Mer", stringsAsFactors=FALSE)
  )
  expect_error(project_territory_reference(non_commune), "non-commune")

  inconnu <- complete
  inconnu$littoral_code[[1L]] <- "X"
  expect_error(project_territory_reference(inconnu), "unknown littoral code")
})

test_that("littoral projection is NA-safe for a valid all-NC reference with a non-commune", {
  toutes_nc <- data.frame(
    code=c("29001", "29002", "200000001", "53"),
    type=c("commune", "commune", "epci", "region"),
    nom=c("Alpha", "Beta", "EPCI", "Bretagne"),
    departement=c("29", "29", "29", NA_character_),
    epci=c("200000001", "200000001", NA_character_, NA_character_),
    littoral_code=c("NC", "NC", NA_character_, NA_character_),
    littoral_classement_source=c(NA_character_, NA_character_,
                                 NA_character_, NA_character_),
    stringsAsFactors=FALSE
  )

  projection <- project_territory_reference(toutes_nc)

  expect_identical(projection$rows$littoral_code,
                   c("NC", "NC", NA_character_, NA_character_))
})

test_that("littoral projection rejects an orphan source classement on an unclassified non-commune", {
  de_base <- data.frame(
    code=c("29001", "29002", "200000001", "53"),
    type=c("commune", "commune", "epci", "region"),
    nom=c("Alpha", "Beta", "EPCI", "Bretagne"),
    departement=c("29", "29", "29", NA_character_),
    epci=c("200000001", "200000001", NA_character_, NA_character_),
    littoral_code=c("NC", "NC", NA_character_, NA_character_),
    littoral_classement_source=c(NA_character_, NA_character_,
                                 NA_character_, NA_character_),
    stringsAsFactors=FALSE
  )
  # La référence all-NC valide (non-communes sans code NI source) reste admise.
  expect_s3_class(project_territory_reference(de_base)$rows, "data.frame")

  # Une source ORPHELINE sur un non-commune non classé : le littoral_code reste
  # NA mais la source est renseignée. Le CHECK SQL le refuserait plus tard ; le
  # projector doit le rejeter immédiatement (aucun code ⇒ aucune source).
  orphelin <- de_base
  orphelin$littoral_classement_source[[3L]] <- "Mer"   # EPCI, littoral_code = NA
  expect_error(project_territory_reference(orphelin),
               "orphan littoral source|without a littoral code")
})

test_that("littoral projection separates absent, partial and present-but-empty columns", {
  base <- data.frame(code=c("29001", "22"), type=c("commune", "departement"),
    nom=c("Alpha", "Finistère"), departement=c("29", "29"),
    epci=c(NA_character_, NA_character_), stringsAsFactors=FALSE)

  # Transition explicite : les DEUX colonnes sont absentes.
  absent <- project_territory_reference(base)
  expect_true(all(is.na(absent$rows$littoral_code)))
  expect_true(all(is.na(absent$rows$littoral_classement_source)))

  # Une seule colonne : ambigu, refusé.
  partiel <- base
  partiel$littoral_code <- c("C", NA_character_)
  expect_error(project_territory_reference(partiel),
               "declared together|deux colonnes")

  # Les deux colonnes présentes mais entièrement vides : référence enrichie
  # silencieusement vide, refusée (le contrat app la refuse aussi).
  vide <- base
  vide$littoral_code <- NA_character_
  vide$littoral_classement_source <- NA_character_
  expect_error(project_territory_reference(vide),
               "present but empty|vide")
})

test_that("reference publishing uses the owner protocol without legacy serving dependencies", {
  calls <- character()
  current <- data.frame(content_version="old", reference_content_version="source-old")
  fail_write <- FALSE
  db <- list(
    transaction=function(expr) {
      old_current <- current; old_calls <- calls
      tryCatch(force(expr), error=function(err) {
        current <<- old_current; calls <<- old_calls; stop(err)
      })
    },
    lock=function(owner) calls <<- c(calls, paste("lock", owner)),
    marker=function(owner) { calls <<- c(calls, paste("marker", owner)); current },
    write=function(projection, version, dependency) {
      calls <<- c(calls, paste("write", version, nrow(projection$rows), dependency$content_version))
      if (fail_write) stop("injected retained reference write failure")
      current <<- data.frame(content_version=version, reference_content_version=dependency$content_version)
    },
    rebind=function(owner, version) {
      calls <<- c(calls, paste("rebind", owner, version))
      current$reference_content_version <<- version
    }
  )
  territories <- data.frame(code="29001", type="commune", nom="Alpha",
    departement="29", epci="200000001", stringsAsFactors=FALSE)
  projection <- project_territory_reference(territories)
  result <- publish_territory_reference_projection(projection, db)
  expect_true(result$changed)
  expect_true(any(grepl("^write ", calls)))
  expect_false(any(grepl("service_registry|essential_service_access|building_ramp|building_grid|bpe_profile", calls)))
  writes <- sum(grepl("^write ", calls))
  noop <- publish_territory_reference_projection(projection, db)
  expect_false(noop$changed)
  expect_equal(sum(grepl("^write ", calls)), writes)
  current$content_version <- "database-behind"
  retried <- publish_territory_reference_projection(projection, db)
  expect_true(retried$changed)
  current$reference_content_version <- "dependency-behind"
  rebound <- publish_territory_reference_projection(projection, db)
  expect_false(rebound$changed)
  expect_true(rebound$rebound)
  expect_identical(current$reference_content_version, projection$content_version)
  committed <- current; committed_calls <- calls
  fail_write <- TRUE; current$content_version <- "database-behind-again"
  before_failure <- current; before_failure_calls <- calls
  expect_error(publish_territory_reference_projection(projection, db),
    "injected retained reference write failure")
  expect_identical(current, before_failure)
  expect_identical(calls, before_failure_calls)
  fail_write <- FALSE
  expect_equal(committed$content_version, projection$content_version)
  expect_true(length(committed_calls) > 0L)
})

test_that("retained scalar snapshot is assembled without legacy service-share projection", {
  root <- file.path(pkgload::pkg_path(), "..", "public", "data")
  artifacts <- tempfile("retained-scalar-artifacts-")
  dir.create(artifacts)
  on.exit(unlink(artifacts, recursive=TRUE), add=TRUE)
  vintages <- nanoparquet::read_parquet(file.path(root, "vintages.parquet"))
  territories <- territoires_producteur_fixture(
    c("economie", "demographie", "mobilite", "habitat"), root)
  for (theme in c("economie", "demographie", "mobilite", "habitat")) {
    payload <- payload_producteur_fixture(theme, root)
    payload$territoires <- territories
    metadata <- lire_theme_metadata(theme)
    # The committed Mobility facts carry the historical raccordement source;
    # keep that bundle assertion in test-publish-scalar.R rather than pairing
    # it with the current canonical owner declaration here.
    if (identical(theme, "mobilite")) {
      metadata$scalar_contracts$raccordement_tc <- NULL
      # #953 : déclarées au canon, matérialisées au prochain run seulement
      metadata$scalar_contracts$stations_service <- NULL
      metadata$scalar_contracts$stations_service_1000 <- NULL
      metadata$scalar_contracts$bornes_recharge_1000 <- NULL
    }
    materialize_theme_scalar_artifact(payload, metadata, vintages, theme, artifacts)
  }
  reference <- project_territory_reference(territories)
  snapshot <- project_retained_scalar_snapshot(root, reference, artifacts)
  ids <- as.character(snapshot$scalar$descriptors$indicator_id)
  expect_true(length(ids) > 0L)
  expect_false(any(grepl("^(share_|iso_)", ids)))
  expect_identical(snapshot$comparison$scalar_content_version,
    scalar_content_version(snapshot$scalar))
  expect_identical(snapshot$comparison$reference_content_version,
    reference$content_version)
})
