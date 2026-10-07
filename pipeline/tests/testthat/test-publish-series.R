test_that("annual series preserves declared gaps and source vintage", {
  descriptor <- list(indicator_id="conso_enaf_annuel", axis_kind="year",
    axis_values=as.character(2011:2014), completeness="may_be_missing",
    comparison_point="2014", label="Consommation", unit="ha", direction="low",
    allowed_levels="commune", source_id="consoenaf", vintage_id="2025")
  points <- data.frame(indicator_id="conso_enaf_annuel", territory_id="22001",
    territory_type="commune", axis_value=c("2011","2013","2014"),
    observation_period=c("2011","2013","2014"), value=c(2,0,NA_real_),
    status=c("measured","measured","missing"), source_id="consoenaf", vintage_id="2025")
  result <- validate_series_projection(points, descriptor)
  expect_identical(result$axis_value, c("2011","2013","2014"))
  expect_equal(result$value[result$axis_value == "2013"], 0)
  expect_identical(result$status[result$axis_value == "2013"], "measured")
  expect_true(is.na(result$value[result$axis_value == "2014"]))
  expect_identical(result$status[result$axis_value == "2014"], "missing")
  expect_false("2012" %in% result$axis_value)
  expect_error(validate_series_projection(rbind(points, points[1,]), descriptor), "duplicate")
  invalid <- points; invalid$axis_value[1] <- "2015"
  expect_error(validate_series_projection(invalid, descriptor), "Undeclared")
  bad_descriptor <- descriptor; bad_descriptor$comparison_point <- "2015"
  expect_error(validate_series_projection(points, bad_descriptor), "descriptor")
  no_direction <- descriptor; no_direction$direction <- "none"
  expect_error(validate_series_projection(points, no_direction), "descriptor")
  dense <- descriptor; dense$completeness <- "dense_complete"
  expect_error(validate_series_projection(points, dense), "Dense-complete")
  comparison <- series_comparison(data.frame(territory_id=c("a","b","c","d"),
    value=c(0,2,2,NA_real_)), "b", "low")
  expect_equal(comparison$median, 2)
  expect_equal(comparison$rank, 2L)
  expect_equal(comparison$tied, 2L)
  expect_equal(comparison$comparable_count, 3L)
})

test_that("owned prix_m2 projects annual canonical facts with their effective row lineage", {
  payload <- payload_habitat()
  metadata <- jsonlite::read_json(testthat::test_path("../../inst/extdata/theme-metadata/theme_habitat.json"), simplifyVector=FALSE)
  vintages <- vintages_habitat()
  projection <- project_prix_m2_owned_series(payload$indicateurs, vintages, metadata)
  raw <- payload$indicateurs[payload$indicateurs$key == "prix_m2" & !is.na(payload$indicateurs$detail) &
    payload$indicateurs$type %in% c("commune", "epci", "departement", "region"), , drop=FALSE]
  expect_identical(projection$descriptor$axis_values, as.character(unlist(metadata$indicator_pages$prix_m2$comparison$details)))
  expect_setequal(projection$points$territory_type, c("commune", "epci", "departement", "region"))
  expect_setequal(projection$descriptor$comparison_levels,c("commune", "epci", "departement"))
  expect_true(projection$descriptor$active_read_route)
  for (i in seq_len(nrow(raw))) {
    fact <- raw[i,]
    point <- projection$points[projection$points$territory_id == fact$territoire &
      projection$points$axis_value == as.character(fact$detail),]
    expect_equal(nrow(point), 1L)
    expect_equal(point$value, fact$value)
    expect_identical(point$status, if (is.na(fact$value)) "missing" else "measured")
    links <- projection$point_provenance[projection$point_provenance$territory_id == fact$territoire &
      projection$point_provenance$axis_value == as.character(fact$detail),]
    expect_true(nrow(links) >= 1L)
    lineage <- projection$provenance[match(links$provenance_revision_id, projection$provenance$provenance_revision_id),]
    expect_true(all(lineage$source_id == "dvf_2025_dep22"))
    expect_true(all(lineage$source_version == as.character(fact$vintage_version)))
  }
  expect_true(any(projection$points$status == "missing"))
  expect_true(all(!is.na(projection$points$observation_period)))
  expect_false(anyNA(projection$points$axis_value))
  pooled <- payload$indicateurs[payload$indicateurs$key == "prix_m2" & is.na(payload$indicateurs$detail) &
    payload$indicateurs$territoire == "22001",]
  expect_equal(nrow(pooled),1L)
  expect_equal(pooled$value,525)
  expect_identical(projection$descriptor$dataset_id, metadata$indicator_pages$prix_m2$series_dataset_id)
  expect_identical(projection$descriptor$comparison_point, "2025")
})

test_that("owned series publication retries, rebinds and replaces only its dataset", {
  points <- data.frame(dataset_id="enaf", indicator_id="conso_enaf_annuel",
    territory_id="22001", territory_type="commune", axis_value="2024",
    observation_period="2024", value=0, status="measured", stringsAsFactors=FALSE)
  descriptor <- list(dataset_id="enaf", indicator_id="conso_enaf_annuel", axis_kind="year",
    axis_values="2024", completeness="may_be_missing", comparison_point="2024",
    label="ENAF", unit="ha", direction="low", allowed_levels="commune", descriptor_version="1")
  rev_hash <- series_revision_hash("consoenaf","2025","Cerema","ENAF","2025","2025-01-01","2026-07-24")
  rev_id <- paste0("consoenaf-2025-",substr(rev_hash,1L,16L))
  revisions <- data.frame(provenance_revision_id=rev_id, source_id="consoenaf",
    vintage_id="2025", source_name="Cerema", dataset_name="ENAF", source_version="2025",
    reference_date=as.Date("2025-01-01"), publication_date=as.Date("2026-07-24"), revision_hash=rev_hash)
  projection <- list(points=points, descriptor=descriptor, provenance=revisions,
    point_provenance=data.frame(dataset_id="enaf",indicator_id="conso_enaf_annuel",
      territory_id="22001",axis_value="2024",provenance_revision_id=rev_id))
  state <- new.env(parent=emptyenv())
  state$units <- list(enaf=list(version="v1", facts="enaf-old", provenance="p1", timestamp=1),
    ocsge=list(version="o1", facts="ocsge", provenance="p2", timestamp=2))
  state$reference <- "ref1"
  db <- list(transaction=function(expr) force(expr), lock=function(dataset) invisible(dataset),
    dataset_marker=function(dataset) {
      x <- state$units[[dataset]]
      if (is.null(x)) data.frame() else data.frame(content_version=x$version,
        reference_content_version=x$reference %||% state$reference)
    }, reference_marker=function() data.frame(content_version=state$reference),
    replace_dataset=function(p, version) {
      old <- state$units[[p$descriptor$dataset_id]]
      state$units[[p$descriptor$dataset_id]] <- list(version=version, facts=p$points,
        descriptor=p$descriptor, provenance=p$provenance, reference=state$reference,
        timestamp=(old$timestamp %||% 0)+1)
    })
  original_state <- state$units$ocsge
  first <- publish_owned_series_projection(projection, db)
  expect_true(first$changed)
  expect_identical(state$units$ocsge, original_state)
  after_first <- state$units$enaf
  no_op <- publish_owned_series_projection(projection, db)
  expect_false(no_op$changed)
  expect_identical(state$units$enaf, after_first)
  state$reference <- "ref2"
  rebound <- publish_owned_series_projection(projection, db)
  expect_true(rebound$rebound)
  expect_identical(state$units$ocsge, original_state)
  expect_identical(state$units$enaf$timestamp, after_first$timestamp + 1)
})

test_that("owned series validators reject duplicate axes, undeclared roles and missing provenance", {
  p <- list(
    descriptor=list(dataset_id="state",indicator_id="artif_par_habitant",axis_kind="state_role",
      axis_values=c("M2","M3"),completeness="may_be_missing",comparison_point=NULL,
      label="État",unit="m²/hab",direction="none",allowed_levels="commune",descriptor_version="1"),
    points=data.frame(dataset_id="state",indicator_id="artif_par_habitant",territory_id="22001",
      territory_type="commune",axis_value="M2",observation_period="2021-2025",value=0,
      status="measured",stringsAsFactors=FALSE),
    provenance=data.frame(provenance_revision_id="placeholder",source_id="s",vintage_id="v",source_name="IGN",
      dataset_name="OCS-GE",source_version="2021",reference_date=as.Date("2021-01-01"),
      publication_date=as.Date("2025-09-12"),revision_hash="h",stringsAsFactors=FALSE),
    point_provenance=data.frame(dataset_id="state",indicator_id="artif_par_habitant",territory_id="22001",
      axis_value="M2",provenance_revision_id="placeholder",stringsAsFactors=FALSE))
  p$provenance$revision_hash <- series_revision_hash("s","v","IGN","OCS-GE","2021","2021-01-01","2025-09-12")
  p$provenance$provenance_revision_id <- paste0("s-v-",substr(p$provenance$revision_hash,1L,16L))
  p$point_provenance$provenance_revision_id <- p$provenance$provenance_revision_id[[1L]]
  expect_invisible(validate_owned_series_projection(p))
  bad <- p; bad$descriptor$axis_values <- c("M2","M2")
  expect_error(validate_owned_series_projection(bad),"Invalid owned series descriptor")
  bad <- p; bad$descriptor$axis_values <- c("M3","M2")
  expect_error(validate_owned_series_projection(bad),"Invalid owned series descriptor")
  bad <- p; bad$points$axis_value <- "M4"
  expect_error(validate_owned_series_projection(bad),"undeclared axis")
  bad <- p; bad$point_provenance <- bad$point_provenance[FALSE,,drop=FALSE]
  expect_error(validate_owned_series_projection(bad),"requires at least one provenance")
  bad <- p; bad$points$territory_type <- "region"
  expect_error(validate_owned_series_projection(bad),"undeclared axis/level")
})

test_that("conso ENAF projection follows canonical facts and descriptor-selected point", {
  payload <- compute_payload(communes_fixture_milieux_ocsge(), theme=theme_milieux())
  metadata <- jsonlite::read_json(testthat::test_path("../../inst/extdata/theme-metadata/theme_milieux.json"), simplifyVector=FALSE)
  payload$indicateurs <- payload$indicateurs[payload$indicateurs$key != "conso_enaf_annuel" |
    payload$indicateurs$type %in% unlist(metadata$indicator_pages$conso_enaf_annuel$levels), , drop=FALSE]
  registry <- register_conso_enaf_series_publisher(list(), metadata)
  projection <- registry$conso_enaf_annuel$project(payload)
  expect_identical(projection$descriptor$comparison_point,
    as.character(metadata$indicator_pages$conso_enaf_annuel$comparison$detail))
  canonical <- payload$indicateurs[payload$indicateurs$key == "conso_enaf_annuel", , drop=FALSE]
  expect_identical(projection$descriptor$axis_values,
    as.character(metadata$indicator_pages$conso_enaf_annuel$comparison$details))
  expect_identical(projection$descriptor$allowed_levels,
    unlist(metadata$indicator_pages$conso_enaf_annuel$levels, use.names=FALSE))
  canonical <- canonical[canonical$detail %in% projection$descriptor$axis_values &
    canonical$type %in% projection$descriptor$allowed_levels, , drop=FALSE]
  key <- function(territory, level, axis) paste(territory, level, axis, sep="|")
  canonical_key <- key(canonical$territoire, canonical$type, as.character(canonical$detail))
  projected_key <- key(projection$points$territory_id, projection$points$territory_type,
    projection$points$axis_value)
  expect_length(unique(canonical_key), nrow(canonical))
  expect_length(unique(projected_key), nrow(projection$points))
  expect_setequal(projected_key, canonical_key)
  canonical <- canonical[match(projected_key, canonical_key), , drop=FALSE]
  expect_identical(projection$points$indicator_id, rep("conso_enaf_annuel", nrow(canonical)))
  expect_identical(projection$points$observation_period, as.character(canonical$detail))
  expect_equal(projection$points$value, canonical$value)
  expect_identical(projection$points$status, ifelse(is.na(canonical$value), "missing", "measured"))
  expect_true(all(projection$points$source_id == projection$descriptor$source_id))
  expect_identical(projection$points$vintage_id,
    paste(as.character(canonical$vintage_version), canonical$vintage_date_reference, sep="/"))
  expect_true(all(projection$points$axis_value %in% projection$descriptor$axis_values))
})

test_that("production series input is projected from the canonical Parquet and metadata", {
  root <- testthat::test_path("../../../public/data")
  metadata_path <- testthat::test_path("../../inst/extdata/theme-metadata/theme_milieux.json")
  projection <- read_conso_enaf_series_projection(root, metadata_path)
  canonical <- nanoparquet::read_parquet(file.path(root, "indicateurs_milieux.parquet"))
  metadata <- jsonlite::read_json(metadata_path, simplifyVector=FALSE)
  annual <- canonical[canonical$key == "conso_enaf_annuel", , drop=FALSE]
  selected <- annual[annual$detail %in% metadata$indicator_pages$conso_enaf_annuel$comparison$details &
    annual$type %in% unlist(metadata$indicator_pages$conso_enaf_annuel$levels), , drop=FALSE]
  excluded_region <- annual[annual$type == "region", , drop=FALSE]
  expect_equal(nrow(projection$points), 17710L)
  expect_equal(nrow(excluded_region), 14L)
  expect_equal(nrow(annual), nrow(projection$points) + nrow(excluded_region))
  key <- function(territory, level, year) paste(territory, level, year, sep="|")
  projected_key <- key(projection$points$territory_id, projection$points$territory_type,
    projection$points$axis_value)
  expected_key <- key(selected$territoire, selected$type, as.character(selected$detail))
  expect_setequal(projected_key, expected_key)
  matched <- selected[match(projected_key, expected_key), , drop=FALSE]
  expect_equal(projection$points$value, matched$value)
  expect_identical(projection$points$status, ifelse(is.na(matched$value), "missing", "measured"))
  expect_identical(projection$points$vintage_id,
    paste(as.character(matched$vintage_version), matched$vintage_date_reference, sep="/"))
  expect_identical(projection$descriptor$comparison_point,
    as.character(metadata$indicator_pages$conso_enaf_annuel$comparison$detail))
  expect_true(all(projection$points$source_id == "consoenaf"))
  expect_equal(projection$excluded$region$row_count, 14L)
  expect_identical(projection$excluded$region$policy, "territory_fiche_only")
  vintages <- nanoparquet::read_parquet(file.path(root, "vintages.parquet"))
  expect_identical(projection$canonical_vintage_source,
    as.character(vintages$source[match("consoenaf", vintages$id)]))
  expect_error(require_series_publish_opt_in(""), "explicit LUSK_PUBLISH_SERIES=1")
  expect_error(require_series_publish_opt_in("0"), "explicit LUSK_PUBLISH_SERIES=1")
  expect_invisible(require_series_publish_opt_in("1"))
})

test_that("owned ENAF projection preserves its canonical facts and immutable provenance", {
  root <- testthat::test_path("../../../public/data")
  metadata_path <- testthat::test_path("../../inst/extdata/theme-metadata/theme_milieux.json")
  metadata <- jsonlite::read_json(metadata_path, simplifyVector=FALSE)
  projection <- owned_conso_enaf_projection(list(
    indicateurs=nanoparquet::read_parquet(file.path(root,"indicateurs_milieux.parquet")),
    vintages=nanoparquet::read_parquet(file.path(root,"vintages.parquet"))), metadata)
  expect_invisible(validate_owned_series_projection(projection))
  expect_identical(projection$descriptor$dataset_id,"conso_enaf_annuel")
  expect_equal(nrow(projection$points),17724L)
  expect_equal(sum(projection$points$territory_type=="region"),14L)
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
  old_artifact <- nanoparquet::read_parquet(file.path(root,"indicateurs_milieux.parquet"))
  old_artifact <- old_artifact[old_artifact$key=="artif_par_habitant",]
  old_artifact$state_role <- NULL
  old_artifact$source_components <- NULL
  expect_error(project_artif_m2m3_projection(old_artifact,histories,vintages,metadata),
    "typed roles or source components")
})

test_that("canonical vintage source label is checked against vintage Parquet identity", {
  root <- testthat::test_path("../../../public/data")
  indicators <- nanoparquet::read_parquet(file.path(root, "indicateurs_milieux.parquet"))
  vintages <- nanoparquet::read_parquet(file.path(root, "vintages.parquet"))
  metadata <- jsonlite::read_json(testthat::test_path("../../inst/extdata/theme-metadata/theme_milieux.json"), simplifyVector=FALSE)
  # Keep version and both dates unchanged: only corrupt the human source label.
  source_idx <- which(vintages$id == "consoenaf")
  expect_length(source_idx, 1L)
  vintages$source[[source_idx]] <- "wrong label with same vintage/date"
  expect_error(project_conso_enaf_series_from_artifacts(indicators, vintages, metadata),
    "source label differs")
})

test_that("stable artifact reader detects replacement during the read window", {
  input <- tempfile("series-input-")
  writeLines("before", input)
  on.exit(unlink(input))
  expect_error(read_stable_series_artifacts(c(input=input), function(paths) {
    readLines(paths[["input"]])
    writeLines("replacement", paths[["input"]])
    "old projection"
  }), "changed while reading")
})

test_that("owned series CLI validates before connecting and enforces explicit publish guards", {
  expect_identical(series_revision_hash("abc"),"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  fields <- c("s","v","n","d","v","2025-01-01","2025-01-02")
  exact_hash <- "4d208ad8b6f3c729d6dc423a9bee8f97fc5e513589e2e9fb441fda926883ce28"
  revision_hash <- do.call(series_revision_hash,as.list(fields))
  expect_identical(revision_hash,exact_hash)
  expect_identical(paste0("s-v-",substr(revision_hash,1L,16L)),"s-v-4d208ad8b6f3c729")
  points <- data.frame(dataset_id="enaf",indicator_id="i",territory_id="t",
    territory_type="commune",axis_value="2024",observation_period="2024",
    value=1,status="measured")
  hash <- series_revision_hash("s","v","n","d","v","2025-01-01","2025-01-02")
  rid <- paste0("s-v-",substr(hash,1,16))
  projection <- list(dataset_id="enaf",points=points,
    descriptor=list(dataset_id="enaf",indicator_id="i",axis_kind="year",axis_values="2024",
      completeness="may_be_missing",comparison_point="2024",label="i",unit="ha",direction="low",
      allowed_levels="commune",descriptor_version="1"),
    provenance=data.frame(provenance_revision_id=rid,source_id="s",vintage_id="v",source_name="n",
      dataset_name="d",source_version="v",reference_date=as.Date("2025-01-01"),
      publication_date=as.Date("2025-01-02"),revision_hash=hash),
    point_provenance=data.frame(dataset_id="enaf",indicator_id="i",territory_id="t",
      axis_value="2024",provenance_revision_id=rid))
  connects <- 0L
  connect <- function() { connects <<- connects+1L; stop("must not connect") }
  expect_equal(length(dispatch_owned_series_cli("check",list(enaf=projection),connect)$versions),1L)
  expect_equal(connects,0L)
  expect_error(dispatch_owned_series_cli("publish",list(enaf=projection),connect,opt_in="0"),"LUSK_PUBLISH_OWNED_SERIES=1")
  expect_error(dispatch_owned_series_cli("publish",list(enaf=projection),connect,opt_in="1"),"--indicator-id or explicit --all")
  expect_error(dispatch_owned_series_cli("publish",list(enaf=projection),connect,opt_in="1",lusk_mode="cron"),"cron")
  bad <- projection; bad$points$value <- Inf
  expect_error(dispatch_owned_series_cli("publish",list(enaf=bad),connect,opt_in="1",all=TRUE),"observation")
  expect_equal(connects,0L)
})

test_that("owned-series selectors resolve only their owner and preserve all-check", {
  base <- local({
    points <- data.frame(dataset_id="d",indicator_id="placeholder",territory_id="t",territory_type="commune",
      axis_value="2024",observation_period="2024",value=1,status="measured")
    hash <- series_revision_hash("s","v","n","d","v","2025-01-01","2025-01-02"); rid <- paste0("s-v-",substr(hash,1,16))
    list(dataset_id="d",points=points,descriptor=list(dataset_id="d",indicator_id="x",axis_kind="year",axis_values="2024",
      completeness="may_be_missing",comparison_point="2024",label="x",unit="ha",direction="low",allowed_levels="commune",descriptor_version="1"),
      provenance=data.frame(provenance_revision_id=rid,source_id="s",vintage_id="v",source_name="n",dataset_name="d",source_version="v",
        reference_date=as.Date("2025-01-01"),publication_date=as.Date("2025-01-02"),revision_hash=hash),
      point_provenance=data.frame(dataset_id="d",indicator_id="x",territory_id="t",axis_value="2024",provenance_revision_id=rid))
  })
  ids <- c("conso_enaf_annuel","artif_par_habitant","prix_m2","raccordement_courbe")
  projections <- setNames(lapply(ids,function(id) {p<-base;p$descriptor$indicator_id<-id;p$points$indicator_id<-id;p$point_provenance$indicator_id<-id;p}),ids)
  connect <- function() stop("check must not connect")
  expect_setequal(names(dispatch_owned_series_cli("check",projections,connect)$projections),ids)
  for (id in ids) expect_identical(names(dispatch_owned_series_cli("check",projections,connect,indicator_id=id)$projections),id)
  md <- jsonlite::read_json(testthat::test_path("../../inst/extdata/theme-metadata/theme_mobilite.json"),simplifyVector=FALSE)
  expect_identical(owned_series_indicator_owner("raccordement_reference",list(),list(),md),"raccordement_courbe")
  expect_error(dispatch_owned_series_cli("check",projections,connect,indicator_id="not_registered"),"Unknown owned-series indicator_id")
  expect_error(dispatch_owned_series_cli("publish",projections,connect,opt_in="1"),"--indicator-id or explicit --all")
  expect_error(dispatch_owned_series_cli("publish",projections,connect,opt_in="1",indicator_id="not_registered"),"Unknown owned-series indicator_id")
})

test_that("production owned-series reader and check route project both canonical fixture units", {
  payload <- compute_payload(communes_fixture_milieux_ocsge(),theme=theme_milieux())
  habitat <- payload_habitat()
  habitat_vintages <- vintages_habitat()
  all_vintages <- unique(rbind(vintages_milieux(), habitat_vintages))
  sortie <- tempfile("owned-series-canonical-"); dir.create(sortie)
  on.exit(unlink(sortie,recursive=TRUE))
  nanoparquet::write_parquet(payload$indicateurs,file.path(sortie,"indicateurs_milieux.parquet"))
  nanoparquet::write_parquet(payload$histoires,file.path(sortie,"histoires_milieux.parquet"))
  nanoparquet::write_parquet(habitat$indicateurs,file.path(sortie,"indicateurs_habitat.parquet"))
  nanoparquet::write_parquet(all_vintages,file.path(sortie,"vintages.parquet"))
  metadata_path <- testthat::test_path("../../inst/extdata/theme-metadata/theme_milieux.json")
  habitat_metadata_path <- testthat::test_path("../../inst/extdata/theme-metadata/theme_habitat.json")
  projections <- read_owned_series_projections(sortie,metadata_path,habitat_metadata_path)
  metadata <- jsonlite::read_json(metadata_path,simplifyVector=FALSE)
  habitat_metadata <- jsonlite::read_json(habitat_metadata_path,simplifyVector=FALSE)
  expect_setequal(vapply(projections,function(p) p$descriptor$dataset_id,character(1)),
    vapply(list(metadata$indicator_pages$conso_enaf_annuel,
      metadata$indicator_pages$artif_par_habitant, habitat_metadata$indicator_pages$prix_m2),
      function(p) p$series_dataset_id,character(1)))
  expect_equal(vapply(projections,function(p) nrow(p$points),integer(1)),
    c(conso_enaf_annuel_owned=210L,artif_par_habitant_owned=30L,
      prix_m2_owned=sum(habitat$indicateurs$key=="prix_m2" & !is.na(habitat$indicateurs$detail) &
        habitat$indicateurs$type %in% c("commune","epci","departement","region"))))
  producer <- project_conso_enaf_series_from_artifacts(payload$indicateurs,
    vintages_milieux(),metadata)
  prix_producer <- project_prix_m2_owned_series(habitat$indicateurs,habitat_vintages,habitat_metadata)
  canonical_files <- list(indicateurs=nanoparquet::read_parquet(file.path(sortie,"indicateurs_milieux.parquet")),
    vintages=nanoparquet::read_parquet(file.path(sortie,"vintages.parquet")))
  established <- owned_conso_enaf_projection(canonical_files,metadata)
  expect_identical(scalar_content_version(projections$conso_enaf_annuel_owned),
    scalar_content_version(established))
  expect_identical(scalar_content_version(projections$prix_m2_owned),scalar_content_version(prix_producer))
  expect_equal(attr(projections,"excluded")$conso_enaf_annuel_owned$region$row_count,
    0L)
  expect_equal(producer$excluded$region$row_count,14L)
  unlink(file.path(sortie,c("histoires_milieux.parquet","indicateurs_habitat.parquet")))
  scoped <- read_owned_series_projections(sortie,metadata_path,habitat_metadata_path,indicator_id="conso_enaf_annuel")
  expect_identical(names(scoped),"conso_enaf_annuel_owned")
  expect_identical(scoped$conso_enaf_annuel_owned$descriptor$indicator_id,"conso_enaf_annuel")
  connect <- function() stop("check route must not connect")
  checked <- dispatch_owned_series_cli("check",projections,connect)
  expect_identical(unlist(checked$versions),vapply(projections,scalar_content_version,character(1)))
  script <- paste(readLines(testthat::test_path("../../scripts/publish-serving-tables.R"),warn=FALSE),collapse="\n")
  expect_true(grepl("--owned-series-check",script,fixed=TRUE))
  expect_true(grepl("--owned-series-publish",script,fixed=TRUE))
  expect_true(grepl("dispatch_owned_series_cli(mode,projections,connect,indicator_id=indicator_id,all=publish_all)",script,fixed=TRUE))
})

test_that("canonical annual rows outside descriptor axes or levels are rejected", {
  payload <- compute_payload(communes_fixture_milieux_ocsge(), theme=theme_milieux())
  metadata <- jsonlite::read_json(testthat::test_path("../../inst/extdata/theme-metadata/theme_milieux.json"), simplifyVector=FALSE)
  bad_axis <- payload
  extra <- bad_axis$indicateurs[bad_axis$indicateurs$key == "conso_enaf_annuel", ][1, , drop=FALSE]
  extra$detail <- "2099"
  bad_axis$indicateurs <- rbind(bad_axis$indicateurs, extra)
  expect_error(project_conso_enaf_series(bad_axis, metadata), "undeclared.*axis|axis.*undeclared")
  bad_level <- payload
  extra <- bad_level$indicateurs[bad_level$indicateurs$key == "conso_enaf_annuel", ][1, , drop=FALSE]
  extra$type <- "unknown_level"
  bad_level$indicateurs <- rbind(bad_level$indicateurs, extra)
  expect_error(project_conso_enaf_series(bad_level, metadata), "unexpected territory level")
  duplicate <- payload
  duplicate$indicateurs <- rbind(duplicate$indicateurs,
    duplicate$indicateurs[duplicate$indicateurs$key == "conso_enaf_annuel", ][1, , drop=FALSE])
  expect_error(project_conso_enaf_series(duplicate, metadata), "duplicate territory/axis keys")
  mislabeled <- payload
  annual_idx <- which(mislabeled$indicateurs$key == "conso_enaf_annuel")[[1L]]
  mislabeled$indicateurs$theme[[annual_idx]] <- "demographie"
  expect_error(project_conso_enaf_series(mislabeled, metadata), "mislabeled")
  bad_metadata <- metadata
  bad_metadata$indicator_pages$conso_enaf_annuel$label <- NULL
  expect_error(project_conso_enaf_series(payload, bad_metadata), "descriptor is invalid")
  bad_metadata <- metadata
  bad_metadata$source_records$consoenaf$vintages[[1]]$version <- "wrong-vintage"
  eligible <- payload
  eligible$indicateurs <- eligible$indicateurs[eligible$indicateurs$key != "conso_enaf_annuel" |
    eligible$indicateurs$type %in% unlist(metadata$indicator_pages$conso_enaf_annuel$levels), , drop=FALSE]
  expect_error(project_conso_enaf_series(eligible, bad_metadata), "vintage disagrees")
})

test_that("registered series publication is atomic, idempotent and rollback-safe", {
  descriptor <- list(indicator_id="fixture_series", axis_kind="year", axis_values="2020",
    completeness="may_be_missing", comparison_point="2020", label="fixture", unit="ha",
    direction="low", allowed_levels="commune", source_id="fixture", vintage_id="v1", descriptor_version="1")
  points <- data.frame(indicator_id="fixture_series", territory_id="t1", territory_type="commune",
    axis_value="2020", observation_period="2020", value=0, status="measured",
    source_id="fixture", vintage_id="v1")
  state <- new.env(parent=emptyenv()); state$marker <- NULL; state$marker_reference <- NULL
  state$reference <- "territory-v1"; state$projection <- NULL
  db <- list(transaction=function(expr) {
    before <- list(marker=state$marker, marker_reference=state$marker_reference, projection=state$projection)
    tryCatch(force(expr), error=function(e) {
      state$marker <- before$marker; state$marker_reference <- before$marker_reference
      state$projection <- before$projection; stop(e)
    })
  }, marker=function(name) {
    if (name == "territory_reference") return(data.frame(content_version=state$reference,
      reference_content_version=NA_character_))
    if (is.null(state$marker)) data.frame() else data.frame(content_version=state$marker,
      reference_content_version=state$marker_reference)
  },
  replace=function(projection, version) {
    state$projection <- projection; state$marker <- version; state$marker_reference <- state$reference
  })
  registry <- register_series_publisher(list(), "fixture", function(input) list(points=points, descriptor=descriptor),
    function(projection, db, version) db$replace(projection, version))
  expect_true(publish_registered_series(registry, "fixture", NULL, db)$changed)
  marker <- state$marker
  expect_false(publish_registered_series(registry, "fixture", NULL, db)$changed)
  state$reference <- "territory-v2"
  rebound <- publish_registered_series(registry, "fixture", NULL, db)
  expect_false(rebound$changed)
  expect_true(rebound$rebound)
  expect_identical(state$marker_reference, "territory-v2")
  changed_points <- points; changed_points$value <- 1
  broken <- register_series_publisher(list(), "broken", function(input) list(points=changed_points, descriptor=descriptor),
    function(projection, db, version) { db$replace(projection, version); stop("injected failure") })
  expect_error(publish_registered_series(broken, "broken", NULL, db), "injected failure")
  expect_identical(state$marker, marker)
})

test_that("publishing a validated projection preserves its exact identity and version", {
  payload <- compute_payload(communes_fixture_milieux_ocsge(), theme=theme_milieux())
  metadata <- jsonlite::read_json(testthat::test_path("../../inst/extdata/theme-metadata/theme_milieux.json"), simplifyVector=FALSE)
  payload$indicateurs <- payload$indicateurs[payload$indicateurs$key != "conso_enaf_annuel" |
    payload$indicateurs$type %in% unlist(metadata$indicator_pages$conso_enaf_annuel$levels), , drop=FALSE]
  projection <- project_conso_enaf_series(payload, metadata)
  state <- new.env(parent=emptyenv()); state$marker <- NULL; state$marker_reference <- NULL
  state$reference <- "territory-v1"; state$projection <- NULL; state$seen_version <- NULL
  db <- list(transaction=function(expr) force(expr), marker=function(name) {
    if (name == "territory_reference") return(data.frame(content_version=state$reference,
      reference_content_version=NA_character_))
    if (is.null(state$marker)) data.frame() else data.frame(content_version=state$marker,
      reference_content_version=state$marker_reference)
  }, replace=function(got, version) {
    state$projection <- got; state$seen_version <- version
    state$marker <- version; state$marker_reference <- state$reference
  })
  result <- publish_series_projection(projection, db,
    function(got, database, version) database$replace(got, version))
  expect_identical(state$projection, projection)
  expect_identical(state$seen_version, scalar_content_version(projection))
  expect_identical(result$content_version, state$seen_version)
})

test_that("series smoke cleanup is limited to owned RESTRICT schema drops", {
  sql <- series_smoke_schema_cleanup_sql(function(parts) paste0('"', parts, '"'), "series_it_owned")
  expect_true(grepl('DROP TABLE IF EXISTS "series_it_owned"."ordered_series" RESTRICT',
    paste(sql, collapse="\n"), fixed=TRUE))
  expect_true(grepl('DROP SCHEMA IF EXISTS "series_it_owned" RESTRICT', tail(sql, 1L), fixed=TRUE))
  expect_error(series_smoke_schema_cleanup_sql(function(parts) paste0('"', parts, '"'), "public"),
    "owned series smoke schema")
})
test_that("owned raccordement publisher projects focal curve and a distinct named median reference", {
  axis_keys <- paste0("t",sprintf("%04d",c(0,15,30,45,60,90,120,180,240,300,360)))
  metadata <- list(theme="mobilite",owned_series_routes=list(raccordement_courbe=list(
     dataset_id="raccordement_curve",indicator_id="raccordement_courbe",theme_id="mobilite",
     active_read_route=TRUE,reference_read_route=TRUE,axis_kind="duration_minute",
     axis_values=c(0,15,30,45,60,90,120,180,240,300,360),
      observation_period_contract=list(kind="snapshot_date",source="raccordement_recipe_date_mesure"),
     comparison_contract=list(statistic="median",scope="default_group"),
     reference_indicator="raccordement_reference",reference=list(id="commune_bretonne_mediane",
        label="Commune bretonne médiane",role="analytical_reference",statistic="median_routed_communes"),
     reference_id="commune_bretonne_mediane",reference_role="analytical_reference",
     reference_label="Commune bretonne médiane",reference_statistic="median_routed_communes",
     source_id="matrice_temps_mairies")),
    indicator_pages=list(raccordement_courbe=list(indicator="raccordement_courbe",unit="%",direction="high",
      comparison=list(detail="t0090",details=axis_keys),label="Courbe raccordement",sources="matrice_temps_mairies",
      trajectory=list(reference=list(indicator="raccordement_reference",territoire="53",
        label="Commune bretonne médiane")),levels=c("commune","epci","departement"))),
    source_records=list(matrice_temps_mairies=list(dataset="Matrice de temps",vintages=list(list(
       id="matrice_temps_mairies",version="2026-09-18",dateReference="2026-08-25",
      datePublication="2026-08-26")))))
  keys <- axis_keys
  rows <- function(key, values, territory, type) data.frame(key=key,theme="mobilite",detail=keys,
    type=type,territoire=territory,value=values,unit="%",vintage_source="Fixture matrix",
    observation_period=rep("2026-09-16",length(keys)),
    vintage_version="2026-09-18",vintage_date_reference=as.Date("2026-08-25"),
    vintage_date_publication=as.Date("2026-08-26"),stringsAsFactors=FALSE)
  canonical <- rbind(rows("raccordement_courbe",seq(.1,1,length.out=11),"35238","commune"),
    rows("raccordement_courbe",rep(NA_real_,11),"29001","commune"),
    rows("raccordement_reference",seq(.05,.95,length.out=11),"53","region"))
  vintages <- data.frame(id="matrice_temps_mairies",source="Fixture matrix",version="2026-09-18",
    date_reference=as.Date("2026-08-25"),date_publication=as.Date("2026-08-26"))
  projection <- project_raccordement_owned_series(canonical,vintages,metadata,
    producer_contract=list(date_mesure="2026-09-16"))
  expect_no_error(validate_owned_series_projection(projection))
  expect_equal(projection$descriptor$axis_kind,"duration_minute")
  expect_true(projection$descriptor$active_read_route)
  rennes <- projection$points[projection$points$territory_id=="35238",]
  unavailable <- projection$points[projection$points$territory_id=="29001",]
  expect_equal(rennes$value,seq(.1,1,length.out=11))
  expect_true(all(unavailable$status=="missing"))
  expect_true(all(is.na(unavailable$value)))
  expect_equal(projection$named_reference$value,seq(.05,.95,length.out=11))
  expect_equal(unique(projection$points$observation_period),"2026-09-16")
  expect_equal(unique(projection$named_reference$observation_period),"2026-09-16")
  changed_recipe <- project_raccordement_owned_series(
    transform(canonical, observation_period="2026-09-17"),vintages,metadata,
    producer_contract=list(date_mesure="2026-09-17"))
  expect_equal(unique(changed_recipe$points$observation_period),"2026-09-17")
  expect_error(project_raccordement_owned_series(canonical,vintages,metadata,
    producer_contract=list(date_mesure="2026-09-17")),"observation period")
  expect_equal(projection$named_reference_descriptors$reference_indicator_id,"raccordement_reference")
  expect_true(projection$named_reference_descriptors$active_read_route)
  expect_equal(projection$descriptor$comparison_statistic,"median")
  expect_equal(projection$descriptor$comparison_scope,"default_group")
  expect_false("territory_id" %in% names(projection$named_reference))
  expect_true(all(projection$named_reference$reference_id=="commune_bretonne_mediane"))
  missing_identity <- metadata; missing_identity$indicator_pages$raccordement_courbe$indicator <- NULL
  expect_error(project_raccordement_owned_series(canonical,vintages,missing_identity,
    producer_contract=list(date_mesure="2026-09-16")),
    "metadata contract")
  invalid_identity <- metadata; invalid_identity$owned_series_routes$raccordement_courbe$indicator_id <- "other_curve"
  expect_error(project_raccordement_owned_series(canonical,vintages,invalid_identity,
    producer_contract=list(date_mesure="2026-09-16")),
    "metadata contract")
  missing_reference_route <- metadata
  missing_reference_route$owned_series_routes$raccordement_courbe$reference_indicator <- NULL
  expect_error(project_raccordement_owned_series(canonical,vintages,missing_reference_route,
    producer_contract=list(date_mesure="2026-09-16")),
    "metadata contract")
  wrong_period <- canonical; wrong_period$observation_period[1] <- "2026-08-25"
  expect_error(project_raccordement_owned_series(wrong_period,vintages,metadata,
    producer_contract=list(date_mesure="2026-09-16")),
    "observation period")
})
