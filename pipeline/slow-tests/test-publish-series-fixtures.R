# Slow tier (#1172): three committed public/data projections protect ENAF, OCS-GE and vintage-label identity; synthetic codec/validator/atomic-publication contracts are back in tests/testthat/.
# Subject files: pipeline/R/publish_series.R, pipeline/inst/extdata/theme-metadata, public/data
# Run explicitly with testthat::test_file(..., package="lusk") from pipeline/.

local({
  withr::local_dir(file.path(pkgload::pkg_path(), "tests", "testthat"))
  for (helper in list.files(file.path(pkgload::pkg_path(), "tests", "testthat"), pattern = "^helper.*\\.R$", full.names = TRUE)) source(helper, local = environment())

test_that("owned ENAF projection preserves producer-fixture facts and immutable provenance", {
  root <- testthat::test_path("../../../public/data")
  metadata_path <- testthat::test_path("../../inst/extdata/theme-metadata/theme_milieux.json")
  metadata <- jsonlite::read_json(metadata_path, simplifyVector=FALSE)
  projection <- owned_conso_enaf_projection(list(
    indicateurs=lire_indicateurs_producteur_fixture("milieux", root),
    vintages=nanoparquet::read_parquet(file.path(root,"vintages.parquet"))), metadata)
  expect_invisible(validate_owned_series_projection(projection))
  expect_identical(projection$descriptor$dataset_id,"conso_enaf_annuel")
  expected_facts <- lire_indicateurs_producteur_fixture("milieux", root)
  expected_facts <- expected_facts[expected_facts$key=="conso_enaf_annuel",,drop=FALSE]
  expect_equal(nrow(projection$points),nrow(expected_facts))
  expect_equal(sum(projection$points$territory_type=="region"),
    sum(expected_facts$type=="region"))
  expect_setequal(projection$descriptor$comparison_levels,c("commune", "epci", "departement"))
  expect_true(all(projection$points$dataset_id=="conso_enaf_annuel"))
  expect_equal(nrow(projection$point_provenance),nrow(projection$points))
  expect_identical(projection$provenance$source_name,
    as.character(nanoparquet::read_parquet(file.path(root,"vintages.parquet"))$source[
      match("consoenaf",nanoparquet::read_parquet(file.path(root,"vintages.parquet"))$id)]))
  bad <- projection; bad$point_provenance <- bad$point_provenance[-1,,drop=FALSE]
  expect_error(validate_owned_series_projection(bad),"requires at least one provenance")
})

test_that("OCS-GE projection uses typed per-role components and retains comparison details", {
  root <- testthat::test_path("../../../public/data")
  metadata <- jsonlite::read_json(testthat::test_path("../../inst/extdata/theme-metadata/theme_milieux.json"),simplifyVector=FALSE)
  vintages <- nanoparquet::read_parquet(file.path(root,"vintages.parquet"))
  vintage_ids <- c("ocsge_artificialisation_22_2021","ocsge_artificialisation_22_2025",
    "ocsge_artificialisation_35_2020","ocsge_artificialisation_35_2023",
    "ocsge_artificialisation_56_2022","ocsge_artificialisation_56_2024")
  ids <- list(c("ocsge_artificialisation_22_2021"),c("ocsge_artificialisation_22_2025"),
    c("ocsge_artificialisation_35_2020","ocsge_artificialisation_56_2022"),
    c("ocsge_artificialisation_35_2023","ocsge_artificialisation_56_2024"))
  roles <- c("M2","M3","M2","M3")
  details <- c("2021","2025","M2","M3")
  territories <- c("22001","22001","200000003","200000003")
  types <- c("commune","commune","epci","epci")
  periods <- c("2021-2025","2021-2025","2020-2023 (35) ? 2022-2024 (56)",
    "2020-2023 (35) ? 2022-2024 (56)")
  components <- lapply(seq_along(ids),function(i) list(M2=if(roles[[i]]=="M2") ids[[i]] else character(),
    M3=if(roles[[i]]=="M3") ids[[i]] else character()))
  fields <- do.call(rbind,lapply(seq_along(ids),function(i) {
    source <- vintages[match(ids[[i]][[1L]],vintages$id),]
    data.frame(territoire=territories[[i]],type=types[[i]],theme="milieux",key="artif_par_habitant",
      detail=details[[i]],state_role=roles[[i]],value=c(.18,.42,.31,.29)[[i]],unit="m?/hab",
      source_reference=if(length(ids[[i]])==1L) ids[[i]] else periods[[i]],
      source_components=jsonlite::toJSON(components[[i]],auto_unbox=FALSE),
      vintage_source=source$source,vintage_version=source$version,
      vintage_date_reference=source$date_reference,vintage_date_publication=source$date_publication,
      stringsAsFactors=FALSE)
  }))
  histories <- data.frame(territoire=c("22001","200000003"),type=c("commune","epci"),theme="milieux",
    periode_artif=c("2021-2025","2020-2023 (35) ? 2022-2024 (56)"),stringsAsFactors=FALSE)
  projection <- project_artif_m2m3_projection(fields,histories,vintages,metadata)
  expect_invisible(validate_owned_series_projection(projection))
  expect_identical(projection$descriptor$dataset_id,metadata$indicator_pages$artif_par_habitant$series_dataset_id)
  expect_identical(projection$descriptor$comparison_point,"2025")
  expect_identical(projection$descriptor$direction,"low")
  expect_true(all(c("2021","2025","M2","M3") %in% projection$descriptor$axis_values))
  expect_equal(projection$points$value,c(.18,.42,.31,.29),tolerance=0)
  expect_equal(projection$points$state_role,roles)
  source_links <- split(projection$provenance$source_id[match(projection$point_provenance$provenance_revision_id,
      projection$provenance$provenance_revision_id)],
    paste(projection$point_provenance$territory_id,projection$point_provenance$axis_value))
  expect_setequal(source_links[["200000003 M2"]],c("ocsge_artificialisation_35_2020","ocsge_artificialisation_56_2022"))
  expect_setequal(source_links[["200000003 M3"]],c("ocsge_artificialisation_35_2023","ocsge_artificialisation_56_2024"))
  expect_equal(projection$points$observation_period[3],periods[[3]])
  comparison_reference <- data.frame(territory_id=c("22001","22002","200000003","region"),
    territory_type=c("commune","commune","epci","region"),epci_id=c("200000003","200000003",NA,NA),
    density_class_code=c("d1","d1",NA,NA),stringsAsFactors=FALSE)
  # Add a second commune through the canonical source-fact input, then rerun the
  # production projector so immutable provenance and role typing are generated normally.
  second_commune <- fields[fields$territoire=="22001",,drop=FALSE]
  second_commune$territoire <- "22002"
  second_commune$value <- c(.18,.42)
  fields_with_peer <- rbind(fields,second_commune)
  histories_with_peer <- rbind(histories,data.frame(territoire="22002",type="commune",theme="milieux",
    periode_artif="2021-2025",stringsAsFactors=FALSE))
  production_projection <- project_artif_m2m3_projection(fields_with_peer,histories_with_peer,vintages,metadata)
  comparison <- project_ordered_series_comparisons(production_projection,comparison_reference,
    "series-publication-fixture-v1","territory-reference-fixture-v1")
  expect_identical(comparison$axis_values,c("M2","M3"))
  expect_identical(unique(comparison$groups$axis_value),c("M2","M3"))
  expect_setequal(unique(comparison$groups$comparison_context),
    c("density_class","epci","bretagne","same_level"))
  expect_equal(comparison$groups$group_value[comparison$groups$comparison_context=="density_class"],c(.18,.42))
  expect_equal(comparison$territories$rank[comparison$territories$comparison_context=="density_class"],rep(1L,4))
  expect_equal(comparison$territories$tie_count[comparison$territories$comparison_context=="density_class"],rep(2L,4))
  density_members <- c("22001","22002")
  density_points <- production_projection$points[
    production_projection$points$territory_id %in% density_members &
      production_projection$points$territory_type=="commune",,drop=FALSE]
  parity <- project_series_comparison_group(data.frame(
    territory_id=density_points$territory_id,axis_value=density_points$state_role,
    value=density_points$value,status=density_points$status),comparison$axis_values,
    density_members,direction=production_projection$descriptor$direction,statistic="median")
  published_group <- comparison$groups[comparison$groups$comparison_context=="density_class" &
    comparison$groups$group_id=="d1",,drop=FALSE]
  expect_equal(published_group$group_value,parity$groups$value)
  published_territories <- comparison$territories[
    comparison$territories$comparison_context=="density_class" &
      comparison$territories$group_id=="d1",,drop=FALSE]
  published_territories <- published_territories[order(published_territories$axis_value,
    published_territories$territory_id),,drop=FALSE]
  parity_territories <- parity$territories[order(parity$territories$axis_value,
    parity$territories$territory_id),,drop=FALSE]
  expect_equal(published_territories$rank,parity_territories$rank)
  expect_equal(published_territories$tie_count,parity_territories$tie_count)
  expect_equal(published_territories$rank_size,parity_territories$rank_size)
  expect_identical(comparison$input_content_version,"series-publication-fixture-v1")
  expect_identical(comparison$reference_content_version,"territory-reference-fixture-v1")
  expect_identical(comparison$provenance,production_projection$provenance)
  expect_identical(comparison$point_provenance,production_projection$point_provenance)
  expect_identical(comparison$statistic,"median")
  bad_route <- production_projection
  bad_route$descriptor$comparison_statistic <- "mode"
  expect_error(project_ordered_series_comparisons(bad_route,comparison_reference,"s1","r1"),
    "supported comparison statistic")
  expect_error(project_ordered_series_comparisons(production_projection,comparison_reference,"","r1"),
    "publication identities")
  old_artifact <- lire_indicateurs_producteur_fixture("milieux", root)
  old_artifact <- old_artifact[old_artifact$key=="artif_par_habitant",]
  old_artifact$state_role <- NULL
  old_artifact$source_components <- NULL
  expect_error(project_artif_m2m3_projection(old_artifact,histories,vintages,metadata),
    "typed roles or source components")
})

test_that("canonical vintage source label is checked against vintage Parquet identity", {
  root <- testthat::test_path("../../../public/data")
  indicators <- lire_indicateurs_producteur_fixture("milieux", root)
  vintages <- nanoparquet::read_parquet(file.path(root, "vintages.parquet"))
  metadata <- jsonlite::read_json(testthat::test_path("../../inst/extdata/theme-metadata/theme_milieux.json"), simplifyVector=FALSE)
  # Keep version and both dates unchanged: only corrupt the human source label.
  source_idx <- which(vintages$id == "consoenaf")
  expect_length(source_idx, 1L)
  vintages$source[[source_idx]] <- "wrong label with same vintage/date"
  expect_error(project_conso_enaf_series_from_artifacts(indicators, vintages, metadata),
    "source label differs")
})

})
