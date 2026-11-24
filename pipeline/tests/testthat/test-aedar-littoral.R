# Littoral AEDAR fixed context (#1043, child of #1040). The pooled reference
# must be produced from the already-pooled littoral artifact - never by
# averaging commune summaries - and the fixed group rows must carry the pooled
# statistic for both C and NC, like the density preset.




test_that("both AEDAR pool builders resolve the registered address-origin spine identically", {
  dir <- tempfile("aedar-littoral-spine-"); dir.create(dir)
  on.exit(unlink(dir,recursive=TRUE),add=TRUE)
  registered <- file.path(dir,AEDAR_ADDRESS_ORIGIN_FILE)
  override <- file.path(dir,"explicit-origin.parquet")
  origins <- data.frame(address_id=c("a","b"),code_insee=c("22001","22002"),lon=1:2,lat=1:2)
  nanoparquet::write_parquet(origins,registered)
  nanoparquet::write_parquet(origins,override)
  previous <- Sys.getenv("LUSK_AEDAR_ADDRESS_ORIGINS",unset=NA_character_)
  Sys.unsetenv("LUSK_AEDAR_ADDRESS_ORIGINS")
  on.exit({
    if(is.na(previous)) Sys.unsetenv("LUSK_AEDAR_ADDRESS_ORIGINS")
    else Sys.setenv(LUSK_AEDAR_ADDRESS_ORIGINS=previous)
  },add=TRUE)
  # Default: no env var -> the registered file in the raw cache is found.
  expect_equal(aedar_address_origin_path(dir),registered)
  # Explicit override always wins over the registered default.
  Sys.setenv(LUSK_AEDAR_ADDRESS_ORIGINS=override)
  expect_equal(aedar_address_origin_path(dir),override)
  Sys.unsetenv("LUSK_AEDAR_ADDRESS_ORIGINS")
  expect_error(aedar_address_origin_path(tempfile("empty-")),AEDAR_ADDRESS_ORIGIN_FILE)
  # Both builders use that ONE seam, so their precedence cannot drift.
  pipeline_root <- testthat::test_path("..","..")
  for(script in c("build-aedar-density-aggregate.R","build-aedar-littoral-aggregate.R")) {
    text <- paste(readLines(file.path(pipeline_root,"scripts",script),warn=FALSE),collapse="\n")
    expect_match(text,"origins_path<-aedar_address_origin_path\\(raw_dir\\)")
  }
})

test_that("littoral summary projects the pooled law from already-pooled facts", {
  bindings <- aedar_aggregate_reading_bindings()
  source <- aedar_littoral_test_source()
  facts <- aedar_littoral_pooled_facts()

  projected <- project_aedar_littoral_summary(facts,source,registry_size=2L)
  expect_identical(names(projected),AEDAR_LITTORAL_SUMMARY_COLUMNS)
  expect_equal(nrow(projected),2L*nrow(bindings))
  available <- projected[projected$group_id=="C",]
  unavailable <- projected[projected$group_id=="NC",]
  expected <- vapply(seq_len(nrow(bindings)),function(i)
    sum(facts[facts$territory_id=="C",bindings$underlying[[i]]]),numeric(1))
  expect_equal(available$value,expected)
  expect_true(all(available$status=="available" & available$n_typequ==2L))
  expect_true(all(available$n_addresses==2L & available$n_observed==4L))
  expect_true(all(available$coverage_status=="covered"))
  expect_true(all(unavailable$status=="unavailable" & is.na(unavailable$value) &
    is.na(unavailable$n_typequ)))

  # A commune-summary average must not be substituted: partial members with no
  # complete registry stay unavailable (the producer pooling law is inherited).
  partial <- facts[facts$territory_id=="C" & facts$TYPEQU=="A",]
  expect_true(all(project_aedar_littoral_summary(partial,source,registry_size=2L)$status==
    "unavailable"))
  # Pooled facts carrying a density-class key are rejected outright.
  bad <- facts; bad$territory_type <- "density_class"
  expect_error(project_aedar_littoral_summary(bad,source,registry_size=2L),
    "already-pooled littoral facts")
})

test_that("littoral membership uses the served C/NC classification exactly", {
  ref <- data.frame(territory_type=c("commune","commune","commune","epci","region"),
    territory_id=c("22001","22002","22003","E1","53"),
    epci_id=c("E1","E1","E2",NA_character_,NA_character_),
    density_class_code=c("1","1","2",NA_character_,NA_character_),
    littoral_code=c("C","C","NC",NA_character_,NA_character_),stringsAsFactors=FALSE)
  rows <- aedar_comparison_membership_rows(ref)
  lit <- rows[rows$comparison_context=="littoral",]
  expect_setequal(lit$group_id,c("C","NC"))
  expect_true(all(lit$territory_type=="commune"))
  # Same-status peers are exactly the produced scopes.
  expect_equal(lit$group_id[order(lit$group_id)],c("C","NC"))
  # membership set-equality validation accepts matching scopes and rejects a
  # missing C/NC group.
  expect_silent(validate_aedar_comparison_membership(list(groups=rows),ref))
  short <- rows[!(rows$comparison_context=="littoral" & rows$group_id=="NC"),]
  expect_error(validate_aedar_comparison_membership(list(groups=short),ref),
    "contexts/groups differ")
})

test_that("fixed partition requires pooled statistic for both density and littoral", {
  membership <- function(context,group) data.frame(comparison_context=context,
    group_id=group,territory_type="commune",stringsAsFactors=FALSE)
  measures <- AEDAR_AGGREGATE_MEASURES
  mk <- function(context,group,statistic) data.frame(
    comparison_context=context,group_id=group,territory_type="commune",
    TYPEQU="A104",measure=measures,statistic=statistic,
    value=1,n_addresses=1,n_observed=1,coverage_status="covered",stringsAsFactors=FALSE)
  # Both pooled contexts validate against their produced scope.
  expect_silent(validate_aedar_comparison_part(mk("density_class","1","pooled"),
    data.frame(),"A104",membership("density_class","1")))
  expect_silent(validate_aedar_comparison_part(mk("littoral","C","pooled"),
    data.frame(),"A104",membership("littoral","C")))
  expect_silent(validate_aedar_comparison_part(mk("littoral","NC","pooled"),
    data.frame(),"A104",membership("littoral","NC")))
  # A median littoral group is rejected.
  expect_error(validate_aedar_comparison_part(mk("littoral","C","median"),
    data.frame(),"A104",membership("littoral","C")),"invalid fixed-context statistic")
})

# #1150: the AEDAR reader must consume the builder's ACTUAL crosswalk output.
# The pinned DREAL positive-list fixture and the 1202-commune canonical universe
# are both committed, so the membership proof below needs no DB and no network.
aedar_littoral_fixture_chemin <- function() {
  testthat::test_path("fixtures", "littoral-dreal-bretagne-2023-04-21.csv")
}

aedar_littoral_univers_canonique <- function() {
  readr::read_csv(
    testthat::test_path("..", "..", "inst", "extdata", "population_communes_2023.csv"),
    col_types = readr::cols(code_commune = readr::col_character()),
    show_col_types = FALSE, progress = FALSE
  )$code_commune
}

test_that("littoral reference binds to the builder crosswalk and the pinned DREAL positive list", {
  path <- aedar_littoral_fixture_chemin()
  communes <- aedar_littoral_univers_canonique()
  source <- lire_classes_littoral(path)
  # On the pre-#1150 code this call is the immediate failure: the reader selects
  # code_insee from a builder that now returns code_commune.
  ref <- read_aedar_littoral_reference(path, communes = communes)
  built <- construire_crosswalk_littoral(source, communes)

  # The expectation is bound to the builder's declared output contract, not to
  # a second literal list: renaming a builder column without moving the
  # declaration fails HERE instead of drifting silently downstream (#1150).
  expect_setequal(names(built), CROSSWALK_LITTORAL_COLUMNS)
  code_column <- CROSSWALK_LITTORAL_COLUMNS[[1L]]
  statut_column <- CROSSWALK_LITTORAL_COLUMNS[[2L]]

  cw <- ref$crosswalk
  expect_setequal(names(cw), c("code_insee", "littoral_code", "littoral_label"))
  expect_identical(cw$code_insee, as.character(built[[code_column]]))
  expect_identical(cw$littoral_code, as.character(built[[statut_column]]))
  expect_identical(cw$littoral_label,
    ifelse(cw$littoral_code == "C", "Littoral", "Non littoral"))

  # The served C/NC membership IS the DREAL positive list joined to the canon.
  positifs <- intersect(source$Code_insee, communes)
  expect_length(communes, 1202L)
  expect_equal(nrow(cw), 1202L)
  expect_setequal(cw$code_insee[cw$littoral_code == "C"], positifs)
  expect_setequal(cw$code_insee[cw$littoral_code == "NC"], setdiff(communes, positifs))
  expect_equal(cw$littoral_code[match(c("29083", "29084"), cw$code_insee)], c("C", "C"))
  expect_identical(ref$sha256, tolower(sha256_aedar_file(path)))
})

test_that("littoral reference fails closed when the builder crosswalk columns are renamed", {
  path <- aedar_littoral_fixture_chemin()
  communes <- aedar_littoral_univers_canonique()
  original <- construire_crosswalk_littoral
  local_mocked_bindings(construire_crosswalk_littoral = function(source, communes, ...) {
    x <- original(source, communes, ...)
    names(x) <- c("commune", "statut", "classement_source")
    x
  })
  expect_error(read_aedar_littoral_reference(path, communes = communes),
    "crosswalk|contract|inattendu|unexpected")
})

test_that("comparison input identity validates the classification version against the manifest reference", {
  # #1154: the littoral classification version is a 32-hex version TOKEN that
  # travels with the canonical territory reference, not a 64-hex file digest.
  # It must equal the manifest's reference_content_version (single source).
  reference_content_version <- "ec2d980c88a9401441cd1e934fde0411"
  make_hashes <- function() c(`mode:walk`=paste(rep("a",64),collapse=""),
    `mode:transit_gain`=paste(rep("b",64),collapse=""),
    `mode:transit`=paste(rep("c",64),collapse=""),
    `mode:car`=paste(rep("d",64),collapse=""),
    `mode:bike_lts4`=paste(rep("e",64),collapse=""),
    `mode:bike_lts2`=paste(rep("f",64),collapse=""),
    address_origins=paste(rep("1",64),collapse=""),
    density_reference=paste(rep("2",64),collapse=""),
    density_artifact=paste(rep("3",64),collapse=""),
    density_aggregate_content_version=paste(rep("4",64),collapse=""),
    density_reference_identity=MANIFEST_CLASSES_DENSITE$id[[1L]],
    density_reference_sha256=MANIFEST_CLASSES_DENSITE$sha256[[1L]],
    density_reference_vintage=MANIFEST_CLASSES_DENSITE$vintage[[1L]],
    littoral_artifact=paste(rep("7",64),collapse=""),
    littoral_aggregate_content_version=paste(rep("8",64),collapse=""),
    littoral_reference_identity=MANIFEST_CLASSES_LITTORAL$id[[1L]],
    littoral_reference_sha256=MANIFEST_CLASSES_LITTORAL$sha256[[1L]],
    littoral_classification_content_version=aedar_littoral_classification_content_version(reference_content_version),
    littoral_reference_vintage=MANIFEST_CLASSES_LITTORAL$vintage[[1L]])
  validate <- function(hashes,reference=reference_content_version) {
    identity <- as.character(jsonlite::toJSON(as.list(hashes),auto_unbox=TRUE))
    version <- paste(as.character(openssl::sha256(charToRaw(identity))),collapse="")
    validate_aedar_comparison_input_identity(identity,version,
      reference_content_version=reference,require_littoral=TRUE)
  }

  # A legitimate 32-hex classification version equal to the manifest reference passes.
  expect_silent(validate(make_hashes()))

  # A classification version that disagrees with the manifest fails, named.
  divergent <- make_hashes()
  divergent["littoral_classification_content_version"] <- "00112233445566778899aabbccddeeff"
  expect_error(validate(divergent),"pinned source/reference")

  # The three genuine digests stay strict 64-hex: short/malformed values still fail.
  for (field in c("littoral_artifact","littoral_aggregate_content_version","littoral_reference_sha256")) {
    malformed <- make_hashes()
    malformed[field] <- "deadbeef"
    expect_error(validate(malformed),"pinned source/reference",info=field)
  }

  # Omitting the classification version still breaks the required-name set.
  incomplete <- make_hashes()[setdiff(names(make_hashes()),"littoral_classification_content_version")]
  expect_error(validate(incomplete),"pinned source/reference")
})

test_that("base comparison input identity path is unchanged without littoral", {
  hashes <- c(`mode:walk`=paste(rep("a",64),collapse=""),
    `mode:transit_gain`=paste(rep("b",64),collapse=""),
    `mode:transit`=paste(rep("c",64),collapse=""),
    `mode:car`=paste(rep("d",64),collapse=""),
    `mode:bike_lts4`=paste(rep("e",64),collapse=""),
    `mode:bike_lts2`=paste(rep("f",64),collapse=""),
    address_origins=paste(rep("1",64),collapse=""),
    density_reference=paste(rep("2",64),collapse=""),
    density_artifact=paste(rep("3",64),collapse=""),
    density_aggregate_content_version=paste(rep("4",64),collapse=""),
    density_reference_identity=MANIFEST_CLASSES_DENSITE$id[[1L]],
    density_reference_sha256=MANIFEST_CLASSES_DENSITE$sha256[[1L]],
    density_reference_vintage=MANIFEST_CLASSES_DENSITE$vintage[[1L]])
  pin_identity <- function(h) {
    identity <- as.character(jsonlite::toJSON(as.list(h),auto_unbox=TRUE))
    list(identity=identity,
      version=paste(as.character(openssl::sha256(charToRaw(identity))),collapse=""))
  }
  valid <- pin_identity(hashes)
  # No reference_content_version argument and require_littoral=FALSE: the old path.
  expect_silent(validate_aedar_comparison_input_identity(valid$identity,valid$version,
    require_littoral=FALSE))
  # A tampered base digest still fails exactly as before.
  tampered <- hashes; tampered["density_artifact"] <- "deadbeef"
  bad <- pin_identity(tampered)
  expect_error(validate_aedar_comparison_input_identity(bad$identity,bad$version,
    require_littoral=FALSE),"pinned source/reference")
})
