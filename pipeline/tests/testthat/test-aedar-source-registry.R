test_that("AEDAR source registry includes every current downloadable source in one raw bundle", {
  expect_setequal(AEDAR_SOURCE_RESOURCES$filename, c(
    "address-walk-53-2026v1.parquet",
    "address-transit-gain-53-2026v1.parquet",
    "address-transit-53-2026v1.parquet",
    "address-car-53-2026v1.parquet",
    "address-bike-lts4-53-2026v1.parquet",
    "address-bike-lts2-53-2026v1.parquet",
    "aggregates-commune-53-2026v1.parquet",
    "aggregates-epci-53-2026v1.parquet",
    "aggregates-departement-53-2026v1.parquet",
    "aggregates-region-53-2026v1.parquet",
    "aedar-doc-2026v1.pdf"
  ))
  expect_equal(sum(AEDAR_SOURCE_RESOURCES$kind == "address"), 6L)
  expect_equal(sum(AEDAR_SOURCE_RESOURCES$kind == "aggregate"), 4L)
  expect_equal(sum(AEDAR_SOURCE_RESOURCES$kind == "documentation"), 1L)
  expect_true(all(nzchar(AEDAR_SOURCE_RESOURCES$url)))
  expect_true(all(grepl("^[0-9a-f]{40}$", AEDAR_SOURCE_RESOURCES$sha1)))
})

make_aedar_download_fixture <- function() {
  bytes <- charToRaw("aedar source fixture bytes")
  list(bytes=bytes, resources=data.frame(
    url="https://example.invalid/aedar.parquet", filename="fixture.parquet",
    sha1=paste(as.character(openssl::sha1(bytes)),collapse=""),
    stringsAsFactors=FALSE))
}

test_that("AEDAR source acquisition validates and atomically installs downloaded bytes", {
  fixture <- make_aedar_download_fixture()
  raw_dir <- tempfile("aedar-source-download-")
  on.exit(unlink(raw_dir,recursive=TRUE),add=TRUE)
  calls <- 0L
  downloader <- function(url,destfile,mode,quiet) {
    calls <<- calls+1L
    expect_equal(url,fixture$resources$url)
    expect_equal(mode,"wb")
    writeBin(fixture$bytes,destfile)
    0L
  }
  paths <- download_aedar_sources(raw_dir,fixture$resources,download=downloader)
  expect_equal(names(paths),fixture$resources$filename)
  expect_equal(readBin(paths[[1L]],"raw",n=100L),fixture$bytes)
  expect_false(file.exists(paste0(paths[[1L]],".part")))
  expect_equal(calls,1L)
  expect_equal(download_aedar_sources(raw_dir,fixture$resources,download=downloader),paths)
  expect_equal(calls,1L)
})

test_that("AEDAR source acquisition rejects bad downloaded or cached bytes", {
  fixture <- make_aedar_download_fixture()
  raw_dir <- tempfile("aedar-source-integrity-")
  on.exit(unlink(raw_dir,recursive=TRUE),add=TRUE)
  bad_download <- function(url,destfile,mode,quiet) {
    writeBin(charToRaw("wrong bytes"),destfile)
    0L
  }
  expect_error(download_aedar_sources(raw_dir,fixture$resources,download=bad_download),
               "Pinned AEDAR checksum mismatch")
  target <- file.path(raw_dir,fixture$resources$filename)
  expect_false(file.exists(target))
  expect_false(file.exists(paste0(target,".part")))
  writeBin(charToRaw("corrupt cached bytes"),target)
  expect_error(download_aedar_sources(raw_dir,fixture$resources,
    download=function(...) stop("must not download over a corrupt cached file")),
    "Pinned AEDAR checksum mismatch")
  expect_equal(readBin(target,"raw",n=100L),charToRaw("corrupt cached bytes"))
})

test_that("AEDAR source acquisition cleans partial files after a failed download", {
  fixture <- make_aedar_download_fixture()
  raw_dir <- tempfile("aedar-source-failure-")
  on.exit(unlink(raw_dir,recursive=TRUE),add=TRUE)
  expect_error(download_aedar_sources(raw_dir,fixture$resources,
    download=function(url,destfile,mode,quiet) {
      writeBin(charToRaw("partial"),destfile)
      stop("fixture network failure")
    }),"fixture network failure")
  expect_length(list.files(raw_dir,all.files=FALSE),0L)
})

test_that("AEDAR source acquisition rejects malformed selections", {
  fixture <- make_aedar_download_fixture()
  raw_dir <- tempfile("aedar-source-selection-")
  on.exit(unlink(raw_dir,recursive=TRUE),add=TRUE)
  expect_error(download_aedar_sources(raw_dir,fixture$resources["filename"]),"malformed")
  expect_error(download_aedar_sources(raw_dir,rbind(fixture$resources,fixture$resources)),"malformed")
})

test_that("AEDAR aggregate resource compatibility remains limited to all four levels", {
  expected <- AEDAR_SOURCE_RESOURCES[AEDAR_SOURCE_RESOURCES$kind=="aggregate",
    c("level","url","filename","sha1","published_on")]
  expect_equal(AEDAR_AGGREGATE_RESOURCES,expected)
  expect_equal(AEDAR_AGGREGATE_RESOURCES$level,AEDAR_AGGREGATE_LEVELS)
  expect_error(verify_aedar_resource_hash("unused","unknown"),"Unknown AEDAR aggregate level")
})
