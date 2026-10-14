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

test_that("AEDAR TYPEQU metadata joins individual codes and preserves explicit no-gamme", {
  registry <- data.frame(TYPEQU=sprintf("A%03d",1:235),
    LIB_TYPEQU=paste("Equipment",1:235), stringsAsFactors=FALSE)
  i <- seq_len(235)
  domain <- ((i-1L) %% 27L) %% 7L + 1L
  hierarchy <- data.frame(TYPEQU=registry$TYPEQU,label=registry$LIB_TYPEQU,
    domain_code=paste0("D",domain),domain_label=paste("Domain",domain),
    subdomain_code=paste0("S",((i-1L) %% 27L)+1L),subdomain_label=paste("Subdomain",((i-1L) %% 27L)+1L),source_order=i)
  gamme <- data.frame(TYPEQU=registry$TYPEQU, LIBELLE_TYPEQU=registry$LIB_TYPEQU,
    GAMME=c("Proximité","Hors Gamme",NA_character_,rep("Proximité",232)),stringsAsFactors=FALSE)
  result <- validate_aedar_typequ_metadata(registry,hierarchy,gamme)
  expect_equal(result$TYPEQU,registry$TYPEQU)
  expect_equal(result$gamme_status[1:3],c("classified","hors_gamme","absent"))
  expect_identical(result$GAMME[2],"Hors Gamme")
  expect_true(is.na(result$GAMME[3]))
  expect_error(validate_aedar_typequ_metadata(registry,hierarchy,gamme[-1,]),
    "exactly one")
  bad <- gamme; bad$LIBELLE_TYPEQU[1] <- "Wrong"
  expect_error(validate_aedar_typequ_metadata(registry,hierarchy,bad),"label")
})

test_that("official-format hierarchy and individual TYPEQU workbook parse in source order", {
  registry <- read_aedar_typequ_registry()
  i <- seq_len(nrow(registry))
  html <- c('<table><thead><tr><th>Code</th><th>Libellé</th><th>Description</th></tr></thead><tbody>')
  domain_codes <- paste0("D",1:7)
  subdomain_codes <- paste0("S",1:27)
  for (domain in seq_len(7)) {
    html <- c(html,sprintf('<tr><td indentlevel="1">%s</td><td>Domain %d</td><td>Family</td></tr>',domain_codes[domain],domain))
    subdomains <- which(((seq_len(27)-1L) %% 7L)+1L==domain)
    for (subdomain in subdomains) {
      html <- c(html,sprintf('<tr><td indentlevel="2">%s</td><td>Subdomain %d</td><td>Group</td></tr>',subdomain_codes[subdomain],subdomain))
      entries <- which(((i-1L) %% 27L)+1L==subdomain)
      for (entry in entries) html <- c(html,sprintf('<tr><td indentlevel="3">%s</td><td>%s</td><td>Description %d</td></tr>',registry$TYPEQU[entry],registry$LIB_TYPEQU[entry],entry))
    }
  }
  html <- c(html,"</tbody></table>")
  hierarchy_path <- tempfile(fileext=".html")
  writeLines(html,hierarchy_path,useBytes=TRUE)
  workbook <- testthat::test_path("fixtures","aedar-typequ-gamme-2025.xlsx")
  sources <- read_aedar_typequ_metadata_sources(hierarchy_path,workbook)
  expect_equal(nrow(sources$hierarchy),235L)
  expect_equal(length(unique(sources$hierarchy$domain_code)),7L)
  expect_equal(length(unique(paste(sources$hierarchy$domain_code,sources$hierarchy$subdomain_code))),27L)
  expect_setequal(sources$hierarchy$TYPEQU,registry$TYPEQU)
  expect_equal(normalize_aedar_typequ_label_for_validation(
    sources$hierarchy$label[match(registry$TYPEQU,sources$hierarchy$TYPEQU)]),
    normalize_aedar_typequ_label_for_validation(registry$LIB_TYPEQU))
  expect_equal(sources$hierarchy$source_order,seq_len(235L))
  expect_true(all(sources$hierarchy$domain_label==paste("Domain",sub("^D","",sources$hierarchy$domain_code))))
  expect_true(all(sources$hierarchy$subdomain_label==paste("Subdomain",sub("^S","",sources$hierarchy$subdomain_code))))
  # Workbook regroupement codes intentionally repeat; individual TYPEQU are unique.
  expect_true(anyDuplicated(sources$gamme$TYPEQU_REGROUPEMENT)>0L)
  expect_equal(sources$gamme$TYPEQU,registry$TYPEQU)
  result <- validate_aedar_typequ_metadata(registry,sources$hierarchy,sources$gamme)
  expect_equal(result$source_order,seq_len(235L))
  expect_equal(result$GAMME[match(sources$gamme$TYPEQU,result$TYPEQU)],sources$gamme$GAMME)
  source_examples <- sources$gamme$TYPEQU[1:3]
  expect_equal(result$gamme_status[match(source_examples,result$TYPEQU)],c("classified","hors_gamme","absent"))
  expect_identical(result$GAMME[match(source_examples[2],result$TYPEQU)],"Hors Gamme")
  expect_true(is.na(result$GAMME[match(source_examples[3],result$TYPEQU)]))
})

test_that("approved apostrophe and surrounding-space label differences validate source-faithfully", {
  registry <- read_aedar_typequ_registry()
  i <- seq_len(nrow(registry)); subdomain <- (i-1L) %% 27L + 1L
  domain <- (subdomain-1L) %% 7L + 1L
  hierarchy <- data.frame(TYPEQU=registry$TYPEQU,label=registry$LIB_TYPEQU,
    domain_code=paste0("D",domain),domain_label=paste("Domain",domain),
    subdomain_code=paste0("S",subdomain),subdomain_label=paste("Subdomain",subdomain),
    source_order=i,stringsAsFactors=FALSE)
  apostrophe_codes <- c("A135","D503","D705","F125")
  for (code in apostrophe_codes) {
    index <- match(code,hierarchy$TYPEQU)
    hierarchy$label[index] <- gsub("'","’",hierarchy$label[index],fixed=TRUE)
  }
  d710 <- match("D710",hierarchy$TYPEQU)
  hierarchy$label[d710] <- trimws(hierarchy$label[d710])
  gamme <- data.frame(TYPEQU=registry$TYPEQU,LIBELLE_TYPEQU=registry$LIB_TYPEQU,
    GAMME=rep(NA_character_,nrow(registry)),stringsAsFactors=FALSE)
  gamme$LIBELLE_TYPEQU[d710] <- paste0(gamme$LIBELLE_TYPEQU[d710]," ")
  result <- validate_aedar_typequ_metadata(registry,hierarchy,gamme)
  expect_identical(result$LIB_TYPEQU[match(apostrophe_codes,result$TYPEQU)],
    hierarchy$label[match(apostrophe_codes,hierarchy$TYPEQU)])
  expect_identical(result$LIB_TYPEQU[match("D710",result$TYPEQU)],hierarchy$label[d710])
  expect_identical(result$GAMME,gamme$GAMME)
  substantive <- hierarchy
  substantive$label[substantive$TYPEQU=="A135"] <- "COUR D’ASSISES MODIFIÉE"
  expect_error(validate_aedar_typequ_metadata(registry,substantive,gamme),"label")
})
