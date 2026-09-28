test_that("le builder refuse un Parquet canonique manquant", {
  d <- tempfile(); dir.create(d)
  expect_error(preparer_tables_service(d), "Parquet canonique absent")
})

test_that("versions sémantiques isolent les tables et ignorent l'ordre des lignes", {
  tables <- list(territory_reference=data.frame(id=c("b","a")),
    service_registry=data.frame(service=c("x","y")),
    essential_service_access=data.frame(share=c(.2,.3)),
    building_ramp=data.frame(value=c(1,2)), building_grid=data.frame(cell=c(1,2)))
  scope <- list(kind="communes-bretagne",label="communes bretonnes")
  building <- list(statistic="mean",direction="high")
  baseline <- versions_tables_service(tables,scope,building)
  reordered <- tables; reordered$building_ramp <- reordered$building_ramp[2:1,,drop=FALSE]
  expect_identical(versions_tables_service(reordered,scope,building),baseline)
  rownames(reordered$building_ramp) <- c("un", "deux")
  expect_identical(versions_tables_service(reordered,scope,building),baseline)
  changed <- tables; changed$building_ramp$value[[1]] <- 9
  ramp_changed <- versions_tables_service(changed,scope,building)
  expect_false(identical(ramp_changed["building_ramp"],baseline["building_ramp"]))
  expect_identical(ramp_changed[setdiff(names(baseline),"building_ramp")],baseline[setdiff(names(baseline),"building_ramp")])
  scope_changed <- versions_tables_service(tables,modifyList(scope,list(label="autre portée")),building)
  expect_false(identical(scope_changed["essential_service_access"],baseline["essential_service_access"]))
  expect_identical(scope_changed[setdiff(names(baseline),"essential_service_access")],baseline[setdiff(names(baseline),"essential_service_access")])
})

test_that("les projections canoniques ont leurs formes SQL et leurs indices locaux", {
  # test_path is anchored to this test file, unlike getwd() under test_local().
  d <- normalizePath(test_path("..", "..", "..", "public", "data"), mustWork=FALSE)
  files <- file.path(d, paste0(c("territoires", "indicateurs_mobilite", "vintages", "rampe_acces_batiments", "distribution_acces_batiments"), ".parquet"))
  skip_if_not(all(file.exists(files)), "Parquets canoniques non présents dans ce checkout")
  result <- preparer_tables_service(d)
  expected <- list(
    territory_reference=c("territory_id","territory_type","name","department_id","epci_id","density_class_code","density_class_label"),
    service_registry="service",
    essential_service_access=c("territory_id","service","mode","share","indicator_label","effective_direction","source_id","source_name","source_version","reference_date","source_publication_date"),
    building_ramp=c("territory_id","territory_type","availability","mode","quantile_index","quantile","accessible_types","total_buildings","source_id","source_version","effective_direction"),
    building_grid=c("territory_id","territory_type","availability","mode","cell_index","breadth_bucket","depth_bucket","building_count","total_buildings","source_id","source_version")
  )
  expect_named(result$tables, names(expected))
  for (n in names(expected)) expect_identical(names(result$tables[[n]]), expected[[n]])
  expect_named(result$versions, names(expected))
  expect_type(result$versions, "character")
  expect_length(result$versions, 5L)
  expect_equal(unname(vapply(result$tables, nrow, integer(1)))[1:3], c(1268L,5L,19020L))
  ramp <- result$tables$building_ramp
  complete_ramp <- ramp[ramp$availability=="complete",]
  expect_true(all(vapply(split(complete_ramp$quantile_index, paste(complete_ramp$territory_type,complete_ramp$territory_id,complete_ramp$mode)), function(z) identical(sort(z),0:10), logical(1))))
  expect_true(all(ramp$quantile_index[ramp$availability=="absent"] == -1L))
  grid <- result$tables$building_grid
  complete_grid <- grid[grid$availability=="complete",]
  expect_true(all(vapply(split(complete_grid$cell_index, paste(complete_grid$territory_type,complete_grid$territory_id)), function(z) identical(sort(z),0:29), logical(1))))
  expect_true(all(grid$cell_index[grid$availability=="absent"] == -1L))
  expect_true(all(result$tables$building_ramp$effective_direction == "high"))
  expect_true(all(result$tables$essential_service_access$effective_direction %in% c("high","low")))
  expect_true(all(result$tables$essential_service_access$source_id == "mobilite_snapshot"))
  for (table in c("building_ramp", "building_grid")) {
    facts <- result$tables[[table]]
    expect_true(all(c("commune", "epci", "departement", "region") %in% facts$territory_type))
    grain <- if (table == "building_ramp") c("territory_type", "territory_id", "mode", "quantile_index") else c("territory_type", "territory_id", "cell_index")
    expect_identical(anyDuplicated(facts[grain]), 0L)
    expect_true(all(facts$territory_id %in% result$tables$territory_reference$territory_id))
  }
  grid <- result$tables$building_grid
  complete_grid <- grid[grid$availability == "complete",]
  sums <- tapply(complete_grid$building_count, paste(complete_grid$territory_type, complete_grid$territory_id), sum)
  denominators <- tapply(complete_grid$total_buildings, paste(complete_grid$territory_type, complete_grid$territory_id), unique)
  expect_identical(unname(sums), unname(denominators[names(sums)]))
})
